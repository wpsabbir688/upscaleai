// One-time admin seeder. Reads the password ONLY from the environment —
// never commit a password or a default credential to the repo.
//
//   UPSCALE_ADMIN_EMAIL=admin@example.com \
//   UPSCALE_ADMIN_PASSWORD='...' \
//   node scripts/seed-admin.js
//
// Behaviour: creates the user if missing, otherwise promotes the existing
// account to admin and resets its password to the env value (so the same
// script rotates the admin password). Writes an audit-log entry either way.
// DB_PATH / DATA_DIR env overrides are honoured (see src/config.js).
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { openDb, publicUser, writeAudit } from '../src/db.js';
import { config } from '../src/config.js';

const email = (process.env.UPSCALE_ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.UPSCALE_ADMIN_PASSWORD || '';

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error('seed-admin: UPSCALE_ADMIN_EMAIL is missing or invalid.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('seed-admin: UPSCALE_ADMIN_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

const db = openDb();
const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
const hash = await argon2.hash(password);
const now = Date.now();

let userId;
if (existing) {
  db.prepare(`UPDATE users SET password_hash = ?, role = 'admin',
    status = 'active', updated_at = ? WHERE id = ?`)
    .run(hash, now, existing.id);
  userId = existing.id;
  console.log(`seed-admin: promoted existing account ${email} to admin (password reset).`);
} else {
  userId = randomUUID();
  db.prepare(`INSERT INTO users
    (id, email, password_hash, role, status, plan, credits, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', 'active', 'free', ?, ?, ?)`)
    .run(userId, email, hash, config.freeCredits, now, now);
  db.prepare(`INSERT INTO credit_ledger (id, user_id, delta, reason, job_id, created_at)
    VALUES (?, ?, ?, 'signup', NULL, ?)`)
    .run(randomUUID(), userId, config.freeCredits, now);
  console.log(`seed-admin: created admin account ${email}.`);
}
writeAudit(db, null, 'admin_seeded', userId, { email });
console.log(`seed-admin: user ${JSON.stringify(publicUser(
  db.prepare('SELECT * FROM users WHERE id = ?').get(userId)))}`);
console.log('seed-admin: done. Rotate this password after first login (Profile → Change password).');
