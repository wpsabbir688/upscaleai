# UpscaleAI — Enhance Beyond Limits

Premium AI image upscaling platform, v1. Users upload images, the **real
Real-ESRGAN x4plus model** enhances them on CPU, and results are compared
with a Before/After slider and downloaded as high-resolution PNGs.

**Honesty notes (read first):**

- Upscaling does **not** recover guaranteed original detail. The model
  generates plausible detail from learned patterns; results are enhanced,
  not restored ground truth.
- v1 has **no accounts, no credits, no payments**. Pricing cards on the
  homepage are marked as examples only. Accounts/billing/admin are Stage 2.
- No customer counts, reviews, testimonials, or accuracy claims are made
  anywhere in the product — there are none to show.
- Processing progress is **indeterminate by design**: the UI never shows a
  fake percentage. The resolution calculator gives a benchmark-based time
  estimate instead.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite + Tailwind v4, JSX only, Lucide icons, React Router |
| Backend API | Node.js + Express, SQLite job store (`node:sqlite`) |
| AI worker | Python + PyTorch (CPU), minimal pure-torch RRDBNet — no basicsr/facexlib dependency |
| Model | Real-ESRGAN x4plus (`RealESRGAN_x4plus.pth`, official v0.1.0 release) |
| Queue | Serial in-process queue (one job at a time — see memory note below) |

## Stage 0 benchmark (measured on this VM: 2 CPU threads, no GPU, 7.7 GB RAM)

Test images are synthetic photo-like images (gradient + shapes + noise).
All outputs had exact expected dimensions.

| Case | Wall time | Peak RSS | Output |
|---|---|---|---|
| 256px, direct, 4x | 43.8 s | 1,154.6 MB | 1024×1024 |
| 512px, direct, 4x | 136.0 s | 3,759.9 MB | 2048×2048 |
| 512px, tile-256, 4x | 131.5 s | 1,611.0 MB | 2048×2048 |
| 256px, direct, 2x | 28.9 s | 1,215.9 MB | 512×512 |

Consequences baked into v1:

- **Serial queue**: one job at a time. A tiled job peaks at ~1.6 GB; two
  concurrent jobs could OOM the VM.
- **Tiling**: inputs over 256 px on a side use 256 px tiles with 32 px
  overlap (same speed as direct at 512 px, 57 % less peak memory).
- **Caps**: files ≤ 10 MB, longest side ≤ 1024 px. A 1024 px input takes
  roughly 9 minutes tiled; the per-job timeout is 20 minutes.
- **Scales**: only 2x and 4x. 2x is derived from the native 4x model
  output (downsampled), not a separate 2x model. 6x/8x/10x/15x/20x are
  shown disabled until staged upscaling is benchmarked.
- **No face restoration / denoise controls**: no compatible model is
  bundled, so no such controls are shown (never fake controls).

## Setup

### 1. Python worker + model

```bash
cd ai
python3 -m venv venv
./venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
./venv/bin/pip install pillow numpy
mkdir -p weights
curl -L -o weights/RealESRGAN_x4plus.pth \
  https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth
```

Verify the worker (takes ~30 s for a 256 px image):

```bash
./venv/bin/python upscale.py --input ../server/tests/fixtures/medium.png \
  --output /tmp/out.png --scale 4 --weights weights/RealESRGAN_x4plus.pth
```

Re-run the benchmark any time with `./venv/bin/python bench.py`.

### 2. API server

```bash
cd server
npm install
npm start          # http://localhost:4001, serves API + built frontend if present
```

Environment overrides: `PORT`, `DATA_DIR`, `DB_PATH`, `UPSCALE_PY`,
`UPSCALE_WORKER`, `UPSCALE_WEIGHTS`. Uploaded files live in
`server/data/jobs/<uuid>/` and are deleted 24 hours after completion
(sweep on startup + every 30 minutes).

### 3. Frontend

```bash
cd client
npm install
npm run dev        # http://localhost:5173, proxies /api to :4001
npm run build      # production build; the API server serves client/dist
npm run preview    # http://localhost:4173
```

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/capabilities` | Real scales/formats/limits the UI may offer |
| POST | `/api/jobs` | Multipart `image` + `scale` (2/4); validates signature, MIME, dims, size |
| POST | `/api/batch` | Multipart `images` (≤10) + `scale`; one job per file |
| GET | `/api/jobs` | Job list, newest first |
| GET | `/api/jobs/:id` | Job status (queued/processing/done/failed/cancelled) |
| POST | `/api/jobs/:id/cancel` | Cancels queued jobs; kills a processing worker |
| GET | `/api/jobs/:id/download` | Enhanced PNG (done jobs only) |
| GET | `/api/jobs/:id/original` | Original upload |
| GET | `/api/jobs/:id/preview/:kind` | Inline preview (`input`/`output`) for the slider |
| GET | `/api/batch/:id` | Batch job list |
| GET | `/api/batch/:id/zip` | ZIP of completed outputs (+ `_notes.txt` for skipped jobs) |

Validation rejects files by **content signature** (PNG/JPEG/WebP magic
bytes), never by extension or client MIME alone. Job paths are UUID
directories; no user input becomes a path segment.

## Tests

```bash
cd server && npm test   # node:test, serial: API suite + worker suite
cd client && npm run build
```

The API suite covers: bad MIME, spoofed signature, oversize file,
over-dimension image, bad scale, full lifecycle queued → done with a
correct download, failed jobs surfacing a real error (truncated PNG),
cancel of a queued job, and batch + ZIP. The worker suite checks output
dimensions, PNG integrity, and corrupt-input failure. 12/12 green at v1.

## Limits (v1)

- CPU-only, no GPU. Expect minutes per image, not seconds.
- One job at a time; no user isolation (no accounts yet — job list is
  shared on a single deployment).
- SQLite, not Postgres; no Redis. Production moves to Postgres + Prisma
  and a real queue (documented migration, same schema shape).
- No live-host deployment in v1: a CPU Real-ESRGAN worker cannot run on
  free-tier hosts (typically 512 MB RAM). Live deploy needs a real
  server with several GB of RAM (GPU host preferred).

## Stage 2 (explicitly NOT built)

Accounts + sessions, server-side credits, plans + verified payments
(webhook-verified, never frontend callbacks), processing history per
user, admin dashboard (analytics, users, jobs, worker health, audit
logs), developer API, face restoration / denoise models (only with a
real bundled model), staged upscaling for 6x–20x (only after
benchmarking), S3-compatible storage, Postgres + Redis.
