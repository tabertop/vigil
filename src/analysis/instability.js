// Instability index — a per-country risk score derived from the unified event
// model (roadmap step 4). Everything already normalizes into events, so the
// index is just an aggregation over them, fused with the wire for context.
//
// Score intuition:
//   • GDELT precise points contribute their mention `count`, weighted up by
//     `intensity` (hot incident locations count for more).
//   • RSS country signals contribute their aggregated mention count.
//   Both are already `events`, so one pass over events captures both sources.
//   The wire is used to attach the latest headline + article count per country.
//
// Raw weight is log-compressed against the busiest country so the 0–100 score
// stays readable when one hotspot dwarfs the rest.

import { tagCountries, countryByIso } from '../data/countries.js';

// Article severity weighting — coverage volume is NOT instability. A country in 30
// trade/diplomacy stories isn't in crisis; one in 5 airstrike stories is. Wire
// articles contribute weight by how conflict/severity-laden the headline is, so
// heavily-covered-but-stable states (China, US, UK) don't get pushed to Critical.
const SEV_HIGH = [' killed', ' dead', 'airstrike', 'air strike', 'missile', 'shelling', 'bombing', ' bomb', 'car bomb', 'suicide', 'attack', 'strike on', ' war', 'invasion', 'offensive', 'massacre', ' coup', ' siege', 'explosion', 'clashes', 'gunmen', 'assault', 'genocide', 'atrocity', 'ethnic cleansing', 'hostage', 'militant', 'insurgent', 'terror', 'drone strike', 'artillery', 'frontline', 'ceasefire', 'armed forces'];
const SEV_MED = ['protest', 'sanction', 'crisis', 'tension', 'unrest', 'crackdown', 'dispute', ' warns', 'threat', 'border', 'displaced', 'refugee', 'famine', 'outbreak', 'epidemic', 'disaster', 'flood', 'earthquake', 'wildfire', 'coup', 'martial law', 'state of emergency', 'evacuat', 'militia', 'rebel', 'incursion', 'blockade', 'strike'];
function artWeight(title) {
  const s = ' ' + String(title || '').toLowerCase() + ' ';
  if (SEV_HIGH.some((k) => s.includes(k))) return 6;
  if (SEV_MED.some((k) => s.includes(k))) return 2;
  return 0.4; // generic mention — barely moves the score
}

function tierOf(score) {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'Severe';
  if (score >= 25) return 'Elevated';
  return 'Watch';
}

export function computeInstability(events = [], wire = []) {
  const acc = new Map(); // iso -> aggregate

  const bump = (iso, country) => {
    let a = acc.get(iso);
    if (!a) {
      a = { iso, name: country.name, lat: country.lat, lon: country.lon, raw: 0, signals: 0, articles: 0, topPlace: '', topCount: 0, sources: new Set(), latestHeadline: '', latestAt: 0 };
      acc.set(iso, a);
    }
    return a;
  };

  // 1) events → raw weight + signal counts, grouped by country
  for (const e of events) {
    const tags = tagCountries(e.place || '');
    if (!tags.length) continue;
    const { country } = tags[0];
    const a = bump(country.iso, country);
    const count = Number(e.count) || 0;
    const intensity = Number(e.intensity) || 0;
    a.raw += count * (1 + intensity * 0.5);
    if (e.precise === false) a.sources.add('RSS');
    else { a.sources.add('GDELT'); a.signals += 1; }
    if (count > a.topCount && e.precise !== false) { a.topCount = count; a.topPlace = e.place; }
  }

  // 2) wire → article weight + counts + latest headline per mentioned country.
  // Wire coverage is itself a signal: many countries appear ONLY in the wire (no
  // GDELT precise point), and they must still score — otherwise a heavily-reported
  // country like Lebanon reads 0/100. Each corroborating article adds raw weight,
  // and a wire-only country is created here rather than skipped.
  for (const r of wire) {
    const isos = r.countries && r.countries.length ? r.countries : tagCountries(r.title + ' ' + (r.country || '')).map((t) => t.country.iso);
    const w = artWeight(r.title);
    const seen = new Set();
    for (const iso of isos) {
      if (seen.has(iso)) continue;
      seen.add(iso);
      let a = acc.get(iso);
      if (!a) { const country = countryByIso(iso); if (!country) continue; a = bump(iso, country); }
      a.articles += 1;
      a.raw += w; // severity-weighted, not flat
      a.sources.add('RSS');
      const at = Number(r.publishedAt) || 0;
      if (at > a.latestAt) { a.latestAt = at; a.latestHeadline = r.title; }
    }
  }

  const rows = [...acc.values()];
  const maxRaw = rows.reduce((m, a) => Math.max(m, a.raw), 0) || 1;
  const denom = Math.log1p(maxRaw);

  // Score curve: blend a linear ratio (spreads the top so only genuine hotspots
  // approach 100) with a log ratio (keeps the long tail visible instead of
  // collapsing when one hotspot dwarfs the rest). Pure log bunched everyone at the
  // top (16 "Critical"); this yields a believable distribution.
  const countries = rows
    .map((a) => {
      const lin = a.raw / maxRaw;                 // 0..1, magnitude-faithful
      const lg = Math.log1p(a.raw) / denom;       // 0..1, tail-preserving
      const score = Math.round((0.68 * lin + 0.32 * lg) * 100);
      return {
        iso: a.iso,
        name: a.name,
        lat: a.lat,
        lon: a.lon,
        score,
        tier: tierOf(score),
        signals: a.signals,
        articles: a.articles,
        topPlace: a.topPlace || a.name,
        latestHeadline: a.latestHeadline,
        sources: [...a.sources].sort(),
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return { generatedAt: new Date().toISOString(), count: countries.length, countries };
}
