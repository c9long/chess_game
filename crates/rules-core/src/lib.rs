//! Authoritative rules engine for the 4-player 16×16 chess variant.
//! See `docs/PLAN.md` §2 (rules version 2) and `docs/RULES.md`.
//!
//! This crate is the single implementation of the rules, shared by the
//! browser and server (via WASM), the bot engine and the future Unity client.
//!
//! # Quick tour
//!
//! ```
//! use rules_core::{GameConfig, GameMode, GameState, apply_move, legal_moves, parse_move};
//!
//! let mut state = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
//! assert_eq!(legal_moves(&state).len(), 30);
//! let events = apply_move(&mut state, parse_move("e2e4").unwrap()).unwrap();
//! assert_eq!(events.len(), 1); // MoveMade
//! assert_eq!(state.seat_to_move(), rules_core::Seat::West);
//! let text = state.to_string(); // position string
//! assert_eq!(rules_core::parse_position(&text).unwrap(), state);
//! ```
//!
//! # Modules
//!
//! * [`geometry`] — squares, seats, teams.
//! * [`piece`] / [`civ`] — piece kinds, rosters with leader roles, versioned
//!   civ definitions and modifier hooks.
//! * [`config`] — per-game configuration.
//! * [`setup`] — starting position and castling geometry.
//! * [`state`] — [`GameState`] and seat statuses.
//! * [`movegen`] — legal move generation (self-check allowed).
//! * [`apply`] — applying moves, timeouts, abandons, resignations and agreed
//!   draws; turn advance.
//! * [`outcome`] — results and placements.
//! * [`notation`] / [`position_string`] — text formats.
//! * [`zobrist`] — hashing. [`mod@perft`] — move-tree counting.

#![forbid(unsafe_code)]

pub mod apply;
pub mod civ;
pub mod config;
pub mod error;
pub mod geometry;
pub mod movegen;
pub mod notation;
pub mod outcome;
pub mod perft;
pub mod piece;
pub mod position_string;
pub mod setup;
pub mod state;
pub mod zobrist;

#[cfg(feature = "serde")]
mod serde_impl;

pub use apply::{
    GameEvent, PASS_NOTATION, apply_abandon, apply_agreed_draw, apply_generated_move, apply_move,
    apply_move_into, apply_resign, apply_timeout, draw_voters,
};
pub use civ::{CivDefinition, CivHooks, CivId, Roster, civ_definition};
pub use config::{CivSpec, GameConfig, GameMode};
pub use error::{ConfigError, NotationError, PositionError, RulesError};
pub use geometry::{Seat, Square, Team};
pub use movegen::{
    Move, MoveFlag, attacked_leader_squares, find_legal_move, generate_legal_moves,
    generate_moves_for_seat, has_legal_move, is_square_attacked_by, leader_under_attack,
    legal_moves, premove_candidates,
};
pub use notation::{format_move, parse_move};
pub use outcome::{GameResult, Outcome};
pub use perft::{perft, perft_divide};
pub use piece::{KindSet, Piece, PieceKind};
pub use position_string::{format_position, parse_position};
pub use state::{
    CastlingRights, DefeatLog, DefeatReason, DefeatRecord, EpTarget, GameState, SeatStatus,
};

/// Version of the rule set implemented by this crate. Stored with every match
/// so replays re-simulate under the exact rules they were played with.
///
/// * `1` — the original 12×12 board (no longer playable by this engine).
/// * `2` — the 16×16 board (centred armies, promotion on the 9th line), en
///   passant on.
/// * `3` — version 2 without en passant.
///
/// New games use the current version. Configs and position strings with a
/// version outside [`MIN_SUPPORTED_RULES_VERSION`]..=[`RULES_VERSION`] are
/// rejected with an error, never mis-simulated.
pub const RULES_VERSION: u32 = 3;

/// The oldest rules version this engine can still play and replay.
pub const MIN_SUPPORTED_RULES_VERSION: u32 = 2;

/// Whether this engine can play `rules_version`.
pub const fn is_supported_rules_version(rules_version: u32) -> bool {
    rules_version >= MIN_SUPPORTED_RULES_VERSION && rules_version <= RULES_VERSION
}

impl GameState {
    /// Parses a position string (see [`position_string`]).
    pub fn from_position_string(s: &str) -> Result<GameState, PositionError> {
        parse_position(s)
    }

    /// Formats this state as a position string (same as `to_string()`).
    pub fn to_position_string(&self) -> String {
        format_position(self)
    }
}

impl core::str::FromStr for GameState {
    type Err = PositionError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        parse_position(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_version_is_three() {
        assert_eq!(RULES_VERSION, 3);
        let supported: Vec<u32> = (0..10).filter(|&v| is_supported_rules_version(v)).collect();
        assert_eq!(supported, [2, 3]);
    }
}
