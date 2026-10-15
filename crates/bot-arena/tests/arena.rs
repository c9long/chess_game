//! End-to-end tests of the arena library: schedules, parallel play,
//! reproducibility, logs, records and ratings.

use std::collections::HashMap;

use bot_arena::game::{
    GameOptions, GameRecord, GameSpec, TimeControl, opening_position, play_game,
};
use bot_arena::player::{Mover, PlayerSpec};
use bot_arena::rating::{comparisons, fit_ladder};
use bot_arena::run::{RunSetup, run_games};
use bot_arena::schedule::Scheduler;
use bot_arena::{group_samples, report};
use rules_core::GameMode;

// Tiny budgets keep the debug-build tests fast.
fn players() -> Vec<PlayerSpec> {
    vec![
        PlayerSpec::parse("brs+:nodes=60:q=2:name=a").unwrap(),
        PlayerSpec::parse("paranoid:nodes=150:q=2:name=b").unwrap(),
    ]
}

fn opts(mode: GameMode, log: bool) -> GameOptions {
    GameOptions {
        mode,
        tc: TimeControl::Untimed,
        seed: 7,
        opening: (1, 2),
        start: None,
        log,
    }
}

fn run(mode: GameMode, games: usize, threads: usize) -> Vec<GameRecord> {
    let players = players();
    let mut sched = Scheduler::new();
    sched.add_match(mode, 0, 1, games);
    let setup = RunSetup {
        players: &players,
        opts: opts(mode, false),
        threads,
        run: "test".into(),
        log: None,
        out: None,
        verbose: false,
    };
    run_games(&setup, &sched.games, |_| false).unwrap()
}

fn check_record(r: &GameRecord) {
    assert_ne!(r.result, "unfinished", "{r:?}");
    assert!(r.placements.iter().all(|&p| (1..=4).contains(&p)));
    assert!(r.placements.contains(&1));
    let total_moves: u32 = r.stats.iter().map(|s| s.moves).sum();
    assert!(total_moves <= r.plies, "{r:?}");
    if r.mode == "teams" {
        assert_eq!(r.placements[0], r.placements[2]);
        assert_eq!(r.placements[1], r.placements[3]);
    }
}

#[test]
fn ffa_match_is_complete_and_balanced() {
    let a = run(GameMode::Ffa, 6, 6);
    assert_eq!(a.len(), 6);
    for (i, r) in a.iter().enumerate() {
        assert_eq!(r.index, i);
        assert_eq!(r.group, 0);
        check_record(r);
        // A and B hold two seats each.
        assert_eq!(r.players.iter().filter(|p| *p == "a").count(), 2);
    }
    // Every player sits in every seat equally often.
    for seat in 0..4 {
        assert_eq!(a.iter().filter(|r| r.players[seat] == "a").count(), 3);
    }
    // All games of a group share the opening.
    assert!(a.iter().all(|r| r.opening == a[0].opening));
}

#[test]
fn same_seed_same_games_whatever_the_thread_count() {
    let key = |r: &GameRecord| (r.players.clone(), r.placements, r.result.clone(), r.plies);
    let a = run(GameMode::Teams, 4, 4);
    let b = run(GameMode::Teams, 4, 1);
    assert_eq!(
        a.iter().map(key).collect::<Vec<_>>(),
        b.iter().map(key).collect::<Vec<_>>()
    );
}

#[test]
fn teams_match_and_record_roundtrip() {
    let recs = run(GameMode::Teams, 4, 2);
    assert_eq!(recs.len(), 4);
    for r in &recs {
        check_record(r);
        let line = serde_json::to_string(r).unwrap();
        let back: GameRecord = serde_json::from_str(&line).unwrap();
        assert_eq!(&back, r);
    }
    // Two groups with different openings.
    assert_ne!(recs[0].opening, recs[2].opening);
    // Teams comparisons are only across teams: 4 per game.
    let index: HashMap<String, usize> = [("a".to_string(), 0), ("b".to_string(), 1)].into();
    assert!(recs.iter().all(|r| comparisons(r, &index).len() == 4));
    let ladder = fit_ladder(&recs, &["a".into(), "b".into()], (0, 0.0), 50, 1);
    assert!(ladder.connected);
    assert!(ladder.rating.iter().all(|x| x.is_finite()));
    let text = report::ladder_table(&ladder) + &report::seat_bias(&recs);
    assert!(text.contains("South+North wins"));
    // Each Teams group yields one SPRT sample.
    assert_eq!(group_samples(&recs, "a", "b", 2).len(), 2);
}

#[test]
fn opening_is_whole_rounds() {
    for group in 0..6 {
        let (s, moves) = opening_position(&opts(GameMode::Ffa, false), group).unwrap();
        assert!(moves.len() == 4 || moves.len() == 8, "{moves:?}");
        assert_eq!(s.ply() as usize, moves.len());
    }
}

#[test]
fn log_has_headers_and_moves() {
    let players = players();
    let spec = GameSpec {
        index: 0,
        group: 0,
        seats: [0, 1, 0, 1],
    };
    let mut movers: [Mover; 4] = Default::default();
    let (rec, text) = play_game(
        &spec,
        &players,
        &opts(GameMode::Ffa, true),
        &mut movers,
        "t",
    )
    .unwrap();
    let text = text.unwrap();
    assert!(text.contains("[Mode \"ffa\"]"));
    assert!(text.contains(&format!("[Result \"{}\"]", rec.result)));
    assert!(text.contains("[South \"brs+:nodes=60:q=2:name=a\"]"));
    // One line per bot turn after the opening (automatic passes are events
    // on the preceding line), ending with the game-end event.
    let turns = text.lines().filter(|l| l.contains(". ")).count() as u32;
    let moves: u32 = rec.stats.iter().map(|s| s.moves).sum();
    assert_eq!(turns, moves);
    assert!(text.contains("end["));
}

#[test]
fn simulated_clock_flags_players() {
    let players = players();
    let spec = GameSpec {
        index: 0,
        group: 0,
        seats: [0, 1, 0, 1],
    };
    let mut o = opts(GameMode::Teams, false);
    // No time at all: South, West and North flag in turn; South+North then
    // have no ACTIVE seat and West+East win.
    o.tc = TimeControl::Clock {
        base_ms: 0,
        inc_ms: 0,
    };
    let mut movers: [Mover; 4] = Default::default();
    let (rec, _) = play_game(&spec, &players, &o, &mut movers, "t").unwrap();
    assert_eq!(rec.result, "teams_winner");
    assert_eq!(rec.placements, [2, 1, 2, 1]);
    assert!(rec.stats[0].timeout && rec.stats[1].timeout && rec.stats[2].timeout);
    assert!(!rec.stats[3].timeout);
}
