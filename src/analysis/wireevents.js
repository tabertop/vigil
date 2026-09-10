// Generic wire-derived event layers — scan the multi-source wire for a topic's
// keywords, geo-tag matches to countries, and return country-centroid points
// sized by how many outlets cover it. Same engine as protests, reused for armed
// conflict and disease outbreaks. Works live off the RSS wire (no extra feed).

import { tagCountries, countryByIso } from '../data/countries.js';

export const KEYWORDS = {
  armedconflict: ['airstrike', 'air strike', 'air raid', 'shelling', 'shelled', 'offensive', 'artillery', 'clash', 'clashes', 'militant', 'insurgent', 'ambush', 'gunmen', 'gunfire', 'armed forces', 'troops', 'missile', 'rocket', 'drone strike', 'drone attack', 'bombing', 'bombard', 'bomb ', 'firefight', 'frontline', 'front line', 'killed', 'attack', 'strike on', 'war', 'invasion', 'invade', 'coup', 'ceasefire', 'incursion', 'raid', 'militia', 'combatant', 'shell ', 'assault', 'siege', 'seized', 'battle'],
  disease: ['outbreak', 'cholera', 'ebola', 'marburg', 'measles', 'mpox', 'monkeypox', 'dengue', 'malaria', 'polio', 'epidemic', 'pandemic', 'bird flu', 'avian flu', 'h5n1', 'coronavirus', 'covid', 'infection', 'quarantine', 'contagion', 'diphtheria', 'meningitis', 'lassa', 'virus', 'flu ', 'disease', 'vaccine'],
  terror: ['terror', 'terrorist', 'terror attack', 'suicide bomb', 'suicide attack', 'car bomb', 'vbied', ' ied ', 'roadside bomb', 'improvised explosive', 'bombing', 'bomb blast', 'blast', 'explosion', 'detonat', 'mass shooting', 'gunmen', 'gunman', 'opened fire', 'hostage', 'kidnap', 'abduct', 'massacre', 'claimed responsibility', 'jihadist', 'jihadi', 'extremist', 'militant attack', 'insurgent attack', 'grenade', 'assassinat', 'isis', 'islamic state', 'al-qaeda', 'al-shabaab', 'boko haram', 'iswap', 'al-shabab'],
};

export function computeWireEvents(wire = [], kw = [], layer = 'events') {
  const acc = new Map(); // iso -> { count, time, headline }
  const kws = kw.map((k) => ' ' + k);
  for (const r of wire) {
    const hay = ' ' + String(r.title || '').toLowerCase();
    if (!kws.some((k) => hay.includes(k))) continue;
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
  const label = layer === 'disease' ? 'outbreak report' : layer === 'armedconflict' ? 'conflict report' : layer === 'terror' ? 'terror-related report' : 'report';
  const out = [];
  for (const [iso, a] of acc) {
    const c = countryByIso(iso);
    if (!c) continue;
    out.push({
      id: layer + ':' + iso,
      lat: c.lat, lon: c.lon, place: c.name, label: c.name,
      count: a.count, intensity: Math.min(1, a.count / 6),
      layer, time: a.time, source: 'Wire',
      sub: `${a.count} ${label}${a.count === 1 ? '' : 's'} · ${c.name}`,
    });
  }
  return out.sort((x, y) => y.count - x.count);
}
