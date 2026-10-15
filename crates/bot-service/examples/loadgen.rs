//! Load generator for a running bot-service.
//!
//! ```text
//! cargo run --release -p bot-service --example loadgen -- \
//!     [addr=127.0.0.1:7700] [level=600] [concurrency=12] [seconds=10] \
//!     [mode=ffa|teams|mixed] [clockMs=600000]
//! ```
//!
//! Keeps `concurrency` requests in flight (one HTTP/1.1 connection per
//! request) for `seconds`, over positions reached by random play from the
//! start, and prints throughput, status counts and latency.

use std::time::{Duration, Instant};

use bot_engine::Rng;
use rules_core::{GameConfig, GameMode, GameState, apply_move, legal_moves};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Default)]
struct Stats {
    statuses: std::collections::BTreeMap<u16, u64>,
    latencies: Vec<u64>,
    over_deadline: u64,
    max_over: i64,
    server_over: u64,
    depth_sum: u64,
    nodes_sum: u64,
    degraded: u64,
    errors: u64,
}

fn positions(mode: &str, n: usize) -> Vec<String> {
    let mut rng = Rng::new(0x10AD);
    let mut out = Vec::new();
    while out.len() < n {
        let m = match mode {
            "teams" => GameMode::Teams,
            "mixed" if out.len() % 2 == 1 => GameMode::Teams,
            _ => GameMode::Ffa,
        };
        let mut s = GameState::new(GameConfig::new(m)).unwrap();
        let plies = rng.below(48);
        for _ in 0..plies {
            let moves = legal_moves(&s);
            if s.is_over() || moves.is_empty() {
                break;
            }
            let mv = moves[rng.below(moves.len() as u64) as usize];
            apply_move(&mut s, mv).unwrap();
        }
        if !s.is_over() {
            out.push(s.to_string());
        }
    }
    out
}

async fn request(addr: &str, body: &str) -> std::io::Result<(u16, Value)> {
    let mut sock = tokio::net::TcpStream::connect(addr).await?;
    sock.set_nodelay(true)?;
    let req = format!(
        "POST /v1/move HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    sock.write_all(req.as_bytes()).await?;
    let mut buf = Vec::with_capacity(1024);
    sock.read_to_end(&mut buf).await?;
    let text = String::from_utf8_lossy(&buf);
    let status = text
        .split(' ')
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let json = text
        .find("\r\n\r\n")
        .and_then(|i| serde_json::from_str(&text[i + 4..]).ok())
        .unwrap_or(Value::Null);
    Ok((status, json))
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize, d: &str| args.get(i).cloned().unwrap_or_else(|| d.to_string());
    let addr = arg(0, "127.0.0.1:7700");
    let level = arg(1, "600");
    let concurrency: usize = arg(2, "12").parse().expect("concurrency");
    let seconds: u64 = arg(3, "10").parse().expect("seconds");
    let mode = arg(4, "ffa");
    let clock: u64 = arg(5, "600000").parse().expect("clockMs");
    let positions = std::sync::Arc::new(positions(&mode, 256));
    let end = Instant::now() + Duration::from_secs(seconds);
    let started = Instant::now();
    let mut tasks = Vec::new();
    for t in 0..concurrency {
        let (addr, level, positions) = (addr.clone(), level.clone(), positions.clone());
        tasks.push(tokio::spawn(async move {
            let mut st = Stats::default();
            let mut i = t;
            while Instant::now() < end {
                let body = serde_json::json!({
                    "position": positions[i % positions.len()],
                    "level": level,
                    "clockMs": clock,
                    "incrementMs": 0,
                    "seed": i,
                })
                .to_string();
                i += concurrency;
                let t0 = Instant::now();
                match request(&addr, &body).await {
                    Ok((status, v)) => {
                        let ms = t0.elapsed().as_millis() as u64;
                        *st.statuses.entry(status).or_default() += 1;
                        if status == 200 {
                            st.latencies.push(ms);
                            let deadline = v["deadlineMs"].as_i64().unwrap_or(0);
                            let over = ms as i64 - deadline;
                            st.max_over = st.max_over.max(over);
                            st.over_deadline += u64::from(over > 0);
                            st.server_over +=
                                u64::from(v["timeMs"].as_i64().unwrap_or(0) > deadline);
                            st.depth_sum += v["depth"].as_u64().unwrap_or(0);
                            st.nodes_sum += v["nodes"].as_u64().unwrap_or(0);
                            st.degraded += u64::from(v["degraded"].as_bool().unwrap_or(false));
                        }
                    }
                    Err(_) => st.errors += 1,
                }
            }
            st
        }));
    }
    let mut all = Stats {
        max_over: i64::MIN,
        ..Stats::default()
    };
    for t in tasks {
        let s = t.await.unwrap();
        for (k, v) in s.statuses {
            *all.statuses.entry(k).or_default() += v;
        }
        all.latencies.extend(s.latencies);
        all.over_deadline += s.over_deadline;
        all.server_over += s.server_over;
        all.max_over = all.max_over.max(s.max_over);
        all.depth_sum += s.depth_sum;
        all.nodes_sum += s.nodes_sum;
        all.degraded += s.degraded;
        all.errors += s.errors;
    }
    let secs = started.elapsed().as_secs_f64();
    let total: u64 = all.statuses.values().sum();
    let ok = all.latencies.len() as u64;
    all.latencies.sort_unstable();
    let q = |p: f64| {
        all.latencies
            .get(((all.latencies.len().max(1) - 1) as f64 * p).round() as usize)
            .copied()
            .unwrap_or(0)
    };
    println!("level={level} mode={mode} clock={clock} concurrency={concurrency} seconds={secs:.1}");
    println!(
        "requests={total} rps={:.1} ok_rps={:.1} statuses={:?} conn_errors={}",
        total as f64 / secs,
        ok as f64 / secs,
        all.statuses,
        all.errors
    );
    println!(
        "latency_ms p50={} p95={} max={} | client_over_deadline={} max_over_ms={} server_over_deadline={} | avg_depth={:.2} avg_nodes={} degraded={}",
        q(0.5),
        q(0.95),
        all.latencies.last().copied().unwrap_or(0),
        all.over_deadline,
        all.max_over,
        all.server_over,
        all.depth_sum as f64 / ok.max(1) as f64,
        all.nodes_sum / ok.max(1),
        all.degraded
    );
}
