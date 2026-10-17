//! One or more tests per rule of PLAN §2 (rules version 2, 16×16 board).

mod common;

use common::*;
use rules_core::*;

fn start(mode: GameMode) -> GameState {
    GameState::new(GameConfig::new(mode)).unwrap()
}

/// The start position with `seat` to move (via the position string).
fn start_with_to_move(mode: GameMode, seat: Seat) -> GameState {
    let text = start(mode).to_position_string().replacen(
        " S AAAA ",
        &format!(" {} AAAA ", seat.letter()),
        1,
    );
    parse_position(&text).unwrap()
}

fn defeat_events(ev: &[GameEvent]) -> Vec<(Seat, DefeatReason)> {
    ev.iter()
        .filter_map(|e| match e {
            GameEvent::Defeat { seat, reason } => Some((*seat, *reason)),
            _ => None,
        })
        .collect()
}

fn ended(ev: &[GameEvent]) -> Option<Outcome> {
    ev.iter().find_map(|e| match e {
        GameEvent::GameEnded { outcome } => Some(*outcome),
        _ => None,
    })
}

// ---------------------------------------------------------------------------
// Setup and first moves
// ---------------------------------------------------------------------------

#[test]
fn south_first_moves_hand_verified() {
    // South's 30 opening moves on the 16×16 board:
    //   pawns e2..l2: 8 × (single + double step)            = 16
    //   knight f1: d2 (empty margin), e3, g3 (h2 own pawn)   =  3
    //   knight k1: j3, l3, m2 (i2 own pawn)                  =  3
    //   rook e1: d1, c1, b1, a1; rook l1: m1, n1, o1, p1     =  8
    //   bishops, queen, king: boxed in by own pieces         =  0
    //                                                         = 30
    // No other army is within reach (four empty squares separate the armies).
    let mut expected: Vec<String> = Vec::new();
    for f in "efghijkl".chars() {
        expected.push(format!("{f}2{f}3"));
        expected.push(format!("{f}2{f}4"));
    }
    expected.extend(
        [
            "f1d2", "f1e3", "f1g3", "k1j3", "k1l3", "k1m2", "e1d1", "e1c1", "e1b1", "e1a1", "l1m1",
            "l1n1", "l1o1", "l1p1",
        ]
        .map(String::from),
    );
    expected.sort();
    for mode in [GameMode::Ffa, GameMode::Teams] {
        assert_eq!(move_strings(&start(mode)), expected, "{mode:?}");
    }
}

#[test]
fn every_seat_has_30_opening_moves_reaching_into_the_margins() {
    // Knights hop sideways into the empty margin; rooks slide into the corners.
    let margin = [
        (Seat::South, ["f1d2", "k1m2", "e1a1", "l1p1"]),
        (Seat::West, ["a6b4", "a11b13", "a5a1", "a12a16"]),
        (Seat::North, ["f16d15", "k16m15", "e16a16", "l16p16"]),
        (Seat::East, ["p6o4", "p11o13", "p5p1", "p12p16"]),
    ];
    for mode in [GameMode::Ffa, GameMode::Teams] {
        for (seat, moves) in margin {
            let s = start_with_to_move(mode, seat);
            assert_eq!(legal_moves(&s).len(), 30, "{seat} {mode:?}");
            for m in moves {
                assert!(is_legal(&s, m), "{m} for {seat}");
            }
            // Pawns never start in contact with another army.
            assert!(
                legal_moves(&s).iter().all(|m| s.piece_at(m.to).is_none()),
                "{seat} has a capture at the start"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

#[test]
fn self_check_is_allowed() {
    let s = build(
        "ffa",
        &["sKg7", "nRg11", "nRf16", "wKa9", "nKi16", "eKp9"],
        "S AAAA - - 0 0",
    );
    // Every king step is legal, even onto squares attacked by North's rooks.
    let moves = move_strings(&s);
    for m in [
        "g7f6", "g7f7", "g7f8", "g7g6", "g7g8", "g7h6", "g7h7", "g7h8",
    ] {
        assert!(moves.contains(&m.to_string()), "{m}");
    }
    assert!(leader_under_attack(&s, Seat::South));
    assert!(is_square_attacked_by(&s, sq("f8"), Seat::North));
}

#[test]
fn teammates_block_and_cannot_be_captured() {
    let pieces = ["sKi1", "sRa1", "nRa7", "wKa9", "nKi16", "eKp9"];
    let teams = build("teams", &pieces, "S AAAA - - 0 0");
    assert!(!is_legal(&teams, "a1a7"));
    assert!(!is_legal(&teams, "a1a8"));
    assert!(is_legal(&teams, "a1a6"));
    let ffa = build("ffa", &pieces, "S AAAA - - 0 0");
    assert!(is_legal(&ffa, "a1a7"));
    assert!(!is_legal(&ffa, "a1a8"));
}

#[test]
fn frozen_pieces_block_and_can_be_captured_but_never_move() {
    let mut s = build(
        "teams",
        &["sKi1", "sRa1", "wKa9", "wRa6", "nKi16", "eKp9"],
        "S AFAA - - 0 0 def=Wt",
    );
    assert!(is_legal(&s, "a1a6")); // capture the frozen rook
    assert!(!is_legal(&s, "a1a7")); // it blocks
    let mut buf = Vec::new();
    generate_moves_for_seat(&s, Seat::West, &mut buf);
    assert!(buf.is_empty());
    // Turn order skips West.
    play(&mut s, "i1i2");
    assert_eq!(s.seat_to_move(), Seat::North);
    check_invariants(&s);
}

#[test]
fn sliding_and_leaping_pieces_in_the_open() {
    let s = build(
        "ffa",
        &["sKa1", "sQh8", "sNp16", "wKa9", "nKi16", "eKp9"],
        "S AAAA - - 0 0",
    );
    let moves = legal_moves(&s);
    let from = |f: &str| moves.iter().filter(|m| m.from == sq(f)).count();
    // Queen h8, rays counted explicitly:
    // rank 8: a8..g8 (7) and i8..p8 (8) = 15; file h: h1..h7 (7), h9..h16 (8) = 15;
    // diagonals: a1 is own king -> b2..g7 (6), i9..p16 but p16 own knight -> i9..o15 (7),
    // i7..o1 (7), g9..a15 (7). Total 15 + 15 + 6 + 7 + 7 + 7 = 57.
    assert_eq!(from("h8"), 57);
    assert_eq!(from("p16"), 2); // knight in the corner: n15, o14
    assert_eq!(from("a1"), 3);
}

// ---------------------------------------------------------------------------
// Leader capture, stalemate, statuses
// ---------------------------------------------------------------------------

#[test]
fn ffa_leader_capture_by_non_adjacent_seat_removes_army() {
    let mut s = build(
        "ffa",
        &["sKi1", "sQi8", "wKa9", "nKi16", "nRa16", "nPe15", "eKp9"],
        "S AAAA - - 7 0",
    );
    let ev = play(&mut s, "i8i16");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::LeaderCaptured)]
    );
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::North }));
    assert_eq!(s.status(Seat::North), SeatStatus::Removed);
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert_eq!(s.seat_to_move(), Seat::West);
    assert_eq!(s.no_progress(), 0);
    assert_eq!(s.move_limit(), 75);
    check_invariants(&s);
    // North is skipped from now on.
    play(&mut s, "a9a8");
    assert_eq!(s.seat_to_move(), Seat::East);
}

#[test]
fn teams_defeated_seat_keeps_playing_while_partner_active() {
    let mut s = build(
        "teams",
        &["sKi1", "wKa9", "wQi8", "nKi16", "nRa16", "eKp9"],
        "W AAAA - - 0 0",
    );
    let ev = play(&mut s, "i8i16");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::LeaderCaptured)]
    );
    assert!(
        !ev.iter()
            .any(|e| matches!(e, GameEvent::ArmyRemoved { .. }))
    );
    assert_eq!(s.status(Seat::North), SeatStatus::Defeated);
    assert_eq!(s.seat_to_move(), Seat::North);
    assert!(is_legal(&s, "a16a10"));
    play(&mut s, "a16a15");
    assert_eq!(s.seat_to_move(), Seat::East);
    check_invariants(&s);
}

#[test]
fn capturing_a_defeated_seats_old_leader_has_no_effect() {
    let mut s = build(
        "teams",
        &["sKi1", "wKa9", "wRa15", "nKa16", "nRe16", "eKp9"],
        "W AADA - - 0 0 def=Ns",
    );
    let ev = play(&mut s, "a15a16");
    assert!(defeat_events(&ev).is_empty());
    assert_eq!(s.status(Seat::North), SeatStatus::Defeated);
    assert!(!s.is_over());
    check_invariants(&s);
}

/// South: K a1, R b1, B c1, B a3, P a2 b2 b3 b4 d2 — every piece is blocked
/// by its own pieces, the board edge, or East's blockers on b5 and d3.
const SOUTH_BOXED: [&str; 9] = [
    "sKa1", "sRb1", "sBc1", "sBa3", "sPa2", "sPb2", "sPb3", "sPb4", "sPd2",
];

#[test]
fn ffa_stalemate_is_a_loss_and_removes_the_army() {
    let mut pieces = SOUTH_BOXED.to_vec();
    pieces.extend(["eRb5", "eNd3", "eKp9", "wKa9", "nKi16"]);
    let mut s = build("ffa", &pieces, "E AAAA - - 0 0");
    let ev = play(&mut s, "p9p8");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::South, DefeatReason::Stalemate)]
    );
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::South }));
    assert_eq!(s.status(Seat::South), SeatStatus::Removed);
    assert_eq!(s.seat_to_move(), Seat::West);
    check_invariants(&s);
}

/// Teams: North's K a16, B b16, P a15 b15 c15 are boxed by their own pieces
/// and by South's (teammate) R a14, N b14, B c14.
fn teams_north_boxed() -> GameState {
    build(
        "teams",
        &[
            "nKa16", "nBb16", "nPa15", "nPb15", "nPc15", "sRa14", "sNb14", "sBc14", "sKi1", "sNg1",
            "wKa9", "wQi8", "eKp9",
        ],
        "W AAAA - - 0 0",
    )
}

#[test]
fn teams_stalemate_once_then_automatic_passes_then_team_out() {
    let mut s = teams_north_boxed();
    // West moves; North has no legal move at the start of its turn: defeated.
    let ev = play(&mut s, "a9b9");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::Stalemate)]
    );
    assert!(!ev.iter().any(|e| matches!(e, GameEvent::Pass { .. })));
    assert_eq!(s.status(Seat::North), SeatStatus::Defeated);
    assert_eq!(s.seat_to_move(), Seat::East);
    assert_eq!(s.no_progress(), 0); // reset by the defeat
    check_invariants(&s);

    play(&mut s, "p9p8");
    play(&mut s, "g1h3");
    assert_eq!(s.no_progress(), 2);
    // North is DEFEATED and still stuck: it passes automatically (once).
    let ply_before = s.ply();
    let ev = play(&mut s, "b9b10");
    assert_eq!(
        ev.iter()
            .filter(|e| matches!(e, GameEvent::Pass { .. }))
            .collect::<Vec<_>>(),
        vec![&GameEvent::Pass { seat: Seat::North }]
    );
    assert!(defeat_events(&ev).is_empty()); // stalemate happens only once
    assert_eq!(s.seat_to_move(), Seat::East);
    assert_eq!(s.no_progress(), 4); // West's move + North's pass
    assert_eq!(s.ply(), ply_before + 2);
    assert_eq!(PASS_NOTATION, "--");
    check_invariants(&s);

    // Stalemated North + South losing its leader: the team is out.
    play(&mut s, "p8p7");
    play(&mut s, "h3g5");
    let ev = play(&mut s, "i8i1");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::South, DefeatReason::LeaderCaptured)]
    );
    let o = ended(&ev).expect("game over");
    assert_eq!(
        o.result,
        GameResult::TeamsWinner {
            team: Team::WestEast
        }
    );
    assert_eq!(o.placements, [2, 1, 2, 1]);
    // "That team's pieces are removed."
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::South }));
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::North }));
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert!(matches!(ev.last(), Some(GameEvent::GameEnded { .. })));
    assert_eq!(apply_move(&mut s, mv("p7p6")), Err(RulesError::GameOver));
    check_invariants(&s);
}

#[test]
fn teams_frozen_partner_plus_leader_loss_is_team_out() {
    let mut s = build(
        "teams",
        &["sKi1", "sNg1", "wKa9", "wQi8", "nKi16", "eKp9"],
        "N AAAA - - 0 0",
    );
    let ev = apply_timeout(&mut s, Seat::North).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::Timeout)]
    );
    assert!(ev.contains(&GameEvent::Frozen { seat: Seat::North }));
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert_eq!(s.seat_to_move(), Seat::East);
    check_invariants(&s);
    play(&mut s, "p9p8");
    play(&mut s, "g1h3");
    let ev = play(&mut s, "i8i1");
    assert_eq!(
        ended(&ev).unwrap().result,
        GameResult::TeamsWinner {
            team: Team::WestEast
        }
    );
    check_invariants(&s);
}

#[test]
fn teams_leaderless_teammate_timing_out_becomes_frozen() {
    let mut s = build(
        "teams",
        &["sKi1", "wKa9", "nRa16", "eKp9"],
        "N AADA - - 0 0 def=Nl",
    );
    let ev = apply_timeout(&mut s, Seat::North).unwrap();
    assert_eq!(ev, vec![GameEvent::Frozen { seat: Seat::North }]);
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert_eq!(s.defeats().len(), 1);
    assert_eq!(
        s.defeats().reason(Seat::North),
        Some(DefeatReason::LeaderCaptured)
    );
    assert_eq!(s.pieces_of(Seat::North).count(), 1); // pieces stay
    assert_eq!(s.seat_to_move(), Seat::East);
    check_invariants(&s);
}

// ---------------------------------------------------------------------------
// Timeout / abandon
// ---------------------------------------------------------------------------

#[test]
fn ffa_timeouts_and_abandons_to_a_winner() {
    let mut s = start(GameMode::Ffa);
    assert!(matches!(
        apply_timeout(&mut s, Seat::West),
        Err(RulesError::NotSeatToMove { .. })
    ));
    let ev = apply_timeout(&mut s, Seat::South).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::South, DefeatReason::Timeout)]
    );
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::South }));
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_eq!(s.seat_to_move(), Seat::West);
    check_invariants(&s);

    // Abandon by a seat that is not on move: the turn stays with West.
    apply_abandon(&mut s, Seat::North).unwrap();
    assert_eq!(s.seat_to_move(), Seat::West);
    assert_eq!(
        apply_abandon(&mut s, Seat::North),
        Err(RulesError::SeatNotInPlay(Seat::North))
    );
    check_invariants(&s);

    let ev = apply_timeout(&mut s, Seat::West).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(o.result, GameResult::FfaWinner { seat: Seat::East });
    // 1st survivor, then reverse order of defeat.
    assert_eq!(o.placement(Seat::East), 1);
    assert_eq!(o.placement(Seat::West), 2);
    assert_eq!(o.placement(Seat::North), 3);
    assert_eq!(o.placement(Seat::South), 4);
    assert_eq!(apply_timeout(&mut s, Seat::East), Err(RulesError::GameOver));
    assert_eq!(apply_abandon(&mut s, Seat::East), Err(RulesError::GameOver));
    check_invariants(&s);
}

#[test]
fn teams_abandon_freezes_and_turn_advances_if_on_move() {
    let mut s = start(GameMode::Teams);
    let ev = apply_abandon(&mut s, Seat::South).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::South, DefeatReason::Abandon)]
    );
    assert_eq!(s.status(Seat::South), SeatStatus::Frozen);
    assert_eq!(s.pieces_of(Seat::South).count(), 16);
    assert_eq!(s.seat_to_move(), Seat::West);
    check_invariants(&s);
}

// ---------------------------------------------------------------------------
// Castling
// ---------------------------------------------------------------------------

#[test]
fn castling_both_sides_without_attack_restrictions() {
    // North's rooks attack j1 and g1; castling is still legal.
    let pieces = [
        "sKi1", "sRe1", "sRl1", "nRj16", "nRg15", "wKa9", "nKi16", "eKp9",
    ];
    let s = build("ffa", &pieces, "S AAAA Se1,Sl1 - 0 0");
    assert!(is_legal(&s, "i1k1"));
    assert!(is_legal(&s, "i1g1"));
    assert_eq!(
        find_legal_move(&s, mv("i1k1")).unwrap().flag,
        MoveFlag::Castle
    );

    let mut short = s.clone();
    let ev = play(&mut short, "i1k1");
    assert!(ev.contains(&GameEvent::Castle {
        seat: Seat::South,
        rook_from: sq("l1"),
        rook_to: sq("j1")
    }));
    assert_eq!(
        short.piece_at(sq("k1")),
        Some(Piece::new(PieceKind::King, Seat::South))
    );
    assert_eq!(
        short.piece_at(sq("j1")),
        Some(Piece::new(PieceKind::Rook, Seat::South))
    );
    assert!(short.castling_rights(Seat::South).is_empty());
    check_invariants(&short);

    let mut long = s.clone();
    play(&mut long, "i1g1");
    assert_eq!(
        long.piece_at(sq("g1")),
        Some(Piece::new(PieceKind::King, Seat::South))
    );
    assert_eq!(
        long.piece_at(sq("h1")),
        Some(Piece::new(PieceKind::Rook, Seat::South))
    );
    assert_eq!(long.piece_at(sq("e1")), None);
    check_invariants(&long);
}

#[test]
fn castling_blocked_or_rights_lost() {
    let pieces = ["sKi1", "sRe1", "sRl1", "sBj1", "wKa9", "nKi16", "eKp9"];
    let s = build("ffa", &pieces, "S AAAA Se1,Sl1 - 0 0");
    assert!(!is_legal(&s, "i1k1")); // j1 occupied
    assert!(is_legal(&s, "i1g1"));

    // Without the right there is no castle even with an empty path.
    let s = build(
        "ffa",
        &["sKi1", "sRe1", "sRl1", "wKa9", "nKi16", "eKp9"],
        "S AAAA Sl1 - 0 0",
    );
    assert!(!is_legal(&s, "i1g1"));
    assert!(is_legal(&s, "i1k1"));

    // Moving the leader away and back loses both rights.
    let mut s = build(
        "ffa",
        &["sKi1", "sRe1", "sRl1", "wKa9", "nKi16", "eKp9"],
        "S AAAA Se1,Sl1 - 0 0",
    );
    play(&mut s, "i1i2");
    assert!(s.castling_rights(Seat::South).is_empty());

    // Moving a rook loses that side; capturing a rook loses that side.
    let mut s = build(
        "ffa",
        &["sKi1", "sRe1", "sRl1", "wKa9", "wRl7", "nKi16", "eKp9"],
        "S AAAA Se1,Sl1 - 0 0",
    );
    play(&mut s, "e1e2");
    assert_eq!(
        s.castling_rights(Seat::South),
        CastlingRights {
            long: false,
            short: true
        }
    );
    play(&mut s, "l7l1");
    assert!(s.castling_rights(Seat::South).is_empty());
    check_invariants(&s);
}

#[test]
fn castling_for_west_north_east() {
    let s = build(
        "ffa",
        &[
            "sKi1", "wKa9", "wRa5", "wRa12", "nKi16", "nRe16", "eKp9", "eRp5",
        ],
        "W AAAA Wa5,Wa12,Ne16,Ep5 - 0 0",
    );
    let mut w = s.clone();
    play(&mut w, "a9a11");
    assert_eq!(
        w.piece_at(sq("a10")),
        Some(Piece::new(PieceKind::Rook, Seat::West))
    );
    play(&mut w, "i16g16");
    assert_eq!(
        w.piece_at(sq("h16")),
        Some(Piece::new(PieceKind::Rook, Seat::North))
    );
    play(&mut w, "p9p7");
    assert_eq!(
        w.piece_at(sq("p8")),
        Some(Piece::new(PieceKind::Rook, Seat::East))
    );
    check_invariants(&w);
    let mut w2 = s.clone();
    play(&mut w2, "a9a7");
    assert_eq!(
        w2.piece_at(sq("a8")),
        Some(Piece::new(PieceKind::Rook, Seat::West))
    );
}

#[test]
fn castling_rights_are_dropped_when_a_seat_leaves_active() {
    let s = build(
        "teams",
        &["sKi1", "sRl1", "wKa9", "nKi16", "eKp9"],
        "S ADAA Sl1 - 0 0 def=Ws",
    );
    // Rights for a non-ACTIVE seat are rejected by the parser...
    assert!(parse_position(&s.to_position_string().replace("Sl1 ", "Sl1,Wa12 ")).is_err());
    // ...and cleared by the engine on defeat.
    let mut t = build(
        "teams",
        &["sKi1", "sRl1", "wKa9", "nKi16", "eKp9"],
        "S AAAA Sl1 - 0 0",
    );
    apply_timeout(&mut t, Seat::South).unwrap();
    assert!(t.castling_rights(Seat::South).is_empty());
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

#[test]
fn promotion_lines_per_seat_and_choices() {
    let pieces = [
        "sKi1", "wKa9", "nKp16", "eKp9", "sPf8", "nPg9", "nPj9", "wPh7", "ePi6",
    ];
    let cases = [
        (Seat::South, "f8", "f9", "f8g9"), // rank 9
        (Seat::North, "j9", "j8", "g9f8"), // rank 8
        (Seat::West, "h7", "i7", "h7i6"),  // file i
        (Seat::East, "i6", "h6", "i6h7"),  // file h
    ];
    for (seat, from, to, capture) in cases {
        let s = build("ffa", &pieces, &format!("{} AAAA - - 0 0", seat.letter()));
        let push = format!("{from}{to}");
        for k in ["q", "r", "b", "n"] {
            assert!(is_legal(&s, &format!("{push}{k}")), "{seat} {push}{k}");
            assert!(
                is_legal(&s, &format!("{capture}{k}")),
                "{seat} {capture}{k}"
            );
        }
        // Mandatory: no plain push; never to a leader or a pawn.
        assert!(!is_legal(&s, &push), "{seat} {push}");
        assert!(!is_legal(&s, &format!("{push}k")));
        assert!(!is_legal(&s, &format!("{push}p")));
        assert!(!is_legal(&s, capture));
    }
    let mut s = build("ffa", &pieces, "S AAAA - - 0 0");
    let ev = play(&mut s, "f8g9n");
    assert!(ev.contains(&GameEvent::Promotion {
        seat: Seat::South,
        square: sq("g9"),
        kind: PieceKind::Knight
    }));
    assert_eq!(
        s.piece_at(sq("g9")),
        Some(Piece::new(PieceKind::Knight, Seat::South))
    );
    assert_eq!(s.no_progress(), 0);
    check_invariants(&s);
}

#[test]
fn promotion_line_is_seven_steps_from_the_start_line() {
    // 16×16: the first line past the centre is seven steps from the pawn line
    // (South rank 9, North rank 8, West file i, East file h).
    let lines = [
        (Seat::South, "e9"),
        (Seat::North, "e8"),
        (Seat::West, "i5"),
        (Seat::East, "h5"),
    ];
    for (seat, example) in lines {
        assert_eq!(seat.progress(sq(example)), setup::PROMOTION_PROGRESS);
        for s in setup::pawn_line(seat) {
            let (fx, fy) = seat.forward();
            let seven = s.offset(7 * fx, 7 * fy).unwrap();
            assert_eq!(seat.progress(seven), setup::PROMOTION_PROGRESS);
            let six = s.offset(6 * fx, 6 * fy).unwrap();
            assert_eq!(seat.progress(six) + 1, setup::PROMOTION_PROGRESS);
        }
    }
}

// ---------------------------------------------------------------------------
// En passant
// ---------------------------------------------------------------------------

/// Kings on their home squares, South's e2 and f2 pawns, and a West pawn on
/// d4 that attacks e3 (the square South's e2 pawn skips with a double step).
const EP_SETUP: [&str; 7] = ["sKi1", "wKa9", "nKi16", "eKp9", "sPe2", "sPf2", "wPd4"];

#[test]
fn en_passant_capture() {
    for mode in ["ffa", "teams"] {
        let mut s = build(mode, &EP_SETUP, "S AAAA - - 0 0");
        play(&mut s, "e2e4");
        assert_eq!(
            s.ep_target(Seat::South),
            Some(EpTarget {
                skipped: sq("e3"),
                pawn: sq("e4")
            })
        );
        // West's d4 pawn captures diagonally forward onto e3.
        let m = find_legal_move(&s, mv("d4e3")).unwrap();
        assert_eq!(m.flag, MoveFlag::EnPassant);
        let ev = play(&mut s, "d4e3");
        assert!(ev.contains(&GameEvent::EnPassant {
            seat: Seat::West,
            captured_square: sq("e4")
        }));
        assert_eq!(s.piece_at(sq("e4")), None);
        assert_eq!(
            s.piece_at(sq("e3")),
            Some(Piece::new(PieceKind::Pawn, Seat::West))
        );
        check_invariants(&s);
    }
}

#[test]
fn en_passant_expires_when_turn_order_returns() {
    let mut s = build("ffa", &EP_SETUP, "S AAAA - - 0 0");
    play(&mut s, "e2e4");
    play(&mut s, "a9a8"); // West declines
    assert!(s.ep_target(Seat::South).is_some()); // still live for North/East
    play(&mut s, "i16i15");
    play(&mut s, "p9p8");
    // The pointer reached South: target cleared before South moves.
    assert_eq!(s.ep_target(Seat::South), None);
    play(&mut s, "f2f3");
    assert!(!is_legal(&s, "d4e3"));
    check_invariants(&s);
}

#[test]
fn en_passant_expires_when_double_stepper_stops_taking_turns() {
    let mut s = build("teams", &EP_SETUP, "S AAAA - - 0 0");
    play(&mut s, "e2e4");
    assert!(is_legal(&s, "d4e3"));
    apply_abandon(&mut s, Seat::South).unwrap(); // South frozen while West is on move
    assert_eq!(s.ep_target(Seat::South), None);
    assert_eq!(s.seat_to_move(), Seat::West);
    assert!(!is_legal(&s, "d4e3"));
    check_invariants(&s);
}

#[test]
fn en_passant_skipped_seat_target_is_cleared() {
    // West is frozen (skipped). South's target set on its move is cleared
    // only when the pointer next reaches South; a frozen seat's own target
    // can never exist.
    let mut s = build(
        "teams",
        &["sKi1", "sPf2", "wKa9", "nKi16", "nPg15", "eKp9"],
        "S AFAA - - 0 0 def=Wt",
    );
    play(&mut s, "f2f4");
    assert_eq!(s.seat_to_move(), Seat::North);
    assert!(s.ep_target(Seat::South).is_some());
    play(&mut s, "g15g13");
    play(&mut s, "p9p8");
    assert_eq!(s.seat_to_move(), Seat::South);
    assert_eq!(s.ep_target(Seat::South), None);
    check_invariants(&s);
}

#[test]
fn en_passant_can_promote() {
    // North i15-i13 skips i14, which is on West's promotion file i.
    let mut s = build(
        "ffa",
        &["sKi1", "wKa9", "wPh15", "nKp16", "nPi15", "eKp9"],
        "N AAAA - - 0 0",
    );
    play(&mut s, "i15i13");
    play(&mut s, "p9p8");
    play(&mut s, "i1i2");
    let promos: Vec<String> = move_strings(&s)
        .into_iter()
        .filter(|m| m.starts_with("h15i14"))
        .collect();
    assert_eq!(promos, vec!["h15i14b", "h15i14n", "h15i14q", "h15i14r"]);
    let ev = play(&mut s, "h15i14q");
    assert!(ev.contains(&GameEvent::EnPassant {
        seat: Seat::West,
        captured_square: sq("i13")
    }));
    assert_eq!(
        s.piece_at(sq("i14")),
        Some(Piece::new(PieceKind::Queen, Seat::West))
    );
    assert_eq!(s.piece_at(sq("i13")), None);
    check_invariants(&s);
}

#[test]
fn en_passant_disabled_by_config() {
    let mut s = build("ffa", &EP_SETUP, "S AAAA - - 0 0 ep=off");
    assert!(!s.config().en_passant_enabled);
    play(&mut s, "e2e4");
    assert_eq!(s.ep_target(Seat::South), None);
    assert!(!is_legal(&s, "d4e3"));
    assert!(s.to_position_string().contains("ep=off"));
    check_invariants(&s);
}

// ---------------------------------------------------------------------------
// Move limit
// ---------------------------------------------------------------------------

const KINGS: [&str; 4] = ["sKi1", "wKa9", "nKi16", "eKp9"];

#[test]
fn move_limit_ffa_tie() {
    let mut s = build("ffa", &KINGS, "S AAAA - - 98 40");
    play(&mut s, "i1i2");
    assert!(!s.is_over());
    let ev = play(&mut s, "a9a8");
    let o = ended(&ev).unwrap();
    assert_eq!(
        o.result,
        GameResult::FfaMoveLimitTie {
            survivors: [true; 4]
        }
    );
    assert_eq!(o.placements, [1, 1, 1, 1]);
    check_invariants(&s);
}

#[test]
fn move_limit_counts_only_seats_still_taking_turns() {
    let mut s = build("ffa", &["sKi1", "nKi16", "eKp9"], "S ARAA - - 74 0 def=Wl");
    assert_eq!(s.move_limit(), 75);
    let ev = play(&mut s, "i1i2");
    let o = ended(&ev).unwrap();
    assert_eq!(
        o.result,
        GameResult::FfaMoveLimitTie {
            survivors: [true, false, true, true]
        }
    );
    assert_eq!(o.placements, [1, 4, 1, 1]);

    // Teams with a frozen seat: limit 75.
    let mut s = build("teams", &KINGS, "S AAFA - - 74 0 def=Nt");
    let ev = play(&mut s, "i1i2");
    assert_eq!(ended(&ev).unwrap().result, GameResult::TeamsDraw);
    assert_eq!(ended(&ev).unwrap().placements, [1; 4]);
    check_invariants(&s);
}

#[test]
fn move_limit_resets_on_capture_pawn_move_and_defeat() {
    let mut s = build(
        "ffa",
        &["sKi1", "sRa1", "sPf2", "wKa9", "wNa5", "nKi16", "eKp9"],
        "S AAAA - - 50 0",
    );
    play(&mut s, "a1a5");
    assert_eq!(s.no_progress(), 0);
    play(&mut s, "a9a8");
    assert_eq!(s.no_progress(), 1);
    play(&mut s, "i16i15");
    play(&mut s, "p9p8");
    assert_eq!(s.no_progress(), 3);
    play(&mut s, "f2f4");
    assert_eq!(s.no_progress(), 0);

    // A timeout of an ACTIVE seat is a defeat: reset.
    let mut t = build("teams", &KINGS, "N AAAA - - 70 0");
    apply_timeout(&mut t, Seat::North).unwrap();
    assert_eq!(t.no_progress(), 0);
    check_invariants(&t);
}

#[test]
fn freezing_a_defeated_seat_lowers_the_limit_without_reset() {
    let mut s = build(
        "teams",
        &["sKi1", "wKa9", "nRa16", "eKp9"],
        "N AADA - - 80 0 def=Nl",
    );
    assert_eq!(s.move_limit(), 100);
    let ev = apply_timeout(&mut s, Seat::North).unwrap();
    assert_eq!(ev.first(), Some(&GameEvent::Frozen { seat: Seat::North }));
    assert_eq!(ended(&ev).unwrap().result, GameResult::TeamsDraw);
    assert_eq!(s.no_progress(), 80);
    check_invariants(&s);
}

#[test]
fn automatic_passes_count_toward_the_move_limit() {
    // North is DEFEATED and boxed in; it passes every round.
    let s0 = teams_north_boxed();
    let text = s0
        .to_position_string()
        .replace(" W AAAA ", " W AADA ")
        .replace(" 0 0 ", " 95 0 ")
        .replace("def=-", "def=Ns");
    let mut s = parse_position(&text).unwrap();
    let ev = play(&mut s, "a9b9"); // 96, North passes: 97
    assert!(ev.contains(&GameEvent::Pass { seat: Seat::North }));
    assert_eq!(s.no_progress(), 97);
    play(&mut s, "p9p8"); // 98
    let ev = play(&mut s, "g1h3"); // 99
    assert!(!s.is_over(), "{ev:?}");
    let ev = play(&mut s, "b9b10"); // 100 -> draw before North's pass
    assert_eq!(ended(&ev).unwrap().result, GameResult::TeamsDraw);
    assert!(!ev.iter().any(|e| matches!(e, GameEvent::Pass { .. })));
    check_invariants(&s);
}

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

#[test]
fn illegal_and_garbage_moves_are_rejected_without_side_effects() {
    let mut s = start(GameMode::Ffa);
    let before = s.clone();
    for m in [
        "a1a2", "b5c5", "e2e5", "e2e3q", "i1k1", "i1i2", "f1f3", "p16a1", "h1h16", "e2f3",
    ] {
        assert_eq!(
            apply_move(&mut s, mv(m)),
            Err(RulesError::IllegalMove(mv(m))),
            "{m}"
        );
        assert_eq!(s, before);
    }
    // Every (from, to) pair, with and without promotions, never panics.
    let legal = legal_moves(&s);
    for from in Square::all() {
        for to in Square::all() {
            for promotion in [None, Some(PieceKind::Queen), Some(PieceKind::King)] {
                let m = Move {
                    from,
                    to,
                    promotion,
                    flag: MoveFlag::Castle,
                };
                let ok = find_legal_move(&s, m).is_some();
                assert_eq!(ok, legal.iter().any(|l| l.same_choice(&m)));
            }
        }
    }
    // A wrong caller-supplied flag is ignored.
    let m = Move {
        flag: MoveFlag::EnPassant,
        ..mv("e2e3")
    };
    let ev = apply_move(&mut s, m).unwrap();
    assert!(matches!(ev[0], GameEvent::MoveMade { mv, .. } if mv.flag == MoveFlag::Normal));
}

#[test]
fn invalid_configs_are_rejected() {
    let mut c = GameConfig::new(GameMode::Ffa);
    c.rules_version = 99;
    assert!(matches!(GameState::new(c), Err(RulesError::Config(_))));
}
