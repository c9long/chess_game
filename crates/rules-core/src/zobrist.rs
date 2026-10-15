//! Zobrist hashing.
//!
//! [`GameState::hash`](crate::GameState::hash) is maintained incrementally by
//! every state mutation and always equals [`compute_hash`] of the same state.
//! It covers everything that affects move generation and the outcome:
//!
//! * every piece (seat × kind × square),
//! * the seat to move,
//! * each seat's status,
//! * each seat's two castling rights,
//! * each seat's en passant target (keyed by its skipped square; the pawn
//!   square is implied by the geometry),
//! * whether the game is over.
//!
//! **Not hashed:** the no-progress counter, the ply counter, the defeat order
//! and the game config (fixed per game). Search code that cares about the
//! move limit must account for the counter separately (e.g. by not storing
//! transposition-table entries whose result depends on it, or by mixing in a
//! bucket of the counter itself).

use crate::geometry::{NUM_SQUARES, Seat};
use crate::piece::PieceKind;
use crate::state::{GameState, SeatStatus};

pub(crate) struct Keys {
    pub piece: [[[u64; NUM_SQUARES]; PieceKind::COUNT]; Seat::COUNT],
    pub to_move: [u64; Seat::COUNT],
    pub status: [[u64; 4]; Seat::COUNT],
    pub castling: [[u64; 2]; Seat::COUNT],
    pub ep: [[u64; NUM_SQUARES]; Seat::COUNT],
    pub game_over: u64,
}

const fn splitmix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

const fn build_keys() -> Keys {
    let mut s: u64 = 0x5EED_0FC4_E55A_1234_u64;
    let mut keys = Keys {
        piece: [[[0; NUM_SQUARES]; PieceKind::COUNT]; Seat::COUNT],
        to_move: [0; Seat::COUNT],
        status: [[0; 4]; Seat::COUNT],
        castling: [[0; 2]; Seat::COUNT],
        ep: [[0; NUM_SQUARES]; Seat::COUNT],
        game_over: 0,
    };
    let mut seat = 0;
    while seat < Seat::COUNT {
        let mut k = 0;
        while k < PieceKind::COUNT {
            let mut sq = 0;
            while sq < NUM_SQUARES {
                keys.piece[seat][k][sq] = splitmix(&mut s);
                sq += 1;
            }
            k += 1;
        }
        let mut sq = 0;
        while sq < NUM_SQUARES {
            keys.ep[seat][sq] = splitmix(&mut s);
            sq += 1;
        }
        keys.to_move[seat] = splitmix(&mut s);
        let mut st = 0;
        while st < 4 {
            keys.status[seat][st] = splitmix(&mut s);
            st += 1;
        }
        keys.castling[seat][0] = splitmix(&mut s);
        keys.castling[seat][1] = splitmix(&mut s);
        seat += 1;
    }
    keys.game_over = splitmix(&mut s);
    keys
}

pub(crate) static KEYS: Keys = build_keys();

pub(crate) fn status_key(seat: Seat, status: SeatStatus) -> u64 {
    KEYS.status[seat.index()][status as usize]
}

/// Recomputes the hash of `state` from scratch (used to verify the
/// incrementally maintained [`GameState::hash`]).
pub fn compute_hash(state: &GameState) -> u64 {
    let mut h = 0u64;
    for (i, p) in state.board().iter().enumerate() {
        if let Some(p) = p {
            h ^= KEYS.piece[p.owner.index()][p.kind.index()][i];
        }
    }
    h ^= KEYS.to_move[state.seat_to_move().index()];
    for seat in Seat::ALL {
        h ^= status_key(seat, state.status(seat));
        let cr = state.castling_rights(seat);
        if cr.long {
            h ^= KEYS.castling[seat.index()][0];
        }
        if cr.short {
            h ^= KEYS.castling[seat.index()][1];
        }
        if let Some(t) = state.ep_target(seat) {
            h ^= KEYS.ep[seat.index()][t.skipped.index()];
        }
    }
    if state.is_over() {
        h ^= KEYS.game_over;
    }
    h
}
