import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp, useData } from '../lib/app';
import { rpc, db, audit } from '../lib/supabase';
import { n0, rs, rs1, pct, flagClass } from '../lib/format';
import { ChannelKpi } from '../lib/types';
import { projectPlan, PLAN_2026_SPEND, ChannelBase } from '../lib/whatIf';
import { Section, AskButton, Loading, Tag } from '../components/ui';

const SHORT: Record<string, string> = { C01: 'Ambassadors', C02: 'Paid Social', C03: 'Creators', C04: 'College Partn.', C05: 'Referrals', C06: 'Organic', C07: 'Community' };

export default function Channels() {
  const { asOf, refresh } = useApp();
  const { data: kpis, error } = useData(() => rpc<ChannelKpi[]>('f_channel_kpis', { p_as_of: asOf }), [asOf]);
  const { data: full } = useData(() => rpc<ChannelKpi[]>('f_channel_kpis', { p_as_of: null }), []);
  if (!kpis) return <Loading error={error} />;

  async function setStatus(c: ChannelKpi, status: string) {
    await db.from('campaigns').update({ status }).eq('campaign_id', c.campaign_id);
    await audit('campaigns', 'status', c.campaign_id, { status: c.status }, { status });
    refresh();
  }

  const chart = kpis.filter((k) => k.registrants > 0).map((k) => ({ name: SHORT[k.campaign_id] ?? k.campaign_name, cpr: k.cost_per_registrant, ceiling: k.cost_ceiling, cpv: k.cost_per_visitor }));
  const totals = kpis.reduce((a, k) => ({ sp: a.sp + Number(k.spend_inr), reg: a.reg + k.registrants, vis: a.vis + k.visitors }), { sp: 0, reg: 0, vis: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Channels: diagnose</h1>
          <p className="text-sm text-slate-500">Attribution = campaign recorded on the registration [D]. Ceiling = 1.5× the channel's 2025 cost per registrant; Paid Social ₹137 [A].</p>
        </div>
        <AskButton q="Which channels are underperforming and why? Compare cost per visitor, show rate and opt-outs, and say what to scale, change or stop." label="Diagnose channels" />
      </div>

      <Section title="Campaign KPIs" sub="Red = above cost ceiling or show rate below 70% · amber = above 2025 cost · green = within">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead className="border-b border-slate-200"><tr>
              {['Campaign', 'Status', 'Spend', 'Identified', 'Registrants', 'Visitors', 'Show rate', '₹ / registrant', 'Ceiling', '₹ / visitor', 'Opt-outs', 'Flag'].map((h) => <th key={h} className="th">{h}</th>)}
            </tr></thead>
            <tbody>
              {kpis.map((k) => (
                <tr key={k.campaign_id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="td font-medium">{k.campaign_name}<div className="text-[11px] text-slate-400">{k.campaign_id} · {k.channel}</div></td>
                  <td className="td">
                    <select className="input py-0.5 text-xs" value={k.status ?? 'active'} onChange={(e) => setStatus(k, e.target.value)} aria-label={`Status of ${k.campaign_name}`}>
                      <option value="active">active</option><option value="paused">paused</option><option value="stopped">stopped</option>
                    </select>
                  </td>
                  <td className="td">{rs(k.spend_inr)}</td>
                  <td className="td">{n0(k.identified)}</td>
                  <td className="td">{n0(k.registrants)}</td>
                  <td className="td">{n0(k.visitors)}</td>
                  <td className={`td ${k.show_rate_pct !== null && k.show_rate_pct < 70 ? 'font-semibold text-red-700' : ''}`}>{pct(k.show_rate_pct)}</td>
                  <td className="td">{rs1(k.cost_per_registrant)}</td>
                  <td className="td text-slate-500">{rs1(k.cost_ceiling)}</td>
                  <td className="td">{rs1(k.cost_per_visitor)}</td>
                  <td className="td">{n0(k.opt_outs)}</td>
                  <td className="td"><span className={`tag ${flagClass[k.flag]}`}>{k.flag}</span></td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="td">Total (attributed)</td><td className="td" /><td className="td">{rs(totals.sp)}</td><td className="td" />
                <td className="td">{n0(totals.reg)}</td><td className="td">{n0(totals.vis)}</td>
                <td className="td">{totals.reg ? pct((100 * totals.vis) / totals.reg) : '–'}</td>
                <td className="td">{totals.reg ? rs1(totals.sp / totals.reg) : '–'}</td><td className="td" />
                <td className="td">{totals.vis ? rs1(totals.sp / totals.vis) : '–'}</td><td className="td" colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Cost per registrant vs ceiling" sub="Where the next rupee is still cheap">
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={chart} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => rs1(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="cpr" name="₹ per registrant" fill="#1a4380" />
              <Bar dataKey="ceiling" name="Ceiling" fill="#cbd5e1" />
              <Bar dataKey="cpv" name="₹ per visitor" fill="#d97706" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {full && <WhatIf kpis={full} />}
    </div>
  );
}

function WhatIf({ kpis }: { kpis: ChannelKpi[] }) {
  const { askCopilot } = useApp();
  const base: ChannelBase[] = useMemo(() => kpis.map((k) => ({
    campaign_id: k.campaign_id, campaign_name: k.campaign_name, spend_2025: Number(k.spend_inr), registrants_2025: k.registrants,
    show_rate_pct: k.registrants ? (100 * k.visitors) / k.registrants : 0,
  })), [kpis]);
  const [spend, setSpend] = useState<Record<string, number>>(() => Object.fromEntries(base.map((b) => [b.campaign_id, b.spend_2025])));
  const before = projectPlan(base, {});
  const after = projectPlan(base, spend);
  const delta = after.attendees - before.attendees;
  return (
    <Section title="Budget what-if" sub={<>Starts from each channel's 2025 cost and show rate [D]; spend above 2025 costs 1.5× per registrant (diminishing returns) [A]; walk-ins fixed at 125 [A]. Base: whole 2025 dataset.</>}
      right={<div className="flex gap-2">
        <button className="btn-ghost text-xs" onClick={() => setSpend(Object.fromEntries(base.map((b) => [b.campaign_id, b.spend_2025])))}>2025 spend</button>
        <button className="btn-ghost text-xs" onClick={() => setSpend({ ...PLAN_2026_SPEND })}>2026 plan</button>
      </div>}>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          {after.rows.map((r) => (
            <div key={r.campaign_id} className="grid grid-cols-12 items-center gap-2 text-sm">
              <span className="col-span-3 font-medium">{r.campaign_name}</span>
              <input type="range" min={0} max={150000} step={1000} value={spend[r.campaign_id]} className="col-span-4 accent-navy-700"
                onChange={(e) => setSpend({ ...spend, [r.campaign_id]: Number(e.target.value) })} aria-label={`Spend ${r.campaign_name}`} />
              <input type="number" className="input col-span-2 py-0.5" value={spend[r.campaign_id]} step={1000}
                onChange={(e) => setSpend({ ...spend, [r.campaign_id]: Math.max(0, Number(e.target.value)) })} />
              <span className="col-span-3 text-xs text-slate-500">{n0(r.registrants)} reg · {n0(r.attendees)} att</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg bg-navy-50 p-4 text-sm">
          <div className="mb-2 font-semibold text-navy-900">Result <Tag t="A" /></div>
          <div className="grid grid-cols-3 gap-1 text-xs">
            <span /><span className="font-semibold">2025</span><span className="font-semibold">What-if</span>
            <span>Spend</span><span>{rs(before.totalSpend)}</span><span>{rs(after.totalSpend)}</span>
            <span>Registrants</span><span>{n0(before.registrants)}</span><span>{n0(after.registrants)}</span>
            <span>Attendees</span><span>{n0(before.attendees)}</span><span className="font-bold">{n0(after.attendees)}</span>
          </div>
          <div className={`mt-3 text-lg font-bold ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{delta >= 0 ? '+' : ''}{n0(delta)} attendees</div>
          <div className="text-xs text-slate-500">{after.totalSpend > 300000 ? '⚠ Over the ₹3,00,000 budget' : `₹${n0(300000 - after.totalSpend)} of ₹3,00,000 unallocated`}</div>
          <button className="btn-primary mt-3 w-full justify-center text-xs" onClick={() => askCopilot(
            `Evaluate this budget plan with what_if_budget: ${JSON.stringify(spend)}. Is it a good reallocation versus 2025? What are the risks, and propose the tasks to execute it.`)}>
            ✦ Review this plan with copilot
          </button>
        </div>
      </div>
    </Section>
  );
}
