import { useEffect, useRef, useState } from 'react';
import { useApp, useData } from '../lib/app';
import { db, rpc, audit } from '../lib/supabase';
import { n0, dateLabel } from '../lib/format';
import { GateToday } from '../lib/types';
import { Kpi, Section, Loading } from '../components/ui';

interface Result { ok: boolean; repeat?: boolean; name?: string; status?: string; reason?: string; admitted_at?: string; role?: string; sport?: string; college?: string }
interface RecentRow { occurred_at: string; person_name: string | null; result: string; source: string; registration_id: string | null }

// BarcodeDetector is not in TypeScript's DOM types yet
type Detector = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };
const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;

export default function Gate() {
  const { edition, ed, refresh, version, today } = useApp();
  const [tick, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick((x) => x + 1), 10000); return () => clearInterval(i); }, []);
  const { data, error } = useData(async () => {
    const [g, recent] = await Promise.all([
      rpc<GateToday[]>('f_gate_today', { p_edition: edition }).then((r) => r[0]),
      db.from('checkins').select('occurred_at,person_name,result,source,registration_id').gte('occurred_at', today.slice(0, 10)).lte('occurred_at', today.slice(0, 10) + ' 23:59:59')
        .order('row_id', { ascending: false }).limit(8).then((r) => (r.data ?? []) as RecentRow[]),
    ]);
    return { g, recent };
  }, [tick, today]);
  const [code, setCode] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState('');
  const [walk, setWalk] = useState({ name: '', college: '' });
  const [cam, setCam] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [version]);
  if (!data) return <Loading error={error} />;
  const g = data.g;

  async function scan(c: string, source: 'scanner' | 'manual') {
    if (!c.trim()) return;
    setErr(''); setRes(null);
    try { const r = await rpc<Result>('check_in', { p_code: c, p_source: source, p_edition: edition }); setRes(r); setCode(''); refresh(); }
    catch (e) { setErr((e as Error).message); }
    input.current?.focus();
  }
  async function walkIn() {
    setErr('');
    try { const r = await rpc<Result>('walk_in', { p_name: walk.name, p_college: walk.college || null, p_edition: edition }); setRes({ ...r, status: 'walk-in' }); setWalk({ name: '', college: '' }); refresh(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function moveClock(to: string, label: string) {
    setErr('');
    try {
      await rpc('set_demo_clock', { p_clock: to, p_edition: edition });
      await audit('editions', 'demo_clock', edition, { demo_clock: ed.demo_clock }, { demo_clock: to, label });
      refresh();
    } catch (e) { setErr((e as Error).message); }
  }
  const realInWindow = today !== ed.demo_clock.replace('T', ' ').slice(0, 19);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Gate: {ed.label}</h1>
        <p className="text-sm text-slate-500">Scan the QR pass (or type the pass code) to admit. Only confirmed passes open the gate; each person is counted once a day. Fest days: {dateLabel(ed.fest_day1)} and {dateLabel(ed.fest_day2)}.</p>
      </div>

      {!g.gate_open ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <b>The gate is closed.</b> Today in this fest year is {dateLabel(today)}.
          {!realInWindow && <> To rehearse fest day, move the demo clock (this changes "today" for the whole app; Reset data puts it back).
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-primary text-xs" onClick={() => moveClock(ed.fest_day1 + ' 10:00:00', 'fest day 1')}>Move to fest day 1, 10:00</button>
              <button className="btn-ghost border border-amber-300 text-xs" onClick={() => moveClock(ed.fest_day2 + ' 10:00:00', 'fest day 2')}>Fest day 2, 10:00</button>
            </div></>}
        </div>
      ) : !realInWindow && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span><b>Gate open</b> (demo clock: {new Date(today.replace(' ', 'T')).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}).</span>
          <span className="flex gap-2">
            <button className="btn-ghost text-xs" onClick={() => moveClock(today.slice(0, 10) + ' ' + String(Math.min(new Date(today.replace(' ', 'T')).getHours() + 2, 21)).padStart(2, '0') + ':00:00', '+2h')}>+2 hours</button>
            {today.slice(0, 10) === ed.fest_day1 && <button className="btn-ghost text-xs" onClick={() => moveClock(ed.fest_day2 + ' 10:00:00', 'fest day 2')}>Go to day 2</button>}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Admitted today" tag="D" value={n0(g.admitted_today)} sub={<>{n0(g.last_hour)} in the last hour</>} tone="good" />
        <Kpi label="Walk-ins today" tag="D" value={n0(g.walk_ins_today)} />
        <Kpi label="Refused today" tag="D" value={n0(g.denied_today)} sub="cancelled / waitlisted passes" tone={g.denied_today ? 'warn' : 'default'} />
        <Kpi label="Verified attendees" tag="D" value={n0(g.verified_total)} sub="both days, counted once" />
        <Kpi label="Confirmed passes" tag="D" value={n0(g.confirmed)} sub={g.confirmed ? `${n0(Math.round((100 * g.verified_total) / g.confirmed))}% of confirmed are in` : ''} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Scan a pass">
          <div className="flex gap-2">
            <input ref={input} className="input flex-1 font-mono text-lg uppercase" placeholder="Pass code, e.g. R26-1A2B3C4D" value={code} disabled={!g.gate_open}
              onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan(code, 'manual')} aria-label="Pass code" />
            <button className="btn-primary" disabled={!g.gate_open} onClick={() => scan(code, 'manual')}>Admit</button>
          </div>
          {BD ? <button className="btn-ghost mt-2 text-xs" disabled={!g.gate_open} onClick={() => setCam(!cam)}>{cam ? 'Stop camera' : 'Use camera'}</button>
            : <p className="mt-2 text-[11px] text-slate-400">Camera scanning needs a browser with barcode detection (Chrome on Android/desktop). A USB/Bluetooth scanner types into the box like a keyboard.</p>}
          {cam && BD && <Camera onCode={(c) => { setCam(false); scan(c, 'scanner'); }} />}
          {err && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{err}</p>}
          {res && (
            <div className={`mt-3 rounded-xl p-4 text-center ${res.ok ? (res.repeat ? 'bg-amber-100 text-amber-900' : 'bg-emerald-600 text-white') : 'bg-red-600 text-white'}`} role="status">
              <div className="text-2xl font-bold">{res.ok ? (res.repeat ? 'Already in' : 'Admit') : 'Do not admit'}</div>
              {res.name && <div className="text-lg">{res.name}</div>}
              <div className="text-sm opacity-90">{res.ok ? [res.status, res.role, res.sport, res.college].filter(Boolean).join(' · ') : res.reason}</div>
              {res.repeat && res.admitted_at && <div className="text-xs">first admitted {new Date(res.admitted_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>}
            </div>
          )}
        </Section>
        <Section title="Walk-in" sub="Visitor with no registration: record and admit">
          <div className="flex flex-wrap gap-2 text-sm">
            <input className="input flex-1" placeholder="Name" value={walk.name} maxLength={80} disabled={!g.gate_open} onChange={(e) => setWalk({ ...walk, name: e.target.value })} aria-label="Walk-in name" />
            <input className="input flex-1" placeholder="College (optional)" value={walk.college} disabled={!g.gate_open} onChange={(e) => setWalk({ ...walk, college: e.target.value })} aria-label="Walk-in college" />
            <button className="btn-primary" disabled={!g.gate_open} onClick={walkIn}>Admit walk-in</button>
          </div>
          <h3 className="mt-4 mb-1 text-xs font-semibold uppercase text-slate-500">Latest at the gate today</h3>
          {data.recent.length === 0 ? <p className="text-xs text-slate-400">No check-ins yet today.</p> : (
            <ul className="divide-y divide-slate-100 text-xs">
              {data.recent.map((r, i) => (
                <li key={i} className="flex justify-between py-1">
                  <span>{r.person_name ?? '–'} <span className="text-slate-400">{r.registration_id ?? 'walk-in'}</span></span>
                  <span className={r.result === 'admitted' ? 'text-emerald-700' : 'text-red-700'}>{r.result} · {new Date(r.occurred_at.replace(' ', 'T')).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Camera({ onCode }: { onCode: (c: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onCode); cb.current = onCode;
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null; let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return;
        video.current.srcObject = stream; await video.current.play();
        const det = new BD!({ formats: ['qr_code'] });
        while (!stop) {
          const found = await det.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) { cb.current(found[0].rawValue); break; }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (e) { setErr('Camera unavailable: ' + (e as Error).message); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return <div className="mt-2">{err ? <p className="text-xs text-red-700">{err}</p> : <video ref={video} className="w-full rounded-lg bg-black" muted playsInline />}</div>;
}
