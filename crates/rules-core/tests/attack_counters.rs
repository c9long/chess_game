//! Adversarial tests derived from PLAN §2 ("rules_version 1"): turn order and
//! skipping, Teams alternation, the no-progress counter and move limit,
//! en passant expiry, Zobrist hashing, position-string round trips and move
//! notation. Every scripted action is followed by a full state check
//! (incremental hash == recomputed hash, position string round trip, ...).

mod common;

use common::board_field;
use rules_core::*;
use std::panic::{AssertUnwindSafe, catch_unwind};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KINGS: [&str; 4] = ["sKg1", "wKa7", "nKg12", "eKl7"];

fn sq(s: &str) -> Square {
    s.parse().unwrap()
}

fn mv(s: &str) -> Move {
    parse_move(s).unwrap_or_else(|e| panic!("bad move {s}: {e}"))
}

fn start(mode: GameMode) -> GameState {
    GameState::new(GameConfig::new(mode)).unwrap()
}

fn pos(mode: &str, pieces: &[&str], rest: &str) -> GameState {
    let text = format!("{mode} {} {rest}", board_field(pieces));
    let s = parse_position(&text).unwrap_or_else(|e| panic!("bad test position {text}: {e}"));
    check_state(&s);
    s
}

fn try_pos(mode: &str, pieces: &[&str], rest: &str) -> Result<GameState, PositionError> {
    parse_position(&format!("{mode} {} {rest}", board_field(pieces)))
}

/// Cheap invariants that must hold after every action.
fn check_state(s: &GameState) {
    assert_eq!(
        s.hash(),
        zobrist::compute_hash(s),
        "incremental hash differs from recomputed hash in {s}"
    );
    let text = s.to_string();
    let back = parse_position(&text).unwrap_or_else(|e| panic!("round trip failed: {e}\n{text}"));
    assert_eq!(&back, s, "round trip changed the state: {text}");
    assert_eq!(back.to_string(), text);
    assert_eq!(back.hash(), s.hash());
    let seats = Seat::ALL.iter().filter(|&&x| s.takes_turns(x)).count() as u32;
    assert_eq!(s.seats_taking_turns(), seats);
    for seat in Seat::ALL {
        if !s.takes_turns(seat) {
            assert!(
                s.ep_target(seat).is_none(),
                "{seat:?} no longer takes turns but holds an ep target: {s}"
            );
        }
        if s.status(seat) == SeatStatus::Removed {
            assert_eq!(s.pieces_of(seat).count(), 0, "{seat:?} removed with pieces");
        }
    }
    if !s.is_over() {
        assert_eq!(
            s.move_limit(),
            u32::from(s.config().move_limit_rounds) * seats,
            "move limit must be rounds x seats still taking turns: {s}"
        );
        assert!(
            s.no_progress() < s.move_limit(),
            "limit reached but game not over: {s}"
        );
        assert!(
            s.takes_turns(s.seat_to_move()),
            "seat to move is skipped: {s}"
        );
        assert!(
            has_legal_move(s, s.seat_to_move()),
            "seat to move has no move: {s}"
        );
        assert!(
            s.ep_target(s.seat_to_move()).is_none(),
            "turn reached a seat whose ep target is still live: {s}"
        );
    }
}

fn go(s: &mut GameState, m: &str) -> Vec<GameEvent> {
    let ev = apply_move(s, mv(m)).unwrap_or_else(|e| panic!("{m} failed: {e} in {s}"));
    check_state(s);
    ev
}

fn illegal(s: &mut GameState, m: &str) {
    let before = s.clone();
    assert!(
        matches!(apply_move(s, mv(m)), Err(RulesError::IllegalMove(_))),
        "{m} should be illegal in {before}"
    );
    assert_eq!(*s, before, "rejected move changed the state");
}

fn legal(s: &GameState, m: &str) -> bool {
    find_legal_move(s, mv(m)).is_some()
}

fn timeout(s: &mut GameState, seat: Seat) -> Vec<GameEvent> {
    let ev = apply_timeout(s, seat).unwrap_or_else(|e| panic!("timeout {seat:?} failed: {e}"));
    check_state(s);
    ev
}

fn abandon(s: &mut GameState, seat: Seat) -> Vec<GameEvent> {
    let ev = apply_abandon(s, seat).unwrap_or_else(|e| panic!("abandon {seat:?} failed: {e}"));
    check_state(s);
    ev
}

fn ended(ev: &[GameEvent]) -> Option<Outcome> {
    ev.iter().find_map(|e| match e {
        GameEvent::GameEnded { outcome } => Some(*outcome),
        _ => None,
    })
}

fn passes(ev: &[GameEvent]) -> Vec<Seat> {
    ev.iter()
        .filter_map(|e| match e {
            GameEvent::Pass { seat } => Some(*seat),
            _ => None,
        })
        .collect()
}

fn defeats(ev: &[GameEvent]) -> Vec<(Seat, DefeatReason)> {
    ev.iter()
        .filter_map(|e| match e {
            GameEvent::Defeat { seat, reason } => Some((*seat, *reason)),
            _ => None,
        })
        .collect()
}

fn field(s: &GameState, i: usize) -> String {
    s.to_string().split(' ').nth(i).unwrap().to_string()
}

const KNIGHT_TOUR: [&str; 8] = [
    "d1c3", "a4c5", "d12e10", "l4j5", "c3d1", "c5a4", "e10d12", "j5l4",
];

// ---------------------------------------------------------------------------
// Turn order
// ---------------------------------------------------------------------------

#[test]
fn ffa_turns_go_clockwise_and_knight_tour_transposes_to_start_hash() {
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let s0 = start(mode);
        let mut s = s0.clone();
        let order = [Seat::West, Seat::North, Seat::East, Seat::South];
        for (i, m) in KNIGHT_TOUR.iter().enumerate() {
            assert_eq!(s.seat_to_move(), order[(i + 3) % 4]);
            go(&mut s, m);
            assert_eq!(s.seat_to_move(), order[i % 4], "after {m}");
            assert_eq!(s.no_progress(), i as u32 + 1);
            assert_eq!(s.ply(), i as u32 + 1);
        }
        assert_eq!(s.board(), s0.board());
        assert_eq!(
            s.castling_rights(Seat::West),
            s0.castling_rights(Seat::West)
        );
        // The hash ignores ply and the counter: same position, same hash.
        assert_eq!(s.hash(), s0.hash());
        assert_ne!(s, s0);
    }
}

#[test]
fn ffa_removed_seats_are_skipped() {
    let mut s = pos("ffa", &["sKg1", "nKg12", "eKl7"], "S ARAA - - 0 0 def=Wl");
    go(&mut s, "g1g2");
    assert_eq!(s.seat_to_move(), Seat::North);
    go(&mut s, "g12g11");
    assert_eq!(s.seat_to_move(), Seat::East);
    go(&mut s, "l7l6");
    assert_eq!(s.seat_to_move(), Seat::South);

    let mut s = pos("ffa", &["sKg1", "eKl7"], "S ARRA - - 0 0 def=Wl,Nl");
    go(&mut s, "g1g2");
    assert_eq!(s.seat_to_move(), Seat::East);
    go(&mut s, "l7l6");
    assert_eq!(s.seat_to_move(), Seat::South);

    let mut s = pos("ffa", &["wKa7", "eKl7"], "E RARA - - 0 0 def=Sl,Nl");
    go(&mut s, "l7l6");
    assert_eq!(s.seat_to_move(), Seat::West);
    go(&mut s, "a7a6");
    assert_eq!(s.seat_to_move(), Seat::East);
}

#[test]
fn ffa_leader_capture_skips_the_newly_removed_next_seat() {
    // South takes West's king: West is next in order but is now REMOVED.
    let mut s = pos(
        "ffa",
        &["sKg1", "sRa1", "wKa7", "wPc5", "nKg12", "eKl7"],
        "S AAAA - - 42 0",
    );
    let ev = go(&mut s, "a1a7");
    assert_eq!(
        defeats(&ev),
        vec![(Seat::West, DefeatReason::LeaderCaptured)]
    );
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::West }));
    assert_eq!(s.status(Seat::West), SeatStatus::Removed);
    assert_eq!(s.piece_at(sq("c5")), None);
    assert_eq!(s.seat_to_move(), Seat::North);
    assert_eq!(s.no_progress(), 0);
    assert_eq!(s.move_limit(), 75);

    // East takes South's king: the next seat after East is West.
    let mut s = pos(
        "ffa",
        &["sKg1", "wKa7", "nKg12", "eKl7", "eRg5"],
        "E AAAA - - 0 0",
    );
    go(&mut s, "g5g1");
    assert_eq!(s.status(Seat::South), SeatStatus::Removed);
    assert_eq!(s.seat_to_move(), Seat::West);
}

#[test]
fn teams_frozen_seat_gives_one_team_two_turns_in_a_row() {
    // West frozen: S, N (same team twice), E, S, ...
    let mut s = pos(
        "teams",
        &["sKg1", "wKa7", "wRa3", "nKg12", "eKl7"],
        "S AFAA - - 0 0 def=Wt",
    );
    assert_eq!(s.move_limit(), 75);
    go(&mut s, "g1g2");
    assert_eq!(s.seat_to_move(), Seat::North);
    go(&mut s, "g12g11");
    assert_eq!(s.seat_to_move(), Seat::East);
    go(&mut s, "l7l6");
    assert_eq!(s.seat_to_move(), Seat::South);
    assert_eq!(
        s.piece_at(sq("a3")),
        Some(Piece::new(PieceKind::Rook, Seat::West))
    );
    assert_eq!(
        s.piece_at(sq("a7")),
        Some(Piece::new(PieceKind::King, Seat::West))
    );

    // East frozen: N then S back to back.
    let mut s = pos("teams", &KINGS, "N AAAF - - 0 0 def=Et");
    go(&mut s, "g12g11");
    assert_eq!(s.seat_to_move(), Seat::South);
    go(&mut s, "g1g2");
    assert_eq!(s.seat_to_move(), Seat::West);
}

#[test]
fn teams_timeout_on_move_freezes_and_turn_skips_the_frozen_seat() {
    let mut s = start(GameMode::Teams);
    go(&mut s, "d1c3");
    let ev = timeout(&mut s, Seat::West);
    assert_eq!(defeats(&ev), vec![(Seat::West, DefeatReason::Timeout)]);
    assert!(ev.contains(&GameEvent::Frozen { seat: Seat::West }));
    assert!(
        !ev.iter()
            .any(|e| matches!(e, GameEvent::ArmyRemoved { .. }))
    );
    assert_eq!(s.pieces_of(Seat::West).count(), 16);
    assert_eq!(s.seat_to_move(), Seat::North);
    assert_eq!(s.no_progress(), 0);
    assert_eq!(s.move_limit(), 75);
    go(&mut s, "d12e10");
    assert_eq!(s.seat_to_move(), Seat::East);
    go(&mut s, "l4j5");
    assert_eq!(s.seat_to_move(), Seat::South);
    go(&mut s, "c3e4");
    assert_eq!(s.seat_to_move(), Seat::North, "frozen West must be skipped");
    assert_eq!(s.no_progress(), 3);
}

#[test]
fn teams_defeated_seat_keeps_its_turn_slot() {
    let mut s = pos(
        "teams",
        &["sKg1", "wKa7", "wRa3", "nKg12", "nQa12", "eKl7"],
        "N AAAA - - 5 0",
    );
    let ev = go(&mut s, "a12a7");
    assert_eq!(
        defeats(&ev),
        vec![(Seat::West, DefeatReason::LeaderCaptured)]
    );
    assert_eq!(s.status(Seat::West), SeatStatus::Defeated);
    assert!(
        !ev.iter()
            .any(|e| matches!(e, GameEvent::ArmyRemoved { .. }))
    );
    assert_eq!(s.seat_to_move(), Seat::East);
    assert_eq!(s.no_progress(), 0);
    assert_eq!(s.move_limit(), 100);
    go(&mut s, "l7l6");
    go(&mut s, "g1g2");
    assert_eq!(s.seat_to_move(), Seat::West);
    go(&mut s, "a3b3");
    assert_eq!(s.seat_to_move(), Seat::North);
    assert_eq!(s.no_progress(), 3);
}

#[test]
fn abandon_by_seat_not_on_move_keeps_turn_then_seat_is_skipped() {
    let mut s = pos("ffa", &KINGS, "S AAAA - - 40 7");
    let ev = abandon(&mut s, Seat::North);
    assert_eq!(defeats(&ev), vec![(Seat::North, DefeatReason::Abandon)]);
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::North }));
    assert_eq!(s.status(Seat::North), SeatStatus::Removed);
    assert_eq!(s.seat_to_move(), Seat::South);
    assert_eq!(s.no_progress(), 0, "an abandon is a defeat: counter resets");
    assert_eq!(s.ply(), 7, "an abandon is not a turn");
    go(&mut s, "g1g2");
    assert_eq!(s.seat_to_move(), Seat::West);
    go(&mut s, "a7a6");
    assert_eq!(s.seat_to_move(), Seat::East);
    go(&mut s, "l7l6");
    assert_eq!(s.seat_to_move(), Seat::South);
}

#[test]
fn abandon_by_seat_on_move_advances_the_turn() {
    let mut s = pos("ffa", &KINGS, "S AAAA - - 40 7");
    abandon(&mut s, Seat::South);
    assert_eq!(s.seat_to_move(), Seat::West);
    let mut t = pos("teams", &KINGS, "W AAAA - - 40 7");
    abandon(&mut t, Seat::West);
    assert_eq!(t.status(Seat::West), SeatStatus::Frozen);
    assert_eq!(t.seat_to_move(), Seat::North);
}

#[test]
fn clock_actions_on_wrong_seat_or_finished_game_are_rejected_without_change() {
    let mut s = pos("ffa", &["sKg1", "nKg12", "eKl7"], "S ARAA - - 3 9 def=Wl");
    let before = s.clone();
    assert!(matches!(
        apply_timeout(&mut s, Seat::North),
        Err(RulesError::NotSeatToMove { .. })
    ));
    assert!(matches!(
        apply_abandon(&mut s, Seat::West),
        Err(RulesError::SeatNotInPlay(Seat::West))
    ));
    assert_eq!(s, before);

    let mut t = pos("teams", &KINGS, "S AFAA - - 0 0 def=Wt");
    let before = t.clone();
    assert!(apply_abandon(&mut t, Seat::West).is_err());
    assert!(apply_timeout(&mut t, Seat::West).is_err());
    assert_eq!(t, before);

    let mut over = pos("ffa", &["sKg1", "eKl7"], "S ARRA - - 0 0 def=Wl,Nl");
    abandon(&mut over, Seat::East);
    assert!(over.is_over());
    let before = over.clone();
    assert_eq!(
        apply_timeout(&mut over, Seat::South),
        Err(RulesError::GameOver)
    );
    assert_eq!(
        apply_abandon(&mut over, Seat::South),
        Err(RulesError::GameOver)
    );
    assert_eq!(apply_move(&mut over, mv("g1g2")), Err(RulesError::GameOver));
    assert_eq!(over, before);
}

#[test]
fn teams_two_automatic_passes_in_one_action() {
    // West and North are DEFEATED with no pieces: both pass every round.
    let mut s = pos("teams", &["sKg1", "eKl7"], "S ADDA - - 10 20 def=Wl,Nl");
    assert_eq!(s.move_limit(), 100);
    let ev = go(&mut s, "g1g2");
    assert!(matches!(
        ev[0],
        GameEvent::MoveMade {
            seat: Seat::South,
            ..
        }
    ));
    assert_eq!(passes(&ev), vec![Seat::West, Seat::North]);
    assert_eq!(s.seat_to_move(), Seat::East);
    assert_eq!(s.ply(), 23);
    assert_eq!(s.no_progress(), 13);
    let ev = go(&mut s, "l7l6");
    assert!(passes(&ev).is_empty());
    assert_eq!(s.seat_to_move(), Seat::South);
    assert_eq!(s.ply(), 24);
    assert_eq!(s.no_progress(), 14);
}

#[test]
fn teams_move_limit_reached_on_an_automatic_pass() {
    // 97 + move = 98, West's pass = 99, North's pass = 100: draw.
    let mut s = pos("teams", &["sKg1", "eKl7"], "S ADDA - - 97 0 def=Wl,Nl");
    let ev = go(&mut s, "g1g2");
    assert_eq!(passes(&ev), vec![Seat::West, Seat::North]);
    assert_eq!(ended(&ev).unwrap().result, GameResult::TeamsDraw);
    assert!(matches!(ev.last(), Some(GameEvent::GameEnded { .. })));
    assert_eq!(s.no_progress(), 100);

    // 98 + move = 99, West's pass = 100: draw before North's pass.
    let mut s = pos("teams", &["sKg1", "eKl7"], "S ADDA - - 98 0 def=Wl,Nl");
    let ev = go(&mut s, "g1g2");
    assert_eq!(passes(&ev), vec![Seat::West]);
    assert_eq!(ended(&ev).unwrap().result, GameResult::TeamsDraw);
}

#[test]
fn teams_frozen_and_passing_seats_of_one_team() {
    // West frozen, North DEFEATED with no pieces: S, (W skipped), N passes, E.
    let mut s = pos(
        "teams",
        &["sKg1", "wKa7", "eKl7"],
        "S AFDA - - 0 0 def=Wt,Nl",
    );
    assert_eq!(s.move_limit(), 75);
    let ev = go(&mut s, "g1g2");
    assert_eq!(passes(&ev), vec![Seat::North]);
    assert_eq!(s.seat_to_move(), Seat::East);
    assert_eq!(s.no_progress(), 2);
    assert_eq!(s.ply(), 2);
    let ev = go(&mut s, "l7l6");
    assert!(passes(&ev).is_empty());
    assert_eq!(s.seat_to_move(), Seat::South);
}

// ---------------------------------------------------------------------------
// No-progress counter and move limit
// ---------------------------------------------------------------------------

#[test]
fn move_limit_scales_with_configured_rounds() {
    let mut cfg = GameConfig::new(GameMode::Ffa);
    cfg.move_limit_rounds = 2;
    let mut s = GameState::new(cfg).unwrap();
    assert_eq!(s.move_limit(), 8);
    for m in &KNIGHT_TOUR[..7] {
        let ev = go(&mut s, m);
        assert!(ended(&ev).is_none());
    }
    let ev = go(&mut s, KNIGHT_TOUR[7]);
    let o = ended(&ev).expect("8 non-progress turns with limit 8");
    assert_eq!(
        o.result,
        GameResult::FfaMoveLimitTie {
            survivors: [true; 4]
        }
    );
    assert_eq!(o.placements, [1; 4]);
}

#[test]
fn ffa_move_limit_tie_with_two_removed_seats() {
    let mut s = pos("ffa", &["sKg1", "eKl7"], "S ARRA - - 49 0 def=Wl,Nl");
    assert_eq!(s.move_limit(), 50);
    let ev = go(&mut s, "g1g2");
    let o = ended(&ev).expect("limit reached");
    assert_eq!(
        o.result,
        GameResult::FfaMoveLimitTie {
            survivors: [true, false, false, true]
        }
    );
    assert_eq!(o.placement(Seat::South), 1);
    assert_eq!(o.placement(Seat::East), 1);
    // Removed seats follow in reverse order of defeat.
    assert!(o.placement(Seat::North) > 1);
    assert!(o.placement(Seat::North) < o.placement(Seat::West));
}

#[test]
fn castling_does_not_reset_the_counter() {
    let mut s = pos(
        "ffa",
        &["sKg1", "sRj1", "wKa7", "nKg12", "eKl7"],
        "S AAAA Sj1 - 10 0",
    );
    let ev = go(&mut s, "g1i1");
    assert!(ev.iter().any(|e| matches!(e, GameEvent::Castle { .. })));
    assert_eq!(s.no_progress(), 11);
    assert_eq!(
        s.piece_at(sq("h1")),
        Some(Piece::new(PieceKind::Rook, Seat::South))
    );
    assert_eq!(field(&s, 4), "-");
}

#[test]
fn pawn_moves_and_captures_reset_the_counter() {
    let mut s = pos(
        "ffa",
        &["sKg1", "sPd2", "sPe2", "wKa7", "wNb4", "nKg12", "eKl7"],
        "S AAAA - - 30 0",
    );
    go(&mut s, "d2d4"); // double step
    assert_eq!(s.no_progress(), 0);
    go(&mut s, "b4c6");
    assert_eq!(s.no_progress(), 1);
    go(&mut s, "g12g11");
    go(&mut s, "l7l6");
    assert_eq!(s.no_progress(), 3);
    go(&mut s, "e2e3"); // single step
    assert_eq!(s.no_progress(), 0);
    go(&mut s, "c6d4"); // knight capture
    assert_eq!(s.no_progress(), 0);
}

#[test]
fn ffa_timeout_resets_counter_and_lowers_limit() {
    let mut s = pos(
        "ffa",
        &["sKg1", "sPd2", "wKa7", "nKg12", "eKl7"],
        "S AAAA - - 60 3",
    );
    let ev = timeout(&mut s, Seat::South);
    assert_eq!(defeats(&ev), vec![(Seat::South, DefeatReason::Timeout)]);
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::South }));
    assert_eq!(s.status(Seat::South), SeatStatus::Removed);
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_eq!(s.no_progress(), 0);
    assert_eq!(s.move_limit(), 75);
    assert_eq!(s.seat_to_move(), Seat::West);
    assert_eq!(s.ply(), 3, "a timeout is not a move");
}

#[test]
fn teams_defeated_seat_abandoning_lowers_limit_without_reset_or_early_end() {
    let mut s = pos(
        "teams",
        &["sKg1", "wRa3", "nKg12", "eKl7"],
        "S ADAA - - 73 0 def=Wl",
    );
    assert_eq!(s.move_limit(), 100);
    let ev = abandon(&mut s, Seat::West);
    assert!(ev.contains(&GameEvent::Frozen { seat: Seat::West }));
    assert!(
        defeats(&ev).is_empty(),
        "a DEFEATED seat is not defeated again"
    );
    assert_eq!(s.status(Seat::West), SeatStatus::Frozen);
    assert_eq!(s.move_limit(), 75);
    assert_eq!(
        s.no_progress(),
        73,
        "freezing a DEFEATED seat is not a defeat"
    );
    assert!(!s.is_over());
    assert_eq!(s.seat_to_move(), Seat::South);
    go(&mut s, "g1g2");
    assert_eq!(s.seat_to_move(), Seat::North);
    assert!(!s.is_over());
    let ev = go(&mut s, "g12g11");
    assert_eq!(ended(&ev).unwrap().result, GameResult::TeamsDraw);
}

#[test]
fn teams_last_active_seat_abandoning_ends_the_game() {
    let mut s = pos(
        "teams",
        &["sKg1", "wRa3", "nKg12", "eKl7"],
        "S ADAA - - 0 0 def=Wl",
    );
    let ev = abandon(&mut s, Seat::East);
    assert_eq!(defeats(&ev), vec![(Seat::East, DefeatReason::Abandon)]);
    let o = ended(&ev).expect("team WE has no ACTIVE seat");
    assert_eq!(
        o.result,
        GameResult::TeamsWinner {
            team: Team::SouthNorth
        }
    );
    assert_eq!(o.placements, [1, 2, 1, 2]);
    assert!(matches!(ev.last(), Some(GameEvent::GameEnded { .. })));
    assert_eq!(
        s.pieces_of(Seat::West).count(),
        0,
        "losing team's pieces are removed"
    );
    assert_eq!(
        s.pieces_of(Seat::East).count(),
        0,
        "losing team's pieces are removed"
    );
}

#[test]
fn ffa_abandon_leaving_one_active_seat_ends_with_reverse_defeat_placements() {
    let mut s = pos("ffa", &["sKg1", "eKl7"], "S ARRA - - 0 0 def=Wl,Nl");
    let ev = abandon(&mut s, Seat::East);
    let o = ended(&ev).unwrap();
    assert_eq!(o.result, GameResult::FfaWinner { seat: Seat::South });
    assert_eq!(o.placements, [1, 4, 3, 2]);
}

// ---------------------------------------------------------------------------
// En passant expiry
// ---------------------------------------------------------------------------

fn ep_fixture() -> GameState {
    pos(
        "ffa",
        &["sKg1", "sPd2", "wKa7", "wPc4", "nKg12", "eKl7"],
        "S AAAA - - 5 0",
    )
}

#[test]
fn ep_target_lives_until_turn_order_returns_to_its_seat() {
    let mut s = ep_fixture();
    go(&mut s, "d2d4");
    assert_eq!(
        s.ep_target(Seat::South),
        Some(EpTarget {
            skipped: sq("d3"),
            pawn: sq("d4")
        })
    );
    assert_eq!(field(&s, 5), "Sd3");
    assert!(legal(&s, "c4d3"));
    go(&mut s, "a7a6"); // West declines
    assert!(s.ep_target(Seat::South).is_some());
    go(&mut s, "g12g11");
    assert!(s.ep_target(Seat::South).is_some());
    go(&mut s, "l7l6");
    assert_eq!(s.seat_to_move(), Seat::South);
    assert_eq!(s.ep_target(Seat::South), None);
    assert_eq!(field(&s, 5), "-");
    go(&mut s, "g1g2");
    assert!(!legal(&s, "c4d3"));
}

#[test]
fn ep_capture_removes_the_pawn_and_resets_the_counter() {
    let mut t = ep_fixture();
    go(&mut t, "d2d4");
    let ev = go(&mut t, "c4d3");
    assert!(ev.iter().any(|e| matches!(
        e,
        GameEvent::EnPassant { seat: Seat::West, captured_square } if *captured_square == sq("d4")
    )));
    assert_eq!(t.piece_at(sq("d4")), None);
    assert_eq!(
        t.piece_at(sq("d3")),
        Some(Piece::new(PieceKind::Pawn, Seat::West))
    );
    assert_eq!(t.no_progress(), 0);
    assert_eq!(t.seat_to_move(), Seat::North);
}

#[test]
fn two_ep_targets_live_at_once_expire_independently() {
    let mut s = pos(
        "ffa",
        &["sKg1", "sPd4", "sPh2", "wKa7", "wPb5", "nKg12", "eKl7"],
        "S AAAA - - 0 0",
    );
    go(&mut s, "h2h4");
    go(&mut s, "b5d5");
    assert_eq!(s.ep_target(Seat::South).map(|t| t.skipped), Some(sq("h3")));
    assert_eq!(s.ep_target(Seat::West).map(|t| t.skipped), Some(sq("c5")));
    assert_eq!(field(&s, 5), "Sh3,Wc5");
    go(&mut s, "g12g11");
    go(&mut s, "l7l6");
    assert_eq!(s.ep_target(Seat::South), None);
    assert_eq!(s.ep_target(Seat::West).map(|t| t.skipped), Some(sq("c5")));
    let ev = go(&mut s, "d4c5");
    assert!(ev.iter().any(|e| matches!(e, GameEvent::EnPassant { .. })));
    assert_eq!(s.piece_at(sq("d5")), None);
}

#[test]
fn ep_target_cleared_when_its_seat_abandons() {
    let mut s = pos(
        "teams",
        &["sKg1", "sPd4", "wKa7", "wPb5", "nKg12", "eKl7"],
        "W AAAA - - 0 0",
    );
    go(&mut s, "b5d5");
    assert!(s.ep_target(Seat::West).is_some());
    abandon(&mut s, Seat::West);
    assert_eq!(s.status(Seat::West), SeatStatus::Frozen);
    assert_eq!(s.ep_target(Seat::West), None);
    assert_eq!(s.seat_to_move(), Seat::North);
    go(&mut s, "g12g11");
    go(&mut s, "l7l6");
    assert!(!legal(&s, "d4c5"));
}

#[test]
fn ep_target_cleared_when_turn_reaches_its_seat_as_a_pass() {
    // West is DEFEATED with one pawn; after its double step it is blocked by
    // East's (teammate) rook and passes; the pass clears its target.
    let mut s = pos(
        "teams",
        &["sKg1", "sPb4", "wPb5", "nKg12", "eKl7", "eRe5"],
        "W ADAA - - 0 0 def=Wl",
    );
    go(&mut s, "b5d5");
    go(&mut s, "g12g11");
    go(&mut s, "l7l6");
    assert!(
        legal(&s, "b4c5"),
        "South may take West's double step en passant"
    );
    let ev = go(&mut s, "g1g2");
    assert_eq!(passes(&ev), vec![Seat::West]);
    assert_eq!(s.ep_target(Seat::West), None);
    go(&mut s, "g11g10");
    go(&mut s, "l6l5");
    assert!(!legal(&s, "b4c5"));
}

#[test]
fn off_move_abandon_that_kills_the_only_move_makes_defeated_seat_pass() {
    // West (DEFEATED, on move) has one move: c9xd10 en passant of North's
    // double step. North abandons: its target is cleared ("when the seat
    // stops taking turns"), so West has no legal move and must pass rather
    // than leave the game stuck.
    let mut s = pos(
        "teams",
        &["sKg1", "wPc9", "nKg12", "nPd9", "eKl7"],
        "W ADAA - Nd10 12 30 def=Wl",
    );
    assert_eq!(legal_moves(&s).len(), 1);
    let ev = abandon(&mut s, Seat::North);
    assert_eq!(defeats(&ev), vec![(Seat::North, DefeatReason::Abandon)]);
    assert_eq!(s.ep_target(Seat::North), None);
    assert_eq!(passes(&ev), vec![Seat::West]);
    assert_eq!(s.seat_to_move(), Seat::East);
    assert_eq!(s.no_progress(), 1, "reset by the defeat, then West's pass");
    assert_eq!(s.ply(), 31);
}

#[test]
fn position_with_ep_target_for_the_seat_to_move_is_rejected_or_inert() {
    // The turn has already reached South, so its target cannot be live.
    let r = try_pos(
        "ffa",
        &["sKg1", "sPd4", "wKa7", "wPc4", "nKg12", "eKl7"],
        "S AAAA - Sd3 0 0",
    );
    if let Ok(mut s) = r {
        let accepted = s.ep_target(Seat::South);
        apply_move(&mut s, mv("g1g2")).unwrap();
        // After South's own turn the target must certainly be gone.
        assert!(
            !legal(&s, "c4d3"),
            "stale en passant allowed after the owner's turn: {s}"
        );
        assert_eq!(s.ep_target(Seat::South), None);
        assert_eq!(
            accepted, None,
            "parser accepted a live ep target for the seat to move"
        );
    }
}

#[test]
fn position_with_ep_target_for_a_frozen_seat_is_rejected_or_inert() {
    let r = try_pos(
        "teams",
        &["sKg1", "sPd4", "wKa7", "wPd5", "nKg12", "eKl7"],
        "S AFAA - Wc5 0 0 def=Wt",
    );
    if let Ok(s) = r {
        assert_eq!(s.ep_target(Seat::West), None);
        assert!(!legal(&s, "d4c5"));
    }
}

#[test]
fn ep_capture_requires_the_double_stepped_pawn_on_its_square() {
    // West to move with South's target d3 (pawn square d4) but no South pawn
    // on d4: "provided ... the double-stepped pawn is still on its square".
    for occupant in [None, Some("nNd4"), Some("sNd4"), Some("wNd4")] {
        let mut pieces = vec!["sKg1", "wKa7", "wPc4", "nKg12", "eKl7"];
        pieces.extend(occupant);
        if let Ok(s) = try_pos("ffa", &pieces, "W AAAA - Sd3 0 0") {
            assert!(
                !legal(&s, "c4d3"),
                "en passant without the double-stepped pawn ({occupant:?}) in {s}"
            );
        }
    }
}

#[test]
fn ep_target_that_no_double_step_can_create_is_rejected_or_inert() {
    // South double-steps only from rank 2 to rank 4 (skipping rank 3), so
    // "Sd5" (pawn on d6) can never exist; West's c4 pawn attacks d5.
    if let Ok(s) = try_pos(
        "ffa",
        &["sKg1", "sPd6", "wKa7", "wPc4", "nKg12", "eKl7"],
        "W AAAA - Sd5 0 0",
    ) {
        assert!(
            !legal(&s, "c4d5"),
            "impossible ep target accepted and usable: {s}"
        );
    }
}

#[test]
fn north_and_west_ep_targets_round_trip_with_derived_pawn_squares() {
    let s = pos(
        "ffa",
        &["sKg1", "wKa7", "wPd5", "nKg12", "nPd9", "eKl7"],
        "E AAAA - Wc5,Nd10 0 9",
    );
    assert_eq!(
        s.ep_target(Seat::North),
        Some(EpTarget {
            skipped: sq("d10"),
            pawn: sq("d9")
        })
    );
    assert_eq!(
        s.ep_target(Seat::West),
        Some(EpTarget {
            skipped: sq("c5"),
            pawn: sq("d5")
        })
    );
    assert_eq!(field(&s, 5), "Wc5,Nd10");
    // East moves; South's turn: both targets still live (W and N not reached).
    let mut s = s;
    go(&mut s, "l7l6");
    assert!(s.ep_target(Seat::West).is_some() && s.ep_target(Seat::North).is_some());
    go(&mut s, "g1g2"); // turn reaches West
    assert_eq!(s.ep_target(Seat::West), None);
    assert!(s.ep_target(Seat::North).is_some());
    go(&mut s, "a7a6"); // turn reaches North
    assert_eq!(s.ep_target(Seat::North), None);
}

#[test]
fn counter_at_or_past_the_limit_in_a_position_string_is_a_finished_game() {
    let s = pos("ffa", &KINGS, "S AAAA - - 100 0");
    assert!(s.is_over());
    assert_eq!(
        s.outcome().unwrap().result,
        GameResult::FfaMoveLimitTie {
            survivors: [true; 4]
        }
    );
    let mut t = s.clone();
    assert_eq!(apply_move(&mut t, mv("g1g2")), Err(RulesError::GameOver));
    let s = pos("teams", &KINGS, "S AFAA - - 75 0 def=Wt");
    assert_eq!(s.outcome().unwrap().result, GameResult::TeamsDraw);
    let s = pos("ffa", &KINGS, "S AAAA - - 99 0");
    assert!(!s.is_over());
}

#[test]
fn position_statuses_must_fit_the_mode_and_defeat_order() {
    let k3 = ["sKg1", "nKg12", "eKl7"];
    let bad: [(&str, &[&str], &str); 8] = [
        // DEFEATED / FROZEN do not exist in FFA, REMOVED does not exist in Teams.
        ("ffa", &KINGS, "S ADAA - - 0 0 def=Wl"),
        ("ffa", &KINGS, "S AFAA - - 0 0 def=Wt"),
        ("teams", &k3, "S ARAA - - 0 0 def=Wl"),
        // defeat order inconsistent with statuses
        ("ffa", &k3, "S ARAA - - 0 0"),
        ("ffa", &KINGS, "S AAAA - - 0 0 def=Wl"),
        ("ffa", &k3, "S ARAA - - 0 0 def=Wl,Wl"),
        // the seat to move must take turns in a live game
        ("ffa", &k3, "W ARAA - - 0 0 def=Wl"),
        ("teams", &KINGS, "W AFAA - - 0 0 def=Wt"),
    ];
    for (mode, pieces, rest) in bad {
        assert!(
            try_pos(mode, pieces, rest).is_err(),
            "accepted invalid position: {mode} ... {rest}"
        );
    }
}

// ---------------------------------------------------------------------------
// Zobrist hash
// ---------------------------------------------------------------------------

#[test]
fn hash_distinguishes_side_to_move_status_castling_and_ep() {
    let base = start(GameMode::Ffa).to_string();
    let a = parse_position(&base).unwrap();
    let b = parse_position(&base.replacen(" S AAAA ", " W AAAA ", 1)).unwrap();
    let c = parse_position(&base.replacen("Sc1,", "", 1)).unwrap();
    assert_ne!(a.hash(), b.hash(), "side to move");
    assert_ne!(a.hash(), c.hash(), "castling");

    let pieces = ["sKg1", "sPd4", "wKa7", "wPc4", "nKg12", "eKl7"];
    let d = pos("ffa", &pieces, "W AAAA - Sd3 0 0");
    let e = pos("ffa", &pieces, "W AAAA - - 0 0");
    assert_ne!(d.hash(), e.hash(), "en passant target");

    let pieces = ["sKg1", "wKa7", "wRa3", "nKg12", "eKl7"];
    let f = pos("teams", &pieces, "S AAAA - - 0 0");
    let g = pos("teams", &pieces, "S ADAA - - 0 0 def=Wl");
    let h = pos("teams", &pieces, "S AFAA - - 0 0 def=Wt");
    assert_ne!(f.hash(), g.hash(), "status");
    assert_ne!(g.hash(), h.hash(), "status");
    assert_ne!(f.hash(), h.hash(), "status");
}

#[test]
fn hash_matches_recompute_through_promotion_castle_ep_and_defeats() {
    // Every helper call already checks hash == recompute; this just drives
    // through the remaining event kinds.
    let mut s = pos(
        "ffa",
        &[
            "sKg1", "sRj1", "sPd6", "wKa7", "wPf5", "nKg12", "nRe7", "eKl7", "eQl1",
        ],
        "S AAAA Sj1 - 0 0",
    );
    go(&mut s, "d6e7q"); // capture + promotion
    go(&mut s, "f5g5n"); // West promotes
    go(&mut s, "g12g11");
    go(&mut s, "l1k1"); // East queen
    go(&mut s, "g1i1"); // castle
    go(&mut s, "g5e6"); // knight
    timeout(&mut s, Seat::North);
    let ev = go(&mut s, "k1i1"); // East takes South's king
    assert_eq!(
        defeats(&ev),
        vec![(Seat::South, DefeatReason::LeaderCaptured)]
    );
    assert_eq!(s.seat_to_move(), Seat::West);
    let ev = abandon(&mut s, Seat::West);
    assert_eq!(
        ended(&ev).unwrap().result,
        GameResult::FfaWinner { seat: Seat::East }
    );
    assert_eq!(ended(&ev).unwrap().placements, [3, 2, 4, 1]);
}

// ---------------------------------------------------------------------------
// Position strings
// ---------------------------------------------------------------------------

#[test]
fn mid_game_teams_position_round_trips_exactly() {
    let board = board_field(&[
        "sKg1", "sRc1", "sRj1", "sPd4", "wRb8", "nKg12", "nPc11", "eKl7", "eQl6", "ePi5",
    ]);
    let text = format!(
        "teams {board} W ADFA Sc1,Sj1 Ej5 37 123 ep=on ml=30 \
         civ=canada.1,canada.1,canada.1,canada.1 def=Wl,Nt rv=1"
    );
    let s = parse_position(&text).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(s.to_string(), text);
    assert_eq!(
        s.statuses(),
        [
            SeatStatus::Active,
            SeatStatus::Defeated,
            SeatStatus::Frozen,
            SeatStatus::Active
        ]
    );
    assert_eq!(
        s.ep_target(Seat::East),
        Some(EpTarget {
            skipped: sq("j5"),
            pawn: sq("i5")
        })
    );
    assert_eq!(s.no_progress(), 37);
    assert_eq!(s.ply(), 123);
    assert_eq!(s.move_limit(), 90);
    assert_eq!(s.seat_to_move(), Seat::West);
    let order: Vec<_> = s.defeats().iter().map(|r| (r.seat, r.reason)).collect();
    assert_eq!(
        order,
        vec![
            (Seat::West, DefeatReason::LeaderCaptured),
            (Seat::North, DefeatReason::Timeout)
        ]
    );
    check_state(&s);
    // West (DEFEATED) moves; North frozen is skipped; East's target expires
    // when the turn reaches East.
    let mut s = s.clone();
    go(&mut s, "b8b9");
    assert_eq!(s.seat_to_move(), Seat::East);
    assert_eq!(s.ep_target(Seat::East), None);
    assert_eq!(s.no_progress(), 38);
    assert_eq!(s.ply(), 124);
}

#[test]
fn finished_game_position_round_trips_and_derives_outcome() {
    let s = pos("ffa", &["sKg1"], "S ARRR - - 0 50 def=Wl,Nl,El");
    assert!(s.is_over());
    let o = s.outcome().unwrap();
    assert_eq!(o.result, GameResult::FfaWinner { seat: Seat::South });
    assert_eq!(o.placements, [1, 4, 3, 2]);
}

#[test]
fn huge_ply_or_counter_never_panics() {
    for rest in [
        "S AAAA - - 0 4294967295",
        "S AAAA - - 4294967295 0 ml=65535",
        "S AAAA - - 262139 4294967295 ml=65535",
        "S AAAA - - 4294967296 0",
        "S AAAA - - 0 4294967296",
        "S AAAA - - 0 0 ml=65536",
        "S AAAA - - 0 0 ml=0",
        "S AAAA - - -1 0",
    ] {
        let text = format!("ffa {} {rest}", board_field(&KINGS));
        let r = catch_unwind(|| {
            if let Ok(mut s) = parse_position(&text) {
                let _ = s.to_string();
                let _ = apply_move(&mut s, mv("g1g2"));
                let to_move = s.seat_to_move();
                let _ = apply_timeout(&mut s, to_move);
            }
        });
        assert!(r.is_ok(), "panicked on outside input: {text}");
    }
}

#[test]
fn position_parser_never_panics_on_mutated_input() {
    let bases = [
        start(GameMode::Ffa).to_string(),
        start(GameMode::Teams).to_string(),
        pos(
            "teams",
            &["sKg1", "sRc1", "sPd4", "wRb8", "nKg12", "eKl7", "ePi5"],
            "W ADFA Sc1 Ej5 37 123 ml=30 def=Wl,Nt",
        )
        .to_string(),
    ];
    let alphabet: Vec<char> =
        " /0123456789swneSWNEADFRPNBQKabcdefghijklmlstar,-=._xyz\u{e9}\u{1F600}\0"
            .chars()
            .collect();
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    for i in 0..6000 {
        let base = &bases[i % bases.len()];
        let mut chars: Vec<char> = base.chars().collect();
        for _ in 0..1 + rng.below(4) {
            let n = chars.len().max(1);
            match rng.below(5) {
                0 => {
                    let p = rng.below(n);
                    if p < chars.len() {
                        chars[p] = alphabet[rng.below(alphabet.len())];
                    }
                }
                1 => {
                    let p = rng.below(n);
                    if p < chars.len() {
                        chars.remove(p);
                    }
                }
                2 => {
                    let p = rng.below(n + 1).min(chars.len());
                    chars.insert(p, alphabet[rng.below(alphabet.len())]);
                }
                3 => chars.truncate(rng.below(n)),
                _ => {
                    // swap two digits (counters, ranks)
                    let a = rng.below(n);
                    let b = rng.below(n);
                    if a < chars.len() && b < chars.len() {
                        chars.swap(a, b);
                    }
                }
            }
        }
        let text: String = chars.into_iter().collect();
        let r = catch_unwind(AssertUnwindSafe(|| {
            if let Ok(s) = parse_position(&text) {
                check_state(&s);
                let mut t = s.clone();
                if let Some(m) = legal_moves(&t).first().copied() {
                    let _ = apply_move(&mut t, m);
                    check_state(&t);
                }
            }
        }));
        assert!(r.is_ok(), "panic or invariant failure for input {text:?}");
    }
}

// ---------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------

#[test]
fn a10a12_west_rook_move_from_the_start() {
    let m = mv("a10a12");
    assert_eq!(m.from, sq("a10"));
    assert_eq!(m.to, sq("a12"));
    assert_eq!(format_move(&m), "a10a12");
    let mut s = start(GameMode::Ffa);
    go(&mut s, "d1c3");
    let ev = go(&mut s, "a10a12");
    assert!(matches!(
        ev[0],
        GameEvent::MoveMade {
            seat: Seat::West,
            piece: PieceKind::Rook,
            ..
        }
    ));
    assert_eq!(
        s.piece_at(sq("a12")),
        Some(Piece::new(PieceKind::Rook, Seat::West))
    );
    assert_eq!(field(&s, 4), "Sc1,Sj1,Wa3,Nc12,Nj12,El3,El10");
}

#[test]
fn multi_digit_rank_parsing_is_unambiguous() {
    for (text, from, to) in [
        ("a1a12", "a1", "a12"),
        ("a11a2", "a11", "a2"),
        ("l12l1", "l12", "l1"),
        ("b10c11", "b10", "c11"),
        ("a12a10", "a12", "a10"),
    ] {
        let m = mv(text);
        assert_eq!((m.from, m.to), (sq(from), sq(to)), "{text}");
        assert_eq!(m.promotion, None);
        assert_eq!(format_move(&m), text);
    }
    let m = mv("a11a12q");
    assert_eq!(
        (m.from, m.to, m.promotion),
        (sq("a11"), sq("a12"), Some(PieceKind::Queen))
    );
    assert_eq!(format_move(&m), "a11a12q");
}

#[test]
fn promotion_is_mandatory_and_limited_to_non_leader_non_pawn_pieces() {
    let mut s = pos(
        "ffa",
        &["sKg1", "sPd6", "wKa7", "nKg12", "nRe7", "eKl7"],
        "S AAAA - - 9 0",
    );
    illegal(&mut s, "d6d7");
    illegal(&mut s, "d6d7k");
    illegal(&mut s, "d6d7p");
    illegal(&mut s, "d6e7");
    for (letter, kind) in [
        ('q', PieceKind::Queen),
        ('r', PieceKind::Rook),
        ('b', PieceKind::Bishop),
        ('n', PieceKind::Knight),
    ] {
        for to in ["d7", "e7"] {
            let mut t = s.clone();
            let text = format!("d6{to}{letter}");
            let ev = go(&mut t, &text);
            assert!(
                ev.iter()
                    .any(|e| matches!(e, GameEvent::Promotion { kind: k, .. } if *k == kind))
            );
            assert_eq!(t.piece_at(sq(to)), Some(Piece::new(kind, Seat::South)));
            assert_eq!(t.no_progress(), 0);
            assert_eq!(t.seat_to_move(), Seat::West);
        }
    }
    for (rest, pawn, m, bad) in [
        ("W AAAA - - 0 0", "wPf5", "f5g5n", "f5g5"),
        ("N AAAA - - 0 0", "nPd7", "d7d6b", "d7d6"),
        ("E AAAA - - 0 0", "ePg5", "g5f5r", "g5f5"),
    ] {
        let mut pieces = KINGS.to_vec();
        pieces.push(pawn);
        let mut t = pos("ffa", &pieces, rest);
        illegal(&mut t, bad);
        go(&mut t, m);
    }
}

#[test]
fn promotion_suffix_on_a_non_promoting_move_is_rejected() {
    let mut s = start(GameMode::Ffa);
    illegal(&mut s, "d1c3q");
    illegal(&mut s, "d2d3q");
    illegal(&mut s, "d2d4n");
    illegal(&mut s, "c1b1r");
}

#[test]
fn move_parser_never_panics_and_rejects_garbage() {
    for bad in [
        "",
        "--",
        PASS_NOTATION,
        "a",
        "a1",
        "a1a",
        "a1a13",
        "a1a0",
        "m1a1",
        "a0a1",
        "a1a2qq",
        "a99999999999999999999a1",
        "a1a99999999999999999999",
        "\u{1F600}",
        "a1\u{301}a2",
        "\u{ff41}1a2",
        "a-1a2",
        "a+1a2",
        "a1a2\u{0}",
        "a1a2\u{1F600}",
    ] {
        let r = catch_unwind(|| parse_move(bad));
        match r {
            Ok(res) => assert!(res.is_err(), "{bad:?} should not parse"),
            Err(_) => panic!("parse_move panicked on {bad:?}"),
        }
    }
    // Random strings: never panic; whatever parses round-trips.
    let alphabet: Vec<char> = "abcdefghijklmnz0123456789-qrbnkpQRBNKP \u{e9}"
        .chars()
        .collect();
    let mut rng = Rng(12345);
    for _ in 0..20000 {
        let len = rng.below(9);
        let text: String = (0..len)
            .map(|_| alphabet[rng.below(alphabet.len())])
            .collect();
        let r = catch_unwind(|| parse_move(&text));
        let Ok(res) = r else {
            panic!("parse_move panicked on {text:?}");
        };
        if let Ok(m) = res {
            assert_ne!(m.from, m.to, "{text:?}");
            let again = parse_move(&format_move(&m)).unwrap();
            assert!(again.same_choice(&m), "{text:?}");
        }
    }
}

// ---------------------------------------------------------------------------
// Random games against an independent model of the counters
// ---------------------------------------------------------------------------

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next() % n as u64) as usize
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum Action {
    Move(Move),
    Timeout(Seat),
    Abandon(Seat),
}

fn mid(a: Square, b: Square) -> Square {
    Square::from_coords((a.file() + b.file()) / 2, (a.rank() + b.rank()) / 2).unwrap()
}

fn status_rank_ok(before: SeatStatus, after: SeatStatus) -> bool {
    use SeatStatus::*;
    matches!(
        (before, after),
        (Active, _)
            | (Defeated, Defeated)
            | (Defeated, Frozen)
            | (Frozen, Frozen)
            | (Removed, Removed)
    )
}

fn check_transition(prev: &GameState, action: Action, ev: &[GameEvent], next: &GameState) {
    let ctx = || format!("\nprev: {prev}\naction: {action:?}\nevents: {ev:?}\nnext: {next}");
    check_state(next);
    let x = prev.seat_to_move();

    if let Action::Move(m) = action {
        match ev.first() {
            Some(GameEvent::MoveMade { seat, mv, .. }) => {
                assert_eq!(*seat, x, "{}", ctx());
                assert!(mv.same_choice(&m), "{}", ctx());
            }
            _ => panic!("first event must be MoveMade{}", ctx()),
        }
    }

    // Statuses only get worse.
    for s in Seat::ALL {
        assert!(
            status_rank_ok(prev.status(s), next.status(s)),
            "status of {s:?}{}",
            ctx()
        );
        if next.mode() == GameMode::Ffa {
            assert!(
                matches!(next.status(s), SeatStatus::Active | SeatStatus::Removed),
                "{}",
                ctx()
            );
        } else {
            assert_ne!(next.status(s), SeatStatus::Removed, "{}", ctx());
        }
    }

    // Turn chain: holder -> (passes / stalemates) -> new seat to move, each
    // step the next seat clockwise that still takes turns.
    let off_move_abandon = matches!(action, Action::Abandon(s) if s != x);
    let mut chain = vec![x];
    for e in ev {
        match e {
            GameEvent::Pass { seat } => chain.push(*seat),
            GameEvent::Defeat {
                seat,
                reason: DefeatReason::Stalemate,
            } => chain.push(*seat),
            _ => {}
        }
    }
    if !next.is_over() {
        chain.push(next.seat_to_move());
    }
    if off_move_abandon && chain.len() >= 2 && chain[1] == x {
        chain.remove(1);
    }
    for w in chain.windows(2) {
        let (a, b) = (w[0], w[1]);
        assert_ne!(a, b, "seat got two turns in a row{}", ctx());
        let mut c = a.next();
        while c != b {
            assert!(
                !next.takes_turns(c),
                "{c:?} still takes turns but was skipped between {a:?} and {b:?}{}",
                ctx()
            );
            c = c.next();
        }
    }

    // No-progress counter and ply.
    let mut np = prev.no_progress();
    let mut ply = prev.ply();
    let mut frozen_without_defeat = false;
    for e in ev {
        match e {
            GameEvent::MoveMade { piece, .. } => {
                ply += 1;
                if *piece == PieceKind::Pawn {
                    np = 0;
                } else {
                    np += 1;
                }
            }
            GameEvent::Capture { .. } | GameEvent::Defeat { .. } => np = 0,
            GameEvent::Pass { .. } => {
                ply += 1;
                np += 1;
            }
            GameEvent::Frozen { seat }
                if !ev
                    .iter()
                    .any(|d| matches!(d, GameEvent::Defeat { seat: s, .. } if s == seat)) =>
            {
                frozen_without_defeat = true;
            }
            _ => {}
        }
    }
    assert_eq!(next.ply(), ply, "ply{}", ctx());
    if !frozen_without_defeat {
        assert_eq!(next.no_progress(), np, "no-progress counter{}", ctx());
    } else {
        assert!(
            next.no_progress() >= prev.no_progress().min(np),
            "{}",
            ctx()
        );
    }

    // En passant model.
    if prev.config().en_passant_enabled && !next.is_over() {
        let mut exp: [Option<Square>; 4] = Seat::ALL.map(|s| prev.ep_target(s).map(|t| t.skipped));
        for e in ev {
            match e {
                GameEvent::MoveMade { seat, mv, piece } => {
                    let d = mv.from.rank().abs_diff(mv.to.rank())
                        + mv.from.file().abs_diff(mv.to.file());
                    let double = *piece == PieceKind::Pawn
                        && d == 2
                        && (mv.from.rank() == mv.to.rank() || mv.from.file() == mv.to.file());
                    assert_eq!(double, mv.flag == MoveFlag::DoubleStep, "{}", ctx());
                    if double {
                        exp[seat.index()] = Some(mid(mv.from, mv.to));
                    }
                }
                GameEvent::Pass { seat }
                | GameEvent::Defeat {
                    seat,
                    reason: DefeatReason::Stalemate,
                } => exp[seat.index()] = None,
                _ => {}
            }
        }
        for s in Seat::ALL {
            if !next.takes_turns(s) {
                exp[s.index()] = None;
            }
        }
        exp[next.seat_to_move().index()] = None;
        for s in Seat::ALL {
            assert_eq!(
                next.ep_target(s).map(|t| t.skipped),
                exp[s.index()],
                "ep target of {s:?}{}",
                ctx()
            );
        }
    }

    // Outcome.
    let active = |s: Seat| next.status(s) == SeatStatus::Active;
    if next.is_over() {
        let o = match ev.last() {
            Some(GameEvent::GameEnded { outcome }) => *outcome,
            _ => panic!("game over but last event is not GameEnded{}", ctx()),
        };
        assert_eq!(next.outcome(), Some(&o), "{}", ctx());
        let log: Vec<Seat> = next.defeats().iter().map(|r| r.seat).collect();
        match o.result {
            GameResult::FfaWinner { seat } => {
                assert!(active(seat));
                assert_eq!(Seat::ALL.iter().filter(|&&s| active(s)).count(), 1);
                assert_eq!(o.placement(seat), 1);
                assert_eq!(log.len(), 3, "{}", ctx());
                for (i, s) in log.iter().rev().enumerate() {
                    assert_eq!(o.placement(*s) as usize, i + 2, "{}", ctx());
                }
            }
            GameResult::FfaMoveLimitTie { survivors } => {
                assert!(next.no_progress() >= next.move_limit(), "{}", ctx());
                for s in Seat::ALL {
                    assert_eq!(survivors[s.index()], active(s), "{}", ctx());
                    if active(s) {
                        assert_eq!(o.placement(s), 1);
                    } else {
                        assert!(o.placement(s) > 1);
                    }
                }
                for w in log.windows(2) {
                    assert!(o.placement(w[0]) > o.placement(w[1]), "{}", ctx());
                }
            }
            GameResult::TeamsWinner { team } => {
                assert!(team.seats().iter().any(|&s| active(s)), "{}", ctx());
                assert!(
                    !team.other().seats().iter().any(|&s| active(s)),
                    "{}",
                    ctx()
                );
                for s in Seat::ALL {
                    let want = if s.team() == team { 1 } else { 2 };
                    assert_eq!(o.placement(s), want, "{}", ctx());
                    if s.team() != team {
                        assert_eq!(next.pieces_of(s).count(), 0, "{}", ctx());
                    }
                }
            }
            GameResult::TeamsDraw => {
                assert!(next.no_progress() >= next.move_limit(), "{}", ctx());
                for t in Team::ALL {
                    assert!(t.seats().iter().any(|&s| active(s)), "{}", ctx());
                }
            }
            GameResult::FfaAgreedDraw { .. } | GameResult::TeamsAgreedDraw => {
                panic!("agreed draws are not played in this model{}", ctx())
            }
        }
    } else {
        assert!(!ev.iter().any(|e| matches!(e, GameEvent::GameEnded { .. })));
        if next.mode() == GameMode::Ffa {
            assert!(Seat::ALL.iter().filter(|&&s| active(s)).count() >= 2);
        } else {
            for t in Team::ALL {
                assert!(t.seats().iter().any(|&s| active(s)), "{}", ctx());
            }
        }
    }
}

#[test]
fn random_games_match_an_independent_counter_turn_and_ep_model() {
    let games: usize = std::env::var("ATTACK_GAMES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(160);
    let mut rng = Rng(0xDEAD_BEEF_1234_5678);
    let mut moves = Vec::new();
    let mut endings = [0usize; 4];
    for g in 0..games {
        let mode = if g % 2 == 0 {
            GameMode::Ffa
        } else {
            GameMode::Teams
        };
        let mut cfg = GameConfig::new(mode);
        cfg.move_limit_rounds = [1, 2, 3, 25][rng.below(4)];
        cfg.en_passant_enabled = rng.below(8) != 0;
        let mut s = GameState::new(cfg).unwrap();
        for _ in 0..300 {
            if s.is_over() {
                break;
            }
            let roll = rng.below(1000);
            let action = if roll < 15 {
                Action::Timeout(s.seat_to_move())
            } else if roll < 25 {
                let live: Vec<Seat> = Seat::ALL
                    .into_iter()
                    .filter(|&x| s.takes_turns(x))
                    .collect();
                Action::Abandon(live[rng.below(live.len())])
            } else {
                if roll < 60 {
                    // junk move: must be rejected without side effects
                    let from = Square::new(rng.below(144) as u8).unwrap();
                    let to = Square::new(rng.below(144) as u8).unwrap();
                    let promo = [None, Some(PieceKind::Queen), Some(PieceKind::King)][rng.below(3)];
                    let junk = Move {
                        from,
                        to,
                        promotion: promo,
                        flag: MoveFlag::Normal,
                    };
                    if find_legal_move(&s, junk).is_none() {
                        let before = s.clone();
                        assert!(apply_move(&mut s, junk).is_err());
                        assert_eq!(s, before);
                    }
                }
                generate_legal_moves(&s, &mut moves);
                assert!(!moves.is_empty());
                // notation round trip of every legal move
                for m in &moves {
                    let p = parse_move(&format_move(m)).unwrap();
                    assert!(p.same_choice(m));
                    assert_eq!(find_legal_move(&s, p), Some(*m));
                }
                let caps: Vec<Move> = moves
                    .iter()
                    .copied()
                    .filter(|m| s.piece_at(m.to).is_some() || m.flag == MoveFlag::EnPassant)
                    .collect();
                let m = if !caps.is_empty() && rng.below(3) == 0 {
                    caps[rng.below(caps.len())]
                } else {
                    moves[rng.below(moves.len())]
                };
                Action::Move(m)
            };
            let prev = s.clone();
            if let Action::Move(m) = action {
                // The unvalidated fast path must agree with apply_move.
                let mut fast = s.clone();
                let mut fast_ev = Vec::new();
                apply_generated_move(&mut fast, m, &mut fast_ev);
                let mut slow = s.clone();
                let slow_ev = apply_move(&mut slow, m).unwrap();
                assert_eq!(fast, slow, "apply_generated_move diverged on {m} in {prev}");
                assert_eq!(fast_ev, slow_ev);
            }
            let ev = match action {
                Action::Move(m) => apply_move(&mut s, m),
                Action::Timeout(seat) => apply_timeout(&mut s, seat),
                Action::Abandon(seat) => apply_abandon(&mut s, seat),
            }
            .unwrap_or_else(|e| panic!("{action:?} failed: {e} in {prev}"));
            check_transition(&prev, action, &ev, &s);
        }
        if let Some(o) = s.outcome() {
            let k = match o.result {
                GameResult::FfaWinner { .. } => 0,
                GameResult::FfaMoveLimitTie { .. } => 1,
                GameResult::TeamsWinner { .. } => 2,
                GameResult::TeamsDraw => 3,
                GameResult::FfaAgreedDraw { .. } | GameResult::TeamsAgreedDraw => {
                    unreachable!("agreed draws are not played here")
                }
            };
            endings[k] += 1;
        }
    }
    // Make sure the run actually exercised every kind of ending.
    assert!(endings.iter().all(|&n| n > 0), "endings {endings:?}");
}
