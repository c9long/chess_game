//! Service configuration from environment variables.
//!
//! | Variable | Default | Meaning |
//! |---|---|---|
//! | `BOT_BIND` | `127.0.0.1:7700` | Listen address. |
//! | `BOT_WORKERS` | available cores (respects cgroup CPU limits) | Search threads = global concurrency cap. |
//! | `BOT_MAX_QUEUE` | `4 × BOT_WORKERS` | Requests allowed to wait for a worker; beyond this, 503. |
//! | `BOT_LOG` | `info` | `tracing` filter (`RUST_LOG` syntax). |
//! | `BOT_LOG_FORMAT` | `text` | `text` or `json`. |

use std::fmt;
use std::net::SocketAddr;

/// Default listen address.
pub const DEFAULT_BIND: &str = "127.0.0.1:7700";

/// Default queue length per worker.
pub const QUEUE_PER_WORKER: usize = 4;

/// Log output format.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum LogFormat {
    /// Human-readable `key=value` lines.
    #[default]
    Text,
    /// One JSON object per line.
    Json,
}

/// Service configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    /// Listen address.
    pub bind: SocketAddr,
    /// Number of search worker threads (the global concurrency cap).
    pub workers: usize,
    /// Maximum number of requests waiting for a worker.
    pub max_queue: usize,
    /// `tracing` filter directive.
    pub log_filter: String,
    /// Log output format.
    pub log_format: LogFormat,
}

/// An invalid environment variable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigError {
    /// The variable name.
    pub var: &'static str,
    /// The offending value.
    pub value: String,
    /// What was expected.
    pub expected: &'static str,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid {}={:?}: expected {}",
            self.var, self.value, self.expected
        )
    }
}

impl std::error::Error for ConfigError {}

/// The number of cores this process may use (cgroup quotas included).
pub fn available_cores() -> usize {
    std::thread::available_parallelism().map_or(1, |n| n.get())
}

impl Config {
    /// A configuration with `workers` workers and defaults for the rest.
    pub fn with_workers(workers: usize) -> Config {
        let workers = workers.max(1);
        Config {
            bind: DEFAULT_BIND.parse().expect("valid default address"),
            workers,
            max_queue: workers * QUEUE_PER_WORKER,
            log_filter: "info".into(),
            log_format: LogFormat::Text,
        }
    }

    /// Reads the configuration from the process environment.
    pub fn from_env() -> Result<Config, ConfigError> {
        Config::from_lookup(|k| std::env::var(k).ok())
    }

    /// Reads the configuration through `lookup` (testable).
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Config, ConfigError> {
        let get = |k: &str| {
            lookup(k)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let bind = match get("BOT_BIND") {
            None => DEFAULT_BIND.parse().expect("valid default address"),
            Some(v) => v.parse().map_err(|_| ConfigError {
                var: "BOT_BIND",
                value: v,
                expected: "a socket address such as 0.0.0.0:7700",
            })?,
        };
        let workers = match get("BOT_WORKERS") {
            None => available_cores(),
            Some(v) => match v.parse::<usize>() {
                Ok(n) if (1..=1024).contains(&n) => n,
                _ => {
                    return Err(ConfigError {
                        var: "BOT_WORKERS",
                        value: v,
                        expected: "an integer from 1 to 1024",
                    });
                }
            },
        };
        let max_queue = match get("BOT_MAX_QUEUE") {
            None => workers * QUEUE_PER_WORKER,
            Some(v) => v.parse::<usize>().map_err(|_| ConfigError {
                var: "BOT_MAX_QUEUE",
                value: v,
                expected: "a non-negative integer",
            })?,
        };
        let log_filter = get("BOT_LOG").unwrap_or_else(|| "info".into());
        let log_format = match get("BOT_LOG_FORMAT").as_deref() {
            None | Some("text") => LogFormat::Text,
            Some("json") => LogFormat::Json,
            Some(v) => {
                return Err(ConfigError {
                    var: "BOT_LOG_FORMAT",
                    value: v.into(),
                    expected: "text or json",
                });
            }
        };
        Ok(Config {
            bind,
            workers,
            max_queue,
            log_filter,
            log_format,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let v: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| v.iter().find(|(kk, _)| kk == k).map(|(_, vv)| vv.clone())
    }

    #[test]
    fn defaults() {
        let c = Config::from_lookup(env(&[])).unwrap();
        assert_eq!(c.bind.to_string(), "127.0.0.1:7700");
        assert_eq!(c.workers, available_cores());
        assert_eq!(c.max_queue, c.workers * QUEUE_PER_WORKER);
        assert_eq!(c.log_format, LogFormat::Text);
    }

    #[test]
    fn overrides() {
        let c = Config::from_lookup(env(&[
            ("BOT_BIND", "0.0.0.0:8000"),
            ("BOT_WORKERS", "3"),
            ("BOT_MAX_QUEUE", "0"),
            ("BOT_LOG_FORMAT", "json"),
        ]))
        .unwrap();
        assert_eq!(c.bind.to_string(), "0.0.0.0:8000");
        assert_eq!(c.workers, 3);
        assert_eq!(c.max_queue, 0);
        assert_eq!(c.log_format, LogFormat::Json);
        // Queue default follows the worker count.
        let c = Config::from_lookup(env(&[("BOT_WORKERS", "2")])).unwrap();
        assert_eq!(c.max_queue, 8);
    }

    #[test]
    fn rejects_bad_values() {
        for (k, v) in [
            ("BOT_BIND", "localhost"),
            ("BOT_WORKERS", "0"),
            ("BOT_WORKERS", "many"),
            ("BOT_MAX_QUEUE", "-1"),
            ("BOT_LOG_FORMAT", "xml"),
        ] {
            let e = Config::from_lookup(env(&[(k, v)])).unwrap_err();
            assert_eq!(e.var, k);
        }
    }
}
