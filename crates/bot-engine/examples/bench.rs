//! Search speed from the start position.
//!
//! `cargo run --release -p bot-engine --example bench [ms...]`

use bot_engine::{Engine, FfaAlgorithm, SearchConfig, SearchLimits};
use rules_core::{GameConfig, GameMode, GameState};

fn main() {
    let budgets: Vec<u64> = std::env::args()
        .skip(1)
        .filter_map(|a| a.parse().ok())
        .collect();
    let budgets = if budgets.is_empty() {
        vec![100, 500]
    } else {
        budgets
    };
    let cases = [
        ("teams", GameMode::Teams, FfaAlgorithm::BrsPlus),
        ("ffa brs+", GameMode::Ffa, FfaAlgorithm::BrsPlus),
        ("ffa brs", GameMode::Ffa, FfaAlgorithm::Brs),
        ("ffa paranoid", GameMode::Ffa, FfaAlgorithm::Paranoid),
    ];
    for ms in budgets {
        for (name, mode, algo) in cases {
            let state = GameState::new(GameConfig::new(mode)).unwrap();
            let cfg = SearchConfig {
                ffa_algorithm: algo,
                ..SearchConfig::default()
            };
            let mut engine = Engine::new(64);
            let r = engine.search(&state, &SearchLimits::time_ms(ms), &cfg);
            let nps = r.nodes as f64 / (r.time_ms.max(1) as f64 / 1000.0);
            let pv: Vec<String> = r.pv.iter().map(|m| m.to_string()).collect();
            println!(
                "{ms:>4} ms  {name:<13} depth {:>2}  nodes {:>8}  time {:>4} ms  {:>8.0} nps  score {:>6}  pv {}",
                r.depth,
                r.nodes,
                r.time_ms,
                nps,
                r.score,
                pv.join(" ")
            );
        }
    }
}
