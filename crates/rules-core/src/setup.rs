//! Starting setup and fixed per-seat geometry (back lines, pawn lines,
//! castling squares), as specified in PLAN §2.
//!
//! | Seat  | Back line (long-rook side first)            | Pawns   |
//! |-------|---------------------------------------------|---------|
//! | South | c1 R, d1 N, e1 B, f1 Q, g1 K, h1 B, i1 N, j1 R | c2–j2 |
//! | West  | a3 R, a4 N, a5 B, a6 Q, a7 K, a8 B, a9 N, a10 R | b3–b10 |
//! | North | c12 R, d12 N, e12 B, f12 Q, g12 K, h12 B, i12 N, j12 R | c11–j11 |
//! | East  | l3 R, l4 N, l5 B, l6 Q, l7 K, l8 B, l9 N, l10 R | k3–k10 |

use crate::geometry::{NUM_SQUARES, Seat, Square};
use crate::piece::{Piece, PieceKind};

/// Back-line piece kinds, indexed from the long-rook end.
pub const BACK_LINE_KINDS: [PieceKind; 8] = [
    PieceKind::Rook,
    PieceKind::Knight,
    PieceKind::Bishop,
    PieceKind::Queen,
    PieceKind::King,
    PieceKind::Bishop,
    PieceKind::Knight,
    PieceKind::Rook,
];

/// Index of the leader's home square within [`back_line`].
pub const LEADER_HOME_INDEX: usize = 4;

/// Progress (see [`Seat::progress`]) of a seat's pawn start line.
pub const PAWN_START_PROGRESS: u8 = 1;
/// Progress of a seat's promotion line (first line past the center).
pub const PROMOTION_PROGRESS: u8 = 6;

/// Square at position `i` (0..8) along a line parallel to `seat`'s back edge,
/// `depth` steps in from that edge, starting at the long-rook end.
const fn line_square(seat: Seat, depth: u8, i: u8) -> Square {
    let along = 2 + i;
    let (file, rank) = match seat {
        Seat::South => (along, depth),
        Seat::North => (along, 11 - depth),
        Seat::West => (depth, along),
        Seat::East => (11 - depth, along),
    };
    match Square::from_coords(file, rank) {
        Some(s) => s,
        None => Square::from_index(0),
    }
}

/// The eight back-line squares of `seat`, long-rook end first
/// (South: c1..j1, West: a3..a10, North: c12..j12, East: l3..l10).
pub const fn back_line(seat: Seat) -> [Square; 8] {
    let mut out = [Square::from_index(0); 8];
    let mut i = 0;
    while i < 8 {
        out[i] = line_square(seat, 0, i as u8);
        i += 1;
    }
    out
}

/// The eight pawn start squares of `seat` (South: c2..j2, etc.).
pub const fn pawn_line(seat: Seat) -> [Square; 8] {
    let mut out = [Square::from_index(0); 8];
    let mut i = 0;
    while i < 8 {
        out[i] = line_square(seat, 1, i as u8);
        i += 1;
    }
    out
}

/// The leader's home square (South g1, West a7, North g12, East l7).
pub const fn leader_home(seat: Seat) -> Square {
    back_line(seat)[LEADER_HOME_INDEX]
}

/// The standard v1 starting board.
pub fn start_board() -> [Option<Piece>; NUM_SQUARES] {
    let mut board = [None; NUM_SQUARES];
    for seat in Seat::ALL {
        for (sq, kind) in back_line(seat).into_iter().zip(BACK_LINE_KINDS) {
            board[sq.index()] = Some(Piece::new(kind, seat));
        }
        for sq in pawn_line(seat) {
            board[sq.index()] = Some(Piece::new(PieceKind::Pawn, seat));
        }
    }
    board
}

/// Which rook a castle uses.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum CastleSide {
    /// Toward the rook three squares past the queen (South: c1).
    Long,
    /// Toward the rook two squares past the leader (South: j1).
    Short,
}

impl CastleSide {
    /// Both sides.
    pub const ALL: [CastleSide; 2] = [CastleSide::Long, CastleSide::Short];
}

/// Squares involved in one castle.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CastleGeometry {
    /// Where the leader must stand.
    pub leader_home: Square,
    /// Where the rook must stand.
    pub rook_home: Square,
    /// Leader destination (two squares toward the rook).
    pub leader_to: Square,
    /// Rook destination (the square the leader crossed).
    pub rook_to: Square,
    /// Back-line indices strictly between leader and rook (must be empty).
    between: (u8, u8),
    line: [Square; 8],
}

impl CastleGeometry {
    /// Squares strictly between leader and rook; all must be empty.
    pub fn between(&self) -> impl Iterator<Item = Square> + '_ {
        let (start, end) = self.between;
        self.line
            .iter()
            .copied()
            .skip(start as usize)
            .take(end.saturating_sub(start) as usize)
    }
}

/// Castling geometry for `seat` on `side`.
///
/// South long: K g1→e1, R c1→f1. South short: K g1→i1, R j1→h1.
/// Other seats mirror this along their own back line.
pub fn castle_geometry(seat: Seat, side: CastleSide) -> CastleGeometry {
    let line = back_line(seat);
    let (rook, leader_to, rook_to, between) = match side {
        CastleSide::Long => (0, 2, 3, (1, 4)),
        CastleSide::Short => (7, 6, 5, (5, 7)),
    };
    CastleGeometry {
        leader_home: line[LEADER_HOME_INDEX],
        rook_home: line[rook],
        leader_to: line[leader_to],
        rook_to: line[rook_to],
        between,
        line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sq(s: &str) -> Square {
        s.parse().unwrap()
    }

    #[test]
    fn exact_setup_squares() {
        let b = start_board();
        let expect = |s: &str, kind: PieceKind, seat: Seat| {
            assert_eq!(b[sq(s).index()], Some(Piece::new(kind, seat)), "{s}");
        };
        use PieceKind::*;
        for (i, s) in ["c1", "d1", "e1", "f1", "g1", "h1", "i1", "j1"]
            .iter()
            .enumerate()
        {
            expect(s, BACK_LINE_KINDS[i], Seat::South);
        }
        for (i, s) in ["c12", "d12", "e12", "f12", "g12", "h12", "i12", "j12"]
            .iter()
            .enumerate()
        {
            expect(s, BACK_LINE_KINDS[i], Seat::North);
        }
        for (i, s) in ["a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10"]
            .iter()
            .enumerate()
        {
            expect(s, BACK_LINE_KINDS[i], Seat::West);
        }
        for (i, s) in ["l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10"]
            .iter()
            .enumerate()
        {
            expect(s, BACK_LINE_KINDS[i], Seat::East);
        }
        for f in "cdefghij".chars() {
            expect(&format!("{f}2"), Pawn, Seat::South);
            expect(&format!("{f}11"), Pawn, Seat::North);
        }
        for r in 3..=10 {
            expect(&format!("b{r}"), Pawn, Seat::West);
            expect(&format!("k{r}"), Pawn, Seat::East);
        }
        assert_eq!(b.iter().flatten().count(), 64);
        // Empty 2×2 corners.
        for s in [
            "a1", "b1", "a2", "b2", "k1", "l1", "k2", "l2", "a11", "b12", "k11", "l12",
        ] {
            assert_eq!(b[sq(s).index()], None, "{s}");
        }
        // Queens on their own color; light armies S/W, dark armies N/E.
        assert!(sq("f1").is_light() && sq("a6").is_light());
        assert!(!sq("f12").is_light() && !sq("l6").is_light());
        expect("f1", Queen, Seat::South);
        expect("a7", King, Seat::West);
    }

    #[test]
    fn castling_geometry() {
        let g = castle_geometry(Seat::South, CastleSide::Long);
        assert_eq!((g.leader_home, g.rook_home), (sq("g1"), sq("c1")));
        assert_eq!((g.leader_to, g.rook_to), (sq("e1"), sq("f1")));
        assert_eq!(
            g.between().collect::<Vec<_>>(),
            vec![sq("d1"), sq("e1"), sq("f1")]
        );
        let g = castle_geometry(Seat::South, CastleSide::Short);
        assert_eq!((g.leader_to, g.rook_to), (sq("i1"), sq("h1")));
        assert_eq!(g.between().collect::<Vec<_>>(), vec![sq("h1"), sq("i1")]);
        let g = castle_geometry(Seat::West, CastleSide::Short);
        assert_eq!((g.leader_home, g.rook_home), (sq("a7"), sq("a10")));
        assert_eq!((g.leader_to, g.rook_to), (sq("a9"), sq("a8")));
        let g = castle_geometry(Seat::East, CastleSide::Long);
        assert_eq!((g.leader_to, g.rook_to), (sq("l5"), sq("l6")));
        let g = castle_geometry(Seat::North, CastleSide::Long);
        assert_eq!((g.leader_to, g.rook_to), (sq("e12"), sq("f12")));
    }
}
