-- update_07: simulated 2026 people get distinct names, colleges, roles and sports [A]; bet 3 text matches Slide 3.
-- No counts, dates, statuses or spend change, so every number on every screen stays the same. Safe to re-run.
begin;
-- 07: make the simulated 2026 people look like real sign-ups [A]. Changes names, colleges, roles and sports only:
-- no count, date, status, spend or campaign changes, so every metric stays exactly the same.
--  * Clones (S2-, S3- ...) of a 2025 person used to keep that person's name, so the same name appeared twice.
--    They now get a different name drawn from the 2025 name pool.
--  * Simulated registrations get a college, a role (participant / spectator) and, for participants, a sport,
--    as the 2026 registration form asks. Mix by channel is an assumption [A]: contingents are mostly players.
create or replace function stable_hash(t text) returns int language sql immutable as $$
  select abs(('x' || substr(md5(t), 1, 8))::bit(32)::int) $$;

create or replace function sim_dress_up(p_schema text default 'public') returns json language plpgsql as $$
declare n_names int; n_regs int;
begin
  -- every clone gets a distinct first + last name combination that no other simulated person has
  execute format($q$
    create temp table _nm on commit drop as
    with pool as (select distinct person_name from %1$I.people where not is_simulated and person_type = 'external' and person_name like '%% %%'),
         f as (select distinct split_part(person_name, ' ', 1) fn from pool),
         l as (select distinct substr(person_name, strpos(person_name, ' ') + 1) ln from pool),
         taken as (select distinct person_name from %1$I.people where is_simulated and person_id !~ '^S[2-9]-'),
         free as (select f.fn || ' ' || l.ln nm, row_number() over (order by stable_hash(f.fn || ' ' || l.ln), f.fn, l.ln) rn
                  from f cross join l where f.fn || ' ' || l.ln not in (select person_name from taken)),
         c as (select person_id, row_number() over (order by stable_hash(person_id), person_id) rn
               from (select distinct person_id from %1$I.people where is_simulated and person_id ~ '^S[2-9]-') z)
    select c.person_id, free.nm from c join free using (rn) $q$, p_schema);
  execute format('update %I.people t set person_name = n.nm from _nm n where t.person_id = n.person_id and t.is_simulated', p_schema);
  get diagnostics n_names = row_count;
  execute format('update %I.registrations t set person_name = n.nm from _nm n where t.person_id = n.person_id and t.is_simulated', p_schema);
  execute format('update %I.registration_history t set person_name = n.nm from _nm n where t.person_id = n.person_id and t.is_simulated', p_schema);
  execute format('update %I.interactions t set person_name = n.nm from _nm n where t.person_id = n.person_id and t.is_simulated', p_schema);
  execute format($q$
    update %1$I.registrations r set
      role = x.role,
      sport = case when x.role = 'participant' then (array['Athletics','Badminton','Basketball','Chess','Cricket','Football','Hockey','Squash','Table tennis','Tennis','Volleyball'])[1 + stable_hash(r.registration_id || 's') %% 11] end,
      college = case when r.campaign_id = 'C04'
        then (array['Chandigarh University','Lovely Professional University','Guru Nanak Dev University','Panjab University','Kurukshetra University','Maharshi Dayanand University','Delhi Technological University','Netaji Subhas University of Technology','Jamia Millia Islamia','Amity University Noida','Shiv Nadar University','Ashoka University','Sharda University','University of Rajasthan'])[1 + stable_hash(r.registration_id || 'c') %% 14]
        else (array['Hansraj College','Hindu College','Kirori Mal College','St. Stephen''s College','Shri Ram College of Commerce','Miranda House','Ramjas College','Sri Venkateswara College','Delhi Technological University','Netaji Subhas University of Technology','IIIT Delhi','Jamia Millia Islamia','Amity University Noida','Shiv Nadar University','Sharda University','GGSIPU','Jamia Hamdard','Bennett University'])[1 + stable_hash(r.registration_id || 'c') %% 18] end
    from (select registration_id, case when (stable_hash(registration_id || 'r') %% 100) <
            case campaign_id when 'C04' then 75 when 'C05' then 35 when 'C01' then 30 when 'C07' then 30 else 15 end
          then 'participant' else 'spectator' end role
          from %1$I.registrations where is_simulated) x
    where r.registration_id = x.registration_id and r.is_simulated $q$, p_schema);
  get diagnostics n_regs = row_count;
  drop table if exists _nm;
  return json_build_object('schema', p_schema, 'renamed_people_rows', n_names, 'registrations_dressed', n_regs);
end $$;
revoke all on function sim_dress_up(text) from public;
do $$ begin if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function sim_dress_up(text) from anon, authenticated'; end if; end $$;

select sim_dress_up('public');
select sim_dress_up('original');

update bets set change_if = 'Within 5% of the ceiling → hold' where bet_id = 3;
commit;

select 'distinct simulated names (expect 1884 of 1885)' as check, count(distinct person_name)::text || ' of ' || count(*) as result from people where is_simulated
union all select 'simulated registrations with a role (expect 1203)', count(*)::text from registrations where is_simulated and role is not null
union all select '2026 registrants unchanged (expect 1203)', value::text from f_funnel(null, '2026') where metric = 'registrants'
union all select 'projected attendees unchanged (expect 2479)', projected_attendees::text from f_forecast(null, '2026_base', '2026');
