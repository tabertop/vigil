// Intelligence dossier — the "click to drill in" analysis layer.
// Given a country (iso) or a specific signal location (place), it fuses the
// stored event model + wire into a structured risk product: a score & tier, a
// confidence rating driven by source corroboration, a breakdown of *risk
// drivers* mined from the reporting, the key incident locations, the relevant
// intelligence feed, and a data-grounded narrative assessment.
//
// Everything here is derived from data already in the store — no external calls,
// no dependencies. It is deterministic and explainable (each driver carries its
// evidence), which is the point: an analyst can see *why* a place scores as it
// does, not just the number.

import { tagCountries, countryByIso } from '../data/countries.js';
import { KEYWORDS } from './wireevents.js';
import { countryFacts } from '../data/facts.js';
import { centroidFor } from '../data/centroids.js';
import { sourceGrade, gradeWeight, GRADE_LABEL } from '../data/sources.js';
import { sanctionsFor } from '../data/sanctions.js';

const CRIT_KW = ['killed', 'dead', 'attack', 'strike', 'war', 'missile', 'explosion', 'offensive', 'coup', 'invasion', 'massacre', 'siege'];
const countKw = (arts, kws) => arts.filter((a) => { const t = ' ' + String(a.title || '').toLowerCase(); return kws.some((k) => t.includes(k)); }).length;

// Risk-driver taxonomy. Each article/place is scanned for these keyword sets;
// a driver's weight is how many distinct reports corroborate it.
const DRIVERS = [
  { key: 'armed-conflict', label: 'Armed conflict', kw: ['airstrike', 'air raid', 'shelling', 'clash', 'offensive', 'artillery', 'strike', 'fighting', 'battle', 'assault', 'attack', 'troops', 'armed forces', 'bombard', 'frontline', 'front line', 'shell', 'combat'] },
  { key: 'insurgency', label: 'Insurgency / non-state armed groups', kw: ['militant', 'insurgen', 'jihad', 'al-shabaab', 'al shabaab', 'boko haram', 'isis', 'islamic state', 'taliban', 'rsf', 'm23', 'junta', 'rebel', 'wagner', 'cartel', 'gang', 'houthi'] },
  { key: 'displacement', label: 'Displacement / humanitarian', kw: ['displace', 'refugee', 'idp', ' aid', 'humanitarian', 'famine', 'hunger', 'starv', ' camp', 'relief', 'evacuat', 'shortage', 'cholera', 'civilian'] },
  { key: 'maritime', label: 'Maritime / trade security', kw: ['shipping', 'vessel', 'strait', 'naval', 'red sea', ' port', 'tanker', 'maritime', 'blockade', 'sea lane', 'shipping lane'] },
  { key: 'political', label: 'Political instability', kw: ['coup', 'election', 'protest', 'sanction', 'regime', 'unrest', 'crackdown', 'opposition', 'ceasefire', 'negotiat', ' talks', 'boycott', 'government'] },
  { key: 'strategic', label: 'Strategic / great-power', kw: ['drill', 'exercise', 'deploy', 'warn', 'tension', 'nuclear', 'missile', 'escalat', 'border', 'incursion', 'airspace', 'sovereignty'] },
];

function tierOf(score) {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'Severe';
  if (score >= 25) return 'Elevated';
  return 'Watch';
}

function scoreDrivers(texts) {
  const out = DRIVERS.map((d) => ({ key: d.key, label: d.label, weight: 0, evidence: [] }));
  for (const t of texts) {
    const low = ' ' + String(t.text || '').toLowerCase() + ' ';
    out.forEach((o, i) => {
      if (DRIVERS[i].kw.some((k) => low.includes(k))) {
        o.weight += 1;
        if (o.evidence.length < 3 && t.cite) o.evidence.push(t.cite);
      }
    });
  }
  return out.filter((o) => o.weight > 0).sort((a, b) => b.weight - a.weight);
}

// Reliability-weighted confidence: breadth of INDEPENDENT sources gated by their
// Admiralty reliability grades. Two wire services outweigh five copies of one
// state broadcaster. `graded` is a list of {source, grade}.
function confidenceOf(graded, dataPoints) {
  const distinct = new Set(graded.map((g) => g.source)).size;
  const relSum = graded.reduce((a, g) => a + gradeWeight(g.grade), 0);
  const best = graded.map((g) => g.grade).sort()[0] || 'U';
  const hasHigh = best === 'A' || best === 'B';
  if (distinct >= 3 && hasHigh) return { level: 'High', why: `${distinct} independent sources (best grade ${best}), ${dataPoints} corroborating data points`, reliability: Math.round((relSum / Math.max(1, graded.length)) * 100) / 100, bestGrade: best };
  if (distinct >= 2 || (distinct >= 1 && best === 'A')) return { level: 'Moderate', why: `${distinct} source(s), best grade ${best}, ${dataPoints} data point(s)`, reliability: Math.round((relSum / Math.max(1, graded.length)) * 100) / 100, bestGrade: best };
  return { level: 'Low', why: `single ${best !== 'U' ? 'grade-' + best + ' ' : ''}source, uncorroborated`, reliability: Math.round((relSum / Math.max(1, graded.length)) * 100) / 100 || gradeWeight(best), bestGrade: best };
}

// Build a dossier for a country (iso) OR a single place (fallback).
export function buildDossier({ iso, place }, { events = [], wire = [], index = { countries: [] } } = {}) {
  // Resolve target: prefer explicit iso; else tag the clicked place to a country.
  let country = iso ? countryByIso(iso) : null;
  // Fallback: the curated gazetteer covers ~47 countries; resolve any other ISO
  // from the complete centroid table + facts so EVERY country works.
  if (!country && iso) {
    const c = centroidFor(iso);
    if (c) country = { iso: String(iso).toUpperCase(), name: (countryFacts(iso) || {}).name || c.name, lat: c.lat, lon: c.lon, aliases: [] };
  }
  if (!country && place) {
    const tags = tagCountries(place);
    if (tags.length) country = tags[0].country;
  }

  // --- gather signals + articles scoped to the target ---
  let signals, articles, name, lat, lon;

  if (country) {
    name = country.name; lat = country.lat; lon = country.lon;
    signals = events
      .filter((e) => e.precise !== false)
      .filter((e) => { const t = tagCountries(e.place || ''); return t[0] && t[0].country.iso === country.iso; })
      .sort((a, b) => b.count - a.count);
    articles = wire.filter((r) => {
      const isos = r.countries && r.countries.length ? r.countries : tagCountries(r.title + ' ' + (r.country || '')).map((t) => t.country.iso);
      return isos.includes(country.iso);
    });
  } else {
    // place-only dossier: scope to the exact signal location + loosely-matching wire
    name = place || 'Unknown location';
    signals = events.filter((e) => e.precise !== false && e.place === place).sort((a, b) => b.count - a.count);
    if (signals[0]) { lat = signals[0].lat; lon = signals[0].lon; }
    const token = String(place || '').split(/[,\s]+/).filter((w) => w.length > 3)[0] || '';
    articles = token ? wire.filter((r) => r.title.toLowerCase().includes(token.toLowerCase())) : [];
  }

  articles = articles.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  // --- metrics ---
  const totalMentions = signals.reduce((s, e) => s + (Number(e.count) || 0), 0);
  const sourceSet = new Set([...signals.map((s) => s.source), ...articles.map((a) => a.source)]);
  const sourceCount = sourceSet.size;
  const dataPoints = signals.length + articles.length;
  const topPlace = signals[0] ? signals[0].place : name;

  // --- score & tier ---
  let score, tier;
  const row = country ? (index.countries || []).find((c) => c.iso === country.iso) : null;
  if (row) { score = row.score; tier = row.tier; }
  else {
    // Not in the country index for this window — derive from local evidence so a
    // wire-covered place never shows a misleading 0. Article volume + strongest
    // geolocated signal both contribute.
    const peak = signals[0] ? Math.round(signals[0].intensity * 100) : 0;
    const artScore = Math.min(70, articles.length * 8);
    score = Math.min(100, Math.max(peak, artScore));
    tier = tierOf(score);
  }

  // --- risk drivers (mined from headlines + incident place names) ---
  const texts = [
    ...articles.map((a) => ({ text: a.title, cite: { title: a.title, url: a.url, source: a.source } })),
    ...signals.map((s) => ({ text: s.place, cite: null })),
  ];
  const drivers = scoreDrivers(texts);
  // GDELT geolocated fighting is itself armed-conflict evidence even absent a headline
  if (signals.length && !drivers.some((d) => d.key === 'armed-conflict')) {
    drivers.unshift({ key: 'armed-conflict', label: 'Armed conflict', weight: signals.length, evidence: [] });
  }

  // instability sub-scores (0–100), mapped from driver weights — the
  // Unrest / Conflict / Military / Humanitarian breakdown behind the headline score
  const dw = {};
  drivers.forEach((d) => { dw[d.key] = d.weight; });
  const sub = (...keys) => Math.min(100, Math.round(keys.reduce((s, k) => s + (dw[k] || 0), 0) * 16));
  const subscores = [
    { key: 'conflict', label: 'Conflict', score: sub('armed-conflict', 'insurgency') },
    { key: 'unrest', label: 'Unrest', score: sub('political') },
    { key: 'military', label: 'Military', score: sub('strategic', 'maritime') },
    { key: 'humanitarian', label: 'Humanitarian', score: sub('displacement') },
  ];

  // reliability-graded source set (distinct), for the confidence model
  const gradedSources = [...sourceSet].map((s) => ({ source: s, grade: sourceGrade(s) }));
  const confidence = confidenceOf(gradedSources, dataPoints);

  // --- intelligence brief (scannable indicator line, à la a watch-desk digest) ---
  const brief = {
    protests: countKw(articles, KEYWORDS.protests || ['protest', 'demonstration', 'rally', 'riot', 'unrest', 'strike']),
    armed: countKw(articles, KEYWORDS.armedconflict),
    disease: countKw(articles, KEYWORDS.disease),
    critical: countKw(articles, CRIT_KW),
  };

  // --- narrative assessment (templated, but every clause is data-derived) ---
  const topDrivers = drivers.slice(0, 3).map((d) => d.label.toLowerCase());
  const sentences = [];
  sentences.push(`${name} is assessed at ${tier.toUpperCase()} (${score}/100) on the VIGIL instability index.`);
  if (topDrivers.length) {
    sentences.push(
      `Signal fusion identifies ${topDrivers.join(', ')} as the primary risk driver${topDrivers.length > 1 ? 's' : ''}` +
        (topPlace && topPlace !== name ? `, with activity concentrated around ${topPlace}.` : '.')
    );
  }
  sentences.push(
    `Drawn from ${signals.length} geolocated signal${signals.length === 1 ? '' : 's'} and ${articles.length} report${articles.length === 1 ? '' : 's'} ` +
      `across ${sourceCount} source${sourceCount === 1 ? '' : 's'}; confidence ${confidence.level.toUpperCase()}.`
  );

  return {
    name,
    iso: country ? country.iso : null,
    lat, lon,
    score,
    tier,
    headline: `${tier} · ${drivers[0] ? drivers[0].label : 'Elevated activity'}`,
    confidence,
    subscores,
    brief,
    facts: country ? countryFacts(country.iso) : null,
    sanctions: country ? sanctionsFor(country.iso) : null,
    metrics: { signalCount: signals.length, totalMentions, articleCount: articles.length, sourceCount, topPlace },
    drivers: drivers.slice(0, 6),
    signals: signals.slice(0, 8).map((s) => ({ place: s.place, count: s.count, intensity: s.intensity, source: s.source })),
    articles: articles.slice(0, 12).map((a) => { const g = sourceGrade(a.source, a.domain); return { title: a.title, url: a.url, domain: a.domain, source: a.source, grade: g, gradeLabel: GRADE_LABEL[g], publishedAt: a.publishedAt, retrievedAt: a.retrievedAt }; }),
    sources: [...sourceSet],
    gradedSources: gradedSources.map((g) => ({ source: g.source, grade: g.grade })),
    assessment: sentences.join(' '),
    generatedAt: new Date().toISOString(),
  };
}
