// Correlation Engine — cross-domain (multi-INT) fusion.
// The instability index scores each country on ONE blended number; this asks a
// different, Gotham-style question: in how many *distinct* threat domains is a
// place lighting up at once, and do they converge? A country with armed conflict
// AND a disease outbreak AND mass protests AND a natural disaster stacking in the
// same window is a qualitatively different problem than one with a high score in
// a single domain. That stacking — "convergence" — is what this surfaces.
//
// Domains are derived from data already computed elsewhere (geolocated conflict
// signals, plus wire-mined protest/armed/disease/disaster/political layers), so
// it stays deterministic and every domain keeps a headline as evidence.

import { tagCountries, countryByIso } from '../data/countries.js';
import { computeProtests } from './protests.js';
import { computeWireEvents, KEYWORDS } from './wireevents.js';

const DISASTER_KW = ['earthquake', 'flood', 'flooding', 'wildfire', 'cyclone', 'hurricane', 'typhoon', 'drought', 'famine', 'landslide', 'volcano', 'eruption', 'heatwave', 'wildfires', 'storm surge', 'tsunami'];
const POLITICAL_KW = ['coup', 'election', 'sanction', 'impeach', 'no-confidence', 'martial law', 'state of emergency', 'crackdown', 'dissolved parliament', 'political crisis', 'resign'];

const DOMAINS = [
  { key: 'conflict', label: 'Armed conflict', weight: 3 },
  { key: 'protest', label: 'Civil unrest', weight: 2 },
  { key: 'disease', label: 'Disease outbreak', weight: 2 },
  { key: 'disaster', label: 'Natural disaster', weight: 2 },
  { key: 'political', label: 'Political crisis', weight: 1 },
];

// helper: turn a computeWireEvents-style layer into iso -> {count, headline}
function byIso(rows) {
  const m = new Map();
  for (const r of rows) {
    const iso = String(r.id || '').split(':')[1];
    if (iso) m.set(iso, { count: r.count, headline: r.sub || r.label || '' });
  }
  return m;
}

export function computeCorrelation(wire = [], events = [], index = { countries: [] }) {
  const protest = byIso(computeProtests(wire));
  const armed = byIso(computeWireEvents(wire, KEYWORDS.armedconflict, 'armedconflict'));
  const disease = byIso(computeWireEvents(wire, KEYWORDS.disease, 'disease'));
  const disaster = byIso(computeWireEvents(wire, DISASTER_KW, 'disaster'));
  const political = byIso(computeWireEvents(wire, POLITICAL_KW, 'political'));

  // conflict domain from geolocated signals (precise GDELT points), tagged to country
  const conflictIso = new Map();
  for (const e of events) {
    if (e.precise === false) continue;
    const t = tagCountries(e.place || '');
    const iso = t[0] && t[0].country.iso;
    if (!iso) continue;
    conflictIso.set(iso, (conflictIso.get(iso) || 0) + (Number(e.count) || 1));
  }
  const idxScore = new Map((index.countries || []).map((c) => [c.iso, c.score]));

  // union of all countries touched by any domain
  const isos = new Set([...conflictIso.keys(), ...protest.keys(), ...armed.keys(), ...disease.keys(), ...disaster.keys(), ...political.keys()]);

  const rows = [];
  for (const iso of isos) {
    const c = countryByIso(iso);
    if (!c) continue;
    const active = [];
    const push = (key, label, present, headline) => { if (present) active.push({ key, label, headline: headline || '' }); };
    push('conflict', 'Armed conflict', conflictIso.has(iso) || armed.has(iso), armed.get(iso)?.headline || (conflictIso.has(iso) ? `${conflictIso.get(iso)} geolocated conflict signals` : ''));
    push('protest', 'Civil unrest', protest.has(iso), protest.get(iso)?.headline);
    push('disease', 'Disease outbreak', disease.has(iso), disease.get(iso)?.headline);
    push('disaster', 'Natural disaster', disaster.has(iso), disaster.get(iso)?.headline);
    push('political', 'Political crisis', political.has(iso), political.get(iso)?.headline);

    if (active.length < 2) continue; // convergence requires ≥2 stacked domains

    const wsum = active.reduce((s, a) => s + (DOMAINS.find((d) => d.key === a.key)?.weight || 1), 0);
    const convergence = Math.min(100, Math.round(wsum * 11 + active.length * 6));
    rows.push({
      iso, name: c.name, lat: c.lat, lon: c.lon,
      domainCount: active.length,
      domains: active,
      convergence,
      indexScore: idxScore.get(iso) ?? null,
      tier: convergence >= 70 ? 'Convergence' : convergence >= 45 ? 'Compound' : 'Watch',
    });
  }
  rows.sort((a, b) => b.domainCount - a.domainCount || b.convergence - a.convergence);
  return {
    generatedAt: new Date().toISOString(),
    domains: DOMAINS,
    count: rows.length,
    alerts: rows,
  };
}
