import { ReactNode } from 'react';
import { useApp } from '../lib/app';

export function Kpi({ label, value, sub, tone = 'default', tag }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn'; tag?: 'D' | 'A' }) {
  const toneCls = { default: 'text-slate-900', good: 'text-emerald-700', bad: 'text-red-700', warn: 'text-amber-700' }[tone];
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        <span>{label}</span>{tag && <Tag t={tag} />}
      </div>
      <div className={`mt-1 text-2xl font-bold ${toneCls}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Tag({ t }: { t: 'D' | 'A' }) {
  return <span title={t === 'D' ? 'From the data' : 'Assumption'} className={`tag ${t === 'D' ? 'bg-navy-50 text-navy-700' : 'bg-amber-50 text-amber-700'}`}>[{t}]</span>;
}

export function Section({ title, children, right, sub }: { title: string; children: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function AskButton({ q, label = 'Ask copilot' }: { q: string; label?: string }) {
  const { askCopilot } = useApp();
  return <button className="btn-ghost text-xs text-navy-700" onClick={() => askCopilot(q)} title={q}>
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mr-1 inline h-3.5 w-3.5 -translate-y-px fill-none stroke-current" strokeWidth="1.5"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" strokeLinejoin="round" /></svg>{label}</button>;
}

export function Loading({ error }: { error?: string | null }) {
  if (error) return <div className="card p-4 text-sm text-red-700">Could not load data: {error}</div>;
  return <div className="p-6 text-sm text-slate-500">Loading…</div>;
}
