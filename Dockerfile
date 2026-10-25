# UpscaleAI — full stack in ONE container, for Hugging Face Spaces (Docker SDK).
#
# Why this fits the free tier: HF's free "CPU Basic" hardware has 16 GB RAM,
# and the Real-ESRGAN worker peaks at ~1.6 GB (tiled) — the only free tier
# found that fits it. Netlify/Render-free (512 MB) cannot run this worker.
#
# Layout inside the image mirrors the repo: /app/server, /app/client,
# /app/ai. The Express server serves BOTH the API and the built frontend
# (client/dist) on $PORT, so the whole app is same-origin — no CORS or
# cookie cross-origin work is needed.
#
# Weights are downloaded at BUILD time from the official release and are
# NEVER committed to git (ai/weights/ is gitignored). Order matters for
# layer caching: heavy, rarely-changing layers (torch, weights) come
# BEFORE the source copy, so code edits only redo the client build.
FROM python:3.12-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# Node 24 (nodesource) + build tools (argon2 native build) + curl.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version && python3 --version

WORKDIR /app

# --- Server deps (cached unless server package files change) ---
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# --- Client deps (vite/tailwind are devDeps, required for the build) ---
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci

# --- Python worker env: torch CPU + pillow + numpy ---
RUN python3 -m venv /app/ai/venv \
 && /app/ai/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /app/ai/venv/bin/pip install --no-cache-dir torch \
      --index-url https://download.pytorch.org/whl/cpu \
 && /app/ai/venv/bin/pip install --no-cache-dir pillow numpy \
 && /app/ai/venv/bin/python -c "import torch, PIL, numpy; print('torch', torch.__version__)"

# --- Model weights at BUILD time (official Real-ESRGAN v0.1.0 release) ---
# Sanity check: the file must be larger than 60 MB, or the build fails
# here instead of producing an image whose worker can never load a model.
RUN mkdir -p /app/ai/weights \
 && curl -L -o /app/ai/weights/RealESRGAN_x4plus.pth \
      https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth \
 && test "$(stat -c%s /app/ai/weights/RealESRGAN_x4plus.pth)" -gt 60000000

# --- App source ---
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY client/index.html client/vite.config.js ./client/
COPY client/public ./client/public
COPY client/src ./client/src
COPY ai/rrdbnet.py ai/upscale.py ./ai/
COPY docker/start.sh ./docker/start.sh

# --- Build the frontend (the server serves client/dist) ---
RUN cd client && npm run build

RUN mkdir -p /app/data && chmod 777 /app/data \
 && chmod +x /app/docker/start.sh

# HF Spaces sets PORT (7860 by default for Docker spaces); keep 7860 as
# the fallback so `docker run -p 7860:7860` works locally too.
ENV PORT=7860
EXPOSE 7860
CMD ["bash", "/app/docker/start.sh"]
