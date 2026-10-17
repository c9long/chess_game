//! Starting setup and fixed per-seat geometry (back lines, pawn lines,
//! castling squares), as specified in PLAN §2.
//!
//! The board is 16×16 (rules version 2). Each army is centred on its edge,
//! leaving four empty squares on either side of its back and pawn lines and
//! fully playable 4×4 empty corners.
//!
//! | Seat  | Back line (long-rook side first)                         | Pawns    |
//! |-------|----------------------------------------------------------|----------|
//! | South | e1 R, f1 N, g1 B, h1 Q, i1 K, j1 B, k1 N, l1 R            | e2–l2    |
//! | West  | a5 R, a6 N, a7 B, a8 Q, a9 K, a10 B, a11 N, a12 R         | b5–b12   |
//! | North | e16 R, f16 N, g16 B, h16 Q, i16 K, j16 B, k16 N, l16 R    | e15–l15  |
//! | East  | p5 R, p6 N, p7 B, p8 Q, p9 K, p10 B, p11 N, p12 R         | o5–o12   |
//!
//! That is the standard back line. A civ whose ability changes its army swaps
//! the *kinds* on those same eight squares ([`crate::civ::Roster::back_line`]); for
//! England v2 the K, Q and both N squares hold Prime Ministers
//! (`R M B M M B M R`). Pawns are always the standard eight.

use crate::config::GameConfig;
use crate::geometry::{BOARD_SIZE, NUM_SQUARES, Seat, Square};
use crate::piece::{Piece, PieceKind};

/// Standard back-line piece kinds, indexed from the long-rook end.
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
/// Progress of a seat's promotion line (first line past the center):
/// South rank 9, North rank 8, West file `i`, East file `h`.
pub const PROMOTION_PROGRESS: u8 = 8;

/// Distance from the board's corner to the first square of an army's back
/// and pawn lines (the width of the empty margin on each side).
pub const ARMY_MARGIN: u8 = 4;

/// Square at position `i` (0..8) along a line parallel to `seat`'s back edge,
/// `depth` steps in from that edge, starting at the long-rook end.
const fn line_square(seat: Seat, depth: u8, i: u8) -> Square {
    let along = ARMY_MARGIN + i;
    let far = BOARD_SIZE - 1 - depth;
    let (file, rank) = match seat {
        Seat::South => (along, depth),
        Seat::North => (along, far),
        Seat::West => (depth, along),
        Seat::East => (far, along),
    };
    match Square::from_coords(file, rank) {
        Some(s) => s,
        None => Square::from_index(0),
    }
}

/// The eight back-line squares of `seat`, long-rook end first
/// (South: e1..l1, West: a5..a12, North: e16..l16, East: p5..p12).
pub const fn back_line(seat: Seat) -> [Square; 8] {
    let mut out = [Square::from_index(0); 8];
    let mut i = 0;
    while i < 8 {
        out[i] = line_square(seat, 0, i as u8);
        i += 1;
    }
    out
}

/// The eight pawn start squares of `seat` (South: e2..l2, etc.).
pub const fn pawn_line(seat: Seat) -> [Square; 8] {
    let mut out = [Square::from_index(0); 8];
    let mut i = 0;
    while i < 8 {
        out[i] = line_square(seat, 1, i as u8);
        i += 1;
    }
    out
}

/// The leader's home square (South i1, West a9, North i16, East p9).
pub const fn leader_home(seat: Seat) -> Square {
    back_line(seat)[LEADER_HOME_INDEX]
}

/// The standard starting board (rules version 2, every seat with the
/// standard army).
pub fn start_board() -> [Option<Piece>; NUM_SQUARES] {
    start_board_with(|_| BACK_LINE_KINDS)
}

/// The starting board for `config`: each seat's back line comes from its
/// civ's roster (e.g. England v2's Prime Ministers), pawns are standard.
pub fn start_board_for(config: &GameConfig) -> [Option<Piece>; NUM_SQUARES] {
    start_board_with(|seat| config.civ(seat).roster.back_line())
}

fn start_board_with(line_of: impl Fn(Seat) -> [PieceKind; 8]) -> [Option<Piece>; NUM_SQUARES] {
    let mut board = [None; NUM_SQUARES];
    for seat in Seat::ALL {
        for (sq, kind) in back_line(seat).into_iter().zip(line_of(seat)) {
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
    /// Toward the rook three squares past the queen (South: e1).
    Long,
    /// Toward the rook two squares past the leader (South: l1).
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
/// South long: K i1→g1, R e1→h1. South short: K i1→k1, R l1→j1.
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
        for (i, s) in ["e1", "f1", "g1", "h1", "i1", "j1", "k1", "l1"]
            .iter()
            .enumerate()
        {
            expect(s, BACK_LINE_KINDS[i], Seat::South);
        }
        for (i, s) in ["e16", "f16", "g16", "h16", "i16", "j16", "k16", "l16"]
            .iter()
            .enumerate()
        {
            expect(s, BACK_LINE_KINDS[i], Seat::North);
        }
        for (i, s) in ["a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12"]
            .iter()
            .enumerate()
        {
            expect(s, BACK_LINE_KINDS[i], Seat::West);
        }
        for (i, s) in ["p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"]
            .iter()
            .enumerate()
        {
            expect(s, BACK_LINE_KINDS[i], Seat::East);
        }
        for f in "efghijkl".chars() {
            expect(&format!("{f}2"), Pawn, Seat::South);
            expect(&format!("{f}15"), Pawn, Seat::North);
        }
        for r in 5..=12 {
            expect(&format!("b{r}"), Pawn, Seat::West);
            expect(&format!("o{r}"), Pawn, Seat::East);
        }
        assert_eq!(b.iter().flatten().count(), 64);
        // Empty, playable 4×4 corners.
        for s in Square::all() {
            let (f, r) = (s.file(), s.rank());
            let corner = !(4..=11).contains(&f) && !(4..=11).contains(&r);
            if corner {
                assert_eq!(b[s.index()], None, "{s}");
            }
        }
        // Four empty squares either side of each back and pawn line.
        for s in [
            "a1", "d1", "m1", "p1", "d2", "m2", "a4", "b4", "a13", "b13", "p4", "o13",
        ] {
            assert_eq!(b[sq(s).index()], None, "{s}");
        }
        // Queens on their own color; light armies S/W, dark armies N/E.
        // h1 = (7,0): 7 odd -> light. a8 = (0,7): light.
        // h16 = (7,15): 22 even -> dark. p8 = (15,7): 22 even -> dark.
        assert!(sq("h1").is_light() && sq("a8").is_light());
        assert!(!sq("h16").is_light() && !sq("p8").is_light());
        expect("h1", Queen, Seat::South);
        expect("a8", Queen, Seat::West);
        expect("h16", Queen, Seat::North);
        expect("p8", Queen, Seat::East);
        expect("a9", King, Seat::West);
        expect("p9", King, Seat::East);
        expect("i16", King, Seat::North);
        // Opposing queens face each other.
        assert_eq!(sq("h1").file(), sq("h16").file());
        assert_eq!(sq("a8").rank(), sq("p8").rank());
    }

    #[test]
    fn england_back_line_uses_the_same_squares() {
        use crate::civ::CivId;
        use crate::config::GameMode;
        let config = GameConfig::new(GameMode::Ffa).with_civs([
            CivId::England,
            CivId::Canada,
            CivId::Canada,
            CivId::England,
        ]);
        let b = start_board_for(&config);
        let pm = |seat| Some(Piece::new(PieceKind::PrimeMinister, seat));
        // South: f1, h1, i1, k1 (the N, Q, K, N squares).
        for s in ["f1", "h1", "i1", "k1"] {
            assert_eq!(b[sq(s).index()], pm(Seat::South), "{s}");
        }
        for s in ["e1", "l1"] {
            assert_eq!(b[sq(s).index()].map(|p| p.kind), Some(PieceKind::Rook));
        }
        for s in ["g1", "j1"] {
            assert_eq!(b[sq(s).index()].map(|p| p.kind), Some(PieceKind::Bishop));
        }
        // East: p6, p8, p9, p11.
        for s in ["p6", "p8", "p9", "p11"] {
            assert_eq!(b[sq(s).index()], pm(Seat::East), "{s}");
        }
        // West and North keep the standard army.
        assert_eq!(
            b[sq("a9").index()],
            Some(Piece::new(PieceKind::King, Seat::West))
        );
        assert_eq!(
            b[sq("h16").index()],
            Some(Piece::new(PieceKind::Queen, Seat::North))
        );
        assert_eq!(b.iter().flatten().count(), 64);
        // Occupied squares are the same as the standard setup.
        let std = start_board();
        for i in 0..NUM_SQUARES {
            assert_eq!(b[i].is_some(), std[i].is_some());
        }
        assert_eq!(start_board_for(&GameConfig::new(GameMode::Ffa)), std);
    }

    #[test]
    fn leader_homes_and_lines() {
        assert_eq!(leader_home(Seat::South), sq("i1"));
        assert_eq!(leader_home(Seat::West), sq("a9"));
        assert_eq!(leader_home(Seat::North), sq("i16"));
        assert_eq!(leader_home(Seat::East), sq("p9"));
        for seat in Seat::ALL {
            for s in pawn_line(seat) {
                assert_eq!(seat.progress(s), PAWN_START_PROGRESS);
            }
            for s in back_line(seat) {
                assert_eq!(seat.progress(s), 0);
            }
        }
    }

    #[test]
    fn castling_geometry() {
        let g = castle_geometry(Seat::South, CastleSide::Long);
        assert_eq!((g.leader_home, g.rook_home), (sq("i1"), sq("e1")));
        assert_eq!((g.leader_to, g.rook_to), (sq("g1"), sq("h1")));
        assert_eq!(
            g.between().collect::<Vec<_>>(),
            vec![sq("f1"), sq("g1"), sq("h1")]
        );
        let g = castle_geometry(Seat::South, CastleSide::Short);
        assert_eq!((g.leader_home, g.rook_home), (sq("i1"), sq("l1")));
        assert_eq!((g.leader_to, g.rook_to), (sq("k1"), sq("j1")));
        assert_eq!(g.between().collect::<Vec<_>>(), vec![sq("j1"), sq("k1")]);
        let g = castle_geometry(Seat::West, CastleSide::Short);
        assert_eq!((g.leader_home, g.rook_home), (sq("a9"), sq("a12")));
        assert_eq!((g.leader_to, g.rook_to), (sq("a11"), sq("a10")));
        let g = castle_geometry(Seat::East, CastleSide::Long);
        assert_eq!((g.leader_home, g.rook_home), (sq("p9"), sq("p5")));
        assert_eq!((g.leader_to, g.rook_to), (sq("p7"), sq("p8")));
        let g = castle_geometry(Seat::North, CastleSide::Long);
        assert_eq!((g.leader_home, g.rook_home), (sq("i16"), sq("e16")));
        assert_eq!((g.leader_to, g.rook_to), (sq("g16"), sq("h16")));
        let g = castle_geometry(Seat::North, CastleSide::Short);
        assert_eq!((g.leader_to, g.rook_to), (sq("k16"), sq("j16")));
    }
}
