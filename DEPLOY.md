# Deploying AURA 2026 (VTU SportsOS)

One page for shipping every part of the system to **staging** and **production**.
No secrets live in this file: keys and passwords stay in the `.env` files, Secret Manager,
Vercel and Expo.

## The 4 modules at a glance

| Module | Code | Staging | Production | How it ships |
|---|---|---|---|---|
| **1. Database** | `supabase/migrations/` | Supabase project `zivnurzq…` | Supabase project `mrqkwhrm…` | Run each new migration file by hand, in number order |
| **2. API** (for the apps) | `backend/` | Cloud Run `aura-api-staging` → https://aura-api-staging-wgebilkjsa-el.a.run.app | Cloud Run `aura-api` → https://aura-api-1080803822966.asia-south1.run.app | `backend/deploy-cloudrun.sh` (by hand) |
| **3. Website** | `frontend/web/` | https://vtu-athletics.vercel.app | https://acse-aura.vercel.app | `git push`: `origin` → staging (GitHub Action), `fortis` → production (Vercel) |
| **4. Mobile apps** (Athletes, Officials) | `frontend/mobile/` | `athletes-demo`, `officials-demo` APKs; `athletes-store-staging` (App Store review) | `athletes-production`, `officials-production` (stores); `*-preview` APKs | `eas build` (by hand) |

Git remotes:

| Remote | Repository | Deploys |
|---|---|---|
| `origin` | `ganeshak11/vtu-athletics` | Staging website (GitHub Action `deploy-staging.yml`) |
| `fortis` | `fortis-tech-gk/ACSE-aura` | Production website (Vercel Git integration on that repo) |

## Order of a release

Always ship in this order. Each step only adds things the next step may use, so a
half-finished release never breaks what is live.

1. **Checks:** audit suite, type-checks, lint, website build (below).
2. **Database:** new migrations.
3. **API:** Cloud Run.
4. **Website:** push.
5. **Apps:** build, only when `frontend/mobile/` changed.

Do it on **staging first**, try it there, then repeat on production.

---

## 0. Checks before any deploy

```bash
bash scripts/audit/run.sh
```

Must end with `TOTAL: 0 failing check(s)`. It needs Docker and runs on a throwaway local database, never staging or production.

```bash
(cd backend && npx tsc --noEmit -p .) && (cd frontend/mobile && npx tsc --noEmit -p .) && (cd frontend/web && npx tsc --noEmit -p .)
```

```bash
npm --prefix frontend/web run lint
```

```bash
npm --prefix frontend/web run build
```

Lint must show `0 errors` (warnings are fine).

---

## 1. Database (Supabase migrations)

There is no migration runner: each file in `supabase/migrations/` is run once, in number
order. Most are written to be safe to re-run, but don't count on it — keep the ledger at the
bottom of this file up to date.

Skip the `college_credentials_*.sql` files in that folder; they are git-ignored one-off data loads.

### Staging

The connection string is `SUPABASE_DB_URL` in `frontend/web/.env.stag`.

```bash
STAG_DB=$(grep '^SUPABASE_DB_URL' frontend/web/.env.stag | cut -d= -f2- | tr -d '"')
```

```bash
psql "$STAG_DB" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0040_example.sql
```

`-1` runs the whole file in one transaction: if anything fails, nothing is applied.

**Reset staging with fresh demo data.** This wipes staging. Don't do it while Apple is reviewing the app, because it changes every login. It writes the new logins to `docs/staging-demo.stag.md`.

```bash
python3 scripts/staging/seed_demo.py --yes-reset-staging
```

### Production

Either paste the file into **Supabase dashboard → SQL Editor** (production project) and Run,
or use psql with the production connection string (Supabase dashboard → Connect):

```bash
psql "$PROD_DB" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0040_example.sql
```

**Before production:** the same file must already have run cleanly on staging, and the
audit suite must pass with it.

**Rollback:** there are no down-migrations. Fix forward with a new migration.

---

## 2. API (Cloud Run, Mumbai)

Needs `gcloud` signed in as the project owner account (`gcloud auth login`), project
`aura-2026-514120`. The script builds from `backend/`, deploys, and prints a health check.

### Staging

```bash
cd backend && AURA_ENV=staging ./deploy-cloudrun.sh aura-2026-514120
```

### Production

```bash
cd backend && ./deploy-cloudrun.sh aura-2026-514120
```

**Sizing (26 Nov, budget up to ₹30,000):** CPU is always on (`--no-cpu-throttling`) so
send-and-forget pushes always finish. Normal: production keeps 1 warm instance (max 20, 512 MiB);
staging scales to zero. ~₹150/day for production.

**Meet days — morning of 6 Dec (PED swaps start) through 10 Dec**, sized for ~4000 athletes:
6 warm instances, up to 60, 1 GiB each. Resize the running service (about a minute, no rebuild):

```bash
cd backend && ./deploy-cloudrun.sh aura-2026-514120 --resize-meet
```

A code deploy during the meet must keep the meet sizing: `./deploy-cloudrun.sh aura-2026-514120 --meet`.

**After the meet**: `./deploy-cloudrun.sh aura-2026-514120 --resize-normal`.

**Database for the meet:** the production Supabase project runs the smallest compute (60
connections, 224 MB cache). Before 6 Dec, raise it in Supabase → Project Settings → Compute and
Disk (Medium or larger) and lower it again after 10 Dec.

**First time only** (stores JWT / QR / Supabase secrets in Secret Manager, typed in the terminal):

```bash
cd backend && ./deploy-cloudrun.sh aura-2026-514120 --init-secrets
```

For staging, put `AURA_ENV=staging` in front.

**Check it:** the script prints `Health: {"status":"healthy","database":"connected",…}`. Also:

```bash
curl -s https://aura-api-1080803822966.asia-south1.run.app/health
```

**Rollback:** send traffic back to the previous revision.

```bash
gcloud run revisions list --service aura-api --region asia-south1 --project aura-2026-514120
```

```bash
gcloud run services update-traffic aura-api --region asia-south1 --project aura-2026-514120 --to-revisions=REVISION_NAME=100
```

For staging the service is `aura-api-staging`.

### PED alerts tick (Cloud Scheduler)

Cloud Run scales to zero, so the PED call room alerts (30 / 20 / 10 min, DNS, results) are driven by the
Cloud Scheduler job **`ped-alerts-tick`** (asia-south1, every minute, Asia/Kolkata). It POSTs to
`/api/internal/ped-alerts/tick` with the header `X-Cron-Secret`, which must equal the `PED_CRON_SECRET`
secret (staging: `PED_CRON_SECRET_STAGING`). The deploy script passes the secret to the service.

```bash
gcloud scheduler jobs describe ped-alerts-tick --location asia-south1 --project aura-2026-514120
```

If you change the secret, add a new version and update the job's header too, or every tick gets 403:

```bash
gcloud secrets versions add PED_CRON_SECRET --project aura-2026-514120 --data-file=-
```

```bash
gcloud scheduler jobs update http ped-alerts-tick --location asia-south1 --project aura-2026-514120 --update-headers "X-Cron-Secret=$(gcloud secrets versions access latest --secret PED_CRON_SECRET --project aura-2026-514120)"
```

There is no staging job (the staging API only runs its in-process timer while an instance is up).

---

## 3. Website (Vercel)

Vercel environment variables (both projects) must include `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and **`SUPABASE_SERVICE_ROLE_KEY`**. Since row-level security is
on (migration 0036), the site shows no data without the service-role key.

### Staging

Push to `origin`. The GitHub Action `deploy-staging.yml` builds and deploys to Vercel. It only runs when `frontend/web/**` changed.

```bash
git push origin main
```

To redeploy without a new commit:

```bash
gh workflow run deploy-staging.yml --repo ganeshak11/vtu-athletics
```

### Production

Push the same `main` to the production repository. Vercel deploys it automatically. Confirm that once in the Vercel dashboard: project connected to `fortis-tech-gk/ACSE-aura`, production branch `main`.

```bash
git push fortis main
```

**Check it:** open https://acse-aura.vercel.app/results — the championship tables must list the colleges.

**Rollback:** Vercel dashboard → Deployments → previous deployment → **Promote to Production**.

---

## 4. Mobile apps (Expo EAS)

Run from `frontend/mobile/`. Always put **`EAS_NO_VCS=1`** in front, so files git doesn't track (e.g. `docs/` with phone numbers) are never uploaded. Expo account: `ganesh_a_k_11` (`npx eas-cli whoami`).

Which API each build talks to is fixed **at build time** by its profile (`eas.json`):

| Profile | App | API | Output | Use |
|---|---|---|---|---|
| `officials-demo` | Officials | staging | APK | Rehearsal tablets |
| `athletes-demo` | Athletes | staging | APK | Rehearsal phones |
| `athletes-store-staging` | Athletes | staging | store build | App Store review (staging logins) |
| `officials-preview` | Officials | production | APK | Meet-day tablets (sideloaded) |
| `athletes-preview` | Athletes | production | APK | Testing against production |
| `officials-production` | Officials | production | AAB (Play) | Play Store |
| `athletes-production` | Athletes | production | AAB / IPA | Play Store / App Store |

### Staging (rehearsal)

```bash
cd frontend/mobile && EAS_NO_VCS=1 npx eas-cli build -p android --profile officials-demo --non-interactive --no-wait
```

```bash
cd frontend/mobile && EAS_NO_VCS=1 npx eas-cli build -p android --profile athletes-demo --non-interactive --no-wait
```

The APK link appears on the build page (expo.dev → project → Builds), or:

```bash
cd frontend/mobile && npx eas-cli build:list --limit 3
```

### Production

The officials app is Android-only, installed on the meet's own tablets:

```bash
cd frontend/mobile && EAS_NO_VCS=1 npx eas-cli build -p android --profile officials-preview --non-interactive --no-wait
```

Athletes app for the stores (`autoIncrement` raises the build number; bump `version` in `app.config.js`, e.g. to 1.0.1, for a new store release):

```bash
cd frontend/mobile && EAS_NO_VCS=1 npx eas-cli build -p android --profile athletes-production --non-interactive --no-wait
```

```bash
cd frontend/mobile && EAS_NO_VCS=1 npx eas-cli build -p ios --profile athletes-production --non-interactive --no-wait
```

```bash
cd frontend/mobile && npx eas-cli submit -p android --profile athletes-production --latest
```

```bash
cd frontend/mobile && npx eas-cli submit -p ios --profile athletes-production --latest
```

The App Store listing text and the reviewer notes are in `docs/app-store/athletes-app-store.md`.

**Rollback:** an installed app can't be pulled back. Reinstall the previous APK from its EAS build page, or publish a fixed build. An app needs a new build when `frontend/mobile/` changes. A change in the API, website or database alone doesn't need one.

---

## Release checklist (copy for each release)

- [ ] `scripts/audit/run.sh` passes; type-checks, lint, website build pass
- [ ] Staging: migrations → API → `git push origin main` → app builds (if mobile changed)
- [ ] Tried on staging (website + officials app + athletes app)
- [ ] Production: migrations → API → `git push fortis main` → app builds (if mobile changed)
- [ ] Checked: `/health` on the API, `/results` on the website
- [ ] Migration ledger below updated

## Migration ledger

| Migration | Staging | Production |
|---|---|---|
| 0001–0032 | ✅ | ✅ |
| 0033 fair heat draw | ✅ | ✅ |
| 0034 results ranking, ties, limits | ✅ | ✅ |
| 0035 scanner eligibility | ✅ | ✅ |
| 0036 row-level security | ✅ | ✅ |
| 0037 reserve substitution | ✅ | ✅ |
| 0038 result change log | ✅ | ✅ |
| 0039 function privileges | ✅ | ✅ |
| 0040 20 km walk, decathlon, heptathlon events | ✅ | ✅ rows already present, not run |
| 0041 relay teams built from athlete-form nominations | ✅ | ✅ |
| 0045 decathlon / heptathlon scoring (World Athletics tables) | ✅ | ✅ |
| 0046 substitute athlete keeps events, photo, DOB, phone, Aadhaar | ✅ | ✅ |
| 0042–0044, 0047–0052 | ✅ | ✅ (not logged at the time; confirmed 2026-11-26 by schema comparison) |
| 0053 PED login in the athletes app | ✅ 2026-11-26 | ✅ 2026-11-26 |
| 0054 college check-in (one scan per college) | ✅ 2026-11-26 | ✅ 2026-11-26 |
| 0055 re-sync functions after 0001–0018 were re-run on production | ✅ 2026-11-26 (no-op) | ✅ 2026-11-26 |
| 0056 Mixed relay max 3 nominations per squad (DB) | ✅ 2026-11-27 | ✅ 2026-11-27 (+ history row) |

**Never re-run an old migration file.** Re-running 0001–0018 on production on 26 Nov silently put back the
oldest versions of 10 functions (points, standings, field ranking, call room, check-in, payment trigger);
0055 repaired it. After any production migration, compare the two databases (function bodies, columns,
triggers, indexes, constraints, policies, grants) — they must have 0 differences. The queries are in
`docs/audit/e2e-audit-2026-11-26.md` §6.

## Deploy log

| Date | Module | Where | Version | Note |
|---|---|---|---|---|
| 2026-11-16 | API | staging | `d27d0f9` | revision `aura-api-staging-00003-qd8` |
| 2026-11-16 | Officials app | staging | `d27d0f9` | `officials-demo` build `99d10efa…` |
| 2026-11-21 | API | staging | decathlon / heptathlon | revision `aura-api-staging-00009-dkr` |
| 2026-11-21 | API | production | decathlon / heptathlon | revision `aura-api-00010-n4v` |
| 2026-11-21 | Database | staging + production | 0046 | substitute athlete migration |
| 2026-11-26 | Database | staging + production | 0053, 0054 | PED app, college check-in |
| 2026-11-26 | Database | production + staging | 0055 | re-sync of 13 functions + withdrawn-status check; schema and grants now identical to staging |
| 2026-11-26 | Database | production | history | `supabase_migrations.schema_migrations` marked 0023–0055 applied (the Supabase GitHub integration had replayed 0001–0022; GitHub auto-deploy being turned off) |
| 2026-11-26 | API | production | `46158bc` | revision `aura-api-00025-wgc`, normal sizing (min 1 / max 20 / 512 MiB); health 200, `ped-alerts-tick` 200 |
| 2026-11-26 | Website | production | `46158bc` | payments desk decides the shown receipt |
| 2026-11-27 | API | staging | `ae0e961` | revision `aura-api-staging-00020-82n` (audit follow-ups) |
| 2026-11-27 | Database | production | 0056 | existing over-cap squads untouched: NHCE Men and AIET Men have 4 Mixed nominees each (organisers to decide) |
| 2026-11-27 | Website | production | `5e2cbda` | audit follow-ups (`ae0e961`): POST-only forms, payment status sync, upload checks |
| 2026-11-27 | API | production | `5e2cbda` | revision `aura-api-00027-rkv`, normal sizing; venue login limits, finalize guard, standings cache, staff deactivation; schema = staging (0 differences) |
| 2026-11-26 | API | production | `ea5b927` | revision `aura-api-00014-pkt` (roll call, photo finish, PED app, college check-in) |
| 2026-11-26 | API | production | `PED_CRON_SECRET` | revision `aura-api-00015-8f2`; Cloud Scheduler `ped-alerts-tick` every minute |
| 2026-11-26 | API | staging | `65bbc42` | revision `aura-api-staging-00014-fl6` (with `PED_CRON_SECRET_STAGING`) |
| — | Website | production | still `700e1d5` | not deployed (unchanged) |
