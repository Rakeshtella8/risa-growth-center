// Copilot tools. Every number the chatbot states must come from one of these calls.
// The model never does arithmetic itself: it uses `calculate`, `what_if_budget` or SQL.
import type { SupabaseClient } from '@supabase/supabase-js';
import { projectPlan, ChannelBase, MARGINAL_MULT } from '../../src/lib/whatIf.js';
import { evaluate } from './calc.js';
import { evaluateBet } from '../../src/lib/bets.js';
import type { Bet, ChannelKpi, ChannelWeek } from '../../src/lib/types.js';

export interface Ctx {
  db: SupabaseClient;
  asOf: string | null;      // 'YYYY-MM-DD HH:mm:ss' or null = all data
  target: string;           // 2025_goal | 2026_base | 2026_stretch
}

type Json = Record<string, unknown>;

export const toolDefs = [
  fn('get_funnel', 'Whole-event funnel at the current as-of date: identified people, registrants, confirmed, cancelled, waitlisted, verified visitors, walk-ins, confirmed no-shows, show rate, marketing spend. Each metric comes with its definition, plus leaks_ranked (each leak with the attendees it could add back) and reading_notes. Use leaks_ranked for "biggest gap / which leak first".', {}),
  fn('get_channel_trend', 'Weekly registrations, spend and cost per registrant for each campaign (week_start Monday). Use for trends and what changed week on week.', {
    campaign_id: { type: 'string', description: 'Optional, e.g. C02' },
  }),
  fn('get_channel_kpis', 'Per campaign/channel: spend, impressions, clicks, landing sessions, registration starts (reach funnel), identified, registrants, confirmed, cancelled, visitors, show rate %, cost per registrant, cost per visitor, cost ceiling, opt-outs, red/amber/green flag.', {}),
  fn('get_weekly_pace', 'Weekly (Mon-Sun) registrations and spend with cumulative totals and cost per registrant, up to the as-of date.', {}),
  fn('get_forecast', 'Forecast vs the selected comparison target (or the one given). Before the fest: forecast_attendees counts only people already registered; projected_attendees adds the recent weekly run-rate for the weeks left [A]; pace_pct compares registrants with an even plan to date. Also gap, budget, spend so far.', {
    target_key: { type: 'string', enum: ['2025_goal', '2026_base', '2026_stretch'], description: 'Optional. Defaults to the target selected in the app.' },
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
  fn('what_if_budget', 'Projects registrants and attendees if channel budgets change, using each channel\'s 2025 cost per registrant and show rate, with 1.5x marginal cost above 2025 spend [assumption]. Give new total spend per campaign_id (C01 Campus Ambassadors, C02 Paid Social, C03 Creator Partners, C04 College Partnerships, C05 Student Referrals, C06 Organic Search, C07 Community Groups). Channels not listed keep 2025 spend.', {
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
  switch (name) {
    case 'get_funnel': {
      const rows = (await rpc(ctx, 'f_funnel', { p_as_of })) as { metric: string; value: number; definition?: string }[];
      const v = (k: string) => Number(rows.find((r) => r.metric === k)?.value ?? 0);
      const r1 = (x: number) => Math.round(x * 10) / 10;
      if (v('registrants')) rows.push({ metric: 'cost_per_registrant_inr', value: r1(v('marketing_spend_inr') / v('registrants')), definition: 'Marketing spend / external registrants' });
      if (v('registered_visitors')) rows.push({ metric: 'cost_per_attendee_inr', value: r1(v('marketing_spend_inr') / v('registered_visitors')), definition: 'Dashboard definition: marketing spend / campaign-driven (registered) verified visitors; walk-ins excluded because no campaign drove them' });
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
      const rows = (await rpc(ctx, 'f_channel_kpis', { p_as_of })) as Record<string, unknown>[];
      const { data: owners } = await ctx.db.from('campaigns').select('campaign_id,owner_name');
      const totSpend = rows.reduce((a, r) => a + Number(r.spend_inr ?? 0), 0);
      const totVis = rows.reduce((a, r) => a + Number(r.visitors ?? 0), 0);
      const own = new Map((owners ?? []).map((o: { campaign_id: string; owner_name: string }) => [o.campaign_id, o.owner_name]));
      const full = rows.map((r) => ({ ...r, owner_name: own.get(String(r.campaign_id)) ?? null,
        share_of_spend_pct: totSpend ? Math.round(Number(r.spend_inr) / totSpend * 1000) / 10 : null,
        share_of_attributed_visitors_pct: totVis ? Math.round(Number(r.visitors) / totVis * 1000) / 10 : null }));
      const columns = full.length ? Object.keys(full[0]).filter((c) => c !== 'channel') : [];
      return { as_of: ctx.asOf ?? 'all data',
        note: 'Table: each row lists values in the order of columns. cost_ceiling = max cost per registrant before the channel is flagged red (1.5x its 2025 cost; Paid Social = its 2025 average). A channel is above its ceiling only if cost_per_registrant > cost_ceiling.',
        columns, rows: full.map((r) => columns.map((c) => (r as Record<string, unknown>)[c])) };
    }
    case 'get_weekly_pace':
      return { as_of: ctx.asOf ?? 'all data', rows: await rpc(ctx, 'f_weekly_pace', { p_as_of }) };
    case 'get_channel_trend': {
      const rows = (await rpc(ctx, 'f_channel_weekly', { p_as_of })) as { campaign_id: string }[];
      return { as_of: ctx.asOf ?? 'all data', rows: args.campaign_id ? rows.filter((r) => r.campaign_id === args.campaign_id) : rows };
    }
    case 'get_forecast': {
      const key = (args.target_key as string) || ctx.target;
      const fc = (await rpc(ctx, 'f_forecast', { p_as_of, p_target: key })) as Record<string, unknown> | Record<string, unknown>[];
      const f = (Array.isArray(fc) ? fc[0] : fc) ?? {};
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
    case 'get_targets': {
      const { data, error } = await ctx.db.from('plan_targets').select('*');
      if (error) throw new Error(error.message);
      return data;
    }
    case 'get_bets': {
      // Same verdict logic as the Bets screen: bets 2 and 3 read their KPI live from channel data,
      // bets 1, 4 and 5 use the latest KPI reading the team entered.
      const [{ data, error }, kpis, weeks] = await Promise.all([ctx.db.from('v_bet_status').select('*'), rpc(ctx, 'f_channel_kpis', { p_as_of }), rpc(ctx, 'f_channel_weekly', { p_as_of }).catch(() => [])]);
      if (error) throw new Error(error.message);
      return { as_of: ctx.asOf ?? 'all data', bets: (data as Bet[]).map((b) => {
        const e = evaluateBet(b, kpis as ChannelKpi[], weeks as ChannelWeek[]);
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
      return { tables: byTable, functions: ['f_funnel(p_as_of)', 'f_channel_kpis(p_as_of)', 'f_weekly_pace(p_as_of)', 'f_forecast(p_as_of, p_target)', 'f_registrations(p_as_of)', 'f_visitors(p_as_of)', 'f_spend(p_as_of)'], views: ['c_people', 'c_ext_people', 'v_funnel', 'v_channel_kpis', 'v_weekly_pace', 'v_forecast', 'v_bet_status'] };
    }
    case 'run_sql':
      return await rpc(ctx, 'copilot_query', { q: String(args.query ?? '') });
    case 'calculate':
      return { expression: args.expression, result: evaluate(String(args.expression ?? '')) };
    case 'what_if_budget': {
      const kpis = (await rpc(ctx, 'f_channel_kpis', { p_as_of: null })) as Json[];
      const base: ChannelBase[] = kpis.map((k) => ({
        campaign_id: String(k.campaign_id), campaign_name: String(k.campaign_name),
        spend_2025: Number(k.spend_inr), registrants_2025: Number(k.registrants),
        show_rate_pct: Number(k.registrants) > 0 ? (100 * Number(k.visitors)) / Number(k.registrants) : 0,
      }));
      const spend = (args.spend ?? {}) as Record<string, number>;
      const before = projectPlan(base, {});
      const after = projectPlan(base, spend);
      const r1 = (x: number) => Math.round(x * 10) / 10;
      return {
        assumption: `Spend above the 2025 level buys registrants at ${MARGINAL_MULT}x the 2025 average cost; cuts scale down proportionally; walk-ins fixed at 125 [A]. Baseline = current data.`,
        before: { total_spend: before.totalSpend, registrants: r1(before.registrants), attendees: r1(before.attendees) },
        after: { total_spend: after.totalSpend, registrants: r1(after.registrants), attendees: r1(after.attendees) },
        delta: { spend: after.totalSpend - before.totalSpend, registrants: r1(after.registrants - before.registrants), attendees: r1(after.attendees - before.attendees) },
        by_channel: after.rows.filter((r) => spend[r.campaign_id] !== undefined).map((r) => ({
          campaign_id: r.campaign_id, campaign_name: r.campaign_name, spend_2025: r.spend_2025, new_spend: r.new_spend,
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
