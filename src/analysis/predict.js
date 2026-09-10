// Predictive Assessment ("what happens next") — the forward-looking fusion layer.
// It does NOT claim to know the future; it synthesizes every forward signal VIGIL
// already computes — I&W tripwires, the escalation forecast, cross-domain
// convergence, anomalies and momentum — into a ranked set of predicted near-term
// developments, each with an estimative probability, a timeframe, its drivers, and
// the exact signals it rests on (so an analyst can audit the call, not just trust it).
//
// This is layer 1 (deterministic, always on). Layer 2 (src/analysis/ai.js) narrates
// this same picture with an LLM when ANTHROPIC_API_KEY is set.

import { estimative } from './estimative.js';

export function computePredictions({ index = { countries: [] }, warnings, forecast, correlation } = {}) {
  const nameOf = (iso) => (index.countries.find((c) => c.iso === iso) || {}).name || iso;
  const preds = [];

  // 1) Scenario escalation — from the I&W tripwire board
  for (const s of warnings?.scenarios || []) {
    if (s.rank < 2) continue; // WATCH and above
    preds.push({
      kind: 'scenario', subject: s.name, region: s.region,
      prediction: `${s.name}: ${s.tripped}/${s.total} warning indicators active — escalation ${estimative(s.probability)}`,
      probability: s.probability, timeframe: 'days–weeks',
      confidence: s.tripped >= 4 ? 'high' : s.tripped >= 2 ? 'moderate' : 'low',
      drivers: s.indicators.filter((i) => i.tripped).map((i) => i.label).slice(0, 4),
      basis: ['I&W tripwires'],
    });
  }

  // 2) Country escalation — from the forecast momentum/probability
  for (const f of forecast?.escalating || []) {
    if (!(f.probEscalation >= 30 || f.momentumPerDay >= 2)) continue;
    const name = nameOf(f.iso);
    const prob = f.probEscalation || Math.min(90, Math.round((f.momentumPerDay || 0) * 10));
    preds.push({
      kind: 'country', subject: name, iso: f.iso,
      prediction: `${name} likely to intensify — projected ${f.projection}/100 (${f.projectedTier}) within 72h; tier escalation ${estimative(f.probEscalation)}`,
      probability: prob, timeframe: '72h',
      confidence: (f.confidence || 'moderate').toLowerCase(),
      drivers: [`momentum ${f.momentumPerDay > 0 ? '+' : ''}${f.momentumPerDay}/day`, f.anomalyZ >= 2 ? `anomaly ${f.anomalyZ}σ vs baseline` : null].filter(Boolean),
      basis: ['index trend history'],
    });
  }

  // 3) Compounding crisis — from the convergence engine
  for (const a of correlation?.alerts || []) {
    if (a.domainCount < 3) continue;
    preds.push({
      kind: 'convergence', subject: a.name, iso: a.iso,
      prediction: `${a.name}: ${a.domainCount} threat domains converging (${a.domains.map((d) => d.label).join(', ')}) — elevated risk of cascading failure`,
      probability: a.convergence, timeframe: 'near-term', confidence: 'moderate',
      drivers: a.domains.map((d) => d.label), basis: ['correlation engine'],
    });
  }

  // merge duplicates on the same subject (keep the strongest), then rank
  const bySubject = new Map();
  for (const p of preds) {
    const k = p.subject;
    if (!bySubject.has(k) || bySubject.get(k).probability < p.probability) bySubject.set(k, p);
    else { const e = bySubject.get(k); e.basis = [...new Set([...e.basis, ...p.basis])]; }
  }
  const ranked = [...bySubject.values()].sort((a, b) => b.probability - a.probability);
  ranked.forEach((p) => { p.assessment = estimative(p.probability); });

  return { generatedAt: new Date().toISOString(), method: 'deterministic signal fusion', count: ranked.length, predictions: ranked.slice(0, 24) };
}
