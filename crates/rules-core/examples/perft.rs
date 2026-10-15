//! Prints perft counts: `cargo run --release --example perft -- [ffa|teams] [depth] [position string]`.

use std::time::Instant;

use rules_core::{GameConfig, GameMode, GameState, parse_position, perft};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = match args.first().map(String::as_str) {
        Some("teams") => GameMode::Teams,
        _ => GameMode::Ffa,
    };
    let depth: u32 = args.get(1).and_then(|d| d.parse().ok()).unwrap_or(4);
    let state = match args.get(2) {
        Some(text) => match parse_position(text) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("bad position: {e}");
                std::process::exit(2);
            }
        },
        None => GameState::new(GameConfig::new(mode)).expect("valid config"),
    };
    for d in 1..=depth {
        let t = Instant::now();
        let n = perft(&state, d);
        println!("perft({d}) = {n}  [{:.2?}]", t.elapsed());
    }
}
