# Builds supabase/update_05.sql: aligns the 2026 edition with the deck's base plan. Includes update_04's fixes.
from pathlib import Path
root = Path(__file__).resolve().parent.parent / 'supabase'
part = lambda f: (root / 'sql' / f).read_text()
_u4 = (root / 'update_04.sql').read_text()
TIDY = _u4[_u4.index('-- Tidy display text'):_u4.index('select reset_to_original();')]  # bet text, target sources, demo task dates
out = f"""-- Update 5: the 2026 edition now follows the deck's base plan (analysis/target_model.py):
--   * simulated 2026 weeks use the deck's channel budgets and planned registrants per channel [A]
--   * plan pace and projections follow last year's season curve weighted by the planned channel mix
--   * 2026 assumed show rate = 77.2% (the plan's channel mix, before the show-up programme) [A]
--   * bets 2 and 3 read projected end-of-campaign cost per registrant (f_channel_projection)
-- Also includes update_04 (Reset data fix, tidy bet text, demo task dates). You can skip update_04.
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

-- ===== 2026 show rate from the plan's channel mix [A] =====
update editions set assumed_show_rate_pct = 77.2 where edition = '2026';
update original.editions set assumed_show_rate_pct = 77.2 where edition = '2026';

{TIDY}
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
select reset_to_original();
analyze;

select '2025 verified visitors' as check, (select value::text from f_funnel(null, '2025') where metric = 'verified_visitors') as result
union all select '2026 registrants so far (simulated)', (select value::text from f_funnel(null, '2026') where metric = 'registrants')
union all select '2026 pace vs plan (%)', (select pace_pct::text from f_forecast(null, null, '2026'))
union all select '2026 projected registrants (plan 3,117)', (select projected_registrants::text from f_forecast(null, null, '2026'))
union all select 'contingent projected cost per registrant (plan 85.6)', (select projected_cost_per_registrant::text from f_channel_projection(null, '2026') where campaign_id = 'C04')
union all select 'reset works for the app', has_function_privilege('anon', 'reset_to_original()', 'execute')::text
union all select 'same week last year', (select last_cumulative::text from f_pace_compare(null, '2026') where week_no = 7)
union all select 'anon can register people', has_function_privilege('anon', 'register_person(text,text,text,text,text,text)', 'execute')::text;
"""
(root / 'update_05.sql').write_text(out)
print(len(out.splitlines()), 'lines')
