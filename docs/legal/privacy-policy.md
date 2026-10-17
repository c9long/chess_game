> **[DRAFT — for attorney review before publication. Not yet in effect. Bracketed text in ALL CAPS is a placeholder to fill in. Items marked "[CONFIRM AT IMPLEMENTATION]" must be checked against the shipped code and provider settings. Bracketed "Drafting note" paragraphs are for the reviewing attorney and must be deleted before publication. Before publication, resolve every bracketed or CONFIRM item so that no statement in this policy is aspirational.]**

# Privacy Policy

**[GAME NAME]** (working title: "LinkedLists's Chess Game")

- **Version:** v0.2 (draft)
- **Effective date:** [EFFECTIVE DATE]
- **Last updated:** [EFFECTIVE DATE]

---

## The short version

- We collect only what we need to run a free online chess game: your account details, your games, and basic technical data for security and fixing bugs.
- **We never store your date of birth.** We keep only your age band (13–15, 16–17 or 18+) and the date you confirmed it.
- **We do not sell or share your personal information**, show ads, or track you across other websites. We use **only strictly necessary cookies**.
- You can **download your data** or **delete your account** at any time in Settings. Deletion of your account is immediate. Some records are kept for limited periods (for example, security logs for 90 days and backups for up to 30 days), as explained in Section 8.
- Your past games stay in other players' match histories under a **placeholder name instead of your username**. People who played or watched those games may still recognize them.
- The Service is for people **13 and older**.

The full policy follows. This policy is a notice about our practices; it is not part of the contract in our **Terms of Service** at `play.[DOMAIN]/terms`, which also apply to your use of the Service.

---

## 1. Who we are

**[OPERATOR LEGAL NAME]** ("**we**", "**us**", "**our**"), [ADDRESS], operates the Game. We are the "controller" (or "business") responsible for your personal information.

This policy covers the website and web game at `play.[DOMAIN]`, our servers at `api.[DOMAIN]`, any downloadable client we release (including a future PC client on Steam), and emails we send (together, the "**Service**").

Contact: [PRIVACY CONTACT EMAIL]. See Section 16.

## 2. Information we collect

### 2.1 Information you give us

| Category | What exactly | When |
|---|---|---|
| **Age band** | Your age band (13–15, 16–17 or 18+) and the date you confirmed it. **We never store your date of birth.** It is checked when you submit it and then discarded; it is not written to our database or logs. | First visit, before signup or your first guest game |
| **Account details** | Email address; username; whether your email is verified; account creation date. | Signup |
| **Password** | Stored only as a one-way **argon2id hash**. We never store or log your actual password and cannot see it. | Signup / password change |
| **Passkeys** (optional) | The public key and credential ID your device creates, plus a label for the passkey. Your fingerprint, face or device PIN **never leaves your device** and is never sent to us. | When you add a passkey |
| **Two-step verification** (optional) | Your authenticator (TOTP) secret and backup codes, **encrypted** in our database. | When you turn it on |
| **Agreement records** | Which version of the Terms you accepted and which version of this Privacy Policy you acknowledged, when, and a pseudonymized (keyed-hash) form of the IP address used at that moment. | Each time you accept or acknowledge |
| **Messages to us** | Your email address and whatever you include when you contact us (support, appeals, privacy requests, copyright notices). | When you contact us |
| **Copyright (DMCA) records** | Copyright notices and counter-notices (including the sender's contact details), the account they concern, strike history, and a keyed hash of that account's email address. | When a notice or counter-notice is sent |
| **Reports** | When you report a player: who reported whom, the reason you chose (offensive username, harassment, cheating or something else), your optional note (up to 500 characters), the game it came from (if any), the reported player's username at that moment, and when. Guests can report too. | When you submit a report |
| **Blocks** (registered accounts only) | The players you blocked and when. | When you block someone |
| **Chat** (planned) | If we add chat, we will update this policy before launch to explain what is collected and how long it is kept. | — |

### 2.2 Information created when you play

| Category | What exactly |
|---|---|
| **Guest account** | A random guest name (for example, "Guest-4821"), an internal ID, a guest flag, and creation and last-activity dates. |
| **Lobbies** | Lobby name, mode, time control, who is seated where, ready state. A lobby password, if set, is stored only as a hash. Lobbies exist only in server memory and disappear when the lobby closes. |
| **Match records** | For each game: mode, time control, whether it was rated, rules version, start and end times, how it ended; for each seat: the player (or bot level), team, chosen civilization, finishing place, how and when the player was defeated, and rating before and after. |
| **Moves and events** | Every move and game event (promotions, passes, defeats, time-outs, abandonments, disconnects and reconnects, game end), with clock times and server timestamps. |
| **Ratings** | Your rating, number of ranked games and highest rating for each mode and time control, and a hidden internal rating used only to calibrate bot strength. |
| **Sessions** | A session record for each signed-in browser or device, including when it was created and when it expires. |
| **Friends** (registered accounts only) | Your friends list and friend requests: who asked whom, and when the request was sent and accepted. You can only send a request to someone you are playing or have finished a game with. Whether you are online right now (connected to the Service in an open app or browser tab) is worked out live and **not stored**. Challenges you send or receive (who invited whom to which lobby) exist only in server memory and disappear within 5 minutes or when the lobby starts or closes. |

### 2.3 Information collected automatically

| Category | What exactly | Why |
|---|---|---|
| **IP address** | Your IP address, as passed to us by Cloudflare. | Security, rate limiting (for example, limiting login and lobby-password attempts), and abuse prevention. Kept in security logs for 90 days. |
| **Device and browser information** | Browser type and version, operating system, screen size, and language. | Compatibility and fixing errors. |
| **Error reports** | When something breaks, a crash/error report with technical details (error message, code location, browser and OS version, page URL, time, and [your internal user ID]). | Fixing bugs. |
| **Bot-protection signals** | Cloudflare Turnstile checks whether a visitor is human when you sign up, sign in or start as a guest, using signals from your browser. | Stopping automated account creation and password guessing. |
| **Account-linking signals** | IP addresses, session and device identifiers [and browser characteristics] compared across accounts. | To detect multi-accounting, ban evasion and rating manipulation. Kept with security logs (90 days) or with the related moderation record. |

> [CONFIRM AT IMPLEMENTATION: If no account-linking signals are used, delete that row and "related-account signals" in Section 4.]
>
> [CONFIRM AT IMPLEMENTATION: Configure Sentry to scrub IP addresses, email addresses, cookies and request bodies from error events, and decide whether to attach the internal user ID. Update the "Error reports" row to match.]

### 2.4 Information from sign-in providers

If you choose to sign in with **Google, Discord, GitHub or Microsoft** (or, in the future, **Steam**), that provider sends us information to identify you. We request only the minimum permissions needed to sign you in.

| Provider | What we receive and keep |
|---|---|
| Google, Discord, GitHub, Microsoft | Your account ID with that provider and your email address (and whether the provider has verified it). Providers may also send your display name and profile picture; [we do not store them / we use them only to pre-fill your username]. |
| Steam (future) | Your SteamID64, whether you own the game on Steam, and whether Valve reports a publisher ban on your Steam account. |

We never receive your password for those services. We do not post anything to those accounts or access your contacts.

> [CONFIRM AT IMPLEMENTATION: Choose the bracketed option above to match the OAuth scopes and the fields Better Auth persists.]

### 2.5 What we do not collect

We do **not** collect: your date of birth; your real name (unless you choose to put it in your username or email address); precise location; contacts; photos; payment information (the Service is currently free); advertising identifiers; or biometric information.

## 3. Where your information comes from

- **You**, when you sign up, play, change settings or contact us.
- **Your device and browser**, automatically, when you use the Service.
- **Sign-in providers** you choose to use (Section 2.4).
- **Cloudflare**, which provides us with security signals (Turnstile results and your IP address).
- **Valve (Steam)**, if you use a future Steam client.
- **Other players**, if they report conduct involving you (once reporting is available).

## 4. How we use your information, and our legal bases

If you are in the European Economic Area (EEA), the United Kingdom or Switzerland, data-protection law requires us to have a "legal basis" for each use. **We do not rely on your consent** as a legal basis for any of the uses below.

| Purpose | Information used | Legal basis (EEA/UK) |
|---|---|---|
| Create and run your account or guest account; sign you in; keep you signed in | Account details, password hash, passkeys, two-step secrets, sign-in provider IDs, sessions | **Contract** — necessary to provide the Service you asked for |
| Run lobbies and games; enforce clocks and rules; show results | Lobby data, match records, moves and events, username, civilization | **Contract** |
| Calculate and display ratings; keep match history; let you and other players review past games | Match records, ratings | **Contract** |
| Friends: friend requests, friends lists, showing your friends when you are online, and challenges to private games | Friends list and requests, online status, username, match records (to check you played together) | **Contract** |
| Blocking: keeping players you blocked from sending you friend requests or challenges, and from seeing you online | Blocks, friends list and requests | **Contract** |
| Moderation: reviewing reports, refusing offensive or impersonating usernames, warning players, resetting usernames and suspending accounts | Reports, username, match records and events of the reported game, account status | **Legitimate interests** (keeping the Service safe and fair for all players, and enforcing our Terms) |
| Upgrade a guest account to a registered account while keeping your history; merge a Steam account with a web account | Guest account, match records, ratings, agreement records | **Contract** |
| Send transactional emails (email verification, password reset, sign-in and security alerts, important changes to these documents) | Email address | **Contract**; for security alerts, also **legitimate interests** (protecting your account) |
| Check that users are 13 or older, record their age band, and apply under-18 defaults | Age band and date | **Legitimate interests** (keeping the Service limited to its intended audience, applying age-appropriate defaults, and meeting our obligations under US children's-privacy law) |
| Record your acceptance of the Terms and your acknowledgment of this Privacy Policy | Agreement records | **Legitimate interests** (being able to show what was agreed) |
| Protect the Service: rate limiting, preventing account takeover, bot protection, blocking attacks | IP address, Turnstile signals, security logs, sessions | **Legitimate interests** (keeping the Service and accounts secure) |
| Fair play: detect cheating, collusion, rating manipulation and abuse; moderate usernames and lobby names; handle reports and appeals | Match records, moves and timings, ratings, usernames, account-linking signals (Section 2.3), reports | **Legitimate interests** (fair competition and a safe community) and **contract** (enforcing the Terms) |
| Calibrate bot strength | Hidden internal rating from casual games against bots | **Legitimate interests** (accurate bot difficulty) |
| Fix bugs, keep the Service running, and plan capacity | Error reports, device and browser information, aggregated usage counts | **Legitimate interests** (a working, reliable Service) |
| Back up data and restore it after failure | All account and game data | **Legitimate interests** (not losing your account and history) |
| Keep past games in other players' histories after you delete your account | Match records, moves and ratings history, linked to an internal ID under a placeholder name | **Legitimate interests** (our and other players' interest in accurate match histories and ratings) |
| Respond to your messages and privacy requests | Contact details and message content | **Contract**, **legal obligation** (for privacy requests) |
| Comply with law; respond to valid legal requests; handle copyright notices and administer our repeat-infringer policy; establish or defend legal claims | Any relevant information, including copyright (DMCA) records | **Legal obligation** where EU/UK law requires it; otherwise **legitimate interests** (responding to valid legal process in other countries, meeting US copyright-law requirements, and defending legal claims) |

Where we rely on legitimate interests, we have balanced our interests against your rights. You can object (Section 11). Our uses are limited and expected for an online game, and we do not use your information for advertising or profiling for marketing.

**Do you have to give us personal information?** You don't have to give us personal information, but some is needed to provide the Service. Without completing the age screen you cannot play. Without an email address (or a sign-in provider) you can play only as a guest, which means casual games only and an account that expires after 30 days of inactivity. Without IP address and browser signals we cannot protect the Service, so we cannot serve you. No law requires you to provide personal information to us.

**Automated decisions.** Ratings are calculated automatically from game results. We may use automated tools to flag possible cheating or abuse, but [a person reviews flags before any permanent ban]. We do not make decisions with legal or similarly significant effects about you based solely on automated processing.

> [Drafting note: For EEA users aged 13–17, reliance on "contract" depends on the minor's capacity to contract under national law. Because consent is not relied on, the Art. 8 GDPR child-consent ages (13–16 by member state) do not apply, but the UK Children's Code and EU guidance on minors still expect high-privacy defaults. TODO.md flags this for before any EU/UK users are accepted.]

## 5. Who can see your information

### 5.1 Other players

Your **username**, **civilization emblem**, seat, ready status, moves and results are visible to other players in your lobbies and games. [Your ratings and match history are visible to other players on your profile and on game results.] Once you have played enough ranked games, your username, ratings and number of ranked games appear on public leaderboards that anyone can view. Treat your username as public.

> [CONFIRM AT IMPLEMENTATION: whether profiles, ratings and match history are public, visible to signed-in users only, or private. Update the bracketed sentence.]

**Friends.** If you add friends, each of your friends can see that you are friends, your username, and **whether you are online right now**. Online status is shown only to your accepted friends, never to other players. Someone you sent a friend request to (or who sent you one) sees your username and when the request was sent. When you challenge friends, the friends you invite see your username, the game settings and the names of the others invited. Removing a friend, or deleting your account, ends all of this at once.

**Blocking.** If you block a player, they are not told. They stop seeing you online and can no longer send you friend requests or challenges (they get the same message as for any player they can't add). Any friendship or friend request between you is removed, so they may notice that it is gone. Blocking doesn't remove anyone from a game that is already running.

**Reports.** If you report a player, **we never tell them who reported them**. Reports are seen only by our moderators. If we act on a report (a warning, a username reset or a suspension), the reported player may learn of the action, but not of the reporter.

### 5.2 Service providers (processors)

We use the following companies to run the Service. They process personal information under data processing agreements (we accept their standard terms) that limit their use of it to providing services to us, except limited use for security and service improvement as their agreements allow.

| Provider | What they do for us | Information involved | Location |
|---|---|---|---|
| **OVHcloud US** | Server hosting (our game server, database and bots run on a virtual server in US-East / Virginia) | All account and game data | United States |
| **Cloudflare, Inc.** | Website hosting (Cloudflare Pages), DNS, content delivery, DDoS protection, HTTPS, bot protection (Turnstile)[, and encrypted off-site backups (Cloudflare R2)] | IP address, request data, browser signals; [encrypted backups] | Global network; United States |
| **[Backblaze, Inc.]** | [Encrypted off-site backups (if used instead of Cloudflare R2)] | [Encrypted backups of account and game data] | [United States] |
| **Resend (Plus Five Five, Inc.)** | Sending transactional emails | Email address, email content, delivery status | United States |
| **Functional Software, Inc. (Sentry)** | Error and crash reporting[, uptime monitoring] | Error reports, device and browser information[, internal user ID] | United States |
| **[Better Stack]** | [Uptime monitoring] | [No personal information beyond request metadata] | [CONFIRM] |

> [CONFIRM AT IMPLEMENTATION: Review the Cloudflare DPA and Turnstile privacy addendum for any controller-role use of bot and security signals, and describe it here if it exists.]
>
> [CONFIRM AT IMPLEMENTATION: Keep only the backup and uptime providers actually used, verify each provider's legal entity name and DPA, and select US data residency where offered (e.g. Sentry US region).]

### 5.3 Sign-in providers and Valve

**Google, Discord, GitHub, Microsoft** and (in the future) **Valve (Steam)** are not our processors. When you choose to sign in with them, they handle your information under their own privacy policies. We send them only what is needed to complete the sign-in (for example, a request to confirm who you are, or a Steam authentication ticket to verify).

### 5.4 Legal reasons and safety

We may disclose information if we believe in good faith it is reasonably necessary to: comply with law or a valid legal process (such as a subpoena or court order); protect the safety of any person (including reporting apparent child exploitation to NCMEC and law enforcement); investigate fraud, security issues or violations of our Terms; or protect our rights or property. Where permitted, we will tell you about a government request for your information.

### 5.5 Business transfers

If we are involved in a merger, acquisition, financing, reorganization or sale of assets, your information may be transferred as part of that transaction, subject to this policy. We will notify you before your information becomes subject to a different privacy policy.

### 5.6 No selling, no sharing, no advertising

**We do not sell your personal information. We do not "share" it for cross-context behavioral advertising.** We do not use advertising networks, advertising cookies, data brokers, or tracking pixels, and we do not let third parties track you across websites through our Service. We have not done any of these things in the past 12 months.

## 6. Cookies and similar technologies

We use **only strictly necessary cookies and browser storage**, needed to provide the Service you asked for. We do **not** use analytics, advertising or social-media cookies, so we do not show a cookie consent banner.

| Name (example) | Set by | Purpose | Duration |
|---|---|---|---|
| Session cookie (e.g. `__Secure-…session_token`) | Us | Keeps you signed in (as a guest or registered player). Secure, HttpOnly, SameSite=Lax. | Until sign-out or session expiry ([X] days) |
| Sign-in state / security cookies | Us | Protect sign-in (including OAuth, passkey and two-step flows) against forgery (CSRF) | Minutes, or the session |
| Age-screen cookie | Us | Remembers that the age screen was not passed on this browser, so it cannot be immediately retried. Contains no birth date or other personal details. | [X days] |
| Preferences (browser storage) | Us | Remembers settings such as sound, board theme and the last civilization you chose | Until you clear it |
| `__cf_bm`, Turnstile cookies | Cloudflare | Bot and abuse protection | Up to 30 minutes / per Cloudflare |

> [CONFIRM AT IMPLEMENTATION: exact cookie names and lifetimes from Better Auth and Cloudflare configuration.]
>
> [Drafting note: The age-screen retry-blocking cookie is used to comply with COPPA guidance rather than to deliver a service the visitor requested; counsel should confirm it fits the EU ePrivacy "strictly necessary" exemption or treat it as a legal-obligation measure. It stores no personal details.]

If we ever add analytics or other non-essential cookies, we will update this policy and ask for consent where the law requires it.

## 7. Do Not Track and Global Privacy Control

Because we **do not track you across third-party websites** over time and do not sell or share personal information, browser "**Do Not Track**" signals and **Global Privacy Control (GPC)** signals do not change how the Service behaves: we already treat every visitor as opted out of sale, sharing and cross-site tracking. No third party is permitted to collect personal information about your online activities over time and across different websites through our Service.

> [CONFIRM AT IMPLEMENTATION: no third-party scripts, fonts, pixels or SDKs (including OAuth SDKs such as Google Identity Services) load from non-Cloudflare domains on our pages. If any do, disclose them here, because the provider can see that activity. Review the Cloudflare DPA and Turnstile privacy addendum for any controller-role use.]

## 8. How long we keep information

When you delete your account, we remove your email, username, sign-in methods and sessions. Your past games stay in other players' records under a placeholder name. They are still linked to an internal ID, so they may be identifiable to people who played or watched those games. We keep them on the basis of our and other players' legitimate interest in accurate match histories and ratings. [CONFIRM AT IMPLEMENTATION: at deletion, the internal ID on those games is replaced with a fresh random ID that is not kept in the deletion log (PLAN §5).]

| Information | How long |
|---|---|
| **Registered account** (email, username, sign-in methods, settings) | Until you delete your account. Deletion takes effect **immediately**. |
| **On account deletion** | Email and username are replaced with "Deleted player #…"; passwords, passkeys, sessions, two-step secrets, sign-in provider links, friends lists, friend requests and blocks are **deleted**; the IP hash on agreement records is cleared. Reports you filed or that were filed about you are kept for the periods below, linked only to the placeholder; the username recorded in reports about you is deleted. |
| **Guest accounts** | **Purged after 30 days of inactivity.** Guests with no games are deleted; for guests with games, the guest details are removed and the games are kept under a placeholder name as described above. |
| **Match records, moves and ratings history** | Kept for as long as the Service runs, so other players' histories, ratings and replays stay accurate. **After you delete your account (or a guest account is purged), they are kept in de-identified form** under a placeholder name and are no longer linked to your email or username. They remain linked to an internal ID and may be recognizable to people who played or watched those games. |
| **Age band** | For the life of the account (as part of the account record); deleted with the account's other details. |
| **Agreement records** (document, version, date) | For the life of the account and afterwards in de-identified form (without the IP hash), so we can show which terms applied. |
| **Deletion log** (internal user ID and deletion date only) | Indefinitely. [CONFIRM AT IMPLEMENTATION: the log does not keep the replacement ID given to the deleted user's past games.] It is re-applied after any restore from backup so that **deleted accounts never come back**. |
| **Security logs** (including IP addresses) | **90 days**, unless needed longer to investigate a specific security incident or abuse. |
| **Error reports** (Sentry) | [30 days on the Sentry Developer plan / 90 days on the Team plan — CONFIRM the plan in use]. |
| **Email delivery records** (Resend) | [CONFIRM: per Resend plan, e.g. 30 days]. |
| **Lobbies** | Only in server memory; gone when the lobby closes. |
| **Sessions** | Until sign-out or expiry; deleted on account deletion. |
| **Friends lists and friend requests** | Until you (or the other player) remove the friend, decline or cancel the request. **Deleted, not de-identified, when you delete your account.** Online status is never stored; challenges live only in server memory for at most 5 minutes. |
| **Blocks** | Until you unblock the player. **Deleted when either account is deleted.** |
| **Reports** | Open reports until a moderator reviews them. Reviewed reports (resolved or dismissed), including who handled them, when, and what was done, are **deleted 1 year after the review**. |
| **Suspensions** | The date and the moderator who suspended the account, until the suspension is lifted or the account is deleted. |
| **Support, appeal and privacy-request emails** | [2 years] after the matter is closed, or longer if needed for a legal claim. |
| **Moderation records** (e.g. reasons for a ban) | [For as long as needed to enforce the ban, up to [X] years]. |
| **Copyright (DMCA) records** (notices, counter-notices, strike history, hashed email of the affected account) | [3] years after the last notice, including after account deletion, to administer our repeat-infringer policy (**legitimate interests**: meeting US copyright-law requirements and preventing terminated repeat infringers from re-registering). |
| **Backups** | Encrypted, off-site, on a rolling basis. **Backups roll off within 30 days**, so deleted data disappears from backups within 30 days, unless a copy must be preserved to investigate a specific security incident or for a legal claim, in which case it is kept only for that purpose and deleted when the matter is closed. |

> [Drafting note: If counsel wants to prevent banned users from deleting and immediately re-registering with the same email, consider keeping a salted hash of a banned account's email for the ban period and disclosing it in the "Moderation records" row.]

## 9. How we protect your information

- **Encryption in transit:** HTTPS/TLS everywhere, between your browser, Cloudflare and our server.
- **Passwords:** hashed with **argon2id**, a modern, memory-hard algorithm. Lobby passwords are hashed too.
- **Two-step secrets** are encrypted at rest. **Passkeys** are phishing-resistant and we store only public keys.
- **No plaintext secrets** in our database or logs.
- **Network protection:** our server accepts web traffic only through Cloudflare; DDoS protection, rate limits and bot protection (Turnstile) guard sign-in and guest creation.
- **Backups** are encrypted and stored off-site.
- **Access control:** only the people who operate the Service can access production systems, using strong authentication [with MFA].
- **Session and cookie protections:** Secure, HttpOnly, SameSite cookies; strict cross-origin (CORS) rules.
- **Data minimization:** we never store your birth date, store only a keyed hash, not the raw IP, for agreement records, and keep raw IP addresses for only 90 days.

No system is perfectly secure. Protect your account by using a unique password, a passkey, or two-step verification.

## 10. If there is a data breach

If a security incident affects your personal information, we will investigate promptly, take steps to contain it, and **notify you and the relevant authorities as and when required by law** (for example, by email to the address on your account, and, for users in the EEA or UK, notifying the relevant data protection authority within 72 hours where required). Notices will explain what happened, what information was involved, what we are doing, and what you can do.

## 11. Your rights and choices

### 11.1 Rights available to everyone

Wherever you live, you can:

| Right | How |
|---|---|
| **Access / download (portability)** | **Settings → Download my data** gives you a JSON file with your profile, ratings, match history, friends and friend requests, the players you blocked, and the reports you filed (without the reported player's details). Or email us for a copy of other information we hold. Reports filed about you are not in the download; on request we tell you about them without revealing who filed them. |
| **Correct** | Change your email or password in Settings. Usernames can't be changed during the beta (a moderator may reset an offensive username, and you then choose a new one). Email us to correct anything else. |
| **Delete** | **Settings → Delete account** deletes immediately (see Section 8). Or email us. |
| **Disconnect sign-in providers** | Settings → Sign-in methods (as long as one sign-in method remains). You can also revoke our access in your Google, Discord, GitHub, Microsoft or Steam settings. |
| **Object / ask us to restrict** | Email us. We will stop or limit a use based on legitimate interests unless we have compelling grounds, or need it for legal claims. |
| **Appeal** | If we deny your request, reply to our decision within [60] days and ask us to reconsider. We will respond within 60 days (or as required by law). If we still deny it, you can complain to your state attorney general or data protection authority. |

To make a request by email, write to [PRIVACY CONTACT EMAIL] **from the email address on your account** (or include your username and, for guests, your guest name). We will verify your identity before acting, usually by confirming control of the account's email address or by asking you to sign in. We respond within **30 days** (or sooner if required), and may extend once where the law permits. We do not charge for requests unless they are manifestly unfounded or excessive.

**Guest accounts** cannot be verified by email. If you are signed in as a guest, you can use **Settings → Download my data** and **Settings → Delete guest account** in the same browser, or upgrade to a registered account first. You can also email us from the same browser session using the reference code shown in Settings. [CONFIRM AT IMPLEMENTATION: guest export/delete tools and reference code exist (PLAN §8).]

**Match history after deletion.** If you delete your account, we keep your past games in de-identified form under a placeholder name (Section 8) because they are also part of other players' records.

### 11.2 California and other US state residents

We provide the rights in this section to all users. Depending on how many residents of a state use the Service, some state privacy laws (such as those of Connecticut, Virginia, Texas and others) may apply to us. Whether or not they apply, we give all users the rights described here.

**Categories of personal information** we have collected in the past 12 months (CCPA categories):

| CCPA category | Examples | Disclosed for a business purpose to |
|---|---|---|
| Identifiers | Email, username, internal IDs, IP address, sign-in provider IDs, SteamID (future), session and device identifiers used as account-linking signals | Hosting, CDN/security, email and error-reporting providers |
| Account login credentials (sensitive personal information) | Password hash, passkey public keys, encrypted two-step secrets | Hosting provider (stored in our database) |
| Characteristics of protected classifications | Only your age band (13–15, 16–17 or 18+; no birth date) | Hosting provider |
| Internet or electronic network activity | Game moves and events, session data, security logs, error reports, account-linking signals [and browser characteristics] | Hosting, CDN/security and error-reporting providers |
| Inferences | Ratings and skill estimates (used only for matchmaking, display and bot calibration) | Hosting provider |

**Sources, purposes and retention:** see Sections 3, 4 and 8.

**Your rights:** to know what personal information we collect, use and disclose; to access and receive a portable copy; to correct; to delete; to opt out of sale or sharing (**we do not sell or share**, including of users under 16); and to limit use of sensitive personal information (**we use it only to provide the Service and keep it secure**, as the law permits, so there is nothing to limit). **We will not discriminate against you** for exercising any right.

**Authorized agents:** you may use an authorized agent to make a request. We may ask for written proof of the agent's authority and ask you to verify your identity directly.

**"Shine the Light" (Cal. Civ. Code § 1798.83):** we do not disclose personal information to third parties for their direct-marketing purposes.

### 11.3 EEA, UK and Swiss residents

In addition to the rights above, you have the right to **lodge a complaint** with your local data protection authority (or, in the UK, the Information Commissioner's Office). We would appreciate the chance to address your concern first: contact us at [PRIVACY CONTACT EMAIL].

Our EU representative under Article 27 GDPR is [NAME, ADDRESS, EMAIL]; our UK representative under Article 27 UK GDPR is [NAME, ADDRESS, EMAIL].

> [Drafting note: Do not publish a statement that no representative has been appointed. The Art. 27(2) exemption covers only occasional, low-risk processing, which a live game with continuous accounts (including teenagers) is not, and Art. 3(2)(b) "monitoring" can be triggered by anti-cheat timing analysis and ratings. Before launch, either (a) appoint EU and UK representatives and fill in the sentence above, or (b) decide in writing, with counsel, not to offer the Service in the EEA/UK, enforce that with geo-blocking and the bracketed eligibility bullet in Terms Section 3.3, and replace Sections 11.3 and 13's EEA/UK language accordingly.]

## 12. Children's privacy

The Service is **not directed to children under 13**, and we do not knowingly collect personal information from children under 13.

- **Neutral age screen.** Before anyone can sign up or play as a guest, we ask for a full date of birth with nothing pre-selected, without saying what age is required.
- **If you are under 13**, we do not create an account or store anything about you, except a cookie that prevents the age screen from being immediately retried on that browser (Section 6).
- **We never store birth dates.** We keep only your age band (13–15, 16–17 or 18+) and the date you confirmed it.
- **If we learn** that we have collected personal information from a child under 13 (for example, from a report, a parent, or something the user says), we will **promptly delete** the account and its personal information. In each of the child's past games, the child's seat is replaced with a "Removed player" value that is not linked to any ID, so the child's history cannot be pieced back together.
- **Parents and guardians:** if you believe your child under 13 has used the Service, contact [PRIVACY CONTACT EMAIL] and we will delete the information.

**Users aged 13–17** need a parent or guardian's permission to use the Service (see the Terms). We do not sell or share their information, do not show them targeted ads, and do not make their information available for anyone's marketing. If you are under 18, your profile and match history are [private / visible only to players you have played with] by default.

> [CONFIRM AT IMPLEMENTATION: choose the under-18 default and implement it from the stored age band.]

## 13. International users and data transfers

We are based in the United States, and our servers are in the **United States** (US-East). If you use the Service from outside the US, your information will be transferred to, stored and processed in the US, where data-protection laws may differ from those in your country.

When you use the Service from the EEA, UK or Switzerland, you send your information directly to us in the United States. When we share it with our US service providers, we rely on the **EU-US Data Privacy Framework** (and its UK and Swiss extensions) where the provider is certified, and otherwise on the **European Commission's Standard Contractual Clauses** (with the UK Addendum) in their data processing agreements. You can request a copy of these safeguards at [PRIVACY CONTACT EMAIL].

> [Drafting note: The operator is not itself DPF-certified. For a controller without an EU establishment collecting directly from EU users, the Chapter V transfer rules apply to onward transfers rather than to the user's own direct submission (EDPB Guidelines 05/2021). The Art. 49(1)(b) contract derogation was removed because it covers only occasional, non-systematic transfers (EDPB Guidelines 2/2018). Before publication, check each processor's DPF certification at dataprivacyframework.gov and confirm SCCs are in each DPA.]

## 14. Third-party links and services

The Service may link to websites or services we don't control, including sign-in providers. This policy does not cover them; please read their privacy policies.

## 15. Changes to this policy

We may update this policy, for example when we add features like chat or a Steam client. We will post the new version with a new **version number** and **effective date** at the top.

- For **material changes**, we will notify you **by email** (if you have an account with an email address) **and/or by a prominent notice in the Service** at least **14 days** before the change takes effect, and we will ask you to acknowledge that you have seen the updated policy.
- We will not use personal information collected under an earlier version in a materially different way without giving you that notice (and, where required by law, getting your consent).
- Previous versions are available on request [or at `play.[DOMAIN]/privacy/history`].

## 16. Contact us

**[OPERATOR LEGAL NAME]**
[ADDRESS]
Privacy questions and requests: [PRIVACY CONTACT EMAIL]
Security issues: [SECURITY CONTACT EMAIL]

---

*Version v0.2 (draft) · Effective [EFFECTIVE DATE]*
