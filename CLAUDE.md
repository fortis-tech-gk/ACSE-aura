# VTU SportsOS — Web Registration System (CLAUDE.md)

## System Overview
VTU SportsOS is the official athletic meet management system for the **28th VTU Inter-Collegiate State Level Athletic Meet 2026 (Dr. ACS-AURA 2026)** hosted by Dr. ACS College of Engineering, Bengaluru under Visvesvaraya Technological University (VTU), Belagavi.

**Scope of Task**: Focus **EXCLUSIVELY** on the **Web Registration Part** under `frontend/web/`. Do not touch `backend/`, `frontend/mobile/`, or unrelated admin subpages unless directly required by the squad registration flow.

---

## Tech Stack & Architecture
- **Framework**: Next.js 16.3.1 (App Router, Turbopack, Server Actions enabled)
- **UI Library**: React 19, Vanilla CSS (`dashboard.css`, `home.css`, `globals.css`)
- **Backend / Database**: Supabase (PostgreSQL, Row Level Security, Storage Buckets)
- **Auth**: Passphrase-based squad authentication (`squad_code` + `passphrase` hashed via bcrypt or stored in session cookie `squad_session`)
- **Storage**: Supabase Storage Buckets (`athlete-photos` for passport photos, `payment-proofs` for transaction receipts)

---

## Registration Flow Architecture & File Map

```
frontend/web/
├── src/
│   ├── app/
│   │   ├── actions/
│   │   │   ├── auth.ts              # Squad & admin authentication actions
│   │   │   ├── athletes.ts          # Add/delete athlete, quota validations, photo upload
│   │   │   └── payment.ts           # calculateSquadFees, submitPaymentAction, invoice
│   │   ├── login/
│   │   │   └── squad/page.tsx       # College PED passphrase login portal
│   │   ├── squad/
│   │   │   ├── layout.tsx           # Squad layout wrapper with session check
│   │   │   ├── SquadNav.tsx         # Navigation bar for contingent portal
│   │   │   ├── dashboard/page.tsx   # Contingent overview, quotas, roster summary, advisory
│   │   │   ├── athletes/
│   │   │   │   ├── page.tsx         # Server component fetching squad athletes & events
│   │   │   │   └── AthletesManager.tsx # Client modal: Bio-data, photos, event selection
│   │   │   ├── payment/
│   │   │   │   ├── page.tsx         # Server component fetching fee breakdown
│   │   │   │   └── PaymentClient.tsx# UPI QR, UTR submission, payment receipt modal
│   │   │   └── cards/
│   │   │       └── page.tsx         # Printable 6x4 inch athlete accreditation ID cards
│   │   └── components/
│   │       └── invoice/
│   │           ├── FeeInvoiceModal.tsx         # Official college fee invoice & receipt
│   │           └── RegistrationReportModal.tsx # Printable official entry roster form
│   └── lib/
│       ├── auth-guard.ts            # requireSquad() session verification
│       ├── supabase.ts              # supabaseAdmin client (service_role key)
│       └── championship-events.ts   # Event codes & official naming map
```

---

## VTU Official Registration Rules & Business Logic

### 1. Athlete Identification & Eligibility
- **Fields Required**: Full Name (SSLC/10th Certificate match), USN (University Seat Number), Semester (1–10), Blood Group, College Joining Date, Present Year Start Date (`sem_start_date`), Date of Birth, 10-digit student phone, 12-digit Aadhaar Number.
- **Validations**:
  - Aadhaar: Exactly 12 digits, globally unique across entire championship (`profiles.aadhaar_number`).
  - USN: free-form text (no format check, so 1st-years can use a temporary USN), trimmed + uppercased, globally unique across championship (`profiles.usn`).
  - Dates: `college_joining_date <= today`, `sem_start_date >= college_joining_date`.
  - Photo: Mandatory passport-size photo (JPG, PNG, WebP ≤ 5MB) uploaded to Supabase bucket `athlete-photos`.

### 2. Event Quotas & Combinations (VTU Athletic Code)
- **Individual Events**:
  - Maximum **2 individual events** per athlete (`event1Id` and `event2Id`).
  - Event 1 is mandatory unless athlete is registered **only** for a standalone Relay or Half Marathon.
  - Event 1 and Event 2 must be different.
  - **Reserve Event**: Maximum 1 reserve event (`reserveEventId`).
    - **Rule (amended 07-11-2026)**: 1 reserve event is allowed **even when the athlete has both Event 1 and Event 2** (see `docs/rules/vtu_rules.txt` → AMENDMENTS). Do not re-add the old "no reserve with two events" block.
    - **Rule 36**: A reserve event can **only** be nominated if the athlete is registered for at least one individual regular event.
    - Reserve event must be distinct from Event 1 and Event 2.
- **Squad Quota (College-wide limit per event)**:
  - Maximum **2 athletes** from the same college squad in any single regular individual discipline.
- **Relay Events**:
  - **Rule 3 & 24**: Mutual exclusivity between divisional relays — an athlete can participate in **at most one** divisional relay (either `4x100m` OR `4x400m`, never both).
  - **No relay team building (removed 16-11-2026)**: PEDs only tick on the athlete form whether an athlete runs a relay (4x100m / 4x400m / Mixed). There is no Relay Teams page, no leg/reserve assignment, and incomplete relays never block payment. Do not re-add a lineup step or a relay-readiness gate.
  - **Meet-time changes by the PED (athletes app, 26-11-2026)**: after registration, a college PED logs in to the AURA Athletes app (college code + the Men's OR Women's passphrase, one login for both squads) and can (a) swap a reserve into an individual event in place of a college athlete — a reserve who already has 2 individual events must give one up — and (b) pick the 4 running members / legs of each relay. Both close at **22:00 IST the day before the event** (`ped_swap_reserve` / `ped_set_relay_runners`, migration 0053; API `backend/src/routes/ped.routes.ts`). This is not part of web registration; the no-lineup rule above still applies to the website.
  - **Cap**: max 6 athletes nominated per divisional relay per squad; Mixed Relay max 3 per squad and 6 per college (website and DB trigger, migration 0056).
- **Editing events (26-11-2026)**: Edit → "Edit Events" lets a PED change an athlete's events (`updateAthleteEventsAction`, same rules as registration, quotas count the other athletes). Allowed only while the roster is editable AND the college has **no SUBMITTED or VERIFIED payment** on either squad; once the college has paid even once, events are frozen (a REJECTED payment does not count). Bio-data edits stay allowed.
  - **Rule 27 (4x400m Mixed Relay)**: Unrestricted across individual events; the W-M-W-M running order is settled on the day, not in registration.
- **Half Marathon (21km)**:
  - Code `HM-M` (Men) or `HM-W` (Women).
  - Can be registered standalone.

### 3. Fee Computation Matrix
Fees are calculated dynamically via `calculateSquadFees()` in `frontend/web/src/app/actions/payment.ts`:
- **Regular Individual Event**: ₹100 per entry
- **Reserve Event**: **₹0 (Free)**
- **Half Marathon**: ₹100 per entry
- **Relay Team**: **₹100 for each of the first 4 members**, members 5 & 6 free → ₹100 × min(members, 4), max ₹400 per team. Members = athletes nominated to that relay on the athlete form.
- **Mixed Relay (4x400m Mixed)**: the team is shared by the college, but each squad pays only for its **own** members: ₹100 × min(own members, 2), so ₹200 max per squad and ₹400 per college.
- **Total Amount Formula**:
  $$\text{Total Amount} = (\text{Regular Count} \times 100) + (\text{HM Count} \times 100) + (\sum_{\text{teams}} 100 \times \min(\text{members}, 4))$$
- **Balance Due**: $\max(0, \text{Total Amount} - \text{Total Verified Payments})$
- **ONE PAYMENT PER COLLEGE (16-11-2026)**: the Men's and Women's squads of a college share one fee account. Total Amount, verified payments and Balance Due are summed over **both** squads (`calculateCollegeFees()` / `getCollegeSquadIds()` in `src/lib/payments.ts`). Either PED pays the college balance; **repeat payments are allowed** (a pending receipt does not block another, `63dc82e`) and **paying never locks the roster** (migration 0047). Verification (`reviewPayment`) and every roster change (`syncCollegePaymentStatus()`) set the same `payment_status` on both squads from the CURRENT fee, so adding an entry after verification turns a VERIFIED college back to SUBMITTED (balance due). The Payments desk verifies by **payment id** (the receipt it shows). Fees are still computed per squad first, then added up.

### 4. Payment Submission & Roster Lock Lifecycle
- **UPI Offline Payment**: PED transfers fee to host UPI ID (`host_upi_id` from `meet_settings`) and submits:
  - 8–30 alphanumeric UTR/Bank Reference Number (unique constraint).
  - Amount paid.
  - Transaction screenshot/receipt (JPG, PNG, PDF ≤ 5MB) uploaded to bucket `payment-proofs`.
- **Roster editing (current rules)**:
  1. **Registration open**: PEDs add / edit / delete athletes freely; paying does not lock anything. Edit **Events** is frozen once the college has a SUBMITTED or VERIFIED payment (REJECTED does not count); bio-data edits stay allowed.
  2. **Registration closed** (`meet_settings.registration_open = false`, all squads `roster_locked`): only a squad the admin unlocks on `/admin/colleges` (`toggleSquadRosterLockAction` → `late_entry_open`) can edit (late entries). Re-locking recomputes the payment status of **both** squads.
  3. **Verification**: `VERIFIED` once verified payments (bank `amount_received`) cover the current college fee; otherwise `SUBMITTED` (balance due) or `REJECTED`. Bib numbers (`close_registration_and_generate_bids`) and check-in auto-accreditation need `VERIFIED`.
- **Enforcement**: every roster mutation goes through `rosterEditBlockReason()` (`src/lib/roster-window.ts`): registration open, or the squad's late-entry window. Quotas are enforced in the server action AND by DB triggers.
- **Migrations**: applied by hand with psql (staging first). Never re-run an old file. Production's Supabase GitHub integration once replayed 0001–0022 (26 Nov); its history table `supabase_migrations.schema_migrations` is now kept complete — after applying a migration by hand on production, insert its row there too.

---

## Known Pitfalls & Watch-outs

1. **`DrAFT` vs `DRAFT` Typo**:
   - An earlier bulk replace of `DR` to `Dr` changed `DRAFT` to `DrAFT` in several files and DB migration check constraints:
     `payment_status IN ('DrAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED')`.
   - Always ensure code checking `payment_status` accounts for both or matches the exact string used in `payment.ts` and `squads` table.
2. **`package-lock.json` Integrity**:
   - Never do case-insensitive global search-and-replace across `package-lock.json` because base64 SHA-512 hashes will corrupt and break Vercel deployments (`EINTEGRITY`).
3. **Server Actions in Next.js 16**:
   - Always start action files with `'use server';`.
   - Avoid passing non-serializable objects (e.g. raw functions, unhandled File buffers across client-server boundaries). Use `FormData` for multipart uploads.
4. **Supabase returns at most 1,000 rows per request**:
   - Any whole-table read (all athletes, all payments) silently stops at row 1,000. Use `fetchAllRows()` from `src/lib/db-fetch-all.ts` (pages through the query) for those; per-squad reads are far below the cap.
5. **Foreign Key Cascade on Delete**:
   - When deleting an athlete, registrations, relay memberships, and heat assignments must be deleted first or cascading to prevent FK constraint failures.

---

## Common Commands
```bash
# Run web development server
npm --prefix frontend/web run dev

# Full Next.js production build check
npm --prefix frontend/web run build

# Linting
npm --prefix frontend/web run lint
```
