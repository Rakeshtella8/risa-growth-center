-- Update 5: the 2026 edition now follows the deck's base plan (analysis/target_model.py):
--   * simulated 2026 weeks use the deck's channel budgets and planned registrants per channel [A]
--   * plan pace and projections follow last year's season curve weighted by the planned channel mix
--   * 2026 assumed show rate = 77.2% (the plan's channel mix, before the show-up programme) [A]
--   * bets 2 and 3 read projected end-of-campaign cost per registrant (f_channel_projection)
-- Also includes update_04 (Reset data fix, tidy bet text, demo task dates). You can skip update_04.
-- Paste the whole file into the Supabase SQL editor and Run. Safe to run more than once.
begin;

-- ===== schema (idempotent) =====
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

-- Editions: each fest year is a time window over the same tables. Dates, capacity and the "today" used for
-- the demo are settings, so a new year needs no code change. 2025 = the given dataset; 2026 = the live campaign.
create table if not exists editions (
  edition text primary key, label text,
  window_start timestamp, window_end timestamp,        -- rows with timestamps in this window belong to the edition
  campaign_start date, fest_day1 date, fest_day2 date,
  capacity int,                                        -- confirmed places; new registrations beyond it go to the waitlist [A]
  assumed_show_rate_pct numeric, assumed_walk_ins int, -- used for pre-event forecasts [A]
  default_target text, baseline_edition text,          -- target to compare with; edition used as "last year"
  demo_clock timestamp);                               -- "today" for this edition when the real date is outside its window
insert into editions values
 ('2025','CampusFest 2025 (replay)','2025-01-01','2025-05-31 23:59:59','2025-01-20','2025-04-12','2025-04-13',2500,68.8,125,'2025_goal',null,'2025-04-20 23:59:59'),
 ('2026','CampusFest 2026 (live)','2026-01-01','2026-05-31 23:59:59','2026-01-19','2026-04-11','2026-04-12',3000,77.2,125,'2026_base','2025','2026-03-08 23:59:59')
on conflict (edition) do nothing;
alter table app_settings add column if not exists edition text not null default '2026';

-- Attendee management fields
alter table people add column if not exists college text;
alter table registrations add column if not exists college text;
alter table registrations add column if not exists role text;     -- participant | spectator
alter table registrations add column if not exists sport text;
-- Simulated rows (2026 demo weeks) are flagged so they can be removed in one click
alter table people add column if not exists is_simulated boolean not null default false;
alter table registrations add column if not exists is_simulated boolean not null default false;
alter table registration_history add column if not exists is_simulated boolean not null default false;
alter table checkins add column if not exists is_simulated boolean not null default false;
alter table interactions add column if not exists is_simulated boolean not null default false;
alter table daily_marketing add column if not exists is_simulated boolean not null default false;

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
create table if not exists original.plan_targets        (like public.plan_targets);
create table if not exists original.editions            (like public.editions);
-- twins created before the attendee-management columns existed get them too
alter table original.people add column if not exists college text;
alter table original.registrations add column if not exists college text;
alter table original.registrations add column if not exists role text;
alter table original.registrations add column if not exists sport text;
alter table original.people add column if not exists is_simulated boolean not null default false;
alter table original.registrations add column if not exists is_simulated boolean not null default false;
alter table original.registration_history add column if not exists is_simulated boolean not null default false;
alter table original.checkins add column if not exists is_simulated boolean not null default false;
alter table original.interactions add column if not exists is_simulated boolean not null default false;
alter table original.daily_marketing add column if not exists is_simulated boolean not null default false;

-- copy rows between a public table and its twin by column name (column order may differ)
create or replace function copy_table(src text, dst text, filter text default 'true') returns void language plpgsql as $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cols
  from information_schema.columns c
  where c.table_schema = split_part(dst,'.',1) and c.table_name = split_part(dst,'.',2)
    and exists (select 1 from information_schema.columns s where s.table_schema = split_part(src,'.',1)
                and s.table_name = split_part(src,'.',2) and s.column_name = c.column_name);
  execute format('insert into %s (%s) select %s from %s where %s', dst, cols, cols, src, filter);
end $$;

create or replace function reset_to_original() returns text language plpgsql as $$
declare t text;
begin
  foreach t in array array['event','targets','campaigns','daily_marketing','people',
                           'interactions','registrations','registration_history','checkins'] loop
    execute format('truncate public.%I', t);
    perform copy_table('original.' || t, 'public.' || t);
    if t <> 'event' then
      execute format('select setval(pg_get_serial_sequence(''public.%I'',''row_id''), greatest(coalesce((select max(row_id) from public.%I),0),1))', t, t);
    end if;
  end loop;
  -- targets and edition settings edited in the app go back to the strategy model's values
  if exists (select 1 from original.plan_targets) then
    truncate public.plan_targets;
    perform copy_table('original.plan_targets', 'public.plan_targets');
  end if;
  if exists (select 1 from original.editions) then
    delete from public.editions where true; -- Supabase safeupdate blocks a DELETE with no WHERE
    perform copy_table('original.editions', 'public.editions');
  end if;
  update app_settings set as_of = null where id = 1;
  insert into audit_log(table_name, action) values ('*', 'reset_to_original');
  return 'reset done';
end $$;


-- keep the edition settings for Reset data (once)
insert into original.editions select * from public.editions where not exists (select 1 from original.editions);

-- ===== metric layer =====
-- RISA Growth Center: cleaning + metric layer. Single source of truth for dashboard AND chatbot.
-- Counting rules (same as analysis/diagnose.py):
--  * duplicates removed by stable ID (first row kept)
--  * external people only (person_type = 'external')
--  * registration status = latest history version (by effective_at, history_id) at the as-of time
--  * verified visitor = external person with >=1 check-in that is admitted AND verified, counted once
--  * spend = sum of marketing_spend_inr (credits are negative rows and reduce spend)
-- Every f_* function takes p_as_of (timestamp) and p_edition (text). An edition is one fest year: a time window over
-- the same tables, with its dates and capacity in table editions. p_edition NULL = app_settings.edition.
-- p_as_of NULL = the edition's "today" (real date if inside the window, else editions.demo_clock); a later
-- as-of is capped at that "today", so the dashboard never shows the future.
-- The v_* views call the functions with the as_of stored in app_settings.
-- enable_nestloop = off: CTE row estimates are poor on these small tables and the planner otherwise
-- picks nested loops (5M comparisons, ~1 s). Hash joins keep every function well under 100 ms.

-- Old single-edition signatures (dropped so calls are never ambiguous; views are recreated below)
drop function if exists f_forecast(timestamp, text) cascade;
drop function if exists f_channel_weekly(timestamp) cascade;
drop function if exists f_weekly_pace(timestamp) cascade;
drop function if exists f_channel_kpis(timestamp) cascade;
drop function if exists f_funnel(timestamp) cascade;
drop function if exists f_spend(timestamp) cascade;
drop function if exists f_visitors(timestamp) cascade;
drop function if exists f_registrations(timestamp) cascade;

create or replace function cfg_as_of() returns timestamp language sql stable as
$$ select as_of from app_settings where id = 1 $$;

-- ---------- editions ----------
create or replace function ed(p_edition text default null) returns editions language sql stable as $$
  select * from editions where edition = coalesce(p_edition, (select edition from app_settings where id = 1), '2026')
$$;
-- "today" inside an edition: the real date in India when it falls inside the window, else the demo clock
create or replace function ed_clock(p_edition text default null) returns timestamp language sql stable as $$
  select case when (now() at time zone 'Asia/Kolkata') between e.window_start and e.window_end
              then (now() at time zone 'Asia/Kolkata')::timestamp else e.demo_clock end
  from ed(p_edition) e
$$;
create or replace function ed_cut(p_as_of timestamp, p_edition text default null) returns timestamp language sql stable as $$
  select least(coalesce(p_as_of, ed_clock(p_edition)), ed_clock(p_edition))
$$;

-- ---------- cleaned base sets ----------
create or replace view c_people as
select distinct on (person_id) * from people where person_id is not null order by person_id, row_id;

create or replace view c_ext_people as
select * from c_people where person_type = 'external';

create or replace function f_registrations(p_as_of timestamp default null, p_edition text default null)
returns table(registration_id text, person_id text, campaign_id text, registered_at timestamp, status text,
              role text, sport text, college text)
language sql stable set enable_nestloop = off set jit = off as $$
  with w as materialized (select e.window_start ws, ed_cut(p_as_of, e.edition) cut from ed(p_edition) e),
  ext as materialized (select person_id from c_ext_people),
  r as materialized (
    select distinct on (registration_id) registration_id, person_id, campaign_id, registered_at, role, sport, college
    from registrations, w where registered_at between w.ws and w.cut order by registration_id, row_id),
  h as materialized (
    select distinct on (history_id) history_id, registration_id, effective_at, status from registration_history, w
    where effective_at between w.ws and w.cut order by history_id, row_id),
  last as materialized (
    select distinct on (registration_id) registration_id, status from h
    order by registration_id, effective_at desc, history_id desc)
  select r.registration_id, r.person_id, r.campaign_id, r.registered_at, coalesce(l.status,'interested'), r.role, r.sport, r.college
  from r left join last l on l.registration_id = r.registration_id
  where r.person_id in (select person_id from ext)
$$;

create or replace function f_visitors(p_as_of timestamp default null, p_edition text default null)
returns table(person_id text, first_checkin timestamp, days_attended int)
language sql stable set enable_nestloop = off set jit = off as $$
  with w as materialized (select e.window_start ws, ed_cut(p_as_of, e.edition) cut from ed(p_edition) e),
  ext as materialized (select person_id from c_ext_people),
  c as materialized (
    select distinct on (event_id) person_id, occurred_at, result, verification from checkins, w
    where occurred_at between w.ws and w.cut order by event_id, row_id)
  select c.person_id, min(c.occurred_at), count(distinct c.occurred_at::date)::int
  from c
  where c.result = 'admitted' and c.verification = 'verified'
    and c.person_id in (select person_id from ext)
  group by c.person_id
$$;

create or replace function f_spend(p_as_of timestamp default null, p_edition text default null)
returns table(activity_id text, campaign_id text, activity_date timestamp, impressions int, clicks int,
              landing_page_sessions int, registration_starts int, spend int)
language sql stable set enable_nestloop = off set jit = off as $$
  with w as materialized (select e.window_start ws, ed_cut(p_as_of, e.edition) cut from ed(p_edition) e)
  select distinct on (activity_id) activity_id, campaign_id, activity_date, impressions, clicks,
         landing_page_sessions, registration_starts, marketing_spend_inr
  from daily_marketing, w where activity_date between w.ws and w.cut
  order by activity_id, row_id
$$;

-- External people active in the edition: first seen in its window, or (returning from an earlier year)
-- touched in it by an interaction, registration or check-in. source 'returning' marks the latter.
create or replace function f_people(p_as_of timestamp default null, p_edition text default null)
returns table(person_id text, person_name text, college text, source text, campaign_id text, seen_at timestamp)
language sql stable set enable_nestloop = off set jit = off as $$
  with w as materialized (select e.window_start ws, ed_cut(p_as_of, e.edition) cut from ed(p_edition) e),
  ext as materialized (select * from c_ext_people),
  touch as materialized (
    select x.person_id, min(x.t) t, (array_agg(x.c order by x.t) filter (where x.c is not null))[1] c from (
      select i.person_id, i.occurred_at t, i.campaign_id c from interactions i
      union all select r.person_id, r.registered_at, r.campaign_id from registrations r
      union all select k.person_id, k.occurred_at, null from checkins k) x, w
    where x.t between w.ws and w.cut group by x.person_id)
  select e.person_id, e.person_name, e.college,
    case when e.first_seen_at between w.ws and w.cut then e.first_touch_source else 'returning' end,
    case when e.first_seen_at between w.ws and w.cut then e.first_campaign_id else t.c end,
    case when e.first_seen_at between w.ws and w.cut then e.first_seen_at else t.t end
  from ext e cross join w left join touch t on t.person_id = e.person_id
  where e.first_seen_at between w.ws and w.cut or t.person_id is not null
$$;

-- ---------- 1. funnel ----------
create or replace function f_funnel(p_as_of timestamp default null, p_edition text default null)
returns table(metric text, value numeric, definition text) language sql stable set enable_nestloop = off set jit = off as $$
  with r as (select * from f_registrations(p_as_of, p_edition)),
       v as (select * from f_visitors(p_as_of, p_edition)),
       ppl as (select * from f_people(p_as_of, p_edition)),
       rv as (select r.*, (v.person_id is not null) attended from r left join v using(person_id)),
       w as (select e.window_start ws, ed_cut(p_as_of, e.edition) cut, e.capacity from ed(p_edition) e),
       it as (select distinct on (interaction_id) person_id, event_type from interactions, w
              where occurred_at between w.ws and w.cut and event_type in ('qr_pass_issued','qr_pass_downloaded','reminder_sent')
              order by interaction_id, row_id)
  select * from (values
   ('identified_people', (select count(*) from ppl)::numeric, 'Distinct external people seen in this edition by the as-of time (campaign leads, direct sign-ups, returning people and gate walk-ins)'),
   ('identified_pre_event', (select count(*) from ppl where source in ('campaign','direct','returning'))::numeric, 'External people identified before the gate (excludes walk-ins identified at the gate)'),
   ('registrants', (select count(distinct person_id) from r)::numeric, 'Distinct external people with a registration'),
   ('confirmed', (select count(distinct person_id) from r where status='confirmed')::numeric, 'Registrants whose latest status is confirmed'),
   ('cancelled', (select count(distinct person_id) from r where status='cancelled')::numeric, 'Latest status cancelled'),
   ('waitlisted', (select count(distinct person_id) from r where status='waitlisted')::numeric, 'Latest status waitlisted (stranded if the event is over)'),
   ('interested_only', (select count(distinct person_id) from r where status='interested')::numeric, 'Never moved past interested'),
   ('verified_visitors', (select count(*) from v)::numeric, 'Distinct external people admitted and verified at least once'),
   ('registered_visitors', (select count(distinct person_id) from rv where attended)::numeric, 'Visitors who had registered'),
   ('walk_in_visitors', (select count(*) from v where person_id not in (select person_id from r))::numeric, 'Visitors with no registration'),
   ('confirmed_no_shows', (select count(distinct person_id) from rv where status='confirmed' and not attended and (select cut from w) >= (select fest_day2 from ed(p_edition))::timestamp)::numeric, 'Confirmed but never verified at the gate (counted once the last fest day has started)'),
   ('show_rate_pct', round(100.0*(select count(distinct person_id) from rv where attended)/nullif((select count(distinct person_id) from r),0),1), 'Registered visitors / registrants'),
   ('marketing_spend_inr', (select coalesce(sum(spend),0) from f_spend(p_as_of, p_edition))::numeric, 'Net spend incl. credits'),
   ('multi_day_visitors', (select count(*) from v where days_attended > 1)::numeric, 'Visitors on both days'),
   ('capacity', (select capacity from w)::numeric, 'Confirmed places available (setting) [A]'),
   ('qr_passes_issued', (select count(distinct person_id) from it where event_type='qr_pass_issued')::numeric, 'People sent a QR entry pass'),
   ('qr_passes_downloaded', (select count(distinct person_id) from it where event_type='qr_pass_downloaded')::numeric, 'People who opened/downloaded their QR pass'),
   ('reminders_sent', (select count(*) from it where event_type='reminder_sent')::numeric, 'Reminder messages logged'),
   ('participants', (select count(distinct person_id) from r where role='participant')::numeric, 'Registrants who will play (role recorded on the form)'),
   ('spectators', (select count(distinct person_id) from r where role='spectator')::numeric, 'Registrants coming to watch (role recorded on the form)')
  ) t(metric, value, definition)
$$;
create or replace view v_funnel as select * from f_funnel(cfg_as_of(), null);

-- ---------- 2. channel KPIs ----------
create or replace function f_channel_kpis(p_as_of timestamp default null, p_edition text default null)
returns table(campaign_id text, campaign_name text, channel text, status text, spend_inr numeric,
  impressions numeric, clicks numeric, sessions numeric, registration_starts numeric,
  identified int, registrants int, confirmed int, cancelled int,
  visitors int, show_rate_pct numeric, cost_per_registrant numeric, cost_per_visitor numeric,
  cost_ceiling numeric, opt_outs int, flag text)
language sql stable set enable_nestloop = off set jit = off as $$
  with w as materialized (select e.window_start ws, ed_cut(p_as_of, e.edition) cut from ed(p_edition) e),
       ext as materialized (select person_id from c_ext_people),
       s as materialized (select campaign_id, sum(spend) sp, sum(impressions) im, sum(clicks) cl,
                                 sum(landing_page_sessions) se, sum(registration_starts) st from f_spend(p_as_of, p_edition) group by 1),
       r as materialized (select * from f_registrations(p_as_of, p_edition)),
       v as materialized (select person_id from f_visitors(p_as_of, p_edition)),
       ra as materialized (
         select r.campaign_id,
                count(distinct r.person_id) reg,
                count(distinct r.person_id) filter (where r.status = 'confirmed') conf,
                count(distinct r.person_id) filter (where r.status = 'cancelled') canc,
                count(distinct r.person_id) filter (where r.person_id in (select person_id from v)) vis
         from r group by r.campaign_id),
       ia as materialized (
         select campaign_id, count(*) idn from f_people(p_as_of, p_edition)
         where source in ('campaign','direct','returning') group by 1),
       oa as materialized (
         select campaign_id, count(distinct person_id) opt from (
           select distinct on (interaction_id) campaign_id, person_id from interactions, w
           where event_type = 'opted_out' and occurred_at between w.ws and w.cut
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
         when vis > 0 and 100.0*vis/nullif(reg,0) < 70 then 'red'
         when sp/reg > ceil/1.5 then 'amber'
         else 'green' end
  from k order by sp desc
$$;
create or replace view v_channel_kpis as select * from f_channel_kpis(cfg_as_of(), null);

-- ---------- 3. weekly pace (Mon-Sun weeks) ----------
create or replace function f_weekly_pace(p_as_of timestamp default null, p_edition text default null)
returns table(week_start date, registrations int, cumulative_registrations int, spend_inr numeric,
              cumulative_spend numeric, cost_per_registrant numeric)
language sql stable set enable_nestloop = off set jit = off as $$
  with r as (select date_trunc('week', registered_at)::date wk, count(distinct person_id) n
             from f_registrations(p_as_of, p_edition) group by 1),
       s as (select date_trunc('week', activity_date)::date wk, sum(spend) sp from f_spend(p_as_of, p_edition) group by 1),
       w as (select coalesce(r.wk,s.wk) wk, coalesce(r.n,0)::int n, coalesce(s.sp,0)::numeric sp
             from r full join s on r.wk=s.wk)
  select wk, n, (sum(n) over (order by wk))::int, sp, sum(sp) over (order by wk), round(sp/nullif(n,0),1)
  from w order by wk
$$;
create or replace function f_channel_weekly(p_as_of timestamp default null, p_edition text default null)
returns table(week_start date, campaign_id text, registrations int, spend_inr numeric, cost_per_registrant numeric)
language sql stable set enable_nestloop = off set jit = off as $$
  with r as (select date_trunc('week', registered_at)::date wk, campaign_id, count(distinct person_id) n
             from f_registrations(p_as_of, p_edition) where campaign_id is not null group by 1,2),
       s as (select date_trunc('week', activity_date)::date wk, campaign_id, sum(spend) sp
             from f_spend(p_as_of, p_edition) where campaign_id is not null group by 1,2)
  select coalesce(r.wk,s.wk), coalesce(r.campaign_id,s.campaign_id), coalesce(r.n,0)::int, coalesce(s.sp,0)::numeric,
         round(coalesce(s.sp,0)/nullif(r.n,0),1)
  from r full join s on r.wk=s.wk and r.campaign_id=s.campaign_id
  order by 1,2
$$;
create or replace view v_weekly_pace as select * from f_weekly_pace(cfg_as_of(), null);

-- Channel plan for an edition with a baseline year, built the way analysis/target_model.py builds the deck's plan [A]:
-- spend above last year's buys registrants at 1.5x last year's cost, cuts scale down proportionally.
-- m = plan registrants / last year's registrants for the channel. Used to weight last year's season curve
-- by the planned channel mix (cutting front-loaded paid social shifts registrations later in the season).
create or replace function f_channel_plan(p_edition text default null)
returns table(campaign_id text, base_spend numeric, base_registrants int, budget numeric, plan_registrants numeric, m numeric)
language sql stable set enable_nestloop = off set jit = off as $$
  with e as (select * from ed(p_edition)),
  k as (select * from f_channel_kpis(null, (select baseline_edition from e)) where (select baseline_edition from e) is not null)
  select k.campaign_id, k.spend_inr, k.registrants, c.budget_2026_inr,
    k.registrants * x.eff / k.spend_inr, x.eff / k.spend_inr
  from k join campaigns c on c.campaign_id = k.campaign_id,
  lateral (select case when c.budget_2026_inr > k.spend_inr then k.spend_inr + (c.budget_2026_inr - k.spend_inr) / 1.5
                       else c.budget_2026_inr end::numeric eff) x
  where k.spend_inr > 0 and k.registrants > 0 and c.budget_2026_inr is not null
$$;

-- Per-channel projection to the end of the campaign (editions with a baseline year) [A]:
-- projected registrants = registrants so far / the share of that channel's registrants last year had by the same
-- campaign day; projected cost per registrant = the channel's plan budget / projected registrants. This is the
-- deck's yardstick (e.g. contingent ₹75,000 / 876 = ₹85.6). Cost-to-date is misleading mid-season because spend
-- runs ahead of registrations (2025 College Partnerships: ₹137 by 9 Mar, ₹68.9 at the end) [D].
create or replace function f_channel_projection(p_as_of timestamp default null, p_edition text default null)
returns table(campaign_id text, registrants int, spend_to_date numeric, share_by_now numeric, projected_registrants int,
              plan_registrants int, budget numeric, projected_cost_per_registrant numeric)
language sql stable set enable_nestloop = off set jit = off as $$
  with e as materialized (select * from ed(p_edition)),
  b as materialized (select * from editions where edition = (select baseline_edition from e)),
  off as materialized (select (select campaign_start from b)::timestamp + (ed_cut(p_as_of, (select edition from e)) - (select campaign_start from e)::timestamp) upto),
  bl as materialized (select distinct on (person_id) person_id, campaign_id, registered_at from f_registrations(null, (select edition from b))
         where exists (select 1 from b) order by person_id, registered_at),
  sh as materialized (select campaign_id, count(*) filter (where registered_at <= off.upto)::numeric
                / nullif(count(*), 0) share from bl, off group by 1),
  k as materialized (select * from f_channel_kpis(p_as_of, (select edition from e))),
  pl as materialized (select * from f_channel_plan((select edition from e)))
  select k.campaign_id, k.registrants, k.spend_inr, round(sh.share, 3),
    case when sh.share > 0 then round(k.registrants / sh.share)::int end,
    round(pl.plan_registrants)::int, pl.budget,
    case when sh.share > 0 and k.registrants > 0 then round(pl.budget / (k.registrants / sh.share), 1) end
  from k join sh on sh.campaign_id = k.campaign_id left join pl on pl.campaign_id = k.campaign_id
$$;

-- This year against the same campaign week last year (baseline edition) and against the plan.
-- Plan pace = the target spread over the weeks like last year's registrations, weighted by the planned channel mix
-- (f_channel_plan), because registrations are back-loaded and differ by channel;
-- an even spread only when there is no baseline year.
-- Week 1 starts on the edition's campaign_start; registrations before it count in week 1.
create or replace function f_pace_compare(p_as_of timestamp default null, p_edition text default null, p_target text default null)
returns table(week_no int, week_start date, registrations int, cumulative int,
              last_week_start date, last_registrations int, last_cumulative int, plan_cumulative int)
language sql stable set enable_nestloop = off set jit = off as $$
  with e as (select * from ed(p_edition)),
  b as (select * from editions where edition = (select baseline_edition from e)),
  c as (select ed_cut(p_as_of, (select edition from e))::date d),
  t as (select registrants from plan_targets where target_key = coalesce(p_target, (select default_target from e))),
  n as (select greatest(ceil(((select fest_day1 from e) - (select campaign_start from e)) / 7.0), 1)::int n),
  wk as (select g wn, (select campaign_start from e) + 7*(g-1) ws from generate_series(1, (select n from n)) g),
  cur as (select greatest((registered_at::date - (select campaign_start from e)) / 7 + 1, 1) wn, count(distinct person_id) k
          from f_registrations(p_as_of, (select edition from e)) group by 1),
  pl as (select campaign_id, m from f_channel_plan((select edition from e))),
  bp as (select distinct on (person_id) person_id, campaign_id, registered_at from f_registrations(null, (select edition from b))
         where exists (select 1 from b) order by person_id, registered_at),
  prev as (select greatest((registered_at::date - (select campaign_start from b)) / 7 + 1, 1) wn, count(*) k,
                  sum(coalesce(pl.m, 1)) wk from bp left join pl using (campaign_id) group by 1)
  select wk.wn, wk.ws,
    case when wk.ws <= (select d from c) then coalesce(cur.k,0)::int end,
    case when wk.ws <= (select d from c) then (sum(coalesce(cur.k,0)) over (order by wk.wn))::int end,
    case when exists (select 1 from b) then (select campaign_start from b) + 7*(wk.wn-1) end,
    case when exists (select 1 from b) then coalesce(prev.k,0)::int end,
    case when exists (select 1 from b) then (sum(coalesce(prev.k,0)) over (order by wk.wn))::int end,
    case when (select sum(wk) from prev) > 0
         then round((select registrants from t) * (sum(coalesce(prev.wk,0)) over (order by wk.wn)) / (select sum(wk) from prev))::int
         else round((select registrants from t) * wk.wn::numeric / (select n from n))::int end
  from wk left join cur on cur.wn = wk.wn left join prev on prev.wn = wk.wn
  order by wk.wn
$$;

-- ---------- 4. forecast vs selected target ----------
create or replace function f_forecast(p_as_of timestamp default null, p_target text default null, p_edition text default null)
returns table(target_key text, target_label text, target_attendees int, actual_visitors int,
  registrants int, open_registrants int, assumed_show_rate_pct numeric, walk_ins_assumed int,
  forecast_attendees int, gap_to_target int, budget_inr int, spend_to_date numeric, note text,
  recent_weekly_registrations numeric, weeks_to_event numeric, projected_registrants int,
  projected_attendees int, projected_gap int, target_registrants int, expected_registrants_by_now int, pace_pct numeric,
  edition text, today timestamp, fest_day1 date)
language sql stable set enable_nestloop = off set jit = off as $$
  -- Before the fest: "so far" forecast (people already registered) AND a projection of final registrants.
  -- With a baseline year the projection is seasonal: registrants so far / the share of last year's registrants
  -- that had arrived by the same campaign day (registrations are back-loaded). Without one, it adds the
  -- last 21 days' run-rate for the weeks left. Pace compares with the target spread the same way.
  -- Show rate and walk-ins come from the edition settings [A].
  with e as materialized (select * from ed(p_edition)),
       f as materialized (select metric, value from f_funnel(p_as_of, (select edition from e))),
       t as materialized (select * from plan_targets where target_key = coalesce(p_target, (select default_target from e))),
       r as materialized (select registered_at from f_registrations(p_as_of, (select edition from e))),
       b as materialized (select * from editions where edition = (select baseline_edition from e)),
       pl as materialized (select campaign_id, m from f_channel_plan((select edition from e))),
       bl as materialized (select distinct on (person_id) person_id, registered_at, coalesce(pl.m, 1) m
              from f_registrations(null, (select edition from b)) left join pl using (campaign_id)
              where exists (select 1 from b) order by person_id, registered_at),
       x as materialized (select
          (select value from f where metric='verified_visitors')::int vis,
          (select value from f where metric='registrants')::int reg,
          (select value from f where metric='marketing_spend_inr') sp,
          (select fest_day1::timestamp + interval '10 hours' from e) ev_at,   -- gates open 10:00 (2025 event start) [D]
          (select fest_day2::timestamp + interval '1 day' from e) ev_end,
          (select campaign_start::timestamp from e) c_start,
          (select campaign_start::timestamp from b) b_start,
          ed_cut(p_as_of, (select edition from e)) cut,
          (select assumed_show_rate_pct / 100.0 from e) srate,
          (select assumed_walk_ins from e) walk),
       y as materialized (select x.*, (x.cut >= x.ev_end) post, (x.cut >= x.ev_at and x.cut < x.ev_end) live,
          greatest(extract(epoch from (x.ev_at - x.cut)) / 604800.0, 0) wleft,
          (select count(*) from r where registered_at > x.cut - interval '21 days') / 3.0 rate,
          greatest(extract(epoch from (x.cut - x.c_start)) / nullif(extract(epoch from (x.ev_at - x.c_start)),0), 0) frac,
          (select sum(m) filter (where registered_at <= x.b_start + (x.cut - x.c_start))
                  / nullif(sum(m), 0) from bl) share
          from x)
  select t.target_key, t.label, t.verified_attendees, y.vis, y.reg,
    case when y.post then 0 else y.reg end,
    round(y.srate*100,1), y.walk,
    case when y.post then y.vis else greatest(y.vis, round(y.reg*y.srate + y.walk)::int) end,
    (case when y.post then y.vis else greatest(y.vis, round(y.reg*y.srate + y.walk)::int) end) - t.verified_attendees,
    t.budget_inr, y.sp,
    case when y.post then 'Event has happened: forecast = actual verified visitors [D]'
         when y.live then 'Fest in progress: ' || y.vis || ' verified so far [D]; forecast_attendees = the larger of that and registrants x ' || round(y.srate*100,1) || '% + ' || y.walk || ' walk-ins [A].'
         when y.share > 0 then 'Pre-event. forecast_attendees = registrants so far x ' || round(y.srate*100,1) || '% + ' || y.walk || ' walk-ins (people already registered only). projected_registrants = registrants so far / ' || round(y.share*100,1) || '% (the share of planned registrants that last year''s curve, weighted by the planned channel mix, had in by the same campaign day) [A].'
         else 'Pre-event. forecast_attendees = registrants so far x ' || round(y.srate*100,1) || '% + ' || y.walk || ' walk-ins (people already registered only). projected_attendees adds the last 21 days'' weekly run-rate for the weeks left before the fest [A].' end,
    case when y.post then null else round(y.rate,1) end,
    case when y.post then 0 else round(y.wleft,1) end,
    case when y.post then y.reg else round(y.preg)::int end,
    case when y.post then y.vis else greatest(y.vis, round(y.preg*y.srate + y.walk)::int) end,
    (case when y.post then y.vis else greatest(y.vis, round(y.preg*y.srate + y.walk)::int) end) - t.verified_attendees,
    t.registrants,
    case when y.post or y.live then t.registrants else round(t.registrants * y.pfrac)::int end,
    case when y.post or y.live or coalesce(y.pfrac,0) = 0 then null else round(100.0 * y.reg / nullif(t.registrants * y.pfrac,0),1) end,
    (select edition from e), y.cut, (select fest_day1 from e)
  from t, (select y0.*,
              case when y0.share > 0 and not y0.live then greatest(y0.reg / y0.share, y0.reg) else y0.reg + y0.rate*y0.wleft end preg,
              case when y0.share is not null then least(y0.share, 1) else least(y0.frac, 1) end pfrac
            from y y0) y
$$;
create or replace view v_forecast as select * from f_forecast(cfg_as_of(), null, null);

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


-- ===== attendee management =====
-- Attendee management: the list, a person's timeline, and the actions the app takes on people.
-- Actions run with the caller's rights (anon may already write these tables) and stamp rows with the
-- edition's "today" (ed_clock), so they always land inside the edition's window.

-- ---------- list ----------
create or replace function f_attendees(p_edition text default null, p_q text default null, p_status text default null,
  p_limit int default 50, p_offset int default 0)
returns table(person_id text, person_name text, college text, role text, sport text, campaign_id text,
  registration_id text, registered_at timestamp, status text, attended boolean, last_checkin timestamp,
  reminders int, pass_issued boolean, pass_opened boolean, is_simulated boolean, total bigint)
language sql stable set enable_nestloop = off set jit = off as $$
  with w as materialized (select e.window_start ws, ed_cut(null, e.edition) cut, e.edition from ed(p_edition) e),
  p as materialized (select * from f_people(null, (select edition from w))),
  r as materialized (select distinct on (person_id) * from f_registrations(null, (select edition from w))
                     order by person_id, registered_at desc),
  v as materialized (select * from f_visitors(null, (select edition from w))),
  it as materialized (
    select i.person_id,
      count(*) filter (where event_type = 'reminder_sent')::int rem,
      bool_or(event_type = 'qr_pass_issued') iss, bool_or(event_type = 'qr_pass_downloaded') opn
    from interactions i, w where occurred_at between w.ws and w.cut
      and event_type in ('reminder_sent','qr_pass_issued','qr_pass_downloaded') group by 1),
  sim as materialized (select distinct on (person_id) person_id, is_simulated from people order by person_id, row_id),
  rows as (
    select p.person_id, p.person_name, coalesce(r.college, p.college) college, r.role, r.sport,
      coalesce(r.campaign_id, p.campaign_id) campaign_id, r.registration_id, r.registered_at,
      case when r.registration_id is null then case when p.source = 'walk_in' then 'walk-in' else 'lead' end else r.status end status,
      v.person_id is not null attended, v.first_checkin last_checkin,
      coalesce(it.rem,0) reminders, coalesce(it.iss,false) pass_issued, coalesce(it.opn,false) pass_opened,
      coalesce(sim.is_simulated,false) is_simulated
    from p left join r on r.person_id = p.person_id left join v on v.person_id = p.person_id
    left join it on it.person_id = p.person_id left join sim on sim.person_id = p.person_id),
  f as (
    select * from rows
    where (p_q is null or p_q = '' or person_name ilike '%' || p_q || '%' or person_id ilike '%' || p_q || '%'
           or registration_id ilike '%' || p_q || '%' or college ilike '%' || p_q || '%')
      and (p_status is null or p_status = '' or p_status = 'all'
           or (p_status = 'attended' and attended)
           or (p_status = 'no_pass' and status = 'confirmed' and not pass_issued)
           or status = p_status))
  select f.*, count(*) over () from f
  order by registered_at desc nulls last, person_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ---------- one person's history, all editions ----------
create or replace function f_person_timeline(p_person_id text)
returns table(at timestamp, kind text, detail text, campaign_id text)
language sql stable as $$
  select * from (
    select first_seen_at, 'first seen', 'via ' || coalesce(first_touch_source,'?'), first_campaign_id
      from (select * from people where person_id = p_person_id order by row_id limit 1) p
    union all select registered_at, 'registered', registration_id || coalesce(' · ' || role, '') || coalesce(' · ' || sport, ''), campaign_id
      from (select distinct on (registration_id) * from registrations where person_id = p_person_id order by registration_id, row_id) r
    union all select effective_at, 'status', status, campaign_id
      from (select distinct on (history_id) * from registration_history where person_id = p_person_id order by history_id, row_id) h
    union all select occurred_at, replace(event_type, '_', ' '), detail, campaign_id
      from (select distinct on (interaction_id) * from interactions where person_id = p_person_id order by interaction_id, row_id) i
    union all select occurred_at, 'gate: ' || result, verification || ' · ' || source, campaign_id
      from (select distinct on (event_id) * from checkins where person_id = p_person_id order by event_id, row_id) c
  ) t order by 1 desc nulls last limit 200
$$;

-- ---------- helpers ----------
create or replace function new_id(prefix text) returns text language sql volatile as $$
  select prefix || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))
$$;

create or replace function ed_suffix(p_edition text) returns text language sql immutable as $$
  select right(coalesce(p_edition, ''), 2)
$$;

-- latest status of one registration inside its edition
create or replace function reg_status(p_registration_id text, p_edition text default null) returns text language sql stable as $$
  select status from f_registrations(null, p_edition) where registration_id = p_registration_id
$$;

create or replace function confirmed_count(p_edition text default null) returns int language sql stable as $$
  select count(distinct person_id)::int from f_registrations(null, p_edition) where status = 'confirmed'
$$;

-- ---------- actions ----------
create or replace function register_person(p_name text, p_college text default null, p_role text default null,
  p_sport text default null, p_campaign_id text default null, p_edition text default null)
returns json language plpgsql as $$
declare e editions; ts timestamp; pid text; rid text; st text; cname text; cowner text;
begin
  e := ed(p_edition);
  p_name := btrim(coalesce(p_name, ''));
  if p_name = '' then raise exception 'Name is required'; end if;
  if length(p_name) > 80 or length(coalesce(p_college,'')) > 120 or length(coalesce(p_sport,'')) > 40 then raise exception 'A field is too long'; end if;
  if p_role is not null and p_role not in ('participant','spectator') then raise exception 'Role must be participant or spectator'; end if;
  p_campaign_id := nullif(upper(btrim(coalesce(p_campaign_id, ''))), '');
  ts := ed_clock(e.edition) - interval '1 second';
  if ts >= e.fest_day2::timestamp + interval '1 day' then raise exception 'Registration for % is closed: the fest is over', e.label; end if;
  st := case when confirmed_count(e.edition) >= e.capacity then 'waitlisted' else 'confirmed' end;
  select campaign_name, owner_name into cname, cowner from campaigns where campaign_id = p_campaign_id order by row_id limit 1;
  pid := new_id('P' || ed_suffix(e.edition) || '-');
  rid := new_id('R' || ed_suffix(e.edition) || '-');
  insert into people(person_id, person_name, person_type, first_seen_at, first_touch_source, first_campaign_id, first_campaign_name, college)
    values (pid, p_name, 'external', ts, case when p_campaign_id is null then 'direct' else 'campaign' end, p_campaign_id, cname, nullif(btrim(p_college), ''));
  insert into registrations(registration_id, person_id, person_name, campaign_id, campaign_name, owner_name, registered_at, college, role, sport)
    values (rid, pid, p_name, p_campaign_id, cname, cowner, ts, nullif(btrim(p_college), ''), p_role, nullif(btrim(p_sport), ''));
  insert into registration_history(history_id, registration_id, person_id, person_name, campaign_id, campaign_name, effective_at, status)
    values (new_id('H-'), rid, pid, p_name, p_campaign_id, cname, ts, st);
  return json_build_object('registration_id', rid, 'person_id', pid, 'status', st, 'at', ts);
end $$;

create or replace function set_registration_status(p_registration_id text, p_status text, p_edition text default null)
returns json language plpgsql as $$
declare e editions; cur text; r record; ts timestamp;
begin
  e := ed(p_edition);
  if p_status not in ('confirmed','cancelled','waitlisted') then raise exception 'Status must be confirmed, cancelled or waitlisted'; end if;
  select * into r from registrations where registration_id = p_registration_id order by row_id limit 1;
  if r is null then raise exception 'No registration %', p_registration_id; end if;
  cur := reg_status(p_registration_id, e.edition);
  if cur is null then raise exception 'Registration % is not in %', p_registration_id, e.label; end if;
  if cur = p_status then return json_build_object('registration_id', p_registration_id, 'status', cur, 'changed', false); end if;
  if p_status = 'confirmed' and confirmed_count(e.edition) >= e.capacity then
    raise exception 'The fest is full (% confirmed places). Raise capacity or cancel someone first.', e.capacity;
  end if;
  -- strictly after the previous status change, so "latest status" is never a tie
  select least(ed_clock(e.edition), greatest(ed_clock(e.edition) - interval '1 second', max(effective_at) + interval '1 millisecond'))
    into ts from registration_history where registration_id = p_registration_id;
  insert into registration_history(history_id, registration_id, person_id, person_name, campaign_id, campaign_name, effective_at, status)
    values (new_id('H-'), r.registration_id, r.person_id, r.person_name, r.campaign_id, r.campaign_name, ts, p_status);
  return json_build_object('registration_id', p_registration_id, 'status', p_status, 'previous', cur, 'changed', true);
end $$;

-- Promote the oldest waitlisted registrations while confirmed places are free (Bet 1: daily waitlist release)
create or replace function release_waitlist(p_edition text default null, p_max int default null)
returns json language plpgsql as $$
declare e editions; free int; n int := 0; r record;
begin
  e := ed(p_edition);
  free := e.capacity - confirmed_count(e.edition);
  if p_max is not null then free := least(free, p_max); end if;
  if free <= 0 then return json_build_object('released', 0, 'free_places', e.capacity - confirmed_count(e.edition)); end if;
  for r in select registration_id from f_registrations(null, e.edition) where status = 'waitlisted'
           order by registered_at, registration_id limit free loop
    perform set_registration_status(r.registration_id, 'confirmed', e.edition);
    n := n + 1;
  end loop;
  return json_build_object('released', n, 'free_places', e.capacity - confirmed_count(e.edition));
end $$;

-- reminder_sent | qr_pass_issued | qr_pass_downloaded, logged as an interaction (these feed Bet 1)
create or replace function log_touch(p_registration_id text, p_event_type text, p_detail text default null, p_edition text default null)
returns json language plpgsql as $$
declare e editions; r record;
begin
  e := ed(p_edition);
  if p_event_type not in ('reminder_sent','qr_pass_issued','qr_pass_downloaded') then raise exception 'Unknown touch type %', p_event_type; end if;
  select * into r from registrations where registration_id = p_registration_id order by row_id limit 1;
  if r is null then raise exception 'No registration %', p_registration_id; end if;
  insert into interactions(interaction_id, person_id, person_name, campaign_id, campaign_name, occurred_at, event_type, detail)
    values (new_id('I-'), r.person_id, r.person_name, r.campaign_id, r.campaign_name, ed_clock(e.edition) - interval '1 second', p_event_type, left(p_detail, 200));
  return json_build_object('ok', true);
end $$;

-- Send passes / reminders to everyone confirmed who has not had one (bulk version of log_touch)
create or replace function bulk_touch(p_event_type text, p_edition text default null)
returns json language plpgsql as $$
declare e editions; n int;
begin
  e := ed(p_edition);
  if p_event_type not in ('reminder_sent','qr_pass_issued') then raise exception 'Bulk action must be reminder_sent or qr_pass_issued'; end if;
  insert into interactions(interaction_id, person_id, person_name, campaign_id, campaign_name, occurred_at, event_type, detail)
  select new_id('I-'), r.person_id, g.person_name, r.campaign_id, g.campaign_name, ed_clock(e.edition) - interval '1 second', p_event_type, 'bulk'
  from f_registrations(null, e.edition) r
  join lateral (select person_name, campaign_name from registrations x where x.registration_id = r.registration_id order by row_id limit 1) g on true
  where r.status = 'confirmed'
    and (p_event_type = 'reminder_sent' or not exists (
      select 1 from interactions i where i.person_id = r.person_id and i.event_type = 'qr_pass_issued'
        and i.occurred_at between e.window_start and ed_clock(e.edition)));
  get diagnostics n = row_count;
  return json_build_object('sent', n);
end $$;

create or replace function gate_open(e editions) returns boolean language sql stable as $$
  select ed_clock(e.edition)::date between e.fest_day1 and e.fest_day2
$$;

-- Gate scan: admit a confirmed pass once per day; anything else is refused and logged as denied
create or replace function check_in(p_code text, p_source text default 'scanner', p_edition text default null)
returns json language plpgsql as $$
declare e editions; r record; st text; ts timestamp; prev timestamp;
begin
  e := ed(p_edition);
  if not gate_open(e) then
    raise exception 'The gate is closed: today in % is %. Move the demo clock to a fest day (% or %) to rehearse.', e.label, ed_clock(e.edition)::date, e.fest_day1, e.fest_day2;
  end if;
  p_code := upper(btrim(coalesce(p_code, '')));
  select * into r from registrations where upper(registration_id) = p_code order by row_id limit 1;
  if r is null then return json_build_object('ok', false, 'reason', 'No registration with pass code ' || p_code); end if;
  st := reg_status(r.registration_id, e.edition);
  if st is null then return json_build_object('ok', false, 'reason', 'This pass is for another fest year', 'name', r.person_name); end if;
  ts := ed_clock(e.edition);
  select max(occurred_at) into prev from checkins where person_id = r.person_id and result = 'admitted'
    and occurred_at::date = ts::date;
  if prev is not null then
    return json_build_object('ok', true, 'repeat', true, 'name', r.person_name, 'status', st, 'admitted_at', prev);
  end if;
  insert into checkins(event_id, person_id, person_name, registration_id, campaign_id, campaign_name, occurred_at, result, verification, source)
    values (new_id('G-'), r.person_id, r.person_name, r.registration_id, r.campaign_id, r.campaign_name, ts,
            case when st = 'confirmed' then 'admitted' else 'denied' end, 'verified',
            case when p_source in ('scanner','manual') then p_source else 'manual' end);
  if st <> 'confirmed' then
    return json_build_object('ok', false, 'reason', 'Pass status is ' || st || ', not confirmed', 'name', r.person_name, 'status', st);
  end if;
  return json_build_object('ok', true, 'repeat', false, 'name', r.person_name, 'status', st, 'admitted_at', ts,
    'role', r.role, 'sport', r.sport, 'college', r.college);
end $$;

-- A visitor with no registration, admitted at the gate
create or replace function walk_in(p_name text, p_college text default null, p_edition text default null)
returns json language plpgsql as $$
declare e editions; pid text; ts timestamp;
begin
  e := ed(p_edition);
  if not gate_open(e) then raise exception 'The gate is closed: today in % is %.', e.label, ed_clock(e.edition)::date; end if;
  p_name := btrim(coalesce(p_name, ''));
  if p_name = '' or length(p_name) > 80 then raise exception 'Enter the visitor''s name (up to 80 characters)'; end if;
  ts := ed_clock(e.edition);
  pid := new_id('W' || ed_suffix(e.edition) || '-');
  insert into people(person_id, person_name, person_type, first_seen_at, first_touch_source, college)
    values (pid, p_name, 'external', ts, 'walk_in', nullif(btrim(p_college), ''));
  insert into checkins(event_id, person_id, person_name, occurred_at, result, verification, source)
    values (new_id('G-'), pid, p_name, ts, 'admitted', 'verified', 'manual');
  return json_build_object('ok', true, 'person_id', pid, 'name', p_name, 'admitted_at', ts);
end $$;

-- Live gate numbers for today
create or replace function f_gate_today(p_edition text default null)
returns table(today date, gate_open boolean, admitted_today int, denied_today int, walk_ins_today int,
              verified_total int, confirmed int, last_hour int)
language sql stable as $$
  with e as (select * from ed(p_edition)), t as (select ed_clock((select edition from e)) now_),
  c as (select distinct on (event_id) * from checkins, t where occurred_at::date = t.now_::date order by event_id, row_id)
  select (select now_::date from t), gate_open(ed(p_edition)),
    (select count(distinct person_id) from c where result = 'admitted')::int,
    (select count(*) from c where result = 'denied')::int,
    (select count(distinct person_id) from c where result = 'admitted' and registration_id is null)::int,
    (select count(*) from f_visitors(null, (select edition from e)))::int,
    confirmed_count((select edition from e)),
    (select count(distinct person_id) from c, t where result = 'admitted' and occurred_at > t.now_ - interval '1 hour')::int
$$;

-- Move "today" for an edition (demo only; inside its window)
create or replace function set_demo_clock(p_clock timestamp, p_edition text default null)
returns json language plpgsql as $$
declare e editions;
begin
  e := ed(p_edition);
  if p_clock < e.window_start or p_clock > e.window_end then
    raise exception 'Pick a date between % and %', e.window_start::date, e.window_end::date;
  end if;
  update editions set demo_clock = p_clock where edition = e.edition;
  return json_build_object('edition', e.edition, 'today', p_clock);
end $$;

-- ---------- simulated 2026 weeks ----------
-- Builds the first weeks of the 2026 campaign (up to the 2026 demo clock) from the 2025 campaign shifted by
-- 364 days (same weekday), with each channel's volume and spend scaled by an assumed 2026 multiplier [A].
-- Every row is flagged is_simulated; remove_simulated() deletes them, reset restores them.
-- Move each table's row_id counter past the highest row_id in use. Rows copied in with explicit ids
-- (data loads, Reset data) can leave a counter behind, which makes the next insert collide.
create or replace function sync_row_ids() returns void language plpgsql as $$
declare t text;
begin
  foreach t in array array['campaigns','daily_marketing','people','interactions','registrations','registration_history','checkins'] loop
    execute format('select setval(pg_get_serial_sequence(''public.%I'',''row_id''), greatest(coalesce((select max(row_id) from public.%I),0),1))', t, t);
  end loop;
end $$;

create or replace function seed_simulated_2026() returns json language plpgsql as $$
declare e editions; cut timestamp; sh interval := interval '364 days'; n_people int; n_reg int;
begin
  select * into e from editions where edition = '2026';
  cut := e.demo_clock;
  perform remove_simulated();
  perform sync_row_ids();
  -- The simulation runs the deck's base plan (analysis/target_model.py) [A]:
  --   m     = 2026 plan registrants / 2025 registrants per channel (e.g. College Partnerships 876 / 450)
  --   ratio = 2026 channel budget / 2025 spend (e.g. 75,000 / 31,000); spend keeps 2025's weekly timing
  create temp table _m(campaign_id text primary key, m numeric, ratio numeric) on commit drop;
  insert into _m values
    ('C01', 669/520.0, 60000/42000.0),   -- Campus Ambassadors
    ('C02', 219/680.0, 30000/93000.0),   -- Paid Social, retargeting only
    ('C03',  89/350.0, 15000/59000.0),   -- Creator Partners
    ('C04', 876/450.0, 75000/31000.0),   -- College Partnerships -> contingent engine
    ('C05', 608/350.0, 40000/19000.0),   -- Student Referrals
    ('C06', 381/250.0, 25000/14000.0),   -- Organic Search
    ('C07', 275/200.0, 25000/16000.0);   -- Community Groups
  create temp table _sp on commit drop as select campaign_id, m, ratio from _m;
  create temp table _p on commit drop as
    select p.*, g.k, 'S' || g.k || '-' || p.person_id new_pid
    from (select distinct on (person_id) * from people
          where person_type = 'external' and first_touch_source = 'campaign' and not is_simulated
            and first_seen_at between '2025-01-01' and '2025-05-31' and first_seen_at + interval '364 days' <= cut
          order by person_id, row_id) p
    join _m on _m.campaign_id = p.first_campaign_id
    cross join lateral generate_series(1, floor(_m.m)::int +
      case when (abs(hashtext(p.person_id)) % 1000) / 1000.0 < _m.m - floor(_m.m) then 1 else 0 end) g(k);
  insert into people(person_id, person_name, person_type, first_seen_at, first_touch_source, first_campaign_id,
                     first_campaign_name, owner_id, owner_name, is_simulated)
    select new_pid, person_name, 'external', first_seen_at + sh, 'campaign', first_campaign_id, first_campaign_name, owner_id, owner_name, true from _p;
  get diagnostics n_people = row_count;
  create temp table _r on commit drop as
    select r.*, p.k, p.new_pid, 'S' || p.k || '-' || r.registration_id new_rid
    from (select distinct on (registration_id) * from registrations where not is_simulated
          and registered_at between '2025-01-01' and '2025-05-31' order by registration_id, row_id) r
    join _p p on p.person_id = r.person_id
    where r.registered_at + sh <= cut;
  insert into registrations(registration_id, person_id, person_name, campaign_id, campaign_name, owner_id, owner_name, registered_at, is_simulated)
    select new_rid, new_pid, person_name, campaign_id, campaign_name, owner_id, owner_name, registered_at + sh, true from _r;
  get diagnostics n_reg = row_count;
  insert into registration_history(history_id, registration_id, person_id, person_name, campaign_id, campaign_name, owner_id, owner_name, effective_at, status, is_simulated)
    select 'S' || r.k || '-' || h.history_id, r.new_rid, r.new_pid, h.person_name, h.campaign_id, h.campaign_name, h.owner_id, h.owner_name, h.effective_at + sh, h.status, true
    from (select distinct on (history_id) * from registration_history where not is_simulated order by history_id, row_id) h
    join _r r on r.registration_id = h.registration_id
    where h.effective_at + sh <= cut;
  insert into interactions(interaction_id, person_id, person_name, campaign_id, campaign_name, owner_id, owner_name, occurred_at, event_type, detail, is_simulated)
    select 'S' || p.k || '-' || i.interaction_id, p.new_pid, i.person_name, i.campaign_id, i.campaign_name, i.owner_id, i.owner_name, i.occurred_at + sh, i.event_type, i.detail, true
    from (select distinct on (interaction_id) * from interactions where not is_simulated order by interaction_id, row_id) i
    join _p p on p.person_id = i.person_id
    where i.occurred_at + sh <= cut;
  -- QR passes: the show-up programme issues a pass on confirmation; ~80% of people open it [A]
  insert into interactions(interaction_id, person_id, person_name, campaign_id, campaign_name, occurred_at, event_type, detail, is_simulated)
    select 'SQ' || x.t || '-' || r.new_rid, r.new_pid, r.person_name, r.campaign_id, r.campaign_name,
           least(r.registered_at + sh + (case when x.t = 1 then interval '1 hour' else interval '1 day' end), cut - interval '1 second'),
           case when x.t = 1 then 'qr_pass_issued' else 'qr_pass_downloaded' end, 'simulated', true
    from _r r cross join (values (1),(2)) x(t)
    join (select registration_id, status from f_registrations(null, '2026')) st on st.registration_id = r.new_rid
    where st.status = 'confirmed'
      and (x.t = 1 or (abs(hashtext(r.new_rid)) % 100) < 80);
  insert into daily_marketing(activity_id, campaign_id, campaign_name, owner_id, owner_name, activity_date, impressions, clicks,
                              reported_reach, landing_page_sessions, registration_starts, marketing_spend_inr, platform, is_simulated)
    select 'S-' || d.activity_id, d.campaign_id, d.campaign_name, d.owner_id, d.owner_name, d.activity_date + sh,
      round(d.impressions * s.m), round(d.clicks * s.m), round(d.reported_reach * s.m),
      round(d.landing_page_sessions * s.m), round(d.registration_starts * s.m), round(d.marketing_spend_inr * s.ratio),
      d.platform, true
    from (select distinct on (activity_id) * from daily_marketing where not is_simulated
          and activity_date between '2025-01-01' and '2025-05-31' order by activity_id, row_id) d
    join _sp s on s.campaign_id = d.campaign_id
    where d.activity_date + sh <= cut;
  return json_build_object('people', n_people, 'registrations', n_reg, 'up_to', cut);
end $$;

create or replace function remove_simulated() returns json language plpgsql as $$
declare t text; n int; out jsonb := '{}';
begin
  foreach t in array array['checkins','interactions','registration_history','registrations','daily_marketing','people'] loop
    execute format('delete from public.%I where is_simulated', t);
    get diagnostics n = row_count;
    out := out || jsonb_build_object(t, n);
  end loop;
  return out::json;
end $$;


-- ===== access rules =====
-- Access rules for the public demo (anon key) and the chatbot.
-- Demo users can read everything and edit the operational tables; "Reset to original" undoes any damage.
-- The chatbot's free-form SQL runs through copilot_query(): SELECT/WITH only, read-only transaction,
-- the API role's statement timeout (Supabase anon: 3 s), max 200 rows, executed as role copilot_ro, which can read but never write.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'copilot_ro') then
    create role copilot_ro nologin noinherit;
  end if;
end $$;

-- 1. Table privileges ---------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
revoke select on chat_log from anon, authenticated;

-- editable through the app (Campaigns & tasks, Data screen, settings)
grant insert, update, delete on tasks, bet_kpi_readings, daily_marketing, checkins, registrations,
  registration_history, people, interactions to anon, authenticated;
grant update on campaigns, bets, app_settings, plan_targets, editions to anon, authenticated;
grant insert on campaigns to anon, authenticated;
grant insert on audit_log, chat_log to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- RLS on (Supabase best practice) with explicit demo policies mirroring the grants above
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists demo_read on public.%I', t);
    execute format('drop policy if exists demo_write on public.%I', t);
    if t <> 'chat_log' then
      execute format('create policy demo_read on public.%I for select to anon, authenticated, copilot_ro using (true)', t);
    end if;
    if t in ('tasks','bet_kpi_readings','daily_marketing','checkins','registrations','registration_history',
             'people','interactions','campaigns','bets','app_settings','audit_log','chat_log','plan_targets','editions') then
      execute format('create policy demo_write on public.%I for all to anon, authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

-- views run with the owner's rights; make them respect the caller instead where it matters
-- (all v_* views only read data that anon can already read, so owner rights are acceptable here)

-- 2. Function privileges ------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
-- read functions (metrics) and the helpers they call (functions run with the caller's rights)
grant execute on function cfg_as_of(), ed(text), ed_clock(text), ed_cut(timestamp, text), ed_suffix(text),
  f_registrations(timestamp, text), f_visitors(timestamp, text), f_spend(timestamp, text), f_people(timestamp, text),
  f_funnel(timestamp, text), f_channel_kpis(timestamp, text), f_weekly_pace(timestamp, text), f_channel_weekly(timestamp, text),
  f_pace_compare(timestamp, text, text), f_forecast(timestamp, text, text), f_channel_plan(text), f_channel_projection(timestamp, text),
  f_attendees(text, text, text, int, int), f_person_timeline(text), f_gate_today(text),
  reg_status(text, text), confirmed_count(text), gate_open(editions)
  to anon, authenticated;
-- attendee actions used by the app (write only to tables anon may already edit)
grant execute on function new_id(text), register_person(text, text, text, text, text, text),
  set_registration_status(text, text, text), release_waitlist(text, int), log_touch(text, text, text, text),
  bulk_touch(text, text), check_in(text, text, text), walk_in(text, text, text), set_demo_clock(timestamp, text),
  remove_simulated()
  to anon, authenticated;
-- copy_table() and seed_simulated_2026() stay owner-only

alter function reset_to_original() security definer set search_path = public;
grant execute on function reset_to_original() to anon, authenticated;
-- load_from_github() stays owner-only (it fetches from the internet)

-- the http extension must never be callable by the app or the chatbot
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'extensions' and p.proname like 'http%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- 3. Read-only role and SQL tool for the chatbot ------------------------------

grant copilot_ro to current_user;   -- needed to hand function ownership to the role
grant usage on schema public to copilot_ro;
grant select on all tables in schema public to copilot_ro;
revoke select on chat_log, audit_log from copilot_ro;
grant execute on function cfg_as_of(), ed(text), ed_clock(text), ed_cut(timestamp, text), ed_suffix(text),
  f_registrations(timestamp, text), f_visitors(timestamp, text), f_spend(timestamp, text), f_people(timestamp, text),
  f_funnel(timestamp, text), f_channel_kpis(timestamp, text), f_weekly_pace(timestamp, text), f_channel_weekly(timestamp, text),
  f_pace_compare(timestamp, text, text), f_forecast(timestamp, text, text), f_channel_plan(text), f_channel_projection(timestamp, text),
  f_attendees(text, text, text, int, int), f_person_timeline(text), f_gate_today(text),
  reg_status(text, text), confirmed_count(text), gate_open(editions)
  to copilot_ro;

create or replace function copilot_query(q text) returns json
language plpgsql security definer set search_path = public as $$
declare
  clean text := regexp_replace(btrim(q), ';\s*$', '');
  res json; n int;
begin
  if clean !~* '^(select|with)\s' then
    raise exception 'Only SELECT or WITH queries are allowed';
  end if;
  if position(';' in clean) > 0 then
    raise exception 'Only one statement is allowed';
  end if;
  set local transaction_read_only = on;
  execute format('select count(*) from (%s) q', clean) into n;
  execute format('select coalesce(json_agg(t), ''[]''::json) from (select * from (%s) q limit 200) t', clean) into res;
  return json_build_object('row_count', n, 'returned', least(n, 200), 'truncated', n > 200, 'rows', res);
end $$;
-- a new owner needs CREATE on the schema (Supabase's postgres user is not a superuser); take it back right after
grant create on schema public to copilot_ro;
alter function copilot_query(text) owner to copilot_ro;
revoke create on schema public from copilot_ro;
revoke execute on function copilot_query(text) from public;
grant execute on function copilot_query(text) to anon, authenticated;

-- 4. Housekeeping -------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists tasks_touch on tasks;
create trigger tasks_touch before update on tasks for each row execute function touch_updated_at();


-- ===== 2026 show rate from the plan's channel mix [A] =====
update editions set assumed_show_rate_pct = 77.2 where edition = '2026';
update original.editions set assumed_show_rate_pct = 77.2 where edition = '2026';

-- Tidy display text: rupee sign, arrows and range dashes in the bet rules; plain source names on targets
update bets set description = regexp_replace(replace(replace(replace(replace(description,'Rs ','₹'),' -> ',' → '),'>= ','≥ '),'<= ','≤ '),'(\d)-(\d)','\1–\2','g'), scale_if = regexp_replace(replace(replace(replace(replace(scale_if,'Rs ','₹'),' -> ',' → '),'>= ','≥ '),'<= ','≤ '),'(\d)-(\d)','\1–\2','g'), change_if = regexp_replace(replace(replace(replace(replace(change_if,'Rs ','₹'),' -> ',' → '),'>= ','≥ '),'<= ','≤ '),'(\d)-(\d)','\1–\2','g'), stop_if = regexp_replace(replace(replace(replace(replace(stop_if,'Rs ','₹'),' -> ',' → '),'>= ','≥ '),'<= ','≤ '),'(\d)-(\d)','\1–\2','g'), action_text = regexp_replace(replace(replace(replace(replace(action_text,'Rs ','₹'),' -> ',' → '),'>= ','≥ '),'<= ','≤ '),'(\d)-(\d)','\1–\2','g') where bet_id is not null;
update plan_targets set source = replace(replace(source, 'analysis/target_model.py base case', 'Strategy model, base case'), 'analysis/target_model.py stretch case', 'Strategy model, stretch case') where source like 'analysis/%';
update original.plan_targets set source = replace(replace(source, 'analysis/target_model.py base case', 'Strategy model, base case'), 'analysis/target_model.py stretch case', 'Strategy model, stretch case') where source like 'analysis/%';

-- Demo tasks were dated from the real calendar (Dec 2026), after the 2026 fest. Date them inside the fest year instead,
-- counted from the 2026 demo "today" (8 Mar 2026).
update tasks t set due_date = date '2026-03-08' + v.days
from (values ('Set up T-14 / T-3 / T-1 reminder sequence', 7), ('Daily waitlist auto-release job', 10),
             ('Send formal invites to 40 NCR college sports committees', 14), ('Cut Paid Social to the 2026 budget', 5),
             ('Design squad referral rewards (non-cash)', 21), ('Pitch sponsor for evening pro-night', 28)) v(title, days)
where t.title = v.title and t.created_by = 'user' and t.due_date > date '2026-05-31';


-- ===== simulated 2026 weeks (rebuilt each run; also stored for Reset data) =====
select seed_simulated_2026();
delete from original.people where is_simulated;
delete from original.registrations where is_simulated;
delete from original.registration_history where is_simulated;
delete from original.interactions where is_simulated;
delete from original.daily_marketing where is_simulated;
select copy_table('public.people', 'original.people', 'is_simulated');
select copy_table('public.registrations', 'original.registrations', 'is_simulated');
select copy_table('public.registration_history', 'original.registration_history', 'is_simulated');
select copy_table('public.interactions', 'original.interactions', 'is_simulated');
select copy_table('public.daily_marketing', 'original.daily_marketing', 'is_simulated');
update app_settings set edition = '2026', as_of = null where id = 1;

commit;
select reset_to_original();
analyze;

select '2025 verified visitors' as check, (select value::text from f_funnel(null, '2025') where metric = 'verified_visitors') as result
union all select '2026 registrants so far (simulated)', (select value::text from f_funnel(null, '2026') where metric = 'registrants')
union all select '2026 pace vs plan (%)', (select pace_pct::text from f_forecast(null, null, '2026'))
union all select '2026 projected registrants (plan 3,117)', (select projected_registrants::text from f_forecast(null, null, '2026'))
union all select 'contingent projected cost per registrant (plan 85.6)', (select projected_cost_per_registrant::text from f_channel_projection(null, '2026') where campaign_id = 'C04')
union all select 'reset works for the app', has_function_privilege('anon', 'reset_to_original()', 'execute')::text
union all select 'same week last year', (select last_cumulative::text from f_pace_compare(null, '2026') where week_no = 7)
union all select 'anon can register people', has_function_privilege('anon', 'register_person(text,text,text,text,text,text)', 'execute')::text;
