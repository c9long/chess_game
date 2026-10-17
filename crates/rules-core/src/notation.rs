//! Move notation.
//!
//! A move is written `<from><to>[promotion]`: two square names followed by an
//! optional promotion letter (`q`, `r`, `b`, `n`; any piece letter parses and
//! the legality check rejects the rest). Files are `a`..`p`, ranks `1`..`16`,
//! so `f1g3`, `e8e9q` and `a10p16` are all valid. Castling is written as the
//! leader's move (`i1k1`). An automatic pass is logged as `--`
//! ([`crate::apply::PASS_NOTATION`]) and is never parsed as a move.

use crate::error::NotationError;
use crate::geometry::Square;
use crate::movegen::Move;
use crate::piece::PieceKind;

/// Parses a move string such as `f1g3`, `e8e9q` or `a10p16`. The returned
/// move has flag `Normal`; [`crate::apply_move`] derives the real flag.
pub fn parse_move(s: &str) -> Result<Move, NotationError> {
    let bad = || NotationError::InvalidMove(s.chars().take(16).collect());
    let b = s.as_bytes();
    let (from, n1) = Square::parse_prefix(b).ok_or_else(bad)?;
    let rest = b.get(n1..).ok_or_else(bad)?;
    let (to, n2) = Square::parse_prefix(rest).ok_or_else(bad)?;
    let tail = rest.get(n2..).ok_or_else(bad)?;
    let promotion = match tail {
        [] => None,
        [c] => Some(PieceKind::from_letter(*c as char).ok_or_else(bad)?),
        _ => return Err(bad()),
    };
    if from == to {
        return Err(bad());
    }
    Ok(Move {
        from,
        to,
        promotion,
        flag: Default::default(),
    })
}

/// Formats a move (`f1g3`, `e8e9q`). Same as `mv.to_string()`.
pub fn format_move(mv: &Move) -> String {
    mv.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_formats() {
        for s in [
            "g1h3", "c6c7q", "a10a12", "l12a1", "b3c2", "d6d7n", "f5g5r", "a1l12b", "p16a1",
            "e8e9q", "a10p16", "m13n15", "o16p15r",
        ] {
            assert_eq!(format_move(&parse_move(s).unwrap()), s);
        }
        let m = parse_move("a10a12").unwrap();
        assert_eq!(m.from.to_string(), "a10");
        assert_eq!(m.to.to_string(), "a12");
        assert_eq!(
            parse_move("c6c7Q").unwrap().promotion,
            Some(PieceKind::Queen)
        );
    }

    #[test]
    fn rejects_garbage() {
        for s in [
            "", "g1", "g1h", "g1h17", "g0h1", "q1a1", "a1a1", "c6c7x", "c6c7qq", "--", "g1-h3",
            "G1H3", "a1a10 ", "é1a1", "a1\u{0}", "a011a1", "p16p16", "p17a1",
        ] {
            assert!(parse_move(s).is_err(), "{s:?} should not parse");
        }
    }
}
