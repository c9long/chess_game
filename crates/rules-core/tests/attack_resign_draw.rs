//! Adversarial, spec-derived tests for resignation and draw by agreement.
//!
//! Spec (task + docs/PLAN.md §2 + docs/RULES.md):
//! * Resign: any seat that still takes turns, any time. Errors after the end
//!   or for a seat no longer taking turns.
//!   - FFA: effect = timeout with reason Resign (army removed). Own turn →
//!     turn advances (stalemate resolution as after timeouts). Off turn → the
//!     seat on move is re-checked. Game may end. Defeat{Resign} + ArmyRemoved.
//!   - Teams: the whole team resigns (the server collected the partner's
//!     consent) and the game ends at once, the other team winning. Each team
//!     seat still taking turns freezes, resigner first: ACTIVE →
//!     Defeat{Resign} + Frozen; DEFEATED → Frozen only. A single Teams seat
//!     leaving on its own is an abandon (used below to set up frozen seats).
//! * En passant target is cleared when the seat stops taking turns.
//! * Agreed draw: FFA survivors tie for best place, defeated keep reverse
//!   defeat order; Teams everyone 1st. Voters = seats still taking turns.

mod common;

use common::*;
use rules_core::*;

fn start(mode: GameMode) -> GameState {
    GameState::new(GameConfig::new(mode)).unwrap()
}

fn ended(ev: &[GameEvent]) -> Option<Outcome> {
    ev.iter().find_map(|e| match e {
        GameEvent::GameEnded { outcome } => Some(*outcome),
        _ => None,
    })
}

fn castling_field(s: &GameState) -> String {
    s.to_position_string()
        .split(' ')
        .nth(4)
        .unwrap()
        .to_string()
}

fn ep_field(s: &GameState) -> String {
    s.to_position_string()
        .split(' ')
        .nth(5)
        .unwrap()
        .to_string()
}

fn json_round_trip(s: &GameState) {
    let j = serde_json::to_string(s).unwrap();
    let back: GameState = serde_json::from_str(&j).unwrap();
    assert_eq!(&back, s, "serde round trip differs: {j}");
    assert_eq!(back.hash(), s.hash());
    assert_eq!(back.outcome(), s.outcome());
}

fn full_check(s: &GameState) {
    check_invariants(s);
    json_round_trip(s);
}

/// Independent model of FFA placements: ACTIVE seats share 1st, defeated
/// seats follow in reverse order of defeat (competition ranking).
fn model_ffa_placements(s: &GameState) -> [u8; 4] {
    let mut p = [0u8; 4];
    let active: Vec<Seat> = Seat::ALL
        .into_iter()
        .filter(|&x| s.status(x) == SeatStatus::Active)
        .collect();
    for a in &active {
        p[a.index()] = 1;
    }
    let recs: Vec<DefeatRecord> = s.defeats().iter().collect();
    for (next, r) in (active.len() as u8 + 1..).zip(recs.iter().rev()) {
        p[r.seat.index()] = next;
    }
    p
}

// ---------------------------------------------------------------------------
// Resign: seat to move vs off turn
// ---------------------------------------------------------------------------

#[test]
fn resign_is_not_a_turn_and_resets_no_progress() {
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let mut s = start(mode);
        play(&mut s, "e2e4");
        play(&mut s, "b5c5");
        play(&mut s, "e11e10");
        // East moves a knight (no progress), then South a knight.
        let east_knight = move_strings(&s)
            .into_iter()
            .find(|m| m.starts_with("l4") || m.starts_with("l9"))
            .unwrap();
        play(&mut s, &east_knight);
        play(&mut s, "d1c3");
        assert_eq!(s.no_progress(), 2);
        let ply = s.ply();
        // West is on move; North resigns off turn.
        assert_eq!(s.seat_to_move(), Seat::West);
        apply_resign(&mut s, Seat::North).unwrap();
        assert_eq!(s.ply(), ply, "{mode:?}: resign must not count as a turn");
        assert_eq!(s.no_progress(), 0, "{mode:?}: a defeat resets no-progress");
        if mode == GameMode::Ffa {
            assert_eq!(s.seat_to_move(), Seat::West);
            assert_eq!(s.move_limit(), 75);
        } else {
            // Teams: North's whole team resigned; the game is over.
            assert!(s.is_over());
        }
        full_check(&s);
    }
}

#[test]
fn own_turn_resign_equals_timeout_in_ffa() {
    {
        let mode = GameMode::Ffa;
        let mut s = start(mode);
        play(&mut s, "e2e4");
        let mut a = s.clone();
        let mut b = s.clone();
        let ea = apply_resign(&mut a, Seat::West).unwrap();
        let eb = apply_timeout(&mut b, Seat::West).unwrap();
        let strip = |ev: &[GameEvent]| -> Vec<GameEvent> {
            ev.iter()
                .map(|e| match e {
                    GameEvent::Defeat { seat, .. } => GameEvent::Defeat {
                        seat: *seat,
                        reason: DefeatReason::Timeout,
                    },
                    other => *other,
                })
                .collect()
        };
        assert_eq!(strip(&ea), strip(&eb));
        assert_eq!(a.board(), b.board());
        assert_eq!(a.statuses(), b.statuses());
        assert_eq!(a.seat_to_move(), b.seat_to_move());
        assert_eq!(a.seat_to_move(), Seat::North);
        // South's double-step target is still live (South not reached yet).
        assert_eq!(ep_field(&a), ep_field(&b));
        assert_eq!(a.defeats().reason(Seat::West), Some(DefeatReason::Resign));
        full_check(&a);
    }
}

#[test]
fn own_turn_resign_in_teams_differs_from_timeout() {
    // A Teams timeout freezes one seat and the partner plays on; a Teams
    // resignation takes the whole team out and ends the game.
    let mut s = start(GameMode::Teams);
    play(&mut s, "e2e4");
    let mut a = s.clone();
    let mut b = s.clone();
    apply_resign(&mut a, Seat::West).unwrap();
    apply_timeout(&mut b, Seat::West).unwrap();
    assert!(a.is_over() && !b.is_over());
    assert_eq!(a.status(Seat::East), SeatStatus::Frozen);
    assert_eq!(b.status(Seat::East), SeatStatus::Active);
    assert_eq!(
        a.outcome().map(|o| o.result),
        Some(GameResult::TeamsWinner {
            team: Team::SouthNorth
        })
    );
    full_check(&a);
    full_check(&b);
}

// ---------------------------------------------------------------------------
// Resign that triggers stalemate / auto-pass for the seat on move
// ---------------------------------------------------------------------------

/// South's only legal move is b4xc5 en passant on West's double-stepped pawn
/// (d5, skipped c5).
const EP_TRAP: [&str; 14] = [
    "sKa1", "sRb1", "sBc1", "sBa3", "sPa2", "sPb2", "sPb3", "sPb4", "sPd2", "eRb5", "eNd3", "eKl7",
    "wKa7", "wPd5",
];

#[test]
fn ep_trap_position_is_what_the_tests_assume() {
    let mut pieces = EP_TRAP.to_vec();
    pieces.push("nKg12");
    let s = build("ffa", &pieces, "S AAAA - Wc5 0 0");
    assert_eq!(move_strings(&s), vec!["b4c5"]);
    let m = legal_moves(&s);
    assert_eq!(m[0].flag, MoveFlag::EnPassant);
}

#[test]
fn ffa_off_turn_resign_of_ep_victim_stalemates_seat_on_move() {
    let mut pieces = EP_TRAP.to_vec();
    pieces.push("nKg12");
    let mut s = build("ffa", &pieces, "S AAAA - Wc5 0 0");
    let ev = apply_resign(&mut s, Seat::West).unwrap();
    assert_eq!(
        ev,
        vec![
            GameEvent::Defeat {
                seat: Seat::West,
                reason: DefeatReason::Resign
            },
            GameEvent::ArmyRemoved { seat: Seat::West },
            GameEvent::Defeat {
                seat: Seat::South,
                reason: DefeatReason::Stalemate
            },
            GameEvent::ArmyRemoved { seat: Seat::South },
        ]
    );
    assert_eq!(s.seat_to_move(), Seat::North);
    assert_eq!(s.ply(), 0);
    full_check(&s);
}

#[test]
fn teams_off_turn_abandon_clears_ep_target_and_stalemates_seat_on_move() {
    // Teams: West leaves alone (abandon) and freezes, its pawn stays on d5,
    // but its en passant target is cleared because West stopped taking turns
    // -> South has no move.
    let mut pieces = EP_TRAP.to_vec();
    pieces.push("nKg12");
    let mut s = build("teams", &pieces, "S AAAA - Wc5 0 0");
    assert_eq!(move_strings(&s), vec!["b4c5"]);
    let ev = apply_abandon(&mut s, Seat::West).unwrap();
    assert_eq!(
        ev,
        vec![
            GameEvent::Defeat {
                seat: Seat::West,
                reason: DefeatReason::Abandon
            },
            GameEvent::Frozen { seat: Seat::West },
            GameEvent::Defeat {
                seat: Seat::South,
                reason: DefeatReason::Stalemate
            },
        ]
    );
    assert_eq!(
        s.statuses(),
        [
            SeatStatus::Defeated,
            SeatStatus::Frozen,
            SeatStatus::Active,
            SeatStatus::Active
        ]
    );
    assert!(s.ep_target(Seat::West).is_none());
    assert_eq!(
        s.piece_at(sq("d5")),
        Some(Piece::new(PieceKind::Pawn, Seat::West))
    );
    assert_eq!(s.seat_to_move(), Seat::North);
    assert_eq!(s.ply(), 0);
    assert_eq!(s.no_progress(), 0);
    assert_eq!(draw_voters(&s), [true, false, true, true]);
    full_check(&s);
}

#[test]
fn teams_off_turn_abandon_makes_defeated_seat_on_move_pass() {
    let mut pieces = EP_TRAP.to_vec();
    pieces.push("nKg12");
    let mut s = build("teams", &pieces, "S DAAA - Wc5 7 30 def=Sl");
    assert_eq!(move_strings(&s), vec!["b4c5"]);
    let ev = apply_abandon(&mut s, Seat::West).unwrap();
    assert_eq!(
        ev,
        vec![
            GameEvent::Defeat {
                seat: Seat::West,
                reason: DefeatReason::Abandon
            },
            GameEvent::Frozen { seat: Seat::West },
            GameEvent::Pass { seat: Seat::South },
        ]
    );
    assert_eq!(s.seat_to_move(), Seat::North);
    assert_eq!(s.ply(), 31, "an automatic pass counts as a turn");
    assert_eq!(
        s.no_progress(),
        1,
        "defeat resets to 0, then the pass adds 1"
    );
    full_check(&s);
}

// ---------------------------------------------------------------------------
// Resign that ends the game
// ---------------------------------------------------------------------------

#[test]
fn ffa_off_turn_resign_by_second_to_last_seat_crowns_seat_on_move() {
    let mut s = build("ffa", &["sKg1", "nKg12"], "S ARAR - - 0 0 def=Wl,Er");
    let ev = apply_resign(&mut s, Seat::North).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(o.result, GameResult::FfaWinner { seat: Seat::South });
    assert_eq!(o.placements, [1, 4, 2, 3]);
    assert_eq!(
        ev,
        vec![
            GameEvent::Defeat {
                seat: Seat::North,
                reason: DefeatReason::Resign
            },
            GameEvent::ArmyRemoved { seat: Seat::North },
            GameEvent::GameEnded { outcome: o },
        ]
    );
    full_check(&s);
    // Every further action is refused.
    for seat in Seat::ALL {
        assert_eq!(apply_resign(&mut s, seat), Err(RulesError::GameOver));
        assert_eq!(apply_timeout(&mut s, seat), Err(RulesError::GameOver));
        assert_eq!(apply_abandon(&mut s, seat), Err(RulesError::GameOver));
    }
    assert_eq!(apply_agreed_draw(&mut s), Err(RulesError::GameOver));
    assert_eq!(draw_voters(&s), [false; 4]);
}

#[test]
fn ffa_seat_on_move_resigns_leaving_one() {
    let mut s = build("ffa", &["sKg1", "nKg12"], "S ARAR - - 0 0 def=Wl,Er");
    let ev = apply_resign(&mut s, Seat::South).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(o.result, GameResult::FfaWinner { seat: Seat::North });
    assert_eq!(o.placements, [2, 4, 1, 3]);
    full_check(&s);
}

#[test]
fn teams_resign_with_frozen_partner_ends_game_and_removes_both_armies() {
    // North is frozen; South (ACTIVE) resigns off turn -> S/N team has no
    // ACTIVE seat -> West/East win; the losing team's pieces are removed
    // (including the frozen North pieces).
    let mut s = build(
        "teams",
        &["sKg1", "sRa1", "wKa7", "nKg12", "nQf12", "eKl7"],
        "W AAFA - - 0 0 def=Nt",
    );
    let ev = apply_resign(&mut s, Seat::South).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(
        o.result,
        GameResult::TeamsWinner {
            team: Team::WestEast
        }
    );
    assert_eq!(o.placements, [2, 1, 2, 1]);
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    assert_eq!(s.pieces_of(Seat::West).count(), 1);
    assert_eq!(s.defeats().reason(Seat::South), Some(DefeatReason::Resign));
    assert_eq!(
        ev.first(),
        Some(&GameEvent::Defeat {
            seat: Seat::South,
            reason: DefeatReason::Resign
        })
    );
    assert_eq!(ev[1], GameEvent::Frozen { seat: Seat::South });
    full_check(&s);
}

#[test]
fn teams_one_resign_ends_the_game_for_both_partners() {
    let mut s = start(GameMode::Teams);
    let ev = apply_resign(&mut s, Seat::East).unwrap(); // off turn
    let o = ended(&ev).unwrap();
    assert_eq!(
        o.result,
        GameResult::TeamsWinner {
            team: Team::SouthNorth
        }
    );
    assert_eq!(o.placements, [1, 2, 1, 2]);
    assert_eq!(s.pieces_of(Seat::West).count(), 0);
    assert_eq!(s.pieces_of(Seat::East).count(), 0);
    assert_eq!(s.pieces_of(Seat::South).count(), 16);
    assert_eq!(s.defeats().reason(Seat::East), Some(DefeatReason::Resign));
    assert_eq!(s.defeats().reason(Seat::West), Some(DefeatReason::Resign));
    assert_eq!(draw_voters(&s), [false; 4]);
    full_check(&s);
}

#[test]
fn teams_abandon_then_resign_by_the_partner() {
    let mut s = start(GameMode::Teams);
    apply_abandon(&mut s, Seat::East).unwrap();
    assert!(!s.is_over());
    assert_eq!(draw_voters(&s), [true, true, true, false]);
    full_check(&s);
    let ev = apply_resign(&mut s, Seat::West).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(
        o.result,
        GameResult::TeamsWinner {
            team: Team::SouthNorth
        }
    );
    assert_eq!(s.defeats().reason(Seat::East), Some(DefeatReason::Abandon));
    assert_eq!(s.defeats().reason(Seat::West), Some(DefeatReason::Resign));
    full_check(&s);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[test]
fn double_resign_is_refused_in_both_modes() {
    // Teams: the first resignation ends the game.
    let mut s = start(GameMode::Teams);
    apply_resign(&mut s, Seat::North).unwrap();
    let before = s.clone();
    for seat in Seat::ALL {
        assert_eq!(apply_resign(&mut s, seat), Err(RulesError::GameOver));
    }
    assert_eq!(s, before);
    {
        let mode = GameMode::Ffa;
        let mut s = start(mode);
        apply_resign(&mut s, Seat::North).unwrap();
        let before = s.clone();
        assert_eq!(
            apply_resign(&mut s, Seat::North),
            Err(RulesError::SeatNotInPlay(Seat::North))
        );
        assert_eq!(s, before);
        // Same seat after an own-turn resign.
        let mut s = start(mode);
        apply_resign(&mut s, Seat::South).unwrap();
        let before = s.clone();
        assert_eq!(
            apply_resign(&mut s, Seat::South),
            Err(RulesError::SeatNotInPlay(Seat::South))
        );
        assert_eq!(s, before);
    }
}

#[test]
fn teams_defeated_then_frozen_cannot_resign() {
    let mut s = build(
        "teams",
        &["sKg1", "wKa7", "nRa12", "eKl7"],
        "W AADA - - 0 0 def=Nl",
    );
    apply_abandon(&mut s, Seat::North).unwrap();
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    let before = s.clone();
    assert_eq!(
        apply_resign(&mut s, Seat::North),
        Err(RulesError::SeatNotInPlay(Seat::North))
    );
    assert_eq!(s, before);
    full_check(&s);
}

#[test]
fn resign_after_move_limit_end_is_refused() {
    let mut s = build("ffa", &["sKg1", "nKg12", "eKl7"], "S ARAA - - 74 0 def=Wl");
    let ev = play(&mut s, "g1g2");
    assert!(ended(&ev).is_some());
    let before = s.clone();
    assert_eq!(apply_resign(&mut s, Seat::North), Err(RulesError::GameOver));
    assert_eq!(s, before);
}

// ---------------------------------------------------------------------------
// En passant targets and castling rights of the resigning seat
// ---------------------------------------------------------------------------

#[test]
fn off_turn_departure_clears_only_the_leavers_ep_target() {
    // FFA: a resignation. Teams: a single seat leaving (abandon), since a
    // Teams resignation ends the game.
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let mut s = start(mode);
        play(&mut s, "c2c4");
        play(&mut s, "b5d5");
        play(&mut s, "d11d9");
        assert_eq!(s.seat_to_move(), Seat::East);
        assert_eq!(ep_field(&s), "Sc3,Wc5,Nd10");
        match mode {
            GameMode::Ffa => apply_resign(&mut s, Seat::West).unwrap(),
            GameMode::Teams => apply_abandon(&mut s, Seat::West).unwrap(),
        };
        assert_eq!(ep_field(&s), "Sc3,Nd10", "{mode:?}");
        assert!(s.ep_target(Seat::West).is_none());
        full_check(&s);
        // North's target is still capturable by... nobody here, but it must
        // expire when the turn reaches North (after East and South).
        let m = legal_moves(&s)[0];
        apply_move(&mut s, m).unwrap();
        assert_eq!(s.seat_to_move(), Seat::South);
        assert!(s.ep_target(Seat::South).is_none());
        assert!(s.ep_target(Seat::North).is_some());
        full_check(&s);
    }
}

#[test]
fn own_turn_abandon_after_double_step_skip_expires_targets_on_the_walk() {
    // Teams: West double-steps; North leaves; East and South move; when the
    // pointer reaches/skips North its (absent) target and West's expire as
    // normal.
    let mut s = start(GameMode::Teams);
    play(&mut s, "c2c4");
    play(&mut s, "b5d5");
    apply_abandon(&mut s, Seat::North).unwrap(); // North to move
    // North was on move: the turn advanced to East.
    assert_eq!(s.seat_to_move(), Seat::East);
    assert_eq!(ep_field(&s), "Sc3,Wc5");
    full_check(&s);
}

#[test]
fn resign_clears_castling_of_resigner_only() {
    // Teams: the whole resigning team loses its rights.
    let mut s = start(GameMode::Teams);
    apply_resign(&mut s, Seat::North).unwrap();
    assert_eq!(castling_field(&s), "Wa3,Wa10,El3,El10");
    full_check(&s);
    {
        let mode = GameMode::Ffa;
        let mut s = start(mode);
        assert_eq!(castling_field(&s), "Sc1,Sj1,Wa3,Wa10,Nc12,Nj12,El3,El10");
        apply_resign(&mut s, Seat::North).unwrap();
        assert_eq!(castling_field(&s), "Sc1,Sj1,Wa3,Wa10,El3,El10", "{mode:?}");
        apply_resign(&mut s, Seat::South).unwrap();
        assert_eq!(castling_field(&s), "Wa3,Wa10,El3,El10", "{mode:?}");
        assert!(s.castling_rights(Seat::South).is_empty());
        full_check(&s);
    }
}

#[test]
fn teams_frozen_pieces_still_block_and_can_be_captured() {
    let mut s = build(
        "teams",
        &["sKg1", "sRd1", "wKa7", "nKg12", "nRd5", "eKl7", "eRd12"],
        "E AAAA - - 0 0",
    );
    // East's rook on d12 sees down to North's rook on d5? North is an enemy
    // of East, so East can capture it only after... (it is on move now).
    apply_abandon(&mut s, Seat::North).unwrap(); // off turn
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert!(is_legal(&s, "d12d5"), "frozen pieces can be captured");
    assert!(!is_legal(&s, "d12d4"), "frozen pieces block");
    full_check(&s);
}

// ---------------------------------------------------------------------------
// Agreed draw placements
// ---------------------------------------------------------------------------

#[test]
fn ffa_agreed_draw_zero_prior_defeats() {
    let mut s = start(GameMode::Ffa);
    let ev = apply_agreed_draw(&mut s).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(
        o.result,
        GameResult::FfaAgreedDraw {
            survivors: [true; 4]
        }
    );
    assert_eq!(o.placements, [1, 1, 1, 1]);
    full_check(&s);
}

#[test]
fn ffa_agreed_draw_one_prior_defeat() {
    let mut s = start(GameMode::Ffa);
    play(&mut s, "e2e4");
    apply_resign(&mut s, Seat::East).unwrap();
    let ev = apply_agreed_draw(&mut s).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(
        o.result,
        GameResult::FfaAgreedDraw {
            survivors: [true, true, true, false]
        }
    );
    assert_eq!(o.placements, [1, 1, 1, 4]);
    assert_eq!(o.placements, model_ffa_placements(&s));
    full_check(&s);
}

#[test]
fn ffa_agreed_draw_two_prior_defeats_mixed_reasons() {
    // South stalemated first (via resign of West off turn in EP_TRAP), then
    // West resigned before it: order is West (resign), South (stalemate).
    let mut pieces = EP_TRAP.to_vec();
    pieces.push("nKg12");
    let mut s = build("ffa", &pieces, "S AAAA - Wc5 0 0");
    apply_resign(&mut s, Seat::West).unwrap();
    let ev = apply_agreed_draw(&mut s).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(
        o.result,
        GameResult::FfaAgreedDraw {
            survivors: [false, false, true, true]
        }
    );
    // West out first -> 4th; South out second -> 3rd.
    assert_eq!(o.placements, [3, 4, 1, 1]);
    assert!(s.to_position_string().contains("def=Wr,Ss"));
    full_check(&s);
}

#[test]
fn teams_resign_of_last_active_on_a_team_with_defeated_partner_ends_game() {
    // West is DEFEATED (still playing); East resigning leaves W/E without an
    // ACTIVE seat -> S/N win and W/E pieces (incl. the defeated West) leave.
    let mut s = build(
        "teams",
        &["sKg1", "wRa7", "nKg12", "eKl7", "eQl6"],
        "S ADAA - - 3 9 def=Wl",
    );
    let ev = apply_resign(&mut s, Seat::East).unwrap();
    let o = ended(&ev).unwrap();
    assert_eq!(
        o.result,
        GameResult::TeamsWinner {
            team: Team::SouthNorth
        }
    );
    assert_eq!(o.placements, [1, 2, 1, 2]);
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::West }));
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::East }));
    full_check(&s);
}

#[test]
fn teams_agreed_draw_with_defeated_and_frozen_seats() {
    let mut s = build(
        "teams",
        &["sKg1", "wRa7", "nKg12", "eKl7", "eQl6"],
        "S ADAA - - 3 9 def=Wl",
    );
    apply_abandon(&mut s, Seat::North).unwrap(); // off turn
    assert_eq!(draw_voters(&s), [true, true, false, true]);
    let ev = apply_agreed_draw(&mut s).unwrap();
    assert_eq!(ev.len(), 1);
    let o = ended(&ev).unwrap();
    assert_eq!(o.result, GameResult::TeamsAgreedDraw);
    assert_eq!(o.placements, [1; 4]);
    // Frozen and defeated pieces stay on the board.
    assert_eq!(s.pieces_of(Seat::North).count(), 1);
    assert_eq!(s.pieces_of(Seat::West).count(), 1);
    full_check(&s);
}

// ---------------------------------------------------------------------------
// Voters
// ---------------------------------------------------------------------------

#[test]
fn voters_follow_every_status_change() {
    let mut s = build(
        "teams",
        &["sKg1", "wRa7", "wKb12", "nKg12", "eKl7"],
        "S ADAA - - 0 0 def=Wl",
    );
    // West is DEFEATED but still playing: it votes.
    assert_eq!(draw_voters(&s), [true, true, true, true]);
    apply_abandon(&mut s, Seat::West).unwrap(); // DEFEATED -> FROZEN
    assert_eq!(draw_voters(&s), [true, false, true, true]);
    apply_abandon(&mut s, Seat::North).unwrap();
    assert_eq!(draw_voters(&s), [true, false, false, true]);
    for seat in Seat::ALL {
        assert_eq!(draw_voters(&s)[seat.index()], s.takes_turns(seat));
    }
    full_check(&s);
}

// ---------------------------------------------------------------------------
// Position string / hash round trips
// ---------------------------------------------------------------------------

#[test]
fn agreed_draw_with_defeated_seat_on_move_round_trips() {
    let mut s = build(
        "teams",
        &["sKg1", "wRa7", "nKg12", "eKl7"],
        "W ADAA - - 3 9 def=Wl",
    );
    assert_eq!(s.seat_to_move(), Seat::West);
    apply_agreed_draw(&mut s).unwrap();
    let text = s.to_position_string();
    assert!(text.ends_with(" end=draw"));
    let back = parse_position(&text).unwrap();
    assert_eq!(back, s);
    assert_eq!(back.hash(), s.hash());
    full_check(&s);
}

#[test]
fn end_marker_may_appear_anywhere_among_options() {
    let s = parse_position(&format!(
        "ffa {} S AAAA - - 0 0 end=draw ep=on",
        board_field(&["sKg1", "wKa7", "nKg12", "eKl7"])
    ))
    .unwrap();
    assert!(s.is_agreed_draw());
    full_check(&s);
}

#[test]
fn agreed_draw_hash_differs_from_move_limit_but_equals_parsed() {
    let mut a = build("ffa", &["sKg1", "nKg12", "eKl7"], "S ARAA - - 10 0 def=Wl");
    let pre = a.hash();
    apply_agreed_draw(&mut a).unwrap();
    assert_ne!(a.hash(), pre);
    assert_eq!(a.hash(), zobrist::compute_hash(&a));
    let b = parse_position(&a.to_position_string()).unwrap();
    assert_eq!(b.hash(), a.hash());
    assert_eq!(b.outcome(), a.outcome());
}

#[test]
fn position_rejects_resign_reason_for_defeated_teams_seat_only() {
    let board = board_field(&["sKg1", "wKa7", "nKg12", "eKl7"]);
    assert!(parse_position(&format!("teams {board} S AADA - - 0 0 def=Nr")).is_err());
    assert!(parse_position(&format!("teams {board} S AAFA - - 0 0 def=Nr")).is_ok());
    let board = board_field(&["sKg1", "wKa7", "eKl7"]);
    assert!(parse_position(&format!("ffa {board} S AARA - - 0 0 def=Nr")).is_ok());
}

#[test]
fn serde_rejects_agreed_draw_flag_on_decided_game() {
    let s = build("ffa", &["sKg1", "nKg12", "eKl7"], "S ARAA - - 74 0 def=Wl");
    let mut v: serde_json::Value = serde_json::to_value(&s).unwrap();
    assert!(v.get("agreed_draw").is_none(), "omitted when false");
    v["agreed_draw"] = serde_json::Value::Bool(true);
    assert!(serde_json::from_value::<GameState>(v.clone()).is_ok());
    v["no_progress"] = serde_json::json!(75);
    assert!(serde_json::from_value::<GameState>(v).is_err());
}

#[test]
fn serde_result_and_event_shapes() {
    let mut s = start(GameMode::Ffa);
    let ev = apply_resign(&mut s, Seat::South).unwrap();
    let j = serde_json::to_value(ev[0]).unwrap();
    assert_eq!(
        j,
        serde_json::json!({"type": "defeat", "seat": "south", "reason": "resign"})
    );
    let ev = apply_agreed_draw(&mut s).unwrap();
    let j = serde_json::to_value(ev[0]).unwrap();
    assert_eq!(
        j["outcome"]["result"],
        serde_json::json!({"type": "ffa_agreed_draw", "survivors": [false, true, true, true]})
    );
    assert_eq!(j["outcome"]["placements"], serde_json::json!([4, 1, 1, 1]));
    let t: GameResult =
        serde_json::from_value(serde_json::json!({"type": "teams_agreed_draw"})).unwrap();
    assert_eq!(t, GameResult::TeamsAgreedDraw);
}

// ---------------------------------------------------------------------------
// Randomized property check against the spec
// ---------------------------------------------------------------------------

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn check_resign(
    before: &GameState,
    after: &GameState,
    seat: Seat,
    res: &Result<Vec<GameEvent>, RulesError>,
) {
    if before.is_over() {
        assert_eq!(res, &Err(RulesError::GameOver));
        assert_eq!(after, before);
        return;
    }
    if !before.takes_turns(seat) {
        assert_eq!(res, &Err(RulesError::SeatNotInPlay(seat)));
        assert_eq!(after, before);
        return;
    }
    let ev = res.as_ref().unwrap();
    if before.mode() == GameMode::Teams {
        check_team_resign(before, after, seat, ev);
        return;
    }
    let was_active = before.status(seat) == SeatStatus::Active;
    let leave_ev = match before.mode() {
        GameMode::Ffa => GameEvent::ArmyRemoved { seat },
        GameMode::Teams => GameEvent::Frozen { seat },
    };
    if was_active {
        assert_eq!(
            ev[0],
            GameEvent::Defeat {
                seat,
                reason: DefeatReason::Resign
            }
        );
        assert_eq!(ev[1], leave_ev);
        let n = before.defeats().len();
        let recs: Vec<DefeatRecord> = after.defeats().iter().collect();
        assert_eq!(
            recs[n],
            DefeatRecord {
                seat,
                reason: DefeatReason::Resign
            }
        );
    } else {
        assert_eq!(ev[0], leave_ev);
        assert_eq!(after.defeats().reason(seat), before.defeats().reason(seat));
    }
    // Exactly one Defeat event for the resigner at most.
    assert_eq!(
        ev.iter()
            .filter(|e| matches!(e, GameEvent::Defeat { seat: s2, .. } if *s2 == seat))
            .count(),
        usize::from(was_active)
    );
    let expected_status = match before.mode() {
        GameMode::Ffa => SeatStatus::Removed,
        GameMode::Teams => SeatStatus::Frozen,
    };
    assert_eq!(after.status(seat), expected_status);
    assert!(after.castling_rights(seat).is_empty());
    assert!(after.ep_target(seat).is_none());
    let passes = ev
        .iter()
        .filter(|e| matches!(e, GameEvent::Pass { .. }))
        .count() as u32;
    assert_eq!(after.ply(), before.ply() + passes);
    let others_defeated = ev
        .iter()
        .any(|e| matches!(e, GameEvent::Defeat { seat: s2, .. } if *s2 != seat));
    let on_move = before.seat_to_move() == seat;
    if !after.is_over() {
        assert_ne!(after.seat_to_move(), seat);
        if !on_move && passes == 0 && !others_defeated {
            assert_eq!(after.seat_to_move(), before.seat_to_move());
            for o in Seat::ALL {
                if o != seat {
                    assert_eq!(after.ep_target(o), before.ep_target(o));
                    assert_eq!(after.castling_rights(o), before.castling_rights(o));
                }
            }
        }
        // Teams: pieces stay when the game goes on.
        if before.mode() == GameMode::Teams {
            assert_eq!(
                after.pieces_of(seat).count(),
                before.pieces_of(seat).count()
            );
        }
        assert_eq!(draw_voters(after), Seat::ALL.map(|x| after.takes_turns(x)));
    } else {
        assert!(matches!(ev.last(), Some(GameEvent::GameEnded { .. })));
    }
    if before.mode() == GameMode::Ffa {
        assert_eq!(after.pieces_of(seat).count(), 0);
    }
    if on_move {
        let mut t = before.clone();
        let tev = apply_timeout(&mut t, seat).unwrap();
        assert_eq!(tev.len(), ev.len());
        assert_eq!(t.board(), after.board());
        assert_eq!(t.statuses(), after.statuses());
        assert_eq!(t.ply(), after.ply());
        assert_eq!(t.no_progress(), after.no_progress());
        assert_eq!(t.hash(), after.hash());
        assert_eq!(
            t.outcome().map(|o| o.placements),
            after.outcome().map(|o| o.placements)
        );
    }
}

/// Teams: the resigner's whole team goes out and the other team wins at once.
fn check_team_resign(before: &GameState, after: &GameState, seat: Seat, ev: &[GameEvent]) {
    let team = seat.team();
    let partner = seat.partner();
    let o = ended(ev).expect("a Teams resignation ends the game");
    assert!(matches!(ev.last(), Some(GameEvent::GameEnded { .. })));
    assert_eq!(o.result, GameResult::TeamsWinner { team: team.other() });
    for s2 in Seat::ALL {
        let expected = if s2.team() == team { 2 } else { 1 };
        assert_eq!(o.placements[s2.index()], expected);
    }
    assert_eq!(after.outcome(), Some(&o));
    // Exactly the team's ACTIVE seats are newly defeated, resigner first.
    let defeats: Vec<Seat> = ev
        .iter()
        .filter_map(|e| match e {
            GameEvent::Defeat { seat: s2, reason } => {
                assert_eq!(*reason, DefeatReason::Resign);
                Some(*s2)
            }
            _ => None,
        })
        .collect();
    let expected: Vec<Seat> = [seat, partner]
        .into_iter()
        .filter(|&s2| before.status(s2) == SeatStatus::Active)
        .collect();
    assert_eq!(defeats, expected);
    for s2 in [seat, partner] {
        if before.takes_turns(s2) {
            assert_eq!(after.status(s2), SeatStatus::Frozen);
            assert!(ev.contains(&GameEvent::Frozen { seat: s2 }));
        } else {
            assert_eq!(after.status(s2), before.status(s2));
        }
        // Every team seat still taking turns took part in the vote and is
        // recorded as resigned; a FROZEN partner keeps its record.
        if before.takes_turns(s2) {
            assert_eq!(after.defeats().reason(s2), Some(DefeatReason::Resign));
        } else {
            assert_eq!(after.defeats().reason(s2), before.defeats().reason(s2));
        }
        assert_eq!(after.pieces_of(s2).count(), 0);
        assert!(after.castling_rights(s2).is_empty());
    }
    // Nothing else happened: no passes, no turns, the winners untouched.
    assert!(!ev.iter().any(|e| matches!(e, GameEvent::Pass { .. })));
    assert_eq!(after.ply(), before.ply());
    for s2 in team.other().seats() {
        assert_eq!(after.status(s2), before.status(s2));
        assert_eq!(after.pieces_of(s2).count(), before.pieces_of(s2).count());
    }
    assert_eq!(draw_voters(after), [false; 4]);
}

#[test]
fn random_resigns_and_draws_obey_the_spec() {
    let mut rng = Rng(0x1234_5678_9abc_def1);
    let mut stats = [0usize; 6];
    for g in 0..400 {
        let mode = if g % 2 == 0 {
            GameMode::Ffa
        } else {
            GameMode::Teams
        };
        let mut s = start(mode);
        for _ in 0..400 {
            if s.is_over() {
                // Probe errors on finished games too.
                let seat = Seat::ALL[rng.below(4)];
                let before = s.clone();
                let r = apply_resign(&mut s, seat);
                check_resign(&before, &s, seat, &r);
                break;
            }
            let roll = rng.below(100);
            if roll < 4 {
                let seat = Seat::ALL[rng.below(4)];
                let before = s.clone();
                let r = apply_resign(&mut s, seat);
                if r.is_ok() {
                    stats[if before.seat_to_move() == seat { 0 } else { 1 }] += 1;
                    if before.status(seat) == SeatStatus::Defeated {
                        stats[2] += 1;
                    }
                } else {
                    stats[3] += 1;
                }
                check_resign(&before, &s, seat, &r);
            } else if roll == 4 && rng.below(4) == 0 {
                let before = s.clone();
                let voters = draw_voters(&before);
                assert!(voters.iter().any(|&v| v));
                assert!(voters[before.seat_to_move().index()]);
                let ev = apply_agreed_draw(&mut s).unwrap();
                assert_eq!(ev.len(), 1);
                let o = ended(&ev).unwrap();
                assert_eq!(s.board(), before.board());
                assert_eq!(s.statuses(), before.statuses());
                match mode {
                    GameMode::Ffa => {
                        assert_eq!(
                            o.result,
                            GameResult::FfaAgreedDraw {
                                survivors: Seat::ALL
                                    .map(|x| before.status(x) == SeatStatus::Active)
                            }
                        );
                        assert_eq!(o.placements, model_ffa_placements(&before));
                    }
                    GameMode::Teams => {
                        assert_eq!(o.result, GameResult::TeamsAgreedDraw);
                        assert_eq!(o.placements, [1; 4]);
                    }
                }
                stats[4] += 1;
            } else {
                let moves = legal_moves(&s);
                let m = moves[rng.below(moves.len())];
                apply_move(&mut s, m).unwrap();
            }
            full_check(&s);
        }
        if s.is_over() {
            stats[5] += 1;
        }
    }
    eprintln!("stats (own, off, defeated, errors, draws, finished) = {stats:?}");
    assert!(stats.iter().all(|&n| n > 0), "{stats:?}");
}
