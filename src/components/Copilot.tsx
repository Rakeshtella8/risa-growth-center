import { useEffect, useRef, useState } from 'react';
import { useApp, TARGETS } from '../lib/app';
import { db, audit, sessionId } from '../lib/supabase';
import { asOfLabel } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';

interface Proposal { title: string; description?: string; owner_name?: string; due_date?: string; priority?: string; bet_id?: number; campaign_id?: string; state?: 'open' | 'created' | 'dismissed'; createdId?: number }
interface TraceItem { tool: string; args: unknown; ok: boolean; result: unknown }
interface Msg { role: 'user' | 'assistant'; content: string; trace?: TraceItem[]; proposals?: Proposal[]; model?: string; context?: string; error?: boolean }

const STARTERS = [
  'Why are we behind the 2,200 target?',
  'Which channel should we cut, and where should that money go?',
  'Move ₹10k from Creators to Referrals: what happens?',
  'What was the ticket revenue?',
  'How many people downloaded the brochure but never registered?',
];

function loadMsgs(): Msg[] { try { return JSON.parse(sessionStorage.getItem('rgc_chat') || '[]'); } catch { return []; } }

export default function Copilot({ onClose }: { onClose: () => void }) {
  const { asOf, target, refresh, pendingQuestion, clearPending } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>(loadMsgs);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { try { sessionStorage.setItem('rgc_chat', JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ } end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  useEffect(() => { if (pendingQuestion && !busy) { send(pendingQuestion); clearPending(); } }, [pendingQuestion]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctxLabel = `${asOfLabel(asOf)} · ${TARGETS.find((t) => t.key === target)?.label}`;

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history: Msg[] = [...msgs, { role: 'user', content: q, context: ctxLabel }];
    setMsgs(history); setInput(''); setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })), asOf, target, sessionId: sessionId() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      setMsgs([...history, { role: 'assistant', content: j.answer || '(no answer)', trace: j.trace, model: j.model, error: !!j.error,
        proposals: (j.proposals ?? []).map((p: Proposal) => ({ ...p, state: 'open' })) }]);
    } catch (e) {
      setMsgs([...history, { role: 'assistant', content: `Could not reach the copilot: ${(e as Error).message}`, error: true }]);
    } finally { setBusy(false); }
  }

  async function confirm(mi: number, pi: number) {
    const m = msgs[mi]; const p = m.proposals![pi];
    const question = [...msgs.slice(0, mi)].reverse().find((x) => x.role === 'user')?.content ?? null;
    const row = { title: p.title, description: p.description ?? null, owner_name: p.owner_name ?? null, due_date: p.due_date || null,
      priority: ['low', 'medium', 'high'].includes(p.priority ?? '') ? p.priority : 'medium', bet_id: p.bet_id && p.bet_id >= 1 && p.bet_id <= 5 ? p.bet_id : null,
      campaign_id: p.campaign_id ?? null, created_by: 'copilot', source_question: question };
    const { data, error } = await db.from('tasks').insert(row).select('id');
    if (error) { alert('Could not create task: ' + error.message); return; }
    await audit('tasks', 'insert_from_copilot', String(data?.[0]?.id), null, row);
    update(mi, pi, { state: 'created', createdId: data?.[0]?.id });
    refresh();
  }
  function update(mi: number, pi: number, patch: Partial<Proposal>) {
    setMsgs((all) => all.map((m, i) => (i !== mi ? m : { ...m, proposals: m.proposals!.map((p, j) => (j === pi ? { ...p, ...patch } : p)) })));
  }

  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-white xl:static xl:z-10 xl:w-[440px] xl:shrink-0 xl:border-l xl:border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <div className="font-semibold text-navy-900">✦ Growth analyst & copilot</div>
          <div className="text-[11px] text-slate-500">Answers from live data · {ctxLabel}</div>
        </div>
        <div className="flex gap-1">
          <button className="btn-ghost text-xs" onClick={() => setMsgs([])}>Clear</button>
          <button className="btn-ghost text-xs" onClick={onClose} aria-label="Close copilot">✕</button>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {msgs.length === 0 && (
          <div className="space-y-2 text-sm text-slate-600">
            <p>Ask about performance, bottlenecks, budgets or next steps. Every number comes from a database query or the calculator, and I'll say when the data can't answer.</p>
            {STARTERS.map((s) => <button key={s} className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs hover:bg-slate-50" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        {msgs.map((m, mi) => (
          <div key={mi} className={m.role === 'user' ? 'ml-8' : 'mr-2'}>
            {m.role === 'user' ? (
              <div className="rounded-xl rounded-br-sm bg-navy-800 px-3 py-2 text-sm text-white">{m.content}</div>
            ) : (
              <div className={`rounded-xl rounded-bl-sm border px-3 py-2 text-sm ${m.error ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="prose-chat" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                {m.proposals?.map((p, pi) => (
                  <div key={pi} className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs">
                    <div className="font-semibold">Proposed task: {p.title}</div>
                    {p.description && <div className="mt-0.5 text-slate-600">{p.description}</div>}
                    <div className="mt-0.5 text-slate-500">{[p.owner_name && `Owner: ${p.owner_name}`, p.due_date && `Due: ${p.due_date}`, p.bet_id && `Bet #${p.bet_id}`, p.campaign_id].filter(Boolean).join(' · ')}</div>
                    {p.state === 'open' && <div className="mt-2 flex gap-2">
                      <button className="btn-primary px-2 py-1 text-xs" onClick={() => confirm(mi, pi)}>Confirm & create</button>
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => update(mi, pi, { state: 'dismissed' })}>Dismiss</button>
                    </div>}
                    {p.state === 'created' && <div className="mt-1 font-semibold text-emerald-700">✓ Created task #{p.createdId}. See Campaigns & tasks.</div>}
                    {p.state === 'dismissed' && <div className="mt-1 text-slate-400">Dismissed</div>}
                  </div>
                ))}
                {!!m.trace?.length && (
                  <details className="mt-2 text-[11px] text-slate-500">
                    <summary className="cursor-pointer">How I got this ({m.trace.length} {m.trace.length === 1 ? 'query' : 'queries'}{m.model ? ` · ${m.model}` : ''})</summary>
                    <ol className="mt-1 space-y-1">
                      {m.trace.map((t, i) => (
                        <li key={i} className="rounded bg-white p-1.5">
                          <span className={t.ok ? 'text-emerald-700' : 'text-red-700'}>{t.ok ? '✓' : '✗'}</span> <b>{t.tool}</b> <code className="break-all">{JSON.stringify(t.args).slice(0, 200)}</code>
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-slate-400">{JSON.stringify(t.result).slice(0, 800)}</pre>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="mr-2 animate-pulse rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">Querying the data…</div>}
        <div ref={end} />
      </div>
      <form className="border-t border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <div className="flex gap-2">
          <textarea className="input flex-1 resize-none" rows={2} placeholder="Ask about the campaign…" value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} aria-label="Message the copilot" />
          <button className="btn-primary self-end" disabled={busy || !input.trim()}>Send</button>
        </div>
        <p className="mt-1 text-[10px] text-slate-400">Tasks are only created when you click Confirm. [D] = data, [A] = assumption.</p>
      </form>
    </aside>
  );
}
