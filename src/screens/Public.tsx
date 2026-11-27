// Public pages a student sees: the registration form (#register?c=C04) and their QR entry pass (#pass/<id>).
// They use the same database functions as the dashboard, so every sign-up counts at once.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { db, rpc } from '../lib/supabase';
import { dateLabel } from '../lib/format';
import type { Edition, Attendee } from '../lib/types';
import { DEFAULT_EDITIONS } from '../lib/app';

export const SPORTS = ['Athletics', 'Badminton', 'Basketball', 'Chess', 'Cricket', 'Football', 'Hockey', 'Squash', 'Table tennis', 'Tennis', 'Volleyball'];
const statusCls: Record<string, string> = {
  confirmed: 'bg-emerald-100 text-emerald-800', waitlisted: 'bg-amber-100 text-amber-800', cancelled: 'bg-red-100 text-red-800',
  interested: 'bg-slate-100 text-slate-700',
};

export function passUrl(id: string) { return `${location.origin}${location.pathname}#pass/${encodeURIComponent(id)}`; }
export function registerUrl(campaignId?: string) { return `${location.origin}${location.pathname}#register${campaignId ? '?c=' + encodeURIComponent(campaignId) : ''}`; }

interface Reg { registration_id: string; person_id: string; status: string }

export function RegisterForm({ edition, campaigns, fixedCampaign, onDone }: {
  edition: string; campaigns: { campaign_id: string; campaign_name: string }[]; fixedCampaign?: string | null; onDone: (r: Reg, name: string) => void;
}) {
  const [f, setF] = useState({ name: '', college: '', role: 'participant', sport: '', campaign: fixedCampaign ?? '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setErr('');
    if (!f.name.trim()) { setErr('Please enter your name.'); return; }
    if (f.role === 'participant' && !f.sport) { setErr('Pick the sport you will play.'); return; }
    setBusy(true);
    try {
      const r = await rpc<Reg>('register_person', { p_name: f.name, p_college: f.college || null, p_role: f.role,
        p_sport: f.role === 'participant' ? f.sport : null, p_campaign_id: f.campaign || null, p_edition: edition });
      onDone(r, f.name.trim());
      setF({ name: '', college: '', role: 'participant', sport: '', campaign: fixedCampaign ?? '' });
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid gap-3 text-sm">
      <label className="grid gap-1"><span className="font-medium">Full name</span>
        <input className="input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Full name" /></label>
      <label className="grid gap-1"><span className="font-medium">College</span>
        <input className="input" value={f.college} maxLength={120} placeholder="e.g. Hansraj College" onChange={(e) => setF({ ...f, college: e.target.value })} aria-label="College" /></label>
      <div className="grid gap-1"><span className="font-medium">Coming to</span>
        <div className="flex gap-2">
          {[['participant', 'Play'], ['spectator', 'Watch']].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setF({ ...f, role: v })} aria-pressed={f.role === v}
              className={`btn flex-1 justify-center border ${f.role === v ? 'border-navy-700 bg-navy-50 text-navy-900' : 'border-slate-300'}`}>{l}</button>
          ))}
        </div>
      </div>
      {f.role === 'participant' && (
        <label className="grid gap-1"><span className="font-medium">Sport</span>
          <select className="input" value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })} aria-label="Sport">
            <option value="">Choose…</option>{SPORTS.map((s) => <option key={s}>{s}</option>)}
          </select></label>
      )}
      {!fixedCampaign && (
        <label className="grid gap-1"><span className="font-medium">How did you hear about us?</span>
          <select className="input" value={f.campaign} onChange={(e) => setF({ ...f, campaign: e.target.value })} aria-label="Source campaign">
            <option value="">Not sure / other</option>{campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
          </select></label>
      )}
      {err && <p className="text-xs text-red-700" role="alert">{err}</p>}
      <button className="btn-primary justify-center" onClick={submit} disabled={busy}>{busy ? 'Registering…' : 'Register'}</button>
      <p className="text-[11px] text-slate-400">Demo: please don't enter real personal details. Name and college only; no phone or email is collected.</p>
    </div>
  );
}

export function PassCard({ id, name, status, ed }: { id: string; name?: string; status?: string; ed?: Edition }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(id, { margin: 1, width: 220 }).then(setSrc).catch(() => setSrc('')); }, [id]);
  return (
    <div className="mx-auto w-full max-w-xs rounded-2xl border-2 border-navy-800 bg-white p-4 text-center">
      <div className="text-xs font-semibold uppercase tracking-wider text-navy-800">{ed?.label.replace(/ \(.*\)/, '') ?? 'CampusFest'} · entry pass</div>
      {name && <div className="mt-1 text-lg font-bold">{name}</div>}
      {src ? <img src={src} alt={`QR code for pass ${id}`} className="mx-auto my-2 h-52 w-52" /> : <div className="my-2 h-52" />}
      <div className="font-mono text-sm tracking-wider">{id}</div>
      {status && <span className={`tag mt-2 ${statusCls[status] ?? 'bg-slate-100'}`}>{status}</span>}
      {ed && <div className="mt-2 text-xs text-slate-500">{dateLabel(ed.fest_day1)} – {dateLabel(ed.fest_day2)} · IIT Delhi · gates 10:00</div>}
      {status === 'waitlisted' && <p className="mt-2 text-xs text-amber-800">You're on the waitlist. We'll confirm you as soon as a place frees up.</p>}
      {status === 'cancelled' && <p className="mt-2 text-xs text-red-700">This registration is cancelled and won't open the gate.</p>}
    </div>
  );
}

function useLiveEdition() {
  const [eds, setEds] = useState<Edition[]>(DEFAULT_EDITIONS);
  const [campaigns, setCampaigns] = useState<{ campaign_id: string; campaign_name: string }[]>([]);
  useEffect(() => {
    db.from('editions').select('*').then((r) => { if (!r.error && r.data?.length) setEds(r.data as Edition[]); });
    db.from('campaigns').select('campaign_id,campaign_name').order('campaign_id').then((r) => setCampaigns((r.data ?? []) as typeof campaigns));
  }, []);
  return { ed: eds.find((e) => e.edition === '2026') ?? eds[0], eds, campaigns };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-navy-900 px-4 py-3 text-white"><div className="mx-auto max-w-md font-bold">CampusFest · IIT Delhi</div></header>
      <main className="mx-auto max-w-md p-4">{children}</main>
    </div>
  );
}

export function RegisterPage() {
  const { ed, campaigns } = useLiveEdition();
  const c = new URLSearchParams(location.hash.split('?')[1] ?? '').get('c');
  const [done, setDone] = useState<Reg | null>(null);
  const [name, setName] = useState('');
  return (
    <Shell>
      {!done ? (
        <div className="card p-4">
          <h1 className="text-lg font-bold">Register for {ed.label.replace(/ \(.*\)/, '')}</h1>
          <p className="mb-3 text-sm text-slate-500">{dateLabel(ed.fest_day1)} – {dateLabel(ed.fest_day2)} at IIT Delhi. Inter-college sport, evening pro-nights.</p>
          <RegisterForm edition={ed.edition} campaigns={campaigns} fixedCampaign={c} onDone={(r, n) => { setDone(r); setName(n); }} />
        </div>
      ) : (
        <div className="space-y-3 text-center">
          <h1 className="text-lg font-bold">{done.status === 'confirmed' ? "You're in!" : "You're on the waitlist"}</h1>
          <PassCard id={done.registration_id} name={name || undefined} status={done.status} ed={ed} />
          <p className="text-sm text-slate-600">Show this QR code at the gate. Save the link: <a className="text-navy-700 underline" href={passUrl(done.registration_id)}>your pass</a></p>
          <button className="btn-ghost" onClick={() => setDone(null)}>Register someone else</button>
        </div>
      )}
    </Shell>
  );
}

export function PassPage({ id }: { id: string }) {
  const { eds } = useLiveEdition();
  const [a, setA] = useState<Attendee | null | undefined>(undefined);
  const [edition, setEdition] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const r = await db.from('registrations').select('registered_at').eq('registration_id', id).limit(1);
      const year = (r.data?.[0]?.registered_at as string | undefined)?.slice(0, 4);
      if (!year) { setA(null); return; }
      setEdition(year);
      const rows = await rpc<Attendee[]>('f_attendees', { p_edition: year, p_q: id, p_status: null, p_limit: 5 }).catch(() => []);
      const me = rows.find((x) => x.registration_id === id) ?? null;
      setA(me);
      // count the first opening of a pass in this browser as "downloaded" (Bet 1 KPI)
      try {
        const k = 'rgc_pass_opened_' + id;
        if (me && !sessionStorage.getItem(k) && !me.pass_opened) {
          sessionStorage.setItem(k, '1');
          await rpc('log_touch', { p_registration_id: id, p_event_type: 'qr_pass_downloaded', p_detail: 'pass page', p_edition: year });
        }
      } catch { /* storage blocked: skip */ }
    })();
  }, [id]);
  const ed = eds.find((e) => e.edition === edition);
  return (
    <Shell>
      {a === undefined ? <p className="text-center text-sm text-slate-500">Loading pass…</p>
        : a === null ? <p className="card p-4 text-center text-sm">No pass found for <span className="font-mono">{id}</span>.</p>
        : <div className="space-y-3 text-center">
            <PassCard id={id} name={a.person_name} status={a.status} ed={ed} />
            <p className="text-xs text-slate-500">{[a.role, a.sport, a.college].filter(Boolean).join(' · ')}</p>
          </div>}
    </Shell>
  );
}
