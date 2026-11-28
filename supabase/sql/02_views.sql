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
