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
grant update on campaigns, bets, app_settings to anon, authenticated;
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
             'people','interactions','campaigns','bets','app_settings','audit_log','chat_log') then
      execute format('create policy demo_write on public.%I for all to anon, authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

-- views run with the owner's rights; make them respect the caller instead where it matters
-- (all v_* views only read data that anon can already read, so owner rights are acceptable here)

-- 2. Function privileges ------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function cfg_as_of(), f_registrations(timestamp), f_visitors(timestamp), f_spend(timestamp),
  f_funnel(timestamp), f_channel_kpis(timestamp), f_weekly_pace(timestamp), f_forecast(timestamp, text)
  to anon, authenticated;

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
grant execute on function cfg_as_of(), f_registrations(timestamp), f_visitors(timestamp), f_spend(timestamp),
  f_funnel(timestamp), f_channel_kpis(timestamp), f_weekly_pace(timestamp), f_forecast(timestamp, text)
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
alter function copilot_query(text) owner to copilot_ro;
revoke execute on function copilot_query(text) from public;
grant execute on function copilot_query(text) to anon, authenticated;

-- 4. Housekeeping -------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists tasks_touch on tasks;
create trigger tasks_touch before update on tasks for each row execute function touch_updated_at();
