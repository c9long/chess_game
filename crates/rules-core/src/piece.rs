//! Piece kinds, pieces and kind sets.
//!
//! Movement is defined per [`PieceKind`] in [`crate::movegen`]. Which kinds a
//! seat may own, and which of them are leaders, is civ data
//! ([`crate::civ::Roster`]), not hard-coded logic.

use core::fmt;

use crate::geometry::Seat;

/// A piece type: the six standard chess kinds plus the civ-specific kinds.
/// Which kinds a seat fields is civ data ([`crate::civ::Roster`]).
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
#[repr(u8)]
pub enum PieceKind {
    /// Moves one step forward (two from its start line), captures diagonally forward.
    Pawn = 0,
    /// Leaps in an L shape.
    Knight = 1,
    /// Slides diagonally.
    Bishop = 2,
    /// Slides orthogonally.
    Rook = 3,
    /// Slides in all eight directions.
    Queen = 4,
    /// Steps one square in any direction. The standard leader.
    King = 5,
    /// England (civ version 2): moves like a knight **or** a king (the union
    /// of both move sets; never castles, never double-steps). Letter `M`.
    PrimeMinister = 6,
}

impl PieceKind {
    /// Number of piece kinds.
    pub const COUNT: usize = 7;
    /// All kinds in index order.
    pub const ALL: [PieceKind; 7] = [
        PieceKind::Pawn,
        PieceKind::Knight,
        PieceKind::Bishop,
        PieceKind::Rook,
        PieceKind::Queen,
        PieceKind::King,
        PieceKind::PrimeMinister,
    ];

    /// Index `0..COUNT`.
    pub const fn index(self) -> usize {
        self as usize
    }

    /// Uppercase letter: `P N B R Q K M` (`M` = Prime Minister).
    pub const fn letter(self) -> char {
        match self {
            PieceKind::Pawn => 'P',
            PieceKind::Knight => 'N',
            PieceKind::Bishop => 'B',
            PieceKind::Rook => 'R',
            PieceKind::Queen => 'Q',
            PieceKind::King => 'K',
            PieceKind::PrimeMinister => 'M',
        }
    }

    /// Parses a piece letter (case-insensitive).
    pub const fn from_letter(c: char) -> Option<PieceKind> {
        match c {
            'P' | 'p' => Some(PieceKind::Pawn),
            'N' | 'n' => Some(PieceKind::Knight),
            'B' | 'b' => Some(PieceKind::Bishop),
            'R' | 'r' => Some(PieceKind::Rook),
            'Q' | 'q' => Some(PieceKind::Queen),
            'K' | 'k' => Some(PieceKind::King),
            'M' | 'm' => Some(PieceKind::PrimeMinister),
            _ => None,
        }
    }

    /// Lowercase name (`"pawn"`, ..., `"prime minister"`).
    pub const fn name(self) -> &'static str {
        match self {
            PieceKind::Pawn => "pawn",
            PieceKind::Knight => "knight",
            PieceKind::Bishop => "bishop",
            PieceKind::Rook => "rook",
            PieceKind::Queen => "queen",
            PieceKind::King => "king",
            PieceKind::PrimeMinister => "prime minister",
        }
    }
}

impl fmt::Display for PieceKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

/// A piece on the board: a kind and the seat that owns it.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Piece {
    /// What kind of piece this is.
    pub kind: PieceKind,
    /// The seat that owns (and moves) it.
    pub owner: Seat,
}

impl Piece {
    /// Builds a piece.
    pub const fn new(kind: PieceKind, owner: Seat) -> Piece {
        Piece { kind, owner }
    }
}

/// A set of piece kinds (bit set).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct KindSet(u8);

impl KindSet {
    /// The empty set.
    pub const EMPTY: KindSet = KindSet(0);

    /// A set holding exactly `kinds`.
    pub const fn of(kinds: &[PieceKind]) -> KindSet {
        let mut bits = 0u8;
        let mut i = 0;
        while i < kinds.len() {
            bits |= 1 << kinds[i] as u8;
            i += 1;
        }
        KindSet(bits)
    }

    /// Whether `kind` is in the set.
    pub const fn contains(self, kind: PieceKind) -> bool {
        self.0 & (1 << kind as u8) != 0
    }

    /// The set with `kind` added.
    pub const fn with(self, kind: PieceKind) -> KindSet {
        KindSet(self.0 | (1 << kind as u8))
    }

    /// The set with `kind` removed.
    pub const fn without(self, kind: PieceKind) -> KindSet {
        KindSet(self.0 & !(1 << kind as u8))
    }

    /// Kinds in `self` but not in `other`.
    pub const fn difference(self, other: KindSet) -> KindSet {
        KindSet(self.0 & !other.0)
    }

    /// Whether every kind of `self` is also in `other`.
    pub const fn is_subset(self, other: KindSet) -> bool {
        self.0 & !other.0 == 0
    }

    /// Whether the set is empty.
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// Number of kinds in the set.
    pub const fn len(self) -> usize {
        self.0.count_ones() as usize
    }

    /// Kinds in index order.
    pub fn iter(self) -> impl Iterator<Item = PieceKind> + Clone {
        PieceKind::ALL
            .into_iter()
            .filter(move |&k| self.contains(k))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_round_trip() {
        for k in PieceKind::ALL {
            assert_eq!(PieceKind::from_letter(k.letter()), Some(k));
            assert_eq!(
                PieceKind::from_letter(k.letter().to_ascii_lowercase()),
                Some(k)
            );
        }
        assert_eq!(PieceKind::from_letter('x'), None);
        assert_eq!(PieceKind::from_letter('M'), Some(PieceKind::PrimeMinister));
        assert_eq!(PieceKind::PrimeMinister.letter(), 'M');
        assert_eq!(PieceKind::PrimeMinister.to_string(), "prime minister");
        // Every kind fits the u8 bit set.
        const _: () = assert!(PieceKind::COUNT <= 8);
        let all = KindSet::of(&PieceKind::ALL);
        assert_eq!(all.len(), PieceKind::COUNT);
        assert!(all.contains(PieceKind::PrimeMinister));
    }

    #[test]
    fn kind_sets() {
        let s = KindSet::of(&[PieceKind::Queen, PieceKind::Rook]);
        assert!(s.contains(PieceKind::Rook));
        assert!(!s.contains(PieceKind::King));
        assert_eq!(s.len(), 2);
        assert_eq!(
            s.iter().collect::<Vec<_>>(),
            vec![PieceKind::Rook, PieceKind::Queen]
        );
        assert!(
            s.without(PieceKind::Rook)
                .with(PieceKind::Knight)
                .contains(PieceKind::Knight)
        );
        assert!(KindSet::EMPTY.is_empty());
        assert!(s.is_subset(s.with(PieceKind::Pawn)));
    }

    #[test]
    fn option_piece_is_two_bytes() {
        assert_eq!(core::mem::size_of::<Option<Piece>>(), 2);
    }
}
