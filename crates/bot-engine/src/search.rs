//! The search: one alpha-beta implementation driven by a *side* function.
//!
//! Every node is a position from rules-core (copy-make: [`GameState`] is a
//! fixed-size `Clone`). The next mover always comes from the state, so
//! automatic passes, stalemates and skipped seats are resolved by rules-core
//! inside `apply_generated_move`.
//!
//! Scores are negamax-style: from the perspective of the *side* to move. The
//! sign flips only when the side changes between two nodes, never just
//! because a ply passed.
//!
//! * **Teams:** side = team. A frozen seat can make the same team move twice
//!   in a row; the score then keeps its sign.
//! * **Paranoid (FFA):** side = "root seat" vs "everyone else"; the opponents
//!   form a coalition minimising the root's score, each in turn order.
//! * **BRS / BRS+ (FFA):** MAX layers (the root seat's moves) alternate with
//!   MIN layers in which the moves of *all* opponents are pooled and only the
//!   best single reply is searched. In BRS+ the other opponents play a
//!   static default move (leader capture, then saving their own attacked
//!   leader, then good captures), which keeps every line a legal game. In
//!   plain BRS and in quiescence they pass ("stand pat"), except that a seat
//!   that can capture the root's leader does, and a seat whose own leader is
//!   attacked saves it: a pass cannot model either, and both decide games.
//!
//! Common machinery: iterative deepening, aspiration windows, PVS, a
//! transposition table, null-move pruning (only when the next mover is on the
//! other side, never in low material or with a threatened leader), late move
//! reductions, MVV-LVA + killer + history ordering with leader captures first,
//! and quiescence search on captures and queen promotions.

use std::time::Instant;

use rules_core::apply::apply_null_move;
use rules_core::{
    GameEvent, GameMode, GameResult, GameState, Move, Piece, PieceKind, Seat, SeatStatus,
    apply_generated_move, generate_legal_moves, is_square_attacked_by, leader_under_attack,
};

use crate::eval::Evaluator;
use crate::rng::splitmix64;
use crate::tt::{Bound, SMove, Tt};
use crate::{EvalWeights, SearchResult};

/// Score of an immediate win; a win found `n` plies from the root scores
/// `WIN - n`.
pub const WIN: i32 = 1_000_000;
/// Scores at or beyond `±MATE_BOUND` are forced wins/losses (leader capture
/// or elimination).
pub const MATE_BOUND: i32 = WIN - 10_000;
const INF: i32 = WIN + 1;
pub(crate) const MAX_PLY: usize = 128;
/// The TT is neither probed for cutoffs nor written while the no-progress
/// counter is within this many turns of the move limit (the Zobrist hash
/// does not include the counter).
pub(crate) const TT_LIMIT_GUARD: u32 = 40;
const DELTA_MARGIN: i32 = 200;
/// The depth-1 iteration may use this many times `max_nodes`.
pub const DEPTH1_NODE_FACTOR: u64 = 4;
/// With exact root scores, root moves are searched with the window
/// `(best so far - EXACT_ROOT_MARGIN, +inf)`: a move scoring below it gets an
/// upper bound only. Level selection never picks such moves (their softmax
/// weight is negligible at every level's temperature), and a full window
/// would disable quiescence pruning.
pub const EXACT_ROOT_MARGIN: i32 = 1_500;
/// The deadline is checked every this many nodes (a power of two). BRS+
/// nodes with exact root scores can cost ~30 µs each (default moves are not
/// counted), so the poll must be frequent.
const CLOCK_POLL: u64 = 32;

/// Multi-player search algorithm used in Free-for-All.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub enum FfaAlgorithm {
    /// Best-Reply Search where the non-best opponents play their
    /// move-ordering-best move (legal lines). Default.
    #[default]
    BrsPlus,
    /// Best-Reply Search where the non-best opponents pass (except to save
    /// their leader or capture the root's). Weaker than BRS+ (it treats the
    /// non-best opponents' hanging pieces as free forever); kept for arena
    /// comparisons, not meant for level play.
    Brs,
    /// Paranoid: all opponents minimise the root's score, in turn order.
    Paranoid,
}

/// Search limits. Whichever is hit first stops the search; the result is the
/// best move of the deepest completed iteration (or a better move fully
/// searched in the interrupted one).
#[derive(Clone, Copy, Debug)]
pub struct SearchLimits {
    /// Maximum iterative-deepening depth: plies for Teams and Paranoid,
    /// layers (root move or pooled opponent reply) for BRS.
    pub max_depth: u32,
    /// Maximum number of nodes (main search plus quiescence). The depth-1
    /// iteration may use up to [`DEPTH1_NODE_FACTOR`] times this so that
    /// normally every root move gets a real score, but it is capped too:
    /// root moves it did not reach are left out of
    /// [`SearchResult::root_moves`].
    pub max_nodes: u64,
    /// Hard deadline.
    pub deadline: Option<Instant>,
}

impl SearchLimits {
    /// Depth-limited only.
    pub fn depth(max_depth: u32) -> SearchLimits {
        SearchLimits {
            max_depth,
            max_nodes: u64::MAX,
            deadline: None,
        }
    }

    /// Node-limited only (deterministic).
    pub fn nodes(max_nodes: u64) -> SearchLimits {
        SearchLimits {
            max_depth: MAX_PLY as u32 / 2,
            max_nodes,
            deadline: None,
        }
    }

    /// Time-limited only: `ms` milliseconds from now.
    pub fn time_ms(ms: u64) -> SearchLimits {
        SearchLimits {
            max_depth: MAX_PLY as u32 / 2,
            max_nodes: u64::MAX,
            deadline: Some(Instant::now() + std::time::Duration::from_millis(ms)),
        }
    }
}

/// Search configuration (everything except limits).
#[derive(Clone, Debug)]
pub struct SearchConfig {
    /// FFA algorithm (ignored in Teams).
    pub ffa_algorithm: FfaAlgorithm,
    /// Evaluation weights.
    pub weights: EvalWeights,
    /// Deterministic evaluation noise amplitude in centipawns (0 = none).
    pub eval_noise: i32,
    /// Seed for the evaluation noise.
    pub seed: u64,
    /// Search every root move with a full window so each gets an exact score
    /// (needed for level-based move selection; costs nodes).
    pub exact_root_scores: bool,
    /// Null-move pruning (Teams and Paranoid only).
    pub null_move: bool,
    /// Late move reductions.
    pub lmr: bool,
    /// Aspiration windows (iterations of depth >= 4).
    pub aspiration: bool,
    /// Maximum quiescence depth (plies/layers).
    pub max_qdepth: u32,
}

impl Default for SearchConfig {
    fn default() -> Self {
        SearchConfig {
            ffa_algorithm: FfaAlgorithm::default(),
            weights: EvalWeights::default(),
            eval_noise: 0,
            seed: 0,
            exact_root_scores: false,
            null_move: true,
            lmr: true,
            aspiration: true,
            max_qdepth: 10,
        }
    }
}

/// One root move with its score from the last completed iteration (exact
/// only with [`SearchConfig::exact_root_scores`]; otherwise an upper bound
/// for moves other than the best).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RootMove {
    /// The move.
    pub mv: Move,
    /// Its score from the root seat's (FFA) or team's (Teams) view.
    pub score: i32,
}

/// A reusable search engine (owns the transposition table and history).
pub struct Engine {
    tt: Tt,
    history: Vec<i32>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Algo {
    Teams,
    Paranoid,
    Brs { plus: bool },
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Filler {
    Pass,
    Best,
}

const HIST_LEN: usize = 4 * 144 * 144;
const HIST_MAX: i32 = 1_000_000;

impl Engine {
    /// An engine with a transposition table of about `tt_mb` megabytes.
    pub fn new(tt_mb: usize) -> Engine {
        Engine {
            tt: Tt::new(tt_mb),
            history: vec![0; HIST_LEN],
        }
    }

    /// Forgets everything learned (TT and history).
    pub fn clear(&mut self) {
        self.tt.clear();
        self.history.fill(0);
    }

    /// Searches `state` for the seat to move.
    pub fn search(
        &mut self,
        state: &GameState,
        limits: &SearchLimits,
        cfg: &SearchConfig,
    ) -> SearchResult {
        let start = Instant::now();
        if state.is_over() {
            return SearchResult::empty();
        }
        let root = state.seat_to_move();
        let algo = match state.mode() {
            GameMode::Teams => Algo::Teams,
            GameMode::Ffa => match cfg.ffa_algorithm {
                FfaAlgorithm::BrsPlus => Algo::Brs { plus: true },
                FfaAlgorithm::Brs => Algo::Brs { plus: false },
                FfaAlgorithm::Paranoid => Algo::Paranoid,
            },
        };
        let algo_id: u64 = match algo {
            Algo::Teams => 1,
            Algo::Paranoid => 2,
            Algo::Brs { plus: true } => 3,
            Algo::Brs { plus: false } => 4,
        };
        // Scores depend on the root (FFA), the algorithm and the noise, so
        // they are part of the key.
        let salt = splitmix64(
            algo_id
                ^ ((root.index() as u64) << 8)
                ^ cfg.seed.rotate_left(17)
                ^ ((cfg.eval_noise as u64) << 32),
        );
        // Age history between searches.
        for h in self.history.iter_mut() {
            *h /= 4;
        }
        self.tt.new_search();
        let ev = Evaluator::new(cfg.weights.clone());
        let mut s = Searcher {
            ev: &ev,
            tt: &mut self.tt,
            history: &mut self.history,
            cfg,
            algo,
            root,
            mode: state.mode(),
            salt,
            nodes: 0,
            max_nodes: limits.max_nodes.max(1),
            node_cap: limits.max_nodes.max(1),
            deadline: limits.deadline,
            stopped: false,
            killers: [[None; 2]; MAX_PLY],
            pv: (0..=MAX_PLY).map(|_| Vec::with_capacity(MAX_PLY)).collect(),
            lists: vec![Vec::new(); MAX_PLY + 1],
            prefixes: vec![Vec::new(); MAX_PLY + 1],
            raw: Vec::with_capacity(128),
            fill_buf: Vec::with_capacity(128),
            events: Vec::with_capacity(16),
        };
        let mut res = s.root_search(state, limits, start);
        res.time_ms = start.elapsed().as_millis() as u64;
        res
    }
}

struct Searcher<'a> {
    ev: &'a Evaluator,
    tt: &'a mut Tt,
    history: &'a mut [i32],
    cfg: &'a SearchConfig,
    algo: Algo,
    root: Seat,
    mode: GameMode,
    salt: u64,
    nodes: u64,
    max_nodes: u64,
    /// The node limit of the current iteration (`max_nodes`, or
    /// `DEPTH1_NODE_FACTOR` times it at depth 1).
    node_cap: u64,
    deadline: Option<Instant>,
    stopped: bool,
    killers: [[Option<SMove>; 2]; MAX_PLY],
    pv: Vec<Vec<SMove>>,
    lists: Vec<Vec<(SMove, i32)>>,
    prefixes: Vec<Vec<GameState>>,
    raw: Vec<Move>,
    fill_buf: Vec<Move>,
    events: Vec<GameEvent>,
}

// Move-ordering score bands.
const S_LEADER: i32 = 50_000_000;
const S_TT: i32 = 40_000_000;
const S_CAP: i32 = 30_000_000;
const S_CAP_OTHER: i32 = 25_000_000;
const S_PROMO: i32 = 24_000_000;
const S_KILLER: i32 = 20_000_000;

/// The piece a move captures, if any (en passant included).
fn victim(st: &GameState, mv: Move) -> Option<Piece> {
    if mv.flag == rules_core::MoveFlag::EnPassant {
        for s in Seat::ALL {
            if let Some(t) = st.ep_target(s)
                && t.skipped == mv.to
                && let Some(p) = st.piece_at(t.pawn)
            {
                return Some(p);
            }
        }
        return None;
    }
    st.piece_at(mv.to)
}

/// Whether capturing `v` captures a live leader.
fn is_leader(st: &GameState, v: Piece) -> bool {
    st.status(v.owner) == SeatStatus::Active && st.roster(v.owner).is_leader(v.kind)
}

/// Whether `owner` defends `sq` (a piece of `owner` could recapture there).
fn is_defended(st: &GameState, owner: Seat, sq: rules_core::Square) -> bool {
    is_square_attacked_by(st, sq, owner)
}

fn to_tt(score: i32, ply: usize) -> i32 {
    if score >= MATE_BOUND {
        score + ply as i32
    } else if score <= -MATE_BOUND {
        score - ply as i32
    } else {
        score
    }
}

fn from_tt(score: i32, ply: usize) -> i32 {
    if score >= MATE_BOUND {
        score - ply as i32
    } else if score <= -MATE_BOUND {
        score + ply as i32
    } else {
        score
    }
}

/// Picks the highest-scored remaining entry at or after `i` and swaps it to `i`.
fn pick(list: &mut [(SMove, i32)], i: usize) {
    let mut best = i;
    for j in i + 1..list.len() {
        if list[j].1 > list[best].1 {
            best = j;
        }
    }
    list.swap(i, best);
}

impl Searcher<'_> {
    // ----- small helpers ---------------------------------------------------

    #[inline]
    fn side_of(&self, seat: Seat) -> u8 {
        match self.algo {
            Algo::Teams => seat.team().index() as u8,
            _ => u8::from(seat != self.root),
        }
    }

    #[inline]
    fn is_brs(&self) -> bool {
        matches!(self.algo, Algo::Brs { .. })
    }

    #[inline]
    fn min_layer(&self, st: &GameState) -> bool {
        self.is_brs() && st.seat_to_move() != self.root
    }

    fn main_filler(&self) -> Filler {
        match self.algo {
            Algo::Brs { plus: true } => Filler::Best,
            _ => Filler::Pass,
        }
    }

    #[inline]
    fn tick(&mut self) -> bool {
        self.nodes += 1;
        if self.nodes >= self.node_cap {
            self.stopped = true;
        } else if self.nodes & (CLOCK_POLL - 1) == 0
            && let Some(d) = self.deadline
            && Instant::now() >= d
        {
            self.stopped = true;
        }
        self.stopped
    }

    fn key(&self, st: &GameState) -> u64 {
        st.hash() ^ self.salt
    }

    fn tt_trusted(&self, st: &GameState) -> bool {
        st.move_limit().saturating_sub(st.no_progress()) > TT_LIMIT_GUARD
    }

    fn noise(&self, st: &GameState, side: u8) -> i32 {
        let amp = self.cfg.eval_noise;
        if amp <= 0 {
            return 0;
        }
        let r = splitmix64(st.hash() ^ self.cfg.seed);
        let n = (r % (2 * amp as u64 + 1)) as i32 - amp;
        if side == self.side_of(self.root) {
            n
        } else {
            -n
        }
    }

    /// Static evaluation from `side`'s view.
    fn eval(&self, st: &GameState, side: u8) -> i32 {
        let a = self.ev.analyse(st);
        let v = match self.algo {
            Algo::Teams => self.ev.combine_teams(st, &a, side as usize),
            _ => {
                let r = self.ev.combine_ffa(st, &a, self.root);
                if side == 0 { r } else { -r }
            }
        };
        v + self.noise(st, side)
    }

    /// Score of a finished line from `side`'s view, or `None` if play goes on.
    /// In FFA the root seat's removal is terminal (nothing more it can do).
    fn terminal(&self, st: &GameState, side: u8, ply: usize) -> Option<i32> {
        let p = ply as i32;
        let root_view = if let Some(o) = st.outcome() {
            match o.result {
                GameResult::TeamsWinner { team } => {
                    return Some(if team.index() == side as usize {
                        WIN - p
                    } else {
                        -(WIN - p)
                    });
                }
                GameResult::TeamsDraw => return Some(0),
                GameResult::FfaWinner { seat } => {
                    if seat == self.root {
                        WIN - p
                    } else {
                        -(WIN - p)
                    }
                }
                GameResult::FfaMoveLimitTie { survivors } => {
                    if survivors[self.root.index()] {
                        // On the evaluation's scale: the static evaluation
                        // already counts `ffa_opponent_out` per removed
                        // opponent, so the tie is that baseline plus the
                        // value of sharing the best placement.
                        let n = survivors.iter().filter(|&&b| b).count().min(4);
                        let w = self.ev.weights();
                        w.ffa_opponent_out * (4 - n) as i32 + w.ffa_tie_value[n]
                    } else {
                        -(WIN - p)
                    }
                }
            }
        } else if self.mode == GameMode::Ffa && st.status(self.root) != SeatStatus::Active {
            -(WIN - p)
        } else {
            return None;
        };
        Some(if side == 0 { root_view } else { -root_view })
    }

    fn hist_index(mover: Seat, mv: Move) -> usize {
        mover.index() * 144 * 144 + mv.from.index() * 144 + mv.to.index()
    }

    /// Move-ordering score of `sm` played from `st` (the mover's own state).
    fn order_score(
        &self,
        st: &GameState,
        sm: SMove,
        tt_move: Option<SMove>,
        ply: usize,
        min_layer: bool,
    ) -> i32 {
        let mv = sm.mv;
        let v = victim(st, mv);
        if let Some(v) = v
            && is_leader(st, v)
        {
            return S_LEADER + if v.owner == self.root { 1000 } else { 0 };
        }
        if tt_move == Some(sm) {
            return S_TT;
        }
        if let Some(v) = v {
            let attacker = st.piece_at(mv.from).map_or(0, |p| self.ev.value(p.kind));
            let base = if min_layer && v.owner != self.root {
                S_CAP_OTHER
            } else {
                S_CAP
            };
            let frozen = st.status(v.owner) == SeatStatus::Frozen;
            let vv = self.ev.value(v.kind) / if frozen { 4 } else { 1 };
            return base + vv * 16 - attacker / 8;
        }
        if let Some(k) = mv.promotion {
            return S_PROMO + self.ev.value(k);
        }
        if ply < MAX_PLY {
            if self.killers[ply][0] == Some(sm) {
                return S_KILLER + 1;
            }
            if self.killers[ply][1] == Some(sm) {
                return S_KILLER;
            }
        }
        self.history[Self::hist_index(st.seat_to_move(), mv)]
    }

    /// Stateless "move-ordering best" move (BRS+ filler).
    fn static_score(&self, st: &GameState, mv: Move) -> i32 {
        let seat = st.seat_to_move();
        let Some(p) = st.piece_at(mv.from) else {
            return i32::MIN;
        };
        if let Some(v) = victim(st, mv) {
            if is_leader(st, v) {
                return 100_000_000;
            }
            let (gain, risk) = (self.ev.value(v.kind), self.ev.value(p.kind));
            // A losing capture onto a defended square is not "best".
            if gain < risk
                && Seat::ALL.into_iter().any(|o| {
                    o != v.owner && st.is_opponent(seat, o) && is_square_attacked_by(st, mv.to, o)
                })
                || gain < risk
                    && st.status(v.owner).takes_turns()
                    && is_defended(st, v.owner, mv.to)
            {
                return (gain - risk) / 4;
            }
            return 10_000_000 + gain * 16 - risk / 8;
        }
        if let Some(k) = mv.promotion {
            return 5_000_000 + self.ev.value(k);
        }
        self.ev.piece_square(seat, p.kind, mv.to.index())
            - self.ev.piece_square(seat, p.kind, mv.from.index())
    }

    /// The statically best move of `moves`. When the mover's own leader is
    /// in danger (attacked: every opponent moves before its next turn in
    /// FFA), moves that leave the leader safe come first (a leader capture
    /// still ranks first among them), so a non-best opponent never "forgets"
    /// to save its leader.
    fn static_best(&self, st: &GameState, moves: &[Move], in_danger: bool) -> Option<Move> {
        if !in_danger {
            let mut best: Option<(Move, i32)> = None;
            for &m in moves {
                let s = self.static_score(st, m);
                if best.is_none_or(|(_, b)| s > b) {
                    best = Some((m, s));
                }
            }
            return best.map(|(m, _)| m);
        }
        let seat = st.seat_to_move();
        let roster = st.roster(seat);
        let leaders: Vec<rules_core::Square> = st
            .pieces_of(seat)
            .filter(|(_, p)| roster.is_leader(p.kind))
            .map(|(sq, _)| sq)
            .collect();
        // Only a leader move, a capture (of an attacker, or of a leader,
        // which removes its seat) or a move onto a line through a leader (a
        // block) can make the leader safe; the rest are skipped without
        // trying them. The first safe move in static order is the same as
        // when trying every move.
        let aligned = |a: rules_core::Square, b: rules_core::Square| {
            let (df, dr) = (
                i32::from(a.file()) - i32::from(b.file()),
                i32::from(a.rank()) - i32::from(b.rank()),
            );
            df == 0 || dr == 0 || df.abs() == dr.abs()
        };
        let mut scored: Vec<(i32, Move)> = moves
            .iter()
            .map(|&m| (self.static_score(st, m), m))
            .collect();
        scored.sort_by_key(|&(s, _)| core::cmp::Reverse(s));
        let mut events = Vec::new();
        for &(_, m) in &scored {
            let could_save = leaders.contains(&m.from)
                || victim(st, m).is_some()
                || leaders.iter().any(|&l| aligned(l, m.to));
            if !could_save {
                continue;
            }
            let mut c = st.clone();
            events.clear();
            apply_generated_move(&mut c, m, &mut events);
            let safe = c.is_over()
                || (c.status(seat) == SeatStatus::Active && !leader_under_attack(&c, seat));
            if safe {
                return Some(m);
            }
        }
        scored.first().map(|&(_, m)| m)
    }

    /// Leader threats relevant to the default move of the seat to move:
    /// (its own leader is attacked, it attacks the root seat's leader).
    fn filler_threats(&self, st: &GameState) -> (bool, bool) {
        let seat = st.seat_to_move();
        let root_active = seat != self.root && st.status(self.root) == SeatStatus::Active;
        let own_active = st.status(seat) == SeatStatus::Active;
        let (own_roster, root_roster) = (st.roster(seat), st.roster(self.root));
        let (mut danger, mut hit) = (false, false);
        for (i, p) in st.board().iter().enumerate() {
            let Some(p) = p else { continue };
            let Some(sq) = rules_core::Square::new(i as u8) else {
                continue;
            };
            if own_active && p.owner == seat && own_roster.is_leader(p.kind) && !danger {
                danger = Seat::ALL
                    .into_iter()
                    .any(|by| st.is_opponent(by, seat) && is_square_attacked_by(st, sq, by));
            } else if root_active && p.owner == self.root && root_roster.is_leader(p.kind) && !hit {
                hit = is_square_attacked_by(st, sq, seat);
            }
        }
        (danger, hit)
    }

    /// The default move of a non-best opponent in a BRS MIN layer (`None` =
    /// pass). `moves` are the seat's legal moves if already generated.
    ///
    /// * [`Filler::Best`] (BRS+): the statically best move, leader-aware.
    /// * [`Filler::Pass`] (plain BRS, quiescence): pass, unless the seat can
    ///   capture the root's leader (it does) or its own leader is attacked
    ///   (it saves it). A pass cannot model either, and both decide games.
    fn filler_move(
        &mut self,
        st: &GameState,
        filler: Filler,
        moves: Option<&[Move]>,
    ) -> Option<Move> {
        let (danger, hit) = self.filler_threats(st);
        if filler == Filler::Pass && !danger && !hit {
            return None;
        }
        let mut buf = core::mem::take(&mut self.fill_buf);
        let list: &[Move] = match moves {
            Some(m) => m,
            None => {
                generate_legal_moves(st, &mut buf);
                &buf
            }
        };
        let m = if filler == Filler::Pass && hit {
            list.iter()
                .copied()
                .find(|&m| victim(st, m).is_some_and(|v| v.owner == self.root && is_leader(st, v)))
        } else {
            None
        };
        let m = m.or_else(|| self.static_best(st, list, danger));
        self.fill_buf = buf;
        m
    }

    /// Plays the filler for the seat to move of `st` (BRS MIN layers).
    fn fill(&mut self, st: &mut GameState, filler: Filler) {
        let m = self.filler_move(st, filler, None);
        self.events.clear();
        match m {
            Some(m) => apply_generated_move(st, m, &mut self.events),
            None => apply_null_move(st, &mut self.events),
        }
    }

    /// Whether `mv` is searched in quiescence.
    fn is_tactical(&self, st: &GameState, mv: Move, coalition: bool) -> bool {
        if mv.promotion.is_some_and(|k| k == PieceKind::Queen) {
            return true;
        }
        match victim(st, mv) {
            None => false,
            // FFA opponents capturing each other only help the root; the
            // coalition only considers captures of the root's pieces.
            Some(v) => !coalition || v.owner == self.root,
        }
    }

    /// Fills `list` with the candidates of `st` (pooled for a BRS MIN layer,
    /// with `prefix` holding the state each opponent moves from).
    fn generate(
        &mut self,
        st: &GameState,
        ply: usize,
        list: &mut Vec<(SMove, i32)>,
        prefix: &mut Vec<GameState>,
        tt_move: Option<SMove>,
        captures_only: bool,
    ) {
        list.clear();
        prefix.clear();
        let coalition = self.mode == GameMode::Ffa && st.seat_to_move() != self.root;
        let mut raw = core::mem::take(&mut self.raw);
        if !self.min_layer(st) {
            generate_legal_moves(st, &mut raw);
            for &mv in &raw {
                if captures_only && !self.is_tactical(st, mv, coalition) {
                    continue;
                }
                let sm = SMove::plain(mv);
                list.push((sm, self.order_score(st, sm, tt_move, ply, false)));
            }
            self.raw = raw;
            return;
        }
        let filler = if captures_only {
            Filler::Pass
        } else {
            self.main_filler()
        };
        let mut cur = st.clone();
        let mut k = 0u8;
        while !cur.is_over() && cur.seat_to_move() != self.root && k < 3 {
            generate_legal_moves(&cur, &mut raw);
            for &mv in &raw {
                if captures_only && !self.is_tactical(&cur, mv, true) {
                    continue;
                }
                let sm = SMove { mv, k };
                list.push((sm, self.order_score(&cur, sm, tt_move, ply, true)));
            }
            prefix.push(cur.clone());
            let m = self.filler_move(&cur, filler, Some(&raw));
            self.events.clear();
            match m {
                Some(m) => apply_generated_move(&mut cur, m, &mut self.events),
                None => apply_null_move(&mut cur, &mut self.events),
            }
            k += 1;
        }
        self.raw = raw;
    }

    /// The child position of candidate `sm`.
    fn make(
        &mut self,
        st: &GameState,
        prefix: &[GameState],
        sm: SMove,
        filler: Filler,
    ) -> GameState {
        let compound = !prefix.is_empty();
        let base = if compound {
            &prefix[(sm.k as usize).min(prefix.len() - 1)]
        } else {
            st
        };
        let mut child = base.clone();
        self.events.clear();
        apply_generated_move(&mut child, sm.mv, &mut self.events);
        if compound {
            let mut guard = 0;
            while !child.is_over() && child.seat_to_move() != self.root && guard < 4 {
                self.fill(&mut child, filler);
                guard += 1;
            }
        }
        child
    }

    fn update_pv(&mut self, ply: usize, sm: SMove) {
        let (head, tail) = self.pv.split_at_mut(ply + 1);
        let line = &mut head[ply];
        line.clear();
        line.push(sm);
        line.extend_from_slice(&tail[0]);
    }

    fn side_has_material(&self, st: &GameState, side: u8) -> bool {
        let mut m = 0;
        for seat in Seat::ALL {
            if self.side_of(seat) != side || !st.takes_turns(seat) {
                continue;
            }
            for k in [
                PieceKind::Knight,
                PieceKind::Bishop,
                PieceKind::Rook,
                PieceKind::Queen,
            ] {
                m += st.piece_count(seat, k) as i32 * self.ev.value(k);
            }
        }
        m >= 1300
    }

    fn side_leader_attacked(&self, st: &GameState, side: u8) -> bool {
        Seat::ALL
            .into_iter()
            .any(|s| self.side_of(s) == side && leader_under_attack(st, s))
    }

    // ----- search ----------------------------------------------------------

    /// Score of `child` from `side`'s view.
    fn child_score(
        &mut self,
        child: &GameState,
        side: u8,
        depth: i32,
        alpha: i32,
        beta: i32,
        ply: usize,
    ) -> i32 {
        if let Some(t) = self.terminal(child, side, ply) {
            self.pv[ply].clear();
            return t;
        }
        if self.side_of(child.seat_to_move()) == side {
            self.negamax(child, depth, alpha, beta, ply, true)
        } else {
            -self.negamax(child, depth, -beta, -alpha, ply, true)
        }
    }

    fn negamax(
        &mut self,
        st: &GameState,
        depth: i32,
        mut alpha: i32,
        mut beta: i32,
        ply: usize,
        null_ok: bool,
    ) -> i32 {
        self.pv[ply].clear();
        let side = self.side_of(st.seat_to_move());
        if let Some(t) = self.terminal(st, side, ply) {
            return t;
        }
        if depth <= 0 {
            return self.qsearch(st, alpha, beta, ply, 0);
        }
        if ply >= MAX_PLY - 8 {
            return self.eval(st, side);
        }
        if self.tick() {
            return 0;
        }
        // Mate-distance pruning.
        alpha = alpha.max(-WIN + ply as i32);
        beta = beta.min(WIN - ply as i32);
        if alpha >= beta {
            return alpha;
        }
        let pv_node = beta - alpha > 1;
        let trusted = self.tt_trusted(st);
        let key = self.key(st);
        let mut tt_move = None;
        if let Some(h) = self.tt.probe(key) {
            tt_move = h.mv;
            if trusted && !pv_node && h.depth >= depth {
                let s = from_tt(h.score, ply);
                match h.bound {
                    Bound::Exact => return s,
                    Bound::Lower if s >= beta => return s,
                    Bound::Upper if s <= alpha => return s,
                    _ => {}
                }
            }
        }

        // Null-move pruning: only when the next mover is on the other side.
        if null_ok
            && self.cfg.null_move
            && !self.is_brs()
            && !pv_node
            && depth >= 3
            && beta.abs() < MATE_BOUND
            && self.side_has_material(st, side)
            && !self.side_leader_attacked(st, side)
            && self.eval(st, side) >= beta
        {
            let mut child = st.clone();
            self.events.clear();
            apply_null_move(&mut child, &mut self.events);
            if !child.is_over() && self.side_of(child.seat_to_move()) != side {
                let r = 2 + depth / 4;
                let s = -self.negamax(&child, depth - 1 - r, -beta, -beta + 1, ply + 1, false);
                if self.stopped {
                    return 0;
                }
                if s >= beta {
                    return if s >= MATE_BOUND { beta } else { s };
                }
            }
        }

        let mut list = core::mem::take(&mut self.lists[ply]);
        let mut prefix = core::mem::take(&mut self.prefixes[ply]);
        self.generate(st, ply, &mut list, &mut prefix, tt_move, false);
        if list.is_empty() {
            self.lists[ply] = list;
            self.prefixes[ply] = prefix;
            return self.eval(st, side);
        }
        let filler = self.main_filler();
        let orig_alpha = alpha;
        let mut best = -INF;
        let mut best_move = None;
        for i in 0..list.len() {
            pick(&mut list, i);
            let (sm, sc) = list[i];
            let child = self.make(st, &prefix, sm, filler);
            let quiet = sc < S_KILLER;
            let new_depth = depth - 1;
            let mut score;
            if i == 0 {
                score = self.child_score(&child, side, new_depth, alpha, beta, ply + 1);
            } else {
                let r = if self.cfg.lmr && depth >= 3 && quiet && i >= if pv_node { 5 } else { 3 } {
                    1 + i32::from(i >= 12 && depth >= 5)
                } else {
                    0
                };
                score = self.child_score(&child, side, new_depth - r, alpha, alpha + 1, ply + 1);
                if score > alpha && r > 0 {
                    score = self.child_score(&child, side, new_depth, alpha, alpha + 1, ply + 1);
                }
                if score > alpha && score < beta {
                    score = self.child_score(&child, side, new_depth, alpha, beta, ply + 1);
                }
            }
            if self.stopped {
                self.lists[ply] = list;
                self.prefixes[ply] = prefix;
                return 0;
            }
            if score > best {
                best = score;
                best_move = Some(sm);
                if score > alpha {
                    alpha = score;
                    self.update_pv(ply, sm);
                    if score >= beta {
                        if quiet {
                            self.reward_quiet(st, &prefix, sm, ply, depth);
                        }
                        break;
                    }
                }
            }
        }
        self.lists[ply] = list;
        self.prefixes[ply] = prefix;

        if trusted {
            let bound = if best >= beta {
                Bound::Lower
            } else if best > orig_alpha {
                Bound::Exact
            } else {
                Bound::Upper
            };
            self.tt
                .store(key, best_move, to_tt(best, ply), depth, bound);
        }
        best
    }

    fn reward_quiet(
        &mut self,
        st: &GameState,
        prefix: &[GameState],
        sm: SMove,
        ply: usize,
        depth: i32,
    ) {
        if ply < MAX_PLY && self.killers[ply][0] != Some(sm) {
            self.killers[ply][1] = self.killers[ply][0];
            self.killers[ply][0] = Some(sm);
        }
        let mover = if prefix.is_empty() {
            st.seat_to_move()
        } else {
            prefix[(sm.k as usize).min(prefix.len() - 1)].seat_to_move()
        };
        let h = &mut self.history[Self::hist_index(mover, sm.mv)];
        *h += depth * depth;
        if *h > HIST_MAX {
            for x in self.history.iter_mut() {
                *x /= 2;
            }
        }
    }

    fn qchild(
        &mut self,
        child: &GameState,
        side: u8,
        alpha: i32,
        beta: i32,
        ply: usize,
        qd: u32,
    ) -> i32 {
        if let Some(t) = self.terminal(child, side, ply) {
            return t;
        }
        if self.side_of(child.seat_to_move()) == side {
            self.qsearch(child, alpha, beta, ply, qd)
        } else {
            -self.qsearch(child, -beta, -alpha, ply, qd)
        }
    }

    fn qsearch(&mut self, st: &GameState, mut alpha: i32, beta: i32, ply: usize, qd: u32) -> i32 {
        self.pv[ply].clear();
        let side = self.side_of(st.seat_to_move());
        if let Some(t) = self.terminal(st, side, ply) {
            return t;
        }
        if self.tick() {
            return 0;
        }
        let stand = self.eval(st, side);
        if ply >= MAX_PLY - 2 || qd >= self.cfg.max_qdepth || stand >= beta {
            return stand;
        }
        if stand > alpha {
            alpha = stand;
        }
        let mut list = core::mem::take(&mut self.lists[ply]);
        let mut prefix = core::mem::take(&mut self.prefixes[ply]);
        self.generate(st, ply, &mut list, &mut prefix, None, true);
        let mut best = stand;
        for i in 0..list.len() {
            pick(&mut list, i);
            let (sm, sc) = list[i];
            if sc < S_LEADER && sm.mv.promotion.is_none() {
                let base = if prefix.is_empty() {
                    st
                } else {
                    &prefix[(sm.k as usize).min(prefix.len() - 1)]
                };
                let gain = victim(base, sm.mv).map_or(0, |v| self.ev.value(v.kind));
                let optimistic = stand + gain + DELTA_MARGIN;
                if optimistic <= alpha {
                    // Fail-soft: the pruned capture might still be worth up
                    // to `optimistic`, so the returned bound must not be
                    // lower (a too-low upper bound poisons the TT).
                    best = best.max(optimistic);
                    continue;
                }
            }
            let child = self.make(st, &prefix, sm, Filler::Pass);
            let score = self.qchild(&child, side, alpha, beta, ply + 1, qd + 1);
            if self.stopped {
                self.lists[ply] = list;
                self.prefixes[ply] = prefix;
                return 0;
            }
            if score > best {
                best = score;
                if score > alpha {
                    alpha = score;
                    if score >= beta {
                        break;
                    }
                }
            }
        }
        self.lists[ply] = list;
        self.prefixes[ply] = prefix;
        best
    }

    // ----- root ------------------------------------------------------------

    fn root_search(
        &mut self,
        st: &GameState,
        limits: &SearchLimits,
        start: Instant,
    ) -> SearchResult {
        let side = self.side_of(self.root);
        let mut raw = Vec::with_capacity(64);
        generate_legal_moves(st, &mut raw);
        if raw.is_empty() {
            return SearchResult::empty();
        }
        let tt_move = self.tt.probe(self.key(st)).and_then(|h| h.mv);
        let mut moves: Vec<(SMove, i32)> = raw
            .iter()
            .map(|&m| {
                let sm = SMove::plain(m);
                (sm, self.order_score(st, sm, tt_move, 0, false))
            })
            .collect();
        moves.sort_by_key(|m| core::cmp::Reverse(m.1));
        if moves.len() == 1 {
            let mv = moves[0].0.mv;
            let score = self.eval(st, side);
            return SearchResult {
                best_move: Some(mv),
                score,
                depth: 0,
                nodes: 1,
                pv: vec![mv],
                time_ms: 0,
                root_moves: vec![crate::RootMove { mv, score }],
            };
        }

        let max_depth = limits.max_depth.clamp(1, (MAX_PLY - 16) as u32) as i32;
        let soft_stop = limits.deadline.map(|d| {
            let total = d.saturating_duration_since(start);
            start + total / 2
        });
        let exact = self.cfg.exact_root_scores;
        let mut result = SearchResult::empty();
        result.best_move = Some(moves[0].0.mv);
        result.pv = vec![moves[0].0.mv];
        let mut prev_score: i32 = 0;
        let mut root_pv: Vec<SMove> = vec![moves[0].0];

        // Root moves searched in an interrupted first iteration.
        let mut partial_done = 0usize;
        'deepen: for depth in 1..=max_depth {
            self.node_cap = if depth == 1 {
                self.max_nodes.saturating_mul(DEPTH1_NODE_FACTOR)
            } else {
                self.max_nodes
            };
            let mut delta = 50;
            let use_asp =
                !exact && self.cfg.aspiration && depth >= 4 && prev_score.abs() < MATE_BOUND;
            let (mut alpha, mut beta) = if use_asp {
                (prev_score - delta, prev_score + delta)
            } else {
                (-INF, INF)
            };
            // An interrupted iteration may only replace the previous best
            // with a move that beat the initial window: after a root
            // fail-low, the widened re-searches are noisy (LMR and TT
            // grafting), and a move that merely beat a lowered alpha is not
            // known to be better than the previous iteration's choice.
            let alpha_initial = alpha;
            loop {
                let (score, best_i, line, done) =
                    self.root_iteration(st, &mut moves, side, depth, alpha, beta, exact);
                if self.stopped {
                    // Adopt a move that fully beat the window in the
                    // interrupted iteration, with its own score (depth stays
                    // the last completed iteration's).
                    if let Some(i) = best_i
                        && score > alpha.max(alpha_initial)
                        && score < beta
                    {
                        result.best_move = Some(moves[i].0.mv);
                        result.score = score;
                        root_pv = line;
                    }
                    if depth == 1 {
                        partial_done = done;
                    }
                    break 'deepen;
                }
                if score <= alpha && alpha > -INF {
                    alpha = (alpha - delta).max(-INF);
                    delta *= 4;
                    if delta > 2000 {
                        alpha = -INF;
                    }
                    continue;
                }
                if score >= beta && beta < INF {
                    beta = (beta + delta).min(INF);
                    delta *= 4;
                    if delta > 2000 {
                        beta = INF;
                    }
                    continue;
                }
                // Completed iteration.
                let bi = best_i.unwrap_or(0);
                let best_sm = moves[bi].0;
                // Stable sort: best first, others by their (bound) scores.
                moves.swap(0, bi);
                moves[1..].sort_by_key(|m| core::cmp::Reverse(m.1));
                prev_score = score;
                root_pv = if line.first() == Some(&best_sm) {
                    line
                } else {
                    vec![best_sm]
                };
                result.best_move = Some(best_sm.mv);
                result.score = score;
                result.depth = depth as u32;
                result.root_moves = moves
                    .iter()
                    .map(|&(sm, s)| crate::RootMove {
                        mv: sm.mv,
                        score: s,
                    })
                    .collect();
                if !exact {
                    result
                        .root_moves
                        .sort_by_key(|m| core::cmp::Reverse(m.score));
                }
                break;
            }
            if score_is_win(prev_score) && WIN - prev_score <= depth {
                break;
            }
            if let Some(soft) = soft_stop
                && Instant::now() >= soft
            {
                break;
            }
            if self.nodes >= self.max_nodes {
                break;
            }
        }
        if result.depth == 0 {
            // The first iteration was interrupted: only the root moves it
            // reached have real scores (the others still hold move-ordering
            // keys, which must never leak into the result).
            result.root_moves = moves[..partial_done]
                .iter()
                .map(|&(sm, s)| crate::RootMove {
                    mv: sm.mv,
                    score: s,
                })
                .collect();
            result
                .root_moves
                .sort_by_key(|m| core::cmp::Reverse(m.score));
            if partial_done == 0 || result.score <= -MATE_BOUND {
                // Nothing (good) was searched: the first unsearched move in
                // ordering that does not leave the leader hanging, scored
                // statically.
                let fallback = self.static_fallback(st, &moves[partial_done..]);
                if let Some(mv) = fallback.or((partial_done == 0).then_some(moves[0].0.mv)) {
                    result.best_move = Some(mv);
                    result.score = self.eval(st, side);
                    root_pv = vec![SMove::plain(mv)];
                }
            }
        }
        result.score = result.score.clamp(-WIN, WIN);
        result.nodes = self.nodes;
        result.pv = self.expand_pv(st, &root_pv);
        if result.pv.first() != result.best_move.as_ref() {
            result.pv = result.best_move.into_iter().collect();
        }
        result
    }

    /// The first of `moves` (in ordering) that does not leave the root's
    /// leader attacked.
    fn static_fallback(&mut self, st: &GameState, moves: &[(SMove, i32)]) -> Option<Move> {
        for &(sm, _) in moves {
            let mut c = st.clone();
            self.events.clear();
            apply_generated_move(&mut c, sm.mv, &mut self.events);
            if c.is_over()
                || (c.status(self.root) == SeatStatus::Active
                    && !leader_under_attack(&c, self.root))
            {
                return Some(sm.mv);
            }
        }
        None
    }

    /// One root iteration. Returns (best score, index of best move, its line,
    /// number of root moves fully searched; they are `moves[..n]`).
    #[allow(clippy::too_many_arguments)]
    fn root_iteration(
        &mut self,
        st: &GameState,
        moves: &mut [(SMove, i32)],
        side: u8,
        depth: i32,
        alpha0: i32,
        beta: i32,
        exact: bool,
    ) -> (i32, Option<usize>, Vec<SMove>, usize) {
        let mut alpha = alpha0;
        let mut best = -INF;
        let mut best_i = None;
        let mut line = Vec::new();
        let mut done = 0;
        for (i, entry) in moves.iter_mut().enumerate() {
            let sm = entry.0;
            let child = self.make(st, &[], sm, Filler::Best);
            let score = if exact {
                // Exact for every move within EXACT_ROOT_MARGIN of the best.
                let lo = if best > -INF {
                    (best - EXACT_ROOT_MARGIN).max(-INF)
                } else {
                    -INF
                };
                self.child_score(&child, side, depth - 1, lo, INF, 1)
            } else if i == 0 {
                self.child_score(&child, side, depth - 1, alpha, beta, 1)
            } else {
                let s = self.child_score(&child, side, depth - 1, alpha, alpha + 1, 1);
                if s > alpha && s < beta {
                    self.child_score(&child, side, depth - 1, alpha, beta, 1)
                } else {
                    s
                }
            };
            if self.stopped {
                break;
            }
            entry.1 = score;
            done = i + 1;
            if score > best {
                best = score;
                best_i = Some(i);
                line.clear();
                line.push(sm);
                line.extend_from_slice(&self.pv[1]);
                if score > alpha {
                    alpha = score;
                    if !exact && score >= beta {
                        break;
                    }
                }
            }
        }
        (best, best_i, line, done)
    }

    /// Turns a line of search moves into real moves from `st` (BRS+ MIN
    /// layers expand to every opponent's move; BRS lines stop at the first
    /// MIN layer because passes are not moves).
    fn expand_pv(&mut self, st: &GameState, line: &[SMove]) -> Vec<Move> {
        let mut out = Vec::new();
        let mut cur = st.clone();
        let mut buf = Vec::new();
        for sm in line {
            if cur.is_over()
                || (self.mode == GameMode::Ffa && cur.status(self.root) != SeatStatus::Active)
            {
                break;
            }
            if !self.min_layer(&cur) {
                generate_legal_moves(&cur, &mut buf);
                if !buf.contains(&sm.mv) {
                    break;
                }
                out.push(sm.mv);
                self.events.clear();
                apply_generated_move(&mut cur, sm.mv, &mut self.events);
                continue;
            }
            if self.main_filler() == Filler::Pass {
                break;
            }
            let mut k = 0u8;
            let mut ok = true;
            while !cur.is_over() && cur.seat_to_move() != self.root && k < 3 {
                generate_legal_moves(&cur, &mut buf);
                let m = if k == sm.k {
                    if !buf.contains(&sm.mv) {
                        ok = false;
                        break;
                    }
                    sm.mv
                } else {
                    match self.filler_move(&cur, Filler::Best, Some(&buf)) {
                        Some(m) => m,
                        None => {
                            ok = false;
                            break;
                        }
                    }
                };
                out.push(m);
                self.events.clear();
                apply_generated_move(&mut cur, m, &mut self.events);
                k += 1;
            }
            if !ok {
                break;
            }
        }
        out
    }
}

fn score_is_win(s: i32) -> bool {
    s >= MATE_BOUND
}
