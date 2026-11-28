// Copilot tools. Every number the chatbot states must come from one of these calls.
// The model never does arithmetic itself: it uses `calculate`, `what_if_budget` or SQL.
import type { SupabaseClient } from '@supabase/supabase-js';
import { projectPlan, ChannelBase, MARGINAL_MULT } from '../../src/lib/whatIf.js';
import { evaluate } from './calc.js';
import { evaluateBet } from '../../src/lib/bets.js';
import { projectedFlag } from '../../src/lib/flags.js';
import type { Bet, ChannelKpi, ChannelProjection, ChannelWeek, FunnelRow } from '../../src/lib/types.js';

export interface Ctx {
  db: SupabaseClient;
  asOf: string | null;      // 'YYYY-MM-DD HH:mm:ss' or null = today in the fest year
  target: string;           // 2025_goal | 2026_base | 2026_stretch
  edition?: string;         // fest year: '2026' (live) or '2025' (replay); default 2026
}

type Json = Record<string, unknown>;

export const toolDefs = [
  fn('get_funnel', 'Whole-event funnel at the current as-of date: identified people, registrants, confirmed, cancelled, waitlisted, verified visitors, walk-ins, confirmed no-shows, show rate, marketing spend, capacity, QR passes issued/opened (qr_passes_downloaded), confirmed_pass_not_opened, qr_open_rate_pct, reminders sent, participants/spectators. Use it for ANY count; never count rows with run_sql when a metric exists. Each metric comes with its definition, plus leaks_ranked (each leak with the attendees it could add back) and reading_notes. Use leaks_ranked for "biggest gap / which leak first".', {}),
  fn('get_channel_trend', 'Weekly registrations, spend and cost per registrant for each campaign (week_start Monday). Use for trends and what changed week on week.', {
    campaign_id: { type: 'string', description: 'Optional, e.g. C02' },
  }),
  fn('get_channel_kpis', 'Per campaign/channel: spend, impressions, clicks, landing sessions, registration starts (reach funnel), identified, registrants, confirmed, cancelled, visitors, show rate %, cost per registrant, cost per visitor, cost ceiling, opt-outs, red/amber/green flag.', {}),
  fn('get_weekly_pace', 'Weekly (Mon-Sun) registrations and spend with cumulative totals and cost per registrant, up to the as-of date.', {}),
  fn('get_forecast', 'Forecast vs the selected comparison target (or the one given). Before the fest: forecast_attendees counts only people already registered; projected_registrants / projected_attendees project the season (see note and reading_notes) [A]; pace_pct compares registrants with the plan to date. Also gap, budget, spend so far. Read reading_notes before saying which bet closes a gap.', {
    target_key: { type: 'string', enum: ['2025_goal', '2026_base', '2026_stretch'], description: 'Optional. Defaults to the target selected in the app.' },
  }),
  fn('get_pace_vs_last_year', 'This fest year week by week (campaign week 1 = campaign start) against the same campaign week last year and an even plan to the selected target: registrations per week, cumulative this year, cumulative last year, plan cumulative. Use for "are we ahead of last year?"', {}),
  fn('get_attendees', 'Attendee management list for this fest year: people with their latest status (confirmed, waitlisted, cancelled, interested, lead, walk-in), role, sport, college, source campaign, pass sent/opened, reminders, checked in. Filter by status or search text. Returns at most 20 rows plus the total. For counts (how many confirmed, passes opened, waitlisted) use get_funnel, not this list.', {
    status: { type: 'string', enum: ['all', 'confirmed', 'no_pass', 'waitlisted', 'cancelled', 'interested', 'lead', 'attended', 'walk-in'] },
    search: { type: 'string', description: 'Optional name, college or pass code' },
  }),
  fn('get_targets', 'All comparison targets (2025 goal, 2026 base, 2026 stretch) with identified, registrants, verified attendees, budget and source.', {}),
  fn('get_bets', 'The 5 growth bets with KPI, base/stretch attendee impact, budget, owner, score, status, scale/change/stop thresholds, latest KPI reading and open tasks.', {}),
  fn('list_tasks', 'Tasks in the campaign manager (title, owner, due date, status, priority, linked bet/campaign).', {
    status: { type: 'string', enum: ['open', 'todo', 'doing', 'done', 'blocked'], description: 'Optional filter. open = everything not done (todo, doing, blocked)' },
  }),
  fn('get_data_dictionary', 'Lists every table and column available. Use it to check whether the data CAN answer a question before saying it cannot.', {}),
  fn('run_sql', 'Read-only SQL (one SELECT or WITH statement, Postgres) over the tables and views. Max 200 rows returned. Raw tables contain duplicates and non-external people: for people counts, prefer the f_* functions or views (c_ext_people, f_registrations(null), f_visitors(null), f_spend(null)) which apply the counting rules.', {
    query: { type: 'string', description: 'A single SELECT/WITH statement' },
  }, ['query']),
  fn('calculate', 'Exact arithmetic. Use for EVERY derived number (differences, ratios, percentages, sums). Supports + - * / ( ) and numbers.', {
    expression: { type: 'string', description: 'e.g. (93000+59000)/274000*100' },
  }, ['expression']),
  fn('what_if_budget', 'Projects registrants and attendees if channel budgets change, using each channel\'s 2025 cost per registrant and show rate, with 1.5x marginal cost above 2025 spend [assumption]. Give new total spend per campaign_id (C01 Campus Ambassadors, C02 Paid Social, C03 Creator Partners, C04 College Partnerships, C05 Student Referrals, C06 Organic Search, C07 Community Groups). In the 2026 fest year, channels not listed keep their 2026 planned budget (returned as planned_budgets; base plan C01 60000, C02 30000, C03 15000, C04 75000, C05 40000, C06 25000, C07 25000), so "move 10k from Creators to Referrals" = {"C03": 5000, "C05": 50000}. In the 2025 replay they keep 2025 spend.', {
    spend: { type: 'object', additionalProperties: { type: 'number' }, description: 'e.g. {"C03": 49000, "C05": 29000}' },
  }, ['spend']),
  fn('propose_task', 'Propose a task for the campaign manager. This does NOT create it: the user sees a card and must click Confirm. Use after recommending an action.', {
    title: { type: 'string' },
    description: { type: 'string' },
    owner_name: { type: 'string' },
    due_date: { type: 'string', description: 'YYYY-MM-DD' },
    priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    bet_id: { type: 'integer', description: '1-5, optional' },
    campaign_id: { type: 'string', description: 'C01-C07, optional' },
  }, ['title', 'description']),
] as const;

function fn(name: string, description: string, properties: Json, required: string[] = []) {
  return { type: 'function' as const, function: { name, description, parameters: { type: 'object', properties, required } } };
}

async function rpc(ctx: Ctx, name: string, args: Json) {
  const { data, error } = await ctx.db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function runTool(ctx: Ctx, name: string, args: Json): Promise<unknown> {
  const p_as_of = ctx.asOf;
  const p_edition = ctx.edition ?? '2026';
  switch (name) {
    case 'get_funnel': {
      const rows = (await rpc(ctx, 'f_funnel', { p_as_of, p_edition })) as { metric: string; value: number; definition?: string }[];
      const v = (k: string) => Number(rows.find((r) => r.metric === k)?.value ?? 0);
      const r1 = (x: number) => Math.round(x * 10) / 10;
      if (v('registrants')) rows.push({ metric: 'cost_per_registrant_inr', value: r1(v('marketing_spend_inr') / v('registrants')), definition: 'Marketing spend / external registrants' });
      if (v('registered_visitors')) rows.push({ metric: 'cost_per_attendee_inr', value: r1(v('marketing_spend_inr') / v('registered_visitors')), definition: 'Dashboard definition: marketing spend / campaign-driven (registered) verified visitors; walk-ins excluded because no campaign drove them' });
      if (v('qr_passes_issued')) {
        rows.push({ metric: 'confirmed_pass_not_opened', value: Math.max(v('confirmed') - v('qr_passes_downloaded'), 0), definition: 'Confirmed (latest status) minus people who opened their QR pass: likeliest no-shows (Bet 1)' });
        rows.push({ metric: 'qr_open_rate_pct', value: v('confirmed') ? r1((100 * v('qr_passes_downloaded')) / v('confirmed')) : 0, definition: 'QR passes opened / confirmed. Bet 1 scales at 85%' });
      }
      // Leaks ranked by attendees they could add back. Walk-ins are NOT a leak: they add attendees.
      const sr = v('show_rate_pct') / 100 || 0.688;
      const leaks = [
        { leak: 'Identified (pre-event) but never registered', people: Math.max(v('identified_pre_event') - v('registrants'), 0), attendees_if_recovered: 0, how: 'people x show rate [A]' },
        { leak: 'Confirmed but did not attend (no-shows)', people: v('confirmed_no_shows'), attendees_if_recovered: v('confirmed_no_shows'), how: 'already confirmed, each one recovered is one attendee [A]' },
        { leak: 'Cancelled (latest status)', people: v('cancelled'), attendees_if_recovered: 0, how: 'people x show rate [A]' },
        { leak: 'Stuck on waitlist (never released)', people: v('waitlisted'), attendees_if_recovered: 0, how: 'people x show rate [A]' },
      ].map((l) => ({ ...l, attendees_if_recovered: l.attendees_if_recovered || Math.round(l.people * sr) }))
        .filter((l) => l.people > 0).sort((a, b) => b.attendees_if_recovered - a.attendees_if_recovered);
      // Compact form keeps the free models under their tokens-per-minute limits; definitions live in get_data_dictionary.
      const metrics = Object.fromEntries(rows.map((r) => [r.metric, Number(r.value)]));
      return { as_of: ctx.asOf ?? 'all data', metrics, leaks_ranked: leaks,
        reading_notes: [
          'There is NO show-rate target. The only benchmark is the red-flag threshold: show rate below 70% is red. 2025 actual show rate is show_rate_pct.',
          'walk_in_visitors are extra attendees who never registered; they are not a leak and add to verified_visitors.',
          'verified_visitors = registered_visitors + walk_in_visitors.',
          'attendees_if_recovered is an upper bound at the 2025 show rate, not a forecast [A].',
          'show_rate_pct = registered_visitors / registrants. identified_pre_event = campaign leads; identified_people also counts walk-ins. confirmed/cancelled/waitlisted = latest registration status. confirmed_no_shows = latest status confirmed but never a verified visitor.',
          'cost_per_attendee_inr = spend / registered_visitors (walk-ins excluded: no campaign drove them).',
        ] };
    }
    case 'get_channel_kpis': {
      const rows = (await rpc(ctx, 'f_channel_kpis', { p_as_of, p_edition })) as Record<string, unknown>[];
      const { data: owners } = await ctx.db.from('campaigns').select('campaign_id,owner_name');
      const totSpend = rows.reduce((a, r) => a + Number(r.spend_inr ?? 0), 0);
      const totVis = rows.reduce((a, r) => a + Number(r.visitors ?? 0), 0);
      const own = new Map((owners ?? []).map((o: { campaign_id: string; owner_name: string }) => [o.campaign_id, o.owner_name]));
      const proj = (await rpc(ctx, 'f_channel_projection', { p_as_of, p_edition }).catch(() => [])) as ChannelProjection[];
      const hasProj = proj.some((p) => p.projected_cost_per_registrant !== null);
      const full = rows.map((r0) => {
        const p = proj.find((x) => x.campaign_id === r0.campaign_id);
        const pf = projectedFlag(r0 as unknown as ChannelKpi, p);
        const r = hasProj ? { ...r0, cost_per_registrant_so_far: r0.cost_per_registrant, cost_per_registrant: undefined,
          projected_registrants: p?.projected_registrants ?? null, plan_registrants: p?.plan_registrants ?? null, planned_budget: p?.budget ?? null,
          projected_cost_per_registrant: pf.projected, flag: pf.flag, flag_reason: pf.reason,
          show_rate_pct: Number(r0.visitors) > 0 ? r0.show_rate_pct : null } : r0;
        return ({ ...r, owner_name: own.get(String(r.campaign_id)) ?? null,
        share_of_spend_pct: totSpend ? Math.round(Number(r.spend_inr) / totSpend * 1000) / 10 : null,
        share_of_attributed_visitors_pct: totVis ? Math.round(Number(r.visitors) / totVis * 1000) / 10 : null }); });
      const columns = full.length ? Object.keys(full[0]).filter((c) => c !== 'channel' && !(hasProj && c === 'cost_per_registrant')) : [];
      return { as_of: ctx.asOf ?? 'all data',
        note: 'Table: each row lists values in the order of columns. cost_ceiling = max cost per registrant before the channel is flagged red (1.5x its 2025 cost; Paid Social = its 2025 average). A channel is above its ceiling only if cost_per_registrant > cost_ceiling.' + (hasProj
          ? ' Mid-season (2026): flag and ceiling checks use projected_cost_per_registrant = planned_budget / projected_registrants [A] (same as the Bets screen and Slide 3): red above the ceiling or show rate < 70%, amber within 5% of it, green below. cost_per_registrant_so_far runs high mid-season because spend comes before registrations; do not judge a channel on it. Quote flag_reason. show_rate_pct is null before the fest (nobody has attended yet), which is not a red flag.' : ''),
        columns, rows: full.map((r) => columns.map((c) => (r as Record<string, unknown>)[c])) };
    }
    case 'get_weekly_pace':
      return { as_of: ctx.asOf ?? 'all data', rows: await rpc(ctx, 'f_weekly_pace', { p_as_of, p_edition }) };
    case 'get_channel_trend': {
      const rows = (await rpc(ctx, 'f_channel_weekly', { p_as_of, p_edition })) as { campaign_id: string }[];
      return { as_of: ctx.asOf ?? 'all data', rows: args.campaign_id ? rows.filter((r) => r.campaign_id === args.campaign_id) : rows };
    }
    case 'get_forecast': {
      const key = (args.target_key as string) || ctx.target;
      const fc = (await rpc(ctx, 'f_forecast', { p_as_of, p_target: key, p_edition })) as Record<string, unknown> | Record<string, unknown>[];
      const f = (Array.isArray(fc) ? fc[0] : fc) ?? {};
      if ('pace_pct' in f && String(f.edition) === '2026') {
        // Split the projected gap into (a) channels projected above/below their planned registrants and
        // (b) bets the projection does not include, so the copilot never credits one bet with the whole gap.
        const plan = (await rpc(ctx, 'f_channel_plan', { p_edition })) as Record<string, unknown>[];
        const planRegs = Math.round(plan.reduce((a, r) => a + Number(r.plan_registrants ?? 0), 0));
        const show = Number(f.assumed_show_rate_pct ?? 0) / 100;
        const walk = Number(f.walk_ins_assumed ?? 0);
        const projRegs = Number(f.projected_registrants ?? 0);
        const target = Number(f.target_attendees ?? 0);
        const planAtt = Math.round(planRegs * show + walk);
        const channelPart = Math.round((projRegs - planRegs) * show);
        const notInProjection = target - planAtt;
        const betsText = key === '2026_stretch' ? 'bet 1 show-up and waitlist (+202), bet 4 squad referral (+172) and bet 5 evening walk-ins (+300)' : 'bet 1 show-up programme and waitlist release (+139)';
        const short = projRegs - planRegs;
        const gap_breakdown = {
          projected_gap: f.projected_gap,
          planned_from_bets_not_in_projection: notInProjection,
          gap_left_if_those_bets_deliver: channelPart,
          channels_vs_plan_registrants: short,
          plan_channel_registrants: planRegs,
          summary: `Projected gap ${f.projected_gap}. The target counts ${betsText}, which the projection leaves out: if they deliver as planned they close ${notInProjection} of it, leaving ${channelPart}. That remainder is the channels: projected ${projRegs} registrants vs the plan's ${planRegs} (${short >= 0 ? '+' : ''}${short}) x ${f.assumed_show_rate_pct}% show rate. So the bets do NOT create a surplus; closing the last ${Math.abs(channelPart)} needs channels back on plan or a bet beyond plan.`,
          how_to_read: 'Quote summary. Do not add the bets on top of the gap a second time: they are already inside the target.',
        };
        // Lead with the season projection; rename the registered-so-far figures so they are not read as the forecast.
        const { forecast_attendees, gap_to_target, ...rest } = f as Record<string, unknown>;
        const headline = {
          target_attendees: target, projected_attendees: f.projected_attendees, projected_gap: f.projected_gap,
          projected_registrants: projRegs, pace_pct: f.pace_pct,
          answer_with_these: 'Use projected_attendees and projected_gap for "are we on track / how far off". attendees_from_registered_so_far is NOT a forecast: it only counts people registered by today and ignores the 5 weeks of registrations still to come.',
        };
        return { headline, gap_breakdown, ...rest, attendees_from_registered_so_far: forecast_attendees, gap_if_no_one_else_registers: gap_to_target, reading_notes: [
        'projected_registrants and projected_attendees are projections [A], not data [D]. The method is in note: registrants so far divided by the share of the season last year had in by now, weighted by the planned channel budgets.',
        'The projection already assumes the planned channel budgets run as planned, which is bets 2 and 3 (contingent engine 876 registrants, paid cut to retargeting). Do not count bet 2 or 3 again to close the gap.',
        'The 2026 base target 2,670 = 2,406 from the channel plan + 125 walk-ins + 139 from bet 1 (show-up programme 63 + waitlist release 76). The projection leaves bet 1 out, so bet 1 closes 139 of a base gap; the rest is channels short of plan (see gap_breakdown). Stretch 3,205 adds bet 1 at +202, bet 4 squad referral +172 and bet 5 pro-nights +300.',
        'If projected_registrants is below the plan registrants, name the channels behind plan with get_bets or run_sql on f_channel_projection (projected vs plan registrants per channel), then the bet that owns them.',
        'Use gap_breakdown for "why the gap / what closes it": never credit one bet with the whole gap.',
      ] };
      }
      if (!ctx.asOf || Number(f.open_registrants ?? 0) === 0 || 'pace_pct' in f) return f; // update 2 computes projection + pace in SQL
      // Mid-campaign: the forecast only counts people registered so far, so also report pace against an even
      // weekly plan (12 campaign weeks, 20 Jan - 13 Apr) - that is the fair "on track?" test before the fest.
      const { data: tr } = await ctx.db.from('plan_targets').select('registrants').eq('target_key', key);
      const t = (tr ?? [])[0] as { registrants?: number } | undefined;
      const start = Date.UTC(2025, 0, 20);
      const weeks = Math.min(12, Math.max(0, (new Date(ctx.asOf.replace(' ', 'T') + 'Z').getTime() - start) / (7 * 864e5)));
      const expected = Math.round((t?.registrants ?? 0) / 12 * weeks);
      const regs = Number(f.registrants ?? 0);
      return { ...f, pace: { campaign_weeks_elapsed: Math.round(weeks * 10) / 10, target_registrants: t?.registrants, expected_registrants_by_now_even_pace: expected,
        registrants_so_far: regs, pace_pct: expected ? Math.round(regs / expected * 1000) / 10 : null,
        how_to_read: 'pace_pct >= 100 means on track for the registrant target at an even weekly pace [A]; forecast_attendees excludes registrations still to come' } };
    }
    case 'get_pace_vs_last_year': {
      const rows = (await rpc(ctx, 'f_pace_compare', { p_as_of, p_edition, p_target: ctx.target })) as Json[];
      return { edition: p_edition, as_of: ctx.asOf ?? 'today', note: 'registrations/cumulative are null for weeks after today; last_* = same campaign week of the baseline year [D]; plan_cumulative = even pace to the target [A]',
        columns: ['week_no', 'week_start', 'registrations', 'cumulative', 'last_registrations', 'last_cumulative', 'plan_cumulative'],
        rows: rows.map((r) => [r.week_no, r.week_start, r.registrations, r.cumulative, r.last_registrations, r.last_cumulative, r.plan_cumulative]) };
    }
    case 'get_attendees': {
      const rows = (await rpc(ctx, 'f_attendees', { p_edition, p_q: args.search ?? null, p_status: args.status ?? 'all', p_limit: 20, p_offset: 0 })) as Json[];
      const cols = ['person_name', 'status', 'role', 'sport', 'college', 'campaign_id', 'registration_id', 'registered_at', 'pass_issued', 'pass_opened', 'reminders', 'attended', 'is_simulated'];
      return { edition: p_edition, total: rows[0]?.total ?? 0, returned: rows.length, columns: cols, rows: rows.map((r) => cols.map((c) => r[c])) };
    }
    case 'get_targets': {
      const { data, error } = await ctx.db.from('plan_targets').select('*');
      if (error) throw new Error(error.message);
      return data;
    }
    case 'get_bets': {
      // Same verdict logic as the Bets screen: bets 2 and 3 read their KPI live from channel data,
      // bets 1, 4 and 5 use the latest KPI reading the team entered.
      const [{ data, error }, kpis, weeks, funnel, proj] = await Promise.all([ctx.db.from('v_bet_status').select('*'), rpc(ctx, 'f_channel_kpis', { p_as_of, p_edition }),
        rpc(ctx, 'f_channel_weekly', { p_as_of, p_edition }).catch(() => []), rpc(ctx, 'f_funnel', { p_as_of, p_edition }), rpc(ctx, 'f_channel_projection', { p_as_of, p_edition }).catch(() => [])]);
      if (error) throw new Error(error.message);
      return { as_of: ctx.asOf ?? 'all data', bets: (data as Bet[]).map((b) => {
        const e = evaluateBet(b, kpis as ChannelKpi[], weeks as ChannelWeek[], funnel as FunnelRow[], proj as ChannelProjection[]);
        return { bet_id: b.bet_id, name: b.name, owner_name: b.owner_name, status: b.status, kpi_name: b.kpi_name,
          kpi_value: e.value, kpi_unit: e.unit, kpi_source: e.source === 'manual reading' && /simulated/i.test(b.latest_kpi_note ?? '') ? 'SIMULATED sample reading, not real data [A]' : e.source, verdict: e.verdict, thresholds: e.why,
          scale_if: b.scale_if, change_if: b.change_if, stop_if: b.stop_if, base_attendees: b.base_attendees, stretch_attendees: b.stretch_attendees,
          budget_inr: b.budget_inr, score: b.score, open_tasks: b.open_tasks };
      }) };
    }
    case 'list_tasks': {
      let q = ctx.db.from('tasks').select('id,title,description,owner_name,due_date,status,priority,bet_id,campaign_id,created_by').order('id');
      if (args.status === 'open') q = q.neq('status', 'done');
      else if (args.status) q = q.eq('status', args.status as string);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data;
    }
    case 'get_data_dictionary': {
      const { data, error } = await ctx.db.from('v_data_dictionary').select('*');
      if (error) throw new Error(error.message);
      const byTable: Record<string, string[]> = {};
      for (const r of data as { table_name: string; column_name: string }[]) (byTable[r.table_name] ??= []).push(r.column_name);
      return { tables: byTable, functions: ['f_funnel(p_as_of, p_edition)', 'f_channel_kpis(p_as_of, p_edition)', 'f_weekly_pace(p_as_of, p_edition)', 'f_pace_compare(p_as_of, p_edition, p_target)', 'f_forecast(p_as_of, p_target, p_edition)', 'f_registrations(p_as_of, p_edition)', 'f_visitors(p_as_of, p_edition)', 'f_spend(p_as_of, p_edition)', 'f_people(p_as_of, p_edition)', 'f_attendees(p_edition, p_q, p_status, p_limit, p_offset)'], views: ['c_people', 'c_ext_people', 'v_bet_status'],
        note: 'Rows of every fest year live in the same tables; the functions filter to one edition by date window (editions table). Always pass the edition.' };
    }
    case 'run_sql':
      return await rpc(ctx, 'copilot_query', { q: String(args.query ?? '') });
    case 'calculate':
      return { expression: args.expression, result: evaluate(String(args.expression ?? '')) };
    case 'what_if_budget': {
      const kpis = (await rpc(ctx, 'f_channel_kpis', { p_as_of: null, p_edition: '2025' })) as Json[];
      const base: ChannelBase[] = kpis.map((k) => ({
        campaign_id: String(k.campaign_id), campaign_name: String(k.campaign_name),
        spend_2025: Number(k.spend_inr), registrants_2025: Number(k.registrants),
        show_rate_pct: Number(k.registrants) > 0 ? (100 * Number(k.visitors)) / Number(k.registrants) : 0,
      }));
      // 2026: start from the planned channel budgets (the deck's base plan); channels not named keep their plan budget.
      let plan: Record<string, number> = {};
      if (ctx.edition !== '2025') {
        const { data: camps } = await ctx.db.from('campaigns').select('campaign_id,budget_2026_inr');
        for (const c of (camps ?? []) as { campaign_id: string; budget_2026_inr: number | null }[]) if (c.budget_2026_inr !== null) plan[c.campaign_id] = Number(c.budget_2026_inr);
      }
      const usePlan = Object.keys(plan).length > 0;
      const spend = (args.spend ?? {}) as Record<string, number>;
      const before = projectPlan(base, usePlan ? plan : {});
      const after = projectPlan(base, usePlan ? { ...plan, ...spend } : spend);
      const r1 = (x: number) => Math.round(x * 10) / 10;
      return {
        assumption: `Spend above the 2025 level buys registrants at ${MARGINAL_MULT}x the 2025 average cost; cuts scale down proportionally; each channel keeps its 2025 show rate; walk-ins fixed at 125 [A]. ` + (usePlan
          ? 'Baseline = the 2026 planned channel budgets (before = the plan, 3,117 registrants); channels not named keep their plan budget. These are season totals, not results to date.'
          : 'Baseline = the full 2025 campaign.'),
        planned_budgets: usePlan ? plan : undefined,
        before: { total_spend: before.totalSpend, registrants: r1(before.registrants), attendees: r1(before.attendees) },
        after: { total_spend: after.totalSpend, registrants: r1(after.registrants), attendees: r1(after.attendees) },
        delta: { spend: after.totalSpend - before.totalSpend, registrants: r1(after.registrants - before.registrants), attendees: r1(after.attendees - before.attendees) },
        by_channel: after.rows.filter((r) => spend[r.campaign_id] !== undefined).map((r) => ({
          campaign_id: r.campaign_id, campaign_name: r.campaign_name, spend_2025: r.spend_2025, planned_spend: usePlan ? plan[r.campaign_id] : undefined, new_spend: r.new_spend,
          registrants: r1(r.registrants), attendees: r1(r.attendees), marginal_cost_per_registrant: r1(r.marginal_cost_per_registrant),
        })),
      };
    }
    case 'propose_task':
      return { status: 'proposed_awaiting_user_confirmation', task: args };
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
