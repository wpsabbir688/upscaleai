import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { openDb } from './db.js';
import { JobQueue, sweepExpired } from './queue.js';
import { makeRouter } from './routes.js';

export function createApp(dbPath) {
  const db = openDb(dbPath);
  const queue = new JobQueue(db);
  const app = express();
  app.use(express.json());
  // Minimal CORS for local Vite dev (5173). In production the server also
  // serves the built frontend, so same-origin applies.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', makeRouter(db, queue));
  // Multer (size/count) errors become clean JSON 400s, not HTML 500s.
  app.use((err, req, res, next) => {
    if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' ||
        err.code === 'LIMIT_UNEXPECTED_FILE')) {
      return res.status(400).json({ error: 'Upload rejected: file too large or too many files.' });
    }
    if (err) return res.status(400).json({ error: err.message || 'Bad request.' });
    next();
  });
  // Serve the built frontend when present (npm run build in client/).
  const dist = path.resolve(process.cwd(), '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  }
  return { app, db, queue };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app, db } = createApp();
  const removed = sweepExpired(db);
  if (removed) console.log(`[upscaleai] swept ${removed} expired job(s)`);
  setInterval(() => sweepExpired(db), 30 * 60 * 1000);
  app.listen(config.port, () => {
    console.log(`[upscaleai] API on http://localhost:${config.port}`);
  });
}
