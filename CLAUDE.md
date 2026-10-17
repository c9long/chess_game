# Instructions for AI assistants

## TODO.md is the single source of truth

- All planned work lives in [TODO.md](TODO.md).
- When the user says "add to to-do", append an item to the right section of TODO.md.
- When you complete an item, strike it through **in place** and add the date: `- ~~Item text~~ (done YYYY-MM-DD)`. Never delete items, and never use checkboxes.
- Make the TODO.md update part of the same change that completes the work.

## Where things are decided

- [docs/PLAN.md](docs/PLAN.md) is the approved master plan. §2 is the authoritative rules spec (rules version 2: the 16×16 board).
- Open rules questions are listed in TODO.md. Don't silently decide them in code; keep such behavior behind a rules-config flag.
- The display name comes only from `APP_NAME` in `packages/config`. Never hard-code the game title.
- Code and package names stay neutral (`rules-core`, `@game/*`). Don't put the game title in identifiers.

## Engineering rules

- The Rust `rules-core` crate is the only implementation of game rules. The browser, server, bots and future Unity client all call into it. Never re-implement rules in TypeScript or C#.
- The server is authoritative: it never trusts client-reported moves, clocks or results.
- Civ abilities will modify rules later, so keep the roster/leader/hook abstractions in `rules-core` intact, even though v1 uses the standard roster for every civ.
- Never use national flags (or flag-derived color layouts) for civilizations.
- Verify before claiming done: `cargo test`, `cargo clippy --all-targets -- -D warnings`, `pnpm check`.

## Commits
- As you code, or as agents complete their work, split the changes into logical commit chunks (one concern per commit, e.g. a crate, a package, docs, config), then commit and push straight to `main` on the remote (no feature branches unless asked).
- Never commit half-finished work that another agent is still editing. Parallel subagents don't commit themselves; the orchestrating session commits each piece once it is complete and verified.
- Use clear messages: a short imperative subject plus a body explaining the why when it isn't obvious.
- Never add AI attribution or watermarks anywhere: no "Generated with Claude Code" lines, no `Co-Authored-By: Claude` trailers, in commits, PRs, code or docs.

## Workflow scripts

- Wrap every `agent()` call in a retry helper. On a rate-limit or session-limit error, wait until the reset time (or a fixed backoff if the reset time is unknown), then retry up to 3 attempts.
- Never let a limit failure silently drop a step. If retries are exhausted, fail the run and report which steps are incomplete.
- Use `resumeFromRunId` so completed steps are served from cache on resume.
