-- RISA Growth Center: one-paste setup for the Supabase SQL editor.
-- Runs schema, metric views, loads the 2025 data from GitHub, then the plan layer. Safe to re-run.

-- RISA Growth Center: raw data tables (mirror the 9 data sheets of Attendee_Dataset.xlsx)
-- row_id is a surrogate key so that duplicate source IDs (import retries) can be stored as-is;
-- all cleaning happens in the views (02_views.sql), never at load time.
-- Every working table has a twin in schema "original" used by reset_to_original().

create schema if not exists original;

create table if not exists event (
  event_name text, history_start timestamp, history_end timestamp,
  event_starts_at timestamp, event_ends_at timestamp,
  timezone text, currency text, fictional boolean);

create table if not exists targets (
  row_id bigserial primary key, effective_at timestamp,
  identified_external_people_goal int, registration_goal int,
  unique_external_visitors_goal int, marketing_budget_inr int, target_version text);

create table if not exists campaigns (
  row_id bigserial primary key, campaign_id text, campaign_name text, channel text,
  target_audience text, objective text, owner_id text, owner_name text,
  created_at timestamp, planned_start_at timestamp, planned_end_at timestamp,
  status text default 'active',            -- app field: active | paused | stopped
  budget_2026_inr int);                     -- app field: plan budget per campaign

create table if not exists daily_marketing (
  row_id bigserial primary key, activity_id text, campaign_id text, campaign_name text,
  owner_id text, owner_name text, activity_date timestamp, impressions int, clicks int,
  reported_reach int, landing_page_sessions int, registration_starts int,
  marketing_spend_inr int, platform text);

create table if not exists people (
  row_id bigserial primary key, person_id text, person_name text, person_type text,
  first_seen_at timestamp, first_touch_source text, first_campaign_id text,
  first_campaign_name text, owner_id text, owner_name text);

create table if not exists interactions (
  row_id bigserial primary key, interaction_id text, person_id text, person_name text,
  campaign_id text, campaign_name text, owner_id text, owner_name text,
  occurred_at timestamp, event_type text, detail text);

create table if not exists registrations (
  row_id bigserial primary key, registration_id text, person_id text, person_name text,
  campaign_id text, campaign_name text, owner_id text, owner_name text, registered_at timestamp);

create table if not exists registration_history (
  row_id bigserial primary key, history_id text, registration_id text, person_id text,
  person_name text, campaign_id text, campaign_name text, owner_id text, owner_name text,
  effective_at timestamp, status text);

create table if not exists checkins (
  row_id bigserial primary key, event_id text, person_id text, person_name text,
  registration_id text, campaign_id text, campaign_name text, owner_id text, owner_name text,
  occurred_at timestamp, result text, verification text, source text);

-- App tables ---------------------------------------------------------------
create table if not exists app_settings (
  id int primary key default 1 check (id = 1),
  as_of timestamp,                 -- null = end of dataset (everything)
  compare_target text not null default '2026_base'  -- 2025_goal | 2026_base | 2026_stretch
);
insert into app_settings(id) values (1) on conflict do nothing;

-- Plan targets for the comparison selector. 2025 goal comes from the targets sheet [D];
-- 2026 values come from analysis/target_model.py [A].
create table if not exists plan_targets (
  target_key text primary key, label text, identified int, registrants int,
  verified_attendees int, budget_inr int, source text);

-- 2025 per-channel baseline used for cost ceilings (1.5x 2025 cost per registrant) [D]+[A]
create table if not exists channel_baseline (
  campaign_id text primary key, cost_per_registrant_2025 numeric, show_rate_2025 numeric,
  ceiling_multiplier numeric default 1.5);

create table if not exists bets (
  bet_id int primary key, name text, description text, kpi_name text, kpi_unit text,
  base_attendees int, stretch_attendees int, budget_inr int, owner_name text,
  confidence numeric, effort_weeks numeric, score numeric,
  scale_if text, change_if text, stop_if text, action_text text,
  status text default 'running');           -- running | scaled | changed | stopped

-- Manually entered KPI readings (bets whose KPI is not in the raw data, e.g. pro-night RSVPs)
create table if not exists bet_kpi_readings (
  id bigserial primary key, bet_id int references bets(bet_id), reading_date date,
  value numeric, note text, created_at timestamptz default now());

create table if not exists tasks (
  id bigserial primary key, title text not null, description text,
  owner_name text, due_date date, status text default 'todo',   -- todo | doing | done | blocked
  priority text default 'medium', bet_id int references bets(bet_id), campaign_id text,
  created_by text default 'user',          -- user | copilot
  source_question text,                    -- chatbot question that led to this task
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists audit_log (
  id bigserial primary key, table_name text, row_ref text, action text,
  old_value jsonb, new_value jsonb, session_id text, created_at timestamptz default now());

create table if not exists chat_log (
  id bigserial primary key, session_id text, role text, content text,
  tool_calls jsonb, model text, created_at timestamptz default now());

-- Twins in schema original (filled once by the seed; never edited by the app)
create table if not exists original.event               (like public.event);
create table if not exists original.targets             (like public.targets);
create table if not exists original.campaigns           (like public.campaigns);
create table if not exists original.daily_marketing     (like public.daily_marketing);
create table if not exists original.people              (like public.people);
create table if not exists original.interactions        (like public.interactions);
create table if not exists original.registrations       (like public.registrations);
create table if not exists original.registration_history(like public.registration_history);
create table if not exists original.checkins            (like public.checkins);

create or replace function reset_to_original() returns text language plpgsql as $$
declare t text;
begin
  foreach t in array array['event','targets','campaigns','daily_marketing','people',
                           'interactions','registrations','registration_history','checkins'] loop
    execute format('truncate public.%I', t);
    execute format('insert into public.%I select * from original.%I', t, t);
    if t <> 'event' then
      execute format('select setval(pg_get_serial_sequence(''public.%I'',''row_id''), greatest(coalesce((select max(row_id) from public.%I),0),1))', t, t);
    end if;
  end loop;
  update app_settings set as_of = null where id = 1;
  insert into audit_log(table_name, action) values ('*', 'reset_to_original');
  return 'reset done';
end $$;

-- RISA Growth Center: cleaning + metric layer. Single source of truth for dashboard AND chatbot.
-- Counting rules (same as analysis/diagnose.py):
--  * duplicates removed by stable ID (first row kept)
--  * external people only (person_type = 'external')
--  * registration status = latest history version (by effective_at, history_id) at the as-of time
--  * verified visitor = external person with >=1 check-in that is admitted AND verified, counted once
--  * spend = sum of marketing_spend_inr (credits are negative rows and reduce spend)
-- Every f_* function takes p_as_of (timestamp). NULL = no cut-off (whole dataset).
-- The v_* views call the functions with the as_of stored in app_settings.

create or replace function cfg_as_of() returns timestamp language sql stable as
$$ select as_of from app_settings where id = 1 $$;

-- ---------- cleaned base sets ----------
create or replace view c_people as
select distinct on (person_id) * from people where person_id is not null order by person_id, row_id;

create or replace view c_ext_people as
select * from c_people where person_type = 'external';

create or replace function f_registrations(p_as_of timestamp default null)
returns table(registration_id text, person_id text, campaign_id text, registered_at timestamp, status text)
language sql stable as $$
  with r as (
    select distinct on (registration_id) * from registrations
    where (p_as_of is null or registered_at <= p_as_of) order by registration_id, row_id),
  h as (
    select distinct on (history_id) * from registration_history
    where (p_as_of is null or effective_at <= p_as_of) order by history_id, row_id),
  last as (
    select distinct on (registration_id) registration_id, status from h
    order by registration_id, effective_at desc, history_id desc)
  select r.registration_id, r.person_id, r.campaign_id, r.registered_at, coalesce(l.status,'interested')
  from r join c_ext_people p on p.person_id = r.person_id
  left join last l on l.registration_id = r.registration_id
$$;

create or replace function f_visitors(p_as_of timestamp default null)
returns table(person_id text, first_checkin timestamp, days_attended int)
language sql stable as $$
  with c as (
    select distinct on (event_id) * from checkins
    where (p_as_of is null or occurred_at <= p_as_of) order by event_id, row_id)
  select c.person_id, min(c.occurred_at), count(distinct c.occurred_at::date)::int
  from c join c_ext_people p on p.person_id = c.person_id
  where c.result = 'admitted' and c.verification = 'verified'
  group by c.person_id
$$;

create or replace function f_spend(p_as_of timestamp default null)
returns table(activity_id text, campaign_id text, activity_date timestamp, impressions int, clicks int,
              landing_page_sessions int, registration_starts int, spend int)
language sql stable as $$
  select distinct on (activity_id) activity_id, campaign_id, activity_date, impressions, clicks,
         landing_page_sessions, registration_starts, marketing_spend_inr
  from daily_marketing where (p_as_of is null or activity_date <= p_as_of)
  order by activity_id, row_id
$$;

-- ---------- 1. funnel ----------
create or replace function f_funnel(p_as_of timestamp default null)
returns table(metric text, value numeric, definition text) language sql stable as $$
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
  impressions numeric, clicks numeric, identified int, registrants int, confirmed int, cancelled int,
  visitors int, show_rate_pct numeric, cost_per_registrant numeric, cost_per_visitor numeric,
  cost_ceiling numeric, opt_outs int, flag text)
language sql stable as $$
  with s as (select campaign_id, sum(spend) sp, sum(impressions) im, sum(clicks) cl from f_spend(p_as_of) group by 1),
       r as (select * from f_registrations(p_as_of)),
       v as (select person_id from f_visitors(p_as_of)),
       i as (select distinct on (interaction_id) * from interactions
             where event_type='opted_out' and (p_as_of is null or occurred_at <= p_as_of) order by interaction_id, row_id),
       k as (
  select c.campaign_id, c.campaign_name, c.channel, c.status,
    coalesce(s.sp,0)::numeric sp, coalesce(s.im,0)::numeric im, coalesce(s.cl,0)::numeric cl,
    (select count(*) from c_ext_people p where p.first_campaign_id=c.campaign_id and (p_as_of is null or p.first_seen_at<=p_as_of))::int idn,
    (select count(distinct person_id) from r where r.campaign_id=c.campaign_id)::int reg,
    (select count(distinct person_id) from r where r.campaign_id=c.campaign_id and r.status='confirmed')::int conf,
    (select count(distinct person_id) from r where r.campaign_id=c.campaign_id and r.status='cancelled')::int canc,
    (select count(distinct r.person_id) from r join v using(person_id) where r.campaign_id=c.campaign_id)::int vis,
    (select count(distinct i.person_id) from i join c_ext_people p using(person_id) where i.campaign_id=c.campaign_id)::int opt,
    b.cost_per_registrant_2025*b.ceiling_multiplier ceil
  from (select distinct on (campaign_id) * from campaigns order by campaign_id, row_id) c
  left join s on s.campaign_id=c.campaign_id
  left join channel_baseline b on b.campaign_id=c.campaign_id)
  select campaign_id, campaign_name, channel, status, sp, im, cl, idn, reg, conf, canc, vis,
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
language sql stable as $$
  with r as (select date_trunc('week', registered_at)::date wk, count(distinct person_id) n
             from f_registrations(p_as_of) group by 1),
       s as (select date_trunc('week', activity_date)::date wk, sum(spend) sp from f_spend(p_as_of) group by 1),
       w as (select coalesce(r.wk,s.wk) wk, coalesce(r.n,0)::int n, coalesce(s.sp,0)::numeric sp
             from r full join s on r.wk=s.wk)
  select wk, n, (sum(n) over (order by wk))::int, sp, sum(sp) over (order by wk), round(sp/nullif(n,0),1)
  from w order by wk
$$;
create or replace view v_weekly_pace as select * from f_weekly_pace(cfg_as_of());

-- ---------- 4. forecast vs selected target ----------
create or replace function f_forecast(p_as_of timestamp default null, p_target text default null)
returns table(target_key text, target_label text, target_attendees int, actual_visitors int,
  registrants int, open_registrants int, assumed_show_rate_pct numeric, walk_ins_assumed int,
  forecast_attendees int, gap_to_target int, budget_inr int, spend_to_date numeric, note text)
language sql stable as $$
  with f as (select metric, value from f_funnel(p_as_of)),
       t as (select * from plan_targets where target_key = coalesce(p_target,(select compare_target from app_settings where id=1))),
       ev as (select event_starts_at from event limit 1),
       x as (select
          (select value from f where metric='verified_visitors')::int vis,
          (select value from f where metric='registrants')::int reg,
          (select value from f where metric='registered_visitors')::int rvis,
          (select value from f where metric='walk_in_visitors')::int wi,
          (select value from f where metric='marketing_spend_inr') sp)
  select t.target_key, t.label, t.verified_attendees, x.vis, x.reg,
    case when p_as_of is null or p_as_of >= (select event_starts_at from ev) then 0 else x.reg end,
    68.8, 125,
    case when p_as_of is null or p_as_of >= (select event_starts_at from ev) then x.vis
         else round(x.reg*0.688 + 125)::int end,
    (case when p_as_of is null or p_as_of >= (select event_starts_at from ev) then x.vis
          else round(x.reg*0.688 + 125)::int end) - t.verified_attendees,
    t.budget_inr, x.sp,
    case when p_as_of is null or p_as_of >= (select event_starts_at from ev)
         then 'Event has happened: forecast = actual verified visitors [D]'
         else 'Pre-event: forecast = registrants so far x 68.8% (2025 show rate) + 125 walk-ins (2025) [A]. Excludes registrations still to come.' end
  from t, x
$$;
create or replace view v_forecast as select * from f_forecast(cfg_as_of(), null);

-- ---------- 5. bet status ----------
create or replace view v_bet_status as
select b.bet_id, b.name, b.kpi_name, b.kpi_unit, b.base_attendees, b.stretch_attendees, b.budget_inr,
  b.owner_name, b.score, b.status, b.scale_if, b.change_if, b.stop_if, b.action_text,
  (select value from bet_kpi_readings k where k.bet_id=b.bet_id order by reading_date desc, id desc limit 1) latest_kpi_value,
  (select reading_date from bet_kpi_readings k where k.bet_id=b.bet_id order by reading_date desc, id desc limit 1) latest_kpi_date,
  (select count(*) from tasks t where t.bet_id=b.bet_id and t.status<>'done') open_tasks
from bets b order by b.bet_id;

-- ---------- 6. data dictionary (lets the chatbot say what the data CAN'T answer) ----------
create or replace view v_data_dictionary as
select table_name::text, column_name::text, data_type::text
from information_schema.columns
where table_schema='public' and table_name in
 ('campaigns','daily_marketing','people','interactions','registrations','registration_history',
  'checkins','targets','event','plan_targets','bets','bet_kpi_readings','tasks')
order by table_name, ordinal_position;

-- Loads the raw 2025 data from the public GitHub repo (data/json/*.json) into public.* and original.*.
-- Uses the pgsql-http extension, so no 4 MB seed file has to be pasted into the SQL editor.
create extension if not exists http with schema extensions;

create or replace function load_from_github(p_base text default
  'https://raw.githubusercontent.com/Rakeshtella8/risa-growth-center/main/data/json/')
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  t text; cols text; j json; n int; msg text := '';
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '60');
  foreach t in array array['event','targets','campaigns','daily_marketing','people',
                           'interactions','registrations','registration_history','checkins'] loop
    select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and column_name <> 'row_id'
       and not (t = 'campaigns' and column_name in ('status','budget_2026_inr'));
    select content::json into j from extensions.http_get(p_base || t || '.json');
    execute format('truncate public.%I', t);
    execute format('insert into public.%I (%s) select %s from json_populate_recordset(null::public.%I, $1)',
                   t, cols, cols, t) using j;
    get diagnostics n = row_count;
    execute format('truncate original.%I', t);
    execute format('insert into original.%I select * from public.%I', t, t);
    msg := msg || t || '=' || n || ' ';
  end loop;
  return msg;
end $$;

select load_from_github();

insert into plan_targets values
 ('2025_goal','2025 revised goal',3600,3200,2200,300000,'Targets sheet, revised plan 15 Mar 2025 [D]'),
 ('2026_base','2026 base plan',3677,3117,2670,300000,'analysis/target_model.py base case [A]'),
 ('2026_stretch','2026 stretch plan',3896,3336,3205,300000,'analysis/target_model.py stretch case [A]')
on conflict (target_key) do update set label=excluded.label, identified=excluded.identified,
 registrants=excluded.registrants, verified_attendees=excluded.verified_attendees,
 budget_inr=excluded.budget_inr, source=excluded.source;

-- Plan layer: 2025 channel baselines (computed from the ORIGINAL data, frozen) and the 5 bets from Slides 2-3.
truncate channel_baseline;
insert into channel_baseline(campaign_id, cost_per_registrant_2025, show_rate_2025, ceiling_multiplier)
select campaign_id, cost_per_registrant, show_rate_pct,
  case when campaign_id = 'C02' then 1.0 else 1.5 end   -- Slide 3: paid retargeting stop line = 2025 paid average Rs 137
from f_channel_kpis(null);

update campaigns c set budget_2026_inr = b.v from (values
 ('C04',75000),('C01',60000),('C05',40000),('C06',25000),('C07',25000),('C02',30000),('C03',15000)) b(id,v)
where c.campaign_id = b.id;
update original.campaigns c set budget_2026_inr = p.budget_2026_inr from public.campaigns p where p.row_id = c.row_id;

truncate bets cascade;
insert into bets(bet_id,name,description,kpi_name,kpi_unit,base_attendees,stretch_attendees,budget_inr,owner_name,confidence,effort_weeks,score,scale_if,change_if,stop_if,action_text) values
(1,'Show-up programme + waitlist auto-release','Reminders at T-14/T-3/T-1, QR passes, daily waitlist release. 575 confirmed no-shows and 88 stranded waitlisted in 2025 [D].','QR passes downloaded / confirmed','%',139,202,30000,'CRM/ops lead',0.7,2,70.7,'>= 85% -> extend winning reminder variant','70-85% -> add WhatsApp and captain nudges','< 70%, or opt-outs > 6.5% of identified -> pause reminders','If paused: captain-led nudges only; waitlist release keeps running daily'),
(2,'Contingent engine','Formal invites via college sports committees across NCR, Haryana, Punjab with team registration. Best 2025 show rate 85.6% (College Partnerships) [D].','Cost per contingent registrant','INR',364,364,75000,'Partnerships lead',0.8,6,48.5,'<= Rs 103 and >= 88 registrants/week -> add colleges','Rs 103-138 -> narrow to top-converting colleges','> Rs 138 for 2 weeks -> move spend to referrals','Re-allocate weekly in the dashboard'),
(3,'Shift paid spend to peer channels','Paid Social Rs 93k -> 30k, Creators Rs 59k -> 15k; freed money funds bets 1-2 and peer channels. Rs 274-337 per paid attendee vs Rs 69-108 peer [D].','Cost per registrant by channel vs ceiling','INR',117,117,0,'Growth lead',0.8,2,46.8,'Below ceiling -> move more from paid','At ceiling -> hold','Paid retargeting > Rs 137 per registrant -> cut paid to zero','Shift money to the channel furthest below its ceiling'),
(4,'Squad referral','Contingent players invite friends; non-cash rewards [A]. Referrals cheapest channel in 2025 (Rs 69/attendee, 78.6% show) [D].','Referred registrants / contingent registrants','ratio',0,172,0,'Referrals lead',0.5,3,28.7,'>= 0.25 by T-4w -> roll out to all contingents','0.10-0.25 -> change the reward','< 0.10 after 2 weeks -> stop, drop from stretch','Swap reward type, re-test 1 week'),
(5,'Evening pro-nights + IPL screening','Sponsor-funded evening events in the OAT (2,000-2,500 seats [O]); 400 check-ins at 6 pm on day 1 in 2025 [D].','Pro-night RSVPs','count',0,300,0,'Events + sponsorship lead',0.3,8,11.3,'>= 300 RSVPs -> add second screening zone','150-300 -> push via contingents','No sponsor by T-6w -> drop screening, keep DJ night','Cap RSVPs at OAT capacity');

select metric, value from v_funnel;
