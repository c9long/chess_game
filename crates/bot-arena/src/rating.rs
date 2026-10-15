//! Ratings from placements.
//!
//! Every game is broken into **pairwise placement comparisons** between seats
//! held by *different* players (in Teams only across the two teams, since
//! partners always share a placement): the better-placed seat scores 1, a
//! shared placement 0.5 each. A **Bradley–Terry** model,
//! `P(a beats b) = 1 / (1 + 10^((R_b - R_a) / 400))`, is fitted to all
//! comparisons by maximum likelihood (Hunter's MM algorithm). A shared
//! placement counts as half a win each way. A small prior (one virtual draw
//! per pair of players that met) keeps ratings finite when a player wins
//! every comparison.
//!
//! Comparisons from one game (and games sharing an opening) are correlated,
//! so confidence intervals come from a **cluster bootstrap** that resamples
//! whole opening groups, stratified by pairing/lineup so that every resample
//! keeps the schedule's design.

use std::collections::HashMap;

use bot_engine::Rng;
use rules_core::{GameMode, Seat};

use crate::game::GameRecord;

/// The pairwise comparisons of one game: `(player_a, player_b, score_a)`.
pub fn comparisons(rec: &GameRecord, index: &HashMap<String, usize>) -> Vec<(usize, usize, f64)> {
    let mut out = Vec::new();
    let teams = rec.game_mode() == GameMode::Teams;
    for i in 0..4 {
        for j in i + 1..4 {
            let (pi, pj) = (index[&rec.players[i]], index[&rec.players[j]]);
            if pi == pj {
                continue;
            }
            if teams && Seat::from_index(i).map(Seat::team) == Seat::from_index(j).map(Seat::team) {
                continue;
            }
            let s = match rec.placements[i].cmp(&rec.placements[j]) {
                std::cmp::Ordering::Less => 1.0,
                std::cmp::Ordering::Equal => 0.5,
                std::cmp::Ordering::Greater => 0.0,
            };
            out.push((pi, pj, s));
        }
    }
    out
}

/// Accumulated pairwise results: `score[a][b]` is a's total score against b
/// over `count[a][b]` comparisons.
#[derive(Clone, Debug)]
pub struct Pairwise {
    /// Score of row against column.
    pub score: Vec<Vec<f64>>,
    /// Number of comparisons.
    pub count: Vec<Vec<f64>>,
}

impl Pairwise {
    /// Empty table for `n` players.
    pub fn new(n: usize) -> Pairwise {
        Pairwise {
            score: vec![vec![0.0; n]; n],
            count: vec![vec![0.0; n]; n],
        }
    }

    /// Adds one comparison (weighted).
    pub fn add(&mut self, a: usize, b: usize, s: f64, w: f64) {
        self.score[a][b] += s * w;
        self.score[b][a] += (1.0 - s) * w;
        self.count[a][b] += w;
        self.count[b][a] += w;
    }

    /// Adds every comparison of a game.
    pub fn add_game(&mut self, rec: &GameRecord, index: &HashMap<String, usize>, w: f64) {
        for (a, b, s) in comparisons(rec, index) {
            self.add(a, b, s, w);
        }
    }

    /// Number of players.
    pub fn len(&self) -> usize {
        self.score.len()
    }

    /// Whether there are no players.
    pub fn is_empty(&self) -> bool {
        self.score.is_empty()
    }
}

/// Elo difference implied by an expected score.
pub fn elo_from_score(s: f64) -> f64 {
    let s = s.clamp(1e-6, 1.0 - 1e-6);
    400.0 * (s / (1.0 - s)).log10()
}

/// Expected score implied by an Elo difference.
pub fn score_from_elo(elo: f64) -> f64 {
    1.0 / (1.0 + 10f64.powf(-elo / 400.0))
}

/// Bradley–Terry maximum-likelihood ratings (Elo scale, mean 0) with
/// `prior` virtual draws added to every pair of players that met.
pub fn bradley_terry(pw: &Pairwise, prior: f64) -> Vec<f64> {
    let n = pw.len();
    let mut s = pw.score.clone();
    let mut c = pw.count.clone();
    for a in 0..n {
        for b in 0..n {
            if a != b && c[a][b] > 0.0 {
                s[a][b] += prior * 0.5;
                c[a][b] += prior;
            }
        }
    }
    let wins: Vec<f64> = (0..n).map(|a| s[a].iter().sum()).collect();
    let mut g = vec![1.0f64; n];
    for _ in 0..10_000 {
        let mut max_change = 0.0f64;
        for a in 0..n {
            let denom: f64 = (0..n)
                .filter(|&b| b != a && c[a][b] > 0.0)
                .map(|b| c[a][b] / (g[a] + g[b]))
                .sum();
            if denom <= 0.0 || wins[a] <= 0.0 {
                continue;
            }
            let new = wins[a] / denom;
            max_change = max_change.max((new / g[a]).ln().abs());
            g[a] = new;
        }
        // Normalise to geometric mean 1.
        let mean_ln = g.iter().map(|x| x.ln()).sum::<f64>() / n as f64;
        for x in g.iter_mut() {
            *x = (x.ln() - mean_ln).exp();
        }
        if max_change < 1e-10 {
            break;
        }
    }
    g.iter().map(|x| 400.0 * x.log10()).collect()
}

/// Whether every player is connected to every other through comparisons.
pub fn connected(pw: &Pairwise) -> bool {
    let n = pw.len();
    if n == 0 {
        return true;
    }
    let mut seen = vec![false; n];
    let mut stack = vec![0];
    seen[0] = true;
    while let Some(a) = stack.pop() {
        for (b, &c) in pw.count[a].iter().enumerate() {
            if !seen[b] && c > 0.0 {
                seen[b] = true;
                stack.push(b);
            }
        }
    }
    seen.into_iter().all(|x| x)
}

/// A fitted ladder with bootstrap confidence intervals.
#[derive(Clone, Debug)]
pub struct Ladder {
    /// Player labels (input order).
    pub labels: Vec<String>,
    /// Ratings, shifted so that the anchor has its anchor value.
    pub rating: Vec<f64>,
    /// 95% interval of each rating relative to the anchor (bootstrap).
    pub ci: Vec<(f64, f64)>,
    /// Gap to the previous player in input order, with its 95% interval and
    /// the bootstrap share of resamples in which the gap was positive.
    pub gaps: Vec<Option<(f64, f64, f64, f64)>>,
    /// Pairwise table.
    pub pairwise: Pairwise,
    /// Anchor index and value.
    pub anchor: (usize, f64),
    /// Whether the comparison graph is connected.
    pub connected: bool,
}

fn percentile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let pos = q * (sorted.len() - 1) as f64;
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo as f64)
}

/// Fits the ladder over `records`. `labels` fixes the player order (gaps are
/// between consecutive labels). Clusters for the bootstrap are
/// `(run, group)`.
pub fn fit_ladder(
    records: &[GameRecord],
    labels: &[String],
    anchor: (usize, f64),
    bootstrap: usize,
    seed: u64,
) -> Ladder {
    let n = labels.len();
    let index: HashMap<String, usize> = labels
        .iter()
        .enumerate()
        .map(|(i, l)| (l.clone(), i))
        .collect();
    // Cluster the games by opening group.
    let mut cluster_of: HashMap<(String, usize), usize> = HashMap::new();
    let mut clusters: Vec<Pairwise> = Vec::new();
    let mut total = Pairwise::new(n);
    for r in records {
        let k = (r.run.clone(), r.group);
        let ci = *cluster_of.entry(k).or_insert_with(|| {
            clusters.push(Pairwise::new(n));
            clusters.len() - 1
        });
        clusters[ci].add_game(r, &index, 1.0);
        total.add_game(r, &index, 1.0);
    }
    const PRIOR: f64 = 1.0;
    let base = bradley_terry(&total, PRIOR);
    let shift = anchor.1 - base[anchor.0];
    let rating: Vec<f64> = base.iter().map(|r| r + shift).collect();

    // Stratify by the set of players in a cluster (the pairing or lineup), so
    // every resample keeps the schedule's design (and its connectivity).
    let mut strata: HashMap<Vec<usize>, Vec<usize>> = HashMap::new();
    for (ci, c) in clusters.iter().enumerate() {
        let key: Vec<usize> = (0..n)
            .filter(|&a| c.count[a].iter().any(|&x| x > 0.0))
            .collect();
        strata.entry(key).or_default().push(ci);
    }
    let mut strata: Vec<Vec<usize>> = strata.into_values().collect();
    strata.sort();
    let mut rel: Vec<Vec<f64>> = vec![Vec::with_capacity(bootstrap); n];
    let mut gaps: Vec<Vec<f64>> = vec![Vec::with_capacity(bootstrap); n];
    let mut rng = Rng::new(seed ^ 0xB007_57A9);
    if !clusters.is_empty() {
        for _ in 0..bootstrap {
            let mut pw = Pairwise::new(n);
            for stratum in &strata {
                for _ in 0..stratum.len() {
                    let c = &clusters[stratum[rng.below(stratum.len() as u64) as usize]];
                    for a in 0..n {
                        for b in 0..n {
                            pw.score[a][b] += c.score[a][b];
                            pw.count[a][b] += c.count[a][b];
                        }
                    }
                }
            }
            let r = bradley_terry(&pw, PRIOR);
            for i in 0..n {
                rel[i].push(r[i] - r[anchor.0]);
                if i > 0 {
                    gaps[i].push(r[i] - r[i - 1]);
                }
            }
        }
    }
    let ci = rel
        .iter_mut()
        .map(|v| {
            v.sort_by(f64::total_cmp);
            (
                percentile(v, 0.025) + anchor.1,
                percentile(v, 0.975) + anchor.1,
            )
        })
        .collect();
    let gaps = (0..n)
        .map(|i| {
            if i == 0 || gaps[i].is_empty() {
                return None;
            }
            let v = &mut gaps[i];
            v.sort_by(f64::total_cmp);
            let pos = v.iter().filter(|&&x| x > 0.0).count() as f64 / v.len() as f64;
            Some((
                rating[i] - rating[i - 1],
                percentile(v, 0.025),
                percentile(v, 0.975),
                pos,
            ))
        })
        .collect();
    Ladder {
        labels: labels.to_vec(),
        rating,
        ci,
        gaps,
        connected: connected(&total),
        pairwise: total,
        anchor,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bt_recovers_known_strengths() {
        // Expected scores from true ratings 0, 100, 300.
        let truth = [0.0, 100.0, 300.0];
        let mut pw = Pairwise::new(3);
        for a in 0..3 {
            for b in a + 1..3 {
                let s = score_from_elo(truth[a] - truth[b]);
                pw.add(a, b, s, 10_000.0);
            }
        }
        let r = bradley_terry(&pw, 0.0);
        for i in 0..3 {
            let got = r[i] - r[0];
            assert!((got - truth[i]).abs() < 0.5, "{i}: {got}");
        }
        assert!(connected(&pw));
    }

    #[test]
    fn prior_keeps_perfect_scores_finite() {
        let mut pw = Pairwise::new(2);
        pw.add(0, 1, 1.0, 20.0);
        let r = bradley_terry(&pw, 1.0);
        assert!(r[0].is_finite() && r[0] > r[1]);
        // 20.5 / 0.5 => 41:1 odds.
        assert!((r[0] - r[1] - elo_from_score(20.5 / 21.0)).abs() < 0.5);
    }

    #[test]
    fn elo_score_roundtrip() {
        for e in [-400.0, -10.0, 0.0, 35.0, 250.0] {
            assert!((elo_from_score(score_from_elo(e)) - e).abs() < 1e-6);
        }
        assert!((score_from_elo(10.0) - 0.514_387).abs() < 1e-5);
    }

    #[test]
    fn disconnected_is_detected() {
        let mut pw = Pairwise::new(4);
        pw.add(0, 1, 0.6, 1.0);
        pw.add(2, 3, 0.6, 1.0);
        assert!(!connected(&pw));
    }
}
