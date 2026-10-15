//! Mini arena for comparing FFA algorithms and strength levels (the real
//! tournament and calibration tool will be `bot-arena`).
//!
//! `cargo run --release -p bot-engine --example arena -- <ffa|teams> <games> <budget> <A> <B> [threads]`
//!
//! Players: `brs+`, `brs`, `paranoid` (engine search with `<budget>`:
//! milliseconds per move like `50`, or nodes like `20000n`), or a level
//! `600` .. `2400` / `max` (`choose_move` with a 10-minute clock; `<budget>`
//! is ignored). Two seats play A and two play B: in FFA four seat patterns
//! (opposite and adjacent, both ways round), in Teams A and B each take both
//! teams. Every group of patterns starts from the same random opening.
//! Placement points: 1st = 3, 2nd = 2, 3rd = 1, 4th = 0 (ties share the
//! average), so in Teams a win is worth 3 per seat and a draw 2.

use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use bot_engine::{Engine, FfaAlgorithm, Level, Rng, SearchConfig, SearchLimits, choose_move};
use rules_core::{
    GameConfig, GameMode, GameResult, GameState, Move, Seat, apply_move, legal_moves,
};

#[derive(Clone, Copy, Debug)]
enum Player {
    Algo(FfaAlgorithm),
    Level(Level),
}

fn player(s: &str) -> Player {
    match s {
        "brs+" => Player::Algo(FfaAlgorithm::BrsPlus),
        "brs" => Player::Algo(FfaAlgorithm::Brs),
        "paranoid" => Player::Algo(FfaAlgorithm::Paranoid),
        other => Player::Level(
            Level::from_label(other).unwrap_or_else(|| panic!("unknown player {other}")),
        ),
    }
}

#[derive(Default, Clone, Copy)]
struct Tally {
    points: [f64; 2],
    firsts: [f64; 2],
    games: u32,
    move_limit: u32,
    plies: u64,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = match args.first().map(String::as_str) {
        Some("teams") => GameMode::Teams,
        _ => GameMode::Ffa,
    };
    let games: usize = args.get(1).and_then(|a| a.parse().ok()).unwrap_or(48);
    let budget = args.get(2).cloned().unwrap_or_else(|| "50".into());
    let players = [
        player(args.get(3).map_or("brs+", String::as_str)),
        player(args.get(4).map_or("paranoid", String::as_str)),
    ];
    let threads: usize = args.get(5).and_then(|a| a.parse().ok()).unwrap_or(12);
    let limits = || {
        if let Some(n) = budget.strip_suffix('n') {
            SearchLimits::nodes(n.parse().unwrap())
        } else {
            SearchLimits::time_ms(budget.parse().unwrap())
        }
    };
    // Seat patterns: which seats play A (index 0); others play B.
    let patterns: &[[usize; 4]] = match mode {
        GameMode::Ffa => &[[0, 1, 0, 1], [1, 0, 1, 0], [0, 0, 1, 1], [1, 1, 0, 0]],
        GameMode::Teams => &[[0, 1, 0, 1], [1, 0, 1, 0]],
    };
    let next = AtomicUsize::new(0);
    let tally = Mutex::new(Tally::default());
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                let mut engines = [Engine::new(16), Engine::new(16)];
                loop {
                    let g = next.fetch_add(1, Ordering::Relaxed);
                    if g >= games {
                        break;
                    }
                    let pattern = patterns[g % patterns.len()];
                    let group = (g / patterns.len()) as u64;
                    let mut rng = Rng::new(group + 1000);
                    let mut s = GameState::new(GameConfig::new(mode)).unwrap();
                    // Random opening (same for every pattern of a group).
                    let opening = 4 + rng.below(5);
                    for _ in 0..opening {
                        if s.is_over() {
                            break;
                        }
                        let moves = legal_moves(&s);
                        let m = moves[rng.below(moves.len() as u64) as usize];
                        apply_move(&mut s, m).unwrap();
                    }
                    for e in engines.iter_mut() {
                        e.clear();
                    }
                    let mut plies = 0u64;
                    while !s.is_over() && plies < 2000 {
                        let seat = s.seat_to_move();
                        let side = pattern[seat.index()];
                        let mv: Move = match players[side] {
                            Player::Algo(algo) => {
                                let cfg = SearchConfig {
                                    ffa_algorithm: algo,
                                    ..SearchConfig::default()
                                };
                                engines[side].search(&s, &limits(), &cfg).best_move.unwrap()
                            }
                            Player::Level(level) => {
                                let seed = group * 1_000_003 + plies;
                                choose_move(&s, level, 600_000, 0, seed).best_move.unwrap()
                            }
                        };
                        apply_move(&mut s, mv).unwrap();
                        plies += 1;
                    }
                    let Some(o) = s.outcome().copied() else {
                        continue;
                    };
                    let mut pts = [0.0f64; 2];
                    let mut firsts = [0.0f64; 2];
                    for seat in Seat::ALL {
                        let place = o.placement(seat) as usize;
                        let tied = Seat::ALL
                            .iter()
                            .filter(|&&x| o.placement(x) == o.placement(seat))
                            .count();
                        let p: f64 = (place..place + tied).map(|q| (4 - q) as f64).sum::<f64>()
                            / tied as f64;
                        pts[pattern[seat.index()]] += p;
                        if place == 1 {
                            firsts[pattern[seat.index()]] += 1.0 / tied as f64;
                        }
                    }
                    let mut t = tally.lock().unwrap();
                    t.games += 1;
                    t.plies += plies;
                    if matches!(
                        o.result,
                        GameResult::FfaMoveLimitTie { .. } | GameResult::TeamsDraw
                    ) {
                        t.move_limit += 1;
                    }
                    for i in 0..2 {
                        t.points[i] += pts[i];
                        t.firsts[i] += firsts[i];
                    }
                    eprintln!(
                        "game {g:>3} pattern {:?}: placements {:?} plies {plies}",
                        pattern, o.placements
                    );
                }
            });
        }
    });
    let t = *tally.lock().unwrap();
    let n = f64::from(t.games.max(1));
    println!(
        "{} {} games, avg {:.0} plies, {} move-limit endings",
        t.games,
        mode.name(),
        t.plies as f64 / n,
        t.move_limit
    );
    for (i, label) in ["A", "B"].iter().enumerate() {
        println!(
            "{label} {:?}: {:.1} pts ({:.2}/seat-game), first places {:.1}",
            players[i],
            t.points[i],
            t.points[i] / (2.0 * n),
            t.firsts[i]
        );
    }
}
