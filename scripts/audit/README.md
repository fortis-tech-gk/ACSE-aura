# Audit suite

Re-runnable checks from the Nov 2026 audit. Each check describes the **correct** behaviour:
`FAIL` means the bug is still there, `PASS` means it is fixed (or was already working).
Use it as a to-do list: fix, re-run, watch the FAILs turn into PASSes.

```bash
bash scripts/audit/run.sh
```

## What it does

1. Starts a **throwaway** Supabase Postgres in Docker and applies every migration in
   `supabase/migrations/` (the git-ignored credential files are skipped).
2. Loads test data (`fixture.sql`): 6 colleges, one unpaid, some athletes not accredited,
   two reserve-only entries.
3. Runs the database checks (`checks.sql`).
4. Starts PostgREST and the **real backend API** (`backend/src/server.ts`) against that
   throwaway database, with freshly generated test secrets, from a temp folder, so
   `backend/.env` is never read and production is never contacted.
5. Runs the API checks (`api_checks.sh`), then removes all containers.

Exit code is 0 only when every check passes.

**Needs:** Docker, `psql`, Node, and `backend/node_modules` installed. The Docker images are
the Supabase ones the Supabase CLI already uses. Override ports with `AUDIT_DB_PORT`,
`AUDIT_REST_PORT`, `AUDIT_PROXY_PORT`, `AUDIT_API_PORT` if 55432–55435 are busy.

## Checks

| ID | Correct behaviour |
|---|---|
| D1–D3 | The heat draw leaves out reserve-only, unaccredited and unpaid athletes |
| D4 | Teammates are separated into different heats |
| D5 | Lanes are drawn at random |
| D6 | Drawing a FINAL doesn't put every entrant into it |
| Q1 | `qualify_next_round(…, 2, 0)` gives exactly the top 2 per heat |
| P1 | A dead heat shares the place |
| P2 | A final run in 2 sections gives medals to the fastest overall |
| P3 | Editing a completed event is refused, or medals are recalculated |
| P4 | Identical field series share the place |
| P5–P6 | Field and high-jump countback |
| P7–P8 | Impossible marks and times are rejected |
| P9 | Points are 5-3-1 (official rules) |
| L1 | A corrected result is logged with its old and new value |
| S1–S4 | Accreditation, call room, meals and hostel refuse unpaid or unaccredited athletes |
| S5–S7 | Offline replays count once, duplicates are flagged, hostel gender is enforced |
| C1–C2 | Call room reserve substitution: same college only, logged, not after the call room closes |
| R1 | Row-level security is ON for every table |
| B1–B7 | Database backstops for rules the website already enforces (B1 follows the 07-11 reserve amendment; B3 is website-only by design) |
| A1 | A referee can't write results outside their assigned events |
| A2 | The API rejects impossible times |
| A3–A4 | `finalize` can't award medals from a heat or under the wrong event |
| A5 | A deactivated official is locked out immediately |
| A6 | PIN login requires a role |
| A7 | Forged, `alg=none` and missing tokens are rejected |
| A8 | Athlete login locks after 8 wrong dates of birth |
| A9 | A burst of bad PIN logins doesn't stall the API |

Not covered: the website's server actions (fee maths, registration rules, relay lineups),
the mobile app screens, and production-scale load (use `backend/loadtest/` with k6 for that).
