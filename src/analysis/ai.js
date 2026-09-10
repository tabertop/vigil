// AI narration layer (layer 2 of the predictive function).
// Feeds the deterministic predictive picture to Claude for a reasoned "what happens
// next, and why" assessment — second-order effects, interactions between theaters,
// and the non-obvious. Grounded: the model is given ONLY VIGIL's fused signals and
// told to reason from them, not from outside knowledge, and to use estimative
// language. Activates only when ANTHROPIC_API_KEY is set; otherwise returns
// {available:false} and the UI shows the deterministic board alone.
//
// Zero-dependency: uses the built-in fetch against the Anthropic Messages API.

const MODEL = process.env.VIGIL_AI_MODEL || 'claude-sonnet-5';

export async function aiForecast({ predictions = [], warnings, forecast, index } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { available: false, note: 'Set ANTHROPIC_API_KEY to enable the AI predictive narrative.' };

  // Compact the live picture into a grounded context block.
  const topWarn = (warnings?.scenarios || []).slice(0, 6).map((s) => `- ${s.name} [${s.level} ${s.probability}%]: ${s.tripped}/${s.total} indicators (${s.indicators.filter((i) => i.tripped).map((i) => i.label).join('; ') || 'none'})`).join('\n');
  const esc = (forecast?.escalating || []).slice(0, 10).map((f) => `- ${(index?.countries || []).find((c) => c.iso === f.iso)?.name || f.iso}: now ${f.current}, projected ${f.projection} (${f.projectedTier}), escalation ${f.probEscalation}%, momentum ${f.momentumPerDay}/day${f.anomalyZ >= 2 ? `, anomaly ${f.anomalyZ}σ` : ''}`).join('\n');
  const det = predictions.slice(0, 12).map((p) => `- [${p.probability}%] ${p.prediction}`).join('\n');
  const top = (index?.countries || []).slice(0, 12).map((c) => `${c.name} ${c.score}`).join(', ');

  const context = `CURRENT INSTABILITY INDEX (top): ${top}

INDICATORS & WARNINGS (scenario tripwires):
${topWarn || '(none active)'}

ESCALATION FORECAST (statistical, from index history):
${esc || '(insufficient history)'}

DETERMINISTIC PREDICTIONS (signal fusion):
${det || '(none)'}`;

  const system = `You are a senior intelligence analyst producing a forward-looking assessment for a watch desk. Reason ONLY from the VIGIL signals provided below — do not introduce outside facts or events not implied by the data. Use ICD-203 estimative language (remote/unlikely/roughly even/likely/very likely/almost certain) with a parenthetical probability. Be concise and decision-useful. Flag second-order effects and interactions BETWEEN theaters that the per-country signals miss. Clearly mark this as a model-generated estimate. Never fabricate specific casualty figures, dates, or named operations.`;

  const user = `Based only on the following live intelligence picture, give:
1. TOP 5 PREDICTED DEVELOPMENTS over the next 72h–2 weeks (ranked, each with estimative probability, timeframe, and the driving indicators).
2. CROSS-THEATER INTERACTIONS or second-order effects worth watching.
3. KEY UNCERTAINTIES / what would change the assessment.

LIVE PICTURE:
${context}`;

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 45000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1400, system, messages: [{ role: 'user', content: user }] }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) { const t = await r.text(); return { available: true, error: `Anthropic API ${r.status}`, detail: t.slice(0, 300) }; }
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return { available: true, generatedAt: new Date().toISOString(), narrative: text, usage: data.usage || null };
  } catch (e) {
    return { available: true, error: 'request failed', detail: String(e && e.message || e) };
  }
}
