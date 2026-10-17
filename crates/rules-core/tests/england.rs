//! England civ version 2: four Prime Ministers (letter `M`) replace the king,
//! queen and both knights. Expectations come from the rules text (docs/RULES.md
//! "Civilizations with special armies") and plain geometry, not from the
//! engine's own tables.

mod common;

use common::*;
use rules_core::*;

/// England (v2) in South, the standard army elsewhere.
const ENGLAND_SOUTH: &str = "civ=england.2,canada.1,canada.1,canada.1";

fn england_south(mode: GameMode) -> GameState {
    GameState::new(GameConfig::new(mode).with_civs([
        CivId::England,
        CivId::Canada,
        CivId::Canada,
        CivId::Canada,
    ]))
    .unwrap()
}

fn name(f: i32, r: i32) -> String {
    format!("{}{}", (b'a' + f as u8) as char, r + 1)
}

fn on(f: i32, r: i32) -> bool {
    (0..16).contains(&f) && (0..16).contains(&r)
}

const KNIGHT: [(i32, i32); 8] = [
    (1, 2),
    (2, 1),
    (2, -1),
    (1, -2),
    (-1, -2),
    (-2, -1),
    (-2, 1),
    (-1, 2),
];
const KING: [(i32, i32); 8] = [
    (0, 1),
    (1, 1),
    (1, 0),
    (1, -1),
    (0, -1),
    (-1, -1),
    (-1, 0),
    (-1, 1),
];

/// Destinations of a Prime Minister on (f, r) on an otherwise empty board,
/// from signed-integer geometry: knight leaps plus king steps.
fn pm_geometry(f: i32, r: i32) -> Vec<String> {
    let from = name(f, r);
    let mut v: Vec<String> = KNIGHT
        .iter()
        .chain(KING.iter())
        .filter(|&&(df, dr)| on(f + df, r + dr))
        .map(|&(df, dr)| format!("{from}{}", name(f + df, r + dr)))
        .collect();
    v.sort();
    v
}

fn moves_from(s: &GameState, from: &str) -> Vec<String> {
    let from = sq(from);
    let mut v: Vec<String> = legal_moves(s)
        .iter()
        .filter(|m| m.from == from)
        .map(|m| m.to_string())
        .collect();
    v.sort();
    v
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

#[test]
fn new_games_use_england_v2_with_four_prime_ministers() {
    let s = england_south(GameMode::Ffa);
    assert_eq!(
        s.config().civs[0],
        CivSpec {
            id: CivId::England,
            version: 2
        }
    );
    let pm = Some(Piece::new(PieceKind::PrimeMinister, Seat::South));
    for at in ["f1", "h1", "i1", "k1"] {
        assert_eq!(s.piece_at(sq(at)), pm, "{at}");
    }
    assert_eq!(s.piece_at(sq("e1")).unwrap().kind, PieceKind::Rook);
    assert_eq!(s.piece_at(sq("g1")).unwrap().kind, PieceKind::Bishop);
    assert_eq!(s.piece_at(sq("j1")).unwrap().kind, PieceKind::Bishop);
    assert_eq!(s.piece_at(sq("l1")).unwrap().kind, PieceKind::Rook);
    assert_eq!(s.piece_count(Seat::South, PieceKind::King), 0);
    assert_eq!(s.piece_count(Seat::South, PieceKind::Queen), 0);
    assert_eq!(s.piece_count(Seat::South, PieceKind::Knight), 0);
    assert_eq!(s.piece_count(Seat::South, PieceKind::Pawn), 8);
    assert_eq!(s.leader_count(Seat::South), 4);
    assert_eq!(
        s.leader_squares(Seat::South).collect::<Vec<_>>(),
        [sq("f1"), sq("h1"), sq("i1"), sq("k1")]
    );
    // England can't castle; the standard seats still can.
    assert!(s.castling_rights(Seat::South).is_empty());
    for seat in [Seat::West, Seat::North, Seat::East] {
        assert_eq!(s.castling_rights(seat), CastlingRights::BOTH);
        assert_eq!(s.leader_count(seat), 1);
    }
    check_invariants(&s);
}

#[test]
fn every_seat_can_be_england() {
    let s =
        GameState::new(GameConfig::new(GameMode::Teams).with_civs([CivId::England; 4])).unwrap();
    for (seat, squares) in [
        (Seat::South, ["f1", "h1", "i1", "k1"]),
        (Seat::West, ["a6", "a8", "a9", "a11"]),
        (Seat::North, ["f16", "h16", "i16", "k16"]),
        (Seat::East, ["p6", "p8", "p9", "p11"]),
    ] {
        let got: Vec<String> = s.leader_squares(seat).map(|q| q.to_string()).collect();
        assert_eq!(got, squares, "{seat}");
        assert!(s.castling_rights(seat).is_empty());
    }
    check_invariants(&s);
}

#[test]
fn england_v1_stays_the_standard_army() {
    let text = format!(
        "ffa {} S AAAA - - 0 0 civ=england.1,canada.1,canada.1,canada.1",
        board_field(&["sKi1", "wKa9", "nKi16", "eKp9"])
    );
    let s = parse_position(&text).unwrap();
    assert_eq!(s.civ(Seat::South).version, 1);
    assert_eq!(s.leader_count(Seat::South), 1);
    let mut c = GameConfig::new(GameMode::Ffa);
    c.civs[0] = CivSpec {
        id: CivId::England,
        version: 1,
    };
    let s = GameState::new(c).unwrap();
    assert_eq!(s.piece_at(sq("i1")).unwrap().kind, PieceKind::King);
    assert_eq!(s.castling_rights(Seat::South), CastlingRights::BOTH);
    assert_eq!(legal_moves(&s).len(), 30);
}

/// Depth 1 with England in South = 34, counted by hand:
/// * pawns e2–l2: a push and a double-step each = 16;
/// * rooks: e1 → a1, b1, c1, d1 and l1 → m1, n1, o1, p1 = 8;
/// * bishops g1 and j1 are boxed in by their own pawns = 0;
/// * Prime Ministers (king steps all blocked by own pieces):
///   f1 → d2, e3, g3 (h2 is its own pawn) = 3; h1 → g3, i3 = 2;
///   i1 → h3, j3 = 2; k1 → j3, l3, m2 (i2 is its own pawn) = 3; total 10.
///
/// 16 + 8 + 10 = 34. None of those moves reaches another army, so West,
/// North and East still have 30 each at depths 2–4: 34·30, 34·30², 34·30³.
#[test]
fn perft_from_start_with_england_south() {
    let s = england_south(GameMode::Ffa);
    let mut first = move_strings(&s);
    first.retain(|m| ["f1", "h1", "i1", "k1"].iter().any(|p| m.starts_with(p)));
    assert_eq!(
        first,
        [
            "f1d2", "f1e3", "f1g3", "h1g3", "h1i3", "i1h3", "i1j3", "k1j3", "k1l3", "k1m2"
        ]
    );
    assert_eq!(perft(&s, 1), 34);
    assert_eq!(perft(&s, 2), 34 * 30);
    assert_eq!(perft(&s, 3), 34 * 30 * 30);
    let t = england_south(GameMode::Teams);
    assert_eq!(perft(&t, 1), 34);
    assert_eq!(perft(&t, 2), 34 * 30);
}

#[test]
fn perft_with_four_englands() {
    // Every England seat has 34 opening moves, independent of the others.
    let s = GameState::new(GameConfig::new(GameMode::Ffa).with_civs([CivId::England; 4])).unwrap();
    assert_eq!(perft(&s, 1), 34);
    assert_eq!(perft(&s, 2), 34 * 34);
    assert_eq!(perft(&s, 3), 34 * 34 * 34);
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/// A lone Prime Minister on each of the 256 squares moves exactly like a
/// knight plus a king, with no wrap from file p to a or rank 16 to 1.
#[test]
fn prime_minister_on_every_square_matches_geometry() {
    // Other leaders parked on the far corners' neighbours, away from most squares.
    let others = ["wKf9", "nKj11", "eKk6"];
    for f in 0..16 {
        for r in 0..16 {
            let n = name(f, r);
            if others.iter().any(|o| o[2..] == n) {
                continue;
            }
            let mut pieces: Vec<String> = others.iter().map(|s| s.to_string()).collect();
            pieces.push(format!("sM{n}"));
            let refs: Vec<&str> = pieces.iter().map(|s| s.as_str()).collect();
            let s = build("ffa", &refs, &format!("S AAAA - - 0 0 {ENGLAND_SOUTH}"));
            let mut want = pm_geometry(f, r);
            // Landing on another seat's king is a capture: still a move.
            want.sort();
            assert_eq!(moves_from(&s, &n), want, "Prime Minister on {n}");
            assert_eq!(legal_moves(&s).len(), want.len(), "{n}");
        }
    }
}

#[test]
fn prime_minister_counts_centre_edge_corner() {
    let rest = format!("S AAAA - - 0 0 {ENGLAND_SOUTH}");
    let base = ["wKa16", "nKp16", "eKp15"];
    let count = |at: &str| {
        let mut p: Vec<String> = base.iter().map(|s| s.to_string()).collect();
        p.push(format!("sM{at}"));
        let refs: Vec<&str> = p.iter().map(|s| s.as_str()).collect();
        moves_from(&build("ffa", &refs, &rest), at).len()
    };
    assert_eq!(count("h8"), 16); // centre: 8 leaps + 8 steps
    assert_eq!(count("a1"), 2 + 3); // corner
    assert_eq!(count("p1"), 2 + 3); // other corner
    assert_eq!(count("b2"), 4 + 8); // next to the corner
    assert_eq!(count("h1"), 4 + 5); // bottom edge
    assert_eq!(count("a8"), 4 + 5); // left edge
    assert_eq!(count("p8"), 4 + 5); // right edge (no wrap to file a)
    assert_eq!(count("h16"), 4 + 5); // top edge (no wrap to rank 1)
    // Next to the North and East kings (p16, p15): capturing them counts.
    assert_eq!(count("o15"), 4 + 8);
}

#[test]
fn prime_minister_captures_and_is_blocked_like_knight_and_king() {
    // South PM h8; own pawn g8 (blocks a step), own rook j9 (blocks a leap),
    // North pawn i9 (capturable step), North knight f7 (capturable leap).
    let s = build(
        "ffa",
        &[
            "sMh8", "sMa1", "sPg8", "sRj9", "nPi9", "wKa16", "nNf7", "nKp16", "eKp1",
        ],
        &format!("S AAAA - - 0 0 {ENGLAND_SOUTH}"),
    );
    let got = moves_from(&s, "h8");
    for m in [
        "h8i9", "h8f7", "h8g9", "h8h9", "h8i8", "h8i7", "h8h7", "h8g7",
    ] {
        assert!(got.contains(&m.to_string()), "{m} missing from {got:?}");
    }
    assert!(!got.contains(&"h8g8".to_string()));
    assert!(!got.contains(&"h8j9".to_string()));
    // 8 steps - 1 own pawn + 8 leaps - 1 own rook = 14.
    assert_eq!(got.len(), 14, "{got:?}");
    let mut c = s.clone();
    let ev = play(&mut c, "h8f7");
    assert!(ev.iter().any(|e| matches!(
        e,
        GameEvent::Capture { captured, .. } if captured.kind == PieceKind::Knight
    )));
    assert!(matches!(
        ev[0],
        GameEvent::MoveMade {
            piece: PieceKind::PrimeMinister,
            ..
        }
    ));
    check_invariants(&c);
}

#[test]
fn prime_minister_attacks_like_knight_and_king() {
    let s = build(
        "ffa",
        &["sMh8", "wKa16", "nKp16", "eKp1"],
        &format!("S AAAA - - 0 0 {ENGLAND_SOUTH}"),
    );
    for t in ["g10", "i10", "j9", "j7", "i6", "g6", "f7", "f9"] {
        assert!(is_square_attacked_by(&s, sq(t), Seat::South), "leap {t}");
    }
    for t in ["g9", "h9", "i9", "i8", "i7", "h7", "g7", "g8"] {
        assert!(is_square_attacked_by(&s, sq(t), Seat::South), "step {t}");
    }
    for t in ["h10", "h6", "j8", "f8", "j10", "f6", "h8"] {
        assert!(!is_square_attacked_by(&s, sq(t), Seat::South), "{t}");
    }
}

#[test]
fn self_check_with_a_prime_minister_is_allowed() {
    // South PM i1 may step next to West's rook line.
    let s = build(
        "ffa",
        &["sMi1", "sMa1", "wRb3", "wKa16", "nKp16", "eKp1"],
        &format!("S AAAA - - 0 0 {ENGLAND_SOUTH}"),
    );
    assert!(is_legal(&s, "i1i2"));
    assert!(is_legal(&s, "i1h3")); // onto the rook's rank: attacked
    let mut c = s.clone();
    play(&mut c, "i1h3");
    assert!(leader_under_attack(&c, Seat::South));
    assert_eq!(attacked_leader_squares(&c, Seat::South), [sq("h3")]);
}

// ---------------------------------------------------------------------------
// Leaders and defeat
// ---------------------------------------------------------------------------

#[test]
fn check_warning_names_only_the_attacked_prime_ministers() {
    // West rook on rank 3 attacks the PM on c3 but not the ones on f1/k1.
    let s = build(
        "ffa",
        &["sMc3", "sMf1", "sMk1", "wRm3", "wKa16", "nKp16", "eKp1"],
        &format!("W AAAA - - 0 0 {ENGLAND_SOUTH}"),
    );
    assert!(leader_under_attack(&s, Seat::South));
    assert_eq!(attacked_leader_squares(&s, Seat::South), [sq("c3")]);
    assert!(attacked_leader_squares(&s, Seat::West).is_empty());
}

#[test]
fn ffa_capturing_prime_ministers_one_by_one_defeats_only_on_the_last() {
    // West's rook on the 3rd rank picks off South's Prime Ministers.
    let mut s = build(
        "ffa",
        &[
            "sMc3", "sMf3", "sMk1", "sMl1", "sPb2", "wRa3", "wKa16", "nKp16", "nPd15", "ePo10",
            "eKp1",
        ],
        &format!("W AAAA - - 0 0 {ENGLAND_SOUTH}"),
    );
    let ev = play(&mut s, "a3c3");
    assert!(
        !ev.iter().any(|e| matches!(e, GameEvent::Defeat { .. })),
        "first Prime Minister is not a defeat: {ev:?}"
    );
    assert_eq!(s.status(Seat::South), SeatStatus::Active);
    assert_eq!(s.leader_count(Seat::South), 3);
    check_invariants(&s);
    // North and East move, South shuffles a pawn, West takes the next one.
    play(&mut s, "d15d14");
    play(&mut s, "o10n10");
    play(&mut s, "b2b3");
    play(&mut s, "c3f3");
    assert_eq!(s.status(Seat::South), SeatStatus::Active);
    assert_eq!(s.leader_count(Seat::South), 2);
    // Put the remaining two in reach: take k1 via rank 1, then l1.
    play(&mut s, "d14d13");
    play(&mut s, "n10m10");
    play(&mut s, "b3b4");
    play(&mut s, "f3f1");
    play(&mut s, "d13d12");
    play(&mut s, "m10l10");
    play(&mut s, "k1j3"); // South moves one PM away; l1 still on the rank
    let ev = play(&mut s, "f1l1");
    assert!(!ev.iter().any(|e| matches!(e, GameEvent::Defeat { .. })));
    assert_eq!(s.leader_count(Seat::South), 1);
    assert_eq!(s.status(Seat::South), SeatStatus::Active);
    play(&mut s, "d12d11");
    play(&mut s, "l10k10");
    play(&mut s, "b4b5");
    // The rook reaches j3's file? Use the rank: l1 → l3, then capture j3.
    play(&mut s, "l1l3");
    play(&mut s, "d11d10");
    play(&mut s, "k10j10");
    // South keeps the PM where it is (self-check is legal).
    play(&mut s, "b5b6");
    let ev = play(&mut s, "l3j3");
    assert!(
        ev.contains(&GameEvent::Defeat {
            seat: Seat::South,
            reason: DefeatReason::LeaderCaptured
        }),
        "{ev:?}"
    );
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::South }));
    assert_eq!(s.status(Seat::South), SeatStatus::Removed);
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    check_invariants(&s);
}

#[test]
fn teams_last_prime_minister_captured_defeats_and_partner_plays_on() {
    // South (England) has one PM left; West captures it. South becomes
    // DEFEATED and keeps its pawn; North (partner) is still ACTIVE.
    let mut s = build(
        "teams",
        &["sMc3", "sPh4", "wRa3", "wKa16", "nKp16", "eKp1"],
        &format!("W AAAA - - 0 0 {ENGLAND_SOUTH}"),
    );
    let ev = play(&mut s, "a3c3");
    assert!(ev.contains(&GameEvent::Defeat {
        seat: Seat::South,
        reason: DefeatReason::LeaderCaptured
    }));
    assert_eq!(s.status(Seat::South), SeatStatus::Defeated);
    assert!(!s.is_over());
    check_invariants(&s);
}

#[test]
fn teams_defeated_englands_remaining_prime_ministers_are_ordinary_pieces() {
    // South (England) is DEFEATED (stalemated earlier) but still holds two
    // Prime Ministers. They move, they are not leaders any more: no warning,
    // and capturing them changes nothing.
    let mut s = build(
        "teams",
        &["sMc3", "sMh8", "wRa3", "wKa16", "nKp16", "eKp1"],
        &format!("W DAAA - - 0 0 def=Ss {ENGLAND_SOUTH}"),
    );
    assert!(!leader_under_attack(&s, Seat::South));
    assert!(attacked_leader_squares(&s, Seat::South).is_empty());
    let ev = play(&mut s, "a3c3");
    assert!(!ev.iter().any(|e| matches!(e, GameEvent::Defeat { .. })));
    assert_eq!(s.status(Seat::South), SeatStatus::Defeated);
    // North and East move, then South's last PM still moves as a piece.
    play(&mut s, "p16o16");
    play(&mut s, "p1o1");
    assert_eq!(s.seat_to_move(), Seat::South);
    assert_eq!(moves_from(&s, "h8").len(), 16);
    play(&mut s, "h8g10");
    check_invariants(&s);
}

#[test]
fn ffa_resigned_or_timed_out_england_is_removed_with_its_prime_ministers() {
    let mut s = england_south(GameMode::Ffa);
    let ev = apply_timeout(&mut s, Seat::South).unwrap();
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::South }));
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    let mut t = england_south(GameMode::Teams);
    apply_abandon(&mut t, Seat::South).unwrap();
    assert_eq!(t.status(Seat::South), SeatStatus::Frozen);
    // FROZEN England's PMs stay as blocking, capturable pieces.
    assert_eq!(t.piece_count(Seat::South, PieceKind::PrimeMinister), 4);
    assert!(!leader_under_attack(&t, Seat::South));
    check_invariants(&t);
}

// ---------------------------------------------------------------------------
// Castling and promotion
// ---------------------------------------------------------------------------

#[test]
fn england_never_castles() {
    // A Prime Minister on the leader home square with rooks at home and an
    // empty back line: still no castling move.
    let s = build(
        "ffa",
        &["sRe1", "sMi1", "sRl1", "sMa2", "wKa16", "nKp16", "eKp1"],
        &format!("S AAAA - - 0 0 {ENGLAND_SOUTH}"),
    );
    assert!(legal_moves(&s).iter().all(|m| m.flag != MoveFlag::Castle));
    assert!(!is_legal(&s, "i1k1"));
    assert!(!is_legal(&s, "i1g1"));
    // A position claiming a castling right for England is rejected.
    let text = format!(
        "ffa {} S AAAA Se1 - 0 0 {ENGLAND_SOUTH}",
        board_field(&["sRe1", "sMi1", "sRl1", "sMa2", "wKa16", "nKp16", "eKp1"])
    );
    let err = parse_position(&text).unwrap_err().to_string();
    assert!(err.contains("castling"), "{err}");
    // Even with only one PM left (others captured) England can't castle.
    let s = build(
        "ffa",
        &["sRe1", "sMi1", "sRl1", "wKa16", "nKp16", "eKp1"],
        &format!("S AAAA - - 0 0 {ENGLAND_SOUTH}"),
    );
    assert!(legal_moves(&s).iter().all(|m| m.flag != MoveFlag::Castle));
}

#[test]
fn england_pawns_promote_to_q_r_b_n_but_never_a_prime_minister() {
    // South pawn h8 → h9 (South's promotion line is rank 9).
    let s = build(
        "ffa",
        &["sPh8", "sMa1", "wKa16", "nKp16", "eKp1"],
        &format!("S AAAA - - 0 0 {ENGLAND_SOUTH}"),
    );
    let promos: Vec<Option<PieceKind>> = legal_moves(&s)
        .iter()
        .filter(|m| m.from == sq("h8"))
        .map(|m| m.promotion)
        .collect();
    assert_eq!(
        promos,
        [
            Some(PieceKind::Knight),
            Some(PieceKind::Bishop),
            Some(PieceKind::Rook),
            Some(PieceKind::Queen)
        ]
    );
    assert!(!is_legal(&s, "h8h9m"));
    assert!(!is_legal(&s, "h8h9k"));
    assert!(matches!(
        apply_move(&mut s.clone(), mv("h8h9m")),
        Err(RulesError::IllegalMove(_))
    ));
    let mut c = s.clone();
    play(&mut c, "h8h9q");
    assert_eq!(
        c.piece_at(sq("h9")),
        Some(Piece::new(PieceKind::Queen, Seat::South))
    );
    // The promoted queen is an ordinary piece, not a leader.
    assert_eq!(c.leader_count(Seat::South), 1);
    let mut c = s.clone();
    play(&mut c, "h8h9n");
    assert_eq!(c.piece_count(Seat::South, PieceKind::Knight), 1);
    check_invariants(&c);
}

// ---------------------------------------------------------------------------
// Text formats
// ---------------------------------------------------------------------------

#[test]
fn position_string_round_trip_with_prime_ministers() {
    let mut s = england_south(GameMode::Ffa);
    play(&mut s, "f1e3");
    let text = s.to_position_string();
    // Rank 1 after f1e3: R _ B M M B M R; the PM stands on e3.
    assert!(text.contains("/4sR1sBsMsMsBsMsR4 "), "{text}");
    assert!(text.contains("/4sM11/"), "{text}");
    assert!(
        text.contains("civ=england.2,canada.1,canada.1,canada.1"),
        "{text}"
    );
    let back = parse_position(&text).unwrap();
    assert_eq!(back, s);
    assert_eq!(back.to_position_string(), text);
    check_invariants(&s);
    // The start rank is R M B M M B M R.
    let start = england_south(GameMode::Ffa).to_position_string();
    assert!(start.contains("/4sRsMsBsMsMsBsMsR4 "), "{start}");
}

#[test]
fn rosters_are_enforced_by_position_strings() {
    // A king for England v2, or a Prime Minister for a standard civ, is rejected.
    let bad_king = format!(
        "ffa {} S AAAA - - 0 0 {ENGLAND_SOUTH}",
        board_field(&["sKi1", "wKa16", "nKp16", "eKp1"])
    );
    assert!(parse_position(&bad_king).is_err());
    let bad_pm = format!(
        "ffa {} S AAAA - - 0 0",
        board_field(&["sMi1", "wKa16", "nKp16", "eKp1"])
    );
    assert!(parse_position(&bad_pm).is_err());
    // England v2 may hold promoted queens and knights.
    let ok = format!(
        "ffa {} S AAAA - - 0 0 {ENGLAND_SOUTH}",
        board_field(&["sMi1", "sQd4", "sNe5", "wKa16", "nKp16", "eKp1"])
    );
    assert!(parse_position(&ok).is_ok());
    // An ACTIVE England with no Prime Minister is impossible.
    let none = format!(
        "ffa {} S AAAA - - 0 0 {ENGLAND_SOUTH}",
        board_field(&["sQd4", "wKa16", "nKp16", "eKp1"])
    );
    assert!(parse_position(&none).is_err());
    // Unknown England version.
    let v3 = format!(
        "ffa {} S AAAA - - 0 0 civ=england.3,canada.1,canada.1,canada.1",
        board_field(&["sMi1", "wKa16", "nKp16", "eKp1"])
    );
    assert!(parse_position(&v3).is_err());
}

#[test]
fn notation_parses_m_as_a_promotion_letter_but_it_is_never_legal() {
    let m = parse_move("h8h9m").unwrap();
    assert_eq!(m.promotion, Some(PieceKind::PrimeMinister));
    assert_eq!(m.to_string(), "h8h9m");
}

#[test]
fn random_games_with_england_keep_invariants() {
    // Deterministic pseudo-random playouts with England in every seat
    // combination; every state must stay consistent and leaders must match.
    let mut seed = 0x1234_5678_9abc_def0_u64;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let configs = [
        [CivId::England, CivId::Canada, CivId::Japan, CivId::Mali],
        [CivId::Canada, CivId::England, CivId::England, CivId::Usa],
        [CivId::England; 4],
    ];
    for mode in [GameMode::Ffa, GameMode::Teams] {
        for civs in configs {
            for _ in 0..4 {
                let mut s = GameState::new(GameConfig::new(mode).with_civs(civs)).unwrap();
                for _ in 0..400 {
                    if s.is_over() {
                        break;
                    }
                    let moves = legal_moves(&s);
                    let m = moves[(next() % moves.len() as u64) as usize];
                    let before = s.clone();
                    apply_move(&mut s, m).unwrap();
                    for seat in Seat::ALL {
                        if civs[seat.index()] == CivId::England {
                            assert_eq!(s.piece_count(seat, PieceKind::King), 0);
                            // PMs never increase (no promotion to a PM).
                            assert!(
                                s.piece_count(seat, PieceKind::PrimeMinister)
                                    <= before.piece_count(seat, PieceKind::PrimeMinister)
                            );
                            assert!(s.castling_rights(seat).is_empty());
                        }
                    }
                }
                check_invariants(&s);
            }
        }
    }
}
