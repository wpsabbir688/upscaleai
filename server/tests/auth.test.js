import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const serverDir = path.join(here, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upscaleai-auth-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.DB_PATH = path.join(tmp, 'data', 'jobs.db');

const { createApp } = await import('../src/index.js');

let base;
let server;
let db;
let adminCookie;

test.before(async () => {
  const created = createApp(process.env.DB_PATH);
  server = await new Promise((resolve) => {
    const s = created.app.listen(0, () => resolve(s));
  });
  db = created.db;
  base = `http://localhost:${server.address().port}`;
  // Seed the admin through the real CLI script (env vars only, no defaults).
  const seed = spawnSync('node', ['scripts/seed-admin.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      UPSCALE_ADMIN_EMAIL: 'admin@example.com',
      UPSCALE_ADMIN_PASSWORD: 'admin-password-123',
    },
    encoding: 'utf8',
  });
  assert.equal(seed.status, 0, `seed-admin failed: ${seed.stderr}`);
  adminCookie = await login('admin@example.com', 'admin-password-123');
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

function cookieOf(res) {
  const set = res.headers.get('set-cookie');
  assert.ok(set && set.includes('upscaleai_session'), 'session cookie missing');
  assert.match(set, /HttpOnly/);
  return set.split(';')[0];
}

async function register(email, password = 'test-password-123') {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json(), cookie: res.status === 201 ? cookieOf(res) : null };
}

async function login(email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(await res.clone().json().catch(() => ({})))}`);
  return cookieOf(res);
}

function authed(cookie, path, opts = {}) {
  return fetch(`${base}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Cookie: cookie },
  });
}

async function credits(cookie) {
  const res = await authed(cookie, '/api/credits');
  assert.equal(res.status, 200);
  return res.json();
}

async function postJob(cookie, file = 'small.png', scale = 2, extraHeaders = {}) {
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(path.join(fixtures, file))]), file);
  fd.append('scale', String(scale));
  const res = await authed(cookie, '/api/jobs', { method: 'POST', body: fd, headers: extraHeaders });
  return { status: res.status, body: await res.json() };
}

test('registration validation + duplicate rejection', async () => {
  const badEmail = await register('not-an-email');
  assert.equal(badEmail.status, 400);
  const short = await register('short@example.com', 'short');
  assert.equal(short.status, 400);
  const first = await register('dup@example.com');
  assert.equal(first.status, 201);
  assert.equal(first.body.credits, 10); // free signup grant
  assert.equal(first.body.plan, 'free');
  assert.ok(!('password_hash' in first.body));
  const second = await register('dup@example.com');
  assert.equal(second.status, 409);
});

test('wrong-password rejection + suspended account blocked', async () => {
  await register('wrongpw@example.com');
  const bad = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'wrongpw@example.com', password: 'nope-nope-nope' }),
  });
  assert.equal(bad.status, 401);
  const good = await login('wrongpw@example.com', 'test-password-123');
  // Admin suspends the account: the live session must stop working too.
  const users = await (await authed(adminCookie, '/api/admin/users')).json();
  const target = users.find((u) => u.email === 'wrongpw@example.com');
  const sus = await authed(adminCookie, `/api/admin/users/${target.id}/suspend`, { method: 'POST' });
  assert.equal(sus.status, 200);
  const me = await authed(good, '/api/auth/me');
  assert.equal(me.status, 403);
  const relogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'wrongpw@example.com', password: 'test-password-123' }),
  });
  assert.equal(relogin.status, 403);
  const unsus = await authed(adminCookie, `/api/admin/users/${target.id}/unsuspend`, { method: 'POST' });
  assert.equal(unsus.status, 200);
  await login('wrongpw@example.com', 'test-password-123');
});

test('cross-user job access is 403 everywhere (never data)', async () => {
  const a = await register('owner@example.com');
  const b = await register('other@example.com');
  const { status, body } = await postJob(a.cookie);
  assert.equal(status, 201);
  const id = body.id;
  for (const [method, path, want] of [
    ['GET', `/api/jobs/${id}`, 403],
    ['GET', `/api/jobs/${id}/preview/input`, 403],
    ['GET', `/api/jobs/${id}/download`, 403],
    ['POST', `/api/jobs/${id}/cancel`, 403],
  ]) {
    const res = await authed(b.cookie, path, { method });
    assert.equal(res.status, want, `${method} ${path} as other user`);
    const payload = await res.json().catch(() => ({}));
    assert.ok(!payload.outputW && payload.error, 'no job data leaked');
  }
  // Owner can still see + cancel their own job (also frees the worker).
  const mine = await authed(a.cookie, `/api/jobs/${id}`);
  assert.equal(mine.status, 200);
  const cancelled = await authed(a.cookie, `/api/jobs/${id}/cancel`, { method: 'POST' });
  assert.equal((await cancelled.json()).status, 'cancelled');
});

test('admin endpoints are 403 for non-admins', async () => {
  const u = await register('regular@example.com');
  for (const [method, path, body] of [
    ['GET', '/api/admin/overview', undefined],
    ['GET', '/api/admin/users', undefined],
    ['GET', '/api/admin/jobs', undefined],
    ['GET', '/api/admin/health', undefined],
    ['GET', '/api/admin/audit', undefined],
    ['POST', '/api/admin/users/someone/suspend', undefined],
    ['POST', '/api/admin/users/someone/credits', { delta: 5 }],
  ]) {
    const res = await authed(u.cookie, path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(res.status, 403, `${method} ${path} as non-admin`);
  }
  const ok = await authed(adminCookie, '/api/admin/overview');
  assert.equal(ok.status, 200);
  const overview = await ok.json();
  assert.ok(overview.users.total >= 2);
});

test('idempotent creation never double-charges', async () => {
  const u = await register('idem@example.com');
  const before = await credits(u.cookie);
  assert.equal(before.balance, 10);
  const key = 'idem-key-123';
  const first = await postJob(u.cookie, 'small.png', 2, { 'Idempotency-Key': key });
  assert.equal(first.status, 201);
  const mid = await credits(u.cookie);
  assert.equal(mid.balance, 9, '2x costs 1 credit');
  const second = await postJob(u.cookie, 'small.png', 2, { 'Idempotency-Key': key });
  assert.equal(second.status, 200);
  assert.equal(second.body.id, first.body.id, 'retry returns the original job');
  const after = await credits(u.cookie);
  assert.equal(after.balance, 9, 'no second charge on retry');
  await authed(u.cookie, `/api/jobs/${first.body.id}/cancel`, { method: 'POST' });
});

test('failed jobs refund automatically', async () => {
  const u = await register('refund@example.com');
  const src = fs.readFileSync(path.join(fixtures, 'small.png'));
  const trunc = path.join(tmp, 'truncated2.png');
  fs.writeFileSync(trunc, src.subarray(0, 100));
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(trunc)]), 'truncated2.png');
  fd.append('scale', '4');
  const res = await authed(u.cookie, '/api/jobs', { method: 'POST', body: fd });
  assert.equal(res.status, 201);
  const job = await res.json();
  assert.equal((await credits(u.cookie)).balance, 8, '4x costs 2 credits');
  const t0 = Date.now();
  let failed = null;
  while (Date.now() - t0 < 120000) {
    const cur = await (await authed(u.cookie, `/api/jobs/${job.id}`)).json();
    if (cur.status === 'failed') { failed = cur; break; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  assert.ok(failed, 'job should fail on truncated input');
  const after = await credits(u.cookie);
  assert.equal(after.balance, 10, 'failed job refunded in full');
  assert.ok(after.ledger.some((x) => x.reason === 'refund' && x.delta === 2 && x.jobId === job.id));
});

test('insufficient credits reject with 402, then succeed after admin grant', async () => {
  const u = await register('broke@example.com');
  const users = await (await authed(adminCookie, '/api/admin/users')).json();
  const target = users.find((x) => x.email === 'broke@example.com');
  const drain = await authed(adminCookie, `/api/admin/users/${target.id}/credits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta: -10, reason: 'test drain' }),
  });
  assert.equal(drain.status, 200);
  assert.equal((await credits(u.cookie)).balance, 0);
  const denied = await postJob(u.cookie);
  assert.equal(denied.status, 402);
  assert.match(denied.body.error, /Not enough credits/);
  const grant = await authed(adminCookie, `/api/admin/users/${target.id}/credits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta: 5, reason: 'test grant' }),
  });
  assert.equal(grant.status, 200);
  const ok = await postJob(u.cookie);
  assert.equal(ok.status, 201);
  await authed(u.cookie, `/api/jobs/${ok.body.id}/cancel`, { method: 'POST' });
});

test('credit adjustment writes an audit log entry', async () => {
  const u = await register('audited@example.com');
  const users = await (await authed(adminCookie, '/api/admin/users')).json();
  const target = users.find((x) => x.email === 'audited@example.com');
  const adj = await authed(adminCookie, `/api/admin/users/${target.id}/credits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta: 3, reason: 'goodwill' }),
  });
  assert.equal(adj.status, 200);
  const audit = await (await authed(adminCookie, '/api/admin/audit')).json();
  const entry = audit.find((x) =>
    x.action === 'credit_adjust' && x.targetEmail === 'audited@example.com');
  assert.ok(entry, 'audit entry exists');
  assert.equal(entry.actorEmail, 'admin@example.com');
  assert.match(entry.detail, /goodwill/);
});

test('change password works end to end (endpoint + new login)', async () => {
  const u = await register('changepw@example.com', 'old-password-123');
  const wrong = await authed(u.cookie, '/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'new-password-123' }),
  });
  assert.equal(wrong.status, 401);
  const changed = await authed(u.cookie, '/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'old-password-123', newPassword: 'new-password-123' }),
  });
  assert.equal(changed.status, 200);
  const oldLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'changepw@example.com', password: 'old-password-123' }),
  });
  assert.equal(oldLogin.status, 401);
  await login('changepw@example.com', 'new-password-123');
});

test('account deletion wipes jobs, sessions, and the user row', async () => {
  const u = await register('deleteme@example.com');
  const { status, body } = await postJob(u.cookie);
  assert.equal(status, 201);
  await authed(u.cookie, `/api/jobs/${body.id}/cancel`, { method: 'POST' });
  const del = await authed(u.cookie, '/api/auth/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-password-123' }),
  });
  assert.equal(del.status, 200);
  const me = await authed(u.cookie, '/api/auth/me');
  assert.equal(me.status, 401);
  const relogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'deleteme@example.com', password: 'test-password-123' }),
  });
  assert.equal(relogin.status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users WHERE email = ?').get('deleteme@example.com').c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM jobs WHERE id = ?').get(body.id).c, 0);
  const adminJobs = await (await authed(adminCookie, '/api/admin/jobs')).json();
  assert.ok(!adminJobs.some((j) => j.id === body.id));
});

test('admin cannot suspend their own account', async () => {
  const users = await (await authed(adminCookie, '/api/admin/users')).json();
  const me = users.find((x) => x.email === 'admin@example.com');
  const res = await authed(adminCookie, `/api/admin/users/${me.id}/suspend`, { method: 'POST' });
  assert.equal(res.status, 400);
});
