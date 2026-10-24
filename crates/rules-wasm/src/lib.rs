//! WebAssembly bindings for [`rules_core`], used by the browser and the Node
//! server through `packages/rules` (`@game/rules`).
//!
//! The JS-facing surface is deliberately small: one class, [`WasmGame`],
//! whose structured results are **JSON strings** in the wire format defined
//! in [`dto`] (camelCase keys, snake_case enum values). `@game/rules` parses
//! them into typed objects. Every error is thrown as a JS `Error` whose
//! message is the engine's error message (e.g. `"illegal move e2e5"`).
//!
//! All logic lives in [`session::Session`], which is target-independent and
//! unit-tested natively; this module only adapts it to wasm-bindgen.

pub mod dto;
pub mod session;

use wasm_bindgen::prelude::*;

use crate::session::Session;

fn js_err(msg: String) -> JsError {
    JsError::new(&msg)
}

/// Rules version implemented by this build.
#[wasm_bindgen(js_name = rulesVersion)]
pub fn rules_version() -> u32 {
    rules_core::RULES_VERSION
}

/// The oldest rules version this build still plays (replays of older games).
#[wasm_bindgen(js_name = minSupportedRulesVersion)]
pub fn min_supported_rules_version() -> u32 {
    rules_core::MIN_SUPPORTED_RULES_VERSION
}

/// A game in progress. Call `free()` when done (or rely on the finalizer).
#[wasm_bindgen]
pub struct WasmGame {
    inner: Session,
}

#[wasm_bindgen]
impl WasmGame {
    /// New game from a JSON config: `{"mode": "ffa" | "teams", "civs"?: [...4],
    /// "enPassant"?: bool, "moveLimitRounds"?: number, "rulesVersion"?: number}`.
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str) -> Result<WasmGame, JsError> {
        Session::from_config_json(config_json)
            .map(|inner| WasmGame { inner })
            .map_err(js_err)
    }

    /// Game from a position string.
    #[wasm_bindgen(js_name = fromPosition)]
    pub fn from_position(text: &str) -> Result<WasmGame, JsError> {
        Session::from_position(text)
            .map(|inner| WasmGame { inner })
            .map_err(js_err)
    }

    /// An independent copy of this game.
    #[wasm_bindgen(js_name = clone)]
    pub fn clone_game(&self) -> WasmGame {
        WasmGame {
            inner: self.inner.clone(),
        }
    }

    /// Legal moves of the seat to move as a JSON array of move objects.
    #[wasm_bindgen(js_name = legalMoves)]
    pub fn legal_moves(&mut self) -> String {
        self.inner.legal_moves_json()
    }

    /// Legal moves of the seat to move as notation strings.
    #[wasm_bindgen(js_name = legalMoveNotations)]
    pub fn legal_move_notations(&mut self) -> Vec<String> {
        self.inner.legal_move_notations()
    }

    /// The moves `seat` could make if it were on move now (premoves), as a JSON array of
    /// move objects; empty when the seat no longer takes turns or the game is over.
    #[wasm_bindgen(js_name = movesForSeat)]
    pub fn moves_for_seat(&mut self, seat: &str) -> Result<String, JsError> {
        self.inner.moves_for_seat_json(seat).map_err(js_err)
    }

    /// Applies a move in notation (`"e2e4"`, `"e8e9q"`); returns events JSON.
    #[wasm_bindgen(js_name = applyMove)]
    pub fn apply_move(&mut self, notation: &str) -> Result<String, JsError> {
        self.inner.apply_move(notation).map_err(js_err)
    }

    /// The seat to move ran out of time; returns events JSON.
    #[wasm_bindgen(js_name = applyTimeout)]
    pub fn apply_timeout(&mut self, seat: &str) -> Result<String, JsError> {
        self.inner.apply_timeout(seat).map_err(js_err)
    }

    /// A seat that still takes turns abandoned; returns events JSON.
    #[wasm_bindgen(js_name = applyAbandon)]
    pub fn apply_abandon(&mut self, seat: &str) -> Result<String, JsError> {
        self.inner.apply_abandon(seat).map_err(js_err)
    }

    /// A seat that still takes turns resigned (any time); returns events JSON.
    /// FFA: that seat's army is removed. Teams: its whole team resigns and the
    /// game ends (the caller collects the partner's consent first).
    #[wasm_bindgen(js_name = applyResign)]
    pub fn apply_resign(&mut self, seat: &str) -> Result<String, JsError> {
        self.inner.apply_resign(seat).map_err(js_err)
    }

    /// Ends the game in a draw by agreement; returns events JSON. The caller
    /// collects the votes (see `drawVoters`).
    #[wasm_bindgen(js_name = applyAgreedDraw)]
    pub fn apply_agreed_draw(&mut self) -> Result<String, JsError> {
        self.inner.apply_agreed_draw().map_err(js_err)
    }

    /// JSON array of four booleans: the seats whose agreement a draw needs.
    #[wasm_bindgen(js_name = drawVoters)]
    pub fn draw_voters(&self) -> String {
        self.inner.draw_voters_json()
    }

    /// Full view of the position as JSON.
    pub fn snapshot(&self) -> String {
        self.inner.snapshot_json()
    }

    /// Position string (round-trips through `fromPosition`).
    #[wasm_bindgen(js_name = positionString)]
    pub fn position_string(&self) -> String {
        self.inner.position_string()
    }

    /// Whether an ACTIVE seat's leader is attacked (information only).
    #[wasm_bindgen(js_name = leaderUnderAttack)]
    pub fn leader_under_attack(&self, seat: &str) -> Result<bool, JsError> {
        self.inner.leader_under_attack(seat).map_err(js_err)
    }

    /// Squares of a seat's leader pieces (its civ's leader role), any status.
    #[wasm_bindgen(js_name = leaderSquares)]
    pub fn leader_squares(&self, seat: &str) -> Result<Vec<String>, JsError> {
        self.inner.leader_squares(seat).map_err(js_err)
    }

    /// Native (in-WASM) perft, depth at most 6.
    pub fn perft(&self, depth: u32) -> Result<f64, JsError> {
        // Counts up to depth 6 are far below 2^53, so f64 is exact.
        self.inner.perft(depth).map(|n| n as f64).map_err(js_err)
    }
}
