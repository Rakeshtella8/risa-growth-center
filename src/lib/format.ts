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

export function asOfLabel(asOf: string | null) {
  if (!asOf) return 'All data';
  const d = new Date(asOf.replace(' ', 'T'));
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
