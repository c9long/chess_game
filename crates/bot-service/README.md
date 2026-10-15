# bot-service

A small HTTP service that picks bot moves with `bot-engine` (PLAN §6). The
Node game server calls it whenever a bot seat is to move. The server stays
authoritative: it validates the returned move with rules-core (via
rules-wasm) like any other move, and it charges the bot's clock itself.

- HTTP/1.1 with JSON bodies; keep-alive is supported.
- Searches run on a fixed pool of worker threads (`BOT_WORKERS`, default:
  the CPUs the process may use). That pool is the global concurrency cap.
- Requests wait in an earliest-deadline-first queue.
- Under load, search budgets shrink so that moves stay on time.
- When the queue is full, the service answers `503` at once, so the game
  server can play a fallback move instead of waiting.

## Running

```sh
cargo run --release -p bot-service            # listens on 127.0.0.1:7700
BOT_WORKERS=2 BOT_LOG_FORMAT=json cargo run --release -p bot-service

# Docker (build from the repository root; there is a compose service in infra/)
docker build -f crates/bot-service/Dockerfile -t bot-service .
docker run --rm -p 7700:7700 --cpus=2 bot-service
```

| Variable | Default | Meaning |
|---|---|---|
| `BOT_BIND` | `127.0.0.1:7700` (image: `0.0.0.0:7700`) | Listen address. |
| `BOT_WORKERS` | CPUs available to the process (respects cgroup/`--cpus` limits) | Search threads, which is the global concurrency cap. 1–1024. Each worker keeps up to ~33 MB of search tables (1, 2, 4, 8 and 16 MB, created on first use), so budget about 35 MB per worker plus a few MB: 12 workers plateau near 400 MB. With the compose `mem_limit` of 512m, keep `BOT_WORKERS` ≤ 12. |
| `BOT_MAX_QUEUE` | `4 × BOT_WORKERS` | Requests that may wait for a worker. One more gets `503 overloaded`. `0` means no waiting at all. |
| `BOT_LOG` | `info` | `tracing` filter, e.g. `bot_service=debug`. |
| `BOT_LOG_FORMAT` | `text` (image: `json`) | `text` or `json`. Each answered move is logged at `info`: level, move, score, depth, nodes, times, load scale. |

An invalid variable makes the process exit with code 2 and a message.

On SIGTERM or SIGINT the service:

1. stops accepting connections (idle keep-alive connections are closed);
2. finishes open requests and every job already queued, for at most 3 s
   (a stalled client cannot hold the shutdown longer);
3. exits with code 0.

The longest search is 500 ms, so a 5 s stop grace period is plenty.

Connections: HTTP/1.1 with keep-alive and `TCP_NODELAY`; the listen backlog
is 1024. A client must send a request's headers within 5 s (this also
closes idle keep-alive connections after 5 s) and its body within 5 s
after that (`408 body_timeout`).

## `POST /v1/move`

### Request

```json
{
  "position": "ffa 2nRnNnBnQnKnBnNnR2/.../2sRsNsBsQsKsBsNsR2 S AAAA Sc1,Sj1,Wa3,Wa10,Nc12,Nj12,El3,El10 - 0 0 ep=on ml=25 civ=canada.1,canada.1,canada.1,canada.1 def=- rv=1",
  "level": "1500",
  "clockMs": 300000,
  "incrementMs": 2000,
  "seed": 42
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `position` | string | yes | A rules-core position string (`rules_core::position_string`, the same `toString()` rules-wasm produces). The bot plays for the seat to move. |
| `level` | string | yes | `"600"`, `"900"`, `"1200"`, `"1500"`, `"1800"`, `"2100"`, `"2400"` or `"max"` (case-insensitive). A JSON number such as `1500` is also accepted. |
| `clockMs` | number ≥ 0, or `null` | yes | The bot seat's remaining clock in ms, as the server's clock currently shows it. Fractions are rounded down (so a clock derived from `performance.now()` can be sent as is). `null` means untimed (see below). |
| `incrementMs` | number ≥ 0, or `null` | no, default `0` | Increment per move in ms (`null` = 0; fractions rounded down). |
| `seed` | integer 0…2⁶⁴−1 | no, default random | Seeds evaluation noise and the weak levels' deliberate mistakes. Pass something stable per game and ply (e.g. a hash of game id and ply) to make replays reproducible. JavaScript numbers are exact only up to 2⁵³. |

Unknown fields are rejected with `400 invalid_request`, so a misspelt field
(say `increment`) is caught instead of silently defaulting. Content-Type is
not checked. The body must be at most 64 KiB; anything larger gets `413`.

### Time budget and deadline

The service derives two numbers from the clock. Each response echoes both.

- **`budgetMs`**, the thinking time: `min(levelTarget, clockMs/30 + ¾·incrementMs, clockMs/10)`, and at least 1.
- **`deadlineMs`**, the time by which the service will have replied, counted from when the request arrived: `max(budgetMs, min(500, clockMs/30 + ¾·incrementMs, clockMs/10))`, and at least 1.

Level targets:

| Level | 600 | 900 | 1200 | 1500 | 1800 | 2100 | 2400 | max |
|---|---|---|---|---|---|---|---|---|
| Target (ms) | 30 | 35 | 25 | 80 | 150 | 250 | 400 | 500 |

Weak levels think briefly but may wait in the queue up to `deadlineMs`.

Searches stop before the deadline, leaving a margin of 10% of it (at most
50 ms) for the reply. Every search gets at least ⅛ of `budgetMs` (at least
1 ms); a request that cannot have that is answered `503
deadline_exceeded` instead of with a hasty move:

- at once, when every worker is busy until too close to its deadline;
- when a worker picks it up too late;
- at its deadline, if it is still queued then.

So, measured inside the service, every request is answered within
`deadlineMs`. The only exception is scheduling noise on an oversubscribed
host, typically a few ms. `timeMs` and `deadlineMs` count from when the
handler starts: TCP connect, accept and reading the request are not
included.

**Recommended client timeout:** `min(deadlineMs + 100, clockMs − 50)` ms:
network and event-loop slack, but never so long that waiting could flag the
bot. The game server can compute `deadlineMs` with the formula above before
sending. On timeout, treat the request like a 503.

**Very low clocks:** below about 150 ms of clock (with no increment),
`deadlineMs` is a few ms or less (1 ms below 60 ms), and the service will
often answer `503 deadline_exceeded` even when idle. Skip the service then
and play the fallback move locally.

**Connections:** use a keep-alive HTTP agent (Node: `new
http.Agent({ keepAlive: true, maxSockets: BOT_WORKERS + BOT_MAX_QUEUE })`).
Opening a new socket per request costs a handshake every move, and a burst
of new connections at round start can still overflow the listen queue.

**Untimed** (`clockMs: null`):

- `deadlineMs` is 500.
- Levels 600–2400 search to their node budget only, from a cleared table.
  With a `seed`, and when the service is not under load, the move is then a
  pure function of the request: the same as `bot_engine::choose_move(state,
  level, u64::MAX, incrementMs, seed)`.
- `max` uses its 500 ms target.

### `200 OK`

```json
{
  "move": "c2b3",
  "score": -281,
  "depth": 4,
  "nodes": 36501,
  "timeMs": 369,
  "queueMs": 0,
  "searchMs": 369,
  "budgetMs": 500,
  "deadlineMs": 500,
  "degraded": false,
  "pv": ["c2b3", "b5c5", "c11b10", "k3j2", "b3a4", "c5d5", "c12c1", "l3a3"]
}
```

| Field | Meaning |
|---|---|
| `move` | The move in rules-core notation: `<from><to>[promo]`, e.g. `c2b3`, `c6c7q`, `a10a12`; castling is written as the leader's move (`g1i1`). It is legal in `position`. Apply it through rules-wasm like a human move. |
| `score` | Centipawns from the bot seat's view (FFA) or its team's view (Teams). `\|score\| ≥ 990000` (`bot_engine::MATE_BOUND`) means a forced leader capture or elimination is found; it is then `±(1000000 − plies)`. Always within `±1000000`. |
| `depth` | Deepest completed iteration. In FFA this counts BRS layers. `0` means either the only legal move was returned without a search, or the first iteration was cut short (rare: a very short budget on a busy position); the move is then the best of the root moves searched so far and `score` is its depth-1 score, never an unsearched pick. |
| `nodes` | Nodes searched. |
| `timeMs` | Time inside the service, from receipt to reply. Always `≤ deadlineMs` apart from host scheduling noise. |
| `queueMs` | Time spent waiting for a worker. |
| `searchMs` | Engine time. |
| `budgetMs`, `deadlineMs` | See above. |
| `degraded` | `true` if the search got clearly less time or nodes than an unloaded search would have (budget cut for load, or a late start after queueing). The move is still legal and on time, just weaker. |
| `pv` | Principal variation in notation. It starts with `move`. It is a single move when a weak level deliberately picked a non-best move. |

The service does not charge the clock. The game server measures the
round-trip itself and deducts it from the bot's clock as it would for a
human.

### Errors

Every error has a JSON body `{"error": "<code>", "message": "<detail>"}`,
except the framework's 404 and 405, which return plain text.

| Status | `error` | When | Game-server action |
|---|---|---|---|
| 400 | `invalid_request` | Malformed JSON, a missing field (`position`, `level`, `clockMs`), an unknown field, or a wrong type such as a negative or string clock. | A bug in the caller: log it and play a fallback move. |
| 400 | `invalid_level` | The level is not one of the eight labels. | Same. |
| 400 | `invalid_position` | The position string does not parse or fails rules-core validation. | Same. |
| 409 | `game_over` | The position is already finished. | Do not ask for a move. |
| 409 | `no_legal_move` | Defensive: the engine found no move. It cannot happen for a valid, unfinished position, because rules-core guarantees the seat to move has a legal move. | Treat like `game_over` and log it. |
| 503 + `Retry-After: 1` | `overloaded` | Every worker is busy and `BOT_MAX_QUEUE` requests are already waiting. Answered immediately. | Play a fallback move now (see below). |
| 408 | `body_timeout` | The body did not arrive within 5 s of the headers. | A caller or network problem: play a fallback move. |
| 413 | `body_too_large` | Body over 64 KiB. | A bug in the caller. |
| 503 + `Retry-After: 1` | `deadline_exceeded` | No worker can give the search its minimum time before `deadlineMs`. Answered at once when that is already clear (every worker busy until too late), otherwise at the latest at the deadline. | Play a fallback move now. |
| 503 + `Retry-After: 1` | `shutting_down` | The service is stopping. | Play a fallback move now. |
| 500 | `internal` | The search panicked. This is a bug: the worker survives and the request is logged. | Play a fallback move. |
| 404 / 405 | (plain text) | Unknown route or wrong method. | |

### Load-shedding contract for the game server

1. **Never wait past the deadline.** Every request ends by `deadlineMs`,
   either with a move or with a 503. The bot's clock is never burned
   waiting for the bot service.
2. **On any 503, a timeout or a connection error, play a quick fallback
   move locally and do not retry that move.** By the time `Retry-After`
   (1 s) passes, the move is long overdue. Pick the fallback with
   rules-core through rules-wasm, never with rules re-implemented in
   TypeScript. Suggested fallback, cheapest first:
   1. capture an opponent's leader if possible;
   2. otherwise take the highest-value capture;
   3. otherwise play a random legal move.
3. **Keep asking for later moves.** The service recovers as soon as the
   queue drains. Back off only when 503s repeat: once you see a 503, wait
   `Retry-After` seconds before sending further requests for that game.
   Play fallbacks in the meantime.
4. **Stop seating new bots when saturated.** PLAN §6 says to refuse new bot
   seats under saturation. Do that while 503s are frequent, or while
   `/metrics` shows `bot_queue_depth` near `BOT_MAX_QUEUE`.
5. A `degraded: true` move is valid and on time, just from a shallower
   search. Use it normally.

How the service sheds load internally:

- A worker that takes a job while other jobs still wait caps its search
  time and node budget. The cap is set so every waiting job can still
  start in time to search as long itself, counting when the other
  workers' running searches end. The cap is never below ⅛ of the budget.
- Quick weak-level searches are almost never cut.
- Jobs whose client disconnected or timed out are dropped from the queue
  (they never hold a slot that a live request needs).
- Small transposition tables (levels ≤ 2100) are cleared after every move,
  so a result depends only on its request.
- 2400 and max keep a warm 16 MB table per worker across timed requests;
  an untimed 2400 request clears it first.

## `GET /healthz`

Returns `200` with the plain-text body `ok\n` while the process is serving.
Use it for liveness and readiness probes. The distroless image has no shell
or curl, so probe from the orchestrator.

## `GET /metrics`

Plain text in the Prometheus exposition style:

```text
bot_requests_total 80535          # POST /v1/move received
bot_ok_total 80535                # 200s
bot_bad_request_total 0           # 400s (and 408/413 for slow or oversized bodies)
bot_game_over_total 0             # 409s
bot_shed_total 0                  # 503s (sum of the next two)
bot_shed_queue_full_total 0       #   queue full / shutting down
bot_shed_deadline_total 0         #   no worker could start the search in time
bot_internal_errors_total 0       # 500s
bot_degraded_total 870            # moves searched with clearly less than an unloaded budget
bot_cancelled_total 0             # queued jobs dropped after the client went away
bot_nodes_total 124233021
bot_in_flight 0                   # gauge: move requests being handled
bot_queue_depth 0                 # gauge: jobs waiting for a worker
bot_workers 12
bot_workers_busy 0                # gauge
bot_uptime_seconds 72
bot_http_responses_total{code="200"} 80535   # every HTTP response by status,
bot_http_responses_total{code="405"} 2       # all routes (incl. 404/405/413)
bot_latency_ms{quantile="0.5"} 399   # end-to-end, answered moves, last 2048
bot_latency_ms{quantile="0.95"} 490
```

(The `#` comments above are for this README. The real output uses
`# HELP` lines.) The `bot_*_total` counters other than
`bot_http_responses_total` cover `POST /v1/move` only. Connections closed
for malformed HTTP or a header timeout produce no response and are not
counted.

## Throughput

Measured with `examples/loadgen.rs` on the 12-core dev machine, release
build, `BOT_WORKERS=12`:

- positions from random play, half FFA and half Teams;
- a 10-minute clock, so each level gets its full target;
- the load generator running on the same machine.

Other jobs kept the machine at a load average of 14–40 during these runs,
so treat the numbers as lower bounds.

| Level | Concurrency | Requests/s | p50 / p95 latency (ms) | Notes |
|---|---|---|---|---|
| 600 | 24 | 6,200–6,900 | 2 / 10 | |
| 1200 | 24 | 530–660 | 43 / 74 | |
| 1500 | 24 | 205 | 115 / 150 | |
| 1800 | 24 | 92–97 | 258 / 320 | |
| 2400 | 12 | 34–35 | 344 / 436 | Full 400 ms budget. |
| 2400 | 36 | 80–104 | 340 / 400 | Budgets cut under load (`degraded`). |
| max | 12 | 29–32 | 371 / 477 | |
| max | 120 | 150 answered + immediate 503s | 401 / 459 | The queue (48) is full and the excess is shed. |

To reproduce:

```sh
cargo run --release -p bot-service &
cargo run --release -p bot-service --example loadgen -- 127.0.0.1:7700 1500 24 10 mixed 600000
#   args: addr level concurrency seconds ffa|teams|mixed clockMs
```

In real games a bot moves only on its own turns, and a human takes seconds
per move. So one worker serves many concurrent games, roughly
`think-time × moves-per-second`, in line with PLAN §6.

## Code map

- `src/api.rs`: handlers and wire types.
- `src/pool.rs`: worker threads, the EDF queue, deadlines, load scaling and
  withdrawal.
- `src/metrics.rs`: counters and the latency window.
- `src/config.rs`: environment parsing.
- `src/main.rs`: runtime, logging and signals.
- `tests/service.rs`: in-process HTTP tests, including concurrency,
  shedding and graceful shutdown.
- `examples/loadgen.rs`: the load generator.
