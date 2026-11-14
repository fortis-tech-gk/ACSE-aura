# AURA Athletes — App Store submission kit

Everything to paste into App Store Connect for the **AURA Athletes** iOS app
(bundle ID `in.acsce.aura.athletes`). Screenshots are in `screenshots-6.9in/`.

---

## 1. Plan

| When | What | Build profile | Review login |
|---|---|---|---|
| After the developer account is approved | Version **1.0.0** against **staging**, set to **Manually release** (never released) | `athletes-store-staging` | A staging demo athlete (see `docs/staging-demo.stag.md`) |
| 26–27 Nov, after bibs are issued | Version **1.0.1** against **production**, then release | `athletes-production` | A real athlete of our college, with their consent |

- **Do not reset staging** (`seed_demo.py`) while version 1.0.0 is in review — the reset changes every demo login.
- Before the production submission, bump `version` in `frontend/mobile/app.config.js` to `1.0.1`
  (an approved version's build cannot be replaced). Build numbers go up automatically (`autoIncrement`).

## 2. Commands

Run from `frontend/mobile`. The first build asks you to log in to your Apple account once; EAS then
creates and stores the signing certificate, provisioning profile and push key itself.

```bash
# Staging review build (1.0.0)
EAS_NO_VCS=1 eas build --platform ios --profile athletes-store-staging
EAS_NO_VCS=1 eas submit --platform ios --profile athletes-store-staging --latest

# Production build (1.0.1), on 26–27 Nov
EAS_NO_VCS=1 eas build --platform ios --profile athletes-production
EAS_NO_VCS=1 eas submit --platform ios --profile athletes-production --latest
```

`eas submit` uploads the build to App Store Connect. The first time it may ask to create the app
record there (name, bundle ID, SKU — use `aura-athletes`).

## 3. App information

| Field | Value |
|---|---|
| App name (max 30) | **AURA Athletes** — if taken: **AURA Athletes – VTU Meet** |
| Subtitle (max 30) | **VTU Athletic Meet companion** |
| Primary category | Sports |
| Secondary category | Education |
| Price | Free |
| Age rating | 4+ (answer "None" to every content question) |
| Support URL | https://acse-aura.vercel.app/support |
| Privacy Policy URL | https://acse-aura.vercel.app/privacy |
| Marketing URL (optional) | https://acse-aura.vercel.app |
| Copyright | 2026 Dr. ACS College of Engineering, Bengaluru |
| Encryption | Already answered in the app (`ITSAppUsesNonExemptEncryption = false`) |

### Promotional text (max 170)
Your pass, events, call room reminders and live results for Dr. ACS-AURA 2026 — the 28th VTU State Level Inter-Collegiate Athletic Meet, 7–10 December.

### Description (max 4000)
AURA Athletes is the official companion app for athletes competing at Dr. ACS-AURA 2026, the 28th VTU State Level Inter-Collegiate Athletic Meet, hosted by Dr. ACS College of Engineering, Bengaluru, from 7 to 10 December 2026.

Log in with the bib number on your ID card and your date of birth — or scan the QR code on your card — and everything you need for the meet is in one place:

• Digital pass — your photo, bib number, college and a QR code that officials scan at meals, the hostel and the call room.
• My events — every event you are entered in, with heat, lane, call room time and start time.
• Call room reminders — alerts 30, 10 and 5 minutes before you must report, even without internet.
• Results — your times, distances and heights round by round, your placings, medals and points.
• Live standings — college points for the overall, men's and women's championships, and the best athletes.
• Stay & meals — your hostel and room, and which meals you have claimed today.

Your pass and schedule are saved on your phone, so the app keeps working at the venue even with a weak signal.

AURA Athletes is for athletes registered by their college for the meet. Bib numbers are issued by the meet office after registration closes; if you cannot log in, contact your college's Physical Education Director.

### Keywords (max 100, comma-separated)
`athletics,VTU,meet,track,field,results,sports,college,Bengaluru,AURA,inter collegiate,relay,schedule`

### Screenshots
Upload all six from `screenshots-6.9in/` (1320 × 2868, the 6.9" iPhone size) in this order:
login, pass, events, results, standings, stay. Apple scales them for smaller iPhones. iPad screenshots
are not needed — the athletes app is iPhone-only.

## 4. App Privacy ("nutrition label")

Answer in App Store Connect → App Privacy. The app collects (sends off the phone) only:

| Data type | Collected? | Linked to the user? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Identifiers → **User ID** (bib number used to log in) | Yes | Yes | No | App Functionality |
| Identifiers → **Device ID** (push notification token) | Yes | Yes | No | App Functionality |
| Other Data → **date of birth** (used to log in) | Yes | Yes | No | App Functionality |
| Everything else (location, contacts, photos, browsing, purchases, diagnostics, ads data) | No | — | — | — |

- "Do you or your third-party partners use data for tracking?" → **No**.
- The photo, name, blood group, events and results shown in the app come from the college's registration
  on the website; the app only displays them.

## 5. App Review information

**Sign-in required:** Yes. Enter a demo bib number and date of birth in the user name / password fields:

- User name: *bib number* (staging: take a current one from `docs/staging-demo.stag.md`)
- Password: *date of birth as DD-MM-YYYY*

**Notes for the reviewer** (paste as is, then fill in the bib and date of birth):

> AURA Athletes is the official companion app for the 28th VTU State Level Inter-Collegiate Athletic Meet (Dr. ACS-AURA 2026), hosted by Dr. ACS College of Engineering, Bengaluru, 7–10 December 2026.
>
> Athletes are registered by their college's Physical Education Director on our website (https://acse-aura.vercel.app). The meet office then issues each athlete a bib number. There is no sign-up inside the app: athletes log in with their bib number and date of birth, or by scanning the QR code on their printed ID card.
>
> Demo login — Bib number: ____  Date of birth: __ / __ / ____ (type the day, month and year in the three boxes).
>
> The app is read-only: it shows the athlete's pass, events, call room reminders, results, live standings and hostel / meal details. The camera is used only to scan the athlete's own ID-card QR code at login (optional). Notifications are used for call room reminders.
>
> Accounts are created by colleges through the official registration portal, not by users in the app. Athletes can ask their college or the meet office (contact on our support page) to correct or remove their data.

**Contact information:** your name, phone and email (App Store Connect asks for these; Apple uses them only during review).

## 6. Watch-outs

- **Using the college's and VTU's names and logos from a personal account.** Apple can ask for proof
  that you may publish an app with an institution's name and branding (guideline 5.2). Get a short
  **authorisation letter from the Principal on college letterhead** ("…authorised to develop and publish
  the AURA Athletes app on behalf of Dr. ACS College of Engineering for Dr. ACS-AURA 2026…"). Keep it
  ready as a PDF; if Apple asks, upload it in the reply. Mentioning it in the review notes up front is
  optional but can avoid a round-trip.
- **Unlisted vs public.** Public works. For "link only" distribution, request **unlisted app
  distribution** from Apple (developer.apple.com/support/unlisted-app-distribution) after the app is
  approved; then share the direct link with colleges.
- **Release:** choose **Manually release this version** for 1.0.0 (staging), and for 1.0.1 release it
  when you are ready (or "automatically after approval").
