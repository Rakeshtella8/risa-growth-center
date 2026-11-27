-- RISA Growth Center: cleaning + metric layer. Single source of truth for dashboard AND chatbot.
-- Counting rules (same as analysis/diagnose.py):
--  * duplicates removed by stable ID (first row kept)
--  * external people only (person_type = 'external')
--  * registration status = latest history version (by effective_at, history_id) at the as-of time
--  * verified visitor = external person with >=1 check-in that is admitted AND verified, counted once
--  * spend = sum of marketing_spend_inr (credits are negative rows and reduce spend)
-- Every f_* function takes p_as_of (timestamp). NULL = no cut-off (whole dataset).
-- The v_* views call the functions with the as_of stored in app_settings.
-- enable_nestloop = off: CTE row estimates are poor on these small tables and the planner otherwise
-- picks nested loops (5M comparisons, ~1 s). Hash joins keep every function well under 100 ms.

create or replace function cfg_as_of() returns timestamp language sql stable as
$$ select as_of from app_settings where id = 1 $$;

-- ---------- cleaned base sets ----------
create or replace view c_people as
select distinct on (person_id) * from people where person_id is not null order by person_id, row_id;

create or replace view c_ext_people as
select * from c_people where person_type = 'external';

create or replace function f_registrations(p_as_of timestamp default null)
returns table(registration_id text, person_id text, campaign_id text, registered_at timestamp, status text)
language sql stable set enable_nestloop = off as $$
  with ext as materialized (select person_id from c_ext_people),
  r as materialized (
    select distinct on (registration_id) registration_id, person_id, campaign_id, registered_at from registrations
    where (p_as_of is null or registered_at <= p_as_of) order by registration_id, row_id),
  h as materialized (
    select distinct on (history_id) history_id, registration_id, effective_at, status from registration_history
    where (p_as_of is null or effective_at <= p_as_of) order by history_id, row_id),
  last as materialized (
    select distinct on (registration_id) registration_id, status from h
    order by registration_id, effective_at desc, history_id desc)
  select r.registration_id, r.person_id, r.campaign_id, r.registered_at, coalesce(l.status,'interested')
  from r left join last l on l.registration_id = r.registration_id
  where r.person_id in (select person_id from ext)
$$;

create or replace function f_visitors(p_as_of timestamp default null)
returns table(person_id text, first_checkin timestamp, days_attended int)
language sql stable set enable_nestloop = off as $$
  with ext as materialized (select person_id from c_ext_people),
  c as materialized (
    select distinct on (event_id) person_id, occurred_at, result, verification from checkins
    where (p_as_of is null or occurred_at <= p_as_of) order by event_id, row_id)
  select c.person_id, min(c.occurred_at), count(distinct c.occurred_at::date)::int
  from c
  where c.result = 'admitted' and c.verification = 'verified'
    and c.person_id in (select person_id from ext)
  group by c.person_id
$$;

create or replace function f_spend(p_as_of timestamp default null)
returns table(activity_id text, campaign_id text, activity_date timestamp, impressions int, clicks int,
              landing_page_sessions int, registration_starts int, spend int)
language sql stable set enable_nestloop = off as $$
  select distinct on (activity_id) activity_id, campaign_id, activity_date, impressions, clicks,
         landing_page_sessions, registration_starts, marketing_spend_inr
  from daily_marketing where (p_as_of is null or activity_date <= p_as_of)
  order by activity_id, row_id
$$;

-- ---------- 1. funnel ----------
create or replace function f_funnel(p_as_of timestamp default null)
returns table(metric text, value numeric, definition text) language sql stable set enable_nestloop = off as $$
  with r as (select * from f_registrations(p_as_of)),
       v as (select * from f_visitors(p_as_of)),
       ppl as (select * from c_ext_people where p_as_of is null or first_seen_at <= p_as_of),
       rv as (select r.*, (v.person_id is not null) attended from r left join v using(person_id))
  select * from (values
   ('identified_people', (select count(*) from ppl)::numeric, 'Distinct external people first seen by the as-of time (campaign leads + gate walk-ins)'),
   ('identified_pre_event', (select count(*) from ppl where first_touch_source = 'campaign')::numeric, 'External people identified through campaigns (excludes walk-ins identified at the gate)'),
   ('registrants', (select count(distinct person_id) from r)::numeric, 'Distinct external people with a registration'),
   ('confirmed', (select count(distinct person_id) from r where status='confirmed')::numeric, 'Registrants whose latest status is confirmed'),
   ('cancelled', (select count(distinct person_id) from r where status='cancelled')::numeric, 'Latest status cancelled'),
   ('waitlisted', (select count(distinct person_id) from r where status='waitlisted')::numeric, 'Latest status waitlisted (stranded if the event is over)'),
   ('interested_only', (select count(distinct person_id) from r where status='interested')::numeric, 'Never moved past interested'),
   ('verified_visitors', (select count(*) from v)::numeric, 'Distinct external people admitted and verified at least once'),
   ('registered_visitors', (select count(distinct person_id) from rv where attended)::numeric, 'Visitors who had registered'),
   ('walk_in_visitors', (select count(*) from v where person_id not in (select person_id from r))::numeric, 'Visitors with no registration'),
   ('confirmed_no_shows', (select count(distinct person_id) from rv where status='confirmed' and not attended)::numeric, 'Confirmed but never verified at the gate'),
   ('show_rate_pct', round(100.0*(select count(distinct person_id) from rv where attended)/nullif((select count(distinct person_id) from r),0),1), 'Registered visitors / registrants'),
   ('marketing_spend_inr', (select coalesce(sum(spend),0) from f_spend(p_as_of))::numeric, 'Net spend incl. credits'),
   ('multi_day_visitors', (select count(*) from v where days_attended > 1)::numeric, 'Visitors on both days')
  ) t(metric, value, definition)
$$;
create or replace view v_funnel as select * from f_funnel(cfg_as_of());

-- ---------- 2. channel KPIs ----------
create or replace function f_channel_kpis(p_as_of timestamp default null)
returns table(campaign_id text, campaign_name text, channel text, status text, spend_inr numeric,
  impressions numeric, clicks numeric, sessions numeric, registration_starts numeric,
  identified int, registrants int, confirmed int, cancelled int,
  visitors int, show_rate_pct numeric, cost_per_registrant numeric, cost_per_visitor numeric,
  cost_ceiling numeric, opt_outs int, flag text)
language sql stable set enable_nestloop = off as $$
  with ext as materialized (select person_id, first_campaign_id, first_seen_at from c_ext_people),
       s as materialized (select campaign_id, sum(spend) sp, sum(impressions) im, sum(clicks) cl,
                                 sum(landing_page_sessions) se, sum(registration_starts) st from f_spend(p_as_of) group by 1),
       r as materialized (select * from f_registrations(p_as_of)),
       v as materialized (select person_id from f_visitors(p_as_of)),
       ra as materialized (
         select r.campaign_id,
                count(distinct r.person_id) reg,
                count(distinct r.person_id) filter (where r.status = 'confirmed') conf,
                count(distinct r.person_id) filter (where r.status = 'cancelled') canc,
                count(distinct r.person_id) filter (where r.person_id in (select person_id from v)) vis
         from r group by r.campaign_id),
       ia as materialized (
         select first_campaign_id campaign_id, count(*) idn from ext
         where p_as_of is null or first_seen_at <= p_as_of group by 1),
       oa as materialized (
         select campaign_id, count(distinct person_id) opt from (
           select distinct on (interaction_id) campaign_id, person_id from interactions
           where event_type = 'opted_out' and (p_as_of is null or occurred_at <= p_as_of)
           order by interaction_id, row_id) i
         where person_id in (select person_id from ext) group by 1),
       -- campaigns in the list, plus any campaign id that appears in the data but not in the list
       -- (e.g. after a CSV upload), so totals always reconcile with the funnel
       cl as (
         select campaign_id, campaign_name, channel, status
         from (select distinct on (campaign_id) * from campaigns where campaign_id is not null order by campaign_id, row_id) c0
         union all
         select x.campaign_id, 'Unlisted campaign ' || x.campaign_id, 'unlisted', 'unlisted'
         from (select campaign_id from s union select campaign_id from ra union select campaign_id from ia) x
         where x.campaign_id is not null and x.campaign_id not in (select campaign_id from campaigns where campaign_id is not null)),
       k as (
         select c.campaign_id, c.campaign_name, c.channel, c.status,
           coalesce(s.sp,0)::numeric sp, coalesce(s.im,0)::numeric im, coalesce(s.cl,0)::numeric cl,
           coalesce(s.se,0)::numeric se, coalesce(s.st,0)::numeric st,
           coalesce(ia.idn,0)::int idn, coalesce(ra.reg,0)::int reg, coalesce(ra.conf,0)::int conf,
           coalesce(ra.canc,0)::int canc, coalesce(ra.vis,0)::int vis, coalesce(oa.opt,0)::int opt,
           b.cost_per_registrant_2025 * b.ceiling_multiplier ceil
         from cl c
         left join s on s.campaign_id = c.campaign_id
         left join ra on ra.campaign_id = c.campaign_id
         left join ia on ia.campaign_id = c.campaign_id
         left join oa on oa.campaign_id = c.campaign_id
         left join channel_baseline b on b.campaign_id = c.campaign_id)
  select campaign_id, campaign_name, channel, status, sp, im, cl, se, st, idn, reg, conf, canc, vis,
    round(100.0*vis/nullif(reg,0),1), round(sp/nullif(reg,0),1), round(sp/nullif(vis,0),1), round(ceil,1), opt,
    case when reg = 0 then 'grey'
         when sp/reg > ceil then 'red'
         when 100.0*vis/nullif(reg,0) < 70 then 'red'
         when sp/reg > ceil/1.5 then 'amber'
         else 'green' end
  from k order by sp desc
$$;
create or replace view v_channel_kpis as select * from f_channel_kpis(cfg_as_of());

-- ---------- 3. weekly pace (Mon-Sun weeks) ----------
create or replace function f_weekly_pace(p_as_of timestamp default null)
returns table(week_start date, registrations int, cumulative_registrations int, spend_inr numeric,
              cumulative_spend numeric, cost_per_registrant numeric)
language sql stable set enable_nestloop = off as $$
  with r as (select date_trunc('week', registered_at)::date wk, count(distinct person_id) n
             from f_registrations(p_as_of) group by 1),
       s as (select date_trunc('week', activity_date)::date wk, sum(spend) sp from f_spend(p_as_of) group by 1),
       w as (select coalesce(r.wk,s.wk) wk, coalesce(r.n,0)::int n, coalesce(s.sp,0)::numeric sp
             from r full join s on r.wk=s.wk)
  select wk, n, (sum(n) over (order by wk))::int, sp, sum(sp) over (order by wk), round(sp/nullif(n,0),1)
  from w order by wk
$$;
create or replace function f_channel_weekly(p_as_of timestamp default null)
returns table(week_start date, campaign_id text, registrations int, spend_inr numeric, cost_per_registrant numeric)
language sql stable set enable_nestloop = off as $$
  with r as (select date_trunc('week', registered_at)::date wk, campaign_id, count(distinct person_id) n
             from f_registrations(p_as_of) where campaign_id is not null group by 1,2),
       s as (select date_trunc('week', activity_date)::date wk, campaign_id, sum(spend) sp
             from f_spend(p_as_of) where campaign_id is not null group by 1,2)
  select coalesce(r.wk,s.wk), coalesce(r.campaign_id,s.campaign_id), coalesce(r.n,0)::int, coalesce(s.sp,0)::numeric,
         round(coalesce(s.sp,0)/nullif(r.n,0),1)
  from r full join s on r.wk=s.wk and r.campaign_id=s.campaign_id
  order by 1,2
$$;

create or replace view v_weekly_pace as select * from f_weekly_pace(cfg_as_of());

-- ---------- 4. forecast vs selected target ----------
create or replace function f_forecast(p_as_of timestamp default null, p_target text default null)
returns table(target_key text, target_label text, target_attendees int, actual_visitors int,
  registrants int, open_registrants int, assumed_show_rate_pct numeric, walk_ins_assumed int,
  forecast_attendees int, gap_to_target int, budget_inr int, spend_to_date numeric, note text,
  recent_weekly_registrations numeric, weeks_to_event numeric, projected_registrants int,
  projected_attendees int, projected_gap int, target_registrants int, expected_registrants_by_now int, pace_pct numeric)
language sql stable set enable_nestloop = off as $$
  -- Before the fest: "so far" forecast (people already registered) AND a projection that adds the
  -- recent run-rate (last 21 days) for the weeks left. Show rate 68.8% and 125 walk-ins are the 2025 values [A].
  -- Pace = registrants vs an even weekly plan from campaign start (first registration week) to the event.
  with f as (select metric, value from f_funnel(p_as_of)),
       t as (select * from plan_targets where target_key = coalesce(p_target,(select compare_target from app_settings where id=1))),
       ev as (select coalesce((select event_starts_at from event limit 1), '2025-04-12'::timestamp) st),
       r as (select registered_at from f_registrations(p_as_of)),
       x as (select
          (select value from f where metric='verified_visitors')::int vis,
          (select value from f where metric='registrants')::int reg,
          (select value from f where metric='marketing_spend_inr') sp,
          (select st from ev) ev_at,
          (select date_trunc('week', min(registered_at)) from r) c_start,
          (select count(*) from r where p_as_of is not null and registered_at > p_as_of - interval '21 days') last21),
       y as (select x.*, (p_as_of is null or p_as_of >= x.ev_at) post,
          case when p_as_of is null then 0 else greatest(extract(epoch from (x.ev_at - p_as_of)) / 604800.0, 0) end wleft,
          x.last21 / 3.0 rate,
          case when p_as_of is null or x.c_start is null then null
               else greatest(extract(epoch from (p_as_of - x.c_start)) / nullif(extract(epoch from (x.ev_at - x.c_start)),0), 0) end frac
          from x)
  select t.target_key, t.label, t.verified_attendees, y.vis, y.reg,
    case when y.post then 0 else y.reg end,
    68.8, 125,
    case when y.post then y.vis else round(y.reg*0.688 + 125)::int end,
    (case when y.post then y.vis else round(y.reg*0.688 + 125)::int end) - t.verified_attendees,
    t.budget_inr, y.sp,
    case when y.post then 'Event has happened: forecast = actual verified visitors [D]'
         else 'Pre-event. forecast_attendees = registrants so far x 68.8% + 125 walk-ins (people already registered only). projected_attendees adds the last 21 days'' weekly run-rate for the weeks left before the fest [A].' end,
    case when y.post then null else round(y.rate,1) end,
    case when y.post then 0 else round(y.wleft,1) end,
    case when y.post then y.reg else round(y.reg + y.rate*y.wleft)::int end,
    case when y.post then y.vis else round((y.reg + y.rate*y.wleft)*0.688 + 125)::int end,
    (case when y.post then y.vis else round((y.reg + y.rate*y.wleft)*0.688 + 125)::int end) - t.verified_attendees,
    t.registrants,
    case when y.post then t.registrants else round(t.registrants * least(y.frac,1))::int end,
    case when y.post or y.frac is null or y.frac = 0 then null else round(100.0 * y.reg / nullif(t.registrants * least(y.frac,1),0),1) end
  from t, y
$$;
create or replace view v_forecast as select * from f_forecast(cfg_as_of(), null);

-- ---------- 5. bet status ----------
create or replace view v_bet_status as
select b.bet_id, b.name, b.kpi_name, b.kpi_unit, b.base_attendees, b.stretch_attendees, b.budget_inr,
  b.owner_name, b.score, b.status, b.scale_if, b.change_if, b.stop_if, b.action_text,
  (select value from bet_kpi_readings k where k.bet_id=b.bet_id order by reading_date desc, id desc limit 1) latest_kpi_value,
  (select reading_date from bet_kpi_readings k where k.bet_id=b.bet_id order by reading_date desc, id desc limit 1) latest_kpi_date,
  (select count(*) from tasks t where t.bet_id=b.bet_id and t.status<>'done') open_tasks,
  (select note from bet_kpi_readings k where k.bet_id=b.bet_id order by reading_date desc, id desc limit 1) latest_kpi_note
from bets b order by b.bet_id;

-- ---------- 6. data dictionary (lets the chatbot say what the data CAN'T answer) ----------
create or replace view v_data_dictionary as
select table_name::text, column_name::text, data_type::text
from information_schema.columns
where table_schema='public' and table_name in
 ('campaigns','daily_marketing','people','interactions','registrations','registration_history',
  'checkins','targets','event','plan_targets','bets','bet_kpi_readings','tasks')
order by table_name, ordinal_position;
