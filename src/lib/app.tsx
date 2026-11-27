import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';

import { db } from './supabase';
import type { Edition, PlanTarget } from './types';

export type TargetKey = '2025_goal' | '2026_base' | '2026_stretch';
// Default labels; the live ones come from plan_targets (editable on the Data screen).
export const TARGETS: { key: TargetKey; label: string }[] = [
  { key: '2025_goal', label: '2025 goal (2,200)' },
  { key: '2026_base', label: '2026 base (2,670)' },
  { key: '2026_stretch', label: '2026 stretch (3,205)' },
];
const SHORT: Record<string, string> = { '2025_goal': '2025 goal', '2026_base': '2026 base', '2026_stretch': '2026 stretch' };
export function targetLabels(rows: PlanTarget[] | null) {
  if (!rows?.length) return TARGETS;
  return TARGETS.map((t) => { const r = rows.find((x) => x.target_key === t.key);
    return r ? { key: t.key, label: `${SHORT[t.key]} (${new Intl.NumberFormat('en-IN').format(r.verified_attendees)})` } : t; });
}

// Fallback edition settings (the live ones come from table editions, editable on the Data screen).
export const DEFAULT_EDITIONS: Edition[] = [
  { edition: '2026', label: 'CampusFest 2026 (live)', window_start: '2026-01-01 00:00:00', window_end: '2026-05-31 23:59:59', campaign_start: '2026-01-19',
    fest_day1: '2026-04-11', fest_day2: '2026-04-12', capacity: 3000, assumed_show_rate_pct: 68.8, assumed_walk_ins: 125, default_target: '2026_base',
    baseline_edition: '2025', demo_clock: '2026-03-08 23:59:59' },
  { edition: '2025', label: 'CampusFest 2025 (replay)', window_start: '2025-01-01 00:00:00', window_end: '2025-05-31 23:59:59', campaign_start: '2025-01-20',
    fest_day1: '2025-04-12', fest_day2: '2025-04-13', capacity: 2500, assumed_show_rate_pct: 68.8, assumed_walk_ins: 125, default_target: '2025_goal',
    baseline_edition: null, demo_clock: '2025-04-20 23:59:59' },
];

const ts = (s: string) => s.replace(' ', 'T').slice(0, 19);
// "Today" inside an edition: the real date in India if it falls in the window, else the demo clock (same rule as SQL ed_clock)
export function editionToday(e: Edition): string {
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const n = (x: string) => x.replace('T', ' ').slice(0, 19);
  return ist >= n(e.window_start) && ist <= n(e.window_end) ? ist : e.demo_clock.replace('T', ' ').slice(0, 19);
}
export type Phase = 'pre' | 'live' | 'post';
export function phaseOf(e: Edition, at: string): Phase {
  const d = at.slice(0, 10);
  return d < e.fest_day1 ? 'pre' : d <= e.fest_day2 ? 'live' : 'post';
}
// Week-end checkpoints (Sundays 23:59:59) from the first campaign week up to "today"; null = today.
export function asOfSteps(e: Edition, today: string): (string | null)[] {
  const out: (string | null)[] = [];
  const d = new Date(e.campaign_start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6);
  const end = ts(today);
  while (d.toISOString().slice(0, 19) < end && d.toISOString().slice(0, 10) <= e.fest_day2) {
    out.push(d.toISOString().slice(0, 10) + ' 23:59:59');
    d.setUTCDate(d.getUTCDate() + 7);
  }
  out.push(null);
  return out;
}

interface AppState {
  asOf: string | null; setAsOf: (v: string | null) => void;
  target: TargetKey; setTarget: (v: TargetKey) => void;
  edition: string; setEdition: (v: string) => void; ed: Edition; editions: Edition[]; today: string; phase: Phase;
  version: number; refresh: () => void;
  copilotOpen: boolean; setCopilotOpen: (v: boolean) => void;
  askCopilot: (q: string) => void; pendingQuestion: string | null; clearPending: () => void;
  targets: { key: TargetKey; label: string }[];
}

const Ctx = createContext<AppState | null>(null);

function load<T>(k: string, d: T): T {
  try { const v = localStorage.getItem(k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; }
}
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

export function AppProvider({ children }: { children: ReactNode }) {
  const [edition, setEditionS] = useState<string>(() => load('rgc_edition', '2026'));
  const [asOf, setAsOfS] = useState<string | null>(() => load('rgc_asof_' + load('rgc_edition', '2026'), null));
  const [target, setTargetS] = useState<TargetKey>(() => load('rgc_target', '2026_base'));
  const [version, setVersion] = useState(0);
  const [copilotOpen, setCopilotOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1280 : false));
  const [pendingQuestion, setPending] = useState<string | null>(null);
  const [editions, setEditions] = useState<Edition[]>(DEFAULT_EDITIONS);
  const setAsOf = (v: string | null) => { setAsOfS(v); save('rgc_asof_' + edition, v); };
  const setTarget = (v: TargetKey) => { setTargetS(v); save('rgc_target', v); };
  const refresh = useCallback(() => setVersion((x) => x + 1), []);
  const askCopilot = (q: string) => { setCopilotOpen(true); setPending(q); };
  const [targets, setTargets] = useState(TARGETS);
  useEffect(() => { db.from('plan_targets').select('*').then((r) => { if (!r.error) setTargets(targetLabels(r.data as PlanTarget[])); }); }, [version]);
  useEffect(() => { db.from('editions').select('*').order('edition', { ascending: false }).then((r) => { if (!r.error && r.data?.length) setEditions(r.data as Edition[]); }); }, [version]);
  const ed = editions.find((e) => e.edition === edition) ?? editions[0];
  const today = useMemo(() => editionToday(ed), [ed]);
  const phase = phaseOf(ed, asOf ?? today);
  const setEdition = (v: string) => {
    const next = editions.find((e) => e.edition === v); if (!next) return;
    setEditionS(v); save('rgc_edition', v);
    setAsOfS(null); save('rgc_asof_' + v, null);
    setTarget(next.default_target as TargetKey);
  };
  return (
    <Ctx.Provider value={{ asOf, setAsOf, target, setTarget, edition: ed.edition, setEdition, ed, editions, today, phase, version, refresh,
      copilotOpen, setCopilotOpen, askCopilot, pendingQuestion, clearPending: () => setPending(null), targets }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

// Fetch helper that re-runs when as-of, target or data version change.
export function useData<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const { version, edition } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fetcher().then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e) => { if (live) setError(String(e.message ?? e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, edition, ...deps]);
  return { data, error, loading };
}
