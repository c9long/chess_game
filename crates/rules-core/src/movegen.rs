//! Move generation.
//!
//! Self-check is allowed, so pseudo-legal moves **are** the legal moves: no
//! move is ever filtered for leaving a leader attacked.
//!
//! * Only seats that take turns (ACTIVE or DEFEATED) generate moves; FROZEN
//!   and REMOVED seats never move.
//! * Pieces of the mover's own seat and (in Teams) of the partner block and
//!   cannot be captured. Every other piece — including FROZEN pieces — can be
//!   captured.
//! * Castling: only for ACTIVE seats whose civ starts with exactly one leader
//!   piece ([`crate::civ::Roster::castling_leader`]), with both pieces on their
//!   home squares, the right still held and the squares between empty. No
//!   attack restrictions. Civs with several leader pieces (England v2) never
//!   castle.
//! * Promotion: a pawn reaching its promotion line must promote; one move is
//!   generated per roster promotion choice (every civ so far: N, B, R, Q).
//! * Prime Minister (England v2): the union of the knight's and the king's
//!   moves (no castling).
//! * En passant (when enabled): see [`crate::state::EpTarget`] and PLAN §2.

use core::fmt;
use core::str::FromStr;

use crate::error::NotationError;
use crate::geometry::{
    ALL_DIRS, DIAGONAL, KING_STEPS, KNIGHT_STEPS, ORTHOGONAL, Seat, Square, ray,
};
use crate::piece::{Piece, PieceKind};
use crate::setup::{self, CastleSide, PAWN_START_PROGRESS, PROMOTION_PROGRESS};
use crate::state::{GameState, SeatStatus};

/// Extra information about how a move is executed. Derived by the engine;
/// ignored when a caller submits a move (only `from`, `to` and `promotion`
/// identify a move).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum MoveFlag {
    /// Ordinary move or capture (including promotions).
    #[default]
    Normal,
    /// Pawn double-step from its start line.
    DoubleStep,
    /// Castling; `from`/`to` are the leader's squares.
    Castle,
    /// En passant capture; `to` is the skipped square.
    EnPassant,
}

/// A player move. Notation: `<from><to>[promotion]`, e.g. `g1h3`, `c6c7q`,
/// `a10a12`. Passes are never moves; they are engine events.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Move {
    /// Origin square (for castling: the leader's square).
    pub from: Square,
    /// Destination square (for castling: the leader's destination).
    pub to: Square,
    /// Promotion piece, required when a pawn reaches its promotion line.
    pub promotion: Option<PieceKind>,
    /// How the move executes (see [`MoveFlag`]).
    #[cfg_attr(feature = "serde", serde(default))]
    pub flag: MoveFlag,
}

impl Move {
    /// A move without promotion (flag `Normal`).
    pub const fn new(from: Square, to: Square) -> Move {
        Move {
            from,
            to,
            promotion: None,
            flag: MoveFlag::Normal,
        }
    }

    /// A promoting move.
    pub const fn promoting(from: Square, to: Square, kind: PieceKind) -> Move {
        Move {
            from,
            to,
            promotion: Some(kind),
            flag: MoveFlag::Normal,
        }
    }

    const fn with_flag(mut self, flag: MoveFlag) -> Move {
        self.flag = flag;
        self
    }

    /// Whether two moves denote the same player choice (ignores the flag).
    pub fn same_choice(&self, other: &Move) -> bool {
        self.from == other.from && self.to == other.to && self.promotion == other.promotion
    }
}

impl fmt::Display for Move {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}", self.from, self.to)?;
        if let Some(k) = self.promotion {
            write!(f, "{}", k.letter().to_ascii_lowercase())?;
        }
        Ok(())
    }
}

impl FromStr for Move {
    type Err = NotationError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        crate::notation::parse_move(s)
    }
}

// ---------------------------------------------------------------------------
// Sinks: generation is generic so "is there any move?" can stop early.
// ---------------------------------------------------------------------------

pub(crate) trait Sink {
    fn push(&mut self, m: Move);
    fn done(&self) -> bool {
        false
    }
}

impl Sink for Vec<Move> {
    fn push(&mut self, m: Move) {
        Vec::push(self, m);
    }
}

struct AnyMove(bool);

impl Sink for AnyMove {
    fn push(&mut self, _: Move) {
        self.0 = true;
    }
    fn done(&self) -> bool {
        self.0
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// All legal moves of the seat to move (empty once the game is over).
pub fn legal_moves(state: &GameState) -> Vec<Move> {
    let mut v = Vec::with_capacity(64);
    generate_legal_moves(state, &mut v);
    v
}

/// Clears `buf` and fills it with the legal moves of the seat to move (empty
/// once the game is over). Reuse `buf` across calls to avoid allocation.
pub fn generate_legal_moves(state: &GameState, buf: &mut Vec<Move>) {
    buf.clear();
    if state.is_over() {
        return;
    }
    gen_seat(state, state.seat_to_move(), buf);
}

/// Clears `buf` and fills it with the moves `seat` could make if it were on
/// move now (empty if the seat does not take turns or the game is over).
pub fn generate_moves_for_seat(state: &GameState, seat: Seat, buf: &mut Vec<Move>) {
    buf.clear();
    if state.is_over() {
        return;
    }
    gen_seat(state, seat, buf);
}

/// Premove candidates for `seat`: every square each of its pieces could reach by its
/// movement pattern alone, whatever stands in the way or on the square (full rays for
/// sliders; a pawn's pushes and both forward diagonals), so a player can premove a recapture
/// onto a square their own piece holds now. Castling and en passant are left out. Empty when
/// the seat no longer takes turns. Never legal moves in themselves: a premove is played only
/// if it is in [`legal_moves`] when the turn comes.
pub fn premove_candidates(state: &GameState, seat: Seat) -> Vec<Move> {
    let mut out = Vec::new();
    if !state.takes_turns(seat) {
        return out;
    }
    let mut push = |from: Square, to: Square, pawn: bool| {
        if pawn && seat.progress(to) == PROMOTION_PROGRESS {
            for k in state.roster(seat).promotion_choices().iter() {
                out.push(Move {
                    promotion: Some(k),
                    ..Move::new(from, to)
                });
            }
        } else {
            out.push(Move::new(from, to));
        }
    };
    for (i, p) in state.board().iter().enumerate() {
        let Some(p) = *p else { continue };
        if p.owner != seat {
            continue;
        }
        let from = Square::from_index(i);
        let rays = |dirs: &[usize], push: &mut dyn FnMut(Square, Square, bool)| {
            for &d in dirs {
                for to in ray(from, d) {
                    push(from, to, false);
                }
            }
        };
        match p.kind {
            PieceKind::Pawn => {
                let (fx, fy) = seat.forward();
                if let Some(one) = from.offset(fx, fy) {
                    push(from, one, true);
                    if seat.progress(from) == PAWN_START_PROGRESS
                        && let Some(two) = one.offset(fx, fy)
                    {
                        push(from, two, true);
                    }
                }
                for (dx, dy) in pawn_capture_offsets(fx, fy) {
                    if let Some(to) = from.offset(dx, dy) {
                        push(from, to, true);
                    }
                }
            }
            PieceKind::Knight => KNIGHT_STEPS[i].iter().for_each(|to| push(from, to, false)),
            PieceKind::King => KING_STEPS[i].iter().for_each(|to| push(from, to, false)),
            PieceKind::PrimeMinister => {
                KNIGHT_STEPS[i].iter().for_each(|to| push(from, to, false));
                KING_STEPS[i].iter().for_each(|to| push(from, to, false));
            }
            PieceKind::Bishop => rays(&DIAGONAL, &mut push),
            PieceKind::Rook => rays(&ORTHOGONAL, &mut push),
            PieceKind::Queen => rays(&ALL_DIRS, &mut push),
        }
    }
    out
}

/// Whether `seat` has at least one legal move (ignores whose turn it is).
pub fn has_legal_move(state: &GameState, seat: Seat) -> bool {
    if !state.takes_turns(seat) {
        return false;
    }
    if state.civ(seat).hooks.modify_moves.is_some() {
        let mut v = Vec::new();
        gen_seat(state, seat, &mut v);
        return !v.is_empty();
    }
    let mut sink = AnyMove(false);
    gen_seat_standard(state, seat, &mut sink);
    sink.0
}

/// Finds the legal move matching `mv`'s `from`, `to` and `promotion` for the
/// seat to move, returning it with the engine's flag.
pub fn find_legal_move(state: &GameState, mv: Move) -> Option<Move> {
    if state.is_over() {
        return None;
    }
    let seat = state.seat_to_move();
    if !state.takes_turns(seat) {
        return None;
    }
    let piece = state.piece_at(mv.from)?;
    if piece.owner != seat {
        return None;
    }
    let mut buf = Vec::with_capacity(32);
    if state.civ(seat).hooks.modify_moves.is_some() {
        gen_seat(state, seat, &mut buf);
    } else {
        gen_piece(state, mv.from, piece, &mut buf);
        if mv.from == setup::leader_home(seat) {
            gen_castles(state, seat, &mut buf);
        }
    }
    let exact = buf.iter().find(|m| m.same_choice(&mv) && m.flag == mv.flag);
    exact
        .or_else(|| buf.iter().find(|m| m.same_choice(&mv)))
        .copied()
}

/// Whether a piece of `by` could capture on `sq` with its next move if `sq`
/// held a piece it may capture (pawns attack diagonally forward only).
/// Information only (e.g. the optional "leader under attack" glow); seats
/// that do not take turns attack nothing.
pub fn is_square_attacked_by(state: &GameState, sq: Square, by: Seat) -> bool {
    if !state.takes_turns(by) {
        return false;
    }
    let owned = |s: Square, kind: PieceKind| state.piece_at(s) == Some(Piece::new(kind, by));
    // Prime Ministers attack like knights and like kings.
    if KNIGHT_STEPS[sq.index()]
        .iter()
        .any(|s| owned(s, PieceKind::Knight) || owned(s, PieceKind::PrimeMinister))
    {
        return true;
    }
    if KING_STEPS[sq.index()]
        .iter()
        .any(|s| owned(s, PieceKind::King) || owned(s, PieceKind::PrimeMinister))
    {
        return true;
    }
    // Pawns of `by` attack sq if sq is one of their forward diagonals, i.e.
    // the pawn sits one step "backward-diagonal" from sq.
    let (fx, fy) = by.forward();
    for (dx, dy) in pawn_capture_offsets(fx, fy) {
        if let Some(s) = sq.offset(-dx, -dy)
            && owned(s, PieceKind::Pawn)
        {
            return true;
        }
    }
    for dir in ALL_DIRS {
        let diagonal = dir >= 4;
        for s in ray(sq, dir) {
            if let Some(p) = state.piece_at(s) {
                if p.owner == by {
                    let slides = match p.kind {
                        PieceKind::Queen => true,
                        PieceKind::Bishop => diagonal,
                        PieceKind::Rook => !diagonal,
                        _ => false,
                    };
                    if slides {
                        return true;
                    }
                }
                break;
            }
        }
    }
    false
}

/// Whether any leader of `seat` is attacked by an opponent that takes turns.
///
/// Drives the optional, information-only "under attack" glow. Always `false`
/// for a seat that is not ACTIVE: a non-ACTIVE seat's leaders are ordinary
/// pieces (capturing them has no effect), so there is no leader to warn
/// about. With several leader pieces (England v2) it is `true` when **any**
/// of them is attacked; [`attacked_leader_squares`] says which.
pub fn leader_under_attack(state: &GameState, seat: Seat) -> bool {
    attacked_leaders(state, seat).next().is_some()
}

/// Squares of `seat`'s leader pieces that are attacked by an opponent that
/// takes turns, in square order (the check ring goes on these only). Empty
/// for a seat that is not ACTIVE, like [`leader_under_attack`].
pub fn attacked_leader_squares(state: &GameState, seat: Seat) -> Vec<Square> {
    attacked_leaders(state, seat).collect()
}

fn attacked_leaders(state: &GameState, seat: Seat) -> impl Iterator<Item = Square> + '_ {
    let active = state.status(seat) == SeatStatus::Active;
    let roster = state.roster(seat);
    state
        .pieces_of(seat)
        .filter(move |&(sq, p)| {
            active
                && roster.is_leader(p.kind)
                && Seat::ALL
                    .into_iter()
                    .any(|by| state.is_opponent(by, seat) && is_square_attacked_by(state, sq, by))
        })
        .map(|(sq, _)| sq)
}

// ---------------------------------------------------------------------------
// Generation internals
// ---------------------------------------------------------------------------

/// Full generation for `seat`, including civ hooks.
fn gen_seat(state: &GameState, seat: Seat, buf: &mut Vec<Move>) {
    if !state.takes_turns(seat) {
        return;
    }
    gen_seat_standard(state, seat, buf);
    if let Some(hook) = state.civ(seat).hooks.modify_moves {
        hook(state, seat, buf);
    }
}

fn gen_seat_standard<S: Sink>(state: &GameState, seat: Seat, sink: &mut S) {
    if !state.takes_turns(seat) {
        return;
    }
    for (i, p) in state.board().iter().enumerate() {
        if let Some(p) = *p
            && p.owner == seat
        {
            gen_piece(state, Square::from_index(i), p, sink);
            if sink.done() {
                return;
            }
        }
    }
    gen_castles(state, seat, sink);
}

#[inline]
fn push_target<S: Sink>(
    state: &GameState,
    seat: Seat,
    from: Square,
    to: Square,
    sink: &mut S,
) -> bool {
    match state.piece_at(to) {
        None => {
            sink.push(Move::new(from, to));
            true
        }
        Some(q) => {
            if state.is_opponent(seat, q.owner) {
                sink.push(Move::new(from, to));
            }
            false
        }
    }
}

fn gen_piece<S: Sink>(state: &GameState, from: Square, piece: Piece, sink: &mut S) {
    let seat = piece.owner;
    match piece.kind {
        PieceKind::Pawn => gen_pawn(state, from, seat, sink),
        PieceKind::Knight => {
            for to in KNIGHT_STEPS[from.index()].iter() {
                push_target(state, seat, from, to, sink);
            }
        }
        PieceKind::King => {
            for to in KING_STEPS[from.index()].iter() {
                push_target(state, seat, from, to, sink);
            }
        }
        PieceKind::PrimeMinister => {
            // Knight leaps and king steps never share a destination.
            for to in KNIGHT_STEPS[from.index()].iter() {
                push_target(state, seat, from, to, sink);
            }
            for to in KING_STEPS[from.index()].iter() {
                push_target(state, seat, from, to, sink);
            }
        }
        PieceKind::Bishop => slide(state, seat, from, &DIAGONAL, sink),
        PieceKind::Rook => slide(state, seat, from, &ORTHOGONAL, sink),
        PieceKind::Queen => slide(state, seat, from, &ALL_DIRS, sink),
    }
}

fn slide<S: Sink>(state: &GameState, seat: Seat, from: Square, dirs: &[usize], sink: &mut S) {
    for &d in dirs {
        for to in ray(from, d) {
            if !push_target(state, seat, from, to, sink) {
                break;
            }
        }
    }
}

/// Forward-diagonal capture offsets for forward direction `(fx, fy)`.
pub(crate) const fn pawn_capture_offsets(fx: i8, fy: i8) -> [(i8, i8); 2] {
    if fx == 0 {
        [(-1, fy), (1, fy)]
    } else {
        [(fx, -1), (fx, 1)]
    }
}

fn push_pawn<S: Sink>(state: &GameState, seat: Seat, m: Move, sink: &mut S) {
    if seat.progress(m.to) == PROMOTION_PROGRESS {
        for k in state.roster(seat).promotion_choices().iter() {
            sink.push(Move {
                promotion: Some(k),
                ..m
            });
        }
    } else {
        sink.push(m);
    }
}

fn gen_pawn<S: Sink>(state: &GameState, from: Square, seat: Seat, sink: &mut S) {
    let (fx, fy) = seat.forward();
    // Pushes.
    if let Some(one) = from.offset(fx, fy)
        && state.piece_at(one).is_none()
    {
        push_pawn(state, seat, Move::new(from, one), sink);
        if seat.progress(from) == PAWN_START_PROGRESS
            && let Some(two) = one.offset(fx, fy)
            && state.piece_at(two).is_none()
        {
            push_pawn(
                state,
                seat,
                Move::new(from, two).with_flag(MoveFlag::DoubleStep),
                sink,
            );
        }
    }
    // Captures (normal and en passant).
    for (dx, dy) in pawn_capture_offsets(fx, fy) {
        let Some(to) = from.offset(dx, dy) else {
            continue;
        };
        match state.piece_at(to) {
            Some(q) => {
                if state.is_opponent(seat, q.owner) {
                    push_pawn(state, seat, Move::new(from, to), sink);
                }
            }
            None => {
                if state.config().en_passant_enabled && !ep_victims(state, seat, to).is_empty() {
                    push_pawn(
                        state,
                        seat,
                        Move::new(from, to).with_flag(MoveFlag::EnPassant),
                        sink,
                    );
                }
            }
        }
    }
}

/// Squares of double-stepped opponent pawns that a pawn of `seat` landing on
/// the empty square `to` captures en passant. Usually zero or one; two
/// targets can share a skipped square (e.g. South c2–c4 and West b3–d3 both
/// skip c3), in which case one en passant capture takes both pawns.
pub(crate) fn ep_victims(state: &GameState, seat: Seat, to: Square) -> EpVictims {
    let mut out = EpVictims::default();
    if !state.config().en_passant_enabled || state.piece_at(to).is_some() {
        return out;
    }
    for x in Seat::ALL {
        let Some(t) = state.ep_target(x) else {
            continue;
        };
        if t.skipped == to
            && state.is_opponent(seat, x)
            && state.piece_at(t.pawn) == Some(Piece::new(PieceKind::Pawn, x))
        {
            out.push(t.pawn);
        }
    }
    out
}

/// Small fixed list of en passant victim squares.
#[derive(Clone, Copy, Default, Debug)]
pub(crate) struct EpVictims {
    len: u8,
    squares: [Option<Square>; 4],
}

impl EpVictims {
    fn push(&mut self, sq: Square) {
        if let Some(slot) = self.squares.get_mut(self.len as usize) {
            *slot = Some(sq);
            self.len += 1;
        }
    }
    pub(crate) fn is_empty(&self) -> bool {
        self.len == 0
    }
    pub(crate) fn iter(&self) -> impl Iterator<Item = Square> + '_ {
        self.squares.iter().flatten().copied()
    }
}

fn gen_castles<S: Sink>(state: &GameState, seat: Seat, sink: &mut S) {
    if state.status(seat) != SeatStatus::Active {
        return;
    }
    let rights = state.castling_rights(seat);
    if rights.is_empty() {
        return;
    }
    let Some(leader) = state.roster(seat).castling_leader() else {
        return;
    };
    for side in CastleSide::ALL {
        if !rights.get(side) {
            continue;
        }
        let g = setup::castle_geometry(seat, side);
        if state.piece_at(g.leader_home) == Some(Piece::new(leader, seat))
            && state.piece_at(g.rook_home) == Some(Piece::new(PieceKind::Rook, seat))
            && g.between().all(|s| state.piece_at(s).is_none())
        {
            sink.push(Move::new(g.leader_home, g.leader_to).with_flag(MoveFlag::Castle));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{GameConfig, GameMode};

    #[test]
    fn move_display() {
        let m = Move::promoting(
            "c6".parse().unwrap(),
            "c7".parse().unwrap(),
            PieceKind::Queen,
        );
        assert_eq!(m.to_string(), "c6c7q");
        assert_eq!("c6c7q".parse::<Move>().unwrap(), m);
    }

    #[test]
    fn no_castling_unless_active() {
        let mut s = crate::parse_position(
            "teams 8nK7/16/16/16/16/16/16/wK14eK/16/16/16/16/16/16/16/8sK2sR4 S AAAA Sl1 - 0 0",
        )
        .unwrap();
        let castle = Move::new("i1".parse().unwrap(), "k1".parse().unwrap());
        assert_eq!(
            find_legal_move(&s, castle).map(|m| m.flag),
            Some(MoveFlag::Castle)
        );
        // Even if rights were somehow still held, a non-ACTIVE seat never castles.
        s.set_status(Seat::South, SeatStatus::Defeated);
        assert!(find_legal_move(&s, castle).is_none());
        let mut buf = Vec::new();
        generate_moves_for_seat(&s, Seat::South, &mut buf);
        assert!(buf.iter().all(|m| m.flag != MoveFlag::Castle));
        assert!(!buf.is_empty());
    }

    #[test]
    fn start_position_attacks() {
        let s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
        // South's e2 pawn attacks d3 (outside its army's span); its f1
        // knight reaches d2 in the empty margin.
        assert!(is_square_attacked_by(
            &s,
            "d3".parse().unwrap(),
            Seat::South
        ));
        assert!(is_square_attacked_by(
            &s,
            "d2".parse().unwrap(),
            Seat::South
        ));
        // West's b5 pawn attacks c4 and c6; nobody touches another army.
        assert!(is_square_attacked_by(&s, "c4".parse().unwrap(), Seat::West));
        assert!(is_square_attacked_by(&s, "c6".parse().unwrap(), Seat::West));
        assert!(!is_square_attacked_by(
            &s,
            "b5".parse().unwrap(),
            Seat::South
        ));
        assert!(!is_square_attacked_by(
            &s,
            "g6".parse().unwrap(),
            Seat::South
        ));
        for seat in Seat::ALL {
            assert!(!leader_under_attack(&s, seat));
        }
    }
}
