//! Game results and placements.
//!
//! * **FFA** ends when one ACTIVE seat remains: it places 1st, the others in
//!   reverse order of defeat (last defeated = 2nd).
//! * **Teams** ends when a team has no ACTIVE seat: the other team places 1st
//!   (both seats), the losing team 2nd.
//! * **Move limit** (no-progress counter reaches `move_limit_rounds × seats
//!   still taking turns`): FFA survivors (ACTIVE seats) tie for the best
//!   remaining placement, defeated seats keep reverse-defeat-order places
//!   below them; Teams is a draw (everyone 1st).
//! * **Agreed draw** ([`crate::apply_agreed_draw`], once every seat that
//!   still takes turns agreed): placed exactly like the move limit — FFA
//!   survivors tie for the best remaining placement, Teams everyone 1st.
//!   The only result not derivable from statuses and counters alone, so the
//!   state keeps a flag for it ([`GameState::is_agreed_draw`]).
//!
//! Placements use standard competition ranking (ties share a place, the
//! next place skips: 1, 1, 3, 4).

use crate::config::GameMode;
use crate::geometry::{Seat, Team};
use crate::state::{GameState, SeatStatus};

/// How the game ended.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "type", rename_all = "snake_case"))]
pub enum GameResult {
    /// FFA: last civ standing.
    FfaWinner {
        /// The winner.
        seat: Seat,
    },
    /// FFA: move limit reached; the surviving seats tie.
    FfaMoveLimitTie {
        /// Survivors, indexed by [`Seat::index`].
        survivors: [bool; 4],
    },
    /// Teams: the other team has no ACTIVE seat.
    TeamsWinner {
        /// The winning team.
        team: Team,
    },
    /// Teams: move limit reached.
    TeamsDraw,
    /// FFA: every seat still taking turns agreed to a draw; the surviving
    /// (ACTIVE) seats tie for the best remaining placement.
    FfaAgreedDraw {
        /// Survivors, indexed by [`Seat::index`].
        survivors: [bool; 4],
    },
    /// Teams: every seat still taking turns agreed to a draw (everyone 1st).
    TeamsAgreedDraw,
}

impl GameResult {
    /// Whether this is a draw by agreement.
    pub const fn is_agreed_draw(self) -> bool {
        matches!(
            self,
            GameResult::FfaAgreedDraw { .. } | GameResult::TeamsAgreedDraw
        )
    }
}

/// The final result with per-seat placements (1 = best).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Outcome {
    /// What happened.
    pub result: GameResult,
    /// Placement per seat, indexed by [`Seat::index`] (ties share a value).
    pub placements: [u8; 4],
}

impl Outcome {
    /// Placement of `seat` (1 = best).
    pub fn placement(&self, seat: Seat) -> u8 {
        self.placements[seat.index()]
    }
}

/// FFA placements: ACTIVE seats share 1st; defeated seats follow in reverse
/// order of defeat.
fn ffa_placements(state: &GameState) -> [u8; 4] {
    let mut p = [0u8; 4];
    let mut survivors = 0u8;
    for seat in Seat::ALL {
        if state.status(seat) == SeatStatus::Active {
            p[seat.index()] = 1;
            survivors += 1;
        }
    }
    let mut next = survivors + 1;
    for rec in state.defeats().iter().rev() {
        if p[rec.seat.index()] == 0 {
            p[rec.seat.index()] = next;
            next += 1;
        }
    }
    for v in &mut p {
        if *v == 0 {
            *v = 4; // unreachable for consistent states
        }
    }
    p
}

/// The outcome if a seat or team has been eliminated, else `None`.
pub(crate) fn elimination_outcome(state: &GameState) -> Option<Outcome> {
    match state.mode() {
        GameMode::Ffa => {
            let mut active = Seat::ALL
                .into_iter()
                .filter(|&s| state.status(s) == SeatStatus::Active);
            match (active.next(), active.next()) {
                (Some(seat), None) => Some(Outcome {
                    result: GameResult::FfaWinner { seat },
                    placements: ffa_placements(state),
                }),
                (None, _) => Some(Outcome {
                    result: GameResult::FfaMoveLimitTie {
                        survivors: [false; 4],
                    },
                    placements: ffa_placements(state),
                }),
                _ => None,
            }
        }
        GameMode::Teams => {
            let out = |t: Team| {
                t.seats()
                    .iter()
                    .all(|&s| state.status(s) != SeatStatus::Active)
            };
            match (out(Team::SouthNorth), out(Team::WestEast)) {
                (false, false) => None,
                (true, true) => Some(Outcome {
                    result: GameResult::TeamsDraw,
                    placements: [1; 4],
                }),
                (sn_out, _) => {
                    let winner = if sn_out {
                        Team::WestEast
                    } else {
                        Team::SouthNorth
                    };
                    let mut placements = [2u8; 4];
                    for s in winner.seats() {
                        placements[s.index()] = 1;
                    }
                    Some(Outcome {
                        result: GameResult::TeamsWinner { team: winner },
                        placements,
                    })
                }
            }
        }
    }
}

fn survivors(state: &GameState) -> [bool; 4] {
    Seat::ALL.map(|s| state.status(s) == SeatStatus::Active)
}

/// The outcome when the move limit is reached.
pub(crate) fn move_limit_outcome(state: &GameState) -> Outcome {
    match state.mode() {
        GameMode::Ffa => Outcome {
            result: GameResult::FfaMoveLimitTie {
                survivors: survivors(state),
            },
            placements: ffa_placements(state),
        },
        GameMode::Teams => Outcome {
            result: GameResult::TeamsDraw,
            placements: [1; 4],
        },
    }
}

/// The outcome of a draw by agreement (same placements as the move limit).
pub(crate) fn agreed_draw_outcome(state: &GameState) -> Outcome {
    match state.mode() {
        GameMode::Ffa => Outcome {
            result: GameResult::FfaAgreedDraw {
                survivors: survivors(state),
            },
            placements: ffa_placements(state),
        },
        GameMode::Teams => Outcome {
            result: GameResult::TeamsAgreedDraw,
            placements: [1; 4],
        },
    }
}

/// Whether the no-progress counter has reached the current limit.
pub(crate) fn move_limit_reached(state: &GameState) -> bool {
    state.no_progress() >= state.move_limit()
}

/// The outcome implied by statuses and counters alone (elimination or move
/// limit), ignoring an agreed draw.
pub(crate) fn natural_outcome(state: &GameState) -> Option<Outcome> {
    elimination_outcome(state)
        .or_else(|| move_limit_reached(state).then(|| move_limit_outcome(state)))
}

/// The outcome implied by a state's statuses, counters and agreed-draw flag,
/// if it is over. Every finished state produced by the engine satisfies
/// `derive_outcome(s) == s.outcome()`.
pub fn derive_outcome(state: &GameState) -> Option<Outcome> {
    natural_outcome(state).or_else(|| state.is_agreed_draw().then(|| agreed_draw_outcome(state)))
}
