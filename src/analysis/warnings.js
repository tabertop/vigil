// Indicators & Warnings (I&W) engine — the classic warning-intelligence construct.
// Named crisis scenarios, each decomposed into concrete, observable indicators.
// Every ingest cycle each indicator is tested against the live fused data; the
// share of tripped indicators drives the scenario's warning level and estimative
// language. This turns VIGIL's raw signals into "what are we watching for, and how
// close is it," which is what a watch officer actually needs.
//
// Deterministic and explainable: each indicator reports whether it tripped and why.

import { estimative } from './estimative.js';

// ---- helpers over the live context (index/events/wire/correlation/forecast/aircraft) ----
function score(ctx, iso) { const c = (ctx.index?.countries || []).find((x) => x.iso === iso); return c ? c.score : 0; }
function wireHits(ctx, kws, isos) {
  const K = kws.map((k) => k.toLowerCase());
  let n = 0; const ex = [];
  for (const r of ctx.wire || []) {
    const t = ' ' + String(r.title || '').toLowerCase() + ' ';
    if (!K.some((k) => t.includes(k))) continue;
    if (isos && isos.length) { const rc = r.countries || []; if (!isos.some((i) => rc.includes(i))) continue; }
    n++; if (ex.length < 2) ex.push(r.title);
  }
  return { n, ex };
}
function aircraftNear(ctx, box) { // box=[latMin,latMax,lonMin,lonMax]
  return (ctx.aircraft || []).filter((a) => a.lat >= box[0] && a.lat <= box[1] && a.lon >= box[2] && a.lon <= box[3]);
}
function convergence(ctx, iso) { const a = (ctx.correlation?.alerts || []).find((x) => x.iso === iso); return a ? a.domainCount : 0; }
function forecastRising(ctx, iso) { const f = ctx.forecast?.byIso?.[iso]; return f ? f.probEscalation : 0; }

// indicator constructor: test → { tripped, detail }
const ind = (label, test) => ({ label, test });

const SCENARIOS = [
  {
    id: 'taiwan', name: 'Taiwan Strait Crisis', region: 'Indo-Pacific',
    indicators: [
      ind('PLA activity / incursion reporting', (c) => { const h = wireHits(c, ['taiwan strait', 'pla', 'incursion', 'median line', 'air defense zone', 'adiz', 'chinese military'], ['TW', 'CN']); return { tripped: h.n >= 2, detail: `${h.n} reports${h.ex[0] ? ' · ' + h.ex[0] : ''}` }; }),
      ind('China instability elevated', (c) => { const s = score(c, 'CN'); return { tripped: s >= 50, detail: `China index ${s}` }; }),
      ind('Taiwan in conflict reporting', (c) => { const h = wireHits(c, ['taiwan', 'taipei'], ['TW']); return { tripped: h.n >= 3, detail: `${h.n} Taiwan reports` }; }),
      ind('Blockade / invasion language', (c) => { const h = wireHits(c, ['blockade', 'invasion', 'quarantine', 'reunification by force', 'seize taiwan']); return { tripped: h.n >= 1, detail: h.ex[0] || 'none' }; }),
      ind('US carrier / military signaling', (c) => { const h = wireHits(c, ['carrier', 'seventh fleet', 'us military', 'arms sale', 'deterrence'], ['TW', 'CN', 'US']); return { tripped: h.n >= 1, detail: `${h.n} reports` }; }),
    ],
  },
  {
    id: 'iran-israel', name: 'Iran–Israel Direct Escalation', region: 'Middle East',
    indicators: [
      ind('Both states elevated', (c) => { const a = score(c, 'IR'), b = score(c, 'IL'); return { tripped: a >= 50 && b >= 50, detail: `Iran ${a} · Israel ${b}` }; }),
      ind('Direct strike reporting', (c) => { const h = wireHits(c, ['strike', 'missile', 'drone', 'retaliation', 'airstrike', 'ballistic'], ['IR', 'IL']); return { tripped: h.n >= 2, detail: `${h.n} strike reports${h.ex[0] ? ' · ' + h.ex[0] : ''}` }; }),
      ind('Proxy activation (Hezbollah/Houthis)', (c) => { const h = wireHits(c, ['hezbollah', 'houthi', 'islamic jihad', 'axis of resistance']); return { tripped: h.n >= 1, detail: `${h.n} proxy reports` }; }),
      ind('Hormuz / tanker threat', (c) => { const h = wireHits(c, ['hormuz', 'tanker', 'irgc', 'strait', 'shipping']); return { tripped: h.n >= 1, detail: h.ex[0] || 'none' }; }),
      ind('Nuclear-program signaling', (c) => { const h = wireHits(c, ['enrichment', 'nuclear', 'iaea', 'uranium', 'natanz', 'fordow']); return { tripped: h.n >= 1, detail: `${h.n} reports` }; }),
    ],
  },
  {
    id: 'russia-nato', name: 'Russia–NATO Escalation', region: 'Europe',
    indicators: [
      ind('Russia instability elevated', (c) => { const s = score(c, 'RU'); return { tripped: s >= 55, detail: `Russia index ${s}` }; }),
      ind('NATO / alliance signaling', (c) => { const h = wireHits(c, ['nato', 'article 5', 'baltic', 'kaliningrad', 'finland', 'poland border']); return { tripped: h.n >= 2, detail: `${h.n} reports${h.ex[0] ? ' · ' + h.ex[0] : ''}` }; }),
      ind('Nuclear rhetoric', (c) => { const h = wireHits(c, ['nuclear', 'tactical nuke', 'putin warns', 'red line', 'doctrine']); return { tripped: h.n >= 1, detail: h.ex[0] || 'none' }; }),
      ind('Airspace / border incident', (c) => { const h = wireHits(c, ['airspace', 'drone', 'incursion', 'border', 'shot down', 'jet scrambled']); return { tripped: h.n >= 2, detail: `${h.n} reports` }; }),
      ind('Ukraine front escalation', (c) => { const s = score(c, 'UA'); const h = wireHits(c, ['offensive', 'missile', 'strike'], ['UA']); return { tripped: s >= 70 || h.n >= 3, detail: `Ukraine ${s} · ${h.n} strike reports` }; }),
    ],
  },
  {
    id: 'sahel', name: 'Sahel Coup Contagion', region: 'Africa',
    indicators: [
      ind('Coup / junta reporting', (c) => { const h = wireHits(c, ['coup', 'junta', 'military takeover', 'seized power', 'mutiny']); return { tripped: h.n >= 1, detail: h.ex[0] || 'none' }; }),
      ind('Multiple Sahel states active', (c) => { const isos = ['ML', 'BF', 'NE', 'TD', 'GN', 'SD']; const hot = isos.filter((i) => score(c, i) >= 40); return { tripped: hot.length >= 2, detail: `${hot.length} states elevated (${hot.join(',') || '—'})` }; }),
      ind('Jihadist activity (JNIM/ISWAP)', (c) => { const h = wireHits(c, ['jnim', 'iswap', 'islamic state', 'jihadist', 'militant', 'al-qaeda']); return { tripped: h.n >= 1, detail: `${h.n} reports` }; }),
      ind('Wagner / Africa Corps presence', (c) => { const h = wireHits(c, ['wagner', 'africa corps', 'mercenar']); return { tripped: h.n >= 1, detail: h.ex[0] || 'none' }; }),
      ind('External withdrawal / realignment', (c) => { const h = wireHits(c, ['france withdraw', 'us withdraw', 'expel', 'ecowas', 'sever ties']); return { tripped: h.n >= 1, detail: `${h.n} reports` }; }),
    ],
  },
  {
    id: 'red-sea', name: 'Red Sea Shipping Disruption', region: 'Maritime',
    indicators: [
      ind('Houthi attack reporting', (c) => { const h = wireHits(c, ['houthi', 'red sea', 'bab-el-mandeb', 'bab el-mandeb']); return { tripped: h.n >= 1, detail: h.ex[0] || 'none' }; }),
      ind('Vessel / tanker targeting', (c) => { const h = wireHits(c, ['tanker', 'vessel', 'cargo ship', 'merchant ship', 'hijack', 'seized ship']); return { tripped: h.n >= 1, detail: `${h.n} reports` }; }),
      ind('Naval response / coalition', (c) => { const h = wireHits(c, ['prosperity guardian', 'naval', 'warship', 'us navy', 'destroyer', 'coalition']); return { tripped: h.n >= 1, detail: `${h.n} reports` }; }),
      ind('Yemen elevated', (c) => { const s = score(c, 'YE'); return { tripped: s >= 45, detail: `Yemen index ${s}` }; }),
      ind('Shipping / insurance disruption', (c) => { const h = wireHits(c, ['reroute', 'cape of good hope', 'suez', 'insurance', 'freight rate', 'shipping cost']); return { tripped: h.n >= 1, detail: `${h.n} reports` }; }),
    ],
  },
  {
    id: 'sudan', name: 'Sudan Civil War Escalation', region: 'Africa',
    indicators: [
      ind('Sudan critical', (c) => { const s = score(c, 'SD'); return { tripped: s >= 60, detail: `Sudan index ${s}` }; }),
      ind('RSF / SAF combat reporting', (c) => { const h = wireHits(c, ['rsf', 'rapid support', 'saf', 'sudanese army', 'el fasher', 'khartoum']); return { tripped: h.n >= 2, detail: `${h.n} reports${h.ex[0] ? ' · ' + h.ex[0] : ''}` }; }),
      ind('Mass displacement / famine', (c) => { const h = wireHits(c, ['displace', 'famine', 'refugee', 'starv', 'humanitarian', 'idp']); return { tripped: h.n >= 1, detail: `${h.n} reports` }; }),
      ind('Atrocity / ethnic-violence reporting', (c) => { const h = wireHits(c, ['massacre', 'ethnic', 'atrocity', 'mass grave', 'darfur', 'genocide']); return { tripped: h.n >= 1, detail: h.ex[0] || 'none' }; }),
      ind('Regional spillover', (c) => { const isos = ['TD', 'SS', 'EG', 'ET', 'ER']; const hot = isos.filter((i) => score(c, i) >= 35); return { tripped: hot.length >= 1, detail: `${hot.length} neighbors elevated` }; }),
    ],
  },
];

function levelOf(frac) {
  if (frac >= 0.8) return { level: 'CRITICAL', rank: 4 };
  if (frac >= 0.55) return { level: 'WARNING', rank: 3 };
  if (frac >= 0.3) return { level: 'WATCH', rank: 2 };
  return { level: 'DORMANT', rank: 1 };
}

export function computeWarnings(ctx = {}) {
  const scenarios = SCENARIOS.map((s) => {
    const indicators = s.indicators.map((i) => { let r; try { r = i.test(ctx); } catch { r = { tripped: false, detail: '—' }; } return { label: i.label, tripped: !!r.tripped, detail: r.detail }; });
    const tripped = indicators.filter((i) => i.tripped).length;
    const frac = indicators.length ? tripped / indicators.length : 0;
    const { level, rank } = levelOf(frac);
    return {
      id: s.id, name: s.name, region: s.region,
      level, rank,
      tripped, total: indicators.length,
      probability: Math.round(frac * 100),
      assessment: estimative(frac),
      indicators,
    };
  }).sort((a, b) => b.rank - a.rank || b.probability - a.probability);

  return { generatedAt: new Date().toISOString(), count: scenarios.length, scenarios };
}
