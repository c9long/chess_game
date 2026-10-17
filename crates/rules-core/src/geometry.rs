//! Board geometry: squares, seats, teams and precomputed step/ray tables.
//!
//! The board is 16×16 (rules version 2). Files are `a`..`p` (left to right
//! from South's view), ranks are `1`..`16` (bottom to top). A [`Square`] is an
//! index `0..256` with `file = index % 16` and `rank = index / 16` (both
//! 0-based), so `a1 = 0`, `p1 = 15`, `a16 = 240` and `p16 = 255`. Every index
//! fits in a `u8`, so code must never form `NUM_SQUARES as u8` (it is 0).
//!
//! Square colors follow standard chess: `a1` is dark, and a square is light
//! when `file + rank` (0-based) is odd.

use core::fmt;
use core::str::FromStr;

use crate::error::NotationError;

/// Number of files (and ranks) on the board.
pub const BOARD_SIZE: u8 = 16;
/// Number of squares on the board.
pub const NUM_SQUARES: usize = 256;

/// A square on the 16×16 board. Every `u8` is a valid index `0..256`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Square(u8);

impl Square {
    /// Builds a square from its index `0..256`. (Every `u8` is a square on
    /// the 16×16 board; the `Option` keeps the API stable across sizes.)
    pub const fn new(index: u8) -> Option<Square> {
        if (index as usize) < NUM_SQUARES {
            Some(Square(index))
        } else {
            None
        }
    }

    /// Builds a square from 0-based file (`a` = 0) and rank (`1` = 0).
    pub const fn from_coords(file: u8, rank: u8) -> Option<Square> {
        if file < BOARD_SIZE && rank < BOARD_SIZE {
            Some(Square(rank * BOARD_SIZE + file))
        } else {
            None
        }
    }

    /// Internal constructor; callers guarantee `index < 256`.
    pub(crate) const fn from_index(index: usize) -> Square {
        debug_assert!(index < NUM_SQUARES);
        Square(index as u8)
    }

    /// The square's index `0..256`, suitable for indexing board arrays.
    pub const fn index(self) -> usize {
        self.0 as usize
    }

    /// The square's index as a `u8`.
    pub const fn to_u8(self) -> u8 {
        self.0
    }

    /// 0-based file (`a` = 0 .. `p` = 15).
    pub const fn file(self) -> u8 {
        self.0 % BOARD_SIZE
    }

    /// 0-based rank (`1` = 0 .. `16` = 15).
    pub const fn rank(self) -> u8 {
        self.0 / BOARD_SIZE
    }

    /// `true` for light squares (`a1` is dark).
    pub const fn is_light(self) -> bool {
        (self.file() + self.rank()) % 2 == 1
    }

    /// The square `df` files and `dr` ranks away, if it is on the board.
    pub const fn offset(self, df: i8, dr: i8) -> Option<Square> {
        let f = self.file() as i16 + df as i16;
        let r = self.rank() as i16 + dr as i16;
        if f >= 0 && f < BOARD_SIZE as i16 && r >= 0 && r < BOARD_SIZE as i16 {
            Some(Square((r * BOARD_SIZE as i16 + f) as u8))
        } else {
            None
        }
    }

    /// All 256 squares in index order (`a1`, `b1`, ..., `p16`).
    pub fn all() -> impl Iterator<Item = Square> + Clone {
        (0..NUM_SQUARES).map(Square::from_index)
    }

    /// The file letter `a`..`p`.
    pub const fn file_char(self) -> char {
        (b'a' + self.file()) as char
    }

    /// Parses a square at the start of `bytes` (e.g. `a1`, `p16`), returning it
    /// and the number of bytes consumed. Ranks are read greedily (`a10` is
    /// `a10`, never `a1` followed by `0`); leading zeros are rejected.
    pub(crate) fn parse_prefix(bytes: &[u8]) -> Option<(Square, usize)> {
        let file = match bytes.first() {
            Some(&c @ b'a'..=b'p') => c - b'a',
            _ => return None,
        };
        let (rank1, used) = match (bytes.get(1), bytes.get(2)) {
            (Some(b'1'), Some(&d @ b'0'..=b'6')) => (10 + (d - b'0'), 3),
            (Some(&d @ b'1'..=b'9'), _) => (d - b'0', 2),
            _ => return None,
        };
        Square::from_coords(file, rank1 - 1).map(|s| (s, used))
    }
}

impl fmt::Display for Square {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}", self.file_char(), self.rank() + 1)
    }
}

impl fmt::Debug for Square {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

impl FromStr for Square {
    type Err = NotationError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match Square::parse_prefix(s.as_bytes()) {
            Some((sq, used)) if used == s.len() => Ok(sq),
            _ => Err(NotationError::InvalidSquare(s.chars().take(16).collect())),
        }
    }
}

/// One of the four seats, in clockwise turn order.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
#[repr(u8)]
pub enum Seat {
    /// Bottom edge (ranks 1–2); moves first.
    South = 0,
    /// Left edge (files a–b).
    West = 1,
    /// Top edge (ranks 15–16).
    North = 2,
    /// Right edge (files o–p).
    East = 3,
}

impl Seat {
    /// All seats in turn order.
    pub const ALL: [Seat; 4] = [Seat::South, Seat::West, Seat::North, Seat::East];
    /// Number of seats.
    pub const COUNT: usize = 4;

    /// Index `0..4` in turn order.
    pub const fn index(self) -> usize {
        self as usize
    }

    /// The seat with turn-order index `i`.
    pub const fn from_index(i: usize) -> Option<Seat> {
        match i {
            0 => Some(Seat::South),
            1 => Some(Seat::West),
            2 => Some(Seat::North),
            3 => Some(Seat::East),
            _ => None,
        }
    }

    /// The next seat clockwise (South → West → North → East → South).
    pub const fn next(self) -> Seat {
        match self {
            Seat::South => Seat::West,
            Seat::West => Seat::North,
            Seat::North => Seat::East,
            Seat::East => Seat::South,
        }
    }

    /// The seat opposite (the Teams partner).
    pub const fn partner(self) -> Seat {
        match self {
            Seat::South => Seat::North,
            Seat::West => Seat::East,
            Seat::North => Seat::South,
            Seat::East => Seat::West,
        }
    }

    /// The seat's Teams team.
    pub const fn team(self) -> Team {
        match self {
            Seat::South | Seat::North => Team::SouthNorth,
            Seat::West | Seat::East => Team::WestEast,
        }
    }

    /// Single uppercase letter: `S`, `W`, `N`, `E`.
    pub const fn letter(self) -> char {
        match self {
            Seat::South => 'S',
            Seat::West => 'W',
            Seat::North => 'N',
            Seat::East => 'E',
        }
    }

    /// Parses a seat letter (case-insensitive).
    pub const fn from_letter(c: char) -> Option<Seat> {
        match c {
            'S' | 's' => Some(Seat::South),
            'W' | 'w' => Some(Seat::West),
            'N' | 'n' => Some(Seat::North),
            'E' | 'e' => Some(Seat::East),
            _ => None,
        }
    }

    /// Lowercase name (`"south"`, ...).
    pub const fn name(self) -> &'static str {
        match self {
            Seat::South => "south",
            Seat::West => "west",
            Seat::North => "north",
            Seat::East => "east",
        }
    }

    /// Pawn "forward" direction as `(file delta, rank delta)`.
    pub const fn forward(self) -> (i8, i8) {
        match self {
            Seat::South => (0, 1),
            Seat::West => (1, 0),
            Seat::North => (0, -1),
            Seat::East => (-1, 0),
        }
    }

    /// How far `sq` lies from this seat's own back edge, measured along its
    /// forward direction (0 = back line, 1 = pawn start line, 8 = promotion line).
    pub const fn progress(self, sq: Square) -> u8 {
        match self {
            Seat::South => sq.rank(),
            Seat::North => BOARD_SIZE - 1 - sq.rank(),
            Seat::West => sq.file(),
            Seat::East => BOARD_SIZE - 1 - sq.file(),
        }
    }
}

impl fmt::Display for Seat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

/// A Teams side. Partners sit opposite each other.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
#[repr(u8)]
pub enum Team {
    /// South + North.
    SouthNorth = 0,
    /// West + East.
    WestEast = 1,
}

impl Team {
    /// Both teams.
    pub const ALL: [Team; 2] = [Team::SouthNorth, Team::WestEast];

    /// Index `0..2`.
    pub const fn index(self) -> usize {
        self as usize
    }

    /// The two seats of this team.
    pub const fn seats(self) -> [Seat; 2] {
        match self {
            Team::SouthNorth => [Seat::South, Seat::North],
            Team::WestEast => [Seat::West, Seat::East],
        }
    }

    /// The opposing team.
    pub const fn other(self) -> Team {
        match self {
            Team::SouthNorth => Team::WestEast,
            Team::WestEast => Team::SouthNorth,
        }
    }
}

// ---------------------------------------------------------------------------
// Precomputed tables (built at compile time).
// ---------------------------------------------------------------------------

/// The eight ray directions as `(file delta, rank delta)`.
/// Indices 0..4 are orthogonal, 4..8 diagonal.
pub(crate) const DIRS: [(i8, i8); 8] = [
    (0, 1),
    (1, 0),
    (0, -1),
    (-1, 0),
    (1, 1),
    (1, -1),
    (-1, -1),
    (-1, 1),
];
pub(crate) const ORTHOGONAL: [usize; 4] = [0, 1, 2, 3];
pub(crate) const DIAGONAL: [usize; 4] = [4, 5, 6, 7];
pub(crate) const ALL_DIRS: [usize; 8] = [0, 1, 2, 3, 4, 5, 6, 7];

const KNIGHT_OFFSETS: [(i8, i8); 8] = [
    (1, 2),
    (2, 1),
    (2, -1),
    (1, -2),
    (-1, -2),
    (-2, -1),
    (-2, 1),
    (-1, 2),
];

/// Index delta for one step in each direction.
const DIR_DELTA: [i16; 8] = {
    let mut d = [0i16; 8];
    let mut i = 0;
    while i < 8 {
        d[i] = DIRS[i].0 as i16 + DIRS[i].1 as i16 * BOARD_SIZE as i16;
        i += 1;
    }
    d
};

/// Up to eight target squares reachable by a fixed-offset piece.
#[derive(Clone, Copy)]
pub(crate) struct StepList {
    len: u8,
    squares: [u8; 8],
}

impl StepList {
    pub(crate) fn iter(&self) -> impl Iterator<Item = Square> + '_ {
        self.squares
            .iter()
            .take(self.len as usize)
            .map(|&s| Square(s))
    }
}

const fn build_steps(offsets: &[(i8, i8); 8]) -> [StepList; NUM_SQUARES] {
    let mut table = [StepList {
        len: 0,
        squares: [0; 8],
    }; NUM_SQUARES];
    let mut s = 0;
    while s < NUM_SQUARES {
        let sq = Square(s as u8);
        let mut i = 0;
        while i < 8 {
            if let Some(t) = sq.offset(offsets[i].0, offsets[i].1) {
                let n = table[s].len as usize;
                table[s].squares[n] = t.0;
                table[s].len += 1;
            }
            i += 1;
        }
        s += 1;
    }
    table
}

const fn build_ray_len() -> [[u8; 8]; NUM_SQUARES] {
    let mut table = [[0u8; 8]; NUM_SQUARES];
    let mut s = 0;
    while s < NUM_SQUARES {
        let mut d = 0;
        while d < 8 {
            let (df, dr) = DIRS[d];
            let size = BOARD_SIZE as i8;
            let mut f = (s % BOARD_SIZE as usize) as i8 + df;
            let mut r = (s / BOARD_SIZE as usize) as i8 + dr;
            let mut n = 0u8;
            while f >= 0 && f < size && r >= 0 && r < size {
                n += 1;
                f += df;
                r += dr;
            }
            table[s][d] = n;
            d += 1;
        }
        s += 1;
    }
    table
}

pub(crate) static KNIGHT_STEPS: [StepList; NUM_SQUARES] = build_steps(&KNIGHT_OFFSETS);
pub(crate) static KING_STEPS: [StepList; NUM_SQUARES] = build_steps(&DIRS);
static RAY_LEN: [[u8; 8]; NUM_SQUARES] = build_ray_len();

/// Squares along direction `dir` from `sq` (excluding `sq`), nearest first,
/// up to the board edge.
pub(crate) fn ray(sq: Square, dir: usize) -> impl Iterator<Item = Square> {
    let len = RAY_LEN[sq.index()][dir & 7] as i16;
    let delta = DIR_DELTA[dir & 7];
    let start = sq.0 as i16;
    (1..=len).map(move |k| Square((start + k * delta) as u8))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sq(s: &str) -> Square {
        s.parse().unwrap()
    }

    #[test]
    fn coordinates_and_names() {
        assert_eq!(sq("a1").index(), 0);
        assert_eq!(sq("p1").index(), 15);
        assert_eq!(sq("a16").index(), 240);
        assert_eq!(sq("p16").index(), 255);
        assert_eq!(sq("g1").file(), 6);
        assert_eq!(sq("a10").rank(), 9);
        assert_eq!(sq("p16").file(), 15);
        assert_eq!(sq("p16").rank(), 15);
        assert_eq!(Square::all().count(), 256);
        assert_eq!(Square::all().last(), Some(sq("p16")));
        for s in Square::all() {
            assert_eq!(s.to_string().parse::<Square>().unwrap(), s);
        }
        for i in 0..=255u8 {
            assert_eq!(Square::new(i).unwrap().to_u8(), i);
        }
    }

    #[test]
    fn rejects_bad_squares() {
        for bad in [
            "", "a", "a0", "a17", "q1", "A1", "a01", "a1x", "1a", "a100", "p99", "p17", "m160",
        ] {
            assert!(bad.parse::<Square>().is_err(), "{bad} should not parse");
        }
        for good in ["l12", "m13", "p16", "a16", "h9"] {
            assert!(good.parse::<Square>().is_ok(), "{good} should parse");
        }
    }

    #[test]
    fn square_colors() {
        // a1 (0,0) is dark; light iff file + rank (0-based) is odd.
        assert!(!sq("a1").is_light());
        assert!(sq("b1").is_light());
        assert!(!sq("p16").is_light()); // 15 + 15 = 30, even
        assert!(sq("p1").is_light()); // 15 + 0 = 15, odd
        // Queens on their own color (§2): h1 = (7,0) -> 7 odd -> light;
        // a8 = (0,7) -> light; h16 = (7,15) -> 22 even -> dark;
        // p8 = (15,7) -> 22 even -> dark.
        assert!(sq("h1").is_light()); // South
        assert!(sq("a8").is_light()); // West
        assert!(!sq("h16").is_light()); // North
        assert!(!sq("p8").is_light()); // East
    }

    #[test]
    fn seats_and_teams() {
        assert_eq!(Seat::South.next(), Seat::West);
        assert_eq!(Seat::East.next(), Seat::South);
        assert_eq!(Seat::West.partner(), Seat::East);
        assert_eq!(Seat::North.team(), Team::SouthNorth);
        assert_eq!(Team::WestEast.seats(), [Seat::West, Seat::East]);
        for s in Seat::ALL {
            assert_eq!(Seat::from_index(s.index()), Some(s));
            assert_eq!(Seat::from_letter(s.letter()), Some(s));
        }
    }

    #[test]
    fn progress_lines() {
        // Pawn start lines are progress 1, promotion lines progress 8.
        assert_eq!(Seat::South.progress(sq("f2")), 1);
        assert_eq!(Seat::South.progress(sq("f9")), 8);
        assert_eq!(Seat::North.progress(sq("f15")), 1);
        assert_eq!(Seat::North.progress(sq("f8")), 8);
        assert_eq!(Seat::West.progress(sq("b7")), 1);
        assert_eq!(Seat::West.progress(sq("i7")), 8);
        assert_eq!(Seat::East.progress(sq("o7")), 1);
        assert_eq!(Seat::East.progress(sq("h7")), 8);
    }

    #[test]
    fn tables() {
        assert_eq!(KNIGHT_STEPS[0].iter().count(), 2);
        assert_eq!(KING_STEPS[0].iter().count(), 3);
        assert_eq!(KING_STEPS[sq("f6").index()].iter().count(), 8);
        assert_eq!(KNIGHT_STEPS[sq("p16").index()].iter().count(), 2);
        assert_eq!(KING_STEPS[sq("p16").index()].iter().count(), 3);
        let north: Vec<Square> = ray(sq("a1"), 0).collect();
        assert_eq!(north.len(), 15);
        assert_eq!(north[14], sq("a16"));
        let diag: Vec<Square> = ray(sq("p1"), 7).collect();
        assert_eq!(diag.len(), 15);
        assert_eq!(diag.last(), Some(&sq("a16")));
        let east: Vec<Square> = ray(sq("a16"), 1).collect();
        assert_eq!(east.last(), Some(&sq("p16")));
        // Diagonal from p16 toward a1 reaches every square of the long diagonal.
        let sw: Vec<Square> = ray(sq("p16"), 6).collect();
        assert_eq!(sw.len(), 15);
        assert_eq!(sw.last(), Some(&sq("a1")));
    }
}
