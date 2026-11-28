import { useState } from 'react';
import { useApp, useData } from '../lib/app';
import { db, rpc, audit } from '../lib/supabase';
import { n0, pct, dateLabel } from '../lib/format';
import { Attendee, FunnelRow, TimelineRow, metric } from '../lib/types';
import { Kpi, Section, AskButton, Loading } from '../components/ui';
import { RegisterForm, PassCard, passUrl, registerUrl } from './Public';

const PAGE = 50;
const STATUS_FILTERS: [string, string][] = [
  ['all', 'Everyone'], ['confirmed', 'Confirmed'], ['no_pass', 'Confirmed, no pass sent'], ['waitlisted', 'Waitlisted'],
  ['cancelled', 'Cancelled'], ['interested', 'Interested'], ['lead', 'Leads (not registered)'], ['attended', 'Attended'], ['walk-in', 'Walk-ins'],
];
export const statusCls: Record<string, string> = {
  confirmed: 'bg-emerald-100 text-emerald-800', waitlisted: 'bg-amber-100 text-amber-800', cancelled: 'bg-red-100 text-red-800',
  interested: 'bg-slate-100 text-slate-700', lead: 'bg-sky-50 text-sky-800', 'walk-in': 'bg-violet-100 text-violet-800',
};

export default function Attendees() {
  const { edition, ed, refresh, phase, today } = useApp();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Attendee | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, error } = useData(async () => {
    const [rows, funnel, campaigns] = await Promise.all([
      rpc<Attendee[]>('f_attendees', { p_edition: edition, p_q: applied || null, p_status: status, p_limit: PAGE, p_offset: page * PAGE }),
      rpc<FunnelRow[]>('f_funnel', { p_as_of: null, p_edition: edition }),
      db.from('campaigns').select('campaign_id,campaign_name').order('campaign_id').then((r) => (r.data ?? []) as { campaign_id: string; campaign_name: string }[]),
    ]);
    return { rows, funnel, campaigns };
  }, [applied, status, page]);
  if (!data) return <Loading error={error} />;
  const m = (k: string) => metric(data.funnel, k);
  const total = data.rows[0]?.total ?? 0;
  const free = Math.max(m('capacity') - m('confirmed'), 0);
  const noPass = Math.max(m('confirmed') - m('qr_passes_issued'), 0);
  const closed = phase === 'post';

  async function bulk(kind: 'release' | 'passes' | 'reminders') {
    const text = kind === 'release' ? `Confirm up to ${n0(Math.min(free, m('waitlisted')))} waitlisted people (oldest first)?`
      : kind === 'passes' ? `Send a QR entry pass to ${n0(noPass)} confirmed people who don't have one?`
      : `Log a reminder to all ${n0(m('confirmed'))} confirmed people?`;
    if (!window.confirm(text)) return;
    setBusy(true); setMsg('');
    try {
      if (kind === 'release') {
        const r = await rpc<{ released: number; free_places: number }>('release_waitlist', { p_edition: edition, p_max: null });
        setMsg(`Released ${n0(r.released)} from the waitlist. ${n0(r.free_places)} places still free.`);
        await audit('registration_history', 'release_waitlist', edition, null, r);
      } else {
        const r = await rpc<{ sent: number }>('bulk_touch', { p_event_type: kind === 'passes' ? 'qr_pass_issued' : 'reminder_sent', p_edition: edition });
        setMsg(`${kind === 'passes' ? 'Passes' : 'Reminders'} logged for ${n0(r.sent)} people. (Demo: nothing is actually sent; in production this hands off to WhatsApp/email.)`);
        await audit('interactions', kind, edition, null, r);
      }
      refresh();
    } catch (e) { setMsg('Error: ' + (e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Attendees</h1>
          <p className="text-sm text-slate-500">Everyone who registered, is on a lead list or came through the gate. Actions are stamped {dateLabel(today)} (today in this fest year) and update every number at once.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => { setShowForm(!showForm); setShowLinks(false); }} disabled={closed}>+ New registration</button>
          <button className="btn-ghost" onClick={() => { setShowLinks(!showLinks); setShowForm(false); }}>Registration links</button>
          <AskButton q="Who should we chase first this week: waitlist, confirmed without a pass, or unconverted leads? Give numbers and a plan." label="Who to chase?" />
        </div>
      </div>

      {showForm && (
        <Section title="New registration" sub="Same form students see at the public link. Goes to the waitlist automatically when the fest is full.">
          <div className="grid gap-4 md:grid-cols-2">
            <RegisterForm edition={edition} campaigns={data.campaigns} onDone={(r, n) => { setMsg(`Registered ${n}: ${r.status} (pass ${r.registration_id}).`); setShowForm(false); refresh(); }} />
            <p className="text-xs text-slate-500">Name and college only: this is a public demo, so no phone or email is stored. In production the form would collect a contact and send the pass by WhatsApp/email.</p>
          </div>
        </Section>
      )}
      {showLinks && (
        <Section title="Registration links" sub="Give each channel its own link so sign-ups are credited to it (attribution) [D]">
          <div className="space-y-1 text-xs">
            <LinkRow label="General (no campaign)" url={registerUrl()} />
            {data.campaigns.map((c) => <LinkRow key={c.campaign_id} label={`${c.campaign_name} (${c.campaign_id})`} url={registerUrl(c.campaign_id)} />)}
          </div>
        </Section>
      )}
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.startsWith('Error') ? 'bg-red-50 text-red-800' : 'bg-navy-50 text-navy-900'}`} role="status">{msg}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Registrants" tag="D" value={n0(m('registrants'))} sub={m('participants') + m('spectators') > 0 ? <>playing {n0(m('participants'))} · watching {n0(m('spectators'))}</> : <>playing / watching not recorded{edition === '2025' ? ' in the 2025 data' : ''}</>} />
        <Kpi label="Confirmed places" tag="D" value={n0(m('confirmed'))} sub={<CapacityEditor capacity={m('capacity')} edition={edition} onSaved={refresh} />}
          tone={free === 0 ? 'warn' : 'default'} />
        <Kpi label="Waitlisted" tag="D" value={n0(m('waitlisted'))} tone={m('waitlisted') && free ? 'bad' : 'default'}
          sub={<><span>{n0(free)} places free</span>{m('waitlisted') > 0 && free > 0 && !closed && <button className="ml-2 text-navy-700 underline" disabled={busy} onClick={() => bulk('release')}>release now</button>}</>} />
        <Kpi label="QR passes opened" tag="D" value={m('confirmed') && m('qr_passes_issued') ? pct((100 * m('qr_passes_downloaded')) / m('confirmed')) : '–'}
          tone={!m('qr_passes_issued') ? 'default' : (100 * m('qr_passes_downloaded')) / m('confirmed') >= 85 ? 'good' : 'bad'}
          sub={edition === '2025' && !m('qr_passes_issued') ? <>QR passes are new in 2026; the 2025 data has none</> : <>{n0(m('qr_passes_issued'))} sent · {n0(noPass)} confirmed without one{noPass > 0 && !closed && <button className="ml-2 text-navy-700 underline" disabled={busy} onClick={() => bulk('passes')}>send</button>}</>} />
        <Kpi label="Reminders logged" tag="D" value={n0(m('reminders_sent'))}
          sub={!closed ? <button className="text-navy-700 underline" disabled={busy} onClick={() => bulk('reminders')}>remind all confirmed</button> : 'fest is over'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className={open ? 'xl:col-span-3' : 'xl:col-span-5'}>
          <Section title={`People (${n0(total)})`} sub="Newest registrations first. Click a person for their history and actions."
            right={<div className="flex flex-wrap gap-2 text-sm">
              <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} aria-label="Status filter">
                {STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input className="input w-48" placeholder="Name, college or pass…" value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { setApplied(q.trim()); setPage(0); } }} aria-label="Search people" />
              <button className="btn-ghost" onClick={() => { setApplied(q.trim()); setPage(0); }}>Search</button>
            </div>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200"><tr>
                  <th className="th">Name</th><th className="th">Status</th><th className="th">Playing / watching</th><th className="th">Source</th>
                  <th className="th">Registered</th><th className="th">Pass</th><th className="th">Gate</th>
                </tr></thead>
                <tbody>
                  {data.rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-400">Nobody matches.</td></tr>}
                  {data.rows.map((a) => (
                    <tr key={a.person_id} onClick={() => setOpen(a)} className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${open?.person_id === a.person_id ? 'bg-navy-50' : ''}`}>
                      <td className="td"><div className="font-medium">{a.person_name}{a.is_simulated && <span className="tag ml-1 bg-slate-100 text-slate-500" title="Simulated 2026 row [A]">sim</span>}</div>
                        <div className="text-[11px] text-slate-400">{a.college ?? a.person_id}</div></td>
                      <td className="td"><span className={`tag ${statusCls[a.status] ?? 'bg-slate-100'}`}>{a.status}</span></td>
                      <td className="td text-xs">{a.role ? `${a.role}${a.sport ? ' · ' + a.sport : ''}` : '–'}</td>
                      <td className="td text-xs">{a.campaign_id ?? 'direct'}</td>
                      <td className="td text-xs">{a.registered_at ? dateLabel(a.registered_at) : '–'}</td>
                      <td className="td text-xs">{a.pass_opened ? 'opened' : a.pass_issued ? 'sent' : '–'}</td>
                      <td className="td text-xs">{a.attended ? <span className="font-semibold text-emerald-700">in</span> : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <button className="btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
              <span>Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE))}</span>
              <button className="btn-ghost" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next ›</button>
            </div>
          </Section>
        </div>
        {open && <div className="xl:col-span-2"><PersonPanel a={open} closed={closed} onClose={() => setOpen(null)} onChanged={(text) => { setMsg(text); refresh(); setOpen(null); }} /></div>}
      </div>
    </div>
  );
}

function LinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 px-2 py-1">
      <span className="w-56 font-medium">{label}</span>
      <a className="flex-1 truncate font-mono text-navy-700 underline" href={url} target="_blank" rel="noreferrer">{url}</a>
      <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => { navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

function CapacityEditor({ capacity, edition, onSaved }: { capacity: number; edition: string; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(String(capacity));
  const [err, setErr] = useState('');
  async function save() {
    const n = Number(v.replace(/[,\s]/g, ''));
    if (!Number.isInteger(n) || n < 0 || n > 100000) { setErr('whole number'); return; }
    const r = await db.from('editions').update({ capacity: n }).eq('edition', edition);
    if (r.error) { setErr(r.error.message); return; }
    await audit('editions', 'capacity', edition, { capacity }, { capacity: n });
    setEdit(false); setErr(''); onSaved();
  }
  if (!edit) return <>of {n0(capacity)} capacity <button className="text-navy-700 underline" onClick={() => setEdit(true)}>edit</button></>;
  return (
    <span className="inline-flex items-center gap-1">
      <input className="input w-20 py-0 text-xs" value={v} onChange={(e) => setV(e.target.value)} aria-label="Capacity" onKeyDown={(e) => e.key === 'Enter' && save()} />
      <button className="text-navy-700 underline" onClick={save}>save</button>{err && <span className="text-red-700">{err}</span>}
    </span>
  );
}

function PersonPanel({ a, closed, onClose, onChanged }: { a: Attendee; closed: boolean; onClose: () => void; onChanged: (msg: string) => void }) {
  const { edition, ed } = useApp();
  const [err, setErr] = useState('');
  const [showPass, setShowPass] = useState(false);
  const { data } = useData(() => rpc<TimelineRow[]>('f_person_timeline', { p_person_id: a.person_id }), [a.person_id]);
  async function act(fn: string, args: Record<string, unknown>, done: string) {
    setErr('');
    try { await rpc(fn, { ...args, p_edition: edition }); await audit('attendees', fn, a.registration_id ?? a.person_id, { status: a.status }, args); onChanged(done); }
    catch (e) { setErr((e as Error).message); }
  }
  const rid = a.registration_id;
  return (
    <Section title={a.person_name} sub={<>{[a.college, a.role, a.sport].filter(Boolean).join(' · ') || a.person_id}{a.is_simulated && ' · simulated row [A]'}</>}
      right={<button className="btn-ghost text-xs" onClick={onClose} aria-label="Close person">✕</button>}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`tag text-sm ${statusCls[a.status] ?? 'bg-slate-100'}`}>{a.status}</span>
        {rid && <span className="font-mono text-xs text-slate-500">{rid}</span>}
        {a.attended && <span className="tag bg-emerald-600 text-white">checked in</span>}
      </div>
      {rid && !closed && (
        <div className="mt-3 flex flex-wrap gap-2">
          {a.status !== 'confirmed' && <button className="btn-primary text-xs" onClick={() => act('set_registration_status', { p_registration_id: rid, p_status: 'confirmed' }, `${a.person_name} confirmed.`)}>Confirm</button>}
          {a.status !== 'waitlisted' && <button className="btn-ghost border border-slate-300 text-xs" onClick={() => act('set_registration_status', { p_registration_id: rid, p_status: 'waitlisted' }, `${a.person_name} moved to the waitlist.`)}>Waitlist</button>}
          {a.status !== 'cancelled' && <button className="btn-danger border border-red-200 text-xs" onClick={() => window.confirm(`Cancel ${a.person_name}'s registration?`) && act('set_registration_status', { p_registration_id: rid, p_status: 'cancelled' }, `${a.person_name} cancelled.`)}>Cancel</button>}
          <button className="btn-ghost border border-slate-300 text-xs" onClick={() => act('log_touch', { p_registration_id: rid, p_event_type: 'reminder_sent', p_detail: 'manual' }, `Reminder logged for ${a.person_name}.`)}>Log reminder</button>
          {!a.pass_issued && a.status === 'confirmed' && <button className="btn-ghost border border-slate-300 text-xs" onClick={() => act('log_touch', { p_registration_id: rid, p_event_type: 'qr_pass_issued', p_detail: 'manual' }, `Pass sent to ${a.person_name}.`)}>Send pass</button>}
          <button className="btn-ghost text-xs" onClick={() => setShowPass(!showPass)}>{showPass ? 'Hide pass' : 'Show pass'}</button>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-red-700" role="alert">{err}</p>}
      {showPass && rid && (
        <div className="mt-3 space-y-1 text-center">
          <PassCard id={rid} name={a.person_name} status={a.status} ed={ed} />
          <a className="text-xs text-navy-700 underline" href={passUrl(rid)} target="_blank" rel="noreferrer">Open the student's pass page</a>
        </div>
      )}
      <h3 className="mt-4 mb-1 text-xs font-semibold uppercase text-slate-500">History (all years)</h3>
      {!data ? <p className="text-xs text-slate-400">Loading…</p> : (
        <ol className="max-h-80 space-y-1 overflow-y-auto text-xs">
          {data.map((t, i) => (
            <li key={i} className="flex gap-2"><span className="w-28 shrink-0 text-slate-400">{t.at ? new Date(t.at.replace(' ', 'T')).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
              <span className="font-medium">{t.kind}</span><span className="text-slate-500">{t.detail}{t.campaign_id ? ` · ${t.campaign_id}` : ''}</span></li>
          ))}
        </ol>
      )}
    </Section>
  );
}
