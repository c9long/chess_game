//! Bot search engine for the 4-player 12×12 chess variant (PLAN §6).
//!
//! Built on `rules-core` (copy-make on its fixed-size [`GameState`]); it
//! never re-implements rules. The next mover always comes from the state,
//! so skipped seats, automatic passes and stalemates are handled by
//! rules-core.
//!
//! * **Teams:** alpha-beta (PVS) with the score from the perspective of the
//!   *team* to move; the sign flips only when the team changes (a frozen seat
//!   can make one team move twice in a row).
//! * **FFA:** Best-Reply Search (BRS+ by default), with Paranoid and plain
//!   BRS available via [`FfaAlgorithm`].
//! * Handcrafted evaluation ([`EvalWeights`], [`evaluate`]) and strength
//!   [`Level`]s with deterministic noise and capped blunders.
//!
//! # Quick start
//!
//! ```
//! use bot_engine::{Level, choose_move};
//! use rules_core::{GameConfig, GameMode, GameState, legal_moves};
//!
//! let state = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
//! // 600-level bot, 10 minutes on the clock, no increment, seed 42.
//! let r = choose_move(&state, Level::L600, 600_000, 0, 42);
//! let mv = r.best_move.unwrap();
//! assert!(legal_moves(&state).contains(&mv));
//! ```
//!
//! For repeated searches (bot-service, arena) reuse an [`Engine`], which owns
//! the transposition table, and call [`Engine::search`] with explicit
//! [`SearchLimits`] and [`SearchConfig`].
//!
//! Note: deadlines use `std::time::Instant`, which is unavailable on
//! `wasm32-unknown-unknown`; use node limits there.

#![forbid(unsafe_code)]

mod eval;
mod geom;
mod level;
mod rng;
mod search;
mod tt;

use rules_core::Move;

pub use eval::{EvalWeights, Evaluator, evaluate};
pub use level::{
    Level, LevelParams, choose_move, choose_move_in, choose_move_with, level_config, level_limits,
    move_hangs_leader, time_budget_ms,
};
pub use rng::Rng;
pub use search::{
    DEPTH1_NODE_FACTOR, EXACT_ROOT_MARGIN, Engine, FfaAlgorithm, MATE_BOUND, RootMove,
    SearchConfig, SearchLimits, WIN,
};

/// The result of a search.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchResult {
    /// The chosen move (`None` only if the game is over).
    pub best_move: Option<Move>,
    /// Score of the chosen move: centipawns from the bot seat's view (FFA) or
    /// its team's view (Teams). `>= MATE_BOUND` is a forced win
    /// (`WIN - plies`), `<= -MATE_BOUND` a forced loss. Always within
    /// `±WIN`. With `depth == 0` it is a depth-1 score of a partly searched
    /// root, or a static evaluation if no root move was searched.
    pub score: i32,
    /// Deepest completed iteration. 0 when the move was forced, or when the
    /// deadline or node cap interrupted the first iteration (then the move is
    /// the best root move searched so far, or, if none was, the first move in
    /// ordering that does not hang the leader).
    pub depth: u32,
    /// Nodes searched.
    pub nodes: u64,
    /// Principal variation as real moves from the root position (starts with
    /// `best_move`; BRS+ lines include every opponent's move).
    pub pv: Vec<Move>,
    /// Wall time spent, in milliseconds.
    pub time_ms: u64,
    /// Root moves with their scores from the last completed iteration, best
    /// first (exact only with [`SearchConfig::exact_root_scores`], and then
    /// only within [`EXACT_ROOT_MARGIN`] of the best). If the first iteration
    /// was interrupted, only the root moves it reached (possibly none).
    pub root_moves: Vec<RootMove>,
}

impl SearchResult {
    pub(crate) fn empty() -> SearchResult {
        SearchResult {
            best_move: None,
            score: 0,
            depth: 0,
            nodes: 0,
            pv: Vec::new(),
            time_ms: 0,
            root_moves: Vec::new(),
        }
    }
}
