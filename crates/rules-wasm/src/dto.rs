//! The JSON wire contract shared by the browser, the Node server and
//! `packages/rules` (`@game/rules`, whose hand-written TypeScript types
//! mirror these structs and are checked against them by tests).
//!
//! Conventions (keep them stable; the server persists and relays these):
//!
//! * Object keys are **camelCase**.
//! * Enum values are **snake_case** strings, identical to `rules-core`'s
//!   serde output: seats `"south" | "west" | "north" | "east"`, piece kinds
//!   `"pawn" | "knight" | ...`, statuses, defeat reasons, move flags, civ
//!   slugs, teams (`"south_north" | "west_east"`) and event / result tags.
//! * Squares are names (`"a1"` .. `"l12"`).
//! * Per-seat arrays have four entries in turn order South, West, North, East.
//! * The board is 144 entries, index `rank * 12 + file` (`a1` = 0, `b1` = 1,
//!   `a2` = 12, `l12` = 143), `null` for an empty square.

use rules_core::{
    CivId, CivSpec, DefeatReason, GameConfig, GameEvent, GameMode, GameResult, GameState, Move,
    MoveFlag, Outcome, PASS_NOTATION, Piece, PieceKind, RULES_VERSION, Seat, SeatStatus, Square,
    Team, leader_under_attack,
};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/// Configuration accepted by `new WasmGame(json)`. Only `mode` is required.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigInput {
    /// `"ffa"` or `"teams"`.
    pub mode: GameMode,
    /// Four civs in seat order; each a slug (latest version) or `{id, version}`.
    /// Default: Canada v1 for every seat.
    #[serde(default)]
    pub civs: Option<[CivInput; 4]>,
    /// En passant on/off (provisional rule). Default `true`.
    #[serde(default)]
    pub en_passant: Option<bool>,
    /// No-progress rounds before the game ends. Default 25.
    #[serde(default)]
    pub move_limit_rounds: Option<u16>,
    /// Must equal the engine's rules version when given. Default: current.
    #[serde(default)]
    pub rules_version: Option<u32>,
}

/// A civ in a config: `"mali"` or `{"id": "mali", "version": 1}`.
#[derive(Deserialize, Debug)]
#[serde(untagged)]
pub enum CivInput {
    /// Latest version of this civ.
    Slug(CivId),
    /// An exact civ version (replays).
    Spec(CivSpecView),
}

impl ConfigInput {
    /// Builds the engine config (validated later by `GameState::new`).
    pub fn into_config(self) -> GameConfig {
        let mut c = GameConfig::new(self.mode);
        if let Some(civs) = self.civs {
            for (slot, civ) in c.civs.iter_mut().zip(civs) {
                *slot = match civ {
                    CivInput::Slug(id) => CivSpec::latest(id),
                    CivInput::Spec(s) => CivSpec {
                        id: s.id,
                        version: s.version,
                    },
                };
            }
        }
        if let Some(ep) = self.en_passant {
            c.en_passant_enabled = ep;
        }
        if let Some(ml) = self.move_limit_rounds {
            c.move_limit_rounds = ml;
        }
        if let Some(rv) = self.rules_version {
            c.rules_version = rv;
        }
        c
    }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/// A civ and its definition version.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CivSpecView {
    /// Civ slug.
    pub id: CivId,
    /// Definition version.
    pub version: u32,
}

/// The game configuration as reported in snapshots. Also valid input for
/// `new WasmGame(json)`.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    /// `"ffa"` or `"teams"`.
    pub mode: GameMode,
    /// Civ per seat.
    pub civs: [CivSpecView; 4],
    /// Whether en passant is enabled.
    pub en_passant: bool,
    /// No-progress rounds before the game ends.
    pub move_limit_rounds: u16,
    /// Rules version.
    pub rules_version: u32,
}

impl From<&GameConfig> for ConfigView {
    fn from(c: &GameConfig) -> Self {
        ConfigView {
            mode: c.mode,
            civs: c.civs.map(|s| CivSpecView {
                id: s.id,
                version: s.version,
            }),
            en_passant: c.en_passant_enabled,
            move_limit_rounds: c.move_limit_rounds,
            rules_version: c.rules_version,
        }
    }
}

/// A piece on the board.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PieceView {
    /// Piece kind.
    pub kind: PieceKind,
    /// Owning seat.
    pub owner: Seat,
}

impl From<Piece> for PieceView {
    fn from(p: Piece) -> Self {
        PieceView {
            kind: p.kind,
            owner: p.owner,
        }
    }
}

/// A seat's castling rights.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CastlingView {
    /// With the long-side rook (South: c1).
    pub long: bool,
    /// With the short-side rook (South: j1).
    pub short: bool,
}

/// A live en passant target.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EpTargetView {
    /// Square the pawn passed over (where an e.p. capturer lands).
    pub skipped: Square,
    /// Square of the double-stepped pawn.
    pub pawn: Square,
}

/// One entry of the defeat order.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DefeatView {
    /// Defeated seat.
    pub seat: Seat,
    /// Why.
    pub reason: DefeatReason,
}

/// How the game ended.
#[derive(Serialize, Debug)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ResultView {
    /// FFA: last civ standing.
    FfaWinner {
        /// The winner.
        seat: Seat,
    },
    /// FFA: move limit; survivors (per seat) tie.
    FfaMoveLimitTie {
        /// Per seat: whether it survived.
        survivors: [bool; 4],
    },
    /// Teams: the other team has no ACTIVE seat.
    TeamsWinner {
        /// The winning team.
        team: Team,
    },
    /// Teams: move limit.
    TeamsDraw,
    /// FFA: draw by agreement; survivors (per seat) tie.
    FfaAgreedDraw {
        /// Per seat: whether it survived (was ACTIVE).
        survivors: [bool; 4],
    },
    /// Teams: draw by agreement (everyone 1st).
    TeamsAgreedDraw,
}

/// Final result and placements (1 = best; ties share a value).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OutcomeView {
    /// What happened.
    pub result: ResultView,
    /// Placement per seat.
    pub placements: [u8; 4],
}

impl From<&Outcome> for OutcomeView {
    fn from(o: &Outcome) -> Self {
        let result = match o.result {
            GameResult::FfaWinner { seat } => ResultView::FfaWinner { seat },
            GameResult::FfaMoveLimitTie { survivors } => ResultView::FfaMoveLimitTie { survivors },
            GameResult::TeamsWinner { team } => ResultView::TeamsWinner { team },
            GameResult::TeamsDraw => ResultView::TeamsDraw,
            GameResult::FfaAgreedDraw { survivors } => ResultView::FfaAgreedDraw { survivors },
            GameResult::TeamsAgreedDraw => ResultView::TeamsAgreedDraw,
        };
        OutcomeView {
            result,
            placements: o.placements,
        }
    }
}

/// Everything a client needs to render and reason about a position.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotView {
    /// Rules version of this game.
    pub rules_version: u32,
    /// Game configuration.
    pub config: ConfigView,
    /// 144 squares, index `rank * 12 + file`.
    pub board: Vec<Option<PieceView>>,
    /// Status per seat.
    pub statuses: [SeatStatus; 4],
    /// Seat on move (meaningless once `isOver`).
    pub seat_to_move: Seat,
    /// Castling rights per seat.
    pub castling: [CastlingView; 4],
    /// Live en passant target per seat.
    pub ep_targets: [Option<EpTargetView>; 4],
    /// Turns since the last capture, pawn move or defeat.
    pub no_progress: u32,
    /// The no-progress value that ends the game.
    pub move_limit: u32,
    /// Turns taken since the start (moves and passes).
    pub ply: u32,
    /// Defeat order, first defeated first.
    pub defeats: Vec<DefeatView>,
    /// Result once the game is over, else `null`.
    pub outcome: Option<OutcomeView>,
    /// Whether the game is over.
    pub is_over: bool,
    /// Zobrist hash, 16 lowercase hex digits.
    pub hash: String,
    /// Per seat: an ACTIVE seat's leader is attacked (information only).
    pub leader_under_attack: [bool; 4],
    /// Per seat: squares of its leader pieces (its civ's leader role), in
    /// square order; empty once it holds none.
    pub leader_squares: [Vec<Square>; 4],
}

impl From<&GameState> for SnapshotView {
    fn from(s: &GameState) -> Self {
        SnapshotView {
            rules_version: RULES_VERSION,
            config: s.config().into(),
            board: s.board().iter().map(|p| p.map(PieceView::from)).collect(),
            statuses: s.statuses(),
            seat_to_move: s.seat_to_move(),
            castling: Seat::ALL.map(|seat| {
                let c = s.castling_rights(seat);
                CastlingView {
                    long: c.long,
                    short: c.short,
                }
            }),
            ep_targets: Seat::ALL.map(|seat| {
                s.ep_target(seat).map(|t| EpTargetView {
                    skipped: t.skipped,
                    pawn: t.pawn,
                })
            }),
            no_progress: s.no_progress(),
            move_limit: s.move_limit(),
            ply: s.ply(),
            defeats: s
                .defeats()
                .iter()
                .map(|r| DefeatView {
                    seat: r.seat,
                    reason: r.reason,
                })
                .collect(),
            outcome: s.outcome().map(OutcomeView::from),
            is_over: s.is_over(),
            hash: format!("{:016x}", s.hash()),
            leader_under_attack: Seat::ALL.map(|seat| leader_under_attack(s, seat)),
            leader_squares: Seat::ALL.map(|seat| s.leader_squares(seat).collect()),
        }
    }
}

/// A legal move of the seat to move.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MoveView {
    /// Move notation, e.g. `"c2c4"`, `"a10a12"`, `"c6c7q"` (what `applyMove` takes).
    pub notation: String,
    /// Origin (castling: the leader's square).
    pub from: Square,
    /// Destination (castling: the leader's destination; e.p.: the skipped square).
    pub to: Square,
    /// Promotion kind, `null` if none.
    pub promotion: Option<PieceKind>,
    /// How the move executes.
    pub flag: MoveFlag,
    /// Kind of the moving piece.
    pub piece: PieceKind,
    /// Whether the move captures (including en passant).
    pub capture: bool,
}

impl MoveView {
    /// Describes `mv`, a legal move in `state`.
    pub fn new(state: &GameState, mv: &Move) -> MoveView {
        MoveView {
            notation: mv.to_string(),
            from: mv.from,
            to: mv.to,
            promotion: mv.promotion,
            flag: mv.flag,
            piece: state.piece_at(mv.from).map_or(PieceKind::Pawn, |p| p.kind),
            capture: mv.flag == MoveFlag::EnPassant
                || (mv.flag != MoveFlag::Castle && state.piece_at(mv.to).is_some()),
        }
    }
}

/// Something that happened while applying an action, in order.
#[derive(Serialize, Debug)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum EventView {
    /// A seat made a move (first event of `applyMove`).
    MoveMade {
        /// Mover.
        seat: Seat,
        /// Move notation.
        notation: String,
        /// Origin.
        from: Square,
        /// Destination.
        to: Square,
        /// Promotion kind or `null`.
        promotion: Option<PieceKind>,
        /// How the move executed.
        flag: MoveFlag,
        /// Moving piece kind (before promotion).
        piece: PieceKind,
    },
    /// A piece was captured.
    Capture {
        /// Capturing seat.
        seat: Seat,
        /// Where the captured piece stood.
        square: Square,
        /// The captured piece.
        captured: PieceView,
    },
    /// The preceding capture was en passant.
    EnPassant {
        /// Capturing seat.
        seat: Seat,
        /// Square of the removed pawn.
        captured_square: Square,
    },
    /// A pawn promoted.
    Promotion {
        /// Promoting seat.
        seat: Seat,
        /// Promotion square.
        square: Square,
        /// New kind.
        kind: PieceKind,
    },
    /// The move was a castle (the leader's part is the `move_made`).
    Castle {
        /// Castling seat.
        seat: Seat,
        /// Rook origin.
        rook_from: Square,
        /// Rook destination.
        rook_to: Square,
    },
    /// A DEFEATED Teams seat had no legal move and passed.
    Pass {
        /// Passing seat.
        seat: Seat,
        /// Always `"--"`.
        notation: &'static str,
    },
    /// An ACTIVE seat was defeated.
    Defeat {
        /// Defeated seat.
        seat: Seat,
        /// Why.
        reason: DefeatReason,
    },
    /// A seat's army was taken off the board.
    ArmyRemoved {
        /// Whose army.
        seat: Seat,
    },
    /// Teams: a seat became FROZEN.
    Frozen {
        /// Frozen seat.
        seat: Seat,
    },
    /// The game ended (always the last event).
    GameEnded {
        /// Result and placements.
        outcome: OutcomeView,
    },
}

impl From<&GameEvent> for EventView {
    fn from(e: &GameEvent) -> Self {
        match *e {
            GameEvent::MoveMade { seat, mv, piece } => EventView::MoveMade {
                seat,
                notation: mv.to_string(),
                from: mv.from,
                to: mv.to,
                promotion: mv.promotion,
                flag: mv.flag,
                piece,
            },
            GameEvent::Capture {
                seat,
                square,
                captured,
            } => EventView::Capture {
                seat,
                square,
                captured: captured.into(),
            },
            GameEvent::EnPassant {
                seat,
                captured_square,
            } => EventView::EnPassant {
                seat,
                captured_square,
            },
            GameEvent::Promotion { seat, square, kind } => {
                EventView::Promotion { seat, square, kind }
            }
            GameEvent::Castle {
                seat,
                rook_from,
                rook_to,
            } => EventView::Castle {
                seat,
                rook_from,
                rook_to,
            },
            GameEvent::Pass { seat } => EventView::Pass {
                seat,
                notation: PASS_NOTATION,
            },
            GameEvent::Defeat { seat, reason } => EventView::Defeat { seat, reason },
            GameEvent::ArmyRemoved { seat } => EventView::ArmyRemoved { seat },
            GameEvent::Frozen { seat } => EventView::Frozen { seat },
            GameEvent::GameEnded { outcome } => EventView::GameEnded {
                outcome: (&outcome).into(),
            },
        }
    }
}

/// Parses a seat name (`"south"`, `"west"`, `"north"`, `"east"`).
pub fn parse_seat(s: &str) -> Result<Seat, String> {
    Seat::ALL
        .into_iter()
        .find(|seat| seat.name() == s)
        .ok_or_else(|| format!("invalid seat {:?}", truncate(s)))
}

/// At most 16 characters of untrusted input, for error messages.
fn truncate(s: &str) -> String {
    s.chars().take(16).collect()
}
