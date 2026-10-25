# Deploy UpscaleAI free on Hugging Face Spaces (Docker, CPU Basic)

This is the only free deployment found that fits the app: HF's free
**CPU Basic** hardware has **16 GB RAM**, and the Real-ESRGAN worker
peaks at ~1.6 GB (tiled). Netlify cannot run the worker at all, and
Render's free tier (512 MB) would OOM it. The whole stack — React
frontend, Express API, SQLite, Python torch worker — runs in ONE
container, same-origin, so no CORS or cookie work is needed.

**What is NOT done yet:** nothing below has been deployed. This document
prepares everything so deployment is one push once HF access exists.
No HF token exists on the dev VM.

## Prereqs

- A Hugging Face account (https://huggingface.co/join).
- A Hugging Face **access token with Write permission** for git push:
  HF → profile → Settings → Access Tokens → New token (role: Write).
  Never commit the token anywhere; use it only as the git password
  (or via `huggingface-cli login`).

## Step 1 — Create the Space

1. https://huggingface.co/new-space
2. **Space name:** e.g. `upscaleai` (the URL becomes
   `https://huggingface.co/spaces/<your-username>/upscaleai`).
3. **SDK:** Docker.
4. **Hardware:** CPU Basic (free, 16 GB). Do NOT pick ZeroGPU or a paid
   GPU — CPU Basic is the free tier this Dockerfile is built for.
5. Visibility: Public or Private, your choice. Create the Space.

## Step 2 — Push this repo's files into the Space repo

The Space repo needs the `Dockerfile` at its root plus the app source.
The cleanest path copies exactly the tracked files (no venv, weights,
node_modules, or local data — those are gitignored and rebuilt in the
image):

```bash
# 1. Clone the empty Space repo
git clone https://huggingface.co/spaces/<your-username>/upscaleai hf-space
cd hf-space

# 2. Copy the tracked files out of the GitHub repo
cd /path/to/upscaleai
git archive HEAD | tar -x -C /path/to/hf-space

# 3. The Space README MUST be the HF frontmatter file, not the repo README
cp deploy/hf-space-README.md /path/to/hf-space/README.md

cd /path/to/hf-space
git add -A
git commit -m "UpscaleAI: full-stack Docker deploy (HF Spaces, CPU Basic)"
git push   # when asked: username = your HF username, password = your HF token
```

HF starts building the Docker image automatically on push. The first
build takes several minutes (torch CPU wheel + 67 MB model weights +
npm installs) — watch the build logs on the Space page. A failed build
shows its log there; the common transient cause is a torch-index
hiccup, fixed by re-running the build (Space → Settings → Rebuild).

> Alternative: `git remote add hf https://huggingface.co/spaces/<user>/<space>`
> in the GitHub clone and `git push hf main` — but that OVERWRITES the
> Space README with the repo README, so you must then re-upload
> `deploy/hf-space-README.md` as the Space README via the web UI.
> The clone-and-copy flow above avoids that trap.

## Step 3 — Optional: seed an admin (env vars only)

Spaces have no shell, so `scripts/seed-admin.js` cannot run there.
Instead the server seeds from env vars at startup (see
`server/src/adminSeed.js`): Space → Settings → **Variables and secrets**
→ add as **secrets**:

- `UPSCALE_ADMIN_EMAIL` — e.g. `admin@example.com`
- `UPSCALE_ADMIN_PASSWORD` — at least 8 characters

Set them **before the first boot** (or restart/rebuild after adding
them). Startup seeding only **creates or promotes** — it never resets
an existing admin's password, so a password changed via
Profile → Change password survives restarts. After first login, rotate
the password there and then remove the secrets from the Space settings.

Without these, anyone can still register a normal account from the UI;
there is just no admin until one is seeded.

## Step 4 — Verify the live Space (do not skip)

1. Open the Space URL. The homepage must render (first load after
   sleep is slow — see limits below).
2. Register an account → log in → Studio must show your credit balance
   (10 free on signup).
3. Upload a small image (start with ≤256 px) → 4x → wait for the real
   job: expect ~44 s for 256 px, ~2.2 min for 512 px (CPU benchmark).
4. The Before/After slider must show both images; Download must return
   the enhanced PNG at input × scale dimensions.
5. Admin check (if seeded): log in as admin → Admin dashboard shows
   users, jobs, worker health, and the audit log.

If `/api/health` on the Space URL does not return `{"ok":true}`, read
the container logs on the Space page before anything else.

## Note: the Space URL is the app URL (not the Netlify frontend)

The Space container serves its own frontend same-origin, so the Space
URL is the complete, working app — use it as the live link. The
separately deployed Netlify frontend (static only, no backend) cannot
just point `VITE_API_URL` at the Space: session cookies are same-origin
by design, and cross-origin use would additionally need CORS
credentials, `SameSite=None; Secure` cookies, and `credentials:
'include'` fetches. That is a separate change; do not wire the Netlify
site to the Space backend without it.

## Honest limits of the free deployment (do not promise more)

- **Free Spaces sleep after inactivity.** First load after sleep is
  slow (cold container start + model load). This is HF's free tier,
  not a bug.
- **The container filesystem is ephemeral.** On restart/rebuild, the
  SQLite database resets: accounts, credits, jobs, and payment claims
  are lost. This is a demo-grade deployment. Production needs Postgres
  (documented migration in the repo README) on a real server.
- **One job at a time, CPU-only.** Queue siblings wait; 1024 px inputs
  take ~9 minutes tiled and time out at 20 minutes per job.
- **Caps unchanged:** 10 MB files, longest side ≤ 1024 px, scales 2x/4x
  only, 6x–20x disabled until staged upscaling is benchmarked.
- **Manual payments still need a human admin** checking their own
  bKash/Nagad account before approving — there is no automated
  confirmation anywhere.

## Files in this deployment

| File | Purpose |
|---|---|
| `Dockerfile` | Full-stack image: Node 24 + Python 3.12, server deps, torch CPU, weights at build time, client build, serves on `$PORT` |
| `docker/start.sh` | Entrypoint: binds `0.0.0.0:$PORT` (7860 default), HTTPS cookie flag, writable data dir, worker paths |
| `.dockerignore` | Keeps venv/weights/node_modules/data/secrets out of the build context |
| `deploy/hf-space-README.md` | The Space repo's README (frontmatter: `sdk: docker`, `app_port: 7860`) |
| `server/src/adminSeed.js` | Env-var admin seeding at startup (create/promote only, never resets) |
