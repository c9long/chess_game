//! Error types. Nothing in this crate panics on externally supplied input;
//! every failure is reported through one of these.

use core::fmt;

use crate::civ::CivId;
use crate::geometry::Seat;
use crate::movegen::Move;

/// Errors from game actions ([`crate::apply_move`], timeouts, abandons,
/// resignations, agreed draws) and
/// state construction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RulesError {
    /// The game has already ended.
    GameOver,
    /// The move is not in the legal move list of the seat to move.
    IllegalMove(Move),
    /// The action requires the seat to move, but `seat` is not on move.
    NotSeatToMove {
        /// The seat named in the action.
        seat: Seat,
        /// The seat actually on move.
        to_move: Seat,
    },
    /// The seat no longer takes turns (removed or frozen).
    SeatNotInPlay(Seat),
    /// The game configuration is invalid.
    Config(ConfigError),
}

impl fmt::Display for RulesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RulesError::GameOver => f.write_str("the game is over"),
            RulesError::IllegalMove(m) => write!(f, "illegal move {m}"),
            RulesError::NotSeatToMove { seat, to_move } => {
                write!(f, "{seat} is not on move ({to_move} is)")
            }
            RulesError::SeatNotInPlay(s) => write!(f, "{s} no longer takes turns"),
            RulesError::Config(e) => write!(f, "invalid config: {e}"),
        }
    }
}

impl std::error::Error for RulesError {}

impl From<ConfigError> for RulesError {
    fn from(e: ConfigError) -> Self {
        RulesError::Config(e)
    }
}

/// Invalid [`crate::GameConfig`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConfigError {
    /// `rules_version` is not supported by this build.
    UnsupportedRulesVersion(u32),
    /// A seat's civ `(id, version)` has no definition.
    UnknownCivVersion {
        /// The seat.
        seat: Seat,
        /// Its civ.
        civ: CivId,
        /// The requested version.
        version: u32,
    },
    /// `move_limit_rounds` must be at least 1.
    ZeroMoveLimit,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::UnsupportedRulesVersion(v) => write!(f, "unsupported rules_version {v}"),
            ConfigError::UnknownCivVersion { seat, civ, version } => {
                write!(f, "{seat}: unknown civ version {civ}.{version}")
            }
            ConfigError::ZeroMoveLimit => f.write_str("move_limit_rounds must be at least 1"),
        }
    }
}

impl std::error::Error for ConfigError {}

/// Malformed move or square notation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NotationError {
    /// Not a square name `a1`..`p16`.
    InvalidSquare(String),
    /// Not a move string like `g1h3` or `c6c7q`.
    InvalidMove(String),
}

impl fmt::Display for NotationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NotationError::InvalidSquare(s) => write!(f, "invalid square {s:?}"),
            NotationError::InvalidMove(s) => write!(f, "invalid move {s:?}"),
        }
    }
}

impl std::error::Error for NotationError {}

/// Malformed or inconsistent position string (or serialized state).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PositionError {
    /// Which part of the position is wrong (e.g. `"board"`, `"castling"`).
    pub field: &'static str,
    /// Human-readable explanation.
    pub message: String,
}

impl PositionError {
    pub(crate) fn new(field: &'static str, message: impl Into<String>) -> Self {
        PositionError {
            field,
            message: message.into(),
        }
    }
}

impl fmt::Display for PositionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.field, self.message)
    }
}

impl std::error::Error for PositionError {}

/// Shorthand constructor for [`PositionError`].
pub(crate) fn perr(field: &'static str, message: impl Into<String>) -> PositionError {
    PositionError::new(field, message)
}
