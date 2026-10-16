//! Adversarial tests for the Teams resignation (the whole team resigns once
//! the server collected the partner's consent): every reachable status
//! combination (ACTIVE / DEFEATED-still-playing / FROZEN for each seat, with
//! each team keeping an ACTIVE seat), every resigning seat and every seat to
//! move; plus FFA staying a single-seat resignation.

mod common;

use common::*;
use rules_core::*;

fn letter(st: char, seat: char) -> Vec<String> {
    // Pieces per seat status: ACTIVE has a king and a rook, DEFEATED only a
    // rook (lost its leader), FROZEN a king and a rook.
    let (k, r) = match seat {
        's' => ("sKg1", "sRa1"),
        'w' => ("wKa7", "wRa4"),
        'n' => ("nKg12", "nRl12"),
        _ => ("eKl7", "eRl4"),
    };
    match st {
        'A' | 'F' => vec![k.to_string(), r.to_string()],
        _ => vec![r.to_string()],
    }
}

fn ended(ev: &[GameEvent]) -> Option<Outcome> {
    ev.iter().find_map(|e| match e {
        GameEvent::GameEnded { outcome } => Some(*outcome),
        _ => None,
    })
}

#[test]
fn teams_resign_from_every_status_combination() {
    let seats = ['s', 'w', 'n', 'e'];
    let seat_up = ['S', 'W', 'N', 'E'];
    let statuses = ['A', 'D', 'F'];
    let mut checked = 0usize;
    for combo in 0..81usize {
        let st: Vec<char> = (0..4)
            .map(|i| statuses[(combo / 3usize.pow(i)) % 3])
            .collect();
        // Each team (S+N = 0,2; W+E = 1,3) needs an ACTIVE seat.
        if !(st[0] == 'A' || st[2] == 'A') || !(st[1] == 'A' || st[3] == 'A') {
            continue;
        }
        let mut pieces: Vec<String> = Vec::new();
        let mut defs: Vec<String> = Vec::new();
        for i in 0..4 {
            pieces.extend(letter(st[i], seats[i]));
            match st[i] {
                'D' => defs.push(format!("{}l", seat_up[i])),
                'F' => defs.push(format!("{}t", seat_up[i])),
                _ => {}
            }
        }
        let p: Vec<&str> = pieces.iter().map(String::as_str).collect();
        let stat: String = st.iter().collect();
        for to_move in 0..4 {
            if st[to_move] == 'F' {
                continue;
            }
            let def = if defs.is_empty() {
                String::new()
            } else {
                format!(" def={}", defs.join(","))
            };
            let rest = format!("{} {stat} - - 0 0{def}", seat_up[to_move]);
            let base = build("teams", &p, &rest);
            check_invariants(&base);
            for (i, seat) in Seat::ALL.into_iter().enumerate() {
                let mut s = base.clone();
                let res = apply_resign(&mut s, seat);
                if st[i] == 'F' {
                    assert_eq!(res, Err(RulesError::SeatNotInPlay(seat)), "{base}");
                    assert_eq!(s, base);
                    continue;
                }
                let ev = res.unwrap_or_else(|e| panic!("{e} for {seat} in {base}"));
                let o = ended(&ev).unwrap_or_else(|| panic!("no end for {seat} in {base}"));
                let loser = seat.team();
                assert_eq!(
                    o.result,
                    GameResult::TeamsWinner {
                        team: loser.other()
                    },
                    "{base}"
                );
                for s2 in Seat::ALL {
                    let want = if s2.team() == loser { 2 } else { 1 };
                    assert_eq!(o.placements[s2.index()], want, "{seat} in {base}");
                    if s2.team() == loser {
                        assert!(!s.takes_turns(s2));
                        assert_eq!(s.pieces_of(s2).count(), 0, "loser pieces stay in {s}");
                    } else {
                        assert_eq!(s.status(s2), base.status(s2), "winner status changed");
                        assert_eq!(s.defeats().reason(s2), base.defeats().reason(s2));
                    }
                }
                // Resign reasons: every team seat that still took turns (ACTIVE or
                // DEFEATED still playing) is now recorded as resigned; a FROZEN
                // partner (it did not vote) keeps its record. The defeat order
                // keeps the earlier defeats first.
                for s2 in [seat, seat.partner()] {
                    let before = base.status(s2);
                    let want = if before == SeatStatus::Frozen {
                        base.defeats().reason(s2)
                    } else {
                        Some(DefeatReason::Resign)
                    };
                    assert_eq!(s.defeats().reason(s2), want, "{s2} in {base}");
                }
                let order_before: Vec<Seat> = base.defeats().iter().map(|r| r.seat).collect();
                let order_after: Vec<Seat> = s.defeats().iter().map(|r| r.seat).collect();
                assert_eq!(&order_after[..order_before.len()], &order_before[..]);
                for (a, e) in ev.iter().enumerate() {
                    assert!(!ev[a + 1..].contains(e), "duplicate event {e:?}");
                }
                check_invariants(&s);
                // Round trip of the finished position.
                let back = GameState::from_position_string(&s.to_position_string()).unwrap();
                assert_eq!(back, s);
                // Nothing applies after the end.
                for s2 in Seat::ALL {
                    let mut c = s.clone();
                    assert_eq!(apply_resign(&mut c, s2), Err(RulesError::GameOver));
                    assert_eq!(apply_abandon(&mut c, s2), Err(RulesError::GameOver));
                }
                checked += 1;
            }
        }
    }
    assert!(checked > 100, "only {checked} cases");
}

#[test]
fn ffa_resign_is_still_single_seat() {
    let mut s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    let ev = apply_resign(&mut s, Seat::North).unwrap();
    assert!(!s.is_over());
    assert_eq!(s.status(Seat::North), SeatStatus::Removed);
    assert_eq!(s.status(Seat::South), SeatStatus::Active);
    assert!(ended(&ev).is_none());
    check_invariants(&s);
}
