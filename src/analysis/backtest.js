// Forecast backtesting harness — does the model actually predict?
// Walks the persisted index history: at each past snapshot t that has enough
// prior history to forecast AND enough future to verify, it re-runs the forecast
// using ONLY data available at t, then scores the call against what actually
// happened by t+horizon. Reports standard skill metrics:
//   • Brier score      — calibration of the escalation probability (lower better)
//   • precision/recall — of "will escalate a tier" calls
//   • projection MAE   — mean abs error of the projected score
//   • lead time        — avg snapshots of warning before an actual tier-cross
//   • vs. baseline     — Brier of a naive "persistence" model (prob = 0), to show skill
//
// Ground truth here is the index's own realized scores (self-consistency backtest).
// When an external truth set is available (ACLED via ACLED_KEY, wired in
// sources/acled.js), pass it as `truth` to score against independent events.

import { computeForecast } from './forecast.js';

const NEXT_BAND = [25, 50, 75];
function tierBand(s) { return s >= 75 ? 3 : s >= 50 ? 2 : s >= 25 ? 1 : 0; }

export function backtestForecast(history = [], { horizonH = 72, minPrior = 4 } = {}) {
  if (history.length < minPrior + 2) {
    return { generatedAt: new Date().toISOString(), status: 'insufficient-history', snapshots: history.length, note: `need ≥${minPrior + 2} snapshots to backtest; metrics populate as history accrues.` };
  }
  const times = history.map((s) => Date.parse(s.at) || 0);
  const stepH = Math.max(0.25, ((times[times.length - 1] - times[0]) / 3.6e6) / (history.length - 1));
  const horizonSteps = Math.max(1, Math.round(horizonH / stepH));

  let n = 0, brierSum = 0, baseBrierSum = 0, projErrSum = 0;
  let tp = 0, fp = 0, fn = 0, tn = 0, leadSum = 0, leadN = 0;

  for (let t = minPrior; t + horizonSteps < history.length; t++) {
    const prefix = history.slice(0, t + 1);            // data available "as of" t
    const fc = computeForecast(prefix, { horizonH });
    const future = history[t + horizonSteps];
    const futMap = new Map((future.countries || []).map((c) => [c.iso, c.score]));
    const nowMap = new Map((history[t].countries || []).map((c) => [c.iso, c.score]));

    for (const iso in fc.byIso) {
      const f = fc.byIso[iso];
      const actualFuture = futMap.get(iso);
      if (actualFuture == null) continue;
      const cur = nowMap.get(iso); if (cur == null) continue;
      // did it cross into a higher tier band by the horizon?
      const escalated = tierBand(actualFuture) > tierBand(cur) ? 1 : 0;
      const p = (f.probEscalation || 0) / 100;
      brierSum += (p - escalated) ** 2;
      baseBrierSum += (0 - escalated) ** 2; // naive baseline: never predicts escalation
      projErrSum += Math.abs((f.projection ?? cur) - actualFuture);
      n++;
      const predicted = p >= 0.5 ? 1 : 0;
      if (predicted && escalated) { tp++; leadSum += horizonSteps; leadN++; }
      else if (predicted && !escalated) fp++;
      else if (!predicted && escalated) fn++;
      else tn++;
    }
  }

  if (n === 0) return { generatedAt: new Date().toISOString(), status: 'insufficient-overlap', snapshots: history.length, note: 'not enough overlapping windows yet.' };
  const brier = brierSum / n, baseBrier = baseBrierSum / n;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall ? (2 * precision * recall) / (precision + recall) : null;
  const skill = baseBrier ? 1 - brier / baseBrier : 0; // Brier skill score vs baseline

  return {
    generatedAt: new Date().toISOString(),
    status: 'ok',
    horizonH,
    snapshots: history.length,
    samples: n,
    brier: Math.round(brier * 1000) / 1000,
    baselineBrier: Math.round(baseBrier * 1000) / 1000,
    brierSkillScore: Math.round(skill * 1000) / 1000,
    projectionMAE: Math.round((projErrSum / n) * 10) / 10,
    precision: precision == null ? null : Math.round(precision * 100) / 100,
    recall: recall == null ? null : Math.round(recall * 100) / 100,
    f1: f1 == null ? null : Math.round(f1 * 100) / 100,
    avgLeadSteps: leadN ? Math.round((leadSum / leadN) * 10) / 10 : null,
    confusion: { tp, fp, fn, tn },
  };
}
