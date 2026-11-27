#!/usr/bin/env bash
# Regression tests for the metric layer. Usage: PSQL="psql <conn>" tests/test_views.sh
set -u
Q() { $PSQL -At -v ON_ERROR_STOP=1 -c "$1"; }
pass=0; fail=0
check() { # name expected actual
  if [ "$2" == "$3" ]; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1: expected $2 got $3"; fi; }
fm() { Q "select value from f_funnel($1) where metric='$2'"; }

Q "select reset_to_original()" >/dev/null
# 1. Baseline numbers match analysis/diagnose.py
check visitors 2050 "$(fm null verified_visitors)"
check registrants 2800 "$(fm null registrants)"
check no_shows 575 "$(fm null confirmed_no_shows)"
check waitlist 88 "$(fm null waitlisted)"
check spend 274000 "$(fm null marketing_spend_inr)"
check walkins 125 "$(fm null walk_in_visitors)"
check identified 3625 "$(fm null identified_people)"
check show_rate 68.8 "$(fm null show_rate_pct)"
check paid_cpv 273.5 "$(Q "select cost_per_visitor from f_channel_kpis(null) where campaign_id='C02'")"
check week_0303 "174|37425" "$(Q "select registrations||'|'||spend_inr from f_weekly_pace(null) where week_start='2025-03-03'")"

# 2. Dirty data: re-inserting duplicate rows and non-external people must not change any number
Q "insert into checkins(event_id,person_id,person_name,registration_id,campaign_id,campaign_name,owner_id,owner_name,occurred_at,result,verification,source) select event_id,person_id,person_name,registration_id,campaign_id,campaign_name,owner_id,owner_name,occurred_at,result,verification,source from checkins limit 300" >/dev/null
Q "insert into daily_marketing(activity_id,campaign_id,activity_date,marketing_spend_inr) select activity_id,campaign_id,activity_date,marketing_spend_inr from daily_marketing limit 50" >/dev/null
Q "insert into people(person_id,person_type,first_seen_at) values ('T999','test','2025-02-01')" >/dev/null
check dup_visitors 2050 "$(fm null verified_visitors)"
check dup_spend 274000 "$(fm null marketing_spend_inr)"
check dup_identified 3625 "$(fm null identified_people)"

# 3. Edits propagate: +10,000 spend on Paid Social changes total and channel cost
Q "select reset_to_original()" >/dev/null
Q "insert into daily_marketing(activity_id,campaign_id,activity_date,marketing_spend_inr) values ('TEST1','C02','2025-03-01',10000)" >/dev/null
check edit_spend 284000 "$(fm null marketing_spend_inr)"
check edit_paid_cpr 151.5 "$(Q "select cost_per_registrant from f_channel_kpis(null) where campaign_id='C02'")"
# deleting all check-ins of day 2 lowers visitors
Q "delete from checkins where occurred_at::date='2025-04-13'" >/dev/null
check edit_day1_only "$(Q "select count(distinct c.person_id) from original.checkins c join people p using(person_id) where p.person_type='external' and result='admitted' and verification='verified' and occurred_at::date='2025-04-12'")" "$(fm null verified_visitors)"

# 4. Reset restores everything
Q "select reset_to_original()" >/dev/null
check reset_visitors 2050 "$(fm null verified_visitors)"
check reset_spend 274000 "$(fm null marketing_spend_inr)"

# 5. As-of replay: before 15 Mar, the event has not happened
check asof_spend_pre15mar 193375 "$(fm "'2025-03-16 23:59:59'" marketing_spend_inr)"
check asof_visitors_pre_event 0 "$(fm "'2025-04-01'" verified_visitors)"
check asof_forecast_mode "Pre-event" "$(Q "select split_part(note,':',1) from f_forecast('2025-04-01','2026_base')")"

echo "$pass passed, $fail failed"; [ $fail -eq 0 ]
