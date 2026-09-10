// Postgres + PostGIS + pgvector store — the production swap for src/store.js.
// Implements the SAME interface as the JSON store, so switching is a one-line
// import change (or STORAGE=pg with the shim in store.js). Requires the `pg`
// package (npm i pg) and a database migrated with db/schema.sql.
//
// What this buys over the file store:
//   • PostGIS geo indexing for fast spatial queries at scale
//   • pgvector semantic dedup: each incoming report is embedded and matched to an
//     existing fused event (match_event()), collapsing duplicate reporting across
//     ingest cycles — the entity-resolution the file store can't do
//   • durable, queryable history instead of a capped JSON array
//
// Lazily imports `pg` so the zero-dependency default (JSON store) still runs with
// just `node`. This module is only loaded when STORAGE=pg.

let pool = null;
async function db() {
  if (pool) return pool;
  const { Pool } = await import('pg'); // lazy — only when STORAGE=pg
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  return pool;
}

// ── deterministic 256-dim embedding (hashing trick over title+place tokens) ──
// Zero-dependency stand-in for a learned embedding: good enough for near-duplicate
// detection (same story, different outlet). Swap for a real model in production.
export function embed(text) {
  const v = new Array(256).fill(0);
  const toks = String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
  for (const t of toks) { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } const idx = Math.abs(h) % 256; v[idx] += 1; }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}
const vec = (arr) => '[' + arr.map((x) => x.toFixed(6)).join(',') + ']';

const meta = { lastIngest: null, live: false, eventCount: 0, wireCount: 0, sources: [] };

export async function load() {
  const p = await db();
  // sanity ping; schema is applied out-of-band via db/schema.sql
  await p.query('SELECT 1');
}

export async function upsertEvents(events) {
  const p = await db();
  const c = await p.connect();
  try {
    await c.query('BEGIN');
    for (const e of events) {
      await c.query(
        `INSERT INTO events (id,geom,place,count,intensity,type,source,precise,event_time,ingested_at)
         VALUES ($1, ST_SetSRID(ST_MakePoint($2,$3),4326),$4,$5,$6,$7,$8,to_timestamp($9/1000.0),now())
         ON CONFLICT (id) DO UPDATE SET count=EXCLUDED.count, intensity=EXCLUDED.intensity, ingested_at=now()`,
        [e.id, e.lon, e.lat, e.place, e.count || 1, e.intensity || 0, e.type, e.source, e.precise !== false, e.time || Date.now()]
      );
    }
    await c.query('COMMIT');
  } catch (err) { await c.query('ROLLBACK'); throw err; } finally { c.release(); }
  const r = await p.query('SELECT count(*)::int n FROM events');
  meta.eventCount = r.rows[0].n;
}

export async function setWire(wire) {
  const p = await db();
  const c = await p.connect();
  try {
    await c.query('BEGIN');
    for (const w of wire.slice(0, 2000)) {
      const emb = vec(embed(w.title + ' ' + (w.country || '')));
      // entity resolution: attach to an existing fused event if semantically close
      const m = await c.query('SELECT id FROM match_event($1::vector, 0.15)', [emb]);
      const eventId = m.rows[0]?.id || null;
      await c.query(
        `INSERT INTO wire (id,title,url,domain,source,grade,countries,published_at,embedding,event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0),$9::vector,$10)
         ON CONFLICT (id) DO UPDATE SET event_id=EXCLUDED.event_id`,
        [w.id, w.title, w.url, w.domain, w.source, w.grade || null, w.countries || [], w.publishedAt || Date.now(), emb, eventId]
      );
    }
    await c.query('COMMIT');
  } catch (err) { await c.query('ROLLBACK'); throw err; } finally { c.release(); }
  const r = await p.query('SELECT count(*)::int n FROM wire');
  meta.wireCount = r.rows[0].n;
}

export async function setIndex() { /* index is recomputed on read from events/wire; snapshot via appendHistory */ }
export async function getIndex() { return { generatedAt: meta.lastIngest, count: 0, countries: [] }; }

export async function appendHistory(index) {
  const p = await db();
  const at = (index && index.generatedAt) || new Date().toISOString();
  const c = await p.connect();
  try {
    await c.query('BEGIN');
    for (const row of index.countries || []) await c.query('INSERT INTO index_history (at,iso,score,tier) VALUES ($1,$2,$3,$4) ON CONFLICT (at,iso) DO NOTHING', [at, row.iso, row.score, row.tier]);
    await c.query('COMMIT');
  } catch (err) { await c.query('ROLLBACK'); } finally { c.release(); }
}
export async function getHistory() {
  const p = await db();
  const r = await p.query('SELECT at, iso, score FROM index_history ORDER BY at ASC');
  const byAt = new Map();
  for (const row of r.rows) { const k = row.at.toISOString(); if (!byAt.has(k)) byAt.set(k, { at: k, countries: [] }); byAt.get(k).countries.push({ iso: row.iso, score: row.score }); }
  return [...byAt.values()];
}

// events/wire read-back (index recomputation happens in the analysis layer, as with the file store)
export async function getEvents() {
  const p = await db();
  const r = await p.query('SELECT id, ST_X(geom) lon, ST_Y(geom) lat, place, count, intensity, type, source, precise, extract(epoch from event_time)*1000 AS time, extract(epoch from ingested_at)*1000 AS "ingestedAt" FROM events ORDER BY count DESC LIMIT 5000');
  return r.rows;
}
export async function getWire() {
  const p = await db();
  const r = await p.query('SELECT id,title,url,domain,source,grade,countries,extract(epoch from published_at)*1000 AS "publishedAt" FROM wire ORDER BY published_at DESC LIMIT 2000');
  return r.rows;
}

// transient point feeds + hazards + natural are kept in memory (fast-moving, not durable)
const transient = { natural: [], hazards: [], feeds: { aircraft: [], vessels: [], thermal: [] } };
export async function setNatural(e) { transient.natural = e; meta.naturalCount = e.length; }
export function getNatural() { return transient.natural; }
export async function setHazards(e) { transient.hazards = e; meta.hazardCount = e.length; }
export function getHazards() { return transient.hazards; }
export function setFeed(name, e) { transient.feeds[name] = e || []; meta[name + 'Count'] = transient.feeds[name].length; }
export function getFeed(name) { return transient.feeds[name] || []; }

export function getMeta() { return meta; }
export function setMeta(patch) { Object.assign(meta, patch); }
