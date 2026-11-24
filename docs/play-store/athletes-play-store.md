# AURA Athletes — Google Play submission kit

Package `in.acsce.aura.athletes`. Reuses the text in `docs/app-store/athletes-app-store.md`.
Account type: **personal** → must pass a closed test before production (see §1).

## 1. Timeline (started 24 Nov; meet is 7–10 Dec)

| Step | What | Earliest |
|---|---|---|
| 1 | Create the app in Play Console (name, free, app) | 24 Nov |
| 2 | Build `.aab` with `athletes-production` | 24–25 Nov |
| 3 | Upload to **Closed testing** track, add ≥12 testers (email list / Google Group), send opt-in link | 25 Nov |
| 4 | Testers stay opted in **14 continuous days** | ~9 Dec |
| 5 | "Apply for production" in Console (Google review, a few days) | after 9 Dec |

Consequence: Play production **cannot be live before the meet**. For the meet distribute the APK
(`aura-athletes-prod.apk`) from the website / WhatsApp / QR; Play is for afterwards. Closed-test
testers *can* install from Play during the meet, so enrol the host-college student volunteers.
Verify the current rule in Play Console → Dashboard → "Test your app" before relying on this.

## 2. Build

Run from `frontend/mobile` (only after you approve the build quota use):

```bash
EAS_NO_VCS=1 eas build --platform android --profile athletes-production
EAS_NO_VCS=1 eas submit --platform android --profile athletes-production --latest
```

`eas submit` needs a Play service-account JSON key (Console → Setup → API access). Without it,
download the `.aab` from the EAS build page and upload it by hand in the Console.
The `athletes-production` profile has no `buildType`, so it produces an `.aab` (correct for Play).
Bump `version` to 1.0.1 first if registration has closed and you want the final build.

## 3. Store listing

| Field | Value |
|---|---|
| App name (30) | AURA Athletes |
| Short description (80) | Pass, events, call room alerts and live results for Dr. ACS-AURA 2026. |
| Full description (4000) | Same as the App Store description |
| Category | Sports |
| Contact email / website | your email; https://acse-aura.vercel.app |
| Privacy policy | https://acse-aura.vercel.app/privacy |
| Free / ads | Free, no ads |

### Graphics
- **App icon 512×512 PNG**: from `frontend/mobile/assets/icon.png` (resize).
- **Feature graphic 1024×500**: still to make.
- **Phone screenshots (min 2, max 8)**: `docs/app-store/screenshots-6.9in/*.png` are 1320×2868 (2.17:1) —
  **Play rejects ratios above 2:1**. Letterbox/crop to e.g. 1242×2208 or 1080×2160 first.

## 4. App content declarations

- **Privacy policy**: URL above.
- **Ads**: No.
- **App access**: login required → give reviewers a demo bib + date of birth (production: a consenting
  host-college athlete; staging demo logins are in `docs/staging-demo.stag.md`).
- **Content rating**: questionnaire, answer "No" throughout → rated for everyone.
- **Target audience**: 18+ (college students). Not directed at children.
- **News app / COVID / government**: No. (Do not claim government affiliation; VTU is a university.)
- **Data safety**:
  - Collected: User ID (bib number), Device ID (push token), Date of birth.
  - All used for App functionality, linked to user, not shared, not for ads.
  - Encrypted in transit: Yes (HTTPS). Deletion: by request via support page.
- **Permissions to justify**: camera (scan ID-card QR), notifications, exact alarms
  (`SCHEDULE_EXACT_ALARM`, for call room reminders). Exact-alarm apps must declare a core use in the
  "Permissions declaration" form: "countdown reminders for athletes' call room reporting time".
- **Developer verification / org name**: institution branding from a personal account can be queried;
  keep a Principal's authorisation letter handy (same as the Apple note).
