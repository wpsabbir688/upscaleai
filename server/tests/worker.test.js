import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const py = path.join(root, 'ai', 'venv', 'bin', 'python');
const worker = path.join(root, 'ai', 'upscale.py');
const weights = path.join(root, 'ai', 'weights', 'RealESRGAN_x4plus.pth');
const fixtures = path.join(here, 'fixtures');

function runWorker(input, scale, extra = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upscaleai-worker-'));
  const out = path.join(tmp, 'out.png');
  const r = spawnSync(py, [worker, '--input', input, '--output', out,
    '--scale', String(scale), '--weights', weights, ...extra],
    { encoding: 'utf8', timeout: 600000, cwd: path.join(root, 'ai') });
  return { r, out, tmp };
}

test('worker: 64px -> 256px at 4x, valid PNG', () => {
  const { r, out, tmp } = runWorker(path.join(fixtures, 'small.png'), 4);
  assert.equal(r.status, 0, r.stderr);
  const line = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(line.ok, true);
  assert.equal(line.out_w, 256);
  assert.equal(line.out_h, 256);
  const buf = fs.readFileSync(out);
  assert.deepEqual([...buf.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('worker: corrupt input fails with ok:false, never a fake file', () => {
  const trunc = path.join(os.tmpdir(), 'upscaleai-trunc.png');
  const src = fs.readFileSync(path.join(fixtures, 'small.png'));
  fs.writeFileSync(trunc, src.subarray(0, 100));
  const { r, out, tmp } = runWorker(trunc, 4);
  assert.notEqual(r.status, 0);
  const line = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(line.ok, false);
  assert.ok(line.error.length > 0);
  assert.equal(fs.existsSync(out), false);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(trunc, { force: true });
});
