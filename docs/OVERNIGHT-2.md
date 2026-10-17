# Overnight session log 2 (2026-10-17, from 2:10 AM EDT until 9:00 AM)

Your seven requests, what was done for each, and every decision taken on your behalf. Each
finished piece is committed and pushed as soon as it passes its own checks.

## Try it in the morning

```sh
git pull
pnpm install
pnpm dev          # applies migrations, rebuilds the rules engine, then open http://localhost:5173
```

## Decisions taken on your behalf

### 1. 16×16 board
- Each army still has 8 pawns in front of R N B Q K B N R, centred on its side: **4 empty
  squares on each side** of the pawn and back rows, and **4×4 empty corners** that are fully
  playable.
- Exact setup: South c… → **e1–l1** (R e1, N f1, B g1, **Q h1** light, K i1, B j1, N k1, R l1),
  pawns e2–l2; North e16–l16 (Q h16 dark), pawns e15–l15; West a5–a12 (Q a8 light, K a9),
  pawns b5–b12; East p5–p12 (Q p8 dark, K p9), pawns o5–o12. Opposing queens still face each
  other, "queen on her colour" as before.
- **Promotion stays "first line past the centre":** South on rank 9, North on rank 8, West on
  file i, East on file h (7 steps from the pawn's start instead of 5).
- Move limit unchanged (25 rounds). Files a–p, ranks 1–16 in notation.
- Because the board changed, the rules version goes from 1 to **2**. Old 12×12 games stay in
  history (their results don't need re-simulating), but can't be replayed on the new engine.

### 2. Friends and challenges
- **Who can add whom:** registered accounts only (guests are temporary). You can send a request
  only to someone you are **playing with right now or have finished a game with**. Joining a
  random lobby is not enough.
- **Caps:** 50 friends per player; at most 10 outgoing pending requests at a time (so the cap
  can't be dodged by spamming), with a rate limit.
- **Requests:** accept, decline, cancel, remove friend.
- **Challenging a friend** creates a private, invite-only lobby (no password needed for the
  people you invite) and notifies them live if they're online: "X challenges you — Join /
  Decline". Up to 3 friends per challenge; empty seats can still take bots (casual).
- Friend lists show usernames and online status only. Privacy Policy draft updated.

### 3. England: Prime Ministers
- England's king, queen and both knights are replaced by **4 Prime Ministers** on those four
  squares. A Prime Minister moves like a knight **or** a king. All four are leaders: England is
  eliminated only when **all four** are captured.
- England has more than one leader, so **England can't castle** (your earlier rule).
- **Promotion:** England's pawns can still promote to queen, rook, bishop or knight (never to a
  Prime Minister, which is a leader). Removing the queen and knights from England's starting army
  doesn't remove them from the promotion choices.
- **Check warning:** shown when any Prime Minister is attacked, with the ring on the attacked
  ones only.
- Look: a knight wearing a king's crown, in the existing piece-set style.
- England's definition becomes civ version 2 (versions are immutable, so old games keep the old
  England).

### 4. No bots in ranked games
- Already the case: the server refuses bots in ranked lobbies (`ranked_no_bots`, with a test),
  the lobby shows "Bots can't take ranked seats" instead of the Add bot control, and singleplayer
  can never be ranked. Nothing to change.

## Completed

### 1. 16×16 board (rules version 2)
Built as decided above: rules engine, bots, board drawing, web pages, server, tests and docs.
- **Opening:** the armies start four squares apart, so on move 1 the only possible capture
  is a rook taking a rook that moved into the shared corner (a1/p1/a16/p16); on 12×12 the
  corner pawns attacked each other. Every seat still has exactly 30 opening moves.
- **Bots:** moves cost about 1.3–1.5× more thinking time on the bigger board, but every level
  still answers within its time target, and arena games confirm each level still beats the
  one below.
- **Old games:** 12×12 matches stay in history; replaying them is refused cleanly instead of
  producing wrong positions.
- **En passant** practically never comes up early now: a pawn can only be taken en passant once
  enemy pawns have moved off their starting files by capturing.
- **Phones:** at 390 px wide a square is only about 19 px. Pieces still read, but taps are
  small. After the review, a tap or drop just off a legal target counts as that target (touch
  only, never past the near half of the next square), move dots never shrink below 9 px, and
  the h/i file labels step aside from the medallion instead of hiding under it. A real zoom
  for the board on phones is on the to-do list.
Commits `622407b`…`54c9fd1`.

**Review pass:** rules attack tests and a visual check raised 9 issues; all were real.
- The landing page still said "Twelve by twelve" under a "16×16 board" heading; fixed, and the
  landing test now fails if the copy drifts from the board size again.
- The board could get stuck showing an old position: when 5 or more moves arrived while it
  wasn't drawing (a background tab, a burst of updates), one piece had two moves queued and
  the earlier one cancelled the later one. Fixed in the board, with two new board tests.
- Docs said nothing can be captured on move 1; in fact a rook can take a rook that moved into
  a shared corner. Fixed here, in the plan and in the rules page.
- Smaller fixes: a test comment, a board test that ignored captures on files m–p, and the
  dev sandbox now works at phone width.

### 2. Friends and challenges
Built as decided above. Requests are tied to a shared match and seat, so nobody can use user
ids to spam strangers. A review found 17 problems, all fixed. Among them: a signed-out device
kept receiving friends' updates; deleting an account left invitations open; challenge
invitees could see the ids of strangers invited with them; the challenge prompt opened over
other dialogs. The full check passed on the friends commits on their own (server 319 tests,
web 57). Commits `ac83876`…`de6617e`.

### 3. England: Prime Ministers
Built as decided above (piece letter **M**). Rules, bots, the crowned-knight art, the civ
picker ("Special army" tag and a one-line summary), notes on Play and in the lobby, and docs.
England opens with 34 possible moves instead of 30.

**Balance warning, worth your attention:** in bot-vs-bot free-for-all games England finishes
first about **61%** of the time, against about 27% for the same seat with the standard army.
Changing how much the bots value a Prime Minister barely moves that, so it's the rule itself:
four leaders that each move like a knight or king are very hard to eliminate. In Teams there's
no clear effect. I kept your rule as specified; a balance review is on the to-do list. Ideas if
you want to tone it down: three Prime Ministers (keep one knight), or Prime Ministers that move
only like a king plus one knight jump per turn, or England loses when any two are captured.

Commits `03a45a1`…`c138851`. The full check passed on these commits on their own (server 356
tests, web 96). The review pass found 12 issues, all fixed (commits `9e6fa4e`…`56dc142`): bots
treated any attacked Prime Minister like an attacked king and passed up free material (now
only the last one counts); the crown is bigger so the piece reads at phone sizes; England's
name never truncates in the pickers; screen readers say which Prime Ministers are attacked;
the result says "All Prime Ministers captured". After the bot fix England still wins about
45–60% of bot FFA games, so the balance warning stands. *(The usage limit hit at 8:18 AM and
this pass only finished at about 12:30 PM; see "Usage limit" below.)*

### 7. From the to-do list: basic moderation (needed for the app stores)
Apple and Google require blocking and reporting in apps where players interact, and friend
requests now count. Built for the beta, not for scale (commits `ab5b63c`…`39e411b`):
- **Usernames:** a small profanity/slur filter that sees through capitals, accents, "l33t"
  spellings and separators, with an allowlist so ordinary names aren't caught, plus reserved
  names (admin, moderator, support, the game's name, "Guest-…", bot names…). Username changes
  stay unavailable in the beta.
- **Block:** from a player's menu in a game, on the result screen, in history or on the Friends
  page. It ends the friendship, cancels requests, hides online status both ways, and refuses
  their requests and challenges with the same message as any ineligible request, so they
  can't tell they're blocked. A "Blocked" list has Unblock. It doesn't remove anyone from a
  public game already in progress.
- **Report:** offensive username, harassment (for chat later), cheating or other, with an
  optional note; rate limited. The reported player never learns who reported them.
- **Review queue:** user ids listed in `ADMIN_USER_IDS` can open `/admin/reports` (not linked
  anywhere) to dismiss, warn, reset a username or suspend/unsuspend an account. To use it, put
  your own user id there.
- Terms and Privacy Policy drafts say what's kept and for how long.
- The full check passed on these commits on their own (server 392 tests; one clock-timing test
  missed its 5 ms tolerance by 0.2 ms while three workflows were running, and passed 5 of 5 on
  rerun). The review pass found 23 issues, all fixed (commits `68b80df`…`51d94ac`): the name
  filter can't be beaten by splitting a word with `_`/spaces, look-alike letters or the
  displayed spelling, and no longer refuses ordinary Japanese, Thai, Indian and European
  names; a reset username is held for a year; a blocked player no longer sees an "Add friend"
  button that always fails (which gave the block away); keyboard users can use the Report and
  Block dialogs on the result screen.

### 8. From the to-do list: one-address hosting (`WEB_DIST_DIR`)
The API server can now serve the built web app itself, so the CSC setup can run on a single
hostname without Cloudflare Pages (the guide offers it as option B; Pages stays the default).
Commit `b2c539e`. One follow-up: the page security policy still allows `unsafe-eval` because
the board renderer (PixiJS) needs it; a one-line import can remove that.

### 9. Your follow-up: a general civ card; England's ability is "Magna Carta"
The "Special army" pill is gone. Three designs were mocked up independently and a judge picked
the card-first one, with ideas grafted from the other two (commits `597574a`…`9fe7d12`):
- **Every civ has display copy** in `packages/config` (shared with future clients): a one-line
  description of its emblem and a list of named abilities. England has one, **Magna Carta**,
  with the approved Prime Minister wording. Text only; the rules stay in the engine.
- **Civ list:** standard civs show just their name; a civ with abilities adds a gold
  "✦ Magna Carta" line, so the ones that change the rules stand out even among 100+ civs.
  Search also finds ability names, summaries and emblems ("magna", "prime", "eagle").
- **One civ card everywhere:** under the picker on Play and in the lobby, a preview of the
  highlighted civ on wide screens, and any seated player's civ from the lobby seats or by
  tapping a player's emblem in a game (a popover on wide screens, a bottom sheet on phones).
- A review found 19 issues (contrast, focus, heading order, the popover arrow, touch targets),
  all fixed; axe scans of every surface pass.

### 10. From the to-do list: the board on phones, screen readers and keyboard
Commits `afb2baa`…`743ccc6`:
- **Zoom:** pinch, double tap on an empty square, or the corner zoom button (aiming for ~44 px
  squares on a 390 px phone). One finger on a piece still drags it; one finger elsewhere pans.
- **Screen readers** hear every move in plain words ("West: knight b7 to c9, takes North's
  pawn"), batched when bots move together, then "Your move"; the final moves are read before
  the result.
- **Keyboard:** arrow keys move a cursor over the board, Enter/Space select and move, Escape
  cancels; controls are listed in the board settings.
- The single-origin page's security policy no longer needs `unsafe-eval`.
- A review found 13 issues, all fixed. One left for later: an announcement verbosity setting.

### Test-suite fixes along the way
- The full verification of everything committed (Rust format/lint/tests, `pnpm check`, all
  browser tests, the 49 board specs) found one real flake: the landing page's demo-board test
  compared against Chrome's paint timing, which runs seconds late on a loaded machine. It now
  checks the page's own first-frame mark (`b640902`).
- An off-turn resign clock check had a 5 ms tolerance; now 50 ms with a 200 ms pause so a real
  bug still shows (`cbe19d1`).
- **The username filter refused about 1 in 150,000 random test names** (digits like 2 and 6
  were dropped, gluing letters into words that weren't there). Fixed; 0 hits in 600,000 names
  (`e41e7ba`).
- A phone reconnect test fails since the board zoom commit; being fixed now.

### Usage limit and the retry helper
At 8:18 AM the session limit hit while England's and moderation's review fixes and the
one-address review were running. The workflow retry helper retried instantly, so all three
steps failed within seconds, and nothing woke the session at the 8:50 reset; the work sat
idle until 11:24. The helper now waits on a backoff schedule (2, 5, 10, 15, then 30-minute
steps, up to ~6 h), probing with a tiny agent until the limit clears, and only then retries
for real; probes don't use up the 3 attempts. The three steps were resumed from cache and
finished.

### 6. Docker (M0 leftover): verified for real
Both images build, and a local test stack migrated the database, answered `/api/health` and
played a full solo game against the bot engine in its own container. A real run turned up
problems, now fixed: no `.dockerignore` (Docker was uploading the 5.5 GB build folder),
rollbacks could reuse a newer cached rules engine, the server image carried test tools
(663 MB → ~470 MB), the restore steps failed on a non-empty database, and the Cloudflare
Tunnel made every stack without a token fail (it's now optional, on by default in
production). There's also an optional Docker Postgres on port 5433 for machines without one
(see README). Commit `527cc56`.

### 5. Hosting on a UWaterloo CSC machine: new guide
**[docs/DEPLOY-CSCLUB.md](DEPLOY-CSCLUB.md)**. Verdict: **yes, it works without sudo, and
only the domain costs money** (plus the $2/term CSC membership). The game runs as your normal
user (Node, PostgreSQL, the bot engine and a Cloudflare Tunnel in `~/game`), kept alive by a
cron watchdog, with encrypted nightly backups (optionally off-site to Cloudflare R2's free
tier) and a restore script. No open ports are needed: the tunnel connects outward, so the
privileged-port problem disappears. Scripts in `infra/csclub/` were run end to end as a
normal user (setup, install, update, rollback, crash recovery, backup, restore), and a
skeptical review fixed four bugs in them.

The risks aren't technical:
- **Policy:** CSC machines are for "personal or course work" and its hosting rules forbid
  commercial use. A free beta with no ads or payments is probably fine; **email syscom
  first** (a template is in the guide).
- **Reliability:** best effort. CSC's cloud failed in Winter 2025 and is being rebuilt on
  Proxmox; ask what you'd get today.
- **Membership:** resources are deleted when it lapses, so renew every term.
Commit `a8140df`.

### 7 (prep). Android and iOS apps: plan
**[docs/MOBILE.md](MOBILE.md)** recommends wrapping the web app with Capacitor (one codebase;
the board and rules engine run unchanged), with sign-in done in the phone's browser through
the device-approval flow built for Unity, then bearer tokens. Costs: Google Play $25 once,
Apple $99/year (the only subscription; there is no way to ship on iPhone without it).
**One decision for you:** on iOS, hide the Google/Discord/GitHub/Microsoft buttons or add
Sign in with Apple (Apple requires one or the other). Commit `b2a56d0`.

Then the safe parts of that plan were built (commits `8a24cab`…`293bdb8`):
- **Phones:** content clears notches and home indicators; a phone held sideways gets the
  board beside the side panel; the reconnecting bar no longer pushes the game down.
- **Installable:** a web manifest and icons generated from `APP_NAME` (no offline mode yet).
  `APP_SHORT_NAME` exists for a shorter home-screen label; pick one when you have a name.
- **Feel:** vibration on your moves, captures involving you, check, your turn and game end
  (a "Vibration" setting on touch devices); the screen stays awake during a game.
- **Coming back to the app:** the game reconnects as soon as you return, and the seat can be
  rejoined even after the browser killed the tab. A hint on phones says leaving for more than
  the grace period forfeits.
- **For the apps:** the server accepts the app origins (`NATIVE_ORIGINS`, empty by default)
  and a mobile device-flow client; the web build has a token (no-cookie) mode used only inside
  the apps, and `build:native`.
- A review found 13 problems, all fixed. The serious one: a leftover reconnect token could
  let a different account take over a seat; now the server checks who is reconnecting and
  sign-out forgets saved seats.
- The full check passed on these commits on their own (server 352 tests, web 89).

## Not done / left for you

_(Filled in at the end.)_
