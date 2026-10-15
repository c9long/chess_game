//! Adversarial movement tests derived from PLAN §2 ("rules_version 1"):
//! pawn directions for all four seats, knights/sliders at edges and in the
//! 2x2 corners, promotion lines and choices, castling geometry and rights,
//! en passant, teammates, and self-check legality.

mod common;

use common::*;
use rules_core::*;

/// Kings parked in the four 2x2 corners (S a1, W a12, N l12, E l1).
const KINGS: [&str; 4] = ["sKa1", "wKa12", "nKl12", "eKl1"];

fn with_kings<'a>(extra: &[&'a str]) -> Vec<&'a str> {
    let mut v: Vec<&'a str> = KINGS.to_vec();
    v.extend_from_slice(extra);
    v
}

fn ffa(pieces: &[&str], to_move: char) -> GameState {
    build("ffa", pieces, &format!("{to_move} AAAA - - 0 0"))
}

fn teams(pieces: &[&str], to_move: char) -> GameState {
    build("teams", pieces, &format!("{to_move} AAAA - - 0 0"))
}

fn strs(a: &[&str]) -> Vec<String> {
    let mut v: Vec<String> = a.iter().map(|s| s.to_string()).collect();
    v.sort();
    v
}

/// Sorted legal moves starting on `from`; also checks each one is accepted
/// by `find_legal_move` (generator and validator agree).
fn moves_from(s: &GameState, from: &str) -> Vec<String> {
    let f = sq(from);
    let mut v: Vec<String> = legal_moves(s)
        .iter()
        .filter(|m| m.from == f)
        .map(|m| m.to_string())
        .collect();
    v.sort();
    for m in &v {
        assert!(
            is_legal(s, m),
            "{m} generated but rejected by find_legal_move"
        );
    }
    v
}

fn promos(from: &str, to: &str) -> Vec<String> {
    let mut v: Vec<String> = ["b", "n", "q", "r"]
        .iter()
        .map(|p| format!("{from}{to}{p}"))
        .collect();
    v.sort();
    v
}

fn flag_of(s: &GameState, m: &str) -> Option<MoveFlag> {
    let want = mv(m);
    legal_moves(s)
        .into_iter()
        .find(|x| x.same_choice(&want))
        .map(|x| x.flag)
}

/// A quiet king move inside the king's own 2x2 corner for the seat to move.
fn tempo(s: &mut GameState) {
    let seat = s.seat_to_move();
    let (k, _) = s
        .pieces_of(seat)
        .find(|(_, p)| p.kind == PieceKind::King)
        .expect("tempo seat has a king");
    let in_corner = |q: Square| (q.file() < 2 || q.file() > 9) && (q.rank() < 2 || q.rank() > 9);
    for (df, dr) in [
        (0, 1),
        (0, -1),
        (1, 0),
        (-1, 0),
        (1, 1),
        (1, -1),
        (-1, 1),
        (-1, -1),
    ] {
        let Some(t) = k.offset(df, dr) else { continue };
        let m = Move::new(k, t);
        if in_corner(t) && s.piece_at(t).is_none() && find_legal_move(s, m).is_some() {
            apply_move(s, m).unwrap();
            return;
        }
    }
    panic!("no tempo move for {seat} in {s}");
}

fn has_event(ev: &[GameEvent], pred: impl Fn(&GameEvent) -> bool) -> bool {
    ev.iter().any(pred)
}

fn piece(owner: Seat, kind: PieceKind) -> Option<Piece> {
    Some(Piece { kind, owner })
}

// ---------------------------------------------------------------------------
// Pawn directions
// ---------------------------------------------------------------------------

#[test]
fn south_pawn_pushes_north_and_captures_diagonally_forward_only() {
    let s = ffa(&with_kings(&["sPe5", "eNd6", "eNf6", "eNd4", "eNf4"]), 'S');
    assert_eq!(moves_from(&s, "e5"), strs(&["e5e6", "e5d6", "e5f6"]));
}

#[test]
fn north_pawn_pushes_south_and_captures_diagonally_forward_only() {
    let s = ffa(&with_kings(&["nPe8", "sNd7", "sNf7", "sNd9", "sNf9"]), 'N');
    assert_eq!(moves_from(&s, "e8"), strs(&["e8e7", "e8d7", "e8f7"]));
}

#[test]
fn west_pawn_pushes_east_and_captures_diagonally_forward_only() {
    let s = ffa(&with_kings(&["wPe5", "nNf6", "nNf4", "nNd6", "nNd4"]), 'W');
    assert_eq!(moves_from(&s, "e5"), strs(&["e5f5", "e5f6", "e5f4"]));
}

#[test]
fn east_pawn_pushes_west_and_captures_diagonally_forward_only() {
    let s = ffa(&with_kings(&["ePh5", "sNg6", "sNg4", "sNi6", "sNi4"]), 'E');
    assert_eq!(moves_from(&s, "h5"), strs(&["h5g5", "h5g6", "h5g4"]));
}

#[test]
fn double_step_only_from_start_line_for_every_seat() {
    let pieces = with_kings(&[
        "sPe2", "sPf3", "nPe11", "nPf10", "wPb6", "wPc7", "ePk6", "ePj7",
    ]);
    let s = ffa(&pieces, 'S');
    assert_eq!(moves_from(&s, "e2"), strs(&["e2e3", "e2e4"]));
    assert_eq!(moves_from(&s, "f3"), strs(&["f3f4"]));
    let n = ffa(&pieces, 'N');
    assert_eq!(moves_from(&n, "e11"), strs(&["e11e10", "e11e9"]));
    assert_eq!(moves_from(&n, "f10"), strs(&["f10f9"]));
    let w = ffa(&pieces, 'W');
    assert_eq!(moves_from(&w, "b6"), strs(&["b6c6", "b6d6"]));
    assert_eq!(moves_from(&w, "c7"), strs(&["c7d7"]));
    let e = ffa(&pieces, 'E');
    assert_eq!(moves_from(&e, "k6"), strs(&["k6j6", "k6i6"]));
    assert_eq!(moves_from(&e, "j7"), strs(&["j7i7"]));
}

#[test]
fn double_step_needs_both_squares_empty() {
    let s = ffa(
        &with_kings(&[
            "sPe2", "wNe4", "sPh2", "wNh3", "wPb6", "sNd6", "wPb9", "sNc9",
        ]),
        'S',
    );
    assert_eq!(moves_from(&s, "e2"), strs(&["e2e3"]));
    assert!(moves_from(&s, "h2").is_empty());
    let w = ffa(
        &with_kings(&[
            "sPe2", "wNe4", "sPh2", "wNh3", "wPb6", "sNd6", "wPb9", "sNc9",
        ]),
        'W',
    );
    assert_eq!(moves_from(&w, "b6"), strs(&["b6c6"]));
    assert!(moves_from(&w, "b9").is_empty());
}

#[test]
fn pawns_never_capture_straight_ahead_or_backward() {
    let s = ffa(&with_kings(&["sPe5", "wNe6", "wNd4", "wNf4"]), 'S');
    assert!(moves_from(&s, "e5").is_empty());
    let w = ffa(&with_kings(&["wPe5", "sNf5", "sNd4", "sNd6"]), 'W');
    assert!(moves_from(&w, "e5").is_empty());
    let n = ffa(&with_kings(&["nPe8", "sNe7", "sNd9", "sNf9"]), 'N');
    assert!(moves_from(&n, "e8").is_empty());
    let e = ffa(&with_kings(&["ePh5", "sNg5", "sNi4", "sNi6"]), 'E');
    assert!(moves_from(&e, "h5").is_empty());
}

#[test]
fn pawn_captures_do_not_wrap_around_board_edges() {
    // a4 - 1 file would wrap to l-file squares in a naive index scheme.
    let s = ffa(&with_kings(&["sPa4", "wNb5", "wNl4", "wNl5", "wNl3"]), 'S');
    assert_eq!(moves_from(&s, "a4"), strs(&["a4a5", "a4b5"]));
    let s = ffa(&with_kings(&["sPl4", "wNk5", "wNa6", "wNa5"]), 'S');
    assert_eq!(moves_from(&s, "l4"), strs(&["l4l5", "l4k5"]));
    // West pawn on the top edge: only one capture diagonal exists.
    let w = ffa(&with_kings(&["wPd12", "sNe11", "sNe1"]), 'W');
    assert_eq!(moves_from(&w, "d12"), strs(&["d12e12", "d12e11"]));
    // East pawn on the bottom edge.
    let e = ffa(&with_kings(&["ePi1", "sNh2", "sNh12"]), 'E');
    assert_eq!(moves_from(&e, "i1"), strs(&["i1h1", "i1h2"]));
}

// ---------------------------------------------------------------------------
// Knights, sliders and kings near edges and in the 2x2 corners
// ---------------------------------------------------------------------------

#[test]
fn knights_in_corners_and_on_edges() {
    let s = ffa(
        &[
            "sNa1", "sNb2", "sNl12", "sNa6", "sNl6", "sNb1", "sKf6", "wKg10", "nKf9", "eKh3",
        ],
        'S',
    );
    assert_eq!(moves_from(&s, "a1"), strs(&["a1b3", "a1c2"]));
    assert_eq!(
        moves_from(&s, "b2"),
        strs(&["b2a4", "b2c4", "b2d3", "b2d1"])
    );
    assert_eq!(moves_from(&s, "l12"), strs(&["l12k10", "l12j11"]));
    assert_eq!(
        moves_from(&s, "a6"),
        strs(&["a6b8", "a6b4", "a6c7", "a6c5"])
    );
    assert_eq!(
        moves_from(&s, "l6"),
        strs(&["l6k8", "l6k4", "l6j7", "l6j5"])
    );
    assert_eq!(moves_from(&s, "b1"), strs(&["b1a3", "b1c3", "b1d2"]));
}

const FAR_KINGS: [&str; 4] = ["sKf6", "wKh9", "nKd3", "eKj10"];

fn far(extra: &str) -> GameState {
    let mut v: Vec<&str> = FAR_KINGS.to_vec();
    v.push(extra);
    ffa(&v, 'S')
}

#[test]
fn rook_in_corner_slides_along_both_full_edges() {
    let s = far("sRa1");
    let m = moves_from(&s, "a1");
    assert_eq!(m.len(), 22, "{m:?}");
    assert!(m.contains(&"a1a12".to_string()) && m.contains(&"a1l1".to_string()));
}

#[test]
fn rook_on_right_edge_does_not_wrap() {
    let s = far("sRl5");
    let m = moves_from(&s, "l5");
    assert_eq!(m.len(), 22, "{m:?}");
    assert!(
        m.iter()
            .all(|x| x[2..].starts_with('l') || x.ends_with('5'))
    );
}

#[test]
fn bishop_and_queen_long_lines_from_corners() {
    let s = far("sBl1");
    let m = moves_from(&s, "l1");
    assert_eq!(m.len(), 11, "{m:?}");
    assert!(m.contains(&"l1a12".to_string()));
    let s = far("sQa12");
    let m = moves_from(&s, "a12");
    assert_eq!(m.len(), 33, "{m:?}");
    assert!(m.contains(&"a12l1".to_string()));
}

#[test]
fn king_in_each_corner_has_three_moves() {
    let s = ffa(&["sKa1", "wKa12", "nKl12", "eKl1"], 'S');
    assert_eq!(moves_from(&s, "a1"), strs(&["a1a2", "a1b1", "a1b2"]));
    let n = ffa(&["sKa1", "wKa12", "nKl12", "eKl1"], 'N');
    assert_eq!(moves_from(&n, "l12"), strs(&["l12k12", "l12l11", "l12k11"]));
}

#[test]
fn start_position_corner_squares_are_reachable() {
    let s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    assert!(is_legal(&s, "c1a1"));
    assert!(is_legal(&s, "d1b2"));
    let mut s2 = s;
    play(&mut s2, "d1b2");
    assert_eq!(s2.piece_at(sq("b2")), piece(Seat::South, PieceKind::Knight));
}

#[test]
fn sliders_stop_at_blockers_and_capture_opponents_ffa() {
    let p = with_kings(&["sRe4", "sPe6", "wNh4", "nNb4", "eNe2"]);
    let s = ffa(&p, 'S');
    assert_eq!(
        moves_from(&s, "e4"),
        strs(&[
            "e4e5", "e4f4", "e4g4", "e4h4", "e4d4", "e4c4", "e4b4", "e4e3", "e4e2"
        ])
    );
}

// ---------------------------------------------------------------------------
// Teammates
// ---------------------------------------------------------------------------

#[test]
fn teams_rook_cannot_capture_teammate_and_is_blocked_by_it() {
    let p = with_kings(&["sRe4", "sPe6", "wNh4", "nNb4", "eNe2"]);
    let s = teams(&p, 'S');
    assert_eq!(
        moves_from(&s, "e4"),
        strs(&[
            "e4e5", "e4f4", "e4g4", "e4h4", "e4d4", "e4c4", "e4e3", "e4e2"
        ])
    );
    assert!(apply_move(&mut s.clone(), mv("e4b4")).is_err());
}

#[test]
fn teams_pawn_cannot_capture_teammate() {
    let p = with_kings(&["sPe5", "nNd6", "wNf6"]);
    assert_eq!(moves_from(&teams(&p, 'S'), "e5"), strs(&["e5e6", "e5f6"]));
    assert_eq!(
        moves_from(&ffa(&p, 'S'), "e5"),
        strs(&["e5e6", "e5f6", "e5d6"])
    );
}

#[test]
fn teams_knight_and_king_cannot_capture_teammate() {
    let p = [
        "sNc3", "nRe4", "wRd5", "sKg6", "nRg7", "wRh7", "wKa12", "nKl12", "eKl1",
    ];
    let s = teams(&p, 'S');
    let n = moves_from(&s, "c3");
    assert!(n.contains(&"c3d5".to_string()));
    assert!(!n.contains(&"c3e4".to_string()));
    let k = moves_from(&s, "g6");
    assert!(k.contains(&"g6h7".to_string()));
    assert!(!k.contains(&"g6g7".to_string()));
}

#[test]
fn teams_west_and_east_are_teammates() {
    let p = with_kings(&["wRd7", "eNd9", "sNd4"]);
    let s = teams(&p, 'W');
    assert_eq!(
        moves_from(&s, "d7")
            .into_iter()
            .filter(|m| m[2..].starts_with('d'))
            .collect::<Vec<_>>(),
        strs(&["d7d8", "d7d6", "d7d5", "d7d4"])
    );
    let f = ffa(&p, 'W');
    assert!(moves_from(&f, "d7").contains(&"d7d9".to_string()));
}

// ---------------------------------------------------------------------------
// Self-check is legal
// ---------------------------------------------------------------------------

#[test]
fn king_may_move_into_attack() {
    let mut s = ffa(&["sKe5", "eRf12", "wKa12", "nKl12", "eKl1"], 'S');
    assert!(is_legal(&s, "e5f5"));
    play(&mut s, "e5f5");
    assert!(leader_under_attack(&s, Seat::South));
}

#[test]
fn pinned_piece_may_move_and_attacked_king_may_be_ignored() {
    let s = ffa(
        &["sKe4", "sBe5", "eRe10", "sPc3", "wKa12", "nKl12", "eKl1"],
        'S',
    );
    assert!(is_legal(&s, "e5f6"));
    let mut s2 = s.clone();
    play(&mut s2, "e5f6");
    assert!(is_square_attacked_by(&s2, sq("e4"), Seat::East));

    // King already attacked: a pawn move elsewhere is still legal.
    let s = ffa(&["sKe4", "eRe10", "sPc3", "wKa12", "nKl12", "eKl1"], 'S');
    assert!(leader_under_attack(&s, Seat::South));
    assert!(is_legal(&s, "c3c4"));
}

#[test]
fn king_may_step_next_to_enemy_king() {
    let s = ffa(&["sKe5", "wKe7", "nKl12", "eKl1"], 'S');
    assert!(is_legal(&s, "e5e6"));
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

#[test]
fn south_promotes_on_rank_7_to_q_r_b_n_only() {
    let s = ffa(&with_kings(&["sPf6"]), 'S');
    assert_eq!(moves_from(&s, "f6"), promos("f6", "f7"));
    for bad in ["f6f7", "f6f7k", "f6f7p"] {
        let mut t = s.clone();
        assert!(apply_move(&mut t, mv(bad)).is_err(), "{bad} accepted");
        assert_eq!(t, s, "state changed by rejected {bad}");
    }
    let mut t = s.clone();
    let ev = play(&mut t, "f6f7n");
    assert_eq!(t.piece_at(sq("f7")), piece(Seat::South, PieceKind::Knight));
    assert_eq!(t.piece_at(sq("f6")), None);
    assert_eq!(t.piece_count(Seat::South, PieceKind::Pawn), 0);
    assert!(has_event(&ev, |e| matches!(
        e,
        GameEvent::Promotion {
            seat: Seat::South,
            kind: PieceKind::Knight,
            ..
        }
    )));
}

#[test]
fn north_promotes_on_rank_6() {
    let s = ffa(&with_kings(&["nPf7"]), 'N');
    assert_eq!(moves_from(&s, "f7"), promos("f7", "f6"));
    assert!(!is_legal(&s, "f7f6"));
    let mut t = s.clone();
    play(&mut t, "f7f6r");
    assert_eq!(t.piece_at(sq("f6")), piece(Seat::North, PieceKind::Rook));
}

#[test]
fn west_promotes_on_file_g() {
    let s = ffa(&with_kings(&["wPf5"]), 'W');
    assert_eq!(moves_from(&s, "f5"), promos("f5", "g5"));
    assert!(!is_legal(&s, "f5g5"));
    let mut t = s.clone();
    play(&mut t, "f5g5b");
    assert_eq!(t.piece_at(sq("g5")), piece(Seat::West, PieceKind::Bishop));
}

#[test]
fn east_promotes_on_file_f() {
    let s = ffa(&with_kings(&["ePg5"]), 'E');
    assert_eq!(moves_from(&s, "g5"), promos("g5", "f5"));
    assert!(!is_legal(&s, "g5f5"));
    let mut t = s.clone();
    play(&mut t, "g5f5q");
    assert_eq!(t.piece_at(sq("f5")), piece(Seat::East, PieceKind::Queen));
}

#[test]
fn capture_promotions_offer_all_four_pieces_per_target() {
    let s = ffa(&with_kings(&["sPe6", "wNd7", "eNf7"]), 'S');
    let mut want = promos("e6", "e7");
    want.extend(promos("e6", "d7"));
    want.extend(promos("e6", "f7"));
    want.sort();
    assert_eq!(moves_from(&s, "e6"), want);
    let e = ffa(&with_kings(&["ePg5", "sNf6", "sNf4", "sNf5"]), 'E');
    let mut want = promos("g5", "f6");
    want.extend(promos("g5", "f4"));
    want.sort();
    assert_eq!(moves_from(&e, "g5"), want);
}

#[test]
fn no_promotion_before_the_line_and_letter_rejected_there() {
    let s = ffa(&with_kings(&["sPe5", "sPc3"]), 'S');
    assert_eq!(moves_from(&s, "e5"), strs(&["e5e6"]));
    assert!(!is_legal(&s, "e5e6q"));
    assert!(!is_legal(&s, "c3c4q"));
    let w = ffa(&with_kings(&["wPe5"]), 'W');
    assert_eq!(moves_from(&w, "e5"), strs(&["e5f5"]));
    assert!(!is_legal(&w, "e5f5n"));
}

#[test]
fn promotion_on_edge_files_and_ranks() {
    let s = ffa(&with_kings(&["sPa6", "wNb7"]), 'S');
    let mut want = promos("a6", "a7");
    want.extend(promos("a6", "b7"));
    want.sort();
    assert_eq!(moves_from(&s, "a6"), want);
    let w = ffa(&with_kings(&["wPf12", "sNg11"]), 'W');
    let mut want = promos("f12", "g12");
    want.extend(promos("f12", "g11"));
    want.sort();
    assert_eq!(moves_from(&w, "f12"), want);
}

#[test]
fn non_pawn_pieces_never_promote() {
    let s = ffa(&with_kings(&["sRf6"]), 'S');
    assert!(is_legal(&s, "f6f7"));
    assert!(!is_legal(&s, "f6f7q"));
}

// ---------------------------------------------------------------------------
// Castling
// ---------------------------------------------------------------------------

fn castle_check(s: &GameState, seat: Seat, king_mv: &str, rook_from: &str, rook_to: &str) {
    assert_eq!(flag_of(s, king_mv), Some(MoveFlag::Castle), "{king_mv}");
    let mut t = s.clone();
    let ev = play(&mut t, king_mv);
    let m = mv(king_mv);
    assert_eq!(t.piece_at(m.to), piece(seat, PieceKind::King));
    assert_eq!(t.piece_at(m.from), None);
    assert_eq!(t.piece_at(sq(rook_to)), piece(seat, PieceKind::Rook));
    assert_eq!(t.piece_at(sq(rook_from)), None);
    let (rf, rt) = (sq(rook_from), sq(rook_to));
    assert!(has_event(&ev, |e| matches!(
        e,
        GameEvent::Castle { seat: se, rook_from: a, rook_to: b } if *se == seat && *a == rf && *b == rt
    )));
    assert!(t.castling_rights(seat).is_empty());
}

#[test]
fn south_castles_both_sides() {
    let s = build(
        "ffa",
        &["sKg1", "sRc1", "sRj1", "wKa12", "nKl12", "eKl6"],
        "S AAAA Sc1,Sj1 - 0 0",
    );
    castle_check(&s, Seat::South, "g1i1", "j1", "h1");
    castle_check(&s, Seat::South, "g1e1", "c1", "f1");
}

#[test]
fn north_castles_both_sides() {
    let s = build(
        "ffa",
        &["nKg12", "nRc12", "nRj12", "sKa1", "wKa11", "eKl1"],
        "N AAAA Nc12,Nj12 - 0 0",
    );
    castle_check(&s, Seat::North, "g12i12", "j12", "h12");
    castle_check(&s, Seat::North, "g12e12", "c12", "f12");
}

#[test]
fn west_castles_both_sides() {
    let s = build(
        "ffa",
        &["wKa7", "wRa3", "wRa10", "sKa1", "nKl12", "eKl1"],
        "W AAAA Wa3,Wa10 - 0 0",
    );
    castle_check(&s, Seat::West, "a7a9", "a10", "a8");
    castle_check(&s, Seat::West, "a7a5", "a3", "a6");
}

#[test]
fn east_castles_both_sides() {
    let s = build(
        "ffa",
        &["eKl7", "eRl3", "eRl10", "sKa1", "wKa12", "nKl12"],
        "E AAAA El3,El10 - 0 0",
    );
    castle_check(&s, Seat::East, "l7l9", "l10", "l8");
    castle_check(&s, Seat::East, "l7l5", "l3", "l6");
}

#[test]
fn castling_needs_every_between_square_empty() {
    let base = ["sKg1", "sRc1", "sRj1", "wKa12", "nKl12", "eKl6"];
    // Own knight on d1 blocks the long side only.
    let mut p = base.to_vec();
    p.push("sNd1");
    let s = build("ffa", &p, "S AAAA Sc1,Sj1 - 0 0");
    assert!(!is_legal(&s, "g1e1"));
    assert!(is_legal(&s, "g1i1"));
    // Opponent piece on h1 blocks the short side.
    let mut p = base.to_vec();
    p.push("wBh1");
    let s = build("ffa", &p, "S AAAA Sc1,Sj1 - 0 0");
    assert!(!is_legal(&s, "g1i1"));
    assert!(is_legal(&s, "g1e1"));
    // Teammate on i1 blocks the short side (Teams).
    let mut p = base.to_vec();
    p.push("nBi1");
    let s = build("teams", &p, "S AAAA Sc1,Sj1 - 0 0");
    assert!(!is_legal(&s, "g1i1"));
    // A piece beyond the rook (b1) does not block.
    let mut p = base.to_vec();
    p.push("wBb1");
    let s = build("ffa", &p, "S AAAA Sc1,Sj1 - 0 0");
    assert!(is_legal(&s, "g1e1"));
    // West long side: a4 is between a3 and a7.
    let s = build(
        "ffa",
        &["wKa7", "wRa3", "wRa10", "wNa4", "sKa1", "nKl12", "eKl1"],
        "W AAAA Wa3,Wa10 - 0 0",
    );
    assert!(!is_legal(&s, "a7a5"));
    assert!(is_legal(&s, "a7a9"));
}

#[test]
fn castling_allowed_while_attacked_through_and_into_attack() {
    let s = build(
        "ffa",
        &[
            "sKg1", "sRc1", "sRj1", "eRd8", "eRe8", "eRf8", "eRg8", "eRh8", "eRi8", "wKa12",
            "nKl12", "eKl6",
        ],
        "S AAAA Sc1,Sj1 - 0 0",
    );
    assert!(leader_under_attack(&s, Seat::South));
    castle_check(&s, Seat::South, "g1i1", "j1", "h1");
    castle_check(&s, Seat::South, "g1e1", "c1", "f1");
}

#[test]
fn castling_requires_the_right_even_with_pieces_home() {
    let s = build(
        "ffa",
        &["sKg1", "sRc1", "sRj1", "wKa12", "nKl12", "eKl6"],
        "S AAAA Sc1 - 0 0",
    );
    assert!(!is_legal(&s, "g1i1"));
    assert!(is_legal(&s, "g1e1"));
}

#[test]
fn king_move_loses_both_rights_even_after_returning() {
    let mut s = build(
        "ffa",
        &["sKg1", "sRc1", "sRj1", "wKa12", "nKl12", "eKl1"],
        "S AAAA Sc1,Sj1 - 0 0",
    );
    play(&mut s, "g1g2");
    assert!(s.castling_rights(Seat::South).is_empty());
    tempo(&mut s);
    tempo(&mut s);
    tempo(&mut s);
    play(&mut s, "g2g1");
    tempo(&mut s);
    tempo(&mut s);
    tempo(&mut s);
    assert!(!is_legal(&s, "g1i1"));
    assert!(!is_legal(&s, "g1e1"));
}

#[test]
fn rook_move_loses_only_that_side() {
    let mut s = build(
        "ffa",
        &["sKg1", "sRc1", "sRj1", "wKa12", "nKl12", "eKl1"],
        "S AAAA Sc1,Sj1 - 0 0",
    );
    play(&mut s, "j1j2");
    let cr = s.castling_rights(Seat::South);
    assert!(!cr.short && cr.long);
    tempo(&mut s);
    tempo(&mut s);
    tempo(&mut s);
    play(&mut s, "j2j1");
    tempo(&mut s);
    tempo(&mut s);
    tempo(&mut s);
    assert!(!is_legal(&s, "g1i1"));
    assert!(is_legal(&s, "g1e1"));
}

#[test]
fn rook_captured_on_home_square_loses_right_even_if_replaced() {
    // East bishop takes the j1 rook; a different South rook then lands on j1.
    let mut s = build(
        "ffa",
        &[
            "sKg1", "sRc1", "sRj1", "sRj5", "eBl3", "wKa12", "nKl12", "eKl6",
        ],
        "E AAAA Sc1,Sj1 - 0 0",
    );
    play(&mut s, "l3j1");
    assert!(!s.castling_rights(Seat::South).short);
    play(&mut s, "j5j1");
    tempo(&mut s);
    tempo(&mut s);
    // E king l6 is not in a corner: move it manually.
    play(&mut s, "l6l7");
    assert_eq!(s.seat_to_move(), Seat::South);
    assert!(!is_legal(&s, "g1i1"), "castled with a replacement rook");
}

#[test]
fn west_rook_capture_on_home_square_clears_west_right() {
    let mut s = build(
        "ffa",
        &["wKa7", "wRa3", "wRa10", "sKa1", "sRc10", "nKl12", "eKl1"],
        "S AAAA Wa3,Wa10 - 0 0",
    );
    play(&mut s, "c10a10");
    let cr = s.castling_rights(Seat::West);
    assert!(!cr.short && cr.long, "{cr:?}");
}

#[test]
fn stalemated_teams_seat_loses_castling_rights() {
    // South (K g1, R j1, right Sj1) is boxed in by North (teammate) pieces.
    let mut s = build(
        "teams",
        &[
            "sKg1", "sRj1", "nRf1", "nBh1", "nNf2", "nNg2", "nBh2", "nRi1", "nQk1", "nQj2",
            "nKl12", "wKa12", "eKl1",
        ],
        "E AAAA Sj1 - 0 0",
    );
    tempo(&mut s);
    assert_eq!(s.status(Seat::South), SeatStatus::Defeated);
    assert_eq!(
        s.defeats().reason(Seat::South),
        Some(DefeatReason::Stalemate)
    );
    assert!(s.castling_rights(Seat::South).is_empty());
}

// ---------------------------------------------------------------------------
// En passant
// ---------------------------------------------------------------------------

#[test]
fn double_step_creates_target_single_step_does_not() {
    let mut s = ffa(&with_kings(&["sPd2", "sPe2", "wPb6"]), 'S');
    let mut t = s.clone();
    play(&mut t, "e2e3");
    assert_eq!(t.ep_target(Seat::South), None);
    play(&mut s, "d2d4");
    assert_eq!(
        s.ep_target(Seat::South),
        Some(EpTarget {
            skipped: sq("d3"),
            pawn: sq("d4")
        })
    );
    assert!(s.to_position_string().contains(" Sd3 "));
    play(&mut s, "b6d6");
    assert_eq!(
        s.ep_target(Seat::West),
        Some(EpTarget {
            skipped: sq("c6"),
            pawn: sq("d6")
        })
    );
    assert!(
        s.ep_target(Seat::South).is_some(),
        "S target cleared too early"
    );
}

#[test]
fn west_captures_south_en_passant_from_ahead_and_from_behind() {
    for capturer in ["c4", "c2"] {
        let wp = format!("wP{capturer}");
        let mut s = ffa(&with_kings(&["sPd2", wp.as_str()]), 'S');
        play(&mut s, "d2d4");
        let m = format!("{capturer}d3");
        assert_eq!(flag_of(&s, &m), Some(MoveFlag::EnPassant), "{m}");
        let ev = play(&mut s, &m);
        assert_eq!(s.piece_at(sq("d4")), None);
        assert_eq!(s.piece_at(sq("d3")), piece(Seat::West, PieceKind::Pawn));
        assert!(has_event(&ev, |e| matches!(
            e,
            GameEvent::Capture { seat: Seat::West, square, captured }
                if *square == sq("d4") && *captured == Piece { kind: PieceKind::Pawn, owner: Seat::South }
        )));
        assert!(has_event(&ev, |e| matches!(
            e,
            GameEvent::EnPassant { seat: Seat::West, captured_square } if *captured_square == sq("d4")
        )));
    }
}

#[test]
fn south_captures_west_en_passant_three_turns_later() {
    let mut s = ffa(&with_kings(&["wPb5", "sPd4"]), 'W');
    play(&mut s, "b5d5");
    tempo(&mut s); // N
    tempo(&mut s); // E
    assert_eq!(s.seat_to_move(), Seat::South);
    assert!(s.ep_target(Seat::West).is_some());
    assert_eq!(flag_of(&s, "d4c5"), Some(MoveFlag::EnPassant));
    play(&mut s, "d4c5");
    assert_eq!(s.piece_at(sq("d5")), None);
    assert_eq!(s.piece_at(sq("c5")), piece(Seat::South, PieceKind::Pawn));
}

#[test]
fn north_captures_west_en_passant() {
    let mut s = ffa(&with_kings(&["wPb9", "nPd10"]), 'W');
    play(&mut s, "b9d9");
    play(&mut s, "d10c9");
    assert_eq!(s.piece_at(sq("d9")), None);
    assert_eq!(s.piece_at(sq("c9")), piece(Seat::North, PieceKind::Pawn));
}

#[test]
fn east_captures_south_en_passant_two_turns_later() {
    let mut s = ffa(&with_kings(&["sPh2", "ePi4"]), 'S');
    play(&mut s, "h2h4");
    tempo(&mut s); // W
    tempo(&mut s); // N
    play(&mut s, "i4h3");
    assert_eq!(s.piece_at(sq("h4")), None);
    assert_eq!(s.piece_at(sq("h3")), piece(Seat::East, PieceKind::Pawn));
}

#[test]
fn east_captures_north_en_passant() {
    let mut s = ffa(&with_kings(&["nPh11", "ePi11"]), 'N');
    play(&mut s, "h11h9");
    play(&mut s, "i11h10");
    assert_eq!(s.piece_at(sq("h9")), None);
    assert_eq!(s.piece_at(sq("h10")), piece(Seat::East, PieceKind::Pawn));
}

#[test]
fn south_captures_east_en_passant_from_behind() {
    let mut s = ffa(&with_kings(&["ePk5", "sPk4"]), 'E');
    play(&mut s, "k5i5");
    assert_eq!(flag_of(&s, "k4j5"), Some(MoveFlag::EnPassant));
    play(&mut s, "k4j5");
    assert_eq!(s.piece_at(sq("i5")), None);
    assert_eq!(s.piece_at(sq("j5")), piece(Seat::South, PieceKind::Pawn));
}

#[test]
fn west_captures_north_en_passant() {
    let mut s = ffa(&with_kings(&["nPd11", "wPc11"]), 'N');
    play(&mut s, "d11d9");
    tempo(&mut s); // E
    tempo(&mut s); // S
    play(&mut s, "c11d10");
    assert_eq!(s.piece_at(sq("d9")), None);
    assert_eq!(s.piece_at(sq("d10")), piece(Seat::West, PieceKind::Pawn));
}

#[test]
fn en_passant_expires_when_turn_returns_to_owner() {
    let mut s = ffa(&with_kings(&["sPd2", "wPc4"]), 'S');
    play(&mut s, "d2d4");
    tempo(&mut s); // W declines
    tempo(&mut s); // N
    tempo(&mut s); // E
    assert_eq!(s.seat_to_move(), Seat::South);
    assert_eq!(
        s.ep_target(Seat::South),
        None,
        "target live on owner's turn"
    );
    tempo(&mut s); // S
    assert!(!is_legal(&s, "c4d3"));
}

#[test]
fn en_passant_survives_a_frozen_seat_being_skipped() {
    let mut s = build(
        "teams",
        &with_kings(&["sPh2", "ePi4"]),
        "S AFAA - - 0 0 def=Wt",
    );
    play(&mut s, "h2h4");
    assert_eq!(s.seat_to_move(), Seat::North);
    tempo(&mut s);
    assert_eq!(s.seat_to_move(), Seat::East);
    assert!(is_legal(&s, "i4h3"));
}

#[test]
fn en_passant_cleared_when_owner_stops_taking_turns() {
    let mut s = teams(&with_kings(&["sPh2", "ePi4"]), 'S');
    play(&mut s, "h2h4");
    tempo(&mut s); // W
    apply_abandon(&mut s, Seat::South).unwrap();
    assert_eq!(s.status(Seat::South), SeatStatus::Frozen);
    assert_eq!(s.ep_target(Seat::South), None);
    tempo(&mut s); // N
    assert_eq!(s.seat_to_move(), Seat::East);
    assert!(!is_legal(&s, "i4h3"));
    assert_eq!(s.piece_at(sq("h4")), piece(Seat::South, PieceKind::Pawn));
}

#[test]
fn piece_on_skipped_square_blocks_en_passant_normal_capture_only() {
    let mut s = ffa(&with_kings(&["sPh2", "wNg1", "ePi4"]), 'S');
    play(&mut s, "h2h4");
    // A knight landing on the skipped square captures nothing.
    let ev = play(&mut s, "g1h3");
    assert!(!has_event(&ev, |e| matches!(e, GameEvent::Capture { .. })));
    assert_eq!(s.piece_at(sq("h4")), piece(Seat::South, PieceKind::Pawn));
    tempo(&mut s); // N
    assert_eq!(flag_of(&s, "i4h3"), Some(MoveFlag::Normal));
    let ev = play(&mut s, "i4h3");
    assert!(!has_event(&ev, |e| matches!(
        e,
        GameEvent::EnPassant { .. }
    )));
    assert_eq!(s.piece_at(sq("h4")), piece(Seat::South, PieceKind::Pawn));
    assert_eq!(s.piece_count(Seat::West, PieceKind::Knight), 0);
}

#[test]
fn en_passant_needs_the_double_stepped_pawn_still_there() {
    let mut s = ffa(&with_kings(&["sPh2", "wRh10", "ePi4"]), 'S');
    play(&mut s, "h2h4");
    play(&mut s, "h10h4"); // W rook takes the pawn and stands on its square
    tempo(&mut s); // N
    assert!(moves_from(&s, "i4").is_empty());
    assert!(apply_move(&mut s.clone(), mv("i4h3")).is_err());
}

#[test]
fn straight_push_onto_skipped_square_is_not_en_passant() {
    let mut s = ffa(&with_kings(&["sPd2", "wPc3"]), 'S');
    play(&mut s, "d2d4");
    assert_eq!(flag_of(&s, "c3d3"), Some(MoveFlag::Normal));
    let ev = play(&mut s, "c3d3");
    assert!(!has_event(&ev, |e| matches!(e, GameEvent::Capture { .. })));
    assert_eq!(s.piece_at(sq("d4")), piece(Seat::South, PieceKind::Pawn));
}

#[test]
fn pawns_whose_forward_diagonal_misses_the_skipped_square_cannot_take() {
    let mut s = ffa(&with_kings(&["sPd2", "wPe4", "wPe2"]), 'S');
    play(&mut s, "d2d4");
    assert!(!is_legal(&s, "e4d3"));
    assert!(!is_legal(&s, "e2d3"));
    let mut s = ffa(&with_kings(&["sPh2", "ePg4", "ePg2"]), 'S');
    play(&mut s, "h2h4");
    tempo(&mut s);
    tempo(&mut s);
    assert!(!is_legal(&s, "g4h3"));
    assert!(!is_legal(&s, "g2h3"));
}

#[test]
fn en_passant_disabled_by_config_flag() {
    let mut s = build(
        "ffa",
        &with_kings(&["sPd2", "wPc4"]),
        "S AAAA - - 0 0 ep=off",
    );
    play(&mut s, "d2d4");
    assert!(moves_from(&s, "c4").is_empty());
    assert!(apply_move(&mut s.clone(), mv("c4d3")).is_err());
}

#[test]
fn en_passant_onto_promotion_line_must_promote() {
    // West takes North's g11-g9 double step onto g10 (West promotes on g).
    let mut s = ffa(&with_kings(&["nPg11", "wPf9"]), 'N');
    play(&mut s, "g11g9");
    tempo(&mut s); // E
    tempo(&mut s); // S
    assert_eq!(moves_from(&s, "f9"), promos("f9", "g10"));
    play(&mut s, "f9g10q");
    assert_eq!(s.piece_at(sq("g9")), None);
    assert_eq!(s.piece_at(sq("g10")), piece(Seat::West, PieceKind::Queen));

    // South takes West's b7-d7 double step onto c7 (South promotes on rank 7).
    let mut s = ffa(&with_kings(&["wPb7", "sPd6"]), 'W');
    play(&mut s, "b7d7");
    tempo(&mut s); // N
    tempo(&mut s); // E
    assert_eq!(moves_from(&s, "d6"), promos("d6", "c7"));
    let ev = play(&mut s, "d6c7r");
    assert_eq!(s.piece_at(sq("d7")), None);
    assert_eq!(s.piece_at(sq("c7")), piece(Seat::South, PieceKind::Rook));
    assert!(has_event(&ev, |e| matches!(e, GameEvent::EnPassant { .. })));

    // East takes North's f11-f9 double step onto f10 (East promotes on f).
    let mut s = ffa(&with_kings(&["nPf11", "ePg9"]), 'N');
    play(&mut s, "f11f9");
    assert_eq!(moves_from(&s, "g9"), promos("g9", "f10"));
}

#[test]
fn several_en_passant_targets_live_at_once() {
    let mut s = ffa(&with_kings(&["sPh2", "wPb9", "nPd10", "ePi4"]), 'S');
    play(&mut s, "h2h4");
    play(&mut s, "b9d9");
    assert!(s.ep_target(Seat::South).is_some() && s.ep_target(Seat::West).is_some());
    play(&mut s, "d10c9");
    assert_eq!(s.piece_at(sq("d9")), None);
    play(&mut s, "i4h3");
    assert_eq!(s.piece_at(sq("h4")), None);
}

#[test]
fn defeated_teams_seat_double_step_can_be_taken_en_passant() {
    let mut s = build(
        "teams",
        &["sKa1", "nKl12", "eKl1", "wPb5", "sPd4"],
        "W ADAA - - 0 0 def=Wl",
    );
    play(&mut s, "b5d5");
    assert!(s.ep_target(Seat::West).is_some());
    tempo(&mut s); // N
    tempo(&mut s); // E
    assert_eq!(flag_of(&s, "d4c5"), Some(MoveFlag::EnPassant));
}

#[test]
fn engine_ignores_input_flag() {
    // A castle sent with a Normal flag and a normal move sent with a Castle
    // flag must both be resolved by the engine.
    let s = build(
        "ffa",
        &["sKg1", "sRc1", "sRj1", "wKa12", "nKl12", "eKl6"],
        "S AAAA Sc1,Sj1 - 0 0",
    );
    let mut t = s.clone();
    let mut m = mv("g1i1");
    m.flag = MoveFlag::Normal;
    apply_move(&mut t, m).unwrap();
    assert_eq!(t.piece_at(sq("h1")), piece(Seat::South, PieceKind::Rook));
    let mut t = s.clone();
    let mut m = mv("g1h1");
    m.flag = MoveFlag::Castle;
    apply_move(&mut t, m).unwrap();
    assert_eq!(t.piece_at(sq("h1")), piece(Seat::South, PieceKind::King));
    assert_eq!(t.piece_at(sq("j1")), piece(Seat::South, PieceKind::Rook));
}

#[test]
fn en_passant_cleared_when_owner_turn_is_an_automatic_pass() {
    // Teams, West DEFEATED: it double-steps, then has no move and passes on
    // its next turn. The pass reaches West, so its target must be gone.
    let mut s = build(
        "teams",
        &["sKa1", "nKl12", "eKl1", "wPb5", "sPd4", "sNe5"],
        "W ADAA - - 0 0 def=Wl",
    );
    play(&mut s, "b5d5");
    tempo(&mut s); // N
    tempo(&mut s); // E
    assert!(is_legal(&s, "d4c5"));
    let ev = play(&mut s, "a1a2"); // S declines; West then auto-passes
    assert!(has_event(&ev, |e| matches!(
        e,
        GameEvent::Pass { seat: Seat::West }
    )));
    assert_eq!(s.ep_target(Seat::West), None);
    tempo(&mut s); // N
    tempo(&mut s); // E
    assert_eq!(s.seat_to_move(), Seat::South);
    assert!(!is_legal(&s, "d4c5"));
}

#[test]
fn castling_blocked_by_piece_on_leader_or_rook_destination() {
    for blocker in ["sNe1", "wNf1", "sNi1", "wNh1"] {
        let s = build(
            "ffa",
            &["sKg1", "sRc1", "sRj1", "wKa12", "nKl12", "eKl6", blocker],
            "S AAAA Sc1,Sj1 - 0 0",
        );
        let long_blocked = blocker.ends_with("e1") || blocker.ends_with("f1");
        assert_eq!(is_legal(&s, "g1e1"), !long_blocked, "{blocker}");
        assert_eq!(is_legal(&s, "g1i1"), long_blocked, "{blocker}");
    }
}

#[test]
fn pawn_attack_squares_follow_seat_orientation() {
    let s = ffa(&with_kings(&["sPe4", "nPe9", "wPc6", "ePj6"]), 'S');
    let att = |q: &str, by: Seat| is_square_attacked_by(&s, sq(q), by);
    assert!(att("d5", Seat::South) && att("f5", Seat::South));
    assert!(!att("e5", Seat::South) && !att("d3", Seat::South));
    assert!(att("d8", Seat::North) && att("f8", Seat::North));
    assert!(!att("d10", Seat::North) && !att("e8", Seat::North));
    assert!(att("d7", Seat::West) && att("d5", Seat::West));
    assert!(!att("b7", Seat::West) && !att("d6", Seat::West));
    assert!(att("i7", Seat::East) && att("i5", Seat::East));
    assert!(!att("k7", Seat::East) && !att("i6", Seat::East));
}

#[test]
fn teammate_does_not_make_leader_under_attack() {
    let p = ["sKe4", "nRe10", "wKa12", "nKl12", "eKl1"];
    assert!(!leader_under_attack(&teams(&p, 'S'), Seat::South));
    assert!(leader_under_attack(&ffa(&p, 'S'), Seat::South));
}

#[test]
fn frozen_pieces_block_can_be_captured_by_opponents_but_not_teammates() {
    // North FROZEN (teammate of South), West FROZEN (opponent).
    let s = build(
        "teams",
        &["sKa1", "sRe4", "nNe7", "wNh4", "wKa12", "nKl12", "eKl1"],
        "S AFFA - - 0 0 def=Wt,Nt",
    );
    let m = moves_from(&s, "e4");
    assert!(m.contains(&"e4h4".to_string()), "{m:?}");
    assert!(!m.contains(&"e4e7".to_string()), "{m:?}");
    assert!(!m.contains(&"e4e8".to_string()), "{m:?}");
    assert!(!m.contains(&"e4i4".to_string()), "{m:?}");
}
