import { describe, it, expect } from 'vitest';
import { projectPlan, PLAN_2026_SPEND, ChannelBase } from './whatIf';

// 2025 baselines from v_channel_kpis [D]; show rate = visitors / registrants, unrounded
const base: ChannelBase[] = [
  { campaign_id: 'C04', campaign_name: 'College Partnerships', spend_2025: 31000, registrants_2025: 450, show_rate_pct: 100*385/450 },
  { campaign_id: 'C01', campaign_name: 'Campus Ambassadors', spend_2025: 42000, registrants_2025: 520, show_rate_pct: 100*390/520 },
  { campaign_id: 'C05', campaign_name: 'Student Referrals', spend_2025: 19000, registrants_2025: 350, show_rate_pct: 100*275/350 },
  { campaign_id: 'C06', campaign_name: 'Organic Search', spend_2025: 14000, registrants_2025: 250, show_rate_pct: 100*195/250 },
  { campaign_id: 'C07', campaign_name: 'Community Groups', spend_2025: 16000, registrants_2025: 200, show_rate_pct: 100*165/200 },
  { campaign_id: 'C02', campaign_name: 'Paid Social', spend_2025: 93000, registrants_2025: 680, show_rate_pct: 100*340/680 },
  { campaign_id: 'C03', campaign_name: 'Creator Partners', spend_2025: 59000, registrants_2025: 350, show_rate_pct: 100*175/350 },
];

describe('what-if model', () => {
  it('reproduces 2025 when spend is unchanged', () => {
    const p = projectPlan(base, {});
    expect(Math.round(p.registrants)).toBe(2800);
    expect(Math.round(p.attendees)).toBe(2050);
    expect(p.totalSpend).toBe(274000);
  });
  it('reproduces the 2026 base channel engine (target_model.py: 3,117 registrants, 2,406 attendees)', () => {
    const p = projectPlan(base, PLAN_2026_SPEND);
    expect(Math.round(p.registrants)).toBe(3117);
    expect(p.channelAttendees).toBeCloseTo(2406.5, 0);
    expect(p.totalSpend).toBe(270000);
  });
  it('applies diminishing returns above 2025 spend', () => {
    const p = projectPlan(base, { C04: 62000 });
    const cp = p.rows.find((r) => r.campaign_id === 'C04')!;
    expect(Math.round(cp.registrants)).toBe(750); // 450 * (31000 + 31000/1.5)/31000
  });
});
