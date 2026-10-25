const BASE = '/api';

async function jsonOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Session lives in an HttpOnly cookie (set by the server); the frontend
// never sees or stores a token. Same-origin fetches send the cookie.
async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return jsonOrThrow(res);
}

export async function register(email, password) {
  return postJson('/auth/register', { email, password });
}

export async function login(email, password) {
  return postJson('/auth/login', { email, password });
}

export async function logout() {
  return postJson('/auth/logout', {});
}

export async function getMe() {
  const res = await fetch(`${BASE}/auth/me`);
  if (res.status === 401 || res.status === 403) return null;
  return jsonOrThrow(res);
}

export async function changePassword(currentPassword, newPassword) {
  return postJson('/auth/change-password', { currentPassword, newPassword });
}

export async function deleteAccount(password) {
  const res = await fetch(`${BASE}/auth/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return jsonOrThrow(res);
}

export async function getCredits() {
  const res = await fetch(`${BASE}/credits`);
  return jsonOrThrow(res);
}

// Admin (server enforces role; the UI only hides these links).
export async function adminOverview() {
  const res = await fetch(`${BASE}/admin/overview`);
  return jsonOrThrow(res);
}

export async function adminUsers() {
  const res = await fetch(`${BASE}/admin/users`);
  return jsonOrThrow(res);
}

export async function adminJobs() {
  const res = await fetch(`${BASE}/admin/jobs`);
  return jsonOrThrow(res);
}

export async function adminHealth() {
  const res = await fetch(`${BASE}/admin/health`);
  return jsonOrThrow(res);
}

export async function adminAudit() {
  const res = await fetch(`${BASE}/admin/audit`);
  return jsonOrThrow(res);
}

export async function adminSuspend(id) {
  return postJson(`/admin/users/${id}/suspend`, {});
}

export async function adminUnsuspend(id) {
  return postJson(`/admin/users/${id}/unsuspend`, {});
}

export async function adminSetPlan(id, plan) {
  return postJson(`/admin/users/${id}/plan`, { plan });
}

export async function adminAdjustCredits(id, delta, reason) {
  return postJson(`/admin/users/${id}/credits`, { delta, reason });
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
