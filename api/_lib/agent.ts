import { toolDefs, runTool, Ctx } from './tools.js';
import { systemPrompt } from './prompt.js';
import { providers, complete, ChatMsg, Provider } from './llm.js';

export interface TraceItem { tool: string; args: unknown; ok: boolean; result: unknown }
export interface AgentResult { answer: string; trace: TraceItem[]; proposals: unknown[]; model: string; error?: string }

const MAX_STEPS = 7;
const MAX_TOOL_CHARS = 6000;

export type CompleteFn = (p: Provider, m: ChatMsg[], t: unknown[]) => Promise<ChatMsg>;

export async function runAgent(ctx: Ctx, history: { role: 'user' | 'assistant'; content: string }[], targetLabel: string,
  completeFn: CompleteFn = complete, provs: Provider[] = providers()): Promise<AgentResult> {
  if (provs.length === 0) return { answer: 'The AI model is not configured (missing GROQ_API_KEY / GEMINI_API_KEY).', trace: [], proposals: [], model: 'none', error: 'no_provider' };
  const messages: ChatMsg[] = [{ role: 'system', content: systemPrompt(ctx.asOf, targetLabel) }, ...history.slice(-10)];
  const trace: TraceItem[] = [];
  const proposals: unknown[] = [];
  let pi = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    let msg: ChatMsg;
    try {
      msg = await completeFn(provs[pi], messages, toolDefs as unknown as unknown[]);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (pi + 1 < provs.length && (status === undefined || status === 429 || status >= 500 || status === 400)) { pi++; step--; continue; }
      return { answer: `The AI service is unavailable right now (${(e as Error).message.slice(0, 120)}). The dashboard numbers are unaffected; please retry in a minute.`, trace, proposals, model: provs[pi].name, error: 'provider_failed' };
    }
    if (!msg) break;
    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) return { answer: (msg.content ?? '').trim(), trace, proposals, model: `${provs[pi].name}:${provs[pi].model}` };
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
  return { answer: 'I could not finish the analysis within the step limit. Try a narrower question.', trace, proposals, model: provs[pi].name, error: 'step_limit' };
}
