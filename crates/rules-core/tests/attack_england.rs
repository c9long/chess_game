//! Spec-derived attack tests for England civ version 2 (four Prime
//! Ministers, letter `M`). Expectations come from the user request / PLAN
//! decisions and plain signed-integer geometry, never from engine tables.

mod common;

use common::*;
use rules_core::*;

const SEAT_LETTERS: [char; 4] = ['s', 'w', 'n', 'e'];
const KNIGHT: [(i32, i32); 8] = [
    (1, 2),
    (2, 1),
    (2, -1),
    (1, -2),
    (-1, -2),
    (-2, -1),
    (-2, 1),
    (-1, 2),
];
const KING: [(i32, i32); 8] = [
    (0, 1),
    (1, 1),
    (1, 0),
    (1, -1),
    (0, -1),
    (-1, -1),
    (-1, 0),
    (-1, 1),
];

fn nm(f: i32, r: i32) -> String {
    format!("{}{}", (b'a' + f as u8) as char, r + 1)
}

fn on(f: i32, r: i32) -> bool {
    (0..16).contains(&f) && (0..16).contains(&r)
}

fn civ_field(england: &[Seat]) -> String {
    let v: Vec<&str> = Seat::ALL
        .iter()
        .map(|s| {
            if england.contains(s) {
                "england.2"
            } else {
                "canada.1"
            }
        })
        .collect();
    format!("civ={}", v.join(","))
}

fn pm_targets(f: i32, r: i32) -> Vec<String> {
    let mut v: Vec<String> = KNIGHT
        .iter()
        .chain(KING.iter())
        .filter(|&&(df, dr)| on(f + df, r + dr))
        .map(|&(df, dr)| nm(f + df, r + dr))
        .collect();
    v.sort();
    v
}

fn moves_from(s: &GameState, from: &str) -> Vec<String> {
    let from = sq(from);
    let mut v: Vec<String> = legal_moves(s)
        .iter()
        .filter(|m| m.from == from)
        .map(|m| m.to.to_string())
        .collect();
    v.sort();
    v
}

fn england_cfg(mode: GameMode, england: &[Seat]) -> GameConfig {
    let civs = Seat::ALL.map(|s| {
        if england.contains(&s) {
            CivId::England
        } else {
            CivId::Canada
        }
    });
    GameConfig::new(mode).with_civs(civs)
}

// ---------------------------------------------------------------------------
// Movement and attacks
// ---------------------------------------------------------------------------

/// Every square, every owning seat: the PM's moves are exactly the on-board
/// knight leaps plus king steps (no wraparound across the 16-file edge), and
/// it attacks exactly those squares.
#[test]
fn pm_move_and_attack_set_on_every_square_for_every_seat() {
    // Opponent leaders on fixed central squares.
    let kings = ["h8", "i8", "h9", "i9"];
    for (si, seat) in Seat::ALL.into_iter().enumerate() {
        for f in 0..16 {
            for r in 0..16 {
                let here = nm(f, r);
                if kings.contains(&here.as_str()) {
                    continue;
                }
                let mut pieces = vec![format!("{}M{here}", SEAT_LETTERS[si])];
                for (oi, k) in kings.iter().enumerate().take(4) {
                    if oi != si {
                        pieces.push(format!("{}K{k}", SEAT_LETTERS[oi]));
                    }
                }
                let refs: Vec<&str> = pieces.iter().map(|s| s.as_str()).collect();
                let rest = format!("{} AAAA - - 0 0 {}", seat.letter(), civ_field(&[seat]));
                let s = build("ffa", &refs, &rest);
                let expect = pm_targets(f, r);
                assert_eq!(moves_from(&s, &here), expect, "{seat} PM on {here}");
                for t in Square::all() {
                    let want = expect.contains(&t.to_string());
                    assert_eq!(
                        is_square_attacked_by(&s, t, seat),
                        want,
                        "{seat} PM on {here} attacks {t}?"
                    );
                }
            }
        }
    }
}

#[test]
fn pm_counts_at_corners_edges_and_centre() {
    // Knight leaps + king steps that stay on the 16x16 board.
    for (f, r, n) in [
        (0, 0, 2 + 3),   // a1
        (15, 15, 2 + 3), // p16
        (15, 0, 2 + 3),  // p1
        (0, 15, 2 + 3),  // a16
        (7, 0, 4 + 5),   // h1
        (0, 7, 4 + 5),   // a8
        (15, 7, 4 + 5),  // p8 (no wrap to the a-file)
        (1, 1, 4 + 8),   // b2
        (14, 14, 4 + 8), // o15
        (7, 7, 8 + 8),   // h8
    ] {
        assert_eq!(pm_targets(f, r).len(), n, "{}", nm(f, r));
    }
}

#[test]
fn pm_is_blocked_by_own_and_partner_pieces_and_captures_opponents() {
    // Teams: South England PM on h8. North (partner) on i10, West on g10,
    // South's own rook on h9.
    let s = build(
        "teams",
        &[
            "sMh8", "sRh9", "nRi10", "wBg10", "nKi16", "wKa9", "eKp9", "sMe1",
        ],
        "S AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1",
    );
    let got = moves_from(&s, "h8");
    let mut want = pm_targets(7, 7);
    want.retain(|t| t != "h9" && t != "i10");
    assert_eq!(got, want);
    assert!(got.contains(&"g10".to_string()), "captures West's bishop");
}

#[test]
fn pm_has_no_double_moves_and_no_castle_and_no_sliding() {
    let s = build(
        "ffa",
        &["sMi1", "sRl1", "sRe1", "wKa9", "nKi16", "eKp9"],
        "S AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1",
    );
    for m in ["i1k1", "i1g1", "i1i3", "i1k3", "i1f1"] {
        assert!(!is_legal(&s, m), "{m}");
    }
    assert!(legal_moves(&s).iter().all(|m| m.flag != MoveFlag::Castle));
}

// ---------------------------------------------------------------------------
// Leader count semantics
// ---------------------------------------------------------------------------

/// West's queen captures a South PM with South holding `k` PMs.
fn ffa_capture_with(k: usize) -> (GameState, Vec<GameEvent>) {
    let pm_sq = ["c3", "m2", "n14", "b14"];
    let mut pieces = vec![
        "wQc8".to_string(),
        "wKa9".into(),
        "nKi16".into(),
        "eKp9".into(),
    ];
    for s in pm_sq.iter().take(k) {
        pieces.push(format!("sM{s}"));
    }
    pieces.push("sRh4".into());
    let refs: Vec<&str> = pieces.iter().map(|s| s.as_str()).collect();
    let mut s = build(
        "ffa",
        &refs,
        "W AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1",
    );
    assert_eq!(s.leader_count(Seat::South), k as u32);
    let ev = play(&mut s, "c8c3");
    (s, ev)
}

#[test]
fn ffa_three_pm_captures_keep_england_alive_the_fourth_removes_it() {
    for k in 2..=4 {
        let (s, ev) = ffa_capture_with(k);
        assert_eq!(s.status(Seat::South), SeatStatus::Active, "k={k}");
        assert_eq!(s.leader_count(Seat::South), k as u32 - 1);
        assert!(
            !ev.iter().any(|e| matches!(e, GameEvent::Defeat { .. })),
            "k={k}: {ev:?}"
        );
        check_invariants(&s);
    }
    let (s, ev) = ffa_capture_with(1);
    assert_eq!(s.status(Seat::South), SeatStatus::Removed);
    assert!(ev.contains(&GameEvent::Defeat {
        seat: Seat::South,
        reason: DefeatReason::LeaderCaptured
    }));
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::South }));
    assert_eq!(s.pieces_of(Seat::South).count(), 0, "rook removed too");
    assert_eq!(s.no_progress(), 0);
    check_invariants(&s);
}

#[test]
fn ffa_capturing_pms_sequentially_in_one_game() {
    // South England with 4 PMs scattered; West rook hunts them; North/East shuffle.
    let mut s = build(
        "ffa",
        &[
            "sMa1", "sMa3", "sMa5", "sMa7", "sPh4", "wRb16", "wKp16", "nKi16", "nRe12", "eKp9",
            "eRm12",
        ],
        "W AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1",
    );
    // West's rook goes to a16, then takes a7, a5, a3 and a1 in turn.
    play(&mut s, "b16a16");
    play(&mut s, "e12e11");
    play(&mut s, "m12m11");
    play(&mut s, "h4h5");
    for (i, target) in ["a7", "a5", "a3", "a1"].iter().enumerate() {
        let from = if i == 0 {
            "a16".to_string()
        } else {
            ["a7", "a5", "a3"][i - 1].to_string()
        };
        let ev = play(&mut s, &format!("{from}{target}"));
        let left = 3 - i as u32;
        if left > 0 {
            assert_eq!(s.status(Seat::South), SeatStatus::Active, "after {target}");
            assert_eq!(s.leader_count(Seat::South), left);
            // PMs not yet taken stay leaders.
            assert_eq!(s.leader_squares(Seat::South).count() as u32, left);
            assert!(!ev.iter().any(|e| matches!(e, GameEvent::Defeat { .. })));
            // North, East and South each make a quiet move.
            let n = if i % 2 == 0 { "e11e12" } else { "e12e11" };
            let e = if i % 2 == 0 { "m11m12" } else { "m12m11" };
            play(&mut s, n);
            play(&mut s, e);
            // South pushes its pawn.
            let p = ["h5h6", "h6h7", "h7h8"][i];
            play(&mut s, p);
        } else {
            assert_eq!(s.status(Seat::South), SeatStatus::Removed);
            assert_eq!(
                s.defeats().reason(Seat::South),
                Some(DefeatReason::LeaderCaptured)
            );
        }
        check_invariants(&s);
    }
}

#[test]
fn teams_last_pm_capture_defeats_england_and_partner_plays_on() {
    // South England, one PM left on c3; West queen takes it.
    let mut s = build(
        "teams",
        &["sMc3", "sRh4", "wQc8", "wKa9", "nKi16", "eKp9"],
        "W AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1",
    );
    let ev = play(&mut s, "c8c3");
    assert_eq!(s.status(Seat::South), SeatStatus::Defeated);
    assert!(ev.contains(&GameEvent::Defeat {
        seat: Seat::South,
        reason: DefeatReason::LeaderCaptured
    }));
    assert!(!s.is_over());
    // The rook stays and South keeps taking turns.
    assert_eq!(
        s.piece_at(sq("h4")),
        Some(Piece::new(PieceKind::Rook, Seat::South))
    );
    play(&mut s, "i16i15");
    play(&mut s, "p9p10");
    assert_eq!(s.seat_to_move(), Seat::South);
    play(&mut s, "h4h12");
    check_invariants(&s);
}

#[test]
fn teams_with_three_pms_captured_england_stays_active() {
    let mut s = build(
        "teams",
        &["sMc3", "sMm2", "sRh4", "wQc8", "wKa9", "nKi16", "eKp9"],
        "W AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1",
    );
    play(&mut s, "c8c3");
    assert_eq!(s.status(Seat::South), SeatStatus::Active);
    assert_eq!(s.leader_count(Seat::South), 1);
}

#[test]
fn teams_defeated_england_keeps_playing_with_pms_as_ordinary_pieces() {
    // South (England) was stalemated earlier and is DEFEATED while still
    // holding two PMs; North is ACTIVE.
    let mut s = build(
        "teams",
        &["sMe4", "sMg6", "wRe10", "wKa9", "nKi16", "eKp9"],
        "W DAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1 def=Ss",
    );
    // Not ACTIVE: no warnings for its PMs even if attacked, but the pieces
    // are still listed as leader-kind pieces on the board.
    assert!(is_square_attacked_by(&s, sq("e4"), Seat::West));
    assert!(!leader_under_attack(&s, Seat::South));
    assert!(attacked_leader_squares(&s, Seat::South).is_empty());
    let ev = play(&mut s, "e10e4");
    assert!(
        !ev.iter().any(|e| matches!(e, GameEvent::Defeat { .. })),
        "{ev:?}"
    );
    assert_eq!(s.status(Seat::South), SeatStatus::Defeated);
    play(&mut s, "i16i15");
    play(&mut s, "p9p10");
    assert_eq!(s.seat_to_move(), Seat::South);
    // The remaining PM still moves like knight + king.
    assert_eq!(moves_from(&s, "g6"), pm_targets(6, 5));
    // Capturing the last PM of a DEFEATED seat changes nothing either.
    play(&mut s, "g6g7");
    let ev = play(&mut s, "e4e7");
    assert!(!ev.iter().any(|e| matches!(e, GameEvent::Defeat { .. })));
    assert_eq!(s.status(Seat::South), SeatStatus::Defeated);
    check_invariants(&s);
}

#[test]
fn teams_stalemated_england_with_pms_is_defeated_then_passes() {
    // South's only piece is a PM on a1 boxed in by its partner's pieces.
    let mut s = build(
        "teams",
        &[
            "sMa1", "nRa2", "nRb1", "nBb2", "nNb3", "nNc2", "nKi16", "wKa9", "eKp9",
        ],
        "E AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1",
    );
    let ev = play(&mut s, "p9p10");
    assert!(
        ev.contains(&GameEvent::Defeat {
            seat: Seat::South,
            reason: DefeatReason::Stalemate
        }),
        "{ev:?}"
    );
    assert_eq!(s.status(Seat::South), SeatStatus::Defeated);
    // Its PM stays on the board (ordinary piece now).
    assert_eq!(
        s.piece_at(sq("a1")),
        Some(Piece::new(PieceKind::PrimeMinister, Seat::South))
    );
    assert_eq!(s.leader_count(Seat::South), 1);
    assert!(!s.is_over());
    check_invariants(&s);
}

#[test]
fn ffa_timeout_and_resign_remove_england_with_all_pms() {
    let mut s = GameState::new(england_cfg(GameMode::Ffa, &[Seat::South])).unwrap();
    let ev = apply_timeout(&mut s, Seat::South).unwrap();
    assert!(ev.contains(&GameEvent::ArmyRemoved { seat: Seat::South }));
    assert_eq!(s.piece_count(Seat::South, PieceKind::PrimeMinister), 0);
    assert_eq!(s.seat_to_move(), Seat::West);

    let mut s = GameState::new(england_cfg(GameMode::Ffa, &[Seat::West])).unwrap();
    let ev = apply_resign(&mut s, Seat::West).unwrap();
    assert!(ev.contains(&GameEvent::Defeat {
        seat: Seat::West,
        reason: DefeatReason::Resign
    }));
    assert_eq!(s.status(Seat::West), SeatStatus::Removed);
    assert_eq!(s.pieces_of(Seat::West).count(), 0);
    check_invariants(&s);
}

#[test]
fn teams_timeout_freezes_england_and_its_pms_neither_move_nor_attack() {
    let mut s = GameState::new(england_cfg(GameMode::Teams, &[Seat::South])).unwrap();
    apply_timeout(&mut s, Seat::South).unwrap();
    assert_eq!(s.status(Seat::South), SeatStatus::Frozen);
    assert_eq!(s.piece_count(Seat::South, PieceKind::PrimeMinister), 4);
    // Frozen pieces attack nothing; their leaders get no warning.
    assert!(!is_square_attacked_by(&s, sq("e3"), Seat::South));
    assert!(attacked_leader_squares(&s, Seat::South).is_empty());
    assert_eq!(s.leader_squares(Seat::South).count(), 4);
    check_invariants(&s);
}

#[test]
fn teams_resign_by_england_ends_the_game_for_its_team() {
    let mut s = GameState::new(england_cfg(GameMode::Teams, &[Seat::South])).unwrap();
    apply_resign(&mut s, Seat::South).unwrap();
    assert_eq!(
        s.outcome().unwrap().result,
        GameResult::TeamsWinner {
            team: Team::WestEast
        }
    );
}

// ---------------------------------------------------------------------------
// Castling and promotion
// ---------------------------------------------------------------------------

#[test]
fn england_holds_no_castling_rights_from_any_seat_and_cannot_be_given_them() {
    for seat in Seat::ALL {
        let s = GameState::new(england_cfg(GameMode::Ffa, &[seat])).unwrap();
        assert!(s.castling_rights(seat).is_empty(), "{seat}");
        for other in Seat::ALL.into_iter().filter(|&o| o != seat) {
            assert_eq!(s.castling_rights(other), CastlingRights::BOTH);
        }
        let text = s.to_position_string();
        assert!(!text.contains(&format!(
            "{}{}",
            seat.letter(),
            setup::castle_geometry(seat, setup::CastleSide::Long).rook_home
        )));
    }
    // A position string granting England a right is rejected.
    let text = format!(
        "ffa {} S AAAA Se1,Sl1 - 0 0 civ=england.2,canada.1,canada.1,canada.1",
        board_field(&["sRe1", "sMi1", "sRl1", "wKa9", "nKi16", "eKp9"])
    );
    assert!(parse_position(&text).is_err());
}

#[test]
fn england_v1_still_castles() {
    let s = build(
        "ffa",
        &["sRe1", "sKi1", "sRl1", "wKa9", "nKi16", "eKp9"],
        "S AAAA Se1,Sl1 - 0 0 civ=england.1,canada.1,canada.1,canada.1",
    );
    assert_eq!(
        find_legal_move(&s, mv("i1k1")).map(|m| m.flag),
        Some(MoveFlag::Castle)
    );
}

#[test]
fn england_pawn_promotes_to_q_r_b_n_only_from_every_seat() {
    // Pawn one step from its promotion line, per seat.
    let cases = [
        (Seat::South, "sPe8", "e8", "e9"),
        (Seat::West, "wPh5", "h5", "i5"),
        (Seat::North, "nPe9", "e9", "e8"),
        (Seat::East, "ePi5", "i5", "h5"),
    ];
    let leaders = ["sMa1", "wMa16", "nMp16", "eMp1"];
    for (seat, pawn, from, to) in cases {
        let mut pieces: Vec<&str> = leaders.to_vec();
        pieces.push(pawn);
        let rest = format!(
            "{} AAAA - - 0 0 civ=england.2,england.2,england.2,england.2",
            seat.letter()
        );
        let s = build("ffa", &pieces, &rest);
        let mut promos: Vec<char> = legal_moves(&s)
            .iter()
            .filter(|m| m.from == sq(from) && m.to == sq(to))
            .map(|m| m.promotion.expect("must promote").letter())
            .collect();
        promos.sort();
        assert_eq!(promos, vec!['B', 'N', 'Q', 'R'], "{seat}");
        assert!(!is_legal(&s, &format!("{from}{to}m")), "{seat}: PM");
        assert!(!is_legal(&s, &format!("{from}{to}k")), "{seat}: K");
        assert!(!is_legal(&s, &format!("{from}{to}")), "{seat}: no promo");
        // Promoting to a queen gives a queen, not a leader.
        let mut c = s.clone();
        play(&mut c, &format!("{from}{to}q"));
        assert_eq!(c.piece_count(seat, PieceKind::Queen), 1);
        assert_eq!(c.leader_count(seat), 1);
        check_invariants(&c);
    }
}

#[test]
fn promotion_choices_are_roster_data() {
    let e2 = civ_definition(CivId::England, 2).unwrap();
    let e1 = civ_definition(CivId::England, 1).unwrap();
    assert!(
        !e2.roster
            .promotion_choices()
            .contains(PieceKind::PrimeMinister)
    );
    assert!(!e2.roster.promotion_choices().contains(PieceKind::King));
    assert_eq!(e2.roster.promotion_choices(), e1.roster.promotion_choices());
    // Promotion choices are owned by the roster even though Q/N are not in
    // the starting army.
    assert!(!e2.roster.back_line().contains(&PieceKind::Queen));
    assert!(!e2.roster.back_line().contains(&PieceKind::Knight));
    assert!(e2.roster.contains(PieceKind::Queen));
}

// ---------------------------------------------------------------------------
// Position strings and civ versions
// ---------------------------------------------------------------------------

#[test]
fn position_string_round_trips_with_m_for_every_seat() {
    let s = GameState::new(england_cfg(GameMode::Teams, &Seat::ALL)).unwrap();
    let text = s.to_position_string();
    for l in ['s', 'w', 'n', 'e'] {
        assert!(text.contains(&format!("{l}M")), "{text}");
    }
    assert!(!text.contains('K'), "{text}");
    assert!(text.contains("civ=england.2,england.2,england.2,england.2"));
    let back = parse_position(&text).unwrap();
    assert_eq!(back, s);
    assert_eq!(back.hash(), s.hash());
    // Castling field is '-'.
    assert!(text.contains(" S AAAA - - 0 0 "), "{text}");
}

#[test]
fn rosters_and_versions_are_enforced_by_position_strings() {
    let base = ["wKa9", "nKi16", "eKp9"];
    let with = |south: &str, civ: &str| {
        let mut p = base.to_vec();
        p.push(south);
        format!(
            "ffa {} S AAAA - - 0 0 civ={civ},canada.1,canada.1,canada.1",
            board_field(&p)
        )
    };
    assert!(parse_position(&with("sMi1", "england.2")).is_ok());
    assert!(
        parse_position(&with("sKi1", "england.2")).is_err(),
        "no king in v2"
    );
    assert!(
        parse_position(&with("sMi1", "england.1")).is_err(),
        "no PM in v1"
    );
    assert!(parse_position(&with("sKi1", "england.1")).is_ok());
    assert!(parse_position(&with("sMi1", "canada.1")).is_err());
    assert!(parse_position(&with("sMi1", "england.3")).is_err());
    // An England v2 seat with Q and N (promoted) plus a PM is fine.
    let mut p = base.to_vec();
    p.extend(["sMi1", "sQa3", "sNb3"]);
    let t = format!(
        "ffa {} S AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1",
        board_field(&p)
    );
    assert!(parse_position(&t).is_ok());
}

#[test]
fn england_v1_is_still_the_standard_army() {
    let mut cfg = GameConfig::new(GameMode::Ffa);
    cfg.civs[0] = CivSpec {
        id: CivId::England,
        version: 1,
    };
    let s = GameState::new(cfg).unwrap();
    assert_eq!(legal_moves(&s).len(), 30);
    assert_eq!(
        s.piece_at(sq("i1")),
        Some(Piece::new(PieceKind::King, Seat::South))
    );
    assert_eq!(s.castling_rights(Seat::South), CastlingRights::BOTH);
    assert_eq!(s.leader_count(Seat::South), 1);
    // Same board, same hash as all-Canada (civ id is not hashed? equality of
    // boards at least).
    let std = GameState::new(GameConfig::new(GameMode::Ffa)).unwrap();
    assert_eq!(s.board(), std.board());
    // with_civs picks the latest version.
    let latest = GameConfig::new(GameMode::Ffa).with_civs([CivId::England; 4]);
    assert!(latest.civs.iter().all(|c| c.version == 2));
}

/// A game played under England v1 re-simulates identically from its stored
/// civ versions, and diverges (or fails) under v2.
#[test]
fn resimulation_uses_the_stored_civ_version() {
    let mut cfg = GameConfig::new(GameMode::Ffa);
    cfg.civs[0] = CivSpec {
        id: CivId::England,
        version: 1,
    };
    let mut s = GameState::new(cfg).unwrap();
    let mut log = Vec::new();
    let mut rng = 0x1234_5678_9abc_def0u64;
    for _ in 0..120 {
        if s.is_over() {
            break;
        }
        let moves = legal_moves(&s);
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        let m = moves[(rng % moves.len() as u64) as usize];
        log.push(m);
        apply_move(&mut s, m).unwrap();
    }
    // Replay with the stored version.
    let mut r = GameState::new(cfg).unwrap();
    for &m in &log {
        apply_move(&mut r, m).unwrap();
    }
    assert_eq!(r, s);
    assert_eq!(r.hash(), s.hash());
    // A replay that silently used the latest version would differ.
    let mut v2 = GameState::new(GameConfig::new(GameMode::Ffa).with_civs([
        CivId::England,
        CivId::Canada,
        CivId::Canada,
        CivId::Canada,
    ]))
    .unwrap();
    let mut diverged = false;
    for &m in &log {
        if apply_move(&mut v2, m).is_err() {
            diverged = true;
            break;
        }
    }
    assert!(diverged || v2 != s);
}

// ---------------------------------------------------------------------------
// Check indicator data and perft
// ---------------------------------------------------------------------------

#[test]
fn leader_squares_list_every_pm_and_attacked_ones_are_a_subset() {
    // South: PMs f1, k1, c3 and h12. West rook on c10 attacks c3 down the file
    // (c4..c9 empty); North queen on h16 attacks h12.
    let s = build(
        "ffa",
        &[
            "sMf1", "sMk1", "sMc3", "sMh12", "wRc10", "wKa9", "nQh16", "nKi16", "eKp9",
        ],
        "S AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1",
    );
    let all: Vec<String> = s
        .leader_squares(Seat::South)
        .map(|q| q.to_string())
        .collect();
    assert_eq!(all, ["f1", "k1", "c3", "h12"]);
    let hit: Vec<String> = attacked_leader_squares(&s, Seat::South)
        .iter()
        .map(|q| q.to_string())
        .collect();
    assert_eq!(hit, ["c3", "h12"]);
    assert!(leader_under_attack(&s, Seat::South));
    for seat in [Seat::West, Seat::North, Seat::East] {
        assert_eq!(s.leader_squares(seat).count(), 1);
    }
}

#[test]
fn teams_partner_does_not_count_as_attacker_of_pms() {
    // North (partner) queen aims at South's PM: no warning.
    let s = build(
        "teams",
        &["sMh12", "nQh16", "nKi16", "wKa9", "eKp9"],
        "S AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1",
    );
    assert!(attacked_leader_squares(&s, Seat::South).is_empty());
}

#[test]
fn perft_depth_one_is_34_for_england_in_each_seat() {
    // Hand count for an England seat at the start: 8 pawns x 2 = 16, the two
    // rooks have no moves... except the empty margin squares beside them:
    // South e1 rook: d1 c1 b1 a1 (4), l1 rook: m1 n1 o1 p1 (4) = 8.
    // PMs: f1 -> knight d2, e3, g3 (h2 own pawn) + king steps all blocked
    // except none... f1 king steps: e1 R, g1 B, e2 f2 g2 pawns -> 0.
    // f1 knight: d2, e3, g3 = 3 (h2 own pawn).
    // h1 knight: f2 own, g3, i3, j2 own -> g3, i3 = 2.
    // i1 knight: g2 own, h3, j3, k2 own -> h3, j3 = 2.
    // k1 knight: i2 own, j3, l3, m2 -> j3, l3, m2 = 3.
    // Total PMs 3 + 2 + 2 + 3 = 10. 16 + 8 + 10 = 34.
    for seat in Seat::ALL {
        let mut s = GameState::new(england_cfg(GameMode::Ffa, &[seat])).unwrap();
        // Bring `seat` on move with neutral moves for the earlier seats.
        let pre = ["e2e3", "b5c5", "e15e14"];
        for m in pre.iter().take(seat.index()) {
            play(&mut s, m);
        }
        assert_eq!(s.seat_to_move(), seat);
        assert_eq!(legal_moves(&s).len(), 34, "{seat}");
    }
}

#[test]
fn hash_stays_consistent_through_pm_games_with_one_to_four_englands() {
    for n in 1..=4usize {
        let england: Vec<Seat> = Seat::ALL.into_iter().take(n).collect();
        for mode in [GameMode::Ffa, GameMode::Teams] {
            let mut s = GameState::new(england_cfg(mode, &england)).unwrap();
            let mut rng = 0x9e37_79b9_7f4a_7c15u64 ^ n as u64;
            for _ in 0..400 {
                if s.is_over() {
                    break;
                }
                let moves = legal_moves(&s);
                // Prefer captures to reach leader-capture situations.
                let caps: Vec<Move> = moves
                    .iter()
                    .copied()
                    .filter(|m| s.piece_at(m.to).is_some())
                    .collect();
                rng ^= rng << 13;
                rng ^= rng >> 7;
                rng ^= rng << 17;
                let pool = if !caps.is_empty() && !rng.is_multiple_of(3) {
                    &caps
                } else {
                    &moves
                };
                let m = pool[(rng % pool.len() as u64) as usize];
                let before: [u32; 4] = Seat::ALL.map(|x| s.leader_count(x));
                let was_active = Seat::ALL.map(|x| s.status(x) == SeatStatus::Active);
                apply_move(&mut s, m).unwrap();
                for x in Seat::ALL {
                    // An ACTIVE England is defeated exactly when its last PM goes.
                    if was_active[x.index()]
                        && s.civ(x).roster.starting_leaders() == 4
                        && before[x.index()] > 1
                        && s.leader_count(x) >= 1
                    {
                        assert!(
                            s.status(x) == SeatStatus::Active || s.is_over(),
                            "{x} defeated with PMs left: {s}"
                        );
                    }
                }
                check_invariants(&s);
            }
        }
    }
}
