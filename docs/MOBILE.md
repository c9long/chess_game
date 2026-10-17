# Mobile apps (Android + iOS): plan for the PoC beta

Status: proposal (researched 2026-10-17). The web and server preparation is in (2026-10-17):
phase 1 items 1 and 4–8, phase 2 rows 1–5 and 7–10, and the token wipe on account deletion
(each marked **Done** below). There is no Capacitor project yet. Scope is a **proof-of-concept
beta** for a small group of testers. Nothing below is sized for a big user base.

The short version:

- **Wrap the existing web app with [Capacitor](https://capacitorjs.com/)** (version 8). Both store apps
  load the same React + PixiJS build that `play.<domain>` serves, so there is one codebase and no
  rewrite.
- **Signing in happens in the system browser** on our real web origin, through the device-approval
  flow we already built for the Unity client. The app then talks to the API with a **bearer token**
  instead of cookies. This avoids reworking Turnstile, the age screen, clickwrap, passkeys and OAuth
  for the app.
- **Cost:** Google Play $25 once, Apple $99 per year. Apple's fee is the only subscription, and an
  iPhone app can't be shipped without it. Everything else on this list has a free option.
- **Biggest decision for the owner:** on iOS, either hide the Google/Discord/GitHub/Microsoft buttons
  or add Sign in with Apple (§4).

---

## 1. Which approach: Capacitor vs PWA-only vs React Native/Expo

| | **Capacitor (recommended)** | PWA only | React Native / Expo |
|---|---|---|---|
| What it is | Our built web app inside a native shell (WKWebView on iOS, Android System WebView), plus plugins for native features | Users "install" the website from the browser | A separate native UI written in React Native |
| Code reuse | ~100%: same `apps/web` build | 100% | Low. Every page and menu is rebuilt. PixiJS doesn't run natively, so the board would need a WebView anyway or a rewrite (e.g. Skia) |
| In the App Store / Play Store | Yes | No (Android can wrap one as a TWA; iOS can't) | Yes |
| Push notifications | Native (FCM/APNs) | Android: yes. iOS: only once the user adds the site to the Home Screen (iOS 16.4+) ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)) | Native |
| Effort | Small to medium: config, auth adaptation, polish | Smallest | Large |
| Store fees | $25 + $99/yr | $0 | $25 + $99/yr |

**Why Capacitor:**

1. **One codebase.** The rules run as Rust/WASM in the browser, and CLAUDE.md forbids
   re-implementing them. Capacitor runs the same WASM inside the WebView, so nothing is duplicated.
   React Native would need the WASM bridged into a JS engine, and the board would be rewritten.
2. **PixiJS/WebGL works in both WebViews.** WKWebView has had WebGL and a JIT JavaScript engine for
   years, and Capacitor's performance is essentially WKWebView's
   ([Construct on WKWebView](https://www.construct.net/en/blogs/construct-official-blog-1/boosting-ios-performance-855)).
   PixiJS 8 asks for WebGL2 and falls back to WebGL1. No current benchmark exists for our exact
   stack, so phase 0 below tests it on a real mid-range phone.
3. **App Store "minimum functionality" (guideline 4.2).** Apple rejects apps that are just a
   "repackaged website" ([guidelines 4.2 / 4.2.2](https://developer.apple.com/app-store/review/guidelines/)).
   A real-time multiplayer game with solo play against bots is an app, not a website. We still lower
   the risk: the web build is **bundled inside the app** (never point Capacitor's `server.url` at the
   live site), and the app uses native touches (haptics, keep-awake, an offline screen, and push
   later).
4. **The PWA is still worth doing** as a free first step (§3, phase 1): a manifest and icons make the
   site installable on Android today, and the same icons feed the store apps.

### What it costs (be explicit: one subscription only)

| Item | Cost | Recurring? |
|---|---|---|
| Google Play developer account | **$25** | One-time, covers all apps ([summary](https://splitmetrics.com/blog/google-play-apple-app-store-fees/)) |
| Apple Developer Program | **$99** | **Yearly.** Needed for TestFlight, the App Store, push (APNs), Associated Domains and Sign in with Apple. A free Apple ID can only sideload to your own phone for 7 days |
| Building iOS (needs macOS + Xcode 26) | **$0** with [Codemagic's free plan](https://docs.codemagic.io/billing/pricing/) (500 macOS minutes per month, personal account), or a borrowed or owned Mac | Free tier, no card needed |
| Firebase Cloud Messaging (push, both platforms) | **$0** ([Firebase pricing](https://firebase.google.com/pricing)) | No |
| Capacitor and the official plugins | $0 (MIT) | No |

Year one costs **$124**, then **$99 per year**. If the owner wants to put off the Apple fee, ship
Android plus the iOS PWA first and add the iOS app later. Nothing in this plan blocks that.

**Store gates for a beta:**

- **Google Play:** a *new personal* developer account must run a **closed test with at least 12
  testers for 14 days in a row** before it can publish to production
  ([Google](https://support.google.com/googleplay/android-developer/answer/14151465)). The beta can be
  that closed test.
- **Apple:** TestFlight allows up to 10,000 external testers after a light Beta App Review
  ([TestFlight](https://developer.apple.com/testflight/)). Builds expire after 90 days.

---

## 2. How the app talks to the server (and why sign-in goes through the browser)

Today the web app relies on being **same-site** with the API (`play.<domain>` → `api.<domain>`, PLAN
§1). Inside the app, the page's origin is instead **`capacitor://localhost`** on iOS and
**`https://localhost`** on Android ([Capacitor config](https://capacitorjs.com/docs/config): defaults
`iosScheme: capacitor`, `androidScheme: https`, `hostname: localhost`). Requests to `api.<domain>`
from those origins are cross-site, and both WebViews block third-party cookies. So:

- **Session cookies won't work in the app.** Use `Authorization: Bearer <token>`. The Better Auth
  `bearer()` plugin is already installed (`apps/server/src/auth/auth.ts`), and `requireSession`,
  `resolvePlayer` (Colyseus) and every `/api/*` route already accept a bearer token.
- **Signing in inside the WebView is the hard part.** Every sign-in path is behind Turnstile
  (`CAPTCHA_ENDPOINTS` in `auth.ts`). Sign-up and guest start also read the signed `age_ok` /
  `legal_pending` **cookies** (`CLICKWRAP_PATHS`, `apps/server/src/legal/gate.ts`). 2FA, OAuth and the
  guest-upgrade intent use cookies too. Turnstile's server check only accepts tokens solved on our
  web hostname (`allowedHostnames`), and inside the app the hostname is `localhost`. Passkeys in a
  WebView only work when the page's origin matches the passkey domain, which `capacitor://localhost`
  never does ([Apple: passkeys need associated domains](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys);
  [Android WebView passkeys](https://developer.android.com/identity/sign-in/credential-manager-webview)).

**Recommendation: do all sign-in on the real website, then hand a token to the app.**

- **Phase 2a (almost no new server code): reuse the device flow.**
  1. The app calls `POST /api/auth/device/code` with a new client id `game-mobile-client`.
  2. It opens `https://play.<domain>/device?user_code=…` in the system browser
     ([`@capacitor/browser`](https://capacitorjs.com/docs/apis/browser): SFSafariViewController on
     iOS, Custom Tabs on Android).
  3. The player signs in there with anything (email, passkey, Google, guest), so Turnstile, the age
     screen, clickwrap and 2FA all run unchanged, and taps Approve. Check that a guest session can
     approve a device request; if it can't, allow guests on that page.
  4. The app polls `/api/auth/device/token` and stores the `access_token`, which is a session token
     usable as a bearer token. `app.ts` already says native clients take the token from this JSON
     body.
- **Phase 2b (polish): skip the Approve tap.** The web page makes a single-use token with Better Auth's
  [one-time-token plugin](https://www.better-auth.com/docs/plugins/one-time-token) (3-minute expiry)
  and redirects to an app link (`https://play.<domain>/app/auth?ott=…`, verified by
  `apple-app-site-association` / `assetlinks.json`), or to a custom scheme protected by a random
  `state` value. The app catches it with `@capacitor/app`'s `appUrlOpen` event and calls
  `/one-time-token/verify`. Before relying on this, verify that the verify response includes the
  session token.

Two things to know about this approach:

- **Passkeys work through it for free**, because they run in Safari or Chrome on our real origin. In
  the app's own Account page, hide "Add passkey", or open the website's Account page in the browser.
  Native passkeys need associated domains and a server change (Android sends an
  `android:apk-key-hash:` origin), so they wait for later.
- **Apple accepts sign-in through an in-app browser sheet.** It is the pattern Apple recommends for
  OAuth. If a reviewer objects, the fallback is a native email/password form (later work).

---

## 3. Phased plan

### Phase 0: one-day spike (no production code)

- Create `apps/mobile` (neutral name), a Capacitor 8 project with `webDir: '../web/dist-native'`
  (built by `VITE_API_URL=https://api.<domain> pnpm --filter @game/web build:native`). Run
  `npx cap add android` (works on Windows/WSL with Android Studio) and test the board on a real
  mid-range Android phone. Check frame rate, drag, sound, and memory use with
  `devicePixelRatio` at 3.
- Same test on iOS through a Codemagic build or a borrowed Mac. Capacitor 8 needs iOS 15+, Android
  API 24+ and Node 22+ ([Capacitor 8](https://ionic.io/blog/announcing-capacitor-8)).

### Phase 1: safe now, inside the web app (also improves mobile browsers)

All of these help the website on phones too, and none needs the native project. Each is one small
TODO item.

1. **Done.** **Safe areas.** In `apps/web/index.html` set
   `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`. In
   `apps/web/src/index.css`, pad the shell's header, footer and game panels with
   `env(safe-area-inset-top/right/bottom/left)` (notch, home indicator, Android edge-to-edge;
   Capacitor 8 has a built-in `SystemBars` for edge-to-edge on Android).
   *Done:* the insets are `--safe-top/right/bottom/left` CSS variables in `index.css`; the
   header, footer, game page, toasts, dialogs, the reconnecting bar and the lobby's fixed bars
   use them, and the game board's height budget subtracts them.
2. **Touch on the board** (`packages/board/src/BoardView.ts`, already Pixi pointer events). Confirm the
   canvas keeps `touch-action: none` (Pixi's EventSystem sets it), and add
   `user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent` on the
   board container so a long press doesn't open the text callout. Make tap-tap moves as easy as drag
   (bigger hit targets on small screens). Cap the Pixi `resolution` at 2 on phones to save GPU memory.
3. **Portrait layout.** The 16×16 board fills the width, with game panels below it. This is the
   existing "Responsive layout … portrait board scaling" TODO item.
4. **Done.** **Haptics/feedback wrapper** `apps/web/src/lib/feedback.ts`: `feedback('move' | 'capture' |
   'check' | 'yourTurn' | 'gameEnd')`. It calls `navigator.vibrate` where supported (Android Chrome)
   and does nothing elsewhere. Phase 3 swaps in `@capacitor/haptics`. Add an on/off setting in
   `apps/web/src/lib/prefs.ts`.
   *Done:* "Vibration" board setting (default on, shown on touch devices that can vibrate),
   wired in `GameRoom.tsx` at the points the board plays sounds (one vibration per position
   change). Phase 3 installs the native driver with `setFeedbackDriver`.
5. **Done** (`lib/wake-lock.ts`). **Keep the screen awake during a game.** Use the Screen Wake Lock API in `GameRoom.tsx` while
   `phase === 'in_game'`, and re-acquire it on `visibilitychange` (the browser drops it when hidden).
   Phase 3 uses `@capacitor-community/keep-awake` in the app.
6. **Done** (except a longer grace, still open). **Reconnect on resume.** When the page becomes visible again (or the network comes back), rejoin
   right away with the stored reconnection token instead of waiting. Keep that token in
   `localStorage` as well as `sessionStorage` (`apps/web/src/lib/match.ts`), because a phone OS may
   kill a background WebView, and sessionStorage dies with it. The server keeps a seat for 60 s
   (`DEFAULT_RECONNECT_GRACE_MS`). After that a disconnected player is abandoned, which counts as a
   timeout. Show a short "Leaving the app for more than a minute forfeits" hint on phones. Whether to
   lengthen the grace on mobile is a product question, so put it behind config and don't decide it
   silently.
   *Done:* `lib/reconnect-store.ts` keeps the token in both storages (pruned after 6 h, the
   long-lived copy cleared at game end). On `visibilitychange`/`pageshow`/`online`,
   `checkConnection` restarts the SDK's retry budget, or pings the socket and drops it after
   3 s without an answer so the SDK rejoins at once. If the SDK gives up, the match page keeps
   trying with the saved token until 15 s after the grace (75 s by default). The automatic
   retries are tuned (≤ 2 s apart, for the same window) to outlast the server's grace. The hint "Leaving the app for more than 60 s forfeits" shows
   on touch screens during a game (dismissible, remembered). The grace, the hint's number and
   the retry budget all follow the server's `reconnectGraceMs`. Signing out or deleting the
   account leaves the match room and forgets every saved token, and a matchmaking reconnect
   needs the seat owner's session, so a token left in a shared browser can't take a seat. A
   second tab or the relaunched app taking the seat over keeps its own saved token, and the
   old one says the game continues elsewhere.
7. **Done** (orientation `any`, not portrait: the game screen switches to the side-panel layout
   on a phone held sideways, the `wide:` variant in `index.css`). **PWA manifest and icons.** Add a web manifest (name and short name from `APP_NAME` in
   `@game/config`, generated at build time by a small Vite plugin, never hard-coded), plus
   `theme_color` `#1d1b19`, `display: standalone`, portrait, and 192/512 px plus maskable icons from
   one 1024 px source in `packages/assets`. Add `apple-touch-icon`. Leave out a service worker for now
   (it risks stale builds against the server's `protocolVersion`).
   *Done:* `apps/web/plugins/app-manifest.ts` serves and emits `manifest.webmanifest`,
   `favicon.svg`, `apple-touch-icon.png` and `icons/{icon,maskable}-{192,512}.png`. The source
   is `packages/assets/app-icon/emblem.svg` (the header emblem); the PNGs are rendered by
   `packages/assets/scripts/render-app-icons.mjs` and committed. `short_name` is
   `APP_SHORT_NAME` in `@game/config` (equal to `APP_NAME` until a shorter one is chosen).
8. **Done.** **A platform module** `apps/web/src/lib/platform.ts`: `isNative()` (later
   `Capacitor.isNativePlatform()`), `platform()` returning `'web' | 'ios' | 'android'`. Every
   native-only branch goes through it. *Done:* reads `window.Capacitor` (no dependency); a
   `VITE_NATIVE` build counts as native.

### Phase 2: server and web changes for the app (checklist with files)

| # | Change | File(s) |
|---|---|---|
| 1 | **Done.** Native build uses a full API URL. `API_ORIGIN` already reads `VITE_API_URL` (`auth-client.ts`), and `match.ts` / `api.ts` use it. Add a `build:native` script with `VITE_API_URL=https://api.<domain>` and the native flag. The `/api/dev/mail` calls in `DevMail.tsx` are dev-only and can stay relative | `apps/web/package.json`, `apps/web/src/lib/auth-client.ts` |
| 2 | **Done.** New env `NATIVE_ORIGINS` (comma list, default empty; prod `capacitor://localhost,https://localhost`; dev adds `http://localhost` for live reload) | `apps/server/src/config.ts`, `infra/.env.example`, `docs/DEPLOY.md` |
| 3 | **Done.** CORS: allow `[webOrigin, ...nativeOrigins]` (today `cors({ origin: config.webOrigin })`). The web origin keeps credentials; the native origins get CORS without credentials | `apps/server/src/app.ts` |
| 4 | **Done.** Better Auth `trustedOrigins`: add the native origins (and the app-link or scheme callback for 2b) | `apps/server/src/auth/auth.ts` |
| 5 | **Done.** Colyseus WebSocket origin check: `originAllowed` accepts only no Origin or `webOrigin`, but a WebView sends `capacitor://localhost` / `https://localhost`. Add the native origins | `apps/server/src/game/colyseus.ts` (~line 119), update `packages/protocol/README.md` |
| 6 | `requireTrustedOrigin` needs no change: bearer requests carry no cookie, so it lets them through. Keep it strict | `apps/server/src/http/security.ts` (no change) |
| 7 | **Done.** Device client id `game-mobile-client` plus a friendly name ("the mobile app") on the approval page | `auth.ts` (`DEVICE_CLIENT_IDS`), `apps/web/src/pages/Device.tsx` (`CLIENT_NAMES`) |
| 8 | **Done.** Bearer mode in the auth client: when native, `fetchOptions: { auth: { type: 'Bearer', token: () => storedToken } }` (the [bearer plugin docs](https://www.better-auth.com/docs/plugins/bearer) form). *Done with* `credentials: 'omit'` in bearer mode (auth client, `api()`, the export fetch, Colyseus matchmaking), and the server's CORS grant for `NATIVE_ORIGINS` carries no credentials, so a cookie session can never be set or used from an app origin | `apps/web/src/lib/auth-client.ts` |
| 9 | **Done.** `api()` adds `Authorization: Bearer …` when native. So does the account export fetch | `apps/web/src/lib/api.ts`, `apps/web/src/pages/Account.tsx` |
| 10 | **Done** (as a matchmaking `Authorization` header on `client.http.options.headers`: `client.auth.token` would also put the token in the WebSocket URL, where proxies log it). Colyseus: set `client.auth.token = storedToken` before matchmaking (the README already documents this for native clients; `resolvePlayer` reads it) | `apps/web/src/lib/match.ts` |
| 11 | Native sign-in screen (*placeholder in:* a native build shows `NativeSignIn.tsx` instead of the sign-in, sign-up and guest forms, which can't work there): one "Sign in or play as guest" button that runs the device flow (§2), stores the token, and refreshes session state. Sign-out deletes the token and calls `/sign-out` with it | new `apps/web/src/pages/NativeSignIn.tsx`, `apps/web/src/lib/app-state.tsx` |
| 12 | Token storage (the pluggable `lib/token-store.ts` exists, with a localStorage stub; install the secure store with `setTokenStore`): Keychain/Keystore through a free plugin (e.g. `@aparajita/capacitor-secure-storage`), not plain `localStorage` | `apps/mobile` |
| 13 | Hide or redirect web-only UI in the app: OAuth sign-in and "link account" (`callbackURL` uses `window.location.origin`, which is `capacitor://localhost` in the app), "Add passkey", and the JSON export download (WebViews don't save `Content-Disposition` downloads; open it in the browser or use the Share sheet) | `SignIn.tsx`, `SignUp.tsx`, `Account.tsx` |
| 14 | External links (legal pages, emails, help) open in the system browser, not inside the app's WebView | `apps/web/src/components/*` (via `platform.ts`) |
| 15 | OAuth redirect URIs need no change for 2a, because OAuth runs on the website as today | none |
| 16 | Turnstile needs no change for 2a, because it only runs on the website (`allowedHostnames` stays strict). Don't add `localhost` to the production widget | none |

### Phase 3: native shell (`apps/mobile`)

- `capacitor.config.ts`: `appName` from `APP_NAME` (the TS config can import `@game/config`).
  **Choose a neutral, permanent bundle id** (e.g. `com.<domain-without-title>.app`); it can't be
  changed after the first store upload.
- Plugins (all free): `@capacitor/app` (resume, back button, deep links), `@capacitor/browser`,
  `@capacitor/haptics`, `@capacitor-community/keep-awake`, `@capacitor/splash-screen`,
  `@capacitor/network` (offline screen), and the secure-storage plugin.
- Icons and splash screens: generate both platforms' sets from the one source image with
  `@capacitor/assets`.
- Android back button: map it to "close dialog / go back"; never quit in the middle of a game
  without the leave confirmation.
- Orientation: portrait on phones, any orientation on tablets. iOS: decide between iPhone-only and
  universal. Universal means reviewers will also test the iPad layout.
- Builds: Android with `./gradlew bundleRelease` locally or in CI (keep the upload key out of git).
  iOS in Codemagic's free tier. Add a `docs/DEPLOY.md` section for both.

### Phase 4: store submission

**In-app account deletion.** Apple 5.1.1(v) requires that deletion can be *started in the app*,
covers the whole account, may ask for re-authentication, and also applies to guest accounts
([Apple](https://developer.apple.com/support/offering-account-deletion-in-your-app/)). Our current
flow already fits:

- `DELETE /api/account` (`apps/server/src/account/routes.ts`) anonymizes and deletes the user, with
  cascades to sessions, credentials and passkeys.
- It works for guests with a typed confirmation, and for registered users with a session from the
  last 24 h or their password.
- The Account page shows "Delete account…" / "Delete guest account…".
- It authenticates with `requireSession`, so it works with a bearer token. A device-flow session is
  always fresh.
- The privacy policy explains what is kept (match records under a placeholder name), which Apple
  allows.

App work still needed:

- **Done:** after a successful delete, the stored token is wiped (`endBearerSession`).
- For an OAuth-only account whose session is older than 24 h, "sign in again" means re-running the
  device flow. Make sure that path is offered.

Google Play also wants a **web link** where deletion can be requested without the app
([Google](https://support.google.com/googleplay/android-developer/answer/13327111)): give
`https://play.<domain>/account`, plus the privacy-policy contact for people who can't sign in.

**Sign in with Apple (guideline 4.8).** If the iOS app lets people sign in with Google, Discord,
GitHub or Microsoft, it must *also* offer an equivalent login that limits data to name and email,
lets the user hide their email, and doesn't track. In practice that means Sign in with Apple
([4.8](https://developer.apple.com/app-store/review/guidelines/)). Apps that use *only their own*
account system are exempt. This applies even though our sign-in happens in a browser sheet, because
it is still the app's login. Options:

- **A. Beta (recommended): hide third-party OAuth on iOS.** The app opens `/device?…&client=ios` and
  the web sign-in page hides the OAuth buttons for that request. Email/password, passkeys and guest
  remain, so the app is exempt. Cost $0 extra. Catch: someone who signed up on the web with Google
  only would need to add a passkey or set a password on the website first. Check that "Forgot
  password" works for OAuth-only accounts, or add a "Set a password" option on the web Account page.
  Android has no such rule, so it can show every provider.
- **B. Later: add Sign in with Apple.** Better Auth has an Apple provider, including native ID-token
  sign-in ([Better Auth: Apple](https://www.better-auth.com/docs/authentication/apple)). It needs the
  $99 program (which we already pay for iOS), a Services ID and key, and three extra jobs: register
  our email-sending domain with Apple's private email relay (so mail reaches `@privaterelay.appleid.com`
  addresses), **revoke Apple tokens when an account is deleted** (Apple requires this), and add the
  provider to the privacy policy. Already tracked in TODO as "Sign in with Apple ($99/yr)".

**Age ratings.** Apple's questionnaire (new 4+/9+/13+/16+/18+ tiers since 2025;
[summary](https://9to5mac.com/2025/07/24/apple-notifies-developers-of-new-app-store-age-rating-system/))
and Google's IARC questionnaire:

- The game has no violence beyond abstract piece captures, no gambling, no ads and no purchases.
  User-generated content is limited to usernames and lobby names, and there is no chat yet.
- Our Terms require users to be **13+**, so **pick 13+ on Apple** (a stricter rating than computed is
  allowed) and set Play's target audience to 13+ so the app isn't treated as a children's app
  (Families policy).
- Redo both questionnaires when chat ships.

**Privacy "nutrition label" (Apple) / Data safety (Play), mapped from `docs/legal/privacy-policy.md`:**

| Store category | What we have (policy §) | Linked to user? | Tracking / ads? |
|---|---|---|---|
| Contact info: email | Account email (2.1) | Yes | No |
| Identifiers: user ID | Internal ID, username (2.1, 2.2) | Yes | No |
| User content: gameplay content | Match records, moves (2.2) | Yes | No |
| Diagnostics: crash data | Sentry error reports (2.3) | Yes if the user ID is attached (open CONFIRM note) | No |
| Other data | Age band (2.1) | Yes | No |
| Security: IP / device signals | Rate limiting, Turnstile (2.3; Play: "fraud prevention, security") | Yes | No |
| Device push token (only once push ships) | Not in the policy yet: **add it before push** | Yes | No |

Answers for both stores:

- Data is encrypted in transit. Users can request deletion.
- Nothing is sold, nothing is used for tracking, and we use no advertising ID, so Apple's App
  Tracking Transparency prompt isn't needed.
- Export compliance: HTTPS only, so set `ITSAppUsesNonExemptEncryption = NO`.

**Also required:** a privacy-policy URL, a support URL, and a working **demo account** for Apple
review (guideline 2.1). Also check that solo games against bots run without problems while a
reviewer is testing.

### Phase 5: push notifications (after a friends/challenges feature exists)

There is no friends or challenge system yet. Push for "X challenged you" (or a correspondence-style
"your move") only makes sense once one exists. Today's games are real-time, and the player is in the
app anyway. When it is built:

- Use **FCM for both platforms (free)**. iOS goes APNs through FCM after uploading an APNs `.p8` key
  (needs the paid Apple program) to Firebase.
- Client: `@capacitor/push-notifications` returns an APNs token on iOS and an FCM token on Android
  ([docs](https://capacitorjs.com/docs/apis/push-notifications)). To get FCM tokens on both, use the
  free `@capacitor-firebase/messaging`.
- Server: a `push_tokens` table (user id, platform, token, last seen) and a send call through
  `firebase-admin`. Remove a token when sign-out, account deletion or an FCM "unregistered" error
  says it's dead.
- Ask for notification permission only when the player first sends or receives a challenge, not at
  launch.
- Update the privacy policy (§2.3, and §5.2 processors: Google/Firebase, Apple), then the store
  labels.

---

## 4. Decisions the owner needs to make

1. Ship iOS in the first beta ($99/yr starts now), or Android plus the iOS PWA first?
2. For the iOS app: **A** (hide third-party OAuth) or **B** (add Sign in with Apple)?
3. Bundle id and the store listing name (from `APP_NAME`).
4. Whether phones get a longer reconnect grace than 60 s (a rules/product setting, behind config).
5. iPhone-only or universal (iPad) for iOS.

## Sources

- Apple App Review Guidelines 2.1, 4.2, 4.8, 5.1.1(v): https://developer.apple.com/app-store/review/guidelines/
- Apple, offering account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Apple, passkeys and associated domains: https://developer.apple.com/documentation/authenticationservices/supporting-passkeys
- Apple TestFlight: https://developer.apple.com/testflight/
- WebKit, web push for Home Screen web apps: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Capacitor config (schemes, hostname, CapacitorHttp): https://capacitorjs.com/docs/config
- Capacitor 8 announcement: https://ionic.io/blog/announcing-capacitor-8
- Capacitor push notifications: https://capacitorjs.com/docs/apis/push-notifications
- Better Auth bearer plugin: https://www.better-auth.com/docs/plugins/bearer
- Better Auth one-time token: https://www.better-auth.com/docs/plugins/one-time-token
- Better Auth Apple provider: https://www.better-auth.com/docs/authentication/apple
- Better Auth in Capacitor (third-party guide): https://capgo.app/blog/how-to-use-better-auth-in-capacitor-apps/
- Android WebView passkeys: https://developer.android.com/identity/sign-in/credential-manager-webview
- Google Play account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play 12-tester rule: https://support.google.com/googleplay/android-developer/answer/14151465
- Cloudflare Turnstile in mobile WebViews: https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/
- Codemagic pricing: https://docs.codemagic.io/billing/pricing/
- Firebase pricing: https://firebase.google.com/pricing
- Store fees summary: https://splitmetrics.com/blog/google-play-apple-app-store-fees/
- Apple age ratings 2025: https://9to5mac.com/2025/07/24/apple-notifies-developers-of-new-app-store-age-rating-system/
- WKWebView performance background: https://www.construct.net/en/blogs/construct-official-blog-1/boosting-ios-performance-855
