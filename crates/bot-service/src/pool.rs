//! Deadline-aware worker pool.
//!
//! * A fixed set of OS threads (`BOT_WORKERS`) runs searches: the global
//!   concurrency cap. Each worker owns reusable [`Engine`]s (one per table
//!   size); small ones are cleared before every search (see
//!   [`CLEAR_MAX_MB`]).
//! * Waiting jobs form an earliest-deadline-first queue of at most
//!   `max_queue` entries; a submission beyond that is refused at once
//!   ([`Rejected::QueueFull`] → 503).
//! * Each job has a *thinking budget*, [`bot_engine::time_budget_ms`] (the
//!   level's target, at most ~1/30 of the clock plus 3/4 of the increment
//!   and never more than 1/10 of the clock), and a *response deadline*
//!   fixed on receipt: `received + deadline_ms` with
//!   [`response_deadline_ms`] (the same clock-safe allocation with the
//!   500 ms cap of the strongest level, never less than the budget). Weak
//!   levels think briefly but may wait longer for a worker. The search
//!   never runs past the deadline.
//! * Every search gets at least [`min_search_ms`] (`MIN_LOAD_SCALE` of its
//!   budget). A job that cannot have that is never searched: it is refused
//!   at submission when every worker is busy past that point
//!   ([`Rejected::DeadlineUnreachable`] → 503 at once), answered with
//!   [`JobOutcome::Expired`] (→ 503) when a worker picks it up too late, and
//!   withdrawn by the HTTP handler when it is still queued at its deadline
//!   ([`WorkerPool::withdraw`]). So the game server gets either a searched
//!   move or a 503 in time to play its own fallback, never an unsearched
//!   move dressed up as a real one.
//! * Untimed requests (`clock_ms == u64::MAX`) at levels with a node budget
//!   search until that budget from a cleared table, capped only by the
//!   500 ms response deadline (the engine starts no new iteration after half
//!   of it), so with a seed they reproduce [`bot_engine::choose_move`] when
//!   the service is not under load and the budget is reached in time
//!   (normally so in release builds).
//! * Load shedding: when a worker takes a job while others wait, it caps the
//!   search so that every waiting job could still start in time to search
//!   as long, given when the other workers' running searches end and if
//!   every later search took as long (see [`load_scale`]); the job's node
//!   and time budgets are multiplied by that factor (at least
//!   [`MIN_LOAD_SCALE`]). The queue then drains faster instead of clocks
//!   being missed, and quick weak-level searches are left alone. A reply
//!   is flagged `degraded` whenever its search got clearly less time than an
//!   unloaded search would have.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use bot_engine::{Engine, FfaAlgorithm, Level, SearchResult, choose_move_in, level_limits};
use rules_core::GameState;
use tokio::sync::oneshot;

use crate::metrics::Metrics;

/// The smallest fraction of its budget a search gets under load.
pub const MIN_LOAD_SCALE: f64 = 0.125;

/// Engines with tables up to this size (levels up to 2100) are cleared
/// after every search (once the reply is sent), so a node-bound search
/// depends only on the request (a cleared table gives the same move as
/// [`bot_engine::choose_move`] for the same limits). Larger tables (2400,
/// Max) stay warm across timed requests, which are time-bound and so not
/// reproducible anyway (clearing 16 MB costs a few ms, and a warm table
/// helps the next move of a game); they are cleared before an untimed
/// node-bound search (2400 with `clockMs: null`), which must be
/// reproducible.
pub const CLEAR_MAX_MB: usize = 8;

/// The shortest search a job gets: [`MIN_LOAD_SCALE`] of its budget, at
/// least 1 ms. A job that cannot search this long before its deadline is
/// answered 503 instead.
pub fn min_search_ms(budget_ms: u64) -> u64 {
    ((budget_ms as f64 * MIN_LOAD_SCALE).ceil() as u64).max(1)
}

/// Stack size of worker threads.
const WORKER_STACK: usize = 8 << 20;

/// A move request ready for a worker.
#[derive(Debug)]
pub struct MoveJob {
    /// Position to search (not over).
    pub state: GameState,
    /// Strength level.
    pub level: Level,
    /// The bot's remaining clock.
    pub clock_ms: u64,
    /// Increment per move.
    pub increment_ms: u64,
    /// Seed for noise and blunder selection.
    pub seed: u64,
    /// When the request arrived.
    pub received: Instant,
    /// Thinking budget in ms ([`bot_engine::time_budget_ms`]).
    pub budget_ms: u64,
    /// Response deadline in ms after `received` ([`response_deadline_ms`]).
    pub deadline_ms: u64,
}

impl MoveJob {
    /// The response deadline.
    pub fn deadline(&self) -> Instant {
        self.received + Duration::from_millis(self.deadline_ms)
    }
}

/// Upper bound of the response deadline (the strongest level's target).
pub const MAX_DEADLINE_MS: u64 = 500;

/// The response deadline for a move: `min(500, clock/30 + 3/4·increment,
/// clock/10)` ms (at least 1 ms, and at least `budget_ms`). `clock_ms ==
/// u64::MAX` (untimed) gives 500 ms.
pub fn response_deadline_ms(clock_ms: u64, increment_ms: u64, budget_ms: u64) -> u64 {
    let safe = if clock_ms == u64::MAX {
        MAX_DEADLINE_MS
    } else {
        let alloc = clock_ms / 30 + increment_ms.saturating_mul(3) / 4;
        MAX_DEADLINE_MS.min(alloc).min(clock_ms / 10).max(1)
    };
    safe.max(budget_ms)
}

/// A finished search.
#[derive(Debug)]
pub struct MoveDone {
    /// The engine's result (with the level's move selection applied).
    pub result: SearchResult,
    /// Time spent waiting for a worker.
    pub queue_ms: u64,
    /// Budget multiplier applied for load (1.0 = full budget).
    pub load_scale: f64,
    /// Whether the search got clearly less time or fewer nodes than an
    /// unloaded search would have (load scaling or a late start).
    pub degraded: bool,
}

/// What a worker did with a job.
#[derive(Debug)]
pub enum JobOutcome {
    /// Searched.
    Done(MoveDone),
    /// The deadline passed while the job was queued.
    Expired {
        /// Time spent waiting.
        queue_ms: u64,
    },
    /// The search panicked (a bug); the worker survived.
    Failed,
}

/// An accepted job: its id (for [`WorkerPool::withdraw`]) and the receiver
/// of its outcome.
#[derive(Debug)]
pub struct Ticket {
    /// Queue id of the job.
    pub id: u64,
    /// Yields the outcome once a worker has handled the job.
    pub rx: oneshot::Receiver<JobOutcome>,
}

/// Why a job was refused at submission.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Rejected {
    /// `max_queue` jobs are already waiting.
    QueueFull,
    /// Every worker is busy until too close to the job's deadline for it to
    /// get its minimum search ([`min_search_ms`]).
    DeadlineUnreachable,
    /// The pool is shutting down.
    ShuttingDown,
}

struct Queued {
    deadline: Instant,
    seq: u64,
    job: MoveJob,
    reply: oneshot::Sender<JobOutcome>,
}

impl PartialEq for Queued {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Queued {}
impl PartialOrd for Queued {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Queued {
    // BinaryHeap is a max-heap: the earliest deadline (then the oldest
    // submission) must compare greatest.
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .deadline
            .cmp(&self.deadline)
            .then_with(|| other.seq.cmp(&self.seq))
    }
}

struct QueueState {
    heap: BinaryHeap<Queued>,
    seq: u64,
    shutdown: bool,
}

struct Shared {
    queue: Mutex<QueueState>,
    /// When each worker's current search stops (`None`: idle, or not known
    /// yet). Locked after `queue` when both are needed.
    ends: Mutex<Vec<Option<Instant>>>,
    ready: Condvar,
    busy: AtomicUsize,
    workers: usize,
    max_queue: usize,
    ffa_algorithm: FfaAlgorithm,
    metrics: Arc<Metrics>,
}

/// The worker pool.
pub struct WorkerPool {
    shared: Arc<Shared>,
    threads: Mutex<Vec<JoinHandle<()>>>,
}

impl std::fmt::Debug for WorkerPool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkerPool")
            .field("workers", &self.shared.workers)
            .field("max_queue", &self.shared.max_queue)
            .finish_non_exhaustive()
    }
}

impl WorkerPool {
    /// Starts `workers` threads with a queue of at most `max_queue` jobs.
    pub fn new(workers: usize, max_queue: usize, metrics: Arc<Metrics>) -> WorkerPool {
        let workers = workers.max(1);
        let shared = Arc::new(Shared {
            queue: Mutex::new(QueueState {
                heap: BinaryHeap::new(),
                seq: 0,
                shutdown: false,
            }),
            ends: Mutex::new(vec![None; workers]),
            ready: Condvar::new(),
            busy: AtomicUsize::new(0),
            workers,
            max_queue,
            ffa_algorithm: FfaAlgorithm::default(),
            metrics,
        });
        let threads = (0..workers)
            .map(|i| {
                let sh = Arc::clone(&shared);
                std::thread::Builder::new()
                    .name(format!("bot-worker-{i}"))
                    .stack_size(WORKER_STACK)
                    .spawn(move || worker_loop(&sh, i))
                    .expect("spawn worker thread")
            })
            .collect();
        WorkerPool {
            shared,
            threads: Mutex::new(threads),
        }
    }

    /// Queues a job; the ticket's receiver yields its outcome.
    ///
    /// A job is accepted when a worker is idle or fewer than `max_queue`
    /// jobs are waiting, and, when every worker is busy, the first of them
    /// to finish does so early enough for the job's minimum search.
    /// Queued jobs whose client has gone away are dropped first.
    pub fn submit(&self, job: MoveJob) -> Result<Ticket, Rejected> {
        let (tx, rx) = oneshot::channel();
        let mut q = self.lock();
        if q.shutdown {
            return Err(Rejected::ShuttingDown);
        }
        let before = q.heap.len();
        q.heap.retain(|w| !w.reply.is_closed());
        let abandoned = before - q.heap.len();
        if abandoned > 0 {
            self.shared
                .metrics
                .cancelled
                .fetch_add(abandoned as u64, Relaxed);
        }
        let idle = self
            .shared
            .workers
            .saturating_sub(self.shared.busy.load(Relaxed));
        // Jobs that an idle worker is about to take do not count as waiting.
        let waiting_after = (q.heap.len() + 1).saturating_sub(idle);
        if waiting_after > self.shared.max_queue {
            return Err(Rejected::QueueFull);
        }
        if idle == 0 {
            // A lower bound on the start: the earliest end of a running
            // search (unknown ends impose nothing).
            let ends = self.shared.ends.lock().unwrap_or_else(|e| e.into_inner());
            let earliest = ends
                .iter()
                .try_fold(None::<Instant>, |acc, e| {
                    e.map(|t| Some(acc.map_or(t, |a| a.min(t))))
                })
                .flatten();
            if let Some(start) = earliest {
                let latest_start = job.deadline().checked_sub(
                    margin(job.deadline_ms) + Duration::from_millis(min_search_ms(job.budget_ms)),
                );
                if latest_start.is_none_or(|l| start > l) {
                    return Err(Rejected::DeadlineUnreachable);
                }
            }
        }
        q.seq += 1;
        let seq = q.seq;
        q.heap.push(Queued {
            deadline: job.deadline(),
            seq,
            job,
            reply: tx,
        });
        drop(q);
        self.shared.ready.notify_one();
        Ok(Ticket { id: seq, rx })
    }

    /// Removes job `id` if it is still waiting for a worker; returns
    /// whether it was removed (`false`: a worker has taken it, or it is
    /// unknown). A removed job is never searched and its receiver closes.
    pub fn withdraw(&self, id: u64) -> bool {
        let mut q = self.lock();
        let before = q.heap.len();
        q.heap.retain(|w| w.seq != id);
        q.heap.len() != before
    }

    /// Jobs waiting for a worker.
    pub fn queue_depth(&self) -> usize {
        self.lock().heap.len()
    }

    /// Workers searching now.
    pub fn busy(&self) -> usize {
        self.shared.busy.load(Relaxed)
    }

    /// Worker thread count.
    pub fn workers(&self) -> usize {
        self.shared.workers
    }

    /// Maximum waiting jobs.
    pub fn max_queue(&self) -> usize {
        self.shared.max_queue
    }

    /// Stops accepting jobs, lets the workers finish every queued job and
    /// joins them. Idempotent.
    pub fn shutdown(&self) {
        self.lock().shutdown = true;
        self.shared.ready.notify_all();
        let threads = std::mem::take(&mut *self.threads.lock().unwrap_or_else(|e| e.into_inner()));
        for t in threads {
            let _ = t.join();
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, QueueState> {
        self.shared.queue.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl Drop for WorkerPool {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Budget multiplier for a search of `budget_ms` taken while other jobs
/// wait. `waiting_ms` holds the waiting jobs' remaining times to their
/// deadlines, ascending (EDF order); `busy_ms` the remaining search time of
/// every *other* worker (0 = idle).
///
/// Model: this search and every later one last `S`; each waiting job, in
/// EDF order, goes to the worker that frees up first (this one after `S`,
/// the others when their running search ends) and must be able to finish
/// its own `S`-long search by its deadline. The multiplier is the largest
/// such `S` over `budget_ms`, clamped to `[MIN_LOAD_SCALE, 1]`.
pub fn load_scale(budget_ms: u64, waiting_ms: &[f64], busy_ms: &[f64]) -> f64 {
    if budget_ms == 0 || waiting_ms.is_empty() {
        return 1.0;
    }
    let mut free: Vec<f64> = Vec::with_capacity(busy_ms.len() + 1);
    let mut feasible = |s: f64| {
        free.clear();
        free.push(s);
        free.extend_from_slice(busy_ms);
        for &r in waiting_ms {
            let (i, t) = free
                .iter()
                .copied()
                .enumerate()
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .unwrap_or((0, 0.0));
            if t + s > r {
                return false;
            }
            free[i] = t + s;
        }
        true
    };
    let full = budget_ms as f64;
    if feasible(full) {
        return 1.0;
    }
    let (mut lo, mut hi) = (full * MIN_LOAD_SCALE, full);
    if !feasible(lo) {
        return MIN_LOAD_SCALE;
    }
    for _ in 0..20 {
        let mid = 0.5 * (lo + hi);
        if feasible(mid) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo / full).clamp(MIN_LOAD_SCALE, 1.0)
}

/// Safety margin kept between the end of a search and the deadline: 10% of
/// the deadline, 1 to 50 ms (at most half of it), for the reply and for
/// scheduling noise on a busy machine.
fn margin(deadline_ms: u64) -> Duration {
    Duration::from_millis((deadline_ms / 10).clamp(1, 50).min(deadline_ms / 2))
}

fn worker_loop(sh: &Shared, me: usize) {
    // Engines keyed by table size, reused across jobs.
    let mut engines: HashMap<usize, Engine> = HashMap::new();
    let mut waiting: Vec<f64> = Vec::new();
    let mut busy_ms: Vec<f64> = Vec::new();
    loop {
        let item =
            {
                let mut q = sh.queue.lock().unwrap_or_else(|e| e.into_inner());
                loop {
                    if let Some(item) = q.heap.pop() {
                        // Count this worker busy while still holding the lock so
                        // `submit` sees a consistent picture.
                        sh.busy.fetch_add(1, Relaxed);
                        let now = Instant::now();
                        waiting.clear();
                        waiting.extend(q.heap.iter().filter(|w| !w.reply.is_closed()).map(|w| {
                            w.deadline.saturating_duration_since(now).as_secs_f64() * 1e3
                        }));
                        let ends = sh.ends.lock().unwrap_or_else(|e| e.into_inner());
                        busy_ms.clear();
                        busy_ms.extend(ends.iter().enumerate().filter(|&(i, _)| i != me).map(
                            |(_, e)| {
                                e.map_or(0.0, |t| {
                                    t.saturating_duration_since(now).as_secs_f64() * 1e3
                                })
                            },
                        ));
                        break item;
                    }
                    if q.shutdown {
                        return;
                    }
                    q = sh.ready.wait(q).unwrap_or_else(|e| e.into_inner());
                }
            };
        let tt_mb = item.job.level.params().tt_mb;
        waiting.sort_unstable_by(f64::total_cmp);
        let outcome = run_job(
            sh,
            me,
            &mut engines,
            item.job,
            &waiting,
            &busy_ms,
            &item.reply,
        );
        sh.ends.lock().unwrap_or_else(|e| e.into_inner())[me] = None;
        if let Some(outcome) = outcome {
            // The receiver may be gone (client disconnected); nothing to do.
            let _ = item.reply.send(outcome);
        }
        // Counted idle from here: clearing takes at most about a millisecond.
        sh.busy.fetch_sub(1, Relaxed);
        // Clear small tables after replying, off the latency path, so the
        // next search starts from a fresh table.
        if tt_mb <= CLEAR_MAX_MB
            && let Some(e) = engines.get_mut(&tt_mb)
        {
            e.clear();
        }
    }
}

fn run_job(
    sh: &Shared,
    me: usize,
    engines: &mut HashMap<usize, Engine>,
    job: MoveJob,
    waiting: &[f64],
    busy_ms: &[f64],
    reply: &oneshot::Sender<JobOutcome>,
) -> Option<JobOutcome> {
    let now = Instant::now();
    let queue_ms = now.duration_since(job.received).as_millis() as u64;
    if reply.is_closed() {
        sh.metrics.cancelled.fetch_add(1, Relaxed);
        return None;
    }
    let deadline = job.deadline();
    let margin = margin(job.deadline_ms);
    let available = deadline
        .saturating_duration_since(now)
        .saturating_sub(margin);
    if available < Duration::from_millis(min_search_ms(job.budget_ms)) {
        // Too late for a real search: the game server's own fallback is as
        // good and arrives sooner.
        return Some(JobOutcome::Expired { queue_ms });
    }
    let scale = load_scale(job.budget_ms, waiting, busy_ms);
    let mut limits = level_limits(
        job.level,
        &job.state,
        sh.ffa_algorithm,
        job.clock_ms,
        job.increment_ms,
    );
    let params = job.level.params();
    if scale < 1.0 {
        limits.max_nodes = ((params.max_nodes as f64 * scale) as u64).max(1);
    }
    // Untimed, node-bound levels (no deadline from `level_limits`) may use
    // the whole response deadline so that the node budget binds.
    let time_ms = if limits.deadline.is_none() {
        job.deadline_ms
    } else {
        job.budget_ms
    };
    let scaled = Duration::from_secs_f64(time_ms as f64 * scale / 1000.0);
    let search_time = available.min(scaled);
    // What an unloaded search starting on receipt would get.
    let nominal = Duration::from_millis(time_ms)
        .min(Duration::from_millis(job.deadline_ms).saturating_sub(margin));
    let degraded = scale < 1.0 || search_time.as_secs_f64() < 0.9 * nominal.as_secs_f64();
    limits.deadline = Some(now + search_time);
    sh.ends.lock().unwrap_or_else(|e| e.into_inner())[me] = Some(now + search_time);
    let tt_mb = params.tt_mb;
    let untimed_node_bound = job.clock_ms == u64::MAX && params.max_nodes != u64::MAX;
    let engine = engines.entry(tt_mb).or_insert_with(|| Engine::new(tt_mb));
    if untimed_node_bound && tt_mb > CLEAR_MAX_MB {
        engine.clear();
    }
    let res = catch_unwind(AssertUnwindSafe(|| {
        choose_move_in(
            engine,
            &job.state,
            job.level,
            &limits,
            job.seed,
            sh.ffa_algorithm,
        )
    }));
    match res {
        Ok(result) => Some(JobOutcome::Done(MoveDone {
            result,
            queue_ms,
            load_scale: scale,
            degraded,
        })),
        Err(_) => {
            // The engine may be inconsistent after a panic: rebuild it.
            engines.remove(&tt_mb);
            tracing::error!(position = %job.state, "search panicked");
            Some(JobOutcome::Failed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-3
    }

    #[test]
    fn scale() {
        // Nobody waiting: full budget.
        assert_eq!(load_scale(400, &[], &[0.0; 3]), 1.0);
        // Plenty of slack for quick weak-level searches.
        assert_eq!(load_scale(30, &[480.0; 12], &[0.0; 3]), 1.0);
        // 2 workers (the other idle), 6 waiting with 400 ms left: the jobs
        // alternate between the workers and the 6th ends after 4 searches,
        // so each may take 100 ms of a 400 ms budget.
        assert!(near(load_scale(400, &[400.0; 6], &[0.0]), 0.25));
        // Idle workers absorb waiting jobs.
        assert_eq!(load_scale(400, &[400.0; 6], &[0.0; 6]), 1.0);
        // Running searches count: the other worker is busy for 400 ms, so
        // all 6 jobs queue behind this one (7 searches in 400 ms).
        assert!(near(load_scale(400, &[400.0; 6], &[400.0]), 1.0 / 7.0));
        // ... but not if it frees up soon.
        assert!(near(load_scale(400, &[400.0; 6], &[0.0]), 0.25));
        // The most urgent waiting job dominates.
        assert!(near(load_scale(400, &[200.0, 1000.0], &[400.0; 3]), 0.25));
        // Floor.
        assert_eq!(load_scale(400, &[1.0], &[0.0; 3]), MIN_LOAD_SCALE);
    }

    #[test]
    fn minimum_search() {
        assert_eq!(min_search_ms(400), 50);
        assert_eq!(min_search_ms(30), 4);
        assert_eq!(min_search_ms(1), 1);
        assert_eq!(min_search_ms(0), 1);
    }

    #[test]
    fn deadlines() {
        use bot_engine::{Level, time_budget_ms};
        // 10 minutes: weak levels think 30 ms but may wait up to 500 ms.
        let b = time_budget_ms(Level::L600, 600_000, 0);
        assert_eq!((b, response_deadline_ms(600_000, 0, b)), (30, 500));
        // 3 s left: 1/30 of the clock for everyone.
        let b = time_budget_ms(Level::L2400, 3_000, 0);
        assert_eq!((b, response_deadline_ms(3_000, 0, b)), (100, 100));
        // Increment counts; 1/10 of the clock caps it.
        assert_eq!(response_deadline_ms(1_000, 2_000, 1), 100);
        assert_eq!(response_deadline_ms(0, 0, 1), 1);
        assert_eq!(response_deadline_ms(u64::MAX, 0, 30), 500);
        for level in Level::ALL {
            for clock in [0, 50, 3_000, 60_000, u64::MAX] {
                let b = time_budget_ms(level, clock, 500);
                assert!(response_deadline_ms(clock, 500, b) >= b);
            }
        }
    }

    #[test]
    fn margins() {
        assert_eq!(margin(1), Duration::ZERO);
        assert_eq!(margin(10), Duration::from_millis(1));
        assert_eq!(margin(60), Duration::from_millis(6));
        assert_eq!(margin(200), Duration::from_millis(20));
        assert_eq!(margin(500), Duration::from_millis(50));
        assert_eq!(margin(5_000), Duration::from_millis(50));
    }

    #[test]
    fn earliest_deadline_first() {
        let t = Instant::now();
        let state = GameState::new(rules_core::GameConfig::new(rules_core::GameMode::Ffa)).unwrap();
        let mk = |ms: u64, seq: u64| {
            let (tx, _rx) = oneshot::channel();
            Queued {
                deadline: t + Duration::from_millis(ms),
                seq,
                job: MoveJob {
                    state: state.clone(),
                    level: Level::L600,
                    clock_ms: 0,
                    increment_ms: 0,
                    seed: 0,
                    received: t,
                    budget_ms: ms,
                    deadline_ms: ms,
                },
                reply: tx,
            }
        };
        let mut h = BinaryHeap::new();
        h.push(mk(300, 1));
        h.push(mk(100, 2));
        h.push(mk(200, 3));
        h.push(mk(100, 4));
        let order: Vec<u64> = std::iter::from_fn(|| h.pop().map(|q| q.seq)).collect();
        assert_eq!(order, vec![2, 4, 3, 1]);
    }
}
