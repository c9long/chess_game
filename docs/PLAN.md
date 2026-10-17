# LinkedLists's Chess Game — Master Plan (v3)

*Working title: "LinkedLists's Chess Game". The previous title was dropped because of trademark risk around "Civilization". The display name lives in one config constant (`APP_NAME`), and code/package names are deliberately neutral, so a future rename touches one line.*

## Context

We are starting from an empty repository (`/home/c9long/chess_game`). The goal is a **4-player chess variant on a 16×16 board** (12×12 until rules version 2, 2026-10-17). It runs in the browser first, at high visual quality. Players pick one of 9 civilizations before each game. For now a civ is cosmetic only: an emblem beside the username, never a flag. Later, civs will get abilities that change the rules, including replacing the king with other "leader" pieces or having no single leader at all. The rules engine is designed around that from day one.

Later the game will be ported to a **Unity PC client sold on Steam**. That client must share the *same* accounts, progression, ratings and match history, and must be able to play in the same lobbies as browser players (crossplay). Every decision below is made so that the Unity port is a **new front-end only**: the rules, server, database and bots stay as they are.

### Decisions confirmed with you
- **Modes:** Free-for-All (FFA) **and** 2v2 Teams, chosen per lobby. Teammates sit opposite each other.
- **Goal:** be the **last civ standing**. Stalemate is a **loss**, never a draw. Ratings are based on placement (survivor first, then reverse order of defeat).
- **Self-check is allowed:** players may leave their leader under attack. There is no checkmate; you lose when your leader is *captured*.
- **Leaders:** "leader" is a piece role, not just the king. Only civs with a single leader can castle, and castling has no attack restrictions. Promotion is only ever to non-leader pieces.
- **Promotion:** on the first line past the board's center.
- **On defeat:** in FFA the army is removed. In Teams a defeated player's pieces stay in play while their partner is still in the game (see §2).
- **Move limit:** 25 full rounds with no capture or pawn move ends the game.
- **Civ picks:** "Blind pick" (duplicates allowed, as in League of Legends' blind mode) now. "Draft" (bans plus pick order, the "serious" mode) is designed now and built later. "Unique-civ matchmaking" comes when there is a player base.
- **Board:** all 256 squares are playable, including the 4×4 corners that start empty.
- **Disconnects:** the clock keeps running, with a 60-second reconnect grace window shown to others. Optional bot takeover in casual games is designed now and built after v1 (tracked in TODO).
- **Rated play:** only in **ranked lobbies**, chosen when the lobby is created. Ranked lobbies take registered accounts only (no guests, no bots) and are timed; casual lobbies are never rated, even with four registered players (changed from "rated iff all 4 seats are registered humans", 2026-10-16). Ratings are 4-player **Elo** (§5).
- **Legal docs:** I draft the Terms, Privacy Policy, account deletion/export and the 13+ age gate (§8). An attorney reviews them before launch.
- **Region:** US-East first.
- **Single source of truth for work:** a repo-root **`TODO.md`** (§10). "Add to to-do" means add an item there. Finished items are ~~struck through~~ there.

---

## 1. The Recommended Stack (and why)

| Layer | Choice | Why this one |
|---|---|---|
| **Rules engine** (the one true implementation of the rules) | **Rust** library, compiled to **WebAssembly** for browser and server, and to a **native Windows DLL** for Unity | We write the rules once and they run identically everywhere. This matters most when civ abilities change the rules: two separate copies of the rules (e.g. JS + C#) would drift apart and cause "desync" bugs. Rust is also fast enough to power the bots. |
| **Bot engine** | **Rust** (same codebase as the rules) running as its own small service | No existing engine supports 4-player 16×16 with these rules (see §6). Sharing the rules crate means every new rule or civ ability is automatically understood by the bots. |
| **Web front-end** | **TypeScript + React 19 + Vite**. The board is rendered with **PixiJS 8** (GPU-accelerated WebGL/WebGPU). Menus use **Tailwind CSS** with **Motion** animations. | PixiJS gives game-quality 2D: smooth 60 fps animation, particles, lighting/glow filters, and crisp art at any screen resolution. React handles menus, lobbies and forms. The board renderer sits behind an interface, so a 3D (Three.js) board could be swapped in later. |
| **Game / API server** | **Node.js 24 LTS + TypeScript** with **Colyseus** for real-time rooms and **Express** for regular web requests | Colyseus is a mature open-source multiplayer framework. It handles lobbies, seat reservation, reconnection and live room lists, and it ships an **official Unity (C#) SDK**. That gives crossplay almost for free. |
| **Authentication** | **Better Auth** (open-source TypeScript auth library) | One vetted library covers email+password, email verification, password reset, OAuth sign-in, **passkeys** (WebAuthn), **TOTP MFA plus backup codes**, **guest accounts**, and **bearer tokens / device-code login** for Unity. Better Auth hashes with scrypt by default; we plug in **argon2id** (`@node-rs/argon2`, m=19456 KiB, t=2, p=1) through its custom hash/verify option. Steam sign-in needs a small custom plugin (§7). |
| **Database** | **PostgreSQL** accessed via the **Drizzle ORM** | The industry-standard reliable relational database. It is free, and it holds users, ratings, match history and progression for both web and Unity. |
| **Hosting** | One small **Linux VPS in US-East** running everything in **Docker Compose**, with the web front-end on **Cloudflare Pages** (free CDN) behind **Cloudflare** DNS/DDoS protection (free) | Cheapest sensible setup. Docker makes the exact same setup portable to a home server or a bigger provider with no code changes. |
| **Repo layout** | Monorepo: **pnpm workspaces** (TypeScript) plus a **Cargo workspace** (Rust) | One place for everything, with shared types. |

### Web addresses, sessions and security wiring
- The web app is served at **`play.<domain>`** (a Pages custom domain, never `*.pages.dev` in production). The API and WebSocket are at **`api.<domain>`**. Being on the same site keeps login cookies first-party, so browsers don't block them.
- Better Auth configuration:
  - `trustedOrigins = [https://play.<domain>]`;
  - cookies are `Secure` and `SameSite=Lax`;
  - CORS allows credentials only from `play.<domain>`;
  - passkey `rpID = <domain>`.
- Colyseus `onAuth` resolves the Better Auth session from the handshake cookie (web) or the bearer token (Unity). It binds the seat to `user.id` and `is_guest`, and ranked rooms reject guests (`account_required`) and bots (`ranked_no_bots`).
- **Real client IPs behind Cloudflare:** the API is reachable only through a Cloudflare Tunnel (an outbound connection from the VPS), so every request comes from Cloudflare and the `CF-Connecting-IP` header Better Auth reads for rate limiting can be trusted. The VPS firewall opens no web ports at all, only SSH. *(Changed from the original Caddy + Cloudflare-only firewall design during M7: on Linux, Docker's published ports bypass `ufw`, so that firewall rule would not have applied. The tunnel also removes TLS certificate management.)*
- **Rate limits:**
  - auth endpoints: Better Auth's limiter plus Turnstile;
  - guest creation: Turnstile plus a per-IP limit;
  - lobby-password attempts: 5 per minute per IP and per room.

### Planned repository layout (neutral names, independent of the game title)
```
chess_game/
  TODO.md               Single source of truth for all work (§10)
  CLAUDE.md             Standing instructions for AI assistants (TODO.md convention, rules pointers)
  crates/
    rules-core/         Rust: board, piece roster & leader roles, move generation, seat status/defeat, FFA+Teams, notation, rules_version, civ-modifier hooks
    bot-engine/         Rust: bot search + evaluation + strength levels
    rules-wasm/         Rust→WASM bindings (used by web client AND Node server)
    rules-ffi/          Rust→C ABI bindings for Unity (later; built as a Windows x64 DLL)
    bot-service/        Rust: small HTTP service wrapping bot-engine with a deadline-aware worker pool
    bot-arena/          Rust CLI: engine-vs-engine tournaments for tuning & ELO calibration
  apps/
    web/                React + PixiJS client
    server/             Node/Colyseus game server + Express REST API + Better Auth
  packages/
    config/             APP_NAME and other shared constants
    protocol/           Shared message/command definitions (TS types → JSON Schema → C# codegen for Unity)
    db/                 Drizzle schema + migrations
    assets/             Original SVG emblems, piece sets, board textures, sounds
  infra/
    docker-compose.yml  Postgres, migrations, server, bot-service (CPU-limited), Cloudflare Tunnel
    backups/            DB backup + restore scripts
  docs/
    PLAN.md             This document, copied into the repo
    RULES.md            The player-facing rules (generated from §2)
    legal/              terms-of-service.md, privacy-policy.md, incident-response.md (versioned; /terms, /privacy)
```

---

## 2. Game Rules Specification (rules version 2)

**Rules version 2 (2026-10-17)** is version 1 on a 16×16 board instead of 12×12: the setup below,
the promotion line moved to the first line past the new centre, castling along the new back
lines. Everything else (statuses, move limit, resign and draw rules, ...) is unchanged. Matches
stored as rules version 1 stay in the history but are not replayed by the current engine
(re-simulation refuses them with a clear error).

### Board & seats
- 16×16 board. Files are **a–p** (left→right from South's view), ranks **1–16** (bottom→top). Square a1 is dark.
- Four seats, with turn order **clockwise: South → West → North → East**. Seats that no longer take turns (removed or frozen) are skipped.
- Seat colors are neutral game colors (e.g. Crimson, Azure, Gold, Jade), never national colors. The civ emblem carries identity.
- **Teams:** South+North vs West+East. Turns alternate teams while all four seats are taking turns. A skipped (frozen) seat can give one team two turns in a row.

### Starting setup ("centered", 4 empty squares at each end, empty 4×4 corners)
| Seat | Back line (exact squares) | Pawns | Pawns advance toward |
|---|---|---|---|
| South | e1 R, f1 N, g1 B, **h1 Q** (light), i1 K, j1 B, k1 N, l1 R | e2–l2 | north (rank 16) |
| North | e16 R, f16 N, g16 B, **h16 Q** (dark), i16 K, j16 B, k16 N, l16 R | e15–l15 | south (rank 1) |
| West | a5 R, a6 N, a7 B, **a8 Q** (light), a9 K, a10 B, a11 N, a12 R | b5–b12 | east (file p) |
| East | p5 R, p6 N, p7 B, **p8 Q** (dark), p9 K, p10 B, p11 N, p12 R | o5–o12 | west (file a) |

**"Queen on her color":** opposing queens face each other on the same line, as in standard chess. South and West are "light" armies (queen on a light square); North and East are "dark" armies (queen on a dark square). Each Teams pairing has one light and one dark army.

**No contact at the start (rules version 2):** the armies start four squares apart, so no piece can capture on move 1 except a rook taking a rook that moved into the shared corner (a1/p1/a16/p16); on the 12×12 board neighbouring corner pawns attacked each other from move 1. Each seat has 30 opening moves: 16 pawn moves, 3 per knight (one into the empty margin) and 4 per rook (into the empty corner). En passant can only arise after pawns have captured their way off their starting files.

### Pieces, rosters and leaders (the foundation for civ abilities)
- Each civ has a **piece roster** (data, not hard-coded logic). Each piece type has a movement definition and an optional **`leader`** role.
- **v1:** every civ uses the standard roster. **King = the single leader**, plus Q, R, B, N and P.
- Civs may replace the king with another leader type, have several leaders, or have no single leader. Each civ declares a **defeat condition**. The default is "defeated when you hold no leader pieces".
- A roster holds the kinds the civ may own, the leader kinds, the **promotion options** (data, independent of the starting army) and the starting **back line** (pawns are always the standard eight, on the standard squares).
- **England, civ version 2** (decided 2026-10-17; the first civilization ability, named **Magna Carta** in the game): the king, queen and both knights are replaced by **four Prime Ministers** (piece letter **M**) on those four squares: `R M B M M B M R`. A Prime Minister moves like a knight **or** a king (union of both; no castling, no double moves). All four carry the leader role and England keeps the default defeat condition, so it is eliminated only when the last one is captured (or by stalemate/timeout/abandon/resign). Promotion options stay Q, R, B, N (never a Prime Minister). England can't castle (more than one leader). England version 1 (standard roster) stays defined for history; new games use each civ's latest version.

### Movement
- All v1 pieces move as in standard chess. "Forward" for a pawn is toward the opposite edge.
- **No check restriction:** any move is legal even if it leaves your own leader attacked.
- **Check indicator** (decided 2026-10-16, replaces the optional "under attack" glow; with several leaders it shows when any is attacked and rings only the attacked ones): information only, never a restriction or an advance warning. Only for a player's own seat (other players and spectators see none): when their turn starts with their leader under attack ("Check! Your leader is under attack" in the turn banner), and right after their own move leaves their leader attacked ("Your leader is in check", shown until it is no longer attacked). A check that opponents create while it is not that player's turn is not shown until their turn starts. The board marks the leader's square(s) with a pulsing vermilion ring and a light inner line (steady under reduced motion; a dedicated `danger` colour no seat uses) and plays a short check sound. "Under attack" and the leader squares come from `rules-core`; the visibility rule is a pure client function (`apps/web/src/lib/check-indicator.ts`). Always on; no setting or lobby toggle.
- **Pawn double-step** from its starting square.
- **En passant** *(behind a rules-config flag until you confirm; see TODO)*:
  - Each seat holds at most one en passant target (skipped square + pawn square), created by its pawn's double-step.
  - The target is cleared when the turn order next reaches that seat (even if that seat is skipped), or when the seat stops taking turns.
  - Any *opponent* pawn that could capture diagonally onto the skipped square may take en passant, provided the skipped square is empty and the double-stepped pawn is still on its square. The capturer lands on the skipped square and the double-stepped pawn is removed.
  - Several seats' targets may be live at once.
- **Castling:** only for civs that start with **exactly one leader piece** (so not England v2), and only while the seat is ACTIVE.
  - Conditions: the leader and that rook have never moved, and the squares between them are empty. **No attack restrictions.**
  - The leader moves two squares toward the rook, and the rook lands on the square the leader crossed. It works the same along each player's own back line (rank 1/16, file a/p). South: K i1→k1 with R l1→j1, or K i1→g1 with R e1→h1.
- **Promotion is mandatory on the first line past the center:** **South on rank 9, North on rank 8, West on file i, East on file h**, 7 steps from the pawn's start. The pawn becomes one of the civ roster's **promotion options**, never a leader or a pawn (every civ so far: Q, R, B, N; England v2 keeps Q and N here although it starts without them).
- Teammates can't capture each other. Their pieces block like your own.

### Seat status (one definition used everywhere)
Each seat is always in exactly one status:
- **ACTIVE**: in the game, holds a live leader.
- **DEFEATED**: lost its last leader, or was stalemated. *Teams only:* still takes its own turns with its remaining pieces while its partner is ACTIVE.
- **FROZEN** *(Teams only)*: ran out of time. Pieces stay on the board, block, and can be captured, but never move, and the seat's turns are skipped. This includes a DEFEATED teammate whose clock later runs out.
- **REMOVED** *(FFA only)*: army taken off the board, turns skipped.

Once a seat is not ACTIVE, any leader it still has becomes an ordinary piece. Capturing it has no further effect, and it cannot castle. *(This is my reading of "stalemate is a loss" together with "pieces remain while one teammate possesses a leader": a stalemated or timed-out player's leader stops counting.)*

### Defeat & end of game
An ACTIVE seat is **defeated** when:
1. **Leader loss:** its last leader is captured (or the civ's custom defeat condition is met). Any opponent may capture a leader on their own turn, and the defeat is immediate.
2. **Stalemate = loss:** at the start of its turn it has **no legal move**. This happens once. Afterwards, a DEFEATED Teams seat with no legal move **passes automatically**: no clock time, no increment, logged as a `pass` event with notation `--`.
3. **Timeout:** its clock reaches zero. In FFA the seat becomes REMOVED; in Teams it becomes FROZEN.
4. **Abandon** *(proposed)*: the 60-second reconnect grace expires. This is treated exactly like a timeout. In casual lobbies with bot takeover (built later), a bot takes the seat instead. If a seat leaves off-turn and that removes the seat-to-move's last legal move, that turn is re-checked: an ACTIVE seat is stalemated, a DEFEATED Teams seat passes.
5. **Resignation** (any time, by a seat still taking turns). FFA: like a timeout, the seat is REMOVED. Teams: a vote with the teammate. The resigner proposes; if the teammate agrees, the **whole team resigns** (both seats out, the game ends at once, the other team wins: winners 1st, the resigning team 2nd; the end reason is `team_resigned`, and every team seat that still took turns, a DEFEATED one included, is recorded with defeat reason Resign; a FROZEN teammate, who could not vote, keeps its own reason); if the teammate declines, nothing happens and both play on. A teammate who no longer takes turns (FROZEN) can't be asked, so the team resigns at once. An unanswered proposal lapses after one full round or when either teammate stops taking turns; after a decline or lapse the proposer makes 2 more moves before asking again (an automatic pass counts as one). The server collects the vote; the rules core applies a team resignation (`apply_resign`). Leaving the game (abandon) still freezes only that seat. *(User rule, 2026-10-16.)*

| | FFA | Teams |
|---|---|---|
| After defeat by leader loss or stalemate | REMOVED (army off the board) | DEFEATED: keeps taking its own turns while its partner is ACTIVE |
| After timeout / abandon | REMOVED | FROZEN |
| After resignation | REMOVED | the whole team resigns (teammate vote): the other team wins |
| Game ends when… | **one ACTIVE seat remains** (last civ standing) | **a team has no ACTIVE seat**. That team's pieces are removed and the other team wins. |
| Placement | 1st = survivor, then reverse order of defeat | Winning team 1st, losing team 2nd |

- **Move limit:** a no-progress counter counts every turn taken (automatic passes included) since the last capture, pawn move (including promotion) or defeat. When it reaches **25 × the number of seats still taking turns**, the game ends. FFA: the surviving players tie for the best remaining placement. Teams: a draw. This is the only way a game ends without a single winner.
- *(Later)* Draw by agreement: all remaining players (FFA) or both teams accept. The result is a shared placement.

### Clocks
- **10+0** (10 minutes per player) or **3+2** (3 minutes plus 2 seconds after each move).
- Only the seat-to-move's clock runs, and frozen or removed seats' clocks stop. The **server is the authority on time**; clients display a countdown. Each event records the server timestamp and remaining time.
- A disconnected player's clock keeps running, with a 60-second reconnect grace window shown to the others. After that, see "Abandon" above.
- **Untimed** (singleplayer vs bots only): no clock runs and nobody can lose on time; disconnects still use the 60-second reconnect grace, then abandon. Untimed games are never rated.

### Rules versioning and civ-ability hooks
- Every match stores its `rules_version` plus each seat's **civ version** (§5). All rules-config values (setup, promotion lines, move limit, en passant flag) are fixed per `rules_version`. Replays re-simulate exactly, even after rules or civs change.
- The rules core exposes **modifier hook points** per civ. They cover roster/leaders, defeat condition, extra or removed moves, capture effects, promotion options, turn-start effects and setup changes. In v1 they are all empty.

---

## 3. Features: Built in v1 vs Designed-for-Later

### Built in v1
1. **Landing page:** "Play as Guest", or "Sign in / Create account". The first visit shows a neutral date-of-birth screen, then a Terms/Privacy checkbox (§8).
2. **Accounts:**
   - email + username + password signup with email verification and password reset;
   - OAuth sign-in;
   - passkeys and TOTP MFA with backup codes (both optional);
   - guests get a temporary account (e.g. "Guest-4821") that can be upgraded later **keeping its history** (§5);
   - account deletion and data export in settings.
3. **Lobby browser:** a live list of public lobbies showing name, mode, time control, seats filled, and a lock icon if password-protected.
4. **Create lobby:** name, mode (**FFA / Teams**), time control (**10+0 / 3+2**), optional password (empty = public), pick mode (**Blind** now; Draft greyed out "coming soon").
5. **Lobby room:**
   - 4 seats, each showing username, **civ emblem beside the name**, and a ready state;
   - the host can **fill any empty seat with a bot and pick its ELO**, kick players, and swap seats (choosing teams);
   - **a new bot gets a random civ**, which the host can change from the seat menu;
   - the game starts once all 4 seats are filled, all civs chosen and all humans ready.
6. **Civ selection** (required before start, duplicates allowed) from Canada, USA, China, Japan, Germany, Russia, England, France, Mali. The picker is a searchable dropdown of thick emblem-and-name rows (not a grid), driven by the roster in `packages/config`, so it scales to 100+ civs; the same dropdown sets a bot's civ from the seat menu.
7. **Live game:**
   - server-authoritative 4-player game with clocks;
   - the board auto-rotates so you are always at the bottom;
   - move hints, drag-or-click to move, last-move highlight, promotion picker;
   - defeat animations (army dissolves in FFA; greyed or frozen armies in Teams);
   - reconnection.
8. **End screen** with placements. The **match is saved to history** with the full event log.
9. **Ranked play and ratings:** a "Ranked" option when creating a lobby (registered accounts only, no bots); Elo per mode × time control, shown on the end screen, in history, and on a public leaderboard (see §5).
10. **Bots** at selectable strength. They think quickly, but each bot move is paced (at least ~0.7 s after the previous move, longer after a defeat) so every move's animation plays smoothly and several bots in a row read naturally (changed from "as quickly as possible", 2026-10-16).
11. **Singleplayer ("Play vs bots"):** pick a civ, a bot strength and FFA/Teams; you play South against three bots at West, North and East with random civs. Untimed (no clocks), unlisted and unrated (no public or shadow rating); saved to history. In FFA the game ends as soon as you are out (leader captured, stalemated, resigned or left): it is not played out between the bots. It is finalized as an agreed draw in the rules core (the bots still in play share 1st, you keep your defeat-order place) and recorded with end reason `player_eliminated` (result screen and history: "You were eliminated"). Teams is unchanged: a team out already ends the game, and a DEFEATED player whose bot partner still has a leader plays on. *(User rule, 2026-10-16.)*

### Designed now, built later (each is tracked in `TODO.md`)
| Feature | How it's accounted for |
|---|---|
| **Move log** | Built (2026-10-17): every action is stored as an ordered event (`match_events`) with notation and clock times and broadcast as an `events` message; a `moveLog` message sends the game so far on join and reconnect. The game screen's move log lists the moves by round (one column per seat) in the engine's notation, with captures, checks, leader captures, passes, defeats and the result marked (side panel on wide screens; a collapsible bar on phones). |
| **Resign** | Built (M5): the `resign` message; in Teams a vote with the teammate (`respondResign`, `resignEvent`); a Teams resignation resigns the whole team (§2). |
| **Offer / accept draw** | `game.offerDraw` and `game.respondDraw` are reserved. Results already support shared placements. |
| **Takebacks, chat, emotes** | Reserved message namespaces (`game.takeback*`, `chat.*`). Basic moderation (blocking, reports, review queue) is built ("Moderation" below); chat moderation comes with chat. |
| **Spectating & replays** | Spectating (built 2026-10-17): `joinById(<match room>, { spectate: true })` puts a spectator in the match's own watch room, which mirrors the match state and passes its messages on but accepts no game messages, so spectators can never act. Public lobbies and games (listed in the lobby browser while they run) and solo games: anyone signed in; password lobbies: the password; challenge lobbies: invitees and the host's friends; never the room's own players; at most 20 accounts at a time (one place each), shown as "N watching". Ranked games are shown at least 2 full rounds late while they run (anti-cheat), with draw offers and resignation votes hidden; the whole game shows once it ends. The Friends page lists friends' running games to watch. Replays (built 2026-10-17) re-simulate `match_events` under the stored `rules_version` and civ versions: `GET /api/matches/:id/replay` (participants only for now) gives the config, the actions and the server's re-simulated final position, the browser replays them with the rules WASM (History → Replay: board, move log with click-to-jump, step/play controls) and checks it reaches the same position. Rules version 1 (12×12) games can't be replayed. |
| **Draft mode** (bans + pick order) | The lobby state machine already has phases `waiting → civ_select → [draft_ban → draft_pick] → countdown → in_game → finished`. `pickMode` and `draftConfig` live on the lobby, and DB tables are reserved. |
| **Unique-civ matchmaking** | A matchmaking queue service slots in beside lobbies. The uniqueness constraint is a queue option. |
| **Civ abilities** | Roster/leader data model, per-civ defeat condition and modifier hooks (§2), versioned civ definitions (§5). |
| **Progression / XP / unlocks / civ mastery** | DB tables reserved, keyed by user id, so they are shared with Unity. |
| **Rematch** | Built (2026-10-17): after the game a seated human proposes (`proposeRematch`), the other humans answer within 60 s (no answer or leaving = no), bots come along; the server opens a fresh lobby (new room, later a new match id) with the same settings, seats, civs and bots, holding the accepting players' seats for 30 s. Ranked only if the game was ranked and all four accepted, else casual with declined seats open. |
| **AFK → bot takeover (casual), premoves** | A bot-service seat can replace an abandoning human. Premoves are a client-side queue validated by the server. |
| **Unity client + Steam** | See §7. |

### Friends and challenges (built 2026-10-17)
*(User request, 2026-10-17.)*
- **Registered accounts only.** Guests see "Create an account to add friends".
- **Who you can add (rule changed 2026-10-17):** any registered player, by exact username or from search, as well as anyone you are playing with or have finished a game with (by match and seat, from player cards, the result screen and history). The user asked: *"don't forget being able to add a friend by username as well. we should enable some sort of profile search."* This replaces the first rule of the same day (requests only after a game together). Bots, guests, deleted and suspended accounts can't be added. Requests never need a user id.
- **"Who can send me friend requests"** (Account page, per user, in the export): **Anyone** (default) or **Only players I've played with** (the old rule: both seated in the same in-progress or finished match; a lobby alone or an aborted game doesn't count). A request back to someone who already asked you is always accepted. Every refusal about the other player (no such username, a guest, a deleted or suspended account, a player who blocked you, a setting that refuses you) is the same neutral "We couldn't send that request." (`NOT_ELIGIBLE`), so neither blocks nor the setting are ever revealed; only limits about the sender (caps, rate limit, your own block) say more.
- **Player search** (Friends page, search-as-you-type): Postgres only, no Elasticsearch. Exact usernames use the unique index on `users.username` (stored lowercase, so case-insensitive); search uses `pg_trgm` with a GIN index on `lower(username)` (migration 0011), prefix matches first, then trigram similarity. At least 3 characters including 3 letters or digits in a row (pg_trgm splits words at `_`, so a query like `___`, `a__` or `x_t` has no selective trigram and would scan every user), at most 10 results, signed-in registered accounts only, 30 searches a minute per user. Results list live registered players only (never yourself, guests, deleted or suspended accounts, or players you blocked; players who blocked you are listed like anyone else, because their profile and leaderboard row are public and hiding them would reveal the block, and a request to them gets the neutral refusal) with username, a small rating (the Elo of their most-played mode and time control), finished games and the friend state (none / request sent / they asked you / friends / can't add, the last only for your own caps). No emails, and user ids only where a friendship or request already exists. Without `pg_trgm` it falls back to prefix matching (DEPLOY.md). Measured on 50k users: 0.05-22 ms per query once the table has been vacuumed (the GIN index needs its statistics).
- **Public profiles** (`/u/:username`, signed-in viewers): username, member since (month and year), Elo per mode and time control (the leaderboard's numbers; "provisional" below the leaderboard's game minimum), finished games, and the favourite civ (most played) with its emblem. Buttons: Add friend (state-aware), Challenge (friends), and the Block / Report menu. Match history stays private (participants only; opt-in public history is a TODO). Unknown, deleted and suspended players all read "Player not found"; guests have no profile. Leaderboard names and Friends rows link to profiles.
- **Limits:** 50 accepted friends per player (both sides checked when a request is accepted), at most 10 outgoing requests waiting, 20 requests per hour per player. Sending a request to someone who already asked you accepts theirs.
- **Actions:** send, cancel, accept, decline, remove, and block (see Moderation below).
- **Where:** a Friends page (add by username, player search, friends with online dots, Challenge and Remove; incoming and outgoing requests; open challenges), profiles, and "Add friend" on player cards in a live game, on the result screen and in match history. States: Add friend / Request sent / Accept request / Friends / Friends full (50-friend cap) / Too many pending (10 requests waiting).
- **Realtime:** a `social` Colyseus room every signed-in registered client joins (cookie on the web, bearer token in the mobile and Unity apps). It pushes friend requests, acceptances, friends' online/offline status (offline after a 5 s grace) and challenges. Every action is also a REST endpoint, so polling works too (`packages/protocol/README.md`). A connection belongs to the session it was opened with: sign-out, revoked sessions, a password reset, expiry or account deletion close it (close code 4103), so a lost device stops receiving friends' data once its token is revoked.
- **Challenges:** from the Friends page, pick FFA/Teams, 10+0/3+2 and up to 3 friends (online or offline). The server creates a casual, unlisted, **invite-only** lobby hosted by the challenger: invited friends join without a password, anyone else gets `not_invited`. Each invitee gets a prompt (Join / Decline) that expires after 5 minutes or when the lobby starts or closes (on the Friends page, or during a game, it arrives as a toast instead, since the page lists it). Removing the friend or deleting an account withdraws an open invitation. The host's lobby shows the countdown, and after the invitation ends offers "Invite again" (same lobby, friends not yet seated). Co-invitees who aren't your friends are shown by name only. Empty seats can still take bots. Ranked challenges are not built yet (TODO).

### Moderation (built 2026-10-17)
*(Basic moderation for the beta and the app stores, which require blocking and reporting in apps with user interaction. Not built for scale.)*
- **Usernames:** the pluggable `NamePolicy` (`apps/server/src/auth/name-policy.ts`) adds a small profanity/slur filter and reserved names (`name-filter.ts`, word lists in `name-terms.json`) to the length/charset rule, at sign-up, when an account chooses its username, and on a guest upgrade. Matching uses normalized forms (case, accents, look-alike Cyrillic/Greek letters, leetspeak, repeated letters, separators, words split across separators); ambiguous words match only as whole words, words that are also common names (surnames, given names) only as the whole name, plus an allowlist of name stems, to avoid the Scunthorpe problem. Both the username and the shown spelling (`displayUsername`) are checked. Reserved: staff and system words (admin, moderator, mod, support, staff, system, official, root, …), placeholders the server shows (Guest-…, Player-…, Deleted player, bot names such as "Bot 1500"), and the distinctive words of `APP_NAME`. Every refusal says only "That username isn't available. Try another." Lobby names get the profanity filter. Existing accounts are never locked out (username sign-in checks the format only).
- **Username changes: not available in the beta.** A username is chosen once; a moderator can reset an offensive one, and the player then picks a new one. A reset name is held for a year (`reserved_names`), so neither that player nor anyone else can take it back. If changes are offered later: at most once per 30 days, with the old name held for 30 days (TODO).
- **Blocking** (registered accounts, up to 500): from the Friends page, a player's card menu in a live game, the result screen or history rows. Blocking removes any friendship and cancels pending requests both ways; the blocked player can't send friend requests (they get the same `NOT_ELIGIBLE` answer as for anyone ineligible) or challenges (`NOT_FRIENDS`, as for any non-friend), so a block is never revealed; the blocked player's seat relations and history show the blocker like any ineligible player, so no "Add friend" is offered that would always fail. Presence goes to friends only, so neither sees the other online. The Friends page lists blocked players with Unblock. **Blocking never removes anyone from a running game** (public or not).
- **Reports:** anyone signed in (guests too) reports a player from the same menus: offensive username, harassment (for chat later), cheating or other, with an optional 500-character note; the match id is attached when it comes from a game. 10 reports per reporter per 24 hours and one open report per reporter, player and game. The reported player never learns who reported them.
- **Review queue** (PoC): `ADMIN_USER_IDS` (comma list; empty = no admins) may open `/admin/reports` (not linked anywhere). It lists open reports oldest first with the reported name (now and when reported), reason, note, match id, reporter and counts per player. Actions: dismiss; resolve with **warn** (recorded only, nothing is sent yet), **rename** (username reset to "Player-1234" and the old name held for a year; the player chooses a new one at their next visit; also closes their other open username reports) or **suspend** (registered accounts only, since a guest can start a new guest session at once; sign-in refused with "This account has been suspended" and a pointer to the Terms' appeals section, every session revoked, `social` connections closed, removed from pre-game lobbies; a running game goes on; match history untouched; also closes their other open reports; lifted with Unsuspend). The server checks admin rights on every endpoint and records who resolved what, when and how.
- **Data:** `blocks` (blocker, blocked, created_at; one row per direction) and `reports` (reporter, reported user, reported name, match id, reason, note, status open/resolved/dismissed, created_at, resolved_by, resolved_at, action), plus `users.suspended_at` / `suspended_by` (migration 0008) and `reserved_names` (name, reserved_until; migration 0009). Blocks are deleted with either account; reports are re-keyed with the account's shared history on deletion (the reported name is cleared, and a deleted moderator's id in `resolved_by` / `suspended_by` is re-keyed too) and deleted one year after review. The export lists your blocks and the reports you filed.

---

## 4. Civilization Emblems (no flags)

All art will be **original** work. We don't copy Civilization VI's assets; we follow its *approach* of one clean, culturally iconic glyph per civ. Where the Civ VI reference uses a state emblem with modern political weight (e.g. heraldic eagles), I propose a culturally iconic alternative. Heraldic eagles aren't flags, so they remain an option if you prefer them. Each row is confirmed with you against Civ VI reference art before final art (TODO).

| Civ | Proposed emblem | Explicitly avoided | Alternate |
|---|---|---|---|
| Canada | Maple leaf (approved by you) | Full flag layout/red bars | — |
| United States | Bald eagle, wings spread | Stars & stripes, star field | Liberty torch |
| China | Traditional Chinese dragon (specified by you) | Five-star motif, red flag | — |
| Japan | Cherry blossom (sakura) | **Rising Sun** (contentious in Korea/China), red disc | Stylized chrysanthemum |
| Germany | Oak branch with acorns (as on German euro coins) | Reichsadler, Iron Cross, tricolour bands | Brandenburg Gate silhouette; modern stylized eagle |
| Russia | Firebird (Zhar-ptitsa, from folklore) | Double-headed eagle, hammer & sickle, tricolour | Onion-dome silhouette |
| England | Tudor rose | St George's cross | Three lions |

England's civ version 2 adds one piece sprite, the **Prime Minister**: the knight's head wearing the king's crown, in the same original piece-set style (`packages/assets/pieces/prime-minister.svg`), drawn for every seat colour and readable at 19 px squares.
| France | Fleur-de-lis | Tricolour | Gallic rooster |
| Mali | Chiwara (Ci Wara) antelope headdress | Green-gold-red bands | Great Mosque of Djenné silhouette |

Emblems are SVG (vector) files, so they stay crisp at any size, from the lobby icon to a board-edge banner. They are drawn in one consistent style and tinted per seat color.

---

## 5. Data Model (shared by web and Unity)

- **Identity** (managed by Better Auth):
  - `users`: id, username unique, email, email_verified, is_guest, created_at, deleted_at.
  - `accounts`: argon2id password hash *or* OAuth/Steam link.
  - `sessions`, `passkeys` and `verifications`.
  - `two_factor`: TOTP secret and backup codes, encrypted at rest (Better Auth default), with `allowPasswordless: true` so OAuth- and passkey-only users can enable TOTP.
- **Guest upgrade (keeps history):** Better Auth creates a *new* user on upgrade and deletes the guest. In its `onLinkAccount({anonymousUser, newUser})` hook, one transaction re-points every user-keyed row (match_players, legal_acceptances, ratings, elo_ratings, future progression) to the new id first. Game tables reference users with `ON DELETE RESTRICT`, never cascade. A nightly job purges guests inactive for 30 days: those with matches are de-identified as in account deletion below, those without are deleted. The same re-pointing is used when merging a Steam-only account into a web account.
- **Legal:** `legal_acceptances` (user_id, document [terms, privacy, guardian], version, kind [accepted, acknowledged], accepted_at, ip_hash). The Terms are `accepted`; the Privacy Policy is `acknowledged`. `ip_hash` is HMAC-SHA-256 with a secret pepper kept outside the database (an environment secret, rotated, on the incident-response rotation list), never an unkeyed hash. Age confirmation stores only an age band (13–15 / 16–17 / 18+) and the confirmation date, never the birth date. `dmca_records` (account id, keyed hash of the account email, notices, counter-notices, strike history) is kept [3] years after the last notice, including after account deletion. `deletion_log` (user_id, deleted_at) is re-applied after any backup restore.
- **Game catalog:** `civilizations` (id, slug, name, emblem_asset, enabled) plus an immutable `civilization_versions` table (civ_id, version, roster JSON, abilities JSON). Every civ has version 1 with the standard roster and no abilities; England also has **version 2** (the Prime Ministers roster with `promotionOptions` and `backLine`, seeded by `packages/db/src/seed.ts`). Lobbies and new games use each civ's latest version (rules-core `CivId::latest_version`); `match_players.civ_version` records it, and re-simulation uses the stored version.
- **Matches:**
  - `matches`: id, status [in_progress, finished, aborted], mode, time_control, rated (Elo applied), ranked (played in a ranked lobby; stays true if the game is aborted or ends unrated), rules_version, started_at, ended_at, end_reason.
  - `match_players`: match_id, seat, team, user_id *or* bot_level, civ_id, civ_version, final_status, placement, defeat_reason, defeat_seq, rating_before/after (Elo, ranked games only).
  - `match_events`: match_id, seq, seat, type [move, promotion, pass, defeat, timeout, abandon, disconnect, reconnect, game_end, *resign, draw_offer, draw_response*], payload JSON, clock_remaining_ms, server_ts.
- **Live-game durability:** the `matches` row is inserted with status `in_progress` when a game starts, and events are appended as they happen (batched). If the server crashes, on restart it marks orphaned games `aborted` / `server_restart` / unrated. Before marking a match finished, the server re-simulates it from DB rows alone and checks the final position.
- **Ratings** (changed from public OpenSkill ratings for every all-registered game, 2026-10-16):
  - **Only ranked games are rated.** A lobby is ranked or casual from creation. Ranked lobbies take registered accounts only, refuse bots, and are timed (never solo/untimed). Aborted games are never rated, and neither is a ranked game whose result can't be applied to all four players (e.g. an account deleted mid-game).
  - `elo_ratings`: user_id, mode, time_control, rating (integer), games, peak, updated_at; one row per user × mode × time control (FFA/Teams × 10+0/3+2 are separate ratings). References users `ON DELETE RESTRICT` like the other game tables.
  - **Elo:** everyone starts at 1200. K factor per player (FIDE): 40 for the first 30 ranked games in that rating, then 20, and 10 once the player's rating has reached 2400 (tracked by `peak`). Placements decide the result; agreed draws and move-limit ties share a placement and count as ties.
    - FFA (N = 4): every pair (i, j) is a mini-game, S_ij = 1 if i placed better, 0.5 tie, 0 worse; E_ij = 1 / (1 + 10^((R_j − R_i)/400)); Δ_i = round(K_i / (N − 1) × Σ_j (S_ij − E_ij)).
    - Teams: a team's rating is the mean of its two players; standard Elo team vs team (S = 1 / 0.5 / 0), and each player moves by round(K_i × (S − E)).
    - Each player's change is rounded on its own (as specified), so a game isn't always exactly zero-sum: ties and mixed K factors can leave the four changes summing to ±1–2 points. That drift is accepted; it is far below the K-factor noise.
  - Public `GET /api/leaderboard?mode=&tc=&limit=`: the top registered players with at least 5 ranked games in that rating; usernames only; deleted accounts and guests never appear.
  - `ratings` (OpenSkill): the hidden **shadow rating** still updates in casual games with bots, rated against fixed bot anchors (`bot_level_anchors`). It is used only to calibrate bot labels, never shown and never touches Elo. The former public OpenSkill pool is no longer written.
- **Reserved for later:** `progression`, `unlocks`, `civ_stats`, `draft_sessions`, `draft_actions`.
- **Moderation** (2026-10-17): `blocks` and `reports`, and `users.suspended_at` / `suspended_by` (see "Moderation" in §3).
- **Friends** (2026-10-17): `friendships` (user_a, user_b, status [pending, accepted], requested_by, created_at, accepted_at), one row per pair in canonical order (`user_a < user_b`, byte order). Foreign keys `ON DELETE RESTRICT` like the other tables, but friendships are personal data: account deletion deletes the user's rows (never re-keyed), and the export includes them. Presence and challenges live only in server memory. `user_settings` (user_id, friend_requests [anyone, played_with], updated_at; no row = defaults; `ON DELETE CASCADE`; in the export) and the `pg_trgm` GIN index `users_username_trgm_idx` on `lower(username)` (migration 0011).
- **Lobbies** (pre-game) live only in server memory (Colyseus).
- **Account deletion** de-identifies rather than erases shared history. Email and username are scrubbed to "Deleted player #…", credentials, sessions and passkeys are deleted, and the `ip_hash` on acceptances is cleared. Opponents' histories stay intact. In the same transaction, the deleted user's `match_players`, `ratings`, `elo_ratings` and `legal_acceptances` rows are re-keyed to a fresh random per-deletion ID that `deletion_log` does not keep (the data is still pseudonymous, not anonymous, and the Privacy Policy says so). For accounts deleted because the user is under 13, each seat is replaced with a per-match "Removed player" value not linked to any ID.

Security: passwords use **argon2id**. Lobby passwords are hashed too. Plain-text secrets are never stored or logged.

---

## 6. Bots: Do We Have to Build It Ourselves? (Yes, mostly.)

### Why existing engines don't fit
- **Stockfish / Fairy-Stockfish** (the strongest open engines, and Fairy-Stockfish supports custom variants via a config file): **2-player only**, the largest board is **12×10**, and there is no way to express self-check-legal play, leader capture or multi-army turns.
- **4pchess** (github.com/obryanlouis/4pchess, MIT license, C++): open-source 4-player engine for chess.com's 14×14 cut-corner board and Teams rules. Useful as a **reference** for proven techniques, not a drop-in.
- chess.com's 4-player bots are proprietary.

So we build our own engine in Rust on top of `rules-core`. It uses well-established algorithms, not research. Estimated effort: about 3–6 weeks for a solid engine with strength levels.

Allowing self-check **helps us**. Move generation doesn't have to check that a move leaves the leader safe. That is simpler and faster for both the server and the bots, and leader capture becomes a simple "game-ending" score in search.

### The most efficient path (cheapest first)
1. **Search:** each ply is one seat's turn, and the next seat always comes from `rules-core` (which skips frozen or removed seats). The position key covers:
   - the seat to move;
   - every seat's status;
   - castling rights;
   - all live en passant targets;
   - the move-limit counter.
   - **Teams:** alpha-beta where the score's sign follows the mover's *team*, flipping only when the team changes, since a frozen seat can give one team two turns in a row. A DEFEATED seat with no legal move plays an explicit PASS ply. Null-move pruning is off when the next mover is on the same team. Standard enhancements apply: iterative deepening, transposition table, move ordering, quiescence, late-move reductions.
   - **FFA:** **Best-Reply Search (BRS+)**, a published multiplayer search that performs strongly in multiplayer board games, with **Paranoid** as the fallback. Both reuse the same code.
2. **Evaluation (no training needed):** handcrafted scoring covering:
   - material (4-player values);
   - piece-square tables (generated for 16×16) rotated per seat;
   - mobility;
   - pawn advancement toward the promotion line;
   - **leader safety (heavily weighted, since leaders can be captured outright)**.

   This alone yields a strong-club-level bot.
3. **Tuning (CPU only, about $0):** Texel tuning / SPSA of evaluation weights on hundreds of thousands of self-play games from `bot-arena`. Runs overnight on any decent PC.
4. **Neural network ("NNUE"), optional and later:** a small network trained on self-play positions, the approach modern Stockfish uses. One to a few days on one GPU: **~$50–300 rented**, or free on a home PC with a gaming GPU.
5. **Not recommended:** AlphaZero-style learning from scratch. It needs thousands of GPU-hours for no benefit at the levels players need.

When civ abilities arrive, move generation updates automatically through `rules-core`. We add evaluation terms per ability and re-run the overnight tuning.

### Bot strength levels ("ELO")
- Selectable: **600, 900, 1200, 1500, 1800, 2100, 2400, Max**.
- Each level maps to a search-node budget, depth cap, evaluation noise and a controlled blunder rate. Blunders that hang the leader are capped by level, so low-level bots are weak without being absurd.
- **Calibration:** `bot-arena` places levels on our scale. The hidden shadow ratings from casual games (§5) then re-anchor the labels against real humans.
- **Caveat:** 4-player ratings aren't comparable to standard chess Elo. "1500" means 1500 *on our ladder*.
- **Speed:** weak levels answer in under 50 ms. Strong levels use 100–500 ms, never more than a safe fraction of their clock. The game server paces bot moves (`BOT_MIN_MOVE_MS`, default 700 ms after the previous move, overlapping the think time) so animations play fully; in timed games the wait runs on the bot's own clock and is skipped when the bot is low on time.
- **CPU cost (honest numbers):**
  - Weak levels (≤1200) use well under 1% of a CPU core per bot. Strong levels and Max use roughly **3–8% of a core per bot** during a game.
  - On the recommended 4-vCPU server, bot-service runs in a CPU-limited container (2 cores) so it can never starve the game referee. That's enough for roughly **50–100 simultaneous games full of strong bots, or several hundred with weak bots**.
  - Under load it shrinks search budgets rather than miss clocks, and refuses new bot seats when saturated.
  - Bots are the main thing that would push us to a bigger server (§9).

---

## 7. Unity + Steam Crossplay (future, designed now)

- **Same server, same protocol:** Unity uses the **Colyseus Unity SDK** for lobbies/games and HTTPS/JSON (documented with OpenAPI) for profile/history. Web and Unity players share lobbies.
- **Same rules:** Unity loads the `rules-ffi` DLL (the Rust rules core compiled for Windows 64-bit) for move hints and replays. C# bindings are auto-generated (csbindgen). The server stays the referee.
- **Same accounts, via a custom Better Auth "steam" plugin** (Better Auth has no built-in Steam support):
  - **In Unity:**
    1. The client gets a ticket from `GetAuthTicketForWebApi(identity)`.
    2. The server verifies it with Valve's `ISteamUserAuth/AuthenticateUserTicket`, using the publisher Web API key, which stays server-side only.
    3. The server checks game ownership and publisher bans.
    4. It finds or creates `accounts(provider='steam', steamid64)` and returns a bearer session. **No account is created until the age screen and the unchecked Terms checkbox have been completed in the client and a `legal_acceptances` row is written** (§8).
  - **On the website:** "Sign in / link with Steam" uses Steam's OpenID 2.0 with server-side verification.
  - **Signing an existing web account into Unity:** the device-code flow (enter a short code shown in Unity on the website). After that, Steam can be linked from Unity. Website Steam sign-in and the device-code flow show the same checkbox if the account has no current acceptance.
  - **Steam account that already has its own history:** an explicit merge using the same row re-pointing as guest upgrade (§5).
- **"Windows x86":** we ship **64-bit (x86-64)** builds. Steam ended support for 32-bit Windows on Jan 1, 2026.

---

## 8. Legal Documents (drafted by me, US-first)

I will draft these from established practice and the case law on online agreements. **They get a short review by a licensed attorney before public launch** (TODO). The drafts are written to be as enforceable and protective as practical. Where there's a real trade-off, I write both options for the attorney to choose between.

- **Clickwrap acceptance, not "browsewrap":** courts enforce agreements where the user takes an affirmative action next to a conspicuous notice (*Specht v. Netscape*, 2d Cir. 2002; *Meyer v. Uber*, 2d Cir. 2017; *Berman v. Freedom Financial*, 9th Cir. 2022).
  - **Signup (every method: email, OAuth, passkey, Steam), first guest game, and first sign-in from any downloadable client:** an unchecked checkbox, "I agree to the [Terms of Service] and acknowledge that I have read the [Privacy Policy]", with links right beside it and no age claim in it. Nothing proceeds until it is checked; OAuth/passkey/Steam buttons stay disabled until then. Under dispute Option A, a line beneath it reads: "These Terms include an arbitration agreement and class-action waiver (Section 18), which you can opt out of within 30 days."
  - Each acceptance records **document version + timestamp**. Material changes trigger re-acceptance.
- **Neutral age screen (COPPA), its own step before the checkbox:**
  - The user enters their full **date of birth** with nothing pre-selected. The screen never mentions an age cutoff (FTC guidance).
  - Under-13s get a neutral "Sorry, we can't create an account right now" and nothing is stored. A persistent cookie blocks an immediate retry.
  - Only the age band (13–15 / 16–17 / 18+) plus the date is kept. Under-18 bands get high-privacy defaults (profile and match history not public by default).
  - If we later learn a user is under 13, the account and data are deleted promptly (TODO moderation item).
  - The screen comes before playing as a guest or creating an account, never before signing in: signing in and account recovery (sign-in, two-step verification, forgot/reset password, email verification) don't ask, because every account was age-confirmed when it was created. The age is stored on the account, so a signed-in account whose stored confirmation is true is never shown the screen, whatever the browser's age cookie says. An account without one (none is created that way today; a future path or a script could) is asked once after sign-in and the answer is stored on it. A recent under-13 answer in the browser still blocks the sign-in pages (open question in TODO).
  - The web client shows the screen only on a settled answer: while the session or the legal status is loading, refetching or failing (a server restart), it keeps the previous answer or shows a loading state, and says the server is unreachable only after repeated failures, retrying on its own.
- **Terms of Service** cover:
  - **eligibility:** 13+. Users under 18 (or the local age of majority) need a parent or guardian's permission. The guardian is not bound unless a guardian-confirmation step is added (attorney decision);
  - **accounts, security and guest accounts;**
  - **acceptable use:** cheating and engine assistance, harassment, offensive usernames;
  - **rated play** and our right to reset ratings;
  - **moderation and termination;**
  - **intellectual property** and the license to user content (usernames, future chat);
  - **DMCA** takedown/counter-notice procedure, the designated agent, and a repeat-infringer policy;
  - **disclaimers and limitation of liability;**
  - **disputes, two options for the attorney:**
    - **(A)** informal resolution, then individual arbitration under AAA/JAMS consumer rules with a small-claims carve-out, a 30-day opt-out, a class-action waiver, and a batching clause for mass arbitration;
    - **(B)** no arbitration: small-claims carve-out, exclusive venue in the operator's county, and a liability cap.

    The trade-off: under consumer arbitration rules the operator pays most fees, and California waives arbitration if fees are paid late. Minors can generally void contracts, which weakens (A) for under-18 users.
  - **governing law, changes to the terms, contact.**

  Placeholders hold the operator's legal name, address and contact email.
- **Privacy Policy** covers:
  - data collected: email, username, password hash, OAuth/Steam IDs, IP for security and rate limiting, game data, basic device/browser info for errors;
  - purposes;
  - **GDPR legal bases:** contract for accounts and gameplay, legitimate interests for security and anti-abuse. Consent is *not* relied on, so the EU's varying child-consent ages don't apply;
  - processors: OVHcloud, Cloudflare, Resend, Sentry and OAuth providers. We accept their standard data processing agreements;
  - **no selling or sharing of personal data** (CCPA language included voluntarily; the law likely doesn't apply at our size);
  - **CalOPPA disclosures** (California law that does apply): we don't track across sites, so Do-Not-Track and GPC signals don't change our behavior; no third-party cross-site tracking; how policy changes are announced; effective date;
  - retention, including that **backups roll off after 30 days**;
  - security measures and **breach notification as required by law**;
  - user rights (access, export, correction, deletion);
  - children's privacy, international transfers, contact.
- **Cookies:** only **strictly-necessary** cookies (login session, CSRF, preferences). With no analytics or advertising cookies, no consent banner is needed (US and EU). Adding analytics later means adding consent (TODO).
- **Account deletion & export** in settings:
  - export is a JSON download of profile, ratings and match history; guest sessions also get "Download my data" and "Delete guest account" in Settings, plus a reference code for email requests;
  - deletion de-identifies as in §5, immediately;
  - backups holding the old data roll off within 30 days;
  - `deletion_log` is re-applied after any restore, so deleted accounts never come back.
- **Incident response:** a one-page runbook (`docs/legal/incident-response.md`):
  1. detect, contain, rotate secrets, and force password and session resets;
  2. work out which data and users are affected, and in which states or countries;
  3. notify users by email, plus state attorneys general or EU/UK regulators where thresholds require it, within the shortest applicable deadline (GDPR: 72 hours).

  Security logs are kept for 90 days.
- **Emails:** transactional only (verification, password reset, security alerts), so CAN-SPAM marketing rules don't apply. Future marketing needs opt-in and an unsubscribe link (TODO).

---

## 9. Infrastructure & Costs — Explained for Someone New to This

### What each piece is, in plain language

| Thing | What it is (analogy) | What it does for the game |
|---|---|---|
| **Domain name** (e.g. yourgame.com) | Your street address on the internet. | Lets people type a name instead of a number to reach the game. |
| **DNS** | The internet's phone book. | Translates the domain into the address of our server. Cloudflare provides it free. |
| **Server / VPS** ("Virtual Private Server") | A computer that is always on, rented by the month and kept in a professional data center with backup power and fast internet. Ours is in Virginia (US-East). | Runs the game referee (checks every move, runs clocks), the lobby system, the bots, the account system and the database. |
| **Front-end / static hosting / CDN** | The game's "storefront" files (graphics, code that runs in the browser), copied to warehouses around the world so they're always close to the player. | Makes the game load fast everywhere. Cloudflare Pages does this free. |
| **WebSocket** | An open phone line between the browser and the server, instead of sending letters back and forth. | Moves, clocks and lobby updates arrive instantly in both directions. |
| **Game server (Node.js + Colyseus)** | The referee and the maître d'. | Seats players in lobbies, enforces the rules (it never trusts a player's computer), runs the official clocks and records results. |
| **Rules engine (Rust → WebAssembly / DLL)** | A single precision-made engine part that fits both the "web car" and the future "Unity car". | Guarantees the browser, server, bots and future Unity game all agree on what's legal. |
| **Bot service** | A separate worker who only thinks about chess moves, with a fixed share of the computer so it can't crowd out the referee. | Plays for empty seats at the chosen strength. |
| **Database (PostgreSQL)** | A fireproof filing cabinet with an index. | Stores accounts, ratings, match history and progression permanently, saving each move as it happens. This is the data Unity will reuse. |
| **Password hashing (argon2id)** | A one-way blender: you can turn a password into a smoothie, but never the smoothie back into the password. | Even if the database were stolen, passwords couldn't be read. At login we blend what was typed and compare smoothies. |
| **OAuth ("Sign in with Google/Discord…")** | A valet key: Google vouches for who you are without giving us your Google password. | Faster signup. Free for the providers we picked. |
| **Passkeys** | Your device's fingerprint/face unlock acting as your key; nothing to remember or leak. | Optional password-free login, very resistant to phishing. |
| **MFA / TOTP** | A second lock: a 6-digit code from an authenticator app that changes every 30 seconds. | Optional extra account protection. |
| **HTTPS / TLS certificate** | The padlock in the browser bar: an armored truck for data in transit. | Encrypts everything between player and server. Free (Cloudflare handles it; the tunnel encrypts the hop to the VPS). |
| **Docker / Docker Compose** | Shipping containers: each program is packed with everything it needs, and one list describes the whole fleet. | One command starts the whole system, identically on a rented server, a home server or a laptop. |
| **Transactional email** | A mail carrier for automatic emails. | Sends "verify your email" and "reset your password" messages. |
| **Backups** | Copies of the filing cabinet stored in another building, kept for 30 days. | If the server dies, we restore accounts and history. |
| **Monitoring / error tracking** | Smoke alarms. | Alerts us when the site is down or errors happen, before players complain. |
| **CI/CD (GitHub Actions)** | An automatic inspector and delivery truck. | Every code change is tested automatically, then deployed. Deploys wait for running games to finish first. |
| **CAPTCHA (Cloudflare Turnstile)** | A bouncer that quietly checks "are you a human?" | Stops bots from mass-creating accounts or guessing passwords. Free. |

### Cost breakdown (Oct 2026 prices; check at purchase time)

**Stage 0: Development (now): $0/month.** Everything runs on your current computer (WSL Linux). PostgreSQL 16, Node 24 and pnpm are already installed. Rust and Docker get installed in M0.

**Stage 1: Public launch / beta (up to a few hundred concurrent players)**
| Item | Provider (recommended) | Cost |
|---|---|---|
| Server, US-East (4 vCPU, 8 GB RAM, 75 GB NVMe) | **OVHcloud US "VPS-2"**: pick the US-East (Virginia) location at checkout. ≈ $8.50/mo is the price with 12 months paid upfront; month-to-month costs somewhat more. OVH renames tiers often, so **check the specs, not the plan name**. (The cheaper VPS-1, 2 vCPU / 4 GB at ≈ $4.54, only suits a closed beta. Hetzner, previously the cheapest, raised prices sharply in 2026.) | **≈ $9–15/mo** |
| Front-end hosting + CDN | Cloudflare Pages | $0 |
| DNS, DDoS protection, HTTPS at edge, Turnstile CAPTCHA | Cloudflare Free | $0 |
| Domain name (.com) | Cloudflare Registrar or similar | **≈ $10–15/year** |
| Database | PostgreSQL on the same server | $0 extra |
| Backups (nightly, encrypted, off-site, 30-day rolling) | Cloudflare R2 (10 GB free) or Backblaze B2 | $0–1/mo |
| Transactional email | Resend free tier (3,000/mo, **but only 100/day**) | $0 now. **Upgrade to Pro ($20/mo) before any public announcement**, because a launch spike would exceed 100 verification emails/day. Until then, over-cap emails are retried the next day. |
| Error tracking / uptime alerts | Sentry free Developer tier; Better Stack free tier or Sentry uptime monitors. (UptimeRobot's free plan is non-commercial only.) | $0 |
| OAuth: Google, Discord, GitHub, Microsoft | — | $0 |
| Code hosting & automated tests | GitHub (free tier) | $0 |
| **Monthly total** | | **≈ $10–20/month now, ≈ $30–40/month from public launch (email Pro) + ≈ $12/year domain** |

If many players fill seats with strong bots, the next step is a bigger OVH tier (≈ $12–20/mo) or a second small server just for bots.

**One-time / later costs**
| Item | Cost | When |
|---|---|---|
| Steam Direct fee | **$100 per game**: non-refundable, but Valve pays it back once the game earns $1,000 on Steam. Valve takes 30% of sales. | Unity version ready to list |
| Unity engine | Free (Unity Personal) under its revenue threshold (currently $200k/yr; verify then) | Unity phase |
| Sign in with Apple | $99/year (Apple Developer Program). Deferred because it isn't free. | Optional |
| Original art: 9 emblems, piece set, board textures, sounds | ≈ $0 (self-made / AI-assisted then hand-cleaned) to ≈ $1,500–4,000 (commissioned artist) | Before public launch |
| Attorney review of legal drafts + trademark search on the final name | ≈ $500–2,000 | Before public launch / Steam |
| Business entity (LLC) + registered agent / business mailing address (so your home address isn't published in the Terms) | ≈ $50–500 to form; $0–800/yr state fees depending on state; ≈ $50–150/yr mail/agent service | Before public launch (ask the attorney) |
| DMCA designated-agent registration (US Copyright Office) | $6 per 3 years | Before public launch |
| EU/UK representative (if EU/UK users are accepted; otherwise geo-block) | ≈ $100–500/yr | Before public launch, if applicable |
| Optional bot neural-network training (GPU rental) | ≈ $50–300 total | Only if stronger top bots are wanted |

**Stage 2: Growth (thousands of concurrent players):** larger or second server (bots on their own machine), managed PostgreSQL, Redis (lets several game servers share lobby info), paid email tier: **≈ $50–150/month**. Chess messages are tiny, so bandwidth stays negligible.

### Should you build a home Linux server?
**For hosting the live game: not needed.** Costs are low (≈ $10–40/mo). An always-on home machine (50–100 W) costs about $6–12/month in electricity alone. On top of that come hardware ($300–1,000), slower home upload speeds, outages, ISP rules that often forbid hosting, and the security exposure of your home network.

**Where a home machine is genuinely useful:** a strong CPU (and optionally a gaming GPU) is great for **bot tuning, bot-arena testing and optional neural-network training**, which saves the GPU rental. Because everything runs in Docker, hosting can still move home later via Cloudflare Tunnel, with no router ports opened.

---

## 10. `TODO.md` — Single Source of Truth (created in M0)

**Conventions** (also written into `CLAUDE.md`, so every future assistant session follows them):
- Every piece of work lives in `TODO.md`. "Add to to-do" means a new item here.
- Completion is marked **only** by ~~strike-through~~ plus the date, in place. There are no checkboxes, and items are never silently deleted.
- Milestone items link to the relevant `docs/PLAN.md` section.

**Initial contents:**
- **Now: v1 build.** M0–M7 (§11), one item per sub-deliverable.
- **Open rules questions:**
  - confirm the en passant rule (§2; it stays behind a flag until then);
  - confirm "Abandon = timeout" after the 60-second grace;
  - confirm that a stalemated or timed-out player's leader no longer keeps a Teams team alive;
  - ~~Teams resignation: player-only or whole team?~~ Whole team, by teammate vote (§2, decided 2026-10-16);
  - ~~attacked-leader glow: default on or off, and a per-lobby toggle?~~ Replaced by the check indicator: always on, own seat only, no toggle (§2, decided 2026-10-16);
  - review corner-pawn opening balance (East is exposed on both corners) with bot-arena data.
- **Before public release:**
  - moderation: ~~profanity filter, reserved/impersonation names, report button + review queue, username change policy~~ (built 2026-10-17, §3 "Moderation"); a process for deleting accounts found to belong to under-13s;
  - legal: attorney review of Terms/Privacy (choose dispute option A or B, confirm minor/guardian language); fill in the legal placeholders;
  - business: decide on and form a business entity and get a business mailing address; trademark search for the final name; register a DMCA agent ($6) and set a 3-year renewal reminder;
  - operations: write and rehearse the incident-response runbook; restore-from-backup drill, including re-applying `deletion_log`; upgrade Resend to Pro;
  - art: confirm each emblem against Civ VI reference art, then produce final original art for all 9.
- **Before marketing in the EU/UK:** decide on Art. 27 EU and UK representatives; apply UK Children's Code high-privacy defaults for under-18s (attorney confirms).
- **Anti-cheat (not now; ideas kept):**
  - statistical engine-match analysis on rated games (compare moves with bot-engine top choices, weighted by position complexity);
  - move-time consistency analysis;
  - report-driven review queue;
  - account trust levels (new accounts need N casual games before rated);
  - rating rollback for confirmed cheaters;
  - spectator delay on rated games (built 2026-10-17: ranked games are shown to spectators at least 2 full rounds late).
- **Monetization (undecided):** options are cosmetic piece sets/boards/emblem frames, a supporter subscription, a paid Steam version alongside a free web version, or battle-pass-style progression. Constraints: no pay-to-win, and the choice affects progression data design.
- **Mobile:** responsive layout, touch drag/tap controls, portrait board scaling, PWA install.
- **Designed-for-later features:**
  - **in-game:** move log UI, resign, draw offers, takebacks, chat/emotes, spectating, replays, rematch, AFK bot takeover (casual), premoves (built so far: move log, resign, draw offers, spectating, replays, rematch);
  - **game modes:** draft mode, unique-civ matchmaking, civ abilities, progression/XP/unlocks/civ mastery;
  - **Unity / Steam:** Unity client, Steam auth plugin + publisher Web API key, Steam integration;
  - **platform:** Sign in with Apple, NNUE bots, Redis scale-out, analytics (with cookie consent), marketing email (opt-in).

---

## 11. Build Milestones (in order)

| # | Milestone | Outcome |
|---|---|---|
| M0 | **Foundation** | Monorepo, pnpm + Cargo workspaces, lint/format, GitHub Actions CI, Docker Compose dev stack (Postgres), `docs/PLAN.md`, **`TODO.md`**, **`CLAUDE.md`** (TODO convention), `packages/config` with `APP_NAME`. |
| M1 | **Rules core (Rust)** | Board/setup; roster + leader roles; seat statuses; pseudo-legal move generation for 4 orientations (no self-check filtering); leader capture; stalemate-once then auto-pass; timeout/abandon hooks; FFA removal vs Teams defeated/frozen; single-leader castling without attack checks; en passant behind a flag; mid-board promotion to non-leaders; move-limit counter; notation; `rules_version`; empty civ hooks. WASM build. `docs/RULES.md`. |
| M2 | **Board renderer (web)** | PixiJS board with original art; smooth animations (move, capture particles, FFA army dissolve, Teams grey/freeze); check indicator on the leader's square (replaced the optional attacked-leader glow, 2026-10-16); move hints; drag/click; promotion picker; auto-rotation; sounds. **Hot-seat sandbox (all 4 sides on one screen) in dev/staging builds only, never in production.** Colorblind-safe palette, reduced motion. |
| M3 | **Accounts + legal** | Better Auth: guest + history-preserving upgrade; email/password with argon2id via custom hash/verify, plus verification and reset (Resend); OAuth (Google, Discord, GitHub, Microsoft); passkeys; TOTP MFA + backup codes (`allowPasswordless`); Turnstile; rate limits; real-IP handling. Neutral DOB screen, versioned clickwrap, `docs/legal/` drafts at /terms and /privacy, account deletion + JSON export + `deletion_log`. |
| M4 | **Lobbies** | Colyseus lobby list + lobby room: create (mode, time control, optional hashed password with attempt limits); join; seats/teams; blind civ pick with emblems beside names; host controls; bot seats with level picker and random-but-editable civ; ready/start; session-bound seats. |
| M5 | **Live games** | Authoritative game room; server clocks (10+0, 3+2); 60 s reconnect grace + abandon; all defeat paths; end screen; **incremental event persistence + abort-on-restart**; re-simulation check; ratings (ranked lobbies with 4-player Elo + hidden OpenSkill shadow pool; changed from public OpenSkill, 2026-10-16). |
| M6 | **Bots** | Engine (Teams team-signed alpha-beta, FFA BRS+); handcrafted eval; strength levels; bot-service (CPU-limited, deadline-aware, load-shedding); `bot-arena` calibration; overnight tuning. |
| M7 | **Deploy** | OVHcloud US VPS-2 (4 vCPU/8 GB) + Docker Compose + Cloudflare Tunnel (no open web ports); Cloudflare Pages at `play.<domain>`, API at `api.<domain>`; **draining deploys**; nightly 30-day off-site backups with a tested restore; monitoring; staging. Walkthrough: [DEPLOY.md](DEPLOY.md). |

---

## 12. Verification (how we prove each part works)

- **Rules core:**
  - Unit tests for every rule in §2:
    - setup squares and colors, and the 30 opening moves per seat (the only round-1 contact is a rook capture in a shared corner);
    - leader capture by a non-adjacent seat;
    - stalemate-once, then auto-pass;
    - Teams cases: stalemated A plus B losing its leader → team out; frozen A plus B losing its leader → team out; leaderless teammate timing out → frozen;
    - castling with no attack checks, and only while ACTIVE;
    - promotion on rank 9/8 and file i/h;
    - en passant expiry when the double-stepper is skipped;
    - the move-limit counter resets on defeat and with a frozen seat.
  - "Perft" move-count tests on hand-verified positions, including frozen or passing seats.
  - Randomized fuzzing of millions of self-play games asserting invariants: no pieces for REMOVED seats, FROZEN seats never move, every game terminates.
  - WASM and native builds produce identical results.
- **Server:** integration tests with the real server and 4 simulated WebSocket clients, covering:
  - lobby join/password (including the attempt limit) and civ pick, including bot civ assignment;
  - clocks (increment, timeout, and that passes cost no time);
  - reconnect grace and abandon;
  - every defeat path in FFA and Teams;
  - a server kill mid-game → match marked aborted on restart;
  - saved events re-simulating to the same final position.
- **End-to-end (Playwright browser automation):**
  - guest → DOB screen → accept terms → create lobby → fill 3 bots → play to game end → match in history;
  - guest → upgrade to an email account → old match still in history;
  - signup → verify email → enable TOTP → MFA login;
  - passkey registration/login with Chrome's virtual authenticator;
  - account export and deletion (history de-identified and re-keyed; deleted account stays deleted after a test restore).
- **Security checks:** stored hashes use the argon2id format; no plaintext secrets in DB or logs; rate limits work with real client IPs behind Cloudflare; Turnstile on auth and guest creation; lobby passwords hashed; acceptance records written; cookies/CORS/passkey rpID correct on `play.`/`api.` subdomains.
- **Bots:** `bot-arena` tournaments confirm each level beats the one below and moves stay within time budgets.
- **Load test (k6 + bot-arena):** measure simultaneous games per vCPU at each bot level mix (e.g. 70% weak / 30% strong) on a VPS-2-equivalent machine. Targets: bot moves within budget, referee latency under 100 ms, p99 move latency under 1 s.
- **Visual quality:** screenshot review at 1080p/1440p/4K, 60 fps check in browser performance tools, colorblind simulation.

---

### Sources consulted (Oct 2026)
- Hetzner 2026 price increases: [findstack](https://findstack.com/resources/hetzner-price-increase-2026), [wz-it](https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/)
- OVHcloud US VPS range: [us.ovhcloud.com/vps](https://us.ovhcloud.com/vps/)
- Resend free tier: [costbench](https://costbench.com/software/email-api/resend/free-plan/)
- Steam ends 32-bit Windows support: [guru3d](https://www.guru3d.com/story/steam-client-drops-32bit-support-on-windows-10-and-11/)
- Fairy-Stockfish board-size limit (12×10): [TalkChess](https://talkchess.com/viewtopic.php?p=837333)
- 4pchess engine (MIT, Teams): [GitHub](https://github.com/obryanlouis/4pchess)
- Colyseus Unity SDK: [docs](https://docs.colyseus.io/getting-started/unity)
- Better Auth plugins: [docs](https://better-auth.com/docs/plugins)
