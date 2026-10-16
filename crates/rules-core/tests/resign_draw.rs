//! Resignation ([`apply_resign`]) and draw by agreement
//! ([`apply_agreed_draw`], [`draw_voters`]) in both modes.

mod common;

use common::*;
use rules_core::*;

fn start(mode: GameMode) -> GameState {
    GameState::new(GameConfig::new(mode)).unwrap()
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

const KINGS: [&str; 4] = ["sKg1", "wKa7", "nKg12", "eKl7"];

// ---------------------------------------------------------------------------
// Resignation: Free-for-All
// ---------------------------------------------------------------------------

#[test]
fn ffa_resign_on_own_turn_removes_army_and_advances() {
    let mut s = start(GameMode::Ffa);
    let ev = apply_resign(&mut s, Seat::South).unwrap();
    assert_eq!(
        ev,
        vec![
            GameEvent::Defeat {
                seat: Seat::South,
                reason: DefeatReason::Resign
            },
            GameEvent::ArmyRemoved { seat: Seat::South },
        ]
    );
    assert_eq!(s.status(Seat::South), SeatStatus::Removed);
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_eq!(s.seat_to_move(), Seat::West);
    assert_eq!(s.defeats().reason(Seat::South), Some(DefeatReason::Resign));
    assert_eq!(s.no_progress(), 0);
    assert_eq!(s.ply(), 0); // resigning is not a turn
    assert!(s.to_position_string().contains(" RAAA "));
    assert!(s.to_position_string().contains("def=Sr"));
    check_invariants(&s);
}

#[test]
fn ffa_resign_off_turn_keeps_the_turn() {
    let mut s = start(GameMode::Ffa);
    play(&mut s, "c2c3");
    assert_eq!(s.seat_to_move(), Seat::West);
    let ev = apply_resign(&mut s, Seat::North).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::North, DefeatReason::Resign)]
    );
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::North }));
    assert_eq!(s.seat_to_move(), Seat::West);
    assert_eq!(s.move_limit(), 75);
    check_invariants(&s);
    // North is skipped from now on.
    play(&mut s, "b5c5");
    assert_eq!(s.seat_to_move(), Seat::East);
}

#[test]
fn ffa_resign_matches_timeout_except_reason() {
    let mut a = start(GameMode::Ffa);
    let mut b = a.clone();
    let ra = apply_resign(&mut a, Seat::South).unwrap();
    let rb = apply_timeout(&mut b, Seat::South).unwrap();
    assert_eq!(ra.len(), rb.len());
    assert_eq!(a.board(), b.board());
    assert_eq!(a.statuses(), b.statuses());
    assert_eq!(a.seat_to_move(), b.seat_to_move());
    assert_eq!(a.hash(), b.hash()); // the defeat reason is not hashed
}

#[test]
fn ffa_resignations_to_a_winner() {
    let mut s = start(GameMode::Ffa);
    apply_timeout(&mut s, Seat::South).unwrap();
    apply_resign(&mut s, Seat::East).unwrap(); // off turn (West to move)
    assert_eq!(s.seat_to_move(), Seat::West);
    let ev = apply_resign(&mut s, Seat::West).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(o.result, GameResult::FfaWinner { seat: Seat::North });
    assert_eq!(o.placements, [4, 2, 1, 3]);
    assert!(matches!(ev.last(), Some(GameEvent::GameEnded { .. })));
    check_invariants(&s);
    assert_eq!(apply_resign(&mut s, Seat::North), Err(RulesError::GameOver));
}

#[test]
fn ffa_resign_off_turn_can_stalemate_the_seat_on_move() {
    // South's only legal move is b4xc5 (West's pawn). When West resigns its
    // army leaves the board, so South's turn is judged again: stalemate.
    let mut pieces = vec![
        "sKa1", "sRb1", "sBc1", "sBa3", "sPa2", "sPb2", "sPb3", "sPb4", "sPd2",
    ];
    pieces.extend(["eRb5", "eNd3", "eKl7", "wKa7", "wPc5", "nKg12"]);
    let mut s = build("ffa", &pieces, "S AAAA - - 0 0");
    assert_eq!(move_strings(&s), vec!["b4c5"]);
    let ev = apply_resign(&mut s, Seat::West).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![
            (Seat::West, DefeatReason::Resign),
            (Seat::South, DefeatReason::Stalemate)
        ]
    );
    assert_eq!(s.statuses()[0], SeatStatus::Removed);
    assert_eq!(s.seat_to_move(), Seat::North);
    check_invariants(&s);
}

// ---------------------------------------------------------------------------
// Resignation: Teams
// ---------------------------------------------------------------------------

#[test]
fn teams_resign_freezes_only_that_player() {
    let mut s = start(GameMode::Teams);
    let ev = apply_resign(&mut s, Seat::North).unwrap(); // off turn
    assert_eq!(
        ev,
        vec![
            GameEvent::Defeat {
                seat: Seat::North,
                reason: DefeatReason::Resign
            },
            GameEvent::Frozen { seat: Seat::North },
        ]
    );
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert_eq!(s.status(Seat::South), SeatStatus::Active);
    assert_eq!(s.pieces_of(Seat::North).count(), 16); // pieces stay
    assert_eq!(s.seat_to_move(), Seat::South);
    assert!(s.castling_rights(Seat::North).is_empty());
    assert!(s.to_position_string().contains(" AAFA "));
    assert!(s.to_position_string().contains("def=Nr"));
    check_invariants(&s);
    play(&mut s, "c2c3");
    play(&mut s, "b5c5");
    // North is skipped.
    assert_eq!(s.seat_to_move(), Seat::East);
}

#[test]
fn teams_resign_on_own_turn_advances() {
    let mut s = start(GameMode::Teams);
    apply_resign(&mut s, Seat::South).unwrap();
    assert_eq!(s.status(Seat::South), SeatStatus::Frozen);
    assert_eq!(s.seat_to_move(), Seat::West);
    check_invariants(&s);
}

#[test]
fn teams_defeated_seat_resigns_and_just_freezes() {
    // On its own turn.
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "nRa12", "eKl7"],
        "N AADA - - 0 0 def=Nl",
    );
    let ev = apply_resign(&mut s, Seat::North).unwrap();
    assert_eq!(ev, vec![GameEvent::Frozen { seat: Seat::North }]);
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert_eq!(s.defeats().len(), 1);
    assert_eq!(
        s.defeats().reason(Seat::North),
        Some(DefeatReason::LeaderCaptured)
    );
    assert_eq!(s.pieces_of(Seat::North).count(), 1);
    assert_eq!(s.seat_to_move(), Seat::East);
    check_invariants(&s);

    // Off turn: no defeat reset, but the move limit drops (100 -> 75).
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "nRa12", "eKl7"],
        "W AADA - - 40 0 def=Nl",
    );
    let ev = apply_resign(&mut s, Seat::North).unwrap();
    assert_eq!(ev, vec![GameEvent::Frozen { seat: Seat::North }]);
    assert_eq!(s.seat_to_move(), Seat::West);
    assert_eq!(s.no_progress(), 40);
    assert_eq!(s.move_limit(), 75);
    check_invariants(&s);
}

#[test]
fn teams_defeated_seat_resigning_can_reach_the_move_limit() {
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "nRa12", "eKl7"],
        "W AADA - - 80 0 def=Nl",
    );
    let ev = apply_resign(&mut s, Seat::North).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(o.result, GameResult::TeamsDraw);
    check_invariants(&s);
}

#[test]
fn teams_resign_of_last_active_teammate_ends_the_game() {
    let mut s = build(
        "teams",
        &["sKg1", "sNe1", "wKa7", "nRa12", "eKl7"],
        "W AADA - - 0 0 def=Nl",
    );
    let ev = apply_resign(&mut s, Seat::South).unwrap();
    assert_eq!(
        defeat_events(&ev),
        vec![(Seat::South, DefeatReason::Resign)]
    );
    let o = ended(&ev).unwrap();
    assert_eq!(
        o.result,
        GameResult::TeamsWinner {
            team: Team::WestEast
        }
    );
    assert_eq!(o.placements, [2, 1, 2, 1]);
    // The losing team's pieces are removed.
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::South }));
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::North }));
    assert!(matches!(ev.last(), Some(GameEvent::GameEnded { .. })));
    check_invariants(&s);
}

#[test]
fn resign_errors_leave_the_state_unchanged() {
    // Frozen seat (Teams) and removed seat (FFA) no longer take turns.
    let mut s = build("teams", &KINGS, "S AAFA - - 0 0 def=Nt");
    let before = s.clone();
    assert_eq!(
        apply_resign(&mut s, Seat::North),
        Err(RulesError::SeatNotInPlay(Seat::North))
    );
    assert_eq!(s, before);

    let mut s = build("ffa", &["sKg1", "nKg12", "eKl7"], "S ARAA - - 0 0 def=Wr");
    let before = s.clone();
    assert_eq!(
        apply_resign(&mut s, Seat::West),
        Err(RulesError::SeatNotInPlay(Seat::West))
    );
    assert_eq!(s, before);

    // After the game ended.
    let mut s = start(GameMode::Ffa);
    apply_agreed_draw(&mut s).unwrap();
    let before = s.clone();
    for seat in Seat::ALL {
        assert_eq!(apply_resign(&mut s, seat), Err(RulesError::GameOver));
    }
    assert_eq!(s, before);
}

// ---------------------------------------------------------------------------
// Draw by agreement
// ---------------------------------------------------------------------------

#[test]
fn draw_voters_are_the_seats_still_taking_turns() {
    assert_eq!(draw_voters(&start(GameMode::Ffa)), [true; 4]);
    assert_eq!(draw_voters(&start(GameMode::Teams)), [true; 4]);
    // FFA: removed seats don't vote.
    let s = build("ffa", &["sKg1", "nKg12", "eKl7"], "S ARAA - - 0 0 def=Wl");
    assert_eq!(draw_voters(&s), [true, false, true, true]);
    // Teams: a DEFEATED seat still playing votes; a FROZEN seat doesn't.
    let s = build(
        "teams",
        &["sKg1", "wRa7", "nKg12", "eKl7"],
        "S ADFA - - 0 0 def=Wl,Nt",
    );
    assert_eq!(draw_voters(&s), [true, true, false, true]);
    // Nobody votes once the game is over.
    let mut s = start(GameMode::Teams);
    apply_agreed_draw(&mut s).unwrap();
    assert_eq!(draw_voters(&s), [false; 4]);
}

#[test]
fn ffa_agreed_draw_with_prior_defeats() {
    let mut s = start(GameMode::Ffa);
    play(&mut s, "c2c3");
    apply_timeout(&mut s, Seat::West).unwrap(); // first out
    apply_resign(&mut s, Seat::South).unwrap(); // second out
    assert_eq!(draw_voters(&s), [false, false, true, true]);
    let board = *s.board();
    let ply = s.ply();
    let ev = apply_agreed_draw(&mut s).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(ev.len(), 1);
    assert_eq!(
        o.result,
        GameResult::FfaAgreedDraw {
            survivors: [false, false, true, true]
        }
    );
    // Survivors tie for 1st; the defeated keep reverse-defeat placements.
    assert_eq!(o.placements, [3, 4, 1, 1]);
    assert!(o.result.is_agreed_draw());
    assert!(s.is_over() && s.is_agreed_draw());
    assert_eq!(s.board(), &board); // nothing is removed
    assert_eq!(s.ply(), ply);
    assert!(legal_moves(&s).is_empty());
    let text = s.to_position_string();
    assert!(text.ends_with(" end=draw"), "{text}");
    assert!(text.contains("def=Wt,Sr"), "{text}");
    check_invariants(&s);
    assert_eq!(apply_agreed_draw(&mut s), Err(RulesError::GameOver));
    assert_eq!(apply_move(&mut s, mv("f11f10")), Err(RulesError::GameOver));
}

#[test]
fn ffa_agreed_draw_matches_move_limit_placements() {
    let mut a = build("ffa", &["sKg1", "nKg12", "eKl7"], "S ARAA - - 74 0 def=Wl");
    let mut b = a.clone();
    let oa = ended(&apply_agreed_draw(&mut a).unwrap()).unwrap();
    let ob = ended(&play(&mut b, "g1g2")).unwrap();
    assert!(matches!(ob.result, GameResult::FfaMoveLimitTie { .. }));
    assert_eq!(oa.placements, ob.placements);
    assert_eq!(oa.placements, [1, 4, 1, 1]);
}

#[test]
fn teams_agreed_draw_puts_everyone_first() {
    let mut s = build(
        "teams",
        &["sKg1", "wRa7", "nKg12", "eKl7"],
        "S ADFA - - 0 0 def=Wl,Nt",
    );
    let ev = apply_agreed_draw(&mut s).unwrap();
    assert_eq!(
        ev,
        vec![GameEvent::GameEnded {
            outcome: Outcome {
                result: GameResult::TeamsAgreedDraw,
                placements: [1; 4],
            }
        }]
    );
    assert_eq!(s.pieces_of(Seat::North).count(), 1); // frozen pieces stay
    check_invariants(&s);
}

#[test]
fn agreed_draw_position_string_and_hash_round_trip() {
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let mut s = start(mode);
        play(&mut s, "c2c4");
        let live_hash = s.hash();
        apply_agreed_draw(&mut s).unwrap();
        assert_ne!(s.hash(), live_hash);
        assert_eq!(s.hash(), zobrist::compute_hash(&s));
        let text = s.to_position_string();
        let back = parse_position(&text).unwrap();
        assert_eq!(back, s);
        assert_eq!(back.hash(), s.hash());
        assert_eq!(back.outcome(), s.outcome());
        assert!(back.is_agreed_draw());
        // Without the marker the game is still running.
        let open = parse_position(text.trim_end_matches(" end=draw")).unwrap();
        assert!(!open.is_over());
        check_invariants(&s);
    }
}

#[test]
fn end_marker_requires_a_game_otherwise_in_progress() {
    // Move limit already reached.
    assert!(
        parse_position(&format!(
            "ffa {} S AAAA - - 100 0 end=draw",
            board_field(&KINGS)
        ))
        .is_err()
    );
    // A seat already won.
    assert!(
        parse_position(&format!(
            "ffa {} S ARRR - - 0 0 def=Wl,Nl,El end=draw",
            board_field(&["sKg1"])
        ))
        .is_err()
    );
    // The seat to move must have been able to play.
    assert!(
        parse_position(&format!(
            "ffa {} W ARAA - - 0 0 def=Wl end=draw",
            board_field(&["sKg1", "nKg12", "eKl7"])
        ))
        .is_err()
    );
    assert!(
        parse_position(&format!(
            "ffa {} S AAAA - - 0 0 end=draw",
            board_field(&KINGS)
        ))
        .is_ok()
    );
}
