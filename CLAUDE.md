# SynRegis CRM

Single-user CRM for SynRegis (syndic/copropriété management, Mauritius). Tracks real-estate
development projects ("leads") and their promoteurs through a sales pipeline. Built and
maintained with Claude Code. Owner: Axel (axlrrn@gmail.com) — the only authorized user.

## Stack & architecture

- **Frontend:** React 19 + Create React App (`react-scripts`). The entire app lives in
  **`src/App.js`** (single file, by design). Plain `var`/function components, inline styles,
  design tokens at the top of the file (`NAVY`, `CARD`, `GOLD`, `CREAM`, `MUTED`, `BORDER`, `INP`).
- **Backend:** Firebase project `synregis-crm` — Firestore (data) + Auth (Google + email/password).
  No server of our own. **No Firebase Storage** (free plan, see Gotchas).
- **Hosting:** Vercel, auto-deploys every push to `main` (GitHub integration, repo
  `Axlrrn/synregis-crm`). Production: **https://synregis-crm.vercel.app**.
  No local `.vercel` link — never run `vercel link` here. Free plan: max 100 deploys/day,
  so batch changes into one push.
- **Android app:** WebView wrapper in **`android/`** — displays the production site, adds
  native capabilities (share-target, fingerprint, credentials, notifications). Distributed
  as a sideloaded APK at **`/synregis.apk`** (copied into `public/`, served by Vercel).
- **AI extraction:** Google **Gemini API** called directly from the browser
  (`generativelanguage.googleapis.com`), free tier.

## Data model (Firestore)

- `leads/{id}` — one doc per project: `projectName` (required), `location`, `promoteur`,
  `promoteurKey` (lowercase grouping key — call/meeting logs sync across all leads sharing it),
  `promoteurFull`, `contactName`, `phone`, `units`, `unitDetails`, `amenities`, `projectStage`,
  `pipelineStage`, `priority`, `notes`, `callLog[]`/`meetingLog[]` (`{date, note}`),
  `nextFollowUp` (yyyy-mm-dd), `region`, `gpsCoords`, `attachments[]` (dead — no Storage),
  `createdAt`.
- `config/app` — `regions[]` (editable list) and `geminiKey` (the Gemini API key, so it
  syncs across devices). Always write with `setDoc(..., {merge: true})`.
- `pipelineStage` ∈ Prospecting, Proposal Sent, Negotiation, Due Diligence, Won, Lost, On Hold,
  Unwanted. **Lost + Unwanted = the Archive** (excluded from pipeline views and notifications).
- Seeding: if the `leads` collection is ever empty, `INITIAL_LEADS` (in App.js) re-seeds it.

## Auth & security

- **Web (PC):** Google popup sign-in. **App:** email + password (Google blocks OAuth inside
  WebViews — `disallowed_useragent`). The password is set/changed from the website:
  Settings → App Password (links an email/password credential to the same Firebase account).
- `ALLOWED_EMAILS` in App.js gates the UI; the real enforcement is **Firestore rules**:
  `allow read, write: if request.auth != null && request.auth.token.email == 'axlrrn@gmail.com'`.
  Adding a user means updating BOTH. Rules were set 2026-06-12 after the test-mode expiry
  incident (see Gotchas).
- **In the app:** fingerprint gate on open (native BiometricPrompt, phone-PIN fallback),
  then silent auto sign-in using credentials encrypted with an Android-Keystore AES/GCM key.
  Sessions never expire on their own. The SIGN OUT button is web-only (hidden in-app).
- "Forgot password?" on the sign-in screen → Firebase reset email.

## AI lead extraction (Gemini)

- `extractLeadWithAI(text, image, apiKey, regions)` in App.js. Prompt asks for a strict JSON
  object (projectName, location, promoteur, contactName, phone, units, unitDetails, amenities,
  region constrained to the configured list, notes). `responseMimeType: application/json`,
  temperature 0.
- **Model fallback chain** (survives Google renames): `gemini-flash-latest` → `gemini-3-flash`
  → `gemini-2.5-flash` → `gemini-2.0-flash` — tries the next on HTTP 404 only.
- Key: created at aistudio.google.com (free tier ~1.5k req/day), pasted in Settings →
  AI Extraction, stored in `config/app.geminiKey`. **Never hardcode it.**
- Entry points: ✨ AI button (paste text and/or screenshot — Ctrl+V works), Android share
  (text or image), all converging on `PasteLeadModal` → prefilled `AddForm` for review.
- If the ad has no project name, `handleExtracted` composes `"Promoteur – Location"`.

## URL params (web ↔ app contract)

- `/?shared=<urlencoded text>` — opens the AI modal prefilled (text share from Android).
- `/?sharedimg=1` — web pulls the shared image from the native bridge
  (`window.SynRegisNative.getSharedImage()`, one-shot, returns `"mime;base64"`).
- Both are consumed once and stripped with `history.replaceState`.

## Android app (`android/`)

Zero-dependency wrapper (no androidx): `MainActivity` + `NotificationHelper` + `AlarmReceiver`
+ `BootReceiver`. The WebView UA gets **` SynRegisApp`** appended — the web app keys all
in-app behavior off `/SynRegisApp/.test(navigator.userAgent)` (hide Google button, hide
sign-out, phone notification settings, APK download section hidden).

**JS bridge (`window.SynRegisNative`):** `getSharedImage()`, `storeCredentials(email, pw)`,
`getCredentials()` → `"email\npassword"`, `clearCredentials()`, `scheduleReminders(json)`,
`requestNotificationPermission()`.

**Native notifications:** web pushes `{enabled, time, includeStale, followUps[], staleNames[]}`
on every leads/settings change; native stores it (SharedPreferences) and arms a daily
AlarmManager alarm (`setAndAllowWhileIdle`, re-armed after firing and on boot). Nothing fires
on days with nothing due. Huawei battery management can still kill alarms — the in-app hint
tells the user to whitelist the app.

**Build** (toolchain is portable, lives on **D:** — C: is chronically full):

```
cmd /c "set JAVA_HOME=D:\Android\jdk17&& set GRADLE_USER_HOME=D:\Android\gradle-home&& cd /d <repo>\android&& D:\Android\gradle-8.7\bin\gradle.bat assembleRelease --no-daemon"
```

- SDK: `D:\Android\sdk` (platform-34, build-tools 34.0.0). Output:
  `android/app/build/outputs/apk/release/app-release.apk`.
- **Bump `versionCode`/`versionName`** in `android/app/build.gradle` for every release.
- **Signing:** keystore at `C:\Users\axeln\OneDrive\SynRegis\keys\synregis-release.keystore`
  (alias `synregis`; password in the README.txt beside it — OneDrive-synced backup).
  `android/keystore.properties` (gitignored) points to it. Losing the key only means
  uninstall/reinstall — all data is in Firestore.
- **Publish:** copy the APK to `public/synregis.apk`, commit, push — installs over the old
  version (same key). Download from Settings → Android App, or the direct URL, or the repo.

## Dev workflow

- Local preview: `crm-dev` launch config (CRA on port 3000). The preview can't get past
  Google sign-in — verify by compile cleanliness + code review, then on Axel's actual devices
  (Claude-in-Chrome can inspect his signed-in Edge/Chrome session when debugging live issues).
- Baseline ESLint warnings (pre-existing, ignore): `uploadBytes` unused, `no-useless-escape`
  at the INITIAL_LEADS regex. Anything else is new.
- Commit style: conventional-ish (`feat(...)`, `fix(...)`), Co-Authored-By Claude trailer.

## UX features worth knowing before touching code

- **Stale tracking:** `lastActivityDate` = max(createdAt, callLog, meetingLog dates);
  active-pipeline leads silent ≥14 days get "Quiet Nd" amber tags + "GOING QUIET" banner.
- **Hierarchical filters:** Filters ▾ → Priority / Construction Stage / Region / **Missing info**
  (no promoteur, no phone, …) with live counts; active filters render as removable chips.
  All filters AND together with the pipeline chips and search.
- **Group by promoteur:** groups the filtered list by `promoteurKey`, biggest portfolios first.
- **Back-button sentinel:** while any modal/detail layer is open, one history entry is kept so
  the Android back button closes the top layer instead of quitting (`layers` array in AppInner).
  New modals MUST be added to that array.
- **Per-device settings** in localStorage (`synregis_settings`): badge, banner, stale,
  browserNotif (PC), appNotif + appNotifStale + notifTime (app).
- Dark-first design: see Gotchas — never reintroduce light/white surfaces.

## Gotchas — learned the hard way (do / don't)

1. **Firebase test-mode rules expire after ~30 days** → every read fails with
   `Missing or insufficient permissions`, which *looks like total data loss*. It never is.
   Fix in Console → Firestore → Rules. Don't panic-reseed.
2. **No Firebase Storage on the free (Spark) plan** — `uploadBytesResumable` can never work.
   The Attach PDF UI is vestigial; replace with a link field if it ever matters.
3. **Huawei phone (Nova 15, no Google services)** — Axel's daily device:
   - PWA installs are always badged shortcuts (Chrome can't mint WebAPKs; Huawei Browser uses
     QuickApp). The APK is the only clean install — don't resurrect PWA install UI.
   - The browser **force-darkens light pages**: white surfaces turn black and navy text
     disappears. Design dark-first; `color-scheme: only light` is set but not trusted;
     header/splash use `logo_dark.png` (cream/gold recolor).
   - PWA periodic background sync never fired — that's why notifications are native now.
4. **Google OAuth is blocked inside WebViews** — never add a Google sign-in path for the app;
   the email/password + encrypted-credential flow exists precisely for this.
5. **A full C: drive produces absurd Gradle errors** ("failed to load native-platform.dll",
   "cannot create directory") — check `Get-PSDrive C` free space before debugging Gradle.
   Everything build-related deliberately lives on D:.
6. **PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM** — it corrupted
   `keystore.properties` (first key read as `﻿storeFile` → null). For files read by
   other tools use `[IO.File]::WriteAllText($path, $text, New-Object Text.UTF8Encoding $false)`.
7. **winget MSI installs fail (exit 1602) from non-interactive shells** — UAC prompt can't be
   shown. Use portable ZIP distributions (that's how JDK/SDK/Gradle are installed).
8. **Never swallow Firestore write errors** — a silent `catch(e){}` around `setDoc` once showed
   a false "Saved ✓" while the DB was locked. Surface `permission-denied` to the user.
9. **Silent form rejections are bugs** — Add Lead used to no-op when Project Name was empty.
   Always render the reason a button "did nothing".
10. **Vercel free plan:** ≤100 deploys/day — batch commits; one push per coherent change-set.
11. The git remote URL embeds a GitHub PAT (Axel's setup) — be mindful when printing
    `git remote -v` output into anything shareable.

## Where credentials/secrets live (never in this repo)

| Secret | Location |
|---|---|
| Gemini API key | Firestore `config/app.geminiKey` (set via Settings → AI Extraction) |
| Android keystore + password | `C:\Users\axeln\OneDrive\SynRegis\keys\` (README.txt has the password) |
| `keystore.properties` | `android/` — gitignored |
| Firebase web config | Public by design (in App.js) — security is in Firestore rules |
| App password (email auth) | Firebase Auth; user-managed via Settings → App Password |
