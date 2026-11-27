// OpenAI-compatible chat completions with fallback across Groq and Gemini models, best model first.
export interface Provider { name: string; url: string; key: string | undefined; model: string }

// Free tiers limit each MODEL separately (requests and tokens per minute), so the chain tries several models
// per provider before giving up. Override with comma-separated GROQ_MODELS / GEMINI_MODELS.
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const list = (v: string | undefined, d: string) => (v || d).split(',').map((x) => x.trim()).filter(Boolean);

export function providers(): Provider[] {
  // Ordered by answer quality, not by provider: the small gpt-oss-20b invents comparisons, so it is the last resort.
  const groq = list(process.env.GROQ_MODELS || process.env.GROQ_MODEL, 'openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b');
  const gem = list(process.env.GEMINI_MODELS || process.env.GEMINI_MODEL, 'gemini-flash-latest,gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.5-flash-lite');
  const g = (model: string): Provider => ({ name: 'groq', url: GROQ, key: process.env.GROQ_API_KEY, model });
  const m = (model: string): Provider => ({ name: 'gemini', url: GEMINI, key: process.env.GEMINI_API_KEY, model });
  const small = (x: string) => /gpt-oss-20b/.test(x);
  return [
    ...groq.filter((x) => !small(x)).map(g),
    ...gem.map(m),
    ...groq.filter(small).map(g),
  ].filter((p) => !!p.key);
}

export interface ChatMsg { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export async function complete(p: Provider, messages: ChatMsg[], tools: unknown[], signal?: AbortSignal) {
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({ model: p.model, messages, tools, tool_choice: 'auto', temperature: 0.1, max_tokens: 1000,
      ...(p.model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}) }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`${p.name} ${res.status}: ${body.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const j = await res.json();
  return j.choices?.[0]?.message as ChatMsg;
}
