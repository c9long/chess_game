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
- **Opening:** the armies start four squares apart, so nobody can capture on move 1 any more
  (on 12×12 the corner pawns could). Every seat has exactly 30 opening moves.
- **Bots:** moves cost about 1.3–1.5× more thinking time on the bigger board, but every level
  still answers within its time target, and arena games confirm each level still beats the
  one below.
- **Old games:** 12×12 matches stay in history; replaying them is refused cleanly instead of
  producing wrong positions.
- **En passant** practically never comes up early now: a pawn can only be taken en passant once
  enemy pawns have moved off their starting files by capturing.
- **Phones:** at 390 px wide a square is only about 19 px. Pieces still read, but taps are
  small. A zoom for the board on phones is on the to-do list.
Commits `622407b`…`54c9fd1`. A review pass (rules attack tests + visual check) follows.

### 2. Friends and challenges
Built as decided above. Requests are tied to a shared match and seat, so nobody can use user
ids to spam strangers. A review found 17 problems, all fixed. Among them: a signed-out device
kept receiving friends' updates; deleting an account left invitations open; challenge
invitees could see the ids of strangers invited with them; the challenge prompt opened over
other dialogs. The full check passed on the friends commits on their own (server 319 tests,
web 57). Commits `ac83876`…`de6617e`.

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

## Not done / left for you

_(Filled in at the end.)_
