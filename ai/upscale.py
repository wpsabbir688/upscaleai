#!/usr/bin/env python3
"""UpscaleAI worker CLI: Real-ESRGAN x4plus inference on CPU.

Usage:
    python upscale.py --input in.png --output out.png [--scale 2|4]
                      [--tile 0|256] [--weights weights/RealESRGAN_x4plus.pth]

- scale 4: native model output.
- scale 2: native 4x model output downsampled 2x with Lanczos. This is
  documented, not a native 2x model: the detail enhancement comes from the
  4x model; the downsample only reduces size. Never claim otherwise.
- tile 0: single direct pass. tile N: split the input into NxN tiles with
  a 32px overlap, run each tile, stitch (overlap trimmed). Tiling keeps
  peak memory bounded for large inputs at the cost of more wall time.
- On success prints one JSON line to stdout:
  {"ok": true, "out_w": W, "out_h": H, "seconds": T, "peak_rss_mb": M,
   "scale": S, "tile": N}
  On failure prints {"ok": false, "error": "..."} and exits non-zero.
  peak_rss_mb is the process peak RSS (ru_maxrss), measured by the caller
  via resource or by this script for the inference section only.
"""

import argparse
import json
import resource
import sys
import time

import torch
from PIL import Image

from rrdbnet import load_x4plus


def peak_rss_mb():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


def run_tile(model, tile, pad, device='cpu'):
    """Run the model on one tile tensor (1,C,H,W in [0,1])."""
    with torch.no_grad():
        return model(tile.to(device)).cpu()


def upscale_tensor(model, img_t, scale, tile):
    """img_t: (1,3,H,W) float tensor in [0,1]. Returns (1,3,H*scale,W*scale)."""
    _, _, h, w = img_t.shape
    if tile and (h > tile or w > tile):
        pad = 32
        out_h, out_w = h * 4, w * 4
        out = torch.zeros((1, 3, out_h, out_w), dtype=torch.float32)
        # Tile grid with overlap; stitch the non-overlap core of each tile.
        for y0 in range(0, h, tile):
            for x0 in range(0, w, tile):
                y1 = min(y0 + tile, h)
                x1 = min(x0 + tile, w)
                # Padded read window, clamped to the image.
                py0 = max(y0 - pad, 0)
                px0 = max(x0 - pad, 0)
                py1 = min(y1 + pad, h)
                px1 = min(x1 + pad, w)
                sub = img_t[:, :, py0:py1, px0:px1]
                sub_out = run_tile(model, sub, pad)
                # Core region inside the tile output (trim the pad margins).
                oy0 = (y0 - py0) * 4
                ox0 = (x0 - px0) * 4
                oy1 = oy0 + (y1 - y0) * 4
                ox1 = ox0 + (x1 - x0) * 4
                out[:, :, y0 * 4:y1 * 4, x0 * 4:x1 * 4] = \
                    sub_out[:, :, oy0:oy1, ox0:ox1]
        result = out
    else:
        result = run_tile(model, img_t, 0)
    if scale == 2:
        # Downsample the native 4x output to 2x (bicubic in tensor space;
        # documented as derived from the 4x model, not a native 2x model).
        result = torch.nn.functional.interpolate(
            result, scale_factor=0.5, mode='bicubic', align_corners=False)
    return result.clamp(0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--scale', type=int, choices=[2, 4], default=4)
    ap.add_argument('--tile', type=int, default=0)
    ap.add_argument('--weights', default='weights/RealESRGAN_x4plus.pth')
    args = ap.parse_args()

    try:
        torch.set_num_threads(2)
        torch.set_num_interop_threads(1)
        t0 = time.time()
        model = load_x4plus(args.weights)
        img = Image.open(args.input).convert('RGB')
        w, h = img.size
        import numpy as np
        arr = np.asarray(img, dtype=np.float32) / 255.0
        img_t = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)
        out_t = upscale_tensor(model, img_t, args.scale, args.tile)
        out_arr = (out_t.squeeze(0).permute(1, 2, 0).numpy() * 255.0
                   ).round().astype('uint8')
        Image.fromarray(out_arr, mode='RGB').save(args.output)
        print(json.dumps({
            'ok': True,
            'out_w': out_arr.shape[1],
            'out_h': out_arr.shape[0],
            'seconds': round(time.time() - t0, 1),
            'peak_rss_mb': round(peak_rss_mb(), 1),
            'scale': args.scale,
            'tile': args.tile,
        }))
    except Exception as e:  # noqa: BLE001 - worker must report, not crash silent
        print(json.dumps({'ok': False, 'error': f'{type(e).__name__}: {e}'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
