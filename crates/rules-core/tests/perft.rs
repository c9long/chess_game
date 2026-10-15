//! Perft (move-tree leaf counts).

mod common;

use rules_core::*;

fn start(mode: GameMode) -> GameState {
    GameState::new(GameConfig::new(mode)).unwrap()
}

/// Depth 1 = 28 (see `south_first_moves_hand_verified` in tests/rules.rs:
/// 16 pawn pushes + 2 corner-pawn captures c2xb3/j2xk3 + 6 knight moves +
/// 4 rook moves).
///
/// Depth 2 = 777, by hand: West has 28 replies to most South moves (b3..b10
/// pushes 16, b3xc2 and b10xc11 2, knights a4/a9 3+3, rooks a3/a10 2+2).
/// South moves that change West's count:
/// * c2c3: blocks b3's push and double-step, removes b3xc2, adds b4xc3 → 26
/// * c2c4: removes b3xc2 and b4's push/double-step; adds b3xc4, b5xc4 and
///   en passant b4xc3 → 28
/// * c2b3: removes West's b3 pawn (3 moves); adds a3xb3 → 26
/// * d2d3 / d2d4: block b3's / b4's double-step → 27 each
/// * d1c3: blocks b3's push and double-step; adds b4xc3 → 27
///
/// All other 22 moves → 28. Total = 22·28 + 26 + 28 + 26 + 27 + 27 + 27 = 777.
#[test]
fn perft_start_ffa() {
    let s = start(GameMode::Ffa);
    assert_eq!(perft(&s, 1), 28);
    assert_eq!(perft(&s, 2), 777);
    assert_eq!(perft(&s, 3), 21_560);
}

#[test]
fn perft_start_teams() {
    // Identical to FFA until partners' pieces can interact (depth 5+).
    let s = start(GameMode::Teams);
    assert_eq!(perft(&s, 1), 28);
    assert_eq!(perft(&s, 2), 777);
    assert_eq!(perft(&s, 3), 21_560);
}

#[test]
fn perft_divide_sums_to_perft() {
    let s = start(GameMode::Ffa);
    let div = perft_divide(&s, 2);
    assert_eq!(div.len(), 28);
    assert_eq!(div.iter().map(|(_, n)| n).sum::<u64>(), 777);
    let get = |m: &str| div.iter().find(|(mv, _)| mv.to_string() == m).unwrap().1;
    assert_eq!(get("c2c3"), 26);
    assert_eq!(get("c2c4"), 28);
    assert_eq!(get("c2b3"), 26);
    assert_eq!(get("d2d3"), 27);
    assert_eq!(get("d2d4"), 27);
    assert_eq!(get("d1c3"), 27);
    assert_eq!(get("e2e4"), 28);
}

/// Deeper counts; slow in debug builds. Run with
/// `cargo test --release --test perft -- --ignored`.
#[test]
#[ignore]
fn perft_start_deep() {
    assert_eq!(perft(&start(GameMode::Ffa), 4), 592_802);
    assert_eq!(perft(&start(GameMode::Teams), 4), 592_802);
    assert_eq!(perft(&start(GameMode::Ffa), 5), 18_105_934);
    assert_eq!(perft(&start(GameMode::Teams), 5), 18_084_094);
}

/// Teams: North DEFEATED and boxed in (passes every turn), East FROZEN
/// (skipped), so play alternates West, South, West, ...
///
/// Depth 1: West's king a7 → a6, a8, b6, b7, b8 = 5.
/// Depth 2: after each, North passes, East is skipped and South moves:
/// K g1 5, N b10 5 (c12 d11 d9 c8 a8), B c10 13 (d11 e12; b9 a8; d9..l1),
/// R a10 down the a-file to West's king: 4 (Ka6), 2 (Ka8), 9 (Kb6/b7/b8).
/// = (23+4) + (23+2) + 3·(23+9) = 148.
#[test]
fn perft_with_passing_and_frozen_seats() {
    let s = common::build(
        "teams",
        &[
            "nKa12", "nBb12", "nPa11", "nPb11", "nPc11", "sRa10", "sNb10", "sBc10", "sKg1", "wKa7",
            "eKl7",
        ],
        "W AADF - - 0 0 def=Ns,Et",
    );
    assert_eq!(perft(&s, 1), 5);
    assert_eq!(perft(&s, 2), 148);
    // Regression values (computed by the engine, cross-checked by the
    // reference generator in tests/fuzz.rs).
    assert_eq!(perft(&s, 3), 1_008);
    assert_eq!(perft(&s, 4), 6_958);
}

/// FFA: South is boxed in and is stalemated (and removed) whenever East's
/// reply leaves its blockers on b5 and d3.
///
/// Depth 1: East K 5 + R b5 19 (b4, b6..b12, a5, c5..l5) + N d3 8 = 32.
///
/// Depth 2 = 69, by hand:
/// * 5 king moves: South is stalemated and removed, West's king has 5 → 25
/// * Rxb4: South Bxb4 → 1
/// * R b6..b12: South b4b5 → 7 × 1 = 7
/// * Ra5: b4b5, b4xa5 → 2; Rc5: b4b5, b4xc5 → 2; R d5..l5: b4b5 → 8 × 1
/// * knight moves free d2 (d2d3, d2d4): Ne5/Nf4/Nf2/Ne1 → 2 each; Nc5 → 3
///   (b4xc5); Nxc1 → 3 (Rxc1); Nxb4 → 3 (Bxb4); Nxb2 → 6 (K, R, B, B take b2)
///
/// = 25 + 1 + 7 + 2 + 2 + 8 + 8 + 3 + 3 + 3 + 6 = 69.
#[test]
fn perft_through_stalemate() {
    let s = common::build(
        "ffa",
        &[
            "sKa1", "sRb1", "sBc1", "sBa3", "sPa2", "sPb2", "sPb3", "sPb4", "sPd2", "eRb5", "eNd3",
            "eKl7", "wKa7", "nKg12",
        ],
        "E AAAA - - 0 0",
    );
    assert_eq!(perft(&s, 1), 32);
    assert_eq!(perft(&s, 2), 69);
    assert_eq!(perft(&s, 3), 345);
}
