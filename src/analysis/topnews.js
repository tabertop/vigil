// Top News aggregator — clusters the multi-source wire into distinct stories and
// ranks them by importance. A story covered by many outlets is more important
// than one covered by a single feed (breadth = corroboration), so the headline
// score leans on distinct-source count, then recency, then severity.
//
// Zero-dependency: clustering is greedy token/entity overlap over short headlines.

import { tagCountries } from '../data/countries.js';

const STOP = new Set(
  ('the a an and or but of to in on for with from by at as is are was were be been being this that these those it its his her their our your my we you they he she them him us not no yes will would could should can may might must have has had do does did over under after before into out about more most other some such than then them there here what when where which who whom whose why how all any both each few nor own same so too very just also into amid says say said report reports news world after over first years year people government against during between'
    .split(' ')
  )
);
// severity keywords bubble hard-news above soft stories
const SEVERITY = ['strike', 'airstrike', 'killed', 'dead', 'attack', 'war', 'missile', 'shelling', 'clashes', 'offensive', 'coup', 'sanction', 'nuclear', 'invasion', 'troops', 'militant', 'explosion', 'assault', 'ceasefire', 'hostage', 'genocide', 'massacre', 'displaced', 'famine', 'crisis', 'protest', 'earthquake'];

function tokens(title) {
  const words = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\- ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOP.has(w));
  return new Set(words);
}
// tokens distinctive enough to anchor a cluster (rare-ish: length ≥ 6 or a country)
function strong(tok, isos) {
  const s = new Set(isos);
  for (const w of tok) if (w.length >= 6) s.add(w);
  return s;
}

function overlap(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

function severityOf(title) {
  const low = ' ' + String(title).toLowerCase() + ' ';
  let s = 0;
  for (const k of SEVERITY) if (low.includes(k)) s++;
  return Math.min(3, s);
}

export function buildTopNews(wire = [], now = Date.now()) {
  // newest first so each cluster's representative is the freshest headline
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
      // cluster if they share ≥2 significant tokens AND ≥1 distinctive/entity token
      if (overlap(it.tok, c.tok) >= 2 && overlap(it.strong, c.strong) >= 1) { best = c; break; }
    }
    if (best) {
      best.members.push(it.r);
      best.sources.add(it.r.source);
      it.tok.forEach((t) => best.tok.add(t));
      it.strong.forEach((t) => best.strong.add(t));
      it.isos.forEach((i) => best.isos.add(i));
    } else {
      clusters.push({ rep: it.r, members: [it.r], sources: new Set([it.r.source]), tok: new Set(it.tok), strong: new Set(it.strong), isos: new Set(it.isos) });
    }
  }

  const stories = clusters
    .map((c) => {
      const ageH = (now - (c.rep.publishedAt || now)) / 3.6e6;
      const recency = Math.max(0, 3 - ageH / 8); // full for <0h, ~0 by 24h
      const sev = severityOf(c.rep.title);
      const score = c.sources.size * 3 + c.members.length + recency + sev;
      return {
        title: c.rep.title,
        url: c.rep.url,
        source: c.rep.source,
        domain: c.rep.domain,
        sources: [...c.sources],
        sourceCount: c.sources.size,
        articleCount: c.members.length,
        countries: [...c.isos].slice(0, 4),
        publishedAt: c.rep.publishedAt,
        severity: sev,
        score: Math.round(score * 10) / 10,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);

  return { generatedAt: new Date().toISOString(), count: stories.length, stories };
}
