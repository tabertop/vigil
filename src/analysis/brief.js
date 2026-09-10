// Intelligence Brief — a structured, continuously-updated global/regional briefing.
// Deterministically selects the top developments for a region from the world-state
// (corroborated fused events + active warnings), then — when the AI layer is on —
// makes ONE cached LLM call per region to write WHAT / WHY / WATCH grounded in the
// evidence. Cached per region (TTL) so we never call the model per request.
//
// Without a key it degrades to a deterministic brief (WHAT + confidence + sources).

import { countryFacts } from '../data/facts.js';
import { countryByIso } from '../data/countries.js';
import { callClaude, aiEnabled, aiModel } from '../llm.js';

const ME = new Set(['IL', 'IR', 'SA', 'YE', 'IQ', 'SY', 'LB', 'JO', 'AE', 'QA', 'KW', 'BH', 'OM', 'PS', 'TR', 'EG']);
export const REGIONS = ['global', 'north-america', 'europe', 'middle-east', 'asia-pacific', 'africa', 'latin-america'];
const REGION_LABEL = { global: 'Global', 'north-america': 'North America', europe: 'Europe', 'middle-east': 'Middle East', 'asia-pacific': 'Asia-Pacific', africa: 'Africa', 'latin-america': 'Latin America' };

function regionOf(iso) {
  if (ME.has(iso)) return 'middle-east';
  const f = countryFacts(iso) || {}; const c = f.continent;
  if (c === 'Europe') return 'europe';
  if (c === 'Africa') return 'africa';
  if (c === 'Asia' || c === 'Oceania') return 'asia-pacific';
  if (c === 'South America') return 'latin-america';
  if (c === 'North America') return ['US', 'CA'].includes(iso) ? 'north-america' : 'latin-america';
  return 'other';
}
const inRegion = (isos, region) => region === 'global' || (isos || []).some((i) => regionOf(i) === region);
const WARN_REGION = { 'Middle East': 'middle-east', Europe: 'europe', 'Indo-Pacific': 'asia-pacific', Africa: 'africa', Maritime: 'global' };

const cache = new Map(); // region -> { at, brief }
const TTL_MS = 18 * 60 * 1000;

export async function buildBrief(region, { state } = {}) {
  region = REGIONS.includes(region) ? region : 'global';
  const hit = cache.get(region);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.brief;

  // ---- deterministic candidate selection ----
  const events = (state.fusion?.events || []).filter((e) => inRegion(e.countries, region));
  const warns = (state.warnings?.scenarios || []).filter((s) => s.rank >= 2 && (region === 'global' || WARN_REGION[s.region] === region));
  const candidates = [];
  for (const s of warns.slice(0, 4)) candidates.push({ kind: 'warning', title: s.name, detail: `${s.level} · ${s.tripped}/${s.total} indicators · ${s.probability}%`, indicators: s.indicators.filter((i) => i.tripped).map((i) => i.label), sources: [] });
  for (const e of events.slice(0, 8)) candidates.push({ kind: 'event', title: e.title, detail: `${e.confidence.level} ${e.confidence.score}% · ${e.sourceCount} sources`, confidence: e.confidence.level, sources: (e.provenance || []).slice(0, 4).map((p) => ({ source: p.source, grade: p.grade, url: p.url })) });
  const top = candidates.slice(0, 6);

  const risk = state.threat ? { level: state.threat.label, score: state.threat.score, threatcon: state.threat.level } : null;

  let brief;
  if (aiEnabled() && top.length) {
    brief = await aiBrief(region, risk, top, state);
  } else {
    brief = deterministicBrief(region, risk, top);
  }
  cache.set(region, { at: Date.now(), brief });
  return brief;
}

function deterministicBrief(region, risk, top) {
  return {
    region, regionLabel: REGION_LABEL[region], generatedAt: new Date().toISOString(), ai: false,
    globalRisk: risk,
    items: top.map((c) => ({ what: c.title, why: null, confidence: c.confidence || (c.kind === 'warning' ? c.detail : 'REPORTED'), watch: null, detail: c.detail, sources: c.sources || [] })),
  };
}

async function aiBrief(region, risk, top, state) {
  const ctx = top.map((c, i) => `${i + 1}. [${c.kind}] ${c.title}\n   detail: ${c.detail}${c.indicators ? '\n   indicators: ' + c.indicators.join('; ') : ''}${c.sources && c.sources.length ? '\n   sources: ' + c.sources.map((s) => s.source + '(' + s.grade + ')').join(', ') : ''}`).join('\n');
  const system = `You are VIGIL, an OSINT analyst writing a ${REGION_LABEL[region]} intelligence brief. For EACH numbered development, ground your writing ONLY in the provided detail/sources — do not invent facts, numbers, or sources. Return STRICT JSON only (no prose, no markdown fences): {"items":[{"n":1,"why":"one sentence on why it matters","watch":"one sentence on what to watch next","confidence":"HIGH|MODERATE|LOW"}]}. Keep why/watch concise and decision-useful. Use estimative language. Confidence reflects source corroboration.`;
  const user = `DEVELOPMENTS:\n${ctx}\n\nReturn JSON with why/watch/confidence for each n (1..${top.length}).`;
  const r = await callClaude({ system, user, maxTokens: 900 });
  let parsed = null;
  if (r.ok) { try { const m = r.text.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : r.text); } catch { parsed = null; } }
  const byN = {}; if (parsed && Array.isArray(parsed.items)) for (const it of parsed.items) byN[it.n] = it;
  return {
    region, regionLabel: REGION_LABEL[region], generatedAt: new Date().toISOString(), ai: !!parsed,
    globalRisk: risk,
    items: top.map((c, i) => { const a = byN[i + 1] || {}; return { what: c.title, why: a.why || null, watch: a.watch || null, confidence: a.confidence || c.confidence || 'MODERATE', detail: c.detail, sources: c.sources || [] }; }),
  };
}
