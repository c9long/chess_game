//! Game schedules: which player sits where, with seat rotation.
//!
//! Every schedule is built from **opening groups**: all games of a group
//! start from the same random opening and differ only in seat assignment,
//! so each player sits in each relevant seat equally often. That cancels the
//! seat bias (e.g. East's exposed corners) and most opening luck.

use rules_core::GameMode;

use crate::game::GameSpec;

/// Seat patterns for a two-player match (`true` = player A), S, W, N, E.
///
/// * FFA: all six ways to give A two seats (opposite and adjacent, each
///   way round), so A and B each sit in every seat equally often and face
///   each neighbour order equally often.
/// * Teams: A is one team, B the other, both ways round.
pub fn two_player_patterns(mode: GameMode) -> &'static [[bool; 4]] {
    const FFA: [[bool; 4]; 6] = [
        [true, false, true, false],
        [false, true, false, true],
        [true, true, false, false],
        [false, false, true, true],
        [true, false, false, true],
        [false, true, true, false],
    ];
    const TEAMS: [[bool; 4]; 2] = [[true, false, true, false], [false, true, false, true]];
    match mode {
        GameMode::Ffa => &FFA,
        GameMode::Teams => &TEAMS,
    }
}

/// Builds schedules with globally unique game indices and group numbers.
#[derive(Default, Debug)]
pub struct Scheduler {
    /// The games so far.
    pub games: Vec<GameSpec>,
    next_group: usize,
}

impl Scheduler {
    /// An empty schedule.
    pub fn new() -> Scheduler {
        Scheduler::default()
    }

    fn push_group(&mut self, seatings: &[[usize; 4]]) {
        let group = self.next_group;
        self.next_group += 1;
        for &seats in seatings {
            let index = self.games.len();
            self.games.push(GameSpec {
                index,
                group,
                seats,
            });
        }
    }

    /// A two-player match of at least `games` games (whole groups), A and B
    /// being player indices.
    pub fn add_match(&mut self, mode: GameMode, a: usize, b: usize, games: usize) {
        let pats = two_player_patterns(mode);
        let seatings: Vec<[usize; 4]> = pats
            .iter()
            .map(|p| p.map(|is_a| if is_a { a } else { b }))
            .collect();
        for _ in 0..games.div_ceil(pats.len()).max(1) {
            self.push_group(&seatings);
        }
    }

    /// A fixed four-seat lineup (player per seat S, W, N, E), rotated through
    /// the four cyclic seat rotations (partners stay partners in Teams). At
    /// least `games` games (whole groups).
    pub fn add_lineup(&mut self, lineup: [usize; 4], games: usize) {
        let mut seatings: Vec<[usize; 4]> = (0..4)
            .map(|r| std::array::from_fn(|s| lineup[(s + 4 - r) % 4]))
            .collect();
        seatings.dedup();
        if seatings.iter().all(|s| *s == seatings[0]) {
            seatings.truncate(1);
        }
        for _ in 0..games.div_ceil(seatings.len()).max(1) {
            self.push_group(&seatings);
        }
    }
}

/// Which pairs a ladder plays.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum Pairs {
    /// Each player against the next one.
    Adjacent,
    /// Each player against the next two (adds cross-checks for the ladder).
    Near,
    /// Every pair.
    All,
}

/// The `(i, j)` pairs of a ladder over `n` players.
pub fn ladder_pairs(n: usize, pairs: Pairs) -> Vec<(usize, usize)> {
    let reach = match pairs {
        Pairs::Adjacent => 1,
        Pairs::Near => 2,
        Pairs::All => n,
    };
    let mut out = Vec::new();
    for d in 1..=reach {
        for i in 0..n.saturating_sub(d) {
            out.push((i, i + d));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffa_patterns_are_balanced() {
        let pats = two_player_patterns(GameMode::Ffa);
        for seat in 0..4 {
            assert_eq!(pats.iter().filter(|p| p[seat]).count(), 3);
        }
        for p in pats {
            assert_eq!(p.iter().filter(|&&x| x).count(), 2);
        }
    }

    #[test]
    fn lineup_rotates() {
        let mut s = Scheduler::new();
        s.add_lineup([0, 1, 2, 3], 8);
        assert_eq!(s.games.len(), 8);
        assert_eq!(s.games[1].seats, [3, 0, 1, 2]);
        for p in 0..4 {
            for seat in 0..4 {
                assert_eq!(s.games.iter().filter(|g| g.seats[seat] == p).count(), 2);
            }
        }
        assert_eq!(s.games[4].group, 1);
        let mut s = Scheduler::new();
        s.add_lineup([5, 5, 5, 5], 3);
        assert_eq!(s.games.len(), 3);
    }

    #[test]
    fn match_rounds_up_to_groups() {
        let mut s = Scheduler::new();
        s.add_match(GameMode::Ffa, 0, 1, 7);
        assert_eq!(s.games.len(), 12);
        s.add_match(GameMode::Teams, 2, 3, 3);
        assert_eq!(s.games.len(), 16);
        assert_eq!(s.games[15].group, 3);
        assert_eq!(s.games[15].index, 15);
    }

    #[test]
    fn pairs() {
        assert_eq!(ladder_pairs(3, Pairs::Adjacent), vec![(0, 1), (1, 2)]);
        assert_eq!(ladder_pairs(4, Pairs::Near).len(), 5);
        assert_eq!(ladder_pairs(4, Pairs::All).len(), 6);
    }
}
