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
