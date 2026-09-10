// Shared LLM caller (Anthropic Messages API) — zero-dependency, built-in fetch.
// Activates only when ANTHROPIC_API_KEY is set; callers degrade gracefully otherwise.
// Keep prompts small: retrieval/deterministic filtering happens BEFORE this, so we
// never ship enormous datasets to the model (cost + latency discipline).

const MODEL = process.env.VIGIL_AI_MODEL || 'claude-sonnet-5';

export function aiEnabled() { return !!process.env.ANTHROPIC_API_KEY; }
export function aiModel() { return MODEL; }

export async function callClaude({ system, user, maxTokens = 1200, timeoutMs = 45000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'no_key', note: 'Set ANTHROPIC_API_KEY to enable the AI analyst.' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      signal: ctrl.signal,
    });
    if (!r.ok) { const t = await r.text(); return { ok: false, error: `anthropic_${r.status}`, detail: t.slice(0, 300) }; }
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return { ok: true, text, usage: data.usage || null, model: MODEL };
  } catch (e) {
    return { ok: false, error: 'request_failed', detail: String((e && e.message) || e) };
  } finally { clearTimeout(to); }
}
