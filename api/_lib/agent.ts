import { toolDefs, runTool, Ctx } from './tools.js';
import { systemPrompt } from './prompt.js';
import { providers, complete, ChatMsg, Provider } from './llm.js';

export interface TraceItem { tool: string; args: unknown; ok: boolean; result: unknown }
export interface AgentResult { answer: string; trace: TraceItem[]; proposals: unknown[]; model: string; error?: string; attempts?: string[] }

const MAX_STEPS = 7;
const MAX_TOOL_CHARS = 4000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// "Please try again in 2.5s" (Groq) / "retryDelay": "3s" (Gemini)
function retryAfter(msg: string) { const m = msg.match(/try again in ([\d.]+)s|retryDelay\"?:\s*\"(\d+)s/); return m ? Number(m[1] ?? m[2]) : null; }

export type CompleteFn = (p: Provider, m: ChatMsg[], t: unknown[]) => Promise<ChatMsg>;

export async function runAgent(ctx: Ctx, history: { role: 'user' | 'assistant'; content: string }[], targetLabel: string,
  completeFn: CompleteFn = complete, provs: Provider[] = providers()): Promise<AgentResult> {
  if (provs.length === 0) return { answer: 'The AI model is not configured (missing GROQ_API_KEY / GEMINI_API_KEY).', trace: [], proposals: [], model: 'none', error: 'no_provider' };
  const messages: ChatMsg[] = [{ role: 'system', content: systemPrompt(ctx.asOf, targetLabel) }, ...history.slice(-10)];
  const trace: TraceItem[] = [];
  const proposals: unknown[] = [];
  let pi = 0; let waited = 0; const attempts: string[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    let msg: ChatMsg;
    try {
      msg = await completeFn(provs[pi], messages, toolDefs as unknown as unknown[]);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const wait = status === 429 ? retryAfter((e as Error).message) : null;
      attempts.push(`${provs[pi].model} ${status ?? 'net'} ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 160)}`);
      if (wait !== null && wait <= 20 && waited + wait <= 30) { waited += wait; await sleep(wait * 1000 + 250); step--; continue; }
      if (pi + 1 < provs.length) {
        pi++; step--;
        // Another provider can't replay this provider's tool-call messages (Gemini needs its own signatures),
        // so hand over what was fetched so far as plain text.
        if (provs[pi].name !== provs[pi - 1].name) flatten(messages);
        continue;
      }
      console.error('all providers failed', (e as Error).message);
      return { answer: 'The free AI models are busy right now (rate limit). Please wait about a minute and ask again. The dashboard numbers are unaffected.', trace, proposals, model: provs[pi].name, error: 'provider_failed', attempts };
    }
    if (!msg) break;
    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) return { answer: tidy(msg.content ?? ''), trace, proposals, model: `${provs[pi].name}:${provs[pi].model}`, attempts };
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
    for (const c of calls) {
      let args: Record<string, unknown> = {};
      let result: unknown; let ok = true;
      try {
        args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
        result = await runTool(ctx, c.function.name, args);
        if (c.function.name === 'propose_task') proposals.push(args);
      } catch (e) { ok = false; result = { error: (e as Error).message }; }
      trace.push({ tool: c.function.name, args, ok, result });
      let s = JSON.stringify(result);
      if (s.length > MAX_TOOL_CHARS) s = s.slice(0, MAX_TOOL_CHARS) + '... [truncated: narrow the query]';
      messages.push({ role: 'tool', tool_call_id: c.id, name: c.function.name, content: s });
    }
  }
  return { answer: 'I could not finish the analysis within the step limit. Try a narrower question.', trace, proposals, model: `${provs[pi].name}:${provs[pi].model}`, error: 'step_limit' };
}

function flatten(messages: ChatMsg[]) {
  const first = messages.findIndex((m) => m.role === 'tool' || (m.role === 'assistant' && m.tool_calls?.length));
  if (first < 0) return;
  const notes = messages.slice(first).filter((m) => m.role === 'tool').map((m) => `Result of ${m.name}: ${m.content}`);
  messages.splice(first, messages.length - first, { role: 'user', content: `Data already fetched by tools for my last question (use it, call more tools only if needed):\n${notes.join('\n')}` });
}

// Models sometimes write the source tags with full-width brackets (【D】); the UI styles [D] / [A].
// gpt-oss models occasionally leak their internal channel markup at the end of an answer; cut it off.
export function tidy(s: string) {
  const cut = s.search(/<\|[a-z_]+\|>|【(?:commentary|analysis|final)\b/);
  if (cut >= 0) s = s.slice(0, cut);
  return s.replace(/【\s*([DA])\s*】/g, '[$1]').replace(/【([^】]{1,60})】/g, ' ($1)').trim();
}
