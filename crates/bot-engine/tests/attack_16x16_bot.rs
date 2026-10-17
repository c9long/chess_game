//! Fuzz: the bot never returns an illegal move on the 16×16 board (rules
//! version 2), across levels, modes, the empty corners, promotions on the
//! new lines, en passant from the new start lines and castling.

mod common;

use bot_engine::{Level, choose_move};
use common::*;
use rules_core::*;

fn assert_bot_move_legal(s: &GameState, level: Level, seed: u64) -> Option<Move> {
    let res = choose_move(s, level, u64::MAX, 0, seed);
    let Some(m) = res.best_move else {
        assert!(s.is_over(), "no move but game not over: {s}");
        return None;
    };
    assert!(
        is_generated(s, m),
        "{level:?} returned {m} ({:?}) not in legal moves of {s}",
        m.flag
    );
    // The PV must start with the move and consist of legal moves.
    let mut c = s.clone();
    for pm in res.pv.iter().take(8) {
        if c.is_over() {
            break;
        }
        if !is_generated(&c, *pm) {
            // Only the first move is a hard contract; report others too.
            panic!("{level:?} PV contains illegal {pm} in {c} (root {s})");
        }
        apply_move(&mut c, *pm).unwrap();
    }
    Some(m)
}

#[test]
fn bots_only_play_legal_moves_in_full_games() {
    let levels = [Level::L600, Level::L900, Level::L1200, Level::L1500];
    for (g, mode) in [
        GameMode::Ffa,
        GameMode::Teams,
        GameMode::Ffa,
        GameMode::Teams,
    ]
    .into_iter()
    .enumerate()
    {
        let mut s = GameState::new(GameConfig::new(mode)).unwrap();
        let mut ply = 0u64;
        let cap = if cfg!(debug_assertions) { 32 } else { 120 };
        while !s.is_over() && ply < cap {
            let level = levels[(ply as usize + g) % levels.len()];
            let Some(m) = assert_bot_move_legal(&s, level, ply * 31 + g as u64) else {
                break;
            };
            apply_move(&mut s, m).unwrap();
            ply += 1;
        }
    }
}

#[test]
fn bots_handle_corners_promotion_ep_and_castling() {
    let positions = [
        // South pawn one step from rank 9, corners occupied.
        build(
            "ffa",
            &[
                "sKa1", "wKa16", "nKp16", "eKp1", "sPf8", "wNg9", "sNa2", "eRo1",
            ],
            "S AAAA - - 0 0",
        ),
        // West pawn about to promote on file i, with a capture option.
        build(
            "ffa",
            &["sKa1", "wKa16", "nKp16", "eKp1", "wPh3", "sBi4", "nQi2"],
            "W AAAA - - 0 0",
        ),
        // North promotes on rank 8.
        build(
            "teams",
            &["sKa1", "wKa16", "nKp16", "eKp1", "nPc9", "wRb8"],
            "N AAAA - - 0 0",
        ),
        // East promotes on file h.
        build(
            "teams",
            &["sKa1", "wKa16", "nKp16", "eKp1", "ePi14", "nNh13"],
            "E AAAA - - 0 0",
        ),
        // Castling available for South both sides, enemies near.
        build(
            "ffa",
            &[
                "sKi1", "sRe1", "sRl1", "sPh2", "wKa9", "wQd4", "nKi16", "eKp9", "eRm5",
            ],
            "S AAAA Se1,Sl1 - 0 0",
        ),
        // East castling both sides.
        build(
            "teams",
            &["sKi1", "wKa9", "nKi16", "eKp9", "eRp5", "eRp12", "sQk7"],
            "E AAAA Ep5,Ep12 - 0 0",
        ),
    ];
    for s in &positions {
        for level in Level::ALL {
            // Debug builds re-validate every search move, so keep them short.
            let heavy = matches!(level, Level::L2100 | Level::L2400);
            if matches!(level, Level::Max) || (cfg!(debug_assertions) && heavy) {
                continue;
            }
            for seed in 0..3 {
                assert_bot_move_legal(s, level, seed);
            }
        }
    }
    // En passant: South i2-i4, West h4 can capture onto i3 (promoting).
    let mut s = build(
        "ffa",
        &["sPi2", "wPh4", "sKa1", "wKa16", "nKp16", "eKp1"],
        "S AAAA - - 0 0",
    );
    apply_move(&mut s, parse_move("i2i4").unwrap()).unwrap();
    for level in [Level::L600, Level::L1200, Level::L1800] {
        for seed in 0..4 {
            assert_bot_move_legal(&s, level, seed);
        }
    }
    // En passant for North after West's b12-d12 (non-promoting).
    let mut s = build(
        "ffa",
        &["wPb12", "nPd13", "sKa1", "wKa16", "nKp16", "eKp1"],
        "W AAAA - - 0 0",
    );
    apply_move(&mut s, parse_move("b12d12").unwrap()).unwrap();
    for level in [Level::L600, Level::L1200, Level::L1800] {
        for seed in 0..4 {
            assert_bot_move_legal(&s, level, seed);
        }
    }
}
