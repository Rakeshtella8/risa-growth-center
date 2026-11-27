// Scale / change / stop verdicts for the 5 bets, using the thresholds on Slide 3.
// Bets 2 and 3 read their KPI live from the data, bet 1 too once QR passes are issued; bets 4 and 5 use the latest KPI reading entered by the team
// (their KPIs, e.g. QR passes or RSVPs, are not in the 2025 dataset).
import type { Bet, ChannelKpi, ChannelWeek, FunnelRow } from './types';

export type Verdict = 'scale' | 'change' | 'stop' | 'no data';
export interface BetEval { value: number | null; unit: string; source: 'data' | 'manual reading' | 'none'; verdict: Verdict; why: string }

// Bet 2 also needs volume: average new College Partnerships registrants over the last 2 weeks that had any.
export function weeklyVolume(weeks: ChannelWeek[] | undefined, campaignId: string): number | null {
  if (!weeks) return null;
  const w = weeks.filter((x) => x.campaign_id === campaignId && x.registrations > 0).sort((a, b) => a.week_start.localeCompare(b.week_start)).slice(-2);
  return w.length ? w.reduce((a, x) => a + Number(x.registrations), 0) / w.length : null;
}

export function evaluateBet(b: Bet, kpis: ChannelKpi[], weeks?: ChannelWeek[], funnel?: FunnelRow[]): BetEval {
  const ch = (id: string) => kpis.find((k) => k.campaign_id === id);
  const manual = b.latest_kpi_value;
  switch (b.bet_id) {
    case 1: {
      // Live when passes are being issued: QR passes opened / confirmed registrants
      const f = (k: string) => Number(funnel?.find((r) => r.metric === k)?.value ?? 0);
      if (f('qr_passes_issued') > 0 && f('confirmed') > 0) {
        const v = Math.round((1000 * f('qr_passes_downloaded')) / f('confirmed')) / 10;
        return { value: v, unit: '% of confirmed opened their pass', source: 'data', ...band(v, 85, 70, 'higher'), why: '≥ 85% scale · 70–85% change · < 70% stop' };
      }
      if (manual === null) return none('Enter the QR-pass rate (passes ÷ confirmed, %) as a KPI reading.');
      return { value: manual, unit: '%', source: 'manual reading', ...band(manual, 85, 70, 'higher'), why: '≥ 85% scale · 70–85% change · < 70% stop' };
    }
    case 2: {
      const c = ch('C04'); const v = c?.cost_per_registrant ?? null;
      if (v === null) return none('No College Partnerships registrants yet.');
      const vol = weeklyVolume(weeks, 'C04');
      const volText = vol === null ? 'weekly volume unknown' : `${Math.round(vol)} registrants/week (last 2 weeks)`;
      if (v > 138) return { value: v, unit: '₹ per registrant', source: 'data', verdict: 'stop', why: `Above ₹138 → move spend to referrals · ${volText}` };
      if (v > 103) return { value: v, unit: '₹ per registrant', source: 'data', verdict: 'change', why: `₹103–138 → narrow to top-converting colleges · ${volText}` };
      if (vol !== null && vol >= 88) return { value: v, unit: '₹ per registrant', source: 'data', verdict: 'scale', why: `≤ ₹103 and ${volText} (≥ 88 needed) → add colleges` };
      return { value: v, unit: '₹ per registrant', source: 'data', verdict: 'change', why: `Cost is fine (≤ ₹103) but ${volText}, below the 88 needed to scale → add colleges only after volume holds` };
    }
    case 3: {
      // Ceiling ₹137 per registrant for Paid Social. Within 5% below it counts as "at ceiling" (hold).
      const c = ch('C02'); const v = c?.cost_per_registrant ?? null;
      if (v === null) return none('No Paid Social registrants yet.');
      if (v > 137) return { value: v, unit: '₹ per registrant (Paid Social)', source: 'data', verdict: 'stop', why: 'Paid above the ₹137 ceiling → cut paid to zero' };
      if (v >= 137 * 0.95) return { value: v, unit: '₹ per registrant (Paid Social)', source: 'data', verdict: 'change', why: 'Paid within 5% of the ₹137 ceiling → hold, do not move more money yet' };
      return { value: v, unit: '₹ per registrant (Paid Social)', source: 'data', verdict: 'scale', why: 'Paid more than 5% below the ₹137 ceiling → keep shifting budget to peer channels' };
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

// Valid range for a manual KPI reading, per bet (null = no manual reading for this bet).
export function readingRange(betId: number): { min: number; max: number; hint: string } | null {
  if (betId === 1) return { min: 0, max: 100, hint: 'a percentage from 0 to 100' };
  if (betId === 4) return { min: 0, max: 5, hint: 'a ratio such as 0.27 (not a percentage)' };
  if (betId === 5) return { min: 0, max: 10000, hint: 'a whole number of RSVPs' };
  return null;
}

function none(why: string): BetEval { return { value: null, unit: '', source: 'none', verdict: 'no data', why }; }
function band(v: number, good: number, bad: number, dir: 'higher' | 'lower'): { verdict: Verdict } {
  if (dir === 'higher') return { verdict: v >= good ? 'scale' : v >= bad ? 'change' : 'stop' };
  return { verdict: v <= good ? 'scale' : v <= bad ? 'change' : 'stop' };
}

export const verdictClass: Record<Verdict, string> = {
  scale: 'bg-emerald-100 text-emerald-800', change: 'bg-amber-100 text-amber-800', stop: 'bg-red-100 text-red-800', 'no data': 'bg-slate-100 text-slate-600',
};
