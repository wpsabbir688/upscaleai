import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import argon2 from 'argon2';
import { openDb } from '../src/db.js';
import { ensureAdminFromEnv } from '../src/adminSeed.js';
import { config } from '../src/config.js';

function freshDb() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upscaleai-seed-'));
  return openDb(path.join(tmp, 'jobs.db'));
}

function setEnv(email, password) {
  if (email === undefined) delete process.env.UPSCALE_ADMIN_EMAIL;
  else process.env.UPSCALE_ADMIN_EMAIL = email;
  if (password === undefined) delete process.env.UPSCALE_ADMIN_PASSWORD;
  else process.env.UPSCALE_ADMIN_PASSWORD = password;
}

test.after(() => setEnv(undefined, undefined));

test('env absent is a no-op', async () => {
  const db = freshDb();
  setEnv(undefined, undefined);
  const r = await ensureAdminFromEnv(db);
  assert.equal(r.seeded, false);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, 0);
});

test('valid env creates an admin with signup credits', async () => {
  const db = freshDb();
  setEnv('admin@example.com', 'long-password-here');
  const r = await ensureAdminFromEnv(db);
  assert.equal(r.seeded, true);
  assert.equal(r.reason, 'created');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('admin@example.com');
  assert.equal(user.role, 'admin');
  assert.equal(user.credits, config.freeCredits);
  assert.equal(await argon2.verify(user.password_hash, 'long-password-here'), true);
});

test('second run is a no-op and never resets the password', async () => {
  const db = freshDb();
  setEnv('admin@example.com', 'long-password-here');
  await ensureAdminFromEnv(db);
  // Admin rotates the password via Profile afterwards.
  const rotated = await argon2.hash('rotated-password-here');
  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(rotated, 'admin@example.com');
  const r = await ensureAdminFromEnv(db);
  assert.equal(r.seeded, false);
  assert.equal(r.reason, 'already-admin');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('admin@example.com');
  assert.equal(await argon2.verify(user.password_hash, 'rotated-password-here'), true);
});

test('existing non-admin is promoted without a password change', async () => {
  const db = freshDb();
  const hash = await argon2.hash('user-password-here');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, status, plan,
    credits, created_at, updated_at) VALUES ('u1', 'user@example.com', ?, 'user',
    'active', 'free', 10, 1, 1)`).run(hash);
  setEnv('user@example.com', 'long-password-here');
  const r = await ensureAdminFromEnv(db);
  assert.equal(r.seeded, true);
  assert.equal(r.reason, 'promoted');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('user@example.com');
  assert.equal(user.role, 'admin');
  assert.equal(await argon2.verify(user.password_hash, 'user-password-here'), true);
});

test('invalid env throws (server logs a warning, never crashes)', async () => {
  const db = freshDb();
  setEnv('not-an-email', 'long-password-here');
  await assert.rejects(() => ensureAdminFromEnv(db), /UPSCALE_ADMIN_EMAIL/);
  setEnv('admin@example.com', 'short');
  await assert.rejects(() => ensureAdminFromEnv(db), /UPSCALE_ADMIN_PASSWORD/);
});
