import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

export type TargetKey = '2025_goal' | '2026_base' | '2026_stretch';
export const TARGETS: { key: TargetKey; label: string }[] = [
  { key: '2025_goal', label: '2025 goal (2,200)' },
  { key: '2026_base', label: '2026 base (2,670)' },
  { key: '2026_stretch', label: '2026 stretch (3,205)' },
];

// Week-end checkpoints (Sundays 23:59:59) for replaying the 2025 campaign; null = all data.
export const AS_OF_STEPS: (string | null)[] = (() => {
  const out: (string | null)[] = [];
  const d = new Date(Date.UTC(2025, 0, 26));
  while (d <= new Date(Date.UTC(2025, 3, 13))) {
    out.push(d.toISOString().slice(0, 10) + ' 23:59:59');
    d.setUTCDate(d.getUTCDate() + 7);
  }
  out.push(null);
  return out;
})();

interface AppState {
  asOf: string | null; setAsOf: (v: string | null) => void;
  target: TargetKey; setTarget: (v: TargetKey) => void;
  version: number; refresh: () => void;
  copilotOpen: boolean; setCopilotOpen: (v: boolean) => void;
  askCopilot: (q: string) => void; pendingQuestion: string | null; clearPending: () => void;
}

const Ctx = createContext<AppState | null>(null);

function load<T>(k: string, d: T): T {
  try { const v = localStorage.getItem(k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; }
}
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

export function AppProvider({ children }: { children: ReactNode }) {
  const [asOf, setAsOfS] = useState<string | null>(() => load('rgc_asof', null));
  const [target, setTargetS] = useState<TargetKey>(() => load('rgc_target', '2026_base'));
  const [version, setVersion] = useState(0);
  const [copilotOpen, setCopilotOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1280 : false));
  const [pendingQuestion, setPending] = useState<string | null>(null);
  const setAsOf = (v: string | null) => { setAsOfS(v); save('rgc_asof', v); };
  const setTarget = (v: TargetKey) => { setTargetS(v); save('rgc_target', v); };
  const refresh = useCallback(() => setVersion((x) => x + 1), []);
  const askCopilot = (q: string) => { setCopilotOpen(true); setPending(q); };
  return (
    <Ctx.Provider value={{ asOf, setAsOf, target, setTarget, version, refresh, copilotOpen, setCopilotOpen, askCopilot, pendingQuestion, clearPending: () => setPending(null) }}>
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
  const { version } = useApp();
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
  }, [version, ...deps]);
  return { data, error, loading };
}
