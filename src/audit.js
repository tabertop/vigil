// Audit log — append-only record of who did what, for accountability & review.
// Every authenticated data access, login, export and admin action is logged to
// data/audit.jsonl (one JSON object per line — cheap to append, easy to ship to
// a SIEM later). Admins can read the tail via /api/audit.

import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const AUDIT_FILE = join(DATA_DIR, 'audit.jsonl');

let ready = false;
async function ensure() { if (!ready) { await mkdir(DATA_DIR, { recursive: true }); ready = true; } }

// Fire-and-forget; auditing must never block or crash a request.
export async function audit(entry) {
  try {
    await ensure();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    await appendFile(AUDIT_FILE, line);
  } catch { /* non-fatal */ }
}

export async function readAudit(limit = 200) {
  try {
    const txt = await readFile(AUDIT_FILE, 'utf8');
    const lines = txt.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
}
