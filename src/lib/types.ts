export interface FunnelRow { metric: string; value: number; definition: string }
export interface ChannelKpi {
  campaign_id: string; campaign_name: string; channel: string; status: string; spend_inr: number;
  impressions: number; clicks: number; sessions?: number; registration_starts?: number; identified: number; registrants: number; confirmed: number; cancelled: number;
  visitors: number; show_rate_pct: number | null; cost_per_registrant: number | null; cost_per_visitor: number | null;
  cost_ceiling: number | null; opt_outs: number; flag: string;
}
export interface WeekRow { week_start: string; registrations: number; cumulative_registrations: number; spend_inr: number; cumulative_spend: number; cost_per_registrant: number | null }
export interface Forecast {
  target_key: string; target_label: string; target_attendees: number; actual_visitors: number; registrants: number;
  open_registrants: number; assumed_show_rate_pct: number; walk_ins_assumed: number; forecast_attendees: number;
  gap_to_target: number; budget_inr: number; spend_to_date: number; note: string;
  // update 2 (optional so the app still works before the SQL update is applied)
  recent_weekly_registrations?: number | null; weeks_to_event?: number; projected_registrants?: number; projected_attendees?: number;
  projected_gap?: number; target_registrants?: number; expected_registrants_by_now?: number; pace_pct?: number | null;
}
export interface ChannelWeek { week_start: string; campaign_id: string; registrations: number; spend_inr: number; cost_per_registrant: number | null }
export interface AuditRow { id: number; table_name: string; row_ref: string | null; action: string; old_value: unknown; new_value: unknown; created_at: string }
export interface PlanTarget { target_key: string; label: string; identified: number; registrants: number; verified_attendees: number; budget_inr: number; source: string }
export interface Bet {
  bet_id: number; name: string; kpi_name: string; kpi_unit: string; base_attendees: number; stretch_attendees: number;
  budget_inr: number; owner_name: string; score: number; status: string; scale_if: string; change_if: string; stop_if: string;
  action_text: string; latest_kpi_value: number | null; latest_kpi_date: string | null; open_tasks: number; latest_kpi_note?: string | null;
}
export interface Task {
  id: number; title: string; description: string | null; owner_name: string | null; due_date: string | null; status: string;
  priority: string; bet_id: number | null; campaign_id: string | null; created_by: string; source_question: string | null;
  created_at: string; updated_at: string;
}
export const metric = (rows: FunnelRow[] | null, m: string) => Number(rows?.find((r) => r.metric === m)?.value ?? 0);
