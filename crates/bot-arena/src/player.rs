//! Player specifications: a strength level or a raw engine configuration.
//!
//! Grammar: `<base>[:<option>]*`.
//!
//! * **Levels** — base `600` .. `2400` or `max`. They play exactly like
//!   production bots ([`bot_engine::choose_move_in`] on a cleared table, the
//!   same as [`bot_engine::choose_move_with`]), including noise and
//!   controlled blunders. Option: `algo=brs+|brs|paranoid` (FFA search).
//! * **Engines** — base `brs+`, `brs` or `paranoid` (in Teams games the base
//!   only names the engine; Teams always uses team alpha-beta). Options:
//!   * limits: `nodes=N`, `ms=N`, `depth=N` (any combination; default
//!     `nodes=30000`);
//!   * search: `tt=MB` (default 16), `q=N` (max quiescence depth), `noise=N`,
//!     `nonull`, `nolmr`, `noasp`, `exact`;
//!   * evaluation weights: `w.<name>=<int>` with `<name>` one of
//!     `p n b r q k` (material), `mob.<p|n|b|r|q|k>` (mobility),
//!     `leader_hanging`, `leader_attacked_to_move`, `leader_zone_attack`,
//!     `leader_open_line`, `leader_open_cap`, `leader_shield`,
//!     `frozen_material_pct`, `ffa_opponent_out`, `teams_active_seat`,
//!     `tempo`.
//! * Any player: `name=<label>` sets the display label (default: the spec).
//!
//! Examples: `1500`, `2100:algo=paranoid`, `brs+:nodes=50000`,
//! `paranoid:ms=40`, `brs+:nodes=30000:nonull:name=no-null`,
//! `brs+:nodes=30000:w.leader_hanging=-3000`.

use std::time::{Duration, Instant};

use bot_engine::{
    Engine, FfaAlgorithm, Level, SearchConfig, SearchLimits, choose_move_in, level_limits,
    time_budget_ms,
};
use rules_core::{GameState, Move};

/// What a player is.
#[derive(Clone, Debug)]
pub enum PlayerKind {
    /// A strength level (production move choice).
    Level {
        /// The level.
        level: Level,
        /// FFA algorithm.
        algo: FfaAlgorithm,
    },
    /// A raw engine configuration.
    Engine {
        /// Search configuration (seed is set per move).
        cfg: Box<SearchConfig>,
        /// Node limit.
        nodes: Option<u64>,
        /// Time limit per move (ms).
        ms: Option<u64>,
        /// Depth limit.
        depth: Option<u32>,
        /// Transposition table size (MB).
        tt_mb: usize,
    },
}

/// A parsed player specification.
#[derive(Clone, Debug)]
pub struct PlayerSpec {
    /// Display label (unique within a run).
    pub label: String,
    /// The original specification string.
    pub spec: String,
    /// What it is.
    pub kind: PlayerKind,
}

/// Default node budget of an engine spec without any limit.
pub const DEFAULT_ENGINE_NODES: u64 = 30_000;

fn parse_algo(s: &str) -> Result<FfaAlgorithm, String> {
    match s.to_ascii_lowercase().as_str() {
        "brs+" | "brsplus" => Ok(FfaAlgorithm::BrsPlus),
        "brs" => Ok(FfaAlgorithm::Brs),
        "paranoid" => Ok(FfaAlgorithm::Paranoid),
        _ => Err(format!("unknown FFA algorithm `{s}` (brs+, brs, paranoid)")),
    }
}

fn kind_index(s: &str) -> Option<usize> {
    Some(match s {
        "p" => 0,
        "n" => 1,
        "b" => 2,
        "r" => 3,
        "q" => 4,
        "k" => 5,
        _ => return None,
    })
}

fn set_weight(cfg: &mut SearchConfig, name: &str, v: i32) -> Result<(), String> {
    let w = &mut cfg.weights;
    if let Some(i) = kind_index(name) {
        w.piece_value[i] = v;
        return Ok(());
    }
    if let Some(k) = name.strip_prefix("mob.")
        && let Some(i) = kind_index(k)
    {
        w.mobility[i] = v;
        return Ok(());
    }
    let slot = match name {
        "leader_hanging" => &mut w.leader_hanging,
        "leader_attacked_to_move" => &mut w.leader_attacked_to_move,
        "leader_zone_attack" => &mut w.leader_zone_attack,
        "leader_open_line" => &mut w.leader_open_line,
        "leader_open_cap" => &mut w.leader_open_cap,
        "leader_shield" => &mut w.leader_shield,
        "frozen_material_pct" => &mut w.frozen_material_pct,
        "ffa_opponent_out" => &mut w.ffa_opponent_out,
        "teams_active_seat" => &mut w.teams_active_seat,
        "tempo" => &mut w.tempo,
        _ => return Err(format!("unknown weight `w.{name}`")),
    };
    *slot = v;
    Ok(())
}

fn num<T: std::str::FromStr>(key: &str, v: &str) -> Result<T, String> {
    v.parse()
        .map_err(|_| format!("bad value `{v}` for option `{key}`"))
}

impl PlayerSpec {
    /// Parses a specification (see the module docs).
    pub fn parse(spec: &str) -> Result<PlayerSpec, String> {
        let spec = spec.trim();
        let mut parts = spec.split(':');
        let base = parts.next().unwrap_or_default().to_ascii_lowercase();
        let mut label: Option<String> = None;
        let level = Level::from_label(base.trim_start_matches('l'));
        let mut kind = if let Some(level) = level {
            PlayerKind::Level {
                level,
                algo: FfaAlgorithm::default(),
            }
        } else {
            let algo = parse_algo(&base)
                .map_err(|_| format!("unknown player base `{base}` in `{spec}`"))?;
            PlayerKind::Engine {
                cfg: Box::new(SearchConfig {
                    ffa_algorithm: algo,
                    ..SearchConfig::default()
                }),
                nodes: None,
                ms: None,
                depth: None,
                tt_mb: 16,
            }
        };
        for opt in parts {
            let (key, val) = match opt.split_once('=') {
                Some((k, v)) => (k.trim(), Some(v.trim())),
                None => (opt.trim(), None),
            };
            if key == "name" {
                label = Some(val.ok_or("`name` needs a value")?.to_string());
                continue;
            }
            match &mut kind {
                PlayerKind::Level { algo, .. } => match (key, val) {
                    ("algo", Some(v)) => *algo = parse_algo(v)?,
                    _ => {
                        return Err(format!(
                            "level players accept only `algo=` and `name=` (got `{opt}`)"
                        ));
                    }
                },
                PlayerKind::Engine {
                    cfg,
                    nodes,
                    ms,
                    depth,
                    tt_mb,
                } => match (key, val) {
                    ("nodes", Some(v)) => *nodes = Some(num(key, v)?),
                    ("ms", Some(v)) => *ms = Some(num(key, v)?),
                    ("depth", Some(v)) => *depth = Some(num(key, v)?),
                    ("tt", Some(v)) => *tt_mb = num(key, v)?,
                    ("q", Some(v)) => cfg.max_qdepth = num(key, v)?,
                    ("noise", Some(v)) => cfg.eval_noise = num(key, v)?,
                    ("algo", Some(v)) => cfg.ffa_algorithm = parse_algo(v)?,
                    ("nonull", None) => cfg.null_move = false,
                    ("nolmr", None) => cfg.lmr = false,
                    ("noasp", None) => cfg.aspiration = false,
                    ("exact", None) => cfg.exact_root_scores = true,
                    (k, Some(v)) if k.starts_with("w.") => {
                        set_weight(cfg, &k[2..], num(k, v)?)?;
                    }
                    _ => return Err(format!("unknown engine option `{opt}` in `{spec}`")),
                },
            }
        }
        if let PlayerKind::Engine {
            nodes, ms, depth, ..
        } = &mut kind
            && nodes.is_none()
            && ms.is_none()
            && depth.is_none()
        {
            *nodes = Some(DEFAULT_ENGINE_NODES);
        }
        Ok(PlayerSpec {
            label: label.unwrap_or_else(|| spec.to_string()),
            spec: spec.to_string(),
            kind,
        })
    }

    /// Whether this player's moves are reproducible for a fixed seed (no
    /// wall-clock limit binds) under the given clock.
    pub fn deterministic(&self, timed: bool) -> bool {
        match &self.kind {
            PlayerKind::Level { level, .. } => !timed && *level != Level::Max,
            PlayerKind::Engine { ms, .. } => !timed && ms.is_none(),
        }
    }
}

/// Statistics of one move choice.
#[derive(Clone, Copy, Debug, Default)]
pub struct MoveInfo {
    /// Wall time (µs).
    pub micros: u64,
    /// Nodes searched.
    pub nodes: u64,
    /// Completed depth.
    pub depth: u32,
}

/// Per-seat move chooser (owns a reusable engine for engine players).
#[derive(Default)]
pub struct Mover {
    engine: Option<(usize, Engine)>,
}

impl Mover {
    /// Forgets learned state (call at the start of each game).
    pub fn reset(&mut self) {
        if let Some((_, e)) = &mut self.engine {
            e.clear();
        }
    }

    fn engine_with(&mut self, tt_mb: usize) -> &mut Engine {
        if self.engine.as_ref().is_some_and(|(mb, _)| *mb != tt_mb) {
            self.engine = None;
        }
        &mut self
            .engine
            .get_or_insert_with(|| (tt_mb, Engine::new(tt_mb)))
            .1
    }

    /// Chooses a move for the seat to move. `clock` is `(remaining_ms,
    /// increment_ms)` in timed games, `None` when untimed.
    pub fn choose(
        &mut self,
        player: &PlayerSpec,
        state: &GameState,
        clock: Option<(u64, u64)>,
        seed: u64,
    ) -> (Option<Move>, MoveInfo) {
        let start = Instant::now();
        let res = match &player.kind {
            PlayerKind::Level { level, algo } => {
                // Same as `choose_move_with`, but on a reused (cleared) table.
                let (rem, inc) = clock.unwrap_or((u64::MAX, 0));
                let tt_mb = level.params().tt_mb;
                let engine = self.engine_with(tt_mb);
                engine.clear();
                let limits = level_limits(*level, state, *algo, rem, inc);
                choose_move_in(engine, state, *level, &limits, seed, *algo)
            }
            PlayerKind::Engine {
                cfg,
                nodes,
                ms,
                depth,
                tt_mb,
            } => {
                let engine = self.engine_with(*tt_mb);
                // A time limit is further capped by the clock (Max's rule).
                let ms = match (clock, ms) {
                    (Some((rem, inc)), Some(ms)) => {
                        Some((*ms).min(time_budget_ms(Level::Max, rem, inc)))
                    }
                    (Some((rem, inc)), None) => Some(time_budget_ms(Level::Max, rem, inc)),
                    (None, ms) => *ms,
                };
                let limits = SearchLimits {
                    max_depth: depth.unwrap_or(SearchLimits::nodes(1).max_depth),
                    max_nodes: nodes.unwrap_or(u64::MAX),
                    deadline: ms.map(|ms| start + Duration::from_millis(ms)),
                };
                let cfg = SearchConfig {
                    seed,
                    ..(**cfg).clone()
                };
                engine.search(state, &limits, &cfg)
            }
        };
        let info = MoveInfo {
            micros: start.elapsed().as_micros() as u64,
            nodes: res.nodes,
            depth: res.depth,
        };
        (res.best_move, info)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_levels_and_engines() {
        let p = PlayerSpec::parse("1500").unwrap();
        assert!(matches!(
            p.kind,
            PlayerKind::Level {
                level: Level::L1500,
                algo: FfaAlgorithm::BrsPlus
            }
        ));
        let p = PlayerSpec::parse("MAX:algo=paranoid:name=mp").unwrap();
        assert_eq!(p.label, "mp");
        assert!(matches!(
            p.kind,
            PlayerKind::Level {
                level: Level::Max,
                algo: FfaAlgorithm::Paranoid
            }
        ));
        let p = PlayerSpec::parse("brs+:nodes=5000:nonull:q=4:w.leader_hanging=-3000:w.mob.n=7")
            .unwrap();
        let PlayerKind::Engine { cfg, nodes, ms, .. } = &p.kind else {
            panic!()
        };
        assert_eq!(*nodes, Some(5000));
        assert_eq!(*ms, None);
        assert!(!cfg.null_move);
        assert_eq!(cfg.max_qdepth, 4);
        assert_eq!(cfg.weights.leader_hanging, -3000);
        assert_eq!(cfg.weights.mobility[1], 7);
        let p = PlayerSpec::parse("paranoid").unwrap();
        let PlayerKind::Engine { nodes, .. } = &p.kind else {
            panic!()
        };
        assert_eq!(*nodes, Some(DEFAULT_ENGINE_NODES));
        assert!(p.deterministic(false));
        assert!(!p.deterministic(true));
    }

    #[test]
    fn rejects_bad_specs() {
        assert!(PlayerSpec::parse("1000").is_err());
        assert!(PlayerSpec::parse("1500:nodes=5").is_err());
        assert!(PlayerSpec::parse("brs+:w.nope=1").is_err());
        assert!(PlayerSpec::parse("brs+:nodes=x").is_err());
        assert!(PlayerSpec::parse("brs+:algo=minimax").is_err());
    }
}
