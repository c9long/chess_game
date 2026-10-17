//! Strength levels (PLAN §6): 600, 900, 1200, 1500, 1800, 2100, 2400, Max.
//!
//! Each level maps to a node budget, a depth cap, deterministic evaluation
//! noise and a controlled blunder rate: with probability `blunder_rate` the
//! move is sampled (softmax with `temperature`) among the `top_n` root moves
//! instead of taking the best. Moves that hang the bot's own leader (leave it
//! attacked by an opponent, every one of whom moves before the bot again) or
//! that lose by force are filtered out of that sample unless the
//! `hang_allow` roll passes (zero from 1500 up). In practice no level hangs
//! its leader on purpose: the search already scores such moves near `-WIN`,
//! so their softmax weight is negligible even when the filter is skipped.
//! Weak levels are weak through noise, shallow search and short quiescence,
//! not through leader blunders. Ratings are on our own ladder, not chess Elo.

use std::time::{Duration, Instant};

use rules_core::{
    GameMode, GameState, Move, SeatStatus, apply_move, leader_under_attack, legal_moves,
};

use crate::rng::Rng;
use crate::search::{
    EXACT_ROOT_MARGIN, Engine, FfaAlgorithm, MATE_BOUND, RootMove, SearchConfig, SearchLimits, WIN,
};
use crate::{EvalWeights, SearchResult, evaluate};

/// A selectable bot strength.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum Level {
    /// Beginner.
    L600,
    /// Novice.
    L900,
    /// Casual.
    L1200,
    /// Intermediate.
    L1500,
    /// Club.
    L1800,
    /// Strong club.
    L2100,
    /// Expert.
    L2400,
    /// Full strength within the time budget.
    Max,
}

/// Search and selection parameters of a level.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct LevelParams {
    /// Depth cap in plies (Teams, Paranoid); BRS uses `(2 * plies + 1) / 3`
    /// layers (one BRS layer covers up to three opponent plies).
    pub max_depth_plies: u32,
    /// Node budget.
    pub max_nodes: u64,
    /// Target thinking time in ms (capped further by the clock).
    pub target_ms: u64,
    /// Evaluation noise amplitude (centipawns).
    pub eval_noise: i32,
    /// Probability of sampling among the top moves instead of the best.
    pub blunder_rate: f64,
    /// How many top moves are candidates when sampling.
    pub top_n: usize,
    /// Softmax temperature in centipawns.
    pub temperature: f64,
    /// Probability that the leader-safety filter is skipped when sampling.
    /// Leader-losing moves still get (almost) zero softmax weight because the
    /// search scores them near `-WIN`, so this never makes a level hang its
    /// leader deliberately; it only matters for moves the search misjudges.
    pub hang_allow: f64,
    /// Transposition table size (MB).
    pub tt_mb: usize,
    /// Maximum quiescence depth (weak levels see shorter exchanges).
    pub max_qdepth: u32,
}

impl Level {
    /// All levels, weakest first.
    pub const ALL: [Level; 8] = [
        Level::L600,
        Level::L900,
        Level::L1200,
        Level::L1500,
        Level::L1800,
        Level::L2100,
        Level::L2400,
        Level::Max,
    ];

    /// The ladder rating label (`None` for Max).
    pub const fn rating(self) -> Option<u32> {
        // Calibrated with bot-arena on 2026-10-15 (docs/bots-calibration.md):
        // every level beats the one below in FFA and in Teams.
        match self {
            Level::L600 => Some(600),
            Level::L900 => Some(900),
            Level::L1200 => Some(1200),
            Level::L1500 => Some(1500),
            Level::L1800 => Some(1800),
            Level::L2100 => Some(2100),
            Level::L2400 => Some(2400),
            Level::Max => None,
        }
    }

    /// Level from its label (`"600"` .. `"2400"`, `"max"`).
    pub fn from_label(s: &str) -> Option<Level> {
        if s.eq_ignore_ascii_case("max") {
            return Some(Level::Max);
        }
        let n: u32 = s.parse().ok()?;
        Level::ALL.into_iter().find(|l| l.rating() == Some(n))
    }

    /// The level's parameters.
    pub fn params(self) -> LevelParams {
        let p = |max_depth_plies,
                 max_nodes,
                 target_ms,
                 eval_noise,
                 blunder_rate,
                 top_n,
                 temperature,
                 hang_allow,
                 tt_mb,
                 max_qdepth| LevelParams {
            max_depth_plies,
            max_nodes,
            target_ms,
            eval_noise,
            blunder_rate,
            top_n,
            temperature,
            hang_allow,
            tt_mb,
            max_qdepth,
        };
        // Calibrated with bot-arena on 2026-10-15 (docs/bots-calibration.md):
        // every level beats the one below in FFA and in Teams. Re-checked on
        // the 16×16 board on 2026-10-17: unchanged, still monotonic, and every
        // node budget still finishes inside its time target.
        match self {
            Level::L600 => p(1, 300, 30, 200, 0.60, 10, 300.0, 0.25, 1, 1),
            Level::L900 => p(2, 1_000, 35, 120, 0.40, 6, 160.0, 0.10, 1, 2),
            Level::L1200 => p(3, 3_000, 25, 70, 0.25, 4, 90.0, 0.03, 2, 4),
            Level::L1500 => p(4, 8_000, 80, 40, 0.12, 3, 50.0, 0.0, 4, 6),
            Level::L1800 => p(6, 16_000, 150, 20, 0.06, 2, 30.0, 0.0, 8, 8),
            Level::L2100 => p(8, 40_000, 250, 6, 0.03, 2, 15.0, 0.0, 8, 10),
            Level::L2400 => p(12, 100_000, 400, 0, 0.0, 1, 1.0, 0.0, 16, 10),
            Level::Max => p(64, u64::MAX, 500, 0, 0.0, 1, 1.0, 0.0, 16, 10),
        }
    }
}

/// Thinking time for a move: the level's target, but never more than about
/// 1/30 of the remaining clock plus 3/4 of the increment, and never more than
/// 1/10 of the remaining clock. Always at least 1 ms. `clock_ms == u64::MAX`
/// means untimed play: the budget is the level's target (used only by Max;
/// other levels are then limited by their node budget alone, see
/// [`level_limits`]).
pub fn time_budget_ms(level: Level, clock_ms: u64, increment_ms: u64) -> u64 {
    let target = level.params().target_ms;
    if clock_ms == u64::MAX {
        return target;
    }
    let alloc = clock_ms / 30 + increment_ms.saturating_mul(3) / 4;
    let hard = clock_ms / 10;
    target.min(alloc).min(hard).max(1)
}

/// The search configuration a level uses.
pub fn level_config(level: Level, seed: u64, ffa_algorithm: FfaAlgorithm) -> SearchConfig {
    let p = level.params();
    SearchConfig {
        ffa_algorithm,
        weights: EvalWeights::default(),
        eval_noise: p.eval_noise,
        seed,
        exact_root_scores: p.blunder_rate > 0.0,
        max_qdepth: p.max_qdepth,
        ..SearchConfig::default()
    }
}

/// The search limits a level uses for one move, starting now.
pub fn level_limits(
    level: Level,
    state: &GameState,
    ffa_algorithm: FfaAlgorithm,
    clock_ms: u64,
    increment_ms: u64,
) -> SearchLimits {
    let p = level.params();
    let plies = p.max_depth_plies;
    let depth = match (state.mode(), ffa_algorithm) {
        (GameMode::Ffa, FfaAlgorithm::BrsPlus | FfaAlgorithm::Brs) => (2 * plies + 1) / 3,
        _ => plies,
    };
    // Untimed play with a finite node budget is purely node-bound (and so
    // fully deterministic); otherwise the time budget sets a deadline.
    let deadline = if clock_ms == u64::MAX && p.max_nodes != u64::MAX {
        None
    } else {
        let budget = time_budget_ms(level, clock_ms, increment_ms);
        Some(Instant::now() + Duration::from_millis(budget))
    };
    SearchLimits {
        max_depth: depth,
        max_nodes: p.max_nodes,
        deadline,
    }
}

/// Picks the bot's move: a pure function of its inputs (up to the deadline;
/// levels whose node budget binds first are fully deterministic for a given
/// seed).
///
/// `clock_ms` is the bot's remaining clock (`u64::MAX` = untimed: no
/// deadline except for Max, so results are reproducible) and
/// `increment_ms` the increment per move. The score is from the bot seat's
/// view (FFA) or its team's view (Teams).
pub fn choose_move(
    state: &GameState,
    level: Level,
    clock_ms: u64,
    increment_ms: u64,
    seed: u64,
) -> SearchResult {
    choose_move_with(
        state,
        level,
        clock_ms,
        increment_ms,
        seed,
        FfaAlgorithm::default(),
    )
}

/// [`choose_move`] with an explicit FFA algorithm (for arena testing).
pub fn choose_move_with(
    state: &GameState,
    level: Level,
    clock_ms: u64,
    increment_ms: u64,
    seed: u64,
    ffa_algorithm: FfaAlgorithm,
) -> SearchResult {
    let start = Instant::now();
    // A forced move needs no engine (and no table allocation).
    if let Some(res) = forced_move(state, start) {
        return res;
    }
    // Allocate the table before the deadline clock starts.
    let mut engine = Engine::new(level.params().tt_mb);
    let limits = level_limits(level, state, ffa_algorithm, clock_ms, increment_ms);
    let mut res = choose_move_in(&mut engine, state, level, &limits, seed, ffa_algorithm);
    res.time_ms = start.elapsed().as_millis() as u64;
    res
}

/// Level-based move choice with a caller-owned [`Engine`] and explicit
/// limits (bot-service: engines reused across requests, limits shrunk under
/// load). Applies the level's configuration and blunder selection exactly
/// like [`choose_move_with`]. The engine is not cleared: call
/// [`Engine::clear`] first (on an engine of `level.params().tt_mb`) to get
/// the same result as [`choose_move_with`] for the same limits.
pub fn choose_move_in(
    engine: &mut Engine,
    state: &GameState,
    level: Level,
    limits: &SearchLimits,
    seed: u64,
    ffa_algorithm: FfaAlgorithm,
) -> SearchResult {
    let start = Instant::now();
    if let Some(res) = forced_move(state, start) {
        return res;
    }
    let cfg = level_config(level, seed, ffa_algorithm);
    let mut res = engine.search(state, limits, &cfg);
    if let Some(m) = select_move(state, &res, &level.params(), seed) {
        if Some(m) != res.best_move {
            res.pv = vec![m];
            if let Some(rm) = res.root_moves.iter().find(|r| r.mv == m) {
                res.score = rm.score;
            }
        }
        res.best_move = Some(m);
    }
    res.score = res.score.clamp(-WIN, WIN);
    res.time_ms = start.elapsed().as_millis() as u64;
    res
}

/// The result for a position with exactly one legal move (no search).
fn forced_move(state: &GameState, start: Instant) -> Option<SearchResult> {
    if state.is_over() {
        return None;
    }
    let moves = legal_moves(state);
    if moves.len() != 1 {
        return None;
    }
    let mv = moves[0];
    let score = evaluate(state, state.seat_to_move(), &EvalWeights::default());
    Some(SearchResult {
        best_move: Some(mv),
        score,
        depth: 0,
        nodes: 1,
        pv: vec![mv],
        time_ms: start.elapsed().as_millis() as u64,
        root_moves: vec![RootMove { mv, score }],
    })
}

/// Whether playing `mv` leaves the mover's leader attacked (every opponent
/// moves before the mover's next turn, so the leader is hanging).
pub fn move_hangs_leader(state: &GameState, mv: Move) -> bool {
    let me = state.seat_to_move();
    let mut c = state.clone();
    if apply_move(&mut c, mv).is_err() {
        return false;
    }
    if c.is_over() {
        return false;
    }
    c.status(me) == SeatStatus::Active && leader_under_attack(&c, me)
}

/// Level-based move selection among the searched root moves.
///
/// No sampling happens without a completed first iteration (`depth == 0`:
/// the root moves do not all have real scores), or when the best move is a
/// forced win or loss (scores there count plies, not centipawns: the best is
/// the fastest win or the longest defence).
fn select_move(state: &GameState, res: &SearchResult, p: &LevelParams, seed: u64) -> Option<Move> {
    let best = res.best_move?;
    if p.blunder_rate <= 0.0 || res.root_moves.len() < 2 || res.depth == 0 {
        return Some(best);
    }
    let mut rng = Rng::new(seed ^ state.hash().rotate_left(7) ^ 0xB1_0DE5);
    if rng.next_f64() >= p.blunder_rate {
        return Some(best);
    }
    let best_score = res
        .root_moves
        .iter()
        .find(|r| r.mv == best)
        .map_or(res.score, |r| r.score);
    if best_score.abs() >= MATE_BOUND {
        return Some(best);
    }
    let allow_hang = rng.next_f64() < p.hang_allow;
    let mut cands: Vec<(Move, i32)> = res.root_moves.iter().map(|r| (r.mv, r.score)).collect();
    cands.sort_by_key(|c| core::cmp::Reverse(c.1));
    cands.truncate(p.top_n.max(1));
    cands.retain(|&(m, s)| {
        // Moves below the exact-score window only have an upper bound.
        m == best
            || (s > best_score - EXACT_ROOT_MARGIN
                && (allow_hang || !(move_hangs_leader(state, m) || s <= -MATE_BOUND)))
    });
    if cands.len() < 2 {
        return Some(best);
    }
    let t = p.temperature.max(1.0);
    let weights: Vec<f64> = cands
        .iter()
        .map(|&(_, s)| (f64::from((s - best_score).clamp(-50_000, 0)) / t).exp())
        .collect();
    let total: f64 = weights.iter().sum();
    let mut x = rng.next_f64() * total;
    for (i, w) in weights.iter().enumerate() {
        if x < *w {
            return Some(cands[i].0);
        }
        x -= w;
    }
    Some(cands[cands.len() - 1].0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budgets() {
        // Untimed: level target.
        assert_eq!(time_budget_ms(Level::Max, u64::MAX, 0), 500);
        // 10+0 at the start: target.
        assert_eq!(time_budget_ms(Level::L2400, 600_000, 0), 400);
        // Low clock: a small fraction.
        assert_eq!(time_budget_ms(Level::Max, 3_000, 0), 100);
        assert_eq!(time_budget_ms(Level::Max, 1_000, 2_000), 100);
        assert_eq!(time_budget_ms(Level::Max, 0, 0), 1);
        // Weak levels stay under 50 ms.
        for l in [Level::L600, Level::L900, Level::L1200] {
            assert!(time_budget_ms(l, u64::MAX, 0) < 50);
        }
    }

    #[test]
    fn levels_are_monotonic() {
        for w in Level::ALL.windows(2) {
            let (a, b) = (w[0].params(), w[1].params());
            assert!(a.max_nodes <= b.max_nodes);
            assert!(a.max_depth_plies <= b.max_depth_plies);
            assert!(a.eval_noise >= b.eval_noise);
            assert!(a.blunder_rate >= b.blunder_rate);
            assert!(a.hang_allow >= b.hang_allow);
        }
        for l in [
            Level::L1500,
            Level::L1800,
            Level::L2100,
            Level::L2400,
            Level::Max,
        ] {
            assert_eq!(l.params().hang_allow, 0.0);
        }
        assert_eq!(Level::from_label("1500"), Some(Level::L1500));
        assert_eq!(Level::from_label("MAX"), Some(Level::Max));
        assert_eq!(Level::from_label("1000"), None);
    }
}
