//! Adversarial movement tests derived from PLAN §2 (rules version 2, 16×16):
//! pawn directions for all four seats, knights/sliders at edges and in the
//! 4x4 corners, promotion lines and choices, castling geometry and rights,
//! en passant, teammates, and self-check legality.

mod common;

use common::*;
use rules_core::*;

/// Kings parked in the four corners (S a1, W a16, N p16, E p1).
const KINGS: [&str; 4] = ["sKa1", "wKa16", "nKp16", "eKp1"];

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

/// Like [`ffa`] with en passant on (it is off from rules version 3).
fn ffa_ep(pieces: &[&str], to_move: char) -> GameState {
    build("ffa", pieces, &format!("{to_move} AAAA - - 0 0 ep=on"))
}

/// Like [`teams`] with en passant on (it is off from rules version 3).
fn teams_ep(pieces: &[&str], to_move: char) -> GameState {
    build("teams", pieces, &format!("{to_move} AAAA - - 0 0 ep=on"))
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

/// A quiet king move inside the king's own 4x4 corner for the seat to move.
fn tempo(s: &mut GameState) {
    let seat = s.seat_to_move();
    let (k, _) = s
        .pieces_of(seat)
        .find(|(_, p)| p.kind == PieceKind::King)
        .expect("tempo seat has a king");
    let in_corner = |q: Square| (q.file() < 4 || q.file() > 11) && (q.rank() < 4 || q.rank() > 11);
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
    let s = ffa(&with_kings(&["sPg7", "eNf8", "eNh8", "eNf6", "eNh6"]), 'S');
    assert_eq!(moves_from(&s, "g7"), strs(&["g7g8", "g7f8", "g7h8"]));
}

#[test]
fn north_pawn_pushes_south_and_captures_diagonally_forward_only() {
    let s = ffa(
        &with_kings(&["nPg10", "sNf9", "sNh9", "sNf11", "sNh11"]),
        'N',
    );
    assert_eq!(moves_from(&s, "g10"), strs(&["g10g9", "g10f9", "g10h9"]));
}

#[test]
fn west_pawn_pushes_east_and_captures_diagonally_forward_only() {
    let s = ffa(&with_kings(&["wPg7", "nNh8", "nNh6", "nNf8", "nNf6"]), 'W');
    assert_eq!(moves_from(&s, "g7"), strs(&["g7h7", "g7h8", "g7h6"]));
}

#[test]
fn east_pawn_pushes_west_and_captures_diagonally_forward_only() {
    let s = ffa(&with_kings(&["ePj7", "sNi8", "sNi6", "sNk8", "sNk6"]), 'E');
    assert_eq!(moves_from(&s, "j7"), strs(&["j7i7", "j7i8", "j7i6"]));
}

#[test]
fn double_step_only_from_start_line_for_every_seat() {
    let pieces = with_kings(&[
        "sPg2", "sPh3", "nPg15", "nPh14", "wPb8", "wPc9", "ePo8", "ePn9",
    ]);
    let s = ffa(&pieces, 'S');
    assert_eq!(moves_from(&s, "g2"), strs(&["g2g3", "g2g4"]));
    assert_eq!(moves_from(&s, "h3"), strs(&["h3h4"]));
    let n = ffa(&pieces, 'N');
    assert_eq!(moves_from(&n, "g15"), strs(&["g15g14", "g15g13"]));
    assert_eq!(moves_from(&n, "h14"), strs(&["h14h13"]));
    let w = ffa(&pieces, 'W');
    assert_eq!(moves_from(&w, "b8"), strs(&["b8c8", "b8d8"]));
    assert_eq!(moves_from(&w, "c9"), strs(&["c9d9"]));
    let e = ffa(&pieces, 'E');
    assert_eq!(moves_from(&e, "o8"), strs(&["o8n8", "o8m8"]));
    assert_eq!(moves_from(&e, "n9"), strs(&["n9m9"]));
}

#[test]
fn double_step_needs_both_squares_empty() {
    let s = ffa(
        &with_kings(&[
            "sPg2", "wNg4", "sPj2", "wNj3", "wPb8", "sNd8", "wPb13", "sNc13",
        ]),
        'S',
    );
    assert_eq!(moves_from(&s, "g2"), strs(&["g2g3"]));
    assert!(moves_from(&s, "j2").is_empty());
    let w = ffa(
        &with_kings(&[
            "sPg2", "wNg4", "sPj2", "wNj3", "wPb8", "sNd8", "wPb13", "sNc13",
        ]),
        'W',
    );
    assert_eq!(moves_from(&w, "b8"), strs(&["b8c8"]));
    assert!(moves_from(&w, "b13").is_empty());
}

#[test]
fn pawns_never_capture_straight_ahead_or_backward() {
    let s = ffa(&with_kings(&["sPg7", "wNg8", "wNf6", "wNh6"]), 'S');
    assert!(moves_from(&s, "g7").is_empty());
    let w = ffa(&with_kings(&["wPg7", "sNh7", "sNf6", "sNf8"]), 'W');
    assert!(moves_from(&w, "g7").is_empty());
    let n = ffa(&with_kings(&["nPg10", "sNg9", "sNf11", "sNh11"]), 'N');
    assert!(moves_from(&n, "g10").is_empty());
    let e = ffa(&with_kings(&["ePj7", "sNi7", "sNk6", "sNk8"]), 'E');
    assert!(moves_from(&e, "j7").is_empty());
}

#[test]
fn pawn_captures_do_not_wrap_around_board_edges() {
    // a6 - 1 file would wrap to p-file squares in a naive index scheme.
    let s = ffa(&with_kings(&["sPa6", "wNb7", "wNp6", "wNp7", "wNp5"]), 'S');
    assert_eq!(moves_from(&s, "a6"), strs(&["a6a7", "a6b7"]));
    let s = ffa(&with_kings(&["sPp6", "wNo7", "wNa8", "wNa7"]), 'S');
    assert_eq!(moves_from(&s, "p6"), strs(&["p6p7", "p6o7"]));
    // West pawn on the top edge: only one capture diagonal exists.
    let w = ffa(&with_kings(&["wPf16", "sNg15", "sNg1"]), 'W');
    assert_eq!(moves_from(&w, "f16"), strs(&["f16g16", "f16g15"]));
    // East pawn on the bottom edge.
    let e = ffa(&with_kings(&["ePk1", "sNj2", "sNj16"]), 'E');
    assert_eq!(moves_from(&e, "k1"), strs(&["k1j1", "k1j2"]));
}

// ---------------------------------------------------------------------------
// Knights, sliders and kings near edges and in the 4x4 corners
// ---------------------------------------------------------------------------

#[test]
fn knights_in_corners_and_on_edges() {
    let s = ffa(
        &[
            "sNa1", "sNb2", "sNp16", "sNa8", "sNp8", "sNb1", "sKh12", "wKk5", "nKe12", "eKl10",
        ],
        'S',
    );
    assert_eq!(moves_from(&s, "a1"), strs(&["a1b3", "a1c2"]));
    assert_eq!(
        moves_from(&s, "b2"),
        strs(&["b2a4", "b2c4", "b2d3", "b2d1"])
    );
    assert_eq!(moves_from(&s, "p16"), strs(&["p16o14", "p16n15"]));
    assert_eq!(
        moves_from(&s, "a8"),
        strs(&["a8b10", "a8b6", "a8c9", "a8c7"])
    );
    assert_eq!(
        moves_from(&s, "p8"),
        strs(&["p8o10", "p8o6", "p8n9", "p8n7"])
    );
    assert_eq!(moves_from(&s, "b1"), strs(&["b1a3", "b1c3", "b1d2"]));
}

const FAR_KINGS: [&str; 4] = ["sKh8", "wKj11", "nKf5", "eKl12"];

fn far(extra: &str) -> GameState {
    let mut v: Vec<&str> = FAR_KINGS.to_vec();
    v.push(extra);
    ffa(&v, 'S')
}

#[test]
fn rook_in_corner_slides_along_both_full_edges() {
    let s = far("sRa1");
    let m = moves_from(&s, "a1");
    assert_eq!(m.len(), 30, "{m:?}"); // a2..a16 and b1..p1
    assert!(m.contains(&"a1a16".to_string()) && m.contains(&"a1p1".to_string()));
}

#[test]
fn rook_on_right_edge_does_not_wrap() {
    let s = far("sRp7");
    let m = moves_from(&s, "p7");
    assert_eq!(m.len(), 30, "{m:?}"); // p1..p16 except p7, and a7..o7
    assert!(
        m.iter()
            .all(|x| x[2..].starts_with('p') || x[2..].ends_with('7') && x.len() == 4)
    );
}

#[test]
fn bishop_and_queen_long_lines_from_corners() {
    let s = far("sBp1");
    let m = moves_from(&s, "p1");
    assert_eq!(m.len(), 15, "{m:?}"); // o2..a16
    assert!(m.contains(&"p1a16".to_string()));
    let s = far("sQa16");
    let m = moves_from(&s, "a16");
    assert_eq!(m.len(), 45, "{m:?}"); // 15 down, 15 across, 15 diagonal
    assert!(m.contains(&"a16p1".to_string()));
}

#[test]
fn king_in_each_corner_has_three_moves() {
    let s = ffa(&["sKa1", "wKa16", "nKp16", "eKp1"], 'S');
    assert_eq!(moves_from(&s, "a1"), strs(&["a1a2", "a1b1", "a1b2"]));
    let n = ffa(&["sKa1", "wKa16", "nKp16", "eKp1"], 'N');
    assert_eq!(moves_from(&n, "p16"), strs(&["p16o16", "p16p15", "p16o15"]));
}

#[test]
fn start_position_corner_squares_are_reachable() {
    let s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    assert!(is_legal(&s, "e1a1"));
    assert!(is_legal(&s, "l1p1"));
    assert!(is_legal(&s, "f1d2"));
    let mut s2 = s;
    play(&mut s2, "f1d2");
    assert_eq!(s2.piece_at(sq("d2")), piece(Seat::South, PieceKind::Knight));
    // The knight can continue into the 4x4 corner.
    for m in ["b6c6", "f15f14", "o6n6"] {
        play(&mut s2, m);
    }
    assert!(is_legal(&s2, "d2b1"));
    assert!(is_legal(&s2, "d2b3"));
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
    let p = with_kings(&["sPg7", "nNf8", "wNh8"]);
    assert_eq!(moves_from(&teams(&p, 'S'), "g7"), strs(&["g7g8", "g7h8"]));
    assert_eq!(
        moves_from(&ffa(&p, 'S'), "g7"),
        strs(&["g7g8", "g7h8", "g7f8"])
    );
}

#[test]
fn teams_knight_and_king_cannot_capture_teammate() {
    let p = [
        "sNe5", "nRg6", "wRf7", "sKi8", "nRi9", "wRj9", "wKa16", "nKp16", "eKp1",
    ];
    let s = teams(&p, 'S');
    let n = moves_from(&s, "e5");
    assert!(n.contains(&"e5f7".to_string()));
    assert!(!n.contains(&"e5g6".to_string()));
    let k = moves_from(&s, "i8");
    assert!(k.contains(&"i8j9".to_string()));
    assert!(!k.contains(&"i8i9".to_string()));
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
    let mut s = ffa(&["sKg7", "eRh16", "wKa16", "nKp16", "eKp1"], 'S');
    assert!(is_legal(&s, "g7h7"));
    play(&mut s, "g7h7");
    assert!(leader_under_attack(&s, Seat::South));
}

#[test]
fn pinned_piece_may_move_and_attacked_king_may_be_ignored() {
    let s = ffa(
        &["sKg6", "sBg7", "eRg12", "sPe5", "wKa16", "nKp16", "eKp1"],
        'S',
    );
    assert!(is_legal(&s, "g7h8"));
    let mut s2 = s.clone();
    play(&mut s2, "g7h8");
    assert!(is_square_attacked_by(&s2, sq("g6"), Seat::East));

    // King already attacked: a pawn move elsewhere is still legal.
    let s = ffa(&["sKg6", "eRg12", "sPe5", "wKa16", "nKp16", "eKp1"], 'S');
    assert!(leader_under_attack(&s, Seat::South));
    assert!(is_legal(&s, "e5e6"));
}

#[test]
fn king_may_step_next_to_enemy_king() {
    let s = ffa(&["sKg7", "wKg9", "nKp16", "eKp1"], 'S');
    assert!(is_legal(&s, "g7g8"));
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

#[test]
fn south_promotes_on_rank_9_to_q_r_b_n_only() {
    let s = ffa(&with_kings(&["sPh8"]), 'S');
    assert_eq!(moves_from(&s, "h8"), promos("h8", "h9"));
    for bad in ["h8h9", "h8h9k", "h8h9p"] {
        let mut t = s.clone();
        assert!(apply_move(&mut t, mv(bad)).is_err(), "{bad} accepted");
        assert_eq!(t, s, "state changed by rejected {bad}");
    }
    let mut t = s.clone();
    let ev = play(&mut t, "h8h9n");
    assert_eq!(t.piece_at(sq("h9")), piece(Seat::South, PieceKind::Knight));
    assert_eq!(t.piece_at(sq("h8")), None);
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
fn north_promotes_on_rank_8() {
    let s = ffa(&with_kings(&["nPh9"]), 'N');
    assert_eq!(moves_from(&s, "h9"), promos("h9", "h8"));
    assert!(!is_legal(&s, "h9h8"));
    let mut t = s.clone();
    play(&mut t, "h9h8r");
    assert_eq!(t.piece_at(sq("h8")), piece(Seat::North, PieceKind::Rook));
}

#[test]
fn west_promotes_on_file_i() {
    let s = ffa(&with_kings(&["wPh7"]), 'W');
    assert_eq!(moves_from(&s, "h7"), promos("h7", "i7"));
    assert!(!is_legal(&s, "h7i7"));
    let mut t = s.clone();
    play(&mut t, "h7i7b");
    assert_eq!(t.piece_at(sq("i7")), piece(Seat::West, PieceKind::Bishop));
}

#[test]
fn east_promotes_on_file_h() {
    let s = ffa(&with_kings(&["ePi7"]), 'E');
    assert_eq!(moves_from(&s, "i7"), promos("i7", "h7"));
    assert!(!is_legal(&s, "i7h7"));
    let mut t = s.clone();
    play(&mut t, "i7h7q");
    assert_eq!(t.piece_at(sq("h7")), piece(Seat::East, PieceKind::Queen));
}

#[test]
fn capture_promotions_offer_all_four_pieces_per_target() {
    let s = ffa(&with_kings(&["sPg8", "wNf9", "eNh9"]), 'S');
    let mut want = promos("g8", "g9");
    want.extend(promos("g8", "f9"));
    want.extend(promos("g8", "h9"));
    want.sort();
    assert_eq!(moves_from(&s, "g8"), want);
    let e = ffa(&with_kings(&["ePi7", "sNh8", "sNh6", "sNh7"]), 'E');
    let mut want = promos("i7", "h8");
    want.extend(promos("i7", "h6"));
    want.sort();
    assert_eq!(moves_from(&e, "i7"), want);
}

#[test]
fn no_promotion_before_the_line_and_letter_rejected_there() {
    let s = ffa(&with_kings(&["sPg7", "sPe5"]), 'S');
    assert_eq!(moves_from(&s, "g7"), strs(&["g7g8"]));
    assert!(!is_legal(&s, "g7g8q"));
    assert!(!is_legal(&s, "e5e6q"));
    let w = ffa(&with_kings(&["wPg7"]), 'W');
    assert_eq!(moves_from(&w, "g7"), strs(&["g7h7"]));
    assert!(!is_legal(&w, "g7h7n"));
}

#[test]
fn promotion_on_edge_files_and_ranks() {
    let s = ffa(&with_kings(&["sPa8", "wNb9"]), 'S');
    let mut want = promos("a8", "a9");
    want.extend(promos("a8", "b9"));
    want.sort();
    assert_eq!(moves_from(&s, "a8"), want);
    let w = ffa(&with_kings(&["wPh16", "sNi15"]), 'W');
    let mut want = promos("h16", "i16");
    want.extend(promos("h16", "i15"));
    want.sort();
    assert_eq!(moves_from(&w, "h16"), want);
}

#[test]
fn non_pawn_pieces_never_promote() {
    let s = ffa(&with_kings(&["sRh8"]), 'S');
    assert!(is_legal(&s, "h8h9"));
    assert!(!is_legal(&s, "h8h9q"));
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
        &["sKi1", "sRe1", "sRl1", "wKa16", "nKp16", "eKp8"],
        "S AAAA Se1,Sl1 - 0 0",
    );
    castle_check(&s, Seat::South, "i1k1", "l1", "j1");
    castle_check(&s, Seat::South, "i1g1", "e1", "h1");
}

#[test]
fn north_castles_both_sides() {
    let s = build(
        "ffa",
        &["nKi16", "nRe16", "nRl16", "sKa1", "wKa15", "eKp1"],
        "N AAAA Ne16,Nl16 - 0 0",
    );
    castle_check(&s, Seat::North, "i16k16", "l16", "j16");
    castle_check(&s, Seat::North, "i16g16", "e16", "h16");
}

#[test]
fn west_castles_both_sides() {
    let s = build(
        "ffa",
        &["wKa9", "wRa5", "wRa12", "sKa1", "nKp16", "eKp1"],
        "W AAAA Wa5,Wa12 - 0 0",
    );
    castle_check(&s, Seat::West, "a9a11", "a12", "a10");
    castle_check(&s, Seat::West, "a9a7", "a5", "a8");
}

#[test]
fn east_castles_both_sides() {
    let s = build(
        "ffa",
        &["eKp9", "eRp5", "eRp12", "sKa1", "wKa16", "nKp16"],
        "E AAAA Ep5,Ep12 - 0 0",
    );
    castle_check(&s, Seat::East, "p9p11", "p12", "p10");
    castle_check(&s, Seat::East, "p9p7", "p5", "p8");
}

#[test]
fn castling_needs_every_between_square_empty() {
    let base = ["sKi1", "sRe1", "sRl1", "wKa16", "nKp16", "eKp8"];
    // Own knight on f1 blocks the long side only.
    let mut p = base.to_vec();
    p.push("sNf1");
    let s = build("ffa", &p, "S AAAA Se1,Sl1 - 0 0");
    assert!(!is_legal(&s, "i1g1"));
    assert!(is_legal(&s, "i1k1"));
    // Opponent piece on j1 blocks the short side.
    let mut p = base.to_vec();
    p.push("wBj1");
    let s = build("ffa", &p, "S AAAA Se1,Sl1 - 0 0");
    assert!(!is_legal(&s, "i1k1"));
    assert!(is_legal(&s, "i1g1"));
    // Teammate on k1 blocks the short side (Teams).
    let mut p = base.to_vec();
    p.push("nBk1");
    let s = build("teams", &p, "S AAAA Se1,Sl1 - 0 0");
    assert!(!is_legal(&s, "i1k1"));
    // A piece beyond the rook (b1) does not block.
    let mut p = base.to_vec();
    p.push("wBb1");
    let s = build("ffa", &p, "S AAAA Se1,Sl1 - 0 0");
    assert!(is_legal(&s, "i1g1"));
    // West long side: a6 is between a5 and a9.
    let s = build(
        "ffa",
        &["wKa9", "wRa5", "wRa12", "wNa6", "sKa1", "nKp16", "eKp1"],
        "W AAAA Wa5,Wa12 - 0 0",
    );
    assert!(!is_legal(&s, "a9a7"));
    assert!(is_legal(&s, "a9a11"));
}

#[test]
fn castling_allowed_while_attacked_through_and_into_attack() {
    let s = build(
        "ffa",
        &[
            "sKi1", "sRe1", "sRl1", "eRf10", "eRg10", "eRh10", "eRi10", "eRj10", "eRk10", "wKa16",
            "nKp16", "eKp8",
        ],
        "S AAAA Se1,Sl1 - 0 0",
    );
    assert!(leader_under_attack(&s, Seat::South));
    castle_check(&s, Seat::South, "i1k1", "l1", "j1");
    castle_check(&s, Seat::South, "i1g1", "e1", "h1");
}

#[test]
fn castling_requires_the_right_even_with_pieces_home() {
    let s = build(
        "ffa",
        &["sKi1", "sRe1", "sRl1", "wKa16", "nKp16", "eKp8"],
        "S AAAA Se1 - 0 0",
    );
    assert!(!is_legal(&s, "i1k1"));
    assert!(is_legal(&s, "i1g1"));
}

#[test]
fn king_move_loses_both_rights_even_after_returning() {
    let mut s = build(
        "ffa",
        &["sKi1", "sRe1", "sRl1", "wKa16", "nKp16", "eKp1"],
        "S AAAA Se1,Sl1 - 0 0",
    );
    play(&mut s, "i1i2");
    assert!(s.castling_rights(Seat::South).is_empty());
    tempo(&mut s);
    tempo(&mut s);
    tempo(&mut s);
    play(&mut s, "i2i1");
    tempo(&mut s);
    tempo(&mut s);
    tempo(&mut s);
    assert!(!is_legal(&s, "i1k1"));
    assert!(!is_legal(&s, "i1g1"));
}

#[test]
fn rook_move_loses_only_that_side() {
    let mut s = build(
        "ffa",
        &["sKi1", "sRe1", "sRl1", "wKa16", "nKp16", "eKp1"],
        "S AAAA Se1,Sl1 - 0 0",
    );
    play(&mut s, "l1l2");
    let cr = s.castling_rights(Seat::South);
    assert!(!cr.short && cr.long);
    tempo(&mut s);
    tempo(&mut s);
    tempo(&mut s);
    play(&mut s, "l2l1");
    tempo(&mut s);
    tempo(&mut s);
    tempo(&mut s);
    assert!(!is_legal(&s, "i1k1"));
    assert!(is_legal(&s, "i1g1"));
}

#[test]
fn rook_captured_on_home_square_loses_right_even_if_replaced() {
    // East bishop takes the l1 rook; a different South rook then lands on l1.
    let mut s = build(
        "ffa",
        &[
            "sKi1", "sRe1", "sRl1", "sRl7", "eBp5", "wKa16", "nKp16", "eKp8",
        ],
        "E AAAA Se1,Sl1 - 0 0",
    );
    play(&mut s, "p5l1");
    assert!(!s.castling_rights(Seat::South).short);
    play(&mut s, "l7l1");
    tempo(&mut s);
    tempo(&mut s);
    // E king p8 is not in a corner: move it manually.
    play(&mut s, "p8p9");
    assert_eq!(s.seat_to_move(), Seat::South);
    assert!(!is_legal(&s, "i1k1"), "castled with a replacement rook");
}

#[test]
fn west_rook_capture_on_home_square_clears_west_right() {
    let mut s = build(
        "ffa",
        &["wKa9", "wRa5", "wRa12", "sKa1", "sRe12", "nKp16", "eKp1"],
        "S AAAA Wa5,Wa12 - 0 0",
    );
    play(&mut s, "e12a12");
    let cr = s.castling_rights(Seat::West);
    assert!(!cr.short && cr.long, "{cr:?}");
}

#[test]
fn stalemated_teams_seat_loses_castling_rights() {
    // South (K i1, R l1, right Sl1) is boxed in by North (teammate) pieces.
    let mut s = build(
        "teams",
        &[
            "sKi1", "sRl1", "nRh1", "nBj1", "nNh2", "nNi2", "nBj2", "nRk1", "nQm1", "nQl2",
            "nKp16", "wKa16", "eKp1",
        ],
        "E AAAA Sl1 - 0 0",
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
    let mut s = ffa_ep(&with_kings(&["sPd2", "sPg2", "wPb8"]), 'S');
    let mut t = s.clone();
    play(&mut t, "g2g3");
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
    play(&mut s, "b8d8");
    assert_eq!(
        s.ep_target(Seat::West),
        Some(EpTarget {
            skipped: sq("c8"),
            pawn: sq("d8")
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
        let mut s = ffa_ep(&with_kings(&["sPd2", wp.as_str()]), 'S');
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
    let mut s = ffa_ep(&with_kings(&["wPb5", "sPd4"]), 'W');
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
    let mut s = ffa_ep(&with_kings(&["wPb13", "nPd14"]), 'W');
    play(&mut s, "b13d13");
    play(&mut s, "d14c13");
    assert_eq!(s.piece_at(sq("d13")), None);
    assert_eq!(s.piece_at(sq("c13")), piece(Seat::North, PieceKind::Pawn));
}

#[test]
fn east_captures_south_en_passant_two_turns_later() {
    let mut s = ffa_ep(&with_kings(&["sPl2", "ePm4"]), 'S');
    play(&mut s, "l2l4");
    tempo(&mut s); // W
    tempo(&mut s); // N
    play(&mut s, "m4l3");
    assert_eq!(s.piece_at(sq("l4")), None);
    assert_eq!(s.piece_at(sq("l3")), piece(Seat::East, PieceKind::Pawn));
}

#[test]
fn east_captures_north_en_passant() {
    let mut s = ffa_ep(&with_kings(&["nPl15", "ePm15"]), 'N');
    play(&mut s, "l15l13");
    play(&mut s, "m15l14");
    assert_eq!(s.piece_at(sq("l13")), None);
    assert_eq!(s.piece_at(sq("l14")), piece(Seat::East, PieceKind::Pawn));
}

#[test]
fn south_captures_east_en_passant_from_behind() {
    let mut s = ffa_ep(&with_kings(&["ePo5", "sPo4"]), 'E');
    play(&mut s, "o5m5");
    assert_eq!(flag_of(&s, "o4n5"), Some(MoveFlag::EnPassant));
    play(&mut s, "o4n5");
    assert_eq!(s.piece_at(sq("m5")), None);
    assert_eq!(s.piece_at(sq("n5")), piece(Seat::South, PieceKind::Pawn));
}

#[test]
fn west_captures_north_en_passant() {
    let mut s = ffa_ep(&with_kings(&["nPd15", "wPc15"]), 'N');
    play(&mut s, "d15d13");
    tempo(&mut s); // E
    tempo(&mut s); // S
    play(&mut s, "c15d14");
    assert_eq!(s.piece_at(sq("d13")), None);
    assert_eq!(s.piece_at(sq("d14")), piece(Seat::West, PieceKind::Pawn));
}

#[test]
fn en_passant_expires_when_turn_returns_to_owner() {
    let mut s = ffa_ep(&with_kings(&["sPd2", "wPc4"]), 'S');
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
        &with_kings(&["sPl2", "ePm4"]),
        "S AFAA - - 0 0 def=Wt ep=on",
    );
    play(&mut s, "l2l4");
    assert_eq!(s.seat_to_move(), Seat::North);
    tempo(&mut s);
    assert_eq!(s.seat_to_move(), Seat::East);
    assert!(is_legal(&s, "m4l3"));
}

#[test]
fn en_passant_cleared_when_owner_stops_taking_turns() {
    let mut s = teams_ep(&with_kings(&["sPj2", "ePm4"]), 'S');
    play(&mut s, "j2j4");
    tempo(&mut s); // W
    apply_abandon(&mut s, Seat::South).unwrap();
    assert_eq!(s.status(Seat::South), SeatStatus::Frozen);
    assert_eq!(s.ep_target(Seat::South), None);
    tempo(&mut s); // N
    assert_eq!(s.seat_to_move(), Seat::East);
    assert!(!is_legal(&s, "m4j3"));
    assert_eq!(s.piece_at(sq("j4")), piece(Seat::South, PieceKind::Pawn));
}

#[test]
fn piece_on_skipped_square_blocks_en_passant_normal_capture_only() {
    let mut s = ffa_ep(&with_kings(&["sPl2", "wNk1", "ePm4"]), 'S');
    play(&mut s, "l2l4");
    // A knight landing on the skipped square captures nothing.
    let ev = play(&mut s, "k1l3");
    assert!(!has_event(&ev, |e| matches!(e, GameEvent::Capture { .. })));
    assert_eq!(s.piece_at(sq("l4")), piece(Seat::South, PieceKind::Pawn));
    tempo(&mut s); // N
    assert_eq!(flag_of(&s, "m4l3"), Some(MoveFlag::Normal));
    let ev = play(&mut s, "m4l3");
    assert!(!has_event(&ev, |e| matches!(
        e,
        GameEvent::EnPassant { .. }
    )));
    assert_eq!(s.piece_at(sq("l4")), piece(Seat::South, PieceKind::Pawn));
    assert_eq!(s.piece_count(Seat::West, PieceKind::Knight), 0);
}

#[test]
fn en_passant_needs_the_double_stepped_pawn_still_there() {
    let mut s = ffa_ep(&with_kings(&["sPh2", "wRh10", "ePi4"]), 'S');
    play(&mut s, "h2h4");
    play(&mut s, "h10h4"); // W rook takes the pawn and stands on its square
    tempo(&mut s); // N
    assert!(moves_from(&s, "i4").is_empty());
    assert!(apply_move(&mut s.clone(), mv("i4h3")).is_err());
}

#[test]
fn straight_push_onto_skipped_square_is_not_en_passant() {
    let mut s = ffa_ep(&with_kings(&["sPd2", "wPc3"]), 'S');
    play(&mut s, "d2d4");
    assert_eq!(flag_of(&s, "c3d3"), Some(MoveFlag::Normal));
    let ev = play(&mut s, "c3d3");
    assert!(!has_event(&ev, |e| matches!(e, GameEvent::Capture { .. })));
    assert_eq!(s.piece_at(sq("d4")), piece(Seat::South, PieceKind::Pawn));
}

#[test]
fn pawns_whose_forward_diagonal_misses_the_skipped_square_cannot_take() {
    let mut s = ffa_ep(&with_kings(&["sPd2", "wPg4", "wPg2"]), 'S');
    play(&mut s, "d2d4");
    assert!(!is_legal(&s, "g4d3"));
    assert!(!is_legal(&s, "g2d3"));
    let mut s = ffa_ep(&with_kings(&["sPj2", "ePi4", "ePi2"]), 'S');
    play(&mut s, "j2j4");
    tempo(&mut s);
    tempo(&mut s);
    assert!(!is_legal(&s, "i4j3"));
    assert!(!is_legal(&s, "i2j3"));
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
    // West takes North's i15-i13 double step onto i14 (West promotes on i).
    let mut s = ffa_ep(&with_kings(&["nPi15", "wPh13"]), 'N');
    play(&mut s, "i15i13");
    tempo(&mut s); // E
    tempo(&mut s); // S
    assert_eq!(moves_from(&s, "h13"), promos("h13", "i14"));
    play(&mut s, "h13i14q");
    assert_eq!(s.piece_at(sq("i13")), None);
    assert_eq!(s.piece_at(sq("i14")), piece(Seat::West, PieceKind::Queen));

    // South takes West's b9-d9 double step onto c9 (South promotes on rank 9).
    let mut s = ffa_ep(&with_kings(&["wPb9", "sPd8"]), 'W');
    play(&mut s, "b9d9");
    tempo(&mut s); // N
    tempo(&mut s); // E
    assert_eq!(moves_from(&s, "d8"), promos("d8", "c9"));
    let ev = play(&mut s, "d8c9r");
    assert_eq!(s.piece_at(sq("d9")), None);
    assert_eq!(s.piece_at(sq("c9")), piece(Seat::South, PieceKind::Rook));
    assert!(has_event(&ev, |e| matches!(e, GameEvent::EnPassant { .. })));

    // East takes North's h15-h13 double step onto h14 (East promotes on h).
    let mut s = ffa_ep(&with_kings(&["nPh15", "ePi13"]), 'N');
    play(&mut s, "h15h13");
    assert_eq!(moves_from(&s, "i13"), promos("i13", "h14"));
}

#[test]
fn several_en_passant_targets_live_at_once() {
    let mut s = ffa_ep(&with_kings(&["sPl2", "wPb13", "nPd14", "ePm4"]), 'S');
    play(&mut s, "l2l4");
    play(&mut s, "b13d13");
    assert!(s.ep_target(Seat::South).is_some() && s.ep_target(Seat::West).is_some());
    play(&mut s, "d14c13");
    assert_eq!(s.piece_at(sq("d13")), None);
    play(&mut s, "m4l3");
    assert_eq!(s.piece_at(sq("l4")), None);
}

#[test]
fn defeated_teams_seat_double_step_can_be_taken_en_passant() {
    let mut s = build(
        "teams",
        &["sKa1", "nKl12", "eKl1", "wPb5", "sPd4"],
        "W ADAA - - 0 0 def=Wl ep=on",
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
        &["sKi1", "sRe1", "sRl1", "wKa16", "nKp16", "eKp8"],
        "S AAAA Se1,Sl1 - 0 0",
    );
    let mut t = s.clone();
    let mut m = mv("i1k1");
    m.flag = MoveFlag::Normal;
    apply_move(&mut t, m).unwrap();
    assert_eq!(t.piece_at(sq("j1")), piece(Seat::South, PieceKind::Rook));
    let mut t = s.clone();
    let mut m = mv("i1j1");
    m.flag = MoveFlag::Castle;
    apply_move(&mut t, m).unwrap();
    assert_eq!(t.piece_at(sq("j1")), piece(Seat::South, PieceKind::King));
    assert_eq!(t.piece_at(sq("l1")), piece(Seat::South, PieceKind::Rook));
}

#[test]
fn en_passant_cleared_when_owner_turn_is_an_automatic_pass() {
    // Teams, West DEFEATED: it double-steps, then has no move and passes on
    // its next turn. The pass reaches West, so its target must be gone.
    let mut s = build(
        "teams",
        &["sKa1", "nKl12", "eKl1", "wPb5", "sPd4", "sNe5"],
        "W ADAA - - 0 0 def=Wl ep=on",
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
    for blocker in ["sNg1", "wNh1", "sNk1", "wNj1"] {
        let s = build(
            "ffa",
            &["sKi1", "sRe1", "sRl1", "wKa16", "nKp16", "eKp8", blocker],
            "S AAAA Se1,Sl1 - 0 0",
        );
        let long_blocked = blocker.ends_with("g1") || blocker.ends_with("h1");
        assert_eq!(is_legal(&s, "i1g1"), !long_blocked, "{blocker}");
        assert_eq!(is_legal(&s, "i1k1"), long_blocked, "{blocker}");
    }
}

#[test]
fn pawn_attack_squares_follow_seat_orientation() {
    let s = ffa(&with_kings(&["sPg6", "nPg11", "wPe8", "ePl8"]), 'S');
    let att = |q: &str, by: Seat| is_square_attacked_by(&s, sq(q), by);
    assert!(att("f7", Seat::South) && att("h7", Seat::South));
    assert!(!att("g7", Seat::South) && !att("f5", Seat::South));
    assert!(att("f10", Seat::North) && att("h10", Seat::North));
    assert!(!att("f12", Seat::North) && !att("g10", Seat::North));
    assert!(att("f9", Seat::West) && att("f7", Seat::West));
    assert!(!att("b9", Seat::West) && !att("f8", Seat::West));
    assert!(att("k9", Seat::East) && att("k7", Seat::East));
    assert!(!att("o9", Seat::East) && !att("k8", Seat::East));
}

#[test]
fn teammate_does_not_make_leader_under_attack() {
    let p = ["sKg6", "nRg12", "wKa16", "nKp16", "eKp1"];
    assert!(!leader_under_attack(&teams(&p, 'S'), Seat::South));
    assert!(leader_under_attack(&ffa(&p, 'S'), Seat::South));
}

#[test]
fn frozen_pieces_block_can_be_captured_by_opponents_but_not_teammates() {
    // North FROZEN (teammate of South), West FROZEN (opponent).
    let s = build(
        "teams",
        &["sKa1", "sRg6", "nNg9", "wNj6", "wKa16", "nKp16", "eKp1"],
        "S AFFA - - 0 0 def=Wt,Nt",
    );
    let m = moves_from(&s, "g6");
    assert!(m.contains(&"g6j6".to_string()), "{m:?}");
    assert!(!m.contains(&"g6g9".to_string()), "{m:?}");
    assert!(!m.contains(&"g6g10".to_string()), "{m:?}");
    assert!(!m.contains(&"g6k6".to_string()), "{m:?}");
}
