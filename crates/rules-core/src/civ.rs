//! Civilizations: rosters, leader roles and modifier hooks.
//!
//! A civ is identified by [`CivId`] plus an immutable `version`. Each
//! `(id, version)` pair resolves to a static [`CivDefinition`] holding:
//!
//! * a [`Roster`]: which piece kinds the civ may own, which of those carry the
//!   **leader** role, which kinds a pawn may promote to (its own list, separate
//!   from the starting army) and the starting back line (pawns are always the
//!   standard eight);
//! * [`CivHooks`]: optional modifier functions the rules engine calls at fixed
//!   points. Every hook is `None` so far, which means "standard rules".
//!
//! Version 1 of every civ uses the standard roster (P N B R Q K) with the King
//! as the single leader, and has no hooks. Changing a civ's rules means adding
//! a *new* version; old versions stay so replays re-simulate exactly.
//!
//! **England version 2** (the first civ with a special army): the king, queen
//! and both knights are replaced by four **Prime Ministers**
//! ([`PieceKind::PrimeMinister`], letter `M`) on those four squares. All four
//! are leaders, so the default defeat condition ("holds no leader pieces")
//! eliminates England only when the last one is captured. England can't castle
//! (it has more than one leader piece, see [`Roster::castling_leader`]), and its
//! pawns still promote to Q, R, B or N, never to a Prime Minister.
//!
//! New games use [`CivId::latest_version`] of each civ; matches store the
//! version per seat.

use core::fmt;

use crate::geometry::Seat;
use crate::movegen::Move;
use crate::piece::{KindSet, PieceKind};
use crate::setup::{BACK_LINE_KINDS, LEADER_HOME_INDEX};
use crate::state::GameState;

/// The nine selectable civilizations (cosmetic at version 1; see the module
/// docs for the versions that change rules).
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
#[repr(u8)]
pub enum CivId {
    /// Canada.
    Canada = 0,
    /// United States.
    Usa = 1,
    /// China.
    China = 2,
    /// Japan.
    Japan = 3,
    /// Germany.
    Germany = 4,
    /// Russia.
    Russia = 5,
    /// England.
    England = 6,
    /// France.
    France = 7,
    /// Mali.
    Mali = 8,
}

impl CivId {
    /// All civs.
    pub const ALL: [CivId; 9] = [
        CivId::Canada,
        CivId::Usa,
        CivId::China,
        CivId::Japan,
        CivId::Germany,
        CivId::Russia,
        CivId::England,
        CivId::France,
        CivId::Mali,
    ];

    /// Stable lowercase identifier (`"canada"`, `"usa"`, ...).
    pub const fn slug(self) -> &'static str {
        match self {
            CivId::Canada => "canada",
            CivId::Usa => "usa",
            CivId::China => "china",
            CivId::Japan => "japan",
            CivId::Germany => "germany",
            CivId::Russia => "russia",
            CivId::England => "england",
            CivId::France => "france",
            CivId::Mali => "mali",
        }
    }

    /// Parses a slug produced by [`CivId::slug`].
    pub fn from_slug(s: &str) -> Option<CivId> {
        CivId::ALL.into_iter().find(|c| c.slug() == s)
    }

    /// The newest version of this civ's definition (used for new games).
    pub const fn latest_version(self) -> u32 {
        match self {
            CivId::England => 2,
            _ => 1,
        }
    }
}

impl fmt::Display for CivId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.slug())
    }
}

/// Which piece kinds a civ may own, which of them are leaders, what its pawns
/// may promote to and how its back line starts.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Roster {
    kinds: KindSet,
    leaders: KindSet,
    promotions: KindSet,
    back_line: [PieceKind; 8],
}

impl Roster {
    /// The standard roster: P N B R Q K, King is the single leader, pawns
    /// promote to N B R Q, back line R N B Q K B N R.
    pub const STANDARD: Roster = Roster {
        kinds: KindSet::of(&[
            PieceKind::Pawn,
            PieceKind::Knight,
            PieceKind::Bishop,
            PieceKind::Rook,
            PieceKind::Queen,
            PieceKind::King,
        ]),
        leaders: KindSet::of(&[PieceKind::King]),
        promotions: KindSet::of(&[
            PieceKind::Knight,
            PieceKind::Bishop,
            PieceKind::Rook,
            PieceKind::Queen,
        ]),
        back_line: BACK_LINE_KINDS,
    };

    /// England version 2: four Prime Ministers (all leaders) on the K, Q and
    /// both N squares; Q and N stay in the roster as promotion choices.
    pub const ENGLAND_PRIME_MINISTERS: Roster = Roster {
        kinds: KindSet::of(&[
            PieceKind::Pawn,
            PieceKind::Knight,
            PieceKind::Bishop,
            PieceKind::Rook,
            PieceKind::Queen,
            PieceKind::PrimeMinister,
        ]),
        leaders: KindSet::of(&[PieceKind::PrimeMinister]),
        promotions: KindSet::of(&[
            PieceKind::Knight,
            PieceKind::Bishop,
            PieceKind::Rook,
            PieceKind::Queen,
        ]),
        back_line: [
            PieceKind::Rook,
            PieceKind::PrimeMinister,
            PieceKind::Bishop,
            PieceKind::PrimeMinister,
            PieceKind::PrimeMinister,
            PieceKind::Bishop,
            PieceKind::PrimeMinister,
            PieceKind::Rook,
        ],
    };

    /// Builds a roster. Returns `None` unless:
    /// * every leader, promotion choice and back-line kind is in `kinds`;
    /// * promotion choices are neither leaders nor pawns;
    /// * the back line holds no pawn and at least one leader piece.
    pub const fn new(
        kinds: KindSet,
        leaders: KindSet,
        promotions: KindSet,
        back_line: [PieceKind; 8],
    ) -> Option<Roster> {
        if !leaders.is_subset(kinds) || !promotions.is_subset(kinds) {
            return None;
        }
        // Promotion choices are never pawns or leaders.
        if promotions.contains(PieceKind::Pawn)
            || promotions.difference(leaders).len() != promotions.len()
        {
            return None;
        }
        let mut has_leader = false;
        let mut j = 0;
        while j < 8 {
            let kind = back_line[j];
            if !kinds.contains(kind) || matches!(kind, PieceKind::Pawn) {
                return None;
            }
            if leaders.contains(kind) {
                has_leader = true;
            }
            j += 1;
        }
        if !has_leader {
            return None;
        }
        Some(Roster {
            kinds,
            leaders,
            promotions,
            back_line,
        })
    }

    /// All kinds the civ may own (including promotion-only kinds).
    pub const fn kinds(self) -> KindSet {
        self.kinds
    }

    /// Kinds with the leader role.
    pub const fn leaders(self) -> KindSet {
        self.leaders
    }

    /// Whether the civ may own `kind`.
    pub const fn contains(self, kind: PieceKind) -> bool {
        self.kinds.contains(kind)
    }

    /// Whether `kind` has the leader role.
    pub const fn is_leader(self, kind: PieceKind) -> bool {
        self.leaders.contains(kind)
    }

    /// Kinds a pawn may promote to (roster data, independent of the starting
    /// army; never a leader or a pawn).
    pub const fn promotion_choices(self) -> KindSet {
        self.promotions
    }

    /// The starting back line, from the long-rook end (see
    /// [`crate::setup::back_line`] for the squares).
    pub const fn back_line(self) -> [PieceKind; 8] {
        self.back_line
    }

    /// Number of leader pieces the civ starts with.
    pub const fn starting_leaders(self) -> u32 {
        let mut n = 0;
        let mut i = 0;
        while i < 8 {
            if self.leaders.contains(self.back_line[i]) {
                n += 1;
            }
            i += 1;
        }
        n
    }

    /// The leader kind if the roster has exactly one leader *kind* (it may
    /// still start with several pieces of it; see [`Roster::castling_leader`]).
    pub fn single_leader(self) -> Option<PieceKind> {
        let mut it = self.leaders.iter();
        match (it.next(), it.next()) {
            (Some(k), None) => Some(k),
            _ => None,
        }
    }

    /// The piece kind that castles, if this civ may castle at all: only a civ
    /// that starts with exactly **one** leader piece, standing on the leader
    /// home square, castles. Civs with more than one leader piece (England
    /// v2's four Prime Ministers) never castle.
    pub const fn castling_leader(self) -> Option<PieceKind> {
        let home = self.back_line[LEADER_HOME_INDEX];
        if self.starting_leaders() == 1 && self.leaders.contains(home) {
            Some(home)
        } else {
            None
        }
    }
}

/// Custom defeat condition: returns `true` when `seat` should be defeated.
/// Replaces the default "holds no leader pieces".
pub type DefeatConditionFn = fn(&GameState, Seat) -> bool;

/// Post-processes the standard moves generated for `seat` (may add or remove
/// moves). Added moves are applied with the standard move application
/// (piece moves from `from` to `to`, capturing whatever stands there).
pub type ModifyMovesFn = fn(&GameState, Seat, &mut Vec<Move>);

/// Optional civ modifier hooks. `None` everywhere means standard rules.
///
/// Further hook points listed in PLAN §2 (capture effects, turn-start effects,
/// setup changes) will be added here together with the first civ version that
/// needs them; adding a field with a `None` default does not change existing
/// civ versions.
#[derive(Clone, Copy, Debug)]
pub struct CivHooks {
    /// Replaces the default defeat condition.
    pub defeat_condition: Option<DefeatConditionFn>,
    /// Adds/removes moves after standard generation.
    pub modify_moves: Option<ModifyMovesFn>,
}

impl CivHooks {
    /// No hooks: standard rules.
    pub const NONE: CivHooks = CivHooks {
        defeat_condition: None,
        modify_moves: None,
    };

    /// Whether every hook is `None`.
    pub const fn is_empty(&self) -> bool {
        self.defeat_condition.is_none() && self.modify_moves.is_none()
    }
}

/// An immutable, versioned civ definition.
#[derive(Clone, Copy, Debug)]
pub struct CivDefinition {
    /// Which civ.
    pub id: CivId,
    /// Definition version (stored per seat with every match).
    pub version: u32,
    /// Piece roster and leader roles.
    pub roster: Roster,
    /// Rule modifiers (all empty so far).
    pub hooks: CivHooks,
}

impl CivDefinition {
    /// Whether this definition differs from the standard rules (a special
    /// roster or any hook).
    pub fn is_special(&self) -> bool {
        self.roster != Roster::STANDARD || !self.hooks.is_empty()
    }
}

const fn standard_v1(id: CivId) -> CivDefinition {
    CivDefinition {
        id,
        version: 1,
        roster: Roster::STANDARD,
        hooks: CivHooks::NONE,
    }
}

static CIVS_V1: [CivDefinition; 9] = [
    standard_v1(CivId::Canada),
    standard_v1(CivId::Usa),
    standard_v1(CivId::China),
    standard_v1(CivId::Japan),
    standard_v1(CivId::Germany),
    standard_v1(CivId::Russia),
    standard_v1(CivId::England),
    standard_v1(CivId::France),
    standard_v1(CivId::Mali),
];

/// England version 2: four Prime Ministers replace the king, queen and knights.
static ENGLAND_V2: CivDefinition = CivDefinition {
    id: CivId::England,
    version: 2,
    roster: Roster::ENGLAND_PRIME_MINISTERS,
    hooks: CivHooks::NONE,
};

/// Looks up the definition of civ `id` at `version`. Every version ever
/// published stays defined (immutable), so old matches re-simulate exactly.
pub fn civ_definition(id: CivId, version: u32) -> Option<&'static CivDefinition> {
    match (id, version) {
        (_, 1) => CIVS_V1.get(id as usize),
        (CivId::England, 2) => Some(&ENGLAND_V2),
        _ => None,
    }
}

/// Fallback used only if an unvalidated config slips through; never reached
/// for states built through the public constructors.
pub(crate) static FALLBACK_CIV: CivDefinition = standard_v1(CivId::Canada);

#[cfg(test)]
mod tests {
    use super::*;
    use PieceKind::*;

    #[test]
    fn all_v1_civs_are_standard() {
        for id in CivId::ALL {
            let def = civ_definition(id, 1).unwrap();
            assert_eq!(def.id, id);
            assert_eq!(def.version, 1);
            assert_eq!(def.roster, Roster::STANDARD);
            assert!(def.hooks.is_empty());
            assert!(!def.is_special());
            assert_eq!(CivId::from_slug(id.slug()), Some(id));
            // A civ with no leader would need a custom defeat condition.
            assert!(!def.roster.leaders().is_empty() || def.hooks.defeat_condition.is_some());
        }
        assert!(civ_definition(CivId::Mali, 2).is_none());
        assert!(civ_definition(CivId::Mali, 0).is_none());
        assert!(civ_definition(CivId::England, 3).is_none());
    }

    #[test]
    fn latest_versions() {
        for id in CivId::ALL {
            let latest = id.latest_version();
            let expect = if id == CivId::England { 2 } else { 1 };
            assert_eq!(latest, expect, "{id}");
            // Every version up to the latest stays defined (immutable history).
            for v in 1..=latest {
                let def = civ_definition(id, v).unwrap();
                assert_eq!((def.id, def.version), (id, v));
            }
            assert!(civ_definition(id, latest + 1).is_none());
        }
    }

    #[test]
    fn england_v2_prime_ministers() {
        let def = civ_definition(CivId::England, 2).unwrap();
        assert!(def.is_special());
        assert!(def.hooks.is_empty(), "the default defeat condition applies");
        let r = def.roster;
        assert_eq!(r, Roster::ENGLAND_PRIME_MINISTERS);
        assert_eq!(
            r.back_line(),
            [
                Rook,
                PrimeMinister,
                Bishop,
                PrimeMinister,
                PrimeMinister,
                Bishop,
                PrimeMinister,
                Rook
            ]
        );
        assert_eq!(r.leaders().iter().collect::<Vec<_>>(), [PrimeMinister]);
        assert_eq!(r.starting_leaders(), 4);
        assert!(!r.contains(King));
        // Queen and knight are not in the army but stay promotion choices.
        assert_eq!(
            r.promotion_choices().iter().collect::<Vec<_>>(),
            [Knight, Bishop, Rook, Queen]
        );
        assert!(!r.promotion_choices().contains(PrimeMinister));
        // One leader kind, but four leader pieces: no castling.
        assert_eq!(r.single_leader(), Some(PrimeMinister));
        assert_eq!(r.castling_leader(), None);
        // England v1 stays the standard army.
        assert_eq!(
            civ_definition(CivId::England, 1).unwrap().roster,
            Roster::STANDARD
        );
    }

    #[test]
    fn standard_roster() {
        let r = Roster::STANDARD;
        assert_eq!(r.single_leader(), Some(King));
        assert_eq!(r.castling_leader(), Some(King));
        assert_eq!(r.starting_leaders(), 1);
        assert_eq!(r.back_line(), BACK_LINE_KINDS);
        assert!(!r.contains(PrimeMinister));
        assert_eq!(
            r.promotion_choices().iter().collect::<Vec<_>>(),
            vec![Knight, Bishop, Rook, Queen]
        );
        let std_kinds = Roster::STANDARD.kinds();
        let two = Roster::new(
            std_kinds,
            KindSet::of(&[King, Queen]),
            KindSet::of(&[Knight, Bishop, Rook]),
            BACK_LINE_KINDS,
        )
        .unwrap();
        assert_eq!(two.single_leader(), None);
        assert_eq!(two.castling_leader(), None);
        assert_eq!(two.starting_leaders(), 2);
        // Invalid rosters.
        let promos = Roster::STANDARD.promotion_choices();
        let none = |kinds, leaders, promotions, line| {
            assert!(Roster::new(kinds, leaders, promotions, line).is_none());
        };
        // Leader not in the roster.
        none(
            KindSet::of(&[Pawn]),
            KindSet::of(&[King]),
            KindSet::EMPTY,
            BACK_LINE_KINDS,
        );
        // Promotion to a leader or a pawn.
        none(
            std_kinds,
            KindSet::of(&[King]),
            promos.with(King),
            BACK_LINE_KINDS,
        );
        none(
            std_kinds,
            KindSet::of(&[King]),
            promos.with(Pawn),
            BACK_LINE_KINDS,
        );
        // Promotion to a kind outside the roster.
        none(
            std_kinds,
            KindSet::of(&[King]),
            promos.with(PrimeMinister),
            BACK_LINE_KINDS,
        );
        // Back line with a kind outside the roster, a pawn, or no leader.
        none(
            std_kinds.without(Queen),
            KindSet::of(&[King]),
            promos.without(Queen),
            BACK_LINE_KINDS,
        );
        none(std_kinds, KindSet::of(&[King]), promos, [Pawn; 8]);
        none(std_kinds, KindSet::of(&[King]), promos, [Rook; 8]);
        // The England roster is valid through the constructor too.
        let e = Roster::ENGLAND_PRIME_MINISTERS;
        assert_eq!(
            Roster::new(e.kinds(), e.leaders(), e.promotion_choices(), e.back_line()),
            Some(e)
        );
        let s = Roster::STANDARD;
        assert_eq!(
            Roster::new(s.kinds(), s.leaders(), s.promotion_choices(), s.back_line()),
            Some(s)
        );
    }
}
