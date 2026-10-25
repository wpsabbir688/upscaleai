import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

// SQLite for Stage 2 (zero external services on the VM). Production moves to
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
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',      -- user | admin
      status TEXT NOT NULL DEFAULT 'active',  -- active | suspended
      plan TEXT NOT NULL DEFAULT 'free',      -- free | pro | premium (label only until payments exist)
      credits INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,   -- signup | job | refund | admin_adjust
      job_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor_id TEXT,          -- NULL for CLI seeding
      action TEXT NOT NULL,   -- credit_adjust | plan_change | suspend | unsuspend | admin_seeded | payment_approve | payment_reject
      target_user_id TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
    CREATE TABLE IF NOT EXISTS idempotency (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      response TEXT NOT NULL,  -- exact JSON body returned on first creation
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    -- Manual bKash/Nagad payment claims: the user sends money OUTSIDE the
    -- app (Send Money to the owner's number) and submits the transaction
    -- here. A claim is only ever 'pending' until a human admin approves or
    -- rejects it after checking their own bKash/Nagad account. There is no
    -- automated verification and no gateway of any kind. txn_id is globally
    -- unique: one transaction can be claimed only once.
    CREATE TABLE IF NOT EXISTS payment_claims (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      method TEXT NOT NULL,           -- bkash | nagad
      amount_bdt INTEGER NOT NULL,
      txn_id TEXT NOT NULL UNIQUE,
      sender_mobile TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
      reject_reason TEXT,
      admin_id TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_claims_user ON payment_claims(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_claims_status ON payment_claims(status, created_at DESC);
  `);
  // Ledger detail column (payment approvals record txn_id + method here).
  const ledgerCols = db.prepare('PRAGMA table_info(credit_ledger)').all().map((c) => c.name);
  if (!ledgerCols.includes('detail')) db.exec('ALTER TABLE credit_ledger ADD COLUMN detail TEXT');
  // v1 -> Stage 2 migration: jobs gain an owner + credit bookkeeping.
  // Rows from v1 have user_id NULL and are therefore inaccessible to every
  // account (ownership check requires an exact match) — the old shared list
  // is intentionally gone, not silently re-attributed.
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
  if (!cols.includes('user_id')) db.exec("ALTER TABLE jobs ADD COLUMN user_id TEXT");
  if (!cols.includes('credit_cost')) db.exec('ALTER TABLE jobs ADD COLUMN credit_cost INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('credit_refunded')) db.exec('ALTER TABLE jobs ADD COLUMN credit_refunded INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at DESC)');
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
    creditCost: row.credit_cost || 0,
    outputW: row.status === 'done' ? row.input_w * row.scale : null,
    outputH: row.status === 'done' ? row.input_h * row.scale : null,
    error: row.error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Never expose password_hash or session material. Claims never carry any
// payment password/PIN — none is ever collected or stored.
export function publicClaim(row) {
  if (!row) return null;
  return {
    id: row.id,
    method: row.method,
    amountBdt: row.amount_bdt,
    credits: row.amount_bdt, // 1 BDT = 1 credit (see config.creditPerBdt)
    txnId: row.txn_id,
    senderMobile: row.sender_mobile,
    status: row.status,
    rejectReason: row.reject_reason || null,
    decidedAt: row.decided_at || null,
    createdAt: row.created_at,
    userEmail: row.user_email || null,
  };
}

// Never expose password_hash or session material.
export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    plan: row.plan,
    credits: row.credits,
    createdAt: row.created_at,
  };
}

export function writeAudit(db, actorId, action, targetUserId, detail) {
  db.prepare(`INSERT INTO audit_log
    (id, actor_id, action, target_user_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      randomUUID(), actorId, action, targetUserId,
      detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)),
      Date.now(),
    );
}
