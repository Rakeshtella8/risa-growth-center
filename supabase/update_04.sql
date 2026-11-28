-- update_04: fixes "Reset data" on Supabase (its safeupdate guard refuses DELETE without WHERE),
-- tidies bet and target display text, dates the demo tasks inside the fest year,
-- then restores the original data once. Safe to run more than once.
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
-- create or replace resets these, so restore them (same as 05_security.sql)
alter function reset_to_original() security definer set search_path = public;
grant execute on function reset_to_original() to anon, authenticated;


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

select reset_to_original();

select (select demo_clock::text from editions where edition = '2026') as clock_2026,
       (select value::text from f_funnel(null, '2026') where metric = 'registrants') as registrants_2026;
