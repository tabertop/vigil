// Protests layer — derived live from the multi-source wire (no extra feed needed).
// Scans headlines for protest/unrest reporting, geo-tags each to a country, and
// returns country-centroid protest points sized by how many outlets are covering
// it. Works even where GDELT is blocked, since it rides the RSS wire.

import { tagCountries, countryByIso } from '../data/countries.js';

const KW = ['protest', 'protester', 'demonstration', 'demonstrator', 'rally', 'march ', 'riot', 'unrest', 'uprising', 'sit-in', 'walkout', 'general strike', 'anti-government', 'crackdown', 'clashes with police'];

function isProtest(title) {
  const s = ' ' + String(title || '').toLowerCase() + ' ';
  return KW.some((k) => s.includes(k));
}

export function computeProtests(wire = []) {
  const acc = new Map(); // iso -> { count, time, headline }
  for (const r of wire) {
    if (!isProtest(r.title)) continue;
    const isos = r.countries && r.countries.length ? r.countries : tagCountries(r.title + ' ' + (r.country || '')).map((t) => t.country.iso);
    const seen = new Set();
    for (const iso of isos) {
      if (seen.has(iso)) continue;
      seen.add(iso);
      const a = acc.get(iso) || { count: 0, time: 0, headline: '' };
      a.count += 1;
      if ((r.publishedAt || 0) > a.time) { a.time = r.publishedAt || 0; a.headline = r.title; }
      acc.set(iso, a);
    }
  }
  const out = [];
  for (const [iso, a] of acc) {
    const c = countryByIso(iso);
    if (!c) continue;
    out.push({
      id: 'protest:' + iso,
      lat: c.lat, lon: c.lon, place: c.name, label: c.name,
      count: a.count, intensity: Math.min(1, a.count / 6),
      layer: 'protests', time: a.time, source: 'Wire',
      sub: `${a.count} protest report${a.count === 1 ? '' : 's'} · ${c.name}`,
    });
  }
  return out.sort((x, y) => y.count - x.count);
}
