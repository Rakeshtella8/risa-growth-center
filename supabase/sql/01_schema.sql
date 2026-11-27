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
 ('2026','CampusFest 2026 (live)','2026-01-01','2026-05-31 23:59:59','2026-01-19','2026-04-11','2026-04-12',3000,68.8,125,'2026_base','2025','2026-03-08 23:59:59')
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
    delete from public.editions;
    perform copy_table('original.editions', 'public.editions');
  end if;
  update app_settings set as_of = null where id = 1;
  insert into audit_log(table_name, action) values ('*', 'reset_to_original');
  return 'reset done';
end $$;
