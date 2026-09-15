// Event Fusion Engine — the intelligence core.
// Raw feeds give you N headlines about the same incident; an intelligence product
// gives you ONE event with N citations, a corroboration count, and a defensible
// confidence assessment. This clusters the multi-source wire into distinct events
// (greedy token/entity overlap over short headlines), then for each event computes:
//   • corroboration — number of DISTINCT sources reporting it
//   • reliability   — Admiralty-graded weight of those sources (a wire service
//                     counts for more than a single state broadcaster)
//   • confidence    — CONFIRMED / PROBABLE / SINGLE-SOURCE, from corroboration
//                     breadth × source reliability × tier diversity
//   • provenance    — every contributing report, with its grade, kept for audit
//   • geo           — country tagging + centroid so events place on the map
//
// Deterministic, zero-dependency, and fully explainable: every event can be traced
// back to the exact reports and grades that produced its confidence.

import { tagCountries, countryByIso } from '../data/countries.js';
import { sourceGrade, gradeWeight, GRADE_LABEL } from '../data/sources.js';

const STOP = new Set(
  ('the a an and or but of to in on for with from by at as is are was were be been being this that these those it its his her their our your my we you they he she them him us not no yes will would could should can may might must have has had do does did over under after before into out about more most other some such than then them there here what when where which who whom whose why how all any both each few nor own same so too very just also amid says say said report reports news world after over first years year people government against during between'
    .split(' ')
  )
);
const SEVERITY = ['strike', 'airstrike', 'killed', 'dead', 'attack', 'war', 'missile', 'shelling', 'clashes', 'offensive', 'coup', 'sanction', 'nuclear', 'invasion', 'troops', 'militant', 'explosion', 'assault', 'ceasefire', 'hostage', 'genocide', 'massacre', 'displaced', 'famine', 'crisis', 'protest', 'earthquake', 'outbreak'];
// Relevance gate — an intelligence feed carries security/instability events, not
// sports, business or entertainment. An event qualifies if it hits any of these
// (in addition to the SEVERITY terms above).
const RELEVANCE = SEVERITY.concat(['military', 'defen', 'security', 'border', 'sanction', 'diplomat', 'election', 'protest', 'unrest', 'rebel', 'insurgen', 'terror', 'drone', 'navy', 'naval', 'warship', 'airspace', 'nuclear', 'weapon', 'arms', 'hostage', 'kidnap', 'refugee', 'humanitarian', 'aid', 'evacuat', 'flood', 'wildfire', 'cyclone', 'hurricane', 'drought', 'volcano', 'disease', 'cholera', 'outbreak', 'epidemic', 'strike', 'blast', 'bomb', 'shoot', 'gunmen', 'siege', 'crackdown', 'martial', 'junta', 'occupation', 'annex', 'incursion', 'espionage', 'cyberattack', 'cyber', 'assassinat', 'regime', 'militia', 'ambush', 'raid', 'clash', 'tension', 'escalat', 'crisis', 'emergency']);
// Exclusion — sports / entertainment / soft news that keyword-collides with
// security terms ("goal drought", "title race", "transfer war"). If a cluster's
// representative headline reads as one of these, it's dropped regardless.
const EXCLUDE = ['champions league', 'premier league', 'la liga', 'serie a', 'bundesliga', 'world cup', 'euro 20', 'football', 'soccer', 'nba', 'nfl', 'mlb', 'cricket', 'rugby', 'tennis', 'golf', 'olympic', 'fixture', 'transfer window', 'box office', 'grammy', 'oscar', 'celebrity', 'kardashian', 'taylor swift', 'netflix', 'movie', 'album', 'song ', 'recipe', ' vs ', ' v ', 'beat brugge', 'goal drought', 'title race', 'match report', 'full-time', 'kick-off', 'quarter-final', 'semi-final', 'final -'];
function relevant(title) { const low = ' ' + String(title || '').toLowerCase() + ' '; return RELEVANCE.some((k) => low.includes(k)); }
function excluded(title) { const low = ' ' + String(title || '').toLowerCase() + ' '; return EXCLUDE.some((k) => low.includes(k)); }

function tokens(title) {
  return new Set(String(title || '').toLowerCase().replace(/[^a-z0-9'\- ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 5 && !STOP.has(w)));
}
function strong(tok, isos) { const s = new Set(isos); for (const w of tok) if (w.length >= 6) s.add(w); return s; }
function overlap(a, b) { let n = 0; for (const x of a) if (b.has(x)) n++; return n; }
function severityOf(title) { const low = ' ' + String(title).toLowerCase() + ' '; let s = 0; for (const k of SEVERITY) if (low.includes(k)) s++; return Math.min(3, s); }

// Confidence assessment from corroboration breadth + reliability + tier diversity.
function assess(sources) {
  const grades = sources.map((s) => sourceGrade(s.source, s.domain));
  const distinct = new Set(sources.map((s) => s.source)).size;
  const tierSet = new Set(grades);
  const relSum = grades.reduce((a, g) => a + gradeWeight(g), 0);
  const best = grades.sort()[0] || 'U'; // A < B < C ... best grade present
  const hasHigh = best === 'A' || best === 'B';
  // score 0..100: independent-source breadth is the dominant term, quality gates the top
  let conf = Math.min(100, Math.round(relSum * 22 + distinct * 8 + (tierSet.size - 1) * 6));
  let level;
  if (distinct >= 3 && hasHigh) level = 'CONFIRMED';
  else if (distinct >= 2 || (distinct >= 1 && best === 'A')) level = 'PROBABLE';
  else level = 'SINGLE-SOURCE';
  if (level === 'SINGLE-SOURCE') conf = Math.min(conf, 45);
  if (level === 'PROBABLE') conf = Math.min(Math.max(conf, 46), 74);
  if (level === 'CONFIRMED') conf = Math.max(conf, 75);
  return { level, score: conf, distinctSources: distinct, bestGrade: best, tierDiversity: tierSet.size, reliability: Math.round((relSum / Math.max(1, grades.length)) * 100) / 100 };
}

export function fuseEvents(wire = [], now = Date.now()) {
  const items = wire
    .map((r) => {
      const isos = r.countries && r.countries.length ? r.countries : tagCountries(r.title + ' ' + (r.country || '')).map((t) => t.country.iso);
      const tok = tokens(r.title);
      return { r, isos, tok, strong: strong(tok, isos) };
    })
    .sort((a, b) => (b.r.publishedAt || 0) - (a.r.publishedAt || 0));

  const clusters = [];
  for (const it of items) {
    let best = null;
    for (const c of clusters) {
      if (overlap(it.tok, c.tok) >= 2 && overlap(it.strong, c.strong) >= 1) { best = c; break; }
    }
    if (best) {
      best.members.push(it.r); it.tok.forEach((t) => best.tok.add(t)); it.strong.forEach((t) => best.strong.add(t));
      new Set(it.isos).forEach((i) => { best.isos.add(i); best.isoCount.set(i, (best.isoCount.get(i) || 0) + 1); });
      if ((it.r.publishedAt || 0) > (best.last || 0)) best.last = it.r.publishedAt;
      if ((it.r.publishedAt || 0) < (best.first || Infinity)) best.first = it.r.publishedAt;
    } else {
      clusters.push({ rep: it.r, repIsos: [...new Set(it.isos)], members: [it.r], tok: new Set(it.tok), strong: new Set(it.strong), isos: new Set(it.isos), isoCount: new Map([...new Set(it.isos)].map((i) => [i, 1])), first: it.r.publishedAt || now, last: it.r.publishedAt || now });
    }
  }

  // keep only security/instability-relevant clusters (any member headline qualifies),
  // dropping any whose representative headline reads as sports/entertainment
  const relevantClusters = clusters.filter((c) => !excluded(c.rep.title) && c.members.some((m) => relevant(m.title)));
  const events = relevantClusters.map((c, i) => {
    // provenance: one entry per contributing report, newest first, with its grade
    const seen = new Set();
    const provenance = c.members
      .slice()
      .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
      .map((m) => { const grade = sourceGrade(m.source, m.domain); return { source: m.source, domain: m.domain, title: m.title, url: m.url, grade, gradeLabel: GRADE_LABEL[grade], publishedAt: m.publishedAt, retrievedAt: m.retrievedAt }; });
    const distinctSrc = provenance.filter((p) => { if (seen.has(p.source)) return false; seen.add(p.source); return true; });
    const conf = assess(distinctSrc.map((p) => ({ source: p.source, domain: p.domain })));
    // Rank the event's countries by centrality: the countries the REPRESENTATIVE
    // (displayed) headline is actually about come first, then the rest by how many
    // reports in the cluster mention them. The primary dossier (countries[0]) then
    // matches the headline the analyst sees — instead of whatever country the newest
    // report happened to list first, which was sending a US impeachment story to
    // Yemen's dossier.
    const ranked = [...new Set([...c.repIsos, ...[...c.isoCount.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])])];
    const iso = ranked[0];
    const country = iso ? countryByIso(iso) : null;
    const ageH = (now - (c.last || now)) / 3.6e6;
    const recency = Math.max(0, 3 - ageH / 8);
    const sev = severityOf(c.rep.title);
    // priority ranks what an analyst sees first: confidence + severity + breadth + recency
    const priority = Math.round((conf.score * 0.5 + sev * 12 + conf.distinctSources * 6 + recency * 4) * 10) / 10;
    return {
      id: 'ev:' + (c.rep.url || i),
      title: c.rep.title,
      url: c.rep.url,
      lead: c.rep.source,
      countries: ranked.slice(0, 5),
      lat: country ? country.lat : null,
      lon: country ? country.lon : null,
      place: country ? country.name : null,
      severity: sev,
      firstSeen: c.first,
      lastSeen: c.last,
      confidence: conf,
      sourceCount: conf.distinctSources,
      sources: distinctSrc.map((p) => p.source),
      provenance,
      priority,
    };
  })
  .sort((a, b) => b.priority - a.priority);

  const confirmed = events.filter((e) => e.confidence.level === 'CONFIRMED').length;
  return { generatedAt: new Date().toISOString(), count: events.length, confirmed, events };
}
