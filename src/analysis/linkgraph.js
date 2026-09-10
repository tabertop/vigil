// Entity Link Graph — the signature "Gotham" object/link view.
// Mines the live multi-source wire for entities (countries + named actors:
// states-in-conflict, non-state armed groups, and key blocs/orgs) and connects
// any two that co-occur in the same report. The result is a co-occurrence
// network: nodes weighted by how often they're reported, edges weighted by how
// many independent articles link the pair. Everything is derived from data
// already in the store — deterministic and explainable (each edge keeps its
// evidence). The frontend renders it as a force-directed graph you can pivot on.

import { tagCountries, countryByIso } from '../data/countries.js';

// Curated actor gazetteer. Countries come from the country tagger; this adds the
// non-state / supranational entities that drive instability but aren't nations.
// kind: nsag = non-state armed group · org = bloc/institution.
const ACTORS = [
  { id: 'hamas', label: 'Hamas', kind: 'nsag', kw: ['hamas'] },
  { id: 'hezbollah', label: 'Hezbollah', kind: 'nsag', kw: ['hezbollah', 'hizbollah', 'hizbullah'] },
  { id: 'houthis', label: 'Houthis', kind: 'nsag', kw: ['houthi', 'houthis', 'ansar allah'] },
  { id: 'isis', label: 'Islamic State', kind: 'nsag', kw: ['isis', 'isil', 'islamic state', 'daesh', 'iskp', 'is-k', 'islamic state khorasan'] },
  { id: 'alqaeda', label: 'Al-Qaeda', kind: 'nsag', kw: ['al-qaeda', 'al qaeda', 'aqap', 'aqim'] },
  { id: 'alshabaab', label: 'Al-Shabaab', kind: 'nsag', kw: ['al-shabaab', 'al shabaab', 'al-shabab', 'shabaab'] },
  { id: 'bokoharam', label: 'Boko Haram', kind: 'nsag', kw: ['boko haram', 'iswap'] },
  { id: 'taliban', label: 'Taliban', kind: 'nsag', kw: ['taliban'] },
  { id: 'rsf', label: 'Rapid Support Forces', kind: 'nsag', kw: ['rapid support forces', ' rsf ', ' rsf.', ' rsf,'] },
  { id: 'm23', label: 'M23', kind: 'nsag', kw: [' m23 ', ' m23.', ' m23,', 'm23 rebels'] },
  { id: 'wagner', label: 'Wagner Group', kind: 'nsag', kw: ['wagner group', 'wagner mercenar', 'africa corps'] },
  { id: 'pkk', label: 'PKK', kind: 'nsag', kw: [' pkk ', ' pkk.', ' pkk,', 'kurdistan workers'] },
  { id: 'hts', label: 'Hayat Tahrir al-Sham', kind: 'nsag', kw: ['hayat tahrir', ' hts ', 'tahrir al-sham'] },
  { id: 'pij', label: 'Islamic Jihad', kind: 'nsag', kw: ['islamic jihad'] },
  { id: 'jnim', label: 'JNIM', kind: 'nsag', kw: [' jnim ', 'jama\'at nasr', 'nusrat al-islam'] },
  { id: 'iswap', label: 'ISWAP', kind: 'nsag', kw: ['iswap', 'islamic state west africa', 'islamic state in west africa'] },
  { id: 'ttp', label: 'Pakistani Taliban (TTP)', kind: 'nsag', kw: [' ttp ', ' ttp.', ' ttp,', 'tehrik-i-taliban', 'tehreek-e-taliban', 'pakistani taliban'] },
  { id: 'let', label: 'Lashkar-e-Taiba', kind: 'nsag', kw: ['lashkar-e-taiba', 'lashkar-e-tayyiba', ' lashkar'] },
  { id: 'jem', label: 'Jaish-e-Mohammed', kind: 'nsag', kw: ['jaish-e-mohammed', 'jaish-e-muhammad', 'jaish-e-mohammad'] },
  { id: 'kataib', label: 'Kataib Hezbollah / PMF', kind: 'nsag', kw: ['kataib hezbollah', "kata'ib hezbollah", 'popular mobilization', 'nujaba', 'iraqi militia'] },
  { id: 'sdf', label: 'Syrian Democratic Forces', kind: 'nsag', kw: ['syrian democratic forces', ' sdf ', ' sdf.', ' sdf,', ' ypg'] },
  { id: 'lra', label: "Lord's Resistance Army", kind: 'nsag', kw: ["lord's resistance army", ' lra '] },
  { id: 'adf', label: 'ADF (Allied Democratic Forces)', kind: 'nsag', kw: ['allied democratic forces', ' adf ', ' adf.'] },
  { id: 'farc', label: 'FARC dissidents', kind: 'nsag', kw: [' farc', 'farc dissident'] },
  { id: 'eln', label: 'ELN', kind: 'nsag', kw: [' eln ', ' eln.', ' eln,', 'ejercito de liberacion'] },
  { id: 'cjng', label: 'CJNG (Jalisco Cartel)', kind: 'nsag', kw: ['cjng', 'jalisco new generation', 'jalisco cartel'] },
  { id: 'sinaloa', label: 'Sinaloa Cartel', kind: 'nsag', kw: ['sinaloa cartel', 'sinaloa'] },
  { id: 'polisario', label: 'Polisario Front', kind: 'nsag', kw: ['polisario'] },
  { id: 'nato', label: 'NATO', kind: 'org', kw: ['nato'] },
  { id: 'un', label: 'United Nations', kind: 'org', kw: ['united nations', ' u.n.', 'security council', 'peacekeep'] },
  { id: 'eu', label: 'European Union', kind: 'org', kw: ['european union', ' e.u.', 'brussels'] },
  { id: 'au', label: 'African Union', kind: 'org', kw: ['african union'] },
  { id: 'arableague', label: 'Arab League', kind: 'org', kw: ['arab league'] },
  { id: 'iaea', label: 'IAEA', kind: 'org', kw: ['iaea', 'atomic energy agency'] },
  { id: 'icc', label: 'ICC', kind: 'org', kw: ['international criminal court', ' icc '] },
];

function actorsIn(hay) {
  const out = [];
  for (const a of ACTORS) if (a.kw.some((k) => hay.includes(k))) out.push(a);
  return out;
}

// Build the co-occurrence graph from a (windowed) wire.
export function computeLinkGraph(wire = [], { minEdge = 1, maxNodes = 60, keepTopSolo = 22 } = {}) {
  const nodes = new Map(); // id -> node
  const edges = new Map(); // "a|b" -> { a, b, weight, evidence[] }

  const bump = (id, label, kind, iso) => {
    const n = nodes.get(id) || { id, label, kind, iso: iso || null, weight: 0 };
    n.weight += 1;
    nodes.set(id, n);
  };
  const link = (a, b, art) => {
    if (a === b) return;
    const key = a < b ? a + '|' + b : b + '|' + a;
    const e = edges.get(key) || { a: key.split('|')[0], b: key.split('|')[1], weight: 0, evidence: [] };
    e.weight += 1;
    if (e.evidence.length < 3 && art) e.evidence.push({ title: art.title, url: art.url, source: art.source });
    edges.set(key, e);
  };

  for (const r of wire) {
    const hay = ' ' + String(r.title || '').toLowerCase() + ' ' + String(r.country || '').toLowerCase() + ' ';
    // country entities
    const isos = r.countries && r.countries.length
      ? r.countries
      : tagCountries(r.title + ' ' + (r.country || '')).map((t) => t.country.iso);
    const cset = [...new Set(isos)].slice(0, 6);
    // actor entities
    const acts = actorsIn(hay);

    const ents = [];
    for (const iso of cset) {
      const c = countryByIso(iso);
      if (!c) continue;
      const id = 'C:' + iso;
      bump(id, c.name, 'country', iso);
      ents.push(id);
    }
    for (const a of acts) {
      const id = 'A:' + a.id;
      bump(id, a.label, a.kind, null);
      ents.push(id);
    }
    // connect every co-occurring pair in this article
    for (let i = 0; i < ents.length; i++)
      for (let j = i + 1; j < ents.length; j++) link(ents[i], ents[j], r);
  }

  // keep any co-occurrence (minEdge=1), strongest first
  let edgeList = [...edges.values()].filter((e) => e.weight >= minEdge).sort((a, b) => b.weight - a.weight);
  // rank nodes by weight, keep top maxNodes
  const ranked = [...nodes.values()].sort((a, b) => b.weight - a.weight);
  let nodeList = ranked.slice(0, maxNodes);
  const keep = new Set(nodeList.map((n) => n.id));
  edgeList = edgeList.filter((e) => keep.has(e.a) && keep.has(e.b));
  // Keep a node if it has a surviving link OR it's one of the most-reported entities
  // overall — so heavily-covered single-country stories still appear (as standalone
  // nodes) instead of vanishing, while weak unlinked noise is dropped.
  const connected = new Set();
  edgeList.forEach((e) => { connected.add(e.a); connected.add(e.b); });
  const topSolo = new Set(ranked.slice(0, keepTopSolo).map((n) => n.id));
  nodeList = nodeList.filter((n) => connected.has(n.id) || topSolo.has(n.id));

  return {
    generatedAt: new Date().toISOString(),
    counts: { nodes: nodeList.length, edges: edgeList.length, articles: wire.length },
    nodes: nodeList,
    edges: edgeList,
  };
}
