# Slide 1 target model: base and stretch

Script: `target_model.py` (re-runnable; every assumption is a named constant at the top). Tags: **[D]** = 2025 dataset, **[A]** = assumption, **[O]** = Rakesh's site observation.

## Headline
| | 2025 actual [D] | **Base** | **Stretch** |
|---|---|---|---|
| Verified external attendees (distinct) | 2,050 | **2,670 (+30%)** | **3,205 (+56%)** |
| External registrants | 2,800 | 3,117 | 3,336 |
| Identified before the fest | 3,500 | 3,677 | 3,896 |
| Marketing spend | ₹2.74L | ₹3.00L | ₹3.00L |
| Cost per campaign-driven attendee | ₹142 (2,74,000 ÷ 1,925) | ₹118 (3,00,000 ÷ 2,545) | ₹108 (3,00,000 ÷ 2,780) |
| Person-days (both days, 1.354 per person [D]) | 2,775 | ~3,614 | ~4,339 |

Base beats last year's revised target of 2,200 by 21%. Stretch beats it by 46%.

## How it's built
**Step 1: reallocate the same ₹3L budget across channels (the base engine).**
- Each channel starts from its own 2025 cost per registrant and show rate [D].
- Spend **above** 2025 levels buys registrants at **1.5× the 2025 average cost** [A]. This is diminishing returns, so we never extrapolate averages in a straight line.
- Spend cuts scale down proportionally. That's conservative, because in reality you cut the worst-performing spend first.

| Channel | 2025 spend [D] | New spend [A] | Registrants | Show rate [D] | Attendees |
|---|---|---|---|---|---|
| College Partnerships → **contingent engine** | 31,000 | 75,000 | 876 | 85.6% | 749 |
| Campus Ambassadors | 42,000 | 60,000 | 669 | 75.0% | 501 |
| Student Referrals | 19,000 | 40,000 | 608 | 78.6% | 478 |
| Organic Search | 14,000 | 25,000 | 381 | 78.0% | 297 |
| Community Groups | 16,000 | 25,000 | 275 | 82.5% | 227 |
| Paid Social (retargeting only) | 93,000 | 30,000 | 219 | 50.0% | 110 |
| Creator Partners (1–2 sports creators) | 59,000 | 15,000 | 89 | 50.0% | 44 |
| Show-up programme | — | 30,000 | — | — | see step 2 |
| **Total** | **2,74,000** | **3,00,000** | **3,117** | 77.2% | **2,406** |

Worked example (College Partnerships): effective spend = 31,000 + (75,000 − 31,000) ÷ 1.5 = 60,333, which is 1.946× last year. Registrants = 450 × 1.946 = 876. Attendees = 876 × 85.6% = 749.

**Step 2: levers on top**
| Lever | Rule | Base | Stretch |
|---|---|---|---|
| Show-up programme (₹30k) | Closes part of each channel's gap to the best show rate (85.6%) [A]: 25% in base, 50% in stretch | +63 | +126 |
| Waitlist auto-release (no cost) | Last year 3.14% of registrants were stranded [D]. Release them, and they attend at the blended show rate | +76 | +76 |
| Squad referral | +0.25 extra registrants per contingent-engine registrant [A], at the referral show rate of 78.6% [D] | 0 | +172 |
| Evening pro-nights + IPL screening (sponsor-funded) | Walk-ins rise from 125 [D] by +300 [A] | 0 | +300 |
| Walk-ins (baseline) | Same as 2025 [D] | 125 | 125 |

Overlap removed: the show-up programme excludes the waitlisted share, so those people aren't counted twice.

## Rounding rule
The script keeps decimals. Displayed integers are rounded so every column and the bridge add up exactly: unrounded 2,406.5 channel attendees is shown as 2,406 (Creators 44.5 → 44). The base total is 2,670.1 → 2,670, and stretch is 3,205.1 → 3,205.

## Bridge
- **Base:** 2,050 → +481 (reallocation and full budget) → +63 (show-up) → +76 (waitlist) = **2,670**
- **Stretch:** 2,670 → +63 (stronger show-up) → +172 (squad referral) → +300 (evening walk-ins) = **3,205**

## Capacity check (which constraint binds first)
- 2025: 1,430 unique attendees on day 1 and 1,345 on day 2 [D]. Check-ins spiked at 6 pm on day 1 (400 people) [D], so evening entry is a real peak.
- At stretch, about 4,339 person-days ≈ **2,170 a day**. That's already at the open-air theatre's 2,000–2,500 seats [O]. **The evening venue is the binding constraint at stretch**, not the daytime grounds. Mitigations: two screening zones, or staggered pro-night slots.
- Gate throughput: 400 check-ins in one hour last year. At stretch that could be about 600 an hour [A]. Plan for extra QR lanes.

## Sensitivity (base case)
| Assumption change | Effect on base |
|---|---|
| Marginal cost 1.25× instead of 1.5× | +176 → 2,846 |
| Marginal cost 2.0× instead of 1.5× | −220 → 2,450 |
| +1 point of show rate on all registrants | +31 |
| Show-up programme has no effect | −63 → 2,607 |

**Even the pessimistic case (2,450) beats last year's 2,200 target.** The biggest single uncertainty is diminishing returns in the scaled channels, so that's the first thing the dashboard must track (cost per registrant by week, per channel).

## Honest limitations
- The 2025 rates come from a generic fest, used here as a proxy for a sports fest. Contingent behaviour (teams committing together) could beat College Partnerships' 85.6% show rate, so this is likely conservative.
- The squad-referral rate (0.25) and evening walk-ins (+300) are the weakest assumptions. They're only in stretch, and they're the first things to test (Slide 3).
- Campaign attribution is the recorded source, not proven causation.
- Contingent travel and stay costs are assumed to be paid by the teams or sponsors, outside the ₹3L marketing budget.
