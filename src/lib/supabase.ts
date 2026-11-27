import { createClient } from '@supabase/supabase-js';

// The publishable (anon) key is public by design: access is limited by grants and RLS in supabase/sql/05_security.sql.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://twpnytzfgaaztfxbujjl.supabase.co';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_iBzEMZ271LzREvfwfw9H8Q_MW4o78ur';

export const db = createClient(url, key, { auth: { persistSession: false } });

export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function audit(table_name: string, action: string, row_ref: string | null, old_value: unknown, new_value: unknown) {
  await db.from('audit_log').insert({ table_name, action, row_ref, old_value, new_value, session_id: sessionId() });
}

export function sessionId() {
  try {
    let s = localStorage.getItem('rgc_session');
    if (!s) { s = crypto.randomUUID(); localStorage.setItem('rgc_session', s); }
    return s;
  } catch { return 'anon'; }
}
