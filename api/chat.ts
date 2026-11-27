import { createClient } from '@supabase/supabase-js';
import { runAgent } from './_lib/agent.js';

const TARGET_LABELS: Record<string, string> = {
  '2025_goal': '2025 revised goal (2,200 verified attendees)',
  '2026_base': '2026 base plan (2,670 verified attendees)',
  '2026_stretch': '2026 stretch plan (3,205 verified attendees)',
};

// Public project URL and publishable (browser) key, same as the web app uses; env vars override them.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://twpnytzfgaaztfxbujjl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_iBzEMZ271LzREvfwfw9H8Q_MW4o78ur';

type Res = { status: (n: number) => { json: (b: unknown) => void } };

export default async function handler(req: { method?: string; body?: unknown }, res: Res) {
  try { return await handle(req, res); }
  catch (e) { return res.status(500).json({ error: 'copilot failed: ' + (e as Error).message }); }
}

async function handle(req: { method?: string; body?: unknown }, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
    messages?: { role: 'user' | 'assistant'; content: string }[]; asOf?: string | null; target?: string; sessionId?: string; edition?: string;
  };
  const messages = (body.messages ?? []).filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return res.status(400).json({ error: 'last message must be from the user' });
  const target = TARGET_LABELS[body.target ?? ''] ? body.target! : '2026_base';
  const asOf = body.asOf && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(body.asOf) ? body.asOf : null;
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  // targets are editable in the app, so describe the live one
  const { data: tr } = await db.from('plan_targets').select('label,registrants,verified_attendees,budget_inr').eq('target_key', target);
  const t = (tr ?? [])[0] as { label: string; registrants: number; verified_attendees: number; budget_inr: number } | undefined;
  const fmt = (n: number) => new Intl.NumberFormat('en-IN').format(n);
  const label = t ? `${t.label} (${fmt(t.verified_attendees)} verified attendees, ${fmt(t.registrants)} registrants, Rs ${fmt(t.budget_inr)} budget)` : TARGET_LABELS[target];
  const edition = body.edition === '2025' ? '2025' : '2026';
  const { data: er } = await db.from('editions').select('*').eq('edition', edition);
  const e = (er ?? [])[0] as { label: string; campaign_start: string; fest_day1: string; fest_day2: string; capacity: number; demo_clock: string; window_start: string; window_end: string } | undefined;
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const today = e ? (ist >= e.window_start && ist <= e.window_end ? ist : String(e.demo_clock).replace('T', ' ').slice(0, 19)) : null;
  const edInfo = e ? `${e.label} (edition '${edition}'): campaign from ${e.campaign_start}, fest ${e.fest_day1} and ${e.fest_day2}, capacity ${fmt(e.capacity)} confirmed places; "today" in this fest year = ${today}${edition === '2026' ? '. The 2026 rows up to the demo date are SIMULATED from the 2025 campaign [A] (is_simulated = true); anything the team entered since is real' : ''}.` : `edition ${edition}`;
  const result = await runAgent({ db, asOf, target, edition }, messages, label, edInfo);
  try {
    await db.from('chat_log').insert([
      { session_id: body.sessionId ?? null, role: 'user', content: messages[messages.length - 1].content },
      { session_id: body.sessionId ?? null, role: 'assistant', content: result.answer, tool_calls: result.trace, model: result.model },
    ]);
  } catch { /* logging is best-effort */ }
  return res.status(200).json(result);
}
