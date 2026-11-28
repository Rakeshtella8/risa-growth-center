// Channel flag on the projected end-of-campaign cost per registrant, the same yardstick the Bets screen and Slide 3 use.
// Cost-to-date runs high mid-season because spend comes before registrations, so it is only used when there is no projection
// (the 2025 replay, where SQL's f_channel_kpis flag applies).
import type { ChannelKpi, ChannelProjection } from './types';

export interface ProjFlag { projected: number | null; flag: string }

export function projectedFlag(k: ChannelKpi, p: ChannelProjection | undefined): ProjFlag {
  const v = p?.projected_cost_per_registrant;
  if (v === null || v === undefined || k.cost_ceiling === null) return { projected: null, flag: k.flag };
  const ceil = Number(k.cost_ceiling);
  const lowShow = k.visitors > 0 && k.show_rate_pct !== null && k.show_rate_pct < 70;
  const flag = Number(v) > ceil || lowShow ? 'red' : Number(v) >= ceil * 0.95 ? 'amber' : 'green';
  return { projected: Number(v), flag };
}
