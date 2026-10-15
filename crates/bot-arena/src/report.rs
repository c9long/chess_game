//! Text reports: per-player results, head-to-head, ladder, seat bias.

use std::collections::HashMap;
use std::fmt::Write;

use rules_core::{GameMode, Seat};

use crate::game::GameRecord;
use crate::rating::{Ladder, elo_from_score};

/// Placement points of a seat: FFA 3/2/1/0 for 1st..4th (ties share the
/// average); Teams 1 for a win, 0.5 for a draw, 0 for a loss.
pub fn seat_points(rec: &GameRecord, seat: usize) -> f64 {
    let p = rec.placements[seat] as usize;
    let tied = rec.placements.iter().filter(|&&x| x as usize == p).count();
    match rec.game_mode() {
        GameMode::Ffa => (p..p + tied).map(|q| (4 - q) as f64).sum::<f64>() / tied as f64,
        GameMode::Teams => {
            if tied == 4 {
                0.5
            } else if p == 1 {
                1.0
            } else {
                0.0
            }
        }
    }
}

/// Share of first place a seat gets (a shared 1st counts 1/k).
pub fn first_share(rec: &GameRecord, seat: usize) -> f64 {
    if rec.placements[seat] != 1 {
        return 0.0;
    }
    let k = rec.placements.iter().filter(|&&x| x == 1).count();
    match rec.game_mode() {
        GameMode::Ffa => 1.0 / k as f64,
        // Teams: a win is a first place for both partners; a draw is half.
        GameMode::Teams => {
            if k == 4 {
                0.5
            } else {
                1.0
            }
        }
    }
}

fn mean_se(xs: &[f64]) -> (f64, f64) {
    let n = xs.len() as f64;
    if xs.is_empty() {
        return (f64::NAN, f64::NAN);
    }
    let m = xs.iter().sum::<f64>() / n;
    let v = if xs.len() > 1 {
        xs.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (n - 1.0)
    } else {
        0.0
    };
    (m, (v / n).sqrt())
}

/// Overall game statistics.
pub fn summary(records: &[GameRecord]) -> String {
    let mut s = String::new();
    let n = records.len();
    if n == 0 {
        return "no games\n".into();
    }
    let plies: f64 = records.iter().map(|r| f64::from(r.plies)).sum::<f64>() / n as f64;
    let ml = records.iter().filter(|r| r.move_limit()).count();
    let unfinished = records.iter().filter(|r| r.result == "unfinished").count();
    let timeouts: usize = records
        .iter()
        .map(|r| r.stats.iter().filter(|s| s.timeout).count())
        .sum();
    let mut modes: Vec<&str> = records.iter().map(|r| r.mode.as_str()).collect();
    modes.sort_unstable();
    modes.dedup();
    let mut tcs: Vec<&str> = records.iter().map(|r| r.tc.as_str()).collect();
    tcs.sort_unstable();
    tcs.dedup();
    let _ = writeln!(
        s,
        "{n} games ({}; {}), avg {plies:.0} plies after the opening, {ml} move-limit endings ({:.1}%), {timeouts} timeouts, {unfinished} unfinished",
        modes.join("+"),
        tcs.join("+"),
        100.0 * ml as f64 / n as f64
    );
    s
}

/// Per-player table: seat-games, points, first places, speed.
pub fn players_table(records: &[GameRecord], labels: &[String]) -> String {
    #[derive(Default)]
    struct Acc {
        seat_games: usize,
        points: Vec<f64>,
        firsts: f64,
        place: f64,
        moves: u64,
        micros: u64,
        max_micros: u64,
        nodes: u64,
        depth: u64,
        timeouts: usize,
    }
    let index: HashMap<&str, usize> = labels
        .iter()
        .enumerate()
        .map(|(i, l)| (l.as_str(), i))
        .collect();
    let mut acc: Vec<Acc> = (0..labels.len()).map(|_| Acc::default()).collect();
    for r in records {
        for seat in 0..4 {
            let a = &mut acc[index[r.players[seat].as_str()]];
            a.seat_games += 1;
            a.points.push(seat_points(r, seat));
            a.firsts += first_share(r, seat);
            a.place += f64::from(r.placements[seat]);
            let st = &r.stats[seat];
            a.moves += u64::from(st.moves);
            a.micros += st.micros;
            a.max_micros = a.max_micros.max(st.max_micros);
            a.nodes += st.nodes;
            a.depth += st.depth_sum;
            a.timeouts += usize::from(st.timeout);
        }
    }
    let width = labels.iter().map(String::len).max().unwrap_or(6).max(6);
    let mut s = String::new();
    let _ = writeln!(
        s,
        "{:<width$} {:>7} {:>11} {:>7} {:>6} {:>8} {:>8} {:>10} {:>6} {:>4}",
        "player",
        "seat-g",
        "pts/seat-g",
        "1st%",
        "place",
        "ms/move",
        "max ms",
        "nodes/mv",
        "depth",
        "t/o"
    );
    for (i, a) in acc.iter().enumerate() {
        if a.seat_games == 0 {
            continue;
        }
        let (m, se) = mean_se(&a.points);
        let mv = a.moves.max(1) as f64;
        let _ = writeln!(
            s,
            "{:<width$} {:>7} {:>6.3}±{:<4.3} {:>6.1}% {:>6.2} {:>8.1} {:>8.0} {:>10.0} {:>6.2} {:>4}",
            labels[i],
            a.seat_games,
            m,
            1.96 * se,
            100.0 * a.firsts / a.seat_games as f64,
            a.place / a.seat_games as f64,
            a.micros as f64 / 1000.0 / mv,
            a.max_micros as f64 / 1000.0,
            a.nodes as f64 / mv,
            a.depth as f64 / mv,
            a.timeouts
        );
    }
    s
}

/// Head-to-head pairwise placement scores (row vs column, % and Elo).
pub fn head_to_head(ladder: &Ladder) -> String {
    let n = ladder.labels.len();
    let pw = &ladder.pairwise;
    let mut s = String::new();
    let _ = writeln!(s, "pairwise placement score (row vs column; comparisons):");
    for a in 0..n {
        for b in 0..n {
            if a == b || pw.count[a][b] == 0.0 || a > b {
                continue;
            }
            let sc = pw.score[a][b] / pw.count[a][b];
            let _ = writeln!(
                s,
                "  {:<14} vs {:<14} {:>5.1}% ({:+5.0} Elo) over {:.0}",
                ladder.labels[a],
                ladder.labels[b],
                100.0 * sc,
                elo_from_score(sc),
                pw.count[a][b]
            );
        }
    }
    s
}

/// The rating ladder with confidence intervals and gaps.
pub fn ladder_table(ladder: &Ladder) -> String {
    let mut s = String::new();
    let (ai, av) = ladder.anchor;
    let _ = writeln!(
        s,
        "Bradley-Terry ladder (anchor {} = {av:.0}; 95% cluster-bootstrap intervals):",
        ladder.labels[ai]
    );
    if !ladder.connected {
        let _ = writeln!(
            s,
            "  WARNING: players are not all connected by games; ratings across components are not comparable"
        );
    }
    let _ = writeln!(
        s,
        "  {:<16} {:>7} {:>17}   {:>22} {:>8}",
        "player", "rating", "95% interval", "gap to previous (95%)", "P(gap>0)"
    );
    for i in 0..ladder.labels.len() {
        let (lo, hi) = ladder.ci[i];
        let gap = match ladder.gaps[i] {
            Some((g, glo, ghi, pos)) => {
                format!(
                    "{g:>+6.0} [{glo:>+5.0},{ghi:>+5.0}]   {:>6.1}%",
                    100.0 * pos
                )
            }
            None => String::new(),
        };
        let _ = writeln!(
            s,
            "  {:<16} {:>7.0}   [{:>6.0},{:>6.0}]   {gap}",
            ladder.labels[i], ladder.rating[i], lo, hi
        );
    }
    s
}

/// Seat bias: results by seat over all games (seat rotation makes this a fair
/// estimate of the seat's own advantage).
pub fn seat_bias(records: &[GameRecord]) -> String {
    let mut s = String::new();
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let recs: Vec<&GameRecord> = records.iter().filter(|r| r.game_mode() == mode).collect();
        if recs.is_empty() {
            continue;
        }
        let n = recs.len() as f64;
        let _ = writeln!(s, "seat bias, {} ({} games):", mode.name(), recs.len());
        match mode {
            GameMode::Ffa => {
                let _ = writeln!(
                    s,
                    "  {:<6} {:>12} {:>14} {:>9} {:>9}",
                    "seat", "1st %", "pts/game", "4th %", "place"
                );
                for seat in Seat::ALL {
                    let i = seat.index();
                    let firsts: Vec<f64> = recs.iter().map(|r| first_share(r, i)).collect();
                    let pts: Vec<f64> = recs.iter().map(|r| seat_points(r, i)).collect();
                    let last = recs.iter().filter(|r| r.placements[i] == 4).count() as f64;
                    let place = recs.iter().map(|r| f64::from(r.placements[i])).sum::<f64>();
                    let (f, fse) = mean_se(&firsts);
                    let (p, pse) = mean_se(&pts);
                    let _ = writeln!(
                        s,
                        "  {:<6} {:>5.1}±{:<4.1}% {:>7.3}±{:<5.3} {:>8.1}% {:>9.2}",
                        seat.name(),
                        100.0 * f,
                        196.0 * fse,
                        p,
                        1.96 * pse,
                        100.0 * last / n,
                        place / n
                    );
                }
                let _ = writeln!(
                    s,
                    "  (fair share: 25% firsts, 1.5 pts; ± is a 95% interval; move-limit ties split 1st)"
                );
            }
            GameMode::Teams => {
                let ns = recs
                    .iter()
                    .filter(|r| r.placements[0] == 1 && r.placements[1] == 2)
                    .count() as f64;
                let we = recs
                    .iter()
                    .filter(|r| r.placements[1] == 1 && r.placements[0] == 2)
                    .count() as f64;
                let draws = n - ns - we;
                let score: Vec<f64> = recs.iter().map(|r| seat_points(r, 0)).collect();
                let (m, se) = mean_se(&score);
                let _ = writeln!(
                    s,
                    "  South+North wins {:.1}%, West+East wins {:.1}%, draws {:.1}%; South+North score {:.3}±{:.3} (fair 0.5)",
                    100.0 * ns / n,
                    100.0 * we / n,
                    100.0 * draws / n,
                    m,
                    1.96 * se
                );
            }
        }
    }
    s
}
