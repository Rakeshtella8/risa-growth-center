# Builds supabase/update_06.sql: speeds up f_forecast / f_channel_projection (was 5 s, over Supabase's time limit).
from pathlib import Path
root = Path(__file__).resolve().parent.parent / 'supabase'
part = lambda f: (root / 'sql' / f).read_text()
out = f"""-- Update 6: makes the Overview load again. The new seasonal forecast re-ran one sub-query per column and took
-- about 5 seconds, over Supabase's limit for the app. Same results, now about 0.1 s. Safe to run more than once.
begin;
{part('02_views.sql')}
{part('05_security.sql')}
commit;
analyze;

select '2026 projected registrants (expect 3049)' as check, (select projected_registrants::text from f_forecast(null, null, '2026')) as result
union all select '2026 pace vs plan (expect 97.8)', (select pace_pct::text from f_forecast(null, null, '2026'))
union all select 'contingent projected cost (expect 85.2)', (select projected_cost_per_registrant::text from f_channel_projection(null, '2026') where campaign_id = 'C04')
union all select 'app can read the forecast (expect true)', has_function_privilege('anon', 'f_forecast(timestamp,text,text)', 'execute')::text;
"""
(root / 'update_06.sql').write_text(out)
print(len(out.splitlines()), 'lines')
