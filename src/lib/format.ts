const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

export const n0 = (v: unknown) => (v === null || v === undefined || v === '' ? '–' : inr.format(Number(v)));
export const n1 = (v: unknown) => (v === null || v === undefined || v === '' ? '–' : inr1.format(Number(v)));
export const rs = (v: unknown) => (v === null || v === undefined ? '–' : '₹' + inr.format(Number(v)));
export const rs1 = (v: unknown) => (v === null || v === undefined ? '–' : '₹' + inr1.format(Number(v)));
export const pct = (v: unknown) => (v === null || v === undefined ? '–' : inr1.format(Number(v)) + '%');

export const flagClass: Record<string, string> = {
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  green: 'bg-emerald-100 text-emerald-800',
  grey: 'bg-slate-100 text-slate-600',
};

export function dateLabel(s: string | null | undefined) {
  if (!s) return '–';
  return new Date(s.replace(' ', 'T').slice(0, 19)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
// null as-of = the edition's "today"
// "11–12 Apr 2026" (or the full form when months differ)
export function dateRange(a: string, b: string) {
  const [x, y] = [a, b].map((s) => new Date(s.replace(' ', 'T').slice(0, 19)));
  if (x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear()) return `${x.getDate()}–${dateLabel(b)}`;
  return `${dateLabel(a)} – ${dateLabel(b)}`;
}
export function asOfLabel(asOf: string | null, today?: string) {
  if (!asOf) return today ? `Today, ${dateLabel(today)}` : 'Today';
  return dateLabel(asOf);
}
