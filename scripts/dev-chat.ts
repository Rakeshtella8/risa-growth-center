// Local stand-in for the Vercel /api/chat function.
// With GROQ_API_KEY / GEMINI_API_KEY set it uses the real models; with MOCK_LLM=1 it uses a scripted
// model (keyword rules) so the UI flow can be tested offline.
// Usage: SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=dev MOCK_LLM=1 npx tsx scripts/dev-chat.ts
import http from 'node:http';
import handler from '../api/chat';
import { runAgent, CompleteFn } from '../api/_lib/agent';
import type { ChatMsg } from '../api/_lib/llm';
import { createClient } from '@supabase/supabase-js';

const mock: CompleteFn = async (_p, messages: ChatMsg[]) => {
  const q = [...messages].reverse().find((m) => m.role === 'user')?.content?.toLowerCase() ?? '';
  const done = new Set(messages.filter((m) => m.role === 'tool').map((m) => m.name));
  const call = (name: string, args: object = {}): ChatMsg => ({ role: 'assistant', content: null, tool_calls: [{ id: name + done.size, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  if (/revenue|ticket|gender/.test(q)) {
    if (!done.has('get_data_dictionary')) return call('get_data_dictionary');
    return { role: 'assistant', content: 'The data cannot answer that: there is no revenue or ticket-price field in any table [D]. Closest available: marketing spend and registrations.\n\nSource: get_data_dictionary' };
  }
  if (/move|shift/.test(q)) {
    if (!done.has('what_if_budget')) return call('what_if_budget', { spend: { C03: 49000, C05: 29000 } });
    if (!done.has('propose_task')) return call('propose_task', { title: 'Shift ₹10k from Creator Partners to Student Referrals', description: 'Per what-if: more attendees at the same spend', owner_name: 'Growth lead', priority: 'high', campaign_id: 'C05' });
    const w = JSON.parse(messages.find((m) => m.name === 'what_if_budget')!.content!);
    return { role: 'assistant', content: `Moving ₹10,000 from Creators to Referrals changes attendees by **${w.delta.attendees}** at the same spend [A].\n\n| | Before | After |\n|---|---|---|\n| Attendees | ${w.before.attendees} | ${w.after.attendees} |\n\nI proposed a task; confirm it below.\n\nSource: what_if_budget` };
  }
  if (!done.has('get_funnel')) return call('get_funnel');
  const f = JSON.parse(messages.find((m) => m.name === 'get_funnel')!.content!);
  const v = f.rows.find((r: { metric: string }) => r.metric === 'verified_visitors').value;
  return { role: 'assistant', content: `(mock model) Verified attendees: **${v}** [D] as of ${f.as_of}.\n\n- Source: get_funnel` };
};

http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (process.env.MOCK_LLM) {
    const b = JSON.parse(body || '{}');
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY || 'dev', { auth: { persistSession: false } });
    const r = await runAgent({ db, asOf: b.asOf ?? null, target: b.target ?? '2026_base' }, b.messages, 'mock target', mock, [{ name: 'mock', url: '', key: 'x', model: 'scripted' }]);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); return;
  }
  await handler({ method: req.method, body }, { status: (n: number) => ({ json: (o: unknown) => { res.writeHead(n, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); } }) });
}).listen(8787, () => console.log('dev chat on :8787'));
