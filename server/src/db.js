import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

// SQLite for v1 (zero external services on the VM). Production moves to
// Postgres + Prisma; the schema below maps 1:1 onto that migration.
export function openDb(dbPath = config.dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      batch_id TEXT,
      status TEXT NOT NULL,          -- queued | processing | done | failed | cancelled
      original_name TEXT NOT NULL,
      input_ext TEXT NOT NULL,
      input_w INTEGER NOT NULL,
      input_h INTEGER NOT NULL,
      scale INTEGER NOT NULL,
      tile INTEGER NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_batch ON jobs(batch_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
  `);
  return db;
}

export function publicJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    batchId: row.batch_id || null,
    status: row.status,
    originalName: row.original_name,
    inputW: row.input_w,
    inputH: row.input_h,
    scale: row.scale,
    outputW: row.status === 'done' ? row.input_w * row.scale : null,
    outputH: row.status === 'done' ? row.input_h * row.scale : null,
    error: row.error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
