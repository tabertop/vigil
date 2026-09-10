// Global Threat Level — the single headline number for the public.
// Blends the instability index (breadth + peak), the I&W warning board, and
// cross-domain convergence into one 0-100 score mapped to a 5-level THREATCON
// dial. Designed to be instantly legible to a layperson while staying grounded in
// the same signals the analyst views use.

const LEVELS = {
  1: { label: 'GUARDED', color: '#3fb950' },
  2: { label: 'ELEVATED', color: '#e8b53a' },
  3: { label: 'HIGH', color: '#ff8c42' },
  4: { label: 'SEVERE', color: '#e5484d' },
  5: { label: 'CRITICAL', color: '#ff2d2d' },
};

export function computeThreatLevel({ index = { countries: [] }, warnings, correlation } = {}) {
  const C = index.countries || [];
  const crit = C.filter((c) => c.tier === 'Critical').length;
  const top = C.slice(0, 10);
  const topMean = top.length ? top.reduce((s, c) => s + (c.score || 0), 0) / top.length : 0;
  const scen = warnings?.scenarios || [];
  const maxWarn = scen.length ? Math.max(...scen.map((s) => s.probability || 0)) : 0;
  const activeWarn = scen.filter((s) => s.rank >= 3).length;          // WARNING+ scenarios
  const convergences = (correlation?.alerts || []).filter((a) => a.domainCount >= 3).length;

  // 0-100 composite. The world ALWAYS has ~5-8 active conflicts, so a top-scores
  // average is always high and makes a poor global gauge — it would peg at CRITICAL
  // permanently. Instead we measure severity RELATIVE TO BASELINE: breadth of
  // critical states, the single hottest theatre, the top warning scenario, and
  // compounding crises. Normal-bad reads HIGH; CRITICAL is reserved for genuinely
  // exceptional global escalation.
  const peak = C[0] ? C[0].score : 0;
  const critW = Math.min(42, crit * 3.5);   // ~12 critical nations → maxed
  const peakW = peak * 0.18;                  // hottest single country: 100 → 18
  const warnW = maxWarn * 0.20;               // top scenario probability: 100 → 20
  const convW = Math.min(16, convergences * 4);
  const score = Math.round(Math.max(0, Math.min(100, critW + peakW + warnW + convW)));
  const level = score >= 82 ? 5 : score >= 66 ? 4 : score >= 48 ? 3 : score >= 30 ? 2 : 1;

  const topScen = scen[0];
  return {
    score, level,
    label: LEVELS[level].label,
    color: LEVELS[level].color,
    headline: `${crit} ${crit === 1 ? 'nation' : 'nations'} at critical · ${activeWarn} active warning${activeWarn === 1 ? '' : 's'}`,
    drivers: {
      criticalCountries: crit,
      topCountry: C[0] ? C[0].name : null,
      topCountryScore: C[0] ? C[0].score : null,
      topScenario: topScen ? topScen.name : null,
      topScenarioLevel: topScen ? topScen.level : null,
      convergences,
    },
    generatedAt: new Date().toISOString(),
  };
}
