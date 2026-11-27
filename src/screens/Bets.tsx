import { useState } from 'react';
import { useApp, useData } from '../lib/app';
import { rpc, db, audit } from '../lib/supabase';
import { n0, n1, rs } from '../lib/format';
import { Bet, ChannelKpi } from '../lib/types';
import { evaluateBet, verdictClass } from '../lib/bets';
import { Section, AskButton, Loading, Tag } from '../components/ui';

export default function Bets() {
  const { asOf, refresh } = useApp();
  const { data, error } = useData(async () => {
    const [bets, kpis] = await Promise.all([
      db.from('v_bet_status').select('*').then((r) => { if (r.error) throw r.error; return r.data as Bet[]; }),
      rpc<ChannelKpi[]>('f_channel_kpis', { p_as_of: asOf }),
    ]);
    return { bets, kpis };
  }, [asOf]);
  if (!data) return <Loading error={error} />;
  const totalBase = data.bets.reduce((a, b) => a + b.base_attendees, 0);
  const totalStretch = data.bets.reduce((a, b) => a + b.stretch_attendees, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Bets: decide</h1>
          <p className="text-sm text-slate-500">Score = incremental attendees × confidence ÷ person-weeks [A]. Five bets add +{n0(totalBase)} (base) / +{n0(totalStretch)} (stretch) on top of 2,050.</p>
        </div>
        <AskButton q="Review all five bets against their thresholds. Which should we scale, change or stop this week, and why?" label="Scale / change / stop?" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.bets.map((b) => <BetCard key={b.bet_id} b={b} kpis={data.kpis} onChange={refresh} />)}
      </div>
    </div>
  );
}

function BetCard({ b, kpis, onChange }: { b: Bet; kpis: ChannelKpi[]; onChange: () => void }) {
  const ev = evaluateBet(b, kpis);
  const [reading, setReading] = useState('');
  const [saving, setSaving] = useState(false);
  async function addReading() {
    const v = Number(reading);
    if (reading === '' || Number.isNaN(v)) return;
    setSaving(true);
    await db.from('bet_kpi_readings').insert({ bet_id: b.bet_id, reading_date: new Date().toISOString().slice(0, 10), value: v, note: 'entered in app' });
    await audit('bet_kpi_readings', 'insert', String(b.bet_id), null, { value: v });
    setReading(''); setSaving(false); onChange();
  }
  async function setStatus(status: string) {
    await db.from('bets').update({ status }).eq('bet_id', b.bet_id);
    await audit('bets', 'status', String(b.bet_id), { status: b.status }, { status });
    onChange();
  }
  const needsManual = [1, 4, 5].includes(b.bet_id);
  return (
    <Section title={`#${b.bet_id} ${b.name}`} sub={<>Owner: {b.owner_name} · budget {b.budget_inr ? rs(b.budget_inr) : '₹0 extra'} · score {n1(b.score)}</>}
      right={<select className="input py-0.5 text-xs" value={b.status} onChange={(e) => setStatus(e.target.value)} aria-label="Bet status">
        {['running', 'scaled', 'changed', 'stopped'].map((s) => <option key={s}>{s}</option>)}
      </select>}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="text-[11px] uppercase text-slate-500">{b.kpi_name}</div>
          <div className="text-xl font-bold">{ev.value === null ? '–' : n1(ev.value)} <span className="text-xs font-normal text-slate-500">{ev.unit}</span></div>
          <div className="text-[11px] text-slate-400">{ev.source === 'data' ? <>live from data <Tag t="D" /></> : ev.source === 'manual reading' ? `team reading ${b.latest_kpi_date ?? ''}` : 'no reading yet'}</div>
        </div>
        <span className={`tag text-sm ${verdictClass[ev.verdict]}`}>{ev.verdict.toUpperCase()}</span>
        <div className="text-xs text-slate-500">+{n0(b.base_attendees)} base / +{n0(b.stretch_attendees)} stretch <Tag t="A" /></div>
      </div>
      <p className="mt-2 text-xs text-slate-600">{ev.why}</p>
      <div className="mt-3 grid gap-1 text-xs sm:grid-cols-3">
        <div className="rounded bg-emerald-50 p-2"><b>Scale if</b><br />{b.scale_if}</div>
        <div className="rounded bg-amber-50 p-2"><b>Change if</b><br />{b.change_if}</div>
        <div className="rounded bg-red-50 p-2"><b>Stop if</b><br />{b.stop_if}</div>
      </div>
      <p className="mt-2 text-xs text-slate-500"><b>Action:</b> {b.action_text} · open tasks: {b.open_tasks}</p>
      {needsManual && (
        <div className="mt-3 flex items-center gap-2">
          <input className="input w-32" placeholder="KPI value" value={reading} onChange={(e) => setReading(e.target.value)} aria-label={`New KPI reading for bet ${b.bet_id}`} />
          <button className="btn-primary text-xs" onClick={addReading} disabled={saving}>Add reading</button>
          <AskButton q={`Bet #${b.bet_id} (${b.name}): given its latest KPI and thresholds, what should we do next? Propose a task.`} label="Next step?" />
        </div>
      )}
      {!needsManual && <div className="mt-2"><AskButton q={`Bet #${b.bet_id} (${b.name}): given the live KPI and thresholds, what should we do next? Propose a task.`} label="Next step?" /></div>}
    </Section>
  );
}
