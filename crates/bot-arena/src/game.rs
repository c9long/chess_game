//! Playing one game and recording it.

use rules_core::{
    GameConfig, GameEvent, GameMode, GameResult, GameState, Move, Seat, apply_move, apply_timeout,
    legal_moves, parse_position,
};
use serde::{Deserialize, Serialize};

use bot_engine::{Engine, Rng, SearchConfig, SearchLimits};

use crate::player::{Mover, PlayerSpec};

/// Safety cap on turns (the move limit always ends a game far earlier).
pub const MAX_PLIES: u32 = 5_000;

/// Time control of a run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimeControl {
    /// No clocks: levels are limited by their node budgets (Max by its time
    /// target), engines by their own limits.
    Untimed,
    /// Simulated clocks: base and increment in ms. A move that takes longer
    /// than the remaining clock is a timeout.
    Clock {
        /// Starting clock.
        base_ms: u64,
        /// Increment per move.
        inc_ms: u64,
    },
}

impl TimeControl {
    /// Parses `untimed` or `<base_s>+<inc_s>` (e.g. `600+0`, `180+2`).
    pub fn parse(s: &str) -> Result<TimeControl, String> {
        if s.eq_ignore_ascii_case("untimed") || s == "-" {
            return Ok(TimeControl::Untimed);
        }
        let (b, i) = s
            .split_once('+')
            .ok_or_else(|| format!("bad time control `{s}` (untimed or BASE_S+INC_S)"))?;
        let secs = |x: &str| -> Result<u64, String> {
            let v: f64 = x.parse().map_err(|_| format!("bad time control `{s}`"))?;
            Ok((v * 1000.0).round() as u64)
        };
        Ok(TimeControl::Clock {
            base_ms: secs(b)?,
            inc_ms: secs(i)?,
        })
    }

    /// Text form.
    pub fn label(self) -> String {
        match self {
            TimeControl::Untimed => "untimed".into(),
            TimeControl::Clock { base_ms, inc_ms } => {
                format!("{}+{}", base_ms as f64 / 1000.0, inc_ms as f64 / 1000.0)
            }
        }
    }
}

/// Options shared by every game of a run.
#[derive(Clone, Debug)]
pub struct GameOptions {
    /// FFA or Teams.
    pub mode: GameMode,
    /// Clocks.
    pub tc: TimeControl,
    /// Master seed.
    pub seed: u64,
    /// Random opening length range in rounds (one move per seat), inclusive.
    pub opening: (u32, u32),
    /// Start position (position string) instead of the standard setup.
    pub start: Option<String>,
    /// Keep a text log of each game.
    pub log: bool,
}

/// What to play: which player sits in each seat and which opening group.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GameSpec {
    /// Index of the game in the run.
    pub index: usize,
    /// Opening group: games of a group share the random opening and differ
    /// only by seat assignment.
    pub group: usize,
    /// Player index per seat (S, W, N, E).
    pub seats: [usize; 4],
}

/// Per-seat statistics of a game.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct SeatStats {
    /// Moves chosen by the bot.
    pub moves: u32,
    /// Total thinking time (µs).
    pub micros: u64,
    /// Longest move (µs).
    pub max_micros: u64,
    /// Total nodes.
    pub nodes: u64,
    /// Sum of completed depths.
    pub depth_sum: u64,
    /// Lost on time.
    pub timeout: bool,
}

/// The record of one finished game (one JSON line in `--out`).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct GameRecord {
    /// Game index within its run.
    pub index: usize,
    /// Opening group within its run.
    pub group: usize,
    /// Run tag (lets `rate` keep groups from different runs apart).
    #[serde(default)]
    pub run: String,
    /// `ffa` or `teams`.
    pub mode: String,
    /// Time control label.
    pub tc: String,
    /// Player label per seat (S, W, N, E).
    pub players: [String; 4],
    /// Placement per seat (1 = best; ties share).
    pub placements: [u8; 4],
    /// `ffa_winner`, `ffa_move_limit_tie`, `teams_winner`, `teams_draw` or
    /// `unfinished`.
    pub result: String,
    /// Turns played after the opening (bot moves plus automatic passes).
    pub plies: u32,
    /// Random opening moves.
    pub opening: Vec<String>,
    /// Per-seat statistics.
    pub stats: [SeatStats; 4],
}

impl GameRecord {
    /// Game mode.
    pub fn game_mode(&self) -> GameMode {
        if self.mode == "teams" {
            GameMode::Teams
        } else {
            GameMode::Ffa
        }
    }

    /// Whether the game ended by the move limit.
    pub fn move_limit(&self) -> bool {
        self.result == "ffa_move_limit_tie" || self.result == "teams_draw"
    }
}

fn result_name(r: &GameResult) -> &'static str {
    match r {
        GameResult::FfaWinner { .. } => "ffa_winner",
        GameResult::FfaMoveLimitTie { .. } => "ffa_move_limit_tie",
        GameResult::TeamsWinner { .. } => "teams_winner",
        GameResult::TeamsDraw => "teams_draw",
    }
}

fn mix(a: u64, b: u64) -> u64 {
    Rng::new(a ^ b.wrapping_mul(0x9E37_79B9_7F4A_7C15)).next_u64()
}

/// Opening moves are drawn uniformly among the moves scoring within this
/// many centipawns of the best in a depth-1 search (sane but varied).
pub const OPENING_MARGIN_CP: i32 = 60;

/// The start position of a group: the standard setup (or `start`) plus a
/// random opening of whole rounds (every seat makes the same number of
/// opening moves, so the opening does not bias the seat statistics). Each
/// opening move is drawn uniformly among the moves within
/// [`OPENING_MARGIN_CP`] of the best by a depth-1 search, so openings vary
/// without throwing away material.
pub fn opening_position(
    opts: &GameOptions,
    group: usize,
) -> Result<(GameState, Vec<String>), String> {
    let mut s = match &opts.start {
        Some(p) => parse_position(p).map_err(|e| format!("bad start position: {e}"))?,
        None => GameState::new(GameConfig::new(opts.mode)).map_err(|e| e.to_string())?,
    };
    let mut rng = Rng::new(mix(opts.seed, group as u64 + 1));
    let (lo, hi) = opts.opening;
    let rounds = lo + rng.below(u64::from(hi.saturating_sub(lo)) + 1) as u32;
    let plies = rounds * s.seats_taking_turns();
    let mut engine = Engine::new(1);
    let cfg = SearchConfig {
        exact_root_scores: true,
        max_qdepth: 4,
        ..SearchConfig::default()
    };
    let mut moves = Vec::new();
    for _ in 0..plies {
        if s.is_over() {
            break;
        }
        engine.clear();
        let res = engine.search(&s, &SearchLimits::depth(1), &cfg);
        let best = res.root_moves.first().map_or(0, |r| r.score);
        let cands: Vec<Move> = res
            .root_moves
            .iter()
            .filter(|r| r.score >= best - OPENING_MARGIN_CP)
            .map(|r| r.mv)
            .collect();
        let m = if cands.is_empty() {
            let legal = legal_moves(&s);
            legal[rng.below(legal.len() as u64) as usize]
        } else {
            cands[rng.below(cands.len() as u64) as usize]
        };
        moves.push(m.to_string());
        apply_move(&mut s, m).map_err(|e| e.to_string())?;
    }
    Ok((s, moves))
}

fn seat_letter(s: Seat) -> char {
    s.letter().to_ascii_uppercase()
}

fn piece_text(p: rules_core::Piece) -> String {
    format!(
        "{}{}",
        seat_letter(p.owner).to_ascii_lowercase(),
        p.kind.letter()
    )
}

/// Event annotations for the log (everything except `MoveMade`).
fn event_text(e: &GameEvent) -> Option<String> {
    Some(match e {
        GameEvent::MoveMade { .. } => return None,
        GameEvent::Capture {
            square, captured, ..
        } => format!("x{}@{square}", piece_text(*captured)),
        GameEvent::EnPassant { .. } => "ep".into(),
        GameEvent::Promotion { kind, .. } => format!("={}", kind.letter()),
        GameEvent::Castle { .. } => "castle".into(),
        GameEvent::Pass { seat } => format!("pass({})", seat_letter(*seat)),
        GameEvent::Defeat { seat, reason } => {
            format!("defeat({},{reason:?})", seat_letter(*seat))
        }
        GameEvent::ArmyRemoved { seat } => format!("removed({})", seat_letter(*seat)),
        GameEvent::Frozen { seat } => format!("frozen({})", seat_letter(*seat)),
        GameEvent::GameEnded { outcome } => format!("end{:?}", outcome.placements),
    })
}

/// Plays one game. `movers` are the calling thread's per-seat choosers.
/// Returns the record and, if `opts.log`, the game's text log.
pub fn play_game(
    spec: &GameSpec,
    players: &[PlayerSpec],
    opts: &GameOptions,
    movers: &mut [Mover; 4],
    run: &str,
) -> Result<(GameRecord, Option<String>), String> {
    let (mut s, opening) = opening_position(opts, spec.group)?;
    let start_pos = s.to_string();
    for m in movers.iter_mut() {
        m.reset();
    }
    let mut stats = [SeatStats::default(); 4];
    let timed = match opts.tc {
        TimeControl::Untimed => None,
        TimeControl::Clock { base_ms, inc_ms } => Some((base_ms, inc_ms)),
    };
    let mut clocks = [timed.map_or(0, |t| t.0); 4];
    let mut log = String::new();
    let mut plies = 0u32;
    let base_ply = s.ply();
    while !s.is_over() && plies < MAX_PLIES {
        let seat = s.seat_to_move();
        let player = &players[spec.seats[seat.index()]];
        let seed = mix(mix(opts.seed, spec.group as u64), u64::from(s.ply()));
        let clock = timed.map(|(_, inc)| (clocks[seat.index()], inc));
        let (mv, info) = movers[seat.index()].choose(player, &s, clock, seed);
        let st = &mut stats[seat.index()];
        st.moves += 1;
        st.micros += info.micros;
        st.max_micros = st.max_micros.max(info.micros);
        st.nodes += info.nodes;
        st.depth_sum += u64::from(info.depth);
        let ply_before = s.ply();
        let events = if timed.is_some() && info.micros / 1000 >= clocks[seat.index()] {
            clocks[seat.index()] = 0;
            st.timeout = true;
            let ev = apply_timeout(&mut s, seat).map_err(|e| e.to_string())?;
            if opts.log {
                log.push_str(&format!(
                    "{}. {} timeout",
                    ply_before + 1,
                    seat_letter(seat)
                ));
            }
            ev
        } else {
            let mv = mv.ok_or("engine returned no move in a live position")?;
            if let Some((_, inc)) = timed {
                let c = &mut clocks[seat.index()];
                *c = *c - info.micros / 1000 + inc;
            }
            let ev =
                apply_move(&mut s, mv).map_err(|e| format!("illegal engine move {mv}: {e}"))?;
            if opts.log {
                log.push_str(&format!("{}. {} {mv}", ply_before + 1, seat_letter(seat)));
            }
            ev
        };
        if opts.log {
            for e in &events {
                if let Some(t) = event_text(e) {
                    log.push(' ');
                    log.push_str(&t);
                }
            }
            log.push('\n');
        }
        plies = s.ply() - base_ply;
    }
    let (placements, result) = match s.outcome() {
        Some(o) => (o.placements, result_name(&o.result).to_string()),
        None => ([1; 4], "unfinished".to_string()),
    };
    let rec = GameRecord {
        index: spec.index,
        group: spec.group,
        run: run.to_string(),
        mode: opts.mode.name().to_string(),
        tc: opts.tc.label(),
        players: spec.seats.map(|i| players[i].label.clone()),
        placements,
        result,
        plies,
        opening,
        stats,
    };
    let text = opts.log.then(|| {
        let mut h = String::new();
        h.push_str(&format!("[Game \"{}\"]\n", spec.index));
        h.push_str(&format!("[Run \"{run}\"]\n"));
        h.push_str(&format!("[Group \"{}\"]\n", spec.group));
        h.push_str(&format!("[Mode \"{}\"]\n", rec.mode));
        h.push_str(&format!("[TimeControl \"{}\"]\n", rec.tc));
        for seat in Seat::ALL {
            h.push_str(&format!(
                "[{seat:?} \"{}\"]\n",
                players[spec.seats[seat.index()]].spec
            ));
        }
        h.push_str(&format!("[Opening \"{}\"]\n", rec.opening.join(" ")));
        h.push_str(&format!("[Start \"{start_pos}\"]\n"));
        h.push_str(&format!("[Result \"{}\"]\n", rec.result));
        h.push_str(&format!(
            "[Placements \"{}\"]\n",
            rec.placements.map(|p| p.to_string()).join("-")
        ));
        h.push_str(&format!("[Plies \"{}\"]\n\n", rec.plies));
        h.push_str(&log);
        h.push('\n');
        h
    });
    Ok((rec, text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_control_parses() {
        assert_eq!(TimeControl::parse("untimed").unwrap(), TimeControl::Untimed);
        assert_eq!(
            TimeControl::parse("180+2").unwrap(),
            TimeControl::Clock {
                base_ms: 180_000,
                inc_ms: 2_000
            }
        );
        assert_eq!(
            TimeControl::parse("0.5+0.1").unwrap(),
            TimeControl::Clock {
                base_ms: 500,
                inc_ms: 100
            }
        );
        assert!(TimeControl::parse("10").is_err());
    }
}
