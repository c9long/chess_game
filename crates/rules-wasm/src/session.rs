//! Target-independent game session: everything `WasmGame` does, with errors
//! as plain strings so it is unit-tested natively (`cargo test`).

use rules_core::{
    GameEvent, GameState, Move, apply_abandon, apply_agreed_draw, apply_move_into, apply_resign,
    apply_timeout, draw_voters, generate_legal_moves, leader_under_attack, parse_move,
    parse_position, perft,
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

    /// A seat that still takes turns resigned (any time); returns the events
    /// as JSON. FFA: that seat's army is removed. Teams: its whole team
    /// resigns and the game ends (the caller collected the partner's consent).
    pub fn apply_resign(&mut self, seat: &str) -> Result<String, String> {
        let seat = parse_seat(seat)?;
        self.events = apply_resign(&mut self.state, seat).map_err(|e| e.to_string())?;
        Ok(self.events_json())
    }

    /// Ends the game in a draw by agreement (the caller collected the votes
    /// of every seat in [`Session::draw_voters`]); returns the events as JSON.
    pub fn apply_agreed_draw(&mut self) -> Result<String, String> {
        self.events = apply_agreed_draw(&mut self.state).map_err(|e| e.to_string())?;
        Ok(self.events_json())
    }

    /// Per seat: whether its agreement is needed for a draw (seats still
    /// taking turns; all `false` once the game is over).
    pub fn draw_voters(&self) -> [bool; 4] {
        draw_voters(&self.state)
    }

    /// [`Session::draw_voters`] as a JSON array of four booleans.
    pub fn draw_voters_json(&self) -> String {
        to_json(&self.draw_voters())
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

    /// Squares of a seat's leader pieces (its civ's leader role), as names.
    pub fn leader_squares(&self, seat: &str) -> Result<Vec<String>, String> {
        let seat = parse_seat(seat)?;
        Ok(self
            .state
            .leader_squares(seat)
            .map(|sq| sq.to_string())
            .collect())
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
                "rulesVersion": 2
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
                r#"{"mode":"ffa","rulesVersion":1}"#,
                "unsupported rules_version 1",
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
                "attackedLeaderSquares",
                "board",
                "castling",
                "config",
                "defeats",
                "epTargets",
                "hash",
                "isOver",
                "leaderSquares",
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
        assert_eq!(board.len(), 256);
        assert_eq!(board[4], json!({"kind": "rook", "owner": "south"})); // e1
        assert_eq!(board[7], json!({"kind": "queen", "owner": "south"})); // h1
        assert_eq!(board[16 * 8], json!({"kind": "king", "owner": "west"})); // a9
        assert_eq!(
            board[16 * 15 + 8],
            json!({"kind": "king", "owner": "north"})
        ); // i16
        assert_eq!(board[255], Value::Null); // p16 (empty corner)
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
        assert_eq!(snap["rulesVersion"], 2);
        assert_eq!(
            snap["leaderUnderAttack"],
            json!([false, false, false, false])
        );
        assert_eq!(
            snap["leaderSquares"],
            json!([["i1"], ["a9"], ["i16"], ["p9"]])
        );
        assert_eq!(snap["attackedLeaderSquares"], json!([[], [], [], []]));
        assert_eq!(s.leader_squares("east").unwrap(), ["p9"]);
        assert_eq!(s.leader_squares("up").unwrap_err(), "invalid seat \"up\"");
        let hash = snap["hash"].as_str().unwrap();
        assert_eq!(hash.len(), 16);
        assert_eq!(hash, format!("{:016x}", s.state().hash()));
    }

    #[test]
    fn moves_and_events_shape() {
        let mut s = Session::from_config_json(r#"{"mode":"ffa"}"#).unwrap();
        let moves = parse(&s.legal_moves_json());
        assert_eq!(moves.as_array().unwrap().len(), 30);
        assert_eq!(s.legal_move_notations().len(), 30);
        let e2e4 = moves
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["notation"] == "e2e4")
            .unwrap();
        assert_eq!(
            e2e4,
            &json!({"notation": "e2e4", "from": "e2", "to": "e4", "promotion": null,
                    "flag": "double_step", "piece": "pawn", "capture": false})
        );
        // No army starts in contact with another: no opening captures.
        assert!(
            moves
                .as_array()
                .unwrap()
                .iter()
                .all(|m| m["capture"] == false)
        );

        let ev = parse(&s.apply_move("f1d2").unwrap());
        assert_eq!(
            ev,
            json!([
                {"type": "move_made", "seat": "south", "notation": "f1d2", "from": "f1",
                 "to": "d2", "promotion": null, "flag": "normal", "piece": "knight"}
            ])
        );
        let snap = parse(&s.snapshot_json());
        assert_eq!(snap["seatToMove"], "west");
        assert_eq!(snap["ply"], 1);
    }

    #[test]
    fn en_passant_and_castle_events() {
        // South e2 pawn, West d4 pawn (attacks e3), kings on their homes.
        let mut s = Session::from_position(
            "ffa 8nK7/16/16/16/16/16/16/wK14eK/16/16/16/16/3wP12/16/4sP11/8sK7 S AAAA - - 0 0",
        )
        .unwrap();
        s.apply_move("e2e4").unwrap();
        let snap = parse(&s.snapshot_json());
        assert_eq!(snap["epTargets"][0], json!({"skipped": "e3", "pawn": "e4"}));
        let moves = parse(&s.legal_moves_json());
        let ep = moves
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["notation"] == "d4e3")
            .unwrap();
        assert_eq!(ep["flag"], "en_passant");
        assert_eq!(ep["capture"], true);
        let ev = parse(&s.apply_move("d4e3").unwrap());
        assert_eq!(ev[1]["type"], "capture");
        assert_eq!(ev[1]["square"], "e4");
        assert_eq!(
            ev[2],
            json!({"type": "en_passant", "seat": "west", "capturedSquare": "e4"})
        );

        // Castling: South king i1 -> k1 with an empty j1/k1.
        let mut s = Session::from_position(
            "ffa 4nRnNnBnQnKnBnNnR4/4nPnPnPnPnPnPnPnP4/16/16/wRwP12ePeR/wNwP12ePeN/wBwP12ePeB/wKwP12ePeK/wQwP12ePeQ/wBwP12ePeB/wNwP12ePeN/wRwP12ePeR/16/16/4sPsPsPsPsPsPsPsP4/4sRsNsBsQsK2sR4 S AAAA Se1,Sl1,Wa5,Wa12,Ne16,Nl16,Ep5,Ep12 - 0 0",
        )
        .unwrap();
        let moves = parse(&s.legal_moves_json());
        let castle = moves
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["notation"] == "i1k1")
            .unwrap();
        assert_eq!(castle["flag"], "castle");
        assert_eq!(castle["capture"], false);
        let ev = parse(&s.apply_move("i1k1").unwrap());
        assert_eq!(
            ev[1],
            json!({"type": "castle", "seat": "south", "rookFrom": "l1", "rookTo": "j1"})
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
        assert_eq!(s.apply_move("e2e3").unwrap_err(), "the game is over");

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
    fn resign_and_agreed_draw() {
        // Teams: North leaves alone (abandon) and freezes; South keeps the turn.
        let mut s = Session::from_config_json(r#"{"mode":"teams"}"#).unwrap();
        assert_eq!(
            parse(&s.draw_voters_json()),
            json!([true, true, true, true])
        );
        let ev = parse(&s.apply_abandon("north").unwrap());
        assert_eq!(
            ev,
            json!([
                {"type": "defeat", "seat": "north", "reason": "abandon"},
                {"type": "frozen", "seat": "north"}
            ])
        );
        assert_eq!(parse(&s.snapshot_json())["seatToMove"], "south");
        assert_eq!(
            parse(&s.draw_voters_json()),
            json!([true, true, false, true])
        );
        assert!(
            s.apply_resign("north")
                .unwrap_err()
                .contains("no longer takes turns")
        );
        assert_eq!(s.apply_resign("up").unwrap_err(), "invalid seat \"up\"");
        let ev = parse(&s.apply_agreed_draw().unwrap());
        assert_eq!(
            ev,
            json!([{"type": "game_ended", "outcome": {
                "result": {"type": "teams_agreed_draw"},
                "placements": [1, 1, 1, 1]
            }}])
        );
        assert_eq!(
            parse(&s.draw_voters_json()),
            json!([false, false, false, false])
        );
        assert_eq!(s.apply_agreed_draw().unwrap_err(), "the game is over");
        assert_eq!(s.apply_resign("south").unwrap_err(), "the game is over");
        let text = s.position_string();
        assert!(text.ends_with(" end=draw"), "{text}");
        let back = Session::from_position(&text).unwrap();
        assert_eq!(back.state(), s.state());
        assert_eq!(back.snapshot_json(), s.snapshot_json());

        // Teams: a resignation (off turn) resigns the whole team; the other
        // team wins.
        let mut s = Session::from_config_json(r#"{"mode":"teams"}"#).unwrap();
        let ev = parse(&s.apply_resign("north").unwrap());
        assert_eq!(
            ev,
            json!([
                {"type": "defeat", "seat": "north", "reason": "resign"},
                {"type": "frozen", "seat": "north"},
                {"type": "defeat", "seat": "south", "reason": "resign"},
                {"type": "frozen", "seat": "south"},
                {"type": "army_removed", "seat": "south"},
                {"type": "army_removed", "seat": "north"},
                {"type": "game_ended", "outcome": {
                    "result": {"type": "teams_winner", "team": "west_east"},
                    "placements": [2, 1, 2, 1]
                }}
            ])
        );
        let snap = parse(&s.snapshot_json());
        assert_eq!(
            snap["defeats"],
            json!([{"seat": "north", "reason": "resign"}, {"seat": "south", "reason": "resign"}])
        );
        let back = Session::from_position(&s.position_string()).unwrap();
        assert_eq!(back.state(), s.state());

        // FFA: survivors share 1st, the resigned seat is last.
        let mut s = Session::from_config_json(r#"{"mode":"ffa"}"#).unwrap();
        let ev = parse(&s.apply_resign("south").unwrap());
        assert_eq!(ev[1], json!({"type": "army_removed", "seat": "south"}));
        assert_eq!(parse(&s.snapshot_json())["seatToMove"], "west");
        let ev = parse(&s.apply_agreed_draw().unwrap());
        assert_eq!(
            ev[0]["outcome"],
            json!({
                "result": {"type": "ffa_agreed_draw", "survivors": [false, true, true, true]},
                "placements": [4, 1, 1, 1]
            })
        );
    }

    #[test]
    fn errors_and_misc() {
        let mut s = Session::from_config_json(r#"{"mode":"ffa"}"#).unwrap();
        assert_eq!(s.apply_move("e2e5").unwrap_err(), "illegal move e2e5");
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
        assert_eq!(s.perft(3).unwrap(), 27_000);
        assert!(s.perft(7).is_err());
    }

    #[test]
    fn england_prime_ministers_on_the_wire() {
        // A slug means the latest version: England v2 with four Prime Ministers.
        let mut s = Session::from_config_json(
            r#"{"mode":"ffa","civs":["england","canada","canada","canada"]}"#,
        )
        .unwrap();
        let snap = parse(&s.snapshot_json());
        assert_eq!(
            snap["config"]["civs"][0],
            json!({"id": "england", "version": 2})
        );
        assert_eq!(
            snap["config"]["civs"][1],
            json!({"id": "canada", "version": 1})
        );
        let board = snap["board"].as_array().unwrap();
        for i in [5, 7, 8, 10] {
            assert_eq!(
                board[i],
                json!({"kind": "prime_minister", "owner": "south"})
            );
        }
        assert_eq!(snap["leaderSquares"][0], json!(["f1", "h1", "i1", "k1"]));
        assert_eq!(snap["castling"][0], json!({"long": false, "short": false}));
        let moves = s.legal_moves();
        assert_eq!(moves.len(), 34);
        let pm: Vec<&MoveView> = moves
            .iter()
            .filter(|m| m.piece == rules_core::PieceKind::PrimeMinister)
            .collect();
        assert_eq!(pm.len(), 10);
        let json = s.legal_moves_json();
        assert!(json.contains(r#""piece":"prime_minister""#), "{json}");
        let ev = parse(&s.apply_move("f1e3").unwrap());
        assert_eq!(ev[0]["piece"], "prime_minister");
        assert!(s.position_string().contains("sM"));
        assert!(s.position_string().contains("civ=england.2,"));
        // An exact old version still works (replays of England v1 games).
        let old = Session::from_config_json(
            r#"{"mode":"ffa","civs":[{"id":"england","version":1},"canada","canada","canada"]}"#,
        )
        .unwrap();
        let snap = parse(&old.snapshot_json());
        assert_eq!(snap["board"][8], json!({"kind": "king", "owner": "south"}));
        assert_eq!(
            snap["config"]["civs"][0],
            json!({"id": "england", "version": 1})
        );
        assert!(Session::from_config_json(
            r#"{"mode":"ffa","civs":[{"id":"england","version":3},"canada","canada","canada"]}"#,
        )
        .is_err());
        // Only the attacked Prime Minister is listed: West's rook on rank 3.
        let pos = "ffa wK14nK/16/16/16/16/16/16/16/16/16/16/16/16/2sM9wR3/16/5sM4sM4eK W AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1";
        let s = Session::from_position(pos).unwrap();
        let snap = parse(&s.snapshot_json());
        assert_eq!(
            snap["leaderUnderAttack"],
            json!([true, false, false, false])
        );
        assert_eq!(snap["attackedLeaderSquares"], json!([["c3"], [], [], []]));
        assert_eq!(snap["leaderSquares"][0], json!(["f1", "k1", "c3"]));
    }

    #[test]
    fn pass_event_shape() {
        // Teams: North DEFEATED and boxed in passes; East FROZEN is skipped.
        let mut s = Session::from_position(
            "teams nKnB14/nPnPnP13/sRsNsB13/16/16/16/16/wK14eK/16/16/16/16/16/16/16/8sK7 W AADF - - 0 0 def=Ns,Et",
        )
        .unwrap();
        let ev = parse(&s.apply_move("a9b9").unwrap());
        assert_eq!(
            ev[1],
            json!({"type": "pass", "seat": "north", "notation": "--"})
        );
        assert_eq!(parse(&s.snapshot_json())["seatToMove"], "south");
    }
}
