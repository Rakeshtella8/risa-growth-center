// Agent + tools against the local emulator (scripts/dev-postgrest.mjs). The LLM is scripted, so these
// tests check that tools return correct, current numbers and that the safety rails hold.
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { runAgent, CompleteFn } from '../api/_lib/agent';
import { runTool, Ctx } from '../api/_lib/tools';
import type { ChatMsg } from '../api/_lib/llm';

const URL = process.env.DEV_API || 'http://localhost:54321';
const db = createClient(URL, 'dev-anon-key', { auth: { persistSession: false } });
const ctx: Ctx = { db, asOf: null, target: '2026_base' };
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

const metric = (rows: { metric: string; value: number }[], m: string) => Number(rows.find((r) => r.metric === m)!.value);

describe('copilot tools (live local data)', () => {
  beforeAll(async () => { await db.rpc('reset_to_original'); });

  it('funnel matches the audited 2025 numbers', async () => {
    const f = (await runTool(ctx, 'get_funnel', {})) as { rows: { metric: string; value: number }[] };
    expect(metric(f.rows, 'verified_visitors')).toBe(2050);
    expect(metric(f.rows, 'registrants')).toBe(2800);
    expect(metric(f.rows, 'confirmed_no_shows')).toBe(575);
    expect(metric(f.rows, 'marketing_spend_inr')).toBe(274000);
  });

  it('as-of date changes the answer', async () => {
    const f = (await runTool({ ...ctx, asOf: '2025-03-16 23:59:59' }, 'get_funnel', {})) as { rows: { metric: string; value: number }[] };
    expect(metric(f.rows, 'marketing_spend_inr')).toBe(193375);
    expect(metric(f.rows, 'verified_visitors')).toBe(0);
  });

  it('forecast compares against the chosen target', async () => {
    const f = (await runTool(ctx, 'get_forecast', { target_key: '2025_goal' })) as { gap_to_target: number };
    expect(f.gap_to_target).toBe(-150);
  });

  it('mid-campaign forecast reports pace against an even weekly plan', async () => {
    const f = (await runTool({ ...ctx, asOf: '2025-03-10 00:00:00' }, 'get_forecast', { target_key: '2026_base' })) as { pace: { expected_registrants_by_now_even_pace: number; registrants_so_far: number; pace_pct: number } };
    expect(f.pace.expected_registrants_by_now_even_pace).toBe(1818); // 3,117 / 12 x 7 weeks
    expect(f.pace.registrants_so_far).toBe(1348);
    expect(f.pace.pace_pct).toBe(74.1);
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
    const k = (await runTool(ctx, 'get_channel_kpis', {})) as { rows: { campaign_id: string; cost_per_registrant: number }[] };
    expect(k.rows.find((r) => r.campaign_id === 'C02')!.cost_per_registrant).toBe(151.5);
    await db.rpc('reset_to_original');
  });
});

describe('agent loop', () => {
  it('runs tools, returns trace and proposals, never writes tasks itself', async () => {
    const before = await db.from('tasks').select('id');
    const r = await runAgent(ctx, [{ role: 'user', content: 'Move 10k from creators to referrals' }], 'base',
      scripted([{ name: 'what_if_budget', args: { spend: { C03: 49000, C05: 29000 } } },
                { name: 'propose_task', args: { title: 'Shift Rs 10k Creators -> Referrals', description: 'x' } }]), fake);
    expect(r.trace.map((t) => t.tool)).toEqual(['what_if_budget', 'propose_task']);
    expect(r.proposals).toHaveLength(1);
    const after = await db.from('tasks').select('id');
    expect(after.data!.length).toBe(before.data!.length);
  });

  it('reports tool errors to the model instead of crashing', async () => {
    const r = await runAgent(ctx, [{ role: 'user', content: 'x' }], 'base', scripted([{ name: 'run_sql', args: { query: 'drop table tasks' } }]), fake);
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
    const r = await runAgent(ctx, [{ role: 'user', content: 'hi' }], 'base', flaky,
      [{ name: 'first', url: '', key: 'x', model: 'a' }, { name: 'second', url: '', key: 'y', model: 'b' }]);
    expect(r.answer).toBe('from second');
    expect(r.model).toBe('second:b');
    expect(calls).toBe(2);
  });

  it('answers honestly when no provider is configured', async () => {
    const r = await runAgent(ctx, [{ role: 'user', content: 'hi' }], 'base', scripted([]), []);
    expect(r.error).toBe('no_provider');
  });
});
