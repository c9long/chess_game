//! Adversarial tests for seat statuses and game end, derived from PLAN §2
//! ("Seat status" and "Defeat & end of game") and the Teams cases of §12.
//!
//! Every position is set up through the position-string format.

mod common;

use common::*;
use rules_core::*;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn defeat_events(ev: &[GameEvent]) -> Vec<(Seat, DefeatReason)> {
    ev.iter()
        .filter_map(|e| match e {
            GameEvent::Defeat { seat, reason } => Some((*seat, *reason)),
            _ => None,
        })
        .collect()
}

fn passes(ev: &[GameEvent]) -> Vec<Seat> {
    ev.iter()
        .filter_map(|e| match e {
            GameEvent::Pass { seat } => Some(*seat),
            _ => None,
        })
        .collect()
}

fn removed(ev: &[GameEvent]) -> Vec<Seat> {
    ev.iter()
        .filter_map(|e| match e {
            GameEvent::ArmyRemoved { seat } => Some(*seat),
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

/// Index of the first event matching `pred`.
fn pos(ev: &[GameEvent], pred: impl Fn(&GameEvent) -> bool) -> usize {
    ev.iter()
        .position(pred)
        .unwrap_or_else(|| panic!("event not found in {ev:?}"))
}

/// Asserts the game is over with `outcome`, that `GameEnded` is the last
/// event, and that nothing more can be played.
fn assert_finished(s: &mut GameState, ev: &[GameEvent], expected: Outcome) {
    assert_eq!(ended(ev), Some(expected), "events: {ev:?}");
    assert!(matches!(ev.last(), Some(GameEvent::GameEnded { .. })));
    assert!(s.is_over());
    assert_eq!(s.outcome(), Some(&expected));
    assert!(legal_moves(s).is_empty());
    let to_move = s.seat_to_move();
    assert_eq!(apply_timeout(s, to_move), Err(RulesError::GameOver));
    for seat in Seat::ALL {
        assert_eq!(apply_abandon(s, seat), Err(RulesError::GameOver));
    }
    check_invariants(s);
}

fn teams_win(team: Team) -> Outcome {
    let mut placements = [2u8; 4];
    for s in team.seats() {
        placements[s.index()] = 1;
    }
    Outcome {
        result: GameResult::TeamsWinner { team },
        placements,
    }
}

fn with(base: &[&'static str], extra: &[&'static str]) -> Vec<&'static str> {
    let mut v = base.to_vec();
    v.extend_from_slice(extra);
    v
}

/// North boxed in the a12 corner: K a12, R b12, B c12, B a10,
/// P a11 b11 b10 b9 d11. The only "doors" are b8 (in front of P b9) and d10
/// (in front of P d11); a blocker there cannot be captured by these pawns.
/// a8, c8, a9, c9, c10, e10 must stay free of North's opponents.
const NORTH_BOX: [&str; 9] = [
    "nKa12", "nRb12", "nBc12", "nBa10", "nPa11", "nPb11", "nPb10", "nPb9", "nPd11",
];

/// East boxed in the l1 corner (the South box rotated): K l1, R l2, B l3,
/// B j1, P k1 k2 j2 i2 k4. Doors: h2 (in front of P i2) and j4 (in front of
/// P k4). j3, j5, i3, i1, h3, h1 must stay free of East's opponents.
const EAST_BOX: [&str; 9] = [
    "eKl1", "eRl2", "eBl3", "eBj1", "ePk1", "ePk2", "ePj2", "ePi2", "ePk4",
];

/// South boxed in the a1 corner: K a1, R b1, B c1, B a3, P a2 b2 b3 b4 d2.
/// Doors: b5 and d3.
const SOUTH_BOX: [&str; 9] = [
    "sKa1", "sRb1", "sBc1", "sBa3", "sPa2", "sPb2", "sPb3", "sPb4", "sPd2",
];

// ---------------------------------------------------------------------------
// Fixture sanity: the boxes really have no legal move
// ---------------------------------------------------------------------------

#[test]
fn fixture_boxes_have_no_legal_moves() {
    let s = build(
        "ffa",
        &with(&NORTH_BOX, &["eNb8", "eNd10", "sKg1", "wKa7", "eKl7"]),
        "S AAAA - - 0 0",
    );
    assert!(!has_legal_move(&s, Seat::North));
    let s = build(
        "ffa",
        &with(&EAST_BOX, &["sNh2", "sNj4", "sKe1", "wKa7", "nKg12"]),
        "S AAAA - - 0 0",
    );
    assert!(!has_legal_move(&s, Seat::East));
    let s = build(
        "ffa",
        &with(&SOUTH_BOX, &["eRb5", "eNd3", "wKa7", "nKg12", "eKl7"]),
        "W AAAA - - 0 0",
    );
    assert!(!has_legal_move(&s, Seat::South));
}

// ---------------------------------------------------------------------------
// Leader capture (FFA)
// ---------------------------------------------------------------------------

#[test]
fn ffa_east_captures_west_leader_across_the_board() {
    // East and West are not neighbours in turn order; the capture is
    // still immediate.
    let mut s = build(
        "ffa",
        &["sKg1", "wKa7", "wNc9", "wPb4", "nKg12", "eKl2", "eRl7"],
        "E AAAA - - 3 0",
    );
    let ev = play(&mut s, "l7a7");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::West, DefeatReason::LeaderCaptured)]
    );
    assert_eq!(removed(&ev), vec![Seat::West]);
    assert_eq!(s.status(Seat::West), SeatStatus::Removed);
    assert_eq!(s.pieces_of(Seat::West).count(), 0);
    assert_eq!(s.piece_at(sq("c9")), None);
    assert_eq!(s.piece_at(sq("b4")), None);
    assert_eq!(s.seat_to_move(), Seat::South);
    assert!(!s.is_over());
    check_invariants(&s);
    // West's turn is skipped from now on.
    play(&mut s, "g1g2");
    assert_eq!(s.seat_to_move(), Seat::North);
    check_invariants(&s);
}

#[test]
fn ffa_capturing_the_next_seats_leader_skips_its_turn() {
    let mut s = build(
        "ffa",
        &["sKg1", "sRa1", "wKa7", "wQf6", "nKg12", "eKl7"],
        "S AAAA - - 0 0",
    );
    let ev = play(&mut s, "a1a7");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::West, DefeatReason::LeaderCaptured)]
    );
    assert_eq!(s.seat_to_move(), Seat::North);
    assert_eq!(s.piece_at(sq("f6")), None, "West's queen must be removed");
    assert_eq!(s.move_limit(), 75);
    check_invariants(&s);
}

#[test]
fn ffa_leader_capture_by_promotion() {
    // A pawn reaching rank 7 by capturing the leader both promotes and defeats.
    let mut s = build(
        "ffa",
        &["sKg1", "sPf6", "wKg7", "wRa3", "nKg12", "eKl7"],
        "S AAAA - - 0 0",
    );
    let ev = play(&mut s, "f6g7q");
    assert!(ev.iter().any(|e| matches!(
        e,
        GameEvent::Promotion {
            seat: Seat::South,
            kind: PieceKind::Queen,
            ..
        }
    )));
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::West, DefeatReason::LeaderCaptured)]
    );
    assert_eq!(
        s.piece_at(sq("g7")),
        Some(Piece::new(PieceKind::Queen, Seat::South))
    );
    assert_eq!(s.status(Seat::West), SeatStatus::Removed);
    assert_eq!(s.pieces_of(Seat::West).count(), 0);
    assert_eq!(s.seat_to_move(), Seat::North);
    check_invariants(&s);
}

#[test]
fn ffa_last_leader_capture_wins_with_reverse_defeat_placements() {
    // North was defeated first, then East; South now takes West's leader.
    let mut s = build(
        "ffa",
        &["sKg1", "sRa1", "wKa7", "wPb5"],
        "S AARR - - 0 0 def=Nl,Et",
    );
    let ev = play(&mut s, "a1a7");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::West, DefeatReason::LeaderCaptured)]
    );
    assert_eq!(s.pieces_of(Seat::West).count(), 0);
    let expected = Outcome {
        result: GameResult::FfaWinner { seat: Seat::South },
        // S 1st, then reverse order of defeat: W 2nd, E 3rd, N 4th.
        placements: [1, 2, 4, 3],
    };
    assert_finished(&mut s, &ev, expected);
}

#[test]
fn ffa_defeat_event_order_is_defeat_then_removal_then_end() {
    let mut s = build("ffa", &["sKg1", "sRa1", "wKa7"], "S AARR - - 0 0 def=Nl,Et");
    let ev = play(&mut s, "a1a7");
    let made = pos(&ev, |e| matches!(e, GameEvent::MoveMade { .. }));
    let cap = pos(&ev, |e| matches!(e, GameEvent::Capture { .. }));
    let def = pos(&ev, |e| matches!(e, GameEvent::Defeat { .. }));
    let end = pos(&ev, |e| matches!(e, GameEvent::GameEnded { .. }));
    assert_eq!(made, 0);
    assert!(cap < def && def < end);
    if let Some(rm) = ev
        .iter()
        .position(|e| matches!(e, GameEvent::ArmyRemoved { .. }))
    {
        assert!(def < rm && rm < end);
    }
}

// ---------------------------------------------------------------------------
// Stalemate timing and cascades (FFA)
// ---------------------------------------------------------------------------

#[test]
fn ffa_cascade_leader_capture_then_turn_start_stalemate() {
    // South takes West's leader; North (next) is boxed in by East's knights:
    // stalemated at the start of its turn and removed. East is next.
    let mut s = build(
        "ffa",
        &with(
            &NORTH_BOX,
            &["eNb8", "eNd10", "eKl7", "sKg1", "sRa1", "wKa7"],
        ),
        "S AAAA - - 0 0",
    );
    let ev = play(&mut s, "a1a7");
    assert_eq!(
        defeat_events(&ev),
        vec![
            (Seat::West, DefeatReason::LeaderCaptured),
            (Seat::North, DefeatReason::Stalemate),
        ]
    );
    assert_eq!(removed(&ev), vec![Seat::West, Seat::North]);
    assert_eq!(s.status(Seat::West), SeatStatus::Removed);
    assert_eq!(s.status(Seat::North), SeatStatus::Removed);
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert_eq!(s.seat_to_move(), Seat::East);
    assert_eq!(s.no_progress(), 0);
    assert_eq!(s.move_limit(), 50);
    assert!(!s.is_over());
    let order: Vec<_> = s.defeats().iter().map(|r| (r.seat, r.reason)).collect();
    assert_eq!(
        order,
        vec![
            (Seat::West, DefeatReason::LeaderCaptured),
            (Seat::North, DefeatReason::Stalemate)
        ]
    );
    check_invariants(&s);
}

#[test]
fn ffa_removed_army_no_longer_blocks_so_no_stalemate() {
    // Same, but North is boxed only by West's knights. Once West's army is
    // removed, North has moves at the start of its turn and stays ACTIVE.
    let mut s = build(
        "ffa",
        &with(
            &NORTH_BOX,
            &["wNb8", "wNd10", "eKl7", "sKg1", "sRa1", "wKa7"],
        ),
        "S AAAA - - 0 0",
    );
    assert!(!has_legal_move(&s, Seat::North));
    let ev = play(&mut s, "a1a7");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::West, DefeatReason::LeaderCaptured)]
    );
    assert_eq!(s.status(Seat::North), SeatStatus::Active);
    assert_eq!(s.seat_to_move(), Seat::North);
    assert!(is_legal(&s, "b9b8"));
    assert!(is_legal(&s, "d11d10"));
    check_invariants(&s);
}

#[test]
fn ffa_double_stalemate_cascade_ends_the_game() {
    // South takes West's leader; North then East are stalemated in turn
    // (both boxed by South's knights). South is the last ACTIVE seat.
    let mut pieces = with(&NORTH_BOX, &EAST_BOX);
    pieces.extend(["sNb8", "sNd10", "sNh2", "sNj4", "sKe1", "sRa1", "wKa7"]);
    let mut s = build("ffa", &pieces, "S AAAA - - 0 0");
    let ev = play(&mut s, "a1a7");
    assert_eq!(
        defeat_events(&ev),
        vec![
            (Seat::West, DefeatReason::LeaderCaptured),
            (Seat::North, DefeatReason::Stalemate),
            (Seat::East, DefeatReason::Stalemate),
        ]
    );
    assert_eq!(removed(&ev), vec![Seat::West, Seat::North, Seat::East]);
    for seat in [Seat::West, Seat::North, Seat::East] {
        assert_eq!(s.pieces_of(seat).count(), 0, "{seat}");
    }
    let expected = Outcome {
        result: GameResult::FfaWinner { seat: Seat::South },
        // S 1st, E (last defeated) 2nd, N 3rd, W 4th.
        placements: [1, 4, 3, 2],
    };
    assert_finished(&mut s, &ev, expected);
}

#[test]
fn ffa_stalemate_is_judged_only_at_the_start_of_the_seats_own_turn() {
    // East is boxed after South's move, but North moves first and opens a
    // capture for East. East must not be defeated early.
    let mut s = build(
        "ffa",
        &with(
            &EAST_BOX,
            &["sNh2", "sNj4", "sKe1", "wKa7", "nKg12", "nBg6"],
        ),
        "S AAAA - - 0 0",
    );
    let ev = play(&mut s, "e1d1");
    assert!(defeat_events(&ev).is_empty());
    assert_eq!(s.status(Seat::East), SeatStatus::Active);
    play(&mut s, "a7a6");
    let ev = play(&mut s, "g6j3");
    assert!(defeat_events(&ev).is_empty(), "{ev:?}");
    assert_eq!(s.status(Seat::East), SeatStatus::Active);
    assert_eq!(s.seat_to_move(), Seat::East);
    assert!(is_legal(&s, "k2j3"));
    assert!(is_legal(&s, "k4j3"));
    check_invariants(&s);
}

#[test]
fn ffa_stalemate_at_turn_start_after_a_quiet_move_resets_counter() {
    let mut s = build(
        "ffa",
        &with(&EAST_BOX, &["sNh2", "sNj4", "sKe1", "wKa7", "nKg12"]),
        "N AAAA - - 20 0",
    );
    let ev = play(&mut s, "g12g11");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::East, DefeatReason::Stalemate)]
    );
    assert_eq!(removed(&ev), vec![Seat::East]);
    assert_eq!(s.seat_to_move(), Seat::South);
    // "...since the last capture, pawn move or defeat." Whether the
    // stalemated turn itself counts is not specified, so allow 0 or 1.
    assert!(s.no_progress() <= 1, "no_progress = {}", s.no_progress());
    check_invariants(&s);
}

#[test]
fn ffa_timeout_then_next_seat_stalemated_in_one_step() {
    let mut s = build(
        "ffa",
        &with(
            &EAST_BOX,
            &["sNh2", "sNj4", "sKe1", "wKa7", "nKg12", "nRc12"],
        ),
        "N AAAA - - 0 0",
    );
    let ev = apply_timeout(&mut s, Seat::North).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![
            (Seat::North, DefeatReason::Timeout),
            (Seat::East, DefeatReason::Stalemate),
        ]
    );
    assert_eq!(removed(&ev), vec![Seat::North, Seat::East]);
    assert_eq!(s.status(Seat::North), SeatStatus::Removed);
    assert_eq!(s.status(Seat::East), SeatStatus::Removed);
    assert_eq!(s.seat_to_move(), Seat::South);
    assert!(!s.is_over());
    check_invariants(&s);
}

// ---------------------------------------------------------------------------
// Timeout / abandon (FFA)
// ---------------------------------------------------------------------------

#[test]
fn timeout_is_only_for_the_seat_to_move_and_leaves_state_untouched() {
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let mut s = GameState::new(GameConfig::new(mode)).unwrap();
        let before = s.clone();
        for seat in [Seat::West, Seat::North, Seat::East] {
            assert_eq!(
                apply_timeout(&mut s, seat),
                Err(RulesError::NotSeatToMove {
                    seat,
                    to_move: Seat::South
                })
            );
            assert_eq!(s, before);
        }
    }
}

#[test]
fn ffa_timeout_resets_no_progress_and_removes_army() {
    let mut s = build(
        "ffa",
        &["sKg1", "sQd4", "wKa7", "nKg12", "eKl7"],
        "S AAAA - - 50 0",
    );
    let ev = apply_timeout(&mut s, Seat::South).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::South, DefeatReason::Timeout)]
    );
    assert_eq!(removed(&ev), vec![Seat::South]);
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_eq!(s.seat_to_move(), Seat::West);
    assert_eq!(s.no_progress(), 0, "a timeout defeat resets the counter");
    assert_eq!(s.move_limit(), 75);
    check_invariants(&s);
}

#[test]
fn ffa_abandon_by_seat_not_on_move_can_end_the_game() {
    let mut s = build("ffa", &["sKg1", "wKa7", "wRb4"], "S AARR - - 0 0 def=Nl,Es");
    let ev = apply_abandon(&mut s, Seat::West).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::West, DefeatReason::Abandon)]
    );
    assert_eq!(s.pieces_of(Seat::West).count(), 0);
    let expected = Outcome {
        result: GameResult::FfaWinner { seat: Seat::South },
        placements: [1, 2, 4, 3],
    };
    assert_finished(&mut s, &ev, expected);
}

#[test]
fn ffa_abandon_on_move_skips_removed_seats() {
    let mut s = build("ffa", &["sKg1", "wKa7", "eKl7"], "W AARA - - 0 0 def=Nl");
    let ev = apply_abandon(&mut s, Seat::West).unwrap();
    assert_eq!(removed(&ev), vec![Seat::West]);
    assert_eq!(s.seat_to_move(), Seat::East);
    assert!(!s.is_over());
    check_invariants(&s);
}

#[test]
fn abandon_rejected_for_seats_that_no_longer_take_turns() {
    let mut s = build("ffa", &["sKg1", "wKa7", "eKl7"], "S AARA - - 0 0 def=Nl");
    let before = s.clone();
    assert_eq!(
        apply_abandon(&mut s, Seat::North),
        Err(RulesError::SeatNotInPlay(Seat::North))
    );
    assert_eq!(s, before);

    let mut t = build(
        "teams",
        &["sKg1", "wKa7", "nKg12", "eKl7"],
        "S AAFA - - 0 0 def=Nt",
    );
    let before = t.clone();
    assert_eq!(
        apply_abandon(&mut t, Seat::North),
        Err(RulesError::SeatNotInPlay(Seat::North))
    );
    assert!(apply_timeout(&mut t, Seat::North).is_err());
    assert_eq!(t, before);
}

// ---------------------------------------------------------------------------
// Teams: DEFEATED seats
// ---------------------------------------------------------------------------

#[test]
fn teams_defeated_seat_can_capture_an_active_leader() {
    // West is DEFEATED (partner East ACTIVE) but still takes its turns; its
    // queen takes North's king. South is ACTIVE, so the game continues.
    let mut s = build(
        "teams",
        &["sKg1", "wQg6", "nKg12", "nRa12", "eKl7"],
        "W ADAA - - 0 0 def=Wl",
    );
    let ev = play(&mut s, "g6g12");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::LeaderCaptured)]
    );
    assert!(removed(&ev).is_empty());
    assert_eq!(s.status(Seat::North), SeatStatus::Defeated);
    assert_eq!(s.seat_to_move(), Seat::North);
    assert!(!s.is_over());
    check_invariants(&s);
}

#[test]
fn teams_defeated_seat_leader_capture_knocks_the_other_team_out() {
    // South is already DEFEATED; West (also DEFEATED, partner East ACTIVE)
    // takes North's king: South+North has no ACTIVE seat.
    let mut s = build(
        "teams",
        &["sRc1", "wQg6", "nKg12", "nRa12", "eKl7"],
        "W DDAA - - 0 0 def=Sl,Wl",
    );
    let ev = play(&mut s, "g6g12");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::LeaderCaptured)]
    );
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert!(s.pieces_of(Seat::West).count() > 0);
    assert_finished(&mut s, &ev, teams_win(Team::WestEast));
}

#[test]
fn teams_leader_loss_with_no_moves_passes_immediately_not_stalemate() {
    // West takes North's king; North's only other piece is a blocked pawn.
    // North is DEFEATED (South ACTIVE); on its turn it passes. The
    // stalemate defeat must not be applied on top of the leader loss.
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "wQg6", "wNe8", "nKg12", "nPe9", "eKl7"],
        "W AAAA - - 0 0",
    );
    let ev = play(&mut s, "g6g12");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::LeaderCaptured)]
    );
    assert_eq!(passes(&ev), vec![Seat::North]);
    assert!(
        pos(&ev, |e| matches!(e, GameEvent::Defeat { .. }))
            < pos(&ev, |e| matches!(e, GameEvent::Pass { .. }))
    );
    assert_eq!(s.status(Seat::North), SeatStatus::Defeated);
    assert_eq!(s.defeats().len(), 1);
    assert_eq!(s.seat_to_move(), Seat::East);
    check_invariants(&s);
}

#[test]
fn teams_stalemated_seat_passes_then_moves_again_once_unblocked() {
    // North boxed by South's (teammate) knights.
    let mut s = build(
        "teams",
        &with(&NORTH_BOX, &["sNb8", "sNd10", "sKg1", "wKa7", "eKl7"]),
        "W AAAA - - 0 0",
    );
    let ev = play(&mut s, "a7a6");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::Stalemate)]
    );
    assert!(passes(&ev).is_empty());
    assert_eq!(s.status(Seat::North), SeatStatus::Defeated);
    assert_eq!(s.seat_to_move(), Seat::East);
    check_invariants(&s);

    play(&mut s, "l7l6");
    play(&mut s, "g1g2");
    let ev = play(&mut s, "a6a7");
    assert_eq!(passes(&ev), vec![Seat::North]);
    assert!(defeat_events(&ev).is_empty(), "stalemate happens only once");
    assert_eq!(s.seat_to_move(), Seat::East);
    assert_eq!(s.defeats().len(), 1);
    check_invariants(&s);

    play(&mut s, "l6l7");
    play(&mut s, "b8c6"); // South opens the door on b8
    let ev = play(&mut s, "a7a6");
    assert!(passes(&ev).is_empty(), "North has a move now: {ev:?}");
    assert_eq!(s.seat_to_move(), Seat::North);
    assert_eq!(s.status(Seat::North), SeatStatus::Defeated);
    assert!(is_legal(&s, "b9b8"));
    play(&mut s, "b9b8");
    assert_eq!(s.seat_to_move(), Seat::East);
    check_invariants(&s);
}

#[test]
fn teams_stalemated_seat_cannot_castle_even_when_the_path_clears() {
    // North's K g12 and R j12 are unmoved with castling rights, but every
    // exit is blocked by South's (teammate) pieces: North is stalemated.
    let pieces = [
        "nKg12", "nRj12", "nPc11", "sRf12", "sNh12", "sNi12", "sRk12", "sBf11", "sNg11", "sBh11",
        "sNj11", "sNc10", "sKg1", "wKa7", "eKl7",
    ];
    let mut s = build("teams", &pieces, "W AAAA Nj12 - 0 0");
    assert!(!has_legal_move(&s, Seat::North));
    let ev = play(&mut s, "a7a6");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::Stalemate)]
    );
    assert!(s.castling_rights(Seat::North).is_empty());
    play(&mut s, "l7l6");
    play(&mut s, "c10e9"); // frees North's pawn
    play(&mut s, "a6a7");
    assert_eq!(s.seat_to_move(), Seat::North);
    play(&mut s, "c11c10");
    play(&mut s, "l6l7");
    play(&mut s, "h12g10"); // frees h12
    play(&mut s, "a7a6");
    play(&mut s, "c10c9");
    play(&mut s, "l7l6");
    play(&mut s, "i12k11"); // frees i12
    play(&mut s, "a6a7");
    assert_eq!(s.seat_to_move(), Seat::North);
    assert_eq!(s.status(Seat::North), SeatStatus::Defeated);
    assert!(is_legal(&s, "g12h12"));
    assert!(is_legal(&s, "j12i12"));
    assert!(
        !is_legal(&s, "g12i12"),
        "a non-ACTIVE seat's leader cannot castle"
    );
    check_invariants(&s);
}

#[test]
fn teams_stalemate_cascade_with_pass_ends_in_team_out() {
    // West moves; North (boxed) is stalemated; East (DEFEATED, no pieces)
    // passes; South (boxed) is stalemated -> South+North out.
    let mut pieces = with(&NORTH_BOX, &SOUTH_BOX);
    pieces.extend(["wNb8", "wNd10", "wRb5", "wNd3", "wKa7"]);
    let mut s = build("teams", &pieces, "W AAAD - - 0 0 def=El");
    let ev = play(&mut s, "a7a6");
    assert_eq!(
        defeat_events(&ev),
        vec![
            (Seat::North, DefeatReason::Stalemate),
            (Seat::South, DefeatReason::Stalemate),
        ]
    );
    assert_eq!(passes(&ev), vec![Seat::East]);
    assert!(
        pos(&ev, |e| matches!(e, GameEvent::Pass { .. }))
            < pos(&ev, |e| matches!(
                e,
                GameEvent::Defeat {
                    seat: Seat::South,
                    ..
                }
            ))
    );
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert_finished(&mut s, &ev, teams_win(Team::WestEast));
}

#[test]
fn teams_stalemate_then_partner_with_no_moves_passes_in_same_step() {
    // West moves; North (boxed) is stalemated (South ACTIVE, game goes on);
    // East is DEFEATED with no pieces and passes; South is on move.
    let mut s = build(
        "teams",
        &with(&NORTH_BOX, &["wNb8", "wNd10", "wKa7", "sKg1"]),
        "W AAAD - - 0 0 def=El",
    );
    let ev = play(&mut s, "a7a6");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::Stalemate)]
    );
    assert_eq!(passes(&ev), vec![Seat::East]);
    assert_eq!(s.seat_to_move(), Seat::South);
    assert!(!s.is_over());
    check_invariants(&s);
}

// ---------------------------------------------------------------------------
// Teams: team out
// ---------------------------------------------------------------------------

#[test]
fn teams_stalemate_with_defeated_partner_is_team_out() {
    let mut s = build(
        "teams",
        &with(&NORTH_BOX, &["wNb8", "wNd10", "wKa7", "eKl7", "sRe1"]),
        "W DAAA - - 0 0 def=Sl",
    );
    let ev = play(&mut s, "a7a6");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::Stalemate)]
    );
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert_finished(&mut s, &ev, teams_win(Team::WestEast));
}

#[test]
fn teams_stalemate_with_frozen_partner_is_team_out_and_frozen_pieces_go() {
    // South is FROZEN but still holds its king: that king does not keep the
    // team alive. Frozen pieces are removed with the team.
    let mut s = build(
        "teams",
        &with(
            &NORTH_BOX,
            &["wNb8", "wNd10", "wKa7", "eKl7", "sKg1", "sQd1"],
        ),
        "W FAAA - - 0 0 def=St",
    );
    let ev = play(&mut s, "a7a6");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::Stalemate)]
    );
    assert!(removed(&ev).contains(&Seat::South));
    assert!(removed(&ev).contains(&Seat::North));
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_finished(&mut s, &ev, teams_win(Team::WestEast));
}

#[test]
fn teams_timeout_with_stalemated_partner_holding_king_is_team_out() {
    // North was stalemated earlier and still has its king (an ordinary
    // piece now). South times out -> no ACTIVE seat on South+North.
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "nKa12", "nPa11", "eKl7"],
        "S AADA - - 0 0 def=Ns",
    );
    let ev = apply_timeout(&mut s, Seat::South).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::South, DefeatReason::Timeout)]
    );
    assert_eq!(s.status(Seat::South), SeatStatus::Frozen);
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_finished(&mut s, &ev, teams_win(Team::WestEast));
}

#[test]
fn teams_abandon_of_active_seat_not_on_move_with_defeated_partner() {
    let mut s = build(
        "teams",
        &["sRe1", "wKa7", "nKg12", "eKl7"],
        "W DAAA - - 0 0 def=Sl",
    );
    let ev = apply_abandon(&mut s, Seat::North).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::Abandon)]
    );
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_finished(&mut s, &ev, teams_win(Team::WestEast));
}

#[test]
fn teams_capturing_the_last_active_leader_ends_game_even_with_defeated_seat_next() {
    // East takes South's king while North is DEFEATED: the team is out
    // immediately, before North's turn comes round.
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "nRa12", "eKl7", "eRg8"],
        "E AADA - - 0 0 def=Nl",
    );
    let ev = play(&mut s, "g8g1");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::South, DefeatReason::LeaderCaptured)]
    );
    assert!(passes(&ev).is_empty());
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert_finished(&mut s, &ev, teams_win(Team::WestEast));
}

#[test]
fn teams_south_north_can_win_too() {
    // Mirror case to catch a hard-coded winner: North takes West's king while
    // East is FROZEN.
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "wPb5", "nKg12", "nRa12", "eKl7"],
        "N AAAF - - 0 0 def=Et",
    );
    let ev = play(&mut s, "a12a7");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::West, DefeatReason::LeaderCaptured)]
    );
    assert_eq!(s.pieces_of(Seat::West).count(), 0);
    assert_eq!(s.pieces_of(Seat::East).count(), 0);
    assert_finished(&mut s, &ev, teams_win(Team::SouthNorth));
}

// ---------------------------------------------------------------------------
// Teams: FROZEN seats
// ---------------------------------------------------------------------------

#[test]
fn teams_frozen_leader_capture_has_no_effect_and_teammate_cannot_capture() {
    let mut s = build(
        "teams",
        &["sKg1", "sRc1", "wKa7", "wQg6", "nKg12", "nRc12", "eKl7"],
        "W AAFA - - 10 0 def=Nt",
    );
    let ev = play(&mut s, "g6g12");
    assert!(defeat_events(&ev).is_empty());
    assert!(removed(&ev).is_empty());
    assert!(!s.is_over());
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert_eq!(s.no_progress(), 0, "a capture is progress");
    assert_eq!(s.seat_to_move(), Seat::East);
    check_invariants(&s);
    play(&mut s, "l7l6");
    assert_eq!(s.seat_to_move(), Seat::South);
    // Frozen teammate's rook blocks and cannot be captured by South.
    assert!(is_legal(&s, "c1c11"));
    assert!(!is_legal(&s, "c1c12"));
    play(&mut s, "c1c11");
    assert_eq!(s.seat_to_move(), Seat::West, "frozen North is skipped");
    // West (an opponent) can capture the frozen rook.
    let ev = play(&mut s, "g12c12");
    assert!(ev.iter().any(|e| matches!(e, GameEvent::Capture { .. })));
    assert!(defeat_events(&ev).is_empty());
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert_eq!(s.seat_to_move(), Seat::East);
    check_invariants(&s);
}

#[test]
fn teams_frozen_seat_is_skipped_giving_a_team_two_turns_in_a_row() {
    let mut s = GameState::new(GameConfig::new(GameMode::Teams)).unwrap();
    play(&mut s, "e2e3");
    play(&mut s, "b5c5");
    let ev = apply_timeout(&mut s, Seat::North).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::Timeout)]
    );
    assert!(ev.contains(&GameEvent::Frozen { seat: Seat::North }));
    assert_eq!(s.pieces_of(Seat::North).count(), 16);
    assert_eq!(s.seat_to_move(), Seat::East);
    let mut order = Vec::new();
    for m in ["k5j5", "f2f3", "b6c6", "k6j6", "g2g3", "b7c7"] {
        order.push(s.seat_to_move());
        play(&mut s, m);
    }
    assert_eq!(
        order,
        vec![
            Seat::East,
            Seat::South,
            Seat::West,
            Seat::East,
            Seat::South,
            Seat::West
        ]
    );
    // North's pieces never moved.
    let start = GameState::new(GameConfig::new(GameMode::Teams)).unwrap();
    for (sqr, p) in start.pieces_of(Seat::North) {
        assert_eq!(s.piece_at(sqr), Some(p));
    }
    check_invariants(&s);
}

#[test]
fn teams_timeout_of_active_seat_resets_no_progress() {
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "nKg12", "eKl7"],
        "S AAAA - - 40 0",
    );
    let ev = apply_timeout(&mut s, Seat::South).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::South, DefeatReason::Timeout)]
    );
    assert_eq!(s.status(Seat::South), SeatStatus::Frozen);
    assert_eq!(s.pieces_of(Seat::South).count(), 1);
    assert_eq!(s.no_progress(), 0);
    assert_eq!(s.move_limit(), 75);
    assert_eq!(s.seat_to_move(), Seat::West);
    check_invariants(&s);
}

#[test]
fn teams_defeated_seat_abandoning_off_turn_freezes_without_second_defeat() {
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "nRa12", "nBc12", "eKl7"],
        "W AADA - - 0 0 def=Nl",
    );
    let ev = apply_abandon(&mut s, Seat::North).unwrap();
    assert!(defeat_events(&ev).is_empty());
    assert!(ev.contains(&GameEvent::Frozen { seat: Seat::North }));
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert_eq!(s.pieces_of(Seat::North).count(), 2);
    assert_eq!(s.defeats().len(), 1);
    assert_eq!(s.seat_to_move(), Seat::West);
    assert!(!s.is_over());
    play(&mut s, "a7a6");
    assert_eq!(s.seat_to_move(), Seat::East);
    check_invariants(&s);
}

#[test]
fn teams_defeated_seat_timeout_on_turn_freezes_and_game_continues() {
    // North was stalemated (still holds its king). It times out on its own
    // turn: FROZEN, and its partner South keeps the team alive.
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "nKg12", "nRa12", "eKl7"],
        "N AADA - - 0 0 def=Ns",
    );
    let ev = apply_timeout(&mut s, Seat::North).unwrap();
    assert!(defeat_events(&ev).is_empty());
    assert!(ev.contains(&GameEvent::Frozen { seat: Seat::North }));
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert_eq!(s.seat_to_move(), Seat::East);
    assert!(!s.is_over());
    assert_eq!(s.pieces_of(Seat::North).count(), 2);
    check_invariants(&s);
}

#[test]
fn teams_timeout_cascade_freeze_then_stalemate_of_next_seat() {
    // North times out (FROZEN); East (boxed by South's pieces) is stalemated
    // at the start of its turn -> DEFEATED (West ACTIVE). South is next.
    let mut s = build(
        "teams",
        &with(&EAST_BOX, &["sNh2", "sNj4", "sKe1", "wKa7", "nKg12"]),
        "N AAAA - - 0 0",
    );
    let ev = apply_timeout(&mut s, Seat::North).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![
            (Seat::North, DefeatReason::Timeout),
            (Seat::East, DefeatReason::Stalemate),
        ]
    );
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert_eq!(s.status(Seat::East), SeatStatus::Defeated);
    assert_eq!(s.seat_to_move(), Seat::South);
    assert!(!s.is_over());
    check_invariants(&s);
}

#[test]
fn teams_frozen_partner_and_leader_loss_by_east_is_team_out() {
    // §12: frozen A + B loses its leader -> team out (East captures here,
    // so the capturer is not the seat right after the frozen one).
    let mut s = build(
        "teams",
        &["sKg1", "sQd4", "wKa7", "nKg12", "eKl7", "eRg5"],
        "E AAFA - - 0 0 def=Nt",
    );
    let ev = play(&mut s, "g5g1");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::South, DefeatReason::LeaderCaptured)]
    );
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert_finished(&mut s, &ev, teams_win(Team::WestEast));
}

#[test]
fn teams_leaderless_teammate_timeout_keeps_game_going() {
    // §12: a leaderless (DEFEATED) teammate times out -> FROZEN, the game
    // goes on, and its remaining pieces block but never move.
    let mut s = build(
        "teams",
        &["sKg1", "sRg2", "wKa7", "nRg8", "eKl7"],
        "N AADA - - 0 0 def=Nl",
    );
    apply_timeout(&mut s, Seat::North).unwrap();
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert_eq!(s.seat_to_move(), Seat::East);
    play(&mut s, "l7l6");
    assert!(!is_legal(&s, "g2g9"), "frozen teammate's rook blocks");
    assert!(is_legal(&s, "g2g7"));
    play(&mut s, "g2g7");
    play(&mut s, "a7a6");
    play(&mut s, "l6l5");
    assert_eq!(
        s.piece_at(sq("g8")),
        Some(Piece::new(PieceKind::Rook, Seat::North))
    );
    check_invariants(&s);
}

// ---------------------------------------------------------------------------
// More edge cases
// ---------------------------------------------------------------------------

#[test]
fn ffa_abandon_off_turn_that_removes_the_movers_only_capture() {
    // South's only legal move is b4xc5 (West's knight). West abandons while
    // South is on move: West's army is removed and South is left with no
    // legal move. The engine must not leave South "on move" with nothing to
    // play. (§2 judges stalemate "at the start of its turn"; whether this
    // counts is not spelled out, but any consistent result must either
    // defeat South or give the turn to a seat that can move.)
    let mut s = build(
        "ffa",
        &with(
            &SOUTH_BOX,
            &["eRb5", "eNd3", "wNc5", "wKa7", "nKg12", "eKl7"],
        ),
        "S AAAA - - 0 0",
    );
    assert_eq!(move_strings(&s), vec!["b4c5".to_string()]);
    let ev = apply_abandon(&mut s, Seat::West).unwrap();
    assert_eq!(defeat_events(&ev)[0], (Seat::West, DefeatReason::Abandon));
    assert!(s.is_over() || !legal_moves(&s).is_empty());
    assert_eq!(s.status(Seat::South), SeatStatus::Removed);
    assert_eq!(s.seat_to_move(), Seat::North);
    check_invariants(&s);
}

#[test]
fn ffa_removed_seat_loses_its_en_passant_target() {
    // West double-steps; North immediately captures West's king. The target
    // is cleared when the seat stops taking turns.
    let mut s = build(
        "ffa",
        &["sKg1", "wKa7", "wPb5", "nKg12", "nQg7", "eKl7"],
        "W AAAA - - 0 0",
    );
    play(&mut s, "b5d5");
    assert!(s.ep_target(Seat::West).is_some());
    let ev = play(&mut s, "g7a7");
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::West, DefeatReason::LeaderCaptured)]
    );
    assert!(s.ep_target(Seat::West).is_none());
    assert_eq!(s.piece_at(sq("d5")), None);
    check_invariants(&s);
}

#[test]
fn teams_timeout_drops_castling_rights_of_that_seat_only() {
    let mut s = GameState::new(GameConfig::new(GameMode::Teams)).unwrap();
    apply_timeout(&mut s, Seat::South).unwrap();
    assert!(s.castling_rights(Seat::South).is_empty());
    for seat in [Seat::West, Seat::North, Seat::East] {
        assert!(!s.castling_rights(seat).is_empty(), "{seat}");
    }
    check_invariants(&s);
}

#[test]
fn teams_defeated_seat_without_pieces_still_counts_for_the_move_limit() {
    // "25 × the number of seats still taking turns": a DEFEATED Teams seat
    // takes its turns (passing), a FROZEN one does not.
    let s = build("teams", &["sKg1", "wKa7", "nKg12"], "S AAAD - - 0 0 def=El");
    assert_eq!(s.move_limit(), 100);
    let t = build(
        "teams",
        &["sKg1", "wKa7", "nKg12", "eRl3"],
        "S AAAF - - 0 0 def=Et",
    );
    assert_eq!(t.move_limit(), 75);
}

#[test]
fn teams_defeated_seat_without_pieces_passes_every_turn() {
    let mut s = build("teams", &["sKg1", "wKa7", "nKg12"], "S AAAD - - 0 0 def=El");
    play(&mut s, "g1g2");
    play(&mut s, "a7a6");
    let ev = play(&mut s, "g12g11");
    assert_eq!(passes(&ev), vec![Seat::East]);
    assert_eq!(s.seat_to_move(), Seat::South);
    assert_eq!(s.no_progress(), 4);
    assert_eq!(s.ply(), 4);
    check_invariants(&s);
}

#[test]
fn ffa_timeout_on_move_skips_already_removed_seats() {
    let mut s = build("ffa", &["sKg1", "nKg12", "eKl7"], "S ARAA - - 0 0 def=Wl");
    let ev = apply_timeout(&mut s, Seat::South).unwrap();
    assert_eq!(removed(&ev), vec![Seat::South]);
    assert_eq!(s.seat_to_move(), Seat::North);
    assert!(!s.is_over());
    check_invariants(&s);
}

#[test]
fn non_active_seats_old_leader_is_not_a_leader_for_the_glow() {
    // "Once a seat is not ACTIVE, any leader it still has becomes an
    // ordinary piece." The optional glow is for attacked *leaders*.
    let s = build(
        "teams",
        &["sKg1", "wKa7", "wRa12", "nKg12", "eKl7"],
        "S AADA - - 0 0 def=Ns",
    );
    assert!(is_square_attacked_by(&s, sq("g12"), Seat::West));
    assert!(
        !leader_under_attack(&s, Seat::North),
        "a DEFEATED seat's king is an ordinary piece"
    );
}
