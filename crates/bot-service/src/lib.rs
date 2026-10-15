//! HTTP bot service wrapping [`bot_engine`] (PLAN §6).
//!
//! * `POST /v1/move` — pick a move for a position at a level, within a
//!   deadline derived from the bot's clock.
//! * `GET /healthz` — liveness.
//! * `GET /metrics` — plain-text counters.
//!
//! Searches run on a fixed pool of worker threads (the global concurrency
//! cap) fed by an earliest-deadline-first queue; under load the per-move
//! budgets shrink, and when the queue is full requests are refused with
//! 503 + `Retry-After` so the game server can play a quick fallback move.
//! See `README.md` for the full contract and [`pool`] for the scheduling
//! rules.

#![forbid(unsafe_code)]

pub mod api;
pub mod config;
pub mod metrics;
pub mod pool;

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{get, post};
use hyper_util::rt::{TokioIo, TokioTimer};
use hyper_util::server::graceful::GracefulShutdown;
use hyper_util::service::TowerToHyperService;

pub use config::{Config, ConfigError, LogFormat};
pub use metrics::Metrics;
pub use pool::WorkerPool;

/// Maximum request body size (a position string is a few hundred bytes).
pub const MAX_BODY_BYTES: usize = 64 * 1024;

/// A connection must deliver a request's headers within this time (also
/// bounds idle keep-alive connections between requests).
pub const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(5);

/// After the shutdown signal, open requests get this long to finish; the
/// rest (stalled clients) are dropped so a stop grace period of 5 s holds.
/// Searches stop by their deadline (at most 500 ms), so live requests need
/// far less.
pub const DRAIN_TIMEOUT: Duration = Duration::from_secs(3);

/// Listen backlog for [`bind`]: bursts of new connections (many bot turns
/// at round start) must not overflow the kernel queue (the std default of
/// 128 drops SYNs, and clients retry only after ~1 s).
pub const LISTEN_BACKLOG: u32 = 1024;

/// Shared service state (cheap to clone).
#[derive(Clone, Debug)]
pub struct AppState {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    pool: WorkerPool,
    metrics: Arc<Metrics>,
    config: Config,
}

impl AppState {
    /// Starts the worker pool described by `config`.
    pub fn new(config: Config) -> AppState {
        let metrics = Arc::new(Metrics::new());
        let pool = WorkerPool::new(config.workers, config.max_queue, Arc::clone(&metrics));
        AppState {
            inner: Arc::new(Inner {
                pool,
                metrics,
                config,
            }),
        }
    }

    /// The worker pool.
    pub fn pool(&self) -> &WorkerPool {
        &self.inner.pool
    }

    /// The counters.
    pub fn metrics(&self) -> &Metrics {
        &self.inner.metrics
    }

    /// The configuration.
    pub fn config(&self) -> &Config {
        &self.inner.config
    }

    /// Refuses new jobs, finishes queued ones and joins the workers
    /// (blocking).
    pub fn shutdown(&self) {
        self.inner.pool.shutdown();
    }
}

/// The HTTP router. Every response it produces (including 404, 405 and
/// 413 from routing and extraction) is counted by status in `/metrics`.
pub fn router(app: AppState) -> Router {
    Router::new()
        .route("/v1/move", post(api::post_move))
        .route("/healthz", get(api::healthz))
        .route("/metrics", get(api::metrics))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::from_fn_with_state(app.clone(), count_status))
        .with_state(app)
}

async fn count_status(State(app): State<AppState>, req: Request, next: Next) -> Response {
    let resp = next.run(req).await;
    app.metrics().record_status(resp.status().as_u16());
    resp
}

/// Binds a listener with a [`LISTEN_BACKLOG`]-deep accept queue.
pub fn bind(addr: std::net::SocketAddr) -> std::io::Result<tokio::net::TcpListener> {
    let socket = if addr.is_ipv4() {
        tokio::net::TcpSocket::new_v4()?
    } else {
        tokio::net::TcpSocket::new_v6()?
    };
    socket.set_reuseaddr(true)?;
    socket.bind(addr)?;
    socket.listen(LISTEN_BACKLOG)
}

/// Serves `app` on `listener` (HTTP/1.1, keep-alive, `TCP_NODELAY`, headers
/// due within [`HEADER_READ_TIMEOUT`]) until `shutdown` resolves; then stops
/// accepting, lets open requests finish for at most [`DRAIN_TIMEOUT`], and
/// drains the worker pool (every queued job is answered).
pub async fn serve(
    listener: tokio::net::TcpListener,
    app: AppState,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    let router = router(app.clone());
    let graceful = GracefulShutdown::new();
    let mut builder = hyper::server::conn::http1::Builder::new();
    builder
        .timer(TokioTimer::new())
        .header_read_timeout(HEADER_READ_TIMEOUT)
        .keep_alive(true);
    tokio::pin!(shutdown);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = match accepted {
                    Ok(a) => a,
                    Err(e) => {
                        // Transient (e.g. too many open files): back off a
                        // little instead of spinning or dying.
                        tracing::warn!(error = %e, "accept failed");
                        tokio::time::sleep(Duration::from_millis(10)).await;
                        continue;
                    }
                };
                let _ = stream.set_nodelay(true);
                let svc = TowerToHyperService::new(router.clone());
                let conn = builder.serve_connection(TokioIo::new(stream), svc);
                let conn = graceful.watch(conn);
                tokio::spawn(async move {
                    if let Err(e) = conn.await {
                        tracing::debug!(error = %e, "connection ended with an error");
                    }
                });
            }
            () = &mut shutdown => break,
        }
    }
    drop(listener);
    tokio::select! {
        () = graceful.shutdown() => {}
        () = tokio::time::sleep(DRAIN_TIMEOUT) => {
            tracing::warn!("drain timeout: dropping connections still open");
        }
    }
    // Joining worker threads blocks; keep it off the async workers.
    let _ = tokio::task::spawn_blocking(move || app.shutdown()).await;
    Ok(())
}
