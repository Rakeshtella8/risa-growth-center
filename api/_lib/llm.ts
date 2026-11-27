// OpenAI-compatible chat completions with provider fallback: Groq first, then Gemini.
export interface Provider { name: string; url: string; key: string | undefined; model: string }

export function providers(): Provider[] {
  return [
    { name: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b' },
    { name: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest' },
  ].filter((p) => !!p.key);
}

export interface ChatMsg { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export async function complete(p: Provider, messages: ChatMsg[], tools: unknown[], signal?: AbortSignal) {
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({ model: p.model, messages, tools, tool_choice: 'auto', temperature: 0.1, max_tokens: 1200 }),
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
