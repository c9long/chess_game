//! Spec-derived adversarial tests for the 16×16 board (rules version 2).
//!
//! Every expectation here is written from the spec (PLAN §2 / the overnight
//! decisions) or from plain signed-integer geometry, never from rules-core's
//! own tables, so a wrong table or an off-board wrap bug shows up as a diff.

mod common;

use common::*;
use rules_core::*;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn name(f: i32, r: i32) -> String {
    format!("{}{}", (b'a' + f as u8) as char, r + 1)
}

fn on(f: i32, r: i32) -> bool {
    (0..16).contains(&f) && (0..16).contains(&r)
}

fn sqfr(f: i32, r: i32) -> Square {
    Square::from_coords(f as u8, r as u8).unwrap()
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v.dedup();
    v
}

fn moves_from(s: &GameState, from: Square) -> Vec<String> {
    sorted(
        legal_moves(s)
            .iter()
            .filter(|m| m.from == from)
            .map(|m| m.to_string())
            .collect(),
    )
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
/// Prime Minister: knight leaps plus king steps.
const PRIME_MINISTER: [(i32, i32); 16] = [
    (1, 2),
    (2, 1),
    (2, -1),
    (1, -2),
    (-1, -2),
    (-2, -1),
    (-2, 1),
    (-1, 2),
    (0, 1),
    (1, 1),
    (1, 0),
    (1, -1),
    (0, -1),
    (-1, -1),
    (-1, 0),
    (-1, 1),
];
const ORTHO: [(i32, i32); 4] = [(0, 1), (1, 0), (0, -1), (-1, 0)];
const DIAG: [(i32, i32); 4] = [(1, 1), (1, -1), (-1, -1), (-1, 1)];

/// Targets a non-pawn piece of `seat` on (f, r) could move to, from geometry.
fn geometric_targets(s: &GameState, seat: Seat, kind: PieceKind, f: i32, r: i32) -> Vec<String> {
    let mut out = Vec::new();
    let from = name(f, r);
    let try_add = |tf: i32, tr: i32, out: &mut Vec<String>| -> bool {
        if !on(tf, tr) {
            return false;
        }
        match s.piece_at(sqfr(tf, tr)) {
            None => {
                out.push(format!("{from}{}", name(tf, tr)));
                true
            }
            Some(p) => {
                if s.is_opponent(seat, p.owner) {
                    out.push(format!("{from}{}", name(tf, tr)));
                }
                false
            }
        }
    };
    type Offsets = &'static [(i32, i32)];
    let (steps, rays): (Offsets, Offsets) = match kind {
        PieceKind::Knight => (&KNIGHT, &[]),
        PieceKind::King => (&KING, &[]),
        PieceKind::PrimeMinister => (&PRIME_MINISTER, &[]),
        PieceKind::Bishop => (&[], &DIAG),
        PieceKind::Rook => (&[], &ORTHO),
        PieceKind::Queen => (&[], &KING),
        PieceKind::Pawn => unreachable!(),
    };
    for &(df, dr) in steps {
        try_add(f + df, r + dr, &mut out);
    }
    for &(df, dr) in rays {
        let (mut tf, mut tr) = (f + df, r + dr);
        while try_add(tf, tr, &mut out) {
            tf += df;
            tr += dr;
        }
    }
    sorted(out)
}

/// Squares a piece on (f, r) attacks (geometry; target occupancy ignored,
/// sliders stop at the first piece).
fn geometric_attacks(
    s: &GameState,
    seat: Seat,
    kind: PieceKind,
    f: i32,
    r: i32,
) -> Vec<(i32, i32)> {
    let mut out = Vec::new();
    match kind {
        PieceKind::Pawn => {
            let (fx, fy) = seat.forward();
            let (fx, fy) = (fx as i32, fy as i32);
            let diag = if fx == 0 {
                [(-1, fy), (1, fy)]
            } else {
                [(fx, -1), (fx, 1)]
            };
            for (df, dr) in diag {
                if on(f + df, r + dr) {
                    out.push((f + df, r + dr));
                }
            }
        }
        PieceKind::Knight | PieceKind::King | PieceKind::PrimeMinister => {
            let steps: &[(i32, i32)] = match kind {
                PieceKind::Knight => &KNIGHT,
                PieceKind::King => &KING,
                _ => &PRIME_MINISTER,
            };
            for &(df, dr) in steps {
                if on(f + df, r + dr) {
                    out.push((f + df, r + dr));
                }
            }
        }
        _ => {
            let rays: &[(i32, i32)] = match kind {
                PieceKind::Bishop => &DIAG,
                PieceKind::Rook => &ORTHO,
                _ => &KING,
            };
            for &(df, dr) in rays {
                let (mut tf, mut tr) = (f + df, r + dr);
                while on(tf, tr) {
                    out.push((tf, tr));
                    if s.piece_at(sqfr(tf, tr)).is_some() {
                        break;
                    }
                    tf += df;
                    tr += dr;
                }
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Setup squares and colours
// ---------------------------------------------------------------------------

#[test]
fn setup_matches_spec_table_exactly() {
    let s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    // Spec table, typed out by hand.
    let spec: [(char, &[&str]); 4] = [
        (
            's',
            &["e1R", "f1N", "g1B", "h1Q", "i1K", "j1B", "k1N", "l1R"],
        ),
        (
            'n',
            &[
                "e16R", "f16N", "g16B", "h16Q", "i16K", "j16B", "k16N", "l16R",
            ],
        ),
        (
            'w',
            &["a5R", "a6N", "a7B", "a8Q", "a9K", "a10B", "a11N", "a12R"],
        ),
        (
            'e',
            &["p5R", "p6N", "p7B", "p8Q", "p9K", "p10B", "p11N", "p12R"],
        ),
    ];
    let mut expected: Vec<(String, Piece)> = Vec::new();
    for (seat_c, back) in spec {
        let seat = Seat::from_letter(seat_c).unwrap();
        for e in back {
            let (sqs, k) = e.split_at(e.len() - 1);
            let kind = PieceKind::from_letter(k.chars().next().unwrap()).unwrap();
            expected.push((sqs.to_string(), Piece::new(kind, seat)));
        }
    }
    for f in "efghijkl".chars() {
        expected.push((format!("{f}2"), Piece::new(PieceKind::Pawn, Seat::South)));
        expected.push((format!("{f}15"), Piece::new(PieceKind::Pawn, Seat::North)));
    }
    for r in 5..=12 {
        expected.push((format!("b{r}"), Piece::new(PieceKind::Pawn, Seat::West)));
        expected.push((format!("o{r}"), Piece::new(PieceKind::Pawn, Seat::East)));
    }
    assert_eq!(expected.len(), 64);
    for f in 0..16 {
        for r in 0..16 {
            let n = name(f, r);
            let want = expected.iter().find(|(s2, _)| *s2 == n).map(|(_, p)| *p);
            assert_eq!(s.piece_at(sq(&n)), want, "{n}");
        }
    }
    // Colours with arithmetic: a1 = (0,0) dark; light iff (file+rank) odd.
    let light = |n: &str| {
        let q = sq(n);
        (q.file() as u32 + q.rank() as u32) % 2 == 1
    };
    assert!(!light("a1"));
    // h1 = 7+0 = 7 odd: light. a8 = 0+7: light. h16 = 7+15 = 22: dark.
    // p8 = 15+7 = 22: dark.
    assert!(light("h1") && light("a8"));
    assert!(!light("h16") && !light("p8"));
    for n in [
        "a1", "h1", "a8", "h16", "p8", "i1", "a9", "i16", "p9", "p16", "p1", "a16",
    ] {
        assert_eq!(sq(n).is_light(), light(n), "{n}");
    }
    // Kings sit on the opposite colour to their own queen.
    for (q, k) in [("h1", "i1"), ("a8", "a9"), ("h16", "i16"), ("p8", "p9")] {
        assert_ne!(light(q), light(k));
    }
    // The four 4×4 corners are empty.
    for f in (0..4).chain(12..16) {
        for r in (0..4).chain(12..16) {
            assert!(s.piece_at(sqfr(f, r)).is_none(), "{}", name(f, r));
        }
    }
}

#[test]
fn setup_square_index_math() {
    // file + 16*rank, no overflow at the top edge.
    assert_eq!(sq("a1").to_u8(), 0);
    assert_eq!(sq("p1").to_u8(), 15);
    assert_eq!(sq("a2").to_u8(), 16);
    assert_eq!(sq("a16").to_u8(), 240);
    assert_eq!(sq("p16").to_u8(), 255);
    assert_eq!(sq("p16").index(), 255);
    assert_eq!(Square::all().count(), 256);
    assert_eq!(
        Square::all().map(|s| s.index()).sum::<usize>(),
        255 * 256 / 2
    );
    // Offsets at the far edges never wrap or overflow.
    let p16 = sq("p16");
    assert_eq!(p16.offset(1, 0), None);
    assert_eq!(p16.offset(0, 1), None);
    assert_eq!(p16.offset(1, 1), None);
    assert_eq!(p16.offset(-15, -15), Some(sq("a1")));
    assert_eq!(sq("p8").offset(1, 0), None);
    assert_eq!(sq("a9").offset(-1, 0), None);
    assert_eq!(sq("p8").offset(1, 1), None);
    assert_eq!(sq("a1").offset(-1, 1), None);
    assert_eq!(sq("a1").offset(i8::MAX, 0), None);
    assert_eq!(sq("a1").offset(0, i8::MIN), None);
    for s in Square::all() {
        for df in -20i8..=20 {
            for dr in -20i8..=20 {
                let (f, r) = (s.file() as i32 + df as i32, s.rank() as i32 + dr as i32);
                let want = if on(f, r) { Some(sqfr(f, r)) } else { None };
                assert_eq!(s.offset(df, dr), want, "{s} + ({df},{dr})");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Corners and wrap-around
// ---------------------------------------------------------------------------

/// Exhaustive: each non-pawn kind on each of the 256 squares on a near-empty
/// board, compared with signed-integer geometry. Catches any table or ray
/// that wraps from file p to file a or from rank 16 to rank 1.
#[test]
fn every_piece_on_every_square_matches_geometry() {
    // Kings placed in the board middle so the corners stay free.
    let kings = ["wKf9", "nKj11", "eKk6"];
    for kind in [
        PieceKind::Knight,
        PieceKind::Bishop,
        PieceKind::Rook,
        PieceKind::Queen,
        PieceKind::King,
    ] {
        for f in 0..16 {
            for r in 0..16 {
                let n = name(f, r);
                if kings.iter().any(|k| k[2..] == n) {
                    continue;
                }
                let me = format!("s{}{n}", kind.letter());
                let mut pieces: Vec<String> = kings.iter().map(|s| s.to_string()).collect();
                pieces.push(me);
                if kind != PieceKind::King {
                    // South's king somewhere not on this square.
                    let k = if n == "h8" { "sKg7" } else { "sKh8" };
                    pieces.push(k.to_string());
                }
                let refs: Vec<&str> = pieces.iter().map(|s| s.as_str()).collect();
                let s = build("ffa", &refs, "S AAAA - - 0 0");
                let engine = moves_from(&s, sq(&n));
                let geo = geometric_targets(&s, Seat::South, kind, f, r);
                assert_eq!(engine, geo, "{kind:?} on {n}");
            }
        }
    }
}

#[test]
fn corner_extremes_counts() {
    // Knight on each corner: exactly 2 moves; on b2-like squares: 4.
    for (c, k) in [
        ("a1", 2),
        ("p1", 2),
        ("a16", 2),
        ("p16", 2),
        ("b2", 4),
        ("o15", 4),
    ] {
        let s = build(
            "ffa",
            &[&format!("sN{c}"), "sKh8", "wKf9", "nKj11", "eKk6"],
            "S AAAA - - 0 0",
        );
        assert_eq!(moves_from(&s, sq(c)).len(), k, "knight {c}");
    }
    // Queen on p16, empty lines: 15 + 15 + 15 = 45.
    let s = build(
        "ffa",
        &["sQp16", "sKh9", "wKc5", "nKl3", "eKn4"],
        "S AAAA - - 0 0",
    );
    // n4 (13,3) blocks? not on p16's lines (diag from p16: o15 .. a1, n14...).
    assert_eq!(moves_from(&s, sq("p16")).len(), 45);
}

#[test]
fn start_position_corner_squares_are_playable() {
    let mut s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    // South rook e1 slides into the empty corner, all the way to a1.
    let r = moves_from(&s, sq("e1"));
    assert_eq!(
        r,
        sorted(vec![
            "e1a1".into(),
            "e1b1".into(),
            "e1c1".into(),
            "e1d1".into()
        ])
    );
    play(&mut s, "e1a1"); // S
    play(&mut s, "a5a4"); // W rook a5-a4
    play(&mut s, "e16a16"); // N into its corner
    play(&mut s, "p12p16"); // E rook p12 up to p16 corner
    // South rook a1 can go up to a3 (W rook on a4 is capturable).
    let m = moves_from(&s, sq("a1"));
    assert!(m.contains(&"a1a4".to_string()), "{m:?}");
    assert!(!m.contains(&"a1a5".to_string()));
    check_invariants(&s);
}

// ---------------------------------------------------------------------------
// Pawns: double step, promotion lines, en passant
// ---------------------------------------------------------------------------

#[test]
fn start_position_pawn_moves_all_seats() {
    let mut s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    for (seat_moves, play_mv) in [
        (vec!["e2e3", "e2e4"], "e2e4"),
        (vec!["b5c5", "b5d5"], "b5d5"),
        (vec!["e15e14", "e15e13"], "e15e13"),
        (vec!["o5n5", "o5m5"], "o5m5"),
    ] {
        let from = parse_move(seat_moves[0]).unwrap().from;
        assert_eq!(
            moves_from(&s, from),
            sorted(seat_moves.iter().map(|s| s.to_string()).collect())
        );
        let ev = play(&mut s, play_mv);
        match ev[0] {
            GameEvent::MoveMade { mv, .. } => assert_eq!(mv.flag, MoveFlag::DoubleStep),
            _ => panic!(),
        }
    }
    // Each army has exactly 30 opening moves: 16 pawn + 3+3 knight + 4+4 rook.
    let s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    for seat in Seat::ALL {
        let mut buf = Vec::new();
        generate_moves_for_seat(&s, seat, &mut buf);
        assert_eq!(buf.len(), 30, "{seat}");
    }
}

/// (seat, square one step before the promotion line, promotion square,
/// a square two before) for each seat.
#[test]
fn promotion_lines_all_four_seats() {
    // Kings parked out of the way.
    let kings = ["sKa1", "wKa16", "nKp16", "eKp1"];
    let cases = [
        ('S', "s", "f8", "f9", "f7"),
        ('W', "w", "h3", "i3", "g3"),
        ('N', "n", "f9", "f8", "f10"),
        ('E', "e", "i3", "h3", "j3"),
    ];
    for (to_move, letter, before, promo, two_before) in cases {
        let mut pieces: Vec<String> = kings.iter().map(|s| s.to_string()).collect();
        pieces.push(format!("{letter}P{before}"));
        let refs: Vec<&str> = pieces.iter().map(|s| s.as_str()).collect();
        let s = build("ffa", &refs, &format!("{to_move} AAAA - - 0 0"));
        let got = moves_from(&s, sq(before));
        let want = sorted(
            ["n", "b", "r", "q"]
                .iter()
                .map(|k| format!("{before}{promo}{k}"))
                .collect(),
        );
        assert_eq!(got, want, "{to_move}");
        // Without a promotion letter the move is illegal.
        assert!(!is_legal(&s, &format!("{before}{promo}")));
        // Promotion to king or pawn is illegal.
        assert!(!is_legal(&s, &format!("{before}{promo}k")));
        assert!(!is_legal(&s, &format!("{before}{promo}p")));
        let mut c = s.clone();
        play(&mut c, &format!("{before}{promo}q"));
        assert_eq!(
            c.piece_at(sq(promo)),
            Some(Piece::new(
                PieceKind::Queen,
                Seat::from_letter(to_move).unwrap()
            ))
        );
        // One line earlier: a plain push, no promotion.
        let mut pieces: Vec<String> = kings.iter().map(|s| s.to_string()).collect();
        pieces.push(format!("{letter}P{two_before}"));
        let refs: Vec<&str> = pieces.iter().map(|s| s.as_str()).collect();
        let s = build("ffa", &refs, &format!("{to_move} AAAA - - 0 0"));
        assert_eq!(
            moves_from(&s, sq(two_before)),
            vec![format!("{two_before}{before}")]
        );
    }
}

#[test]
fn promotion_on_capture_and_at_board_edges() {
    // South pawn on a8 (corner file) capturing onto b9 promotes; a8a9 too.
    let s = build(
        "ffa",
        &["sPa8", "wNb9", "sKh1", "wKa16", "nKp16", "eKp1"],
        "S AAAA - - 0 0",
    );
    let got = moves_from(&s, sq("a8"));
    assert_eq!(got.len(), 8, "{got:?}");
    assert!(got.contains(&"a8b9q".to_string()));
    // East pawn on i16 (top rank) going west to h16 promotes, and its
    // diagonal "h17" does not exist.
    let s = build(
        "ffa",
        &["ePi16", "wNh15", "sKa1", "wKa13", "nKm12", "eKp1"],
        "E AAAA - - 0 0",
    );
    let got = moves_from(&s, sq("i16"));
    let mut want: Vec<String> = Vec::new();
    for k in ["n", "b", "r", "q"] {
        want.push(format!("i16h16{k}"));
        want.push(format!("i16h15{k}"));
    }
    assert_eq!(got, sorted(want));
}

#[test]
fn position_string_pawn_zones_per_seat() {
    let kings = "sKa1 wKa16 nKp16 eKp1";
    let ok = |p: &str| {
        let mut pieces: Vec<&str> = kings.split(' ').collect();
        pieces.push(p);
        let text = format!("ffa {} S AAAA - - 0 0", board_field(&pieces));
        parse_position(&text).is_ok()
    };
    // Last legal line (progress 7) accepted; promotion line rejected.
    for (good, bad) in [
        ("sPf8", "sPf9"),
        ("nPf9", "nPf8"),
        ("wPh3", "wPi3"),
        ("ePi3", "ePh3"),
    ] {
        assert!(ok(good), "{good}");
        assert!(!ok(bad), "{bad}");
    }
    // Back lines rejected; pawn start lines accepted (incl. outside e..l).
    for bad in ["sPf1", "nPf16", "wPa7", "ePp7"] {
        assert!(!ok(bad), "{bad}");
    }
    for good in ["sPc2", "nPc15", "wPb3", "ePo14"] {
        assert!(ok(good), "{good}");
    }
}

#[test]
fn en_passant_from_real_start_lines_each_seat() {
    // From the start position, set up each seat's double step with an enemy
    // pawn next to the skipped square, all via position strings (with
    // `ep=on`: en passant is off from rules version 3).
    // South i2-i4 skips i3; West pawn on h4 captures to i3 (forward-diagonal
    // for West is (+1, ±1)).
    let s = build(
        "ffa",
        &["sPi2", "wPh4", "sKa1", "wKa16", "nKp16", "eKp1"],
        "S AAAA - - 0 0 ep=on",
    );
    let mut s = s;
    play(&mut s, "i2i4");
    assert_eq!(s.ep_target(Seat::South).map(|t| t.skipped), Some(sq("i3")));
    // i3 is also West's promotion file: the en passant capture promotes.
    assert!(!is_legal(&s, "h4i3"));
    assert_eq!(moves_from(&s, sq("h4")).len(), 4);
    let ev = play(&mut s, "h4i3q");
    assert!(ev.iter().any(|e| matches!(e, GameEvent::Promotion { .. })));
    assert_eq!(
        s.piece_at(sq("i3")),
        Some(Piece::new(PieceKind::Queen, Seat::West))
    );
    check_invariants(&s);
    assert!(ev.iter().any(|e| matches!(e, GameEvent::EnPassant { captured_square, .. } if *captured_square == sq("i4"))));
    assert!(s.piece_at(sq("i4")).is_none());

    // West b12-d12 skips c12; North pawn on d13 captures to c12.
    let mut s = build(
        "ffa",
        &["wPb12", "nPd13", "sKa1", "wKa16", "nKp16", "eKp1"],
        "W AAAA - - 0 0 ep=on",
    );
    play(&mut s, "b12d12");
    assert_eq!(s.ep_target(Seat::West).map(|t| t.skipped), Some(sq("c12")));
    play(&mut s, "d13c12");
    assert!(s.piece_at(sq("d12")).is_none());

    // North l15-l13 skips l14; East pawn on m13 captures to l14.
    let mut s = build(
        "ffa",
        &["nPl15", "ePm13", "sKa1", "wKa16", "nKp16", "eKp1"],
        "N AAAA - - 0 0 ep=on",
    );
    play(&mut s, "l15l13");
    assert_eq!(s.ep_target(Seat::North).map(|t| t.skipped), Some(sq("l14")));
    play(&mut s, "m13l14");
    assert!(s.piece_at(sq("l13")).is_none());

    // East o5-m5 skips n5; South pawn on m4 captures to n5.
    let mut s = build(
        "ffa",
        &["ePo5", "sPm4", "sKa1", "wKa16", "nKp16", "eKp2"],
        "E AAAA - - 0 0 ep=on",
    );
    play(&mut s, "o5m5");
    assert_eq!(s.ep_target(Seat::East).map(|t| t.skipped), Some(sq("n5")));
    play(&mut s, "m4n5");
    assert!(s.piece_at(sq("m5")).is_none());
}

#[test]
fn en_passant_expires_after_a_full_round() {
    let mut s = build(
        "ffa",
        &["sPi2", "ePj4", "sKa1", "wKa16", "nKp16", "eKp1"],
        "S AAAA - - 0 0 ep=on",
    );
    play(&mut s, "i2i4");
    // East (third after South) may still capture: West and North move first.
    play(&mut s, "a16a15");
    play(&mut s, "p16p15");
    assert!(is_legal(&s, "j4i3"), "{s}");
    play(&mut s, "p1p2");
    play(&mut s, "a1a2");
    // South's own turn came round: target gone.
    assert!(s.ep_target(Seat::South).is_none());
}

#[test]
fn no_double_step_off_the_start_line() {
    let s = build(
        "ffa",
        &["sPe3", "wPc5", "sKa1", "wKa16", "nKp16", "eKp1"],
        "S AAAA - - 0 0",
    );
    assert_eq!(moves_from(&s, sq("e3")), vec!["e3e4".to_string()]);
    let s = build(
        "ffa",
        &["sPe3", "wPc5", "sKa1", "wKa16", "nKp16", "eKp1"],
        "W AAAA - - 0 0",
    );
    assert_eq!(moves_from(&s, sq("c5")), vec!["c5d5".to_string()]);
    // Blocked double step: pawn on e2, piece on e4.
    let s = build(
        "ffa",
        &["sPe2", "wNe4", "sKa1", "wKa16", "nKp16", "eKp1"],
        "S AAAA - - 0 0",
    );
    assert_eq!(moves_from(&s, sq("e2")), vec!["e2e3".to_string()]);
}

// ---------------------------------------------------------------------------
// Castling geometry, all four seats
// ---------------------------------------------------------------------------

#[test]
fn castling_all_seats_both_sides() {
    // (seat letter, king home, long rook, long K to, long R to,
    //  short rook, short K to, short R to)
    let cases = [
        ('S', "i1", "e1", "g1", "h1", "l1", "k1", "j1"),
        ('W', "a9", "a5", "a7", "a8", "a12", "a11", "a10"),
        ('N', "i16", "e16", "g16", "h16", "l16", "k16", "j16"),
        ('E', "p9", "p5", "p7", "p8", "p12", "p11", "p10"),
    ];
    let homes = ["sKi1", "wKa9", "nKi16", "eKp9"];
    for (c, k, lr, lk, lrt, sr, sk, srt) in cases {
        let l = c.to_ascii_lowercase();
        let mut pieces: Vec<String> = homes.iter().map(|s| s.to_string()).collect();
        pieces.push(format!("{l}R{lr}"));
        pieces.push(format!("{l}R{sr}"));
        let refs: Vec<&str> = pieces.iter().map(|s| s.as_str()).collect();
        let rights = format!("{c}{lr},{c}{sr}");
        for (kto, rook, rto) in [(lk, lr, lrt), (sk, sr, srt)] {
            let mut s = build("ffa", &refs, &format!("{c} AAAA {rights} - 0 0"));
            let castle = format!("{k}{kto}");
            let found = find_legal_move(&s, mv(&castle)).expect(&castle);
            assert_eq!(found.flag, MoveFlag::Castle, "{castle}");
            let ev = play(&mut s, &castle);
            assert!(
                ev.iter().any(|e| matches!(e,
                GameEvent::Castle { rook_from, rook_to, .. }
                    if *rook_from == sq(rook) && *rook_to == sq(rto))),
                "{castle}: {ev:?}"
            );
            let me = Seat::from_letter(c).unwrap();
            assert_eq!(s.piece_at(sq(kto)), Some(Piece::new(PieceKind::King, me)));
            assert_eq!(s.piece_at(sq(rto)), Some(Piece::new(PieceKind::Rook, me)));
            assert!(s.piece_at(sq(k)).is_none());
            assert!(s.piece_at(sq(rook)).is_none());
            assert!(s.castling_rights(me).is_empty());
            check_invariants(&s);
        }
    }
}

#[test]
fn castling_blocked_and_attacked_squares() {
    // Long side needs f1, g1, h1 empty (three squares); short j1, k1.
    for blocker in ["f1", "g1", "h1"] {
        let b = format!("sN{blocker}");
        let s = build(
            "ffa",
            &["sKi1", "sRe1", "sRl1", &b, "wKa9", "nKi16", "eKp9"],
            "S AAAA Se1,Sl1 - 0 0",
        );
        assert!(!is_legal(&s, "i1g1"), "blocked by {blocker}");
        assert!(is_legal(&s, "i1k1"));
    }
    // No attack restrictions: castle through and into attacked squares, and
    // out of check.
    let s = build(
        "ffa",
        &[
            "sKi1", "sRe1", "sRl1", "wKa9", "nKi16", "nRg8", "nRh8", "eKp9", "eRk5",
        ],
        "S AAAA Se1,Sl1 - 0 0",
    );
    assert!(is_legal(&s, "i1g1"));
    assert!(is_legal(&s, "i1k1"));
}

#[test]
fn castling_rights_lost_when_rook_captured_at_home() {
    // West bishop captures South's l1 rook; Sl1 right must disappear.
    let mut s = build(
        "ffa",
        &["sKi1", "sRe1", "sRl1", "wKa9", "wBo4", "nKi16", "eKp9"],
        "W AAAA Se1,Sl1 - 0 0",
    );
    play(&mut s, "o4l1");
    let cr = s.castling_rights(Seat::South);
    assert!(cr.long && !cr.short, "{s}");
    assert!(!is_legal(&s, "i1k1"));
    check_invariants(&s);
    // A rook that leaves and comes back does not regain the right.
    let mut s = build(
        "ffa",
        &["sKi1", "sRe1", "sRl1", "wKa9", "nKi16", "eKp9"],
        "S AAAA Se1,Sl1 - 0 0",
    );
    play(&mut s, "e1e2");
    play(&mut s, "a9a10");
    play(&mut s, "i16i15");
    play(&mut s, "p9p10");
    play(&mut s, "e2e1");
    assert!(!s.castling_rights(Seat::South).long);
}

#[test]
fn start_position_has_no_castle_but_after_clearing_it_does() {
    let mut s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    assert!(!is_legal(&s, "i1k1"));
    assert!(!is_legal(&s, "i1g1"));
    // Clear South's short side (knight k1, bishop j1) in legal moves.
    for m in [
        "j2j3", "b5c5", "e15e14", "o5n5", //
        "k1m2", "c5d5", "e14e13", "n5m5", //
        "k2k3", "d5e5", "e13e12", "m5l5", //
        "j1k2", "e5f5", "e12e11", "l5k5",
    ] {
        play(&mut s, m);
    }
    assert!(is_legal(&s, "i1k1"), "{s}");
    play(&mut s, "i1k1");
    assert_eq!(
        s.piece_at(sq("j1")),
        Some(Piece::new(PieceKind::Rook, Seat::South))
    );
    check_invariants(&s);
}

// ---------------------------------------------------------------------------
// Notation and position strings
// ---------------------------------------------------------------------------

#[test]
fn notation_edge_cases() {
    for f in 0..16 {
        for r in 0..16 {
            let n = name(f, r);
            let s: Square = n.parse().unwrap();
            assert_eq!(s.to_string(), n);
            assert_eq!((s.file() as i32, s.rank() as i32), (f, r));
        }
    }
    for ok in [
        "a10a16", "a16a10", "p16a1", "a1p16", "a11a12q", "p1p16", "a16p1", "i15i16", "h16h9",
        "a1a10",
    ] {
        let m = parse_move(ok).unwrap();
        assert_eq!(m.to_string(), ok.to_lowercase());
    }
    // Greedy two-digit ranks: "a1a10" is a1→a10, never a1→a1 + "0".
    let m = parse_move("a1a10").unwrap();
    assert_eq!((m.from, m.to), (sq("a1"), sq("a10")));
    let m = parse_move("a11a1").unwrap();
    assert_eq!((m.from, m.to), (sq("a11"), sq("a1")));
    let m = parse_move("a16a1q").unwrap();
    assert_eq!(
        (m.from, m.to, m.promotion),
        (sq("a16"), sq("a1"), Some(PieceKind::Queen))
    );
    for bad in [
        "a17a1", "q1a1", "a0a1", "p16q16", "a1a17", "a1a160", "a10a1qq", "a1", "a161a1", "a1a01",
        "p16p16", "a1a1", "r1a1", "a1A2",
    ] {
        assert!(parse_move(bad).is_err(), "{bad} should not parse");
    }
}

#[test]
fn position_string_edge_cases() {
    // Pieces on p16 / a16 / p1 / a1 round trip.
    let s = build(
        "ffa",
        &["sKa1", "wKa16", "nKp16", "eKp1", "sQi9", "wRj10"],
        "S AAAA - - 0 0",
    );
    let t = s.to_position_string();
    assert!(t.starts_with("ffa wK14nK/"), "{t}");
    let back = parse_position(&t).unwrap();
    assert_eq!(back, s);
    // "16" as a run is fine; "1" followed by "6" is the same run (digits
    // accumulate), and "17"/"10" + "6" overflows.
    let empty = ["16"; 15].join("/");
    let base = |first: &str| format!("ffa {first}/{empty} S AAAA - - 0 0");
    assert!(parse_position(&base("17")).is_err());
    assert!(parse_position(&base("15sK1")).is_err()); // only one leader anyway
    // A rank with 16 squares made of 15 + piece: valid board, though the
    // whole position is invalid (no other leaders). Just make sure it is not
    // a board-shape error by checking the message.
    if let Err(e) = parse_position(&base("15sK")) {
        assert!(!e.to_string().contains("squares"), "{e}");
    }
    // Castling tokens with two-digit ranks.
    let s = build(
        "ffa",
        &[
            "sKi1", "wKa9", "wRa12", "wRa5", "nKi16", "nRl16", "eKp9", "eRp12",
        ],
        "S AAAA Wa5,Wa12,Nl16,Ep12 - 0 0",
    );
    let t = s.to_position_string();
    assert!(t.contains(" Wa5,Wa12,Nl16,Ep12 "), "{t}");
    assert_eq!(parse_position(&t).unwrap(), s);
    // A two-digit en passant square (en passant is off from rules version 3).
    let mut s = build(
        "ffa",
        &["sKa1", "wKa16", "nKp16", "nPf15", "eKp1"],
        "N AAAA - - 0 0 ep=on",
    );
    play(&mut s, "f15f13");
    let t = s.to_position_string();
    assert!(t.contains(" Nf14 "), "{t}");
    assert_eq!(parse_position(&t).unwrap(), s);
    // Junk after a two-digit square is rejected.
    assert!(parse_position(&t.replace(" Nf14 ", " Nf140 ")).is_err());
    assert!(parse_position(&t.replace(" Nf14 ", " Nf17 ")).is_err());
}

// ---------------------------------------------------------------------------
// Attack detection matches geometry (wrap-around, all seats)
// ---------------------------------------------------------------------------

#[test]
fn attack_detection_matches_geometry_everywhere() {
    let kinds = [
        PieceKind::Pawn,
        PieceKind::Knight,
        PieceKind::Bishop,
        PieceKind::Rook,
        PieceKind::Queen,
    ];
    let other_kings = ["wKf9", "nKj11", "eKk6"];
    for (seat_letter, seat) in [
        ('s', Seat::South),
        ('w', Seat::West),
        ('n', Seat::North),
        ('e', Seat::East),
    ] {
        for kind in kinds {
            for f in [0, 1, 7, 14, 15] {
                for r in [0, 1, 6, 8, 14, 15] {
                    if kind == PieceKind::Pawn {
                        let p = match seat {
                            Seat::South => r,
                            Seat::North => 15 - r,
                            Seat::West => f,
                            Seat::East => 15 - f,
                        };
                        if !(1..8).contains(&p) {
                            continue;
                        }
                    }
                    let n = name(f, r);
                    // Kings: South h8, plus the others; move them if clashing.
                    let mut pieces: Vec<String> = Vec::new();
                    let kings = [
                        ("s", "h8", "g8"),
                        ("w", "f9", "f10"),
                        ("n", "j11", "j12"),
                        ("e", "k6", "k7"),
                    ];
                    for (l, a, b) in kings {
                        let at = if a == n { b } else { a };
                        pieces.push(format!("{l}K{at}"));
                    }
                    let _ = other_kings;
                    pieces.push(format!("{seat_letter}{}{n}", kind.letter()));
                    let refs: Vec<&str> = pieces.iter().map(|s| s.as_str()).collect();
                    let s = build("ffa", &refs, "S AAAA - - 0 0");
                    let attacks = geometric_attacks(&s, seat, kind, f, r);
                    // Kings of `seat` also attack.
                    let ksq = s.leader_squares(seat).next().unwrap();
                    let kat = geometric_attacks(
                        &s,
                        seat,
                        PieceKind::King,
                        ksq.file() as i32,
                        ksq.rank() as i32,
                    );
                    for tf in 0..16 {
                        for tr in 0..16 {
                            let want = attacks.contains(&(tf, tr)) || kat.contains(&(tf, tr));
                            let got = is_square_attacked_by(&s, sqfr(tf, tr), seat);
                            assert_eq!(
                                got,
                                want,
                                "{seat} {kind:?} on {n}, target {}",
                                name(tf, tr)
                            );
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Perft: independent cross-check of the first plies
// ---------------------------------------------------------------------------

/// Independent count of South's moves from a position (geometry only, no
/// castling/en passant/promotion needed at this depth).
fn naive_count(s: &GameState) -> u64 {
    let me = s.seat_to_move();
    let mut n = 0u64;
    for f in 0..16 {
        for r in 0..16 {
            let Some(p) = s.piece_at(sqfr(f, r)) else {
                continue;
            };
            if p.owner != me {
                continue;
            }
            if p.kind == PieceKind::Pawn {
                let (fx, fy) = me.forward();
                let (fx, fy) = (fx as i32, fy as i32);
                let prog = match me {
                    Seat::South => r,
                    Seat::North => 15 - r,
                    Seat::West => f,
                    Seat::East => 15 - f,
                };
                let promo_mult = |tf: i32, tr: i32| {
                    let p2 = match me {
                        Seat::South => tr,
                        Seat::North => 15 - tr,
                        Seat::West => tf,
                        Seat::East => 15 - tf,
                    };
                    if p2 == 8 { 4 } else { 1 }
                };
                if on(f + fx, r + fy) && s.piece_at(sqfr(f + fx, r + fy)).is_none() {
                    n += promo_mult(f + fx, r + fy);
                    if prog == 1
                        && on(f + 2 * fx, r + 2 * fy)
                        && s.piece_at(sqfr(f + 2 * fx, r + 2 * fy)).is_none()
                    {
                        n += 1;
                    }
                }
                let diag = if fx == 0 {
                    [(-1, fy), (1, fy)]
                } else {
                    [(fx, -1), (fx, 1)]
                };
                for (df, dr) in diag {
                    let (tf, tr) = (f + df, r + dr);
                    if on(tf, tr)
                        && let Some(q) = s.piece_at(sqfr(tf, tr))
                        && s.is_opponent(me, q.owner)
                    {
                        n += promo_mult(tf, tr);
                    }
                }
            } else {
                n += geometric_targets(s, me, p.kind, f, r).len() as u64;
            }
        }
    }
    n
}

#[test]
fn perft_first_round_and_south_second_move_independent() {
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let s = GameState::new(GameConfig::new(mode)).unwrap();
        assert_eq!(naive_count(&s), 30);
        assert_eq!(perft(&s, 1), 30);
        // Depth 2 independent: after each South move, West has 30.
        let mut total = 0;
        for m in legal_moves(&s) {
            let mut c = s.clone();
            apply_move(&mut c, m).unwrap();
            total += naive_count(&c);
        }
        assert_eq!(total, 900);
        assert_eq!(perft(&s, 2), 900);
    }
}

/// Depth 5 from the start, recounted with the naive generator at the leaves.
/// Run with `cargo test --release --test attack_16x16 -- --ignored`.
#[test]
#[ignore]
fn perft5_independent_leaves() {
    for (mode, want) in [
        (GameMode::Ffa, 28_561_080u64),
        (GameMode::Teams, 28_557_360),
    ] {
        let s = GameState::new(GameConfig::new(mode)).unwrap();
        let mut total = 0u64;
        let l1 = legal_moves(&s);
        for a in l1 {
            let mut s1 = s.clone();
            apply_move(&mut s1, a).unwrap();
            for b in legal_moves(&s1) {
                let mut s2 = s1.clone();
                apply_move(&mut s2, b).unwrap();
                for c in legal_moves(&s2) {
                    let mut s3 = s2.clone();
                    apply_move(&mut s3, c).unwrap();
                    for d in legal_moves(&s3) {
                        let mut s4 = s3.clone();
                        apply_move(&mut s4, d).unwrap();
                        // No en passant possible from the start lines, no
                        // castling (pieces between), so naive is exact.
                        total += naive_count(&s4);
                    }
                }
            }
        }
        assert_eq!(total, want, "{mode:?}");
    }
}

// ---------------------------------------------------------------------------
// Hash and round-trip invariants along random 16×16 games
// ---------------------------------------------------------------------------

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

#[test]
fn random_games_keep_invariants_and_naive_counts() {
    for (game, mode) in [
        GameMode::Ffa,
        GameMode::Teams,
        GameMode::Ffa,
        GameMode::Teams,
    ]
    .into_iter()
    .enumerate()
    {
        let mut rng = Rng(0x1234_5678 + game as u64 * 7919);
        let mut s = GameState::new(GameConfig::new(mode)).unwrap();
        let mut plies = 0;
        while !s.is_over() && plies < 600 {
            let moves = legal_moves(&s);
            // Naive count excludes castling and en passant; compare the rest.
            let special = moves
                .iter()
                .filter(|m| matches!(m.flag, MoveFlag::Castle | MoveFlag::EnPassant))
                .count() as u64;
            assert_eq!(moves.len() as u64 - special, naive_count(&s), "{s}");
            // Prefer captures to make games eventful.
            let caps: Vec<Move> = moves
                .iter()
                .copied()
                .filter(|m| s.piece_at(m.to).is_some())
                .collect();
            let pool = if !caps.is_empty() && !rng.next().is_multiple_of(3) {
                caps
            } else {
                moves
            };
            let m = pool[(rng.next() % pool.len() as u64) as usize];
            apply_move(&mut s, m).unwrap();
            check_invariants(&s);
            plies += 1;
        }
    }
}

/// The armies do touch in round 1: a rook that slides into a corner can be
/// taken by the neighbouring army's rook on the very next turn (PLAN §2 and
/// docs/OVERNIGHT-2.md say nobody can capture on move 1; the move counts are
/// still 30 because the capture replaces the plain move to that square).
#[test]
fn round_one_corner_rook_capture_exists() {
    let mut s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    play(&mut s, "e1a1");
    assert_eq!(legal_moves(&s).len(), 30);
    let ev = play(&mut s, "a5a1");
    assert!(
        ev.iter().any(|e| matches!(e, GameEvent::Capture { .. })),
        "{ev:?}"
    );
    // Same on East's side: South l1-p1, West, North, then East p5xp1.
    let mut s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    for m in ["l1p1", "b5c5", "e15e14"] {
        play(&mut s, m);
    }
    let ev = play(&mut s, "p5p1");
    assert!(ev.iter().any(|e| matches!(e, GameEvent::Capture { .. })));
}
