//! The game state.
//!
//! [`GameState`] is a plain fixed-size value (no heap allocation), so cloning
//! it is a cheap memcpy of a few hundred bytes — suitable for copy-make search.
//! All fields are private; mutations go through the rules functions in
//! [`crate::apply`] so the incremental Zobrist hash and piece counts stay
//! consistent.

use core::fmt;

use crate::civ::{CivDefinition, Roster};
use crate::config::{GameConfig, GameMode};
use crate::error::{PositionError, RulesError, perr as err};
use crate::geometry::{NUM_SQUARES, Seat, Square};
use crate::movegen;
use crate::outcome::{self, Outcome};
use crate::piece::{Piece, PieceKind};
use crate::setup::{self, CastleSide, PAWN_START_PROGRESS, PROMOTION_PROGRESS};
use crate::zobrist::{self, KEYS};

/// A seat's status. Exactly one at any time.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
#[repr(u8)]
pub enum SeatStatus {
    /// In the game and holding a live leader.
    Active = 0,
    /// Teams only: lost its last leader or was stalemated; keeps taking its
    /// own turns while its partner is ACTIVE (passing automatically when it
    /// has no legal move).
    Defeated = 1,
    /// Teams only: timed out, abandoned or resigned. Pieces stay (block, can be
    /// captured) but never move; turns are skipped.
    Frozen = 2,
    /// FFA only: army taken off the board; turns are skipped.
    Removed = 3,
}

impl SeatStatus {
    /// ACTIVE and DEFEATED seats take turns; FROZEN and REMOVED seats are skipped.
    pub const fn takes_turns(self) -> bool {
        matches!(self, SeatStatus::Active | SeatStatus::Defeated)
    }

    /// Position-string letter: `A`, `D`, `F`, `R`.
    pub const fn letter(self) -> char {
        match self {
            SeatStatus::Active => 'A',
            SeatStatus::Defeated => 'D',
            SeatStatus::Frozen => 'F',
            SeatStatus::Removed => 'R',
        }
    }

    /// Parses a position-string letter.
    pub const fn from_letter(c: char) -> Option<SeatStatus> {
        match c {
            'A' => Some(SeatStatus::Active),
            'D' => Some(SeatStatus::Defeated),
            'F' => Some(SeatStatus::Frozen),
            'R' => Some(SeatStatus::Removed),
            _ => None,
        }
    }
}

/// Why a seat was defeated.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum DefeatReason {
    /// Its last leader was captured (or its civ's defeat condition was met).
    LeaderCaptured,
    /// It had no legal move at the start of its turn.
    Stalemate,
    /// Its clock ran out.
    Timeout,
    /// Its reconnect grace expired (treated like a timeout; provisional).
    Abandon,
    /// It resigned (see [`crate::apply_resign`]).
    Resign,
}

impl DefeatReason {
    /// Position-string letter: `l`, `s`, `t`, `a`, `r`.
    pub const fn letter(self) -> char {
        match self {
            DefeatReason::LeaderCaptured => 'l',
            DefeatReason::Stalemate => 's',
            DefeatReason::Timeout => 't',
            DefeatReason::Abandon => 'a',
            DefeatReason::Resign => 'r',
        }
    }

    /// Parses a position-string letter.
    pub const fn from_letter(c: char) -> Option<DefeatReason> {
        match c {
            'l' => Some(DefeatReason::LeaderCaptured),
            's' => Some(DefeatReason::Stalemate),
            't' => Some(DefeatReason::Timeout),
            'a' => Some(DefeatReason::Abandon),
            'r' => Some(DefeatReason::Resign),
            _ => None,
        }
    }

    /// Whether this is a clock loss (timeout, or abandon, which is treated
    /// like a timeout).
    pub const fn is_clock_loss(self) -> bool {
        matches!(self, DefeatReason::Timeout | DefeatReason::Abandon)
    }

    /// Whether leaving play for this reason freezes a Teams seat (clock
    /// losses and resignation) rather than defeating it (leader captured,
    /// stalemate). In FFA every reason removes the seat.
    pub const fn freezes(self) -> bool {
        matches!(
            self,
            DefeatReason::Timeout | DefeatReason::Abandon | DefeatReason::Resign
        )
    }
}

/// One entry of the defeat order.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct DefeatRecord {
    /// The defeated seat.
    pub seat: Seat,
    /// Why.
    pub reason: DefeatReason,
}

/// The order in which seats left ACTIVE status (fixed capacity, no heap).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub struct DefeatLog {
    entries: [Option<DefeatRecord>; 4],
    len: u8,
}

impl DefeatLog {
    /// Records in defeat order (first defeated first).
    pub fn iter(&self) -> impl DoubleEndedIterator<Item = DefeatRecord> + '_ {
        self.entries
            .iter()
            .take(self.len as usize)
            .flatten()
            .copied()
    }

    /// Number of defeated seats.
    pub fn len(&self) -> usize {
        self.len as usize
    }

    /// Whether nobody has been defeated.
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// The defeat reason of `seat`, if it was defeated.
    pub fn reason(&self, seat: Seat) -> Option<DefeatReason> {
        self.iter().find(|r| r.seat == seat).map(|r| r.reason)
    }

    /// Replaces the recorded reason of an already-defeated `seat`, keeping its
    /// place in the defeat order. Does nothing for a seat not in the log.
    pub(crate) fn set_reason(&mut self, seat: Seat, reason: DefeatReason) {
        for rec in self.entries.iter_mut().take(self.len as usize).flatten() {
            if rec.seat == seat {
                rec.reason = reason;
            }
        }
    }

    pub(crate) fn push(&mut self, rec: DefeatRecord) {
        if let Some(slot) = self.entries.get_mut(self.len as usize) {
            *slot = Some(rec);
            self.len += 1;
        }
    }
}

/// A live en passant target created by a pawn double-step.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct EpTarget {
    /// The square the pawn passed over (where an e.p. capturer lands).
    pub skipped: Square,
    /// The square the double-stepped pawn landed on (captured by e.p.).
    pub pawn: Square,
}

/// A seat's two castling rights.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CastlingRights {
    /// With the long-side rook (South: c1).
    pub long: bool,
    /// With the short-side rook (South: j1).
    pub short: bool,
}

impl CastlingRights {
    /// No rights.
    pub const NONE: CastlingRights = CastlingRights {
        long: false,
        short: false,
    };
    /// Both rights.
    pub const BOTH: CastlingRights = CastlingRights {
        long: true,
        short: true,
    };

    /// The right for `side`.
    pub const fn get(self, side: CastleSide) -> bool {
        match side {
            CastleSide::Long => self.long,
            CastleSide::Short => self.short,
        }
    }

    /// Whether neither right remains.
    pub const fn is_empty(self) -> bool {
        !self.long && !self.short
    }
}

/// The complete state of a game: everything needed to continue play.
#[derive(Clone, PartialEq, Eq)]
pub struct GameState {
    pub(crate) config: GameConfig,
    pub(crate) board: [Option<Piece>; NUM_SQUARES],
    pub(crate) statuses: [SeatStatus; 4],
    pub(crate) castling: [CastlingRights; 4],
    pub(crate) ep: [Option<EpTarget>; 4],
    pub(crate) to_move: Seat,
    pub(crate) no_progress: u32,
    pub(crate) ply: u32,
    pub(crate) defeats: DefeatLog,
    pub(crate) outcome: Option<Outcome>,
    /// The game ended by agreement ([`crate::apply_agreed_draw`]). Kept as
    /// state because, unlike every other result, it cannot be derived from
    /// statuses and counters.
    pub(crate) agreed_draw: bool,
    pub(crate) counts: [[u8; PieceKind::COUNT]; 4],
    pub(crate) hash: u64,
}

impl GameState {
    /// The starting position for `config`, South to move.
    pub fn new(config: GameConfig) -> Result<GameState, RulesError> {
        config.validate()?;
        let mut s = GameState::empty(config);
        for (i, p) in setup::start_board_for(&config).into_iter().enumerate() {
            if let Some(p) = p {
                s.put(Square::from_index(i), p);
            }
        }
        for seat in Seat::ALL {
            if s.civ(seat).roster.castling_leader().is_some() {
                s.set_castling(seat, CastlingRights::BOTH);
            }
        }
        Ok(s)
    }

    /// An empty board, all seats ACTIVE, South to move (internal building block).
    fn empty(config: GameConfig) -> GameState {
        let mut s = GameState {
            config,
            board: [None; NUM_SQUARES],
            statuses: [SeatStatus::Active; 4],
            castling: [CastlingRights::NONE; 4],
            ep: [None; 4],
            to_move: Seat::South,
            no_progress: 0,
            ply: 0,
            defeats: DefeatLog::default(),
            outcome: None,
            agreed_draw: false,
            counts: [[0; PieceKind::COUNT]; 4],
            hash: 0,
        };
        s.hash = zobrist::compute_hash(&s);
        s
    }

    // ----- queries -------------------------------------------------------

    /// The game configuration.
    pub fn config(&self) -> &GameConfig {
        &self.config
    }

    /// FFA or Teams.
    pub fn mode(&self) -> GameMode {
        self.config.mode
    }

    /// The board, indexed by [`Square::index`].
    pub fn board(&self) -> &[Option<Piece>; NUM_SQUARES] {
        &self.board
    }

    /// The piece on `sq`, if any.
    pub fn piece_at(&self, sq: Square) -> Option<Piece> {
        self.board[sq.index()]
    }

    /// Status of `seat`.
    pub fn status(&self, seat: Seat) -> SeatStatus {
        self.statuses[seat.index()]
    }

    /// All statuses, indexed by [`Seat::index`].
    pub fn statuses(&self) -> [SeatStatus; 4] {
        self.statuses
    }

    /// Whether `seat` still takes turns (ACTIVE or DEFEATED).
    pub fn takes_turns(&self, seat: Seat) -> bool {
        self.status(seat).takes_turns()
    }

    /// Number of seats still taking turns.
    pub fn seats_taking_turns(&self) -> u32 {
        self.statuses.iter().filter(|s| s.takes_turns()).count() as u32
    }

    /// Castling rights of `seat`.
    pub fn castling_rights(&self, seat: Seat) -> CastlingRights {
        self.castling[seat.index()]
    }

    /// En passant target created by `seat`'s last double-step, if still live.
    pub fn ep_target(&self, seat: Seat) -> Option<EpTarget> {
        self.ep[seat.index()]
    }

    /// The seat whose turn it is. While the game is ongoing this seat always
    /// takes turns and has at least one legal move.
    pub fn seat_to_move(&self) -> Seat {
        self.to_move
    }

    /// Turns taken (moves and automatic passes) since the last capture, pawn
    /// move or defeat.
    pub fn no_progress(&self) -> u32 {
        self.no_progress
    }

    /// The no-progress value at which the game ends right now:
    /// `move_limit_rounds × seats still taking turns`.
    pub fn move_limit(&self) -> u32 {
        u32::from(self.config.move_limit_rounds) * self.seats_taking_turns()
    }

    /// Turns taken since the start (moves plus automatic passes).
    pub fn ply(&self) -> u32 {
        self.ply
    }

    /// The defeat order.
    pub fn defeats(&self) -> &DefeatLog {
        &self.defeats
    }

    /// The final outcome, once the game has ended.
    pub fn outcome(&self) -> Option<&Outcome> {
        self.outcome.as_ref()
    }

    /// Whether the game has ended.
    pub fn is_over(&self) -> bool {
        self.outcome.is_some()
    }

    /// Whether the game ended in a draw by agreement.
    pub fn is_agreed_draw(&self) -> bool {
        self.agreed_draw
    }

    /// Incrementally maintained Zobrist hash (see [`crate::zobrist`]).
    pub fn hash(&self) -> u64 {
        self.hash
    }

    /// Number of `kind` pieces `seat` has on the board.
    pub fn piece_count(&self, seat: Seat, kind: PieceKind) -> u32 {
        u32::from(self.counts[seat.index()][kind.index()])
    }

    /// The civ definition of `seat`.
    pub fn civ(&self, seat: Seat) -> &'static CivDefinition {
        self.config.civ(seat)
    }

    /// The roster of `seat`.
    pub fn roster(&self, seat: Seat) -> Roster {
        self.civ(seat).roster
    }

    /// Whether `a` may capture pieces of `b` (FFA: any other seat; Teams: the
    /// other team).
    pub fn is_opponent(&self, a: Seat, b: Seat) -> bool {
        match self.config.mode {
            GameMode::Ffa => a != b,
            GameMode::Teams => a.team() != b.team(),
        }
    }

    /// Number of leader pieces `seat` holds.
    pub fn leader_count(&self, seat: Seat) -> u32 {
        self.roster(seat)
            .leaders()
            .iter()
            .map(|k| self.piece_count(seat, k))
            .sum()
    }

    /// Squares of `seat`'s leader pieces (the kinds its civ's roster gives
    /// the leader role), in square order. Any status: a seat that is no
    /// longer ACTIVE may still hold a leader piece on the board.
    pub fn leader_squares(&self, seat: Seat) -> impl Iterator<Item = Square> + '_ {
        let roster = self.roster(seat);
        self.pieces_of(seat)
            .filter(move |(_, p)| roster.is_leader(p.kind))
            .map(|(sq, _)| sq)
    }

    /// Whether `seat`'s defeat condition holds (default: no leader pieces).
    pub fn defeat_condition_met(&self, seat: Seat) -> bool {
        match self.civ(seat).hooks.defeat_condition {
            Some(hook) => hook(self, seat),
            None => self.leader_count(seat) == 0,
        }
    }

    /// Squares holding `seat`'s pieces, in square order.
    pub fn pieces_of(&self, seat: Seat) -> impl Iterator<Item = (Square, Piece)> + '_ {
        self.board
            .iter()
            .enumerate()
            .filter_map(move |(i, p)| match p {
                Some(p) if p.owner == seat => Some((Square::from_index(i), *p)),
                _ => None,
            })
    }

    // ----- mutators (crate-internal; keep hash and counts consistent) -----

    pub(crate) fn put(&mut self, sq: Square, piece: Piece) {
        self.take(sq);
        self.board[sq.index()] = Some(piece);
        let c = &mut self.counts[piece.owner.index()][piece.kind.index()];
        *c = c.saturating_add(1);
        self.hash ^= KEYS.piece[piece.owner.index()][piece.kind.index()][sq.index()];
    }

    pub(crate) fn take(&mut self, sq: Square) -> Option<Piece> {
        let piece = self.board[sq.index()].take()?;
        let c = &mut self.counts[piece.owner.index()][piece.kind.index()];
        *c = c.saturating_sub(1);
        self.hash ^= KEYS.piece[piece.owner.index()][piece.kind.index()][sq.index()];
        Some(piece)
    }

    pub(crate) fn set_status(&mut self, seat: Seat, status: SeatStatus) {
        let old = self.statuses[seat.index()];
        self.hash ^= zobrist::status_key(seat, old) ^ zobrist::status_key(seat, status);
        self.statuses[seat.index()] = status;
    }

    pub(crate) fn set_castling(&mut self, seat: Seat, rights: CastlingRights) {
        let old = self.castling[seat.index()];
        let k = &KEYS.castling[seat.index()];
        if old.long != rights.long {
            self.hash ^= k[0];
        }
        if old.short != rights.short {
            self.hash ^= k[1];
        }
        self.castling[seat.index()] = rights;
    }

    pub(crate) fn set_ep(&mut self, seat: Seat, target: Option<EpTarget>) {
        let keys = &KEYS.ep[seat.index()];
        if let Some(old) = self.ep[seat.index()] {
            self.hash ^= keys[old.skipped.index()];
        }
        if let Some(new) = target {
            self.hash ^= keys[new.skipped.index()];
        }
        self.ep[seat.index()] = target;
    }

    pub(crate) fn set_to_move(&mut self, seat: Seat) {
        self.hash ^= KEYS.to_move[self.to_move.index()] ^ KEYS.to_move[seat.index()];
        self.to_move = seat;
    }

    pub(crate) fn set_outcome(&mut self, outcome: Outcome) {
        if self.outcome.is_none() {
            self.hash ^= KEYS.game_over;
        }
        self.outcome = Some(outcome);
    }

    /// Takes every piece of `seat` off the board; returns how many.
    pub(crate) fn remove_army(&mut self, seat: Seat) -> u32 {
        let mut n = 0;
        for i in 0..NUM_SQUARES {
            if matches!(self.board[i], Some(p) if p.owner == seat) {
                self.take(Square::from_index(i));
                n += 1;
            }
        }
        n
    }

    // ----- construction from parts (position strings, serde) -------------

    /// Builds and fully validates a state from its parts. The outcome is
    /// derived (see [`outcome::derive_outcome`]), the hash recomputed.
    pub(crate) fn from_parts(p: StateParts) -> Result<GameState, PositionError> {
        p.config
            .validate()
            .map_err(|e| err("config", e.to_string()))?;
        let mode = p.config.mode;
        let mut s = GameState::empty(p.config);

        // Statuses.
        for seat in Seat::ALL {
            let st = p.statuses[seat.index()];
            let ok = match mode {
                GameMode::Ffa => matches!(st, SeatStatus::Active | SeatStatus::Removed),
                GameMode::Teams => st != SeatStatus::Removed,
            };
            if !ok {
                return Err(err(
                    "statuses",
                    format!("{seat}: status {st:?} is not possible in {}", mode.name()),
                ));
            }
            s.set_status(seat, st);
        }

        // Board.
        for (i, piece) in p.board.iter().enumerate() {
            let Some(piece) = *piece else { continue };
            let sq = Square::from_index(i);
            let seat = piece.owner;
            if s.status(seat) == SeatStatus::Removed {
                return Err(err(
                    "board",
                    format!("{sq}: removed seat {seat} has a piece"),
                ));
            }
            if !s.roster(seat).contains(piece.kind) {
                return Err(err(
                    "board",
                    format!("{sq}: {} not in {seat}'s roster", piece.kind),
                ));
            }
            if piece.kind == PieceKind::Pawn {
                let prog = seat.progress(sq);
                if !(PAWN_START_PROGRESS..PROMOTION_PROGRESS).contains(&prog) {
                    return Err(err(
                        "board",
                        format!("{sq}: {seat} pawn outside its start..promotion zone"),
                    ));
                }
            }
            s.put(sq, piece);
        }

        // Defeat order must list exactly the non-ACTIVE seats.
        for (i, rec) in p.defeats.iter().enumerate() {
            if p.defeats[..i].iter().any(|r| r.seat == rec.seat) {
                return Err(err("defeats", format!("{} listed twice", rec.seat)));
            }
            let st = s.status(rec.seat);
            if st == SeatStatus::Active {
                return Err(err("defeats", format!("{} is listed but ACTIVE", rec.seat)));
            }
            if st == SeatStatus::Defeated && rec.reason.freezes() {
                return Err(err(
                    "defeats",
                    format!(
                        "{} is DEFEATED but its reason is a timeout/abandon/resign",
                        rec.seat
                    ),
                ));
            }
            s.defeats.push(*rec);
        }
        for seat in Seat::ALL {
            if s.status(seat) != SeatStatus::Active && s.defeats.reason(seat).is_none() {
                return Err(err(
                    "defeats",
                    format!("{seat} is not ACTIVE but not listed"),
                ));
            }
        }

        // Castling: only ACTIVE seats of civs that may castle (exactly one
        // leader piece at the start).
        for seat in Seat::ALL {
            let cr = p.castling[seat.index()];
            if !cr.is_empty()
                && (s.status(seat) != SeatStatus::Active
                    || s.roster(seat).castling_leader().is_none())
            {
                return Err(err(
                    "castling",
                    format!("{seat} cannot hold castling rights"),
                ));
            }
            if let Some(leader) = s.roster(seat).castling_leader() {
                for side in CastleSide::ALL {
                    if !cr.get(side) {
                        continue;
                    }
                    // Rights are lost as soon as the leader or that rook
                    // leaves (or is taken on) its home square, so a right
                    // without both pieces at home is unreachable.
                    let g = setup::castle_geometry(seat, side);
                    if s.piece_at(g.leader_home) != Some(Piece::new(leader, seat))
                        || s.piece_at(g.rook_home) != Some(Piece::new(PieceKind::Rook, seat))
                    {
                        return Err(err(
                            "castling",
                            format!(
                                "{seat} holds a right with {} but its leader or rook is not at home",
                                g.rook_home
                            ),
                        ));
                    }
                }
            }
            s.set_castling(seat, cr);
        }

        // En passant targets.
        for seat in Seat::ALL {
            let Some(t) = p.ep[seat.index()] else {
                continue;
            };
            if !p.config.en_passant_enabled {
                return Err(err(
                    "en_passant",
                    "targets present but en passant is disabled",
                ));
            }
            if !s.takes_turns(seat) {
                return Err(err("en_passant", format!("{seat} no longer takes turns")));
            }
            if seat == p.to_move {
                // The target is cleared when the turn order reaches its seat,
                // so the seat on move can never hold a live one.
                return Err(err(
                    "en_passant",
                    format!("{seat} is on move, so its target has expired"),
                ));
            }
            let (df, dr) = seat.forward();
            if seat.progress(t.skipped) != PAWN_START_PROGRESS + 1
                || t.skipped.offset(df, dr) != Some(t.pawn)
            {
                return Err(err(
                    "en_passant",
                    format!("{seat}: {} is not a double-step skipped square", t.skipped),
                ));
            }
            s.set_ep(seat, Some(t));
        }

        // ACTIVE seats must not meet their defeat condition.
        for seat in Seat::ALL {
            if s.status(seat) == SeatStatus::Active && s.defeat_condition_met(seat) {
                return Err(err("board", format!("ACTIVE seat {seat} holds no leader")));
            }
        }

        s.set_to_move(p.to_move);
        s.no_progress = p.no_progress;
        s.ply = p.ply;
        s.agreed_draw = p.agreed_draw;

        let decided = outcome::natural_outcome(&s).is_some();
        if p.agreed_draw && decided {
            return Err(err(
                "end",
                "an agreed draw needs a game that was otherwise still in progress",
            ));
        }
        if !decided {
            // Ongoing, or drawn by agreement at the start of a playable turn.
            if !s.takes_turns(p.to_move) {
                return Err(err("to_move", format!("{} does not take turns", p.to_move)));
            }
            if !movegen::has_legal_move(&s, p.to_move) {
                return Err(err(
                    "to_move",
                    format!(
                        "{} has no legal move (a position must be at the start of a playable turn)",
                        p.to_move
                    ),
                ));
            }
        }
        if let Some(o) = outcome::derive_outcome(&s) {
            s.set_outcome(o);
        }
        debug_assert_eq!(s.hash, zobrist::compute_hash(&s));
        Ok(s)
    }

    /// The parts of this state (inverse of [`GameState::from_parts`]).
    #[cfg_attr(not(feature = "serde"), allow(dead_code))]
    pub(crate) fn to_parts(&self) -> StateParts {
        StateParts {
            config: self.config,
            board: self.board,
            statuses: self.statuses,
            castling: self.castling,
            ep: self.ep,
            to_move: self.to_move,
            no_progress: self.no_progress,
            ply: self.ply,
            defeats: self.defeats.iter().collect(),
            agreed_draw: self.agreed_draw,
        }
    }
}

impl fmt::Debug for GameState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "GameState({})",
            crate::position_string::format_position(self)
        )
    }
}

impl fmt::Display for GameState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&crate::position_string::format_position(self))
    }
}

/// Every independent field of a [`GameState`] (derived data excluded).
#[derive(Clone, Debug)]
pub(crate) struct StateParts {
    pub config: GameConfig,
    pub board: [Option<Piece>; NUM_SQUARES],
    pub statuses: [SeatStatus; 4],
    pub castling: [CastlingRights; 4],
    pub ep: [Option<EpTarget>; 4],
    pub to_move: Seat,
    pub no_progress: u32,
    pub ply: u32,
    pub defeats: Vec<DefeatRecord>,
    pub agreed_draw: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_state() {
        let s = GameState::new(GameConfig::default()).unwrap();
        assert_eq!(s.seat_to_move(), Seat::South);
        assert_eq!(s.statuses(), [SeatStatus::Active; 4]);
        for seat in Seat::ALL {
            assert_eq!(s.castling_rights(seat), CastlingRights::BOTH);
            assert_eq!(s.ep_target(seat), None);
            assert_eq!(s.piece_count(seat, PieceKind::Pawn), 8);
            assert_eq!(s.leader_count(seat), 1);
            assert_eq!(
                s.leader_squares(seat).collect::<Vec<_>>(),
                [setup::leader_home(seat)]
            );
            assert!(!s.defeat_condition_met(seat));
        }
        assert_eq!(s.move_limit(), 100);
        assert_eq!(s.hash(), zobrist::compute_hash(&s));
        assert!(!s.is_over());
    }

    #[test]
    fn state_is_small_and_cheap_to_clone() {
        // Fixed-size, heap-free: a clone is a memcpy.
        assert!(core::mem::size_of::<GameState>() <= 768);
    }

    #[test]
    fn opponents() {
        let ffa = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
        let teams = GameState::new(GameConfig::new(GameMode::Teams)).unwrap();
        assert!(ffa.is_opponent(Seat::South, Seat::North));
        assert!(!ffa.is_opponent(Seat::South, Seat::South));
        assert!(!teams.is_opponent(Seat::South, Seat::North));
        assert!(teams.is_opponent(Seat::South, Seat::West));
    }
}
