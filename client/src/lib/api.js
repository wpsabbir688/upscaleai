// Hosted frontend (e.g. Netlify) talks to a separate API host via
// VITE_API_URL at build time; unset = same-origin '/api' (local dev and
// the server-served build). Note: a cross-origin split also needs the
// server's cookie/CORS settings updated (SameSite=None + Secure) — see README.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') || '/api';

// Clear, honest error for a missing backend. Previously a non-JSON
// response (e.g. the Netlify SPA fallback serving index.html for /api/*)
// was swallowed into {} and then treated as a valid payload — which made
// a logged-out visitor look logged in (truthy {} user, blank credits) and
// crashed the studio when {} flowed into array code (jobs.find/.some).
export const BACKEND_NOT_CONNECTED =
  'The UpscaleAI server is not connected yet — the backend is not live. Please try again later.';

// Network failure (server down, DNS, CORS block) is also "no backend",
// not a cryptic TypeError.
async function apiFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error(BACKEND_NOT_CONNECTED);
  }
}

async function jsonOrThrow(res) {
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error(BACKEND_NOT_CONNECTED);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(BACKEND_NOT_CONNECTED);
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Session lives in an HttpOnly cookie (set by the server); the frontend
// never sees or stores a token. Same-origin fetches send the cookie.
async function postJson(path, body) {
  const res = await apiFetch(`${BASE}${path}`, {
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
  const res = await apiFetch(`${BASE}/auth/me`);
  if (res.status === 401 || res.status === 403) return null;
  const data = await jsonOrThrow(res);
  // Defense in depth: a JSON-but-wrong-shape payload must never become a
  // truthy placeholder user (that was the blank-credit header bug).
  if (!data || typeof data !== 'object' || typeof data.email !== 'string') return null;
  return data;
}

export async function changePassword(currentPassword, newPassword) {
  return postJson('/auth/change-password', { currentPassword, newPassword });
}

export async function deleteAccount(password) {
  const res = await apiFetch(`${BASE}/auth/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return jsonOrThrow(res);
}

export async function getCredits() {
  const res = await apiFetch(`${BASE}/credits`);
  return jsonOrThrow(res);
}

// Manual bKash/Nagad payments (Stage 3): the user sends money outside the
// app and submits a claim; an admin approves it by hand. No gateway.
export async function createPaymentClaim(method, amountBdt, txnId, senderMobile) {
  return postJson('/payments', { method, amountBdt, txnId, senderMobile });
}

export async function listMyPayments() {
  const res = await apiFetch(`${BASE}/payments/mine`);
  return jsonOrThrow(res);
}

export async function adminPayments() {
  const res = await apiFetch(`${BASE}/admin/payments`);
  return jsonOrThrow(res);
}

export async function adminApprovePayment(id) {
  return postJson(`/admin/payments/${id}/approve`, {});
}

export async function adminRejectPayment(id, reason) {
  return postJson(`/admin/payments/${id}/reject`, { reason });
}

// Admin (server enforces role; the UI only hides these links).
export async function adminOverview() {
  const res = await apiFetch(`${BASE}/admin/overview`);
  return jsonOrThrow(res);
}

export async function adminUsers() {
  const res = await apiFetch(`${BASE}/admin/users`);
  return jsonOrThrow(res);
}

export async function adminJobs() {
  const res = await apiFetch(`${BASE}/admin/jobs`);
  return jsonOrThrow(res);
}

export async function adminHealth() {
  const res = await apiFetch(`${BASE}/admin/health`);
  return jsonOrThrow(res);
}

export async function adminAudit() {
  const res = await apiFetch(`${BASE}/admin/audit`);
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
  const res = await apiFetch(`${BASE}/capabilities`);
  return jsonOrThrow(res);
}

export async function createJob(file, scale) {
  const fd = new FormData();
  fd.append('image', file);
  fd.append('scale', String(scale));
  const res = await apiFetch(`${BASE}/jobs`, { method: 'POST', body: fd });
  return jsonOrThrow(res);
}

export async function createBatch(files, scale) {
  const fd = new FormData();
  for (const f of files) fd.append('images', f);
  fd.append('scale', String(scale));
  const res = await apiFetch(`${BASE}/batch`, { method: 'POST', body: fd });
  return jsonOrThrow(res);
}

export async function listJobs() {
  const res = await apiFetch(`${BASE}/jobs`);
  return jsonOrThrow(res);
}

export async function getJob(id) {
  const res = await apiFetch(`${BASE}/jobs/${id}`);
  return jsonOrThrow(res);
}

export async function cancelJob(id) {
  const res = await apiFetch(`${BASE}/jobs/${id}/cancel`, { method: 'POST' });
  return jsonOrThrow(res);
}

export async function getBatch(id) {
  const res = await apiFetch(`${BASE}/batch/${id}`);
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
