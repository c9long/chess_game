//! Adversarial API tests (derived from PLAN §2, rules version 2, not from the
//! implementation): consumer fitness for the WASM/Node server, the bot engine
//! and a future C ABI, plus "never panic on garbage" robustness.
//!
//! Run the throughput benchmark with
//! `cargo test -p rules-core --release --all-features --test attack_api -- --ignored --nocapture`.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::time::Instant;

use rules_core::*;

// ---------------------------------------------------------------------------
// Allocation counting (per thread, so parallel tests do not interfere).
// ---------------------------------------------------------------------------

struct CountingAlloc;

thread_local! {
    static ALLOCS: Cell<u64> = const { Cell::new(0) };
}

fn bump() {
    let _ = ALLOCS.try_with(|c| c.set(c.get() + 1));
}

// A thin wrapper around the system allocator that only counts calls.
#[allow(unsafe_code)]
unsafe impl GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        bump();
        // SAFETY: forwarded unchanged to the system allocator.
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: forwarded unchanged to the system allocator.
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        bump();
        // SAFETY: forwarded unchanged to the system allocator.
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static GLOBAL: CountingAlloc = CountingAlloc;

fn allocs_during<R>(f: impl FnOnce() -> R) -> (R, u64) {
    let before = ALLOCS.with(Cell::get);
    let r = f();
    let after = ALLOCS.with(Cell::get);
    (r, after - before)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
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

fn sq(s: &str) -> Square {
    s.parse().unwrap()
}

fn mv(s: &str) -> Move {
    parse_move(s).unwrap()
}

/// Board field from tokens like `"sKi1"` (seat letter, kind letter, square).
fn board(pieces: &[&str]) -> String {
    let mut grid: [Option<(char, char)>; 256] = [None; 256];
    for p in pieces {
        let mut ch = p.chars();
        let seat = ch.next().unwrap();
        let kind = ch.next().unwrap();
        let square = sq(ch.as_str());
        assert!(grid[square.index()].is_none(), "duplicate square {p}");
        grid[square.index()] = Some((seat, kind));
    }
    let mut ranks = Vec::new();
    for rank in (0..16).rev() {
        let mut s = String::new();
        let mut empty = 0;
        for file in 0..16 {
            match grid[rank * 16 + file] {
                None => empty += 1,
                Some((seat, kind)) => {
                    if empty > 0 {
                        s.push_str(&empty.to_string());
                        empty = 0;
                    }
                    s.push(seat);
                    s.push(kind);
                }
            }
        }
        if empty > 0 {
            s.push_str(&empty.to_string());
        }
        ranks.push(s);
    }
    ranks.join("/")
}

fn pos(mode: &str, pieces: &[&str], rest: &str) -> GameState {
    let text = format!("{mode} {} {rest}", board(pieces));
    match parse_position(&text) {
        Ok(s) => s,
        Err(e) => panic!("bad test position {text}: {e}"),
    }
}

fn start(mode: GameMode) -> GameState {
    GameState::new(GameConfig::new(mode)).unwrap()
}

fn play(state: &mut GameState, m: &str) -> Vec<GameEvent> {
    match apply_move(state, mv(m)) {
        Ok(ev) => ev,
        Err(e) => panic!("{m} failed: {e} in {state}"),
    }
}

fn outcome_of(ev: &[GameEvent]) -> Option<Outcome> {
    ev.iter().find_map(|e| match e {
        GameEvent::GameEnded { outcome } => Some(*outcome),
        _ => None,
    })
}

fn is_reset_event(e: &GameEvent) -> bool {
    matches!(
        e,
        GameEvent::Capture { .. }
            | GameEvent::Defeat { .. }
            | GameEvent::MoveMade {
                piece: PieceKind::Pawn,
                ..
            }
    )
}

/// Checks every §2-derived invariant of one action's event list against the
/// states before and after it.
fn check_action(before: &GameState, after: &GameState, ev: &[GameEvent], was_move: bool) {
    let ctx = || format!("before {before}\nafter {after}\nevents {ev:?}");
    // GameEnded: at most once, always last, iff the game is now over.
    let ends = ev
        .iter()
        .filter(|e| matches!(e, GameEvent::GameEnded { .. }))
        .count();
    assert!(ends <= 1, "{}", ctx());
    assert_eq!(ends == 1, after.is_over(), "{}", ctx());
    if ends == 1 {
        assert!(
            matches!(ev.last(), Some(GameEvent::GameEnded { .. })),
            "{}",
            ctx()
        );
        assert_eq!(outcome_of(ev).as_ref(), after.outcome(), "{}", ctx());
    }
    if was_move {
        match ev.first() {
            Some(GameEvent::MoveMade { seat, mv, piece }) => {
                assert_eq!(*seat, before.seat_to_move(), "{}", ctx());
                assert_eq!(before.piece_at(mv.from).map(|p| p.kind), Some(*piece));
            }
            other => panic!("first event must be MoveMade, got {other:?}\n{}", ctx()),
        }
    }
    // Defeats only hit ACTIVE seats; passes only DEFEATED Teams seats.
    for e in ev {
        match e {
            GameEvent::Defeat { seat, .. } => {
                assert_eq!(before.status(*seat), SeatStatus::Active, "{}", ctx());
                assert_ne!(after.status(*seat), SeatStatus::Active, "{}", ctx());
            }
            GameEvent::Pass { seat } => {
                assert_eq!(after.mode(), GameMode::Teams, "{}", ctx());
                assert_eq!(after.status(*seat), SeatStatus::Defeated, "{}", ctx());
            }
            GameEvent::ArmyRemoved { seat } => {
                assert_eq!(after.pieces_of(*seat).count(), 0, "{}", ctx());
            }
            _ => {}
        }
    }
    // Ply = turns taken (moves + automatic passes).
    let passes = ev
        .iter()
        .filter(|e| matches!(e, GameEvent::Pass { .. }))
        .count() as u32;
    assert_eq!(
        after.ply(),
        before.ply() + u32::from(was_move) + passes,
        "ply: {}",
        ctx()
    );
    // No-progress counter: turns since the last capture / pawn move / defeat.
    let expected_np = match ev.iter().rposition(is_reset_event) {
        Some(i) => ev[i + 1..]
            .iter()
            .filter(|e| matches!(e, GameEvent::Pass { .. }))
            .count() as u32,
        None => before.no_progress() + u32::from(was_move) + passes,
    };
    assert_eq!(after.no_progress(), expected_np, "no_progress: {}", ctx());
    // A live game is at the start of a playable turn.
    if !after.is_over() {
        assert!(after.takes_turns(after.seat_to_move()), "{}", ctx());
        assert!(!legal_moves(after).is_empty(), "{}", ctx());
        assert!(after.no_progress() < after.move_limit(), "{}", ctx());
    } else {
        assert!(legal_moves(after).is_empty());
        let o = after.outcome().unwrap();
        match (after.mode(), o.result) {
            (GameMode::Teams, GameResult::TeamsWinner { team }) => {
                for s in Seat::ALL {
                    let want = if s.team() == team { 1 } else { 2 };
                    assert_eq!(o.placement(s), want, "{}", ctx());
                    if s.team() != team {
                        assert_eq!(after.pieces_of(s).count(), 0, "losing team pieces stay");
                    }
                }
            }
            (GameMode::Teams, GameResult::TeamsDraw) => assert_eq!(o.placements, [1; 4]),
            (GameMode::Ffa, GameResult::FfaWinner { seat }) => {
                assert_eq!(o.placement(seat), 1);
                let mut p = o.placements;
                p.sort_unstable();
                assert_eq!(p, [1, 2, 3, 4], "{}", ctx());
            }
            (GameMode::Ffa, GameResult::FfaMoveLimitTie { survivors }) => {
                for s in Seat::ALL {
                    assert_eq!(survivors[s.index()], after.status(s) == SeatStatus::Active);
                    if survivors[s.index()] {
                        assert_eq!(o.placement(s), 1);
                    }
                }
            }
            (m, r) => panic!("result {r:?} in mode {m:?}"),
        }
    }
}

/// Plays a seeded random game through the string API (format → parse →
/// apply), with random timeouts and abandons, checking everything a server
/// would rely on. `on_state` sees every intermediate state.
fn drive_game(
    mode: GameMode,
    seed: u64,
    max_actions: usize,
    mut on_state: impl FnMut(&GameState, &[GameEvent]),
) -> GameState {
    let mut rng = Rng::new(seed);
    let mut state = start(mode);
    if rng.chance(300) {
        let mut c = GameConfig::new(mode);
        c.en_passant_enabled = rng.chance(500);
        c.move_limit_rounds = 1 + rng.below(4) as u16;
        state = GameState::new(c).unwrap();
    }
    for _ in 0..max_actions {
        if state.is_over() {
            break;
        }
        let before = state.clone();
        let roll = rng.below(1000);
        let (ev, was_move) = if roll < 4 {
            let seat = state.seat_to_move();
            (apply_timeout(&mut state, seat).unwrap(), false)
        } else if roll < 8 {
            let seat = Seat::ALL[rng.below(4)];
            match apply_abandon(&mut state, seat) {
                Ok(ev) => (ev, false),
                Err(e) => {
                    assert!(!before.takes_turns(seat), "abandon {seat} failed: {e}");
                    assert_eq!(e, RulesError::SeatNotInPlay(seat));
                    assert_eq!(state, before, "failed abandon changed the state");
                    continue;
                }
            }
        } else {
            let moves = legal_moves(&state);
            let chosen = moves[rng.below(moves.len())];
            let text = format_move(&chosen);
            let parsed = parse_move(&text).unwrap();
            assert!(parsed.same_choice(&chosen), "{text}");
            (apply_move(&mut state, parsed).unwrap(), true)
        };
        check_action(&before, &state, &ev, was_move);
        // Position string and hash round-trip.
        let text = state.to_position_string();
        let back = parse_position(&text).unwrap_or_else(|e| panic!("{e}: {text}"));
        assert_eq!(back, state, "{text}");
        assert_eq!(back.hash(), state.hash());
        assert_eq!(state.hash(), zobrist::compute_hash(&state));
        on_state(&state, &ev);
    }
    state
}

// ---------------------------------------------------------------------------
// (1) Server: driving games from strings
// ---------------------------------------------------------------------------

#[test]
fn server_drives_full_random_games_from_strings() {
    let mut finished = 0;
    for seed in 0..40u64 {
        let mode = if seed % 2 == 0 {
            GameMode::Ffa
        } else {
            GameMode::Teams
        };
        let s = drive_game(mode, seed, 4000, |_, _| {});
        if s.is_over() {
            finished += 1;
            // Every action after the end is refused with GameOver.
            let mut t = s.clone();
            assert_eq!(apply_move(&mut t, mv("e2e5")), Err(RulesError::GameOver));
            let on_move = t.seat_to_move();
            assert_eq!(apply_timeout(&mut t, on_move), Err(RulesError::GameOver));
            for seat in Seat::ALL {
                assert_eq!(apply_abandon(&mut t, seat), Err(RulesError::GameOver));
            }
            assert_eq!(t, s);
        }
    }
    assert!(finished > 30, "only {finished} of 40 games finished");
}

#[test]
fn submitted_move_flag_is_ignored_and_engine_flag_reported() {
    let mut s = start(GameMode::Ffa);
    // A double step submitted with a bogus EnPassant flag.
    let bogus = Move {
        flag: MoveFlag::EnPassant,
        ..mv("e2e4")
    };
    let ev = apply_move(&mut s, bogus).unwrap();
    match ev[0] {
        GameEvent::MoveMade { mv, .. } => assert_eq!(mv.flag, MoveFlag::DoubleStep),
        ref e => panic!("{e:?}"),
    }
    assert_eq!(s.ep_target(Seat::South).map(|t| t.skipped), Some(sq("e3")));
    // A normal move submitted with a Castle flag.
    let bogus = Move {
        flag: MoveFlag::Castle,
        ..mv("b7c7")
    };
    let ev = apply_move(&mut s, bogus).unwrap();
    match ev[0] {
        GameEvent::MoveMade { mv, .. } => assert_eq!(mv.flag, MoveFlag::Normal),
        ref e => panic!("{e:?}"),
    }
}

#[test]
fn en_passant_through_strings_and_config_flag() {
    // §2: an opponent pawn that could capture onto the skipped square takes e.p.
    let pieces = ["sKi1", "wKa9", "nKi16", "eKp9", "sPe2", "wPd4"];
    let mut s = pos("ffa", &pieces, "S AAAA - - 0 0");
    play(&mut s, "e2e4");
    let ev = play(&mut s, "d4e3");
    assert!(matches!(
        ev[0],
        GameEvent::MoveMade {
            mv: Move {
                flag: MoveFlag::EnPassant,
                ..
            },
            ..
        }
    ));
    assert!(ev.contains(&GameEvent::Capture {
        seat: Seat::West,
        square: sq("e4"),
        captured: Piece::new(PieceKind::Pawn, Seat::South),
    }));
    assert!(ev.contains(&GameEvent::EnPassant {
        seat: Seat::West,
        captured_square: sq("e4"),
    }));
    assert_eq!(s.piece_at(sq("e4")), None);
    assert_eq!(
        s.piece_at(sq("e3")),
        Some(Piece::new(PieceKind::Pawn, Seat::West))
    );

    // Flag off: no target, no capture.
    let mut s = pos("ffa", &pieces, "S AAAA - - 0 0 ep=off");
    play(&mut s, "e2e4");
    assert_eq!(s.ep_target(Seat::South), None);
    assert!(matches!(
        apply_move(&mut s, mv("d4e3")),
        Err(RulesError::IllegalMove(_))
    ));
    assert!(s.to_position_string().contains(" - 0 1 ep=off"), "{s}");
}

#[test]
fn en_passant_expires_when_turn_order_returns() {
    let mut s = start(GameMode::Ffa);
    play(&mut s, "e2e4");
    play(&mut s, "b7c7"); // West declines
    play(&mut s, "f15f13");
    play(&mut s, "o8n8");
    assert_eq!(s.seat_to_move(), Seat::South);
    assert_eq!(s.ep_target(Seat::South), None, "{s}");
}

#[test]
fn castling_via_strings_with_attacked_squares() {
    // West rook on i8 attacks i1 (the leader) — §2: no attack restrictions.
    let base = pos(
        "ffa",
        &[
            "sKi1", "sRe1", "sRl1", "wKa9", "wRa5", "wRa12", "wRi8", "nKi16", "eKp9",
        ],
        "S AAAA Se1,Sl1,Wa5,Wa12 - 0 0",
    );
    let mut s = base.clone();
    let ev = play(&mut s, "i1k1");
    assert!(ev.contains(&GameEvent::Castle {
        seat: Seat::South,
        rook_from: sq("l1"),
        rook_to: sq("j1"),
    }));
    assert_eq!(
        s.piece_at(sq("j1")),
        Some(Piece::new(PieceKind::Rook, Seat::South))
    );
    assert!(s.castling_rights(Seat::South).is_empty());
    // West castles short along file a: a9 -> a11, rook a12 -> a10.
    let ev = play(&mut s, "a9a11");
    assert!(ev.contains(&GameEvent::Castle {
        seat: Seat::West,
        rook_from: sq("a12"),
        rook_to: sq("a10"),
    }));

    let mut s = base.clone();
    let ev = play(&mut s, "i1g1");
    assert!(ev.contains(&GameEvent::Castle {
        seat: Seat::South,
        rook_from: sq("e1"),
        rook_to: sq("h1"),
    }));
    // King onto the rook is not castling notation.
    let mut s = base;
    assert!(apply_move(&mut s, mv("i1l1")).is_err());
}

// ---------------------------------------------------------------------------
// (4) Robustness: garbage in, errors out, never a panic
// ---------------------------------------------------------------------------

#[test]
fn parse_move_and_square_never_panic_on_random_input() {
    let alphabet: Vec<char> = "abcdefghijklmnopqrstuvwxyzABKQRNP0123456789-= \t\n\u{0}é漢🙂"
        .chars()
        .collect();
    let mut rng = Rng::new(7);
    for _ in 0..50_000 {
        let len = rng.below(9);
        let s: String = (0..len)
            .map(|_| alphabet[rng.below(alphabet.len())])
            .collect();
        let r = catch_unwind(|| (parse_move(&s), s.parse::<Square>()));
        let (m, q) = r.unwrap_or_else(|_| panic!("panicked on {s:?}"));
        if let Ok(m) = m {
            // Accepted strings are canonical up to the promotion letter's case.
            assert_eq!(format_move(&m), s.to_ascii_lowercase(), "{s:?}");
        }
        if let Ok(q) = q {
            assert_eq!(q.to_string(), s);
        }
    }
    // Every square name round-trips; near misses are rejected.
    // 16×16: every u8 is a square index (0..=255).
    for i in 0..=255u8 {
        let q = Square::new(i).unwrap();
        assert_eq!(q.to_string().parse::<Square>().unwrap(), q);
    }
    for bad in [
        "a0", "a17", "q1", "a01", "A1", "", "a", "1a", "p160", "a1 ", " a1",
    ] {
        assert!(bad.parse::<Square>().is_err(), "{bad:?}");
    }
    assert_eq!(Square::new(255).map(|q| q.to_string()), Some("p16".into()));
    assert!(Square::from_coords(16, 0).is_none());
    assert!(Square::from_coords(0, 16).is_none());
    assert_eq!(sq("a1").offset(-1, 0), None);
    assert_eq!(sq("p16").offset(i8::MAX, i8::MAX), None);
    assert_eq!(sq("a1").offset(i8::MIN, i8::MIN), None);
}

fn sample_positions() -> Vec<GameState> {
    let mut v = vec![start(GameMode::Ffa), start(GameMode::Teams)];
    let mut snaps = Vec::new();
    drive_game(GameMode::Teams, 3, 300, |s, _| snaps.push(s.clone()));
    drive_game(GameMode::Ffa, 4, 300, |s, _| snaps.push(s.clone()));
    for (i, s) in snaps.into_iter().enumerate() {
        if i % 37 == 0 || s.is_over() {
            v.push(s);
        }
    }
    v
}

#[test]
fn parse_position_never_panics_on_mutated_strings() {
    let seeds: Vec<String> = sample_positions()
        .iter()
        .map(|s| s.to_position_string())
        .collect();
    let junk: Vec<char> = "0123456789sSwWnNeEkKqQrRbBpPaAdDfFlL/-,= .x\u{0}é"
        .chars()
        .collect();
    let mut rng = Rng::new(11);
    let mut accepted = 0;
    for i in 0..30_000 {
        let base: Vec<char> = seeds[i % seeds.len()].chars().collect();
        let mut c = base.clone();
        for _ in 0..1 + rng.below(3) {
            if c.is_empty() {
                break;
            }
            let at = rng.below(c.len());
            match rng.below(4) {
                0 => c[at] = junk[rng.below(junk.len())],
                1 => {
                    c.remove(at);
                }
                2 => c.insert(at, junk[rng.below(junk.len())]),
                _ => {
                    let b = rng.below(c.len());
                    c.swap(at, b);
                }
            }
        }
        let text: String = c.into_iter().collect();
        let r = catch_unwind(|| parse_position(&text))
            .unwrap_or_else(|_| panic!("parse_position panicked on {text:?}"));
        if let Ok(s) = r {
            accepted += 1;
            // Whatever is accepted is a consistent, playable (or finished) state.
            let again = parse_position(&s.to_position_string()).unwrap();
            assert_eq!(again, s, "{text}");
            assert_eq!(s.hash(), zobrist::compute_hash(&s));
            if !s.is_over() {
                assert!(!legal_moves(&s).is_empty(), "{text}");
                let mut t = s.clone();
                let m = legal_moves(&t)[0];
                let ev = catch_unwind(AssertUnwindSafe(|| apply_move(&mut t, m)))
                    .unwrap_or_else(|_| panic!("apply panicked on accepted {text:?}"));
                assert!(ev.is_ok(), "{text}");
            }
        }
    }
    assert!(accepted > 0);
}

#[test]
fn parse_position_extreme_counters_do_not_panic() {
    let kings = ["sKi1", "wKa9", "nKi16", "eKp9"];
    // ply at u32::MAX: playing on must not overflow-panic.
    let mut s = pos("ffa", &kings, "S AAAA - - 0 4294967295");
    let r = catch_unwind(AssertUnwindSafe(|| apply_move(&mut s, mv("i1i2"))));
    assert!(r.is_ok(), "ply overflow panicked");
    // Huge no-progress counter: the game is already over by the move limit.
    let s = pos("ffa", &kings, "S AAAA - - 4294967295 9");
    assert!(s.is_over());
    // Maximum ml: limit 65535 × 4 fits; one more quiet turn ends the game.
    let mut s = pos("ffa", &kings, "S AAAA - - 262139 0 ml=65535");
    assert_eq!(s.move_limit(), 262_140);
    let ev = play(&mut s, "i1i2");
    assert!(s.is_over(), "{ev:?}");
    // Out of range numbers and over-long input are errors.
    for rest in [
        "S AAAA - - 4294967296 0",
        "S AAAA - - 0 4294967296",
        "S AAAA - - 0 0 ml=65536",
        "S AAAA - - 0 0 ml=-1",
    ] {
        let text = format!("ffa {} {rest}", board(&kings));
        assert!(parse_position(&text).is_err(), "{text}");
    }
    let long = format!("{} {}", start(GameMode::Ffa), "x".repeat(10_000));
    assert!(parse_position(&long).is_err());
    let manyfields = format!("{} {}", start(GameMode::Ffa), "ep=on ".repeat(500));
    assert!(parse_position(&manyfields).is_err());
}

#[test]
fn every_garbage_move_is_rejected_without_side_effects() {
    for s0 in sample_positions().into_iter().take(12) {
        let legal = legal_moves(&s0);
        let promos = [
            None,
            Some(PieceKind::Pawn),
            Some(PieceKind::Knight),
            Some(PieceKind::Bishop),
            Some(PieceKind::Rook),
            Some(PieceKind::Queen),
            Some(PieceKind::King),
        ];
        let mut accepted = 0;
        for from in 0..=255u8 {
            for to in 0..=255u8 {
                for promotion in promos {
                    let m = Move {
                        from: Square::new(from).unwrap(),
                        to: Square::new(to).unwrap(),
                        promotion,
                        flag: MoveFlag::Normal,
                    };
                    let mut s = s0.clone();
                    let mut buf = vec![GameEvent::Pass { seat: Seat::East }];
                    match apply_move_into(&mut s, m, &mut buf) {
                        Ok(()) => {
                            accepted += 1;
                            assert!(legal.iter().any(|l| l.same_choice(&m)), "{m} in {s0}");
                            // Appends after the existing content.
                            assert_eq!(buf[0], GameEvent::Pass { seat: Seat::East });
                            assert!(matches!(buf[1], GameEvent::MoveMade { .. }));
                        }
                        Err(e) => {
                            if s0.is_over() {
                                assert_eq!(e, RulesError::GameOver);
                            } else {
                                assert_eq!(e, RulesError::IllegalMove(m));
                            }
                            assert_eq!(s, s0, "rejected {m} changed state");
                            assert_eq!(buf.len(), 1, "rejected {m} appended events");
                        }
                    }
                }
            }
        }
        assert_eq!(accepted, legal.len(), "{s0}");
    }
}

#[test]
fn moves_for_the_wrong_seat_and_teammates_are_rejected() {
    let mut s = start(GameMode::Teams);
    let s0 = s.clone();
    // West, North, East pieces while South is on move.
    for m in ["b5c5", "e15e14", "o5n5", "a11c10"] {
        assert_eq!(
            apply_move(&mut s, mv(m)),
            Err(RulesError::IllegalMove(mv(m)))
        );
    }
    assert_eq!(s, s0);
    // Teams: a teammate's pieces are never capturable (spec: "Teammates can't
    // capture each other"), from any seat's perspective.
    let mut buf = Vec::new();
    for _ in 0..200 {
        for seat in Seat::ALL {
            generate_moves_for_seat(&s, seat, &mut buf);
            for m in &buf {
                if let Some(p) = s.piece_at(m.to) {
                    assert!(s.is_opponent(seat, p.owner), "{seat} {m} hits {p:?}");
                }
            }
        }
        if s.is_over() {
            break;
        }
        let moves = legal_moves(&s);
        let pick = moves[(s.ply() as usize * 7919) % moves.len()];
        apply_move(&mut s, pick).unwrap();
    }
}

#[test]
fn timeouts_for_the_wrong_seat_are_errors() {
    let mut s = start(GameMode::Ffa);
    let s0 = s.clone();
    for seat in [Seat::West, Seat::North, Seat::East] {
        assert_eq!(
            apply_timeout(&mut s, seat),
            Err(RulesError::NotSeatToMove {
                seat,
                to_move: Seat::South
            })
        );
    }
    assert_eq!(s, s0);
    // A REMOVED seat is never on move.
    let mut s = pos("ffa", &["sKi1", "wKa9", "nKi16"], "S AAAR - - 0 0 def=Et");
    let s0 = s.clone();
    assert!(matches!(
        apply_timeout(&mut s, Seat::East),
        Err(RulesError::NotSeatToMove { .. })
    ));
    assert_eq!(
        apply_abandon(&mut s, Seat::East),
        Err(RulesError::SeatNotInPlay(Seat::East))
    );
    assert_eq!(s, s0);
}

#[test]
fn abandon_of_frozen_seat_is_an_error_and_frozen_seats_are_inert() {
    let mut s = pos(
        "teams",
        &["sKi1", "nKi16", "wKa9", "eRp5", "eKp10"],
        "S AAAF - - 0 0 def=Et",
    );
    let s0 = s.clone();
    assert_eq!(
        apply_abandon(&mut s, Seat::East),
        Err(RulesError::SeatNotInPlay(Seat::East))
    );
    assert_eq!(s, s0);
    let mut buf = vec![mv("a1a2")];
    generate_moves_for_seat(&s, Seat::East, &mut buf);
    assert!(buf.is_empty(), "frozen seat generated {buf:?}");
    assert!(!has_legal_move(&s, Seat::East));
    assert!(!is_square_attacked_by(&s, sq("p1"), Seat::East));
    // Nothing of East ever moves.
    assert!(
        legal_moves(&s)
            .iter()
            .all(|m| s.piece_at(m.from).unwrap().owner == Seat::South)
    );
}

#[test]
fn off_turn_abandon_in_teams_freezes_without_moving_the_turn() {
    let mut s = pos(
        "teams",
        &["sKi1", "nKi16", "wKa9", "eKp9"],
        "S AAAA - - 7 20",
    );
    let before = s.clone();
    let ev = apply_abandon(&mut s, Seat::North).unwrap();
    check_action(&before, &s, &ev, false);
    assert_eq!(
        ev,
        vec![
            GameEvent::Defeat {
                seat: Seat::North,
                reason: DefeatReason::Abandon
            },
            GameEvent::Frozen { seat: Seat::North },
        ]
    );
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    assert_eq!(s.seat_to_move(), Seat::South);
    assert_eq!(s.no_progress(), 0, "a defeat resets the move-limit counter");
    // North's frozen king still blocks and can be captured (no effect).
    assert_eq!(
        s.piece_at(sq("i16")),
        Some(Piece::new(PieceKind::King, Seat::North))
    );
}

#[test]
fn ffa_off_turn_abandon_with_two_left_ends_the_game() {
    let mut s = pos("ffa", &["sKi1", "wKa9"], "S AARR - - 0 20 def=Nl,Et");
    assert_eq!(
        apply_abandon(&mut s, Seat::North),
        Err(RulesError::SeatNotInPlay(Seat::North))
    );
    let before = s.clone();
    let ev = apply_abandon(&mut s, Seat::West).unwrap();
    check_action(&before, &s, &ev, false);
    let o = outcome_of(&ev).unwrap();
    assert_eq!(o.result, GameResult::FfaWinner { seat: Seat::South });
    // 1st survivor, then reverse order of defeat: W (last) 2nd, E 3rd, N 4th.
    assert_eq!(o.placements, [1, 2, 4, 3]);
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::West }));
    assert_eq!(s.pieces_of(Seat::West).count(), 0);
}

#[test]
fn teams_timeout_of_last_active_seat_ends_game_and_removes_losers() {
    // South already lost its leader (DEFEATED); North times out → team out.
    let mut s = pos(
        "teams",
        &["sRe1", "nKi16", "nPi15", "wKa9", "eKp9"],
        "N DAAA - - 0 10 def=Sl",
    );
    assert_eq!(
        apply_timeout(&mut s, Seat::South),
        Err(RulesError::NotSeatToMove {
            seat: Seat::South,
            to_move: Seat::North
        })
    );
    let before = s.clone();
    let ev = apply_timeout(&mut s, Seat::North).unwrap();
    check_action(&before, &s, &ev, false);
    assert!(ev.contains(&GameEvent::Defeat {
        seat: Seat::North,
        reason: DefeatReason::Timeout
    }));
    assert_eq!(s.status(Seat::North), SeatStatus::Frozen);
    let o = s.outcome().copied().unwrap();
    assert_eq!(
        o.result,
        GameResult::TeamsWinner {
            team: Team::WestEast
        }
    );
    assert_eq!(o.placements, [2, 1, 2, 1]);
    assert_eq!(s.pieces_of(Seat::South).count(), 0);
    assert_eq!(s.pieces_of(Seat::North).count(), 0);
    // The finished state still round-trips.
    assert_eq!(parse_position(&s.to_position_string()).unwrap(), s);
}

#[test]
fn promotion_requires_a_roster_choice_on_every_seats_line() {
    let base = pos(
        "ffa",
        &[
            "sKi1", "sPh8", "wKa9", "wPh5", "nKi16", "nPe9", "eKp10", "ePi6",
        ],
        "S AAAA - - 0 0",
    );
    // South: rank 9. Missing / king / pawn promotions are illegal.
    for bad in ["h8h9", "h8h9k", "h8h9p"] {
        let mut s = base.clone();
        assert!(apply_move(&mut s, mv(bad)).is_err(), "{bad}");
        assert_eq!(s, base);
    }
    // Promotion letter on a non-promoting move is illegal too.
    let mut s = base.clone();
    assert!(apply_move(&mut s, mv("i1i2q")).is_err());
    for k in ["q", "r", "b", "n"] {
        let mut s = base.clone();
        let ev = play(&mut s, &format!("h8h9{k}"));
        let kind = PieceKind::from_letter(k.to_ascii_uppercase().chars().next().unwrap()).unwrap();
        assert!(ev.contains(&GameEvent::Promotion {
            seat: Seat::South,
            square: sq("h9"),
            kind
        }));
        assert_eq!(s.piece_at(sq("h9")), Some(Piece::new(kind, Seat::South)));
        assert_eq!(s.no_progress(), 0);
    }
    // Every seat: all moves of the pawn promote on its line (S rank 9, N rank 8,
    // W file i, E file h) to exactly {Q, R, B, N}.
    let mut buf = Vec::new();
    for (seat, from, line_ok) in [
        (
            Seat::South,
            "h8",
            (|q: Square| q.rank() == 8) as fn(Square) -> bool,
        ),
        (Seat::West, "h5", |q: Square| q.file() == 8),
        (Seat::North, "e9", |q: Square| q.rank() == 7),
        (Seat::East, "i6", |q: Square| q.file() == 7),
    ] {
        generate_moves_for_seat(&base, seat, &mut buf);
        let pawn: Vec<Move> = buf.iter().copied().filter(|m| m.from == sq(from)).collect();
        assert!(!pawn.is_empty(), "{seat}");
        assert_eq!(pawn.len() % 4, 0, "{seat}: {pawn:?}");
        for m in &pawn {
            assert!(line_ok(m.to), "{seat} {m}");
            assert!(
                matches!(
                    m.promotion,
                    Some(
                        PieceKind::Queen | PieceKind::Rook | PieceKind::Bishop | PieceKind::Knight
                    )
                ),
                "{seat} {m}"
            );
        }
    }
}

#[test]
fn leader_glow_is_off_for_a_seat_that_is_no_longer_active() {
    // §2: once a seat is not ACTIVE its leader is an ordinary piece, and the
    // glow is for "attacked leaders". South (stalemated earlier, DEFEATED)
    // still has its king on i1, attacked by West's rook on i7.
    let s = pos(
        "teams",
        &["sKi1", "wRi7", "wKa9", "nKj16", "eKp9"],
        "W DAAA - - 0 10 def=Ss",
    );
    assert!(is_square_attacked_by(&s, sq("i1"), Seat::West));
    assert!(
        !leader_under_attack(&s, Seat::South),
        "a DEFEATED seat's old king is no longer a leader"
    );
}

#[test]
fn defeated_teams_seat_without_pieces_passes_and_passes_count() {
    // South has no pieces at all (DEFEATED): its turns are automatic passes.
    let mut s = pos(
        "teams",
        &["wKa9", "nKi16", "eKp9"],
        "E DAAA - - 0 0 ml=1 def=Sl",
    );
    assert_eq!(s.move_limit(), 4, "DEFEATED seats still take turns");
    let before = s.clone();
    let ev = play(&mut s, "p9o9");
    check_action(&before, &s, &ev, true);
    assert!(ev.contains(&GameEvent::Pass { seat: Seat::South }));
    assert_eq!(s.seat_to_move(), Seat::West);
    assert_eq!((s.ply(), s.no_progress()), (2, 2));
    play(&mut s, "a9b9"); // 3
    let ev = play(&mut s, "i16i15"); // 4 = limit → draw
    let o = outcome_of(&ev).expect("move limit must end the game");
    assert_eq!(o.result, GameResult::TeamsDraw);
    assert_eq!(o.placements, [1; 4]);
}

#[test]
fn move_limit_ends_exactly_at_rounds_times_seats_taking_turns() {
    let kings = ["sKi1", "wKa9", "nKi16", "eKp9"];
    let mut s = pos("ffa", &kings, "S AAAA - - 2 40 ml=1");
    play(&mut s, "i1i2");
    assert!(!s.is_over(), "3 < 4");
    let ev = play(&mut s, "a9b9");
    let o = outcome_of(&ev).expect("4 = 1 × 4 seats");
    assert_eq!(
        o.result,
        GameResult::FfaMoveLimitTie {
            survivors: [true; 4]
        }
    );
    assert_eq!(o.placements, [1; 4]);

    // With East REMOVED only three seats take turns.
    let mut s = pos("ffa", &kings[..3], "S AAAR - - 2 40 ml=1 def=Et");
    assert_eq!(s.move_limit(), 3);
    let ev = play(&mut s, "i1i2");
    let o = outcome_of(&ev).expect("3 = 1 × 3 seats");
    assert_eq!(o.placements, [1, 1, 1, 4]);
}

// ---------------------------------------------------------------------------
// (2) Bot engine: cost of cloning, generating and applying
// ---------------------------------------------------------------------------

#[test]
fn game_state_is_small_fixed_size_and_clone_does_not_allocate() {
    assert!(
        std::mem::size_of::<GameState>() <= 768,
        "GameState is {} bytes",
        std::mem::size_of::<GameState>()
    );
    for s in sample_positions() {
        let (c, n) = allocs_during(|| s.clone());
        assert_eq!(n, 0, "clone allocated");
        assert_eq!(c, s);
    }
}

#[test]
fn movegen_and_turn_resolution_do_not_allocate_with_warm_buffers() {
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let mut rng = Rng::new(99);
        let mut s = start(mode);
        let mut buf: Vec<Move> = Vec::with_capacity(512);
        let mut ev: Vec<GameEvent> = Vec::with_capacity(64);
        for _ in 0..600 {
            if s.is_over() {
                break;
            }
            let ((), n) = allocs_during(|| generate_legal_moves(&s, &mut buf));
            assert_eq!(n, 0, "generate_legal_moves allocated with a warm buffer");
            let (any, n) = allocs_during(|| has_legal_move(&s, s.seat_to_move()));
            assert!(any);
            assert_eq!(n, 0, "has_legal_move allocated");
            let (_, n) = allocs_during(|| leader_under_attack(&s, Seat::South));
            assert_eq!(n, 0, "leader_under_attack allocated");
            let m = buf[rng.below(buf.len())];
            ev.clear();
            let ((), n) = allocs_during(|| apply_generated_move(&mut s, m, &mut ev));
            // In debug builds apply_generated_move runs a debug_assert that
            // re-validates via find_legal_move (which allocates); release must be 0.
            if !cfg!(debug_assertions) {
                assert_eq!(n, 0, "apply_generated_move allocated");
            }
        }
    }
}

#[test]
fn legal_move_lists_have_no_duplicates_and_validate_to_themselves() {
    for seed in 0..6u64 {
        let mode = if seed % 2 == 0 {
            GameMode::Ffa
        } else {
            GameMode::Teams
        };
        drive_game(mode, 100 + seed, 600, |s, _| {
            let moves = legal_moves(s);
            for (i, a) in moves.iter().enumerate() {
                for b in &moves[i + 1..] {
                    assert!(!a.same_choice(b), "duplicate {a} in {s}");
                }
                assert_eq!(find_legal_move(s, *a), Some(*a), "{a} in {s}");
            }
            assert_eq!(perft(s, 1), moves.len() as u64);
        });
    }
}

#[test]
fn perft_divide_is_consistent_and_finished_states_count_zero() {
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let s = start(mode);
        assert_eq!(perft(&s, 1), 30);
        let div = perft_divide(&s, 2);
        assert_eq!(div.len(), 30);
        assert_eq!(div.iter().map(|(_, n)| n).sum::<u64>(), perft(&s, 2));
        assert_eq!(perft(&s, 0), 1);
        assert!(perft_divide(&s, 0).is_empty());
    }
    let mut over = pos("ffa", &["sKi1", "wKa9"], "S AARR - - 0 20 def=Nl,Et");
    apply_abandon(&mut over, Seat::West).unwrap();
    assert!(over.is_over());
    assert_eq!(perft(&over, 3), 0);
    assert!(legal_moves(&over).is_empty());
}

#[test]
fn transpositions_give_equal_states_and_hashes() {
    let mut a = start(GameMode::Ffa);
    let mut b = start(GameMode::Ffa);
    for m in ["f1e3", "a11c10", "k16j14", "p11n10", "k1j3"] {
        play(&mut a, m);
    }
    for m in ["k1j3", "a11c10", "k16j14", "p11n10", "f1e3"] {
        play(&mut b, m);
    }
    assert_eq!(a, b);
    assert_eq!(a.hash(), b.hash());
    assert_eq!(a.hash(), zobrist::compute_hash(&a));
    assert_ne!(a.hash(), start(GameMode::Ffa).hash());
    // Mode is part of the game: an FFA and a Teams state are not equal.
    let mut t = start(GameMode::Teams);
    for m in ["f1e3", "a11c10", "k16j14", "p11n10", "k1j3"] {
        play(&mut t, m);
    }
    assert_ne!(t, a);
}

/// Throughput report (run in release with `--ignored --nocapture`).
#[test]
#[ignore]
fn bench_perft_and_clone_throughput() {
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let s = start(mode);
        for depth in [3u32, 4] {
            let t = Instant::now();
            let mut nodes = 0u64;
            let mut runs = 0;
            while t.elapsed().as_secs_f64() < 1.0 || runs == 0 {
                nodes += perft(&s, depth);
                runs += 1;
            }
            let secs = t.elapsed().as_secs_f64();
            println!(
                "{mode:?} perft({depth}): {runs} runs, {nodes} leaves in {secs:.3}s = {:.2} M leaves/s",
                nodes as f64 / secs / 1e6
            );
        }
        let mut buf = Vec::with_capacity(256);
        let t = Instant::now();
        let mut n = 0u64;
        while t.elapsed().as_secs_f64() < 0.5 {
            for _ in 0..10_000 {
                generate_legal_moves(&s, &mut buf);
                n += buf.len() as u64;
            }
        }
        println!(
            "{mode:?} movegen: {:.2} M moves/s",
            n as f64 / t.elapsed().as_secs_f64() / 1e6
        );
        let t = Instant::now();
        let mut k = 0u64;
        while t.elapsed().as_secs_f64() < 0.5 {
            for _ in 0..100_000 {
                let c = std::hint::black_box(&s).clone();
                k += u64::from(c.ply() == 0);
            }
        }
        println!(
            "{mode:?} clone: {:.1} M clones/s ({} bytes)",
            k as f64 / t.elapsed().as_secs_f64() / 1e6,
            std::mem::size_of::<GameState>()
        );
    }
}

// ---------------------------------------------------------------------------
// (3) C ABI friendliness: plain, small, Copy value types
// ---------------------------------------------------------------------------

fn assert_copy<T: Copy>() {}

#[test]
fn value_types_are_small_and_copy() {
    assert_copy::<Square>();
    assert_copy::<Seat>();
    assert_copy::<Team>();
    assert_copy::<PieceKind>();
    assert_copy::<Piece>();
    assert_copy::<Move>();
    assert_copy::<MoveFlag>();
    assert_copy::<GameEvent>();
    assert_copy::<Outcome>();
    assert_copy::<GameResult>();
    assert_copy::<GameConfig>();
    assert_copy::<SeatStatus>();
    assert_copy::<DefeatReason>();
    assert_copy::<CastlingRights>();
    assert_copy::<EpTarget>();
    use std::mem::size_of;
    assert_eq!(size_of::<Square>(), 1);
    // (Option<Square> is 2 bytes: Square has no niche; C callers need a sentinel.)
    assert_eq!(size_of::<Seat>(), 1);
    assert_eq!(size_of::<PieceKind>(), 1);
    assert_eq!(size_of::<Piece>(), 2);
    assert!(
        size_of::<Move>() <= 4,
        "Move is {} bytes",
        size_of::<Move>()
    );
    assert!(size_of::<GameEvent>() <= 16);
    // Stable small-integer encodings round-trip.
    for (i, seat) in Seat::ALL.into_iter().enumerate() {
        assert_eq!(seat.index(), i);
        assert_eq!(Seat::from_index(i), Some(seat));
        assert_eq!(Seat::from_letter(seat.letter()), Some(seat));
    }
    assert_eq!(Seat::from_index(4), None);
    assert_eq!(Seat::from_index(usize::MAX), None);
    for (i, k) in PieceKind::ALL.into_iter().enumerate() {
        assert_eq!(k.index(), i);
        assert_eq!(PieceKind::from_letter(k.letter()), Some(k));
    }
    for s in Square::all() {
        assert_eq!(Square::new(s.to_u8()), Some(s));
        assert_eq!(Square::from_coords(s.file(), s.rank()), Some(s));
    }
    // Teams partners and clockwise order per §2.
    assert_eq!(Seat::South.next(), Seat::West);
    assert_eq!(Seat::East.next(), Seat::South);
    assert_eq!(Seat::South.partner(), Seat::North);
    assert_eq!(Seat::West.team(), Team::WestEast);
    assert!(!sq("a1").is_light(), "a1 is dark");
    assert!(sq("h1").is_light(), "South queen on light");
    assert!(!sq("h16").is_light(), "North queen on dark");
    assert!(sq("a8").is_light(), "West queen on light");
    assert!(!sq("p8").is_light(), "East queen on dark");
}

fn assert_send_sync<T: Send + Sync + 'static>() {}

#[test]
fn public_types_are_thread_safe_and_errors_are_displayable() {
    // A server shares states across tasks; a bot searches on worker threads.
    assert_send_sync::<GameState>();
    assert_send_sync::<GameEvent>();
    assert_send_sync::<RulesError>();
    assert_send_sync::<PositionError>();
    assert_send_sync::<NotationError>();
    fn is_error<E: std::error::Error>(e: &E) -> String {
        e.to_string()
    }
    let mut s = start(GameMode::Ffa);
    let e = apply_move(&mut s, mv("a1a2")).unwrap_err();
    assert!(!is_error(&e).is_empty());
    let e = parse_move("zz").unwrap_err();
    assert!(!is_error(&e).is_empty());
    let e = parse_position("ffa").unwrap_err();
    assert!(!is_error(&e).is_empty());
    // Error messages echo at most a bounded prefix of hostile input.
    let huge = "q".repeat(100_000);
    let e = parse_move(&huge).unwrap_err();
    assert!(e.to_string().len() < 200);
    let e = huge.parse::<Square>().unwrap_err();
    assert!(e.to_string().len() < 200);
    let e = parse_position(&huge).unwrap_err();
    assert!(e.to_string().len() < 400);
    let e = parse_position(&format!("{} {}", "ffa", "x".repeat(4000))).unwrap_err();
    assert!(e.to_string().len() < 400, "{}", e.to_string().len());
}

#[test]
fn invalid_configs_are_errors_not_panics() {
    let mut c = GameConfig::new(GameMode::Ffa);
    c.rules_version = 0;
    assert!(matches!(GameState::new(c), Err(RulesError::Config(_))));
    let mut c = GameConfig::new(GameMode::Teams);
    c.move_limit_rounds = 0;
    assert!(matches!(GameState::new(c), Err(RulesError::Config(_))));
    let mut c = GameConfig::new(GameMode::Teams);
    c.civs[3].version = u32::MAX;
    assert!(matches!(GameState::new(c), Err(RulesError::Config(_))));
    // Every civ's latest version is valid and plays the standard roster (v1).
    for id in CivId::ALL {
        let c = GameConfig::new(GameMode::Ffa).with_civs([id; 4]);
        let s = GameState::new(c).unwrap();
        assert_eq!(legal_moves(&s).len(), 30, "{id:?}");
        assert!(civ_definition(id, 0).is_none());
        assert!(civ_definition(id, u32::MAX).is_none());
    }
}

// ---------------------------------------------------------------------------
// (1b) JSON for the WASM / Node layer
// ---------------------------------------------------------------------------

#[cfg(feature = "serde")]
mod json {
    use super::*;
    use serde_json::{Value, json};

    type Mutation = Box<dyn Fn(&mut Value)>;

    #[test]
    fn json_round_trips_every_state_and_event_of_random_games() {
        for seed in 0..10u64 {
            let mode = if seed % 2 == 0 {
                GameMode::Ffa
            } else {
                GameMode::Teams
            };
            drive_game(mode, 500 + seed, 3000, |s, ev| {
                let text = serde_json::to_string(s).unwrap();
                let back: GameState =
                    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{e}: {text}"));
                assert_eq!(&back, s);
                assert_eq!(back.hash(), s.hash());
                assert_eq!(back.outcome(), s.outcome());
                let v: Value = serde_json::from_str(&text).unwrap();
                assert_eq!(v["outcome"].is_null(), !s.is_over());
                let et = serde_json::to_string(ev).unwrap();
                let eback: Vec<GameEvent> = serde_json::from_str(&et).unwrap();
                assert_eq!(eback, ev);
            });
        }
    }

    #[test]
    fn server_can_apply_moves_given_as_json() {
        let mut s = pos(
            "teams",
            &["sKi1", "wKa9", "nKi16", "eKp9", "sPe2", "wPd4"],
            "S AAAA - - 0 0",
        );
        // Clients send {from,to,promotion}; the flag is optional and ignored.
        let m: Move =
            serde_json::from_value(json!({"from":"e2","to":"e4","promotion":null})).unwrap();
        apply_move(&mut s, m).unwrap();
        // West takes South's double-stepped pawn en passant (opponents in Teams).
        let m: Move =
            serde_json::from_value(json!({"from":"d4","to":"e3","promotion":null,"flag":"normal"}))
                .unwrap();
        let ev = apply_move(&mut s, m).unwrap();
        let ej = serde_json::to_value(&ev).unwrap();
        assert_eq!(ej[0]["type"], "move_made");
        assert_eq!(ej[0]["mv"]["flag"], "en_passant");
        assert_eq!(ej[1]["type"], "capture");
        assert_eq!(ej[1]["captured"]["owner"], "south");
        assert_eq!(ej[2]["type"], "en_passant");
        // Malformed move JSON is a deserialization error, not a panic.
        for bad in [
            json!({"from":"q1","to":"a1","promotion":null}),
            json!({"from":"a1","to":"a17","promotion":null}),
            json!({"from":"a1","to":"a2","promotion":"dragon"}),
            json!({"from":1,"to":"a2"}),
            json!({"to":"a2","promotion":null}),
            json!("e2e4"),
            json!(null),
        ] {
            assert!(
                serde_json::from_value::<Move>(bad.clone()).is_err(),
                "{bad}"
            );
        }
        // A deserializable but illegal move is rejected by the engine.
        let s0 = s.clone();
        let m: Move =
            serde_json::from_value(json!({"from":"a1","to":"p16","promotion":"king"})).unwrap();
        assert!(matches!(
            apply_move(&mut s, m),
            Err(RulesError::IllegalMove(_))
        ));
        assert_eq!(s, s0);
    }

    #[test]
    fn tampered_state_json_is_rejected_without_panicking() {
        let mut s = start(GameMode::Teams);
        play(&mut s, "e2e4");
        let good: Value = serde_json::to_value(&s).unwrap();
        let mutations: Vec<(&str, Mutation)> = vec![
            (
                "duplicate square",
                Box::new(|v| {
                    let first = v["pieces"][0].clone();
                    v["pieces"].as_array_mut().unwrap().push(first);
                }),
            ),
            (
                "removed in teams",
                Box::new(|v| v["statuses"][0] = json!("removed")),
            ),
            (
                "rules version",
                Box::new(|v| v["config"]["rules_version"] = json!(1)),
            ),
            (
                "zero move limit",
                Box::new(|v| v["config"]["move_limit_rounds"] = json!(0)),
            ),
            (
                "five defeats",
                Box::new(|v| {
                    v["defeats"] = json!([
                        {"seat":"south","reason":"timeout"},
                        {"seat":"west","reason":"timeout"},
                        {"seat":"north","reason":"timeout"},
                        {"seat":"east","reason":"timeout"},
                        {"seat":"south","reason":"timeout"}
                    ])
                }),
            ),
            ("bad seat", Box::new(|v| v["seat_to_move"] = json!("up"))),
            (
                "bad kind",
                Box::new(|v| v["pieces"][0]["kind"] = json!("dragon")),
            ),
            (
                "bad square",
                Box::new(|v| v["pieces"][0]["square"] = json!("q13")),
            ),
            ("negative", Box::new(|v| v["no_progress"] = json!(-1))),
            ("huge", Box::new(|v| v["ply"] = json!(1e20))),
            (
                "ep on edge",
                Box::new(|v| v["en_passant"][0] = json!({"skipped":"a1","pawn":"a2"})),
            ),
            (
                "ep pawn mismatch",
                Box::new(|v| v["en_passant"][0] = json!({"skipped":"e3","pawn":"e5"})),
            ),
            (
                "remove all kings",
                Box::new(|v| {
                    v["pieces"]
                        .as_array_mut()
                        .unwrap()
                        .retain(|p| p["kind"] != "king");
                }),
            ),
            (
                "pawn on promotion line",
                Box::new(|v| {
                    v["pieces"]
                        .as_array_mut()
                        .unwrap()
                        .push(json!({"square":"a9","kind":"pawn","owner":"south"}));
                }),
            ),
            (
                "missing field",
                Box::new(|v| {
                    v.as_object_mut().unwrap().remove("pieces");
                }),
            ),
            (
                "castling for defeated",
                Box::new(|v| {
                    v["statuses"][1] = json!("defeated");
                    v["defeats"] = json!([{"seat":"west","reason":"stalemate"}]);
                }),
            ),
        ];
        for (name, f) in mutations {
            let mut v = good.clone();
            f(&mut v);
            let r = catch_unwind(AssertUnwindSafe(|| serde_json::from_value::<GameState>(v)));
            let r = r.unwrap_or_else(|_| panic!("{name}: panicked"));
            assert!(r.is_err(), "{name}: accepted");
        }
        // Byte-level garbage.
        let text = serde_json::to_string(&s).unwrap().into_bytes();
        let mut rng = Rng::new(5);
        for _ in 0..5000 {
            let mut b = text.clone();
            for _ in 0..1 + rng.below(3) {
                let at = rng.below(b.len());
                b[at] = b"{}[]\",:0123456789abcdefgklmnopqrstuvwxyz-. "[rng.below(43)];
            }
            let r = catch_unwind(|| serde_json::from_slice::<GameState>(&b));
            assert!(r.is_ok(), "panicked on {}", String::from_utf8_lossy(&b));
        }
    }

    #[test]
    fn config_json_is_validated_on_use() {
        let c: GameConfig = serde_json::from_value(json!({
            "mode": "teams",
            "civs": [
                {"id":"canada","version":1},{"id":"canada","version":1},
                {"id":"canada","version":1},{"id":"canada","version":99}
            ],
            "en_passant_enabled": false,
            "move_limit_rounds": 25,
            "rules_version": 1
        }))
        .unwrap();
        assert!(matches!(GameState::new(c), Err(RulesError::Config(_))));
        let ok = GameConfig::new(GameMode::Teams);
        let back: GameConfig = serde_json::from_str(&serde_json::to_string(&ok).unwrap()).unwrap();
        assert_eq!(back, ok);
    }
}
