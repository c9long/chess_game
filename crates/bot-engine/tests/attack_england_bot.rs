//! Spec-derived attack tests for the bots with England's four Prime
//! Ministers: legality with 1-4 England seats, multi-leader semantics (losing
//! one PM is costly but never terminal; the last one is).

mod common;

use bot_engine::*;
use common::*;
use rules_core::*;

const FFA_ALGOS: [FfaAlgorithm; 3] = [
    FfaAlgorithm::BrsPlus,
    FfaAlgorithm::Brs,
    FfaAlgorithm::Paranoid,
];

fn search(state: &GameState, algo: FfaAlgorithm, limits: &SearchLimits) -> SearchResult {
    let cfg = SearchConfig {
        ffa_algorithm: algo,
        ..SearchConfig::default()
    };
    Engine::new(2).search(state, limits, &cfg)
}

fn england_civs(n: usize) -> [CivId; 4] {
    let mut c = [CivId::Canada; 4];
    for x in c.iter_mut().take(n) {
        *x = CivId::England;
    }
    c
}

/// Every PV move is legal in sequence from the root.
fn assert_pv_legal(state: &GameState, res: &SearchResult, ctx: &str) {
    let mut c = state.clone();
    for (i, &m) in res.pv.iter().enumerate() {
        if c.is_over() {
            break;
        }
        assert!(
            is_generated(&c, m),
            "{ctx}: pv[{i}] {m} illegal in {c} (pv {:?})",
            res.pv
        );
        apply_move(&mut c, m).unwrap();
    }
}

#[test]
fn search_never_returns_illegal_moves_with_one_to_four_englands() {
    for n in 1..=4 {
        let positions = random_positions_with(0xE6_0000 + n as u64, 4, 160, england_civs(n));
        for s in &positions {
            let algos: &[FfaAlgorithm] = if s.mode() == GameMode::Ffa {
                &FFA_ALGOS
            } else {
                &[FfaAlgorithm::BrsPlus]
            };
            for &algo in algos {
                let r = search(s, algo, &SearchLimits::nodes(3_000));
                let m = r.best_move.expect("ongoing game has a move");
                assert!(is_generated(s, m), "n={n} {algo:?}: {m} illegal in {s}");
                assert!(r.score.abs() <= WIN);
                assert_pv_legal(s, &r, &format!("n={n} {algo:?}"));
                for rm in &r.root_moves {
                    assert!(is_generated(s, rm.mv));
                }
            }
        }
    }
}

#[test]
fn level_choice_never_illegal_with_england_seats() {
    for n in 1..=4 {
        let positions = random_positions_with(0xE7_0000 + n as u64, 3, 200, england_civs(n));
        for s in &positions {
            for (i, level) in [Level::L600, Level::L1200, Level::L1800]
                .into_iter()
                .enumerate()
            {
                let r = choose_move(s, level, u64::MAX, 0, 77 + i as u64);
                let m = r.best_move.unwrap();
                assert!(is_generated(s, m), "n={n} {level:?}: {m} illegal in {s}");
            }
        }
    }
}

#[test]
fn full_bot_games_with_four_englands_stay_legal() {
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let mut s = GameState::new(GameConfig::new(mode).with_civs([CivId::England; 4])).unwrap();
        let mut plies = 0;
        while !s.is_over() && plies < 160 {
            let r = choose_move(&s, Level::L900, u64::MAX, 0, plies as u64);
            let m = r.best_move.unwrap();
            assert!(is_generated(&s, m), "{m} illegal in {s}");
            apply_move(&mut s, m).unwrap();
            // An ACTIVE seat always holds a PM; a seat is only out after its last.
            for seat in Seat::ALL {
                if s.status(seat) == SeatStatus::Active {
                    assert!(s.leader_count(seat) >= 1);
                }
            }
            plies += 1;
        }
    }
}

/// A fork of two Prime Ministers costs one of them, never the game: the
/// search must not report a forced loss for England.
#[test]
fn fork_of_two_pms_is_not_scored_as_a_forced_loss() {
    // FFA, only South (England) and West left. West's knight on e5 forks
    // South's PMs on d3 and f7 (e5 reaches d3, f3, c4, g4, c6, g6, d7, f7).
    // South to move can save one PM; West then takes the other.
    let text = format!(
        "ffa {} S AARR - - 0 0 def=Nl,El civ=england.2,canada.1,canada.1,canada.1",
        board_field(&["sMd3", "sMf7", "sRp1", "wNe5", "wKa16", "wRb14"])
    );
    let s = parse_position(&text).unwrap();
    for algo in FFA_ALGOS {
        let r = search(&s, algo, &SearchLimits::depth(3));
        assert!(
            r.score > -MATE_BOUND,
            "{algo:?}: losing one of two PMs scored as a forced loss ({})",
            r.score
        );
    }
}

/// With a single PM left, a hanging PM is a forced loss unless saved: the bot
/// saves it rather than grabbing material.
#[test]
fn last_pm_is_saved_before_grabbing_material() {
    // South (England): PM on c3 attacked by West's rook on c10; a free West
    // bishop sits on g7 for South's rook on g1 to take.
    let text = format!(
        "ffa {} S AARR - - 0 0 def=Nl,El civ=england.2,canada.1,canada.1,canada.1",
        board_field(&["sMc3", "sRg1", "wRc10", "wBg7", "wKa16"])
    );
    let s = parse_position(&text).unwrap();
    for algo in FFA_ALGOS {
        let r = search(&s, algo, &SearchLimits::depth(3));
        let m = r.best_move.unwrap();
        let mut c = s.clone();
        apply_move(&mut c, m).unwrap();
        assert!(
            c.status(Seat::South) == SeatStatus::Active && !leader_under_attack(&c, Seat::South)
                || c.is_over(),
            "{algo:?}: {m} leaves the last PM hanging"
        );
    }
}

/// With spare PMs, a single hanging PM is a material question: the bot may
/// still save it, but the search must not see it as decisive.
#[test]
fn hanging_spare_pm_is_scored_as_material_not_mate() {
    let text = format!(
        "ffa {} W AARR - - 0 0 def=Nl,El civ=england.2,canada.1,canada.1,canada.1",
        board_field(&["sMc3", "sMm2", "sRp1", "wRc10", "wKa16"])
    );
    let s = parse_position(&text).unwrap();
    for algo in FFA_ALGOS {
        let r = search(&s, algo, &SearchLimits::depth(2));
        assert_eq!(r.best_move.unwrap().to_string(), "c10c3", "{algo:?}");
        assert!(r.score < MATE_BOUND, "{algo:?}: {}", r.score);
    }
}

/// Teams: capturing the last PM of an England seat whose partner is out
/// ends the game; the bot finds it.
#[test]
fn teams_bot_takes_the_decisive_last_pm() {
    // South England (one PM on c3) ACTIVE, North DEFEATED by stalemate
    // (status order S W N E); West to move.
    let text = format!(
        "teams {} W AADA - - 0 0 def=Ns civ=england.2,canada.1,canada.1,canada.1",
        board_field(&["sMc3", "sRh4", "wQc8", "wKa9", "nKi16", "eKp9"])
    );
    let s = parse_position(&text).unwrap();
    let cfg = SearchConfig::default();
    let r = Engine::new(2).search(&s, &SearchLimits::depth(2), &cfg);
    assert_eq!(r.best_move.unwrap().to_string(), "c8c3");
    assert!(r.score >= MATE_BOUND, "{}", r.score);
}

/// A spare PM left attacked is a material risk, not a hanging leader: the
/// level filter must not reject a move for it (only the last PM counts).
/// It must still return a legal move when every move leaves some PM attacked.
#[test]
fn level_filter_with_unavoidably_attacked_pm_still_moves_legally() {
    let text = format!(
        "ffa {} S AARR - - 0 0 def=Nl,El civ=england.2,canada.1,canada.1,canada.1",
        board_field(&["sMd3", "sMf7", "sRp1", "wNe5", "wKa16", "wRb14"])
    );
    let s = parse_position(&text).unwrap();
    for seed in 0..20 {
        let r = choose_move(&s, Level::L600, u64::MAX, 0, seed);
        assert!(is_generated(&s, r.best_move.unwrap()));
    }
}

/// With a spare PM attacked, taking a free queen does not "hang the leader":
/// the level filter, fillers and fallback only guard the last leader.
#[test]
fn attacked_spare_pm_does_not_count_as_a_hanging_leader() {
    let text = format!(
        "ffa {} S AARR - - 0 0 def=Nl,El civ=england.2,canada.1,canada.1,canada.1",
        board_field(&["sMc3", "sMm2", "sRp1", "wRc10", "wQp9", "wKa16"])
    );
    let s = parse_position(&text).unwrap();
    assert!(leader_under_attack(&s, Seat::South));
    assert!(!move_hangs_leader(&s, mv("p1p9")));
    let flagged = legal_moves(&s)
        .into_iter()
        .filter(|&m| move_hangs_leader(&s, m))
        .count();
    assert_eq!(
        flagged, 0,
        "no move hangs a leader while a spare PM remains"
    );

    // With the spare gone, leaving the last PM attacked does hang it.
    let text = format!(
        "ffa {} S AARR - - 0 0 def=Nl,El civ=england.2,canada.1,canada.1,canada.1",
        board_field(&["sMc3", "sRp1", "wRc10", "wQp9", "wKa16"])
    );
    let s = parse_position(&text).unwrap();
    assert!(move_hangs_leader(&s, mv("p1p9")));
    for seed in 0..10 {
        let m = choose_move(&s, Level::L600, u64::MAX, 0, seed)
            .best_move
            .unwrap();
        assert!(!move_hangs_leader(&s, m), "seed {seed}: {m}");
    }
}
