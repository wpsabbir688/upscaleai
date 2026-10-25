# UpscaleAI — Enhance Beyond Limits

Premium AI image upscaling platform, v1. Users upload images, the **real
Real-ESRGAN x4plus model** enhances them on CPU, and results are compared
with a Before/After slider and downloaded as high-resolution PNGs.

**Honesty notes (read first):**

- Upscaling does **not** recover guaranteed original detail. The model
  generates plausible detail from learned patterns; results are enhanced,
  not restored ground truth.
- Stage 2 is live: **accounts, server-side credits, and an admin dashboard
  exist**. The studio requires login; every job belongs to exactly one
  user and other users get 403, never data.
- **Manual payments only (Stage 3).** There is no gateway and no automated
  verification: users Send Money to the owner's bKash/Nagad number
  **01944460344** outside the app, submit a claim (method, amount, txn ID,
  sender mobile), and an admin approves it by hand after checking their own
  bKash/Nagad account — approval adds 1 credit per BDT. Nothing here
  simulates a transaction, and no bKash/Nagad password or PIN is ever
  collected or stored. Automated gateway checkout remains blocked on
  merchant eligibility + credentials, which do not exist yet.
- No customer counts, reviews, testimonials, or accuracy claims are made
  anywhere in the product — there are none to show.
- Processing progress is **indeterminate by design**: the UI never shows a
  fake percentage. The resolution calculator gives a benchmark-based time
  estimate instead.

## Stage 2 — accounts, credits, admin (built 2026-10-25)

**Breaking change from v1:** uploads now require login. The old shared job
list is removed; v1 job rows (which have no owner) are inaccessible to
every account by design, not silently re-attributed.

- **Accounts:** registration + login + logout. Passwords are argon2id
  hashes. Sessions are HttpOnly cookies carrying a random token; only its
  SHA-256 hash is stored server-side — tokens are never in localStorage.
  Profile page, **change-password screen + endpoint (landed together)**,
  and account deletion (wipes jobs, files, credits, sessions, user row)
  with password confirmation.
- **Credits (server-side only):** signup grants 10 credits (configurable
  `FREE_CREDITS`). 2x costs 1, 4x costs 2 (`creditCost` in config).
  Deduction happens inside the same SQLite transaction that creates the
  job — the frontend never decides a balance. Failed and cancelled jobs
  refund automatically (refund is guarded by a flag, so it cannot double
  refund). Insufficient credits reject job creation with 402.
  Idempotent creation: send `Idempotency-Key` and a retry returns the
  original job instead of charging twice. `GET /api/credits` returns the
  balance plus the full ledger (signup / job / refund / admin_adjust).
- **Admin:** role `ADMIN` on the user record, seeded by a one-time CLI
  script that reads the password from `UPSCALE_ADMIN_EMAIL` /
  `UPSCALE_ADMIN_PASSWORD` env vars only (no default credential in the
  repo; rotate after first login via Profile → Change password). Every
  admin endpoint is role-checked (non-admin gets 403). Dashboard shows
  overview analytics, users (suspend/unsuspend, plan assignment, credit
  adjustment), all jobs, worker health (queue depth, running job, last
  completion, last error), and the audit log — each sensitive admin
  action (suspend, unsuspend, plan change, credit adjustment, seeding)
  is written to `audit_log` with actor, target, and detail. Plan
  assignment is a stored label in Stage 2: plans carry no billing or
  limits until verified payments exist.
- **Unchanged from v1:** the worker, scales (2x/4x only), caps,
  validation, and serial queue behavior.

## Stage 3 — manual bKash/Nagad payments (built 2026-10-25)

**How it works (exactly as the owner specified):**

1. The user sends money themselves with **Send Money** in their bKash or
   Nagad app to the owner's number **01944460344** — this happens
   outside UpscaleAI. The app never touches a gateway and never asks for
   a bKash/Nagad password or PIN (none is stored anywhere).
2. The user opens **Add credits** (nav, or Profile → "Add credits via
   bKash / Nagad") and submits a claim: method (bKash/Nagad), amount in
   BDT (whole number, 1–100000), transaction ID, and the sender mobile
   number. The page shows the 01944460344 number with a copy button and
   the rate **1 BDT = 1 credit**. A transaction ID can be claimed only
   once (globally unique; duplicates get a clear 409 error).
3. The claim sits **Pending** until a human admin opens the **Payments**
   section of the Admin dashboard, checks the amount and transaction ID
   in their own bKash/Nagad account, and clicks **Approve** or **Reject**.
4. On approve, credits are added **in the same SQLite transaction** as
   the claim decision (claim pending→approved, user credits += amount,
   `payment` ledger entry with txn ID + method, audit entry). A decided
   claim can never be approved twice — re-approval is rejected and adds
   no second credit. On reject, the admin must give a reason, which the
   user sees on their claims list; no credits are added.
5. The existing manual credit-adjustment feature stays as-is for
   corrections (it writes `admin_adjust` ledger entries, separate from
   `payment` entries).

**Admin verification steps (the human part, by design):** open your bKash
or Nagad app → find the transaction by ID → confirm the amount and the
sender number match the claim → only then click Approve. If anything
does not match, Reject with the reason (e.g. "No matching payment
found"). There is no automatic confirmation anywhere in this flow.

### Seeding an admin

```bash
cd server
UPSCALE_ADMIN_EMAIL=admin@example.com \
UPSCALE_ADMIN_PASSWORD='use-a-long-password-here' \
node scripts/seed-admin.js
# Re-running the script for an existing email promotes it to admin and
# resets its password (rotation mechanism). Never commit these values.
```

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
`UPSCALE_WORKER`, `UPSCALE_WEIGHTS`, `FREE_CREDITS`, `COOKIE_SECURE`
(set `COOKIE_SECURE=1` when serving over HTTPS in production; local dev
is plain HTTP). Uploaded files live in `server/data/jobs/<uuid>/` and are
deleted 24 hours after completion (sweep on startup + every 30 minutes).

### 3. Frontend

```bash
cd client
npm install
npm run dev        # http://localhost:5173, proxies /api to :4001
npm run build      # production build; the API server serves client/dist
npm run preview    # http://localhost:4173
```

## API

All job, batch, credit, and admin endpoints require login (HttpOnly
session cookie), except `/api/health` and `/api/capabilities`. Cross-user
job access returns 403.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/capabilities` | Real scales/formats/limits the UI may offer (+ credit costs) |
| POST | `/api/auth/register` | `{ email, password }` → 201 + session cookie, 10 free credits |
| POST | `/api/auth/login` | `{ email, password }` → session cookie |
| POST | `/api/auth/logout` | Deletes the session, clears the cookie |
| GET | `/api/auth/me` | Current user (no password hash, ever) |
| POST | `/api/auth/change-password` | `{ currentPassword, newPassword }`; other sessions invalidated |
| DELETE | `/api/auth/account` | `{ password }` → wipes user, jobs, files, credits, sessions |
| GET | `/api/credits` | Balance, plan, full ledger (newest first) |
| POST | `/api/payments` | Manual payment claim `{ method: bkash\|nagad, amountBdt, txnId, senderMobile }` → 201 pending; duplicate txn ID → 409 |
| GET | `/api/payments/mine` | Own claims with status + reject reason, newest first |
| GET | `/api/admin/payments` | Admin: all claims with user email, newest first |
| POST | `/api/admin/payments/:id/approve` | Admin: one transaction — approve + add amount×1 credits + `payment` ledger + audit; re-approve → 409 |
| POST | `/api/admin/payments/:id/reject` | Admin: `{ reason }` required; stores reason + audit, adds no credits |
| POST | `/api/jobs` | Multipart `image` + `scale` (2/4); validates signature, MIME, dims, size; accepts `Idempotency-Key` |
| POST | `/api/batch` | Multipart `images` (≤10) + `scale`; one job per file; accepts `Idempotency-Key` |
| GET | `/api/jobs` | Own job list, newest first |
| GET | `/api/jobs/:id` | Own job status (queued/processing/done/failed/cancelled) |
| POST | `/api/jobs/:id/cancel` | Cancels own queued jobs; kills a processing worker (refund) |
| GET | `/api/jobs/:id/download` | Own enhanced PNG (done jobs only) |
| GET | `/api/jobs/:id/original` | Own original upload |
| GET | `/api/jobs/:id/preview/:kind` | Own inline preview (`input`/`output`) for the slider |
| GET | `/api/batch/:id` | Own batch job list |
| GET | `/api/batch/:id/zip` | ZIP of own completed outputs (+ `_notes.txt` for skipped jobs) |
| GET | `/api/admin/overview` | Admin: users, job counts, credit totals |
| GET | `/api/admin/users` | Admin: user list (no password hashes) |
| POST | `/api/admin/users/:id/suspend` | Admin: suspend (cannot suspend self) |
| POST | `/api/admin/users/:id/unsuspend` | Admin: unsuspend |
| POST | `/api/admin/users/:id/plan` | Admin: plan label (free/pro/premium) |
| POST | `/api/admin/users/:id/credits` | Admin: `{ delta, reason }` credit adjustment + audit entry |
| GET | `/api/admin/jobs` | Admin: all jobs with owner email |
| GET | `/api/admin/health` | Admin: queue depth, running job, last completion/error |
| GET | `/api/admin/audit` | Admin: audit log (actor, action, target, detail) |

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
cancel of a queued job, batch + ZIP, and unauthenticated rejection.
The auth suite covers: registration validation + duplicates,
wrong-password rejection, suspended-account blocking (login + live
session), cross-user 403 on status/preview/download/cancel, admin 403
for non-admins, idempotent creation without double-charge, failed-job
refund, 402 on insufficient credits + success after an admin grant,
audit-log entries on credit adjustment, change-password end to end,
account deletion wiping jobs/sessions/user row, and self-suspension
refusal. The worker suite checks output dimensions, PNG integrity, and
corrupt-input failure. The payments suite covers: claim validation (bad
method, zero/negative/over-cap/non-integer amount, missing/over-long txn
ID, bad sender mobile), duplicate txn rejection (same and different
user), own-list isolation, non-admin 403 on list/approve/reject, approve
adding exact credits + `payment` ledger detail + audit entry,
double-approve rejection with no second credit, reject storing the
reason with no credits and requiring a reason, and 404 on unknown claims.
**31/31 green at Stage 3** (24 Stage 2 + 7 payments), plus a 13/13 local
Playwright browser verification (register → payment page shows number +
rate → claim pending → duplicate blocked → admin approve → balance
10→110 → reject path shows reason, balance unchanged).

## Limits (Stage 2)

- CPU-only, no GPU. Expect minutes per image, not seconds.
- One job at a time; serial queue (memory safety on small hosts).
- SQLite, not Postgres; no Redis. Production moves to Postgres + Prisma
  and a real queue (documented migration, same schema shape).
- No rate limiting on auth endpoints yet; no email verification or
  password-reset flow (no SMTP configured) — account recovery today is
  the admin seed script (password reset for a known email).
- No live-host deployment: a CPU Real-ESRGAN worker cannot run on
  free-tier hosts (typically 512 MB RAM). Live deploy needs a real
  server with several GB of RAM (GPU host preferred).

## Still NOT built (after Stage 3)

- **Automated gateway payments — BLOCKED.** Manual bKash/Nagad payments
  are live (Stage 3), but there is no gateway merchant account and no
  credentials, so there is no automated checkout and no simulated
  transaction anywhere. Plans are labels until a gateway is verified
  (webhook-verified, never frontend callbacks). Every manual payment
  must be verified by a human admin in their own bKash/Nagad account;
  no automatic confirmation exists.
- Developer API (keys + usage billing).
- Face restoration / denoise models (only with a real bundled model).
- Staged upscaling for 6x–20x (only after benchmarking).
- S3-compatible storage, Postgres + Redis migration.
