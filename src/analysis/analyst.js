// VIGIL AI Analyst — a retrieval-grounded OSINT analyst.
// It does NOT forward the question to a generic LLM. It FIRST retrieves the
// relevant slice of VIGIL's own live data (threat level, warnings, convergence,
// predictions, country dossiers, and topic-matched wire) deterministically, then
// hands the model a small, cited context and strict grounding rules. Every claim
// is traceable to evidence; the model is told to label VERIFIED / REPORTED /
// INFERENCE / LEAD and never to invent.

import { tagCountries } from '../data/countries.js';
import { buildDossier } from './dossier.js';
import { sourceGrade } from '../data/sources.js';
import { callClaude, aiEnabled, aiModel } from '../llm.js';

const STOP = new Set('what whats where when why how which who is are the a an of in on for to and or with from about right now today happening going over last next these those there here into more most other some such than then them will would could should can may might must have has had does did between during against tell show give me my our your'.split(' '));

function parseHours(q) {
  const m = q.match(/last\s+(\d+)\s*(hour|hr|day|week)/);
  if (m) { const n = +m[1]; return m[2].startsWith('day') ? n * 24 : m[2].startsWith('week') ? n * 168 : n; }
  if (/today|last 24|past day/.test(q)) return 24;
  if (/this week|past week/.test(q)) return 168;
  return null;
}
const ago = (ts) => { if (!ts) return '?'; const h = (Date.now() - ts) / 3.6e6; return h < 1 ? Math.round(h * 60) + 'm' : h < 48 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd'; };
const line = (a) => `- [${sourceGrade(a.source, a.domain)}] "${(a.title || '').slice(0, 140)}" (${a.source || a.domain || '?'}, ${ago(a.publishedAt)} ago)`;

// Deterministic retrieval — returns a compact context string + a structured
// evidence list (for the UI citation chips).
export function retrieveContext(question, { state, wire = [], events = [] }) {
  const q = String(question || '').toLowerCase();
  const hours = parseHours(q);
  const sinceTs = hours ? Date.now() - hours * 3.6e6 : 0;
  const inWindow = (a) => !sinceTs || (a.publishedAt || 0) >= sinceTs;

  const evidence = [];
  const addEv = (a) => { if (a && a.url && !evidence.some((e) => e.url === a.url)) evidence.push({ source: a.source, domain: a.domain, grade: sourceGrade(a.source, a.domain), title: a.title, url: a.url, publishedAt: a.publishedAt }); };

  const parts = [];
  const t = state.threat || {};
  parts.push(`GLOBAL THREAT LEVEL: ${t.label || '?'} (${t.score ?? '?'}/100, THREATCON ${t.level ?? '?'}/5) — ${t.headline || ''}`);

  const scen = (state.warnings?.scenarios || []).filter((s) => s.rank >= 2).slice(0, 5);
  if (scen.length) parts.push('\nACTIVE WARNING SCENARIOS:\n' + scen.map((s) => `- ${s.name} [${s.level}, ${s.probability}%]: ${s.tripped}/${s.total} indicators (${s.indicators.filter((i) => i.tripped).map((i) => i.label).join('; ') || 'none'})`).join('\n'));

  const conv = (state.correlation?.alerts || []).slice(0, 4);
  if (conv.length) parts.push('\nCROSS-DOMAIN CONVERGENCE:\n' + conv.map((a) => `- ${a.name}: ${a.domainCount} domains (${a.domains.map((d) => d.label).join(', ')})`).join('\n'));

  const preds = (state.predictions?.predictions || []).slice(0, 5);
  if (preds.length) parts.push('\nPREDICTED DEVELOPMENTS (deterministic signal fusion):\n' + preds.map((p) => `- [${p.probability}%] ${p.prediction}`).join('\n'));

  // country focus (up to 3 tagged) — build a grounded mini-dossier for each
  const tagged = tagCountries(question).slice(0, 3);
  for (const { country } of tagged) {
    const d = buildDossier({ iso: country.iso }, { events, wire, index: state.index });
    const f = state.forecast?.byIso?.[country.iso];
    parts.push(`\nCOUNTRY FOCUS: ${d.name}\nInstability ${d.score}/100 (${d.tier}). ${f ? `Momentum ${f.momentumPerDay}/day (${f.direction}); 72h projection ${f.projection} (${f.projectedTier}); escalation risk ${f.probEscalation}%. ` : ''}Assessment: ${d.assessment}\nDrivers: ${(d.drivers || []).map((x) => x.label).join(', ') || 'n/a'}. Confidence: ${d.confidence?.level}.` +
      (d.articles?.length ? '\nRecent reports:\n' + d.articles.slice(0, 6).filter(inWindow).map((a) => { addEv(a); return line(a); }).join('\n') : ''));
  }

  // topic-matched wire (question tokens) — fills non-country questions (oil, cyber…)
  const toks = q.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
  if (toks.length) {
    const hits = wire.filter(inWindow).filter((a) => { const s = ' ' + (a.title || '').toLowerCase() + ' '; return toks.some((k) => s.includes(k)); }).slice(0, 8);
    if (hits.length) { hits.forEach(addEv); parts.push('\nRELEVANT REPORTING:\n' + hits.map(line).join('\n')); }
  }

  // notable corroborated events (always include a few high-confidence ones)
  const ev = (state.fusion?.events || []).filter((e) => e.confidence?.level !== 'SINGLE-SOURCE').slice(0, 5);
  if (ev.length) parts.push('\nNOTABLE CORROBORATED EVENTS:\n' + ev.map((e) => `- [${e.confidence.level} ${e.confidence.score}%] "${(e.title || '').slice(0, 130)}" (${e.sourceCount} sources)`).join('\n'));

  return { text: parts.join('\n'), evidence, focus: tagged.map((x) => x.country.name), hours };
}

const SYSTEM = `You are VIGIL, an open-source intelligence (OSINT) analyst. Answer the user's question using ONLY the CONTEXT provided, which is drawn from VIGIL's live data (news wire, geolocated events, instability index, warnings, forecasts).

RULES:
- Ground every factual statement in the context. Do NOT use outside knowledge or invent events, numbers, dates, names, casualty figures, or sources.
- Label claims with tags: [VERIFIED] corroborated by multiple graded sources; [REPORTED] a single or low-grade source claim; [INFERENCE] your analytical reasoning from the indicators; [LEAD] unconfirmed but worth watching.
- Use ICD-203 estimative language (unlikely / roughly even chance / likely / very likely / almost certain) with a % when giving probabilities.
- Cite sources inline by outlet name when stating reported facts.
- If the context does not contain the answer, say so plainly. Never fill gaps with speculation presented as fact.
- Be concise and decision-useful: lead with the bottom line, then key points.
- Remember this is OSINT — reporting of varying reliability, not official confirmation.`;

export async function askAnalyst(question, ctx) {
  if (!aiEnabled()) return { ok: false, error: 'no_key', note: 'The AI analyst is offline. Set ANTHROPIC_API_KEY in .env to enable it.', evidence: ctx.evidence };
  const user = `QUESTION: ${question}\n\nCONTEXT (VIGIL live data${ctx.hours ? `, last ${ctx.hours}h` : ''}):\n${ctx.text}`;
  const r = await callClaude({ system: SYSTEM, user, maxTokens: 1100 });
  if (!r.ok) return { ok: false, error: r.error, detail: r.detail, note: r.note, evidence: ctx.evidence };
  return { ok: true, answer: r.text, evidence: ctx.evidence, focus: ctx.focus, generatedAt: new Date().toISOString() };
}
