# Overnight session log 3 (2026-10-24, from 12:40 AM EDT until 8:30 AM)

Your instructions: disable en passant, leave England alone (it's the only civ with an ability
so far), skip the legal work for the profitless beta, do the engineering for a $0-a-month
launch, then keep improving the UI and engineering, taking the recommended option at every
decision. Each finished piece is committed and pushed as soon as it passes its own checks.

## Try it in the morning

```sh
git pull
pnpm install
pnpm dev          # applies migrations, rebuilds the rules engine, then open http://localhost:5173
```

## Decisions taken on your behalf

- **En passant:** rules version 3 is version 2 without en passant. Old games keep replaying
  exactly as they were played (the engine still knows en passant for version-2 games).
- **Hosting:** Oracle Cloud's Always Free ARM server (4 cores, 24 GB) instead of the OVHcloud
  VPS, Resend's free tier kept. The only cost left is the domain (about $10–15 a year).
- **Device sign-in (to-do decision):** approving a code on the Device page now needs a session
  from the last day, the same rule as deleting the account. The apps will use the device flow
  as the "confirm it's you" step, so a stale session must not mint a fresh one.
- **Private lobby passwords (to-do decision):** 5 wrong guesses a minute per IP and per
  account, and 30 per room. Before, 5 wrong guesses from anyone locked the room for everyone,
  the host's friends included.
- **Home-screen name (to-do decision):** "LL Chess".
- **Search shows people who blocked you (open from last time):** kept as it is. Hiding them
  would reveal the block, because profiles and the leaderboard are public anyway.
- **Error tracking:** Sentry's free tier, off until you set a DSN. Nothing personal is sent:
  no user id, email, IP, cookies, request bodies, query strings, usernames or tokens.
- **Ranked repeat limit:** four players who already played 3 rated games together in the last
  24 hours play their next ranked game unrated, in every ranked lobby (not only friend
  challenges, or a password lobby would get around it). The lobby says so before the start.
- **Blocks and profiles:** a block hides the recent-games list both ways; the profile itself
  stays visible, as before.

## Completed

### 1. No en passant (rules version 3)
Commit `5ea663b`. New games are version 3; version-2 matches still replay (History and Replay
accept versions 2 to 3, the server re-simulates both). The rules page and PLAN §2 say so.

### 2. $0-a-month deployment
Commit `92c94f3`.
- **docs/DEPLOY.md step 3, "On Oracle Cloud (free)":** which machine to pick, what to do when
  Ashburn is "out of capacity", and upgrading to Pay As You Go so Oracle doesn't reclaim an
  idle free machine. Free resources still cost $0; set a $1 budget alert.
- **Firewall:** Oracle's network already allows only SSH, and ufw is unsafe on its images, so
  `infra/firewall.sh` refuses to run there.
- **CI checks the real stack on ARM:** a new job builds the production containers on x86 and
  ARM runners and checks the server's health, the database and a bot move. The bot service
  also compiles for ARM locally with no changes, and every native Node package has an ARM
  build in the lockfile.
- **wasm-opt:** now runs in CI and the web deploy, and a missing or failing wasm-opt is an
  error there instead of a warning.

### 3. Device sign-in needs a fresh session
Commit `dba342a`.

### 4. Private lobbies can't be locked by strangers
Commit `e639ef4`.

### 5. Short home-screen name
Commit `5abea77`.

### 6. wasm-opt in CI
Commits `6adaca6`, `12390d7`. CI's first run caught that Ubuntu's binaryen 108 breaks the
engine, so CI and the web deploy install a pinned binaryen release, and the deploy runs the
rules tests on the optimized engine before uploading it (288 KiB, was 302).

### 7. Error tracking (Sentry, opt-in)
Commit `c37a802`. Server and web report errors only when `SENTRY_DSN` / `VITE_SENTRY_DSN`
are set; every error-level log line is reported once (capped at 30 an hour), 4xx answers never.
One shared scrubber removes personal data before anything leaves. docs/DEPLOY.md step 7
covers creating the two Sentry projects and a free uptime check on `/api/health`.

### 8. New pieces, bigger board
Commit `d2797f2`. A chunky Staunton set with a brass collar, a redrawn knight and a
crowned-knight Prime Minister; pieces fill their square, the frame is thinner, and wide
screens put slim upright plates beside the board. Squares: 1280x800 32 to 35 px, 1440x900
37 to 44 px, 1920x1080 47 to 54 px, phones 19 to 20 px.

### 9. Public match history and ranked friend challenges
Commit `368ad2a`.
- **Public history:** "Show my recent games on my profile" on the Account page, off by default.
  When on, your profile shows your last 10 finished games (the day, not the time; other
  players named without guest names or deletion numbers).
- **Ranked challenges:** a Ranked switch when you challenge three friends. Every ranked rule
  applies, plus the repeat limit above.
- New indexes keep both quick on large histories.

### 10. Side plates line up with the frame
Commit `4100f93`. The board now reports where it actually draws its frame, so the wide
layout's plates sit flush with it (they overhung it by 4 to 6 px).

### 11. Bot takeover for absent players; ranked delay for players who are out
Commit `2f8ef38`.
- **Casual games:** when a player's 60 s reconnect grace runs out and another human is still
  playing, a bot plays their seat on their clock; they get it back by rejoining.
  `AFK_BOT_TAKEOVER=false` turns this off.
- **Ranked games:** a player who is out now sees the game 2 rounds late, like spectators, so
  they can't help a friend who is still playing.

### 12. Premoves
Commit `f275b69`. Queue one move while it isn't your turn: it plays the moment your turn comes
if it's still legal, and is dropped with an announcement if not. There's a board setting, on
by default. The game screen now also says when a ranked game isn't rated.

### 13. Two game-screen follow-ups
A bot standing in for an absent player now reads "Bot 1200 (for Alice)" on its plate, and a
player who is out of a ranked game sees "You're out: the game is shown 2 rounds behind" under
the title.

### 14. Premove recaptures
Commit `73c5d83`. Premove targets now follow each piece's movement pattern whatever is in the
way, so you can premove a recapture onto your own piece's square, a pawn capture onto a
square that's empty now, or a slide past a piece that may move.

### Usage limit
A session limit hit at about 4:30 AM; the workflows' retry helper waited for the 4:50 reset and
carried on, so no step was lost.

## Not done / left for you

### Small follow-ups (in TODO.md or noted here)
- The privacy policy's error-report and processor rows still need Sentry added, for when you
  do the legal pass.

### Needs you, money or accounts
- **Buy the domain** and create the free accounts in docs/DEPLOY.md step 1 (Cloudflare, Oracle
  Cloud, Resend), then follow the guide.
- **Legal:** skipped for the profitless beta, as you asked. The "Before public release" list
  in TODO.md is still there for when you commercialize.
