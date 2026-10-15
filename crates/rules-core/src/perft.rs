//! Perft: counts leaf nodes of the move tree to a fixed depth.
//!
//! One ply is one player move; automatic steps (stalemate defeats, passes)
//! happen inside the move that triggers them, exactly as in real play.
//! Finished games have no moves and contribute 0 at any remaining depth.

use crate::apply::{GameEvent, apply_generated_move};
use crate::movegen::{Move, generate_legal_moves};
use crate::state::GameState;

/// Number of move sequences of length `depth` from `state`.
pub fn perft(state: &GameState, depth: u32) -> u64 {
    let mut events = Vec::with_capacity(16);
    perft_inner(state, depth, &mut events)
}

fn perft_inner(state: &GameState, depth: u32, events: &mut Vec<GameEvent>) -> u64 {
    if depth == 0 {
        return 1;
    }
    let mut moves = Vec::with_capacity(64);
    generate_legal_moves(state, &mut moves);
    if depth == 1 {
        return moves.len() as u64;
    }
    let mut total = 0;
    for mv in moves {
        let mut child = state.clone();
        events.clear();
        apply_generated_move(&mut child, mv, events);
        total += perft_inner(&child, depth - 1, events);
    }
    total
}

/// Perft split by first move (for debugging count mismatches).
pub fn perft_divide(state: &GameState, depth: u32) -> Vec<(Move, u64)> {
    let mut events = Vec::with_capacity(16);
    let mut out = Vec::new();
    if depth == 0 {
        return out;
    }
    let mut moves = Vec::with_capacity(64);
    generate_legal_moves(state, &mut moves);
    for mv in moves {
        let mut child = state.clone();
        events.clear();
        apply_generated_move(&mut child, mv, &mut events);
        out.push((mv, perft_inner(&child, depth - 1, &mut events)));
    }
    out
}
