import { useState } from 'react';
import { useApp, useData } from '../lib/app';
import { db, audit } from '../lib/supabase';
import { n0 } from '../lib/format';
import { Section, Loading } from '../components/ui';
import { parseCsv, toCsv } from '../lib/csv';

const TABLES: Record<string, { label: string; cols: string[] }> = {
  daily_marketing: { label: 'Daily Marketing', cols: ['activity_id', 'campaign_id', 'campaign_name', 'activity_date', 'impressions', 'clicks', 'landing_page_sessions', 'registration_starts', 'marketing_spend_inr', 'platform'] },
  registrations: { label: 'Registrations', cols: ['registration_id', 'person_id', 'person_name', 'campaign_id', 'registered_at'] },
  registration_history: { label: 'Registration History', cols: ['history_id', 'registration_id', 'person_id', 'campaign_id', 'effective_at', 'status'] },
  checkins: { label: 'Check-ins', cols: ['event_id', 'person_id', 'registration_id', 'campaign_id', 'occurred_at', 'result', 'verification', 'source'] },
  people: { label: 'People', cols: ['person_id', 'person_name', 'person_type', 'first_seen_at', 'first_touch_source', 'first_campaign_id'] },
  interactions: { label: 'Interest and Engagement', cols: ['interaction_id', 'person_id', 'campaign_id', 'occurred_at', 'event_type', 'detail'] },
};
const PAGE = 50;

export default function DataScreen() {
  const { refresh } = useApp();
  const [table, setTable] = useState('daily_marketing');
  const [page, setPage] = useState(0);
  const [col, setCol] = useState('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState({ col: '', q: '' });
  const [msg, setMsg] = useState('');
  const cfg = TABLES[table];
  const { data, error } = useData(async () => {
    let query = db.from(table).select(['row_id', ...cfg.cols].join(','), { count: 'exact' }).order('row_id').range(page * PAGE, page * PAGE + PAGE - 1);
    if (applied.col && applied.q) query = query.ilike(applied.col, `%${applied.q}%`);
    const r = await query;
    if (r.error) throw r.error;
    return { rows: r.data as unknown as Record<string, unknown>[], count: r.count ?? 0 };
  }, [table, page, applied.col, applied.q]);

  async function saveCell(row: Record<string, unknown>, c: string, value: string) {
    const old = row[c];
    if (String(old ?? '') === value) return;
    const { error: e } = await db.from(table).update({ [c]: value === '' ? null : value }).eq('row_id', row.row_id as number);
    if (e) { setMsg('Error: ' + e.message); return; }
    await audit(table, 'update', String(row.row_id), { [c]: old }, { [c]: value });
    setMsg(`Saved ${c} on row ${row.row_id}. Metrics recalculated.`); refresh();
  }
  async function delRow(row: Record<string, unknown>) {
    const { error: e } = await db.from(table).delete().eq('row_id', row.row_id as number);
    if (e) { setMsg('Error: ' + e.message); return; }
    await audit(table, 'delete', String(row.row_id), row, null);
    setMsg(`Deleted row ${row.row_id}.`); refresh();
  }
  async function addRow() {
    const blank = Object.fromEntries(cfg.cols.map((c) => [c, null]));
    const { error: e } = await db.from(table).insert(blank);
    if (e) { setMsg('Error: ' + e.message); return; }
    setMsg('Added an empty row at the end. Fill its cells.'); refresh();
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
          <button className="btn-primary" onClick={addRow}>Add row</button>
        </div>}>
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <select className="input" value={table} onChange={(e) => { setTable(e.target.value); setPage(0); setApplied({ col: '', q: '' }); setCol(''); setQ(''); }} aria-label="Table">
            {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className="input" value={col} onChange={(e) => setCol(e.target.value)} aria-label="Filter column">
            <option value="">Filter column…</option>{cfg.cols.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="input" placeholder="contains…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setApplied({ col, q }), setPage(0))} aria-label="Filter value" />
          <button className="btn-ghost" onClick={() => { setApplied({ col, q }); setPage(0); }}>Filter</button>
        </div>
        {msg && <p className="mb-2 rounded bg-navy-50 px-2 py-1 text-xs text-navy-800">{msg}</p>}
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
    </div>
  );
}
