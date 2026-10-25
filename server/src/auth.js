import crypto from 'node:crypto';
import argon2 from 'argon2';
import { config } from './config.js';
import { publicUser } from './db.js';

// Sessions: HttpOnly cookie carries a random token; only its SHA-256 hash is
// stored server-side. Tokens are NEVER kept in localStorage.
export const SESSION_COOKIE = 'upscaleai_session';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${config.sessionDays * 24 * 60 * 60}`,
  ];
  if (config.cookieSecure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)`)
    .run(hashToken(token), userId, now, now + config.sessionDays * 24 * 60 * 60 * 1000);
  return token;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateCredentials(email, password) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim().toLowerCase())) {
    return 'Enter a valid email address.';
  }
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  return null;
}

export async function registerUser(db, email, password) {
  const err = validateCredentials(email, password);
  if (err) return { error: err, status: 400 };
  const clean = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(clean);
  if (existing) return { error: 'An account with this email already exists.', status: 409 };
  const id = crypto.randomUUID();
  const now = Date.now();
  const hash = await argon2.hash(password);
  db.prepare(`INSERT INTO users
    (id, email, password_hash, role, status, plan, credits, created_at, updated_at)
    VALUES (?, ?, ?, 'user', 'active', 'free', ?, ?, ?)`)
    .run(id, clean, hash, config.freeCredits, now, now);
  db.prepare(`INSERT INTO credit_ledger (id, user_id, delta, reason, job_id, created_at)
    VALUES (?, ?, ?, 'signup', NULL, ?)`)
    .run(crypto.randomUUID(), id, config.freeCredits, now);
  const user = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  return { user, token: createSession(db, id) };
}

export async function loginUser(db, email, password) {
  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'Invalid email or password.', status: 401 };
  }
  const row = db.prepare('SELECT * FROM users WHERE email = ?')
    .get(email.trim().toLowerCase());
  if (!row) return { error: 'Invalid email or password.', status: 401 };
  if (row.status !== 'active') return { error: 'This account is suspended.', status: 403 };
  let ok = false;
  try { ok = await argon2.verify(row.password_hash, password); } catch { ok = false; }
  if (!ok) return { error: 'Invalid email or password.', status: 401 };
  return { user: publicUser(row), token: createSession(db, row.id) };
}

export function logoutSession(db, req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  clearSessionCookie(res);
}

// Auth middleware: attaches req.user (public shape) or rejects. Suspended
// accounts stop working immediately — their sessions are rejected here.
export function requireAuth(db) {
  return (req, res, next) => {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return res.status(401).json({ error: 'Login required.' });
    const sess = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
    if (!sess || sess.expires_at <= Date.now()) {
      if (sess) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(sess.user_id);
    if (!row) return res.status(401).json({ error: 'Login required.' });
    if (row.status !== 'active') return res.status(403).json({ error: 'This account is suspended.' });
    req.user = publicUser(row);
    req.sessionHash = hashToken(token);
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

// Change password: verifies the current password, then re-hashes and
// invalidates every OTHER session (the current one stays alive).
export async function changePassword(db, userId, sessionHash, currentPassword, newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return { error: 'New password must be at least 8 characters.', status: 400 };
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) return { error: 'User not found.', status: 404 };
  let ok = false;
  try { ok = await argon2.verify(row.password_hash, currentPassword); } catch { ok = false; }
  if (!ok) return { error: 'Current password is incorrect.', status: 401 };
  const hash = await argon2.hash(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hash, Date.now(), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
    .run(userId, sessionHash);
  return { ok: true };
}

export { setSessionCookie, clearSessionCookie, createSession };
