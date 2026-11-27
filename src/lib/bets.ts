// Scale / change / stop verdicts for the 5 bets, using the thresholds on Slide 3.
// Bets 2 and 3 read their KPI live from the data; bets 1, 4 and 5 use the latest KPI reading entered by the team
// (their KPIs, e.g. QR passes or RSVPs, are not in the 2025 dataset).
import type { Bet, ChannelKpi } from './types';

export type Verdict = 'scale' | 'change' | 'stop' | 'no data';
export interface BetEval { value: number | null; unit: string; source: 'data' | 'manual reading' | 'none'; verdict: Verdict; why: string }

export function evaluateBet(b: Bet, kpis: ChannelKpi[]): BetEval {
  const ch = (id: string) => kpis.find((k) => k.campaign_id === id);
  const manual = b.latest_kpi_value;
  switch (b.bet_id) {
    case 1: {
      if (manual === null) return none('Enter the QR-pass rate (passes ÷ confirmed, %) as a KPI reading.');
      return { value: manual, unit: '%', source: 'manual reading', ...band(manual, 85, 70, 'higher'), why: '≥ 85% scale · 70–85% change · < 70% stop' };
    }
    case 2: {
      const c = ch('C04'); const v = c?.cost_per_registrant ?? null;
      if (v === null) return none('No College Partnerships registrants yet.');
      return { value: v, unit: '₹ per registrant', source: 'data', ...band(v, 103, 138, 'lower'), why: '≤ ₹103 scale · ₹103–138 change · > ₹138 stop (College Partnerships)' };
    }
    case 3: {
      const c = ch('C02'); const v = c?.cost_per_registrant ?? null;
      if (v === null) return none('No Paid Social registrants yet.');
      return { value: v, unit: '₹ per registrant (Paid Social)', source: 'data', verdict: v > 137 ? 'stop' : 'scale', why: v > 137 ? 'Paid above ₹137 → cut paid to zero' : 'Paid at or below ₹137 → keep shifting budget to peer channels' };
    }
    case 4: {
      if (manual === null) return none('Enter referred ÷ contingent registrants as a KPI reading.');
      return { value: manual, unit: 'ratio', source: 'manual reading', ...band(manual, 0.25, 0.1, 'higher'), why: '≥ 0.25 scale · 0.10–0.25 change · < 0.10 stop' };
    }
    case 5: {
      if (manual === null) return none('Enter pro-night RSVPs as a KPI reading.');
      return { value: manual, unit: 'RSVPs', source: 'manual reading', ...band(manual, 300, 150, 'higher'), why: '≥ 300 scale · 150–300 change · < 150 or no sponsor by T-6w stop' };
    }
  }
  return none('Unknown bet');
}

function none(why: string): BetEval { return { value: null, unit: '', source: 'none', verdict: 'no data', why }; }
function band(v: number, good: number, bad: number, dir: 'higher' | 'lower'): { verdict: Verdict } {
  if (dir === 'higher') return { verdict: v >= good ? 'scale' : v >= bad ? 'change' : 'stop' };
  return { verdict: v <= good ? 'scale' : v <= bad ? 'change' : 'stop' };
}

export const verdictClass: Record<Verdict, string> = {
  scale: 'bg-emerald-100 text-emerald-800', change: 'bg-amber-100 text-amber-800', stop: 'bg-red-100 text-red-800', 'no data': 'bg-slate-100 text-slate-600',
};
