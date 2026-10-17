//! In-process tests of the HTTP contract: moves at several levels, invalid
//! inputs, load shedding under concurrency and graceful shutdown.

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use bot_engine::{Level, choose_move, time_budget_ms};
use bot_service::api::{ErrorBody, MoveResponse};
use bot_service::pool::{JobOutcome, MoveJob, Rejected};
use bot_service::{AppState, Config, Metrics, WorkerPool, router};
use http_body_util::BodyExt;
use rules_core::{GameConfig, GameMode, GameState, Seat, apply_abandon, legal_moves, parse_move};
use serde_json::{Value, json};
use tower::ServiceExt;

/// Tests in this binary run one at a time: several assert wall-clock
/// deadlines and would otherwise compete for the CPU with the load test.
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Scheduling tolerance for wall-clock assertions: debug builds on a busy
/// machine overshoot a search deadline by more than release builds do.
const SLACK_MS: u64 = if cfg!(debug_assertions) { 120 } else { 30 };

fn start(mode: GameMode) -> GameState {
    GameState::new(GameConfig::new(mode)).unwrap()
}

fn app(workers: usize, max_queue: usize) -> AppState {
    AppState::new(Config {
        max_queue,
        ..Config::with_workers(workers)
    })
}

struct Reply {
    status: StatusCode,
    retry_after: Option<String>,
    body: Vec<u8>,
}

impl Reply {
    fn ok(&self) -> MoveResponse {
        assert_eq!(
            self.status,
            StatusCode::OK,
            "{}",
            String::from_utf8_lossy(&self.body)
        );
        serde_json::from_slice(&self.body).unwrap()
    }

    fn err(&self) -> ErrorBody {
        serde_json::from_slice(&self.body).unwrap()
    }
}

async fn send(r: &Router, method: Method, uri: &str, body: String) -> Reply {
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap();
    let resp = r.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let retry_after = resp
        .headers()
        .get(header::RETRY_AFTER)
        .map(|v| v.to_str().unwrap().to_string());
    let body = resp
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    Reply {
        status,
        retry_after,
        body,
    }
}

async fn post_move(r: &Router, body: Value) -> Reply {
    send(r, Method::POST, "/v1/move", body.to_string()).await
}

fn move_req(state: &GameState, level: &str, clock_ms: u64, seed: Option<u64>) -> Value {
    let mut v = json!({
        "position": state.to_string(),
        "level": level,
        "clockMs": clock_ms,
        "incrementMs": 0,
    });
    if let Some(s) = seed {
        v["seed"] = json!(s);
    }
    v
}

/// The reply's move parses and is legal in `state`.
fn assert_legal(state: &GameState, resp: &MoveResponse) {
    let mv = parse_move(&resp.mv).unwrap();
    assert!(
        legal_moves(state).iter().any(|m| m.same_choice(&mv)),
        "illegal move {}",
        resp.mv
    );
    assert_eq!(resp.pv.first(), Some(&resp.mv));
    let mut s = state.clone();
    rules_core::apply_move(&mut s, mv).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn start_position_moves_at_several_levels() {
    let _serial = SERIAL.lock().await;
    let app = app(4, 16);
    let r = router(app.clone());
    for mode in [GameMode::Ffa, GameMode::Teams] {
        let state = start(mode);
        for (label, level) in [
            ("600", Level::L600),
            ("1200", Level::L1200),
            ("1800", Level::L1800),
            ("2400", Level::L2400),
            ("max", Level::Max),
        ] {
            // 6 s on the clock: strong levels get 200 ms.
            let clock = 6_000;
            let budget = time_budget_ms(level, clock, 0);
            let t = Instant::now();
            let resp = post_move(&r, move_req(&state, label, clock, Some(7)))
                .await
                .ok();
            let elapsed = t.elapsed().as_millis() as u64;
            assert_legal(&state, &resp);
            assert_eq!(resp.budget_ms, budget);
            assert_eq!(resp.deadline_ms, 200);
            assert!(resp.nodes > 0);
            assert!(!resp.degraded);
            assert!(resp.search_ms <= budget + SLACK_MS, "{label}: {resp:?}");
            assert!(
                resp.time_ms <= resp.deadline_ms + SLACK_MS,
                "{label}: {resp:?}"
            );
            assert!(
                elapsed <= resp.deadline_ms + 2 * SLACK_MS,
                "{label}: {elapsed} ms"
            );
        }
    }
    assert_eq!(
        app.metrics().ok.load(std::sync::atomic::Ordering::Relaxed),
        10
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn level_number_and_defaults_are_accepted() {
    let _serial = SERIAL.lock().await;
    let r = router(app(2, 4));
    let state = start(GameMode::Ffa);
    // Numeric level, no increment, no seed.
    let body = json!({ "position": state.to_string(), "level": 900, "clockMs": 60_000 });
    let resp = post_move(&r, body).await.ok();
    assert_legal(&state, &resp);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_seed_makes_weak_levels_reproducible() {
    let _serial = SERIAL.lock().await;
    let r = router(app(2, 4));
    let state = start(GameMode::Ffa);
    // Untimed clock (`null`, or u64::MAX from Rust clients): the level's
    // node budget binds, so the move is a pure function of the request, and
    // equals the library's choice. (The search must finish within half the
    // 500 ms response deadline, which small budgets do even in debug builds
    // on a loaded machine.)
    for (level, label) in [(Level::L600, "600"), (Level::L900, "900")] {
        for seed in [1u64, 2, 3] {
            let mut untimed = move_req(&state, label, 0, Some(seed));
            untimed["clockMs"] = Value::Null;
            let a = post_move(&r, untimed).await.ok();
            let b = post_move(&r, move_req(&state, label, u64::MAX, Some(seed)))
                .await
                .ok();
            assert_eq!(a.deadline_ms, 500);
            assert_eq!(a.mv, b.mv);
            assert_eq!(a.nodes, b.nodes);
            let lib = choose_move(&state, level, u64::MAX, 0, seed);
            assert_eq!(a.mv, lib.best_move.unwrap().to_string());
            assert_eq!(a.nodes, lib.nodes);
        }
    }
    // 2400 keeps its (16 MB) table warm between timed requests, but an
    // untimed request starts from a cleared one, so it is reproducible too.
    // Its 100k-node budget needs a release build to fit the deadline.
    if cfg!(debug_assertions) {
        return;
    }
    let mid = {
        let mut s = start(GameMode::Ffa);
        for i in 0..8 {
            let m = choose_move(&s, Level::L900, u64::MAX, 0, i)
                .best_move
                .unwrap();
            rules_core::apply_move(&mut s, m).unwrap();
        }
        s
    };
    let lib = choose_move(&mid, Level::L2400, u64::MAX, 0, 7);
    // On the 16×16 board 2400's 100k nodes take ~300 ms, close to the 500 ms
    // response deadline (no new iteration after half of it), so on a busy
    // machine a search can be cut short by time. Such a reply is not a
    // reproducibility failure; every reply that reached the node budget must
    // match the library, and at least two of them must.
    let mut matched = 0;
    for _ in 0..6 {
        // A timed 2400 search in between warms the table.
        post_move(&r, move_req(&mid, "2400", 60_000, Some(9)))
            .await
            .ok();
        let mut untimed = move_req(&mid, "2400", 0, Some(7));
        untimed["clockMs"] = Value::Null;
        let a = post_move(&r, untimed).await.ok();
        if a.nodes < lib.nodes {
            continue;
        }
        assert_eq!(a.mv, lib.best_move.unwrap().to_string());
        assert_eq!(a.nodes, lib.nodes);
        matched += 1;
        if matched == 3 {
            break;
        }
    }
    assert!(
        matched >= 2,
        "only {matched} untimed 2400 searches reached their budget"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invalid_inputs_are_rejected() {
    let _serial = SERIAL.lock().await;
    let r = router(app(2, 4));
    let state = start(GameMode::Ffa);
    let pos = state.to_string();
    let cases: Vec<(String, &str)> = vec![
        ("not json".into(), "invalid_request"),
        ("{}".into(), "invalid_request"),
        (
            json!({ "position": pos, "level": "1500" }).to_string(),
            "invalid_request",
        ),
        (
            json!({ "position": pos, "level": "1500", "clockMs": -5 }).to_string(),
            "invalid_request",
        ),
        (
            json!({ "position": pos, "level": "1500", "clockMs": "fast" }).to_string(),
            "invalid_request",
        ),
        (
            json!({ "position": pos, "level": "1000", "clockMs": 1000 }).to_string(),
            "invalid_level",
        ),
        (
            json!({ "position": pos, "level": "grandmaster", "clockMs": 1000 }).to_string(),
            "invalid_level",
        ),
        (
            json!({ "position": pos, "level": 3000, "clockMs": 1000 }).to_string(),
            "invalid_level",
        ),
        (
            json!({ "position": "garbage", "level": "600", "clockMs": 1000 }).to_string(),
            "invalid_position",
        ),
        (
            json!({ "position": pos.replace(" S ", " X "), "level": "600", "clockMs": 1000 })
                .to_string(),
            "invalid_position",
        ),
    ];
    for (body, code) in cases {
        let rep = send(&r, Method::POST, "/v1/move", body.clone()).await;
        assert_eq!(rep.status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(rep.err().error, code, "{body}");
    }
    // Unknown (e.g. misspelt) fields are errors, not silently ignored.
    let rep = send(
        &r,
        Method::POST,
        "/v1/move",
        json!({ "position": pos, "level": "600", "clockMs": 1000, "increment": 2000 }).to_string(),
    )
    .await;
    assert_eq!(rep.status, StatusCode::BAD_REQUEST);
    assert_eq!(rep.err().error, "invalid_request");
    for bad_clock in [json!(-1), json!("1000")] {
        let body = json!({ "position": pos, "level": "600", "clockMs": bad_clock }).to_string();
        let rep = send(&r, Method::POST, "/v1/move", body.clone()).await;
        assert_eq!(rep.status, StatusCode::BAD_REQUEST, "{body}");
    }
    // Oversized body.
    let big = "x".repeat(bot_service::MAX_BODY_BYTES + 1);
    let rep = send(&r, Method::POST, "/v1/move", big).await;
    assert_eq!(rep.status, StatusCode::PAYLOAD_TOO_LARGE);
    // Wrong method / unknown route.
    let rep = send(&r, Method::GET, "/v1/move", String::new()).await;
    assert_eq!(rep.status, StatusCode::METHOD_NOT_ALLOWED);
    let rep = send(&r, Method::GET, "/nope", String::new()).await;
    assert_eq!(rep.status, StatusCode::NOT_FOUND);
}

/// What JavaScript callers easily send: fractional clocks (from
/// `performance.now()`) and `incrementMs: null`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn javascript_style_numbers_are_accepted() {
    let _serial = SERIAL.lock().await;
    let r = router(app(2, 4));
    let state = start(GameMode::Ffa);
    let rep = post_move(
        &r,
        json!({
            "position": state.to_string(), "level": "600",
            "clockMs": 300000.75, "incrementMs": null, "seed": 1
        }),
    )
    .await;
    let resp = rep.ok();
    assert_legal(&state, &resp);
    assert_eq!(resp.budget_ms, time_budget_ms(Level::L600, 300_000, 0));
    let rep = post_move(
        &r,
        json!({
            "position": state.to_string(), "level": "600",
            "clockMs": 60000.0, "incrementMs": 1500.9
        }),
    )
    .await;
    assert_eq!(
        rep.ok().budget_ms,
        time_budget_ms(Level::L600, 60_000, 1_500)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn finished_game_is_a_conflict() {
    let _serial = SERIAL.lock().await;
    let app = app(2, 4);
    let r = router(app.clone());
    let mut state = start(GameMode::Ffa);
    for seat in [Seat::West, Seat::North, Seat::East] {
        apply_abandon(&mut state, seat).unwrap();
    }
    assert!(state.is_over());
    let rep = post_move(&r, move_req(&state, "1500", 60_000, None)).await;
    assert_eq!(rep.status, StatusCode::CONFLICT);
    assert_eq!(rep.err().error, "game_over");
    assert_eq!(
        app.metrics()
            .conflict
            .load(std::sync::atomic::Ordering::Relaxed),
        1
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn healthz_and_metrics() {
    let _serial = SERIAL.lock().await;
    let r = router(app(3, 5));
    let rep = send(&r, Method::GET, "/healthz", String::new()).await;
    assert_eq!(rep.status, StatusCode::OK);
    assert_eq!(rep.body, b"ok\n");
    let state = start(GameMode::Teams);
    post_move(&r, move_req(&state, "600", 60_000, Some(1)))
        .await
        .ok();
    let rep = post_move(&r, json!({"position": "x"})).await;
    assert_eq!(rep.status, StatusCode::BAD_REQUEST);
    // Rejected before any handler runs: still counted by status.
    let rep = send(&r, Method::PUT, "/v1/move", String::new()).await;
    assert_eq!(rep.status, StatusCode::METHOD_NOT_ALLOWED);
    let rep = send(&r, Method::GET, "/metrics", String::new()).await;
    assert_eq!(rep.status, StatusCode::OK);
    let text = String::from_utf8(rep.body).unwrap();
    for line in [
        "bot_requests_total 2\n",
        "bot_ok_total 1\n",
        "bot_bad_request_total 1\n",
        "bot_shed_total 0\n",
        "bot_in_flight 0\n",
        "bot_queue_depth 0\n",
        "bot_workers 3\n",
        "bot_latency_ms{quantile=\"0.5\"} ",
        "bot_latency_ms{quantile=\"0.95\"} ",
        "bot_http_responses_total{code=\"200\"} 2\n",
        "bot_http_responses_total{code=\"400\"} 1\n",
        "bot_http_responses_total{code=\"405\"} 1\n",
    ] {
        assert!(text.contains(line), "missing {line:?} in\n{text}");
    }
}

/// Many simultaneous strong-level requests on a tiny pool: every request is
/// either answered within its deadline or shed with 503 + Retry-After, and
/// nothing hangs.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_requests_are_answered_in_time_or_shed() {
    let _serial = SERIAL.lock().await;
    const N: usize = 48;
    let (workers, max_queue) = (2, 6);
    let app = app(workers, max_queue);
    let r = router(app.clone());
    let states = [start(GameMode::Ffa), start(GameMode::Teams)];
    // 6 s on the clock: 2400 gets min(400, 6000/30, 6000/10) = 200 ms.
    let clock = 6_000;
    let budget = time_budget_ms(Level::L2400, clock, 0);
    assert_eq!(budget, 200);
    let mut tasks = Vec::new();
    for i in 0..N {
        let r = r.clone();
        let state = states[i % 2].clone();
        let level = ["2400", "1800", "max"][i % 3];
        tasks.push(tokio::spawn(async move {
            let t = Instant::now();
            let rep = post_move(&r, move_req(&state, level, clock, Some(i as u64))).await;
            (state, rep, t.elapsed())
        }));
    }
    let all = tokio::time::timeout(Duration::from_secs(20), async {
        let mut out = Vec::new();
        for t in tasks {
            out.push(t.await.unwrap());
        }
        out
    })
    .await
    .expect("requests hung");
    let (mut ok, mut shed, mut degraded) = (0, 0, 0);
    for (state, rep, elapsed) in &all {
        match rep.status {
            StatusCode::OK => {
                let resp = rep.ok();
                assert_legal(state, &resp);
                // Answered within the clock-derived deadline (plus a little
                // for scheduling in a loaded test process).
                assert_eq!(resp.deadline_ms, budget);
                assert!(resp.time_ms <= resp.deadline_ms + SLACK_MS, "{resp:?}");
                assert!(elapsed.as_millis() as u64 <= resp.deadline_ms + 2 * SLACK_MS);
                ok += 1;
                degraded += usize::from(resp.degraded);
            }
            StatusCode::SERVICE_UNAVAILABLE => {
                assert_eq!(rep.retry_after.as_deref(), Some("1"));
                let code = rep.err().error;
                assert!(
                    code == "overloaded" || code == "deadline_exceeded",
                    "{code}"
                );
                assert!(elapsed.as_millis() as u64 <= budget + 2 * SLACK_MS);
                shed += 1;
            }
            s => panic!(
                "unexpected status {s}: {}",
                String::from_utf8_lossy(&rep.body)
            ),
        }
    }
    assert_eq!(ok + shed, N);
    // The pool keeps working at capacity and sheds the excess.
    assert!(ok >= workers, "ok {ok}");
    assert!(shed > 0, "nothing shed");
    let m = app.metrics();
    // Waiting jobs either get load-reduced searches or, when every worker
    // is busy past their deadline, are refused at once.
    assert!(
        degraded > 0 || m.shed_deadline.load(std::sync::atomic::Ordering::Relaxed) > 0,
        "neither load-reduced searches nor early deadline shedding"
    );
    assert_eq!(m.shed() as usize, shed);
    assert_eq!(m.ok.load(std::sync::atomic::Ordering::Relaxed) as usize, ok);
    assert_eq!(m.in_flight.load(std::sync::atomic::Ordering::Relaxed), 0);
    assert_eq!(app.pool().queue_depth(), 0);
    // Afterwards the service answers normally again.
    let state = start(GameMode::Ffa);
    let resp = post_move(&r, move_req(&state, "1500", 60_000, Some(1)))
        .await
        .ok();
    assert!(!resp.degraded);
}

fn job(state: &GameState, level: Level, received: Instant, budget_ms: u64) -> MoveJob {
    MoveJob {
        state: state.clone(),
        level,
        clock_ms: 60_000,
        increment_ms: 0,
        seed: 1,
        received,
        budget_ms,
        deadline_ms: budget_ms,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pool_expires_late_jobs_and_refuses_when_full() {
    let _serial = SERIAL.lock().await;
    let pool = WorkerPool::new(1, 1, Arc::new(Metrics::new()));
    let state = start(GameMode::Ffa);
    // A job whose deadline passed before any worker saw it.
    let old = Instant::now() - Duration::from_secs(1);
    let t = pool.submit(job(&state, Level::L1500, old, 10)).unwrap();
    assert!(matches!(t.rx.await.unwrap(), JobOutcome::Expired { .. }));
    // The worker counts as busy until it has tidied up after replying.
    while pool.busy() > 0 {
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    // One long job occupies the worker, one may wait, the next is refused.
    let now = Instant::now();
    let a = pool.submit(job(&state, Level::Max, now, 300)).unwrap();
    let b = pool.submit(job(&state, Level::L600, now, 2_000)).unwrap();
    assert_eq!(
        pool.submit(job(&state, Level::L600, now, 2_000))
            .unwrap_err(),
        Rejected::QueueFull
    );
    for t in [a, b] {
        match t.rx.await.unwrap() {
            JobOutcome::Done(d) => assert!(d.result.best_move.is_some()),
            o => panic!("{o:?}"),
        }
    }
    pool.shutdown();
    assert_eq!(
        pool.submit(job(&state, Level::L600, Instant::now(), 100))
            .unwrap_err(),
        Rejected::ShuttingDown
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn queued_jobs_can_be_withdrawn() {
    let _serial = SERIAL.lock().await;
    let pool = WorkerPool::new(1, 4, Arc::new(Metrics::new()));
    let state = start(GameMode::Teams);
    let now = Instant::now();
    let running = pool.submit(job(&state, Level::Max, now, 300)).unwrap();
    while pool.busy() == 0 {
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    let queued = pool.submit(job(&state, Level::L600, now, 2_000)).unwrap();
    assert_eq!(pool.queue_depth(), 1);
    assert!(pool.withdraw(queued.id));
    assert!(!pool.withdraw(queued.id));
    assert_eq!(pool.queue_depth(), 0);
    // A withdrawn job is never answered; a running one cannot be withdrawn.
    assert!(queued.rx.await.is_err());
    assert!(!pool.withdraw(running.id));
    assert!(matches!(running.rx.await.unwrap(), JobOutcome::Done(_)));
}

/// A request that cannot get a worker before its deadline is shed with 503
/// at the deadline, not when the worker frees up.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn queued_request_is_shed_at_its_deadline() {
    let _serial = SERIAL.lock().await;
    let app = app(1, 4);
    let r = router(app.clone());
    let state = start(GameMode::Ffa);
    // Occupies the only worker for up to 500 ms (15 s clock).
    let long = {
        let r = r.clone();
        let body = move_req(&state, "max", 15_000, Some(1));
        tokio::spawn(async move { post_move(&r, body).await })
    };
    while app.pool().busy() == 0 {
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    // 600 ms on the clock: a 20 ms deadline.
    let t = Instant::now();
    let rep = post_move(&r, move_req(&state, "600", 600, Some(2))).await;
    let elapsed = t.elapsed().as_millis() as u64;
    assert_eq!(rep.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(rep.retry_after.as_deref(), Some("1"));
    assert_eq!(rep.err().error, "deadline_exceeded");
    assert!(elapsed <= 20 + SLACK_MS, "{elapsed} ms");
    assert_eq!(app.pool().queue_depth(), 0);
    let resp = long.await.unwrap().ok();
    assert_legal(&state, &resp);
    assert_eq!(
        app.metrics()
            .shed_deadline
            .load(std::sync::atomic::Ordering::Relaxed),
        1
    );
}

/// A real TCP server: a request in progress when shutdown starts is still
/// answered, and `serve` returns.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn graceful_shutdown_finishes_open_requests() {
    let _serial = SERIAL.lock().await;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(bot_service::serve(listener, app(2, 4), async move {
        let _ = stop_rx.await;
    }));
    let state = start(GameMode::Ffa);
    let body = move_req(&state, "max", 6_000, Some(3)).to_string();
    let mut sock = tokio::net::TcpStream::connect(addr).await.unwrap();
    let req = format!(
        "POST /v1/move HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    sock.write_all(req.as_bytes()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    stop_tx.send(()).unwrap();
    let mut out = String::new();
    tokio::time::timeout(Duration::from_secs(5), sock.read_to_string(&mut out))
        .await
        .expect("response hung")
        .unwrap();
    assert!(out.starts_with("HTTP/1.1 200"), "{out}");
    let json_start = out.find("\r\n\r\n").unwrap() + 4;
    let resp: MoveResponse = serde_json::from_str(&out[json_start..]).unwrap();
    assert_legal(&state, &resp);
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .expect("server did not stop")
        .unwrap()
        .unwrap();
}

/// A request arriving while every worker is busy until after its deadline
/// is refused at once, not left to wait and then answered with an
/// unsearched move.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unreachable_deadline_is_refused_at_submission() {
    let _serial = SERIAL.lock().await;
    let pool = WorkerPool::new(1, 8, Arc::new(Metrics::new()));
    let state = start(GameMode::Ffa);
    let now = Instant::now();
    let running = pool.submit(job(&state, Level::Max, now, 400)).unwrap();
    // Wait until the worker has started (and published when it ends).
    while pool.busy() == 0 {
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    tokio::time::sleep(Duration::from_millis(5)).await;
    // Same deadline as the running search: no time left to search.
    assert_eq!(
        pool.submit(job(&state, Level::L2400, now, 400))
            .unwrap_err(),
        Rejected::DeadlineUnreachable
    );
    // A later deadline is fine.
    let later = pool
        .submit(job(&state, Level::L600, Instant::now(), 2_000))
        .unwrap();
    for t in [running, later] {
        match t.rx.await.unwrap() {
            JobOutcome::Done(d) => {
                assert!(d.result.best_move.is_some());
                assert!(d.result.depth > 0, "unsearched move");
            }
            o => panic!("{o:?}"),
        }
    }
}

/// Jobs whose client went away do not hold queue slots.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn abandoned_jobs_free_their_queue_slots() {
    let _serial = SERIAL.lock().await;
    let metrics = Arc::new(Metrics::new());
    let pool = WorkerPool::new(1, 2, Arc::clone(&metrics));
    let state = start(GameMode::Teams);
    let now = Instant::now();
    let running = pool.submit(job(&state, Level::Max, now, 300)).unwrap();
    while pool.busy() == 0 {
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    for _ in 0..2 {
        // Submitted, then the client disconnects (receiver dropped).
        drop(pool.submit(job(&state, Level::L600, now, 2_000)).unwrap());
    }
    let live = pool
        .submit(job(&state, Level::L600, Instant::now(), 2_000))
        .expect("abandoned jobs must not fill the queue");
    assert_eq!(pool.queue_depth(), 1);
    assert_eq!(
        metrics.cancelled.load(std::sync::atomic::Ordering::Relaxed),
        2
    );
    assert!(matches!(running.rx.await.unwrap(), JobOutcome::Done(_)));
    assert!(matches!(live.rx.await.unwrap(), JobOutcome::Done(_)));
}

/// A client that never finishes its request neither hangs shutdown nor gets
/// a response: the drain is bounded.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stalled_client_does_not_block_shutdown() {
    let _serial = SERIAL.lock().await;
    use tokio::io::AsyncWriteExt;

    let listener = bot_service::bind("127.0.0.1:0".parse().unwrap()).unwrap();
    let addr = listener.local_addr().unwrap();
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(bot_service::serve(listener, app(1, 2), async move {
        let _ = stop_rx.await;
    }));
    // Partial headers, then silence.
    let mut stalled = tokio::net::TcpStream::connect(addr).await.unwrap();
    stalled
        .write_all(b"POST /v1/move HTTP/1.1\r\nHost: test\r\nContent-Le")
        .await
        .unwrap();
    // Complete headers but a short body.
    let mut short = tokio::net::TcpStream::connect(addr).await.unwrap();
    short
        .write_all(b"POST /v1/move HTTP/1.1\r\nHost: test\r\nContent-Length: 100\r\n\r\n{")
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let t = Instant::now();
    stop_tx.send(()).unwrap();
    tokio::time::timeout(bot_service::DRAIN_TIMEOUT + Duration::from_secs(2), server)
        .await
        .expect("shutdown hung on a stalled client")
        .unwrap()
        .unwrap();
    assert!(t.elapsed() <= bot_service::DRAIN_TIMEOUT + Duration::from_millis(500));
    drop((stalled, short));
}
