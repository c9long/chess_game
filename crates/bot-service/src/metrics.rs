//! Simple counters and a latency window, rendered as plain text
//! (Prometheus exposition style, no labels except latency quantiles).

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::Instant;

/// How many recent move latencies the percentiles are computed over.
pub const LATENCY_WINDOW: usize = 2048;

/// Service counters (all monotonic except the gauges noted).
#[derive(Debug)]
pub struct Metrics {
    started: Instant,
    /// `POST /v1/move` requests received.
    pub requests: AtomicU64,
    /// Moves answered (200).
    pub ok: AtomicU64,
    /// Rejected as invalid (400).
    pub bad_request: AtomicU64,
    /// Rejected because the game is over (409).
    pub conflict: AtomicU64,
    /// Shed because the queue was full (503).
    pub shed_queue_full: AtomicU64,
    /// Shed because the deadline passed while queued (503).
    pub shed_deadline: AtomicU64,
    /// Internal errors (500).
    pub internal_errors: AtomicU64,
    /// Moves searched with a load-reduced budget.
    pub degraded: AtomicU64,
    /// Jobs dropped because the client went away while they were queued.
    pub cancelled: AtomicU64,
    /// Total search nodes.
    pub nodes: AtomicU64,
    /// Gauge: move requests currently being handled.
    pub in_flight: AtomicU64,
    latencies: Mutex<Window>,
    /// Every HTTP response by status code (all routes, including 404/405/413
    /// produced before a handler runs).
    statuses: Mutex<BTreeMap<u16, u64>>,
}

#[derive(Debug)]
struct Window {
    buf: Vec<u32>,
    next: usize,
}

impl Default for Metrics {
    fn default() -> Self {
        Metrics::new()
    }
}

impl Metrics {
    /// Fresh counters.
    pub fn new() -> Metrics {
        Metrics {
            started: Instant::now(),
            requests: AtomicU64::new(0),
            ok: AtomicU64::new(0),
            bad_request: AtomicU64::new(0),
            conflict: AtomicU64::new(0),
            shed_queue_full: AtomicU64::new(0),
            shed_deadline: AtomicU64::new(0),
            internal_errors: AtomicU64::new(0),
            degraded: AtomicU64::new(0),
            cancelled: AtomicU64::new(0),
            nodes: AtomicU64::new(0),
            in_flight: AtomicU64::new(0),
            latencies: Mutex::new(Window {
                buf: Vec::with_capacity(LATENCY_WINDOW),
                next: 0,
            }),
            statuses: Mutex::new(BTreeMap::new()),
        }
    }

    /// Counts one HTTP response with status `code`.
    pub fn record_status(&self, code: u16) {
        *self
            .statuses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(code)
            .or_insert(0) += 1;
    }

    /// Responses sent with status `code` so far.
    pub fn status_count(&self, code: u16) -> u64 {
        self.statuses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&code)
            .copied()
            .unwrap_or(0)
    }

    /// Records the end-to-end latency of an answered move.
    pub fn record_latency_ms(&self, ms: u64) {
        let v = ms.min(u64::from(u32::MAX)) as u32;
        let mut w = self.latencies.lock().unwrap_or_else(|e| e.into_inner());
        if w.buf.len() < LATENCY_WINDOW {
            w.buf.push(v);
        } else {
            let i = w.next;
            w.buf[i] = v;
        }
        w.next = (w.next + 1) % LATENCY_WINDOW;
    }

    /// Latency percentiles `(p50, p95)` in ms over the recent window.
    pub fn latency_percentiles(&self) -> (u32, u32) {
        let mut v = self
            .latencies
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .buf
            .clone();
        if v.is_empty() {
            return (0, 0);
        }
        v.sort_unstable();
        let at = |q: f64| v[((v.len() - 1) as f64 * q).round() as usize];
        (at(0.50), at(0.95))
    }

    /// Total shed requests (both reasons).
    pub fn shed(&self) -> u64 {
        self.shed_queue_full.load(Relaxed) + self.shed_deadline.load(Relaxed)
    }

    /// Renders all metrics; pool gauges are passed in.
    pub fn render(&self, queue_depth: usize, workers: usize, busy: usize) -> String {
        let (p50, p95) = self.latency_percentiles();
        let mut s = String::with_capacity(1024);
        let mut line = |name: &str, help: &str, v: u64| {
            let _ = writeln!(s, "# HELP {name} {help}\n{name} {v}");
        };
        line(
            "bot_requests_total",
            "POST /v1/move requests received.",
            self.requests.load(Relaxed),
        );
        line(
            "bot_ok_total",
            "Moves answered (200).",
            self.ok.load(Relaxed),
        );
        line(
            "bot_bad_request_total",
            "Invalid move requests (400, plus 408/413 for slow or oversized bodies).",
            self.bad_request.load(Relaxed),
        );
        line(
            "bot_game_over_total",
            "Requests for finished games (409).",
            self.conflict.load(Relaxed),
        );
        line("bot_shed_total", "Requests shed (503).", self.shed());
        line(
            "bot_shed_queue_full_total",
            "Shed because the queue was full.",
            self.shed_queue_full.load(Relaxed),
        );
        line(
            "bot_shed_deadline_total",
            "Shed because no worker could start the search in time.",
            self.shed_deadline.load(Relaxed),
        );
        line(
            "bot_internal_errors_total",
            "Internal errors (500).",
            self.internal_errors.load(Relaxed),
        );
        line(
            "bot_degraded_total",
            "Moves searched with clearly less than an unloaded budget.",
            self.degraded.load(Relaxed),
        );
        line(
            "bot_cancelled_total",
            "Queued jobs dropped after the client disconnected or timed out.",
            self.cancelled.load(Relaxed),
        );
        line("bot_nodes_total", "Search nodes.", self.nodes.load(Relaxed));
        line(
            "bot_in_flight",
            "Move requests being handled now.",
            self.in_flight.load(Relaxed),
        );
        line(
            "bot_queue_depth",
            "Jobs waiting for a worker.",
            queue_depth as u64,
        );
        line("bot_workers", "Search worker threads.", workers as u64);
        line("bot_workers_busy", "Workers searching now.", busy as u64);
        line(
            "bot_uptime_seconds",
            "Seconds since start.",
            self.started.elapsed().as_secs(),
        );
        let _ = writeln!(
            s,
            "# HELP bot_http_responses_total HTTP responses by status (every route, \
             including 404/405/413 sent before a handler runs; connections closed for \
             malformed HTTP or a header timeout send nothing countable)."
        );
        for (code, n) in self
            .statuses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
        {
            let _ = writeln!(s, "bot_http_responses_total{{code=\"{code}\"}} {n}");
        }
        let _ = writeln!(
            s,
            "# HELP bot_latency_ms End-to-end latency of answered moves (last {LATENCY_WINDOW}).\n\
             bot_latency_ms{{quantile=\"0.5\"}} {p50}\n\
             bot_latency_ms{{quantile=\"0.95\"}} {p95}"
        );
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles() {
        let m = Metrics::new();
        assert_eq!(m.latency_percentiles(), (0, 0));
        for ms in 1..=100 {
            m.record_latency_ms(ms);
        }
        assert_eq!(m.latency_percentiles(), (51, 95));
        // The window keeps only the most recent values.
        for _ in 0..LATENCY_WINDOW {
            m.record_latency_ms(7);
        }
        assert_eq!(m.latency_percentiles(), (7, 7));
        m.record_status(413);
        m.record_status(413);
        let text = m.render(3, 4, 2);
        assert!(text.contains("bot_queue_depth 3\n"));
        assert!(text.contains("bot_http_responses_total{code=\"413\"} 2\n"));
        assert!(text.contains("bot_latency_ms{quantile=\"0.95\"} 7\n"));
    }
}
