# How to Play

Four-player chess on a 12×12 board. These are the rules of **rules version 1**. If you know regular chess, most of it will feel familiar. This page covers what is different.

Rules marked **(provisional)** are switched on for now but may still change.

---

## The board and the players

- The board has 12 files (columns), **a** to **l**, and 12 ranks (rows), **1** to **12**. Every square is playable, including the empty 2×2 corners. Square a1 is dark, as in normal chess.
- Four players sit on the four sides: **South** (bottom), **West** (left), **North** (top) and **East** (right).
- Turns go **clockwise: South → West → North → East**, then back to South. Players who no longer take turns are skipped.
- Everyone gets the same army: 8 pawns, 2 rooks, 2 knights, 2 bishops, 1 queen and 1 king. Your civilization is shown as an emblem next to your name. In this version it is cosmetic only.

### Game modes

- **Free-for-All (FFA):** everyone for themselves. Be the last player standing.
- **Teams (2 vs 2):** the players sitting opposite each other are partners: **South + North** against **West + East**. You can't capture your partner's pieces, and they block your pieces just like your own do. Turns alternate between the teams while all four players are taking turns; a frozen player's turn is skipped, so one team can get two turns in a row.

### Starting position

Each army sits centered on its own edge, with two empty squares at each end of the back line.

| Seat | Back line | Pawns | Pawns move toward |
|---|---|---|---|
| South | c1 Rook, d1 Knight, e1 Bishop, **f1 Queen**, g1 King, h1 Bishop, i1 Knight, j1 Rook | c2 to j2 | North (rank 12) |
| North | c12 Rook, d12 Knight, e12 Bishop, **f12 Queen**, g12 King, h12 Bishop, i12 Knight, j12 Rook | c11 to j11 | South (rank 1) |
| West | a3 Rook, a4 Knight, a5 Bishop, **a6 Queen**, a7 King, a8 Bishop, a9 Knight, a10 Rook | b3 to b10 | East (file l) |
| East | l3 Rook, l4 Knight, l5 Bishop, **l6 Queen**, l7 King, l8 Bishop, l9 Knight, l10 Rook | k3 to k10 | West (file a) |

As in normal chess, each queen starts on her own color, so opposite queens face each other. South and West are the "light" armies (queen on a light square); North and East are the "dark" armies.

**Watch your corners:** neighboring armies' corner pawns can capture each other from the very first move (c2 and b3, j2 and k3, c11 and b10, j11 and k10). East moves last, so both of East's corner pawns can be taken before East has moved.

---

## Moving

All pieces move exactly as in regular chess. "Forward" for a pawn means toward the far side of the board: up for South, down for North, right for West and left for East.

### There is no check

- **You may leave your king under attack, or even move it into danger.** Nothing stops you.
- There is no checkmate. You lose your king when someone actually **captures** it.
- The game may highlight a king that is under attack. That is just information. Only an **active** player's king is highlighted (see Player status below).

### Pawns

- A pawn moves one square forward, or **two squares** on its first move (from its starting line) if both squares are empty.
- It captures one square diagonally forward.
- **Promotion happens halfway:** when a pawn reaches the first line past the middle of the board, it **must** promote. That line is **rank 7 for South, rank 6 for North, file g for West and file f for East**, five steps from where the pawn started. You choose a queen, rook, bishop or knight. You can never promote to a king.

### En passant (provisional)

- When a pawn moves two squares, it can be captured **en passant** ("in passing") as if it had moved only one square.
- Any opponent's pawn that could capture diagonally onto the square the pawn skipped over may do so, as long as that square is still empty and the pawn that moved two squares hasn't moved or been captured. The capturing pawn lands on the skipped square and the other pawn is removed.
- The chance lasts until it is the moving player's turn again: once the turn order comes back round to that player (even if their turn is skipped), it's gone. It is also gone if that player leaves the game.
- Several players' en passant chances can be open at the same time.

### Castling

- Castling works like regular chess, along your own back line: the king moves **two squares toward a rook**, and that rook jumps to the square the king crossed. Example for South: king g1 → i1 with rook j1 → h1, or king g1 → e1 with rook c1 → f1.
- You may castle only if the king and that rook have **never moved** and every square between them is **empty**.
- **No attack restrictions:** you may castle out of, through or into an attacked square.
- You can castle only while you are an **active** player (see below).

---

## Player status

At every moment each player has exactly one status:

| Status | What it means |
|---|---|
| **Active** | Still in the game, with their king. |
| **Defeated** | Lost their king, or was stalemated. *In Teams only*, a defeated player keeps taking turns with their remaining pieces for as long as their partner is still active. |
| **Frozen** | *Teams only.* Ran out of time (or left the game). The pieces stay on the board: they block squares and can be captured, but they never move again, and the player's turns are skipped. A defeated player who later runs out of time also becomes frozen. |
| **Removed** | *Free-for-All only.* The player's army has been taken off the board, and their turns are skipped. |

**(provisional)** Once a player is no longer active, a king they still have becomes an ordinary piece. Capturing it changes nothing, and it can't castle. In particular, a stalemated or timed-out Teams player's king does **not** keep their team alive.

---

## How you lose

You are knocked out when any one of these happens:

1. **Your king is captured.** Any opponent can do it on their own turn, and it takes effect immediately.
2. **Stalemate is a loss, not a draw.** If you have **no legal move** at the start of your turn, you are defeated. In Teams this happens only once. After that, whenever a defeated player has no legal move on their turn, they **pass automatically**. A pass uses no clock time, earns no increment, and appears in the move log as `--`.
   - Your turn starts once the previous player has finished. If, while it is your turn, another player leaves the game and that takes away your last legal move (for example, your only move captured one of their pieces and, in Free-for-All, their army is taken off the board; or it was an en passant capture of their pawn, which expires when they leave), your turn is judged again: an active player is stalemated, and a defeated Teams player passes.
3. **Your clock runs out.**
4. **(provisional) You leave the game.** If you disconnect, your clock keeps running and the other players see a 60-second reconnect timer. If you don't come back in time, this counts exactly like running out of time.

What happens next depends on the mode:

| | Free-for-All | Teams |
|---|---|---|
| King captured or stalemated | **Removed**: your army leaves the board | **Defeated**: you keep playing your pieces while your partner is active |
| Out of time or left the game | **Removed** | **Frozen** |

---

## How the game ends

- **Free-for-All:** the game ends when only **one active player** is left. That player wins.
- **Teams:** the game ends as soon as a team has **no active player**. That team's pieces are removed and the other team wins. For example, if your partner was stalemated or ran out of time and then your king is captured, your team is out.

### The move limit

- The game counts every turn taken (automatic passes included) since the last **capture**, **pawn move** (promotions count) or **defeat of a player**.
- When that count reaches **25 × the number of players still taking turns**, the game ends. With four players that is 100 turns, or 25 full rounds. Removed and frozen players don't count.
- In Free-for-All the remaining active players tie for the best remaining place. In Teams the game is a draw.
- This is the only way a game can end without a single winner.

### Placements

- **Free-for-All:** the winner is 1st. Everyone else is placed in reverse order of being knocked out, so the last player knocked out is 2nd. If the move limit ends the game, the remaining players share the best place (for example 1st, 1st, 3rd, 4th).
- **Teams:** both players of the winning team are 1st and both players of the losing team are 2nd. A draw puts everyone 1st.

---

## Clocks

- Time controls are **10+0** (10 minutes each) or **3+2** (3 minutes each, plus 2 seconds after every move).
- Only the clock of the player whose turn it is runs. Frozen and removed players' clocks stop.
- The game server keeps the official time.
