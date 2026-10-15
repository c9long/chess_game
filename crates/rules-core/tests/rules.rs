//! One or more tests per rule of PLAN §2 ("rules_version 1").

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
    // South's 28 opening moves:
    //   pawns c2..j2: 8 × (single + double step)            = 16
    //   corner-pawn captures c2xb3 (West) and j2xk3 (East)   =  2
    //   knight d1: b2, c3, e3 (f2 is own pawn)               =  3
    //   knight i1: h3, j3, k2 (g2 is own pawn)               =  3
    //   rook c1: b1, a1; rook j1: k1, l1                      =  4
    //   bishops, queen, king: boxed in by own pieces         =  0
    //                                                         = 28
    let mut expected: Vec<String> = Vec::new();
    for f in "cdefghij".chars() {
        expected.push(format!("{f}2{f}3"));
        expected.push(format!("{f}2{f}4"));
    }
    expected.extend(
        [
            "c2b3", "j2k3", "d1b2", "d1c3", "d1e3", "i1h3", "i1j3", "i1k2", "c1b1", "c1a1", "j1k1",
            "j1l1",
        ]
        .map(String::from),
    );
    expected.sort();
    for mode in [GameMode::Ffa, GameMode::Teams] {
        assert_eq!(move_strings(&start(mode)), expected, "{mode:?}");
    }
}

#[test]
fn every_seat_has_28_opening_moves_including_corner_captures() {
    let corner = [
        (Seat::South, ["c2b3", "j2k3"]),
        (Seat::West, ["b3c2", "b10c11"]),
        (Seat::North, ["c11b10", "j11k10"]),
        (Seat::East, ["k3j2", "k10j11"]),
    ];
    for mode in [GameMode::Ffa, GameMode::Teams] {
        for (seat, caps) in corner {
            let s = start_with_to_move(mode, seat);
            assert_eq!(legal_moves(&s).len(), 28, "{seat} {mode:?}");
            for c in caps {
                assert!(is_legal(&s, c), "{c} for {seat}");
            }
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
        &["sKe5", "nRe9", "nRd12", "wKa7", "nKg12", "eKl7"],
        "S AAAA - - 0 0",
    );
    // Every king step is legal, even onto squares attacked by North's rooks.
    let moves = move_strings(&s);
    for m in [
        "e5d4", "e5d5", "e5d6", "e5e4", "e5e6", "e5f4", "e5f5", "e5f6",
    ] {
        assert!(moves.contains(&m.to_string()), "{m}");
    }
    assert!(leader_under_attack(&s, Seat::South));
    assert!(is_square_attacked_by(&s, sq("d6"), Seat::North));
}

#[test]
fn teammates_block_and_cannot_be_captured() {
    let pieces = ["sKg1", "sRa1", "nRa5", "wKa7", "nKg12", "eKl7"];
    let teams = build("teams", &pieces, "S AAAA - - 0 0");
    assert!(!is_legal(&teams, "a1a5"));
    assert!(!is_legal(&teams, "a1a6"));
    assert!(is_legal(&teams, "a1a4"));
    let ffa = build("ffa", &pieces, "S AAAA - - 0 0");
    assert!(is_legal(&ffa, "a1a5"));
    assert!(!is_legal(&ffa, "a1a6"));
}

#[test]
fn frozen_pieces_block_and_can_be_captured_but_never_move() {
    let mut s = build(
        "teams",
        &["sKg1", "sRa1", "wKa7", "wRa4", "nKg12", "eKl7"],
        "S AFAA - - 0 0 def=Wt",
    );
    assert!(is_legal(&s, "a1a4")); // capture the frozen rook
    assert!(!is_legal(&s, "a1a5")); // it blocks
    let mut buf = Vec::new();
    generate_moves_for_seat(&s, Seat::West, &mut buf);
    assert!(buf.is_empty());
    // Turn order skips West.
    play(&mut s, "g1g2");
    assert_eq!(s.seat_to_move(), Seat::North);
    check_invariants(&s);
}

#[test]
fn sliding_and_leaping_pieces_in_the_open() {
    let s = build(
        "ffa",
        &["sKa1", "sQf6", "sNl12", "wKa7", "nKg12", "eKl7"],
        "S AAAA - - 0 0",
    );
    let moves = legal_moves(&s);
    let from = |f: &str| moves.iter().filter(|m| m.from == sq(f)).count();
    // Queen f6: 11 + 11 orthogonal minus blocks... count rays explicitly.
    // rank 6: a6..e6 (5) and g6..k6 (5) + l6 (1) = 11; file f: f1..f5 (5), f7..f12 (6) = 11;
    // diagonals: a1 is own king -> b2..e5 (4), g7..l12 but l12 own knight -> g7..k11 (5),
    // g5..k1 (5), e7..a11 (5). Total 11 + 11 + 4 + 5 + 5 + 5 = 41.
    assert_eq!(from("f6"), 41);
    assert_eq!(from("l12"), 2); // knight in the corner: j11, k10
    assert_eq!(from("a1"), 3);
}

// ---------------------------------------------------------------------------
// Leader capture, stalemate, statuses
// ---------------------------------------------------------------------------

#[test]
fn ffa_leader_capture_by_non_adjacent_seat_removes_army() {
    let mut s = build(
        "ffa",
        &["sKg1", "sQg6", "wKa7", "nKg12", "nRa12", "nPc11", "eKl7"],
        "S AAAA - - 7 0",
    );
    let ev = play(&mut s, "g6g12");
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
    play(&mut s, "a7a6");
    assert_eq!(s.seat_to_move(), Seat::East);
}

#[test]
fn teams_defeated_seat_keeps_playing_while_partner_active() {
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "wQg6", "nKg12", "nRa12", "eKl7"],
        "W AAAA - - 0 0",
    );
    let ev = play(&mut s, "g6g12");
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
    assert!(is_legal(&s, "a12a8"));
    play(&mut s, "a12a11");
    assert_eq!(s.seat_to_move(), Seat::East);
    check_invariants(&s);
}

#[test]
fn capturing_a_defeated_seats_old_leader_has_no_effect() {
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "wRa11", "nKa12", "nRc12", "eKl7"],
        "W AADA - - 0 0 def=Ns",
    );
    let ev = play(&mut s, "a11a12");
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
    pieces.extend(["eRb5", "eNd3", "eKl7", "wKa7", "nKg12"]);
    let mut s = build("ffa", &pieces, "E AAAA - - 0 0");
    let ev = play(&mut s, "l7l6");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::South, DefeatReason::Stalemate)]
    );
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::South }));
    assert_eq!(s.status(Seat::South), SeatStatus::Removed);
    assert_eq!(s.seat_to_move(), Seat::West);
    check_invariants(&s);
}

/// Teams: North's K a12, B b12, P a11 b11 c11 are boxed by their own pieces
/// and by South's (teammate) R a10, N b10, B c10.
fn teams_north_boxed() -> GameState {
    build(
        "teams",
        &[
            "nKa12", "nBb12", "nPa11", "nPb11", "nPc11", "sRa10", "sNb10", "sBc10", "sKg1", "sNe1",
            "wKa7", "wQg6", "eKl7",
        ],
        "W AAAA - - 0 0",
    )
}

#[test]
fn teams_stalemate_once_then_automatic_passes_then_team_out() {
    let mut s = teams_north_boxed();
    // West moves; North has no legal move at the start of its turn: defeated.
    let ev = play(&mut s, "a7b7");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::Stalemate)]
    );
    assert!(!ev.iter().any(|e| matches!(e, GameEvent::Pass { .. })));
    assert_eq!(s.status(Seat::North), SeatStatus::Defeated);
    assert_eq!(s.seat_to_move(), Seat::East);
    assert_eq!(s.no_progress(), 0); // reset by the defeat
    check_invariants(&s);

    play(&mut s, "l7l6");
    play(&mut s, "e1f3");
    assert_eq!(s.no_progress(), 2);
    // North is DEFEATED and still stuck: it passes automatically (once).
    let ply_before = s.ply();
    let ev = play(&mut s, "b7b8");
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
    play(&mut s, "l6l5");
    play(&mut s, "f3e5");
    let ev = play(&mut s, "g6g1");
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
    assert_eq!(apply_move(&mut s, mv("l5l4")), Err(RulesError::GameOver));
    check_invariants(&s);
}

#[test]
fn teams_frozen_partner_plus_leader_loss_is_team_out() {
    let mut s = build(
        "teams",
        &["sKg1", "sNe1", "wKa7", "wQg6", "nKg12", "eKl7"],
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
    play(&mut s, "l7l6");
    play(&mut s, "e1f3");
    let ev = play(&mut s, "g6g1");
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
        &["sKg1", "wKa7", "nRa12", "eKl7"],
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
    // North's rooks attack h1 and e1; castling is still legal.
    let pieces = [
        "sKg1", "sRc1", "sRj1", "nRh12", "nRe11", "wKa7", "nKg12", "eKl7",
    ];
    let s = build("ffa", &pieces, "S AAAA Sc1,Sj1 - 0 0");
    assert!(is_legal(&s, "g1i1"));
    assert!(is_legal(&s, "g1e1"));
    assert_eq!(
        find_legal_move(&s, mv("g1i1")).unwrap().flag,
        MoveFlag::Castle
    );

    let mut short = s.clone();
    let ev = play(&mut short, "g1i1");
    assert!(ev.contains(&GameEvent::Castle {
        seat: Seat::South,
        rook_from: sq("j1"),
        rook_to: sq("h1")
    }));
    assert_eq!(
        short.piece_at(sq("i1")),
        Some(Piece::new(PieceKind::King, Seat::South))
    );
    assert_eq!(
        short.piece_at(sq("h1")),
        Some(Piece::new(PieceKind::Rook, Seat::South))
    );
    assert!(short.castling_rights(Seat::South).is_empty());
    check_invariants(&short);

    let mut long = s.clone();
    play(&mut long, "g1e1");
    assert_eq!(
        long.piece_at(sq("e1")),
        Some(Piece::new(PieceKind::King, Seat::South))
    );
    assert_eq!(
        long.piece_at(sq("f1")),
        Some(Piece::new(PieceKind::Rook, Seat::South))
    );
    assert_eq!(long.piece_at(sq("c1")), None);
    check_invariants(&long);
}

#[test]
fn castling_blocked_or_rights_lost() {
    let pieces = ["sKg1", "sRc1", "sRj1", "sBh1", "wKa7", "nKg12", "eKl7"];
    let s = build("ffa", &pieces, "S AAAA Sc1,Sj1 - 0 0");
    assert!(!is_legal(&s, "g1i1")); // h1 occupied
    assert!(is_legal(&s, "g1e1"));

    // Without the right there is no castle even with an empty path.
    let s = build(
        "ffa",
        &["sKg1", "sRc1", "sRj1", "wKa7", "nKg12", "eKl7"],
        "S AAAA Sj1 - 0 0",
    );
    assert!(!is_legal(&s, "g1e1"));
    assert!(is_legal(&s, "g1i1"));

    // Moving the leader away and back loses both rights.
    let mut s = build(
        "ffa",
        &["sKg1", "sRc1", "sRj1", "wKa7", "nKg12", "eKl7"],
        "S AAAA Sc1,Sj1 - 0 0",
    );
    play(&mut s, "g1g2");
    assert!(s.castling_rights(Seat::South).is_empty());

    // Moving a rook loses that side; capturing a rook loses that side.
    let mut s = build(
        "ffa",
        &["sKg1", "sRc1", "sRj1", "wKa7", "wRj5", "nKg12", "eKl7"],
        "S AAAA Sc1,Sj1 - 0 0",
    );
    play(&mut s, "c1c2");
    assert_eq!(
        s.castling_rights(Seat::South),
        CastlingRights {
            long: false,
            short: true
        }
    );
    play(&mut s, "j5j1");
    assert!(s.castling_rights(Seat::South).is_empty());
    check_invariants(&s);
}

#[test]
fn castling_for_west_north_east() {
    let s = build(
        "ffa",
        &[
            "sKg1", "wKa7", "wRa3", "wRa10", "nKg12", "nRc12", "eKl7", "eRl3",
        ],
        "W AAAA Wa3,Wa10,Nc12,El3 - 0 0",
    );
    let mut w = s.clone();
    play(&mut w, "a7a9");
    assert_eq!(
        w.piece_at(sq("a8")),
        Some(Piece::new(PieceKind::Rook, Seat::West))
    );
    play(&mut w, "g12e12");
    assert_eq!(
        w.piece_at(sq("f12")),
        Some(Piece::new(PieceKind::Rook, Seat::North))
    );
    play(&mut w, "l7l5");
    assert_eq!(
        w.piece_at(sq("l6")),
        Some(Piece::new(PieceKind::Rook, Seat::East))
    );
    check_invariants(&w);
    let mut w2 = s.clone();
    play(&mut w2, "a7a5");
    assert_eq!(
        w2.piece_at(sq("a6")),
        Some(Piece::new(PieceKind::Rook, Seat::West))
    );
}

#[test]
fn castling_rights_are_dropped_when_a_seat_leaves_active() {
    let s = build(
        "teams",
        &["sKg1", "sRj1", "wKa7", "nKg12", "eKl7"],
        "S ADAA Sj1 - 0 0 def=Ws",
    );
    // Rights for a non-ACTIVE seat are rejected by the parser...
    assert!(parse_position(&s.to_position_string().replace("Sj1 ", "Sj1,Wa10 ")).is_err());
    // ...and cleared by the engine on defeat.
    let mut t = build(
        "teams",
        &["sKg1", "sRj1", "wKa7", "nKg12", "eKl7"],
        "S AAAA Sj1 - 0 0",
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
        "sKg1", "wKa7", "nKl12", "eKl7", "sPd6", "nPe7", "nPh7", "wPf5", "ePg4",
    ];
    let cases = [
        (Seat::South, "d6", "d7", "d6e7"), // rank 7
        (Seat::North, "h7", "h6", "e7d6"), // rank 6
        (Seat::West, "f5", "g5", "f5g4"),  // file g
        (Seat::East, "g4", "f4", "g4f5"),  // file f
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
    let ev = play(&mut s, "d6e7n");
    assert!(ev.contains(&GameEvent::Promotion {
        seat: Seat::South,
        square: sq("e7"),
        kind: PieceKind::Knight
    }));
    assert_eq!(
        s.piece_at(sq("e7")),
        Some(Piece::new(PieceKind::Knight, Seat::South))
    );
    assert_eq!(s.no_progress(), 0);
    check_invariants(&s);
}

#[test]
fn promotion_line_is_five_steps_from_the_start_line() {
    for seat in Seat::ALL {
        for s in setup::pawn_line(seat) {
            let (fx, fy) = seat.forward();
            let five = s.offset(5 * fx, 5 * fy).unwrap();
            assert_eq!(seat.progress(five), setup::PROMOTION_PROGRESS);
        }
    }
}

// ---------------------------------------------------------------------------
// En passant
// ---------------------------------------------------------------------------

#[test]
fn en_passant_capture() {
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let mut s = start(mode);
        play(&mut s, "c2c4");
        assert_eq!(
            s.ep_target(Seat::South),
            Some(EpTarget {
                skipped: sq("c3"),
                pawn: sq("c4")
            })
        );
        // West's b4 pawn captures diagonally onto c3.
        let m = find_legal_move(&s, mv("b4c3")).unwrap();
        assert_eq!(m.flag, MoveFlag::EnPassant);
        let ev = play(&mut s, "b4c3");
        assert!(ev.contains(&GameEvent::EnPassant {
            seat: Seat::West,
            captured_square: sq("c4")
        }));
        assert_eq!(s.piece_at(sq("c4")), None);
        assert_eq!(
            s.piece_at(sq("c3")),
            Some(Piece::new(PieceKind::Pawn, Seat::West))
        );
        check_invariants(&s);
    }
}

#[test]
fn en_passant_expires_when_turn_order_returns() {
    let mut s = start(GameMode::Ffa);
    play(&mut s, "c2c4");
    play(&mut s, "a4c5"); // West declines
    assert!(s.ep_target(Seat::South).is_some()); // still live for North/East
    play(&mut s, "d12c10");
    play(&mut s, "l4j5");
    // The pointer reached South: target cleared before South moves.
    assert_eq!(s.ep_target(Seat::South), None);
    play(&mut s, "d2d3");
    assert!(!is_legal(&s, "b4c3"));
    check_invariants(&s);
}

#[test]
fn en_passant_expires_when_double_stepper_stops_taking_turns() {
    let mut s = start(GameMode::Teams);
    play(&mut s, "c2c4");
    assert!(is_legal(&s, "b4c3"));
    apply_abandon(&mut s, Seat::South).unwrap(); // South frozen while West is on move
    assert_eq!(s.ep_target(Seat::South), None);
    assert_eq!(s.seat_to_move(), Seat::West);
    assert!(!is_legal(&s, "b4c3"));
    check_invariants(&s);
}

#[test]
fn en_passant_skipped_seat_target_is_cleared() {
    // West is frozen (skipped). South's target set on its move is cleared
    // only when the pointer next reaches South; a frozen seat's own target
    // can never exist.
    let mut s = build(
        "teams",
        &["sKg1", "sPd2", "wKa7", "nKg12", "nPe11", "eKl7"],
        "S AFAA - - 0 0 def=Wt",
    );
    play(&mut s, "d2d4");
    assert_eq!(s.seat_to_move(), Seat::North);
    assert!(s.ep_target(Seat::South).is_some());
    play(&mut s, "e11e10");
    play(&mut s, "l7l6");
    assert_eq!(s.seat_to_move(), Seat::South);
    assert_eq!(s.ep_target(Seat::South), None);
    check_invariants(&s);
}

#[test]
fn en_passant_can_promote() {
    // North g11-g9 skips g10, which is on West's promotion file g.
    let mut s = build(
        "ffa",
        &["sKg1", "wKa7", "wPf11", "nKl12", "nPg11", "eKl7"],
        "N AAAA - - 0 0",
    );
    play(&mut s, "g11g9");
    play(&mut s, "l7l6");
    play(&mut s, "g1g2");
    let promos: Vec<String> = move_strings(&s)
        .into_iter()
        .filter(|m| m.starts_with("f11g10"))
        .collect();
    assert_eq!(promos, vec!["f11g10b", "f11g10n", "f11g10q", "f11g10r"]);
    let ev = play(&mut s, "f11g10q");
    assert!(ev.contains(&GameEvent::EnPassant {
        seat: Seat::West,
        captured_square: sq("g9")
    }));
    assert_eq!(
        s.piece_at(sq("g10")),
        Some(Piece::new(PieceKind::Queen, Seat::West))
    );
    assert_eq!(s.piece_at(sq("g9")), None);
    check_invariants(&s);
}

#[test]
fn en_passant_disabled_by_config() {
    let mut cfg = GameConfig::new(GameMode::Ffa);
    cfg.en_passant_enabled = false;
    let mut s = GameState::new(cfg).unwrap();
    play(&mut s, "c2c4");
    assert_eq!(s.ep_target(Seat::South), None);
    assert!(!is_legal(&s, "b4c3"));
    assert!(s.to_position_string().contains("ep=off"));
    check_invariants(&s);
}

// ---------------------------------------------------------------------------
// Move limit
// ---------------------------------------------------------------------------

const KINGS: [&str; 4] = ["sKg1", "wKa7", "nKg12", "eKl7"];

#[test]
fn move_limit_ffa_tie() {
    let mut s = build("ffa", &KINGS, "S AAAA - - 98 40");
    play(&mut s, "g1g2");
    assert!(!s.is_over());
    let ev = play(&mut s, "a7a6");
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
    let mut s = build("ffa", &["sKg1", "nKg12", "eKl7"], "S ARAA - - 74 0 def=Wl");
    assert_eq!(s.move_limit(), 75);
    let ev = play(&mut s, "g1g2");
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
    let ev = play(&mut s, "g1g2");
    assert_eq!(ended(&ev).unwrap().result, GameResult::TeamsDraw);
    assert_eq!(ended(&ev).unwrap().placements, [1; 4]);
    check_invariants(&s);
}

#[test]
fn move_limit_resets_on_capture_pawn_move_and_defeat() {
    let mut s = build(
        "ffa",
        &["sKg1", "sRa1", "sPd2", "wKa7", "wNa3", "nKg12", "eKl7"],
        "S AAAA - - 50 0",
    );
    play(&mut s, "a1a3");
    assert_eq!(s.no_progress(), 0);
    play(&mut s, "a7a6");
    assert_eq!(s.no_progress(), 1);
    play(&mut s, "g12g11");
    play(&mut s, "l7l6");
    assert_eq!(s.no_progress(), 3);
    play(&mut s, "d2d3");
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
        &["sKg1", "wKa7", "nRa12", "eKl7"],
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
    let ev = play(&mut s, "a7b7"); // 96, North passes: 97
    assert!(ev.contains(&GameEvent::Pass { seat: Seat::North }));
    assert_eq!(s.no_progress(), 97);
    play(&mut s, "l7l6"); // 98
    let ev = play(&mut s, "e1f3"); // 99
    assert!(!s.is_over(), "{ev:?}");
    let ev = play(&mut s, "b7b8"); // 100 -> draw before North's pass
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
        "a1a2", "b3c4", "c2c5", "c2c3q", "g1i1", "g1g2", "d1d3", "l12a1", "f1f12", "c2d3",
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
        ..mv("c2c3")
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
