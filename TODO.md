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
- ~~Docker Compose file for the dev/prod stack — `infra/docker-compose.yml` now holds the full production stack (see M7) but is untested: Docker isn't installed on the dev machine (needs sudo). Verify with `docker compose config` and a local `up` once Docker is available.~~ (done 2026-10-17; both images built, a local tunnel-less stack migrated, served /api/health, played a full solo game against the containerized bot-service, and passed a backup dry run plus a restore drill. Fixes: root `.dockerignore`, stale-engine builds from the cargo cache on rollbacks, server image 663 → ~470 MB, server healthcheck, Cloudflare Tunnel behind the `tunnel` profile, `backup.sh --dry-run`, a restore procedure that works. Optional dev Postgres on :5433 in `infra/docker-compose.dev.yml`)

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
- ~~16×16 board (rules v2)~~ (done 2026-10-17; `RULES_VERSION` 2. Each army centred on its edge with four empty squares either side and playable 4×4 corners (South e1–l1, Q h1 light, K i1; West a5–a12; North e16–l16, Q h16 dark; East p5–p12); promotion on the first line past the centre (S rank 9, N rank 8, W file i, E file h); castling on the new back lines; everything else unchanged. Perft from the start: 30, 900, 27,000, 810,000 (no contact for the first round), then 28,561,080 FFA / 28,557,360 Teams at depth 5. Engine, WASM, `@game/rules`, bots (16×16 piece-square tables), board renderer (shader, labels, hit testing), web copy, server, tests and docs updated. Stored 12×12 games (rules version 1) stay in history; re-simulation refuses them with `UnsupportedRulesVersionError` instead of mis-replaying)

### M2 — Board renderer (web) — §3

- ~~PixiJS board, original piece and board art, seat colors (colorblind-safe)~~ (done 2026-10-15; `packages/board` (`@game/board`): procedural shader board, lit piece atlas from `packages/assets`, CVD-checked palette + optional shape markers)
- ~~Animations: move, capture particles, FFA army dissolve, Teams grey/freeze~~ (done 2026-10-15)
- ~~Move hints, drag/click to move, promotion picker, auto-rotation, sounds~~ (done 2026-10-15; basic keyboard control; screen-reader announcements not yet)
- ~~Optional attacked-leader glow (default decided in Open rules questions)~~ (done 2026-10-15; `showAttackedLeaderGlow` option, off by default until the open question is decided)
- ~~Hot-seat sandbox in dev/staging builds only~~ (done 2026-10-15; `pnpm --filter @game/board sandbox`, a separate Vite page, not part of apps/web)
- ~~Civ emblem SVGs (placeholder-quality originals until final art)~~ (done 2026-10-15; working art in `packages/assets/emblems`, China/Mali flagged for refinement in final art pass)
- ~~Check indicator: board `setCheck(seat | null)` (pulsing red ring and glow on the leader square(s), steady under reduced motion, `check` sound) replacing the `showAttackedLeaderGlow` option and its game-settings toggle~~ (done 2026-10-16; leader squares from the engine: `GameState::leader_squares` (roster leader role), `Snapshot.leaderSquares` and `Game.leaderSquares(seat)`; web: pure visibility rule `lib/check-indicator.ts` (unit-tested), turn banner "Check! Your leader is under attack" in the dedicated `danger` colour, "Your leader is in check" pill beside the turn banner after a self-check (announced through a live region); E2E `check-indicator.spec.ts` (singleplayer self-check, and a two-player game for the turn-start check, the self-check and that other players see nothing))
- Board: mount `@game/board` in the apps/web game screen (with M5 live games)
- Board: screen-reader move announcements (aria-live) and a full keyboard pass
- Board: confirm 60 fps at 1440p on a real mid-range GPU (only software-rendered so far)
- Board art pass: illustrator pass on the knight (mane, muzzle) and wider bases/collars across the piece set (packages/assets/pieces)
- Board art pass: simplified heavy-stroke emblem variants for Mali, China and Russia for medallions under ~72 device px
- Board: install binaryen (wasm-opt) in CI/release builds so the rules wasm ships size-optimized (the build now warns when it is missing)
- Board: pinch or tap-to-zoom (or a magnifier while a piece is selected or dragged) for phones: on the 16×16 board a 390 px-wide screen gets ~19 px squares, far below the 44 px touch-target guideline. Partly mitigated 2026-10-17 (touch taps and drops just off a legal target count as that target; hint dots have a 9 px minimum; coordinate labels step aside from the medallions)

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
- ~~Mount `requireCurrentAcceptance` (server-side clickwrap check) on every lobby/game route in M4~~ (done 2026-10-15; matchmaking `onAuth` and the match-history/ratings routes check age, current acceptance and username)
- ~~Age screen only for new visitors: sign-in, two-step, forgot-password and check-email pages no longer behind it; a signed-in account with a stored age confirmation is never asked (an unconfirmed one is asked once); the client never shows it while the session or legal status is loading, refetching or failing (mitigates "asked for my birthdate after every server restart": not reproduced and no confirmed root cause, but every path that could show it to a signed-in player now ends in "confirmed" or a spinner)~~ (done 2026-10-16; `lib/age-gate.ts` decides from settled answers only; `/api/legal/status` reports `userId` so stale answers are ignored; config, session and status retry with backoff and recover after an API restart instead of sticking on "can't reach the server"; `refreshSession` waits for the session store to settle; "Sign in" in the header on the age screen; `restart-session.spec.ts` restarts its own API under an open signed-in page)
- Deleting a registered account with a stale session: also accept a passkey or TOTP step-up (password step-up exists)
- Show how many backup codes remain (needs a server endpoint; regenerating works)
- Email the account owner when password sign-in gets locked by the per-account throttle
- Confirm with the user that the birthdate prompt after a server restart is gone; if it comes back, capture the dev diagnostics from `/api/legal/status` (sessionFound, accountAgeConfirmed, ageCookiePresent, ageCookieValid, serverStartedAt) at that moment to find the root cause
- Product/legal call: after an under-13 answer, should signing in to an existing, already age-confirmed account stay blocked for 24 h (current behavior) or be allowed?

### M4 — Lobbies — §3

- ~~Colyseus lobby list + lobby room; create (mode, time control, optional hashed password with attempt limits)~~ (done 2026-10-15; `packages/protocol` (`@game/protocol`) holds the versioned wire contract + JSON Schema export)
- ~~Seats/teams, host controls, ready/start, session-bound seats~~ (done 2026-10-15)
- ~~Blind civ pick with emblems beside usernames~~ (done 2026-10-15; server: civ per seat, duplicates allowed; web: civ picker and emblem beside every name in the lobby, game panel, results and history)
- ~~Bot seats with level picker and random-but-editable civ~~ (done 2026-10-15)
- ~~Civ dropdown instead of the emblem grid (scales to 100+ civs)~~ (done 2026-10-16; `CivSelect`: a 56 px trigger row (medallion, name, chevron) opening a Radix popover with a search box and scrolling 56 px rows, a check on the chosen civ; WAI-ARIA 1.2 combobox/listbox keyboard (arrows, Page Up/Down, Home/End, Enter, Escape, Tab, typeahead), case- and accent-insensitive search, focus back on the trigger; data-driven from `CIVILIZATIONS`, monogram for civs without art, unit-tested with 120 synthetic civs. Replaces the Play vs bots and lobby grids and the host's bot-civ `<select>`; `CivPicker` and `grid-nav` removed; E2E helper `chooseCiv`, `civ-select.spec.ts`)
- ~~Friends & challenges~~ (done 2026-10-17; registered accounts only. Add anyone you are playing with or finished a game with (both seated in the same in-progress or finished match; a lobby alone or an aborted game doesn't count; no bots, guests or deleted accounts), named by match + seat so user ids can't be used to spam strangers. 50 friends per player (both sides checked on accept), 10 pending outgoing, 20 requests/hour per user; a request back auto-accepts. `friendships` table (migration 0007), deleted (not re-keyed) on account deletion, included in the export. REST for every action (`/api/friends`, `/api/friends/match/:id`, `/api/challenges`), plus a `social` Colyseus room (cookie or bearer) pushing requests, acceptances, presence (5 s offline grace) and challenges. Challenges: up to 3 friends, FFA/Teams, 10+0/3+2, casual; the server creates an unlisted invite-only lobby (`inviteOnly`, others get `not_invited`), invitees get a Join/Decline prompt that expires after 5 minutes or when the lobby starts or closes; the host can invite again into the same lobby after it ends. Removing a friend or deleting an account withdraws open invitations; social connections close when their session ends (sign-out, revoke, expiry). Web: Friends page (online dots, Challenge, Remove, requests, open challenges, empty state, guest hint), header link + phone menu with a badge, "Add friend" on live player cards, the result screen and history rows, toasts and a challenge prompt. `social.test.ts`, `friends.spec.ts`)
- ~~Friends: block users (hide their requests and challenges; remove an existing friendship)~~ (done 2026-10-17; registered accounts, up to 500, from the Friends page, live player cards, the result screen and history rows. Removes the friendship and pending requests both ways; the blocked player gets the same neutral answers as any ineligible player (requests `NOT_ELIGIBLE`, challenges `NOT_FRIENDS`); presence is friends-only so neither sees the other online; "Blocked" list with Unblock on the Friends page. Never removes anyone from a running game. `blocks` table (migration 0008), deleted with either account, in the export. `moderation.test.ts`, `moderation.spec.ts`)
- Friends: ranked challenges (invite-only ranked lobbies; today challenges are casual only)

### M5 — Live games — §2, §5

- ~~Authoritative game room, server clocks (10+0, 3+2), reconnect grace + abandon~~ (done 2026-10-15)
- ~~All defeat paths, end screen~~ (done 2026-10-15; server: leader capture, stalemate, timeout, abandon, `gameOver`; web: result screen with placements and rating changes)
- ~~Incremental event persistence, abort-on-restart, re-simulation check~~ (done 2026-10-15)
- ~~OpenSkill ratings (public + hidden shadow ratings)~~ (done 2026-10-15; display rating = round(900 + 30 × (mu − 3σ)), bot anchors in `bot_level_anchors`)
- ~~Web: lobby browser, create/join lobby, lobby room and live game screens on `@game/protocol`~~ (done 2026-10-15; `/play`, `/match/:roomId`, `/history`; private lobbies with password prompt, host bot/seat controls, live clocks, reconnect after reload)
- ~~One-command local development (`pnpm dev`: database, WASM build, bot-service, server, web)~~ (done 2026-10-15)
- ~~Local dev mailbox page (`/dev/mail`) linked from the check-email screens, kept across server restarts; `pnpm dev` stops every process it started and checks its ports first~~ (done 2026-10-15)
- ~~Singleplayer (vs bots, untimed)~~ (done 2026-10-16; "Play vs bots" on the Play page and the landing page: choose a civ, bot strength and FFA/Teams; South vs three bots at West/North/East with random distinct civs; `kind: 'solo'` create option, `timeControl: 'untimed'`; unlisted, joinable only by its creator, starts by itself, no clocks, unrated with no public or shadow rating, shown in history as "Untimed · vs bots")
- ~~Singleplayer: end the game when the player is out (no playing it out between the bots)~~ (done 2026-10-16; solo FFA only: the moment the human stops taking turns (leader captured, stalemate, resign, abandon/leave) the server applies `Game.applyAgreedDraw()` in the same action, so the bots still in play share 1st and the player keeps the rules core's reverse-defeat placement; end reason `player_eliminated`, its `game_end` row carries `agreedDraw: true` for re-simulation; result screen "You were eliminated" with the player's place, history "You were eliminated"; leave and resign dialogs say the game ends. Teams solo unchanged)
- ~~Bot move pacing~~ (done 2026-10-16; `BOT_MIN_MOVE_MS`, default 700: a bot's move is applied no earlier than that after the previous action (2.2× after a defeat) so each move's animation plays; think time overlaps the wait; in timed games it runs on the bot's clock and is skipped under 10 s; a move already waiting is paced again after an off-turn army removal; bots keep their level and pacing while a human still plays or watches, and finish unpaced only once nobody is connected)
- ~~Ranked mode with 4-player Elo~~ (done 2026-10-16; `ranked` create option, default off: registered accounts only (`account_required`), no bots (`ranked_no_bots`), never solo/untimed; casual lobbies are never rated, replacing the old "rated iff four registered humans" rule. Elo from 1200, FIDE K 40 / 20 / 10 (first 30 games / regular / peak ≥ 2400); FFA pairwise with K/(N−1), Teams team-mean vs team-mean; ties from agreed draws and the move limit; pure module `apps/server/src/game/elo.ts` with golden tests. `elo_ratings` table (migration 0004) per user × mode × time control with games and peak; Elo before/after on `match_players`; public OpenSkill no longer written (hidden shadow pool unchanged). `GET /api/ratings/me` returns Elo; public `GET /api/leaderboard` (5+ ranked games, usernames only, no deleted accounts or guests). Web: Ranked toggle (disabled for guests), Ranked badge and filter in the lobby browser, badge in the lobby and game header, Elo changes on the end screen and in history, Elo cards with games and peak, `/leaderboard` page. Export lists `eloRatings`; deletion re-keys them)
- Lobbies: spectator role (read-only) for spectating/replays
- Game server scale-out: startup abort of `in_progress` matches assumes a single game-server process (revisit with Redis presence)
- Ratings: recalibrate `bot_level_anchors` from bot-arena results and the shadow pool
- ~~Review fixes (seat binding): reservations count as seat claims (one outstanding per user, re-checked on connect: kicks, one seat per user, lobby phase); pending reservations count toward free seats (no locking a lobby with raw matchmaking calls); the creator keeps the host role until their reservation lapses; civ changes can't land on another seat after a swap~~ (done 2026-10-15)
- ~~Review fixes (limits): lobby-password attempts and the matchmaking rate limit count requests on arrival (no parallel bursts past the limit); WebSocket upgrades from a foreign Origin refused~~ (done 2026-10-15)
- ~~Review fixes (live games): bot requests get a deadline from the bot's own clock (local fallback move before the flag); an off-turn action keeps the bot's in-flight request; bots finish with local moves once no human takes turns; clocks measured on a monotonic clock; running games unlisted from the lobby browser~~ (done 2026-10-15)
- ~~Review fixes (persistence): finishing or aborting only touches matches still `in_progress` (a match aborted as `server_restart` is never rewritten as finished/rated); a failed final flush, re-simulation or result write marks the match aborted (`persist_failed`); a rated game with no public rating change is stored and reported unrated; server test runs take a Postgres advisory lock so concurrent runs queue instead of resetting each other's database~~ (done 2026-10-15)
- Lobbies: product call on the per-room password limit (PLAN §1: 5/min per IP and per room). Anyone can keep a private lobby locked for everyone, the host's friends included, by guessing wrong 5 times a minute. Options: let a correct password through from an IP or user with no failures, show the host who is guessing, or let the host rotate the password

### M6 — Bots — §6

- ~~Teams team-signed alpha-beta, FFA BRS+ (Paranoid fallback)~~ (done 2026-10-15; `crates/bot-engine`, BRS+ beat Paranoid in arena tests and is the default)
- ~~Handcrafted evaluation, strength levels 600–2400 + Max~~ (done 2026-10-15; level parameters calibrated with `bot-arena` 2026-10-15, see [docs/bots-calibration.md](docs/bots-calibration.md))
- ~~`bot-service` (CPU-limited, deadline-aware, load-shedding)~~ (done 2026-10-15; `crates/bot-service`: axum service, EDF worker pool, 503 + Retry-After fallback contract in its README, Dockerfile + compose service)
- ~~`bot-arena` tournaments, calibration, overnight tuning~~ (done 2026-10-15 except overnight tuning; `crates/bot-arena`: FFA/Teams matches with seat rotation, Bradley-Terry ladder, SPRT; calibrated level table and results in [docs/bots-calibration.md](docs/bots-calibration.md))
- Overnight evaluation tuning (Texel / SPSA) on bot-arena self-play, gated by `bot-arena sprt`
- ~~Review fixes (bots): BRS/BRS+ default moves save their own leader and take the root's; an interrupted first iteration never leaks move-ordering scores into the result; depth-1 node cap and exact-root window (no more multi-second "node-bound" moves); fail-soft quiescence delta pruning no longer poisons the TT; FFA move-limit tie valued on the evaluation's scale; bot-service gives every search a minimum time or answers 503 (no unsearched moves), honest `degraded`, header/body timeouts and a bounded shutdown drain, listen backlog 1024, abandoned jobs leave the queue, untimed 2400 reproducible, per-status metrics, JS-style numbers accepted and unknown fields rejected~~ (done 2026-10-15; levels re-checked with bot-arena, see [docs/bots-calibration.md](docs/bots-calibration.md))

### M7 — Deploy — §9

- ~~Production container images and stack: server Dockerfile, `infra/docker-compose.yml` (Postgres, migrations, server, bot-service, Cloudflare Tunnel), SSH-only firewall script~~ (done 2026-10-15; untested locally: Docker isn't installed on the dev machine. Caddy + Cloudflare-only firewall replaced by a Cloudflare Tunnel because Docker's published ports bypass `ufw`)
- ~~Web deploy to Cloudflare Pages via GitHub Actions (`.github/workflows/deploy-web.yml`, inactive until repo secrets are set)~~ (done 2026-10-15)
- ~~Draining deploys (45 min stop grace), nightly encrypted 30-day off-site backups (`infra/backup.sh`), restore + `reapply-deletions` steps~~ (done 2026-10-15)
- ~~Step-by-step deployment guide for non-technical readers (`docs/DEPLOY.md`)~~ (done 2026-10-15)
- Provision the real infrastructure: domain, Cloudflare (DNS, Pages, Tunnel, Turnstile), OVHcloud VPS-2, Resend, backup storage; follow docs/DEPLOY.md (needs the owner's accounts)
- First production smoke test, plus a restore-from-backup drill on the live server
- Monitoring: Sentry error tracking (server + web) and an uptime check on `api.<domain>/api/health`
- Staging environment (second compose project on the same VPS, `staging-api.` / `staging.` hostnames)
- ~~No-sudo, no-subscription deployment option for a UWaterloo CSC VM: feasibility review and guide (`docs/DEPLOY-CSCLUB.md`), scripts in `infra/csclub` (release built at home with Docker; user-space Node/PostgreSQL/cloudflared; cron watchdog; encrypted backups; restore)~~ (done 2026-10-17; the full cycle ran as a normal user without root: setup, install, update, rollback, crash recovery, watchdog restarts, backup and restore drill)
- If hosting on the CSC: email syscom for approval and the VM's current specs (template in `docs/DEPLOY-CSCLUB.md`), and name the actual host in `docs/legal/privacy-policy.md` and the incident-response contacts
- Optional: server serves the built web app itself (static files + `index.html` fallback behind a `WEB_DIST_DIR` setting) for a single-origin deploy without Cloudflare Pages
- Optional: GitHub Actions workflow that runs `infra/csclub/package.sh` and attaches the release file, so releases don't need Docker at home
- Only if the CSC host turns out to be a shared general-use machine: have the server require a shared secret header that the Cloudflare Tunnel adds (Cloudflare Access service token or a request-header rule), so other local users can't reach `127.0.0.1` directly and fake `CF-Connecting-IP` (see "If you only get a general-use machine" in `docs/DEPLOY-CSCLUB.md`)

---

## Open rules questions

- Confirm en passant rule (§2); stays behind a flag until confirmed
- Confirm "Abandon = timeout" after the 60-second reconnect grace
- Confirm that a stalemated or timed-out player's leader no longer keeps a Teams team alive
- ~~Teams resignation: player-only or whole team?~~ (done 2026-10-16; whole team, by teammate vote: the resigner proposes, the teammate agrees (both lose, the other team wins at once) or declines (both play on); a frozen teammate means the team resigns at once. User rule; see PLAN §2 and docs/RULES.md "Resigning")
- ~~Attacked-leader glow: default on or off, and per-lobby toggle? (decide before M2)~~ (done 2026-10-16; replaced by the check indicator, always on with no setting or lobby toggle: only for the viewer's own seat, when their turn starts with their leader under attack, and right after their own move leaves it attacked (until it no longer is); never prevents or pre-warns a move. User rule; see PLAN §2 and docs/RULES.md "Check indicators")
- ~~Review corner-pawn opening balance (East exposed on both corners) with bot-arena data (first bot data 2026-10-15 in [docs/bots-calibration.md](docs/bots-calibration.md): FFA East wins 23.0 ± 1.8% vs fair 25%, no Teams bias)~~ (done 2026-10-17; moot with the 16×16 board: no army starts in contact, so there are no move-1 corner-pawn captures. Seat bias of the new board is in docs/bots-calibration.md)
- FFA move-limit tie placements: survivors share 1st and defeated seats keep their reverse-defeat placements (e.g. 1st, 1st, 3rd, 4th) — confirm this is what lobby results and ratings should show
- Confirm: a Teams seat that was already DEFEATED and then freezes does not reset the move-limit counter (only ACTIVE-seat defeats reset it)
- Balance review of England (civ v2, four Prime Ministers) with arena and human data: in bot-arena FFA games England wins about 61% (fair share 25%) and almost never finishes last, at level 1200 and with a 20k-node engine alike; in Teams no clear effect (see docs/bots-calibration.md). Options if human games agree: fewer Prime Ministers, weaker movement, or a different defeat condition (as a new civ version)

## Before public release

- ~~Moderation: profanity filter, reserved/impersonation names, report button + review queue, username change policy~~ (done 2026-10-17; see PLAN §3 "Moderation". Name filter in the pluggable NamePolicy (normalized matching: case, accents, leetspeak, repeats, separators; whole-word rules + allowlist against the Scunthorpe problem; word lists in `apps/server/src/auth/name-terms.json`) and reserved names (staff words, Guest/Player/bot placeholders, `APP_NAME` words) at sign-up, username choice and guest upgrade, with one neutral "That username isn't available" answer; profanity filter on lobby names. Report button on live cards, the result screen, history and the Friends page (guests too; offensive username / harassment / cheating / other + 500-character note; 10 per day, one open report per player and game). `/admin/reports` review queue for `ADMIN_USER_IDS`: dismiss, warn (recorded), reset username, suspend (sign-in refused, sessions revoked, out of lobbies) and unsuspend. Reports kept 1 year after review. Username change policy: **not available in the beta**; a moderator reset is the only change)
- Moderation: chat moderation (filter, mute, reports with message context) when chat is built
- Moderation: appeals process for warnings, username resets and suspensions (Terms §8.2 names an email; decide who answers and how fast)
- Moderation: "Warn" only records the decision; tell the player (email or an in-app notice)
- Moderation: let admins open the reported game (players, moves) from the review queue; today they copy the match id
- Moderation: keep a reset (offensive) username reserved so nobody else can take it right away
- Moderation: require two-step verification (or a fresh sign-in) for admin actions, and keep an audit row for unsuspensions (today only the log line)
- Username changes, if ever offered: at most once per 30 days, and the old name stays reserved for 30 days
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
- ~~Report-driven review queue~~ (done 2026-10-17; "cheating" reports land in the moderation review queue with the game attached; no statistical analysis yet)
- Account trust levels (N casual games before rated)
- Rating rollback for confirmed cheaters
- Spectator delay on rated games once spectating exists

## Monetization (undecided)

- Evaluate: cosmetic piece sets/boards/emblem frames, supporter subscription, paid Steam version alongside a free web version, battle-pass-style progression (no pay-to-win; affects progression data design)

## Mobile

Plan: [docs/MOBILE.md](docs/MOBILE.md) (Capacitor shells around the web build, sign-in through the website's device flow, bearer tokens in the apps).

- Responsive layout, touch drag/tap controls, portrait board scaling, ~~PWA install~~ (PWA install done 2026-10-17 as the web manifest item below)
- ~~Platform module `apps/web/src/lib/platform.ts` (`isNative()`, `platform()`)~~ (done 2026-10-17; reads `window.Capacitor` without a dependency, a `VITE_NATIVE` build counts as native)
- ~~Phone safe areas (viewport-fit=cover, notch and home-indicator padding)~~ (done 2026-10-17; `--safe-*` CSS variables from `env(safe-area-inset-*)` on the header, footer, game page and board height, toasts, dialogs, the reconnecting bar and lobby bars; theme-color, color-scheme and Apple web-app meta tags)
- ~~Web manifest and icons (installable, no service worker)~~ (done 2026-10-17; Vite plugin `apps/web/plugins/app-manifest.ts` builds the manifest from `APP_NAME`/`APP_SHORT_NAME`, orientation any; favicon, apple-touch-icon and 192/512 any + maskable PNGs rendered from `packages/assets/app-icon/emblem.svg` by `render-app-icons.mjs`; E2E checks Chrome's parsed manifest and installability; the game screen uses the side-panel layout on phones held sideways)
- Decide: a short home-screen name (`APP_SHORT_NAME` in `@game/config`, about 12 characters; today it equals `APP_NAME`, which launchers cut off)
- ~~Haptic feedback wrapper `lib/feedback.ts` with a Vibration board setting~~ (done 2026-10-17; `navigator.vibrate` for your own move, captures by or of you, check, your turn and game end at the board's sound points, default on, shown on touch devices; a native driver can be installed later)
- ~~Keep the screen awake during a live game~~ (done 2026-10-17; Screen Wake Lock, re-acquired on visibilitychange, released when the game ends or the page closes)
- ~~Reconnect on resume, reconnection token in localStorage too, "leaving forfeits" hint~~ (done 2026-10-17; on visibilitychange/pageshow/online the connection is pinged and a dead socket dropped so the SDK rejoins at once; tokens kept per match in sessionStorage and localStorage, the long-lived copy cleared at game end; rejoin with the saved token until 15 s after the grace if the SDK gives up; SDK retries tuned to outlast the grace; dismissible "Leaving the app for more than 60 s forfeits" hint on touch screens; the hint and retry budget follow the server's `reconnectGraceMs`; sign-out and account deletion leave the room and forget every saved token; a matchmaking reconnect needs the seat owner's session; a seat taken over by another tab keeps that tab's token)
- Decide: a longer reconnect grace on phones than 60 s (product setting, behind config; MOBILE.md §4)
- ~~Server `NATIVE_ORIGINS` (CORS, Better Auth trusted origins, WebSocket origin check)~~ (done 2026-10-17; comma list, empty by default = unchanged behavior, plain http refused in production; documented in the env examples, DEPLOY.md and the protocol README)
- ~~Device flow client id `game-mobile-client`, shown as "the mobile app" on the approval page~~ (done 2026-10-17)
- ~~Bearer-token mode in the web client for the apps~~ (done 2026-10-17; only when `isNative()`: Better Auth `fetchOptions.auth`, `api()` and the account export send `Authorization: Bearer` from a pluggable token store (localStorage stub); Colyseus matchmaking gets the header, not `client.auth.token`, which would put the token in the WebSocket URL; no cookies in bearer mode (`credentials: 'omit'`) and CORS without credentials for the app origins; a `VITE_NATIVE` outside `build:native` is ignored; sign-out and account deletion wipe the token)
- ~~`pnpm --filter @game/web build:native` (VITE_NATIVE, VITE_API_URL required)~~ (done 2026-10-17; output `apps/web/dist-native`, absolute base kept so deep links load in the shells)
- Phase 0 spike: `apps/mobile` Capacitor 8 project (`webDir: '../web/dist-native'`), test the board on a mid-range Android phone and on iOS (frame rate, drag, sound, memory at devicePixelRatio 3)
- Board touch polish: `user-select`/`-webkit-touch-callout`/tap-highlight off on the board, tap-tap as easy as drag (bigger hit targets on phones), Pixi resolution capped at 2 on phones
- Native sign-in screen (a native build shows a placeholder, `pages/NativeSignIn.tsx`, on the sign-in, sign-up and guest routes until then): "Sign in or play as guest" runs the device flow (`game-mobile-client`), stores the token, refreshes the session; check that a guest can approve a device request
- Secure token storage in the apps (Keychain/Keystore plugin) installed with `setTokenStore`
- Hide or redirect web-only UI in the apps: OAuth sign-in and account linking, "Add passkey", the JSON export download
- External links (legal pages, emails, help) open in the system browser in the apps
- Phase 2b: skip the Approve tap with a one-time token and an app link (verify the verify response carries the session token)
- Capacitor shell: `capacitor.config.ts` (appName from `APP_NAME`, permanent neutral bundle id), plugins (app, browser, haptics, keep-awake, splash screen, network, secure storage), icons and splash from the emblem with `@capacitor/assets`, Android back button, orientation
- Builds: Android `bundleRelease` (upload key out of git), iOS through Codemagic's free tier; DEPLOY.md section
- Decide: iOS in the first beta ($99/yr) or Android + iOS PWA first; hide third-party OAuth on iOS (option A) or add Sign in with Apple (B); bundle id and store name; iPhone-only or universal
- Store submission: in-app account deletion check (OAuth-only accounts re-run the device flow), Google Play deletion web link, age ratings (13+), privacy labels / Data safety, privacy-policy and support URLs, demo account for Apple review
- Google Play closed test (12 testers for 14 days) and TestFlight beta
- Push notifications (FCM for both platforms) once friends challenges need them; `push_tokens` table, privacy policy update first

## Designed-for-later features

- Move log UI
- ~~Resign~~ (done 2026-10-16; `resign` message, any time while still taking turns: FFA removes the army, Teams freezes the seat; a resign on your turn ends it with no increment; the player stays in the room as a spectator; confirm dialog in the game panel; "Resigned" in the player list and the result)
- ~~Teams resignation by teammate vote~~ (done 2026-10-16; `resign` in Teams proposes resigning the team and the teammate answers with `respondResign` (Agree: `Game.applyResign` resigns both seats, the game ends at once, end reason `team_resigned`, a loss for both in ranked Elo; Decline: both play on). Lapses after one full round or when either teammate stops taking turns; 2-move cooldown after a decline or lapse; a frozen teammate means an immediate team resignation; a bot teammate agrees only when its team is clearly losing (draw heuristic). Protocol v1 additions: `respondResign`, `resignEvent`, `teamResignSeat[2]` and `teamResignCooldowns[4]` state fields, three error codes; `resign_proposal` / `resign_response` match events (migration 0006). Web: Teams resign dialog explains the vote, "Waiting for …" status for the proposer, a request card with "Resign the game" / "Keep playing" for the teammate, toasts on decline and lapse, "Your team resigned" on the result screen)
- ~~Draw offers~~ (done 2026-10-16; `offerDraw` / `respondDraw`, `drawEvent`, state `drawOfferSeat` / `drawVotes` / `drawOfferActionSeq` / `drawCooldowns`: every voter must accept, lapses on a decline, a voter change or after one full round, 2-move cooldown after a lapse or decline; bots accept only at ≤ 80% of the strongest rival's material; draw-offer card, toasts and "Draw agreed" result)
- Takebacks
- Chat / emotes
- Spectating
- Replays
- Rematch
- AFK bot takeover (casual games)
- Premoves
- ~~Optional bot "think" delay~~ (done 2026-10-16; superseded by bot move pacing, `BOT_MIN_MOVE_MS`, on by default)
- Draft mode (bans + pick order)
- Unique-civ matchmaking
- Civ abilities
- ~~England: Prime Ministers (civ v2)~~ (done 2026-10-17; England's king, queen and knights are replaced by four Prime Ministers (letter `M`, `prime_minister`) on the K, Q and both N squares: each moves like a knight or a king, all four are leaders and England is eliminated only when the last is captured (default "no leaders" defeat condition). England can't castle (more than one leader piece, `Roster::castling_leader`); pawns still promote to Q, R, B or N (roster `promotion_choices`, now data separate from the starting back line). England v1 stays defined for history; new games use v2 (`CivId::latest_version`), the catalog seed adds the v2 roster row, `match_players.civ_version` stores it. Snapshot field `attackedLeaderSquares`: the check ring goes on the attacked Prime Ministers only. Bots value a Prime Minister at 450 plus a 150 leader reserve, only the last leader is decisive; arena results in docs/bots-calibration.md. Piece art `prime-minister.svg` (knight wearing the king's crown) in the board atlas; "Special army" tag and explanation in the civ picker, Play page and lobby. Perft with England in South: 34, 1,020, 30,600)
- Progression / XP / unlocks / civ mastery
- Unity client (Windows x64) via Colyseus Unity SDK + `rules-ffi` DLL
- Steam auth plugin (ticket + OpenID 2.0) + publisher Web API key
- Steam integration and store listing ($100 Steam Direct fee)
- Sign in with Apple ($99/yr)
- NNUE bot evaluation
- Redis scale-out for multiple game servers
- Analytics (with cookie consent)
- Marketing email (opt-in + unsubscribe)
