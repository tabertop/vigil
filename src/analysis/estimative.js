// Estimative language — ICD 203 (US IC "Analytic Standards") probability bands.
// Analysts don't say "62%"; they say "likely," with the number in parentheses.
// Standardizing this across dossiers, forecasts, reports and warnings is what makes
// the product read as intelligence rather than a dashboard. Accepts 0..1 or 0..100.

export function estimative(p) {
  const n = p > 1 ? p / 100 : p;
  if (n < 0.05) return 'remote';
  if (n < 0.20) return 'very unlikely';
  if (n < 0.45) return 'unlikely';
  if (n < 0.55) return 'roughly even chance';
  if (n < 0.80) return 'likely';
  if (n < 0.95) return 'very likely';
  return 'almost certain';
}

// Phrase + percent, e.g. "likely (62%)"
export function estimativePhrase(p) {
  const n = p > 1 ? Math.round(p) : Math.round(p * 100);
  return `${estimative(p)} (${n}%)`;
}

// Analytic confidence (ICD 203: low / moderate / high) — distinct from probability.
export function analyticConfidence(sourceCount, bestGrade) {
  const hi = bestGrade === 'A' || bestGrade === 'B';
  if (sourceCount >= 3 && hi) return 'high';
  if (sourceCount >= 2 || (sourceCount >= 1 && bestGrade === 'A')) return 'moderate';
  return 'low';
}
