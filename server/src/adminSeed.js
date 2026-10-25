// Startup admin seeding for container deploys (e.g. Hugging Face Spaces),
// where there is no shell to run scripts/seed-admin.js.
//
// Reads UPSCALE_ADMIN_EMAIL / UPSCALE_ADMIN_PASSWORD from the environment
// ONLY — never commit these values. Behaviour (deliberately different from
// the CLI script, so restarts are safe):
//   - env absent            -> no-op (returns { seeded: false })
//   - user missing          -> created as admin with the env password
//   - existing non-admin    -> promoted to admin, password NOT changed
//   - already admin         -> no-op (an existing admin password is never
//                              reset by a restart, so Profile password
//                              changes survive container restarts)
// The CLI script (scripts/seed-admin.js) keeps its own documented
// promote-and-reset behaviour for local use; this hook never resets.
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { writeAudit } from './db.js';
import { config } from './config.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function ensureAdminFromEnv(db) {
  const email = (process.env.UPSCALE_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.UPSCALE_ADMIN_PASSWORD || '';
  if (!email && !password) return { seeded: false, reason: 'env-absent' };
  if (!EMAIL_RE.test(email)) throw new Error('UPSCALE_ADMIN_EMAIL is missing or invalid.');
  if (password.length < 8) throw new Error('UPSCALE_ADMIN_PASSWORD must be at least 8 characters.');

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const now = Date.now();
  if (existing) {
    if (existing.role === 'admin') return { seeded: false, reason: 'already-admin', email };
    db.prepare(`UPDATE users SET role = 'admin', status = 'active',
      updated_at = ? WHERE id = ?`).run(now, existing.id);
    writeAudit(db, null, 'admin_seeded', existing.id, { email, via: 'startup' });
    return { seeded: true, reason: 'promoted', email };
  }
  const userId = randomUUID();
  const hash = await argon2.hash(password);
  db.prepare(`INSERT INTO users
    (id, email, password_hash, role, status, plan, credits, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', 'active', 'free', ?, ?, ?)`)
    .run(userId, email, hash, config.freeCredits, now, now);
  db.prepare(`INSERT INTO credit_ledger (id, user_id, delta, reason, job_id, created_at)
    VALUES (?, ?, ?, 'signup', NULL, ?)`)
    .run(randomUUID(), userId, config.freeCredits, now);
  writeAudit(db, null, 'admin_seeded', userId, { email, via: 'startup' });
  return { seeded: true, reason: 'created', email };
}
