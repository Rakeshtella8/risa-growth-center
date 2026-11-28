# RISA Growth Center

A command centre for growing **verified attendance** at an inter-college sports fest in Delhi NCR (host: IIT Delhi).
It was built for the RISA Labs Growth APM assignment, Challenge A.

**Live app:** https://risa-growth-center-omega.vercel.app · **Repo:** https://github.com/Rakeshtella8/risa-growth-center · **Deck:** `Rakesh_Tella_RISA_Growth_APM.pdf` (3 slides)

The deck and the app use the same numbers. Every target, budget, bet, score and scale / change / stop threshold on the slides is what the app computes or stores; section 10 maps each slide element to the screen that shows it.

The app runs one loop on a single set of numbers: **Measure → Diagnose → Decide → Execute.**

| Tab | Job | What you can do |
|---|---|---|
| Fest year (header) | Context | **2025 (replay)** is the original RISA dataset, untouched. **2026 (live)** is the campaign being run now: the weeks up to the demo clock (8 Mar 2026) are simulated from 2025 at the deck's planned channel budgets [A], and every simulated row is flagged and removable on the Data tab. |
| Overview | Measure | Attendees vs target, funnel, weekly pace and the four biggest leaks. Use the **As of** slider to replay the 2025 campaign week by week. Before the fest it shows a forecast; after, the actuals. |
| Channels | Diagnose | Cost per registrant (so far and projected to campaign end), show rate and cost per attendee for each channel, with red/amber/green flags against each channel's ceiling. A **budget what-if** moves rupees between channels and shows the attendee impact. |
| Attendees | Execute | Register people, confirm, waitlist and release, send QR passes and reminders. The public registration page and pass link work too. |
| Gate | Execute | Scan or type a pass code to admit (each person counts once), admit walk-ins. Live during the fest days. |
| Bets | Decide | The five 2026 bets, each with a live KPI, its scale / change / stop thresholds and a verdict. Set the status, and log KPI readings for bets the dataset can't measure. |
| Campaigns & tasks | Execute | Campaign status and 2026 budgets, a spend log, and a task manager linked to bets and campaigns. |
| Data | Edit / reset | Edit, add or delete raw rows, or upload a CSV. Every number on every tab, and every chatbot answer, recalculates. **Reset data** restores the original 2025 dataset. |
| Copilot (side panel) | All four | A chatbot that answers from live data, does calculations and what-ifs, says when the data can't answer, and proposes tasks. A task is only created when you click **Confirm**. |

Every number carries a tag: **[D]** comes from the data, **[A]** is an assumption.

---

## 0. Research: why Delhi NCR and IIT Delhi

| Claim | Source |
|---|---|
| Delhi NCR is India's largest metro region, ~5.8 crore people (2011) [S] | [Wikipedia: National Capital Region (India)](https://en.wikipedia.org/wiki/National_Capital_Region_(India)), [Census 2011 urban agglomerations](https://www.census2011.co.in/facts/topurbanpopulation.html) |
| Deep sports catchment: Khelo India Youth Games 2025, Haryana 2nd, Rajasthan 3rd, Delhi 5th [S] | [AIR News](https://www.newsonair.gov.in/khelo-india-youth-games-2025-ends-maharashtra-tops-with-158-medals), [Wikipedia: 2025 Khelo India Youth Games](https://en.wikipedia.org/wiki/2025_Khelo_India_Youth_Games) |
| Khelo India University Games 2025: the top 3 were Punjab universities [S] | [AIR News](https://www.newsonair.gov.in/fifth-khelo-india-university-games-conclude-in-jaipur-chandigarh-university-tops-medal-tally) |
| IIT Delhi: walkable campus, indoor courts, hockey ground, athletics track, open-air theatre of ~2,000–2,500 seats [O] | Rakesh's own site observation (not a published source) |

Tags used everywhere: **[D]** 2025 dataset · **[S]** external source · **[A]** assumption · **[O]** first-hand site observation.

## 1. The data and how it is counted

Source: `data/Attendee_Dataset.xlsx`. This is the synthetic CampusFest 2025 dataset supplied by RISA: nine sheets covering 15 Jan to 20 Apr 2025, with the fest on 12–13 Apr.
The raw sheets are loaded **as is**. The cleaning lives in SQL functions, so edited or replaced data is cleaned the same way.

| Rule | Why |
|---|---|
| Duplicates removed by stable ID (the first row wins) | Removes 2 marketing, 4 status-history and 20 check-in duplicates |
| External people only | Removes 40 internal, 10 staff and 10 test identities, plus their registrations and admissions |
| Registration status = latest history row | People move between waitlisted, confirmed and cancelled |
| Verified visitor = admitted **and** verified at least once, counted once per person | Denied, pending and unverified records don't count. Someone who was denied and later admitted counts once |
| Spend = net of credits | Four credit rows (−₹6,500) post after the fest |
| Attribution = the campaign recorded on the registration | This is a label, not proof the campaign caused the registration |

**2025 result (audited, and reproduced by `tests/test_views.sh`):**
- 3,625 people identified
- 2,800 external registrants
- 2,500 confirmed at the end
- **2,050 verified visitors** (1,925 registered and 125 walk-ins), against the revised goal of 2,200
- 68.8% show rate
- ₹2,74,000 spent of the ₹3,00,000 budget
- ₹142 per campaign-driven attendee

The four leaks, ranked by size: **700** identified but never registered, **575** confirmed no-shows, **183** cancelled and **88** stranded on the waitlist.
Paid Social and Creators took 55.5% of spend but delivered 26.8% of attributed visitors, at a 50% show rate.

## 2. The 2026 target model (detailed calculations)

Full model: [`analysis/target_model.md`](analysis/target_model.md), re-runnable as `python3 analysis/target_model.py` (every assumption is a named constant). The 2025 diagnosis is [`analysis/2025_funnel_diagnosis.md`](analysis/2025_funnel_diagnosis.md) (`analysis/diagnose.py data/Attendee_Dataset.xlsx`).

| | 2025 [D] | Base | Stretch |
|---|---|---|---|
| Landing-page sessions | 24,645 | 27,650 | 27,650 |
| Identified before the fest | 3,500 | 3,677 | 3,896 |
| Registrants | 2,800 (80.0%) | 3,117 (84.8%) | 3,336 (85.6%) |
| Attended from registration | 1,925 (68.8%) | 2,545 (81.7%) | 2,780 (83.3%) |
| + walk-ins = **verified attendees** | 125 → **2,050** | 125 → **2,670 (+30%)** | 425 → **3,205 (+56%)** |
| Spend | ₹2,74,000 | ₹3,00,000 | ₹3,00,000 |
| Cost per campaign-driven attendee | ₹142 (2,74,000 ÷ 1,925) | ₹118 (3,00,000 ÷ 2,545) | ₹108 (3,00,000 ÷ 2,780) |

**Step 1: reallocate the ₹3L across channels.** Spend above the 2025 level buys registrants at **1.5× the 2025 average cost** [A] (diminishing returns); cuts scale down proportionally; each channel keeps its 2025 show rate [D].

| Channel | 2025 spend [D] | 2026 plan [A] | Registrants | Show rate [D] | Attendees |
|---|---|---|---|---|---|
| College Partnerships (contingent engine) | 31,000 | 75,000 | 876 | 85.6% | 749 |
| Campus Ambassadors | 42,000 | 60,000 | 669 | 75.0% | 501 |
| Student Referrals | 19,000 | 40,000 | 608 | 78.6% | 478 |
| Organic Search | 14,000 | 25,000 | 381 | 78.0% | 297 |
| Community Groups | 16,000 | 25,000 | 275 | 82.5% | 227 |
| Paid Social (retargeting only) | 93,000 | 30,000 | 219 | 50.0% | 110 |
| Creator Partners | 59,000 | 15,000 | 89 | 50.0% | 44 |
| Show-up programme | – | 30,000 | – | – | step 2 |
| **Total** | **2,74,000** | **3,00,000** | **3,117** | 77.2% | **2,406** |

Worked example (College Partnerships): effective spend = 31,000 + (75,000 − 31,000) ÷ 1.5 = 60,333, i.e. 1.946× 2025. Registrants = 450 × 1.946 = 876. Attendees = 876 × 85.6% = 749.

**Step 2: levers on top.**

| Lever | Rule | Base | Stretch |
|---|---|---|---|
| Show-up programme (₹30k) | Closes part of each channel's gap to the best show rate (85.6%) [A]: 25% in base, 50% in stretch | +63 | +126 |
| Waitlist auto-release | 3.14% of 2025 registrants were stranded on the waitlist [D]; released, they attend at the blended show rate | +76 | +76 |
| Squad referral | +0.25 registrants per contingent registrant [A] at the referral show rate 78.6% [D] | 0 | +172 |
| Evening pro-nights + IPL screening | Walk-ins 125 [D] + 300 [A] | 0 | +300 |
| Walk-ins | Same as 2025 [D] | 125 | 125 |

Base = 2,406 + 63 + 76 + 125 = **2,670**. Stretch = 2,406 + 126 + 76 + 172 + 125 + 300 = **3,205**. The model keeps decimals (2,406.5 → 2,406) so that every column and the bridge add up.

**Capacity.** Stretch means ~4,339 person-days (1.354 days per attendee [D]) ≈ 2,170 a day, which fills the 2,000–2,500-seat open-air theatre [O]: the evening venue is the binding constraint. Last year the gate peaked at 400 check-ins in one hour (6 pm, day 1) [D].

**Sensitivity (base).** Marginal cost 1.25× → 2,846; 2.0× → 2,450 (still above last year's 2,200 target); +1 point of show rate → +31; show-up programme has no effect → 2,607.

**How the app uses it.** `campaigns.budget_2026_inr` holds the plan budgets; `f_channel_plan` recomputes the 876 / 669 / 608 / 381 / 275 / 219 / 89 registrants with the same formula (tested: 3,117 total). The budget what-if (`src/lib/whatIf.ts`) reproduces 2025 (2,800 → 2,050) and the 2026 engine (3,117 → 2,406.5). Change a budget and the plan, pace line and projections move.

**How the 2026 projection works [A].** Projected registrants per channel = registrants so far ÷ the share of that channel's 2025 season that had arrived by the same campaign day. Projected attendees = projected registrants × 77.2% + 125 walk-ins. It already assumes bets 2 and 3 (the channel plan) and leaves out bet 1 (+139 base) and, for stretch, bets 4–5. On 8 Mar 2026: 1,203 registrants (97.8% of plan pace), projected 3,049 registrants and 2,479 attendees: −191 vs 2,670, of which 139 is bet 1 (not yet running) and 52 is channels projected 68 registrants short of plan.

## 3. The five bets and the prioritisation framework (Bets tab)

**Score = incremental attendees (stretch) × confidence ÷ effort in person-weeks** [A]. Confidence: 0.8 proven in our data · 0.7 proven parts, untested combination · 0.5 partly evidenced · 0.3 depends on a third party. The weights only set the ranking; contributions are computed in section 2.

| # | Bet | +Attendees base / stretch | Budget | Conf. | Person-weeks | Score | KPI and thresholds (Slide 3) | Read from |
|---|---|---|---|---|---|---|---|---|
| 1 | Show-up programme + waitlist auto-release | 139 / 202 | ₹30k | 0.7 | 2 | **70.7** | QR passes ÷ confirmed: ≥ 85% scale · 70–85% change · < 70% or opt-outs > 6.5% of identified stop | **Live data** |
| 2 | Contingent engine | 364 / 364 | ₹75k | 0.8 | 6 | **48.5** | Projected cost per contingent registrant: ≤ ₹103 and ≥ 88/wk scale · ₹103–138 change · > ₹138 stop | **Live data** |
| 3 | Shift paid spend to peer channels | 117 / 117 | ₹0 extra | 0.8 | 2 | **46.8** | Projected Paid Social cost per registrant vs ₹137: below scale · within 5% hold · above stop | **Live data** |
| 4 | Squad referral | 0 / 172 | ₹0 (sponsor rewards) | 0.5 | 3 | **28.7** | Referred ÷ contingent registrants: ≥ 0.25 · 0.10–0.25 · < 0.10 | Team reading |
| 5 | Evening pro-nights + IPL screening | 0 / 300 | ₹0 (sponsor) | 0.3 | 8 | **11.3** | RSVPs: ≥ 300 scale · 150–300 change · no sponsor by T-6w stop | Team reading |

Base adds 139 + 364 + 117 = **620**; stretch adds **1,155** (2,050 + 364 + 202 + 117 + 172 + 300 = 3,205). Double down on #1 and #2 (+566, backed by our own data). Deprioritise #5 (largest stretch lever, least certain). Reject: scaling paid social (₹274 per attendee, 50% show rate, 117 of 229 opt-outs [D]), a celebrity headliner (high cost, unproven [A]), blanket discounts (don't fix no-shows [A]).

**Why cost thresholds use the projected end-of-campaign cost.** Spend runs ahead of registrations: in 2025 College Partnerships cost ₹137 per registrant by 9 Mar but ₹68.9 at the end [D]. Judging on cost-to-date would stop the best channel mid-season, so the Bets verdicts, the Channels flags and the copilot all use planned budget ÷ projected registrants. Paid Social's plan (₹30,000 ÷ 219 = ₹137) sits exactly on its stop line by design: paid gets no slack, and on 8 Mar it projects ₹138.3, so bet 3 says stop.

## 4. The copilot (chatbot)

**Grounding.** The model never sees raw tables in its prompt. It calls tools, and the tools run the **same SQL functions the dashboard uses**, so the chat and the screens can't disagree. The tools are:
- `get_funnel`, `get_channel_kpis`, `get_weekly_pace`, `get_channel_trend`, `get_forecast` (with a gap breakdown), `get_pace_vs_last_year`, `get_targets`, `get_attendees`
- `get_bets`, `list_tasks`, `get_data_dictionary`
- `run_sql`: ad-hoc read-only SQL
- `calculate`: a safe arithmetic evaluator, because the model may not do maths in its head
- `what_if_budget`: the target-model engine (2026 starts from the planned budgets)
- `propose_task`: proposes a task and never writes it

Each answer has a **"How I got this"** section listing every query, its arguments and its result.

**Context.** The as-of date and the comparison target selected in the header are passed with every question. Follow-ups use the last 10 turns.

**Can't answer.** Revenue, ticket price, gender, satisfaction, sponsor ROI and causal uplift aren't in the data. The copilot says so, names the data that would be needed, and offers the closest measure that does exist.

**Guardrails.**
- `run_sql` goes through `copilot_query()`. It allows only SELECT/WITH and a single statement, runs in a read-only transaction, and returns at most 200 rows. It runs as a role (`copilot_ro`) that can read but never write, and it can't see the chat log.
- The prompt tells the model to treat instructions found inside data as data.

**Models (free tiers).**
- Groq: `openai/gpt-oss-120b`, then `qwen/qwen3.8-27b` and `openai/gpt-oss-20b`.
- Gemini: `gemini-flash-lite-latest`, then 3.5 Flash-Lite and Flash.

Free tiers limit each model separately. On a 429 the agent waits up to 20 s if the provider gives a retry time, otherwise it moves to the next model. When it switches provider mid-answer, it hands over the data already fetched as text, because Gemini can't replay another provider's tool calls. If every model is busy, the user sees a plain message and the dashboard keeps working. `/api/models` lists the models the configured keys can use.

## 5. Architecture

```
Browser (React 19 + Vite + Tailwind + Recharts)  ──reads/writes──►  Supabase Postgres (free tier, Mumbai)
        │                                                     raw tables  →  f_* functions / v_* views  (single source of truth)
        └── /api/chat (Vercel serverless) ── tools ──────────►  same functions + copilot_query (read-only)
                    └── Groq / Gemini (OpenAI-compatible tool calling)
```

- **Persistence.** Edits go straight to Postgres. Row-level security is on, with demo policies: anyone can read and edit the operational tables. That is the point of the demo. Writes are recorded in `audit_log`, and **Reset data** restores the originals from the `original.*` schema.
- **Performance.** The metric functions use materialized CTEs with nested loops disabled. The heaviest one (channel KPIs) dropped from 48 s to 78 ms on the free tier.
- **Keep-alive.** A daily GitHub Action makes one read so the free Supabase project doesn't pause.

## 6. Run it yourself

1. Create a Supabase project (free tier). In the SQL editor run, in this order: `supabase/setup.sql` (schema, metric functions, loads the 2025 data from this repo over HTTP), then `update_01.sql`, `update_02.sql`, `update_03.sql`, `update_04.sql`, `update_05.sql`, `update_06.sql`. This is the exact sequence the live database was built with; each file ends with a few `check | result` rows to compare (update_06: 3049 · 97.8 · 85.2 · true). The source of every function is in `supabase/sql/01..06`; the update files are generated from them by `scripts/make_update_0*.py`.
2. Put your Supabase URL and publishable key in `src/lib/supabase.ts` and `api/chat.ts`, or set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` and `SUPABASE_URL` / `SUPABASE_ANON_KEY`.
3. On Vercel, import the repo with the Vite preset and set `GROQ_API_KEY` and `GEMINI_API_KEY` (both free from console.groq.com and aistudio.google.com).
4. Locally: `npm i`, `npm run dev`. `scripts/dev-chat.ts` serves `/api/chat`; `MOCK_LLM=1` gives a scripted model for offline UI tests. `scripts/dev-postgrest.mjs` emulates the Supabase REST API over a plain local Postgres, which is how the tests below run without a cloud project.

## 7. Demo workflow (insight → decision → task → dashboard)

1. Overview, fest year 2026: projected 2,479 attendees vs the 2,670 base target, 97.8% of plan pace. Click **Why the gap?** (or ask the copilot "Are we on track for the base target, and what closes the gap?"). It splits the −191: 139 is bet 1, which is planned but not running yet, and 52 is channels projected 68 registrants short of plan.
2. Channels: Paid Social is red (projected ₹138.3 vs its ₹137 ceiling); Bets: bet 3 says **stop**.
3. Ask: "Move 10k from Creators to Referrals. What would that add, and make it a task." The copilot runs the what-if (+67 attendees [A], from the 2026 plan budgets) and proposes a task.
4. Click **Confirm & create**. The task appears on Campaigns & tasks with its owner and due date, tagged "from copilot".
5. Change the data (for example the Creator Partners 2026 budget on Campaigns & tasks, or a spend row on Data) and ask again: the plan, flags, verdicts and the copilot's answer all move. **Reset data** restores the original 2025 data and the 2026 simulation.

## 8. Testing

| Suite | What it checks | Result |
|---|---|---|
| `tests/test_views.sh` (39 checks) | Every audited 2025 number, dirty-data rules, edits propagating, reset, as-of behaviour, the 2026 plan (876 / 3,117), the 2026 simulation (1,203 registrants, 97.8% pace, 3,049 projected, ₹85.2 contingent projected cost) | Pass |
| `vitest` (26 tests) | Calculator, what-if engine (reproduces 2025 and 2026), copilot tools against a local copy of the database, including the gap breakdown (139 / 674) | Pass |
| Access rules | As anon: deletes rejected, multi-statement SQL rejected, chat_log hidden, loader and http functions blocked, reset works | Pass |
| UI end-to-end (Playwright, `tests/e2e/run.cjs`) | Reset, register a person, waitlist release, public registration and QR pass page, gate admit / repeat scan / walk-in, live fest-day Overview, bet verdicts, 2025 replay, phone width with no horizontal scroll, no console or HTTP errors. A separate run edited a spend row (+₹1,00,000) on Data and saw Channels and Overview move, then restored it | Pass |
| Live copilot test bank | Facts, can't-answer, false premises, calculations, what-ifs, as-of, ad-hoc SQL, follow-ups, prompt injection, off-topic | See below |

**Live copilot test bank (production site, 27 Nov 2026).** I ran 33 questions, including multi-turn follow-ups, against the deployed app.

| Run | What happened | What changed |
|---|---|---|
| 1 | Most answers failed. One free model hit its tokens-per-minute limit within 3 questions, and the Gemini fallback failed too. | Added a chain of several models with short retries, and made the error message friendly. |
| 2 | 20 of 33 answered. The `/api/models` check showed two of the Groq models no longer exist and the two Gemini 2.5 models are closed to new users. Switching to Gemini mid-answer broke because of a tool-call signature mismatch. | Rebuilt the chain from the models these keys can actually use. On a provider switch, the data fetched so far is handed over as text. |
| 3 | **32 of 33 answered.** The one failure was a network drop during a redeploy. There were 0 rate-limit failures. Median response 15 s, 90th percentile 30 s, because the agent waits out free-tier limits. | The fixes below. |
| 4 | Changed-data test: I added a temporary ₹10,000 Paid Social spend row through the public API, then asked. The copilot answered ₹1,03,000 spend and ₹151.5 per registrant, and bet #3 flipped to **stop**, all correct. I then deleted the row. | — |
| 5 | Deck-alignment run on 2026 (28 Nov 2026), 13 questions. First pass: 6 of 8 right; it read people-registered-so-far as the forecast, double-counted bet 1 against the gap, and judged channels on cost-to-date. | Forecast now leads with the projection and a gap breakdown; channel flags use projected cost with a stated reason; what-ifs start from the 2026 plan budgets; due dates use the fest-year date. Re-run: 5 of 5 right: gap −191 = 139 (bet 1, not yet running) + 52 (channels 68 registrants short of plan); "move ₹10k Creators → Referrals" = +66.8 attendees with a task proposed for 15 Mar 2026; Paid Social red at ₹138.3 vs ₹136.8; "which college in 2025" and "weather" correctly refused; follow-up "how many more passes for 85%" = 27 (880 − 853). |

Numbers checked against SQL: both-day visitors 725, walk-ins on day 2 45 of 125 (36%), busiest weekday Saturday (441), brochure downloads that never registered 319, top owner Meera Iyer (775 attendees), and cancelled 183. The what-ifs also matched: moving ₹10k from Creators to Referrals adds 67, cutting Paid Social to zero gives 2,120 registrants and 1,710 attendees, and an 80% show rate adds 315.
The copilot refused ticket revenue, gender and satisfaction, and said what data would be needed for each. It corrected false premises ("we beat 3,200", "Paid Social was cheapest"). It refused the write-SQL and "delete all tasks" prompts.

Issues the test bank found, now fixed:
- "Are we on track?" mid-campaign compared the partial forecast with the full target. It now uses pace against an even weekly plan (74% on 10 Mar), and the Overview shows the same.
- Bet verdicts were empty in chat. Chat now uses the same verdict logic as the Bets screen.
- "No data" was read as "stop". It now prompts the team to log a reading.
- A spend share was computed in the model's head (45% instead of 34%). The shares now come from the tool.
- Mixed up 2025 goals and 2026 targets. Both are now stated in the prompt.
- Task due dates were set in 2025. The prompt now carries today's date.
- Asking "open tasks" missed tasks marked doing. "Open" now means everything not done.
- gpt-oss sometimes leaked its markup. That markup is now stripped from answers.


## 9. Tools, plans and what was reused

| Tool | Plan | Used for |
|---|---|---|
| Supabase (Postgres, REST, row-level security) | Free tier, Mumbai region | Database, metric functions, persistence, reset |
| Vercel | Hobby (free) | Hosting the web app and the `/api/chat` serverless function; auto-deploys from GitHub `main` |
| GitHub + GitHub Actions | Free (public repo) | Code, version history, daily keep-alive ping so the free Supabase project doesn't pause |
| Groq API (`openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `openai/gpt-oss-20b`) | Free tier | Copilot models with tool calling |
| Google AI Studio (Gemini Flash-Lite / Flash) | Free tier | Copilot fallback models |
| Claude Code (Anthropic) | Rakesh's Claude subscription | Pair-programming the app, SQL, tests and analysis scripts |
| Oria | Rakesh's Oria account | Laying out the 3-slide deck from the content in `analysis/` |
| React 19, Vite, TypeScript, Tailwind, Recharts, supabase-js, qrcode, Playwright, Vitest, pandas | Open source (MIT / Apache) | UI, charts, QR passes, tests, the Python model |

**Reused as-is:** the open-source libraries above, and the RISA-provided `Attendee_Dataset.xlsx` (loaded unchanged; cleaning happens in SQL). No app template or UI kit was used.
**Written for this project:** every screen, the SQL metric layer (`supabase/sql`), the copilot agent loop, tools and guardrails (`api/_lib`), the 2026 simulation, the Python target model and diagnosis (`analysis/`), and the tests.
**Verified:** every 2025 figure against an independent pandas pass (`analysis/diagnose.py`) and `tests/test_views.sh`; the target model's 3,117 / 2,406.5 against the app's what-if engine and `f_channel_plan`; the copilot against the live site (section 8). AI-written code was read, run and tested before it shipped; numbers in the deck were taken from these outputs, not typed by hand.

## 10. Where each slide lives in the app

| Slide element | In the app |
|---|---|
| S1 2025 baseline (2,050 attendees, 575 no-shows, 88 waitlisted, 55.5% / 26.8% paid share) | Overview and Channels with fest year **2025** |
| S1 funnel and targets (3,677 / 3,117 / 2,670; 3,896 / 3,336 / 3,205), budget ₹3L | Overview (target selector), Data → plan targets |
| S1 channel plan and 1.5× rule | Campaigns & tasks (2026 budgets), Channels → budget what-if |
| S2 five bets, scores 70.7 / 48.5 / 46.8 / 28.7 / 11.3, owners, budgets | Bets |
| S3 thresholds (85 / 70%, ₹103 / ₹138, ₹137, 0.25 / 0.10, 300 / 150 RSVPs) | Bets verdicts (live) and Channels flags, both on projected end-of-campaign cost |
| S3 leading indicators (QR passes ÷ confirmed, weekly registrants, pace) | Overview KPIs, Attendees, pace chart vs plan and vs the same week last year |
| S3 "How the dashboard and AI decide" | Copilot: diagnose → what-if → propose task → Confirm → Campaigns & tasks |

## 11. Limitations (honest)

- **The data is synthetic** and comes from a generic fest. Its rates are a proxy for a sports fest.
- **Attribution is not causation.** Channel costs are averages, and the 1.5× marginal-cost rule is an assumption. The sensitivity table shows its effect.
- **The weakest assumptions** are squad referrals (0.25) and evening walk-ins (+300). They are only in the stretch case, and Bets 4 and 5 test them first.
- **Free AI tiers have per-minute limits,** so answers take 5–30 s while the agent waits for capacity. Very heavy back-to-back questioning can still exhaust every model; the app then says so instead of guessing. A pay-per-use Groq key, or more models in `GROQ_MODELS` / `GEMINI_MODELS`, removes the wait.
- **Wording slips remain possible.** The model owns the wording, so it can still mislabel a correct number. That is why every answer shows its queries.
- **2026 is simulated up to the demo clock (8 Mar 2026).** The weeks so far are generated from the 2025 campaign at the planned budgets [A], so they show the product working, not real 2026 results. The 2025 replay is the untouched original data.
- **Campaign status (active / paused / stopped) is a label.** It does not yet switch a channel off in the projection; change its 2026 budget for that.
- **Bets 4 and 5 have no data feed.** Their KPIs (referral ratio, RSVPs) are typed in as readings; the shipped readings are labelled samples.
- **The demo has no login.** Anyone with the link can edit, which is intended for the review. Reset data undoes any edit. A real deployment would add Supabase Auth and per-role policies.

---
Built by Rakesh Tella.
