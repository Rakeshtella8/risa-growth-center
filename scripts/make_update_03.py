# Builds supabase/update_03.sql (attendee management + editions) from the numbered SQL files.
from pathlib import Path
root = Path(__file__).resolve().parent.parent / 'supabase'
part = lambda f: (root / 'sql' / f).read_text()
out = f"""-- Update 3: fest years ("editions"), attendee management (register, statuses, waitlist release, QR passes,
-- gate check-in, walk-ins) and simulated first weeks of the 2026 campaign, flagged and removable.
-- Paste the whole file into the Supabase SQL editor and Run. Safe to run more than once.
begin;

-- ===== schema (idempotent) =====
{part('01_schema.sql')}

-- keep the edition settings for Reset data (once)
insert into original.editions select * from public.editions where not exists (select 1 from original.editions);

-- ===== metric layer =====
{part('02_views.sql')}

-- ===== attendee management =====
{part('06_attendees.sql')}

-- ===== access rules =====
{part('05_security.sql')}

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
analyze;

select '2025 verified visitors' as check, (select value::text from f_funnel(null, '2025') where metric = 'verified_visitors') as result
union all select '2026 registrants so far (simulated)', (select value::text from f_funnel(null, '2026') where metric = 'registrants')
union all select '2026 pace vs plan (%)', (select pace_pct::text from f_forecast(null, null, '2026'))
union all select 'same week last year', (select last_cumulative::text from f_pace_compare(null, '2026') where week_no = 7)
union all select 'anon can register people', has_function_privilege('anon', 'register_person(text,text,text,text,text,text)', 'execute')::text;
"""
(root / 'update_03.sql').write_text(out)
print(len(out.splitlines()), 'lines')
