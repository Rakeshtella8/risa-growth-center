import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, LabelList } from 'recharts';
import { useApp, useData } from '../lib/app';
import { rpc, db } from '../lib/supabase';
import { n0, n1, rs, pct, asOfLabel, dateLabel } from '../lib/format';
import { FunnelRow, Forecast, PaceWeek, PlanTarget, metric } from '../lib/types';
import { Kpi, Section, AskButton, Loading } from '../components/ui';

const short = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function Overview() {
  const { asOf, target, edition, ed, today, phase } = useApp();
  const { data, error } = useData(async () => {
    const [funnel, forecast, pace, targets] = await Promise.all([
      rpc<FunnelRow[]>('f_funnel', { p_as_of: asOf, p_edition: edition }),
      rpc<Forecast[]>('f_forecast', { p_as_of: asOf, p_target: target, p_edition: edition }),
      rpc<PaceWeek[]>('f_pace_compare', { p_as_of: asOf, p_edition: edition, p_target: target }),
      db.from('plan_targets').select('*').then((r) => (r.data ?? []) as PlanTarget[]),
    ]);
    return { funnel, forecast: forecast[0], pace, targets };
  }, [asOf, target]);
  if (!data) return <Loading error={error} />;
  const { funnel, forecast: f, pace, targets } = data;
  const t = targets.find((x) => x.target_key === target)!;
  const m = (k: string) => metric(funnel, k);
  const pre = phase === 'pre';
  const live = phase === 'live';
  const hasBase = !!ed.baseline_edition;
  const now = pace.filter((w) => w.cumulative !== null).at(-1);
  const lastYear = now?.last_cumulative ?? null;
  const vsLast = lastYear ? (100 * ((now?.cumulative ?? 0) - lastYear)) / lastYear : null;
  const chart = pace.map((w) => ({ ...w, label: short(w.week_start) }));

  const funnelRows = [
    { stage: 'Identified', v: m('identified_pre_event') },
    { stage: 'Registered', v: m('registrants') },
    { stage: 'Confirmed', v: m('confirmed') },
    ...(pre ? [{ stage: 'QR pass opened', v: m('qr_passes_downloaded') }] : [
      { stage: 'Attended (registered)', v: m('registered_visitors') },
      { stage: '+ Walk-ins', v: m('walk_in_visitors') },
      { stage: 'Verified attendees', v: m('verified_visitors') }]),
  ];
  const leaks = [
    { k: 'Identified but not registered', v: Math.max(m('identified_pre_event') - m('registrants'), 0), note: 'leads to convert' },
    pre ? { k: 'Confirmed, pass not opened', v: Math.max(m('confirmed') - m('qr_passes_downloaded'), 0), note: m('qr_passes_issued') ? 'likeliest no-shows: nudge them (Bet 1)' : 'no QR passes sent yet' }
      : { k: 'Confirmed but did not show', v: m('confirmed_no_shows'), note: live ? 'counted after the last fest day starts' : 'biggest bottom-of-funnel leak' },
    { k: 'On the waitlist', v: m('waitlisted'), note: pre ? `release if places free (capacity ${n0(m('capacity'))})` : 'never released, none attended' },
    { k: 'Cancelled', v: m('cancelled'), note: 'latest status cancelled' },
  ];
  const headline = pre ? f.projected_attendees ?? f.forecast_attendees : live ? f.forecast_attendees : f.actual_visitors;
  const headGap = pre ? f.projected_gap ?? f.gap_to_target : f.gap_to_target;
  const attendeeLabel = pre ? 'Projected attendees' : live ? 'Forecast attendees' : 'Verified attendees';
  const daysToFest = Math.ceil((new Date(ed.fest_day1).getTime() - new Date((asOf ?? today).slice(0, 10)).getTime()) / 864e5);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Overview</h1>
          <p className="text-sm text-slate-500">
            As of <b>{asOfLabel(asOf, today)}</b> · {pre ? <><b>{n0(daysToFest)} days</b> to the fest ({dateLabel(ed.fest_day1)})</> : live ? <b>Fest in progress</b> : <>Fest held {dateLabel(ed.fest_day1)}</>}
            {' '}· compared with <b>{t.label}</b> ({n0(t.verified_attendees)} attendees, {rs(t.budget_inr)} budget)
          </p>
        </div>
        <AskButton q="Are we on track against the selected target? If not, where is the biggest gap and what should we do first?" label="Are we on track?" />
      </div>
      {edition === '2026' && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          There is no real 2026 data yet. The weeks up to {dateLabel(ed.demo_clock)} are <b>simulated</b> from the 2025 campaign with assumed channel changes [A].
          Registrations, status changes and check-ins you make here are real and count at once. The Data screen can remove the simulated rows.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label={attendeeLabel} tag={pre || live ? 'A' : 'D'} value={n0(headline)} tone={headGap >= 0 ? 'good' : 'bad'}
          sub={<>{headGap >= 0 ? '+' : ''}{n0(headGap)} vs target {n0(f.target_attendees)}{pre && f.projected_attendees !== undefined
            ? (hasBase ? <> · registrants on course for {n0(f.projected_registrants)} (plan {n0(t.registrants)})</>
              : <> · {n0(f.forecast_attendees)} from people already registered, plus about {n0(f.recent_weekly_registrations)} registrations a week for the {n1(f.weeks_to_event)} weeks left</>)
            : live ? <> · {n0(f.actual_visitors)} verified so far</> : null}</>} />
        <Kpi label="External registrants" tag="D" value={n0(m('registrants'))} tone={pre ? ((f.pace_pct ?? 0) >= 100 ? 'good' : 'bad') : 'default'}
          sub={pre ? <>{pct(f.pace_pct ?? 0)} of plan pace ({n0(f.expected_registrants_by_now)} by now){vsLast !== null && <> · {vsLast >= 0 ? '+' : ''}{n1(vsLast)}% vs same week last year ({n0(lastYear)})</>}</>
            : <>target {n0(t.registrants)} · {pct((100 * m('registrants')) / t.registrants)} of target</>} />
        <Kpi label={pre ? 'Confirmed places' : 'Show rate'} tag="D" value={pre ? n0(m('confirmed')) : pct(m('show_rate_pct'))}
          sub={pre ? <>of {n0(m('capacity'))} capacity · {n0(m('waitlisted'))} waitlisted</> : 'registered attendees ÷ registrants'}
          tone={!pre && m('show_rate_pct') < 70 ? 'bad' : 'default'} />
        <Kpi label="Marketing spend" tag="D" value={rs(m('marketing_spend_inr'))} sub={<>of {rs(t.budget_inr)} budget · {pct((100 * m('marketing_spend_inr')) / t.budget_inr)}</>} />
        {pre
          ? <Kpi label="QR passes opened" tag="D" value={m('confirmed') ? pct((100 * m('qr_passes_downloaded')) / m('confirmed')) : '–'}
              tone={m('confirmed') && (100 * m('qr_passes_downloaded')) / m('confirmed') >= 85 ? 'good' : 'bad'}
              sub={<>{n0(m('qr_passes_downloaded'))} of {n0(m('confirmed'))} confirmed · Bet 1 scales at 85%</>} />
          : <Kpi label="Cost per attendee" tag="D" value={!m('registered_visitors') ? '–' : rs(m('marketing_spend_inr') / m('registered_visitors'))} sub="spend ÷ campaign-driven attendees" />}
      </div>
      <p className="text-xs text-slate-500">{pre ? (hasBase
          ? <>Projected attendees = projected registrants × {n1(ed.assumed_show_rate_pct)}% show rate (the plan's channel mix) + {n0(ed.assumed_walk_ins)} walk-ins [A]. Registrants are projected from how much of last year's season had arrived by this point, weighted by the planned channel budgets.{t.target_key === '2026_base' && <> The {n0(t.verified_attendees)} target also counts bet 1, the show-up programme and waitlist release (+139), which this projection leaves out.</>}{t.target_key === '2026_stretch' && <> The {n0(t.verified_attendees)} target also counts bet 1 show-up and waitlist (+202), bet 4 squad referral (+172) and bet 5 evening walk-ins (+300), which this projection leaves out.</>}</>
          : <>Projected attendees = people registered so far × {n1(ed.assumed_show_rate_pct)}% show rate + {n0(ed.assumed_walk_ins)} walk-ins, plus registrations at the last 3 weeks' pace until the fest [A].</>)
        : live ? <>Fest in progress. Forecast = the larger of people verified so far [D] and registrants × {n1(ed.assumed_show_rate_pct)}% show rate + {n0(ed.assumed_walk_ins)} walk-ins [A].</> : <>Final count of people verified at the gate [D].</>}</p>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <Section title={hasBase ? 'Registrations: this year vs same week last year' : 'Registrations vs plan'}
            sub={`Bars: new external registrants per campaign week [D]. Teal: cumulative this year.${hasBase ? ' Grey dashed: cumulative at the same week last year [D].' : ''} ${hasBase ? ` Amber dashed: plan pace to ${n0(t.registrants)} registrants, following last year's season curve weighted by the planned channel budgets [A].` : ` Amber dashed: even pace to ${n0(t.registrants)} registrants [A].`}`}
            right={<AskButton q="Compare this year's registrations with the same week last year and the plan. Which channel explains the difference?" label="Why the gap?" />}>
            <div className="h-72">
              <ResponsiveContainer>
                <ComposedChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="w" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, name) => [v === null || v === undefined ? '–' : n0(v), String(name)]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="w" dataKey="registrations" name="Registrations / week" fill="#1a4380" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="c" dataKey="cumulative" name="Cumulative" stroke="#0f766e" strokeWidth={2} dot={false} connectNulls={false} />
                  {hasBase && <Line yAxisId="c" dataKey="last_cumulative" name="Last year, same week" stroke="#94a3b8" strokeDasharray="4 3" dot={false} />}
                  <Line yAxisId="c" dataKey="plan_cumulative" name="Plan pace" stroke="#d97706" strokeDasharray="6 4" dot={false} />
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

      <Section title="Where people leak" sub="People who stopped short of the next stage [D]. Click a card to work on them in Attendees."
        right={<AskButton q="Rank the funnel leaks by size and tell me which one to fix first, with numbers." label="Which leak first?" />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {leaks.map((l) => (
            <a key={l.k} href="#attendees" className="rounded-lg border border-slate-200 p-3 hover:border-navy-700">
              <div className="text-2xl font-bold text-red-700">{n0(l.v)}</div>
              <div className="text-sm font-medium">{l.k}</div>
              <div className="text-xs text-slate-500">{l.note}</div>
            </a>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {m('participants') + m('spectators') > 0 ? <>Participants: {n0(m('participants'))} · spectators: {n0(m('spectators'))} (from the registration form) · </> : <>Participant / spectator split not recorded in this data · </>}reminders sent: {n0(m('reminders_sent'))}
          {' '}· cost per registrant: {m('registrants') ? '₹' + n1(m('marketing_spend_inr') / m('registrants')) : '–'}
          {!pre && <> · attendees on both days: {n0(m('multi_day_visitors'))} · walk-ins: {n0(m('walk_in_visitors'))}</>}
        </p>
      </Section>
    </div>
  );
}
