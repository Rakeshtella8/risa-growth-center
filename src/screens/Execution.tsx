import { useState } from 'react';
import { useApp, useData } from '../lib/app';
import { db, audit } from '../lib/supabase';
import { rs } from '../lib/format';
import { Task } from '../lib/types';
import { Section, Loading } from '../components/ui';

interface Campaign { row_id: number; campaign_id: string; campaign_name: string; channel: string; owner_name: string; status: string; budget_2026_inr: number | null; objective: string; target_audience: string }
const STATUSES = ['todo', 'doing', 'blocked', 'done'];
// "₹1,20,000" or "5 000" -> number; null if not a clean number
export function parseAmount(v: string): number | null {
  const t = v.replace(/[₹,\s]/g, '');
  if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
const statusCls: Record<string, string> = { todo: 'bg-slate-100 text-slate-700', doing: 'bg-blue-100 text-blue-800', blocked: 'bg-red-100 text-red-800', done: 'bg-emerald-100 text-emerald-800' };

export default function Execution() {
  const { refresh, target } = useApp();
  const { data, error } = useData(async () => {
    const [c, t, pt] = await Promise.all([
      db.from('campaigns').select('*').order('campaign_id'),
      db.from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false }).order('id'),
      db.from('plan_targets').select('target_key,budget_inr'),
    ]);
    if (c.error) throw c.error; if (t.error) throw t.error;
    return { campaigns: c.data as Campaign[], tasks: t.data as Task[], budgets: (pt.data ?? []) as { target_key: string; budget_inr: number }[] };
  }, []);
  const [filter, setFilter] = useState('open');
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <Loading error={error} />;
  const tasks = data.tasks.filter((t) => filter === 'all' || (filter === 'open' ? t.status !== 'done' : t.status === filter));
  const plan = data.campaigns.reduce((a, c) => a + (c.budget_2026_inr ?? 0), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Campaigns & tasks: execute</h1>
      {err && <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{err}<button className="btn-ghost text-xs" onClick={() => setErr(null)}>Dismiss</button></div>}
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-2">
          <Section title="Campaigns" sub={`2026 plan budgets: ${rs(plan)} of ${rs(data.budgets.find((x) => x.target_key === target)?.budget_inr ?? 300000)} budget (show-up programme ₹30,000 sits outside channels) [A]`}>
            <div className="space-y-2">
              {data.campaigns.map((c) => <CampaignRow key={c.row_id} c={c} onSaved={refresh} onError={setErr} />)}
            </div>
            <NewCampaign campaigns={data.campaigns} onSaved={refresh} />
          </Section>
          <SpendForm campaigns={data.campaigns} onSaved={refresh} />
        </div>
        <div className="xl:col-span-3">
          <Section title={`Tasks (${tasks.length})`} sub="Owners, deadlines and status. Copilot-proposed tasks appear here after you confirm them."
            right={<select className="input py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Task filter">
              <option value="open">Open</option><option value="all">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>}>
            <NewTask campaigns={data.campaigns} onSaved={refresh} />
            <p className="mt-2 text-[11px] text-slate-400">Sorted by due date, earliest first; tasks without a date last.</p>
            <div className="mt-3 divide-y divide-slate-100">
              {tasks.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No tasks here yet.</p>}
              {tasks.map((t) => <TaskRow key={t.id} t={t} onSaved={refresh} onError={setErr} />)}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function CampaignRow({ c, onSaved, onError }: { c: Campaign; onSaved: () => void; onError: (m: string) => void }) {
  const [budget, setBudget] = useState(String(c.budget_2026_inr ?? ''));
  const [bad, setBad] = useState(false);
  function saveBudget() {
    if (budget.trim() === '' && c.budget_2026_inr === null) return;
    const v = parseAmount(budget);
    if (v === null || v < 0 || v > 300000 || !Number.isInteger(v)) { setBad(true); return; }
    setBad(false);
    if (v !== c.budget_2026_inr) save({ budget_2026_inr: v });
  }
  async function save(patch: Partial<Campaign>) {
    const r = await db.from('campaigns').update(patch).eq('campaign_id', c.campaign_id);
    if (r.error) { onError(`${c.campaign_name} not saved: ${r.error.message}`); return; }
    await audit('campaigns', 'update', c.campaign_id, { status: c.status, budget_2026_inr: c.budget_2026_inr }, patch);
    onSaved();
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
      <div className="min-w-40 flex-1"><div className="font-medium">{c.campaign_name}</div><div className="text-[11px] text-slate-400">{[c.owner_name, c.target_audience].filter(Boolean).join(' · ') || 'no owner yet'}</div></div>
      <select className="input py-0.5 text-xs" value={c.status ?? 'active'} onChange={(e) => save({ status: e.target.value })} aria-label={`Status ${c.campaign_name}`}>
        <option>active</option><option>paused</option><option>stopped</option>
      </select>
      <label className="flex items-center gap-1 text-xs text-slate-500">2026 ₹
        <input className={`input w-24 py-0.5 ${bad ? 'border-red-500' : ''}`} inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} onBlur={saveBudget} onKeyDown={(e) => e.key === 'Enter' && saveBudget()} aria-label={`2026 budget ${c.campaign_name}`} aria-invalid={bad} />
      </label>
      {bad && <span className="w-full text-[11px] text-red-700">Whole rupees from 0 to 3,00,000. Not saved.</span>}
    </div>
  );
}

function SpendForm({ campaigns, onSaved }: { campaigns: Campaign[]; onSaved: () => void }) {
  const [f, setF] = useState({ campaign_id: 'C05', date: '2025-03-20', spend: '5000', note: '' });
  const [msg, setMsg] = useState('');
  async function submit() {
    const c = campaigns.find((x) => x.campaign_id === f.campaign_id);
    const amount = parseAmount(f.spend);
    if (!c) { setMsg('Error: pick a campaign.'); return; }
    if (amount === null) { setMsg('Error: spend must be a number in rupees, e.g. 5000 or 5,000.'); return; }
    if (amount === 0) { setMsg('Error: spend of ₹0 adds nothing.'); return; }
    if (Math.abs(amount) > 500000) { setMsg('Error: more than ₹5,00,000 in one entry looks like a typo. Split it or check the figure.'); return; }
    if (!f.date) { setMsg('Error: pick a date.'); return; }
    const row = { activity_id: 'APP-' + Date.now(), campaign_id: c.campaign_id, campaign_name: c.campaign_name, owner_name: c.owner_name,
      activity_date: f.date + ' 00:00:00', marketing_spend_inr: amount, impressions: 0, clicks: 0, reported_reach: 0, landing_page_sessions: 0, registration_starts: 0, platform: f.note || 'manual entry' };
    const { error } = await db.from('daily_marketing').insert(row);
    if (error) { setMsg('Error: ' + error.message); return; }
    await audit('daily_marketing', 'insert', row.activity_id, null, row);
    setMsg(`Logged ${rs(row.marketing_spend_inr)} for ${c.campaign_name}${amount < 0 ? ' (a correction)' : ''}. All dashboards and the copilot now include it.`);
    onSaved();
  }
  return (
    <Section title="Log spend" sub="Adds a row to the marketing data; every metric recalculates [D]. A negative amount records a correction.">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <select className="input" value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })} aria-label="Campaign">
          {campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
        </select>
        <input type="date" className="input" value={f.date} min="2025-01-15" max="2025-04-20" onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Date" />
        <input className="input w-28" inputMode="decimal" value={f.spend} onChange={(e) => setF({ ...f, spend: e.target.value })} aria-label="Spend in rupees" />
        <input className="input w-32" placeholder="note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} aria-label="Note" />
        <button className="btn-primary" onClick={submit}>Add spend</button>
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.startsWith('Error') ? 'text-red-700' : 'text-slate-600'}`} role="status">{msg}</p>}
    </Section>
  );
}

function NewTask({ campaigns, onSaved }: { campaigns: Campaign[]; onSaved: () => void }) {
  const [t, setT] = useState({ title: '', owner_name: '', due_date: '', priority: 'medium', bet_id: '', campaign_id: '' });
  const [err, setErr] = useState('');
  async function add() {
    setErr('');
    if (!t.title.trim()) { setErr('Give the task a title.'); return; }
    const row = { ...t, title: t.title.trim(), owner_name: t.owner_name.trim() || null, bet_id: t.bet_id ? Number(t.bet_id) : null, campaign_id: t.campaign_id || null, due_date: t.due_date || null, created_by: 'user' };
    const { data, error } = await db.from('tasks').insert(row).select('id');
    if (error) { setErr(`Task not saved: ${error.message}`); return; }
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
      <select className="input" value={t.priority} onChange={(e) => setT({ ...t, priority: e.target.value })} aria-label="Priority">
        <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
      </select>
      <button className="btn-primary" onClick={add}>Add</button>
      {err && <p className="w-full text-xs text-red-700" role="alert">{err}</p>}
    </div>
  );
}

function NewCampaign({ campaigns, onSaved }: { campaigns: Campaign[]; onSaved: () => void }) {
  const blank = { campaign_id: '', campaign_name: '', channel: '', owner_name: '', target_audience: '', budget: '' };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [err, setErr] = useState('');
  async function add() {
    setErr('');
    const id = f.campaign_id.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,12}$/.test(id)) { setErr('Campaign ID: 2–12 letters or digits, e.g. C08.'); return; }
    if (campaigns.some((c) => c.campaign_id.toUpperCase() === id)) { setErr(`${id} already exists.`); return; }
    if (!f.campaign_name.trim()) { setErr('Give the campaign a name.'); return; }
    const budget = f.budget.trim() === '' ? null : parseAmount(f.budget);
    if (f.budget.trim() !== '' && (budget === null || budget < 0 || budget > 300000 || !Number.isInteger(budget))) { setErr('2026 budget: whole rupees from 0 to 3,00,000.'); return; }
    const row = { campaign_id: id, campaign_name: f.campaign_name.trim(), channel: f.channel.trim() || 'other', owner_name: f.owner_name.trim() || null,
      target_audience: f.target_audience.trim() || null, objective: 'registrations', status: 'active', budget_2026_inr: budget, created_at: new Date().toISOString() };
    const { error } = await db.from('campaigns').insert(row);
    if (error) { setErr(`Not saved: ${error.message}`); return; }
    await audit('campaigns', 'insert', id, null, row);
    setF(blank); setOpen(false); onSaved();
  }
  if (!open) return <button className="btn-ghost mt-2 text-xs" onClick={() => setOpen(true)}>+ New campaign</button>;
  return (
    <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-2 text-sm sm:grid-cols-2">
      <input className="input" placeholder="ID, e.g. C08" value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })} aria-label="New campaign ID" />
      <input className="input" placeholder="Name" value={f.campaign_name} onChange={(e) => setF({ ...f, campaign_name: e.target.value })} aria-label="New campaign name" />
      <input className="input" placeholder="Channel, e.g. referral" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} aria-label="New campaign channel" />
      <input className="input" placeholder="Owner" value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} aria-label="New campaign owner" />
      <input className="input" placeholder="Audience" value={f.target_audience} onChange={(e) => setF({ ...f, target_audience: e.target.value })} aria-label="New campaign audience" />
      <input className="input" inputMode="numeric" placeholder="2026 budget ₹ (optional)" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} aria-label="New campaign 2026 budget" />
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" onClick={add}>Create campaign</button>
        <button className="btn-ghost" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
      </div>
      {err && <p className="text-xs text-red-700 sm:col-span-2" role="alert">{err}</p>}
      <p className="text-[11px] text-slate-400 sm:col-span-2">Spend and registrations logged against this ID show up in Channels and the copilot straight away.</p>
    </div>
  );
}

function TaskRow({ t, onSaved, onError }: { t: Task; onSaved: () => void; onError: (m: string) => void }) {
  const [edit, setEdit] = useState(false);
  const due = t.due_date ? String(t.due_date).slice(0, 10) : null;
  const [f, setF] = useState({ title: t.title, owner_name: t.owner_name ?? '', due_date: due ?? '', description: t.description ?? '' });
  async function patch(p: Partial<Task>): Promise<boolean> {
    const r = await db.from('tasks').update(p).eq('id', t.id);
    if (r.error) { onError(`Task "${t.title}" not saved: ${r.error.message}`); return false; }
    await audit('tasks', 'update', String(t.id), { status: t.status, priority: t.priority, title: t.title, owner_name: t.owner_name, due_date: t.due_date }, p);
    onSaved();
    return true;
  }
  async function remove() {
    if (!window.confirm(`Delete task "${t.title}"?`)) return;
    const r = await db.from('tasks').delete().eq('id', t.id);
    if (r.error) { onError(`Task not deleted: ${r.error.message}`); return; }
    await audit('tasks', 'delete', String(t.id), t, null);
    onSaved();
  }
  const overdue = due && t.status !== 'done' && due < new Date().toISOString().slice(0, 10);
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
        {t.priority === 'high' && <span className="tag bg-red-50 text-red-700">high</span>}
        <span className="text-xs text-slate-500">{t.owner_name || 'unassigned'}</span>
        <span className={`text-xs ${overdue ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{due ?? 'no date'}</span>
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
          <button className="btn-primary w-fit" onClick={async () => { if (!f.title.trim()) { onError('A task needs a title.'); return; } if (await patch({ ...f, title: f.title.trim(), due_date: f.due_date || null })) setEdit(false); }}>Save</button>
        </div>
      )}
    </div>
  );
}
