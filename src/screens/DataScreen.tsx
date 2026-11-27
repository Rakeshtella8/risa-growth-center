import { useState } from 'react';
import { useApp, useData } from '../lib/app';
import { db, audit } from '../lib/supabase';
import { n0 } from '../lib/format';
import { Section, Loading } from '../components/ui';
import { PlanTarget, AuditRow, Edition } from '../lib/types';
import { rpc } from '../lib/supabase';
import { dateLabel } from '../lib/format';
import { parseCsv, toCsv } from '../lib/csv';

const TABLES: Record<string, { label: string; cols: string[] }> = {
  daily_marketing: { label: 'Daily Marketing', cols: ['activity_id', 'campaign_id', 'campaign_name', 'activity_date', 'impressions', 'clicks', 'landing_page_sessions', 'registration_starts', 'marketing_spend_inr', 'platform'] },
  registrations: { label: 'Registrations', cols: ['registration_id', 'person_id', 'person_name', 'campaign_id', 'registered_at', 'college', 'role', 'sport'] },
  registration_history: { label: 'Registration History', cols: ['history_id', 'registration_id', 'person_id', 'campaign_id', 'effective_at', 'status'] },
  checkins: { label: 'Check-ins', cols: ['event_id', 'person_id', 'registration_id', 'campaign_id', 'occurred_at', 'result', 'verification', 'source'] },
  people: { label: 'People', cols: ['person_id', 'person_name', 'person_type', 'first_seen_at', 'first_touch_source', 'first_campaign_id'] },
  interactions: { label: 'Interest and Engagement', cols: ['interaction_id', 'person_id', 'campaign_id', 'occurred_at', 'event_type', 'detail'] },
};
const PAGE = 50;
const NUMBER_COLS = new Set(['impressions', 'clicks', 'landing_page_sessions', 'registration_starts', 'marketing_spend_inr']);
const DATE_COLS = new Set(['activity_date', 'registered_at', 'effective_at', 'occurred_at', 'first_seen_at']);
const kind = (c: string) => (NUMBER_COLS.has(c) ? 'number' : DATE_COLS.has(c) ? 'date' : 'text');
const nextDay = (d: string) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
interface Filter { col: string; q: string; to: string }

export default function DataScreen() {
  const { refresh } = useApp();
  const [table, setTable] = useState('daily_marketing');
  const [page, setPage] = useState(0);
  const [col, setCol] = useState('');
  const [q, setQ] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState<Filter>({ col: '', q: '', to: '' });
  const [msg, setMsg] = useState('');
  const cfg = TABLES[table];
  const { data, error } = useData(async () => {
    let query = db.from(table).select(['row_id', ...cfg.cols].join(','), { count: 'exact' }).order('row_id').range(page * PAGE, page * PAGE + PAGE - 1);
    const k = kind(applied.col);
    if (applied.col && k === 'text' && applied.q) query = query.ilike(applied.col, `%${applied.q}%`);
    if (applied.col && k === 'number' && applied.q) query = query.eq(applied.col, Number(applied.q));
    if (applied.col && k === 'date') {
      if (applied.q) query = query.gte(applied.col, applied.q);
      if (applied.to) query = query.lt(applied.col, nextDay(applied.to));
    }
    const r = await query;
    if (r.error) throw r.error;
    return { rows: r.data as unknown as Record<string, unknown>[], count: r.count ?? 0 };
  }, [table, page, applied.col, applied.q, applied.to]);

  function applyFilter() {
    setMsg('');
    const k = kind(col);
    const v = q.trim();
    if (col && k === 'number' && v !== '' && !Number.isFinite(Number(v.replace(/,/g, '')))) { setMsg(`Error: ${col} is a number column; enter a number.`); return; }
    if (col && k === 'date' && v && to && to < v) { setMsg('Error: the "to" date is before the "from" date.'); return; }
    setApplied({ col, q: k === 'number' ? v.replace(/,/g, '') : v, to: k === 'date' ? to : '' }); setPage(0);
  }
  const fk = kind(col);

  async function saveCell(row: Record<string, unknown>, c: string, value: string) {
    const old = row[c];
    if (String(old ?? '') === value) return;
    if (kind(c) === 'number' && value !== '' && !Number.isFinite(Number(value.replace(/,/g, '')))) { setMsg(`Error: ${c} must be a number. Not saved.`); refresh(); return; }
    if (kind(c) === 'date' && value !== '' && Number.isNaN(Date.parse(value.replace(' ', 'T')))) { setMsg(`Error: ${c} must be a date like 2025-03-20 or 2025-03-20 14:00:00. Not saved.`); refresh(); return; }
    const clean = value === '' ? null : kind(c) === 'number' ? Number(value.replace(/,/g, '')) : value;
    const { error: e } = await db.from(table).update({ [c]: clean }).eq('row_id', row.row_id as number);
    if (e) { setMsg('Error: ' + e.message); return; }
    await audit(table, 'update', String(row.row_id), { [c]: old }, { [c]: value });
    setMsg(`Saved ${c} on row ${row.row_id}. Metrics recalculated.`); refresh();
  }
  async function delRow(row: Record<string, unknown>) {
    const label = cfg.cols.slice(0, 2).map((c) => String(row[c] ?? '')).join(' · ');
    if (!window.confirm(`Delete row ${row.row_id} (${label}) from ${cfg.label}? Reset data in the top bar restores it.`)) return;
    const { error: e } = await db.from(table).delete().eq('row_id', row.row_id as number);
    if (e) { setMsg('Error: ' + e.message); return; }
    await audit(table, 'delete', String(row.row_id), row, null);
    setMsg(`Deleted row ${row.row_id}.`); refresh();
  }
  async function upload(file: File, mode: 'append' | 'replace') {
    const rows = parseCsv(await file.text());
    if (!rows.length) { setMsg('The CSV has no rows.'); return; }
    const unknown = Object.keys(rows[0]).filter((k) => !cfg.cols.includes(k) && k !== 'row_id');
    const clean = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => cfg.cols.includes(k)).map(([k, v]) => [k, v === '' ? null : v])));
    if (mode === 'replace') {
      if (!window.confirm(`Replace all ${n0(data?.count)} rows of ${cfg.label} with ${clean.length} rows from ${file.name}?`)) return;
      const d = await db.from(table).delete().gte('row_id', 0);
      if (d.error) { setMsg('Error: ' + d.error.message); return; }
    }
    for (let i = 0; i < clean.length; i += 500) {
      const { error: e } = await db.from(table).insert(clean.slice(i, i + 500));
      if (e) { setMsg(`Error after ${i} rows: ${e.message}`); refresh(); return; }
    }
    await audit(table, 'upload_' + mode, file.name, null, { rows: clean.length });
    setMsg(`${mode === 'replace' ? 'Replaced with' : 'Appended'} ${clean.length} rows.${unknown.length ? ' Ignored columns: ' + unknown.join(', ') : ''} Metrics recalculated.`);
    refresh();
  }
  async function download() {
    const all: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const r = await db.from(table).select(cfg.cols.join(',')).order('row_id').range(from, from + 999);
      if (r.error || !r.data?.length) break;
      all.push(...(r.data as unknown as Record<string, unknown>[]));
      if (r.data.length < 1000) break;
    }
    const blob = new Blob([toCsv(all, cfg.cols)], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${table}.csv`; a.click();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Data: edit, upload, reset</h1>
        <p className="text-sm text-slate-500">This is the raw 2025 data, with duplicates and internal/test people left in. The metric layer cleans it on every read, so edits here flow straight into every chart and every copilot answer. Use <b>Reset data</b> (top bar) to restore the original.</p>
      </div>
      <Section title={`${cfg.label} · ${n0(data?.count ?? 0)} rows`}
        right={<div className="flex flex-wrap gap-2 text-xs">
          <button className="btn-ghost" onClick={download}>Download CSV</button>
          <label className="btn-ghost cursor-pointer">Append CSV<input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'append')} /></label>
          <label className="btn-ghost cursor-pointer">Replace with CSV<input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'replace')} /></label>
        </div>}>
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <select className="input" value={table} onChange={(e) => { setTable(e.target.value); setPage(0); setApplied({ col: '', q: '', to: '' }); setCol(''); setQ(''); setTo(''); }} aria-label="Table">
            {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className="input" value={col} onChange={(e) => setCol(e.target.value)} aria-label="Filter column">
            <option value="">Filter column…</option>{cfg.cols.map((c) => <option key={c}>{c}</option>)}
          </select>
          {fk === 'date' ? (<>
            <input type="date" className="input" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter from date" />
            <span className="self-center text-xs text-slate-400">to</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Filter to date" />
          </>) : (
            <input className="input" inputMode={fk === 'number' ? 'decimal' : undefined} placeholder={fk === 'number' ? 'equals…' : 'contains…'} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyFilter()} aria-label="Filter value" />
          )}
          <button className="btn-ghost" onClick={applyFilter}>Filter</button>
          {(applied.q || applied.to) && <button className="btn-ghost" onClick={() => { setCol(''); setQ(''); setTo(''); setApplied({ col: '', q: '', to: '' }); setPage(0); }}>Clear</button>}
        </div>
        {msg && <p className={`mb-2 rounded px-2 py-1 text-xs ${msg.startsWith('Error') ? 'bg-red-50 text-red-800' : 'bg-navy-50 text-navy-800'}`} role="status">{msg}</p>}
        {!data ? <Loading error={error} /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-200"><tr><th className="th">row</th>{cfg.cols.map((c) => <th key={c} className="th">{c}</th>)}<th className="th" /></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={String(r.row_id)} className="border-b border-slate-100">
                      <td className="px-2 py-1 text-slate-400">{String(r.row_id)}</td>
                      {cfg.cols.map((c) => (
                        <td key={c} className="px-1 py-0.5">
                          <input defaultValue={r[c] === null || r[c] === undefined ? '' : String(r[c])} onBlur={(e) => saveCell(r, c, e.target.value)}
                            className="w-full min-w-20 rounded border border-transparent px-1 py-0.5 hover:border-slate-200 focus:border-navy-700 focus:outline-none" aria-label={`${c} row ${r.row_id}`} />
                        </td>
                      ))}
                      <td><button className="btn-danger px-1 text-xs" onClick={() => delRow(r)} aria-label={`Delete row ${r.row_id}`}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <button className="btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
              <span>Page {page + 1} of {Math.max(1, Math.ceil(data.count / PAGE))}</span>
              <button className="btn-ghost" disabled={(page + 1) * PAGE >= data.count} onClick={() => setPage(page + 1)}>Next ›</button>
            </div>
          </>
        )}
      </Section>
      <FestSettings onSaved={refresh} />
      <TargetsEditor onSaved={refresh} />
      <ChangeHistory />
    </div>
  );
}

const TARGET_FIELDS: { k: keyof PlanTarget; label: string }[] = [
  { k: 'identified', label: 'Identified people' }, { k: 'registrants', label: 'Registrants' },
  { k: 'verified_attendees', label: 'Verified attendees' }, { k: 'budget_inr', label: 'Budget ₹' },
];

function TargetsEditor({ onSaved }: { onSaved: () => void }) {
  const { version } = useApp();
  const { data, error } = useData(async () => {
    const r = await db.from('plan_targets').select('*').order('target_key');
    if (r.error) throw r.error;
    return r.data as PlanTarget[];
  }, [version]);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [msg, setMsg] = useState('');
  if (!data) return <Section title="Targets and budget (constraints)"><Loading error={error} /></Section>;
  const val = (t: PlanTarget, k: string) => draft[t.target_key]?.[k] ?? String((t as unknown as Record<string, unknown>)[k] ?? '');
  const set = (t: PlanTarget, k: string, v: string) => setDraft({ ...draft, [t.target_key]: { ...draft[t.target_key], [k]: v } });
  async function save(t: PlanTarget) {
    setMsg('');
    const d = draft[t.target_key] ?? {};
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d)) {
      if (k === 'label') { if (!v.trim()) { setMsg('Error: the label cannot be empty.'); return; } patch.label = v.trim(); continue; }
      const n = Number(v.replace(/[₹,\s]/g, ''));
      if (!Number.isInteger(n) || n < 0 || n > 10000000) { setMsg(`Error: ${k} must be a whole number of 0 or more.`); return; }
      patch[k] = n;
    }
    const next = { ...t, ...patch } as PlanTarget;
    if (next.verified_attendees > next.identified && next.identified > 0) { setMsg('Error: verified attendees cannot exceed identified people.'); return; }
    if (!Object.keys(patch).length) return;
    const r = await db.from('plan_targets').update(patch).eq('target_key', t.target_key);
    if (r.error) { setMsg('Error: ' + r.error.message + (r.error.code === '42501' ? ' (run update_02.sql in Supabase to allow target edits)' : '')); return; }
    await audit('plan_targets', 'update', t.target_key, Object.fromEntries(Object.keys(patch).map((k) => [k, (t as unknown as Record<string, unknown>)[k]])), patch);
    setDraft({ ...draft, [t.target_key]: {} });
    setMsg(`Saved ${next.label}. Overview, Channels, Bets and the copilot now compare against the new figures.`);
    onSaved();
  }
  return (
    <Section title="Targets and budget (constraints)" sub="Change a goal or the budget and every screen and the copilot use it at once. Reset data restores the originals.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200"><tr><th className="th">Target</th>{TARGET_FIELDS.map((f) => <th key={f.k} className="th text-right">{f.label}</th>)}<th className="th" /></tr></thead>
          <tbody>
            {data.map((t) => {
              const dirty = Object.keys(draft[t.target_key] ?? {}).length > 0;
              return (
                <tr key={t.target_key} className="border-b border-slate-100">
                  <td className="px-1 py-1"><input className="input w-full min-w-40" value={val(t, 'label')} onChange={(e) => set(t, 'label', e.target.value)} aria-label={`Label ${t.target_key}`} /><div className="px-1 text-[11px] text-slate-400">{t.target_key} · {t.source}</div></td>
                  {TARGET_FIELDS.map((f) => (
                    <td key={f.k} className="px-1 py-1"><input className="input w-28 text-right" inputMode="numeric" value={val(t, f.k)} onChange={(e) => set(t, f.k, e.target.value)} aria-label={`${f.label} ${t.target_key}`} /></td>
                  ))}
                  <td className="px-1"><button className="btn-primary text-xs" disabled={!dirty} onClick={() => save(t)}>Save</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.startsWith('Error') ? 'text-red-700' : 'text-slate-600'}`} role="status">{msg}</p>}
    </Section>
  );
}

function ChangeHistory() {
  const { version } = useApp();
  const [limit, setLimit] = useState(15);
  const { data, error } = useData(async () => {
    const r = await db.from('audit_log').select('id,table_name,row_ref,action,old_value,new_value,created_at').order('id', { ascending: false }).limit(limit);
    if (r.error) throw r.error;
    return r.data as AuditRow[];
  }, [version, limit]);
  const brief = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? Object.entries(v as Record<string, unknown>).slice(0, 4).map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : String(x)}`).join(', ') : String(v);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  };
  return (
    <Section title="Change history" sub="Every edit made in the app or by the copilot, newest first. Shared by everyone using this demo.">
      {!data ? <Loading error={error} /> : data.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">No changes yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-200"><tr><th className="th">When</th><th className="th">Table</th><th className="th">Action</th><th className="th">Row</th><th className="th">Before</th><th className="th">After</th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap px-2 py-1 text-slate-500">{new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-2 py-1">{a.table_name}</td>
                  <td className="px-2 py-1">{a.action}</td>
                  <td className="px-2 py-1 text-slate-500">{a.row_ref}</td>
                  <td className="px-2 py-1 text-slate-500">{brief(a.old_value)}</td>
                  <td className="px-2 py-1">{brief(a.new_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length >= limit && <button className="btn-ghost mt-2 text-xs" onClick={() => setLimit(limit + 30)}>Show more</button>}
        </div>
      )}
    </Section>
  );
}

function FestSettings({ onSaved }: { onSaved: () => void }) {
  const { ed, edition, today, version } = useApp();
  const [f, setF] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const { data: sim } = useData(async () => {
    const r = await db.from('registrations').select('row_id', { count: 'exact', head: true }).eq('is_simulated', true);
    return r.error ? null : r.count ?? 0;
  }, [version]);
  const v = (k: keyof Edition) => f[k] ?? String(ed[k] ?? '').slice(0, k === 'demo_clock' ? 10 : 50);
  const set = (k: string, x: string) => setF({ ...f, [k]: x });
  async function save() {
    setMsg('');
    const n = { ...ed, ...f } as unknown as Record<string, string>;
    const win = [ed.window_start.slice(0, 10), ed.window_end.slice(0, 10)];
    for (const k of ['campaign_start', 'fest_day1', 'fest_day2']) if (!/^\d{4}-\d{2}-\d{2}$/.test(n[k]) || n[k] < win[0] || n[k] > win[1]) { setMsg(`Error: ${k.replace('_', ' ')} must be a date in ${win[0]} – ${win[1]}.`); return; }
    if (!(n.campaign_start < n.fest_day1 && n.fest_day1 <= n.fest_day2)) { setMsg('Error: campaign start must come before fest day 1, and day 1 on or before day 2.'); return; }
    const cap = Number(String(n.capacity).replace(/,/g, '')), sr = Number(n.assumed_show_rate_pct), wi = Number(n.assumed_walk_ins);
    if (!Number.isInteger(cap) || cap < 0) { setMsg('Error: capacity must be a whole number.'); return; }
    if (!(sr > 0 && sr <= 100)) { setMsg('Error: show rate must be between 0 and 100.'); return; }
    if (!Number.isInteger(wi) || wi < 0) { setMsg('Error: walk-ins must be a whole number.'); return; }
    const patch = { campaign_start: n.campaign_start, fest_day1: n.fest_day1, fest_day2: n.fest_day2, capacity: cap, assumed_show_rate_pct: sr, assumed_walk_ins: wi };
    const r = await db.from('editions').update(patch).eq('edition', edition);
    if (r.error) { setMsg('Error: ' + r.error.message); return; }
    if (f.demo_clock && f.demo_clock !== ed.demo_clock.slice(0, 10)) {
      try { await rpc('set_demo_clock', { p_clock: f.demo_clock + ' 23:59:59', p_edition: edition }); } catch (e) { setMsg('Error: ' + (e as Error).message); return; }
    }
    await audit('editions', 'update', edition, ed, { ...patch, demo_clock: f.demo_clock });
    setF({}); setMsg('Saved. Every screen and the copilot now use these settings.'); onSaved();
  }
  async function removeSim() {
    if (!window.confirm(`Delete the ${sim} simulated 2026 registrations and their people, spend and history? Reset data brings them back.`)) return;
    try { const r = await rpc('remove_simulated'); await audit('*', 'remove_simulated', null, null, r); setMsg('Simulated rows removed. 2026 now shows only what you entered.'); onSaved(); }
    catch (e) { setMsg('Error: ' + (e as Error).message); }
  }
  const field = (k: keyof Edition, label: string, type = 'text') => (
    <label className="grid gap-1 text-xs"><span className="text-slate-500">{label}</span>
      <input className="input" type={type} value={v(k)} onChange={(e) => set(k, e.target.value)} aria-label={label} /></label>
  );
  return (
    <Section title={`Fest settings: ${ed.label}`} sub={`Dates and capacity drive pace, forecasts, the waitlist and the gate. Today in this fest year: ${dateLabel(today)}.`}>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {field('campaign_start', 'Campaign start', 'date')}
        {field('fest_day1', 'Fest day 1', 'date')}
        {field('fest_day2', 'Fest day 2', 'date')}
        {field('capacity', 'Capacity (confirmed places)')}
        {field('assumed_show_rate_pct', 'Assumed show rate % [A]')}
        {field('assumed_walk_ins', 'Assumed walk-ins [A]')}
        {field('demo_clock', 'Demo "today"', 'date')}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary text-xs" disabled={!Object.keys(f).length} onClick={save}>Save settings</button>
        <span className="text-[11px] text-slate-400">Demo "today" only applies while the real date is outside this fest year.</span>
      </div>
      {edition === '2026' && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span><b>Simulated data [A]:</b> {sim === null ? 'unknown' : `${(sim ?? 0).toLocaleString('en-IN')} simulated 2026 registrations`} (2025 campaign shifted one year, channels scaled by assumed 2026 changes).</span>
          {!!sim && <button className="btn-danger border border-red-200 text-xs" onClick={removeSim}>Remove simulated rows</button>}
        </div>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.startsWith('Error') ? 'text-red-700' : 'text-slate-600'}`} role="status">{msg}</p>}
    </Section>
  );
}
