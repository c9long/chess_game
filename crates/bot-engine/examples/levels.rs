//! Prints what each level does from the start position.
//!
//! `cargo run --release -p bot-engine --example levels`

use bot_engine::{Level, choose_move};
use rules_core::{GameConfig, GameMode, GameState};

fn main() {
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let s = GameState::new(GameConfig::new(mode)).unwrap();
        for level in Level::ALL {
            let t0 = std::time::Instant::now();
            let r = choose_move(&s, level, 600_000, 0, 7);
            println!(
                "{:<5} {level:<6?} move {:<6} depth {:>2} nodes {:>8} time {:>4} ms (wall {:>4} ms) score {}",
                mode.name(),
                r.best_move.map(|m| m.to_string()).unwrap_or_default(),
                r.depth,
                r.nodes,
                r.time_ms,
                t0.elapsed().as_millis(),
                r.score
            );
        }
    }
}
