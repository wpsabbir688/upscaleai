#!/usr/bin/env python3
"""Stage 0 benchmark: generate test images, run upscale.py as a subprocess,
report wall time + peak RSS per case. A case FAILS on non-zero exit or on
output dimensions != input x scale. No app code depends on this script.
"""
import json
import os
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(HERE, 'venv', 'bin', 'python')
OUT = os.path.join(HERE, 'bench_out')
os.makedirs(OUT, exist_ok=True)


def make_image(path, size):
    rng = np.random.default_rng(42)
    # Photo-like synthetic: smooth gradient + shapes + fine noise.
    yy, xx = np.mgrid[0:size, 0:size]
    base = np.zeros((size, size, 3), dtype=np.float64)
    base[:, :, 0] = xx / size * 200 + 30
    base[:, :, 1] = yy / size * 180 + 40
    base[:, :, 2] = 200 - xx / size * 120
    noise = rng.normal(0, 18, (size, size, 3))
    arr = np.clip(base + noise, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, 'RGB')
    d = ImageDraw.Draw(img)
    d.ellipse([size // 4, size // 4, size * 3 // 4, size * 3 // 4],
              fill=(220, 60, 60), outline=(20, 20, 20), width=3)
    d.rectangle([size // 8, size * 5 // 8, size * 7 // 8, size * 3 // 4],
                fill=(40, 120, 240))
    img.save(path)
    return path


def run_case(name, inp, scale, tile, timeout=900):
    out = os.path.join(OUT, f'{name}.png')
    t0 = time.time()
    try:
        p = subprocess.run(
            [PY, os.path.join(HERE, 'upscale.py'), '--input', inp,
             '--output', out, '--scale', str(scale), '--tile', str(tile)],
            capture_output=True, text=True, timeout=timeout, cwd=HERE)
    except subprocess.TimeoutExpired:
        print(f'{name}: TIMEOUT after {timeout}s')
        return False
    wall = time.time() - t0
    line = (p.stdout.strip().splitlines() or [''])[-1]
    try:
        res = json.loads(line)
    except json.JSONDecodeError:
        res = {'ok': False, 'error': f'no JSON output; stderr={p.stderr[-500:]}'}
    ok = bool(res.get('ok'))
    if ok:
        iw = Image.open(inp).size
        ow = Image.open(out).size
        ok = ow == (iw[0] * scale, iw[1] * scale)
        if not ok:
            print(f'{name}: DIM MISMATCH input {iw} scale {scale} -> {ow}')
    print(f'{name}: ok={ok} wall={wall:.1f}s worker={res.get("seconds")}s '
          f'peak_rss={res.get("peak_rss_mb")}MB out={res.get("out_w")}x'
          f'{res.get("out_h")} err={res.get("error", "")}')
    return ok


def main():
    cases = []
    img256 = make_image(os.path.join(OUT, 'test256.png'), 256)
    img512 = make_image(os.path.join(OUT, 'test512.png'), 512)
    cases.append(run_case('256_direct_4x', img256, 4, 0))
    cases.append(run_case('512_direct_4x', img512, 4, 0))
    cases.append(run_case('512_tile256_4x', img512, 4, 256))
    cases.append(run_case('256_direct_2x', img256, 2, 0))
    print('BENCHMARK RESULT:', 'PASS' if all(cases) else 'FAIL')
    sys.exit(0 if all(cases) else 1)


if __name__ == '__main__':
    main()
