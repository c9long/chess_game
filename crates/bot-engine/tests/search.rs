//! Search behaviour tests: tactics, Teams sign handling, limits, levels,
//! determinism and legality.

mod common;

use std::time::Instant;

use bot_engine::*;
use common::*;
use rules_core::apply::apply_null_move;
use rules_core::*;

const FFA_ALGOS: [FfaAlgorithm; 3] = [
    FfaAlgorithm::BrsPlus,
    FfaAlgorithm::Brs,
    FfaAlgorithm::Paranoid,
];
const STRONG: [Level; 5] = [
    Level::L1500,
    Level::L1800,
    Level::L2100,
    Level::L2400,
    Level::Max,
];

fn search(state: &GameState, algo: FfaAlgorithm, limits: SearchLimits) -> SearchResult {
    let cfg = SearchConfig {
        ffa_algorithm: algo,
        ..SearchConfig::default()
    };
    Engine::new(4).search(state, &limits, &cfg)
}

fn best(r: &SearchResult) -> String {
    r.best_move.map(|m| m.to_string()).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Leader capture in one
// ---------------------------------------------------------------------------

#[test]
fn ffa_leader_capture_in_one_wins_the_game() {
    // Only South and West remain: taking West's king ends the game.
    let s = build(
        "ffa",
        &["sKg1", "sRa2", "sPe2", "wKa7", "wNd8", "wPc5"],
        "S AARR - - 0 0 def=Nl,El",
    );
    for algo in FFA_ALGOS {
        let r = search(&s, algo, SearchLimits::depth(3));
        assert_eq!(best(&r), "a2a7", "{algo:?}");
        assert!(r.score >= MATE_BOUND, "{algo:?} score {}", r.score);
    }
}

#[test]
fn ffa_leader_capture_preferred_over_queen_capture() {
    let s = build(
        "ffa",
        &[
            "sKg1", "sRa2", "sNe4", "sPe2", "sPf2", "wKa7", "wPb5", "nKg12", "nQf6", "nPg10",
            "eKl7", "eRk4",
        ],
        "S AAAA - - 0 0",
    );
    for algo in FFA_ALGOS {
        for depth in 1..=3 {
            let r = search(&s, algo, SearchLimits::depth(depth));
            assert_eq!(best(&r), "a2a7", "{algo:?} depth {depth}");
        }
    }
}

#[test]
fn teams_leader_capture_in_one_wins_for_the_team() {
    // West is frozen, so East holds the West+East team's only leader.
    let s = build(
        "teams",
        &["sKg1", "sRl2", "sPe2", "wKa7", "nKg12", "eKl7", "eQd5"],
        "S AFAA - - 0 0 def=Wt",
    );
    let r = search(&s, FfaAlgorithm::default(), SearchLimits::depth(3));
    assert_eq!(best(&r), "l2l7");
    assert_eq!(r.score, WIN - 1);
}

// ---------------------------------------------------------------------------
// Leader safety
// ---------------------------------------------------------------------------

/// South's king can grab a knight on h2, but West's rook on h12 (West moves
/// right after South) would then capture the king.
fn poisoned_knight(mode: &str) -> GameState {
    let bait = if mode == "ffa" { "nNh2" } else { "eNh2" };
    build(
        mode,
        &[
            "sKg1", "sNb1", "sPd2", "sPe2", "sPf2", "sPg2", bait, "wRh12", "wKa7", "nKe11", "eKl7",
        ],
        "S AAAA - - 0 0",
    )
}

#[test]
fn strong_levels_never_move_into_immediate_leader_capture() {
    let king_grab = mv("g1h2");
    for mode in ["ffa", "teams"] {
        let s = poisoned_knight(mode);
        assert!(is_generated(&s, king_grab));
        assert!(move_hangs_leader(&s, king_grab));
        for level in STRONG {
            for seed in 0..3 {
                let r = choose_move(&s, level, 60_000, 0, seed);
                let m = r.best_move.unwrap();
                assert!(is_generated(&s, m));
                assert_ne!(m, king_grab, "{mode} {level:?} seed {seed}");
                assert!(
                    !move_hangs_leader(&s, m),
                    "{mode} {level:?} seed {seed}: {m}"
                );
            }
        }
    }
}

#[test]
fn every_algorithm_avoids_the_poisoned_knight() {
    let s = poisoned_knight("ffa");
    for algo in FFA_ALGOS {
        for depth in 1..=3 {
            let r = search(&s, algo, SearchLimits::depth(depth));
            assert_ne!(best(&r), "g1h2", "{algo:?} depth {depth}");
        }
    }
    let t = poisoned_knight("teams");
    for depth in 1..=4 {
        let r = search(&t, FfaAlgorithm::default(), SearchLimits::depth(depth));
        assert_ne!(best(&r), "g1h2", "teams depth {depth}");
    }
}

/// West's rook on a1 attacks South's king on g1 along the first rank and
/// West moves next (a 2-ply threat). South can block (bishop or knight to
/// c1/e1), step into the h2 luft, or greedily grab a rook on b6 with its d5
/// knight. (Without the luft, deep Teams searches correctly see the back rank
/// as lost anyway and take the rook, which made the test depend on speed.)
fn threatened_king(mode: &str) -> GameState {
    let bait = if mode == "ffa" { "nRb6" } else { "eRb6" };
    build(
        mode,
        &[
            "sKg1", "sPf2", "sPg2", "sPh3", "sBe3", "sNd3", "sNd5", "wRa1", "wKa9", bait, "nKd12",
            "eKl7",
        ],
        "S AAAA - - 0 0",
    )
}

#[test]
fn prevents_two_ply_leader_capture_threat() {
    for mode in ["ffa", "teams"] {
        let s = threatened_king(mode);
        assert!(leader_under_attack(&s, Seat::South));
        assert!(move_hangs_leader(&s, mv("d5b6")));
        for level in STRONG {
            for seed in 0..3 {
                let m = choose_move(&s, level, 60_000, 0, seed).best_move.unwrap();
                assert!(
                    !move_hangs_leader(&s, m),
                    "{mode} {level:?} seed {seed} hangs the leader with {m}"
                );
            }
        }
        if mode == "ffa" {
            for algo in FFA_ALGOS {
                for depth in 1..=3 {
                    let r = search(&s, algo, SearchLimits::depth(depth));
                    let m = r.best_move.unwrap();
                    assert!(!move_hangs_leader(&s, m), "{algo:?} depth {depth}: {m}");
                    assert!(r.score > -MATE_BOUND, "{algo:?} depth {depth}");
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Teams sign handling with a frozen seat
// ---------------------------------------------------------------------------

#[test]
fn teams_same_team_twice_south_then_north() {
    // West is frozen: order South, North, East. South's bishop on l9 blocks
    // North's rook from East's king (East is West+East's last leader). Moving
    // the bishop lets North (South's partner, moving next) win at once. A
    // sign error between the two same-team plies would prefer Nxg7 (queen).
    let s = build(
        "teams",
        &[
            "sKg1", "sBl9", "sNh5", "sPd2", "wKa7", "wQa5", "nKg12", "nRl12", "eKl7", "eQg7",
        ],
        "S AFAA - - 0 0 def=Wt",
    );
    for depth in 2..=4 {
        let r = search(&s, FfaAlgorithm::default(), SearchLimits::depth(depth));
        let m = r.best_move.unwrap();
        assert_eq!(m.from.to_string(), "l9", "depth {depth}: {m}");
        assert_eq!(r.score, WIN - 2, "depth {depth}");
        // The PV shows North's winning capture right after.
        assert_eq!(r.pv.get(1).map(|m| m.to_string()).as_deref(), Some("l12l7"));
    }
    let r = choose_move(&s, Level::Max, 60_000, 0, 1);
    assert_eq!(r.best_move.unwrap().from.to_string(), "l9");
}

#[test]
fn teams_same_team_twice_east_then_west() {
    // Mirror for the other team: South is frozen, order East, West, North.
    let s = build(
        "teams",
        &[
            "sKg1", "eBd12", "eNf5", "eKl7", "ePk5", "wKa7", "wRa12", "nKg12", "nQh4",
        ],
        "E FAAA - - 0 0 def=St",
    );
    for depth in 2..=4 {
        let r = search(&s, FfaAlgorithm::default(), SearchLimits::depth(depth));
        let m = r.best_move.unwrap();
        assert_eq!(m.from.to_string(), "d12", "depth {depth}: {m}");
        assert_eq!(r.score, WIN - 2, "depth {depth}");
    }
}

#[test]
fn teams_frozen_seat_threat_is_parried() {
    // East is frozen: order South, West, North, then South again (North and
    // South move back to back). West's rook threatens South's king; North
    // cannot help in time, so South must defend itself.
    let s = build(
        "teams",
        &[
            "sKg1", "sPf2", "sPg2", "sNd5", "wRa1", "wKa7", "nKd12", "eKl7", "eQe7",
        ],
        "S AAAF - - 0 0 def=Et",
    );
    for depth in 1..=4 {
        let m = search(&s, FfaAlgorithm::default(), SearchLimits::depth(depth))
            .best_move
            .unwrap();
        assert!(!move_hangs_leader(&s, m), "depth {depth}: {m}");
    }
}

// ---------------------------------------------------------------------------
// Move limit
// ---------------------------------------------------------------------------

#[test]
fn ahead_side_avoids_the_move_limit_tie() {
    // One turn before the limit (99 of 100): any quiet piece move ends the
    // game in a four-way tie; a pawn move resets the counter.
    let s = build(
        "ffa",
        &["sKg1", "sQf4", "sRc3", "sPe2", "wKa7", "nKg12", "eKl7"],
        "S AAAA - - 99 400",
    );
    for algo in FFA_ALGOS {
        let r = search(&s, algo, SearchLimits::depth(2));
        let m = r.best_move.unwrap();
        assert_eq!(m.from.to_string(), "e2", "{algo:?}: {m}");
    }
}

// ---------------------------------------------------------------------------
// Limits, levels, determinism
// ---------------------------------------------------------------------------

#[test]
fn single_legal_move_is_returned_immediately() {
    // Partner knights box South's king in: the only move is a1b2.
    let s = build(
        "teams",
        &["sKa1", "nNa2", "nNb1", "nKg12", "wKa7", "eKl7"],
        "S AAAA - - 0 0",
    );
    assert_eq!(legal_moves(&s).len(), 1);
    let r = Engine::new(1).search(&s, &SearchLimits::depth(5), &SearchConfig::default());
    assert_eq!(best(&r), "a1b2");
    for level in Level::ALL {
        let r = choose_move(&s, level, 1_000, 0, 9);
        assert_eq!(best(&r), "a1b2", "{level:?}");
        assert_eq!(r.depth, 0);
        assert!(r.time_ms < 50, "{level:?}: {} ms", r.time_ms);
    }
}

#[test]
fn deterministic_with_fixed_seed() {
    let ffa = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    let teams = GameState::new(GameConfig::new(GameMode::Teams)).unwrap();
    for s in [&ffa, &teams] {
        for level in [Level::L600, Level::L900, Level::L1200] {
            for seed in [1u64, 2, 3] {
                let a = choose_move(s, level, u64::MAX, 0, seed);
                let b = choose_move(s, level, u64::MAX, 0, seed);
                assert_eq!(a.best_move, b.best_move);
                assert_eq!(a.score, b.score);
                assert_eq!(a.nodes, b.nodes);
                assert_eq!(a.pv, b.pv);
            }
        }
        // Node-limited engine searches are reproducible too.
        for algo in FFA_ALGOS {
            let a = search(s, algo, SearchLimits::nodes(4_000));
            let b = search(s, algo, SearchLimits::nodes(4_000));
            assert_eq!(
                (a.best_move, a.score, a.nodes),
                (b.best_move, b.score, b.nodes)
            );
        }
    }
    // Different seeds give a weak bot some variety.
    let moves: std::collections::BTreeSet<String> = (0..24)
        .map(|seed| best(&choose_move(&ffa, Level::L600, u64::MAX, 0, seed)))
        .collect();
    assert!(moves.len() >= 2, "{moves:?}");
}

#[test]
fn respects_deadlines() {
    let slack_ms = 60; // debug builds check the clock every 256 nodes
    let ffa = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    let teams = GameState::new(GameConfig::new(GameMode::Teams)).unwrap();
    for s in [&ffa, &teams] {
        for algo in FFA_ALGOS {
            let t0 = Instant::now();
            let r = search(s, algo, SearchLimits::time_ms(40));
            let wall = t0.elapsed().as_millis() as u64;
            assert!(wall <= 40 + slack_ms, "{algo:?} took {wall} ms");
            assert!(r.best_move.is_some());
        }
        // Low clock: the budget is a small fraction of it.
        let budget = time_budget_ms(Level::Max, 1_500, 0);
        assert_eq!(budget, 50);
        let t0 = Instant::now();
        let r = choose_move(s, Level::Max, 1_500, 0, 5);
        let wall = t0.elapsed().as_millis() as u64;
        assert!(wall <= budget + slack_ms, "took {wall} ms of {budget}");
        assert!(r.time_ms <= wall);
        assert!(is_generated(s, r.best_move.unwrap()));
    }
}

#[test]
fn weak_levels_are_fast() {
    let s = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    // Unoptimised builds running the other tests in parallel are several
    // times slower (more so on the 16×16 board, where 1200's 3k nodes take
    // ~300 ms on a loaded machine); the release run keeps the tight bound.
    let slack_ms = if cfg!(debug_assertions) { 600 } else { 60 };
    for level in [Level::L600, Level::L900, Level::L1200] {
        let r = choose_move(&s, level, u64::MAX, 0, 3);
        assert!(r.nodes <= level.params().max_nodes + 1);
        assert!(
            r.time_ms <= level.params().target_ms + slack_ms,
            "{level:?}: {} ms",
            r.time_ms
        );
    }
}

#[test]
fn finished_game_returns_no_move() {
    let s = build("ffa", &["sKg1", "sRa2", "wKa7"], "S AARR - - 0 0 def=Nl,El");
    let mut s2 = s.clone();
    apply_move(&mut s2, mv("a2a7")).unwrap();
    assert!(s2.is_over());
    let r = choose_move(&s2, Level::Max, 60_000, 0, 0);
    assert_eq!(r.best_move, None);
}

// ---------------------------------------------------------------------------
// Legality fuzz
// ---------------------------------------------------------------------------

fn check_result(s: &GameState, r: &SearchResult, ctx: &str) {
    let m = r
        .best_move
        .unwrap_or_else(|| panic!("{ctx}: no move in {s}"));
    assert!(is_generated(s, m), "{ctx}: illegal {m} in {s}");
    // The PV is a playable line.
    let mut c = s.clone();
    for (i, pm) in r.pv.iter().enumerate() {
        if c.is_over() {
            break;
        }
        assert!(
            apply_move(&mut c, *pm).is_ok(),
            "{ctx}: pv move {i} {pm} illegal (pv {:?}) in {s}",
            r.pv
        );
    }
}

fn fuzz(seed: u64, per_mode: usize, nodes: u64) {
    for (i, s) in random_positions(seed, per_mode, 160).iter().enumerate() {
        let algos: &[FfaAlgorithm] = if s.mode() == GameMode::Ffa {
            &FFA_ALGOS
        } else {
            &[FfaAlgorithm::BrsPlus]
        };
        for &algo in algos {
            let r = search(s, algo, SearchLimits::nodes(nodes));
            check_result(s, &r, &format!("pos {i} {algo:?}"));
        }
        let level = Level::ALL[i % 3];
        let r = choose_move(s, level, u64::MAX, 0, seed ^ i as u64);
        check_result(s, &r, &format!("pos {i} {level:?}"));
    }
}

#[test]
fn never_returns_an_illegal_move() {
    fuzz(0xF00D, 12, 600);
}

#[test]
#[ignore = "long; run with --release -- --ignored"]
fn never_returns_an_illegal_move_long() {
    for seed in 0..8 {
        fuzz(seed, 60, 5_000);
    }
}

// ---------------------------------------------------------------------------
// Null-move helper (rules-core)
// ---------------------------------------------------------------------------

#[test]
fn null_move_passes_the_turn() {
    // En passant is off from rules version 3; turn it on to see the target
    // expire.
    let mut config = GameConfig::new(GameMode::Ffa);
    config.en_passant_enabled = true;
    let mut s = GameState::new(config).unwrap();
    apply_move(&mut s, mv("e2e4")).unwrap(); // South double-step: target e3
    assert!(s.ep_target(Seat::South).is_some());
    let mut ev = Vec::new();
    apply_null_move(&mut s, &mut ev); // West passes
    assert_eq!(s.seat_to_move(), Seat::North);
    assert_eq!(s.no_progress(), 1);
    apply_null_move(&mut s, &mut ev); // North
    apply_null_move(&mut s, &mut ev); // East; the turn reaches South again
    assert_eq!(s.seat_to_move(), Seat::South);
    assert!(s.ep_target(Seat::South).is_none());
    assert_eq!(s.hash(), rules_core::zobrist::compute_hash(&s));

    // At the limit, a pass ends the game like any other turn.
    let mut t = build("ffa", &["sKg1", "wKa7", "nKg12", "eKl7"], "S AAAA - - 99 0");
    apply_null_move(&mut t, &mut ev);
    assert!(t.is_over());
}
