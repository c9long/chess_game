//! Running a schedule in parallel.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Instant;

use crate::game::{GameOptions, GameRecord, GameSpec, play_game};
use crate::player::{Mover, PlayerSpec};

/// Everything a run needs besides the schedule.
pub struct RunSetup<'a> {
    /// Players (indices used by the schedule).
    pub players: &'a [PlayerSpec],
    /// Game options.
    pub opts: GameOptions,
    /// Worker threads.
    pub threads: usize,
    /// Run tag stored in every record.
    pub run: String,
    /// Optional text log of every game.
    pub log: Option<&'a Mutex<BufWriter<File>>>,
    /// Optional JSON-lines output of every record.
    pub out: Option<&'a Mutex<BufWriter<File>>>,
    /// Print a progress line per game to stderr.
    pub verbose: bool,
}

/// Plays `specs` on `setup.threads` threads. After each finished game
/// `on_record` sees all records so far (in completion order) and returns
/// `true` to stop scheduling new games. Returns the records sorted by game
/// index.
pub fn run_games(
    setup: &RunSetup<'_>,
    specs: &[GameSpec],
    mut on_record: impl FnMut(&[GameRecord]) -> bool + Send,
) -> Result<Vec<GameRecord>, String> {
    let next = AtomicUsize::new(0);
    let stop = AtomicBool::new(false);
    let state = Mutex::new((Vec::<GameRecord>::new(), None::<String>));
    let started = Instant::now();
    let on_record = Mutex::new(&mut on_record);
    std::thread::scope(|scope| {
        for _ in 0..setup.threads.max(1) {
            scope.spawn(|| {
                let mut movers: [Mover; 4] = Default::default();
                loop {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= specs.len() {
                        break;
                    }
                    let res = play_game(
                        &specs[i],
                        setup.players,
                        &setup.opts,
                        &mut movers,
                        &setup.run,
                    );
                    let mut st = state.lock().unwrap();
                    match res {
                        Err(e) => {
                            st.1.get_or_insert(format!("game {i}: {e}"));
                            stop.store(true, Ordering::Relaxed);
                        }
                        Ok((rec, text)) => {
                            // Whole entries, flushed at once: several runs may append
                            // to the same file, and an interrupted run keeps its games.
                            if let (Some(w), Some(t)) = (setup.log, text) {
                                let mut w = w.lock().unwrap();
                                let _ = w.write_all(t.as_bytes()).and_then(|()| w.flush());
                            }
                            if let Some(w) = setup.out {
                                let line = serde_json::to_string(&rec).unwrap_or_default() + "\n";
                                let mut w = w.lock().unwrap();
                                let _ = w.write_all(line.as_bytes()).and_then(|()| w.flush());
                            }
                            if setup.verbose {
                                eprintln!(
                                    "game {:>5} group {:>4} {:?} placements {:?} {} plies {}",
                                    rec.index,
                                    rec.group,
                                    rec.players,
                                    rec.placements,
                                    rec.result,
                                    rec.plies
                                );
                            }
                            st.0.push(rec);
                            let done = st.0.len();
                            if !setup.verbose && (done.is_multiple_of(50) || done == specs.len()) {
                                let el = started.elapsed().as_secs_f64();
                                eprintln!(
                                    "  {done}/{} games, {:.0}s elapsed, ~{:.0}s left",
                                    specs.len(),
                                    el,
                                    el / done as f64 * (specs.len() - done) as f64
                                );
                            }
                            if (on_record.lock().unwrap())(&st.0) {
                                stop.store(true, Ordering::Relaxed);
                            }
                        }
                    }
                }
            });
        }
    });
    for w in [setup.log, setup.out].into_iter().flatten() {
        let _ = w.lock().unwrap().flush();
    }
    let (mut recs, err) = state.into_inner().unwrap();
    if let Some(e) = err {
        return Err(e);
    }
    recs.sort_by_key(|r| r.index);
    Ok(recs)
}
