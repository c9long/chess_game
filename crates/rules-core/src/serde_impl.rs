//! `serde` support (feature `serde`).
//!
//! * [`Square`] serializes as its name (`"e4"`).
//! * [`GameState`] serializes as a structured object (config, list of placed
//!   pieces, statuses, castling, en passant targets, seat to move, counters,
//!   defeat order, outcome). Deserializing re-validates everything exactly
//!   like a position string; `outcome` is ignored on input and re-derived.

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::config::GameConfig;
use crate::geometry::{NUM_SQUARES, Seat, Square};
use crate::outcome::Outcome;
use crate::piece::Piece;
use crate::state::{CastlingRights, DefeatRecord, EpTarget, GameState, SeatStatus, StateParts};

impl Serialize for Square {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Square {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(D::Error::custom)
    }
}

#[derive(Serialize, Deserialize)]
struct PlacedPiece {
    square: Square,
    #[serde(flatten)]
    piece: Piece,
}

#[derive(Serialize, Deserialize)]
struct GameStateRepr {
    config: GameConfig,
    pieces: Vec<PlacedPiece>,
    statuses: [SeatStatus; 4],
    castling: [CastlingRights; 4],
    en_passant: [Option<EpTarget>; 4],
    seat_to_move: Seat,
    no_progress: u32,
    ply: u32,
    defeats: Vec<DefeatRecord>,
    #[serde(default, skip_deserializing)]
    outcome: Option<Outcome>,
}

impl Serialize for GameState {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let p = self.to_parts();
        let pieces = p
            .board
            .iter()
            .enumerate()
            .filter_map(|(i, pc)| {
                pc.map(|piece| PlacedPiece {
                    square: Square::from_index(i),
                    piece,
                })
            })
            .collect();
        GameStateRepr {
            config: p.config,
            pieces,
            statuses: p.statuses,
            castling: p.castling,
            en_passant: p.ep,
            seat_to_move: p.to_move,
            no_progress: p.no_progress,
            ply: p.ply,
            defeats: p.defeats,
            outcome: self.outcome().copied(),
        }
        .serialize(s)
    }
}

impl<'de> Deserialize<'de> for GameState {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let r = GameStateRepr::deserialize(d)?;
        let mut board = [None; NUM_SQUARES];
        for pp in r.pieces {
            if board[pp.square.index()].replace(pp.piece).is_some() {
                return Err(D::Error::custom(format!("two pieces on {}", pp.square)));
            }
        }
        if r.defeats.len() > 4 {
            return Err(D::Error::custom("more than four defeats"));
        }
        GameState::from_parts(StateParts {
            config: r.config,
            board,
            statuses: r.statuses,
            castling: r.castling,
            ep: r.en_passant,
            to_move: r.seat_to_move,
            no_progress: r.no_progress,
            ply: r.ply,
            defeats: r.defeats,
        })
        .map_err(D::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use crate::*;

    #[test]
    fn json_round_trip() {
        let mut s = GameState::new(GameConfig::new(GameMode::Teams)).unwrap();
        apply_move(&mut s, parse_move("c2c4").unwrap()).unwrap();
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"square\":\"c4\""), "{json}");
        let back: GameState = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);

        let ev = apply_move(&mut s, parse_move("b3c4").unwrap()).unwrap();
        let ej = serde_json::to_string(&ev).unwrap();
        assert!(ej.contains("\"type\":\"move_made\""), "{ej}");
        let back: Vec<GameEvent> = serde_json::from_str(&ej).unwrap();
        assert_eq!(back, ev);

        let m: Move =
            serde_json::from_str(r#"{"from":"a10","to":"a12","promotion":null}"#).unwrap();
        assert_eq!(m, parse_move("a10a12").unwrap());
        assert!(serde_json::from_str::<Square>("\"m1\"").is_err());
        assert!(serde_json::from_str::<GameState>("{}").is_err());
    }
}
