# RISA Growth Center

A command centre for growing **verified attendance** at an inter-college sports fest in Delhi NCR (host: IIT Delhi).
It was built for the RISA Labs Growth APM assignment, Challenge A.

**Live app:** https://risa-growth-center-omega.vercel.app

The app runs one loop on a single set of numbers: **Measure → Diagnose → Decide → Execute.**

| Tab | Job | What you can do |
|---|---|---|
| Overview | Measure | Attendees vs target, funnel, weekly pace and the four biggest leaks. Use the **As of** slider to replay the 2025 campaign week by week. Before the fest it shows a forecast; after, the actuals. |
| Channels | Diagnose | Cost per registrant, show rate and cost per attendee for each channel, with red/amber/green flags. A **budget what-if** moves rupees between channels and shows the attendee impact. |
| Bets | Decide | The five 2026 bets, each with a live KPI, its scale / change / stop thresholds and a verdict. Set the status, and log KPI readings for bets the dataset can't measure. |
| Campaigns & tasks | Execute | Campaign status and 2026 budgets, a spend log, and a task manager linked to bets and campaigns. |
| Data | Edit / reset | Edit, add or delete raw rows, or upload a CSV. Every number on every tab, and every chatbot answer, recalculates. **Reset data** restores the original 2025 dataset. |
| Copilot (side panel) | All four | A chatbot that answers from live data, does calculations and what-ifs, says when the data can't answer, and proposes tasks. A task is only created when you click **Confirm**. |

Every number carries a tag: **[D]** comes from the data, **[A]** is an assumption.

---

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

## 2. The 2026 target model (summary)

| | 2025 [D] | Base | Stretch |
|---|---|---|---|
| Verified attendees | 2,050 | **2,670** | **3,205** |
| Registrants | 2,800 | 3,117 | 3,336 |
| Budget | ₹2.74L | ₹3.00L | ₹3.00L |

How the base case is built:
1. **Reallocate the same ₹3L across channels.** Spend above the 2025 level buys registrants at **1.5× the 2025 average cost** [A], to allow for diminishing returns. Cuts scale proportionally. Each channel keeps its own 2025 show rate [D]. This gives 3,117 registrants and 2,406.5 attendees.
2. **Add the levers:**
   - show-up programme: +63 [A]
   - waitlist auto-release: +76, because 3.14% of registrants were stranded in 2025 [D]
   - walk-ins: 125 [D]
3. **Stretch adds** squad referrals (+172 [A]) and sponsor-funded evening pro-nights (+300 walk-ins [A]).

Sensitivity: with a 2.0× marginal cost the base falls to 2,450, which still beats 2,200.
The app reproduces this model exactly: the budget what-if in `src/lib/whatIf.ts` is tested against 2025 (2,800 → 2,050) and against the 2026 engine (3,117 → 2,406.5).

## 3. The five bets (Bets tab)

The score is incremental attendees × confidence ÷ person-weeks [A].

| # | Bet | KPI | Read from |
|---|---|---|---|
| 1 | Show-up programme and waitlist auto-release | QR passes downloaded ÷ confirmed | Manual reading |
| 2 | Contingent engine (college sports committees) | Cost per College Partnerships registrant (scale ≤ ₹103, stop > ₹138) | **Live data** |
| 3 | Shift paid spend to peer channels | Paid Social cost per registrant vs ₹137 ceiling | **Live data** |
| 4 | Squad referral | Referred ÷ contingent registrants (scale ≥ 0.25, stop < 0.10) | Manual reading |
| 5 | Evening pro-nights and IPL screening | Pro-night RSVPs (scale ≥ 300, stop < 150) | Manual reading |

## 4. The copilot (chatbot)

**Grounding.** The model never sees raw tables in its prompt. It calls tools, and the tools run the **same SQL functions the dashboard uses**, so the chat and the screens can't disagree. The tools are:
- `get_funnel`, `get_channel_kpis`, `get_weekly_pace`, `get_forecast`, `get_targets`
- `get_bets`, `list_tasks`, `get_data_dictionary`
- `run_sql`: ad-hoc read-only SQL
- `calculate`: a safe arithmetic evaluator, because the model may not do maths in its head
- `what_if_budget`: the target-model engine
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

1. Create a Supabase project. In the SQL editor, run `supabase/setup.sql`, which creates the schema and loads the data from this repo, then run `supabase/update_01.sql`.
2. Put your Supabase URL and publishable key in `src/lib/supabase.ts` and `api/chat.ts`, or set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` and `SUPABASE_URL` / `SUPABASE_ANON_KEY`.
3. On Vercel, import the repo with the Vite preset and set `GROQ_API_KEY` and `GEMINI_API_KEY`. Both are free from console.groq.com and aistudio.google.com.
4. To develop locally, run `npm i` and then `npm run dev`. `scripts/dev-chat.ts` serves `/api/chat` locally, and `MOCK_LLM=1` gives a scripted model for offline UI tests.

## 7. Testing

| Suite | What it checks | Result |
|---|---|---|
| `tests/test_views.sh` (21 checks) | Every audited 2025 number, the as-of behaviour (pre-event forecast mode) and the counting rules | Pass |
| `vitest` (20 tests) | Calculator, what-if engine (reproduces 2025 and 2026), and tools against a local copy of the database | Pass |
| Access rules | As anon: deletes rejected, multi-statement SQL rejected, chat_log hidden, loader and http functions blocked, reset works | Pass |
| UI end-to-end (Playwright) | A data edit flows into the Overview, the as-of slider works, reset restores, and a copilot proposal becomes a task after Confirm | Pass |
| Live copilot test bank | Facts, can't-answer, false premises, calculations, what-ifs, as-of, ad-hoc SQL, follow-ups, prompt injection, off-topic | See below |

**Live copilot test bank (production site, 27 Nov 2026).** I ran 33 questions, including multi-turn follow-ups, against the deployed app.

| Run | What happened | What changed |
|---|---|---|
| 1 | Most answers failed. One free model hit its tokens-per-minute limit within 3 questions, and the Gemini fallback failed too. | Added a chain of several models with short retries, and made the error message friendly. |
| 2 | 20 of 33 answered. The `/api/models` check showed two of the Groq models no longer exist and the two Gemini 2.5 models are closed to new users. Switching to Gemini mid-answer broke because of a tool-call signature mismatch. | Rebuilt the chain from the models these keys can actually use. On a provider switch, the data fetched so far is handed over as text. |
| 3 | **32 of 33 answered.** The one failure was a network drop during a redeploy. There were 0 rate-limit failures. Median response 15 s, 90th percentile 30 s, because the agent waits out free-tier limits. | The fixes below. |
| 4 | Changed-data test: I added a temporary ₹10,000 Paid Social spend row through the public API, then asked. The copilot answered ₹1,03,000 spend and ₹151.5 per registrant, and bet #3 flipped to **stop**, all correct. I then deleted the row. | — |

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


## 8. Limitations (honest)

- **The data is synthetic** and comes from a generic fest. Its rates are a proxy for a sports fest.
- **Attribution is not causation.** Channel costs are averages, and the 1.5× marginal-cost rule is an assumption. The sensitivity table shows its effect.
- **The weakest assumptions** are squad referrals (0.25) and evening walk-ins (+300). They are only in the stretch case, and Bets 4 and 5 test them first.
- **Free AI tiers have per-minute limits,** so answers take 5–30 s while the agent waits for capacity. Very heavy back-to-back questioning can still exhaust every model; the app then says so instead of guessing. A pay-per-use Groq key, or more models in `GROQ_MODELS` / `GEMINI_MODELS`, removes the wait.
- **Wording slips remain possible.** The model owns the wording, so it can still mislabel a correct number. That is why every answer shows its queries.
- **The demo has no login.** Anyone with the link can edit, which is intended for the review. Reset data undoes any edit. A real deployment would add Supabase Auth and per-role policies.

---
Built by Rakesh Tella.
