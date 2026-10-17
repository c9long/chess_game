//! Shared test helpers.
#![allow(dead_code)]

use bot_engine::Rng;
use rules_core::*;

/// Move from notation.
pub fn mv(s: &str) -> Move {
    parse_move(s).unwrap()
}

/// Board field of a position string from tokens like `"sKg1"`.
pub fn board_field(pieces: &[&str]) -> String {
    let mut grid: [Option<(char, char)>; 256] = [None; 256];
    for p in pieces {
        let mut ch = p.chars();
        let seat = ch.next().unwrap();
        let kind = ch.next().unwrap();
        let square: Square = ch.as_str().parse().unwrap();
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

/// Builds a state; `rest` is everything after the board, e.g. `"S AAAA - - 0 0"`.
pub fn build(mode: &str, pieces: &[&str], rest: &str) -> GameState {
    let text = format!("{mode} {} {rest}", board_field(pieces));
    match parse_position(&text) {
        Ok(s) => s,
        Err(e) => panic!("bad test position {text}: {e}"),
    }
}

/// Whether `m` is exactly one of the generated legal moves (flag included).
pub fn is_generated(state: &GameState, m: Move) -> bool {
    legal_moves(state).contains(&m)
}

/// Random self-play positions (ongoing games only), `count` per mode.
pub fn random_positions(seed: u64, count: usize, max_plies: u32) -> Vec<GameState> {
    let mut rng = Rng::new(seed);
    let mut out = Vec::new();
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let mut produced = 0;
        while produced < count {
            let mut s = GameState::new(GameConfig::new(mode)).unwrap();
            let target = rng.below(u64::from(max_plies)) as u32;
            // Occasionally freeze/abandon a seat in Teams for variety.
            let freeze_at = if mode == GameMode::Teams && rng.below(3) == 0 {
                Some(rng.below(u64::from(target.max(1))) as u32)
            } else {
                None
            };
            for ply in 0..target {
                if s.is_over() {
                    break;
                }
                if Some(ply) == freeze_at {
                    let seat = s.seat_to_move();
                    apply_timeout(&mut s, seat).unwrap();
                    continue;
                }
                let moves = legal_moves(&s);
                // Prefer captures half of the time so games progress.
                let caps: Vec<Move> = moves
                    .iter()
                    .copied()
                    .filter(|m| s.piece_at(m.to).is_some())
                    .collect();
                let pool = if !caps.is_empty() && rng.below(2) == 0 {
                    &caps
                } else {
                    &moves
                };
                let m = pool[rng.below(pool.len() as u64) as usize];
                apply_move(&mut s, m).unwrap();
            }
            if !s.is_over() {
                out.push(s);
                produced += 1;
            }
        }
    }
    out
}
