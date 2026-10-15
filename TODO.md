# TODO — single source of truth

Conventions (see [CLAUDE.md](CLAUDE.md)):
- "Add to to-do" means adding an item here.
- Completed items are struck through in place with the date: `~~item~~ (done YYYY-MM-DD)`. Nothing is deleted. There are no checkboxes.
- Section references (§) point to [docs/PLAN.md](docs/PLAN.md).

---

## Now — v1 build

### M0 — Foundation
- ~~Monorepo: pnpm workspaces + Cargo workspace, shared TS config, Biome lint/format~~ (done 2026-10-14)
- ~~`packages/config` with `APP_NAME`~~ (done 2026-10-14)
- ~~README rewritten for the working title (old "Civilization Chess" tagline removed)~~ (done 2026-10-14)
- ~~`docs/PLAN.md`, `TODO.md`, `CLAUDE.md`~~ (done 2026-10-14)
- ~~GitHub Actions CI (Rust fmt/clippy/test + TS lint/typecheck/test)~~ (done 2026-10-14)
- ~~Dev database setup script for local PostgreSQL (`infra/dev-db.sh`)~~ (done 2026-10-14)
- Docker Compose file for the dev/prod stack — `infra/docker-compose.yml` written (Postgres) but untested: Docker isn't installed on the dev machine (needs sudo). Verify once Docker is available.

### M1 — Rules core (Rust) — §2
- ~~Board geometry, coordinates, square colors, seats, turn order~~ (done 2026-10-15)
- ~~Piece roster + leader roles (data-driven), standard v1 roster for all civs~~ (done 2026-10-15)
- ~~Starting setup for all four seats (exact squares per §2)~~ (done 2026-10-15)
- ~~Pseudo-legal move generation for all four orientations (no self-check filtering)~~ (done 2026-10-15)
- ~~Promotion on the first line past center (S rank 7, N rank 6, W file g, E file f), non-leader non-pawn pieces only~~ (done 2026-10-15)
- ~~Castling: single-leader civs only, ACTIVE seats only, no attack restrictions~~ (done 2026-10-15)
- ~~En passant per §2, behind a rules-config flag (pending confirmation)~~ (done 2026-10-15)
- ~~Seat statuses (ACTIVE / DEFEATED / FROZEN / REMOVED), leader capture, stalemate-once then auto-pass, timeout/abandon hooks~~ (done 2026-10-15)
- ~~FFA removal vs Teams defeated/frozen; game end and placements~~ (done 2026-10-15)
- ~~Move-limit counter (25 × seats still taking turns)~~ (done 2026-10-15)
- ~~Move notation + serialization; `rules_version`; empty civ-modifier hooks~~ (done 2026-10-15)
- ~~Perft tests, rule unit tests, randomized self-play fuzzing~~ (done 2026-10-15)
- ~~WASM bindings (`rules-wasm`) with identical results to native~~ (done 2026-10-15; `crates/rules-wasm` + typed `@game/rules` wrapper, JS-side perft matches native)
- ~~`docs/RULES.md` player-facing rules~~ (done 2026-10-15)

### M2 — Board renderer (web) — §3
- ~~PixiJS board, original piece and board art, seat colors (colorblind-safe)~~ (done 2026-10-15; `packages/board` (`@game/board`): procedural shader board, lit piece atlas from `packages/assets`, CVD-checked palette + optional shape markers)
- ~~Animations: move, capture particles, FFA army dissolve, Teams grey/freeze~~ (done 2026-10-15)
- ~~Move hints, drag/click to move, promotion picker, auto-rotation, sounds~~ (done 2026-10-15; basic keyboard control; screen-reader announcements not yet)
- ~~Optional attacked-leader glow (default decided in Open rules questions)~~ (done 2026-10-15; `showAttackedLeaderGlow` option, off by default until the open question is decided)
- ~~Hot-seat sandbox in dev/staging builds only~~ (done 2026-10-15; `pnpm --filter @game/board sandbox`, a separate Vite page, not part of apps/web)
- ~~Civ emblem SVGs (placeholder-quality originals until final art)~~ (done 2026-10-15; working art in `packages/assets/emblems`, China/Mali flagged for refinement in final art pass)
- Board: mount `@game/board` in the apps/web game screen (with M5 live games)
- Board: screen-reader move announcements (aria-live) and a full keyboard pass
- Board: confirm 60 fps at 1440p on a real mid-range GPU (only software-rendered so far)
- Board art pass: illustrator pass on the knight (mane, muzzle) and wider bases/collars across the piece set (packages/assets/pieces)
- Board art pass: simplified heavy-stroke emblem variants for Mali, China and Russia for medallions under ~72 device px
- Board: install binaryen (wasm-opt) in CI/release builds so the rules wasm ships size-optimized (the build now warns when it is missing)

### M3 — Accounts + legal — §1, §5, §8
- ~~Better Auth: email/password (argon2id via custom hash/verify), verification and reset via Resend~~ (done 2026-10-15)
- ~~OAuth: Google, Discord, GitHub, Microsoft~~ (done 2026-10-15) (each provider switches on when its env credentials exist; not yet tried against live providers, see Before public release)
- ~~Passkeys; TOTP MFA + backup codes (`allowPasswordless: true`)~~ (done 2026-10-15)
- ~~Guests + history-preserving upgrade (row re-pointing in `onLinkAccount`)~~ (done 2026-10-15)
- ~~Turnstile, rate limits, real client IP behind Cloudflare~~ (done 2026-10-15)
- ~~Neutral date-of-birth screen, versioned clickwrap, `legal_acceptances`~~ (done 2026-10-15)
- Legal drafts in `docs/legal/` (Terms with dispute options A/B, Privacy Policy, incident-response runbook)
- ~~Account deletion (anonymize) + JSON export + `deletion_log`~~ (done 2026-10-15)
- ~~Review fixes: guest upgrade bound to the guest's own signup (verification links no longer sign in or merge for whoever opens them; works across devices); sign-in merges a guest only on an explicit "move my games" choice~~ (done 2026-10-15)
- ~~Review fixes: deletion re-keys match_players/ratings/legal_acceptances to a random placeholder id not kept in `deletion_log`; purged guests are logged too; `reapplyDeletionLog()` for restores~~ (done 2026-10-15)
- ~~Review fixes: age band (13–15 / 16–17 / 18+) stored instead of a bare flag; `legal_acceptances.kind` (Terms accepted, Privacy acknowledged); clickwrap wording per §8 with the Option A arbitration line behind `DISPUTE_OPTION`~~ (done 2026-10-15)
- ~~Review fixes: OAuth signup requires the clickwrap (server hook + disabled buttons), never shows the provider's name, and asks for a username~~ (done 2026-10-15)
- ~~Review fixes: production config fails closed (explicit NODE_ENV, https origins, rpID, separate IP_HASH_SECRET, Cloudflare trust, rate limits on, no siteverify override); signed gate cookies expire server-side; session token never exposed to page scripts; display names follow the name policy; per-account password throttle; hashed verification tokens; encrypted OAuth tokens~~ (done 2026-10-15)
- ~~Review fixes: verification-email recovery (resend on sign-in, resend page), duplicate-signup notice email, 2FA challenge errors, return to the original page after sign-in, device-approval confirmation step, backup codes (unambiguous, case-insensitive, regenerate), passkey remove/rename, Turnstile failure state, legal tables on phones~~ (done 2026-10-15)
- Mount `requireCurrentAcceptance` (server-side clickwrap check) on every lobby/game route in M4
- Deleting a registered account with a stale session: also accept a passkey or TOTP step-up (password step-up exists)
- Show how many backup codes remain (needs a server endpoint; regenerating works)
- Email the account owner when password sign-in gets locked by the per-account throttle
- Product/legal call: after an under-13 answer, should signing in to an existing, already age-confirmed account stay blocked for 24 h (current behavior) or be allowed?

### M4 — Lobbies — §3
- Colyseus lobby list + lobby room; create (mode, time control, optional hashed password with attempt limits)
- Seats/teams, host controls, ready/start, session-bound seats
- Blind civ pick with emblems beside usernames
- Bot seats with level picker and random-but-editable civ

### M5 — Live games — §2, §5
- Authoritative game room, server clocks (10+0, 3+2), reconnect grace + abandon
- All defeat paths, end screen
- Incremental event persistence, abort-on-restart, re-simulation check
- OpenSkill ratings (public + hidden shadow ratings)

### M6 — Bots — §6
- ~~Teams team-signed alpha-beta, FFA BRS+ (Paranoid fallback)~~ (done 2026-10-15; `crates/bot-engine`, BRS+ beat Paranoid in arena tests and is the default)
- ~~Handcrafted evaluation, strength levels 600–2400 + Max~~ (done 2026-10-15; level parameters are first guesses until `bot-arena` calibration)
- `bot-service` (CPU-limited, deadline-aware, load-shedding)
- `bot-arena` tournaments, calibration, overnight tuning

### M7 — Deploy — §9
- OVHcloud US VPS-2 (4 vCPU / 8 GB, US-East), Docker Compose, Caddy, Cloudflare-only firewall
- Cloudflare Pages at `play.<domain>`, API at `api.<domain>`
- Draining deploys, nightly 30-day off-site backups with tested restore, monitoring, staging

---

## Open rules questions
- Confirm en passant rule (§2); stays behind a flag until confirmed
- Confirm "Abandon = timeout" after the 60-second reconnect grace
- Confirm that a stalemated or timed-out player's leader no longer keeps a Teams team alive
- Teams resignation: player-only or whole team?
- Attacked-leader glow: default on or off, and per-lobby toggle? (decide before M2)
- Review corner-pawn opening balance (East exposed on both corners) with bot-arena data
- FFA move-limit tie placements: survivors share 1st and defeated seats keep their reverse-defeat placements (e.g. 1st, 1st, 3rd, 4th) — confirm this is what lobby results and ratings should show
- Confirm: a Teams seat that was already DEFEATED and then freezes does not reset the move-limit counter (only ACTIVE-seat defeats reset it)

## Before public release
- Moderation: profanity filter, reserved/impersonation names, report button + review queue, username change policy
- Process for deleting accounts found to belong to under-13s (COPPA actual knowledge)
- Attorney review of Terms/Privacy (choose dispute option A or B, confirm minor/guardian language)
- Fill legal placeholders (operator legal name, address, contact email)
- Decide on and form a business entity; get a business mailing address
- Trademark search for the final game name
- Register a DMCA designated agent ($6) and set a 3-year renewal reminder
- Write and rehearse the incident-response runbook
- Restore-from-backup drill, including re-applying `deletion_log`
- Upgrade Resend to Pro before any public announcement
- Register OAuth apps (Google, Discord, GitHub, Microsoft) with redirect `<API_PUBLIC_URL>/api/auth/callback/<provider>` and smoke-test each sign-in and account link
- Real Turnstile site/secret keys and Resend sending domain for staging/production
- Confirm each civ emblem against Civ VI reference art, then produce final original art for all 9
- Clickwrap gating on every account path: OAuth/passkey/Steam buttons disabled until the Terms box is checked; Steam/Unity first launch, website Steam sign-in and device-code linking show the same unchecked checkbox and write a `legal_acceptances` row (Terms `accepted`, Privacy Policy `acknowledged`)
- Store age band (13–15 / 16–17 / 18+) instead of a bare 13+ flag; under-18 high-privacy defaults for profile and match history
- `ip_hash` as HMAC-SHA-256 with a secret pepper outside the DB; add the pepper to the incident-response rotation list
- On account deletion, re-key match_players/ratings/legal_acceptances to a fresh random ID not kept in `deletion_log`; under-13 deletions replace each seat with a per-match "Removed player"
- ~~Guest "Download my data" / "Delete guest account" in Settings, plus a reference code for email requests~~ (done 2026-10-15)
- DMCA records table (notices, counter-notices, strikes, keyed email hash) retained [3] years after the last notice, surviving account deletion
- If dispute Option A is chosen: submit the arbitration clause to the AAA Consumer Clause Registry (Rule R-12) at least 30 days before the effective date, pay the fee, renew yearly, re-submit after material changes; calendar every arbitration fee invoice (30-day CCP § 1281.98 deadline)
- Check each processor's EU-US Data Privacy Framework certification and that SCCs are in each DPA
- Before launch: appoint EU and UK Art. 27 representatives, or decide in writing not to serve the EEA/UK and geo-block
- Triage [PRIVACY CONTACT EMAIL] at least daily (COPPA actual-knowledge reports go there)
- Confirm no third-party scripts, fonts, pixels or SDKs load from non-Cloudflare domains; review Cloudflare DPA/Turnstile addendum for controller-role use
- Resolve every bracketed / CONFIRM item in the Privacy Policy before publication
- Quarterly: check state privacy-law thresholds (e.g. CT 35,000, VA 100,000 consumers) against MAU by state

## Before marketing in the EU/UK
- Decide on Art. 27 EU and UK representatives; apply UK Children's Code high-privacy defaults for under-18s (attorney confirms)

## Anti-cheat (not now; ideas kept)
- Statistical engine-match analysis on rated games (compare with bot-engine top choices, weighted by position complexity)
- Move-time consistency analysis
- Report-driven review queue
- Account trust levels (N casual games before rated)
- Rating rollback for confirmed cheaters
- Spectator delay on rated games once spectating exists

## Monetization (undecided)
- Evaluate: cosmetic piece sets/boards/emblem frames, supporter subscription, paid Steam version alongside a free web version, battle-pass-style progression (no pay-to-win; affects progression data design)

## Mobile
- Responsive layout, touch drag/tap controls, portrait board scaling, PWA install

## Designed-for-later features
- Move log UI
- Resign
- Draw offers
- Takebacks
- Chat / emotes
- Spectating
- Replays
- Rematch
- AFK bot takeover (casual games)
- Premoves
- Optional bot "think" delay
- Draft mode (bans + pick order)
- Unique-civ matchmaking
- Civ abilities
- Progression / XP / unlocks / civ mastery
- Unity client (Windows x64) via Colyseus Unity SDK + `rules-ffi` DLL
- Steam auth plugin (ticket + OpenID 2.0) + publisher Web API key
- Steam integration and store listing ($100 Steam Direct fee)
- Sign in with Apple ($99/yr)
- NNUE bot evaluation
- Redis scale-out for multiple game servers
- Analytics (with cookie consent)
- Marketing email (opt-in + unsubscribe)
