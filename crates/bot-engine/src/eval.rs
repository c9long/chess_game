//! Handcrafted evaluation.
//!
//! Every seat gets a *seat term* (material, piece-square tables, pawn
//! advancement, mobility, leader safety); the terms are then combined per
//! mode:
//!
//! * **Teams:** sum of the team's seat terms minus the other team's, plus a
//!   bonus per ACTIVE seat (a team with one leader left loses when it falls).
//! * **FFA** (from one seat's view): own term minus the *mean* term of the
//!   opponents still in the game, plus a bonus per opponent already removed
//!   (placement improves whenever someone else is knocked out). Being removed
//!   yourself is a terminal loss handled by the search.
//!
//! Piece-square tables are defined once from South's point of view and
//! rotated for each seat (they are left-right symmetric, so rotation and
//! reflection agree). All weights live in [`EvalWeights`] so they can be
//! tuned.
//!
//! **Leader safety** matters far more than in chess: self-check is legal, so a
//! leader attacked by an opponent that moves *before* its owner's next turn is
//! very likely lost. That case gets a large penalty
//! ([`EvalWeights::leader_hanging`]).

use rules_core::{GameMode, GameState, KindSet, PieceKind, Seat, SeatStatus};

use crate::geom::{Bits, DIR_DELTA, NSQ, T};

/// Tunable evaluation weights (centipawns).
#[derive(Clone, Debug, PartialEq)]
pub struct EvalWeights {
    /// Material by kind index (P, N, B, R, Q, K). The king value applies only
    /// when it is an ordinary piece (its seat is no longer ACTIVE).
    pub piece_value: [i32; PieceKind::COUNT],
    /// Piece-square tables by kind index, from South's view, indexed by square
    /// index (`file + 12 * rank`).
    pub pst: [[i16; NSQ]; PieceKind::COUNT],
    /// Pawn bonus by progress (0 = back line, 1 = start line, 5 = one step
    /// before the promotion line).
    pub pawn_advance: [i32; 6],
    /// Mobility bonus per reachable square, by kind index.
    pub mobility: [i32; PieceKind::COUNT],
    /// Penalty when a seat's leader is attacked by an opponent that moves
    /// before the seat's next turn (the leader is "hanging").
    pub leader_hanging: i32,
    /// Penalty when the seat to move has its leader attacked (it must spend
    /// its turn on defence).
    pub leader_attacked_to_move: i32,
    /// Penalty per square next to the leader attacked by an opponent (counted
    /// once per attacking seat).
    pub leader_zone_attack: i32,
    /// Penalty per empty square on the eight lines from the leader (capped by
    /// `leader_open_cap`).
    pub leader_open_line: i32,
    /// Cap on the number of open-line squares counted.
    pub leader_open_cap: i32,
    /// Bonus per own or friendly piece next to the leader.
    pub leader_shield: i32,
    /// Material of FROZEN seats counts this percentage (they never move).
    pub frozen_material_pct: i32,
    /// FFA: bonus per opponent already removed.
    pub ffa_opponent_out: i32,
    /// FFA: value of a move-limit tie the root survives, by number of
    /// survivors (index 2..=4; 0 and 1 unused), *on top of* the
    /// `ffa_opponent_out` bonus for each removed opponent (the same baseline
    /// the static evaluation uses), so a tie is compared with play-on scores
    /// on one scale.
    pub ffa_tie_value: [i32; 5],
    /// Teams: bonus per ACTIVE seat (difference between the teams).
    pub teams_active_seat: i32,
    /// Bonus for being on move.
    pub tempo: i32,
}

/// Default piece-square tables from South's view.
#[allow(clippy::needless_range_loop)]
fn default_pst() -> [[i16; NSQ]; PieceKind::COUNT] {
    let mut pst = [[0i16; NSQ]; PieceKind::COUNT];
    for sq in 0..NSQ {
        let f = (sq % 12) as i32;
        let r = (sq / 12) as i32;
        // Centrality 0 (corner) ..= 20 (centre), symmetric in both axes.
        let cf = (2 * f - 11).abs();
        let cr = (2 * r - 11).abs();
        let central = 22 - cf - cr;
        // Distance from the central files only (0..=5).
        let file_c = (11 - cf) / 2;
        // Pawn: prefer central files (advancement is a separate term).
        pst[PieceKind::Pawn.index()][sq] = (file_c * 3) as i16;
        pst[PieceKind::Knight.index()][sq] = (central * 3 - 30) as i16;
        pst[PieceKind::Bishop.index()][sq] = (central * 3 / 2 - 10) as i16;
        pst[PieceKind::Rook.index()][sq] = (file_c * 2 + if r == 1 { -5 } else { 0 }) as i16;
        pst[PieceKind::Queen.index()][sq] = (central - 10) as i16;
        // King: stay home, away from the open middle of a four-army board.
        let king = match r {
            0 => 10,
            1 => 0,
            _ => -15 * r,
        } - if cf <= 3 { 5 } else { 0 };
        pst[PieceKind::King.index()][sq] = king as i16;
    }
    pst
}

impl Default for EvalWeights {
    fn default() -> Self {
        EvalWeights {
            piece_value: [100, 300, 350, 500, 1000, 300],
            pst: default_pst(),
            pawn_advance: [0, 0, 8, 20, 40, 75],
            mobility: [0, 4, 4, 3, 2, 0],
            leader_hanging: 2500,
            leader_attacked_to_move: 60,
            leader_zone_attack: 12,
            leader_open_line: 3,
            leader_open_cap: 24,
            leader_shield: 8,
            frozen_material_pct: 25,
            ffa_opponent_out: 1200,
            ffa_tie_value: [0, 0, 600, 300, 0],
            teams_active_seat: 3000,
            tempo: 15,
        }
    }
}

/// Rotates a square into South's frame for `seat`: returns the square index
/// whose South-view table entry applies.
pub(crate) const fn south_frame(seat: Seat, sq: usize) -> usize {
    let f = sq % 12;
    let r = sq / 12;
    let (sf, sr) = match seat {
        Seat::South => (f, r),
        Seat::North => (11 - f, 11 - r),
        Seat::West => (11 - r, f),
        Seat::East => (r, 11 - f),
    };
    sr * 12 + sf
}

/// Evaluation with precomputed rotated tables.
#[derive(Clone, Debug)]
pub struct Evaluator {
    w: EvalWeights,
    /// Material + rotated PST (+ pawn advancement) per seat, kind, square.
    table: Box<[[[i32; NSQ]; PieceKind::COUNT]; 4]>,
    /// Rotated PST only (used for ACTIVE leaders, which have no material).
    pst_only: Box<[[[i32; NSQ]; PieceKind::COUNT]; 4]>,
}

/// Per-seat analysis of a position.
pub(crate) struct Analysis {
    pub terms: [i32; 4],
}

impl Evaluator {
    /// Builds an evaluator from weights.
    pub fn new(w: EvalWeights) -> Evaluator {
        let mut table = Box::new([[[0i32; NSQ]; PieceKind::COUNT]; 4]);
        let mut pst_only = Box::new([[[0i32; NSQ]; PieceKind::COUNT]; 4]);
        for seat in Seat::ALL {
            for kind in PieceKind::ALL {
                for sq in 0..NSQ {
                    let s = south_frame(seat, sq);
                    let p = i32::from(w.pst[kind.index()][s]);
                    let mut v = w.piece_value[kind.index()] + p;
                    if kind == PieceKind::Pawn {
                        let prog = s / 12;
                        v += w.pawn_advance.get(prog).copied().unwrap_or(0);
                    }
                    table[seat.index()][kind.index()][sq] = v;
                    pst_only[seat.index()][kind.index()][sq] = p;
                }
            }
        }
        Evaluator { w, table, pst_only }
    }

    /// The weights.
    pub fn weights(&self) -> &EvalWeights {
        &self.w
    }

    /// Material + PST value of `kind` for `seat` on `sq` (move ordering).
    #[inline]
    pub(crate) fn piece_square(&self, seat: Seat, kind: PieceKind, sq: usize) -> i32 {
        self.table[seat.index()][kind.index()][sq]
    }

    /// Material value of a kind.
    #[inline]
    pub(crate) fn value(&self, kind: PieceKind) -> i32 {
        self.w.piece_value[kind.index()]
    }

    /// Computes every seat's term.
    pub(crate) fn analyse(&self, st: &GameState) -> Analysis {
        let board = st.board();
        let statuses = st.statuses();
        let mode = st.mode();
        let mut terms = [0i32; 4];
        let mut attacks = [Bits::EMPTY; 4];
        let mut leader_sq = [usize::MAX; 4];
        let mut mob = [0i32; 4];
        let mut leaders = [KindSet::EMPTY; 4];
        // friendly[a][b]: a's pieces block b and b may not capture them.
        let mut friendly = [[false; 4]; 4];
        for a in Seat::ALL {
            leaders[a.index()] = st.roster(a).leaders();
            for b in Seat::ALL {
                friendly[a.index()][b.index()] = match mode {
                    GameMode::Ffa => a == b,
                    GameMode::Teams => a.team() == b.team(),
                };
            }
        }
        let w = &self.w;
        let mobw = w.mobility;

        for (i, cell) in board.iter().enumerate() {
            let Some(p) = *cell else { continue };
            let s = p.owner.index();
            let k = p.kind.index();
            match statuses[s] {
                SeatStatus::Frozen => {
                    terms[s] += w.piece_value[k] * w.frozen_material_pct / 100;
                    continue;
                }
                SeatStatus::Removed => continue,
                _ => {}
            }
            if statuses[s] == SeatStatus::Active && leaders[s].contains(p.kind) {
                leader_sq[s] = i;
                terms[s] += self.pst_only[s][k][i];
            } else {
                terms[s] += self.table[s][k][i];
            }
            let fr = &friendly[s];
            let can_land = |t: usize| match board[t] {
                None => true,
                Some(q) => !fr[q.owner.index()],
            };
            match p.kind {
                PieceKind::Pawn => {
                    let (fx, fy) = p.owner.forward();
                    let f = (i % 12) as i32;
                    let r = (i / 12) as i32;
                    let diag: [(i32, i32); 2] = if fx == 0 {
                        [(-1, i32::from(fy)), (1, i32::from(fy))]
                    } else {
                        [(i32::from(fx), -1), (i32::from(fx), 1)]
                    };
                    for (dx, dy) in diag {
                        let (tf, tr) = (f + dx, r + dy);
                        if (0..12).contains(&tf) && (0..12).contains(&tr) {
                            attacks[s].set((tr * 12 + tf) as usize);
                        }
                    }
                }
                PieceKind::Knight => {
                    let n = T.knight_n[i] as usize;
                    for &t in &T.knight[i][..n] {
                        let t = t as usize;
                        attacks[s].set(t);
                        if can_land(t) {
                            mob[s] += mobw[k];
                        }
                    }
                }
                PieceKind::King => {
                    let n = T.king_n[i] as usize;
                    for &t in &T.king[i][..n] {
                        attacks[s].set(t as usize);
                    }
                }
                PieceKind::Bishop | PieceKind::Rook | PieceKind::Queen => {
                    let dirs: &[usize] = match p.kind {
                        PieceKind::Bishop => &[4, 5, 6, 7],
                        PieceKind::Rook => &[0, 1, 2, 3],
                        _ => &[0, 1, 2, 3, 4, 5, 6, 7],
                    };
                    for &d in dirs {
                        let len = T.ray_len[i][d] as isize;
                        let delta = DIR_DELTA[d];
                        let mut t = i as isize;
                        for _ in 0..len {
                            t += delta;
                            let tu = t as usize;
                            attacks[s].set(tu);
                            match board[tu] {
                                None => mob[s] += mobw[k],
                                Some(q) => {
                                    if !fr[q.owner.index()] {
                                        mob[s] += mobw[k];
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Turn order from the seat to move.
        let to_move = st.seat_to_move();
        let mut order = [to_move; 4];
        for j in 1..4 {
            order[j] = order[j - 1].next();
        }

        for x in Seat::ALL {
            let xi = x.index();
            terms[xi] += mob[xi];
            let l = leader_sq[xi];
            if l == usize::MAX {
                continue;
            }
            let mut safety = 0;
            let mut attacked = false;
            let mut hanging = false;
            let mut zone_hits = 0u32;
            let zone = &T.zone[l];
            for (j, y) in order.iter().enumerate() {
                let yi = y.index();
                if friendly[xi][yi] || !statuses[yi].takes_turns() {
                    continue;
                }
                zone_hits += attacks[yi].and_count(zone);
                if attacks[yi].get(l) {
                    attacked = true;
                    // `y` moves before `x` iff it comes earlier in the order.
                    let x_pos = order.iter().position(|&s| s == x).unwrap_or(0);
                    if j < x_pos {
                        hanging = true;
                    }
                }
            }
            if hanging {
                safety -= w.leader_hanging;
            } else if attacked && x == to_move {
                safety -= w.leader_attacked_to_move;
            }
            safety -= w.leader_zone_attack * zone_hits as i32;
            // Open lines and shield.
            let mut open = 0i32;
            for (d, &delta) in DIR_DELTA.iter().enumerate() {
                let len = T.ray_len[l][d] as isize;
                let mut t = l as isize;
                for _ in 0..len {
                    t += delta;
                    if board[t as usize].is_some() {
                        break;
                    }
                    open += 1;
                }
            }
            safety -= w.leader_open_line * open.min(w.leader_open_cap);
            let n = T.king_n[l] as usize;
            let shield = T.king[l][..n]
                .iter()
                .filter(|&&t| matches!(board[t as usize], Some(q) if friendly[xi][q.owner.index()]))
                .count() as i32;
            safety += w.leader_shield * shield;
            terms[xi] += safety;
        }
        Analysis { terms }
    }

    /// Teams: score for `team_index` (0 = South+North, 1 = West+East).
    pub(crate) fn combine_teams(&self, st: &GameState, a: &Analysis, team_index: usize) -> i32 {
        let mut score = 0;
        let mut active = [0i32; 2];
        for seat in Seat::ALL {
            let t = seat.team().index();
            let v = a.terms[seat.index()];
            if t == team_index {
                score += v;
            } else {
                score -= v;
            }
            if st.status(seat) == SeatStatus::Active {
                active[t] += 1;
            }
        }
        score += self.w.teams_active_seat * (active[team_index] - active[1 - team_index]);
        if st.seat_to_move().team().index() == team_index {
            score += self.w.tempo;
        } else {
            score -= self.w.tempo;
        }
        score
    }

    /// FFA: score from `root`'s view (root assumed ACTIVE).
    pub(crate) fn combine_ffa(&self, st: &GameState, a: &Analysis, root: Seat) -> i32 {
        let mut opp_sum = 0;
        let mut opp_n = 0;
        let mut removed = 0;
        for seat in Seat::ALL {
            if seat == root {
                continue;
            }
            if st.status(seat) == SeatStatus::Active {
                opp_sum += a.terms[seat.index()];
                opp_n += 1;
            } else {
                removed += 1;
            }
        }
        let mut score = a.terms[root.index()];
        if opp_n > 0 {
            score -= opp_sum / opp_n;
        }
        score += self.w.ffa_opponent_out * removed;
        if st.seat_to_move() == root {
            score += self.w.tempo;
        }
        score
    }

    /// Static evaluation from `perspective`'s view: FFA from that seat, Teams
    /// from that seat's team. Positive is good for `perspective`.
    pub fn evaluate(&self, st: &GameState, perspective: Seat) -> i32 {
        let a = self.analyse(st);
        match st.mode() {
            GameMode::Teams => self.combine_teams(st, &a, perspective.team().index()),
            GameMode::Ffa => self.combine_ffa(st, &a, perspective),
        }
    }
}

/// Static evaluation of `state` from `perspective`'s view (FFA: that seat;
/// Teams: that seat's team) with the given weights. Ignores whether the game
/// is over. Convenience wrapper; search code reuses an [`Evaluator`].
pub fn evaluate(state: &GameState, perspective: Seat, weights: &EvalWeights) -> i32 {
    Evaluator::new(weights.clone()).evaluate(state, perspective)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rules_core::GameConfig;

    #[test]
    fn rotation_maps_home_lines() {
        // Each seat's back line maps to South's rank 1 and its pawn line to rank 2.
        for seat in Seat::ALL {
            for sq in rules_core::setup::back_line(seat) {
                assert_eq!(south_frame(seat, sq.index()) / 12, 0, "{seat} {sq}");
            }
            for sq in rules_core::setup::pawn_line(seat) {
                assert_eq!(south_frame(seat, sq.index()) / 12, 1, "{seat} {sq}");
            }
        }
        // It is a bijection for every seat.
        for seat in Seat::ALL {
            let mut seen = [false; NSQ];
            for sq in 0..NSQ {
                seen[south_frame(seat, sq)] = true;
            }
            assert!(seen.iter().all(|&b| b));
        }
    }

    #[test]
    fn start_position_is_symmetric() {
        let ev = Evaluator::new(EvalWeights::default());
        let s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
        let a = ev.analyse(&s);
        assert!(a.terms.iter().all(|&t| t == a.terms[0]), "{:?}", a.terms);
        let t = GameState::new(GameConfig::new(GameMode::Teams)).unwrap();
        // Only tempo separates the teams at the start.
        assert_eq!(ev.evaluate(&t, Seat::South), EvalWeights::default().tempo);
        assert_eq!(ev.evaluate(&t, Seat::West), -EvalWeights::default().tempo);
    }

    #[test]
    fn hanging_leader_is_penalised() {
        // South king g1 attacked by West's rook on c1. With South to move it
        // can escape; with West to move the leader is hanging.
        let base = "ffa 12/12/12/12/12/12/12/12/12/wK11/12/nK1wR3sK4eK";
        let s_to_move: GameState = format!("{base} S AAAA - - 0 0")
            .parse()
            .unwrap_or_else(|e| {
                panic!("{e}");
            });
        let w_to_move: GameState = format!("{base} W AAAA - - 0 0").parse().unwrap();
        let ev = Evaluator::new(EvalWeights::default());
        let a = ev.analyse(&s_to_move);
        let b = ev.analyse(&w_to_move);
        let south = Seat::South.index();
        assert!(a.terms[south] - b.terms[south] >= EvalWeights::default().leader_hanging / 2);
    }
}
