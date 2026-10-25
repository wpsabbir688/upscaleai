import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import argon2 from 'argon2';
import { ZipArchive } from 'archiver';
import { config } from './config.js';
import { publicJob, publicUser, writeAudit } from './db.js';
import {
  registerUser, loginUser, logoutSession, requireAuth, requireAdmin,
  changePassword, setSessionCookie, clearSessionCookie,
} from './auth.js';
import { validateImageBuffer, tileFor, safeDownloadName } from './validate.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileBytes, files: config.maxBatchFiles },
});

const costFor = (scale) => config.creditCost[scale];

export function makeRouter(db, queue) {
  const r = express.Router();
  const auth = requireAuth(db);
  const admin = [auth, requireAdmin];

  // ---------------------------------------------------------------- auth
  r.post('/auth/register', async (req, res) => {
    const { user, token, error, status } = await registerUser(
      db, req.body?.email, req.body?.password);
    if (error) return res.status(status).json({ error });
    setSessionCookie(res, token);
    res.status(201).json(user);
  });

  r.post('/auth/login', async (req, res) => {
    const { user, token, error, status } = await loginUser(
      db, req.body?.email, req.body?.password);
    if (error) return res.status(status).json({ error });
    setSessionCookie(res, token);
    res.json(user);
  });

  r.post('/auth/logout', (req, res) => {
    logoutSession(db, req, res);
    res.json({ ok: true });
  });

  r.get('/auth/me', auth, (req, res) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json(publicUser(row));
  });

  // UI and endpoint land together (a past project shipped a UI promise
  // with no endpoint — never again).
  r.post('/auth/change-password', auth, async (req, res) => {
    const { ok, error, status } = await changePassword(
      db, req.user.id, req.sessionHash,
      req.body?.currentPassword, req.body?.newPassword);
    if (!ok) return res.status(status).json({ error });
    res.json({ ok: true });
  });

  r.delete('/auth/account', auth, async (req, res) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    let ok = false;
    try {
      ok = await argon2.verify(row.password_hash, req.body?.password || '');
    } catch { ok = false; }
    if (!ok) return res.status(401).json({ error: 'Password is incorrect.' });
    // Cancel anything active first (refunds land, then everything is wiped).
    const active = db.prepare(
      "SELECT id FROM jobs WHERE user_id = ? AND status IN ('queued','processing')")
      .all(req.user.id);
    for (const j of active) queue.cancel(j.id);
    const all = db.prepare('SELECT id FROM jobs WHERE user_id = ?').all(req.user.id);
    for (const j of all) {
      fs.rmSync(queue.jobDir(j.id), { recursive: true, force: true });
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM jobs WHERE user_id = ?').run(req.user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
      db.prepare('DELETE FROM credit_ledger WHERE user_id = ?').run(req.user.id);
      db.prepare('DELETE FROM idempotency WHERE user_id = ?').run(req.user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    clearSessionCookie(res);
    res.json({ deleted: true });
  });

  r.get('/credits', auth, (req, res) => {
    const user = db.prepare('SELECT credits, plan FROM users WHERE id = ?').get(req.user.id);
    const ledger = db.prepare(
      'SELECT delta, reason, job_id, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(req.user.id)
      .map((x) => ({ delta: x.delta, reason: x.reason, jobId: x.job_id, createdAt: x.created_at }));
    res.json({ balance: user ? user.credits : 0, plan: user ? user.plan : 'free', ledger });
  });

  // ------------------------------------------------------- job ownership
  function ownedJob(req, res) {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!row) { res.status(404).json({ error: 'Job not found.' }); return null; }
    if (row.user_id !== req.user.id) {
      res.status(403).json({ error: 'This job belongs to another user.' });
      return null;
    }
    return row;
  }

  function ownedBatch(req, res) {
    const rows = db.prepare(
      'SELECT * FROM jobs WHERE batch_id = ? ORDER BY created_at ASC').all(req.params.id);
    if (rows.length === 0) { res.status(404).json({ error: 'Batch not found.' }); return null; }
    if (rows.some((x) => x.user_id !== req.user.id)) {
      res.status(403).json({ error: 'This batch belongs to another user.' });
      return null;
    }
    return rows;
  }

  // ------------------------------------------------- atomic job creation
  // Files are staged to their UUID dirs BEFORE the transaction; the
  // transaction (balance check + deduction + job rows + ledger +
  // idempotency) runs synchronously, so no interleaving is possible.
  // On transaction failure the staged dirs are removed again.
  function chargeAndInsert(userId, jobs, idemKey, responseJson) {
    const total = jobs.reduce((s, j) => s + j.cost, 0);
    const now = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
      if (!user) throw Object.assign(new Error('Login required.'), { status: 401 });
      if (user.credits < total) {
        throw Object.assign(
          new Error(`Not enough credits. This needs ${total} credit(s), you have ${user.credits}.`),
          { status: 402 });
      }
      db.prepare('UPDATE users SET credits = credits - ?, updated_at = ? WHERE id = ?')
        .run(total, now, userId);
      for (const j of jobs) {
        db.prepare(`INSERT INTO jobs
          (id, batch_id, status, original_name, input_ext, input_w, input_h,
           scale, tile, user_id, credit_cost, credit_refunded, error,
           created_at, updated_at, expires_at)
          VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`)
          .run(j.id, j.batchId, j.originalName, j.ext, j.w, j.h, j.scale,
            j.tile, userId, j.cost, now, now, now + config.retentionMs);
        db.prepare(`INSERT INTO credit_ledger
          (id, user_id, delta, reason, job_id, created_at) VALUES (?, ?, ?, 'job', ?, ?)`)
          .run(crypto.randomUUID(), userId, -j.cost, j.id, now);
      }
      if (idemKey) {
        db.prepare(`INSERT INTO idempotency (user_id, key, response, created_at)
          VALUES (?, ?, ?, ?)`)
          .run(userId, idemKey, responseJson, now);
      }
      db.exec('COMMIT');
      return { ok: true };
    } catch (e) {
      db.exec('ROLLBACK');
      if (e && e.status) return { ok: false, status: e.status, error: e.message };
      throw e;
    }
  }

  function jobView(j, now) {
    return {
      id: j.id, batchId: j.batchId || null, status: 'queued',
      originalName: j.originalName, inputW: j.w, inputH: j.h, scale: j.scale,
      creditCost: j.cost, outputW: null, outputH: null, error: null,
      createdAt: now, updatedAt: now,
    };
  }

  function stageJobFile(j, buffer) {
    const dir = queue.jobDir(j.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `input.${j.ext}`), buffer);
  }

  function unstage(jobs) {
    for (const j of jobs) fs.rmSync(queue.jobDir(j.id), { recursive: true, force: true });
  }

  function idempotencyHit(userId, key) {
    if (!key) return null;
    const hit = db.prepare('SELECT response FROM idempotency WHERE user_id = ? AND key = ?')
      .get(userId, key);
    return hit ? JSON.parse(hit.response) : null;
  }

  // Single upload. Body: image file + scale (2 or 4).
  r.post('/jobs', auth, upload.single('image'), (req, res) => {
    const scale = Number(req.body.scale);
    if (scale !== 2 && scale !== 4) {
      return res.status(400).json({ error: 'Scale must be 2 or 4.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    const hit = idempotencyHit(req.user.id, req.headers['idempotency-key']);
    if (hit) return res.status(200).json(hit);
    const v = validateImageBuffer(req.file.buffer);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const now = Date.now();
    const j = {
      id: crypto.randomUUID(), batchId: null,
      originalName: req.file.originalname || 'image', ext: v.ext,
      w: v.width, h: v.height, scale, tile: tileFor(v.width, v.height),
      cost: costFor(scale),
    };
    const responseJson = JSON.stringify(jobView(j, now));
    stageJobFile(j, req.file.buffer);
    const result = chargeAndInsert(req.user.id, [j], req.headers['idempotency-key'], responseJson);
    if (!result.ok) { unstage([j]); return res.status(result.status).json({ error: result.error }); }
    queue.enqueue(j.id);
    res.status(201).json(JSON.parse(responseJson));
  });

  // Batch upload: up to 10 files, one job each, sharing a batch id.
  r.post('/batch', auth, upload.array('images', config.maxBatchFiles), (req, res) => {
    const scale = Number(req.body.scale);
    if (scale !== 2 && scale !== 4) {
      return res.status(400).json({ error: 'Scale must be 2 or 4.' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded.' });
    }
    const hit = idempotencyHit(req.user.id, req.headers['idempotency-key']);
    if (hit) return res.status(200).json(hit);
    const batchId = crypto.randomUUID();
    const jobs = [];
    const rejected = [];
    for (const file of req.files) {
      const v = validateImageBuffer(file.buffer);
      if (!v.ok) rejected.push({ name: file.originalname, error: v.error });
      else {
        jobs.push({
          id: crypto.randomUUID(), batchId,
          originalName: file.originalname || 'image', ext: v.ext,
          w: v.width, h: v.height, scale, tile: tileFor(v.width, v.height),
          cost: costFor(scale), buffer: file.buffer,
        });
      }
    }
    if (jobs.length === 0) return res.status(201).json({ batchId, jobs: [], rejected });
    const now = Date.now();
    const responseJson = JSON.stringify({
      batchId, jobs: jobs.map((j) => jobView(j, now)), rejected,
    });
    for (const j of jobs) stageJobFile(j, j.buffer);
    const result = chargeAndInsert(req.user.id, jobs, req.headers['idempotency-key'], responseJson);
    if (!result.ok) { unstage(jobs); return res.status(result.status).json({ error: result.error }); }
    for (const j of jobs) queue.enqueue(j.id);
    res.status(201).json(JSON.parse(responseJson));
  });

  r.get('/jobs', auth, (req, res) => {
    const rows = db.prepare(
      'SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(req.user.id);
    res.json(rows.map(publicJob));
  });

  r.get('/jobs/:id', auth, (req, res) => {
    const row = ownedJob(req, res);
    if (!row) return;
    res.json(publicJob(row));
  });

  r.post('/jobs/:id/cancel', auth, (req, res) => {
    const row = ownedJob(req, res);
    if (!row) return;
    queue.cancel(req.params.id);
    const fresh = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    res.json(publicJob(fresh));
  });

  // File serving: paths come only from the DB row (UUID dirs), never from
  // user input, so no traversal is possible here.
  function serveFile(req, res, kind) {
    const row = ownedJob(req, res);
    if (!row) return;
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

  r.get('/jobs/:id/download', auth, (req, res) => serveFile(req, res, 'output'));
  r.get('/jobs/:id/original', auth, (req, res) => serveFile(req, res, 'input'));

  // Inline preview (no attachment) for the compare slider.
  r.get('/jobs/:id/preview/:kind', auth, (req, res) => {
    const row = ownedJob(req, res);
    if (!row) return;
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

  r.get('/batch/:id', auth, (req, res) => {
    const rows = ownedBatch(req, res);
    if (!rows) return;
    res.json({ batchId: req.params.id, jobs: rows.map(publicJob) });
  });

  // ZIP of the batch's completed outputs. Failed jobs are listed in a
  // notes file inside the zip instead of silently disappearing.
  r.get('/batch/:id/zip', auth, (req, res) => {
    const rows = ownedBatch(req, res);
    if (!rows) return;
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

  // ------------------------------------------------------------ admin
  r.get('/admin/overview', admin, (req, res) => {
    const users = db.prepare(
      'SELECT COUNT(*) c, SUM(status = \'active\') a, SUM(status = \'suspended\') s, SUM(role = \'admin\') ad FROM users').get();
    const jobs = db.prepare(
      'SELECT status, COUNT(*) c FROM jobs GROUP BY status').all();
    const jobCounts = Object.fromEntries(jobs.map((x) => [x.status, x.c]));
    const credits = db.prepare(
      `SELECT reason, SUM(delta) total FROM credit_ledger GROUP BY reason`).all();
    const byReason = Object.fromEntries(credits.map((x) => [x.reason, x.total]));
    const outstanding = db.prepare('SELECT SUM(credits) total FROM users').get().total || 0;
    res.json({
      users: { total: users.c, active: users.a || 0, suspended: users.s || 0, admins: users.ad || 0 },
      jobs: jobCounts,
      credits: {
        grantedBySignup: byReason.signup || 0,
        spentOnJobs: -(byReason.job || 0),
        refunded: byReason.refund || 0,
        adminAdjustments: byReason.admin_adjust || 0,
        outstanding,
      },
    });
  });

  r.get('/admin/users', admin, (req, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 200').all();
    res.json(rows.map(publicUser));
  });

  function adminUserAction(action, fn) {
    return (req, res) => {
      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
      if (!target) return res.status(404).json({ error: 'User not found.' });
      if (target.id === req.user.id && (action === 'suspend')) {
        return res.status(400).json({ error: 'You cannot suspend your own admin account.' });
      }
      const result = fn(target, req);
      if (result && result.error) return res.status(result.status || 400).json({ error: result.error });
      writeAudit(db, req.user.id, action, target.id, result?.detail ?? null);
      const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
      res.json(publicUser(fresh));
    };
  }

  r.post('/admin/users/:id/suspend', admin, adminUserAction('suspend', (target) => {
    db.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?")
      .run(Date.now(), target.id);
    return { detail: { status: 'suspended' } };
  }));

  r.post('/admin/users/:id/unsuspend', admin, adminUserAction('unsuspend', (target) => {
    db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?")
      .run(Date.now(), target.id);
    return { detail: { status: 'active' } };
  }));

  // Plan assignment is a stored label in Stage 2: plans carry no billing or
  // limits until verified payments exist (blocked item, see README).
  r.post('/admin/users/:id/plan', admin, adminUserAction('plan_change', (target, req) => {
    const plan = req.body?.plan;
    if (!['free', 'pro', 'premium'].includes(plan)) {
      return { error: 'Plan must be free, pro, or premium.', status: 400 };
    }
    db.prepare('UPDATE users SET plan = ?, updated_at = ? WHERE id = ?')
      .run(plan, Date.now(), target.id);
    return { detail: { from: target.plan, to: plan } };
  }));

  r.post('/admin/users/:id/credits', admin, (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    const delta = Number(req.body?.delta);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : '';
    if (!Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ error: 'delta must be a non-zero integer.' });
    }
    if (target.credits + delta < 0) {
      return res.status(400).json({ error: `Adjustment would take ${target.email} below 0 credits.` });
    }
    const now = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ?')
        .run(delta, now, target.id);
      db.prepare(`INSERT INTO credit_ledger
        (id, user_id, delta, reason, job_id, created_at) VALUES (?, ?, ?, 'admin_adjust', NULL, ?)`)
        .run(crypto.randomUUID(), target.id, delta, now);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    writeAudit(db, req.user.id, 'credit_adjust', target.id, { delta, reason });
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
    res.json(publicUser(fresh));
  });

  r.get('/admin/jobs', admin, (req, res) => {
    const rows = db.prepare(
      `SELECT j.*, u.email AS user_email FROM jobs j
       LEFT JOIN users u ON u.id = j.user_id
       ORDER BY j.created_at DESC LIMIT 200`).all();
    res.json(rows.map((x) => ({ ...publicJob(x), userEmail: x.user_email || null })));
  });

  r.get('/admin/health', admin, (req, res) => {
    res.json(queue.health());
  });

  r.get('/admin/audit', admin, (req, res) => {
    const rows = db.prepare(
      `SELECT a.*, u1.email AS actor_email, u2.email AS target_email FROM audit_log a
       LEFT JOIN users u1 ON u1.id = a.actor_id
       LEFT JOIN users u2 ON u2.id = a.target_user_id
       ORDER BY a.created_at DESC LIMIT 200`).all();
    res.json(rows.map((x) => ({
      id: x.id, actorEmail: x.actor_email || (x.actor_id ? null : 'CLI seed'),
      action: x.action, targetEmail: x.target_email || null,
      detail: x.detail, createdAt: x.created_at,
    })));
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
      creditCost: config.creditCost,
      freeCredits: config.freeCredits,
      authRequired: true,
    });
  });

  return r;
}
