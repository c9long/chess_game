# Bot strength calibration

**Date:** 2026-10-15 (12×12); re-checked 2026-10-17 on the 16×16 board  
**Engine:** `crates/bot-engine`, level table in `crates/bot-engine/src/level.rs` (calibrated values below)  
**Tool:** `crates/bot-arena`

> **Caveat.** These ratings are on **our own ladder**. They are pairwise-placement
> Elo between our bots, anchored at `1500 = 1500`. They are not chess Elo and not
> yet comparable to human ratings. The labels will be **re-anchored with the hidden
> shadow ratings from real casual games** (PLAN §5/§6). FFA and Teams are separate
> ladders.

## England's Prime Ministers (civ version 2, 2026-10-17)

England's king, queen and knights are replaced by four Prime Ministers (knight + king moves,
all four leaders; see docs/RULES.md). The engine values a Prime Minister at **450** (mobility
2 per square, a mildly central piece-square table that keeps it near home), adds a
**150 leader reserve** per leader beyond the last, penalises a hanging non-last leader by 350
(`leader_spare_hanging`) instead of the full `leader_hanging`, and treats only the capture of
a seat's **last** leader as decisive. The leader-safety heuristics outside the evaluation (the
level filter that keeps weak bots from sampling a move that hangs the leader, the BRS fillers,
the static fallback and the null-move gate) follow the same rule: an attacked Prime Minister
counts as leader danger only when it is the seat's last one. Arena overrides: `w.m`, `w.mob.m`, `w.leader_reserve`,
`w.leader_spare_hanging`.

Method: four copies of one player, England fixed in South (start position with
`civ=england.2,…`), seats rotating so every player sits in England's seat equally often.
England's seat result is the civ's result. Shared machine (load ≈ 10 on 12 cores), untimed.

| Run | Games | England (South) 1st | England 4th | Other seats' 1st |
|---|---|---|---|---|
| Baseline, no England, `brs+:nodes=20000` | 96 | 26.9 ± 8.0% (South) | 30.2% | 18–28% |
| England, `brs+:nodes=20000`, PM 450 (default) | 96 | **60.9 ± 8.6%** | 3.1% | W 11.6, N 20.8, E 6.6% |
| Same, after the leader-heuristic fix | 96 | **59.9 ± 8.6%** | 3.1% | W 8.5, N 22.9, E 8.7% |
| England, PM 300 | 48 | 69.4 ± 10.8% | 0% | 9–12% |
| England, PM 650 | 48 | 55.9 ± 12.2% | 0% | 9–18% |
| Baseline, no England, level 1200 | 96 | 24.5 ± 8.6% (South) | 28.1% | 22–30% |
| England, level 1200 | 96 | 60.9 ± 9.1% | 1.0% | W 7.3, N 19.8, E 12.0% |
| Same, after the leader-heuristic fix | 96 | **44.6 ± 8.5%** | 2.1% | W 18.2, N 21.7, E 15.5% |
| Teams, England South (partner North standard), level 1500 | 48 | South+North score 0.542 ± 0.142 | | baseline 0.531 ± 0.141 |

**Reading it:** in FFA England wins 45–60% of games against a fair share of 25% and almost
never finishes last, at every strength tried. (Before the leader-heuristic fix the level filter
wrongly treated every attacked Prime Minister as a hanging leader, so a weak England bot's
deliberate mistakes could never leave a spare one en prise, a protection no other piece gets;
level 1200 dropped from 60.9% to 44.6% once fixed. The engine at a fixed node count, which has no level filter, barely moved.) The Prime Minister's value moves this only a
little (a lower value makes the bots trade them more freely, which helps England, not hurts):
the imbalance is in the rules (four leaders to hunt instead of one, and four short-range
attackers), not in how the bots value the piece, so the default stays at 450. In Teams the
effect is within the noise (a defeated seat keeps playing for its partner, so England's
resilience matters less). Bots never returned an illegal move with England in play
(`crates/bot-engine/tests/england_bot.rs`). A balance review with human games is on the
to-do list.

Commands (`$E` = the start position string with England in South; `T` = the same with
`teams`): `bot-arena play P P P P -g 96 -j 12 --seed 11 --start "$E"` with
`P=brs+:nodes=20000[:w.m=300|650]` (48 games for the overrides, `-j 7`) and `P=1200`
(`--seed 7`); Teams: `bot-arena play 1500 1500 1500 1500 -g 48 --mode teams --start "$T"`.

## Re-check on the 16×16 board (rules version 2, 2026-10-17)

The board grew from 12×12 to 16×16. The engine got 16×16 tables (piece-square tables generated
for the new board with the same value ranges, pawn advancement over 7 steps instead of 5, a
256-square history table and attack sets). **The level table is unchanged**: the move-time
targets stay as they were, and every node-bound level still finishes well inside its target
(a node is about 1.3–1.5× slower on the bigger board). Quick confirmation run on a shared
machine (load ≈ 10 on 12 cores), same method as below, new seeds:

**FFA ladder** (336 games, 48 per adjacent pair, untimed, seed 8101):

| Level | Rating | 95% interval | Gap (95%) | P(gap>0) | ms/move (target) | Nodes/move |
|---|---|---|---|---|---|---|
| 600 | 1054 | 925–1177 | | | 0.6 (30) | 144 |
| 900 | 1261 | 1153–1355 | +207 (+145, +284) | 100% | 1.2 (35) | 507 |
| 1200 | 1423 | 1351–1482 | +162 (+92, +230) | 100% | 8.2 (25) | 2.8k |
| 1500 | 1500 | anchor | +77 (+18, +149) | 100% | 27 (80) | 7.5k |
| 1800 | 1511 | 1464–1558 | +11 (−36, +58) | 64% | 57 (150) | 15k |
| 2100 | 1586 | 1511–1666 | +75 (+22, +136) | 99.8% | 137 (250) | 39k |
| 2400 | 1761 | 1672–1864 | +176 (+132, +228) | 100% | 331 (400) | 98k |
| Max | 1772 | 1665–1893 | +11 (−47, +84) | 62% | 418 (500) | 152k |

**Teams ladder** (168 games, 24 per adjacent pair, untimed, seed 8102): 600 −241, 900 284,
1200 586, 1500 1500 (anchor), 1800 1652, 2100 1984, 2400 2173, Max 2361. Every gap positive
with P = 100% (head-to-head 95.8%, 85.4%, 100%, 70.8%, 87.5%, 75.0%, 75.0% for the level
above).

**Reading it:** the ladder stays monotonic in both modes. The two marginal FFA steps are the
same as on the 12×12 board (1500→1800 and 2400→Max, "about equal in FFA"); at 48 games per
pair the intervals are wide, so a full 192-game run is still worth doing before the labels are
re-anchored. Max now searches about 150k nodes per move in FFA at its 500 ms target (240k on
12×12), so its edge over 2400 (98k) is thinner. Seat bias, FFA (336 games): first places S
22.8%, W 27.1%, N 23.2%, E 26.9% (±4.5%), no seat significantly off; Teams: South+North score
0.479 ± 0.076. With no pawn contact on move 1, the old "East's exposed corner pawns" question is
moot. Games are longer: about 380 plies after the opening in FFA ladder games.

Commands: as below, with `-g 48 -j 6 --seed 8101` (FFA) and `--mode teams -g 24 -j 6 --seed 8102`.

## Re-check after the review fixes (2026-10-15, later the same day)

The M6 review changed engine behaviour (see TODO.md "Review fixes (bots)"):
BRS/BRS+ default moves now save their own attacked leader and take the
root's leader; the depth-1 iteration is node-capped and, with exact root
scores, searched with a window of best − 1500 cp; a fail-soft bug in
quiescence delta pruning that stored too-low TT bounds is fixed; the FFA
move-limit tie is valued on the evaluation's scale; an interrupted
iteration only replaces the previous best with a move that beat the
initial aspiration window. The only level-table change is 1200's target
time (40 → 25 ms; it is node-bound in practice). So the ladder was played
again on an **idle machine** (load ≈ 11 on 12 cores from the arena itself),
same method, new seeds.

**FFA ladder** (1,008 games, 144 per adjacent pair, untimed, seed 7001):

| Level | Rating | 95% interval | Gap (95%) | P(gap>0) | Head-to-head vs level below | ms/move | Nodes/move |
|---|---|---|---|---|---|---|---|
| 600 | 1129 | 1067–1184 | | | | 0.4 | 98 |
| 900 | 1295 | 1245–1341 | +166 (+129, +204) | 100% | 72.3% | 0.6 | 292 |
| 1200 | 1439 | 1411–1470 | +144 (+113, +184) | 100% | 69.6% | 7.8 | 2.5k |
| 1500 | 1500 | anchor | +61 (+30, +89) | 100% | 58.7% | 20 | 7.1k |
| 1800 | 1525 | 1478–1569 | +25 (−22, +69) | 86.5% | 53.6% | 39 | 14k |
| 2100 | 1563 | 1511–1619 | +38 (+16, +63) | 100% | 55.5% | 86 | 37k |
| 2400 | 1613 | 1554–1676 | +50 (+16, +85) | 99.5% | 57.2% | 191 | 95k |
| Max | 1631 | 1561–1697 | +18 (−7, +46) | 92.8% | 52.6% | 401 | 240k |

**Teams ladder** (420 games, 60 per adjacent pair, untimed, seed 7002):

| Level | Rating | 95% interval | Gap (95%) | P(gap>0) | Head-to-head vs level below |
|---|---|---|---|---|---|
| 600 | 363 | −82–566 | | | |
| 900 | 840 | 547–1011 | +477 (+335, +792) | 100% | 94.2% |
| 1200 | 1189 | 1022–1295 | +349 (+222, +575) | 100% | 88.3% |
| 1500 | 1500 | anchor | +311 (+205, +478) | 100% | 85.8% |
| 1800 | 1722 | 1633–1849 | +222 (+133, +349) | 100% | 78.3% |
| 2100 | 1842 | 1725–2012 | +120 (+46, +222) | 99.5% | 66.7% |
| 2400 | 2081 | 1928–2293 | +239 (+133, +379) | 100% | 80.0% |
| Max | 2381 | 2205–2608 | +299 (+206, +414) | 100% | 85.0% |

**Algorithms** (96 FFA games each): BRS+ vs Paranoid at 20k nodes 67.7%
(**+128**, 95% +88 to +174); at 40 ms each 64.8% (**+106**, +49 to +157);
BRS+ vs plain BRS at 40 ms 54.0% (+28, −4 to +66). BRS+ stays the default.

**Top of the ladder after the last fix** (the interrupted-iteration rule,
which affects 2400's node-capped and Max's timed searches; seeds 7101/7102):

| Mode | 1800→2100 | 2100→2400 | 2400→Max |
|---|---|---|---|
| FFA (96 games per pair) | +70 (+30, +116), 60.0% | +47 (+11, +75), 56.8% | +17 (−28, +67), 52.5% |
| Teams (60 games per pair) | +198 (+113, +299), 75.8% | +222 (+133, +323), 78.3% | +239 (+160, +349), 80.0% |

Same picture: all steps positive, 2400→Max marginal in FFA (Max searched
162k nodes/move against 2400's 96k here).

**Reading it:**
- Every adjacent level still wins its head-to-head in both modes, and the
  Teams ladder is wide and clean.
- **Marginal FFA steps: 1500→1800 (+25, P = 86.5%) and 2400→Max (+18,
  P = 92.8%).** They are not resolved at 144 games per pair; treat them as
  "about equal in FFA". (The earlier review's confirmation run also saw
  1200 ≈ 1500 and Max ≈ 2400 at 48 games per pair, and larger reruns put
  them back in order.) Teams 1800→2100 is the narrowest Teams step.
- For future FFA calibration use at least 192 games (32 opening groups) per
  adjacent pair. If a visible FFA difference is wanted, widen the spacing
  (for example a lower node budget for 1500, or a node floor for Max well
  above 2400's), and re-check with `bot-arena sprt`.
- FFA ratings are compressed (600 to Max spans about 500 points): a
  4-player game is noisy and one player's mistake often decides who *else*
  wins.
- Seat bias in this run: FFA first places S 24.8%, W 23.8%, N 24.9%, E 26.5%
  (±2.6%); East is not the weak seat here, as in the review's 936-game
  confirmation set. The pooled table further down is from the first run.

## Results in short (first calibration run)

- **Ladder:** with the calibrated table, every level beats the one below it in
  **both** FFA and Teams. All 14 adjacent gaps are positive, 12 of them with
  ≥ 99.7% bootstrap confidence and the other two with 97%.
- **FFA algorithm:** **BRS+ is clearly stronger than Paranoid**: +153 Elo at
  equal nodes and +135 Elo at equal time. BRS+ is also stronger than plain BRS
  (+54 Elo at equal time). It stays the default.
- **Seat bias:** small.
  - FFA: East wins slightly less often: 23.0 ± 1.8% of first places against a
    fair 25%, the only seat below fair at about 2σ. But East is *not* knocked
    out first more often (24.0%), and its average points are within noise of
    fair. West is knocked out first most often (27.8%), North least (21.8%).
  - Teams: no significant bias. South+North score 0.486 ± 0.030 (fair 0.5).

## Method

### Games
- **Two-player matches.** Two configurations share the four seats, two seats
  each.
  - FFA: every match uses all six two-seat patterns (opposite and adjacent,
    both ways round), so each player sits in every seat equally often.
  - Teams: each player plays both as South+North and as West+East.
- **Opening groups.** All games in one seat-rotation group start from the same
  random opening. The opening is 1–2 whole rounds, one move per seat. Each
  opening move is drawn uniformly from the moves within 60 cp of the best in a
  1-ply search. Using whole rounds means no seat gets more random moves than
  another.
- **Untimed, node-bound.** Levels use their node budgets, so these games are
  fully reproducible from the seed. **Max** is the exception: it is bound by
  its 500 ms time target, so its results depend on CPU load. The machine was
  shared with other jobs (load average 25–40 on 12 cores) during this run.
- **Parallel.** 6 worker threads per run, with two to three runs at a time.

### Ratings
- **Comparisons.** Each game is split into pairwise placement comparisons
  between seats held by different players: 1 for the better placement, ½ each
  for a tie. In Teams, only seats on opposite teams are compared.
- **Fit.** A **Bradley–Terry** maximum-likelihood fit (MM algorithm) on the
  Elo scale, with one virtual draw per pair as a prior.
- **Intervals.** 95% intervals come from a **cluster bootstrap**: whole opening
  groups are resampled, stratified by pairing.
- **"P(gap>0)".** The share of bootstrap resamples in which a level rated above
  the level below it.

### Iterations
The `bot-engine` table was first guesses (v2). It was changed only in the
level-parameter definitions.

| Round | Change | FFA finding |
|---|---|---|
| Pilot (v2/v3) | 2400 cut from 150k to 80k nodes | 2100 ≈ 2400 ≈ Max (gaps −5 and +10) |
| v4 | 1500 8k, 1800 16k, 2100 40k with no noise or blunders, 2400 100k | 1800→2100 +69, but 2100→2400 only +10, not significant |
| **v5 (final)** | 2100 gets noise 6 and blunder rate 0.03 | Every gap positive (tables below) |

**Lesson for tuning:**
- In FFA, extra search depth beyond about 3 BRS layers buys little Elo per
  node.
- The blunder and noise settings cost much more than they seem to. Any level
  with `blunder_rate > 0` searches with exact root scores, which in BRS cuts
  depth by roughly one layer at the same node budget.

### Compute
- The calibration itself was about 3,000 games, roughly 80 minutes of wall
  time:
  - 708 FFA and 420 Teams ladder games;
  - 336 games of earlier v4 pairings that the final 2100 change replaced;
  - 288 algorithm-comparison games;
  - 720 FFA and 520 Teams seat-bias games.
- The pilot added about 240 more games.
- Other teams' jobs were running at the same time, which made it about 3× slower
  than an idle machine.

## Calibrated level table (v5)

| Level | Depth cap (plies) | Nodes | Target ms | Noise (cp) | Blunder rate | Top-N | Temp | Hang allow | TT MB | Max qdepth |
|---|---|---|---|---|---|---|---|---|---|---|
| 600 | 1 | 300 | 30 | 200 | 0.60 | 10 | 300 | 0.25 | 1 | 1 |
| 900 | 2 | 1,000 | 35 | 120 | 0.40 | 6 | 160 | 0.10 | 1 | 2 |
| 1200 | 3 | 3,000 | 25\* | 70 | 0.25 | 4 | 90 | 0.03 | 2 | 4 |
| 1500 | 4 | 8,000 | 80 | 40 | 0.12 | 3 | 50 | 0 | 4 | 6 |
| 1800 | 6 | 16,000 | 150 | 20 | 0.06 | 2 | 30 | 0 | 8 | 8 |
| 2100 | 8 | 40,000 | 250 | 6 | 0.03 | 2 | 15 | 0 | 8 | 10 |
| 2400 | 12 | 100,000 | 400 | 0 | 0 | 1 | – | 0 | 16 | 10 |
| Max | 64 | ∞ | 500 | 0 | 0 | 1 | – | 0 | 16 | 10 |

\* 40 ms during the first run; lowered to 25 ms by the review fixes (PLAN §6:
weak levels answer in under 50 ms).

`hang_allow` is the probability that the leader-safety filter is skipped
when a weak level samples a non-best move. Since the search scores
leader-losing moves near −WIN, their softmax weight is negligible anyway, so
no level hangs its leader on purpose (the review measured 0 avoidable
hangs in ~60k FFA moves at 600–1200). Weak levels are weak through noise,
shallow search and short quiescence.

The previous first guesses were 1500 at 10k nodes, 1800 at 25k, 2100 at 60k
with noise 8 and blunder rate 0.02, and 2400 at 150k.

Max is the only time-bound level. On an idle machine it searches about 2.5× as
many nodes as 2400 (Teams: 252k against 95k per move). Under load it falls to
about 2400's node count, which is why its FFA margin below is small.

## FFA ladder (708 games, untimed)

Adjacent matches. Each pair played 96 games (384 comparisons) or 120 games
(480 comparisons); 2400 vs Max played 60 games (240 comparisons).

| Level | Rating | 95% interval | Gap to level below (95%) | P(gap>0) | Head-to-head vs level below | ms/move\* | Nodes/move |
|---|---|---|---|---|---|---|---|
| 600 | 1145 | 1078–1207 | | | | 0.5 | 92 |
| 900 | 1290 | 1234–1338 | +145 (+106, +190) | 100% | 69.8% | 1.0 | 282 |
| 1200 | 1417 | 1388–1443 | +127 (+88, +173) | 100% | 67.6% | 12 | 2.6k |
| 1500 | 1500 | anchor | +83 (+57, +112) | 100% | 61.8% | 31 | 7.1k |
| 1800 | 1561 | 1520–1600 | +61 (+20, +100) | 99.7% | 58.6% | 54 | 14k |
| 2100 | 1614 | 1562–1664 | +54 (+18, +86) | 99.7% | 57.7% | 150 | 37k |
| 2400 | 1731 | 1667–1798 | +117 (+77, +164) | 100% | 66.3% | 450 | 94k |
| Max | 1768 | 1690–1848 | +36 (−0, +70) | 97.1% | 55.2% | 410 | 103k\*\* |

\* Wall time on the overloaded machine, about 3× slower than idle. On an idle
machine, from the bot-engine benchmarks: 2100 is about 50 ms, 2400 about
120–150 ms, and Max uses 250–500 ms.

\*\* Max was starved by the load. It reached only about 2400's node count, so
its margin over 2400 here is a lower bound.

FFA compresses ratings, because a 4-player game is noisy and one player's
blunder often decides who *else* wins. 600 to Max spans about 620 points.

## Teams ladder (420 games, untimed)

Adjacent matches, 60 games (240 comparisons) per pair.

| Level | Rating | 95% interval | Gap to level below (95%) | P(gap>0) | Head-to-head vs level below |
|---|---|---|---|---|---|
| 600 | 624 | 349–815 | | | |
| 900 | 924 | 672–1070 | +299 (+198, +453) | 100% | 85.0% |
| 1200 | 1302 | 1177–1399 | +379 (+258, +575) | 100% | 90.0% |
| 1500 | 1500 | anchor | +198 (+101, +323) | 100% | 75.8% |
| 1800 | 1675 | 1582–1778 | +175 (+82, +278) | 99.9% | 73.3% |
| 2100 | 1763 | 1636–1900 | +88 (−0, +182) | 97.1% | 62.5% |
| 2400 | 2031 | 1870–2227 | +268 (+168, +413) | 100% | 82.5% |
| Max | 2191 | 2009–2415 | +160 (+76, +258) | 100% | 71.7% |

In Teams the ladder is wide, and it lands close to the labels when anchored at
1500. The weakest gap is 1800→2100 (97%). If a future change narrows it, first
lower 1800's node budget or raise 2100's.

## FFA algorithm: BRS+ vs Paranoid (vs BRS)

Each comparison is 96 FFA games (384 comparisons) with seat rotation. These are
raw engine configs, with no level noise.

| Match | Score | Elo | Avg points (0–3) per game | First places |
|---|---|---|---|---|
| BRS+ vs Paranoid, 20k nodes/move each | 70.7% | **+153** (95%: +118 to +190) | 1.91 vs 1.09 | 41.5% vs 8.5% |
| BRS+ vs Paranoid, 40 ms/move each | 68.5% | **+135** (+94 to +186) | 1.87 vs 1.13 | 39.6% vs 10.4% |
| BRS+ vs BRS, 40 ms/move each | 57.7% | **+54** (+21 to +82) | 1.65 vs 1.35 | 35.5% vs 14.5% |

At equal time Paranoid searches more nodes (18.8k vs 13.9k) and goes deeper
(4.8 vs 4.0), and it still loses clearly. **BRS+ stays the FFA default.**

## Seat bias (corner-pawn asymmetry; TODO balance item)

Seat rotation means every configuration sits in every seat equally often, so the
per-seat results below measure the seat itself. The pooled set is 1,932 FFA
games and 1,060 Teams games: every ladder, algorithm and seat-bias run. The
mirror runs have four copies of one level, 1200 or 1800.

### FFA
"Points" scores 3, 2, 1 and 0 for 1st to 4th; fair is 1.5 points and 25%
first places.

| Seat | First places (pooled) | Points | Knocked out first (4th) | Outright wins | Mirror: first places (720 games) |
|---|---|---|---|---|---|
| South | 26.6 ± 1.9% | 1.514 ± 0.050 | 25.9 ± 2.0% | 24.3 ± 1.9% | 27.7 ± 3.2% |
| West | 24.8 ± 1.9% | 1.458 ± 0.050 | 27.8 ± 2.0% | 23.1 ± 1.9% | 26.0 ± 3.2% |
| North | 25.6 ± 1.9% | 1.547 ± 0.048 | 21.8 ± 1.8% | 23.4 ± 1.9% | 25.2 ± 3.1% |
| East | **23.0 ± 1.8%** | 1.480 ± 0.048 | 24.0 ± 1.9% | **21.0 ± 1.8%** | **21.1 ± 2.9%** |

How to read it:
- East converts to a win least often, in the pooled data and in the mirror runs
  alike (21% against a fair 25%).
- East is not eliminated early, though.
- The bias is small, about 2–4 points of win share, and it is close to the
  noise level per run. It is consistent across runs.
- North is the most comfortable seat: it is knocked out first least often and
  has the best points.

### Teams
| Set | South+North wins | West+East wins | Draws | South+North score (fair 0.5) |
|---|---|---|---|---|
| Pooled (1,060 games) | 47.8% | 50.7% | 1.5% | 0.486 ± 0.030 |
| Mirror, 1200 and 1800 (520 games) | 48.1% | 50.8% | 1.2% | 0.487 ± 0.043 |

There is no significant team bias. If anything, West+East is very slightly
ahead, so the corner-pawn exposure does not hurt East's team.

**Caveats:**
- These are bot games. Humans may exploit the exposed corners differently.
- The random 1–2-round openings already include some early corner-pawn trades,
  such as `c2b3 a3b3`.
- The data is for the TODO balance question; no rule change is implied.

## Reproducing

```sh
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --release -p bot-arena
A=target/release/bot-arena

# Re-check after the review fixes (idle machine, 11 threads):
$A ladder 600 900 1200 1500 1800 2100 2400 max --pairs adjacent --mode ffa -g 144 -j 11 --seed 7001 --out ffa.jsonl
$A ladder 600 900 1200 1500 1800 2100 2400 max --pairs adjacent --mode teams -g 60 -j 11 --seed 7002 --out teams.jsonl
$A match brs+:nodes=20000 paranoid:nodes=20000 -g 96 -j 11 --seed 7003
$A match brs+:ms=40 paranoid:ms=40 -g 96 -j 11 --seed 7004
$A match brs+:ms=40 brs:ms=40 -g 96 -j 11 --seed 7005

# First run. FFA ladder: adjacent pairs; more games where gaps are small
$A match 1800 2100 --mode ffa -g 120 -j 6 --seed 502 --out ffa.jsonl
$A match 2100 2400 --mode ffa -g 96  -j 6 --seed 501 --out ffa.jsonl
# ... (600/900 s107, 900/1200 s106, 1200/1500 s105, 1500/1800 s104, 2400/max s102)
# Teams ladder in one go (the reported Teams data replaced this run's 2100
# pairs with a re-run after the final 2100 change, seed 503)
$A ladder 600 900 1200 1500 1800 2100 2400 max --pairs adjacent --mode teams -g 60 --out teams.jsonl
# Combined ratings and seat bias
$A rate ffa.jsonl teams.jsonl --bootstrap 1000
# Seat bias (mirror)
$A play 1200 1200 1200 1200 --mode ffa -g 600 --out seat.jsonl
# Algorithms
$A match brs+:nodes=20000 paranoid:nodes=20000 -g 96
$A match brs+:ms=40 paranoid:ms=40 -g 96
# Future tuning: SPRT, H0 diff <= 0 vs H1 diff >= 10 Elo
$A sprt brs+:nodes=30000:w.leader_hanging=-3000 brs+:nodes=30000 --max-games 20000
```

Games of the node-bound levels are bit-for-bit reproducible from `--seed`,
whatever the thread count. Max and `ms=` players are not.
