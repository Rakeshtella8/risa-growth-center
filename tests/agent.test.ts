// Agent + tools against the local emulator (scripts/dev-postgrest.mjs). The LLM is scripted, so these
// tests check that tools return correct, current numbers and that the safety rails hold.
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { runAgent, CompleteFn } from '../api/_lib/agent';
import { runTool, Ctx } from '../api/_lib/tools';
import type { ChatMsg } from '../api/_lib/llm';

const URL = process.env.DEV_API || 'http://localhost:54321';
const db = createClient(URL, 'dev-anon-key', { auth: { persistSession: false } });
const ctx: Ctx = { db, asOf: null, target: '2026_base', edition: '2025' };
const fake = [{ name: 'fake', url: '', key: 'x', model: 'scripted' }];

// scripted model: calls the given tools in turn, then answers with a summary of what it saw
function scripted(calls: { name: string; args: object }[]): CompleteFn {
  let i = 0;
  return async (_p, messages: ChatMsg[]) => {
    if (i < calls.length) {
      const c = calls[i++];
      return { role: 'assistant', content: null, tool_calls: [{ id: 't' + i, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }] };
    }
    const last = messages.filter((m) => m.role === 'tool').map((m) => m.content).join(' | ');
    return { role: 'assistant', content: 'ANSWER ' + last.slice(0, 200) };
  };
}

const metric = (m: Record<string, number>, k: string) => Number(m[k]);

describe('copilot tools (live local data)', () => {
  beforeAll(async () => { await db.rpc('reset_to_original'); });

  it('funnel matches the audited 2025 numbers', async () => {
    const f = (await runTool(ctx, 'get_funnel', {})) as { metrics: Record<string, number> };
    expect(metric(f.metrics, 'verified_visitors')).toBe(2050);
    expect(metric(f.metrics, 'registrants')).toBe(2800);
    expect(metric(f.metrics, 'confirmed_no_shows')).toBe(575);
    expect(metric(f.metrics, 'marketing_spend_inr')).toBe(274000);
  });

  it('ranks leaks by attendees recoverable and never lists walk-ins', async () => {
    const f = (await runTool(ctx, 'get_funnel', {})) as { leaks_ranked: { leak: string; people: number; attendees_if_recovered: number }[] };
    expect(f.leaks_ranked.map((l) => l.people)).toEqual([575, 700, 183, 88]);
    expect(f.leaks_ranked[0].attendees_if_recovered).toBe(575);
    expect(f.leaks_ranked[1].attendees_if_recovered).toBe(482);
    expect(f.leaks_ranked.some((l) => /walk/i.test(l.leak))).toBe(false);
  });

  it('2026 tools: simulated weeks vs same week last year, attendee list', async () => {
    const c26 = { ...ctx, edition: '2026' };
    const p = (await runTool(c26, 'get_pace_vs_last_year', {})) as { columns: string[]; rows: unknown[][] };
    const wk7 = p.rows.find((r) => r[0] === 7)!;
    expect(wk7[p.columns.indexOf('cumulative')]).toBe(1203);
    expect(wk7[p.columns.indexOf('last_cumulative')]).toBe(1348);
    const a = (await runTool(c26, 'get_attendees', { status: 'waitlisted' })) as { total: number; rows: unknown[][] };
    const f = (await runTool(c26, 'get_funnel', {})) as { metrics: Record<string, number> };
    expect(f.metrics.registrants).toBe(1203);
    expect(Number(a.total)).toBe(f.metrics.waitlisted);
  });

  it('2026 forecast splits the gap between channels and bets left out of the projection', async () => {
    const c26 = { ...ctx, edition: '2026', target: '2026_base' };
    const f = (await runTool(c26, 'get_forecast', {})) as { projected_gap: number; gap_breakdown: Record<string, number> };
    const g = f.gap_breakdown;
    expect(g.plan_channel_registrants).toBe(3117);
    expect(g.from_bets_not_in_projection).toBe(-139);
    expect(Math.abs(g.from_channels_vs_plan + g.from_bets_not_in_projection - f.projected_gap)).toBeLessThanOrEqual(2);
    const s = (await runTool({ ...c26, target: '2026_stretch' }, 'get_forecast', {})) as { gap_breakdown: Record<string, number> };
    expect(s.gap_breakdown.from_bets_not_in_projection).toBe(-674);
  });

  it('as-of date changes the answer', async () => {
    const f = (await runTool({ ...ctx, asOf: '2025-03-16 23:59:59' }, 'get_funnel', {})) as { metrics: Record<string, number> };
    expect(metric(f.metrics, 'marketing_spend_inr')).toBe(193375);
    expect(metric(f.metrics, 'verified_visitors')).toBe(0);
  });

  it('forecast compares against the chosen target', async () => {
    const f = (await runTool(ctx, 'get_forecast', { target_key: '2025_goal' })) as { gap_to_target: number };
    expect(f.gap_to_target).toBe(-150);
  });

  it('mid-campaign forecast projects the run-rate and reports pace', async () => {
    const f = (await runTool({ ...ctx, asOf: '2025-03-09 23:59:59' }, 'get_forecast', { target_key: '2026_base' })) as { registrants: number; pace_pct: number; projected_attendees: number; forecast_attendees: number };
    expect(f.registrants).toBe(1348);
    expect(f.pace_pct).toBeGreaterThan(70); expect(f.pace_pct).toBeLessThan(76);
    expect(f.projected_attendees).toBeGreaterThan(f.forecast_attendees); // adds the run-rate for the weeks left
  });

  it('what-if reproduces the 2026 channel engine', async () => {
    const w = (await runTool(ctx, 'what_if_budget', { spend: { C04: 75000, C01: 60000, C05: 40000, C06: 25000, C07: 25000, C02: 30000, C03: 15000 } })) as { after: { registrants: number } };
    expect(Math.round(w.after.registrants)).toBe(3117);
  });

  it('run_sql answers ad-hoc questions', async () => {
    const r = (await runTool(ctx, 'run_sql', { query: "select count(distinct person_id) n from interactions where event_type='brochure_download'" })) as { rows: { n: number }[] };
    expect(r.rows[0].n).toBeGreaterThan(0);
  });

  it('run_sql cannot write or escape', async () => {
    await expect(runTool(ctx, 'run_sql', { query: 'delete from tasks' })).rejects.toThrow(/Only SELECT/);
    await expect(runTool(ctx, 'run_sql', { query: 'select 1; drop table tasks' })).rejects.toThrow(/one statement/);
    await expect(runTool(ctx, 'run_sql', { query: 'select * from chat_log' })).rejects.toThrow(/permission/);
  });

  it('calculate is exact', async () => {
    const r = (await runTool(ctx, 'calculate', { expression: '93000/680' })) as { result: number };
    expect(r.result).toBeCloseTo(136.764706, 5);
  });

  it('changed data flows through: +Rs 10k Paid Social spend', async () => {
    await db.from('daily_marketing').insert({ activity_id: 'TEST-AG', campaign_id: 'C02', activity_date: '2025-03-01 00:00:00', marketing_spend_inr: 10000 });
    const k = (await runTool(ctx, 'get_channel_kpis', {})) as { columns: string[]; rows: unknown[][] };
    const row = k.rows.find((r) => r[k.columns.indexOf('campaign_id')] === 'C02')!;
    expect(row[k.columns.indexOf('cost_per_registrant')]).toBe(151.5);
    await db.rpc('reset_to_original');
  });
});

describe('agent loop', () => {
  it('runs tools, returns trace and proposals, never writes tasks itself', async () => {
    const before = await db.from('tasks').select('id');
    const r = await runAgent(ctx, [{ role: 'user', content: 'Move 10k from creators to referrals' }], 'base', '',
      scripted([{ name: 'what_if_budget', args: { spend: { C03: 49000, C05: 29000 } } },
                { name: 'propose_task', args: { title: 'Shift Rs 10k Creators -> Referrals', description: 'x' } }]), fake);
    expect(r.trace.map((t) => t.tool)).toEqual(['what_if_budget', 'propose_task']);
    expect(r.proposals).toHaveLength(1);
    const after = await db.from('tasks').select('id');
    expect(after.data!.length).toBe(before.data!.length);
  });

  it('reports tool errors to the model instead of crashing', async () => {
    const r = await runAgent(ctx, [{ role: 'user', content: 'x' }], 'base', '', scripted([{ name: 'run_sql', args: { query: 'drop table tasks' } }]), fake);
    expect(r.trace[0].ok).toBe(false);
    expect(r.answer).toContain('Only SELECT');
  });

  it('falls back to the next provider on 429', async () => {
    let calls = 0;
    const flaky: CompleteFn = async (p) => {
      calls++;
      if (p.name === 'first') { const e = new Error('rate') as Error & { status: number }; e.status = 429; throw e; }
      return { role: 'assistant', content: 'from second' };
    };
    const r = await runAgent(ctx, [{ role: 'user', content: 'hi' }], 'base', '', flaky,
      [{ name: 'first', url: '', key: 'x', model: 'a' }, { name: 'second', url: '', key: 'y', model: 'b' }]);
    expect(r.answer).toBe('from second');
    expect(r.model).toBe('second:b');
    expect(calls).toBe(2);
  });

  it('answers honestly when no provider is configured', async () => {
    const r = await runAgent(ctx, [{ role: 'user', content: 'hi' }], 'base', '', scripted([]), []);
    expect(r.error).toBe('no_provider');
  });
});
