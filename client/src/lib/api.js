const BASE = '/api';

async function jsonOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function getCapabilities() {
  const res = await fetch(`${BASE}/capabilities`);
  return jsonOrThrow(res);
}

export async function createJob(file, scale) {
  const fd = new FormData();
  fd.append('image', file);
  fd.append('scale', String(scale));
  const res = await fetch(`${BASE}/jobs`, { method: 'POST', body: fd });
  return jsonOrThrow(res);
}

export async function createBatch(files, scale) {
  const fd = new FormData();
  for (const f of files) fd.append('images', f);
  fd.append('scale', String(scale));
  const res = await fetch(`${BASE}/batch`, { method: 'POST', body: fd });
  return jsonOrThrow(res);
}

export async function listJobs() {
  const res = await fetch(`${BASE}/jobs`);
  return jsonOrThrow(res);
}

export async function getJob(id) {
  const res = await fetch(`${BASE}/jobs/${id}`);
  return jsonOrThrow(res);
}

export async function cancelJob(id) {
  const res = await fetch(`${BASE}/jobs/${id}/cancel`, { method: 'POST' });
  return jsonOrThrow(res);
}

export async function getBatch(id) {
  const res = await fetch(`${BASE}/batch/${id}`);
  return jsonOrThrow(res);
}

export const previewUrl = (id, kind) => `${BASE}/jobs/${id}/preview/${kind}`;
export const downloadUrl = (id) => `${BASE}/jobs/${id}/download`;
export const batchZipUrl = (id) => `${BASE}/batch/${id}/zip`;

// Rough CPU time estimate from the measured Stage 0 benchmark:
// 256px 4x ≈ 44s, 512px tiled 4x ≈ 132s, 256px 2x ≈ 29s. Linear in pixels
// is only an approximation; the UI labels it as an estimate.
export function estimateSeconds(width, height, scale) {
  const px = width * height;
  const rate = scale === 4 ? 0.0006 : 0.00045;
  return Math.max(10, Math.round(px * rate));
}

export function formatDuration(sec) {
  if (sec < 60) return `~${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `~${m}m ${s}s` : `~${m}m`;
}
