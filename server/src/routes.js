import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import { config } from './config.js';
import { publicJob } from './db.js';
import { validateImageBuffer, tileFor, safeDownloadName } from './validate.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileBytes, files: config.maxBatchFiles },
});

export function makeRouter(db, queue) {
  const r = express.Router();

  function createJob(file, scale, batchId) {
    const v = validateImageBuffer(file.buffer);
    if (!v.ok) return { error: v.error };
    const id = crypto.randomUUID();
    const dir = queue.jobDir(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `input.${v.ext}`), file.buffer);
    const now = Date.now();
    db.prepare(`INSERT INTO jobs
      (id, batch_id, status, original_name, input_ext, input_w, input_h,
       scale, tile, error, created_at, updated_at, expires_at)
      VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`)
      .run(id, batchId, file.originalname || 'image', v.ext, v.width, v.height,
        scale, tileFor(v.width, v.height), now, now, now + config.retentionMs);
    queue.enqueue(id);
    return { job: publicJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)) };
  }

  // Single upload. Body: image file + scale (2 or 4).
  r.post('/jobs', upload.single('image'), (req, res) => {
    const scale = Number(req.body.scale);
    if (scale !== 2 && scale !== 4) {
      return res.status(400).json({ error: 'Scale must be 2 or 4.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    const { job, error } = createJob(req.file, scale, null);
    if (error) return res.status(400).json({ error });
    res.status(201).json(job);
  });

  // Batch upload: up to 10 files, one job each, sharing a batch id.
  r.post('/batch', upload.array('images', config.maxBatchFiles), (req, res) => {
    const scale = Number(req.body.scale);
    if (scale !== 2 && scale !== 4) {
      return res.status(400).json({ error: 'Scale must be 2 or 4.' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded.' });
    }
    const batchId = crypto.randomUUID();
    const jobs = [];
    const rejected = [];
    for (const file of req.files) {
      const { job, error } = createJob(file, scale, batchId);
      if (error) rejected.push({ name: file.originalname, error });
      else jobs.push(job);
    }
    res.status(201).json({ batchId, jobs, rejected });
  });

  r.get('/jobs', (req, res) => {
    const rows = db.prepare(
      'SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100').all();
    res.json(rows.map(publicJob));
  });

  r.get('/jobs/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job not found.' });
    res.json(publicJob(row));
  });

  r.post('/jobs/:id/cancel', (req, res) => {
    const result = queue.cancel(req.params.id);
    if (result === null) return res.status(404).json({ error: 'Job not found.' });
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    res.json(publicJob(row));
  });

  // File serving: paths come only from the DB row (UUID dirs), never from
  // user input, so no traversal is possible here.
  function serveFile(req, res, kind) {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job not found.' });
    const file = kind === 'output'
      ? path.join(queue.jobDir(row.id), 'output.png')
      : path.join(queue.jobDir(row.id), `input.${row.input_ext}`);
    if (kind === 'output' && row.status !== 'done') {
      return res.status(409).json({ error: `Job is ${row.status}, no output yet.` });
    }
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'File expired or missing.' });
    const name = kind === 'output'
      ? safeDownloadName(row.original_name, row.scale)
      : `original_${safeDownloadName(row.original_name, 1).replace('_upscaled_1x', '')}`;
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.resolve(file));
  }

  r.get('/jobs/:id/download', (req, res) => serveFile(req, res, 'output'));
  r.get('/jobs/:id/original', (req, res) => serveFile(req, res, 'input'));

  // Inline preview (no attachment) for the compare slider.
  r.get('/jobs/:id/preview/:kind', (req, res) => {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job not found.' });
    const kind = req.params.kind;
    if (kind !== 'input' && kind !== 'output') {
      return res.status(400).json({ error: 'kind must be input or output.' });
    }
    if (kind === 'output' && row.status !== 'done') {
      return res.status(409).json({ error: `Job is ${row.status}, no output yet.` });
    }
    const file = kind === 'output'
      ? path.join(queue.jobDir(row.id), 'output.png')
      : path.join(queue.jobDir(row.id), `input.${row.input_ext}`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'File expired or missing.' });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.resolve(file));
  });

  r.get('/batch/:id', (req, res) => {
    const rows = db.prepare(
      'SELECT * FROM jobs WHERE batch_id = ? ORDER BY created_at ASC').all(req.params.id);
    if (rows.length === 0) return res.status(404).json({ error: 'Batch not found.' });
    res.json({ batchId: req.params.id, jobs: rows.map(publicJob) });
  });

  // ZIP of the batch's completed outputs. Failed jobs are listed in a
  // notes file inside the zip instead of silently disappearing.
  r.get('/batch/:id/zip', (req, res) => {
    const rows = db.prepare(
      'SELECT * FROM jobs WHERE batch_id = ? ORDER BY created_at ASC').all(req.params.id);
    if (rows.length === 0) return res.status(404).json({ error: 'Batch not found.' });
    const done = rows.filter((x) => x.status === 'done');
    if (done.length === 0) {
      return res.status(409).json({ error: 'No completed images in this batch yet.' });
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="upscaleai_batch_${req.params.id.slice(0, 8)}.zip"`);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('error', () => {
      // Headers are already sent for a streaming ZIP, so a second response
      // is impossible: destroy the stream instead of hanging the client.
      try { res.destroy(); } catch { /* already closed */ }
    });
    archive.pipe(res);
    for (const row of done) {
      const file = path.join(queue.jobDir(row.id), 'output.png');
      if (fs.existsSync(file)) {
        archive.file(file, { name: safeDownloadName(row.original_name, row.scale) });
      }
    }
    const skipped = rows.filter((x) => x.status !== 'done');
    if (skipped.length > 0) {
      const notes = skipped.map((x) =>
        `${x.original_name}: ${x.status}${x.error ? ` — ${x.error}` : ''}`).join('\n');
      archive.append(`These files were not included (not completed):\n${notes}\n`,
        { name: '_notes.txt' });
    }
    archive.finalize();
  });

  // Public capability info, so the UI only offers what is real.
  r.get('/capabilities', (req, res) => {
    res.json({
      scales: [2, 4],
      disabledScales: [6, 8, 10, 15, 20],
      disabledReason: 'Higher scales need staged upscaling, which has not been benchmarked on CPU yet.',
      formats: ['png', 'jpeg', 'webp'],
      maxFileMB: config.maxFileBytes / 1024 / 1024,
      maxDim: config.maxDim,
      model: 'Real-ESRGAN x4plus (RRDBNet, CPU)',
      queueConcurrency: 1,
    });
  });

  return r;
}
