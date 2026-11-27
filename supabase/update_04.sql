-- update_04: fixes "Reset data" on Supabase (its safeupdate guard refuses DELETE without WHERE),
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

select reset_to_original() as result,
       (select demo_clock::text from editions where edition = '2026') as clock_2026,
       (select value::text from f_funnel(null, '2026') where metric = 'registrants') as registrants_2026;
