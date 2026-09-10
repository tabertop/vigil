// Temporal trends — turn the stored index history into direction & momentum.
// The index gives a level; this gives Δ: is a country escalating or cooling, and
// how fast. For each country we compare the latest score to the score ~`hours`
// ago (nearest snapshot at/older than the cutoff) and to its own recent peak,
// then attach a short sparkline series for the UI. Pure function over history.

// Return per-iso trend keyed by iso, plus a ranked list of the biggest movers.
export function computeTrends(history = [], { hours = 24 } = {}) {
  if (!history.length) return { generatedAt: new Date().toISOString(), hours, byIso: {}, movers: [] };

  const now = Date.parse(history[history.length - 1].at) || Date.now();
  const cutoff = now - hours * 36e5;

  // latest scores
  const latest = new Map((history[history.length - 1].countries || []).map((c) => [c.iso, c.score]));

  // baseline: the snapshot at or just before the cutoff (fallback: oldest)
  let baseSnap = history[0];
  for (const s of history) { if ((Date.parse(s.at) || 0) <= cutoff) baseSnap = s; else break; }
  const base = new Map((baseSnap.countries || []).map((c) => [c.iso, c.score]));

  // build a short series (last N snapshots) per iso for sparklines
  const series = new Map();
  const tail = history.slice(-24);
  for (const snap of tail) {
    const m = new Map((snap.countries || []).map((c) => [c.iso, c.score]));
    for (const iso of latest.keys()) {
      if (!series.has(iso)) series.set(iso, []);
      series.get(iso).push(m.get(iso) ?? 0);
    }
  }

  const byIso = {};
  const movers = [];
  for (const [iso, score] of latest) {
    const prior = base.has(iso) ? base.get(iso) : score;
    const delta = score - prior;
    const dir = delta >= 4 ? 'up' : delta <= -4 ? 'down' : 'flat';
    const spark = series.get(iso) || [score];
    const peak = Math.max(...spark, score);
    const entry = { iso, score, prior, delta, dir, peak, spark };
    byIso[iso] = entry;
    if (Math.abs(delta) >= 4) movers.push(entry);
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { generatedAt: new Date().toISOString(), hours, span: { from: baseSnap.at, to: history[history.length - 1].at }, snapshots: history.length, byIso, movers: movers.slice(0, 25) };
}
