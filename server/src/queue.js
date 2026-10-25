import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { imageSize } from 'image-size';

// Serial queue: the benchmark showed a tiled 512px job peaks at ~1.6GB and
// a direct 512px job at ~3.8GB on a 7.7GB VM, so only ONE job runs at a
// time. Running two would risk OOM-killing both.
export class JobQueue {
  constructor(db) {
    this.db = db;
    this.running = null; // { id, child, timer }
    this.waiting = [];
  }

  jobDir(id) {
    return path.join(config.dataDir, 'jobs', id);
  }

  enqueue(id) {
    this.waiting.push(id);
    this.pump();
  }

  pump() {
    if (this.running || this.waiting.length === 0) return;
    const id = this.waiting.shift();
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row || row.status !== 'queued') {
      // Cancelled while waiting, or removed: skip and keep pumping.
      setImmediate(() => this.pump());
      return;
    }
    this.run(row);
  }

  run(row) {
    const dir = this.jobDir(row.id);
    const inputPath = path.join(dir, `input.${row.input_ext}`);
    const outputPath = path.join(dir, 'output.png');
    this.db.prepare(
      'UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?')
      .run('processing', Date.now(), row.id);

    const child = spawn(config.python, [
      config.worker,
      '--input', inputPath,
      '--output', outputPath,
      '--scale', String(row.scale),
      '--tile', String(row.tile),
      '--weights', config.weights,
    ], { cwd: config.aiDir });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      // Mark first: the close handler must not overwrite this message or
      // start the next job twice. The SIGKILL makes 'close' follow at once.
      if (this.running) this.running.timedOut = true;
      child.kill('SIGKILL');
      this.finish(row.id, 'failed',
        'Processing timed out. Try a smaller image or a smaller scale.');
    }, config.jobTimeoutMs);

    this.running = { id: row.id, child, timer, timedOut: false, cancelling: false };

    child.on('close', (code) => {
      if (!this.running || this.running.id !== row.id) return; // finished via cancel path below
      clearTimeout(timer);
      const wasTerminal = this.running.timedOut || this.running.cancelling;
      this.running = null;
      if (wasTerminal) { this.pump(); return; }
      if (code === 0) {
        try {
          const dims = imageSize(fs.readFileSync(outputPath));
          if (dims.width !== row.input_w * row.scale ||
              dims.height !== row.input_h * row.scale) {
            this.finish(row.id, 'failed',
              `Output dimension check failed: expected ${row.input_w * row.scale}x${row.input_h * row.scale}, got ${dims.width}x${dims.height}.`);
          } else {
            this.finish(row.id, 'done', null);
          }
        } catch (e) {
          this.finish(row.id, 'failed', `Output could not be verified: ${e.message}`);
        }
      } else {
        // Surface the worker's real error, never a fake success.
        let msg = 'Image processing failed.';
        try {
          const last = stdout.trim().split('\n').pop();
          const parsed = JSON.parse(last);
          if (parsed && parsed.error) msg = parsed.error;
        } catch { /* fall through to generic + stderr tail */ }
        if (stderr.trim()) msg += ` (${stderr.trim().slice(-300)})`;
        this.finish(row.id, 'failed', msg.slice(0, 500));
      }
      this.pump();
    });

    child.on('error', (e) => {
      if (!this.running || this.running.id !== row.id) return;
      clearTimeout(timer);
      this.running = null;
      this.finish(row.id, 'failed', `Worker could not start: ${e.message}`);
      this.pump();
    });
    // NOTE: the 'close' handler above is the single place that clears
    // `running` for the normal path; timeout/cancel only mark + kill.
  }

  finish(id, status, error) {
    const now = Date.now();
    const expires = status === 'done' || status === 'failed' || status === 'cancelled'
      ? now + config.retentionMs : now;
    this.db.prepare(
      'UPDATE jobs SET status = ?, error = ?, updated_at = ?, expires_at = ? WHERE id = ?')
      .run(status, error, now, expires, id);
  }

  cancel(id) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row) return null;
    if (row.status === 'queued') {
      this.waiting = this.waiting.filter((x) => x !== id);
      this.finish(id, 'cancelled', null);
      return 'cancelled';
    }
    if (row.status === 'processing' && this.running && this.running.id === id) {
      // Mark + kill; the 'close' handler clears `running` and pumps, so the
      // next job never overlaps the dying worker in memory.
      this.running.cancelling = true;
      clearTimeout(this.running.timer);
      const child = this.running.child;
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* noop */ }
      }, 5000);
      this.finish(id, 'cancelled', null);
      return 'cancelled';
    }
    return row.status; // done/failed/cancelled: nothing to cancel
  }
}

// Delete expired job dirs + rows. Runs on startup and on an interval.
export function sweepExpired(db) {
  const now = Date.now();
  const rows = db.prepare(
    "SELECT id FROM jobs WHERE expires_at < ? AND status IN ('done','failed','cancelled')")
    .all(now);
  for (const row of rows) {
    fs.rmSync(path.join(config.dataDir, 'jobs', row.id), { recursive: true, force: true });
    db.prepare('DELETE FROM jobs WHERE id = ?').run(row.id);
  }
  return rows.length;
}
