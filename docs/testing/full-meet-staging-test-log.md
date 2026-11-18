# Full-meet rehearsal on STAGING — test log

Started 2026-11-17. Staging only (API `aura-api-staging`, staging Supabase). Everything is fictional data.
Scripts: `scripts/staging/load_full_meet.py`, `meet_driver.py`, `phase_a_gate_services.py`, `phase_b_schedule.py`, `run_meet.py`.

Legend: ✅ passed · ⚠️ works but needs a decision/fix · ❌ broken

## How it was run (read this first)
- **Added on top of the existing demo data** (no wipe): existing demo logins, PINs and the App Store reviewer login still work.
- Registration was loaded with a script straight into the database, **not through the web portal**. The database triggers (quotas, relay, reserve rules) still ran. The portal forms and photo upload were not exercised at this scale.
- Officials' actions use the **real backend API** (PIN logins, call-room open/scan/advance, referee finalize). Because of the rate limit in finding F-1, bulk per-athlete data entry (call-room check-ins on most heats, times, field attempts) goes through the same database functions the API calls. The first heat of every event uses the real scanner API for every athlete.

---

## Step 1 — Load ~1,100 athletes
Result: ✅ 1,124 athletes in 41 colleges (31 added). 2,988 + 104 event entries, **0 rejected** by the database rules (2 per college per event, 1 divisional relay per athlete, reserves, Mixed relay, half marathon).
Entries per event (regular): 100m 82/80, 200m 80, 400m 70/70, 800m 80, 1500m 70, 5000m 60, 10000m 30, hurdles 60–70, LJ/TJ 70–82, HJ 70, PV 30, SP 72–80, DT 70, JT 70, HT 30, 20km walk 30, Half Marathon 16. Relays: 4x100 242/240 nominations, 4x400 180 each, Mixed 180.
Bibs: ✅ all 1,124 numbered. The 928 late entries were numbered without touching existing bibs (append-only works). Men 100–663, women 2001–2560.
Not tested: Decathlon / Heptathlon (excluded as asked).

## Step 2 — Accreditation, hostels, meals
- ✅ Accreditation: scanned by bib through the API (600) and the database function (rest). 1,080 accredited, 44 left as no-shows on purpose (they are correctly left out of the heat draws: "not_accredited" count shown in the draw).
- ✅ Hostels: 4 more hostels added (8 in total). Every squad allocated, no hostel over capacity (max 173/200). Check-in through the warden API (600) and function: 1,007 checked in.
- ✅ Meals: breakfast + lunch logged for 927 athletes.
- ⚠️ **F-1 (high) — API rate limit is per staff account, not per device.** `server.ts` limits each logged-in user to 600 requests per 15 minutes, keyed on `role + staff id`. Every phone that logs in with the same duty PIN is the same staff account, so **all food counters share one 600-request budget** (≈40 scans a minute for the whole venue), and the same for all wardens, call-room tablets and referees. The test hit `429 Too many requests` after exactly 600 calls per role. A busy lunch with several counters, plus app refreshes, can lock every counter out for up to 15 minutes. **Fixed 2026-11-17** in `backend/src/server.ts`: the limit is now keyed per login token (one 600-request budget per device). Deployed to staging (revision `aura-api-staging-00005`) and re-tested: device A used its 600 and got 429; device B on the same PIN still got 200 for all 100 further calls. **Not yet deployed to production.**
- ⚠️ Registered duplicate-scan and "already claimed" paths were blocked by that limit during the run; re-check after F-1 is fixed (the demo guide step 7 covers it).

## Step 3 — Schedule and heat draws
- ✅ The official Order of Events (Days 1–4) was loaded: 75 scheduled items, with heats, semi-finals and finals as in the PDF.
- ✅ Heat draws through the admin API (`/schedule/draw`) for every event: 800m 10 heats, 100m Men 11 heats, 200m 10 heats, 400m 8–9, hurdles 7–9, relays 4–5, field events one flight. Not-accredited athletes are excluded and counted.
- ✅ Re-drawing an event that has not started replaces its heats (done for the demo 100m Men, Long Jump Men, High Jump Women).
- ⚠️ **F-2 — distance heats are single heats of 60–70 runners.** 1500m heats = 1 heat of 70 (men) / 64 (women); 5000m final = 60 in one heat. Check with the track officials that this is how it will be run.
- ⚠️ **F-3 — the 800m final has 23 runners.** 10 heats, top 2 from each plus ties go through, and the Order of Events has no semi-final, so the final is 23 runners on an 8-lane track. Decide if 800m needs a semi-final round or a pack start.
- ℹ️ The demo events 100m Women, Shot Put Women and 4x100m Relay Women already have completed demo results (10 demo athletes). The new athletes entered in them were **not drawn**, to keep the demo state. To test those three at full scale they would need their demo heats and points wiped.

## Step 4 — Running every event (call room → referee → next round → points)
How: for each heat the call room official opens the call room (API), athletes are checked in (first heat of each event through the real scanner API by bib, the rest through the same database function), ~5% never report (→ DNS when the call room closes), the call room is closed (API), the referee enters results (times with DQ false-starts, DNF and ties; field attempts with fouls; high jump / pole vault bar heights), then the referee finalizes (API) and the system builds the next round and awards points.

Result: ✅ **All 42 events ran to a completed final with exactly 3 placers and points awarded** (2 for 1500m Men, see F-4). Totals: 199 heats, 2,577 heat entries, 1,519 finished times + 48 DQ + 42 DNF, 2,271 throw/jump attempts, 1,944 high-jump/pole-vault attempts.
- ✅ Rounds build themselves exactly as the Order of Events says: 100m Men 11 heats → 3 semi-finals → final; 200m 10 → 4 → final; 400m 9 → 3 → final; 100H/110H 9 → 3 → final; 4x100 / 4x400 / Mixed 4–5 heats → 2 semi-finals → final; 800m, 400H, 1500m heats → final; distance / walk / road / field events are direct finals.
- ✅ Heat ties at 2nd place send both runners through (rule), ties show shared places.
- ✅ Mixed 4x400m earns **0** championship points; medals are recorded.
- ✅ Not-accredited athletes (44 no-shows) are never drawn; call-room no-shows become DNS and cannot get a result.
- ✅ A heat that is stuck mid-way can be resumed; a finished event cannot be redrawn ("1 heat(s) are already under way or finished").
- ⚠️ **F-4 (high) — 1500m "heats" with one heat of 70 runners.** The rule "top 2 of each heat go through" gives a **final of only 2 runners (men) / 3 (women)**. A single 70-runner distance heat needs another rule (split into sections, or run it as a straight final like the 5000m). Needs an organiser decision.
- ⚠️ **F-3 (repeat) — final sizes above 8 lanes** because top-2-per-heat with many heats: 800m 23 / 21, 400H 19 (men) / 16 (women), 200m Men 10 (ties). The Order of Events has no semi-final for these. Decide: add a semi-final round for 400H and 800m, or accept big finals.
- ⚠️ **F-8 (info) — field events run as one flight of 60–80 athletes** (Javelin 68, Discus 71, Long Jump 81, High Jump 70). The referee app shows them as one list. Check this is workable on the tablet and with the field official.

### F-3 fix (added after the run)
Decision: if more than 8 athletes qualify for a lane-race final, run a semi-final first. Done in `backend/src/utils/progression.ts` (heats → auto semi-final, best 2 of each semi → final), deployed to staging and re-run: **800m Men 10 heats → 3 semis (7/7/8) → final of 7; 800m Women → 3 semis → final of 9 (a tie at the cut-off); 400m Hurdles Men → 3 semis → final of 7; Women → final of 9 earlier size 16 now via 3 semis.** Remaining finals above 8 are caused only by the rule "a tie for the last qualifying place sends everyone through" (200m Men 10, 200m Women 9, 800m Women 9): lane 9+ has no lane. Decide how to handle: extra lane / run a tie-break / draw lots. Not deployed to production.

### F-4 and the 8-lane cap (decided, built, re-run)
Decisions: the 1500m is split into **heats of 8**, and **a final never has more than 8 runners** (a tie at the cut-off is settled by a draw of lots).
- `0044_1500m_heats_of_8.sql` — the heat draw now splits a mass-start event drawn as HEATS into heats of 8 (5000m / 10000m stay straight finals). Applied to staging.
- `progression.ts` — the 1500m now follows heats → semi-finals → final, and `capFinalists()` trims any final to 8 (fastest 8; equal times by lots).
- Re-run on staging: **1500m Men 9 heats → 3 semis → final of 7; 1500m Women 8 heats → 3 semis → final of 8; 200m Men / Women, 800m Women finals now 8.** No lane-race final is above 8. Each event still has exactly 3 placers.
- Not in production yet.

## Step 5 — Call-room special cases (28 checks; 24 passed first time, 4 turned out to be test-script mistakes, 1 real bug fixed)
| Check | Result |
|---|---|
| Scan before the call room is opened | ✅ refused ("Open the call room first") |
| Referee tries to open the call room / call room tries to jump a heat to ON_TRACK | ✅ refused (403) |
| Scan an athlete who is not in the heat | ✅ 404 with hint about their real heat |
| Unknown bib, fake / home-made QR | ✅ 404 / 400 |
| Scan the same athlete twice | ✅ "already reported", no duplicate |
| Scratch an athlete, then scan them | ✅ refused ("marked scratched earlier") |
| Hammer-throw athlete with 14 mm spikes / no bib | ✅ refused (limit 9 mm) |
| Scan after the call room is closed | ✅ refused, "athletes who did not report are DNS" |
| Offline tablet sends an earlier scan late (`actedAt` before close) | ✅ accepted |
| Reserve substitution (absent athlete → their college's reserve) | ✅ entry moves to the reserve, replaced athlete is "not in this heat", reserve can check in |
| Relay: swap a runner with a reserve on a full 4 + 2 team | ❌ **F-5 (high) — failed:** "A relay team cannot have more than 2 reserve runners" |
| Relay: use a non-reserve teammate as substitute | ✅ refused |
| Relay team checks in with one runner's scan | ✅ |
| Result for a scratched athlete / after the heat is finalized | ✅ refused ("already finalized, ask the meet office") |
| Finalize a heat with no results at all | ⚠️ **F-6 (medium)** — accepted: the heat becomes COMPLETED with nobody ranked and no points; it is then locked. A mis-tap by the referee can finish an empty heat. Suggest: refuse unless at least one result (or all DNS) exists. |
| Negative / impossible distance (-5 m, 400 m hammer) | ➖ not proven (the heat was already finalized by the F-6 case; re-test needed) |

**F-5 fixed:** `supabase/migrations/0043_relay_swap_full_team.sql`, applied to **staging only**. The swap turned the outgoing runner into a reserve first, which the "max 2 reserves" check rejected for a team that already had 2. Re-tested on a real 4 + 2 team: swap in, swap back, both 200. **Needs applying to production before the meet.**

## Step 6 — Standings and points rules
- ✅ **College points 10-6-2 for any event; athlete points 5-3-1 (individual only)** — migration `0042_college_points_10_6_2.sql`, applied to staging earlier today. I recomputed Overall, Men's and Women's tables independently from the 126 points rows: **all three match the API exactly** and are sorted by total points (medals only break ties). Overall top: BELL 58, BIDA 56, KITT 44, VIJA 34, ARCE 32.
- ✅ Men's / Women's tables exclude relays and Mixed; Overall includes relays and excludes Mixed.
- ✅ Best Male / Best Female Athlete tables use 5-3-1 (max 5 here because each athlete won once; many ties on 5 are broken by name — check this tie-break is acceptable for the real awards).
- ℹ️ The Athletes app standings screen still says "Overall includes individual and relay points". Needs a wording update (next app build).

## Step 7 — Scanners and athlete app
- ✅ Food counter: granted, "ALREADY CLAIMED" on a second scan of the same meal, invalid meal type refused, not-accredited athlete refused ("send them to accreditation").
- ✅ Hostel warden: check-in and repeat check-in; stats 1,007 / 1,124 checked in.
- ✅ Wrong role is refused (warden token on the food scanner, food token on the referee finalize: 403).
- ✅ Real signed QR codes (taken from the athlete login) accepted by the food, warden and accreditation scanners.
- ✅ Accreditation: resending the same scan is safe (offline retry).
- ✅ Athlete app API: login with bib + date of birth (wrong date refused), `/me`, `/performance` (medal + points for a gold medallist).
- ✅ Public standings API 0.35 s, 53 KB.
- ⚠️ **F-7 (medium) — the public `/results` page grows to 1.47 MB** with a full meet in it (every heat of every event on one page, refreshed every 15 s). Fine on Wi-Fi, heavy on mobile data for hundreds of spectators. Suggest: show only the current day / selected event, or paginate.

## Not tested in this run (be honest)
- The officials and athletes **apps on a phone/emulator** (camera scanning, offline airplane-mode sync, push notifications). Everything above exercised the same API the apps call. The browser views of both apps were opened and the Athletes login/pass/standings were checked earlier today.
- The **web registration portal** (forms, photo upload, payment screen), finance-desk verification and the admin pages — registration and payments were loaded by script.
- Decathlon / Heptathlon; photo-finish import (later work).
- Real-time load: 1,000+ people using the apps at once (use `backend/loadtest/`).
- The 100m Women, Shot Put Women and 4x100m Women demo events with the new athletes (kept as demo data).

## Changes made during the rehearsal
1. `0042_college_points_10_6_2.sql` — college points 10-6-2, athlete 5-3-1 (staging applied; **production not applied**).
2. `0043_relay_swap_full_team.sql` — relay swap fix (staging applied; **production not applied**).
3. Website Norm 05 text and `docs/rules/vtu_rules.txt` amendment (17-11-2026).
4. `backend/src/routes/leaderboard.routes.ts` — college detail route totals use 10-6-2.
5. Test scripts in `scripts/staging/`. **Nothing is committed yet.**

## Open decisions / fixes (priority order)
1. **F-1** per-device rate limit — fixed and on staging; deploy to production before the meet.
2. **F-4** 1500m heats of 8 — done on staging (0044); apply to production.
3. **F-5** relay swap — apply 0043 to production.
4. Apply 0042 to production.
5. **F-6** finalize with no results.
6. **F-3** big finals — semi-final rule added and on staging; deploy to production; decide how to handle ties at the cut-off.
7. **F-7** `/results` page size; **F-8** field flights of 70.
