//! Compact, human-readable position strings.
//!
//! A position string round-trips every [`GameState`] field needed to continue
//! play. It is used for tests, perft fixtures and the bot-service protocol.
//! Fields are separated by single spaces:
//!
//! ```text
//! <mode> <board> <to-move> <statuses> <castling> <en-passant> <no-progress> <ply> [key=value ...]
//! ```
//!
//! | Field | Format | Example |
//! |---|---|---|
//! | mode | `ffa` or `teams` | `ffa` |
//! | board | 16 ranks from rank 16 down to rank 1, separated by `/`. Each rank lists files `a`..`p`: a piece is two characters, seat letter (`s w n e`, lowercase) + kind letter (`P N B R Q K M`, uppercase; `M` = Prime Minister, only on a seat whose civ roster has it, e.g. `england.2`); a number `1`..`16` is that many empty squares. Each rank must total 16. | `4sRsNsBsQsKsBsNsR4` |
//! | to-move | seat letter `S W N E` | `S` |
//! | statuses | 4 letters in seat order S, W, N, E: `A`ctive, `D`efeated, `F`rozen, `R`emoved | `AAAA` |
//! | castling | comma list of seat letter + home square of a rook it may still castle with, or `-` | `Se1,Sl1,Wa5` |
//! | en-passant | comma list of seat letter + skipped square of that seat's live double-step, or `-`. Never the seat to move (its target expired when the turn reached it). | `Sf3` |
//! | no-progress | turns since last capture, pawn move or defeat | `0` |
//! | ply | turns taken since the start (moves + passes) | `0` |
//!
//! Optional trailing `key=value` fields (each at most once, any order; the
//! formatter always writes `ep` to `rv` in this order, and `end` after them
//! only when it applies):
//!
//! | Key | Value | Default |
//! |---|---|---|
//! | `ep` | `on` / `off` — en passant enabled | `on` |
//! | `ml` | move-limit rounds (≥ 1) | `25` |
//! | `civ` | four `slug.version` in seat order | `canada.1` ×4 |
//! | `def` | defeat order: comma list of seat letter + reason letter (`l` leader captured, `s` stalemate, `t` timeout, `a` abandon, `r` resign), or `-` | `-` |
//! | `rv` | rules version (only the current version, `2`, parses; 12×12 version-1 positions are rejected) | `2` |
//! | `end` | `draw` — the game ended in a draw by agreement ([`crate::apply_agreed_draw`]). Only valid if the game is not otherwise over (no elimination, move limit not reached) and the seat to move could still play. | absent |
//!
//! Resignations need no extra field: a resigned seat is `R` (FFA) or `F`
//! (Teams) in the statuses, and an ACTIVE seat that resigned is listed in
//! `def` with reason `r`.
//!
//! The start position (FFA) is:
//!
//! ```text
//! ffa 4nRnNnBnQnKnBnNnR4/4nPnPnPnPnPnPnPnP4/16/16/wRwP12ePeR/wNwP12ePeN/wBwP12ePeB/wKwP12ePeK/wQwP12ePeQ/wBwP12ePeB/wNwP12ePeN/wRwP12ePeR/16/16/4sPsPsPsPsPsPsPsP4/4sRsNsBsQsKsBsNsR4 S AAAA Se1,Sl1,Wa5,Wa12,Ne16,Nl16,Ep5,Ep12 - 0 0 ep=on ml=25 civ=canada.1,canada.1,canada.1,canada.1 def=- rv=2
//! ```
//!
//! The result is not stored: it is derived from statuses, defeat order,
//! counters and the `end` marker ([`crate::outcome::derive_outcome`]). Parsing validates the whole
//! state (pieces in rosters, no pieces for REMOVED seats, pawns behind their
//! promotion line, ACTIVE seats holding a leader, castling only for ACTIVE
//! seats, defeat order matching statuses, and — unless the game is over —
//! the seat to move taking turns and having a legal move).

use core::fmt::Write as _;

use crate::RULES_VERSION;
use crate::civ::CivId;
use crate::config::{CivSpec, GameConfig, GameMode};
use crate::error::{PositionError, perr as err};
use crate::geometry::{BOARD_SIZE, NUM_SQUARES, Seat, Square};
use crate::piece::{Piece, PieceKind};
use crate::setup::{self, CastleSide};
use crate::state::{
    CastlingRights, DefeatReason, DefeatRecord, EpTarget, GameState, SeatStatus, StateParts,
};

/// Formats `state` as a position string.
pub fn format_position(state: &GameState) -> String {
    let mut out = String::with_capacity(256);
    out.push_str(state.mode().name());
    out.push(' ');
    for rank in (0..BOARD_SIZE).rev() {
        let mut empty = 0;
        for file in 0..BOARD_SIZE {
            let piece = Square::from_coords(file, rank).and_then(|sq| state.piece_at(sq));
            match piece {
                None => empty += 1,
                Some(p) => {
                    if empty > 0 {
                        let _ = write!(out, "{empty}");
                        empty = 0;
                    }
                    out.push(p.owner.letter().to_ascii_lowercase());
                    out.push(p.kind.letter());
                }
            }
        }
        if empty > 0 {
            let _ = write!(out, "{empty}");
        }
        if rank > 0 {
            out.push('/');
        }
    }
    out.push(' ');
    out.push(state.seat_to_move().letter());
    out.push(' ');
    for seat in Seat::ALL {
        out.push(state.status(seat).letter());
    }

    let mut castles = Vec::new();
    for seat in Seat::ALL {
        let cr = state.castling_rights(seat);
        for side in CastleSide::ALL {
            if cr.get(side) {
                castles.push(format!(
                    "{}{}",
                    seat.letter(),
                    setup::castle_geometry(seat, side).rook_home
                ));
            }
        }
    }
    out.push(' ');
    out.push_str(&list_or_dash(&castles));

    let eps: Vec<String> = Seat::ALL
        .into_iter()
        .filter_map(|s| {
            state
                .ep_target(s)
                .map(|t| format!("{}{}", s.letter(), t.skipped))
        })
        .collect();
    out.push(' ');
    out.push_str(&list_or_dash(&eps));

    let c = state.config();
    let civs: Vec<String> = c
        .civs
        .iter()
        .map(|cs| format!("{}.{}", cs.id.slug(), cs.version))
        .collect();
    let defs: Vec<String> = state
        .defeats()
        .iter()
        .map(|r| format!("{}{}", r.seat.letter(), r.reason.letter()))
        .collect();
    let _ = write!(
        out,
        " {} {} ep={} ml={} civ={} def={} rv={}",
        state.no_progress(),
        state.ply(),
        if c.en_passant_enabled { "on" } else { "off" },
        c.move_limit_rounds,
        civs.join(","),
        list_or_dash(&defs),
        c.rules_version
    );
    if state.is_agreed_draw() {
        out.push_str(" end=draw");
    }
    out
}

fn list_or_dash(items: &[String]) -> String {
    if items.is_empty() {
        "-".to_string()
    } else {
        items.join(",")
    }
}

/// Parses and validates a position string.
pub fn parse_position(s: &str) -> Result<GameState, PositionError> {
    if s.len() > 4096 {
        return Err(err("position", "too long"));
    }
    let fields: Vec<&str> = s.split_ascii_whitespace().collect();
    if fields.len() < 8 {
        return Err(err(
            "position",
            format!("expected at least 8 fields, found {}", fields.len()),
        ));
    }
    let mode = match fields[0] {
        "ffa" => GameMode::Ffa,
        "teams" => GameMode::Teams,
        other => {
            return Err(err(
                "mode",
                format!("expected ffa or teams, found {other:?}"),
            ));
        }
    };
    let board = parse_board(fields[1])?;
    let to_move = single_char(fields[2])
        .and_then(|c| c.is_ascii_uppercase().then_some(c))
        .and_then(Seat::from_letter)
        .ok_or_else(|| {
            err(
                "to_move",
                format!("expected S, W, N or E, found {:?}", fields[2]),
            )
        })?;

    let mut statuses = [SeatStatus::Active; 4];
    let st_chars: Vec<char> = fields[3].chars().collect();
    if st_chars.len() != 4 {
        return Err(err("statuses", "expected 4 letters"));
    }
    for (i, c) in st_chars.into_iter().enumerate() {
        statuses[i] = SeatStatus::from_letter(c)
            .ok_or_else(|| err("statuses", format!("bad status letter {c:?}")))?;
    }

    let mut castling = [CastlingRights::NONE; 4];
    for tok in list_items(fields[4]) {
        let (seat, sq) =
            seat_square(tok).ok_or_else(|| err("castling", format!("bad token {tok:?}")))?;
        let cr = &mut castling[seat.index()];
        if sq == setup::castle_geometry(seat, CastleSide::Long).rook_home && !cr.long {
            cr.long = true;
        } else if sq == setup::castle_geometry(seat, CastleSide::Short).rook_home && !cr.short {
            cr.short = true;
        } else {
            return Err(err(
                "castling",
                format!("{tok:?} is not a (new) rook home square of that seat"),
            ));
        }
    }

    let mut ep: [Option<EpTarget>; 4] = [None; 4];
    for tok in list_items(fields[5]) {
        let (seat, skipped) =
            seat_square(tok).ok_or_else(|| err("en_passant", format!("bad token {tok:?}")))?;
        if ep[seat.index()].is_some() {
            return Err(err("en_passant", format!("{seat} listed twice")));
        }
        let (fx, fy) = seat.forward();
        let pawn = skipped
            .offset(fx, fy)
            .ok_or_else(|| err("en_passant", format!("{tok:?} is not a skipped square")))?;
        ep[seat.index()] = Some(EpTarget { skipped, pawn });
    }

    let no_progress: u32 = parse_canonical(fields[6])
        .ok_or_else(|| err("no_progress", format!("not a number: {:?}", fields[6])))?;
    let ply: u32 = parse_canonical(fields[7])
        .ok_or_else(|| err("ply", format!("not a number: {:?}", fields[7])))?;

    let mut config = GameConfig::new(mode);
    let mut defeats = Vec::new();
    let mut agreed_draw = false;
    let mut seen: Vec<&str> = Vec::new();
    for kv in &fields[8..] {
        let (k, v) = kv
            .split_once('=')
            .ok_or_else(|| err("options", format!("expected key=value, found {kv:?}")))?;
        if seen.contains(&k) {
            return Err(err("options", format!("duplicate key {k:?}")));
        }
        seen.push(k);
        match k {
            "ep" => {
                config.en_passant_enabled = match v {
                    "on" => true,
                    "off" => false,
                    _ => return Err(err("options", format!("ep must be on/off, found {v:?}"))),
                }
            }
            "ml" => {
                config.move_limit_rounds = parse_canonical(v)
                    .ok_or_else(|| err("options", format!("bad ml value {v:?}")))?;
            }
            "civ" => {
                let parts: Vec<&str> = v.split(',').collect();
                if parts.len() != 4 {
                    return Err(err("options", "civ needs four slug.version entries"));
                }
                for (i, p) in parts.into_iter().enumerate() {
                    let (slug, ver) = p
                        .split_once('.')
                        .ok_or_else(|| err("options", format!("bad civ entry {p:?}")))?;
                    let id = CivId::from_slug(slug)
                        .ok_or_else(|| err("options", format!("unknown civ {slug:?}")))?;
                    let version: u32 = parse_canonical(ver)
                        .ok_or_else(|| err("options", format!("bad civ version {ver:?}")))?;
                    config.civs[i] = CivSpec { id, version };
                }
            }
            "def" => {
                for tok in list_items(v) {
                    let mut ch = tok.chars();
                    let rec = match (ch.next(), ch.next(), ch.next()) {
                        (Some(sc), Some(rc), None) if sc.is_ascii_uppercase() => {
                            Seat::from_letter(sc)
                                .zip(DefeatReason::from_letter(rc))
                                .map(|(seat, reason)| DefeatRecord { seat, reason })
                        }
                        _ => None,
                    };
                    defeats.push(rec.ok_or_else(|| err("defeats", format!("bad token {tok:?}")))?);
                    if defeats.len() > 4 {
                        return Err(err("defeats", "more than four entries"));
                    }
                }
            }
            "rv" => {
                let rv: u32 =
                    parse_canonical(v).ok_or_else(|| err("options", format!("bad rv {v:?}")))?;
                if rv != RULES_VERSION {
                    return Err(err("options", format!("unsupported rules version {rv}")));
                }
                config.rules_version = rv;
            }
            "end" => {
                if v != "draw" {
                    return Err(err("end", format!("end must be draw, found {v:?}")));
                }
                agreed_draw = true;
            }
            _ => return Err(err("options", format!("unknown key {k:?}"))),
        }
    }

    GameState::from_parts(StateParts {
        config,
        board,
        statuses,
        castling,
        ep,
        to_move,
        no_progress,
        ply,
        defeats,
        agreed_draw,
    })
}

/// Parses a canonical decimal number: ASCII digits only, no sign and no
/// leading zeros (except `0` itself), so `format(parse(s)) == s`.
fn parse_canonical<T: core::str::FromStr>(s: &str) -> Option<T> {
    let canonical =
        !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) && (s == "0" || !s.starts_with('0'));
    if canonical { s.parse().ok() } else { None }
}

fn single_char(s: &str) -> Option<char> {
    let mut it = s.chars();
    match (it.next(), it.next()) {
        (Some(c), None) => Some(c),
        _ => None,
    }
}

fn list_items(field: &str) -> impl Iterator<Item = &str> {
    let items = if field == "-" { "" } else { field };
    items.split(',').filter(|t| !t.is_empty())
}

/// Parses `<SEAT><square>`, e.g. `Sc1`.
fn seat_square(tok: &str) -> Option<(Seat, Square)> {
    let b = tok.as_bytes();
    let first = *b.first()?;
    if !first.is_ascii_uppercase() {
        return None;
    }
    let seat = Seat::from_letter(first as char)?;
    let rest = b.get(1..)?;
    let (sq, used) = Square::parse_prefix(rest)?;
    (used == rest.len()).then_some((seat, sq))
}

fn parse_board(field: &str) -> Result<[Option<Piece>; NUM_SQUARES], PositionError> {
    let err = |m: String| PositionError::new("board", m);
    let mut board = [None; NUM_SQUARES];
    let ranks: Vec<&str> = field.split('/').collect();
    if ranks.len() != BOARD_SIZE as usize {
        return Err(err(format!(
            "expected {BOARD_SIZE} ranks, found {}",
            ranks.len()
        )));
    }
    for (i, rank_str) in ranks.iter().enumerate() {
        let rank = BOARD_SIZE - 1 - i as u8;
        let b = rank_str.as_bytes();
        let mut file: u32 = 0;
        let mut j = 0;
        while j < b.len() {
            let c = b[j];
            if c.is_ascii_digit() {
                let mut n: u32 = 0;
                while j < b.len() && b[j].is_ascii_digit() {
                    n = n * 10 + u32::from(b[j] - b'0');
                    if n > u32::from(BOARD_SIZE) {
                        return Err(err(format!("rank {}: run too long", rank + 1)));
                    }
                    j += 1;
                }
                if n == 0 {
                    return Err(err(format!("rank {}: zero-length run", rank + 1)));
                }
                file += n;
            } else {
                let seat = (c.is_ascii_lowercase())
                    .then(|| Seat::from_letter(c as char))
                    .flatten()
                    .ok_or_else(|| {
                        err(format!(
                            "rank {}: bad seat letter {:?}",
                            rank + 1,
                            c as char
                        ))
                    })?;
                let kc = *b
                    .get(j + 1)
                    .ok_or_else(|| err(format!("rank {}: missing piece letter", rank + 1)))?;
                let kind = (kc.is_ascii_uppercase())
                    .then(|| PieceKind::from_letter(kc as char))
                    .flatten()
                    .ok_or_else(|| {
                        err(format!(
                            "rank {}: bad piece letter {:?}",
                            rank + 1,
                            kc as char
                        ))
                    })?;
                let sq = u8::try_from(file)
                    .ok()
                    .and_then(|f| Square::from_coords(f, rank))
                    .ok_or_else(|| err(format!("rank {}: too many squares", rank + 1)))?;
                board[sq.index()] = Some(Piece::new(kind, seat));
                file += 1;
                j += 2;
            }
            if file > u32::from(BOARD_SIZE) {
                return Err(err(format!(
                    "rank {}: more than {BOARD_SIZE} squares",
                    rank + 1
                )));
            }
        }
        if file != u32::from(BOARD_SIZE) {
            return Err(err(format!(
                "rank {}: {} squares, expected {BOARD_SIZE}",
                rank + 1,
                file
            )));
        }
    }
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: &str = "ffa 4nRnNnBnQnKnBnNnR4/4nPnPnPnPnPnPnPnP4/16/16/wRwP12ePeR/wNwP12ePeN/wBwP12ePeB/wKwP12ePeK/wQwP12ePeQ/wBwP12ePeB/wNwP12ePeN/wRwP12ePeR/16/16/4sPsPsPsPsPsPsPsP4/4sRsNsBsQsKsBsNsR4 S AAAA Se1,Sl1,Wa5,Wa12,Ne16,Nl16,Ep5,Ep12 - 0 0 ep=on ml=25 civ=canada.1,canada.1,canada.1,canada.1 def=- rv=2";
    /// Teams kings only: North i16, West a9, East p9, South i1.
    const KINGS: &str = "8nK7/16/16/16/16/16/16/wK14eK/16/16/16/16/16/16/16/8sK7";

    #[test]
    fn start_position_string() {
        let s = GameState::new(GameConfig::default()).unwrap();
        assert_eq!(format_position(&s), START);
        let parsed = parse_position(START).unwrap();
        assert_eq!(parsed, s);
        assert_eq!(parsed.hash(), s.hash());
    }

    #[test]
    fn defaults_for_optional_keys() {
        let short = START.split(" ep=").next().unwrap();
        assert_eq!(
            parse_position(short).unwrap(),
            GameState::new(GameConfig::default()).unwrap()
        );
    }

    #[test]
    fn rejects_garbage_without_panicking() {
        let empty = ["16"; 16].join("/");
        let blank = empty.as_str();
        let bad = [
            "",
            "ffa",
            &format!("chess {blank} S AAAA - - 0 0"),
            // 15 ranks; 17 squares in a rank; leading zero; bad pieces.
            &format!("ffa {} S AAAA - - 0 0", ["16"; 15].join("/")),
            &format!("ffa 17/{} S AAAA - - 0 0", ["16"; 15].join("/")),
            &format!("ffa 016/{} S AAAA - - 0 0", ["16"; 15].join("/")),
            &format!("ffa 15sX/{} S AAAA - - 0 0", ["16"; 15].join("/")),
            &format!("ffa 15s/{} S AAAA - - 0 0", ["16"; 15].join("/")),
            &format!("ffa 8sK8sK/{} S AAAA - - 0 0", ["16"; 15].join("/")),
            // The old 12×12 start position (rules version 1) is not a v2 board.
            "ffa 2nRnNnBnQnKnBnNnR2/2nPnPnPnPnPnPnPnP2/wRwP8ePeR/wNwP8ePeN/wBwP8ePeB/wKwP8ePeK/wQwP8ePeQ/wBwP8ePeB/wNwP8ePeN/wRwP8ePeR/2sPsPsPsPsPsPsPsP2/2sRsNsBsQsKsBsNsR2 S AAAA Sc1,Sj1,Wa3,Wa10,Nc12,Nj12,El3,El10 - 0 0 ep=on ml=25 civ=canada.1,canada.1,canada.1,canada.1 def=- rv=1",
            &START.replace("rv=2", "rv=1"),
            // No leaders at all for ACTIVE seats.
            &format!("ffa {blank} S AAAA - - 0 0"),
            &format!("ffa {blank} S RRRR - - 0 0"),
            &START.replace(" S AAAA", " X AAAA"),
            &START.replace(" S AAAA", " s AAAA"),
            &START.replace("AAAA", "AAA"),
            &START.replace("AAAA", "AAAD"),
            &START.replace("Se1,", "Sf1,"),
            &START.replace("Se1,", "Se1,Se1,"),
            &START.replace(" - 0 0", " Sz9 0 0"),
            &START.replace(" - 0 0", " Sf3 x 0"),
            &START.replace(" - 0 0", " - 0 -1"),
            // Non-canonical numbers (sign, leading zeros).
            &START.replace(" - 0 0", " - +5 0"),
            &START.replace(" - 0 0", " - 0 007"),
            &START.replace("ml=25", "ml=025"),
            &START.replace("rv=2", "rv=+2"),
            // Castling right with the e1 rook missing from its home square.
            &START.replace("4sRsNsBsQsKsBsNsR4 S", "5sNsBsQsKsBsNsR4 S"),
            // South is on move, so its own en passant target has expired.
            &START.replace(" - 0 0", " Sf3 0 0"),
            &START.replace("ml=25", "ml=0"),
            &START.replace("ml=25", "ml=99999999"),
            &START.replace("rv=2", "rv=3"),
            &START.replace("canada.1,canada.1,canada.1,canada.1", "canada.1"),
            &START.replace(
                "canada.1,canada.1,canada.1,canada.1",
                "narnia.1,canada.1,canada.1,canada.1",
            ),
            &START.replace(
                "canada.1,canada.1,canada.1,canada.1",
                "canada.7,canada.1,canada.1,canada.1",
            ),
            &START.replace("def=-", "def=Sx"),
            &START.replace("def=-", "def=Sl"),
            &format!("{START} end=win"),
            &format!("{START} end="),
            &format!("{START} end=draw end=draw"),
            // An agreed draw cannot coexist with another ending.
            &format!("{} end=draw", START.replace(" - 0 0", " - 100 0")),
            // A resigned Teams seat is FROZEN, never DEFEATED.
            &format!("teams {KINGS} S AADA - - 0 0 def=Nr"),
            &format!(
                "teams 16{} S AARA - - 0 0 def=Nr",
                KINGS.trim_start_matches("8nK7")
            ),
            &format!("{START} ep=on"),
            &format!("{START} foo=bar"),
            &format!("{START} junk"),
            &format!("ffa \u{e9}/{} S AAAA - - 0 0", ["16"; 15].join("/")),
        ];
        for b in bad {
            assert!(parse_position(b).is_err(), "should reject: {b}");
        }
    }

    #[test]
    fn end_draw_marker_round_trips() {
        let text = format!("{START} end=draw");
        let s = parse_position(&text).unwrap();
        assert!(s.is_agreed_draw());
        assert!(s.is_over());
        assert_eq!(
            s.outcome().unwrap().result,
            crate::GameResult::FfaAgreedDraw {
                survivors: [true; 4]
            }
        );
        assert_eq!(format_position(&s), text);
        assert_ne!(s.hash(), parse_position(START).unwrap().hash());

        let mut live = GameState::new(GameConfig::default()).unwrap();
        crate::apply_agreed_draw(&mut live).unwrap();
        assert_eq!(live, s);
        assert_eq!(live.hash(), s.hash());
    }

    #[test]
    fn resign_reason_letter() {
        let s = parse_position(&format!("teams {KINGS} S AAFA - - 0 0 def=Nr")).unwrap();
        assert_eq!(s.defeats().reason(Seat::North), Some(DefeatReason::Resign));
        assert!(format_position(&s).contains("def=Nr"));
    }
}
