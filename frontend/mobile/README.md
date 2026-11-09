# AURA mobile apps (Expo SDK 58)

One codebase, two apps, selected with `APP_VARIANT`:

| App | `APP_VARIANT` | Package / bundle id | Status |
|---|---|---|---|
| **AURA Athletes** | `athletes` (default) | `in.acsce.aura.athletes` | Pass, My Events, Stay & Meals, call room reminders |
| **AURA Officials** | `officials` | `in.acsce.aura.officials` | Placeholder — scanner modes next |

> Package ids are permanent once uploaded to the Play Store / App Store — change them in
> `app.config.js` before the first upload if needed.

## How AURA Athletes works

- **Login:** bib number + date of birth (as recorded on the registration portal), or scan the
  signed QR on the athlete's ID card (`AURA26.<id>.<signature>`).
- **Offline:** the pass and schedule are cached on the phone; a banner shows when data is stale.
- **Reminders:** scheduled *on the phone* 30, 10 and 5 minutes before each call room time
  (`REMINDER_OFFSETS_MIN` in `src/lib/config.ts`). Re-synced on every refresh. The 5-minute
  reminder uses Android's alarm-clock delivery when the athlete allows "on-time reminders".
- **Push:** the backend pushes "Call room OPEN" when officials open a heat
  (`PATCH /api/schedule/heats/:id/status` → `CALL_ROOM`); the app then refreshes its reminders.
  Needs a development/production build and an EAS project id — Expo Go can't receive push.

## Run locally

```bash
npm install
# Backend on :5000 (see backend/.env.example), then:
APP_VARIANT=athletes EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:5000/api npx expo run:android
APP_VARIANT=athletes EXPO_PUBLIC_API_URL=http://localhost:5000/api npx expo start --web   # quick UI preview
```

For faster local builds add `ANDROID_BUILD_ARCHS=arm64-v8a` (one chip type). Release builds
against an `http://` API allow plain HTTP automatically; `https://` builds don't.

Native `android/` and `ios/` folders are generated (git-ignored). After changing `app.config.js`
or switching variant, regenerate them: `APP_VARIANT=athletes npx expo prebuild --clean`.

## Build & publish (EAS)

> **Always build with `EAS_NO_VCS=1`** (the `npm run eas:*` scripts do this). Without it EAS
> uploads the whole git repository — including `docs/` with PED phone numbers and principal
> e-mails, plus their git history. With it, only `frontend/mobile` (~1 MB) is uploaded,
> filtered by the repo-root `.easignore`. Check what would be uploaded, without uploading:
> `EAS_NO_VCS=1 npx eas-cli@latest build:inspect -p android --profile athletes-preview --stage archive --output /tmp/eas-check`

1. `npx eas-cli@latest login`
2. EAS projects already exist (owner `ganesh_a_k_11`); their ids are in `app.config.js`. To recreate:
   `APP_VARIANT=athletes npx eas-cli@latest init` and `APP_VARIANT=officials npx eas-cli@latest init`
3. Set the real API URL in `eas.json` → `build.base.env.EXPO_PUBLIC_API_URL`.
4. Push credentials: Android needs an FCM key uploaded with `npx eas-cli@latest credentials`;
   iOS needs the Apple Developer account (APNs key is created by EAS).
5. Builds:
   - Test APK to sideload: `npm run eas:athletes:test-apk`
   - Play Store: `npm run eas:athletes:play`
   - App Store: `npm run eas:athletes:ios`
   - `athletes-usb-test`: APK that talks to a laptop backend over USB (`adb reverse tcp:5000 tcp:5000`)

**Play Store (personal account):** new personal developer accounts must run a closed test
(currently 12 testers for 14 days) before production — start it as early as possible.
