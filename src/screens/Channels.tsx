import { Fragment, useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp, useData } from '../lib/app';
import { rpc, db, audit } from '../lib/supabase';
import { n0, n1, rs, rs1, pct, flagClass, asOfLabel } from '../lib/format';
import { ChannelKpi, ChannelProjection, ChannelWeek, PlanTarget } from '../lib/types';
import { projectedFlag } from '../lib/flags';
import { projectPlan, ChannelBase, MARGINAL_MULT } from '../lib/whatIf';
import { Section, AskButton, Loading, Tag } from '../components/ui';

const statusCls: Record<string, string> = { active: 'bg-emerald-50 text-emerald-700', paused: 'bg-amber-50 text-amber-700', stopped: 'bg-red-50 text-red-700', unlisted: 'bg-slate-100 text-slate-600' };
const rate = (a: number | undefined, b: number | undefined) => (a !== undefined && b ? (100 * a) / b : null);
const wkLabel = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function Channels() {
  const { asOf, target, edition, today } = useApp();
  const { data, error } = useData(async () => {
    const [kpis, weekly, proj] = await Promise.all([
      rpc<ChannelKpi[]>('f_channel_kpis', { p_as_of: asOf, p_edition: edition }),
      rpc<ChannelWeek[]>('f_channel_weekly', { p_as_of: asOf, p_edition: edition }).catch(() => [] as ChannelWeek[]),
      rpc<ChannelProjection[]>('f_channel_projection', { p_as_of: asOf, p_edition: edition }).catch(() => [] as ChannelProjection[]),
    ]);
    return { kpis, weekly, proj };
  }, [asOf]);
  const { data: full } = useData(async () => {
    const [kpis, camps, targets] = await Promise.all([
      rpc<ChannelKpi[]>('f_channel_kpis', { p_as_of: null, p_edition: '2025' }),
      db.from('campaigns').select('campaign_id,budget_2026_inr,status').then((r) => (r.data ?? []) as { campaign_id: string; budget_2026_inr: number | null; status: string }[]),
      db.from('plan_targets').select('*').then((r) => (r.data ?? []) as PlanTarget[]),
    ]);
    return { kpis, camps, budget: targets.find((t) => t.target_key === target)?.budget_inr ?? 300000 };
  }, [target]);
  if (!data) return <Loading error={error} />;
  const { kpis, weekly, proj } = data;
  const pf = (k: ChannelKpi) => projectedFlag(k, proj.find((p) => p.campaign_id === k.campaign_id));
  const hasProj = kpis.some((k) => pf(k).projected !== null);
  const totals = kpis.reduce((a, k) => ({ sp: a.sp + Number(k.spend_inr), reg: a.reg + k.registrants, vis: a.vis + k.visitors }), { sp: 0, reg: 0, vis: 0 });
  const hasFunnel = kpis.some((k) => k.sessions !== undefined);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Channels</h1>
          <p className="text-sm text-slate-500">As of <b>{asOfLabel(asOf, today)}</b>. Each registrant counts for the campaign recorded on their registration [D]. Cost ceiling: 1.5× the channel's 2025 cost per registrant, except Paid Social at ₹137 [A].</p>
        </div>
        <AskButton q="Which channels are underperforming and why? Compare cost per attendee, show rate and opt-outs, and say what to scale, change or stop." label="Diagnose channels" />
      </div>

      <Section title="Campaign KPIs" sub={hasProj
        ? 'Flags use the projected end-of-campaign cost per registrant (planned budget ÷ projected registrants) [A], as on the Bets screen: red = above the ceiling or show rate below 70% · amber = within 5% of the ceiling · green = below. Cost so far runs high mid-season because spend comes before registrations.'
        : 'Red = above cost ceiling or show rate below 70% · amber = above 2025 cost · green = within. Status is set on Campaigns & tasks.'}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead className="border-b border-slate-200"><tr>
              {['Campaign', 'Status', 'Spend', 'Identified', 'Registrants', 'Attendees', 'Show rate', hasProj ? '₹ / registrant so far' : '₹ / registrant', ...(hasProj ? ['₹ / registrant projected'] : []), 'Ceiling', '₹ / attendee', 'Opt-outs', 'Flag'].map((h) => <th key={h} className="th">{h}</th>)}
            </tr></thead>
            <tbody>
              {kpis.map((k) => (
                <tr key={k.campaign_id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="td font-medium">{k.campaign_name}<div className="text-[11px] text-slate-400">{k.campaign_id}</div></td>
                  <td className="td"><span className={`tag ${statusCls[k.status] ?? statusCls.active}`}>{k.status ?? 'active'}</span></td>
                  <td className="td">{rs(k.spend_inr)}</td>
                  <td className="td">{n0(k.identified)}</td>
                  <td className="td">{n0(k.registrants)}</td>
                  <td className="td">{n0(k.visitors)}</td>
                  <td className={`td ${k.visitors && k.show_rate_pct !== null && k.show_rate_pct < 70 ? 'font-semibold text-red-700' : ''}`}>{k.visitors ? pct(k.show_rate_pct) : '–'}</td>
                  <td className="td">{rs1(k.cost_per_registrant)}</td>
                  {hasProj && <td className="td font-medium">{rs1(pf(k).projected)}</td>}
                  <td className="td text-slate-500">{rs1(k.cost_ceiling)}</td>
                  <td className="td">{rs1(k.cost_per_visitor)}</td>
                  <td className="td">{n0(k.opt_outs)}</td>
                  <td className="td"><span className={`tag ${flagClass[pf(k).flag]}`}>{pf(k).flag}</span></td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="td">Total (attributed)</td><td className="td" /><td className="td">{rs(totals.sp)}</td><td className="td" />
                <td className="td">{n0(totals.reg)}</td><td className="td">{n0(totals.vis)}</td>
                <td className="td">{totals.reg && totals.vis ? pct((100 * totals.vis) / totals.reg) : '–'}</td>
                <td className="td">{totals.reg ? rs1(totals.sp / totals.reg) : '–'}</td>{hasProj && <td className="td" />}<td className="td" />
                <td className="td">{totals.vis ? rs1(totals.sp / totals.vis) : '–'}</td><td className="td" colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {hasFunnel && <ReachFunnel kpis={kpis} />}
      {weekly.length > 0 && <WhatChanged kpis={kpis} weekly={weekly} />}
      {full && <WhatIf kpis={full.kpis} camps={full.camps} budget={full.budget} />}
    </div>
  );
}

// Reach → click → landing session → registration start → registrant → attendee, with the rate at each step.
function ReachFunnel({ kpis }: { kpis: ChannelKpi[] }) {
  const rows = kpis.filter((k) => (k.impressions ?? 0) > 0 || k.registrants > 0);
  const tot = rows.reduce((a, k) => ({ im: a.im + Number(k.impressions), cl: a.cl + Number(k.clicks), se: a.se + Number(k.sessions ?? 0), st: a.st + Number(k.registration_starts ?? 0), reg: a.reg + k.registrants, vis: a.vis + k.visitors }), { im: 0, cl: 0, se: 0, st: 0, reg: 0, vis: 0 });
  const cell = (v: number | null, worst: boolean) => <td className={`td ${worst && v !== null ? 'font-semibold text-red-700' : ''}`}>{v === null ? '–' : pct(v)}</td>;
  const anyVisitors = rows.some((k) => k.visitors > 0); // before the fest nobody has attended yet: show '–', not 0%
  const steps = (k: { im: number; cl: number; se: number; st: number; reg: number; vis: number }) => [rate(k.cl, k.im), rate(k.se, k.cl), rate(k.st, k.se), rate(k.reg, k.st), anyVisitors ? rate(k.vis, k.reg) : null];
  const all = rows.map((k) => steps({ im: Number(k.impressions), cl: Number(k.clicks), se: Number(k.sessions ?? 0), st: Number(k.registration_starts ?? 0), reg: k.registrants, vis: k.visitors }));
  const minIdx = [0, 1, 2, 3, 4].map((i) => { const vals = all.map((r) => r[i] ?? Infinity); return vals.indexOf(Math.min(...vals)); });
  return (
    <Section title="Reach funnel and conversion rates" sub="Impressions → clicks → landing sessions → registration starts → registrants → attendees, from the marketing and registration data [D]. Red = weakest channel at that step. Registrants are distinct people, so they can differ from form starts.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-200"><tr>
            {['Campaign', 'Impressions', 'Clicks', 'Sessions', 'Reg. starts', 'Click rate', 'Click → session', 'Session → start', 'Start → registrant', 'Registrant → attendee'].map((h) => <th key={h} className="th">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((k, i) => (
              <tr key={k.campaign_id} className="border-b border-slate-100">
                <td className="td font-medium">{k.campaign_name}</td>
                <td className="td">{n0(k.impressions)}</td><td className="td">{n0(k.clicks)}</td><td className="td">{n0(k.sessions)}</td><td className="td">{n0(k.registration_starts)}</td>
                {all[i].map((v, j) => <Fragment key={j}>{cell(v, minIdx[j] === i && rows.length > 1)}</Fragment>)}
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td className="td">Total</td><td className="td">{n0(tot.im)}</td><td className="td">{n0(tot.cl)}</td><td className="td">{n0(tot.se)}</td><td className="td">{n0(tot.st)}</td>
              {steps(tot).map((v, j) => <td key={j} className="td">{v === null ? '–' : pct(v)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// Week-on-week change by campaign for the as-of week, plus a trend chart for one campaign.
function WhatChanged({ kpis, weekly }: { kpis: ChannelKpi[]; weekly: ChannelWeek[] }) {
  const weeks = [...new Set(weekly.filter((w) => w.registrations > 0).map((w) => w.week_start))].sort();
  const [pick, setPick] = useState<string>('');
  const cur = weeks.includes(pick) ? pick : weeks[weeks.length - 1];
  const prev = weeks[weeks.indexOf(cur) - 1];
  const name = (id: string) => kpis.find((k) => k.campaign_id === id)?.campaign_name ?? id;
  const get = (wk: string | undefined, id: string) => weekly.find((w) => w.week_start === wk && w.campaign_id === id);
  const ids = [...new Set(weekly.map((w) => w.campaign_id))];
  const rows = ids.map((id) => {
    const a = get(cur, id), b = get(prev, id);
    return { id, reg: a?.registrations ?? 0, regPrev: b?.registrations ?? 0, sp: Number(a?.spend_inr ?? 0), cpr: a?.cost_per_registrant ?? null, cprPrev: b?.cost_per_registrant ?? null };
  }).map((r) => ({ ...r, d: r.reg - r.regPrev })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const tot = rows.reduce((a, r) => ({ reg: a.reg + r.reg, prev: a.prev + r.regPrev }), { reg: 0, prev: 0 });
  const top = rows[0];
  const [trend, setTrend] = useState(ids.includes('C02') ? 'C02' : ids[0]);
  const ceiling = kpis.find((k) => k.campaign_id === trend)?.cost_ceiling ?? null;
  const series = weekly.filter((w) => w.campaign_id === trend).map((w) => ({ label: wkLabel(w.week_start), reg: w.registrations, cpr: w.cost_per_registrant }));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="What changed this week" sub="Registrations and cost per registrant by campaign vs the week before [D]. Weekly cost is lumpy because spend is booked in batches."
        right={<select className="input py-0.5 text-xs" value={cur} onChange={(e) => setPick(e.target.value)} aria-label="Week">
          {weeks.map((w) => <option key={w} value={w}>Week of {wkLabel(w)}</option>)}
        </select>}>
        {prev ? <p className="mb-2 text-sm">
          Registrations <b>{n0(tot.reg)}</b> vs {n0(tot.prev)} the week before (<span className={tot.reg - tot.prev >= 0 ? 'text-emerald-700' : 'text-red-700'}>{tot.reg - tot.prev >= 0 ? '+' : ''}{n0(tot.reg - tot.prev)}</span>).
          {top && top.d !== 0 && <> Biggest mover: <b>{name(top.id)}</b> ({top.d > 0 ? '+' : ''}{n0(top.d)}).</>}
        </p> : <p className="mb-2 text-sm text-slate-500">First campaign week: nothing to compare yet.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200"><tr>{['Campaign', 'Registrations', 'Change', 'Spend', '₹ / registrant', 'Week before'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="td">{name(r.id)}</td><td className="td">{n0(r.reg)}</td>
                  <td className={`td font-semibold ${r.d > 0 ? 'text-emerald-700' : r.d < 0 ? 'text-red-700' : 'text-slate-400'}`}>{r.d > 0 ? '+' : ''}{n0(r.d)}</td>
                  <td className="td">{rs(r.sp)}</td><td className="td">{rs1(r.cpr)}</td><td className="td text-slate-500">{rs1(r.cprPrev)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Weekly trend" sub="Bars: registrations. Line: cost per registrant. Dashed: the campaign's cost ceiling [D]+[A]."
        right={<select className="input py-0.5 text-xs" value={trend} onChange={(e) => setTrend(e.target.value)} aria-label="Campaign for trend">
          {ids.map((id) => <option key={id} value={id}>{name(id)}</option>)}
        </select>}>
        <div className="h-72">
          <ResponsiveContainer>
            <ComposedChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="r" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, n) => (n === '₹ / registrant' ? rs1(v) : n0(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="r" dataKey="reg" name="Registrations" fill="#1a4380" isAnimationActive={false} />
              <Line yAxisId="c" dataKey="cpr" name="₹ / registrant" stroke="#d97706" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
              {ceiling !== null && <ReferenceLine yAxisId="c" y={ceiling} stroke="#dc2626" strokeDasharray="5 4" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  );
}

const MAX_PER_CHANNEL = 300000;

function WhatIf({ kpis, camps, budget }: { kpis: ChannelKpi[]; camps: { campaign_id: string; budget_2026_inr: number | null; status: string }[]; budget: number }) {
  const { askCopilot, refresh } = useApp();
  // only campaigns with 2025 history can be projected; new or unlisted campaigns have no baseline yet
  const base: ChannelBase[] = useMemo(() => kpis.filter((k) => Number(k.spend_inr) > 0 && k.registrants > 0).map((k) => ({
    campaign_id: k.campaign_id, campaign_name: k.campaign_name, spend_2025: Number(k.spend_inr), registrants_2025: k.registrants,
    show_rate_pct: (100 * k.visitors) / k.registrants,
  })), [kpis]);
  const noBase = kpis.filter((k) => !base.some((b) => b.campaign_id === k.campaign_id));
  const spend2025 = () => Object.fromEntries(base.map((b) => [b.campaign_id, b.spend_2025]));
  const plan2026 = () => Object.fromEntries(base.map((b) => {
    const c = camps.find((x) => x.campaign_id === b.campaign_id);
    return [b.campaign_id, c?.status === 'stopped' ? 0 : c?.budget_2026_inr ?? b.spend_2025];
  }));
  const [spend, setSpend] = useState<Record<string, number>>(spend2025);
  const [preset, setPreset] = useState<'2025' | 'plan' | 'custom'>('2025');
  const [msg, setMsg] = useState('');
  const set = (id: string, v: number) => { setPreset('custom'); setSpend({ ...spend, [id]: Math.min(MAX_PER_CHANNEL, Math.max(0, Math.round(Number.isFinite(v) ? v : 0))) }); };
  const before = projectPlan(base, {});
  const after = projectPlan(base, spend);
  const delta = after.attendees - before.attendees;
  const stretched = after.rows.filter((r) => r.new_spend > 3 * r.spend_2025);
  const planSpend = camps.reduce((a, c) => a + (c.status === 'stopped' ? 0 : Number(c.budget_2026_inr ?? 0)), 0);

  async function apply() {
    if (!window.confirm(`Set the 2026 budgets on Campaigns & tasks to this allocation (total ${rs(after.totalSpend)})?`)) return;
    for (const r of after.rows) {
      const { error } = await db.from('campaigns').update({ budget_2026_inr: r.new_spend }).eq('campaign_id', r.campaign_id);
      if (error) { setMsg('Error: ' + error.message); return; }
    }
    await audit('campaigns', 'apply_what_if', null, null, spend);
    setMsg('2026 budgets updated. See Campaigns & tasks.'); refresh();
  }

  return (
    <Section title="Budget what-if" sub={<>Starts from each channel's 2025 cost and show rate [D]. Spend above 2025 buys registrants at {MARGINAL_MULT}× the 2025 cost (diminishing returns) [A]; cuts scale down proportionally; walk-ins fixed at 125 [A]. Max ₹3,00,000 per channel.</>}
      right={<div className="flex gap-2">
        <button className={`text-xs ${preset === '2025' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setSpend(spend2025()); setPreset('2025'); }}>2025 spend</button>
        <button className={`text-xs ${preset === 'plan' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setSpend(plan2026()); setPreset('plan'); }}>2026 budgets</button>
      </div>}>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          {after.rows.map((r) => (
            <div key={r.campaign_id} className="grid grid-cols-12 items-center gap-2 text-sm">
              <span className="col-span-3 font-medium">{r.campaign_name}</span>
              <input type="range" min={0} max={150000} step={1000} value={Math.min(spend[r.campaign_id] ?? 0, 150000)} className="col-span-4 accent-navy-700"
                onChange={(e) => set(r.campaign_id, Number(e.target.value))} aria-label={`Spend ${r.campaign_name}`} />
              <input type="number" min={0} max={MAX_PER_CHANNEL} className="input col-span-2 py-0.5" value={spend[r.campaign_id] ?? 0} step={1000}
                onChange={(e) => set(r.campaign_id, Number(e.target.value))} aria-label={`Spend amount ${r.campaign_name}`} />
              <span className={`col-span-3 text-xs ${r.new_spend > 3 * r.spend_2025 ? 'text-amber-700' : 'text-slate-500'}`}>{n0(r.registrants)} reg · {n0(r.attendees)} att{r.new_spend > 3 * r.spend_2025 ? ' ⚠' : ''}</span>
            </div>
          ))}
          {noBase.length > 0 && <p className="text-xs text-slate-500">Not projected (no 2025 spend and registrations to start from): {noBase.map((k) => k.campaign_name).join(', ')}.</p>}
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
          <div className="text-xs text-slate-500">{after.totalSpend > budget ? `⚠ ${rs(after.totalSpend - budget)} over the ${rs(budget)} budget` : `${rs(budget - after.totalSpend)} of ${rs(budget)} unallocated`}</div>
          {stretched.length > 0 && <p className="mt-2 text-xs text-amber-800">⚠ {stretched.map((r) => r.campaign_name).join(', ')} at more than 3× last year's spend: the model is extrapolating well past the data, so treat the result as optimistic.</p>}
          {preset === 'plan' && <p className="mt-2 text-xs text-slate-600">These are the channel budgets only ({rs(planSpend)}). The 2026 plan's other levers sit outside channels: show-up programme and waitlist release, about +139 base [A] (see Bets).</p>}
          <button className="btn-primary mt-3 w-full justify-center text-xs" onClick={() => askCopilot(
            `Evaluate this budget plan with what_if_budget: ${JSON.stringify(spend)}. Is it a good reallocation versus 2025? What are the risks, and propose the tasks to execute it.`)}>
            Review this plan with copilot
          </button>
          <button className="btn-ghost mt-2 w-full justify-center text-xs" onClick={apply}>Apply as 2026 budgets</button>
          {msg && <p className="mt-1 text-xs text-navy-800">{msg}</p>}
        </div>
      </div>
    </Section>
  );
}

