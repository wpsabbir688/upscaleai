#!/usr/bin/env bash
# UpscaleAI container entrypoint (Hugging Face Spaces, Docker SDK).
#
# HF sets PORT (7860 by default for Docker spaces). The server binds
# 0.0.0.0:$PORT and serves BOTH the API and the built frontend, so the
# app is same-origin and session cookies work unchanged.
#
# COOKIE_SECURE defaults to 1 here because Spaces serve over HTTPS.
# For a plain-HTTP local `docker run`, pass COOKIE_SECURE=0 or logins
# will not stick (the browser drops Secure cookies over HTTP).
set -euo pipefail

export PORT="${PORT:-7860}"
export COOKIE_SECURE="${COOKIE_SECURE:-1}"
export DATA_DIR="${DATA_DIR:-/app/data}"
export DB_PATH="${DB_PATH:-/app/data/jobs.db}"
export UPSCALE_PY="${UPSCALE_PY:-/app/ai/venv/bin/python}"
export UPSCALE_WORKER="${UPSCALE_WORKER:-/app/ai/upscale.py}"
export UPSCALE_WEIGHTS="${UPSCALE_WEIGHTS:-/app/ai/weights/RealESRGAN_x4plus.pth}"

mkdir -p "$DATA_DIR"

# The server resolves client/dist relative to its working directory
# (../client/dist), so it must run from /app/server.
cd /app/server
exec node src/index.js
