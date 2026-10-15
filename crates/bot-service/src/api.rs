//! HTTP handlers and wire types. See the crate README for the contract.

use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::Json;
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use bot_engine::{Level, time_budget_ms};
use rules_core::parse_position;
use serde::{Deserialize, Serialize};

use crate::pool::{JobOutcome, MoveJob, Rejected, WorkerPool, response_deadline_ms};
use crate::{AppState, MAX_BODY_BYTES};

/// `Retry-After` value (seconds) sent with every 503.
pub const RETRY_AFTER_SECS: u64 = 1;

/// Extra time the handler waits past a job's deadline for a worker that has
/// already started it (it never should need it: searches stop before the
/// deadline).
const HANDLER_GRACE: Duration = Duration::from_secs(1);

/// How long a client may take to send the request body once the headers
/// are in (header reads are bounded by the server, see [`crate::serve`]).
pub const BODY_READ_TIMEOUT: Duration = Duration::from_secs(5);

/// `POST /v1/move` request body. Unknown fields are rejected (a misspelt
/// `incrementMs` must not silently become 0).
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveRequest {
    /// rules-core position string.
    pub position: String,
    /// `"600"`, `"900"`, ..., `"2400"` or `"max"` (a JSON number is also
    /// accepted for the numeric levels).
    pub level: LevelField,
    /// The bot's remaining clock in ms; `null` = untimed (required, so a
    /// forgotten clock is an error rather than an untimed search). A
    /// non-negative JSON number; fractions are rounded down.
    #[serde(deserialize_with = "millis_or_null")]
    pub clock_ms: Option<u64>,
    /// Increment per move in ms (default 0; `null` also means 0).
    #[serde(default, deserialize_with = "millis_or_null")]
    pub increment_ms: Option<u64>,
    /// Seed for evaluation noise and blunder selection (default: random).
    #[serde(default)]
    pub seed: Option<u64>,
}

/// A duration in ms: a non-negative JSON number (fractions rounded down, as
/// clocks derived from `performance.now()` often have them) or `null`.
/// Integers are taken exactly (so `u64::MAX`, bot-engine's "untimed", from
/// Rust clients keeps its meaning).
fn millis_or_null<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Millis {
        Int(u64),
        Float(f64),
    }
    match Option::<Millis>::deserialize(d)? {
        None => Ok(None),
        Some(Millis::Int(n)) => Ok(Some(n)),
        Some(Millis::Float(v)) if v.is_finite() && v >= 0.0 => {
            // `as` saturates; a fractional clock is finite, never "untimed".
            Ok(Some((v.floor() as u64).min(u64::MAX - 1)))
        }
        Some(Millis::Float(v)) => Err(serde::de::Error::custom(format!(
            "expected a non-negative number of milliseconds, got {v}"
        ))),
    }
}

/// A level given as a string or a number.
#[derive(Deserialize, Debug)]
#[serde(untagged)]
pub enum LevelField {
    /// `"1500"`, `"max"`.
    Text(String),
    /// `1500`.
    Number(u64),
}

impl std::fmt::Display for LevelField {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LevelField::Text(s) => write!(f, "{s:?}"),
            LevelField::Number(n) => write!(f, "{n}"),
        }
    }
}

impl LevelField {
    fn level(&self) -> Option<Level> {
        match self {
            LevelField::Text(s) => Level::from_label(s.trim()),
            LevelField::Number(n) => Level::from_label(&n.to_string()),
        }
    }
}

/// `POST /v1/move` success body.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoveResponse {
    /// The move in rules-core notation (`g1h3`, `c6c7q`).
    #[serde(rename = "move")]
    pub mv: String,
    /// Centipawns from the bot seat's view (FFA) or its team's (Teams);
    /// `|score| >= 990000` (`bot_engine::MATE_BOUND`) is a forced leader
    /// capture / elimination. Always within `±1000000`.
    pub score: i32,
    /// Deepest completed search iteration: 0 for a forced move (one legal
    /// move), or when the first iteration was cut short (rare; the move is
    /// still the best searched one, never an unsearched pick).
    pub depth: u32,
    /// Nodes searched.
    pub nodes: u64,
    /// Total time inside the service, from receipt to reply (ms).
    pub time_ms: u64,
    /// Time spent waiting for a worker (ms).
    pub queue_ms: u64,
    /// Time the engine searched (ms).
    pub search_ms: u64,
    /// The thinking budget derived from the level and clock (ms).
    pub budget_ms: u64,
    /// The response deadline derived from the clock (ms after receipt):
    /// the reply is due within this time.
    pub deadline_ms: u64,
    /// Whether the search got clearly less time or nodes than an unloaded
    /// search would have (load scaling, or a late start after queueing).
    pub degraded: bool,
    /// Principal variation in notation (starts with `move`).
    pub pv: Vec<String>,
}

/// Error body for every non-200 reply.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ErrorBody {
    /// Machine-readable code.
    pub error: String,
    /// Human-readable detail.
    pub message: String,
}

/// An error reply.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> ApiError {
        ApiError {
            status,
            code,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ErrorBody {
            error: self.code.to_string(),
            message: self.message,
        };
        let mut resp = (self.status, Json(body)).into_response();
        if self.status == StatusCode::SERVICE_UNAVAILABLE {
            resp.headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from(RETRY_AFTER_SECS));
        }
        resp
    }
}

/// Decrements the in-flight gauge when the request ends (also on cancel).
struct InFlight<'a>(&'a AtomicU64);

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Relaxed);
    }
}

/// A seed for requests that do not give one.
fn random_seed() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64);
    let mut z = t ^ COUNTER
        .fetch_add(1, Relaxed)
        .wrapping_mul(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Withdraws a queued job if the request ends before its outcome arrives
/// (client disconnected or timed out: the handler future is dropped), so
/// an abandoned job never holds a queue slot.
struct WithdrawOnDrop<'a> {
    pool: &'a WorkerPool,
    id: Option<u64>,
    metrics: &'a crate::Metrics,
}

impl Drop for WithdrawOnDrop<'_> {
    fn drop(&mut self) {
        if let Some(id) = self.id
            && self.pool.withdraw(id)
        {
            self.metrics.cancelled.fetch_add(1, Relaxed);
        }
    }
}

/// Whether a body read failed because the body exceeded the size limit.
fn is_length_limit(e: &axum::Error) -> bool {
    let mut cur: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(err) = cur {
        if err.is::<http_body_util::LengthLimitError>() {
            return true;
        }
        cur = err.source();
    }
    false
}

/// `POST /v1/move`.
pub async fn post_move(State(app): State<AppState>, body: Body) -> Response {
    let received = Instant::now();
    let m = app.metrics();
    m.requests.fetch_add(1, Relaxed);
    m.in_flight.fetch_add(1, Relaxed);
    let _guard = InFlight(&m.in_flight);
    let body = match tokio::time::timeout(
        BODY_READ_TIMEOUT,
        axum::body::to_bytes(body, MAX_BODY_BYTES),
    )
    .await
    {
        Ok(Ok(b)) => b,
        Ok(Err(e)) => {
            m.bad_request.fetch_add(1, Relaxed);
            let too_big = is_length_limit(&e);
            return if too_big {
                ApiError::new(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "body_too_large",
                    format!("the request body exceeds {MAX_BODY_BYTES} bytes"),
                )
            } else {
                ApiError::new(StatusCode::BAD_REQUEST, "invalid_request", e.to_string())
            }
            .into_response();
        }
        Err(_) => {
            m.bad_request.fetch_add(1, Relaxed);
            return ApiError::new(
                StatusCode::REQUEST_TIMEOUT,
                "body_timeout",
                format!(
                    "the request body did not arrive within {} s",
                    BODY_READ_TIMEOUT.as_secs()
                ),
            )
            .into_response();
        }
    };
    match handle_move(&app, received, &body).await {
        Ok(resp) => {
            m.ok.fetch_add(1, Relaxed);
            m.nodes.fetch_add(resp.nodes, Relaxed);
            if resp.degraded {
                m.degraded.fetch_add(1, Relaxed);
            }
            m.record_latency_ms(resp.time_ms);
            Json(resp).into_response()
        }
        Err(e) => {
            let counter = match e.status {
                StatusCode::BAD_REQUEST => &m.bad_request,
                StatusCode::CONFLICT => &m.conflict,
                StatusCode::SERVICE_UNAVAILABLE if e.code == "overloaded" => &m.shed_queue_full,
                StatusCode::SERVICE_UNAVAILABLE if e.code == "deadline_exceeded" => {
                    &m.shed_deadline
                }
                StatusCode::SERVICE_UNAVAILABLE => &m.shed_queue_full,
                _ => &m.internal_errors,
            };
            counter.fetch_add(1, Relaxed);
            if e.status.is_server_error() {
                tracing::warn!(status = e.status.as_u16(), code = e.code, msg = %e.message, "move not served");
            } else {
                tracing::debug!(status = e.status.as_u16(), code = e.code, msg = %e.message, "move rejected");
            }
            e.into_response()
        }
    }
}

async fn handle_move(
    app: &AppState,
    received: Instant,
    body: &[u8],
) -> Result<MoveResponse, ApiError> {
    let bad = |code, msg: String| ApiError::new(StatusCode::BAD_REQUEST, code, msg);
    let req: MoveRequest =
        serde_json::from_slice(body).map_err(|e| bad("invalid_request", e.to_string()))?;
    let level = req.level.level().ok_or_else(|| {
        bad(
            "invalid_level",
            format!(
                "unknown level {}; expected 600, 900, 1200, 1500, 1800, 2100, 2400 or max",
                req.level
            ),
        )
    })?;
    let state =
        parse_position(&req.position).map_err(|e| bad("invalid_position", e.to_string()))?;
    if state.is_over() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "game_over",
            "the game is over; there is no move to make",
        ));
    }
    // `u64::MAX` is bot-engine's "untimed".
    let clock_ms = req.clock_ms.unwrap_or(u64::MAX);
    let increment_ms = req.increment_ms.unwrap_or(0);
    let budget_ms = time_budget_ms(level, clock_ms, increment_ms);
    let deadline_ms = response_deadline_ms(clock_ms, increment_ms, budget_ms);
    let seed = req.seed.unwrap_or_else(random_seed);
    let job = MoveJob {
        state,
        level,
        clock_ms,
        increment_ms,
        seed,
        received,
        budget_ms,
        deadline_ms,
    };
    let deadline = job.deadline();
    let ticket = app.pool().submit(job).map_err(|r| match r {
        Rejected::QueueFull => ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "overloaded",
            "all workers busy and the queue is full; play a fallback move",
        ),
        Rejected::DeadlineUnreachable => ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "deadline_exceeded",
            format!(
                "every worker is busy past the {deadline_ms} ms deadline; play a fallback move"
            ),
        ),
        Rejected::ShuttingDown => ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "shutting_down",
            "the service is shutting down; play a fallback move",
        ),
    })?;
    let missed = || {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "deadline_exceeded",
            format!(
                "no worker was free within the {deadline_ms} ms deadline; play a fallback move"
            ),
        )
    };
    let mut withdraw = WithdrawOnDrop {
        pool: app.pool(),
        id: Some(ticket.id),
        metrics: app.metrics(),
    };
    let mut rx = ticket.rx;
    let until_deadline = deadline.saturating_duration_since(Instant::now());
    let received_outcome = match tokio::time::timeout(until_deadline, &mut rx).await {
        Ok(r) => r,
        Err(_) => {
            // Still queued at the deadline: give up on it now. Otherwise a
            // worker is finishing it (its search stops before the deadline).
            withdraw.id = None;
            if app.pool().withdraw(ticket.id) {
                return Err(missed());
            }
            match tokio::time::timeout(HANDLER_GRACE, rx).await {
                Ok(r) => r,
                Err(_) => return Err(missed()),
            }
        }
    };
    withdraw.id = None;
    let outcome = received_outcome.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "worker dropped the job",
        )
    })?;
    let done = match outcome {
        JobOutcome::Done(d) => d,
        JobOutcome::Expired { queue_ms } => {
            return Err(ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "deadline_exceeded",
                format!(
                    "waited {queue_ms} ms for a worker, too close to the {deadline_ms} ms deadline to search; play a fallback move"
                ),
            ));
        }
        JobOutcome::Failed => {
            return Err(ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                "search failed",
            ));
        }
    };
    let r = done.result;
    let mv = r
        .best_move
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "no_legal_move", "no legal move"))?;
    let resp = MoveResponse {
        mv: mv.to_string(),
        score: r.score,
        depth: r.depth,
        nodes: r.nodes,
        time_ms: received.elapsed().as_millis() as u64,
        queue_ms: done.queue_ms,
        search_ms: r.time_ms,
        budget_ms,
        deadline_ms,
        degraded: done.degraded,
        pv: r.pv.iter().map(ToString::to_string).collect(),
    };
    tracing::info!(
        level = level.rating().map_or_else(|| "max".to_string(), |n| n.to_string()),
        mv = %resp.mv,
        score = resp.score,
        depth = resp.depth,
        nodes = resp.nodes,
        time_ms = resp.time_ms,
        queue_ms = resp.queue_ms,
        budget_ms,
        load_scale = done.load_scale,
        degraded = done.degraded,
        "move"
    );
    Ok(resp)
}

/// `GET /healthz`.
pub async fn healthz() -> &'static str {
    "ok\n"
}

/// `GET /metrics`.
pub async fn metrics(State(app): State<AppState>) -> impl IntoResponse {
    let pool = app.pool();
    let text = app
        .metrics()
        .render(pool.queue_depth(), pool.workers(), pool.busy());
    (
        [(
            header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        text,
    )
}
