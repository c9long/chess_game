//! Authoritative rules engine for the 4-player 12×12 chess variant.
//! See `docs/PLAN.md` §2 ("rules_version 1") and `docs/RULES.md`.
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
//! assert_eq!(legal_moves(&state).len(), 28);
//! let events = apply_move(&mut state, parse_move("c2b3").unwrap()).unwrap();
//! assert_eq!(events.len(), 2); // MoveMade + Capture
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
    Move, MoveFlag, find_legal_move, generate_legal_moves, generate_moves_for_seat, has_legal_move,
    is_square_attacked_by, leader_under_attack, legal_moves,
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
pub const RULES_VERSION: u32 = 1;

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
    fn rules_version_is_one() {
        assert_eq!(RULES_VERSION, 1);
    }
}
