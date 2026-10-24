# How to Play

Four-player chess on a 16×16 board. These are the rules of **rules version 3**. If you know regular chess, most of it will feel familiar. This page covers what is different.

Rules marked **(provisional)** are switched on for now but may still change.

Rules version 2 is version 1 (with resigning and draws by agreement) on a bigger board: 16×16 instead of 12×12, with the promotion line moved to match. Everything else is unchanged. Games played on the old 12×12 board stay in your match history.

Rules version 3 (2026-10-24) is version 2 without en passant: a pawn that moves two squares can't be captured "in passing". Games played under version 2 still replay exactly as they were played.

---

## The board and the players

- The board has 16 files (columns), **a** to **p**, and 16 ranks (rows), **1** to **16**. Every square is playable, including the empty 4×4 corners. Square a1 is dark, as in normal chess.
- Four players sit on the four sides: **South** (bottom), **West** (left), **North** (top) and **East** (right).
- Turns go **clockwise: South → West → North → East**, then back to South. Players who no longer take turns are skipped.
- Almost every army is the same: 8 pawns, 2 rooks, 2 knights, 2 bishops, 1 queen and 1 king. Your civilization is shown as an emblem next to your name, and for most civilizations that is all it changes. **England** has a civilization ability, Magna Carta (see [Civilization abilities](#civilization-abilities)).

### Game modes

- **Free-for-All (FFA):** everyone for themselves. Be the last player standing.
- **Teams (2 vs 2):** the players sitting opposite each other are partners: **South + North** against **West + East**. You can't capture your partner's pieces, and they block your pieces just like your own do. Turns alternate between the teams while all four players are taking turns; a frozen player's turn is skipped, so one team can get two turns in a row.

### Starting position

Each army sits centered on its own edge, with four empty squares at each end of its back line and pawn line, so the four 4×4 corners start empty.

| Seat | Back line | Pawns | Pawns move toward |
|---|---|---|---|
| South | e1 Rook, f1 Knight, g1 Bishop, **h1 Queen**, i1 King, j1 Bishop, k1 Knight, l1 Rook | e2 to l2 | North (rank 16) |
| North | e16 Rook, f16 Knight, g16 Bishop, **h16 Queen**, i16 King, j16 Bishop, k16 Knight, l16 Rook | e15 to l15 | South (rank 1) |
| West | a5 Rook, a6 Knight, a7 Bishop, **a8 Queen**, a9 King, a10 Bishop, a11 Knight, a12 Rook | b5 to b12 | East (file p) |
| East | p5 Rook, p6 Knight, p7 Bishop, **p8 Queen**, p9 King, p10 Bishop, p11 Knight, p12 Rook | o5 to o12 | West (file a) |

That is the standard army. England's Prime Ministers stand on its king, queen and knight squares instead (see [below](#civilization-abilities)).

As in normal chess, each queen starts on her own color, so opposite queens face each other. South and West are the "light" armies (queen on a light square); North and East are the "dark" armies.

**Room to develop:** no army starts in contact with another, so on the first move the only possible capture is a rook taking a neighbor's rook that has just moved into the shared corner. Knights can hop sideways into the empty margin (South: f1 to d2, k1 to m2) and rooks can slide straight into the empty corners (South: e1 to a1, l1 to p1), where a neighbor's rook can meet them.

---

## Moving

All pieces move exactly as in regular chess. "Forward" for a pawn means toward the far side of the board: up for South, down for North, right for West and left for East.

### Check never stops a move

- **You may leave your king under attack, or even move it into danger.** Nothing stops you, and the game never warns you before you move.
- There is no checkmate. You lose your king when someone actually **captures** it.

### Check indicators

The game tells you when **your own** king is under attack ("in check"), at two moments:

- **When your turn starts** with your king under attack (someone else put you in check), the turn banner turns bright orange-red and says **"Check! Your leader is under attack"**.
- **Right after your own move** leaves your king under attack (you put yourself in check), you see **"Your leader is in check"** next to the turn banner. It stays until your king is no longer attacked, and if your turn comes round with it still attacked, the turn banner says "Check!" as above.

While the indicator is on, your king's square has a pulsing orange-red ring with a light inner line (a steady one with reduced motion), in a colour no player's army uses, and a short alert sound plays when it appears.

- If an opponent attacks your king while it isn't your turn, you are **not** told until your turn starts (by then the danger may already be gone).
- The indicator is only ever for you: you never see it for other players' kings, and spectators see none.
- It is information only. It never stops a move, and only an **active** player's king can be in check (see Player status below).
- "Leader" is the piece your army can't afford to lose. For most armies that is the king. England has four leaders, its Prime Ministers: the indicator comes on when **any** of them is attacked, and only the attacked ones get the ring.

### Pawns

- A pawn moves one square forward, or **two squares** on its first move (from its starting line) if both squares are empty.
- It captures one square diagonally forward.
- **Promotion happens halfway:** when a pawn reaches the first line past the middle of the board, it **must** promote. That line is **rank 9 for South, rank 8 for North, file i for West and file h for East**, seven steps from where the pawn started. You choose a queen, rook, bishop or knight. You can never promote to a king (or, for England, to a Prime Minister). England's pawns may promote to a queen or knight even though England starts without them.

### No en passant

- A pawn that moves two squares can't be captured en passant. With four players the chance came round so rarely, and expired so confusingly, that it was dropped in rules version 3.

### Castling

- Castling works like regular chess, along your own back line: the king moves **two squares toward a rook**, and that rook jumps to the square the king crossed. Example for South: king i1 → k1 with rook l1 → j1, or king i1 → g1 with rook e1 → h1.
- You may castle only if the king and that rook have **never moved** and every square between them is **empty**.
- **No attack restrictions:** you may castle out of, through or into an attacked square.
- You can castle only while you are an **active** player (see below).
- Only an army with a single leader castles: **England never castles**.

---

## Civilization abilities

A civilization may have **abilities** that change how it plays; the rest play the standard army. In the game, the civilization list names each civilization's abilities, and its card (under the picker, and from any seat in the lobby or the game) explains them. A civilization's rules have a **version**. Most civilizations are at version 1 (the standard army). When a civilization gets new rules it gets a new version, and new games use the newest one; games already played keep the version they were played with, so your match history always replays exactly.

### England: Magna Carta (version 2)

England's ability is called **Magna Carta**. England has **no king, no queen and no knights**. Instead, **four Prime Ministers** start on the king's, the queen's and both knights' squares. South's England army is: e1 Rook, **f1 Prime Minister**, g1 Bishop, **h1 Prime Minister**, **i1 Prime Minister**, j1 Bishop, **k1 Prime Minister**, l1 Rook, pawns e2 to l2 (the other seats mirror this along their own back line).

- **Moves:** a Prime Minister moves like a knight **or** like a king: an L-shaped leap, or one step in any direction. It captures the same way. It never castles and never moves two squares.
- **Leaders:** all four are leaders. Capturing one is not a defeat; England is knocked out only when the **fourth** is captured (or, as for anyone, by stalemate, running out of time, leaving or resigning). You may leave a Prime Minister under attack, as with a king.
- **Check indicator:** shown when any Prime Minister is attacked; the ring marks only the attacked ones.
- **Castling:** England can't castle (it has more than one leader).
- **Promotion:** England's pawns promote to a queen, rook, bishop or knight, as everyone's do, never to a Prime Minister.
- **Once England is no longer active** (Teams: defeated or frozen), its remaining Prime Ministers are ordinary pieces, like a defeated player's king.
- In position strings and logs a Prime Minister is the letter **M**.

The Prime Minister looks like a knight wearing the king's crown.

---

## Player status

At every moment each player has exactly one status:

| Status | What it means |
|---|---|
| **Active** | Still in the game, with their king (England: at least one Prime Minister). |
| **Defeated** | Lost their king, or was stalemated. *In Teams only*, a defeated player keeps taking turns with their remaining pieces for as long as their partner is still active. |
| **Frozen** | *Teams only.* Ran out of time or left the game. The pieces stay on the board: they block squares and can be captured, but they never move again, and the player's turns are skipped. A defeated player who later runs out of time or leaves also becomes frozen. |
| **Removed** | *Free-for-All only.* The player's army has been taken off the board, and their turns are skipped. |

**(provisional)** Once a player is no longer active, a king (or any of England's Prime Ministers) they still have becomes an ordinary piece. Capturing it changes nothing, and it can't castle. In particular, a stalemated or timed-out Teams player's king does **not** keep their team alive.

---

## How you lose

You are knocked out when any one of these happens:

1. **Your king is captured.** Any opponent can do it on their own turn, and it takes effect immediately. England is knocked out only when its **last** Prime Minister is captured; losing one, two or three of them is just a loss of material.
2. **Stalemate is a loss, not a draw.** If you have **no legal move** at the start of your turn, you are defeated. In Teams this happens only once. After that, whenever a defeated player has no legal move on their turn, they **pass automatically**. A pass uses no clock time, earns no increment, and appears in the move log as `--`.
   - Your turn starts once the previous player has finished. If, while it is your turn, another player leaves the game and that takes away your last legal move (for example, your only move captured one of their pieces and, in Free-for-All, their army is taken off the board;), your turn is judged again: an active player is stalemated, and a defeated Teams player passes.
3. **Your clock runs out.**
4. **(provisional) You leave the game.** If you disconnect, your clock keeps running and the other players see a 60-second reconnect timer. If you don't come back in time, this counts exactly like running out of time.
5. **You resign** (see below).

What happens next depends on the mode:

| | Free-for-All | Teams |
|---|---|---|
| King captured or stalemated | **Removed**: your army leaves the board | **Defeated**: you keep playing your pieces while your partner is active |
| Out of time or left the game | **Removed** | **Frozen** |
| Resigned | **Removed** | Your **whole team** resigns, if your partner agrees (see below) |

### Resigning

- You can resign **at any time** while you are still taking turns, not only on your own turn. In Teams that includes a defeated player who is still playing their pieces.
- **Free-for-All:** resigning counts exactly like running out of time: your army is removed and you are out. If it was your turn, play passes to the next player.
- **Teams: resigning is a vote with your partner.** When you resign, your partner is asked whether to resign too:
  - **If your partner agrees, your team resigns:** you both lose, and the game ends at once with the other team winning (the winners place 1st, your team 2nd).
    Both of you are recorded as resigned, including a player who had lost their king but kept playing. A partner who was already frozen (and so could not vote) keeps the reason they were frozen for (time ran out, left the game).
  - **If your partner declines, nothing happens:** you both play on.
  - If your partner doesn't answer within one full round (every other player has had a turn and it is your turn again), or either of you stops taking turns, the request lapses and you both play on.
  - After a request is declined or lapses, you must make 2 more moves before you can ask again (a turn you pass because you have no legal move counts as one).
  - If your partner is already out of the game (frozen), there is nobody to ask: your team resigns at once.
  - A bot partner agrees only when your team is clearly behind (your team's material is at most 80% of the other team's); otherwise it declines.
- Leaving a Teams game (or disconnecting for longer than the reconnect grace) is not a resignation: only your own pieces freeze, and your partner plays on.

---

## How the game ends

- **Free-for-All:** the game ends when only **one active player** is left. That player wins.
- **Teams:** the game ends as soon as a team has **no active player**. That team's pieces are removed and the other team wins. For example, if your partner was stalemated or ran out of time and then your king is captured, your team is out.

### Playing against bots

- **Free-for-All against bots:** the game ends as soon as **you are out**: your king is captured, you are stalemated, you resign or you leave. The game isn't played out between the bots. The bots still in play share 1st place, and you keep the place you were knocked out in (for example 4th, or 2nd if two bots were already out).
- **Teams against bots** works like any Teams game: if you are defeated but your bot partner still has a king, your team plays on.

### The move limit

- The game counts every turn taken (automatic passes included) since the last **capture**, **pawn move** (promotions count) or **defeat of a player**.
- When that count reaches **25 × the number of players still taking turns**, the game ends. With four players that is 100 turns, or 25 full rounds. Removed and frozen players don't count.
- In Free-for-All the remaining active players tie for the best remaining place. In Teams the game is a draw.

### Draw by agreement

- Any player still taking turns can offer a draw. The game ends in a draw only if **every player still taking turns accepts**: active players and, in Teams, defeated players who are still playing their pieces. Removed and frozen players don't vote.
- The result is the same as at the move limit: in Free-for-All the remaining active players share the best remaining place and knocked-out players keep their places; in Teams everyone is 1st.
- Only one offer can be open at a time, and your own vote counts as accepted. The offer ends without a draw as soon as anyone declines, when a player is knocked out or frozen, or after one full round (everyone else has had a turn and it is your turn again; if your turn is skipped because you have no legal move, the skipped turn counts as your turn coming round).
- If your offer is declined or runs out, make two more moves before offering again (a turn you pass because you have no legal move counts as one).
- Bots accept only when they are clearly behind on material; otherwise they decline.
- The move limit, a draw by agreement and the early end of a Free-for-All game against bots (see above) are the only ways a game can end without a single winner.

### Placements

- **Free-for-All:** the winner is 1st. Everyone else is placed in reverse order of being knocked out, so the last player knocked out is 2nd. If the move limit or a draw by agreement ends the game, the remaining players share the best place (for example 1st, 1st, 3rd, 4th).
- **Teams:** both players of the winning team are 1st and both players of the losing team are 2nd. A draw puts everyone 1st.

---

## Clocks

- Time controls are **10+0** (10 minutes each) or **3+2** (3 minutes each, plus 2 seconds after every move).
- Only the clock of the player whose turn it is runs. Frozen and removed players' clocks stop.
- The game server keeps the official time.
