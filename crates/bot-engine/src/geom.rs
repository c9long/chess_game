//! Precomputed board tables used by the evaluation (rules-core keeps its own
//! tables private), plus a tiny 144-bit set.

/// Number of squares.
pub(crate) const NSQ: usize = 144;
/// Board side length.
const SIZE: i32 = 12;

/// Ray directions as (file delta, rank delta); 0..4 orthogonal, 4..8 diagonal.
pub(crate) const DIR_DF: [i32; 8] = [0, 1, 0, -1, 1, 1, -1, -1];
pub(crate) const DIR_DR: [i32; 8] = [1, 0, -1, 0, 1, -1, -1, 1];
/// Index delta of one step in each direction.
pub(crate) const DIR_DELTA: [isize; 8] = {
    let mut d = [0isize; 8];
    let mut i = 0;
    while i < 8 {
        d[i] = (DIR_DF[i] + SIZE * DIR_DR[i]) as isize;
        i += 1;
    }
    d
};

const KNIGHT_OFFSETS: [(i32, i32); 8] = [
    (1, 2),
    (2, 1),
    (2, -1),
    (1, -2),
    (-1, -2),
    (-2, -1),
    (-2, 1),
    (-1, 2),
];

/// A set of squares (144 bits).
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub(crate) struct Bits(pub [u64; 3]);

impl Bits {
    pub(crate) const EMPTY: Bits = Bits([0; 3]);

    #[inline]
    pub(crate) fn set(&mut self, sq: usize) {
        self.0[sq >> 6] |= 1u64 << (sq & 63);
    }

    #[inline]
    pub(crate) fn get(&self, sq: usize) -> bool {
        self.0[sq >> 6] & (1u64 << (sq & 63)) != 0
    }

    #[inline]
    pub(crate) fn and_count(&self, other: &Bits) -> u32 {
        (self.0[0] & other.0[0]).count_ones()
            + (self.0[1] & other.0[1]).count_ones()
            + (self.0[2] & other.0[2]).count_ones()
    }
}

/// All precomputed tables.
pub(crate) struct Tables {
    pub knight: [[u8; 8]; NSQ],
    pub knight_n: [u8; NSQ],
    pub king: [[u8; 8]; NSQ],
    pub king_n: [u8; NSQ],
    /// Number of squares from `sq` to the edge in each direction.
    pub ray_len: [[u8; 8]; NSQ],
    /// Squares within one king step of `sq` (excluding `sq`).
    pub zone: [Bits; NSQ],
}

const fn on_board(f: i32, r: i32) -> bool {
    f >= 0 && f < SIZE && r >= 0 && r < SIZE
}

const fn build() -> Tables {
    let mut t = Tables {
        knight: [[0; 8]; NSQ],
        knight_n: [0; NSQ],
        king: [[0; 8]; NSQ],
        king_n: [0; NSQ],
        ray_len: [[0; 8]; NSQ],
        zone: [Bits::EMPTY; NSQ],
    };
    let mut sq = 0;
    while sq < NSQ {
        let f = (sq % 12) as i32;
        let r = (sq / 12) as i32;
        let mut i = 0;
        while i < 8 {
            let (df, dr) = KNIGHT_OFFSETS[i];
            if on_board(f + df, r + dr) {
                let n = t.knight_n[sq] as usize;
                t.knight[sq][n] = ((r + dr) * SIZE + f + df) as u8;
                t.knight_n[sq] += 1;
            }
            let (kf, kr) = (f + DIR_DF[i], r + DIR_DR[i]);
            if on_board(kf, kr) {
                let n = t.king_n[sq] as usize;
                let to = (kr * SIZE + kf) as usize;
                t.king[sq][n] = to as u8;
                t.king_n[sq] += 1;
                t.zone[sq].0[to >> 6] |= 1u64 << (to & 63);
            }
            let mut len = 0;
            let (mut cf, mut cr) = (f + DIR_DF[i], r + DIR_DR[i]);
            while on_board(cf, cr) {
                len += 1;
                cf += DIR_DF[i];
                cr += DIR_DR[i];
            }
            t.ray_len[sq][i] = len;
            i += 1;
        }
        sq += 1;
    }
    t
}

pub(crate) static T: Tables = build();

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables() {
        // a1 = 0: knight b3, c2; king a2, b1, b2.
        assert_eq!(T.knight_n[0], 2);
        assert_eq!(T.king_n[0], 3);
        assert_eq!(T.ray_len[0][0], 11);
        assert_eq!(T.ray_len[0][4], 11);
        assert_eq!(T.ray_len[0][2], 0);
        // A central square has 8 knight and king steps.
        assert_eq!(T.knight_n[5 * 12 + 5], 8);
        assert_eq!(T.king_n[5 * 12 + 5], 8);
        let mut b = Bits::EMPTY;
        b.set(143);
        assert!(b.get(143));
        assert!(!b.get(142));
        assert_eq!(T.zone[13].and_count(&T.zone[13]), 8);
    }
}
