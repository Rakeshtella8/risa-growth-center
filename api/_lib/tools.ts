// Copilot tools. Every number the chatbot states must come from one of these calls.
// The model never does arithmetic itself: it uses `calculate`, `what_if_budget` or SQL.
import type { SupabaseClient } from '@supabase/supabase-js';
import { projectPlan, ChannelBase, MARGINAL_MULT } from '../../src/lib/whatIf.js';
import { evaluate } from './calc.js';

export interface Ctx {
  db: SupabaseClient;
  asOf: string | null;      // 'YYYY-MM-DD HH:mm:ss' or null = all data
  target: string;           // 2025_goal | 2026_base | 2026_stretch
}

type Json = Record<string, unknown>;

export const toolDefs = [
  fn('get_funnel', 'Whole-event funnel at the current as-of date: identified people, registrants, confirmed, cancelled, waitlisted, verified visitors, walk-ins, confirmed no-shows, show rate, marketing spend. Each metric comes with its definition.', {}),
  fn('get_channel_kpis', 'Per campaign/channel: spend, impressions, clicks, identified, registrants, confirmed, cancelled, visitors, show rate %, cost per registrant, cost per visitor, cost ceiling, opt-outs, red/amber/green flag.', {}),
  fn('get_weekly_pace', 'Weekly (Mon-Sun) registrations and spend with cumulative totals and cost per registrant, up to the as-of date.', {}),
  fn('get_forecast', 'Forecast of verified attendees vs the selected comparison target (or the one given), with gap to target, budget and spend so far.', {
    target_key: { type: 'string', enum: ['2025_goal', '2026_base', '2026_stretch'], description: 'Optional. Defaults to the target selected in the app.' },
  }),
  fn('get_targets', 'All comparison targets (2025 goal, 2026 base, 2026 stretch) with identified, registrants, verified attendees, budget and source.', {}),
  fn('get_bets', 'The 5 growth bets with KPI, base/stretch attendee impact, budget, owner, score, status, scale/change/stop thresholds, latest KPI reading and open tasks.', {}),
  fn('list_tasks', 'Tasks in the campaign manager (title, owner, due date, status, priority, linked bet/campaign).', {
    status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked'], description: 'Optional filter' },
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
      return { as_of: ctx.asOf ?? 'all data', rows };
    }
    case 'get_channel_kpis': {
      const rows = (await rpc(ctx, 'f_channel_kpis', { p_as_of })) as Record<string, unknown>[];
      const { data: owners } = await ctx.db.from('campaigns').select('campaign_id,owner_name');
      const own = new Map((owners ?? []).map((o: { campaign_id: string; owner_name: string }) => [o.campaign_id, o.owner_name]));
      return { as_of: ctx.asOf ?? 'all data', note: 'cost_ceiling = max cost per registrant before the channel is flagged red (1.5x its 2025 cost; Paid Social = its 2025 average)',
        rows: rows.map((r) => ({ ...r, owner_name: own.get(String(r.campaign_id)) ?? null })) };
    }
    case 'get_weekly_pace':
      return { as_of: ctx.asOf ?? 'all data', rows: await rpc(ctx, 'f_weekly_pace', { p_as_of }) };
    case 'get_forecast': {
      const key = (args.target_key as string) || ctx.target;
      const fc = (await rpc(ctx, 'f_forecast', { p_as_of, p_target: key })) as Record<string, unknown> | Record<string, unknown>[];
      const f = (Array.isArray(fc) ? fc[0] : fc) ?? {};
      if (!ctx.asOf || Number(f.open_registrants ?? 0) === 0) return f;
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
      const { data, error } = await ctx.db.from('v_bet_status').select('*');
      if (error) throw new Error(error.message);
      return data;
    }
    case 'list_tasks': {
      let q = ctx.db.from('tasks').select('id,title,description,owner_name,due_date,status,priority,bet_id,campaign_id,created_by').order('id');
      if (args.status) q = q.eq('status', args.status as string);
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
