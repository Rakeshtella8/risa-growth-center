import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, LabelList } from 'recharts';
import { useApp, useData } from '../lib/app';
import { rpc, db } from '../lib/supabase';
import { n0, n1, rs, pct, asOfLabel } from '../lib/format';
import { FunnelRow, Forecast, WeekRow, PlanTarget, metric } from '../lib/types';
import { Kpi, Section, AskButton, Loading } from '../components/ui';

const CAMPAIGN_WEEKS = 12; // 20 Jan – 13 Apr 2025

export default function Overview() {
  const { asOf, target } = useApp();
  const { data, error } = useData(async () => {
    const [funnel, forecast, weeks, targets] = await Promise.all([
      rpc<FunnelRow[]>('f_funnel', { p_as_of: asOf }),
      rpc<Forecast[]>('f_forecast', { p_as_of: asOf, p_target: target }),
      rpc<WeekRow[]>('f_weekly_pace', { p_as_of: asOf }),
      db.from('plan_targets').select('*').then((r) => (r.data ?? []) as PlanTarget[]),
    ]);
    return { funnel, forecast: forecast[0], weeks, targets };
  }, [asOf, target]);
  if (!data) return <Loading error={error} />;
  const { funnel, forecast: f, weeks, targets } = data;
  const t = targets.find((x) => x.target_key === target)!;
  const m = (k: string) => metric(funnel, k);
  const pre = f.open_registrants > 0;
  const regPacePerWeek = t.registrants / CAMPAIGN_WEEKS;
  const weekRows = weeks.filter((w) => w.registrations > 0 || w.spend_inr > 0).map((w, i) => ({
    ...w, label: new Date(w.week_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    pace: Math.round(regPacePerWeek * (i + 1)),
  }));
  const funnelRows = [
    { stage: 'Identified (campaigns)', v: m('identified_pre_event') },
    { stage: 'Registered', v: m('registrants') },
    { stage: 'Confirmed (latest status)', v: m('confirmed') },
    { stage: 'Attended (registered)', v: m('registered_visitors') },
    { stage: '+ Walk-ins', v: m('walk_in_visitors') },
    { stage: 'Verified attendees', v: m('verified_visitors') },
  ];
  const leaks = [
    { k: 'Identified but never registered', v: Math.max(m('identified_pre_event') - m('registrants'), 0), note: 'leads that never converted' },
    pre ? { k: 'Confirmed, not yet attended', v: m('confirmed'), note: 'at 2025 rates ~31% will not show [A]' }
      : { k: 'Confirmed but did not show', v: m('confirmed_no_shows'), note: 'biggest bottom-of-funnel leak' },
    { k: 'Stuck on waitlist', v: m('waitlisted'), note: 'never released, none attended' },
    { k: 'Cancelled', v: m('cancelled'), note: 'latest status cancelled' },
  ];
  const attendeeLabel = pre ? 'Forecast attendees' : 'Verified attendees';
  const gapTone = f.gap_to_target >= 0 ? 'good' : 'bad';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Campaign overview</h1>
          <p className="text-sm text-slate-500">As of <b>{asOfLabel(asOf)}</b> · compared with <b>{t.label}</b> ({n0(t.verified_attendees)} attendees, {rs(t.budget_inr)} budget)</p>
        </div>
        <AskButton q="Are we on track against the selected target? If not, where is the biggest gap and what should we do first?" label="Are we on track?" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label={attendeeLabel} tag={pre ? 'A' : 'D'} value={n0(f.forecast_attendees)} tone={gapTone}
          sub={<>{f.gap_to_target >= 0 ? '+' : ''}{n0(f.gap_to_target)} vs target {n0(f.target_attendees)}{pre && ' · registrants × 68.8% + 125 walk-ins'}</>} />
        <Kpi label="External registrants" tag="D" value={n0(m('registrants'))} sub={<>target {n0(t.registrants)} · {pct((100 * m('registrants')) / t.registrants)} of target</>} />
        <Kpi label="Show rate" tag="D" value={pre ? '–' : pct(m('show_rate_pct'))} sub={pre ? 'known after the fest' : 'registered visitors ÷ registrants'} tone={!pre && m('show_rate_pct') < 70 ? 'bad' : 'default'} />
        <Kpi label="Marketing spend" tag="D" value={rs(m('marketing_spend_inr'))} sub={<>of {rs(t.budget_inr)} budget · {pct((100 * m('marketing_spend_inr')) / t.budget_inr)}</>} />
        <Kpi label="Cost per attendee" tag="D" value={pre || !m('registered_visitors') ? '–' : rs(m('marketing_spend_inr') / m('registered_visitors'))} sub="spend ÷ campaign-driven attendees" />
      </div>
      <p className="text-xs text-slate-500">{f.note}</p>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <Section title="Weekly registrations vs pace" sub={`Bars: new external registrants per week (Mon–Sun) [D]. Line: cumulative. Dashed: even pace to ${n0(t.registrants)} registrants over 12 weeks [A].`}
            right={<AskButton q="Which week had the worst return on spend and why? Use the weekly pace data." label="Worst week?" />}>
            <div className="h-72">
              <ResponsiveContainer>
                <ComposedChart data={weekRows} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="w" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, name) => [n0(v), String(name)]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="w" dataKey="registrations" name="Registrations / week" fill="#1a4380" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="c" dataKey="cumulative_registrations" name="Cumulative" stroke="#0f766e" strokeWidth={2} dot={false} />
                  <Line yAxisId="c" dataKey="pace" name="Target pace" stroke="#d97706" strokeDasharray="6 4" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </div>
        <div className="xl:col-span-2">
          <Section title="Funnel" sub="Distinct external people [D]">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={funnelRows} layout="vertical" margin={{ left: 40, right: 40 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="stage" width={150} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => n0(v)} />
                  <Bar dataKey="v" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                    {funnelRows.map((r, i) => <Cell key={i} fill={i === funnelRows.length - 1 ? '#0f766e' : '#1a4380'} />)}
                    <LabelList dataKey="v" position="right" formatter={(v: unknown) => n0(v)} style={{ fontSize: 11 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </div>
      </div>

      <Section title="Where people leak" sub="The cheapest attendees are people we already have [D]"
        right={<AskButton q="Rank the funnel leaks by size and tell me which one to fix first, with numbers." label="Which leak first?" />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {leaks.map((l) => (
            <div key={l.k} className="rounded-lg border border-slate-200 p-3">
              <div className="text-2xl font-bold text-red-700">{n0(l.v)}</div>
              <div className="text-sm font-medium">{l.k}</div>
              <div className="text-xs text-slate-500">{l.note}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Visitors on both days: {n0(m('multi_day_visitors'))} · walk-ins: {n0(m('walk_in_visitors'))} · identified incl. walk-ins: {n0(m('identified_people'))} · cost per registrant: {m('registrants') ? '₹' + n1(m('marketing_spend_inr') / m('registrants')) : '–'}</p>
      </Section>
    </div>
  );
}
