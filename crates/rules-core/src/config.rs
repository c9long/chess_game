//! Per-game configuration, fixed for the whole game.

use crate::civ::{CivDefinition, CivId, FALLBACK_CIV, civ_definition};
use crate::error::ConfigError;
use crate::geometry::Seat;
use crate::{RULES_VERSION, is_supported_rules_version};

/// Free-for-all or 2v2 Teams (South+North vs West+East).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum GameMode {
    /// Last civ standing wins; defeated armies are removed.
    #[default]
    Ffa,
    /// Partners sit opposite; a team is out when it has no ACTIVE seat.
    Teams,
}

impl GameMode {
    /// `"ffa"` or `"teams"`.
    pub const fn name(self) -> &'static str {
        match self {
            GameMode::Ffa => "ffa",
            GameMode::Teams => "teams",
        }
    }
}

/// A seat's civ choice: id plus the definition version used for this game.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CivSpec {
    /// Which civ.
    pub id: CivId,
    /// Which version of its definition.
    pub version: u32,
}

impl CivSpec {
    /// The latest version of `id`.
    pub const fn latest(id: CivId) -> CivSpec {
        CivSpec {
            id,
            version: id.latest_version(),
        }
    }
}

/// Default number of no-progress rounds before the game ends.
pub const DEFAULT_MOVE_LIMIT_ROUNDS: u16 = 25;

/// Game configuration. Build with [`GameConfig::new`] and adjust fields.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct GameConfig {
    /// FFA or Teams.
    pub mode: GameMode,
    /// Civ per seat, indexed by [`Seat::index`].
    pub civs: [CivSpec; 4],
    /// En passant per §2. Set by the rules version (on in version 2, off from
    /// version 3); tests may still turn it on.
    pub en_passant_enabled: bool,
    /// The game ends when the no-progress counter reaches
    /// `move_limit_rounds × seats still taking turns`.
    pub move_limit_rounds: u16,
    /// A supported version (see [`crate::is_supported_rules_version`]).
    pub rules_version: u32,
}

impl GameConfig {
    /// Default config for `mode` under the current rules version: every seat
    /// Canada v1, no en passant, 25-round move limit.
    pub const fn new(mode: GameMode) -> GameConfig {
        GameConfig::for_rules_version(mode, RULES_VERSION)
    }

    /// Default config for `mode` under `rules_version` (replays of older
    /// games): en passant as that version had it.
    pub const fn for_rules_version(mode: GameMode, rules_version: u32) -> GameConfig {
        GameConfig {
            mode,
            civs: [CivSpec::latest(CivId::Canada); 4],
            en_passant_enabled: en_passant_by_default(rules_version),
            move_limit_rounds: DEFAULT_MOVE_LIMIT_ROUNDS,
            rules_version,
        }
    }

    /// Returns the config with the given civs (latest versions).
    pub const fn with_civs(mut self, civs: [CivId; 4]) -> GameConfig {
        let mut i = 0;
        while i < 4 {
            self.civs[i] = CivSpec::latest(civs[i]);
            i += 1;
        }
        self
    }

    /// Checks the rules version, civ versions and move limit.
    pub fn validate(&self) -> Result<(), ConfigError> {
        if !is_supported_rules_version(self.rules_version) {
            return Err(ConfigError::UnsupportedRulesVersion(self.rules_version));
        }
        if self.move_limit_rounds == 0 {
            return Err(ConfigError::ZeroMoveLimit);
        }
        for seat in Seat::ALL {
            let spec = self.civs[seat.index()];
            if civ_definition(spec.id, spec.version).is_none() {
                return Err(ConfigError::UnknownCivVersion {
                    seat,
                    civ: spec.id,
                    version: spec.version,
                });
            }
        }
        Ok(())
    }

    /// The civ definition of `seat` (configs are validated on state creation).
    pub fn civ(&self, seat: Seat) -> &'static CivDefinition {
        let spec = self.civs[seat.index()];
        civ_definition(spec.id, spec.version).unwrap_or(&FALLBACK_CIV)
    }
}

/// The first rules version without en passant.
pub const NO_EN_PASSANT_SINCE: u32 = 3;

/// Whether en passant is on in `rules_version` (version 2 had it).
pub const fn en_passant_by_default(rules_version: u32) -> bool {
    rules_version < NO_EN_PASSANT_SINCE
}

impl Default for GameConfig {
    fn default() -> Self {
        GameConfig::new(GameMode::Ffa)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_validation() {
        let c = GameConfig::default();
        assert!(!c.en_passant_enabled);
        assert!(GameConfig::for_rules_version(GameMode::Ffa, 2).en_passant_enabled);
        assert!(
            GameConfig::for_rules_version(GameMode::Ffa, 2)
                .validate()
                .is_ok()
        );
        assert_eq!(c.move_limit_rounds, 25);
        assert_eq!(c.rules_version, RULES_VERSION);
        assert!(c.validate().is_ok());

        let mut bad = c;
        // Version 1 (the 12×12 board) is no longer playable by this engine.
        bad.rules_version = 1;
        assert_eq!(bad.validate(), Err(ConfigError::UnsupportedRulesVersion(1)));
        bad.rules_version = 4;
        assert_eq!(bad.validate(), Err(ConfigError::UnsupportedRulesVersion(4)));
        let mut bad = c;
        bad.move_limit_rounds = 0;
        assert_eq!(bad.validate(), Err(ConfigError::ZeroMoveLimit));
        let mut bad = c;
        bad.civs[2].version = 9;
        assert!(matches!(
            bad.validate(),
            Err(ConfigError::UnknownCivVersion {
                seat: Seat::North,
                ..
            })
        ));
        let c = GameConfig::new(GameMode::Teams).with_civs([
            CivId::Mali,
            CivId::Japan,
            CivId::France,
            CivId::Usa,
        ]);
        assert_eq!(c.civ(Seat::North).id, CivId::France);
    }
}
