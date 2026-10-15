//! Seeded, deterministic randomized self-play with injected timeouts and
//! abandons, checking invariants after every action, plus a cross-check of
//! move generation against a naive, independently written reference
//! generator.
//!
//! Game count defaults keep debug-mode runtime short; scale up with
//! `FUZZ_GAMES=100000 cargo test --release --test fuzz`.

mod common;

use std::collections::HashMap;

use common::check_invariants;
use rules_core::*;

/// xorshift64* — tiny deterministic PRNG (no external dependency).
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn chance(&mut self, per_mille: u64) -> bool {
        self.next() % 1000 < per_mille
    }
}

fn games(default: usize) -> usize {
    std::env::var("FUZZ_GAMES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn random_config(rng: &mut Rng, game: usize) -> GameConfig {
    let mode = if game.is_multiple_of(2) {
        GameMode::Ffa
    } else {
        GameMode::Teams
    };
    let mut civs = [CivId::Canada; 4];
    for c in &mut civs {
        *c = CivId::ALL[rng.below(CivId::ALL.len())];
    }
    let mut cfg = GameConfig::new(mode).with_civs(civs);
    cfg.en_passant_enabled = !rng.chance(150);
    // Short move limits exercise move-limit endings and pass loops.
    if rng.chance(300) {
        cfg.move_limit_rounds = 1 + rng.below(6) as u16;
    }
    cfg
}

#[derive(Default, Debug)]
struct Stats {
    games: usize,
    plies: usize,
    passes: usize,
    stalemates: usize,
    timeouts: usize,
    abandons: usize,
    ep: usize,
    castles: usize,
    promotions: usize,
    endings: HashMap<&'static str, usize>,
}

fn result_name(o: &Outcome) -> &'static str {
    match o.result {
        GameResult::FfaWinner { .. } => "ffa_winner",
        GameResult::FfaMoveLimitTie { .. } => "ffa_tie",
        GameResult::TeamsWinner { .. } => "teams_winner",
        GameResult::TeamsDraw => "teams_draw",
    }
}

/// Plays one random game, checking invariants after every action.
fn play_game(seed: u64, game: usize, stats: &mut Stats, full_checks: bool) -> GameState {
    let mut rng = Rng::new(seed);
    let cfg = random_config(&mut rng, game);
    let mut s = if game % 10 == 9 {
        // Some games start from near-stalemate fixtures so stalemate
        // defeats (and the passes that follow in Teams) are exercised.
        let f = fixtures();
        f[rng.below(f.len())].clone()
    } else {
        GameState::new(cfg).unwrap()
    };
    let mut moves = Vec::new();
    let mut events = Vec::new();
    const MAX_ACTIONS: usize = 40_000;
    for _ in 0..MAX_ACTIONS {
        if s.is_over() {
            break;
        }
        let before = s.clone();
        let mover = s.seat_to_move();
        assert!(s.takes_turns(mover));
        events.clear();

        if rng.chance(20) {
            // Timeouts are only accepted for the seat to move.
            let mut c = s.clone();
            let other = mover.next();
            assert!(matches!(
                apply_timeout(&mut c, other),
                Err(RulesError::NotSeatToMove { .. })
            ));
            assert_eq!(c, s);
        }

        let roll = rng.below(1000);
        if roll < 4 {
            // Timeout of the seat to move.
            events = apply_timeout(&mut s, mover).unwrap();
            stats.timeouts += 1;
        } else if roll < 7 {
            let seat = Seat::ALL[rng.below(4)];
            match apply_abandon(&mut s, seat) {
                Ok(ev) => {
                    events = ev;
                    stats.abandons += 1;
                }
                Err(e) => {
                    assert_eq!(e, RulesError::SeatNotInPlay(seat));
                    assert!(!before.takes_turns(seat));
                    assert_eq!(s, before);
                    continue;
                }
            }
        } else if roll < 12 {
            // Garbage move: accepted iff legal, otherwise no change.
            let from = Square::new(rng.below(144) as u8).unwrap();
            let to = Square::new(rng.below(144) as u8).unwrap();
            let promo = [None, Some(PieceKind::Queen), Some(PieceKind::King)][rng.below(3)];
            let m = Move {
                from,
                to,
                promotion: promo,
                flag: MoveFlag::Normal,
            };
            let legal = legal_moves(&s).iter().any(|l| l.same_choice(&m));
            match apply_move(&mut s, m) {
                Ok(ev) => {
                    assert!(legal);
                    events = ev;
                }
                Err(e) => {
                    assert!(!legal);
                    assert_eq!(e, RulesError::IllegalMove(m));
                    assert_eq!(s, before);
                    continue;
                }
            }
        } else {
            generate_legal_moves(&s, &mut moves);
            assert!(!moves.is_empty());
            let m = moves[rng.below(moves.len())];
            if rng.chance(500) {
                events = apply_move(&mut s, m).unwrap();
            } else {
                apply_generated_move(&mut s, m, &mut events);
            }
            match events.first() {
                Some(GameEvent::MoveMade { seat, mv, .. }) => {
                    assert_eq!(*seat, mover);
                    assert_eq!(*mv, m);
                }
                other => panic!("first event should be MoveMade, got {other:?}"),
            }
            stats.plies += 1;
        }

        // Event-level invariants.
        for e in &events {
            match e {
                GameEvent::MoveMade { seat, mv, .. } => {
                    // FROZEN / REMOVED seats never move.
                    assert!(before.takes_turns(*seat));
                    match mv.flag {
                        MoveFlag::EnPassant => stats.ep += 1,
                        MoveFlag::Castle => {
                            stats.castles += 1;
                            assert_eq!(before.status(*seat), SeatStatus::Active);
                        }
                        _ => {}
                    }
                }
                GameEvent::Pass { seat } => {
                    stats.passes += 1;
                    assert_eq!(s.mode(), GameMode::Teams);
                    assert_ne!(s.status(*seat), SeatStatus::Active);
                }
                GameEvent::Defeat { reason, .. } => {
                    if *reason == DefeatReason::Stalemate {
                        stats.stalemates += 1;
                    }
                }
                GameEvent::Promotion { .. } => stats.promotions += 1,
                _ => {}
            }
        }
        assert_eq!(
            matches!(events.last(), Some(GameEvent::GameEnded { .. })),
            s.is_over() && !before.is_over()
        );

        // Frozen seats' pieces never move: their set can only shrink.
        for seat in Seat::ALL {
            if before.status(seat) == SeatStatus::Frozen {
                for (sq, p) in s.pieces_of(seat) {
                    assert_eq!(before.piece_at(sq), Some(p), "frozen piece moved");
                }
            }
            // Statuses only move "down": Active -> Defeated -> Frozen, Active -> Removed/Frozen.
            let (a, b) = (before.status(seat), s.status(seat));
            let rank = |x: SeatStatus| match x {
                SeatStatus::Active => 0,
                SeatStatus::Defeated => 1,
                SeatStatus::Frozen | SeatStatus::Removed => 2,
            };
            assert!(rank(b) >= rank(a), "{seat}: {a:?} -> {b:?}");
        }
        assert!(s.ply() >= before.ply());

        // State-level invariants.
        assert_eq!(s.hash(), zobrist::compute_hash(&s));
        for seat in Seat::ALL {
            match s.status(seat) {
                SeatStatus::Removed => assert_eq!(s.pieces_of(seat).count(), 0),
                SeatStatus::Active => assert!(s.leader_count(seat) > 0),
                _ => {}
            }
            assert!(s.no_progress() <= s.move_limit() || s.is_over());
        }
        if full_checks {
            check_invariants(&s);
        } else if !s.is_over() {
            assert!(has_legal_move(&s, s.seat_to_move()));
        }
    }
    assert!(s.is_over(), "game {game} did not terminate: {s}");
    check_invariants(&s);
    stats.games += 1;
    *stats
        .endings
        .entry(result_name(s.outcome().unwrap()))
        .or_default() += 1;
    s
}

/// Positions where a seat is about to be stalemated.
fn fixtures() -> Vec<GameState> {
    let south_boxed = [
        "sKa1", "sRb1", "sBc1", "sBa3", "sPa2", "sPb2", "sPb3", "sPb4", "sPd2",
    ];
    let mut ffa = south_boxed.to_vec();
    ffa.extend(["eRb5", "eNd3", "eKl7", "wKa7", "wPe6", "nKg12", "nPh9"]);
    let mut teams = south_boxed.to_vec();
    teams.extend(["eRb5", "eNd3", "eKl7", "wKa7", "nKg12", "nRh12", "nPh9"]);
    let north_boxed = [
        "nKa12", "nBb12", "nPa11", "nPb11", "nPc11", "sRa10", "sNb10", "sBc10", "sKg1", "sNe1",
        "wKa7", "wQg6", "eKl7", "eRl1",
    ];
    vec![
        common::build("ffa", &ffa, "E AAAA - - 0 0"),
        common::build("teams", &teams, "E AAAA - - 0 0"),
        common::build("teams", &north_boxed, "W AAAA - - 0 0"),
        common::build("teams", &north_boxed, "W AAAA - - 0 0 ml=3"),
    ]
}

#[test]
fn fuzz_self_play_invariants() {
    let n = games(1500);
    let mut stats = Stats::default();
    for g in 0..n {
        // Round-trip / full checks on every ply for a subset keeps debug runs fast.
        play_game(0xC0FFEE + g as u64, g, &mut stats, g % 8 == 0);
    }
    eprintln!("{stats:#?}");
    assert_eq!(stats.games, n);
    if n >= 1000 {
        // The random games must actually reach the interesting rules.
        assert!(stats.passes > 0, "no passes exercised");
        assert!(stats.stalemates > 0, "no stalemates exercised");
        assert!(stats.ep > 0 && stats.castles > 0 && stats.promotions > 0);
        for k in ["ffa_winner", "ffa_tie", "teams_winner", "teams_draw"] {
            assert!(
                stats.endings.get(k).copied().unwrap_or(0) > 0,
                "no {k} endings"
            );
        }
    }
}

#[test]
fn fuzz_is_deterministic() {
    let mut a = Stats::default();
    let mut b = Stats::default();
    for g in 0..20 {
        let x = play_game(77 + g, g as usize, &mut a, false);
        let y = play_game(77 + g, g as usize, &mut b, false);
        assert_eq!(x, y);
    }
}

// ---------------------------------------------------------------------------
// Reference move generator (naive, written independently of the engine).
// ---------------------------------------------------------------------------

fn at(s: &GameState, f: i32, r: i32) -> Option<Option<Piece>> {
    if (0..12).contains(&f) && (0..12).contains(&r) {
        Some(s.piece_at(Square::from_coords(f as u8, r as u8).unwrap()))
    } else {
        None
    }
}

fn name(f: i32, r: i32) -> String {
    format!("{}{}", (b'a' + f as u8) as char, r + 1)
}

/// (rook square, leader destination, squares that must be empty, is long side)
type CastleRow = (&'static str, &'static str, &'static [&'static str], bool);

fn reference_moves(s: &GameState) -> Vec<String> {
    let mut out = Vec::new();
    if s.is_over() {
        return out;
    }
    let me = s.seat_to_move();
    let status = s.status(me);
    if !matches!(status, SeatStatus::Active | SeatStatus::Defeated) {
        return out;
    }
    let enemy = |o: Seat| match s.mode() {
        GameMode::Ffa => o != me,
        GameMode::Teams => (o.index() % 2) != (me.index() % 2),
    };
    let (fwd_f, fwd_r) = match me {
        Seat::South => (0, 1),
        Seat::West => (1, 0),
        Seat::North => (0, -1),
        Seat::East => (-1, 0),
    };
    for f in 0..12 {
        for r in 0..12 {
            let Some(Some(p)) = at(s, f, r) else { continue };
            if p.owner != me {
                continue;
            }
            let from = name(f, r);
            let add = |tf: i32, tr: i32, out: &mut Vec<String>| -> bool {
                match at(s, tf, tr) {
                    None => false,
                    Some(None) => {
                        out.push(format!("{from}{}", name(tf, tr)));
                        true
                    }
                    Some(Some(q)) => {
                        if enemy(q.owner) {
                            out.push(format!("{from}{}", name(tf, tr)));
                        }
                        false
                    }
                }
            };
            let rays: &[(i32, i32)] = match p.kind {
                PieceKind::Bishop => &[(1, 1), (1, -1), (-1, 1), (-1, -1)],
                PieceKind::Rook => &[(1, 0), (-1, 0), (0, 1), (0, -1)],
                PieceKind::Queen => &[
                    (1, 1),
                    (1, -1),
                    (-1, 1),
                    (-1, -1),
                    (1, 0),
                    (-1, 0),
                    (0, 1),
                    (0, -1),
                ],
                _ => &[],
            };
            for &(df, dr) in rays {
                let (mut tf, mut tr) = (f + df, r + dr);
                while add(tf, tr, &mut out) {
                    tf += df;
                    tr += dr;
                }
            }
            match p.kind {
                PieceKind::Knight => {
                    for (df, dr) in [
                        (1, 2),
                        (2, 1),
                        (2, -1),
                        (1, -2),
                        (-1, -2),
                        (-2, -1),
                        (-2, 1),
                        (-1, 2),
                    ] {
                        add(f + df, r + dr, &mut out);
                    }
                }
                PieceKind::King => {
                    for df in -1..=1 {
                        for dr in -1..=1 {
                            if (df, dr) != (0, 0) {
                                add(f + df, r + dr, &mut out);
                            }
                        }
                    }
                }
                PieceKind::Pawn => {
                    // Distance from own back edge.
                    let prog = |f: i32, r: i32| match me {
                        Seat::South => r,
                        Seat::North => 11 - r,
                        Seat::West => f,
                        Seat::East => 11 - f,
                    };
                    let mut pawn_moves: Vec<(i32, i32)> = Vec::new();
                    let (of, or) = (f + fwd_f, r + fwd_r);
                    if at(s, of, or) == Some(None) {
                        pawn_moves.push((of, or));
                        if prog(f, r) == 1 && at(s, of + fwd_f, or + fwd_r) == Some(None) {
                            pawn_moves.push((of + fwd_f, or + fwd_r));
                        }
                    }
                    let side = if fwd_f == 0 {
                        [(-1, fwd_r), (1, fwd_r)]
                    } else {
                        [(fwd_f, -1), (fwd_f, 1)]
                    };
                    for (df, dr) in side {
                        let (tf, tr) = (f + df, r + dr);
                        match at(s, tf, tr) {
                            Some(Some(q)) if enemy(q.owner) => pawn_moves.push((tf, tr)),
                            Some(None) if s.config().en_passant_enabled => {
                                let target = Square::from_coords(tf as u8, tr as u8).unwrap();
                                let ep = Seat::ALL.into_iter().any(|x| {
                                    s.ep_target(x).is_some_and(|t| {
                                        t.skipped == target
                                            && enemy(x)
                                            && s.piece_at(t.pawn)
                                                == Some(Piece::new(PieceKind::Pawn, x))
                                    })
                                });
                                if ep {
                                    pawn_moves.push((tf, tr));
                                }
                            }
                            _ => {}
                        }
                    }
                    for (tf, tr) in pawn_moves {
                        let base = format!("{from}{}", name(tf, tr));
                        if prog(tf, tr) == 6 {
                            for k in ["n", "b", "r", "q"] {
                                out.push(format!("{base}{k}"));
                            }
                        } else {
                            out.push(base);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    // Castling (v1 table, written out by hand).
    if status == SeatStatus::Active {
        let table: [(&str, [CastleRow; 2]); 4] = [
            (
                "g1",
                [
                    ("c1", "e1", &["d1", "e1", "f1"], true),
                    ("j1", "i1", &["h1", "i1"], false),
                ],
            ),
            (
                "a7",
                [
                    ("a3", "a5", &["a4", "a5", "a6"], true),
                    ("a10", "a9", &["a8", "a9"], false),
                ],
            ),
            (
                "g12",
                [
                    ("c12", "e12", &["d12", "e12", "f12"], true),
                    ("j12", "i12", &["h12", "i12"], false),
                ],
            ),
            (
                "l7",
                [
                    ("l3", "l5", &["l4", "l5", "l6"], true),
                    ("l10", "l9", &["l8", "l9"], false),
                ],
            ),
        ];
        let (king_sq, sides) = table[me.index()];
        let piece = |n: &str| s.piece_at(n.parse().unwrap());
        if piece(king_sq) == Some(Piece::new(PieceKind::King, me)) {
            let rights = s.castling_rights(me);
            for (rook, to, between, long) in sides {
                let right = if long { rights.long } else { rights.short };
                if right
                    && piece(rook) == Some(Piece::new(PieceKind::Rook, me))
                    && between.iter().all(|b| piece(b).is_none())
                {
                    out.push(format!("{king_sq}{to}"));
                }
            }
        }
    }
    out.sort();
    out
}

#[test]
fn movegen_matches_reference_generator() {
    let n = games(300);
    let mut positions = 0usize;
    for g in 0..n {
        let mut rng = Rng::new(0xBEEF + g as u64);
        let cfg = random_config(&mut rng, g);
        let mut s = GameState::new(cfg).unwrap();
        let mut events = Vec::new();
        for _ in 0..3000 {
            if s.is_over() {
                break;
            }
            let mut engine: Vec<String> = legal_moves(&s).iter().map(|m| m.to_string()).collect();
            engine.sort();
            let reference = reference_moves(&s);
            assert_eq!(engine, reference, "move lists differ in {s}");
            positions += 1;
            if rng.chance(3) {
                let seat = s.seat_to_move();
                apply_timeout(&mut s, seat).unwrap();
                continue;
            }
            let moves = legal_moves(&s);
            events.clear();
            apply_generated_move(&mut s, moves[rng.below(moves.len())], &mut events);
        }
    }
    eprintln!("compared {positions} positions");
}
