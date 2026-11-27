import { describe, it, expect } from 'vitest';
import { evaluateBet, weeklyVolume, readingRange } from './bets';
import type { Bet, ChannelKpi, ChannelWeek } from './types';

const bet = (id: number, v: number | null = null) => ({ bet_id: id, latest_kpi_value: v } as unknown as Bet);
const kpi = (id: string, cpr: number) => ({ campaign_id: id, cost_per_registrant: cpr } as unknown as ChannelKpi);
const wk = (d: string, r: number): ChannelWeek => ({ week_start: d, campaign_id: 'C04', registrations: r, spend_inr: 0, cost_per_registrant: null });

describe('bet verdicts', () => {
  it('bet 3: below, at and above the ₹137 ceiling', () => {
    expect(evaluateBet(bet(3), [kpi('C02', 120)]).verdict).toBe('scale');
    expect(evaluateBet(bet(3), [kpi('C02', 135)]).verdict).toBe('change');
    expect(evaluateBet(bet(3), [kpi('C02', 137)]).verdict).toBe('change');
    expect(evaluateBet(bet(3), [kpi('C02', 137.5)]).verdict).toBe('stop');
  });
  it('bet 2: cheap but low volume is change, not scale', () => {
    const low = [wk('2025-03-24', 80), wk('2025-03-31', 70)];
    const high = [wk('2025-03-24', 90), wk('2025-03-31', 100)];
    expect(evaluateBet(bet(2), [kpi('C04', 90)], low).verdict).toBe('change');
    expect(evaluateBet(bet(2), [kpi('C04', 90)], high).verdict).toBe('scale');
    expect(evaluateBet(bet(2), [kpi('C04', 120)], high).verdict).toBe('change');
    expect(evaluateBet(bet(2), [kpi('C04', 150)], high).verdict).toBe('stop');
    expect(weeklyVolume(high, 'C04')).toBe(95);
  });
  it('manual readings: ranges per bet', () => {
    expect(readingRange(1)?.max).toBe(100);
    expect(readingRange(4)?.max).toBe(5);
    expect(readingRange(2)).toBeNull();
    expect(evaluateBet(bet(4, 0.27), []).verdict).toBe('scale');
    expect(evaluateBet(bet(1, 78), []).verdict).toBe('change');
  });
});
