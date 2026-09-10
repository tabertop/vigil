// GDELT adapter — pulls real, free, geolocated world-conflict data.
// Two endpoints, no API key required:
//   GEO 2.0  -> geojson points (WHERE conflict news is concentrated)  -> map events
//   DOC 2.0  -> article list   (WHAT is being reported)               -> the wire
//
// If the network is unavailable (e.g. a sandbox with no egress) the adapter
// transparently falls back to a bundled sample so the server always runs.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// A conflict-focused GDELT query (GDELT query syntax).
export const CONFLICT_QUERY =
  '(airstrike OR shelling OR clashes OR offensive OR militants OR insurgency OR "armed forces" OR troops OR ceasefire OR artillery)';

const GEO_URL = (timespan = '24h') =>
  'https://api.gdeltproject.org/api/v2/geo/geo?query=' +
  encodeURIComponent(CONFLICT_QUERY) +
  `&format=geojson&timespan=${timespan}`;

const DOC_URL = (timespan = '24h', max = 60) =>
  'https://api.gdeltproject.org/api/v2/doc/doc?query=' +
  encodeURIComponent(CONFLICT_QUERY) +
  `&mode=artlist&maxrecords=${max}&format=json&sort=datedesc&timespan=${timespan}`;

async function getJSON(url, timeoutMs = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'argus-monitor/0.1' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    // GDELT sometimes returns an HTML/text error with a 200 — guard the parse.
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

async function fixture(name) {
  const raw = await readFile(join(__dirname, '..', 'fixtures', name), 'utf8');
  return JSON.parse(raw);
}

// GDELT seendate looks like "20260803T101500Z"
function parseSeen(d) {
  if (!d || d.length < 15) return Date.now();
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`;
  const t = Date.parse(iso);
  return isNaN(t) ? Date.now() : t;
}

// Stable id so re-ingesting the same point/article de-duplicates instead of piling up.
function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ---- normalizers: raw GDELT -> unified records the API serves ----

export function normalizeGeo(geojson) {
  const feats = (geojson && geojson.features) || [];
  const now = Date.now();
  return feats
    .map((f) => {
      const c = f.geometry && f.geometry.coordinates; // [lon, lat]
      if (!c || c.length < 2) return null;
      const lon = +c[0], lat = +c[1];
      if (!isFinite(lat) || !isFinite(lon)) return null;
      const p = f.properties || {};
      const place = p.name || p.location || 'Unknown';
      const count = +(p.count || p.value || 1);
      return {
        id: hashId('geo:' + place + ':' + lat.toFixed(2) + ':' + lon.toFixed(2)),
        lat, lon,
        place,
        count,                       // # of conflict mentions geolocated here
        intensity: Math.min(1, count / 50), // 0..1 for colour/size
        type: 'conflict-signal',
        source: 'GDELT GEO 2.0',
        time: now,                   // GDELT geo is a rolling window; stamp ingest time
        ingestedAt: now,
      };
    })
    .filter(Boolean);
}

export function normalizeDoc(json) {
  const arts = (json && json.articles) || [];
  return arts
    .map((a) => {
      if (!a.title || !a.url) return null;
      return {
        id: hashId('doc:' + a.url),
        title: a.title.trim(),
        url: a.url,
        domain: a.domain || '',
        country: a.sourcecountry || '',
        publishedAt: parseSeen(a.seendate),
        source: 'GDELT DOC 2.0',
      };
    })
    .filter(Boolean);
}

// ---- public fetchers (live, with graceful fixture fallback) ----

export async function fetchEvents(timespan = '24h') {
  try {
    const geo = await getJSON(GEO_URL(timespan));
    const events = normalizeGeo(geo);
    if (events.length) return { events, live: true };
    throw new Error('empty');
  } catch (e) {
    const geo = await fixture('geo.json');
    return { events: normalizeGeo(geo), live: false, reason: e.message };
  }
}

export async function fetchWire(timespan = '24h') {
  try {
    const doc = await getJSON(DOC_URL(timespan));
    const wire = normalizeDoc(doc);
    if (wire.length) return { wire, live: true };
    throw new Error('empty');
  } catch (e) {
    const doc = await fixture('doc.json');
    return { wire: normalizeDoc(doc), live: false, reason: e.message };
  }
}
