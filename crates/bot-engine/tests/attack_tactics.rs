//! Hand-built tactical positions: leader captures for every seat orientation,
//! leader defence, FFA third-party captures, Teams partner play with frozen
//! and DEFEATED seats, mid-line promotion, en passant, the move limit (and the
//! transposition table near it), plus quiescence node counts.
//!
//! Positions are written from South's point of view and rotated onto every
//! seat (`me` = the seat to move, `next` = the seat after it, `opp` = the seat
//! opposite, `prev` = the seat before it), so one diagram checks all four
//! board orientations.

mod common;

use bot_engine::*;
use common::*;
use rules_core::*;

const LEVELS: [Level; 3] = [Level::L1800, Level::L2400, Level::Max];

/// Levels checked: all three in release builds; debug builds (the default
/// `cargo test`) are ~10x slower, so they check 1800 only. Run the full set
/// with `cargo test -p bot-engine --release --test attack_tactics`.
fn levels() -> &'static [Level] {
    if cfg!(debug_assertions) {
        &LEVELS[..1]
    } else {
        &LEVELS
    }
}

/// Deepest fixed-depth search used by the depth loops (shallower in debug).
fn max_depth() -> u32 {
    if cfg!(debug_assertions) { 3 } else { 4 }
}
const TIE_LEVELS: [Level; 4] = [Level::L1800, Level::L2100, Level::L2400, Level::Max];
const FFA_ALGOS: [FfaAlgorithm; 3] = [
    FfaAlgorithm::BrsPlus,
    FfaAlgorithm::Brs,
    FfaAlgorithm::Paranoid,
];

// ---------------------------------------------------------------------------
// Rotation helpers
// ---------------------------------------------------------------------------

/// Maps a square written in South's frame onto `seat`'s frame (the inverse
/// of the evaluation's `south_frame`).
fn rot_sq(seat: Seat, sq: Square) -> Square {
    let (f, r) = (sq.file(), sq.rank());
    let (af, ar) = match seat {
        Seat::South => (f, r),
        Seat::West => (r, 11 - f),
        Seat::North => (11 - f, 11 - r),
        Seat::East => (11 - r, f),
    };
    Square::from_coords(af, ar).unwrap()
}

/// The seat playing role `role` (0 = me, 1 = next, 2 = opposite, 3 = previous)
/// when `me` is to move.
fn role(me: Seat, role: usize) -> Seat {
    let mut s = me;
    for _ in 0..role {
        s = s.next();
    }
    s
}

/// Rotates a piece token `"<role><kind><square>"` where role is `m n o p`
/// (me, next, opposite, previous) into a real `"<seat><kind><square>"` token.
fn rot_piece(me: Seat, tok: &str) -> String {
    let mut ch = tok.chars();
    let r = match ch.next().unwrap() {
        'm' => 0,
        'n' => 1,
        'o' => 2,
        'p' => 3,
        c => panic!("bad role {c}"),
    };
    let kind = ch.next().unwrap();
    let sq: Square = ch.as_str().parse().unwrap();
    let seat = role(me, r);
    format!(
        "{}{}{}",
        seat.letter().to_ascii_lowercase(),
        kind,
        rot_sq(me, sq)
    )
}

/// Rotates a move written in South's frame.
fn rot_mv(me: Seat, m: &str) -> Move {
    let base = mv(m);
    Move {
        from: rot_sq(me, base.from),
        to: rot_sq(me, base.to),
        promotion: base.promotion,
        flag: base.flag,
    }
}

/// Statuses field from per-role statuses (me, next, opp, prev).
fn rot_statuses(me: Seat, by_role: [char; 4]) -> String {
    let mut out = ['A'; 4];
    for (r, &c) in by_role.iter().enumerate() {
        out[role(me, r).index()] = c;
    }
    out.iter().collect()
}

/// Builds a rotated position with `me` to move. `defs` are (role, reason)
/// defeat records in order.
fn rotated(
    mode: &str,
    me: Seat,
    pieces: &[&str],
    statuses: [char; 4],
    defs: &[(usize, char)],
    no_progress: u32,
) -> GameState {
    let toks: Vec<String> = pieces.iter().map(|t| rot_piece(me, t)).collect();
    let refs: Vec<&str> = toks.iter().map(String::as_str).collect();
    let def = if defs.is_empty() {
        "-".to_string()
    } else {
        defs.iter()
            .map(|&(r, c)| format!("{}{}", role(me, r).letter(), c))
            .collect::<Vec<_>>()
            .join(",")
    };
    build(
        mode,
        &refs,
        &format!(
            "{} {} - - {no_progress} 0 def={def}",
            me.letter(),
            rot_statuses(me, statuses)
        ),
    )
}

fn search_with(state: &GameState, algo: FfaAlgorithm, limits: SearchLimits) -> SearchResult {
    let cfg = SearchConfig {
        ffa_algorithm: algo,
        ..SearchConfig::default()
    };
    Engine::new(8).search(state, &limits, &cfg)
}

fn level_move(state: &GameState, level: Level, algo: FfaAlgorithm, seed: u64) -> SearchResult {
    // Untimed: node-bound levels are reproducible; Max uses its time target.
    choose_move_with(state, level, u64::MAX, 0, seed, algo)
}

fn algos_for(state: &GameState) -> &'static [FfaAlgorithm] {
    if state.mode() == GameMode::Ffa {
        &FFA_ALGOS
    } else {
        &[FfaAlgorithm::BrsPlus]
    }
}

// ---------------------------------------------------------------------------
// 1. Capture the leader in one, every orientation
// ---------------------------------------------------------------------------

/// `me` can take `next`'s king with the d7 rook (or a free queen with the g3
/// knight). Nobody threatens `me`'s king. (`opp`'s g11 pawn closes the
/// g-file: with it open, Rd7-g7 "forks" two kings, see
/// `brs_prefers_phantom_double_leader_fork_over_leader_capture`.)
const LEADER_IN_ONE_NEXT: &[&str] = &[
    "mKg1", "mPf2", "mPg2", "mPh2", "mRd7", "mNg3", "nKa7", "nPb5", "oQh5", "oKg12", "oPg11",
    "pKl7", "pPk7",
];

/// Same idea against the seat moving just before `me` (its king on l7).
const LEADER_IN_ONE_PREV: &[&str] = &[
    "mKg1", "mPf2", "mPg2", "mPh2", "mRi7", "mNg3", "nKa7", "nPb7", "oQh5", "oKg12", "oPg11",
    "pKl7", "pPk8",
];

#[test]
fn ffa_leader_capture_in_one_every_orientation() {
    for me in Seat::ALL {
        for (pieces, capture) in [(LEADER_IN_ONE_NEXT, "d7a7"), (LEADER_IN_ONE_PREV, "i7l7")] {
            let s = rotated("ffa", me, pieces, ['A'; 4], &[], 0);
            let want = rot_mv(me, capture);
            assert!(is_generated(&s, want), "{me}: {want} not legal in {s}");
            for &algo in algos_for(&s) {
                for depth in 1..=max_depth() {
                    let r = search_with(&s, algo, SearchLimits::depth(depth));
                    assert_eq!(r.best_move, Some(want), "{me} {algo:?} d{depth} in {s}");
                }
                // Node-bound levels only: Max is time-bound, and from about
                // depth 9 on (reached on an idle machine) the free queen and
                // the elimination score within ~50 cp, so its choice would
                // depend on machine speed.
                for &level in levels().iter().filter(|&&l| l != Level::Max) {
                    let r = level_move(&s, level, algo, 7);
                    assert_eq!(r.best_move, Some(want), "{me} {algo:?} {level:?} in {s}");
                }
            }
        }
    }
}

#[test]
fn teams_leader_capture_in_one_every_orientation() {
    // `next` is FROZEN, so `prev` holds the enemy team's last leader and
    // capturing it wins the game outright.
    for me in Seat::ALL {
        let s = rotated(
            "teams",
            me,
            LEADER_IN_ONE_PREV,
            ['A', 'F', 'A', 'A'],
            &[(1, 't')],
            0,
        );
        let want = rot_mv(me, "i7l7");
        for &level in levels() {
            let r = level_move(&s, level, FfaAlgorithm::BrsPlus, 3);
            assert_eq!(r.best_move, Some(want), "{me} {level:?} in {s}");
            assert_eq!(r.score, WIN - 1, "{me} {level:?}");
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Defending against a leader-capture threat
// ---------------------------------------------------------------------------

/// `prev` (moves last, just before `me`) attacks `me`'s king on g1 with a
/// bishop on k5. A free queen on h5 is the bait.
const PREV_BISHOP_THREAT: &[&str] = &[
    "mKg1", "mPf2", "mPg2", "mNg3", "mRc3", "nKa7", "nPb5", "oQh5", "oKg12", "oPf11", "pKl7",
    "pBk5", "pPk8",
];

/// Discovered threat: `next`'s knight on g5 blocks `opp`'s rook on g10 from
/// `me`'s king on g1. In real play `next` moves the knight and `opp` takes the
/// king before `me` moves again. The bait: `prev`'s queen on e4, free for the
/// d2 knight.
const DISCOVERED_THREAT: &[&str] = &[
    "mKg1", "mPf2", "mPh2", "mNd2", "mRc3", "nKa7", "nNg5", "nPb4", "oRg10", "oKj12", "oPf11",
    "pKl7", "pQe4", "pPk8",
];

#[test]
fn defends_leader_threat_from_the_last_mover() {
    for me in Seat::ALL {
        let s = rotated("ffa", me, PREV_BISHOP_THREAT, ['A'; 4], &[], 0);
        assert!(leader_under_attack(&s, me), "{me}: {s}");
        assert!(move_hangs_leader(&s, rot_mv(me, "g3h5")), "{me}: bait");
        for &algo in algos_for(&s) {
            for &level in levels() {
                let m = level_move(&s, level, algo, 1).best_move.unwrap();
                assert!(
                    !move_hangs_leader(&s, m),
                    "{me} {algo:?} {level:?}: {m} hangs the leader in {s}"
                );
            }
        }
    }
}

#[test]
fn defends_against_a_discovered_two_opponent_threat() {
    for me in Seat::ALL {
        let s = rotated("ffa", me, DISCOVERED_THREAT, ['A'; 4], &[], 0);
        assert!(!leader_under_attack(&s, me), "{me}: {s}");
        let bait = rot_mv(me, "d2e4");
        assert!(is_generated(&s, bait), "{me}: bait {bait} in {s}");
        // With the bait taken, `next` moves the knight and `opp` wins the king.
        for algo in [FfaAlgorithm::BrsPlus, FfaAlgorithm::Paranoid] {
            for &level in levels() {
                let r = level_move(&s, level, algo, 1);
                let m = r.best_move.unwrap();
                assert_ne!(
                    m, bait,
                    "{me} {algo:?} {level:?}: took the bait (score {})",
                    r.score
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 3. Not walking the leader into an attacked square
// ---------------------------------------------------------------------------

/// `next`'s rook on a1 attacks `me`'s king along rank 1; f2/g2 pawns block
/// the obvious escapes; h2 holds a bait knight of `opp` but is covered by
/// `prev`'s bishop on l6. The safe answer is to block with the b2 rook.
const KING_WALK: &[&str] = &[
    "mKg1", "mPf2", "mPg2", "mRb2", "nRa1", "nKa7", "oNh2", "oKg12", "pKl7", "pBl6",
];

#[test]
fn strong_levels_do_not_walk_the_leader_into_attack() {
    for me in Seat::ALL {
        for mode in ["ffa", "teams"] {
            let mut pieces: Vec<String> = KING_WALK.iter().map(|s| s.to_string()).collect();
            if mode == "teams" {
                // In Teams the bait must belong to an enemy: give it to `next`.
                pieces[6] = "nNh2".into();
            }
            let refs: Vec<&str> = pieces.iter().map(String::as_str).collect();
            let s = rotated(mode, me, &refs, ['A'; 4], &[], 0);
            assert!(move_hangs_leader(&s, rot_mv(me, "g1h2")), "{me} {mode}");
            for &algo in algos_for(&s) {
                for &level in levels() {
                    let m = level_move(&s, level, algo, 2).best_move.unwrap();
                    // In Teams, Rb2-a2 is a sound counter (if `next` takes the
                    // king, the now-DEFEATED seat's rook still takes `next`'s
                    // king on a7), so only check the leader itself never
                    // steps onto an attacked square, and in FFA that nothing
                    // hangs.
                    if mode == "ffa" || m.from == rot_sq(me, "g1".parse().unwrap()) {
                        assert!(
                            !move_hangs_leader(&s, m),
                            "{me} {mode} {algo:?} {level:?}: {m} in {s}"
                        );
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 4. FFA: a third player will capture an opponent's leader
// ---------------------------------------------------------------------------

/// `next` (West) can take `opp`'s king with its queen on a12 (rank 12 open
/// from a12 to the king on g12). `opp`'s rook on g10 threatens `me`'s king
/// on g1 along the open g-file, but `opp` moves after `next`, who will
/// almost certainly win `opp`'s king first. `me` can take `prev`'s queen
/// for free with the c3 rook.
const THIRD_PARTY: &[&str] = &[
    "mKg1", "mPf2", "mPh2", "mRc3", "nKa5", "nQa12", "nPb4", "oRg10", "oKg12", "oPf11", "pKl7",
    "pQc8", "pPk8",
];

#[test]
fn ffa_third_party_leader_capture_is_modelled() {
    for me in Seat::ALL {
        let s = rotated("ffa", me, THIRD_PARTY, ['A'; 4], &[], 0);
        let next = role(me, 1);
        let opp = role(me, 2);
        // Sanity: the next seat really can take opp's king.
        let mut c = s.clone();
        // Let `me` play a quiet move, then `next` captures.
        apply_move(&mut c, rot_mv(me, "h2h3")).unwrap();
        assert_eq!(c.seat_to_move(), next);
        apply_move(&mut c, rot_mv(me, "a12g12")).unwrap();
        assert_eq!(c.status(opp), SeatStatus::Removed);
        for algo in FFA_ALGOS {
            for &level in levels() {
                let r = level_move(&s, level, algo, 4);
                let m = r.best_move.unwrap();
                assert!(is_generated(&s, m));
                if algo == FfaAlgorithm::BrsPlus {
                    // BRS+ models `next` taking `opp`'s king (its default
                    // move puts leader captures first) and does not panic,
                    // but it still keeps its own king safe.
                    assert!(r.score > -MATE_BOUND, "{me} {level:?}: {}", r.score);
                    assert!(!move_hangs_leader(&s, m), "{me} {level:?}: {m}");
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 5. Teams: partner coordination, frozen double moves, DEFEATED partner passes
// ---------------------------------------------------------------------------

#[test]
fn teams_partner_finishes_when_next_is_frozen() {
    // `next` is FROZEN: order me, opp (partner), prev. `prev` holds the enemy
    // team's last leader on l7, shielded from the partner's rook on l12 by
    // `me`'s bishop on l9. Moving the bishop lets the partner win at once; a
    // queen on g7 (prev's) is the material bait for the h5 knight.
    for me in Seat::ALL {
        let s = rotated(
            "teams",
            me,
            &[
                "mKg1", "mBl9", "mNh5", "mPd2", "nKa7", "nQa5", "oKg12", "oRl12", "pKl7", "pQg7",
            ],
            ['A', 'F', 'A', 'A'],
            &[(1, 't')],
            0,
        );
        for &level in levels() {
            let r = level_move(&s, level, FfaAlgorithm::BrsPlus, 5);
            let m = r.best_move.unwrap();
            assert_eq!(
                m.from,
                rot_sq(me, "l9".parse().unwrap()),
                "{me} {level:?}: {m}"
            );
            assert_eq!(r.score, WIN - 2, "{me} {level:?}");
        }
    }
}

#[test]
fn teams_defeated_partner_passes_and_enemy_moves_twice() {
    // `opp` (partner) is DEFEATED and has no legal move (a lone pawn blocked
    // by an enemy pawn), so it passes automatically: after `me` come `next`,
    // (opp passes), `prev`. `next` and `prev` both move before `me` again.
    // `prev`'s rook on l1 is blocked from `me`'s king (g1) by `next`'s knight
    // on i1: `next` moves the knight, then `prev` wins. `me` must react now
    // (block on j1 with the j5 rook); `prev`'s queen on j9 is the bait.
    for me in Seat::ALL {
        let s = rotated(
            "teams",
            me,
            &[
                "mKg1", "mPf2", "mPg2", "mPh2", "mRj5", "nKa7", "nNi1", "nPf6", "oPf7", "pKl7",
                "pRl1", "pQj9",
            ],
            ['A', 'A', 'D', 'A'],
            &[(2, 'l')],
            0,
        );
        // Check the pass really happens.
        let mut c = s.clone();
        apply_move(&mut c, rot_mv(me, "f2f3")).unwrap();
        apply_move(&mut c, rot_mv(me, "i1j3")).unwrap();
        assert_eq!(
            c.seat_to_move(),
            role(me, 3),
            "{me}: opp should pass in {s}"
        );
        for &level in levels() {
            let r = level_move(&s, level, FfaAlgorithm::BrsPlus, 5);
            let m = r.best_move.unwrap();
            let mut c = s.clone();
            apply_move(&mut c, m).unwrap();
            // Whatever `next` does, `prev` must not be able to take the king
            // right after (check by brute force over next's replies).
            let mut lost = false;
            let king = c
                .board()
                .iter()
                .position(|p| *p == Some(Piece::new(PieceKind::King, me)))
                .and_then(|i| Square::new(i as u8))
                .unwrap();
            for nm in legal_moves(&c) {
                let mut d = c.clone();
                apply_move(&mut d, nm).unwrap();
                if d.is_over() {
                    continue;
                }
                if d.seat_to_move() == role(me, 3) && is_square_attacked_by(&d, king, role(me, 3)) {
                    lost = true;
                    break;
                }
            }
            assert!(
                !lost,
                "{me} {level:?}: {m} (score {}) loses in {s}",
                r.score
            );
            // `next`'s knight then forks from h3 and the team is lost by
            // force; the block on j1 is the longest defence.
            assert_eq!(m, rot_mv(me, "j5j1"), "{me} {level:?}");
        }
    }
}

#[test]
fn teams_defeated_root_protects_active_partner() {
    // `me` is DEFEATED but still moves; its partner `opp` holds the team's
    // only leader. `next`'s rook threatens the partner's king on g12 along
    // rank 12, and `next` moves before `opp`. `me` must capture or block.
    for me in Seat::ALL {
        let s = rotated(
            "teams",
            me,
            &[
                "mPd2", "mRe3", "mBd9", "nKa5", "nRa12", "oKg12", "oPf11", "oPg11", "oPh11",
                "pKl7", "pQc6",
            ],
            ['D', 'A', 'A', 'A'],
            &[(0, 'l')],
            0,
        );
        for &level in levels() {
            let r = level_move(&s, level, FfaAlgorithm::BrsPlus, 5);
            let m = r.best_move.unwrap();
            let mut c = s.clone();
            apply_move(&mut c, m).unwrap();
            assert!(
                !leader_under_attack(&c, role(me, 2)),
                "{me} {level:?}: {m} leaves the partner's king hanging (score {})",
                r.score
            );
        }
    }
}

// ---------------------------------------------------------------------------
// 6. Promotion on the mid-line
// ---------------------------------------------------------------------------

#[test]
fn promotes_on_the_mid_line_every_orientation() {
    for me in Seat::ALL {
        let s = rotated(
            "ffa",
            me,
            &[
                "mKg1", "mPf2", "mPg2", "mPh2", "mPc6", "nKa9", "nPb9", "oKg12", "oPf11", "pKl9",
                "pPk9",
            ],
            ['A'; 4],
            &[],
            0,
        );
        let want = rot_mv(me, "c6c7q");
        assert!(is_generated(&s, want), "{me}: {want} in {s}");
        for &algo in algos_for(&s) {
            for &level in levels() {
                let m = level_move(&s, level, algo, 6).best_move.unwrap();
                assert_eq!(m, want, "{me} {algo:?} {level:?}");
            }
        }
    }
}

#[test]
fn promotion_capture_of_a_leader_every_orientation() {
    // The c6 pawn captures `next`'s king on d7 while promoting. (With the
    // pawn still on h2 instead of h3, `opp`'s queen wins `me`'s king on the
    // back rank after Qa1 and every strong search correctly prefers taking
    // that queen with the e4 knight instead.)
    for me in Seat::ALL {
        let s = rotated(
            "ffa",
            me,
            &[
                "mKg1", "mPf2", "mPg2", "mPh3", "mPc6", "mNe4", "nKd7", "oKg12", "oQf6", "pKl9",
                "pPk9",
            ],
            ['A'; 4],
            &[],
            0,
        );
        for &algo in algos_for(&s) {
            for &level in levels() {
                let m = level_move(&s, level, algo, 6).best_move.unwrap();
                assert_eq!(
                    m.to,
                    rot_sq(me, "d7".parse().unwrap()),
                    "{me} {algo:?} {level:?}: {m}"
                );
                assert!(m.promotion.is_some());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 7. En passant
// ---------------------------------------------------------------------------

#[test]
fn en_passant_saves_the_leader() {
    // `next`'s pawn just double-stepped b5-d5 (target c5) and attacks `me`'s
    // king on e6 (West pawns capture east-diagonally). `me`'s king is boxed
    // in by its own pieces; the d4 pawn takes en passant (d4xc5), or the
    // king takes d5 itself only if undefended (it is defended by c4).
    // Only valid in South's frame (West is `next`); build it unrotated.
    let s = build(
        "ffa",
        &[
            "sKe6", "sPd4", "sNd6", "sBd7", "sNe7", "sBf7", "sRf6", "sNf5", "sRe5", "wPd5", "wPc4",
            "wKa7", "nKg12", "eKl7",
        ],
        "S AAAA - Wc5 0 0",
    );
    let ep = legal_moves(&s)
        .into_iter()
        .find(|m| m.flag == MoveFlag::EnPassant)
        .expect("en passant is legal");
    assert!(!move_hangs_leader(&s, ep));
    for &algo in algos_for(&s) {
        for &level in levels() {
            let r = level_move(&s, level, algo, 8);
            let m = r.best_move.unwrap();
            assert!(
                !move_hangs_leader(&s, m),
                "{algo:?} {level:?}: {m} (ep was {ep}) score {}",
                r.score
            );
        }
    }
}

// ---------------------------------------------------------------------------
// 8. Move limit and the transposition table
// ---------------------------------------------------------------------------

/// A K+Q+R vs three bare kings ending: lots of transpositions.
fn sparse_ffa(no_progress: u32) -> GameState {
    build(
        "ffa",
        &["sKg1", "sQf4", "sRc3", "wKa7", "nKg12", "eKl7"],
        &format!("S AAAA - - {no_progress} 0"),
    )
}

#[test]
fn reused_engine_near_the_move_limit_matches_fresh_engine() {
    // Fill the TT far from the limit, then search the same pieces near it.
    for algo in FFA_ALGOS {
        for np in [55u32, 59, 60, 61, 70, 90, 97, 99] {
            let mut warm = Engine::new(16);
            let cfg = SearchConfig {
                ffa_algorithm: algo,
                ..SearchConfig::default()
            };
            let lim = SearchLimits::depth(max_depth() + 1);
            let _ = warm.search(&sparse_ffa(0), &lim, &cfg);
            let a = warm.search(&sparse_ffa(np), &lim, &cfg);
            let b = Engine::new(16).search(&sparse_ffa(np), &lim, &cfg);
            assert_eq!(a.score, b.score, "{algo:?} np {np}: warm vs fresh engine");
            if np >= 97 {
                // No capture or pawn move can stop the four-way tie.
                assert_eq!(a.score, 0, "{algo:?} np {np}");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 9. Quiescence node counts on tactical positions
// ---------------------------------------------------------------------------

#[test]
fn quiescence_stays_bounded_in_a_melee() {
    // A melee: every army has pieces hanging to every other army.
    let melee = build(
        "ffa",
        &[
            "sKg1", "sQf5", "sRe4", "sRh4", "sBd5", "sNg5", "sPe3", "sPf4", "sPg3", "wKa7", "wQf7",
            "wRd6", "wRe8", "wBc5", "wNh6", "wPc4", "wPd7", "nKg12", "nQg6", "nRf8", "nRh8",
            "nBe7", "nNe6", "nPg8", "nPh7", "eKl7", "eQi6", "eRi4", "eRi8", "eBj5", "eNh5", "ePj7",
            "ePi5",
        ],
        "S AAAA - - 0 0",
    );
    let teams = {
        let mut t = melee.to_string();
        t.replace_range(0..3, "teams");
        parse_position(&t).unwrap()
    };
    for s in [&melee, &teams] {
        for &algo in algos_for(s) {
            for depth in 1..=max_depth() {
                let r = search_with(s, algo, SearchLimits::depth(depth));
                // Measured 2026-10-15: at most ~73k nodes (BRS+ FFA depth 4)
                // and 5.6k for Teams depth 1 (~40 root moves).
                let cap = [0u64, 20_000, 60_000, 150_000, 400_000][depth as usize];
                assert!(
                    r.nodes <= cap,
                    "{} {algo:?} depth {depth}: {} nodes",
                    s.mode().name(),
                    r.nodes
                );
                assert!(is_generated(s, r.best_move.unwrap()));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 10. Regressions for defects found in review on 2026-10-15 (all fixed)
// ---------------------------------------------------------------------------

/// `me`'s queen on j4 can go to g7, attacking `next`'s king on a7 (rank 7)
/// and `opp`'s king on g12 (g-file) at once. Both kings simply step away in
/// real play (`next` moves right after `me`). Meanwhile the g3 knight can
/// take `prev`'s rook on h5 for free.
const PHANTOM_FORK: &[&str] = &[
    "mKg1", "mPf2", "mPg2", "mPh2", "mQj4", "mNg3", "nKa7", "nPb5", "nPb4", "oKg12", "oPf11",
    "oPh11", "pKl7", "pPk7", "pRh5", "pPk8",
];

#[test]
fn brs_takes_the_free_rook_instead_of_a_phantom_fork() {
    let mut wrong = Vec::new();
    for me in Seat::ALL {
        let s = rotated("ffa", me, PHANTOM_FORK, ['A'; 4], &[], 0);
        let want = rot_mv(me, "g3h5");
        // Plain BRS is excluded: its non-best opponents pass, so it sees the
        // hanging rook as free forever and rates "take it later" equal to
        // "take it now" (it no longer falls for the phantom fork itself).
        for algo in [FfaAlgorithm::BrsPlus, FfaAlgorithm::Paranoid] {
            for &level in levels() {
                let r = level_move(&s, level, algo, 0);
                // Was (South): BRS+ 1800 Qg7, 2100 Ql2, 2400/Max Qd4, all
                // scoring ~2400 against Paranoid's ~1550 for Nxh5.
                if r.best_move != Some(want) {
                    wrong.push(format!(
                        "{me} {algo:?} {level:?}: {} ({})",
                        r.best_move.unwrap(),
                        r.score
                    ));
                }
            }
        }
    }
    assert!(wrong.is_empty(), "declined the free rook: {wrong:#?}");
}

#[test]
fn brs_prefers_phantom_double_leader_fork_over_leader_capture() {
    // Rd7xa7 takes `next`'s king now. Rd7-g7 attacks `next`'s and `opp`'s
    // kings; at depth 2 BRS+ and BRS let one king escape (the pooled best
    // reply) while the other seat plays its default move and loses its king.
    let s = build(
        "ffa",
        &[
            "sKg1", "sPf2", "sPg2", "sPh2", "sRd7", "sNg3", "wKa7", "wPb5", "nQh5", "nKg12",
            "nPf11", "eKl7", "ePk7",
        ],
        "S AAAA - - 0 0",
    );
    for algo in [FfaAlgorithm::BrsPlus, FfaAlgorithm::Brs] {
        let r = search_with(&s, algo, SearchLimits::depth(2));
        assert_eq!(best_str(&r), "d7a7", "{algo:?} score {}", r.score);
    }
}

fn best_str(r: &SearchResult) -> String {
    r.best_move.map(|m| m.to_string()).unwrap_or_default()
}

#[test]
fn interrupted_first_iteration_reports_real_scores() {
    let s = build(
        "ffa",
        &[
            "sKg1", "sQf5", "sRe4", "sRh4", "sBd5", "sNg5", "sPe3", "sPf4", "sPg3", "wKa7", "wQf7",
            "wRd6", "wRe8", "wBc5", "wNh6", "wPc4", "wPd7", "nKg12", "nQg6", "nRf8", "nRh8",
            "nBe7", "nNe6", "nPg8", "nPh7", "eKl7", "eQi6", "eRi4", "eRi8", "eBj5", "eNh5", "ePj7",
            "ePi5",
        ],
        "S AAAA - - 0 0",
    );
    for seed in 0..64 {
        // A deadline that has already passed (e.g. bot-service cutting the
        // budget under load): the clock is checked every 256 nodes, so depth
        // 1 is interrupted part-way.
        let lim = SearchLimits {
            max_depth: 10,
            max_nodes: u64::MAX,
            deadline: Some(std::time::Instant::now()),
        };
        let r = choose_move_in(
            &mut Engine::new(1),
            &s,
            Level::L1800,
            &lim,
            seed,
            FfaAlgorithm::BrsPlus,
        );
        for rm in &r.root_moves {
            assert!(
                rm.score.abs() <= WIN,
                "seed {seed}: {} scored {}",
                rm.mv,
                rm.score
            );
        }
        // Was: score 30_015_875 for an unsearched queen capture.
        assert!(
            r.score.abs() <= WIN,
            "seed {seed}: reported score {}",
            r.score
        );
    }
}

#[test]
fn lost_ffa_endgame_accepts_the_move_limit_tie() {
    // Two survivors, one turn before the limit (49 of 50). South (K+P)
    // against West (K+Q+R) is hopeless; any king move ends the game in a
    // shared first place. A pawn move refuses the tie.
    let s = build(
        "ffa",
        &["sKg1", "sPe2", "wKa7", "wQd8", "wRc9"],
        "S AARR - - 49 300 def=Nl,El",
    );
    for level in TIE_LEVELS {
        let r = level_move(&s, level, FfaAlgorithm::BrsPlus, 0);
        // Was: 1800 and 2100 played e2e3 (score ~+750 against the tie's
        // 600: the evaluation counts +1200 per removed opponent, the tie
        // value does not).
        assert_eq!(
            r.best_move.unwrap().from,
            "g1".parse().unwrap(),
            "{level:?}: {:?} score {}",
            r.best_move.map(|m| m.to_string()),
            r.score
        );
    }
}

#[test]
fn plain_brs_sees_a_discovered_two_opponent_threat() {
    let s = rotated("ffa", Seat::South, DISCOVERED_THREAT, ['A'; 4], &[], 0);
    for &level in levels() {
        let m = level_move(&s, level, FfaAlgorithm::Brs, 1)
            .best_move
            .unwrap();
        // Safe: block or leave the g-file (e.g. Rc3-g3, Kg1-f1/g2).
        let mut c = s.clone();
        apply_move(&mut c, m).unwrap();
        let knight_moves: Vec<Move> = legal_moves(&c)
            .into_iter()
            .filter(|nm| nm.from == "g5".parse().unwrap())
            .collect();
        let mut lost = false;
        for nm in knight_moves {
            let mut d = c.clone();
            apply_move(&mut d, nm).unwrap();
            if d.seat_to_move() == Seat::North
                && is_square_attacked_by(&d, king_of(&d), Seat::North)
            {
                lost = true;
            }
        }
        // Was: 1800 Rc3-c7, 2100 Rc3-l3, 2400 Rc3-c12, Max Nd2xe4.
        assert!(!lost, "{level:?}: {m}");
    }
}

fn king_of(s: &GameState) -> Square {
    s.board()
        .iter()
        .position(|p| *p == Some(Piece::new(PieceKind::King, Seat::South)))
        .and_then(|i| Square::new(i as u8))
        .unwrap()
}

#[test]
fn depth_one_respects_a_node_cap() {
    // Replayed arena position (2100 vs 2400, ply 72) where the uncapped
    // exact-score depth-1 iteration of FFA 2100 used ~3.2M nodes against a
    // 40k budget.
    let s = parse_position(
        "ffa nQ5nKnBnNnR2/3wR2nPnP3eQ/1wN2nN3nP2eR/1wP2nPnP4ePeN/wBwP4nB3ePeB/wK1nR1wP5eP1/1wQ3wPsP4eK/wB1wN1wP3eP1sNeB/3wP2sN4eN/wR2sPsB3sP3/2sPsPsQ1sPsPsP3/5sRsKsB2sR1 S AAAA Wa3 - 0 72 ep=on ml=25 civ=canada.1,canada.1,canada.1,canada.1 def=- rv=1",
    )
    .unwrap();
    for level in [Level::L1200, Level::L1500, Level::L1800, Level::L2100] {
        let budget = level.params().max_nodes;
        let r = level_move(&s, level, FfaAlgorithm::BrsPlus, 0);
        assert!(
            r.nodes <= budget * DEPTH1_NODE_FACTOR + 64,
            "{level:?}: {} nodes against a budget of {budget}",
            r.nodes
        );
        assert!(is_generated(&s, r.best_move.unwrap()));
        for rm in &r.root_moves {
            assert!(rm.score.abs() <= WIN, "{level:?}: {} {}", rm.mv, rm.score);
        }
    }
}

#[test]
fn starved_search_never_hangs_the_leader_statically() {
    // `prev`'s bishop attacks the king; with no time at all (no root move
    // searched) the fallback must still not leave the leader hanging.
    for me in Seat::ALL {
        let s = rotated("ffa", me, PREV_BISHOP_THREAT, ['A'; 4], &[], 0);
        let lim = SearchLimits {
            max_depth: 10,
            max_nodes: 1,
            deadline: None,
        };
        let r = Engine::new(1).search(&s, &lim, &SearchConfig::default());
        let m = r.best_move.unwrap();
        assert!(!move_hangs_leader(&s, m), "{me}: {m} (depth {})", r.depth);
    }
}
