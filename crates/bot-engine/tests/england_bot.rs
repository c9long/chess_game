//! The bots with England's Prime Ministers (civ version 2): four leader
//! pieces, only the last of which is decisive.

mod common;

use bot_engine::*;
use common::*;
use rules_core::*;

const ENGLAND_SOUTH: &str = "civ=england.2,canada.1,canada.1,canada.1";

fn search(state: &GameState, algo: FfaAlgorithm, depth: u32) -> SearchResult {
    let cfg = SearchConfig {
        ffa_algorithm: algo,
        ..SearchConfig::default()
    };
    Engine::new(4).search(state, &SearchLimits::depth(depth), &cfg)
}

const FFA_ALGOS: [FfaAlgorithm; 3] = [
    FfaAlgorithm::BrsPlus,
    FfaAlgorithm::Brs,
    FfaAlgorithm::Paranoid,
];

#[test]
fn capturing_the_last_prime_minister_wins() {
    // Only South (England, one PM left) and West remain; West to move.
    let text = format!(
        "ffa {} W AARR - - 0 0 def=Nl,El {ENGLAND_SOUTH}",
        board_field(&["sMg1", "sPe4", "wKa7", "wRa1", "wPc5"])
    );
    let s = parse_position(&text).unwrap();
    for algo in FFA_ALGOS {
        let r = search(&s, algo, 3);
        assert_eq!(r.best_move.unwrap().to_string(), "a1g1", "{algo:?}");
        assert!(r.score >= MATE_BOUND, "{algo:?} score {}", r.score);
    }
}

#[test]
fn capturing_one_of_several_prime_ministers_is_not_a_win_but_is_good() {
    // South has two PMs; West's rook can take g1 (a PM) or a bishop on a4.
    let text = format!(
        "ffa {} W AARR - - 0 0 def=Nl,El {ENGLAND_SOUTH}",
        board_field(&["sMg1", "sMp16", "sBa4", "sPe4", "wKa7", "wRa1", "wPc5"])
    );
    let s = parse_position(&text).unwrap();
    for algo in FFA_ALGOS {
        let r = search(&s, algo, 2);
        let m = r.best_move.unwrap().to_string();
        assert!(r.score < MATE_BOUND, "{algo:?}: {m} scored as a win");
        // Taking the PM (a leader worth more than a bishop) is preferred.
        assert_eq!(m, "a1g1", "{algo:?}");
    }
}

#[test]
fn england_bot_keeps_its_last_prime_minister_safe() {
    // South (England) has one PM left on g1; grabbing the knight on h2 would
    // put it on West's rook file (h12), and West moves next.
    for mode in ["ffa", "teams"] {
        let bait = if mode == "ffa" { "nNh2" } else { "eNh2" };
        let s = build(
            mode,
            &[
                "sMg1", "sRb1", "sPd2", "sPe2", "sPf2", "sPg2", bait, "wRh12", "wKa7", "nKe11",
                "eKl7",
            ],
            &format!("S AAAA - - 0 0 {ENGLAND_SOUTH}"),
        );
        assert!(move_hangs_leader(&s, mv("g1h2")));
        for level in [Level::L1500, Level::L2100, Level::Max] {
            for seed in 0..2 {
                let m = choose_move(&s, level, 60_000, 0, seed).best_move.unwrap();
                assert!(is_generated(&s, m));
                assert!(
                    !move_hangs_leader(&s, m),
                    "{mode} {level:?} seed {seed}: {m}"
                );
            }
        }
    }
}

#[test]
fn evaluation_values_prime_ministers_and_their_loss() {
    let ev = Evaluator::new(EvalWeights::default());
    let w = EvalWeights::default();
    // Four, then three Prime Ministers (one removed from a quiet square).
    let base = ["sMf1", "sMh1", "sMi1", "wKa9", "nKi16", "eKp9"];
    let mut four: Vec<&str> = base.to_vec();
    four.push("sMk1");
    let rest = format!("S AAAA - - 0 0 {ENGLAND_SOUTH}");
    let a = build("ffa", &four, &rest);
    let b = build("ffa", &base, &rest);
    let diff = ev.evaluate(&a, Seat::South) - ev.evaluate(&b, Seat::South);
    let pm = w.piece_value[PieceKind::PrimeMinister.index()];
    // Losing one costs about its value plus the leader reserve.
    assert!(diff >= pm, "diff {diff}");
    assert!(diff <= pm + w.leader_reserve + 120, "diff {diff}");
}

#[test]
fn england_start_evaluation_is_ahead_but_bounded() {
    // Four Prime Ministers (4 × 450, plus 3 × 150 leader reserve) against a queen and two
    // knights (1,600; a single king has no material): the bot rates England's army ahead by
    // a few pawns, which arena games bear out (England wins well over its fair share; see
    // docs/bots-calibration.md), but not by a decisive margin.
    let ev = Evaluator::new(EvalWeights::default());
    let s = GameState::new(GameConfig::new(GameMode::Ffa).with_civs([
        CivId::England,
        CivId::Canada,
        CivId::Canada,
        CivId::Canada,
    ]))
    .unwrap();
    let e = ev.evaluate(&s, Seat::South);
    assert!((0..900).contains(&e), "England start eval {e}");
    // From a standard seat's view England is the stronger opponent.
    assert!(ev.evaluate(&s, Seat::West) < 0);
}

#[test]
fn never_returns_an_illegal_move_with_england() {
    for civs in [
        [CivId::England, CivId::Canada, CivId::Canada, CivId::Canada],
        [CivId::Canada, CivId::England, CivId::Mali, CivId::England],
        [CivId::England; 4],
    ] {
        for (i, s) in random_positions_with(0xE9, 6, 160, civs).iter().enumerate() {
            let algos: &[FfaAlgorithm] = if s.mode() == GameMode::Ffa {
                &FFA_ALGOS
            } else {
                &[FfaAlgorithm::BrsPlus]
            };
            for &algo in algos {
                let cfg = SearchConfig {
                    ffa_algorithm: algo,
                    ..SearchConfig::default()
                };
                let r = Engine::new(2).search(s, &SearchLimits::nodes(600), &cfg);
                let m = r.best_move.unwrap();
                assert!(is_generated(s, m), "pos {i} {algo:?}: illegal {m} in {s}");
                let mut c = s.clone();
                for pm in &r.pv {
                    if c.is_over() {
                        break;
                    }
                    assert!(apply_move(&mut c, *pm).is_ok(), "pv {:?} in {s}", r.pv);
                }
            }
            let level = Level::ALL[i % 4];
            let r = choose_move(s, level, u64::MAX, 0, i as u64);
            assert!(is_generated(s, r.best_move.unwrap()), "{level:?} in {s}");
        }
    }
}

#[test]
fn bots_play_full_games_with_england_legally() {
    // A few complete quick games: every move the bots choose is legal and
    // England is eliminated only when it has no Prime Minister left.
    for (g, civs) in [
        [CivId::England, CivId::Canada, CivId::Japan, CivId::Mali],
        [CivId::Usa, CivId::England, CivId::England, CivId::France],
    ]
    .into_iter()
    .enumerate()
    {
        for mode in [GameMode::Ffa, GameMode::Teams] {
            let mut s = GameState::new(GameConfig::new(mode).with_civs(civs)).unwrap();
            for ply in 0..240 {
                if s.is_over() {
                    break;
                }
                let r = choose_move(&s, Level::L600, u64::MAX, 0, (g * 1000 + ply) as u64);
                let m = r.best_move.unwrap();
                let ev = apply_move(&mut s, m).unwrap();
                for e in ev {
                    if let GameEvent::Defeat {
                        seat,
                        reason: DefeatReason::LeaderCaptured,
                    } = e
                    {
                        assert_eq!(s.piece_count(seat, PieceKind::PrimeMinister), 0);
                        assert_eq!(s.leader_count(seat), 0);
                    }
                }
            }
        }
    }
}
