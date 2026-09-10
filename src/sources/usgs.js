// USGS earthquake adapter — real, free, keyless seismic data for the "natural
// events" layer. Feeds the map with live geolocated quakes (M2.5+, past week).
// Falls back to a bundled fixture when offline, like every other source.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';

function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// USGS feature → unified layer feature. `intensity` 0..1 from magnitude so the
// frontend can size/colour it on the same scale as everything else.
function normalize(f) {
  const c = f.geometry && f.geometry.coordinates;
  if (!c || c.length < 2) return null;
  const lon = +c[0], lat = +c[1];
  if (!isFinite(lat) || !isFinite(lon)) return null;
  const p = f.properties || {};
  const mag = +p.mag || 0;
  return {
    id: hashId('quake:' + (f.id || p.place + p.time)),
    lat, lon,
    place: p.place || 'Unknown',
    mag,
    depth: +c[2] || 0,
    value: mag,
    intensity: Math.max(0, Math.min(1, (mag - 2.5) / 5)), // M2.5→0 .. M7.5→1
    layer: 'natural',
    kind: 'quake',
    time: +p.time || Date.now(),
    source: 'USGS',
  };
}

async function getJSON(url, timeoutMs = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'argus-monitor/0.3' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return JSON.parse(await res.text());
  } finally {
    clearTimeout(t);
  }
}

export async function fetchNatural() {
  try {
    const gj = await getJSON(USGS_URL);
    const events = (gj.features || []).map(normalize).filter(Boolean);
    if (events.length) return { events, live: true };
    throw new Error('empty');
  } catch (e) {
    // fixture is a compact array of {mag,place,time,lon,lat,depth}
    try {
      const raw = JSON.parse(await readFile(join(__dirname, '..', 'fixtures', 'quakes.json'), 'utf8'));
      const events = raw
        .map((q) =>
          normalize({ id: 'fx' + q.time + q.lon, properties: { mag: q.mag, place: q.place, time: q.time }, geometry: { coordinates: [q.lon, q.lat, q.depth] } })
        )
        .filter(Boolean);
      return { events, live: false, reason: e.message };
    } catch {
      return { events: [], live: false, reason: e.message };
    }
  }
}
