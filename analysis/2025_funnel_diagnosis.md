# CampusFest 2025: attendee funnel diagnosis

Source: Attendee_Dataset.xlsx (synthetic, provided by RISA). Script: `diagnose.py` in this folder. All figures are computed from the data unless marked otherwise.

## Counting rules applied
- **Exact duplicate rows removed** by stable ID: 2 daily-marketing rows, 4 registration-history rows, 20 check-in rows.
- **External people only.** Excluded 40 internal, 10 staff and 10 test identities. 40 internal people also had registrations, which were excluded.
- **Registration status** = the latest history version per registration.
- **Verified visitor** = an external person with at least one check-in that is both admitted and verified, counted once. Excluded records: 50 denied, 30 pending/unverified, and 40 non-external people's admissions. 20 people with a denied record were later admitted and verified, so they count once as visitors. 165 visitors appear only in manual (not scanner) records and are counted, since the field guide says manual records can add visitors.

## Audit checks passed (re-run independently)
No duplicate IDs with differing contents. No registrations, status changes or check-ins outside the expected dates. Every check-in and registration joins to a known person. Check-in and registration campaigns match. Spend by campaign reconciles to Rs 2,74,000. That includes Rs -2,500 net of credits posted after the event (14–18 Apr).
- **Spend** = net debits less credits. This includes 4 credit rows worth -Rs 6,500.

## Headline vs targets (revised plan, effective 15 Mar 2025)
| Metric | Actual | Goal | % of goal |
|---|---|---|---|
| Identified external people | 3,625 (3,500 via campaigns before the event + 125 walk-ins identified at the gate) | 3,600 | 100.7% (only 97.2% if counting pre-event identification) |
| External registrants | 2,800 | 3,200 | 87.5% |
| Verified external visitors | 2,050 (1,925 registered + 125 walk-ins) | 2,200 | 93.2% |
| Marketing spend | Rs 2,74,000 | Rs 3,00,000 budget | 91.3% (Rs 26,000 unspent) |

The launch plan (2,800 registrants, 1,800 visitors, Rs 2.4L) was met. The revised plan was not, except identified people.

## Funnel (whole event)
Identified 3,625 → registered 2,800 → confirmed at the end 2,500 → verified visitors 2,050. 725 of the 2,050 visitors came on both days.

**Where people were lost**
1. **Identified but never registered:** 700 leads (the L-prefixed people). The biggest absolute leak at the top.
2. **Confirmed but didn't show:** 575 people, which is 23% of the 2,500 confirmed. The biggest leak at the bottom.
3. **Cancelled:** 183. A further 36 cancelled and then re-confirmed.
4. **Stuck on the waitlist:** 88 people were waitlisted and never released. None attended, even though total attendance was below target. This is a process leak.
5. **Never moved past "interested":** 29.

## By campaign (attribution = recorded acquisition source of the registration)
| Campaign | Spend (Rs) | Registered | Visitors | Show rate | Cost per registrant | Cost per visitor | Cancel % | Opt-outs |
|---|---|---|---|---|---|---|---|---|
| College Partnerships | 31,000 | 450 | 385 | 85.6% | 68.9 | **80.5** | 4.0% | 16 |
| Community Groups | 16,000 | 200 | 165 | 82.5% | 80.0 | 97.0 | 5.5% | 10 |
| Student Referrals | 19,000 | 350 | 275 | 78.6% | 54.3 | **69.1** | 5.1% | 14 |
| Organic Search | 14,000 | 250 | 195 | 78.0% | 56.0 | **71.8** | 6.8% | 11 |
| Campus Ambassadors | 42,000 | 520 | 390 | 75.0% | 80.8 | 107.7 | 4.4% | 18 |
| Paid Social | 93,000 | 680 | 340 | **50.0%** | 136.8 | **273.5** | 8.8% | **117** |
| Creator Partners | 59,000 | 350 | 175 | **50.0%** | 168.6 | **337.1** | 10.3% | 43 |
| **Total (attributed)** | **2,74,000** | **2,800** | **1,925** | 68.8% | 97.9 | 142.3 | 6.5% | 229 |

(The 125 walk-ins have no campaign and are not in this table.)

## The diagnosis in one paragraph
Reach wasn't the problem. Last year's plan put **55.5% of spend (Rs 1.52L) into Paid Social and Creators**. Those channels brought 36.8% of registrants but only **26.8% of attributed visitors**, because half their registrants never showed up. They also produced 160 of the 229 opt-outs. Group and peer channels (College Partnerships, Referrals, Organic, Community) delivered visitors at Rs 69–97 each, with show rates of 78–86%. The 150-visitor gap to target is smaller than the 575 confirmed no-shows plus the 88 stranded waitlisted people. So **the cheapest growth is converting people we already had, then shifting spend to group channels.**

## Timing
- Weekly registrations dipped in 3–9 March (174, against about 250–300 in the weeks around it). That's the week before the targets were raised, and spend that week was the highest of the campaign (Rs 37,425). This is worth flagging as a spend-without-return week.
- Show rate barely changes with how early people registered: 72–74% for those registering within 30 days, 63% for 30–60 days out, and 70% for more than 60 days out. Lead time isn't the main driver. Channel is.

## Caveats
- Campaign attribution is the recorded source. It doesn't prove the campaign *caused* the registration.
- Cost per visitor is an *average*. The next rupee in a cheap channel may cost more (diminishing returns), so it can't be extrapolated linearly.
- The data is synthetic. Real-world rates for a Delhi sports fest will need outside benchmarks or labelled assumptions.
