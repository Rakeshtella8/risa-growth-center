// Budget what-if model. Same rules as analysis/target_model.py, step 1:
//  - each channel starts from its own 2025 cost per registrant and show rate [D]
//  - spend ABOVE the 2025 level buys registrants at MARGINAL_MULT x the 2025 average cost [A]
//  - spend cuts scale registrants down proportionally
export const MARGINAL_MULT = 1.5;

export interface ChannelBase {
  campaign_id: string;
  campaign_name: string;
  spend_2025: number;
  registrants_2025: number;
  show_rate_pct: number; // 0-100
}

export interface ChannelResult extends ChannelBase {
  new_spend: number;
  effective_spend: number;
  registrants: number;
  attendees: number;
  marginal_cost_per_registrant: number;
}

export function projectChannel(c: ChannelBase, newSpend: number, mult = MARGINAL_MULT): ChannelResult {
  const s0 = c.spend_2025;
  const eff = s0 <= 0 ? 0 : newSpend >= s0 ? s0 + (newSpend - s0) / mult : Math.max(newSpend, 0);
  const regs = s0 <= 0 ? 0 : (c.registrants_2025 * eff) / s0;
  const cpr = c.registrants_2025 > 0 ? s0 / c.registrants_2025 : 0;
  return {
    ...c,
    new_spend: newSpend,
    effective_spend: eff,
    registrants: regs,
    attendees: (regs * c.show_rate_pct) / 100,
    marginal_cost_per_registrant: newSpend > s0 ? cpr * mult : cpr,
  };
}

export function projectPlan(channels: ChannelBase[], spend: Record<string, number>, walkIns = 125, mult = MARGINAL_MULT) {
  const rows = channels.map((c) => projectChannel(c, spend[c.campaign_id] ?? c.spend_2025, mult));
  const registrants = rows.reduce((a, r) => a + r.registrants, 0);
  const channelAttendees = rows.reduce((a, r) => a + r.attendees, 0);
  const totalSpend = rows.reduce((a, r) => a + r.new_spend, 0);
  return { rows, registrants, channelAttendees, walkIns, attendees: channelAttendees + walkIns, totalSpend };
}

export const PLAN_2026_SPEND: Record<string, number> = {
  C04: 75000, C01: 60000, C05: 40000, C06: 25000, C07: 25000, C02: 30000, C03: 15000,
};
