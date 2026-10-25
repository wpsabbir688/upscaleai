import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

export const config = {
  port: Number(process.env.PORT || 4001),
  // Job files live under this dir; each job gets its own subdir named by
  // its UUID, so no user input ever becomes a path segment.
  dataDir: process.env.DATA_DIR || path.join(root, 'server', 'data'),
  dbPath: process.env.DB_PATH || path.join(root, 'server', 'data', 'jobs.db'),
  python: process.env.UPSCALE_PY ||
    path.join(root, 'ai', 'venv', 'bin', 'python'),
  worker: process.env.UPSCALE_WORKER ||
    path.join(root, 'ai', 'upscale.py'),
  weights: process.env.UPSCALE_WEIGHTS ||
    path.join(root, 'ai', 'weights', 'RealESRGAN_x4plus.pth'),
  aiDir: path.join(root, 'ai'),
  // Limits come from the Stage 0 benchmark (see README): tile-256 keeps
  // peak RSS ~1.6GB for a 512px input; a 1024px input needs ~9 min tiled.
  maxFileBytes: 10 * 1024 * 1024,
  maxDim: 1024,
  minDim: 16,
  maxBatchFiles: 10,
  jobTimeoutMs: 20 * 60 * 1000,
  retentionMs: 24 * 60 * 60 * 1000,
  // Tile size 0 = direct pass. Inputs over 256px on a side use tile 256.
  directMaxSide: 256,
  tileSize: 256,
};
