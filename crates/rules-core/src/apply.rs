//! Applying actions and advancing the turn.
//!
//! Every action ([`apply_move`], [`apply_timeout`], [`apply_abandon`],
//! [`apply_resign`], [`apply_agreed_draw`]) leaves the state either finished or at the start of a playable turn: the seat to
//! move takes turns and has at least one legal move. Getting there may
//! involve automatic steps, all reported as events:
//!
//! 1. The turn pointer walks clockwise. Every seat it reaches **or skips**
//!    has its en passant target cleared. FROZEN/REMOVED seats are skipped.
//! 2. An ACTIVE seat with no legal move is defeated by **stalemate** (FFA:
//!    removed; Teams: DEFEATED) and the walk continues.
//! 3. A DEFEATED (Teams) seat with no legal move **passes** automatically
//!    (counts as a turn for the move limit, consumes no clock) and the walk
//!    continues.
//!
//! The walk terminates: each step either reaches a seat with a move, removes
//! an ACTIVE seat (at most four times) or takes a pass turn, and pass turns
//! raise the no-progress counter until the move limit ends the game.
//!
//! **No-progress counter:** +1 per turn taken (moves and passes); reset to 0
//! by a capture, a pawn move (including promotion) or the defeat of an
//! ACTIVE seat (any reason). Freezing an already DEFEATED Teams seat is not a
//! defeat and does not reset it, but lowers the limit.

use crate::config::GameMode;
use crate::error::RulesError;
use crate::geometry::Seat;
use crate::movegen::{self, Move, MoveFlag, ep_victims};
use crate::outcome::{self, GameResult, Outcome};
use crate::piece::{Piece, PieceKind};
use crate::setup::{self, CastleSide};
use crate::state::{CastlingRights, DefeatReason, DefeatRecord, EpTarget, GameState, SeatStatus};

/// Something that happened while applying an action, in order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "type", rename_all = "snake_case"))]
pub enum GameEvent {
    /// A seat made a move (always the first event of [`apply_move`]).
    MoveMade {
        /// The mover.
        seat: Seat,
        /// The move, with the engine's flag.
        mv: Move,
        /// Kind of the moving piece (before promotion).
        piece: PieceKind,
    },
    /// A piece was captured.
    Capture {
        /// The capturing seat.
        seat: Seat,
        /// Where the captured piece stood.
        square: crate::geometry::Square,
        /// The captured piece.
        captured: Piece,
    },
    /// The capture was en passant (follows its `Capture`).
    EnPassant {
        /// The capturing seat.
        seat: Seat,
        /// Square of the removed pawn.
        captured_square: crate::geometry::Square,
    },
    /// A pawn promoted.
    Promotion {
        /// The promoting seat.
        seat: Seat,
        /// Promotion square.
        square: crate::geometry::Square,
        /// New kind.
        kind: PieceKind,
    },
    /// The move was a castle; the leader's part is the `MoveMade`.
    Castle {
        /// The castling seat.
        seat: Seat,
        /// Rook origin.
        rook_from: crate::geometry::Square,
        /// Rook destination.
        rook_to: crate::geometry::Square,
    },
    /// A DEFEATED Teams seat had no legal move and passed (notation `--`).
    Pass {
        /// The passing seat.
        seat: Seat,
    },
    /// An ACTIVE seat was defeated.
    Defeat {
        /// The defeated seat.
        seat: Seat,
        /// Why.
        reason: DefeatReason,
    },
    /// FFA: a seat's army was taken off the board (also used for the losing
    /// team's pieces at the end of a Teams game).
    ArmyRemoved {
        /// Whose army.
        seat: Seat,
    },
    /// Teams: a seat became FROZEN.
    Frozen {
        /// The frozen seat.
        seat: Seat,
    },
    /// The game ended (always the last event).
    GameEnded {
        /// Result and placements.
        outcome: Outcome,
    },
}

/// Notation for an automatic pass in move logs.
pub const PASS_NOTATION: &str = "--";

/// Validates `mv` against the legal moves of the seat to move, applies it and
/// advances the turn. Returns the events in order.
pub fn apply_move(state: &mut GameState, mv: Move) -> Result<Vec<GameEvent>, RulesError> {
    let mut events = Vec::with_capacity(4);
    apply_move_into(state, mv, &mut events)?;
    Ok(events)
}

/// Like [`apply_move`] but appends events to a caller-provided buffer. On
/// error nothing is appended and the state is unchanged.
pub fn apply_move_into(
    state: &mut GameState,
    mv: Move,
    events: &mut Vec<GameEvent>,
) -> Result<(), RulesError> {
    if state.is_over() {
        return Err(RulesError::GameOver);
    }
    let legal = movegen::find_legal_move(state, mv).ok_or(RulesError::IllegalMove(mv))?;
    play(state, legal, events);
    Ok(())
}

/// Applies a move taken from [`movegen::generate_legal_moves`] of this exact
/// state **without validating it** (fast path for search and perft). In
/// release builds it never panics, and any other move leaves the state
/// unspecified (though still memory-safe). In debug builds a `debug_assert!`
/// re-validates the move, so a move not from `generate_legal_moves` panics
/// (and the check allocates). Use [`apply_move`] for untrusted input.
pub fn apply_generated_move(state: &mut GameState, mv: Move, events: &mut Vec<GameEvent>) {
    if state.is_over() {
        return;
    }
    debug_assert!(movegen::find_legal_move(state, mv).is_some_and(|m| m == mv));
    play(state, mv, events);
}

/// **Search helper, not a game action.** Passes the turn of the seat to move
/// without moving (a "null move") and advances the turn exactly as after a
/// move: it counts as a turn for the move limit, and the turn walk clears en
/// passant targets and resolves stalemates and automatic passes as usual.
/// Bots use it for null-move pruning and for "stand pat" passes in
/// multi-player quiescence search. Never use it for real play: a player can
/// never pass voluntarily.
pub fn apply_null_move(state: &mut GameState, events: &mut Vec<GameEvent>) {
    if state.is_over() {
        return;
    }
    state.ply = state.ply.saturating_add(1);
    state.no_progress = state.no_progress.saturating_add(1);
    if check_move_limit(state, events) {
        return;
    }
    advance(state, events);
}

/// The seat to move ran out of time. FFA: REMOVED. Teams: FROZEN (an ACTIVE
/// seat is also recorded as defeated; a DEFEATED seat just freezes).
pub fn apply_timeout(state: &mut GameState, seat: Seat) -> Result<Vec<GameEvent>, RulesError> {
    if state.is_over() {
        return Err(RulesError::GameOver);
    }
    if seat != state.seat_to_move() {
        return Err(RulesError::NotSeatToMove {
            seat,
            to_move: state.seat_to_move(),
        });
    }
    let mut events = Vec::new();
    leave_play(state, seat, DefeatReason::Timeout, &mut events);
    if !state.is_over() && !check_move_limit(state, &mut events) {
        advance(state, &mut events);
    }
    Ok(events)
}

/// A seat that still takes turns abandoned the game (reconnect grace
/// expired). Treated exactly like a timeout (provisional rule), but allowed
/// for any seat; if it was that seat's turn, the turn advances.
pub fn apply_abandon(state: &mut GameState, seat: Seat) -> Result<Vec<GameEvent>, RulesError> {
    leave_any_time(state, seat, DefeatReason::Abandon)
}

/// A seat that still takes turns resigned. Allowed at any time, not only on
/// its own turn.
///
/// * **FFA** — exactly a timeout with [`DefeatReason::Resign`]: the seat is
///   REMOVED (army off the board, `Defeat` + `ArmyRemoved`). If it was that
///   seat's turn, the turn advances; otherwise the turn of the seat on move is
///   re-resolved. The game ends when one ACTIVE seat is left.
/// * **Teams** — the seat's **whole team** resigns, and the game ends at once
///   with the other team winning (winners place 1st, the resigning team 2nd;
///   the resigning team's pieces are removed as at any Teams win). Every team
///   seat still taking turns leaves play, the resigning seat first, then its
///   partner: an ACTIVE seat is recorded as defeated ([`DefeatReason::Resign`],
///   `Defeat` event) and freezes (`Frozen` event); a DEFEATED seat still
///   playing freezes and its defeat record's reason becomes
///   [`DefeatReason::Resign`] (it keeps its place in the defeat order; no new
///   `Defeat` event). A partner already FROZEN did not vote and stays as it
///   is, reason included. The engine never asks the partner: the
///   caller (the server) collects the partner's consent first, and resigns
///   immediately when the partner no longer takes turns. A single Teams seat
///   leaving on its own is [`apply_abandon`] or [`apply_timeout`].
///
/// Errors: [`RulesError::GameOver`] once the game has ended,
/// [`RulesError::SeatNotInPlay`] for a REMOVED or FROZEN seat.
pub fn apply_resign(state: &mut GameState, seat: Seat) -> Result<Vec<GameEvent>, RulesError> {
    match state.mode() {
        GameMode::Ffa => leave_any_time(state, seat, DefeatReason::Resign),
        GameMode::Teams => resign_team(state, seat),
    }
}

/// The seats whose agreement a draw needs, indexed by [`Seat::index`]: every
/// seat that still takes turns (ACTIVE seats, plus DEFEATED Teams seats still
/// playing). REMOVED and FROZEN seats don't vote. All `false` once the game
/// is over.
pub fn draw_voters(state: &GameState) -> [bool; 4] {
    if state.is_over() {
        return [false; 4];
    }
    Seat::ALL.map(|s| state.takes_turns(s))
}

/// Ends the game in a draw by agreement. The caller is responsible for
/// collecting the consent of every seat in [`draw_voters`]; the engine only
/// applies the outcome. FFA: [`GameResult::FfaAgreedDraw`] — the ACTIVE
/// seats tie for the best remaining placement and defeated seats keep their
/// reverse-defeat-order placements (as at the move limit). Teams:
/// [`GameResult::TeamsAgreedDraw`] — everyone places 1st. Returns the single
/// `GameEnded` event.
///
/// Errors: [`RulesError::GameOver`] once the game has ended.
pub fn apply_agreed_draw(state: &mut GameState) -> Result<Vec<GameEvent>, RulesError> {
    if state.is_over() {
        return Err(RulesError::GameOver);
    }
    state.agreed_draw = true;
    let o = outcome::agreed_draw_outcome(state);
    let mut events = Vec::with_capacity(1);
    finish(state, o, &mut events);
    Ok(events)
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/// Abandon / FFA resign: a seat that still takes turns leaves play, on its
/// turn or not.
fn leave_any_time(
    state: &mut GameState,
    seat: Seat,
    reason: DefeatReason,
) -> Result<Vec<GameEvent>, RulesError> {
    if state.is_over() {
        return Err(RulesError::GameOver);
    }
    if !state.takes_turns(seat) {
        return Err(RulesError::SeatNotInPlay(seat));
    }
    let was_on_move = seat == state.seat_to_move();
    let mut events = Vec::new();
    leave_play(state, seat, reason, &mut events);
    if !state.is_over() && !check_move_limit(state, &mut events) {
        if was_on_move {
            advance(state, &mut events);
        } else {
            // The seat on move may have lost its only moves (e.g. an en
            // passant capture of the departed seat's pawn): re-resolve.
            settle_turn(state, &mut events);
        }
    }
    Ok(events)
}

/// Teams resignation: every seat of `seat`'s team that still takes turns
/// leaves play (resigner first), then the game ends with the other team
/// winning.
fn resign_team(state: &mut GameState, seat: Seat) -> Result<Vec<GameEvent>, RulesError> {
    if state.is_over() {
        return Err(RulesError::GameOver);
    }
    if !state.takes_turns(seat) {
        return Err(RulesError::SeatNotInPlay(seat));
    }
    let partner = seat.partner();
    let mut events = Vec::new();
    for s in [seat, partner] {
        if state.takes_turns(s) {
            let already_defeated = state.status(s) == SeatStatus::Defeated;
            retire(state, s, DefeatReason::Resign, &mut events);
            // A DEFEATED seat still playing took part in the vote, so it is
            // recorded as resigned too (it keeps its place in the defeat
            // order). A FROZEN partner did not vote and keeps its reason.
            if already_defeated {
                state.defeats.set_reason(s, DefeatReason::Resign);
            }
        }
    }
    // The resigning team has no ACTIVE seat left, so this always ends the
    // game (the other team still has one: the game was not over).
    match outcome::elimination_outcome(state) {
        Some(o) => finish(state, o, &mut events),
        None => {
            // Unreachable for consistent states; resolve the turn as after
            // any departure rather than leave a seat that no longer plays on
            // move.
            debug_assert!(false, "a Teams resignation must end the game");
            if !check_move_limit(state, &mut events) {
                if state.takes_turns(state.seat_to_move()) {
                    settle_turn(state, &mut events);
                } else {
                    advance(state, &mut events);
                }
            }
        }
    }
    Ok(events)
}

/// Executes a known-legal move for the seat to move, then resolves defeats,
/// the move limit and the turn advance.
fn play(state: &mut GameState, mv: Move, events: &mut Vec<GameEvent>) {
    let seat = state.seat_to_move();
    let defeats_before = state.defeats().len();
    let Some(piece) = state.take(mv.from) else {
        return;
    };
    events.push(GameEvent::MoveMade {
        seat,
        mv,
        piece: piece.kind,
    });
    let mut captured = false;
    clear_castling_at(state, mv.from);
    clear_castling_at(state, mv.to);

    match mv.flag {
        MoveFlag::EnPassant => {
            let victims = ep_victims(state, seat, mv.to);
            for sq in victims.iter() {
                if let Some(c) = state.take(sq) {
                    captured = true;
                    clear_castling_at(state, sq);
                    events.push(GameEvent::Capture {
                        seat,
                        square: sq,
                        captured: c,
                    });
                    events.push(GameEvent::EnPassant {
                        seat,
                        captured_square: sq,
                    });
                }
            }
        }
        _ => {
            if let Some(c) = state.take(mv.to) {
                captured = true;
                events.push(GameEvent::Capture {
                    seat,
                    square: mv.to,
                    captured: c,
                });
            }
        }
    }

    if mv.flag == MoveFlag::Castle {
        let side = CastleSide::ALL
            .into_iter()
            .find(|&side| setup::castle_geometry(seat, side).leader_to == mv.to);
        if let Some(side) = side {
            let g = setup::castle_geometry(seat, side);
            if let Some(rook) = state.take(g.rook_home) {
                state.put(g.rook_to, rook);
                events.push(GameEvent::Castle {
                    seat,
                    rook_from: g.rook_home,
                    rook_to: g.rook_to,
                });
            }
            state.set_castling(seat, CastlingRights::NONE);
        }
    }

    let placed = match mv.promotion {
        Some(kind) if piece.kind == PieceKind::Pawn => {
            events.push(GameEvent::Promotion {
                seat,
                square: mv.to,
                kind,
            });
            Piece::new(kind, seat)
        }
        _ => piece,
    };
    state.put(mv.to, placed);

    if mv.flag == MoveFlag::DoubleStep && state.config().en_passant_enabled {
        let (fx, fy) = seat.forward();
        if let Some(skipped) = mv.from.offset(fx, fy) {
            state.set_ep(
                seat,
                Some(EpTarget {
                    skipped,
                    pawn: mv.to,
                }),
            );
        }
    }

    // Leader capture (or a civ's custom defeat condition), checked in turn
    // order after the mover.
    let mut s = seat.next();
    for _ in 0..Seat::COUNT {
        if state.is_over() {
            break;
        }
        if state.status(s) == SeatStatus::Active && state.defeat_condition_met(s) {
            leave_play(state, s, DefeatReason::LeaderCaptured, events);
        }
        s = s.next();
    }

    state.ply = state.ply.saturating_add(1);
    let progress =
        captured || piece.kind == PieceKind::Pawn || state.defeats().len() > defeats_before;
    state.no_progress = if progress {
        0
    } else {
        state.no_progress.saturating_add(1)
    };
    if state.is_over() || check_move_limit(state, events) {
        return;
    }
    advance(state, events);
}

/// Clears any castling right tied to `sq` (a leader or rook home square).
fn clear_castling_at(state: &mut GameState, sq: crate::geometry::Square) {
    for seat in Seat::ALL {
        let cr = state.castling_rights(seat);
        if cr.is_empty() {
            continue;
        }
        let mut new = cr;
        if sq == setup::leader_home(seat) {
            new = CastlingRights::NONE;
        } else if sq == setup::castle_geometry(seat, CastleSide::Long).rook_home {
            new.long = false;
        } else if sq == setup::castle_geometry(seat, CastleSide::Short).rook_home {
            new.short = false;
        }
        if new != cr {
            state.set_castling(seat, new);
        }
    }
}

/// Takes `seat` out of ACTIVE status (or freezes a DEFEATED Teams seat on a
/// clock loss, abandon or resignation), records the defeat, applies FFA
/// removal / Teams freezing and ends the game if a seat or team is eliminated.
fn leave_play(
    state: &mut GameState,
    seat: Seat,
    reason: DefeatReason,
    events: &mut Vec<GameEvent>,
) {
    retire(state, seat, reason, events);
    if let Some(o) = outcome::elimination_outcome(state) {
        finish(state, o, events);
    }
}

/// [`leave_play`] without the end-of-game check.
fn retire(state: &mut GameState, seat: Seat, reason: DefeatReason, events: &mut Vec<GameEvent>) {
    let was_active = state.status(seat) == SeatStatus::Active;
    if was_active {
        state.defeats.push(DefeatRecord { seat, reason });
        state.no_progress = 0;
        events.push(GameEvent::Defeat { seat, reason });
    }
    let new_status = match state.mode() {
        GameMode::Ffa => SeatStatus::Removed,
        GameMode::Teams if reason.freezes() => SeatStatus::Frozen,
        GameMode::Teams => SeatStatus::Defeated,
    };
    state.set_status(seat, new_status);
    state.set_castling(seat, CastlingRights::NONE);
    if !new_status.takes_turns() {
        state.set_ep(seat, None);
    }
    match new_status {
        SeatStatus::Removed => {
            state.remove_army(seat);
            events.push(GameEvent::ArmyRemoved { seat });
        }
        SeatStatus::Frozen => events.push(GameEvent::Frozen { seat }),
        _ => {}
    }
}

/// Ends the game with `outcome_value`.
fn finish(state: &mut GameState, outcome_value: Outcome, events: &mut Vec<GameEvent>) {
    if state.is_over() {
        return;
    }
    if let GameResult::TeamsWinner { team } = outcome_value.result {
        // "That team's pieces are removed and the other team wins."
        for s in team.other().seats() {
            if state.remove_army(s) > 0 {
                events.push(GameEvent::ArmyRemoved { seat: s });
            }
        }
    }
    state.set_outcome(outcome_value);
    events.push(GameEvent::GameEnded {
        outcome: outcome_value,
    });
}

/// Ends the game if the move limit is reached; returns whether it ended.
fn check_move_limit(state: &mut GameState, events: &mut Vec<GameEvent>) -> bool {
    if outcome::move_limit_reached(state) {
        let o = outcome::move_limit_outcome(state);
        finish(state, o, events);
        true
    } else {
        false
    }
}

/// Moves the pointer to the next seat (clearing its en passant target) and
/// resolves turns until a seat with a legal move is on move or the game ends.
fn advance(state: &mut GameState, events: &mut Vec<GameEvent>) {
    step_pointer(state);
    settle_turn(state, events);
}

fn step_pointer(state: &mut GameState) {
    let next = state.seat_to_move().next();
    state.set_to_move(next);
    state.set_ep(next, None);
}

/// Resolves the turn of the seat currently on move: stalemate defeats and
/// automatic passes, walking on until a seat can move or the game ends.
fn settle_turn(state: &mut GameState, events: &mut Vec<GameEvent>) {
    // Each pass raises the no-progress counter (bounded by the move limit);
    // each stalemate removes an ACTIVE seat (at most 4); each resolution
    // needs at most 4 pointer steps.
    let bound = 4 * (u32::from(state.config().move_limit_rounds) * 4 + 8) + 8;
    let mut steps = 0u32;
    loop {
        if state.is_over() {
            return;
        }
        let seat = state.seat_to_move();
        match state.status(seat) {
            SeatStatus::Active => {
                if movegen::has_legal_move(state, seat) {
                    return;
                }
                leave_play(state, seat, DefeatReason::Stalemate, events);
            }
            SeatStatus::Defeated => {
                if movegen::has_legal_move(state, seat) {
                    return;
                }
                events.push(GameEvent::Pass { seat });
                state.ply = state.ply.saturating_add(1);
                state.no_progress = state.no_progress.saturating_add(1);
                if check_move_limit(state, events) {
                    return;
                }
            }
            SeatStatus::Frozen | SeatStatus::Removed => {}
        }
        if state.is_over() {
            return;
        }
        step_pointer(state);
        steps += 1;
        if steps > bound {
            // Unreachable by the termination argument above; fail safe in
            // release builds rather than loop forever.
            debug_assert!(steps <= bound, "turn advance did not terminate");
            let o = outcome::move_limit_outcome(state);
            finish(state, o, events);
            return;
        }
    }
}
