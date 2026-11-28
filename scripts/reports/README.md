# College reports

Printable A4-landscape reports for the PED follow-up desk. Output goes to `docs/reports/`
and is **gitignored** — the tables carry personal phone numbers and e-mail addresses, and
this repository is public.

## College registration status (two tables)

```bash
node scripts/reports/college-registration-status.mjs
```

Reads the production database (`PROD_DB` in `.env.prod-db`, or `DB_URL=...` in the
environment), writes `docs/reports/college-registration-status.html` and prints it to
`college-registration-status.pdf` with headless Chrome.

* **Table 1 — Colleges registered**: Sl. no., college, PED contacts, principal contacts,
  total amount, amount paid, balance to be paid. One fee account per college (Men's and
  Women's squads added up), grouped by VTU division with per-division and grand totals.
  Fees mirror `frontend/web/src/lib/payments.ts`; amount paid counts only the
  bank-confirmed `amount_received` of VERIFIED payments.
* **Table 2 — Colleges not yet registered**: the contact list, with a "Remarks / Called"
  column to tick off while calling.

A balance against a college whose squads read VERIFIED means entries were added after the
payment was verified — those colleges owe the difference.

The same run also writes the not-registered table on its own, as
`docs/reports/colleges-not-registered.html` / `.pdf` (the calling desk's contact list).

## Admin dashboard download

The Meet Admin dashboard has a **College Registration Lists** card with two Excel downloads
(`/api/admin/college-list?list=registered|not-registered`, built by
`frontend/web/src/lib/college-registration-report.ts` from the live database). Same split and
fee figures as this report, but contacts come from the database only: the 2025-26 contact
overlay below lives outside the repository, so the printed list has more PED / principal
contacts for colleges that never registered.

## Contact overlay

Colleges that never registered mostly have no contacts in the database; theirs were matched
by name from the 2025-26 VTU sheets when `colleges-not-registered.html` was built. To reuse
those matches:

```bash
node scripts/reports/extract-contacts-overlay.mjs
```

It writes `docs/reports/contacts-overlay.json` (college code → PED / principal cell), which
the report picks up automatically when a college has no contacts in the database. Without
it the report still runs, with fewer contacts in Table 2.
