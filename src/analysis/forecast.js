// Escalation Forecasting & Anomaly Detection.
// The index tells you a level; a decision-maker needs to know where it's *going*.
// From the persisted index history this computes, per country:
//   • momentum   — least-squares slope of recent scores (points/day)
//   • projection — score projected `horizonH` hours ahead, clamped 0..100
//   • probEscalation — calibrated 0..1 chance the country crosses into a higher
//                      tier within the horizon, from slope, volatility & headroom
//   • anomaly    — z-score of the latest point vs its own recent baseline (a spike
//                  the country doesn't usually run at)
//   • confidence — how much history backs the call (few points → LOW)
// Pure function over the history array; no external calls.

function linreg(ys) {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i]; }
  const d = n * sxx - sx * sx || 1;
  const slope = (n * sxy - sx * sy) / d;
  return { slope, intercept: (sy - slope * sx) / n };
}
function std(ys) { const m = ys.reduce((a, b) => a + b, 0) / ys.length; return Math.sqrt(ys.reduce((a, b) => a + (b - m) * (b - m), 0) / ys.length); }
function tierOf(s) { return s >= 75 ? 'Critical' : s >= 50 ? 'Severe' : s >= 25 ? 'Elevated' : 'Watch'; }
const NEXT_BAND = [25, 50, 75]; // tier thresholds

export function computeForecast(history = [], { horizonH = 72 } = {}) {
  if (history.length < 2) return { generatedAt: new Date().toISOString(), horizonH, byIso: {}, escalating: [], anomalies: [], note: 'insufficient history — forecasts populate as snapshots accrue' };

  const times = history.map((s) => Date.parse(s.at) || 0);
  const now = times[times.length - 1];
  const stepH = Math.max(0.25, ((now - times[0]) / 3.6e6) / (history.length - 1)); // avg hours between snapshots
  const stepsAhead = horizonH / stepH;

  // gather per-iso series (align to latest snapshot's countries)
  const isos = new Set();
  history.forEach((s) => (s.countries || []).forEach((c) => isos.add(c.iso)));

  const byIso = {}, escalating = [], anomalies = [];
  for (const iso of isos) {
    const series = history.map((s) => { const c = (s.countries || []).find((x) => x.iso === iso); return c ? c.score : null; }).filter((v) => v != null);
    if (series.length < 2) continue;
    const recent = series.slice(-12);
    let { slope } = linreg(recent);              // per-snapshot slope
    // Robustness: index history can contain structural breaks (e.g. when the
    // gazetteer expands and a country jumps 0→scored in one step). Clamp the slope
    // so a single discontinuity can't manufacture a "Switzerland → Critical"
    // projection. A real country score moves at most a few points per hour.
    const maxPerStep = 6; // points/snapshot
    slope = Math.max(-maxPerStep, Math.min(maxPerStep, slope));
    const perDay = Math.max(-40, Math.min(40, Math.round(slope * (24 / stepH) * 10) / 10));
    const cur = series[series.length - 1];
    // clamp the projected move too (belt-and-suspenders against spikes)
    const move = Math.max(-35, Math.min(35, slope * stepsAhead));
    let projection = Math.max(0, Math.min(100, Math.round(cur + move)));
    const vol = std(recent) || 1;

    // Escalation risk over the horizon — a general "will it get worse" probability
    // that is meaningful at EVERY level (the old next-tier-crossing model returned
    // 0% for countries already at Critical, i.e. the most dangerous ones).
    //   • below Critical: P(cross into the next-higher tier), from projected level
    //     + momentum + volatility
    //   • already Critical: P(remain critical / deepen) — high, scaled by absolute
    //     level and trajectory (a country at 95 and steady is high-risk, not 0%)
    const nextBand = NEXT_BAND.find((b) => b > cur);
    let probEscalation;
    if (nextBand != null) {
      // logistic on how far the projected score sits past the next threshold
      const base = 1 / (1 + Math.exp(-((projection - nextBand) / (vol + 5))));
      // absolute-level pressure: higher current score carries inherent upside risk
      const pressure = Math.max(0, (cur - (nextBand - 15)) / 30) * 0.25;
      probEscalation = Math.max(0, Math.min(1, base + pressure));
    } else {
      // already Critical: sustained-critical / deepening risk
      const cool = Math.min(0, slope); // negative when cooling
      probEscalation = Math.max(0.35, Math.min(0.98, (cur - 58) / 42 + slope * 0.03 + cool * 0.02));
    }

    // anomaly: z-score of latest vs baseline (exclude the latest point from baseline)
    const base = series.slice(0, -1);
    const bMean = base.reduce((a, b) => a + b, 0) / base.length;
    const bStd = std(base) || 1;
    const z = Math.round(((cur - bMean) / bStd) * 100) / 100;

    const conf = series.length >= 12 ? 'High' : series.length >= 5 ? 'Moderate' : 'Low';
    const dir = perDay >= 1.5 ? 'rising' : perDay <= -1.5 ? 'cooling' : 'stable';
    const entry = { iso, current: cur, tier: tierOf(cur), momentumPerDay: perDay, direction: dir, projection, projectedTier: tierOf(projection), probEscalation: Math.round(probEscalation * 100), anomalyZ: z, points: series.length, confidence: conf };
    byIso[iso] = entry;
    // Only surface "escalating" for countries already at a meaningful level (≥40).
    // A low-instability country with a transient blip is not an escalation story;
    // this keeps the predictive board credible (no "Switzerland → Critical").
    if (cur >= 40 && (perDay >= 2 || probEscalation >= 0.4)) escalating.push(entry);
    if (z >= 2 && cur >= 40) anomalies.push(entry);
  }
  escalating.sort((a, b) => b.probEscalation - a.probEscalation || b.momentumPerDay - a.momentumPerDay);
  anomalies.sort((a, b) => b.anomalyZ - a.anomalyZ);
  return { generatedAt: new Date().toISOString(), horizonH, snapshots: history.length, byIso, escalating: escalating.slice(0, 25), anomalies: anomalies.slice(0, 25) };
}
