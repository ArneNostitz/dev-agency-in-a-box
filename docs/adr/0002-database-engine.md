# ADR-0002: Database engine (SQLite now; Postgres at multi-node)

Status: accepted · 2026-06-22

## Context

The agency persists everything in SQLite via `node:sqlite` (`DatabaseSync`) — issues, runs, token
usage, activity, the change journal, settings, users, etc. All access goes through `getDb()` in
`src/db/connection.ts`; no module imports `node:sqlite` directly. The runner is a **single Node
process**: "agents" are async tasks drawn from a small concurrency pool (default 3), not separate
OS processes. The file-lock registry (`src/locks.ts`) and the scan loop are also in-process.

A recurring question is whether SQLite is the right choice given concurrent agents and write locks.

## Decision

**Keep SQLite for the single-node, self-hosted deployment.** It is the right fit: embedded (no DB to
operate), instant local reads, trivial backups, and it matches the single-process architecture. The
concurrency concerns are addressed by configuration, not by changing engines:

- `PRAGMA journal_mode=WAL` — readers and the single writer no longer block each other.
- `PRAGMA synchronous=NORMAL`, `busy_timeout=5000`, `temp_store=MEMORY`, `mmap_size` — throughput +
  no `SQLITE_BUSY` under the run pool + the dashboard poll.
- Indexes on the hot, growing tables (`token_usage`, `run_step`, `runs`, `activity`) + an hourly
  retention sweep for the purely-ephemeral ones.
- A transparent prepared-statement cache in `getDb()` (SQL string → reused `Statement`).

Writes are tiny and serialized through one process anyway; the real latency lives in the LLM calls
and git I/O, which dwarf any DB cost by orders of magnitude.

## The seam

`getDb()` is the **single engine seam** (marked `── DB ENGINE SEAM ──` in `connection.ts`). Every
`db/*.ts` module obtains its handle there and issues SQL through `.prepare()/.exec()`. Swapping the
engine means reimplementing that one function.

## When to move to Postgres

The trigger is **horizontal scale**: multiple runner instances/replicas sharing one database
(which lines up with the planned multi-user / multi-tenant work). SQLite on a shared or network
volume is unsafe (unreliable file locking, no real cross-process concurrency). At that point three
things change **together**:

1. **Engine → Postgres.** Reimplement the seam.
2. **In-memory locks → shared locks.** `src/locks.ts` (file claims + the structural barrier) is a
   single-process Map; it must move to the DB / a coordination service so claims hold across workers.
3. **In-process pool → a real job queue.** The dispatch pool (`src/pool.ts`) becomes a shared queue.

## Cost / known impedance mismatch

`node:sqlite` is **synchronous**; every Postgres client for Node is **async**. A Postgres backend
therefore cannot be a literal drop-in behind the current synchronous `getDb()` — the query helpers
and their callers would need to become async (or sit behind an async facade). This is deliberately
**not** done now: it is a large, risky change with no payoff for a single-node appliance. Keeping all
access funneled through the seam (already true) makes that future conversion localized rather than a
scattergun rewrite.

## Consequences

- Single-node installs get the embedded-DB simplicity and (post-tuning) no write-lock pain.
- The path to Postgres is documented and bounded; it is a scale-out project, not a config flag.
- Anyone tempted to `import "node:sqlite"` outside `connection.ts` should instead extend the seam.
