"""CampusFest-style attendee target model for the IIT Delhi sports fest.
[D] = from 2025 dataset, [A] = assumption. Run: python3 target_model.py"""
# ---- 2025 baselines by channel [D] (spend Rs, identified, registrants, visitors from registrants)
B = {
 'College Partnerships (contingent engine)': dict(spend=31000, ident=500, reg=450, vis=385),
 'Campus Ambassadors':                       dict(spend=42000, ident=600, reg=520, vis=390),
 'Student Referrals':                        dict(spend=19000, ident=410, reg=350, vis=275),
 'Organic Search':                           dict(spend=14000, ident=290, reg=250, vis=195),
 'Community Groups':                         dict(spend=16000, ident=250, reg=200, vis=165),
 'Paid Social':                              dict(spend=93000, ident=960, reg=680, vis=340),
 'Creator Partners':                         dict(spend=59000, ident=490, reg=350, vis=175),
}
WALKINS_2025 = 125          # [D]
WAITLIST_RATE = 88/2800     # [D] share of registrants stranded on waitlist
BEST_SHOW = 385/450         # [D] best channel show rate (College Partnerships, 85.6%)
REPEAT_FACTOR = 2775/2050   # [D] person-days per unique visitor (1,430 + 1,345 day uniques)

# ---- Assumptions [A]
BUDGET = 300000             # [A] same as 2025 approved budget
MARGINAL_COST_MULT = 1.5    # [A] each extra rupee above 2025 spend buys registrants at 1.5x the 2025 average cost
NEW_SPEND = {               # [A] base-case allocation (sums to budget incl. show-up programme)
 'College Partnerships (contingent engine)': 75000,
 'Campus Ambassadors': 60000,
 'Student Referrals': 40000,
 'Organic Search': 25000,
 'Community Groups': 25000,
 'Paid Social': 30000,        # retargeting only
 'Creator Partners': 15000,   # 1-2 sports creators only
}
SHOWUP_PROGRAMME = 30000    # [A] reminders, QR passes, deposit admin
SHOW_GAP_CLOSED = {'base': 0.25, 'stretch': 0.50}   # [A] share of gap to 85.6% closed by show-up programme
WAITLIST_RELEASED = {'base': 1.0, 'stretch': 1.0}   # [A] process fix: release all, no cost
SQUAD_K = {'base': 0.0, 'stretch': 0.25}            # [A] extra registrants per contingent-engine registrant via squad referral
SQUAD_SHOW = 275/350                                # [D] referral show rate 78.6%
EVENING_WALKINS = {'base': 0, 'stretch': 300}       # [A] extra walk-ins from pro-nights + IPL screening (sponsor funded)

def channel_rows():
    rows = []
    for ch, b in B.items():
        s0, s1 = b['spend'], NEW_SPEND[ch]
        eff = s1 if s1 <= s0 else s0 + (s1 - s0) / MARGINAL_COST_MULT   # effective 2025-equivalent spend
        m = eff / s0
        reg = b['reg'] * m
        show = b['vis'] / b['reg']
        rows.append(dict(ch=ch, spend0=s0, spend1=s1, mult=m, ident=b['ident']*m, reg=reg, show=show))
    return rows

def run(case):
    rows = channel_rows()
    out = {}
    reg_total = sum(r['reg'] for r in rows)
    vis_realloc = sum(r['reg'] * r['show'] for r in rows)
    vis_showup = sum(r['reg'] * (BEST_SHOW - r['show']) * SHOW_GAP_CLOSED[case] * (1 - WAITLIST_RATE) for r in rows if r['show'] < BEST_SHOW)  # exclude waitlisted share (handled by waitlist release)
    blended_show = vis_realloc / reg_total
    vis_waitlist = reg_total * WAITLIST_RATE * WAITLIST_RELEASED[case] * blended_show
    ce = [r for r in rows if r['ch'].startswith('College')][0]
    squad_reg = ce['reg'] * SQUAD_K[case]
    vis_squad = squad_reg * SQUAD_SHOW
    walkins = WALKINS_2025 + EVENING_WALKINS[case]
    total = vis_realloc + vis_showup + vis_waitlist + vis_squad + walkins
    out.update(rows=rows, reg_total=reg_total + squad_reg, ident_total=sum(r['ident'] for r in rows) + squad_reg,
               vis_realloc=vis_realloc, vis_showup=vis_showup, vis_waitlist=vis_waitlist, vis_squad=vis_squad,
               walkins=walkins, total=total, person_days=total*REPEAT_FACTOR,
               spend=sum(NEW_SPEND.values()) + SHOWUP_PROGRAMME)
    out['cpv'] = out['spend'] / (total - walkins)
    return out

def main():
    global MARGINAL_COST_MULT
    assert sum(NEW_SPEND.values()) + SHOWUP_PROGRAMME == BUDGET, sum(NEW_SPEND.values()) + SHOWUP_PROGRAMME
    for case in ('base', 'stretch'):
        o = run(case)
        print(f'\n===== {case.upper()} =====')
        for r in o['rows']:
            print(f"{r['ch'][:40]:40s} spend {r['spend0']:>6}->{r['spend1']:>6}  mult {r['mult']:.2f}  ident {r['ident']:7.1f}  reg {r['reg']:7.1f}  show {r['show']:.3f}  vis {r['reg']*r['show']:7.1f}")
        for k in ('ident_total','reg_total','vis_realloc','vis_showup','vis_waitlist','vis_squad','walkins','total','person_days','spend','cpv'):
            print(f'{k:14s} {o[k]:10.1f}')
    # sensitivity on base
    base = run('base')['total']
    import copy
    print('\n===== SENSITIVITY (base) =====')
    pass
    for mcm in (1.25, 2.0):
        MARGINAL_COST_MULT = mcm; print('marginal cost x', mcm, round(run('base')['total'] - base, 1))
    MARGINAL_COST_MULT = 1.5
    rows = channel_rows(); reg = sum(r['reg'] for r in rows)
    print('+1 pt show rate on all registrants =', round(reg*0.01, 1))
    for g in (0.0, 0.5):
        SHOW_GAP_CLOSED['base'] = g; print('show gap closed', g, round(run('base')['total'] - base, 1))
    SHOW_GAP_CLOSED['base'] = 0.25
if __name__ == "__main__": main()
