import { useEffect, useState } from 'react';
import { useApp, asOfSteps, TargetKey } from './lib/app';
import { asOfLabel } from './lib/format';
import { rpc, audit } from './lib/supabase';
import Overview from './screens/Overview';
import Channels from './screens/Channels';
import Bets from './screens/Bets';
import Execution from './screens/Execution';
import DataScreen from './screens/DataScreen';
import Attendees from './screens/Attendees';
import Gate from './screens/Gate';
import { RegisterPage, PassPage } from './screens/Public';
import Copilot from './components/Copilot';

const TABS = [
  { id: 'overview', label: 'Overview', hint: 'Measure' },
  { id: 'channels', label: 'Channels', hint: 'Diagnose' },
  { id: 'attendees', label: 'Attendees', hint: 'Manage people' },
  { id: 'gate', label: 'Gate', hint: 'Fest-day check-in' },
  { id: 'bets', label: 'Bets', hint: 'Decide' },
  { id: 'execution', label: 'Campaigns & tasks', hint: 'Execute' },
  { id: 'data', label: 'Data', hint: 'Edit / reset' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// Public pages (no dashboard chrome): #register?c=C04 and #pass/<registration id>
export default function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const on = () => setHash(location.hash); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  if (hash.startsWith('#register')) return <RegisterPage />;
  if (hash.startsWith('#pass/')) return <PassPage id={decodeURIComponent(hash.slice(6))} />;
  return <Dashboard />;
}

function Dashboard() {
  const { asOf, setAsOf, target, setTarget, copilotOpen, setCopilotOpen, refresh, targets, edition, setEdition, editions, ed, today } = useApp();
  const [tab, setTab] = useState<TabId>(() => (TABS.find((t) => '#' + t.id === location.hash)?.id ?? 'overview'));
  const [resetting, setResetting] = useState(false);
  useEffect(() => { history.replaceState(null, '', '#' + tab); }, [tab]);
  useEffect(() => {
    const on = () => { const t = TABS.find((x) => '#' + x.id === location.hash); if (t) setTab(t.id); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const steps = asOfSteps(ed, today);
  const idx = steps.indexOf(asOf);

  async function reset() {
    if (!window.confirm('Restore the original data (2025 dataset + simulated 2026 weeks), targets and fest settings? Your data edits, registrations and check-ins will be undone (tasks and KPI readings are kept).')) return;
    setResetting(true);
    try { await rpc('reset_to_original'); await audit('*', 'reset_to_original', null, null, null); refresh(); }
    catch (e) { alert('Reset failed: ' + (e as Error).message); }
    finally { setResetting(false); }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="z-30 shrink-0 bg-navy-900 text-white shadow">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight">RISA Growth Center</span>
            <span className="hidden text-xs text-white/60 sm:inline">Sports fest · Delhi NCR · Attendee growth</span>
          </div>
          <nav className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} title={t.hint} aria-label={t.label} aria-current={tab === t.id ? 'page' : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.id ? 'bg-white text-navy-900' : 'text-white/80 hover:bg-white/10'}`}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2" title="Which fest year you are working on">
              <select value={edition} onChange={(e) => setEdition(e.target.value)} className="rounded-md bg-white/10 px-2 py-1 font-semibold text-white" aria-label="Fest year">
                {editions.map((e) => <option key={e.edition} value={e.edition} className="text-slate-800">{e.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2" title="Look back: every number and the copilot use data up to this date. Right end = today.">
              <span className="text-white/70">As of</span>
              <input type="range" min={0} max={steps.length - 1} value={idx < 0 ? steps.length - 1 : idx}
                onChange={(e) => setAsOf(steps[Number(e.target.value)])} className="w-28 accent-white" aria-label="As-of date" />
              <span className="w-36 font-semibold">{asOfLabel(asOf, today)}</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-white/70">Compare to</span>
              <select value={target} onChange={(e) => setTarget(e.target.value as TargetKey)} className="rounded-md bg-white/10 px-2 py-1 text-white">
                {targets.map((t) => <option key={t.key} value={t.key} className="text-slate-800">{t.label}</option>)}
              </select>
            </label>
            <button onClick={reset} disabled={resetting} className="rounded-md border border-white/30 px-2.5 py-1 text-white/90 hover:bg-white/10">
              {resetting ? 'Resetting…' : 'Reset data'}
            </button>
            <button onClick={() => setCopilotOpen(!copilotOpen)} className="rounded-md bg-amber-400 px-3 py-1 font-semibold text-navy-900 hover:bg-amber-300">
              {copilotOpen ? 'Hide copilot' : 'Ask copilot'}
            </button>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {tab === 'overview' && <Overview />}
          {tab === 'channels' && <Channels />}
          {tab === 'attendees' && <Attendees />}
          {tab === 'gate' && <Gate />}
          {tab === 'bets' && <Bets />}
          {tab === 'execution' && <Execution />}
          {tab === 'data' && <DataScreen />}
          <footer className="mt-8 pb-4 text-xs text-slate-400">
            Data: CampusFest 2025 (fictional dataset supplied by RISA); 2026 weeks to 8 Mar are simulated from it [A] until real 2026 data arrives · [D] data · [A] assumption · 2026 targets from the strategy model · Built by Rakesh Tella
          </footer>
        </main>
        {copilotOpen && <Copilot onClose={() => setCopilotOpen(false)} />}
      </div>
    </div>
  );
}
