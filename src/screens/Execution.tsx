import { useState } from 'react';
import { useApp, useData } from '../lib/app';
import { db, audit } from '../lib/supabase';
import { rs } from '../lib/format';
import { Task } from '../lib/types';
import { Section, Loading } from '../components/ui';

interface Campaign { row_id: number; campaign_id: string; campaign_name: string; channel: string; owner_name: string; status: string; budget_2026_inr: number | null; objective: string; target_audience: string }
const STATUSES = ['todo', 'doing', 'blocked', 'done'];
const statusCls: Record<string, string> = { todo: 'bg-slate-100 text-slate-700', doing: 'bg-blue-100 text-blue-800', blocked: 'bg-red-100 text-red-800', done: 'bg-emerald-100 text-emerald-800' };

export default function Execution() {
  const { refresh } = useApp();
  const { data, error } = useData(async () => {
    const [c, t] = await Promise.all([
      db.from('campaigns').select('*').order('campaign_id'),
      db.from('tasks').select('*').order('id', { ascending: false }),
    ]);
    if (c.error) throw c.error; if (t.error) throw t.error;
    return { campaigns: c.data as Campaign[], tasks: t.data as Task[] };
  }, []);
  const [filter, setFilter] = useState('open');
  if (!data) return <Loading error={error} />;
  const tasks = data.tasks.filter((t) => filter === 'all' || (filter === 'open' ? t.status !== 'done' : t.status === filter));
  const plan = data.campaigns.reduce((a, c) => a + (c.budget_2026_inr ?? 0), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Campaigns & tasks: execute</h1>
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-2">
          <Section title="Campaigns" sub={`2026 plan budgets: ${rs(plan)} of ₹3,00,000 (show-up programme ₹30,000 sits outside channels) [A]`}>
            <div className="space-y-2">
              {data.campaigns.map((c) => <CampaignRow key={c.row_id} c={c} onSaved={refresh} />)}
            </div>
          </Section>
          <SpendForm campaigns={data.campaigns} onSaved={refresh} />
        </div>
        <div className="xl:col-span-3">
          <Section title={`Tasks (${tasks.length})`} sub="Owners, deadlines and status. Copilot-proposed tasks appear here after you confirm them."
            right={<select className="input py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Task filter">
              <option value="open">Open</option><option value="all">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>}>
            <NewTask campaigns={data.campaigns} onSaved={refresh} />
            <div className="mt-3 divide-y divide-slate-100">
              {tasks.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No tasks here yet.</p>}
              {tasks.map((t) => <TaskRow key={t.id} t={t} onSaved={refresh} />)}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function CampaignRow({ c, onSaved }: { c: Campaign; onSaved: () => void }) {
  const [budget, setBudget] = useState(String(c.budget_2026_inr ?? ''));
  async function save(patch: Partial<Campaign>) {
    await db.from('campaigns').update(patch).eq('campaign_id', c.campaign_id);
    await audit('campaigns', 'update', c.campaign_id, { status: c.status, budget_2026_inr: c.budget_2026_inr }, patch);
    onSaved();
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
      <div className="min-w-40 flex-1"><div className="font-medium">{c.campaign_name}</div><div className="text-[11px] text-slate-400">{c.owner_name} · {c.target_audience}</div></div>
      <select className="input py-0.5 text-xs" value={c.status ?? 'active'} onChange={(e) => save({ status: e.target.value })} aria-label={`Status ${c.campaign_name}`}>
        <option>active</option><option>paused</option><option>stopped</option>
      </select>
      <label className="flex items-center gap-1 text-xs text-slate-500">2026 ₹
        <input className="input w-24 py-0.5" value={budget} onChange={(e) => setBudget(e.target.value)} onBlur={() => Number(budget) !== c.budget_2026_inr && save({ budget_2026_inr: Number(budget) || 0 })} aria-label={`2026 budget ${c.campaign_name}`} />
      </label>
    </div>
  );
}

function SpendForm({ campaigns, onSaved }: { campaigns: Campaign[]; onSaved: () => void }) {
  const [f, setF] = useState({ campaign_id: 'C05', date: '2025-03-20', spend: '5000', note: '' });
  const [msg, setMsg] = useState('');
  async function submit() {
    const c = campaigns.find((x) => x.campaign_id === f.campaign_id)!;
    const row = { activity_id: 'APP-' + Date.now(), campaign_id: c.campaign_id, campaign_name: c.campaign_name, owner_name: c.owner_name,
      activity_date: f.date + ' 00:00:00', marketing_spend_inr: Number(f.spend), impressions: 0, clicks: 0, reported_reach: 0, landing_page_sessions: 0, registration_starts: 0, platform: f.note || 'manual entry' };
    const { error } = await db.from('daily_marketing').insert(row);
    if (error) { setMsg('Error: ' + error.message); return; }
    await audit('daily_marketing', 'insert', row.activity_id, null, row);
    setMsg(`Logged ${rs(row.marketing_spend_inr)} for ${c.campaign_name}. All dashboards and the copilot now include it.`);
    onSaved();
  }
  return (
    <Section title="Log spend" sub="Adds a row to the marketing data; every metric recalculates [D]">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <select className="input" value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })} aria-label="Campaign">
          {campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
        </select>
        <input type="date" className="input" value={f.date} min="2025-01-15" max="2025-04-20" onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Date" />
        <input className="input w-28" value={f.spend} onChange={(e) => setF({ ...f, spend: e.target.value })} aria-label="Spend in rupees" />
        <input className="input w-32" placeholder="note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} aria-label="Note" />
        <button className="btn-primary" onClick={submit}>Add spend</button>
      </div>
      {msg && <p className="mt-2 text-xs text-slate-600">{msg}</p>}
    </Section>
  );
}

function NewTask({ campaigns, onSaved }: { campaigns: Campaign[]; onSaved: () => void }) {
  const [t, setT] = useState({ title: '', owner_name: '', due_date: '', priority: 'medium', bet_id: '', campaign_id: '' });
  async function add() {
    if (!t.title.trim()) return;
    const row = { ...t, bet_id: t.bet_id ? Number(t.bet_id) : null, campaign_id: t.campaign_id || null, due_date: t.due_date || null, created_by: 'user' };
    const { data } = await db.from('tasks').insert(row).select('id');
    await audit('tasks', 'insert', String(data?.[0]?.id ?? ''), null, row);
    setT({ title: '', owner_name: '', due_date: '', priority: 'medium', bet_id: '', campaign_id: '' });
    onSaved();
  }
  return (
    <div className="flex flex-wrap gap-2 rounded-lg bg-slate-50 p-2 text-sm">
      <input className="input min-w-56 flex-1" placeholder="New task…" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="Task title" />
      <input className="input w-32" placeholder="Owner" value={t.owner_name} onChange={(e) => setT({ ...t, owner_name: e.target.value })} aria-label="Owner" />
      <input type="date" className="input" value={t.due_date} onChange={(e) => setT({ ...t, due_date: e.target.value })} aria-label="Due date" />
      <select className="input" value={t.bet_id} onChange={(e) => setT({ ...t, bet_id: e.target.value })} aria-label="Linked bet">
        <option value="">No bet</option>{[1, 2, 3, 4, 5].map((i) => <option key={i} value={i}>Bet #{i}</option>)}
      </select>
      <select className="input" value={t.campaign_id} onChange={(e) => setT({ ...t, campaign_id: e.target.value })} aria-label="Linked campaign">
        <option value="">No campaign</option>{campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
      </select>
      <button className="btn-primary" onClick={add}>Add</button>
    </div>
  );
}

function TaskRow({ t, onSaved }: { t: Task; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: t.title, owner_name: t.owner_name ?? '', due_date: t.due_date ?? '', description: t.description ?? '' });
  async function patch(p: Partial<Task>) {
    await db.from('tasks').update(p).eq('id', t.id);
    await audit('tasks', 'update', String(t.id), { status: t.status }, p);
    onSaved();
  }
  async function remove() {
    if (!window.confirm(`Delete task "${t.title}"?`)) return;
    await db.from('tasks').delete().eq('id', t.id);
    await audit('tasks', 'delete', String(t.id), t, null);
    onSaved();
  }
  const overdue = t.due_date && t.status !== 'done' && t.due_date < new Date().toISOString().slice(0, 10);
  return (
    <div className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <select className={`tag cursor-pointer border-0 ${statusCls[t.status] ?? ''}`} value={t.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Task status">
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className={`flex-1 text-sm font-medium ${t.status === 'done' ? 'text-slate-400 line-through' : ''}`}>{t.title}</span>
        {t.created_by === 'copilot' && <span className="tag bg-amber-100 text-amber-800" title={t.source_question ?? ''}>✦ copilot</span>}
        {t.bet_id && <span className="tag bg-navy-50 text-navy-700">Bet #{t.bet_id}</span>}
        {t.campaign_id && <span className="tag bg-slate-100 text-slate-600">{t.campaign_id}</span>}
        <span className="text-xs text-slate-500">{t.owner_name || 'unassigned'}</span>
        <span className={`text-xs ${overdue ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{t.due_date ?? 'no date'}</span>
        <button className="btn-ghost px-1.5 text-xs" onClick={() => setEdit(!edit)}>{edit ? 'Close' : 'Edit'}</button>
        <button className="btn-danger px-1.5 text-xs" onClick={remove}>Delete</button>
      </div>
      {t.description && !edit && <p className="mt-1 pl-1 text-xs text-slate-500">{t.description}</p>}
      {edit && (
        <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-2 text-sm sm:grid-cols-2">
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Edit title" />
          <input className="input" value={f.owner_name} placeholder="Owner" onChange={(e) => setF({ ...f, owner_name: e.target.value })} aria-label="Edit owner" />
          <input type="date" className="input" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} aria-label="Edit due date" />
          <select className="input" value={t.priority} onChange={(e) => patch({ priority: e.target.value })} aria-label="Priority"><option>low</option><option>medium</option><option>high</option></select>
          <textarea className="input sm:col-span-2" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} aria-label="Edit description" />
          <button className="btn-primary w-fit" onClick={() => { patch({ ...f, due_date: f.due_date || null }); setEdit(false); }}>Save</button>
        </div>
      )}
    </div>
  );
}
