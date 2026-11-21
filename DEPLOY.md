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

**Meet days (7–10 Dec):** keep 2 instances always warm (costs more, so only for the meet):

```bash
cd backend && ./deploy-cloudrun.sh aura-2026-514120 --meet
```

**After the meet**, run the normal production command again to scale back to zero.

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

## Deploy log

| Date | Module | Where | Version | Note |
|---|---|---|---|---|
| 2026-11-16 | API | staging | `d27d0f9` | revision `aura-api-staging-00003-qd8` |
| 2026-11-16 | Officials app | staging | `d27d0f9` | `officials-demo` build `99d10efa…` |
| 2026-11-21 | API | staging | decathlon / heptathlon | revision `aura-api-staging-00009-dkr` |
| 2026-11-21 | API | production | decathlon / heptathlon | revision `aura-api-00010-n4v` |
| 2026-11-21 | Database | staging + production | 0046 | substitute athlete migration |
| — | Website | production | still `700e1d5` | not deployed (unchanged) |
