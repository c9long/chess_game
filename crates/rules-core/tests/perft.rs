//! Perft (move-tree leaf counts).

mod common;

use rules_core::*;

fn start(mode: GameMode) -> GameState {
    GameState::new(GameConfig::new(mode)).unwrap()
}

/// Depth 1 = 30, by hand (also `south_first_moves_hand_verified` in
/// tests/rules.rs): South's 8 pawns have a push and a double-step each (16);
/// each knight has 3 moves, two forward and one sideways into the empty
/// margin (f1: d2, e3, g3; k1: j3, l3, m2) (6); each rook slides along rank 1
/// into the empty corner (e1: a1..d1; l1: m1..p1) (8); bishops, queen and
/// king are boxed in by their own pawns. 16 + 6 + 8 = 30.
///
/// Every army's opening moves stay inside its own region (back line, pawn
/// line and the empty margins/corners next to it): no first move can block,
/// unblock or attack another army's piece. The only touch point is a corner
/// square: South's rook may reach a1 or p1, where West's or East's rook can
/// then capture instead of moving there — the same number of moves. So each
/// of the first four seats always has exactly 30 moves:
/// depth 2 = 30², depth 3 = 30³, depth 4 = 30⁴. South's second move (depth 5)
/// is the first that depends on earlier moves (its own opened lines, and in
/// FFA a capture of a North knight that reached d15 or m15).
#[test]
fn perft_start_ffa() {
    let s = start(GameMode::Ffa);
    assert_eq!(perft(&s, 1), 30);
    assert_eq!(perft(&s, 2), 900);
    assert_eq!(perft(&s, 3), 27_000);
}

#[test]
fn perft_start_teams() {
    // Identical to FFA until partners' pieces can interact (depth 5+).
    let s = start(GameMode::Teams);
    assert_eq!(perft(&s, 1), 30);
    assert_eq!(perft(&s, 2), 900);
    assert_eq!(perft(&s, 3), 27_000);
}

#[test]
fn perft_divide_sums_to_perft() {
    let s = start(GameMode::Ffa);
    let div = perft_divide(&s, 2);
    assert_eq!(div.len(), 30);
    assert_eq!(div.iter().map(|(_, n)| n).sum::<u64>(), 900);
    // West's 30 replies never depend on South's first move.
    assert!(div.iter().all(|&(_, n)| n == 30), "{div:?}");
    let get = |m: &str| div.iter().find(|(mv, _)| mv.to_string() == m).unwrap().1;
    assert_eq!(get("e2e4"), 30);
    assert_eq!(get("f1d2"), 30);
    assert_eq!(get("e1a1"), 30);
}

/// Deeper counts; slow in debug builds. Run with
/// `cargo test --release --test perft -- --ignored`.
#[test]
#[ignore]
fn perft_start_deep() {
    assert_eq!(perft(&start(GameMode::Ffa), 4), 810_000);
    assert_eq!(perft(&start(GameMode::Teams), 4), 810_000);
    assert_eq!(perft(&start(GameMode::Ffa), 5), 28_561_080);
    assert_eq!(perft(&start(GameMode::Teams), 5), 28_557_360);
}

/// Teams: North DEFEATED and boxed in (passes every turn), East FROZEN
/// (skipped), so play alternates West, South, West, ...
///
/// Depth 1: West's king a7 → a6, a8, b6, b7, b8 = 5.
/// Depth 2: after each, North passes, East is skipped and South moves:
/// K g1 5, N b14 5 (c16 d15 d13 c12 a12), B c14 17 (d15 e16; b13 a12;
/// d13..p1), R a14 down the a-file to West's king: 8 (Ka6), 6 (Ka8),
/// 13 (Kb6/b7/b8). = (27+8) + (27+6) + 3·(27+13) = 188.
#[test]
fn perft_with_passing_and_frozen_seats() {
    let s = common::build(
        "teams",
        &[
            "nKa16", "nBb16", "nPa15", "nPb15", "nPc15", "sRa14", "sNb14", "sBc14", "sKg1", "wKa7",
            "eKl7",
        ],
        "W AADF - - 0 0 def=Ns,Et",
    );
    assert_eq!(perft(&s, 1), 5);
    assert_eq!(perft(&s, 2), 188);
    // Regression values (computed by the engine, cross-checked by the
    // reference generator in tests/fuzz.rs).
    assert_eq!(perft(&s, 3), 1_290);
    assert_eq!(perft(&s, 4), 8_922);
}

/// FFA: South is boxed in and is stalemated (and removed) whenever East's
/// reply leaves its blockers on b5 and d3.
///
/// Depth 1: East K p7 5 + R b5 27 (b4, b6..b16, a5, c5..p5) + N d3 8 = 40.
///
/// Depth 2 = 77, by hand:
/// * 5 king moves: South is stalemated and removed, West's king has 5 → 25
/// * Rxb4: South Bxb4 → 1
/// * R b6..b16: South b4b5 → 11 × 1 = 11
/// * Ra5: b4b5, b4xa5 → 2; Rc5: b4b5, b4xc5 → 2; R d5..p5: b4b5 → 13 × 1
/// * knight moves free d2 (d2d3, d2d4): Ne5/Nf4/Nf2/Ne1 → 2 each; Nc5 → 3
///   (b4xc5); Nxc1 → 3 (Rxc1); Nxb4 → 3 (Bxb4); Nxb2 → 6 (K, R, B, B take b2)
///
/// = 25 + 1 + 11 + 2 + 2 + 13 + 8 + 3 + 3 + 3 + 6 = 77.
#[test]
fn perft_through_stalemate() {
    let s = common::build(
        "ffa",
        &[
            "sKa1", "sRb1", "sBc1", "sBa3", "sPa2", "sPb2", "sPb3", "sPb4", "sPd2", "eRb5", "eNd3",
            "eKp7", "wKa7", "nKg12",
        ],
        "E AAAA - - 0 0",
    );
    assert_eq!(perft(&s, 1), 40);
    assert_eq!(perft(&s, 2), 77);
    assert_eq!(perft(&s, 3), 460);
}
