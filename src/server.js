// VIGIL backend — HTTP API + static frontend. Zero external dependencies.
//   GET /api/health   -> ingest status
//   GET /api/events   -> GeoJSON FeatureCollection of geolocated conflict signals
//   GET /api/wire     -> latest conflict news articles
//   GET /             -> the live globe frontend (public/index.html)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

// ---- minimal .env loader (zero-dependency) ----
// Reads KEY=VALUE lines from a .env file at the project root and sets any that
// aren't already in the environment. This is how ANTHROPIC_API_KEY (AI narrative),
// AUTH_SECRET, ADMIN_PASSWORD, FIRMS_KEY, AISSTREAM_KEY etc. get "connected"
// without hard-coding secrets. Real env vars always win over the file.
(function loadDotEnv() {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
    for (const raw of readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
    console.log('  [env] loaded .env');
  } catch { /* no .env — fine */ }
})();
import { load, getEvents, getWire, getIndex, getNatural, getHazards, getMeta, getHistory, getFeed, getCases, getCase, saveCase, deleteCase } from './store.js';
import { buildReport } from './analysis/report.js';
import { randomUUID } from 'node:crypto';
import { runIngest } from './ingest.js';
import { buildDossier } from './analysis/dossier.js';
import { computeInstability } from './analysis/instability.js';
import { buildTopNews } from './analysis/topnews.js';
import { computeProtests } from './analysis/protests.js';
import { computeWireEvents, KEYWORDS } from './analysis/wireevents.js';
import { computeLinkGraph } from './analysis/linkgraph.js';
import { computeCorrelation } from './analysis/correlation.js';
import { computeTrends } from './analysis/trends.js';
import { fuseEvents } from './analysis/fusion.js';
import { computeForecast } from './analysis/forecast.js';
import { backtestForecast } from './analysis/backtest.js';
import { computeWarnings } from './analysis/warnings.js';
import { computeThreatLevel } from './analysis/threatlevel.js';
import { getWorldState, primeWorldState } from './worldstate.js';
import { retrieveContext, askAnalyst } from './analysis/analyst.js';
import { buildBrief, REGIONS } from './analysis/brief.js';
import { aiEnabled } from './llm.js';
import { computePredictions } from './analysis/predict.js';
import { aiForecast } from './analysis/ai.js';
import { referencePayload } from './data/reference.js';
import { loadUsers, verifyLogin, issueToken, sessionFrom, roleAtLeast, listUsers, createUser, deleteUser, ROLES, SESSION_COOKIE, SESSION_MAX_AGE } from './auth.js';
import { audit, readAudit, clientIp } from './audit.js';

const AUTH_REQUIRED = process.env.AUTH_REQUIRED !== 'false'; // on by default (serious product)

function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => resolve(d)); req.on('error', () => resolve(''));
  });
}
function setCookie(res, name, val, maxAge) {
  res.setHeader('set-cookie', `${name}=${encodeURIComponent(val)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const PORT = process.env.PORT || 8787;
const INGEST_EVERY_MS = 15 * 60 * 1000; // GDELT updates ~every 15 min

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function json(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

// ---- time-window filtering ----
// A ?window= param scopes every data endpoint by real timestamps, so the whole
// view (map, wire, index, dossier) re-aggregates for that window.
const WINDOWS = { '1h': 36e5, '6h': 6 * 36e5, '24h': 24 * 36e5, '48h': 48 * 36e5, '7d': 7 * 24 * 36e5, all: Infinity };
function windowMs(param) {
  return Object.prototype.hasOwnProperty.call(WINDOWS, param) ? WINDOWS[param] : WINDOWS['24h'];
}
function withinWindow(ts, ms, now) {
  return ms === Infinity || now - (ts || 0) <= ms;
}
// Filtered views of the store for a given window.
function windowedEvents(ms) {
  const now = Date.now();
  return getEvents().filter((e) => withinWindow(e.time ?? e.ingestedAt, ms, now));
}
function windowedWire(ms) {
  const now = Date.now();
  return getWire().filter((w) => withinWindow(w.publishedAt, ms, now));
}

// events -> GeoJSON so the frontend map can consume it directly
function eventsGeoJSON(events) {
  return {
    type: 'FeatureCollection',
    features: events.map((e) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: { id: e.id, place: e.place, count: e.count, intensity: e.intensity, type: e.type, source: e.source, precise: e.precise !== false },
    })),
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  const ms = windowMs(url.searchParams.get('window'));
  const me = sessionFrom(req); // current authenticated user (or null)

  // ---- auth endpoints (public) ----
  if (path === '/api/login' && req.method === 'POST') {
    let body = {}; try { body = JSON.parse(await readBody(req)); } catch {}
    const user = verifyLogin(body.username, body.password);
    if (!user) { await audit({ action: 'login.fail', user: String(body.username || '').slice(0, 40), ip: clientIp(req) }); return json(res, { error: 'Invalid credentials' }, 401); }
    setCookie(res, SESSION_COOKIE, issueToken(user), SESSION_MAX_AGE);
    await audit({ action: 'login', user: user.username, role: user.role, ip: clientIp(req) });
    return json(res, { ok: true, user });
  }
  if (path === '/api/logout') {
    if (me) await audit({ action: 'logout', user: me.username, role: me.role, ip: clientIp(req) });
    setCookie(res, SESSION_COOKIE, '', 0);
    return json(res, { ok: true });
  }
  if (path === '/api/whoami') return json(res, me ? { authenticated: true, ...me } : { authenticated: false });

  // ---- auth gate ----
  if (AUTH_REQUIRED && !me) {
    const isApi = path.startsWith('/api/');
    const isPublic = path === '/login' || path === '/login.html';
    if (isApi) return json(res, { error: 'authentication required' }, 401);
    if (!isPublic) { res.writeHead(302, { location: '/login' }); return res.end(); }
  }

  // ---- RBAC-gated admin endpoints ----
  if (path === '/api/audit') {
    if (!roleAtLeast(me?.role, 'admin')) return json(res, { error: 'forbidden' }, 403);
    return json(res, { entries: await readAudit(Number(url.searchParams.get('limit')) || 200) });
  }
  if (path === '/api/users') {
    if (!roleAtLeast(me?.role, 'admin')) return json(res, { error: 'forbidden' }, 403);
    if (req.method === 'POST') {
      let b = {}; try { b = JSON.parse(await readBody(req)); } catch {}
      if (b.delete) { await deleteUser(b.username); await audit({ action: 'user.delete', user: me.username, detail: b.username }); return json(res, { ok: true, users: listUsers() }); }
      if (!b.username || !b.password || !ROLES.includes(b.role)) return json(res, { error: 'username, password, valid role required' }, 400);
      await createUser(b.username, b.password, b.role); await audit({ action: 'user.create', user: me.username, detail: `${b.username}:${b.role}` });
      return json(res, { ok: true, users: listUsers() });
    }
    return json(res, { users: listUsers(), roles: ROLES });
  }

  // Single coherent world-state per window, computed once + memoized (see worldstate.js).
  const wkey = url.searchParams.get('window') || '24h';
  const stateFor = () => getWorldState(wkey, { events: windowedEvents(ms), wire: windowedWire(ms), history: getHistory(), feeds: { aircraft: getFeed('aircraft') } });

  if (path === '/api/health') return json(res, { ...getMeta(), me });
  if (path === '/api/events') return json(res, eventsGeoJSON(windowedEvents(ms)));
  if (path === '/api/wire') return json(res, windowedWire(ms));
  if (path === '/api/index') return json(res, stateFor().index);
  if (path === '/api/natural') {
    const now = Date.now();
    return json(res, getNatural().filter((e) => withinWindow(e.time, ms, now)));
  }
  if (path === '/api/reference') return json(res, referencePayload());
  // hazards are *currently active* events (a wildfire open for weeks still matters
  // now), so they ignore the time window and always return the full active set.
  if (path === '/api/hazards') return json(res, getHazards());
  if (path === '/api/topnews') return json(res, stateFor().topnews);
  if (path === '/api/protests') return json(res, computeProtests(windowedWire(ms)));
  if (path === '/api/armedconflict') return json(res, computeWireEvents(windowedWire(ms), KEYWORDS.armedconflict, 'armedconflict'));
  if (path === '/api/disease') return json(res, computeWireEvents(windowedWire(ms), KEYWORDS.disease, 'disease'));
  if (path === '/api/terror') return json(res, computeWireEvents(windowedWire(ms), KEYWORDS.terror, 'terror'));
  if (path === '/api/linkgraph') return json(res, stateFor().linkgraph);
  if (path === '/api/correlation') return json(res, stateFor().correlation);
  if (path === '/api/trends') {
    const hours = Number(url.searchParams.get('hours')) || 24;
    return json(res, computeTrends(getHistory(), { hours }));
  }
  if (path === '/api/warnings') return json(res, stateFor().warnings);
  if (path === '/api/threatlevel') return json(res, stateFor().threat);
  if (path === '/api/predict' || path === '/api/ai-forecast') {
    const s = stateFor();
    const det = s.predictions;
    if (path === '/api/ai-forecast') {
      if (me) audit({ action: 'ai.forecast', user: me.username, role: me.role, ip: clientIp(req) });
      const ai = await aiForecast({ predictions: det.predictions, warnings: s.warnings, forecast: s.forecast, index: s.index });
      return json(res, { ...det, ai });
    }
    return json(res, { ...det, aiAvailable: !!process.env.ANTHROPIC_API_KEY });
  }
  // ---- VIGIL AI Analyst (retrieval-grounded Q&A over VIGIL's own data) ----
  if (path === '/api/ask') {
    if (req.method !== 'POST') return json(res, { error: 'POST {question}' }, 405);
    let b = {}; try { b = JSON.parse(await readBody(req)); } catch {}
    const question = String(b.question || '').trim().slice(0, 500);
    if (!question) return json(res, { error: 'question required' }, 400);
    const s = stateFor();
    const ctx = retrieveContext(question, { state: s, wire: windowedWire(ms), events: windowedEvents(ms) });
    if (me) audit({ action: 'ai.ask', user: me.username, role: me.role, detail: question.slice(0, 120), ip: clientIp(req) });
    const out = await askAnalyst(question, ctx);
    return json(res, out);
  }
  if (path === '/api/ask/status') return json(res, { enabled: aiEnabled() });
  if (path === '/api/brief') {
    const region = url.searchParams.get('region') || 'global';
    return json(res, await buildBrief(region, { state: stateFor() }));
  }
  if (path === '/api/aircraft') return json(res, getFeed('aircraft'));
  if (path === '/api/vessels') return json(res, getFeed('vessels'));
  if (path === '/api/thermal') return json(res, getFeed('thermal'));
  if (path === '/api/cyber') return json(res, getFeed('cyber'));
  if (path === '/api/fusion') return json(res, stateFor().fusion);
  if (path === '/api/forecast') {
    const horizonH = Number(url.searchParams.get('horizon')) || 72;
    // default horizon is served from the cached world-state; custom horizons compute live
    return json(res, horizonH === 72 ? stateFor().forecast : computeForecast(getHistory(), { horizonH }));
  }
  // ---- analyst case files (RBAC: viewer reads, analyst+ writes) ----
  if (path === '/api/cases') {
    const id = url.searchParams.get('id');
    if (req.method === 'GET') return json(res, id ? (getCase(id) || { error: 'not found' }) : { cases: getCases() });
    if (req.method === 'POST') {
      if (!roleAtLeast(me?.role, 'analyst')) return json(res, { error: 'forbidden — analyst role required' }, 403);
      let b = {}; try { b = JSON.parse(await readBody(req)); } catch {}
      if (b.delete) { await deleteCase(b.delete); await audit({ action: 'case.delete', user: me.username, detail: b.delete, ip: clientIp(req) }); return json(res, { ok: true, cases: getCases() }); }
      const existing = b.id ? getCase(b.id) : null;
      const now = new Date().toISOString();
      const c = {
        id: b.id || randomUUID().slice(0, 8),
        title: String(b.title || 'Untitled Case').slice(0, 120),
        classification: b.classification || 'UNCLASSIFIED // OSINT',
        entities: Array.isArray(b.entities) ? b.entities.slice(0, 60) : (existing?.entities || []),
        notes: typeof b.notes === 'string' ? b.notes.slice(0, 20000) : (existing?.notes || ''),
        createdBy: existing?.createdBy || me.username,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        updatedBy: me.username,
      };
      await saveCase(c);
      await audit({ action: existing ? 'case.update' : 'case.create', user: me.username, detail: `${c.id}:${c.title}`, ip: clientIp(req) });
      return json(res, { ok: true, case: c });
    }
  }
  if (path === '/api/report') {
    const id = url.searchParams.get('id');
    const c = getCase(id);
    if (!c) return json(res, { error: 'case not found' }, 404);
    const events = windowedEvents(ms), wire = windowedWire(ms);
    if (me) audit({ action: 'report.generate', user: me.username, role: me.role, detail: `${c.id}:${c.title}`, ip: clientIp(req) });
    return json(res, buildReport(c, { events, wire, index: computeInstability(events, wire), history: getHistory(), author: me?.username }));
  }
  if (path === '/api/backtest') {
    const horizonH = Number(url.searchParams.get('horizon')) || 72;
    return json(res, backtestForecast(getHistory(), { horizonH }));
  }
  if (path === '/api/history') {
    const iso = url.searchParams.get('iso');
    const h = getHistory();
    if (iso) return json(res, h.map((s) => ({ at: s.at, score: (s.countries.find((c) => c.iso === iso) || {}).score ?? null })));
    return json(res, { snapshots: h.length, first: h[0]?.at || null, last: h[h.length - 1]?.at || null, history: h });
  }
  if (path === '/api/dossier') {
    const iso = url.searchParams.get('iso');
    const place = url.searchParams.get('place');
    if (!iso && !place) return json(res, { error: 'pass ?iso= or ?place=' }, 400);
    const events = windowedEvents(ms), wire = windowedWire(ms);
    if (me) audit({ action: 'dossier.view', user: me.username, role: me.role, detail: iso || place, ip: clientIp(req) });
    return json(res, buildDossier({ iso, place }, { events, wire, index: stateFor().index }));
  }

  // static files
  let file = path === '/' ? '/index.html' : path === '/login' ? '/login.html' : path;
  file = file.replace(/\.\./g, ''); // basic traversal guard
  try {
    const buf = await readFile(join(PUBLIC, file));
    const ext = extname(file);
    // Never let browsers serve a stale app shell: the frontend is a single, frequently
    // redeployed HTML file (with all JS/CSS inline), so a cached copy shows an old build
    // — which on a phone meant the pre-mobile layout ("nothing works on mobile"). Force
    // revalidation on HTML; keep other static assets briefly cached.
    const cache = ext === '.html' ? 'no-cache, no-store, must-revalidate' : 'no-cache';
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': cache });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});

await load(); // load persisted events/wire/index so endpoints serve data instantly
await loadUsers(); // load/seed accounts for auth

// Listen FIRST, then ingest — with 100+ feeds the boot ingest takes ~20-30s, and
// we don't want the frontend to hit a dead port during it. Persisted data is
// served immediately; the fresh ingest swaps in when it completes.
server.listen(PORT, () => {
  const m = getMeta();
  console.log(`\n  VIGIL server → http://localhost:${PORT}`);
  console.log(`  data source: ${m.source || 'unknown'}\n`);
  // After each ingest, recompute the default-window world-state so the first
  // request post-ingest is warm and every panel reads one fresh, consistent snapshot.
  const prime = () => {
    try {
      const ms24 = windowMs('24h');
      primeWorldState('24h', { events: windowedEvents(ms24), wire: windowedWire(ms24), history: getHistory(), feeds: { aircraft: getFeed('aircraft') } });
    } catch (e) { /* non-fatal */ }
  };
  const ingestThenPrime = () => runIngest().then(prime).catch((e) => console.error('[ingest] failed:', e && e.message));
  ingestThenPrime();                              // ingest once on boot (background) + prime
  setInterval(ingestThenPrime, INGEST_EVERY_MS);  // then on a timer

  // Keep-alive: free hosting (Render free tier) spins the instance DOWN after ~15
  // min of no inbound traffic, so the next visitor eats a 30-60s cold start. A
  // light self-ping every 10 min keeps it warm. Runs only when a public URL is
  // known (RENDER_EXTERNAL_URL is injected automatically on Render, or set
  // KEEPALIVE_URL) — so it's a no-op in local dev. Hits /login: public + cheap.
  const KEEPALIVE_URL = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (KEEPALIVE_URL) {
    const ping = () => fetch(KEEPALIVE_URL.replace(/\/$/, '') + '/login')
      .catch((e) => console.error('[keepalive] ping failed:', e && e.message));
    setInterval(ping, 10 * 60 * 1000); // every 10 min (< the ~15 min idle window)
    console.log(`  keep-alive: self-ping ${KEEPALIVE_URL} every 10 min\n`);
  }
});
