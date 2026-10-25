import { imageSize } from 'image-size';
import { config } from './config.js';

// Magic-byte signatures. MIME from the client is never trusted: the type
// is derived from these bytes, and the extension is derived from the type.
const SIGNATURES = [
  { type: 'png', ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'jpeg', ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  { type: 'webp', ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50] },
];

function detectType(buf) {
  for (const sig of SIGNATURES) {
    let ok = true;
    for (let i = 0; i < sig.magic.length; i++) {
      if (sig.magic[i] !== null && buf[i] !== sig.magic[i]) { ok = false; break; }
    }
    if (ok) return sig;
  }
  return null;
}

export function validateImageBuffer(buf) {
  if (!buf || buf.length === 0) {
    return { ok: false, error: 'Empty file.' };
  }
  if (buf.length > config.maxFileBytes) {
    return { ok: false, error: `File too large: max ${config.maxFileBytes / 1024 / 1024}MB.` };
  }
  const sig = detectType(buf);
  if (!sig) {
    return { ok: false, error: 'Unsupported file type. Only PNG, JPEG, and WebP are accepted.' };
  }
  let dims;
  try {
    dims = imageSize(buf);
  } catch {
    return { ok: false, error: 'Could not read image dimensions. The file may be corrupt.' };
  }
  if (!dims || !dims.width || !dims.height) {
    return { ok: false, error: 'Could not read image dimensions.' };
  }
  const maxSide = Math.max(dims.width, dims.height);
  const minSide = Math.min(dims.width, dims.height);
  if (maxSide > config.maxDim) {
    return { ok: false, error: `Image too large: longest side max ${config.maxDim}px (got ${maxSide}px).` };
  }
  if (minSide < config.minDim) {
    return { ok: false, error: `Image too small: shortest side min ${config.minDim}px.` };
  }
  return { ok: true, type: sig.type, ext: sig.ext, width: dims.width, height: dims.height };
}

export function tileFor(width, height) {
  return Math.max(width, height) <= config.directMaxSide ? 0 : config.tileSize;
}

export function safeDownloadName(originalName, scale) {
  const base = (originalName || 'image').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'image';
  const stem = base.replace(/\.[^.]*$/, '');
  return `${stem}_upscaled_${scale}x.png`;
}
