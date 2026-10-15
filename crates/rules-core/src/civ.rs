//! Civilizations: rosters, leader roles and modifier hooks.
//!
//! A civ is identified by [`CivId`] plus an immutable `version`. Each
//! `(id, version)` pair resolves to a static [`CivDefinition`] holding:
//!
//! * a [`Roster`]: which piece kinds the civ fields, which of those carry the
//!   **leader** role, and (derived) which kinds a pawn may promote to
//!   (every roster kind that is neither a leader nor a pawn);
//! * [`CivHooks`]: optional modifier functions the rules engine calls at fixed
//!   points. Every hook is `None` in v1, which means "standard rules".
//!
//! v1: all nine civs are version 1, use the standard roster (P N B R Q K) with
//! the King as the single leader, and have no hooks. Changing a civ's rules
//! later means adding a *new* version; old versions stay so replays
//! re-simulate exactly.

use core::fmt;

use crate::geometry::Seat;
use crate::movegen::Move;
use crate::piece::{KindSet, PieceKind};
use crate::state::GameState;

/// The nine selectable civilizations (cosmetic in v1).
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

    /// The newest version of this civ's definition.
    pub const fn latest_version(self) -> u32 {
        1
    }
}

impl fmt::Display for CivId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.slug())
    }
}

/// Which piece kinds a civ fields and which of them are leaders.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Roster {
    kinds: KindSet,
    leaders: KindSet,
}

impl Roster {
    /// The standard roster: P N B R Q K, King is the single leader.
    pub const STANDARD: Roster = Roster {
        kinds: KindSet::of(&PieceKind::ALL),
        leaders: KindSet::of(&[PieceKind::King]),
    };

    /// Builds a roster. Returns `None` if a leader kind is not in `kinds`.
    pub const fn new(kinds: KindSet, leaders: KindSet) -> Option<Roster> {
        if leaders.is_subset(kinds) {
            Some(Roster { kinds, leaders })
        } else {
            None
        }
    }

    /// All kinds in the roster.
    pub const fn kinds(self) -> KindSet {
        self.kinds
    }

    /// Kinds with the leader role.
    pub const fn leaders(self) -> KindSet {
        self.leaders
    }

    /// Whether the civ fields `kind`.
    pub const fn contains(self, kind: PieceKind) -> bool {
        self.kinds.contains(kind)
    }

    /// Whether `kind` has the leader role.
    pub const fn is_leader(self, kind: PieceKind) -> bool {
        self.leaders.contains(kind)
    }

    /// Kinds a pawn may promote to: roster kinds that are neither leaders nor pawns.
    pub const fn promotion_choices(self) -> KindSet {
        self.kinds.difference(self.leaders).without(PieceKind::Pawn)
    }

    /// The leader kind if the roster has exactly one. Only such civs may castle.
    pub fn single_leader(self) -> Option<PieceKind> {
        let mut it = self.leaders.iter();
        match (it.next(), it.next()) {
            (Some(k), None) => Some(k),
            _ => None,
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
    /// Rule modifiers (all empty in v1).
    pub hooks: CivHooks,
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

/// Looks up the definition of civ `id` at `version`.
pub fn civ_definition(id: CivId, version: u32) -> Option<&'static CivDefinition> {
    match version {
        1 => CIVS_V1.get(id as usize),
        _ => None,
    }
}

/// Fallback used only if an unvalidated config slips through; never reached
/// for states built through the public constructors.
pub(crate) static FALLBACK_CIV: CivDefinition = standard_v1(CivId::Canada);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_v1_civs_are_standard() {
        for id in CivId::ALL {
            let def = civ_definition(id, 1).unwrap();
            assert_eq!(def.id, id);
            assert_eq!(def.version, 1);
            assert_eq!(def.roster, Roster::STANDARD);
            assert!(def.hooks.is_empty());
            assert_eq!(id.latest_version(), 1);
            assert_eq!(CivId::from_slug(id.slug()), Some(id));
            // A civ with no leader would need a custom defeat condition.
            assert!(!def.roster.leaders().is_empty() || def.hooks.defeat_condition.is_some());
        }
        assert!(civ_definition(CivId::Mali, 2).is_none());
        assert!(civ_definition(CivId::Mali, 0).is_none());
    }

    #[test]
    fn standard_roster() {
        let r = Roster::STANDARD;
        assert_eq!(r.single_leader(), Some(PieceKind::King));
        assert_eq!(
            r.promotion_choices().iter().collect::<Vec<_>>(),
            vec![
                PieceKind::Knight,
                PieceKind::Bishop,
                PieceKind::Rook,
                PieceKind::Queen
            ]
        );
        let two = Roster::new(
            KindSet::of(&PieceKind::ALL),
            KindSet::of(&[PieceKind::King, PieceKind::Queen]),
        )
        .unwrap();
        assert_eq!(two.single_leader(), None);
        assert!(!two.promotion_choices().contains(PieceKind::Queen));
        assert!(
            Roster::new(
                KindSet::of(&[PieceKind::Pawn]),
                KindSet::of(&[PieceKind::King])
            )
            .is_none()
        );
    }
}
