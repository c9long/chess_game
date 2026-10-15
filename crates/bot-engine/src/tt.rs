//! Transposition table keyed on the rules-core Zobrist hash (XOR a per-search
//! salt). The hash excludes the no-progress counter, so the search neither
//! probes for cutoffs nor stores entries when the counter is close to the
//! move limit (see `search::TT_LIMIT_GUARD`).

use rules_core::{Move, MoveFlag, PieceKind, Square};

/// A search move: a real move plus, inside a BRS MIN layer, the index of the
/// opponent (in turn order after the root seat) that plays it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct SMove {
    pub mv: Move,
    pub k: u8,
}

impl SMove {
    pub(crate) const fn plain(mv: Move) -> SMove {
        SMove { mv, k: 0 }
    }
}

pub(crate) fn pack(sm: SMove) -> u32 {
    let promo = match sm.mv.promotion {
        None => 0u32,
        Some(k) => 1 + k.index() as u32,
    };
    let flag = match sm.mv.flag {
        MoveFlag::Normal => 0u32,
        MoveFlag::DoubleStep => 1,
        MoveFlag::Castle => 2,
        MoveFlag::EnPassant => 3,
    };
    (1 << 31)
        | u32::from(sm.mv.from.to_u8())
        | (u32::from(sm.mv.to.to_u8()) << 8)
        | (promo << 16)
        | (flag << 20)
        | (u32::from(sm.k & 0xF) << 24)
}

pub(crate) fn unpack(v: u32) -> Option<SMove> {
    if v & (1 << 31) == 0 {
        return None;
    }
    let from = Square::new((v & 0xFF) as u8)?;
    let to = Square::new(((v >> 8) & 0xFF) as u8)?;
    let promo = (v >> 16) & 0xF;
    let promotion = if promo == 0 {
        None
    } else {
        Some(*PieceKind::ALL.get(promo as usize - 1)?)
    };
    let flag = match (v >> 20) & 0xF {
        0 => MoveFlag::Normal,
        1 => MoveFlag::DoubleStep,
        2 => MoveFlag::Castle,
        3 => MoveFlag::EnPassant,
        _ => return None,
    };
    Some(SMove {
        mv: Move {
            from,
            to,
            promotion,
            flag,
        },
        k: ((v >> 24) & 0xF) as u8,
    })
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Bound {
    Exact,
    Lower,
    Upper,
}

/// A decoded slot. Stored packed in a `u128` (so a new table is a zeroed
/// allocation, which the OS provides lazily) with the upper 32 key bits as
/// the check (the lower bits select the slot).
#[derive(Clone, Copy, Default)]
struct Entry {
    check: u32,
    mv: u32,
    score: i32,
    depth: i16,
    bound: u8,
    age: u8,
}

impl Entry {
    fn encode(self) -> u128 {
        u128::from(self.check)
            | (u128::from(self.mv) << 32)
            | (u128::from(self.score as u32) << 64)
            | (u128::from(self.depth as u16) << 96)
            | (u128::from(self.bound) << 112)
            | (u128::from(self.age) << 120)
    }

    fn decode(v: u128) -> Entry {
        Entry {
            check: v as u32,
            mv: (v >> 32) as u32,
            score: (v >> 64) as u32 as i32,
            depth: (v >> 96) as u16 as i16,
            bound: (v >> 112) as u8,
            age: (v >> 120) as u8,
        }
    }
}

fn check_of(key: u64) -> u32 {
    (key >> 32) as u32
}

/// What a probe returns.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Hit {
    pub mv: Option<SMove>,
    pub score: i32,
    pub depth: i32,
    pub bound: Bound,
}

pub(crate) struct Tt {
    entries: Vec<u128>,
    mask: usize,
    age: u8,
}

impl Tt {
    /// A table of about `mb` megabytes (at least 1024 entries).
    pub(crate) fn new(mb: usize) -> Tt {
        let want = (mb.max(1) * 1024 * 1024) / core::mem::size_of::<u128>();
        let mut len = 1024usize;
        while len * 2 <= want {
            len *= 2;
        }
        Tt {
            entries: vec![0u128; len],
            mask: len - 1,
            age: 0,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.entries.fill(0);
        self.age = 0;
    }

    pub(crate) fn new_search(&mut self) {
        self.age = self.age.wrapping_add(1);
    }

    pub(crate) fn probe(&self, key: u64) -> Option<Hit> {
        let e = Entry::decode(self.entries[(key as usize) & self.mask]);
        if e.check != check_of(key) || e.bound == 0 {
            return None;
        }
        Some(Hit {
            mv: unpack(e.mv),
            score: e.score,
            depth: i32::from(e.depth),
            bound: match e.bound {
                1 => Bound::Exact,
                2 => Bound::Lower,
                _ => Bound::Upper,
            },
        })
    }

    pub(crate) fn store(
        &mut self,
        key: u64,
        mv: Option<SMove>,
        score: i32,
        depth: i32,
        bound: Bound,
    ) {
        let age = self.age;
        let slot = &mut self.entries[(key as usize) & self.mask];
        let e = Entry::decode(*slot);
        let same = e.check == check_of(key) && e.bound != 0;
        let replace = !same || e.age != age || depth >= i32::from(e.depth) || bound == Bound::Exact;
        if !same && e.bound != 0 && e.age == age && i32::from(e.depth) > depth + 2 {
            return; // keep a much deeper entry from this search
        }
        if !replace {
            return;
        }
        let packed = match mv {
            Some(m) => pack(m),
            None if same => e.mv,
            None => 0,
        };
        *slot = Entry {
            check: check_of(key),
            mv: packed,
            score,
            depth: depth.clamp(-100, 1000) as i16,
            bound: match bound {
                Bound::Exact => 1,
                Bound::Lower => 2,
                Bound::Upper => 3,
            },
            age,
        }
        .encode();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_roundtrip() {
        let m = Move {
            from: Square::new(17).unwrap(),
            to: Square::new(143).unwrap(),
            promotion: Some(PieceKind::Queen),
            flag: MoveFlag::EnPassant,
        };
        let sm = SMove { mv: m, k: 2 };
        assert_eq!(unpack(pack(sm)), Some(sm));
        assert_eq!(unpack(0), None);
    }

    #[test]
    fn store_probe() {
        let mut tt = Tt::new(1);
        let m = SMove::plain(Move::new(Square::new(1).unwrap(), Square::new(2).unwrap()));
        tt.store(12345, Some(m), 77, 3, Bound::Lower);
        let h = tt.probe(12345).unwrap();
        assert_eq!(h.mv, Some(m));
        assert_eq!(h.score, 77);
        assert_eq!(h.depth, 3);
        assert_eq!(h.bound, Bound::Lower);
        assert!(tt.probe(12346).is_none());
    }
}
