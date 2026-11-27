-- Loads the raw 2025 data from the public GitHub repo (data/json/*.json) into public.* and original.*.
-- Uses the pgsql-http extension, so no 4 MB seed file has to be pasted into the SQL editor.
create extension if not exists http with schema extensions;

create or replace function load_from_github(p_base text default
  'https://raw.githubusercontent.com/Rakeshtella8/risa-growth-center/main/data/json/')
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  t text; cols text; j json; n int; msg text := '';
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '60');
  foreach t in array array['event','targets','campaigns','daily_marketing','people',
                           'interactions','registrations','registration_history','checkins'] loop
    select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and column_name <> 'row_id'
       and not (t = 'campaigns' and column_name in ('status','budget_2026_inr'));
    select content::json into j from extensions.http_get(p_base || t || '.json');
    execute format('truncate public.%I', t);
    execute format('insert into public.%I (%s) select %s from json_populate_recordset(null::public.%I, $1)',
                   t, cols, cols, t) using j;
    get diagnostics n = row_count;
    execute format('truncate original.%I', t);
    execute format('insert into original.%I select * from public.%I', t, t);
    msg := msg || t || '=' || n || ' ';
  end loop;
  return msg;
end $$;
