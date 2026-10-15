//! Target-independent game session: everything `WasmGame` does, with errors
//! as plain strings so it is unit-tested natively (`cargo test`).

use rules_core::{
    GameEvent, GameState, Move, apply_abandon, apply_move_into, apply_timeout,
    generate_legal_moves, leader_under_attack, parse_move, parse_position, perft,
};

use crate::dto::{ConfigInput, EventView, MoveView, SnapshotView, parse_seat};

/// A game plus reusable buffers.
#[derive(Clone)]
pub struct Session {
    state: GameState,
    moves: Vec<Move>,
    events: Vec<GameEvent>,
}

fn to_json<T: serde::Serialize>(v: &T) -> String {
    // Serializing these plain data types cannot fail.
    serde_json::to_string(v).unwrap_or_else(|_| String::from("null"))
}

impl Session {
    fn with_state(state: GameState) -> Session {
        Session {
            state,
            moves: Vec::with_capacity(64),
            events: Vec::with_capacity(8),
        }
    }

    /// New game from a JSON config (see [`ConfigInput`]).
    pub fn from_config_json(json: &str) -> Result<Session, String> {
        let input: ConfigInput =
            serde_json::from_str(json).map_err(|e| format!("invalid config: {e}"))?;
        let state = GameState::new(input.into_config()).map_err(|e| e.to_string())?;
        Ok(Session::with_state(state))
    }

    /// Game from a position string.
    pub fn from_position(text: &str) -> Result<Session, String> {
        let state = parse_position(text).map_err(|e| format!("invalid position: {e}"))?;
        Ok(Session::with_state(state))
    }

    /// The underlying state.
    pub fn state(&self) -> &GameState {
        &self.state
    }

    /// Legal moves of the seat to move (empty once the game is over).
    pub fn legal_moves(&mut self) -> Vec<MoveView> {
        generate_legal_moves(&self.state, &mut self.moves);
        self.moves
            .iter()
            .map(|m| MoveView::new(&self.state, m))
            .collect()
    }

    /// [`Session::legal_moves`] as a JSON array.
    pub fn legal_moves_json(&mut self) -> String {
        to_json(&self.legal_moves())
    }

    /// Legal move notations only (cheaper).
    pub fn legal_move_notations(&mut self) -> Vec<String> {
        generate_legal_moves(&self.state, &mut self.moves);
        self.moves.iter().map(Move::to_string).collect()
    }

    fn events_json(&self) -> String {
        to_json(&self.events.iter().map(EventView::from).collect::<Vec<_>>())
    }

    /// Applies a move given in notation; returns the events as JSON.
    pub fn apply_move(&mut self, notation: &str) -> Result<String, String> {
        let mv = parse_move(notation).map_err(|e| e.to_string())?;
        self.events.clear();
        apply_move_into(&mut self.state, mv, &mut self.events).map_err(|e| e.to_string())?;
        Ok(self.events_json())
    }

    /// The seat to move ran out of time; returns the events as JSON.
    pub fn apply_timeout(&mut self, seat: &str) -> Result<String, String> {
        let seat = parse_seat(seat)?;
        self.events = apply_timeout(&mut self.state, seat).map_err(|e| e.to_string())?;
        Ok(self.events_json())
    }

    /// A seat abandoned; returns the events as JSON.
    pub fn apply_abandon(&mut self, seat: &str) -> Result<String, String> {
        let seat = parse_seat(seat)?;
        self.events = apply_abandon(&mut self.state, seat).map_err(|e| e.to_string())?;
        Ok(self.events_json())
    }

    /// Full view of the position as JSON.
    pub fn snapshot_json(&self) -> String {
        to_json(&SnapshotView::from(&self.state))
    }

    /// Position string (round-trips through [`Session::from_position`]).
    pub fn position_string(&self) -> String {
        self.state.to_position_string()
    }

    /// Whether an ACTIVE seat's leader is attacked.
    pub fn leader_under_attack(&self, seat: &str) -> Result<bool, String> {
        Ok(leader_under_attack(&self.state, parse_seat(seat)?))
    }

    /// Native perft (for parity checks against the JS-side perft).
    pub fn perft(&self, depth: u32) -> Result<u64, String> {
        if depth > 6 {
            return Err(format!("perft depth {depth} is too deep (max 6)"));
        }
        Ok(perft(&self.state, depth))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn parse(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    fn keys(v: &Value) -> Vec<&str> {
        let mut k: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        k.sort_unstable();
        k
    }

    #[test]
    fn config_defaults_and_options() {
        let s = Session::from_config_json(r#"{"mode":"ffa"}"#).unwrap();
        let snap = parse(&s.snapshot_json());
        assert_eq!(
            snap["config"],
            json!({
                "mode": "ffa",
                "civs": [
                    {"id": "canada", "version": 1},
                    {"id": "canada", "version": 1},
                    {"id": "canada", "version": 1},
                    {"id": "canada", "version": 1}
                ],
                "enPassant": true,
                "moveLimitRounds": 25,
                "rulesVersion": 1
            })
        );

        let s = Session::from_config_json(
            r#"{"mode":"teams","civs":["mali","japan",{"id":"france","version":1},"usa"],"enPassant":false,"moveLimitRounds":10}"#,
        )
        .unwrap();
        let snap = parse(&s.snapshot_json());
        assert_eq!(snap["config"]["mode"], "teams");
        assert_eq!(snap["config"]["civs"][0]["id"], "mali");
        assert_eq!(snap["config"]["civs"][2]["id"], "france");
        assert_eq!(snap["config"]["enPassant"], false);
        assert_eq!(snap["moveLimit"], 40);
        assert!(s.position_string().contains("ep=off ml=10"));

        // The snapshot's config is itself valid input.
        let again = Session::from_config_json(&snap["config"].to_string()).unwrap();
        assert_eq!(again.state(), s.state());
    }

    #[test]
    fn config_errors() {
        for (json, needle) in [
            (r#"{"mode":"duel"}"#, "unknown variant"),
            (r#"{"mode":"ffa","bogus":1}"#, "unknown field"),
            (
                r#"{"civs":["mali","mali","mali","mali"]}"#,
                "missing field `mode`",
            ),
            (r#"{"mode":"ffa","civs":["mali"]}"#, "invalid config"),
            (r#"{"mode":"ffa","moveLimitRounds":0}"#, "move_limit_rounds"),
            (
                r#"{"mode":"ffa","rulesVersion":2}"#,
                "unsupported rules_version 2",
            ),
            (
                r#"{"mode":"ffa","civs":[{"id":"mali","version":9},"mali","mali","mali"]}"#,
                "unknown civ version",
            ),
            ("not json", "invalid config"),
        ] {
            let err = Session::from_config_json(json).err().unwrap();
            assert!(err.contains(needle), "{json}: {err}");
        }
    }

    #[test]
    fn snapshot_shape() {
        let s = Session::from_config_json(r#"{"mode":"ffa"}"#).unwrap();
        let snap = parse(&s.snapshot_json());
        assert_eq!(
            keys(&snap),
            [
                "board",
                "castling",
                "config",
                "defeats",
                "epTargets",
                "hash",
                "isOver",
                "leaderUnderAttack",
                "moveLimit",
                "noProgress",
                "outcome",
                "ply",
                "rulesVersion",
                "seatToMove",
                "statuses"
            ]
        );
        let board = snap["board"].as_array().unwrap();
        assert_eq!(board.len(), 144);
        assert_eq!(board[2], json!({"kind": "rook", "owner": "south"})); // c1
        assert_eq!(board[5], json!({"kind": "queen", "owner": "south"})); // f1
        assert_eq!(board[12 * 6], json!({"kind": "king", "owner": "west"})); // a7
        assert_eq!(
            board[12 * 11 + 6],
            json!({"kind": "king", "owner": "north"})
        ); // g12
        assert_eq!(board[0], Value::Null);
        assert_eq!(
            snap["statuses"],
            json!(["active", "active", "active", "active"])
        );
        assert_eq!(snap["seatToMove"], "south");
        assert_eq!(snap["castling"][0], json!({"long": true, "short": true}));
        assert_eq!(snap["epTargets"], json!([null, null, null, null]));
        assert_eq!(snap["defeats"], json!([]));
        assert_eq!(snap["outcome"], Value::Null);
        assert_eq!(snap["isOver"], false);
        assert_eq!(snap["noProgress"], 0);
        assert_eq!(snap["moveLimit"], 100);
        assert_eq!(snap["ply"], 0);
        assert_eq!(snap["rulesVersion"], 1);
        assert_eq!(
            snap["leaderUnderAttack"],
            json!([false, false, false, false])
        );
        let hash = snap["hash"].as_str().unwrap();
        assert_eq!(hash.len(), 16);
        assert_eq!(hash, format!("{:016x}", s.state().hash()));
    }

    #[test]
    fn moves_and_events_shape() {
        let mut s = Session::from_config_json(r#"{"mode":"ffa"}"#).unwrap();
        let moves = parse(&s.legal_moves_json());
        assert_eq!(moves.as_array().unwrap().len(), 28);
        assert_eq!(s.legal_move_notations().len(), 28);
        let c2c4 = moves
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["notation"] == "c2c4")
            .unwrap();
        assert_eq!(
            c2c4,
            &json!({"notation": "c2c4", "from": "c2", "to": "c4", "promotion": null,
                    "flag": "double_step", "piece": "pawn", "capture": false})
        );
        let c2b3 = moves
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["notation"] == "c2b3")
            .unwrap();
        assert_eq!(c2b3["capture"], true);

        let ev = parse(&s.apply_move("c2b3").unwrap());
        assert_eq!(
            ev,
            json!([
                {"type": "move_made", "seat": "south", "notation": "c2b3", "from": "c2",
                 "to": "b3", "promotion": null, "flag": "normal", "piece": "pawn"},
                {"type": "capture", "seat": "south", "square": "b3",
                 "captured": {"kind": "pawn", "owner": "west"}}
            ])
        );
        let snap = parse(&s.snapshot_json());
        assert_eq!(snap["seatToMove"], "west");
        assert_eq!(snap["ply"], 1);
    }

    #[test]
    fn en_passant_and_castle_events() {
        let mut s = Session::from_config_json(r#"{"mode":"ffa"}"#).unwrap();
        s.apply_move("c2c4").unwrap();
        let snap = parse(&s.snapshot_json());
        assert_eq!(snap["epTargets"][0], json!({"skipped": "c3", "pawn": "c4"}));
        let moves = parse(&s.legal_moves_json());
        let ep = moves
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["notation"] == "b4c3")
            .unwrap();
        assert_eq!(ep["flag"], "en_passant");
        assert_eq!(ep["capture"], true);
        let ev = parse(&s.apply_move("b4c3").unwrap());
        assert_eq!(ev[1]["type"], "capture");
        assert_eq!(ev[1]["square"], "c4");
        assert_eq!(
            ev[2],
            json!({"type": "en_passant", "seat": "west", "capturedSquare": "c4"})
        );

        // Castling: South king g1 -> i1 with an empty h1/i1.
        let mut s = Session::from_position(
            "ffa 2nRnNnBnQnKnBnNnR2/2nPnPnPnPnPnPnPnP2/wRwP8ePeR/wNwP8ePeN/wBwP8ePeB/wKwP8ePeK/wQwP8ePeQ/wBwP8ePeB/wNwP8ePeN/wRwP8ePeR/2sPsPsPsPsPsPsPsP2/2sRsNsBsQsK2sR2 S AAAA Sc1,Sj1,Wa3,Wa10,Nc12,Nj12,El3,El10 - 0 0",
        )
        .unwrap();
        let moves = parse(&s.legal_moves_json());
        let castle = moves
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["notation"] == "g1i1")
            .unwrap();
        assert_eq!(castle["flag"], "castle");
        assert_eq!(castle["capture"], false);
        let ev = parse(&s.apply_move("g1i1").unwrap());
        assert_eq!(
            ev[1],
            json!({"type": "castle", "seat": "south", "rookFrom": "j1", "rookTo": "h1"})
        );
    }

    #[test]
    fn timeout_abandon_and_outcome() {
        let mut s = Session::from_config_json(r#"{"mode":"teams"}"#).unwrap();
        let ev = parse(&s.apply_timeout("south").unwrap());
        assert_eq!(
            ev,
            json!([
                {"type": "defeat", "seat": "south", "reason": "timeout"},
                {"type": "frozen", "seat": "south"}
            ])
        );
        assert!(
            s.apply_timeout("south")
                .unwrap_err()
                .contains("not on move")
        );
        assert!(
            s.apply_abandon("south")
                .unwrap_err()
                .contains("no longer takes turns")
        );
        let ev = parse(&s.apply_abandon("north").unwrap());
        let last = ev.as_array().unwrap().last().unwrap();
        assert_eq!(
            last,
            &json!({"type": "game_ended", "outcome": {
                "result": {"type": "teams_winner", "team": "west_east"},
                "placements": [2, 1, 2, 1]
            }})
        );
        let snap = parse(&s.snapshot_json());
        assert_eq!(snap["isOver"], true);
        assert_eq!(
            snap["statuses"],
            json!(["frozen", "active", "frozen", "active"])
        );
        assert_eq!(
            snap["defeats"],
            json!([{"seat": "south", "reason": "timeout"}, {"seat": "north", "reason": "abandon"}])
        );
        assert_eq!(snap["outcome"]["placements"], json!([2, 1, 2, 1]));
        assert_eq!(s.legal_moves().len(), 0);
        assert_eq!(s.apply_move("c2c3").unwrap_err(), "the game is over");

        // FFA: removal and a winner.
        let mut s = Session::from_config_json(r#"{"mode":"ffa"}"#).unwrap();
        let ev = parse(&s.apply_timeout("south").unwrap());
        assert_eq!(ev[1], json!({"type": "army_removed", "seat": "south"}));
        s.apply_abandon("north").unwrap();
        let ev = parse(&s.apply_abandon("east").unwrap());
        let last = ev.as_array().unwrap().last().unwrap();
        assert_eq!(
            last["outcome"]["result"],
            json!({"type": "ffa_winner", "seat": "west"})
        );
        assert_eq!(last["outcome"]["placements"], json!([4, 1, 3, 2]));
    }

    #[test]
    fn errors_and_misc() {
        let mut s = Session::from_config_json(r#"{"mode":"ffa"}"#).unwrap();
        assert_eq!(s.apply_move("c2c5").unwrap_err(), "illegal move c2c5");
        assert_eq!(s.apply_move("zz").unwrap_err(), "invalid move \"zz\"");
        assert_eq!(s.apply_timeout("up").unwrap_err(), "invalid seat \"up\"");
        assert!(s.leader_under_attack("south").is_ok());
        assert!(
            Session::from_position("ffa nonsense")
                .err()
                .unwrap()
                .starts_with("invalid position: ")
        );
        let text = s.position_string();
        assert_eq!(Session::from_position(&text).unwrap().state(), s.state());
        assert_eq!(s.perft(3).unwrap(), 21_560);
        assert!(s.perft(7).is_err());
    }

    #[test]
    fn pass_event_shape() {
        // Teams: North DEFEATED and boxed in passes; East FROZEN is skipped.
        let mut s = Session::from_position(
            "teams nKnB10/nPnPnP9/sRsNsB9/12/12/wK10eK/12/12/12/12/12/6sK5 W AADF - - 0 0 def=Ns,Et",
        )
        .unwrap();
        let ev = parse(&s.apply_move("a7b7").unwrap());
        assert_eq!(
            ev[1],
            json!({"type": "pass", "seat": "north", "notation": "--"})
        );
        assert_eq!(parse(&s.snapshot_json())["seatToMove"], "south");
    }
}
