// Live hazard layers — real, free, keyless natural-hazard feeds:
//   • NASA EONET  → wildfires, severe storms, volcanoes (open events)
//   • GDACS       → floods, tropical cyclones, volcanoes, drought (alert-scored)
// Both normalize into the same layer-feature shape the map already renders, each
// tagged with a `layer` id so the frontend buckets them automatically. Per-source
// fixture fallback keeps the app populated offline.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=500';
const GDACS_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromDate=&toDate=&alertlevel=Green;Orange;Red&eventlist=TC;FL;VO;DR;WF';

function hashId(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }

async function getJSON(url, ms = 14000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'argus-monitor/0.3', accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return JSON.parse(await res.text());
  } finally { clearTimeout(t); }
}
async function fixture(name) { return JSON.parse(await readFile(join(__dirname, '..', 'fixtures', name), 'utf8')); }

// pull [lon,lat] out of an EONET geometry entry (Point or Polygon)
function coordsOf(geom) {
  const c = geom && geom.coordinates;
  if (!c) return null;
  if (typeof c[0] === 'number') return [c[0], c[1]];
  const ring = Array.isArray(c[0][0]) ? c[0][0] : c[0]; // polygon → first vertex
  return Array.isArray(ring) && typeof ring[0] === 'number' ? ring : (ring[0] || null);
}
const EONET_LAYER = { wildfires: 'fires', severeStorms: 'storms', volcanoes: 'volcanoes' };
const EONET_INTENSITY = { fires: 0.5, storms: 0.75, volcanoes: 0.8 };

function normEonet(events) {
  const now = Date.now();
  return events
    .map((e) => {
      const cat = (e.categories && e.categories[0] && (e.categories[0].id || e.categories[0])) || '';
      const layer = EONET_LAYER[cat];
      if (!layer) return null;
      const g = e.geometry && e.geometry[e.geometry.length - 1];
      const c = coordsOf(g);
      if (!c) return null;
      const t = g && g.date ? Date.parse(g.date) : now;
      const label = e.title || layer;
      return {
        id: hashId('eonet:' + (e.id || label)),
        lat: +c[1], lon: +c[0], place: label, label,
        intensity: EONET_INTENSITY[layer] || 0.5,
        layer, kind: cat, time: isNaN(t) ? now : t, source: 'NASA EONET',
        sub: `${label} · NASA EONET`,
      };
    })
    .filter(Boolean);
}

const GDACS_LAYER = { FL: 'floods', TC: 'storms', VO: 'volcanoes', DR: 'drought', WF: 'fires' };
const GDACS_NAME = { FL: 'Flood', TC: 'Tropical cyclone', VO: 'Volcano', DR: 'Drought', WF: 'Wildfire' };
const ALERT = { Green: 0.3, Orange: 0.65, Red: 1 };

function normGdacs(features) {
  const now = Date.now();
  return features
    .map((f) => {
      // accept both raw GeoJSON features and the compact fixture shape
      const p = f.properties || f;
      const type = p.eventtype;
      const layer = GDACS_LAYER[type];
      if (!layer) return null;
      const c = (f.geometry && f.geometry.coordinates) || p.coords;
      if (!c || typeof c[0] !== 'number') return null;
      const alert = p.alertlevel || p.alert || 'Green';
      const name = (p.eventname || p.name || '').trim() || GDACS_NAME[type] || layer;
      const t = Date.parse(p.fromdate || p.from || '') || now;
      return {
        id: hashId('gdacs:' + (p.eventid || name + c[0] + c[1])),
        lat: +c[1], lon: +c[0], place: name, label: name,
        intensity: ALERT[alert] || 0.4,
        layer, kind: type, time: isNaN(t) ? now : t, source: 'GDACS',
        sub: `${GDACS_NAME[type] || layer} · GDACS · ${alert} alert`,
      };
    })
    .filter(Boolean);
}

async function fetchEonet() {
  try {
    const j = await getJSON(EONET_URL);
    const ev = normEonet(j.events || []);
    if (ev.length) return { events: ev, live: true };
    throw new Error('empty');
  } catch {
    try { return { events: normEonet(await fixture('eonet.json')), live: false }; } catch { return { events: [], live: false }; }
  }
}
async function fetchGdacs() {
  try {
    const j = await getJSON(GDACS_URL);
    const ev = normGdacs(j.features || []);
    if (ev.length) return { events: ev, live: true };
    throw new Error('empty');
  } catch {
    try { return { events: normGdacs(await fixture('gdacs.json')), live: false }; } catch { return { events: [], live: false }; }
  }
}

export async function fetchHazards() {
  const [e, g] = await Promise.all([fetchEonet(), fetchGdacs()]);
  const sources = [];
  if (e.live) sources.push('NASA EONET');
  if (g.live) sources.push('GDACS');
  return { events: [...e.events, ...g.events], live: e.live || g.live, sources };
}
