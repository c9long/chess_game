//! Engine-vs-engine tournaments for the bot engine (PLAN §6, M6).
//!
//! Used to calibrate the strength-level labels, to measure seat bias and to
//! test engine changes (SPRT). The `bot-arena` binary is the CLI; this
//! library holds the pieces so they can be tested:
//!
//! * [`player`] — player specs (levels or raw engine configs) and move choice;
//! * [`game`] — playing and recording one game (clocks, openings, logs);
//! * [`schedule`] — seat-rotated schedules (matches, lineups, ladders);
//! * [`run`] — parallel execution;
//! * [`rating`] — Bradley–Terry ratings from pairwise placements with
//!   cluster-bootstrap intervals;
//! * [`sprt`] — sequential test between two configs;
//! * [`report`] — text reports, including seat-bias statistics.

#![forbid(unsafe_code)]

pub mod game;
pub mod player;
pub mod rating;
pub mod report;
pub mod run;
pub mod schedule;
pub mod sprt;

use std::collections::HashMap;

use game::GameRecord;
use rating::comparisons;

/// SPRT samples: per opening group (in group order, stopping at the first
/// incomplete group), the mean pairwise score of `a` against `b`.
/// `group_size` is the number of games per group.
pub fn group_samples(records: &[GameRecord], a: &str, b: &str, group_size: usize) -> Vec<f64> {
    let index: HashMap<String, usize> = [(a.to_string(), 0), (b.to_string(), 1)].into();
    let mut groups: HashMap<usize, (usize, f64, f64)> = HashMap::new();
    for r in records {
        let e = groups.entry(r.group).or_default();
        e.0 += 1;
        for (x, _, s) in comparisons(r, &index) {
            let s = if x == 0 { s } else { 1.0 - s };
            e.1 += s;
            e.2 += 1.0;
        }
    }
    let mut out = Vec::new();
    let mut keys: Vec<usize> = groups.keys().copied().collect();
    keys.sort_unstable();
    for (expect, g) in keys.into_iter().enumerate() {
        let (n, s, c) = groups[&g];
        if g != expect || n < group_size {
            break;
        }
        if c > 0.0 {
            out.push(s / c);
        }
    }
    out
}
