import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upscaleai-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.DB_PATH = path.join(tmp, 'data', 'jobs.db');

const { createApp } = await import('../src/index.js');

let base;
let server;

test.before(async () => {
  const { app } = createApp(process.env.DB_PATH);
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://localhost:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function postJob(filePath, scale = 4, name) {
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(filePath)]), name || path.basename(filePath));
  fd.append('scale', String(scale));
  const res = await fetch(`${base}/api/jobs`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

async function waitFor(id, wanted, timeoutMs = 300000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const res = await fetch(`${base}/api/jobs/${id}`);
    const job = await res.json();
    if (wanted.includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`job ${id} did not reach ${wanted.join('/')} in time`);
}

test('health + capabilities', async () => {
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.equal(h.ok, true);
  const caps = await (await fetch(`${base}/api/capabilities`)).json();
  assert.deepEqual(caps.scales, [2, 4]);
  assert.ok(caps.disabledScales.includes(20));
});

test('rejects non-image content', async () => {
  const bad = path.join(tmp, 'bad.txt');
  fs.writeFileSync(bad, 'this is not an image');
  const { status, body } = await postJob(bad);
  assert.equal(status, 400);
  assert.match(body.error, /Unsupported file type/);
});

test('rejects a spoofed signature (GIF bytes with .png name)', async () => {
  const fake = path.join(tmp, 'fake.png');
  fs.writeFileSync(fake, Buffer.from('GIF89aXXXXYYYY'));
  const { status, body } = await postJob(fake);
  assert.equal(status, 400);
  assert.match(body.error, /Unsupported file type/);
});

test('rejects oversize files', async () => {
  const big = path.join(tmp, 'oversize.bin');
  fs.writeFileSync(big, Buffer.alloc(11 * 1024 * 1024, 0));
  const { status, body } = await postJob(big);
  assert.equal(status, 400);
  assert.match(body.error, /too large/);
});

test('rejects images over the dimension cap', async () => {
  const { status, body } = await postJob(path.join(fixtures, 'big.png'));
  assert.equal(status, 400);
  assert.match(body.error, /too large/);
});

test('rejects unsupported scales', async () => {
  const { status, body } = await postJob(path.join(fixtures, 'small.png'), 8);
  assert.equal(status, 400);
  assert.match(body.error, /Scale must be 2 or 4/);
});

test('job lifecycle: queued -> done, download has correct dimensions', async () => {
  const { status, body } = await postJob(path.join(fixtures, 'small.png'), 4);
  assert.equal(status, 201);
  assert.ok(['queued', 'processing'].includes(body.status));
  const done = await waitFor(body.id, ['done', 'failed']);
  assert.equal(done.status, 'done', `worker error: ${done.error}`);
  assert.equal(done.outputW, 256);
  assert.equal(done.outputH, 256);
  const dl = await fetch(`${base}/api/jobs/${body.id}/download`);
  assert.equal(dl.status, 200);
  const buf = Buffer.from(await dl.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
  assert.ok(buf.length > 1000);
});

test('failed jobs surface a real error, never a fake success', async () => {
  // Truncated PNG: signature + IHDR survive, pixel data does not, so
  // validation passes but the worker must fail.
  const src = fs.readFileSync(path.join(fixtures, 'small.png'));
  const trunc = path.join(tmp, 'truncated.png');
  fs.writeFileSync(trunc, src.subarray(0, 100));
  const { status, body } = await postJob(trunc, 4);
  assert.equal(status, 201);
  const failed = await waitFor(body.id, ['failed', 'done']);
  assert.equal(failed.status, 'failed');
  assert.ok(failed.error && failed.error.length > 0);
  const dl = await fetch(`${base}/api/jobs/${body.id}/download`);
  assert.equal(dl.status, 409); // no output for a failed job
});

test('queued job can be cancelled; done job cancel is a no-op', async () => {
  // A medium (256px, ~40s) job occupies the worker; the small job behind
  // it stays queued and must be cancellable.
  const first = await postJob(path.join(fixtures, 'medium.png'), 4);
  assert.equal(first.status, 201);
  const second = await postJob(path.join(fixtures, 'small.png'), 4);
  assert.equal(second.status, 201);
  const cancelled = await (await fetch(`${base}/api/jobs/${second.body.id}/cancel`, { method: 'POST' })).json();
  assert.equal(cancelled.status, 'cancelled');
  const done = await waitFor(first.body.id, ['done', 'failed']);
  assert.equal(done.status, 'done');
  const noop = await (await fetch(`${base}/api/jobs/${first.body.id}/cancel`, { method: 'POST' })).json();
  assert.equal(noop.status, 'done');
});

test('batch upload + ZIP of completed outputs', async () => {
  const fd = new FormData();
  for (const f of ['small.png', 'small.png']) {
    fd.append('images', new Blob([fs.readFileSync(path.join(fixtures, f))]), f);
  }
  fd.append('scale', '2');
  const res = await fetch(`${base}/api/batch`, { method: 'POST', body: fd });
  assert.equal(res.status, 201);
  const batch = await res.json();
  assert.equal(batch.jobs.length, 2);
  assert.equal(batch.rejected.length, 0);
  for (const job of batch.jobs) {
    const done = await waitFor(job.id, ['done', 'failed']);
    assert.equal(done.status, 'done', `worker error: ${done.error}`);
    assert.equal(done.outputW, 128);
  }
  const zip = await fetch(`${base}/api/batch/${batch.batchId}/zip`);
  assert.equal(zip.status, 200);
  assert.match(zip.headers.get('content-type'), /application\/zip/);
  const buf = Buffer.from(await zip.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 2)], [0x50, 0x4b]); // PK zip magic
  assert.ok(buf.length > 1000);
});
