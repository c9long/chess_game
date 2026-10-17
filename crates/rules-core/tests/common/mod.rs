//! Shared test helpers.
#![allow(dead_code)]

use rules_core::*;

/// Square from its name.
pub fn sq(s: &str) -> Square {
    s.parse().unwrap()
}

/// Move from notation.
pub fn mv(s: &str) -> Move {
    parse_move(s).unwrap()
}

/// Board field of a position string from tokens like `"sKg1"` (seat letter,
/// piece letter, square).
pub fn board_field(pieces: &[&str]) -> String {
    let mut grid: [Option<(char, char)>; 256] = [None; 256];
    for p in pieces {
        let mut ch = p.chars();
        let seat = ch.next().unwrap();
        let kind = ch.next().unwrap();
        let square = sq(ch.as_str());
        assert!(grid[square.index()].is_none(), "duplicate square in {p}");
        grid[square.index()] = Some((seat, kind));
    }
    let mut ranks = Vec::new();
    for rank in (0..16).rev() {
        let mut s = String::new();
        let mut empty = 0;
        for file in 0..16 {
            match grid[rank * 16 + file] {
                None => empty += 1,
                Some((seat, kind)) => {
                    if empty > 0 {
                        s.push_str(&empty.to_string());
                        empty = 0;
                    }
                    s.push(seat);
                    s.push(kind);
                }
            }
        }
        if empty > 0 {
            s.push_str(&empty.to_string());
        }
        ranks.push(s);
    }
    ranks.join("/")
}

/// Builds a state: `rest` is everything after the board, e.g.
/// `"S AAAA - - 0 0"`.
pub fn build(mode: &str, pieces: &[&str], rest: &str) -> GameState {
    let text = format!("{mode} {} {rest}", board_field(pieces));
    match parse_position(&text) {
        Ok(s) => s,
        Err(e) => panic!("bad test position {text}: {e}"),
    }
}

/// Sorted move strings of the seat to move.
pub fn move_strings(state: &GameState) -> Vec<String> {
    let mut v: Vec<String> = legal_moves(state).iter().map(|m| m.to_string()).collect();
    v.sort();
    v
}

/// Whether `m` (notation) is legal now.
pub fn is_legal(state: &GameState, m: &str) -> bool {
    find_legal_move(state, mv(m)).is_some()
}

/// Applies a move, panicking with context if illegal.
pub fn play(state: &mut GameState, m: &str) -> Vec<GameEvent> {
    match apply_move(state, mv(m)) {
        Ok(ev) => ev,
        Err(e) => panic!("{m} failed: {e} in {state}"),
    }
}

/// Checks all cheap invariants of a state.
pub fn check_invariants(s: &GameState) {
    assert_eq!(s.hash(), zobrist::compute_hash(s), "hash mismatch in {s}");
    let text = s.to_position_string();
    let back = parse_position(&text).unwrap_or_else(|e| panic!("round trip failed: {e}\n{text}"));
    assert_eq!(&back, s, "round trip differs");
    assert_eq!(back.to_position_string(), text);
    assert_eq!(
        outcome::derive_outcome(s).as_ref(),
        s.outcome(),
        "outcome mismatch in {s}"
    );
    for seat in Seat::ALL {
        match s.status(seat) {
            SeatStatus::Removed => assert_eq!(
                s.pieces_of(seat).count(),
                0,
                "{seat} removed but has pieces"
            ),
            SeatStatus::Active => assert!(
                s.leader_count(seat) > 0,
                "{seat} ACTIVE without leader in {s}"
            ),
            _ => {}
        }
        if !s.status(seat).takes_turns() {
            assert!(s.ep_target(seat).is_none());
        }
        if s.status(seat) != SeatStatus::Active {
            assert!(s.castling_rights(seat).is_empty());
        }
    }
    if !s.is_over() {
        assert!(s.takes_turns(s.seat_to_move()));
        assert!(
            !legal_moves(s).is_empty(),
            "seat to move has no moves in {s}"
        );
    } else {
        assert!(legal_moves(s).is_empty());
    }
}
