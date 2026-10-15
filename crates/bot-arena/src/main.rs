//! `bot-arena`: engine-vs-engine tournaments, ratings, SPRT and seat bias.
//!
//! Run in release: `cargo run --release -p bot-arena -- <command> ...`.
//! See `bot-arena --help` and `docs/bots-calibration.md`.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Mutex;

use bot_arena::game::{GameOptions, GameRecord, TimeControl};
use bot_arena::player::PlayerSpec;
use bot_arena::rating::fit_ladder;
use bot_arena::report;
use bot_arena::run::{RunSetup, run_games};
use bot_arena::schedule::{Pairs, Scheduler, ladder_pairs, two_player_patterns};
use bot_arena::sprt::{Decision, Sprt};
use bot_engine::Level;
use clap::{Args, Parser, Subcommand, ValueEnum};
use rules_core::GameMode;

#[derive(Parser)]
#[command(
    name = "bot-arena",
    version,
    about = "Engine-vs-engine tournaments: level calibration, ratings, SPRT, seat bias",
    long_about = "Engine-vs-engine tournaments for the bot engine.\n\n\
PLAYERS are specs `<base>[:<option>]*`:\n  \
levels  600 900 1200 1500 1800 2100 2400 max   (production move choice; option algo=brs+|brs|paranoid)\n  \
engines brs+ brs paranoid   (options nodes=N ms=N depth=N tt=MB q=N noise=N nonull nolmr noasp exact w.<weight>=V)\n  \
any     name=<label>\n\
Examples: 1500   2100:algo=paranoid   brs+:nodes=50000   paranoid:ms=40   brs+:nodes=30000:nonull:name=nonull\n\n\
Seats rotate so every player sits in every seat equally often; games of an opening group share a random opening."
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Clone, Copy, ValueEnum)]
enum ModeArg {
    Ffa,
    Teams,
}

impl From<ModeArg> for GameMode {
    fn from(m: ModeArg) -> GameMode {
        match m {
            ModeArg::Ffa => GameMode::Ffa,
            ModeArg::Teams => GameMode::Teams,
        }
    }
}

#[derive(Args, Clone)]
struct RunArgs {
    /// Game mode.
    #[arg(long, value_enum, default_value = "ffa")]
    mode: ModeArg,
    /// Games per pairing/lineup (rounded up to whole seat-rotation groups).
    #[arg(long, short = 'g', default_value_t = 48)]
    games: usize,
    /// Time control: `untimed` (levels bound by node budgets, Max by its time
    /// target; reproducible except Max/ms limits) or `BASE_S+INC_S` with
    /// simulated clocks (e.g. 600+0, 180+2).
    #[arg(long, default_value = "untimed")]
    tc: String,
    /// Worker threads (parallel games).
    #[arg(long, short = 'j')]
    threads: Option<usize>,
    /// Master seed (openings and per-move seeds).
    #[arg(long, default_value_t = 1)]
    seed: u64,
    /// Random opening length in rounds (one move per seat), `MIN-MAX`;
    /// opening moves are drawn among near-best moves of a 1-ply search.
    #[arg(long, default_value = "1-2")]
    opening: String,
    /// Start position (position string) instead of the standard setup.
    #[arg(long)]
    start: Option<String>,
    /// Append a PGN-like log of every game (moves + events) to this file.
    #[arg(long)]
    log: Option<PathBuf>,
    /// Append every game record as a JSON line to this file (for `rate`).
    #[arg(long)]
    out: Option<PathBuf>,
    /// Run tag stored in records (default: derived from command and seed).
    #[arg(long)]
    run: Option<String>,
    /// Rating anchor `LABEL=RATING` (default: `1500=1500` if present, else
    /// the first player = 0).
    #[arg(long)]
    anchor: Option<String>,
    /// Bootstrap resamples for confidence intervals.
    #[arg(long, default_value_t = 400)]
    bootstrap: usize,
    /// Print one line per finished game.
    #[arg(long, short = 'v')]
    verbose: bool,
}

#[derive(Subcommand)]
enum Cmd {
    /// Two players, two seats each, over every seat pattern (FFA: all 6
    /// two-seat splits; Teams: A as each team).
    Match {
        /// Player A.
        a: String,
        /// Player B.
        b: String,
        #[command(flatten)]
        run: RunArgs,
    },
    /// A fixed lineup in seat order S W N E (any mix of players), rotated
    /// through the 4 cyclic seat rotations. Four copies of one player
    /// measure pure seat bias.
    Play {
        /// Players for South, West, North, East.
        #[arg(num_args = 4, required = true)]
        seats: Vec<String>,
        #[command(flatten)]
        run: RunArgs,
    },
    /// A ladder of players (weakest first): two-player matches between
    /// adjacent (or near / all) pairs, then a Bradley-Terry ladder.
    Ladder {
        /// Players, weakest first.
        #[arg(num_args = 2.., required = true)]
        players: Vec<String>,
        /// Which pairs play.
        #[arg(long, value_enum, default_value = "near")]
        pairs: Pairs,
        #[command(flatten)]
        run: RunArgs,
    },
    /// Sequential probability ratio test: is A at least `elo1` stronger
    /// than B? (H0: diff <= elo0, H1: diff >= elo1.)
    Sprt {
        /// Candidate config.
        a: String,
        /// Baseline config.
        b: String,
        /// H0 Elo.
        #[arg(long, default_value_t = 0.0, allow_negative_numbers = true)]
        elo0: f64,
        /// H1 Elo.
        #[arg(long, default_value_t = 10.0, allow_negative_numbers = true)]
        elo1: f64,
        /// False positive rate.
        #[arg(long, default_value_t = 0.05)]
        alpha: f64,
        /// False negative rate.
        #[arg(long, default_value_t = 0.05)]
        beta: f64,
        /// Stop after this many games without a decision.
        #[arg(long, default_value_t = 30_000)]
        max_games: usize,
        #[command(flatten)]
        run: RunArgs,
    },
    /// Recompute reports and ladders from `--out` JSON-lines files.
    Rate {
        /// Record files.
        #[arg(required = true)]
        files: Vec<PathBuf>,
        /// Player order for ladder gaps, comma-separated (default: levels by
        /// strength, then others in order of appearance).
        #[arg(long, value_delimiter = ',')]
        order: Vec<String>,
        /// Rating anchor `LABEL=RATING`.
        #[arg(long)]
        anchor: Option<String>,
        /// Bootstrap resamples.
        #[arg(long, default_value_t = 400)]
        bootstrap: usize,
    },
}

fn parse_players(specs: &[String]) -> Result<Vec<PlayerSpec>, String> {
    let mut out: Vec<PlayerSpec> = Vec::new();
    for s in specs {
        let p = PlayerSpec::parse(s)?;
        if let Some(q) = out.iter().find(|q| q.label == p.label) {
            if q.spec != p.spec {
                return Err(format!(
                    "two different players share the label `{}`; use name=",
                    p.label
                ));
            }
            continue;
        }
        out.push(p);
    }
    Ok(out)
}

fn open_append(path: &Option<PathBuf>) -> Result<Option<Mutex<BufWriter<File>>>, String> {
    path.as_ref()
        .map(|p| {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(p)
                .map(|f| Mutex::new(BufWriter::new(f)))
                .map_err(|e| format!("{}: {e}", p.display()))
        })
        .transpose()
}

fn parse_anchor(anchor: &Option<String>, labels: &[String]) -> Result<(usize, f64), String> {
    if let Some(a) = anchor {
        let (l, v) = a
            .rsplit_once('=')
            .ok_or_else(|| format!("bad anchor `{a}` (LABEL=RATING)"))?;
        let i = labels
            .iter()
            .position(|x| x == l)
            .ok_or_else(|| format!("anchor `{l}` is not a player"))?;
        let v: f64 = v.parse().map_err(|_| format!("bad anchor rating `{v}`"))?;
        return Ok((i, v));
    }
    Ok(labels
        .iter()
        .position(|l| l == "1500")
        .map_or((0, 0.0), |i| (i, 1500.0)))
}

fn game_options(r: &RunArgs) -> Result<GameOptions, String> {
    let (lo, hi) = r
        .opening
        .split_once('-')
        .map_or(Some((r.opening.as_str(), r.opening.as_str())), Some)
        .ok_or("bad --opening")?;
    let lo: u32 = lo.parse().map_err(|_| "bad --opening")?;
    let hi: u32 = hi.parse().map_err(|_| "bad --opening")?;
    if lo > hi {
        return Err("bad --opening (MIN > MAX)".into());
    }
    Ok(GameOptions {
        mode: r.mode.into(),
        tc: TimeControl::parse(&r.tc)?,
        seed: r.seed,
        opening: (lo, hi),
        start: r.start.clone(),
        log: r.log.is_some(),
    })
}

fn print_reports(
    records: &[GameRecord],
    labels: &[String],
    anchor: (usize, f64),
    bootstrap: usize,
    seed: u64,
) {
    println!("{}", report::summary(records));
    println!("{}", report::players_table(records, labels));
    if labels.len() > 1 {
        let ladder = fit_ladder(records, labels, anchor, bootstrap, seed);
        println!("{}", report::head_to_head(&ladder));
        println!("{}", report::ladder_table(&ladder));
    }
    println!("{}", report::seat_bias(records));
}

fn run_cmd(
    r: &RunArgs,
    players: &[PlayerSpec],
    sched: &Scheduler,
    tag: &str,
    on_record: impl FnMut(&[GameRecord]) -> bool + Send,
) -> Result<Vec<GameRecord>, String> {
    let opts = game_options(r)?;
    let log = open_append(&r.log)?;
    let out = open_append(&r.out)?;
    let threads = r.threads.unwrap_or_else(|| {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
    });
    let timed = opts.tc != TimeControl::Untimed;
    let nondet: Vec<&str> = players
        .iter()
        .filter(|p| !p.deterministic(timed))
        .map(|p| p.label.as_str())
        .collect();
    eprintln!(
        "{} games, {} threads, {} {}, seed {}{}",
        sched.games.len(),
        threads,
        opts.mode.name(),
        opts.tc.label(),
        opts.seed,
        if nondet.is_empty() {
            " (reproducible)".to_string()
        } else {
            format!(" (time-limited, not reproducible: {})", nondet.join(", "))
        }
    );
    let setup = RunSetup {
        players,
        opts,
        threads,
        run: r
            .run
            .clone()
            .unwrap_or_else(|| format!("{tag}-s{}", r.seed)),
        log: log.as_ref(),
        out: out.as_ref(),
        verbose: r.verbose,
    };
    run_games(&setup, &sched.games, on_record)
}

fn read_records(files: &[PathBuf]) -> Result<Vec<GameRecord>, String> {
    let mut out = Vec::new();
    for f in files {
        let file = File::open(f).map_err(|e| format!("{}: {e}", f.display()))?;
        for (i, line) in BufReader::new(file).lines().enumerate() {
            let line = line.map_err(|e| e.to_string())?;
            if line.trim().is_empty() {
                continue;
            }
            let rec: GameRecord = serde_json::from_str(&line)
                .map_err(|e| format!("{}:{}: {e}", f.display(), i + 1))?;
            out.push(rec);
        }
    }
    Ok(out)
}

fn label_order(records: &[GameRecord], order: &[String]) -> Vec<String> {
    let mut labels: Vec<String> = Vec::new();
    for r in records {
        for p in &r.players {
            if !labels.contains(p) {
                labels.push(p.clone());
            }
        }
    }
    if !order.is_empty() {
        let mut out: Vec<String> = order
            .iter()
            .filter(|l| labels.contains(l))
            .cloned()
            .collect();
        out.extend(labels.into_iter().filter(|l| !order.contains(l)));
        return out;
    }
    let level_rank = |l: &str| Level::from_label(l).map(|lv| lv as usize);
    let mut levels: Vec<String> = labels
        .iter()
        .filter(|l| level_rank(l).is_some())
        .cloned()
        .collect();
    levels.sort_by_key(|l| level_rank(l));
    levels.extend(labels.into_iter().filter(|l| level_rank(l).is_none()));
    levels
}

fn real_main() -> Result<(), String> {
    let cli = Cli::parse();
    match &cli.cmd {
        Cmd::Match { a, b, run } => {
            let players = parse_players(&[a.clone(), b.clone()])?;
            if players.len() < 2 {
                return Err("match needs two different players".into());
            }
            let mut sched = Scheduler::new();
            sched.add_match(run.mode.into(), 0, 1, run.games);
            let recs = run_cmd(run, &players, &sched, "match", |_| false)?;
            let labels: Vec<String> = players.iter().map(|p| p.label.clone()).collect();
            let anchor = parse_anchor(&run.anchor, &labels)?;
            print_reports(&recs, &labels, anchor, run.bootstrap, run.seed);
        }
        Cmd::Play { seats, run } => {
            let players = parse_players(seats)?;
            let lineup: [usize; 4] = std::array::from_fn(|i| {
                let p = PlayerSpec::parse(&seats[i])
                    .map(|p| p.label)
                    .unwrap_or_default();
                players.iter().position(|q| q.label == p).unwrap_or(0)
            });
            let mut sched = Scheduler::new();
            sched.add_lineup(lineup, run.games);
            let recs = run_cmd(run, &players, &sched, "play", |_| false)?;
            let labels: Vec<String> = players.iter().map(|p| p.label.clone()).collect();
            let anchor = parse_anchor(&run.anchor, &labels)?;
            print_reports(&recs, &labels, anchor, run.bootstrap, run.seed);
        }
        Cmd::Ladder {
            players: specs,
            pairs,
            run,
        } => {
            let players = parse_players(specs)?;
            let mut sched = Scheduler::new();
            for (i, j) in ladder_pairs(players.len(), *pairs) {
                sched.add_match(run.mode.into(), i, j, run.games);
            }
            let recs = run_cmd(run, &players, &sched, "ladder", |_| false)?;
            let labels: Vec<String> = players.iter().map(|p| p.label.clone()).collect();
            let anchor = parse_anchor(&run.anchor, &labels)?;
            print_reports(&recs, &labels, anchor, run.bootstrap, run.seed);
        }
        Cmd::Sprt {
            a,
            b,
            elo0,
            elo1,
            alpha,
            beta,
            max_games,
            run,
        } => {
            let players = parse_players(&[a.clone(), b.clone()])?;
            if players.len() < 2 {
                return Err("sprt needs two different players".into());
            }
            let sprt = Sprt {
                elo0: *elo0,
                elo1: *elo1,
                alpha: *alpha,
                beta: *beta,
            };
            let mode: GameMode = run.mode.into();
            let gsize = two_player_patterns(mode).len();
            let mut sched = Scheduler::new();
            sched.add_match(mode, 0, 1, *max_games);
            let (la, lb) = (players[0].label.clone(), players[1].label.clone());
            let mut last_n = 0;
            let mut decided = None;
            let recs = run_cmd(run, &players, &sched, "sprt", |recs| {
                let samples = bot_arena::group_samples(recs, &la, &lb, gsize);
                if decided.is_some() || samples.len() == last_n {
                    return decided.is_some();
                }
                last_n = samples.len();
                let st = sprt.status(&samples);
                if last_n.is_multiple_of(10) || st.decision != Decision::Continue {
                    eprintln!(
                        "  sprt: {} groups, score {:.4}, Elo {:+.1} [{:+.1},{:+.1}], LLR {:.2} ({:.2}, {:.2})",
                        st.n, st.mean, st.elo.0, st.elo.1, st.elo.2, st.llr, st.lower, st.upper
                    );
                }
                if st.decision != Decision::Continue {
                    decided = Some(st.n);
                }
                decided.is_some()
            })?;
            let labels = vec![la.clone(), lb.clone()];
            print_reports(&recs, &labels, (1, 0.0), run.bootstrap, run.seed);
            let samples = bot_arena::group_samples(&recs, &la, &lb, gsize);
            let samples = &samples[..decided.unwrap_or(samples.len()).min(samples.len())];
            let st = sprt.status(samples);
            println!(
                "SPRT {la} vs {lb} (H0: Elo <= {}, H1: Elo >= {}, alpha {}, beta {}):",
                sprt.elo0, sprt.elo1, sprt.alpha, sprt.beta
            );
            println!(
                "  {} groups ({} games each), score {:.4}, Elo {:+.1} [{:+.1}, {:+.1}], LLR {:.3} in ({:.3}, {:.3})",
                st.n, gsize, st.mean, st.elo.0, st.elo.1, st.elo.2, st.llr, st.lower, st.upper
            );
            println!(
                "  result: {}",
                match st.decision {
                    Decision::H1 => "H1 accepted: A is stronger (by >= elo1)",
                    Decision::H0 => "H0 accepted: no improvement of elo1 or more",
                    Decision::Continue => "inconclusive (max games reached)",
                }
            );
        }
        Cmd::Rate {
            files,
            order,
            anchor,
            bootstrap,
        } => {
            let recs = read_records(files)?;
            let mut by_mode: HashMap<String, Vec<GameRecord>> = HashMap::new();
            for r in recs {
                by_mode.entry(r.mode.clone()).or_default().push(r);
            }
            let mut modes: Vec<_> = by_mode.into_iter().collect();
            modes.sort_by(|a, b| a.0.cmp(&b.0));
            for (mode, recs) in modes {
                println!("===== {mode} =====");
                let labels = label_order(&recs, order);
                let anchor = parse_anchor(anchor, &labels)?;
                print_reports(&recs, &labels, anchor, *bootstrap, 1);
            }
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    match real_main() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
