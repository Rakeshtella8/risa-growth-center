import { createClient } from '@supabase/supabase-js';
import { runAgent } from './_lib/agent.js';

const TARGET_LABELS: Record<string, string> = {
  '2025_goal': '2025 revised goal (2,200 verified attendees)',
  '2026_base': '2026 base plan (2,670 verified attendees)',
  '2026_stretch': '2026 stretch plan (3,205 verified attendees)',
};

export default async function handler(req: { method?: string; body?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
    messages?: { role: 'user' | 'assistant'; content: string }[]; asOf?: string | null; target?: string; sessionId?: string;
  };
  const messages = (body.messages ?? []).filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return res.status(400).json({ error: 'last message must be from the user' });
  const target = TARGET_LABELS[body.target ?? ''] ? body.target! : '2026_base';
  const asOf = body.asOf && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(body.asOf) ? body.asOf : null;
  const db = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const result = await runAgent({ db, asOf, target }, messages, TARGET_LABELS[target]);
  try {
    await db.from('chat_log').insert([
      { session_id: body.sessionId ?? null, role: 'user', content: messages[messages.length - 1].content },
      { session_id: body.sessionId ?? null, role: 'assistant', content: result.answer, tool_calls: result.trace, model: result.model },
    ]);
  } catch { /* logging is best-effort */ }
  return res.status(200).json(result);
}
