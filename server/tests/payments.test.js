import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upscaleai-payments-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.DB_PATH = path.join(tmp, 'data', 'jobs.db');

const { createApp } = await import('../src/index.js');

let base;
let server;
let adminCookie;

test.before(async () => {
  const created = createApp(process.env.DB_PATH);
  server = await new Promise((resolve) => {
    const s = created.app.listen(0, () => resolve(s));
  });
  base = `http://localhost:${server.address().port}`;
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
  assert.equal(res.status, 200, `login failed for ${email}`);
  return cookieOf(res);
}

function authed(cookie, p, opts = {}) {
  return fetch(`${base}${p}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Cookie: cookie },
  });
}

async function claim(cookie, body) {
  const res = await authed(cookie, '/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const good = (txnId, over = {}) => ({
  method: 'bkash', amountBdt: 100, txnId, senderMobile: '01911111111', ...over,
});

test('unauthenticated payment endpoints reject', async () => {
  const r1 = await fetch(`${base}/api/payments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(good('UNAUTH1')),
  });
  assert.equal(r1.status, 401);
  const r2 = await fetch(`${base}/api/payments/mine`);
  assert.equal(r2.status, 401);
});

test('claim validation rejects bad input', async () => {
  const { cookie } = await register('pay-valid@example.com');
  const cases = [
    [{ ...good('V1'), method: 'rocket' }, 'bad method'],
    [{ ...good('V2'), method: 'BKASH' }, 'method case'],
    [{ ...good('V3'), amountBdt: 0 }, 'zero amount'],
    [{ ...good('V4'), amountBdt: -50 }, 'negative amount'],
    [{ ...good('V5'), amountBdt: 100001 }, 'over cap'],
    [{ ...good('V6'), amountBdt: 12.5 }, 'non-integer amount'],
    [{ ...good('V7'), amountBdt: '100' }, 'string amount'],
    [{ ...good('V8'), txnId: '' }, 'empty txn'],
    [{ ...good('V9'), txnId: '   ' }, 'blank txn'],
    [{ ...good('V10'), txnId: 'x'.repeat(65) }, 'txn too long'],
    [{ ...good('V11'), senderMobile: 'abc' }, 'letters in mobile'],
    [{ ...good('V12'), senderMobile: '019123456' }, 'mobile too short'],
    [{ ...good('V13'), senderMobile: '0191234567890123' }, 'mobile too long'],
    [{ method: 'bkash', amountBdt: 100, senderMobile: '01911111111' }, 'missing txn'],
  ];
  for (const [body, label] of cases) {
    const r = await claim(cookie, body);
    assert.equal(r.status, 400, `${label} should be 400, got ${r.status}: ${JSON.stringify(r.body)}`);
  }
});

test('claim creation + duplicate txn rejection + own-list isolation', async () => {
  const a = await register('pay-a@example.com');
  const b = await register('pay-b@example.com');
  const created = await claim(a.cookie, good('DUP-001', { method: 'nagad', amountBdt: 250 }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, 'pending');
  assert.equal(created.body.credits, 250);
  assert.equal(created.body.method, 'nagad');
  assert.equal(created.body.txnId, 'DUP-001');
  // Same user, same txn -> 409.
  const dupA = await claim(a.cookie, good('DUP-001'));
  assert.equal(dupA.status, 409);
  assert.match(dupA.body.error, /already been claimed/);
  // Different user, same txn -> 409 as well (global uniqueness).
  const dupB = await claim(b.cookie, good('DUP-001'));
  assert.equal(dupB.status, 409);
  // Own list: A sees it, B does not.
  const mineA = await authed(a.cookie, '/api/payments/mine').then((r) => r.json());
  const mineB = await authed(b.cookie, '/api/payments/mine').then((r) => r.json());
  assert.ok(mineA.some((c) => c.txnId === 'DUP-001'));
  assert.ok(!mineB.some((c) => c.txnId === 'DUP-001'));
});

test('non-admin cannot list, approve, or reject claims', async () => {
  const { cookie } = await register('pay-nonadmin@example.com');
  const created = await claim(cookie, good('NA-001'));
  assert.equal(created.status, 201);
  const list = await authed(cookie, '/api/admin/payments');
  assert.equal(list.status, 403);
  const ap = await authed(cookie, `/api/admin/payments/${created.body.id}/approve`, { method: 'POST' });
  assert.equal(ap.status, 403);
  const rj = await authed(cookie, `/api/admin/payments/${created.body.id}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'nope' }),
  });
  assert.equal(rj.status, 403);
});

test('approve adds exact credits + ledger + audit; double-approve blocked', async () => {
  const { cookie } = await register('pay-approve@example.com');
  const created = await claim(cookie, good('AP-001', { amountBdt: 150 }));
  assert.equal(created.status, 201);
  const before = await authed(cookie, '/api/credits').then((r) => r.json());
  assert.equal(before.balance, 10); // signup grant only
  const ap = await authed(adminCookie, `/api/admin/payments/${created.body.id}/approve`, { method: 'POST' });
  assert.equal(ap.status, 200, JSON.stringify(await ap.clone().json().catch(() => ({}))));
  const approved = await ap.json();
  assert.equal(approved.status, 'approved');
  assert.ok(approved.decidedAt);
  const after = await authed(cookie, '/api/credits').then((r) => r.json());
  assert.equal(after.balance, 160); // 10 + 150, exact — no more, no less
  const entry = after.ledger.find((x) => x.reason === 'payment');
  assert.ok(entry, 'payment ledger entry missing');
  assert.equal(entry.delta, 150);
  assert.equal(entry.detail.txnId, 'AP-001');
  assert.equal(entry.detail.method, 'bkash');
  const audit = await authed(adminCookie, '/api/admin/audit').then((r) => r.json());
  assert.ok(audit.some((x) => x.action === 'payment_approve' && String(x.detail).includes('AP-001')));
  // Second approval: rejected, balance unchanged.
  const again = await authed(adminCookie, `/api/admin/payments/${created.body.id}/approve`, { method: 'POST' });
  assert.equal(again.status, 409);
  const still = await authed(cookie, '/api/credits').then((r) => r.json());
  assert.equal(still.balance, 160);
});

test('reject stores reason, adds no credits; reason required; decided claims final', async () => {
  const { cookie } = await register('pay-reject@example.com');
  const created = await claim(cookie, good('RJ-001', { amountBdt: 500 }));
  assert.equal(created.status, 201);
  // Reject without a reason -> 400.
  const noReason = await authed(adminCookie, `/api/admin/payments/${created.body.id}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: '   ' }),
  });
  assert.equal(noReason.status, 400);
  const rj = await authed(adminCookie, `/api/admin/payments/${created.body.id}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'No matching payment found in bKash.' }),
  });
  assert.equal(rj.status, 200);
  const rejected = await rj.json();
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.rejectReason, 'No matching payment found in bKash.');
  // Balance unchanged, no payment ledger entry, audit recorded.
  const credits = await authed(cookie, '/api/credits').then((r) => r.json());
  assert.equal(credits.balance, 10);
  assert.ok(!credits.ledger.some((x) => x.reason === 'payment'));
  const audit = await authed(adminCookie, '/api/admin/audit').then((r) => r.json());
  assert.ok(audit.some((x) => x.action === 'payment_reject' && String(x.detail).includes('RJ-001')));
  // User sees the reason in their own list.
  const mine = await authed(cookie, '/api/payments/mine').then((r) => r.json());
  const row = mine.find((c) => c.txnId === 'RJ-001');
  assert.equal(row.status, 'rejected');
  assert.equal(row.rejectReason, 'No matching payment found in bKash.');
  // Decided claim cannot flip: approve-after-reject -> 409, reject-after-reject -> 409.
  const flip = await authed(adminCookie, `/api/admin/payments/${created.body.id}/approve`, { method: 'POST' });
  assert.equal(flip.status, 409);
  const rj2 = await authed(adminCookie, `/api/admin/payments/${created.body.id}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'again' }),
  });
  assert.equal(rj2.status, 409);
});

test('admin approve/reject of unknown claim -> 404', async () => {
  const ap = await authed(adminCookie, '/api/admin/payments/no-such-id/approve', { method: 'POST' });
  assert.equal(ap.status, 404);
  const rj = await authed(adminCookie, '/api/admin/payments/no-such-id/reject', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'x' }),
  });
  assert.equal(rj.status, 404);
});
