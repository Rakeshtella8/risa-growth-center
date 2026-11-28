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
create or replace function seed_simulated_2026() returns json language plpgsql as $$
declare e editions; cut timestamp; sh interval := interval '364 days'; n_people int; n_reg int;
begin
  select * into e from editions where edition = '2026';
  cut := e.demo_clock;
  perform remove_simulated();
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
