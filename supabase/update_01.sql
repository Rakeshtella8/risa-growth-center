-- Update 1: faster metric functions, access rules, demo tasks. Paste the whole file into the Supabase SQL editor and Run. Safe to run more than once.
begin;

-- 1. Faster metric functions ---------------------------------------------------
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
  impressions numeric, clicks numeric, identified int, registrants int, confirmed int, cancelled int,
  visitors int, show_rate_pct numeric, cost_per_registrant numeric, cost_per_visitor numeric,
  cost_ceiling numeric, opt_outs int, flag text)
language sql stable set enable_nestloop = off as $$
  with ext as materialized (select person_id, first_campaign_id, first_seen_at from c_ext_people),
       s as materialized (select campaign_id, sum(spend) sp, sum(impressions) im, sum(clicks) cl from f_spend(p_as_of) group by 1),
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
       k as (
         select c.campaign_id, c.campaign_name, c.channel, c.status,
           coalesce(s.sp,0)::numeric sp, coalesce(s.im,0)::numeric im, coalesce(s.cl,0)::numeric cl,
           coalesce(ia.idn,0)::int idn, coalesce(ra.reg,0)::int reg, coalesce(ra.conf,0)::int conf,
           coalesce(ra.canc,0)::int canc, coalesce(ra.vis,0)::int vis, coalesce(oa.opt,0)::int opt,
           b.cost_per_registrant_2025 * b.ceiling_multiplier ceil
         from (select distinct on (campaign_id) * from campaigns order by campaign_id, row_id) c
         left join s on s.campaign_id = c.campaign_id
         left join ra on ra.campaign_id = c.campaign_id
         left join ia on ia.campaign_id = c.campaign_id
         left join oa on oa.campaign_id = c.campaign_id
         left join channel_baseline b on b.campaign_id = c.campaign_id)
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
language sql stable set enable_nestloop = off as $$
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
language sql stable set enable_nestloop = off as $$
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

-- 2. Access rules ---------------------------------------------------------------
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
commit;

-- 3. Demo tasks linked to the bets (only if the task list is empty) ---------------------------
insert into tasks (title, description, owner_name, due_date, status, priority, bet_id, campaign_id, created_by)
select * from (values
 ('Set up T-14 / T-3 / T-1 reminder sequence', 'Email + WhatsApp reminders with QR pass link for every confirmed registrant.', 'CRM/ops lead', current_date + 7, 'doing', 'high', 1, null::text, 'user'),
 ('Daily waitlist auto-release job', '88 people were stuck on the waitlist in 2025 [D]. Release seats daily as cancellations arrive.', 'CRM/ops lead', current_date + 10, 'todo', 'high', 1, null, 'user'),
 ('Send formal invites to 40 NCR college sports committees', 'Team registration form; track cost per contingent registrant against the 103 / 138 thresholds.', 'Partnerships lead', current_date + 14, 'todo', 'high', 2, 'C04', 'user'),
 ('Cut Paid Social to the 2026 budget', 'Paid Social and Creators move to the 2026 plan budgets; freed money goes to bets 1 and 2.', 'Growth lead', current_date + 5, 'todo', 'medium', 3, 'C02', 'user'),
 ('Design squad referral rewards (non-cash)', 'Merch and priority entry for squads of 5+. KPI: referred / contingent registrants.', 'Referrals lead', current_date + 21, 'todo', 'medium', 4, 'C05', 'user'),
 ('Pitch sponsor for evening pro-night', 'Needs 300 RSVPs to justify a second night.', 'Events + sponsorship lead', current_date + 28, 'todo', 'low', 5, null, 'user')
) v(title, description, owner_name, due_date, status, priority, bet_id, campaign_id, created_by)
where not exists (select 1 from tasks);

analyze;

-- 4. Checks (should show: chat_log hidden from anon = false, copilot read works, fast funnel)
select 'anon can read chat_log' as check, has_table_privilege('anon', 'chat_log', 'select')::text as result
union all select 'anon can delete campaigns', has_table_privilege('anon', 'campaigns', 'delete')::text
union all select 'copilot_query rows', (copilot_query('select count(*) as n from campaigns')->>'row_count')
union all select 'tasks', (select count(*)::text from tasks)
union all select 'verified visitors', (select value::text from v_funnel where metric = 'verified_visitors');
