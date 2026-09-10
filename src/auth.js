// Authentication, RBAC & session management — zero-dependency (node:crypto).
// Users persist in data/users.json with scrypt-hashed passwords. Sessions are
// stateless signed tokens (HMAC-SHA256) carried in an httpOnly cookie, so no
// server-side session store is needed. Roles are hierarchical:
//   viewer  < analyst < admin
// A default admin is seeded on first boot (credentials printed to the console).

import crypto from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');

export const ROLES = ['viewer', 'analyst', 'admin'];
const RANK = { viewer: 1, analyst: 2, admin: 3 };
export function roleAtLeast(role, min) { return (RANK[role] || 0) >= (RANK[min] || 99); }

// Server secret for signing tokens. Set AUTH_SECRET in prod; otherwise a random
// one is generated per boot (sessions won't survive a restart, which is fine).
const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MS = 12 * 60 * 60 * 1000; // 12h

let users = new Map(); // username -> { username, role, salt, hash }

function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }

export async function loadUsers() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const arr = JSON.parse(await readFile(USERS_FILE, 'utf8'));
    users = new Map(arr.map((u) => [u.username, u]));
  } catch { users = new Map(); }
  if (users.size === 0) {
    // seed a default admin; print credentials once so the operator can log in
    const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    await createUser('admin', pw, 'admin');
    console.log('\n  ┌─ VIGIL auth ─────────────────────────────────');
    console.log('  │ seeded admin account');
    console.log('  │   username: admin');
    console.log(`  │   password: ${pw}`);
    console.log('  │ (set ADMIN_PASSWORD env to control this)');
    console.log('  └──────────────────────────────────────────────\n');
  }
}

async function persist() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify([...users.values()], null, 2));
}

export async function createUser(username, password, role = 'viewer') {
  username = String(username).trim().toLowerCase();
  if (!username || !password) throw new Error('username and password required');
  if (!ROLES.includes(role)) role = 'viewer';
  const salt = crypto.randomBytes(16).toString('hex');
  users.set(username, { username, role, salt, hash: hashPw(password, salt) });
  await persist();
  return { username, role };
}
export function listUsers() { return [...users.values()].map((u) => ({ username: u.username, role: u.role })); }
export async function deleteUser(username) { users.delete(String(username).toLowerCase()); await persist(); }

export function verifyLogin(username, password) {
  const u = users.get(String(username || '').trim().toLowerCase());
  if (!u) return null;
  const h = hashPw(password, u.salt);
  const ok = h.length === u.hash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash));
  return ok ? { username: u.username, role: u.role } : null;
}

// ---- stateless signed session tokens ----
export function issueToken(user) {
  const payload = { u: user.username, r: user.role, exp: Date.now() + SESSION_MS };
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  return b + '.' + sig;
}
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [b, sig] = token.split('.');
  if (!b || !sig) return null;
  const exp = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  const a = Buffer.from(sig), e = Buffer.from(exp);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (!p.exp || p.exp < Date.now()) return null;
    return { username: p.u, role: p.r };
  } catch { return null; }
}

export function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) { const i = part.indexOf('='); if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
export function sessionFrom(req) { return verifyToken(parseCookies(req).vigil_session); }
export const SESSION_COOKIE = 'vigil_session';
export const SESSION_MAX_AGE = SESSION_MS / 1000;
