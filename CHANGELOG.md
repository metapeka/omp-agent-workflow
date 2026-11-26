# Changelog

All notable changes to `omp-agent-workflow`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
semantic for the plugin contract, not for OMP itself.

## [0.5.23] — 2026-11-26

### Added

- F3 metrics in `/handoff-preflight` (read-only, no contract change):
  - `HANDOFF.md` size against the 32k handoff limit, warning above 24k;
  - session cache hit, reasoning share of the last turn and session spend
    from the root session JSONL (`lib/session-metrics.ts`);
  - plan progress, next task with gate/deps, attempts and run spend from
    `AUTOPLAN.md`/`STATE.json`; a missing plan is not a warning.
- `lib/session-metrics.ts` streams the JSONL in 1 MiB chunks, counts only
  `message.assistant.usage` (service `model_usage` records are not chat),
  and keeps UTF-8 intact across chunk boundaries.
- Preflight reads the state file once and passes the text to the advisory
  parser instead of re-reading it.

### Deferred

- Price estimate of the handoff boundary stays out of preflight: recorded
  `usage.cost` rates for one model varied ~2× within a single session
  (flash $0.35–1.02 per 1M output tokens) and list prices from
  `omp models --json` differ ≈1.6×. It needs the cache-monitor price table
  (`costs --json`), not a local guess.

### Fixed

- `usage-last` keeps the session spend row when the last usage record has
  `output: 0` (aborted turn) instead of dropping reasoning and cost together.
- The plan check reads `STATE.plan.path` (a `--plan PATH` run) instead of
  always `AUTOPLAN.md`; a state pointing at a missing plan is a warning.
- `formatTokens` switches to `M` from 999 500, so near-1M values no longer
  render as `1000k`.
- The UTF-8 chunk-boundary test now splits a multibyte character across the
  1 MiB boundary and compares the parsed content.

### Docs

- `docs/research/workflow-presets.md` (F3 status and evidence),
  `model-modes.md` (boundary row), preflight sections in
  `docs/commands.md` and `docs/contracts.md`, wiki, ROADMAP, TODO, HANDOFF.

## [0.5.22] — 2026-11-26

### Added

- Launch presets `routine`, `plan`, `review`, `budget`: model, thinking,
  context thresholds and continue prompt. `bin/omp-yoda --preset NAME`
  strips the flag, applies `--model`/`--thinking` unless the user passed
  them, exports the preset prompt for the supervisor/extension, and cancels
  the `next-session:` advisory for that launch.
- Settings key `workflowPreset` (14th, default `off`), env
  `OMP_WORKFLOW_PRESET`; `OMP_PRESET_OVERRIDE` is the launcher-only channel
  so an explicit `--preset` beats Settings. Per-key precedence:
  Settings > env > preset > mode/default.
- `lib/presets.ts` is the single preset table; `bin/omp-preset` computes
  flags (model only if `omp models --json` lists it) and the prompt.
- `plan` continue prompt asks the next session to record a
  `next-session: model=flash mode=routine` advisory; `review` asks for a
  diff review; `routine`/`budget` keep the default prompt.

### Docs

- D16, `docs/research/workflow-presets.md` (F2 done), `docs/contracts.md`
  (14 settings), `docs/commands.md`, README badges, wiki and HANDOFF.
- `docs/research/cache-monitor-costs-api.md`: requested `costs --json` v1
  for 0.6 economics; no parsing of cache-monitor internals.
- Owner decision: publication stays local (D10); `autoCompactPercent=40`
  applied in the owner's Settings.

## [0.5.21] — 2026-11-26

### Added

- `plan.execution: "omp" | "external"` in `AUTOPLAN.md`. Absent means `omp`
  and keeps the legacy plan hash, so existing plans and active states are
  compatible. `external` names Ensemble (`agent-team`) as the task owner:
  `start`, `verify`, `finish`, and `rebase` return `stop: external-run`
  before lock/state/worktree, leaving `STATE.json` and worktrees untouched.
  `status`, `next`, `doctor`, handoff, `stop`, and `resume` still work.
  Unknown values fail plan parsing like `backend`.
- `doctor`: `execution=external` without an active Ensemble run warns (also
  when `agent-team` is unavailable); an active run is `pass`; an active run
  plus `STATE.run.active` stays `warn two owners`.
- Tests: legacy plan hash, explicit `omp`/`external` hashes, invalid value,
  all four refusals without state/worktree, CLI `start` stop, and doctor
  external warn/pass.

### Docs

- `docs/decisions.md` D15, `docs/contracts.md`, `docs/orchestrator.md`,
  `docs/commands.md`, and `docs/AUTOPLAN.example.md` describe the field and
  its guards.

## [Unreleased]

### Docs

- Contract tests for the hub: `status --json` envelope and stable plan/state
  fields (with and without `STATE.json`), unknown additive plan fields, and
  the `doctor --json` envelope/check shape.
- Short product name **OAW** (`omp-agent-workflow`) is defined once in
  `AGENTS.md` (terms table), all three READMEs, the wiki and `HANDOFF.md`.
  `workflow` keeps meaning the modes/keys (`workflowMode`, status key), not
  a second product name.

### Added

- `docs/commands.md` — full command guide: slash commands, the
  `orchestrator` tool actions, preflight menu, `/wrap` cards, launcher and
  supervisor CLI, and the files each command touches. Linked from the wiki,
  the contracts and all three READMEs.
- `docs/research/market-landscape.md` (+ Russian and Chinese translations):
  public landscape of PI, OMP and GitHub, closest analogues, feature
  prevalence, and positioning conclusions. Linked from the READMEs, the
  wiki index and the roadmap.
- Upstream Orca issue `stablyai/orca#47665` documenting that
  `orca worktree rm` sends SIGTERM to a caller running inside the removed
  worktree.
- Static HTML explainer `docs/index.html` (EN, plus `ru/` and `zh/`) on
  prompt caching, sessions, handoff, and the 2026-11-24 incident; measured
  on a real 400-turn session. Linked from all three READMEs and served by
  GitHub Pages from `main /docs`.

## [0.5.20] — 2026-11-26

### Added

- `bin/omp-orchestrate doctor [--json] [--strict]` — read-only environment
  check with a fixed order of 16 checks: node/omp versions, linked plugin and
  settings, git repo/HEAD, `HANDOFF.md` size, `AUTOPLAN.md`, `STATE.json`,
  writable worktree root, Orca CLI, supervisor lock, terminal handle,
  cache-monitor, and an optional `agent-team status --json` probe. Each probe
  is capped at 2 s with a 9 s total budget, no network, nothing is written;
  missing Orca, agent-team,
  or cache-monitor yields `warn`/`skip`, not `fail`. `--strict` raises `warn`
  to `fail`; exit is 0 without `fail` and 1 with it. `--json` is contract v1
  (`schemaVersion: 1`, `ok`, `strict`, `summary`, `checks[]`).
- `schemaVersion: 1` at the top of `status --json`; stable fields are fixed
  in `docs/contracts.md`.
- Tests: golden check order and levels, PATH shims for `omp`/`orca`/
  `agent-team`, no-Orca exit 0 + warn, `--strict`, broken settings/plan/state,
  missing plan/HANDOFF, `workflowMode=off` skips, ensemble two-owners, CLI
  exit codes, and no home/temp paths in `detail`.

### Docs

- `docs/contracts.md` — CLI JSON v1 section: `status` stable fields, the
  `doctor` check table, exit codes, and non-contract fields.
- `docs/commands.md`, the wiki index, the orchestrator/operations pages, and
  all three READMEs mention `doctor`.

## [0.5.19] — 2026-11-25

### Added

- `next-session:` advisory line: an agent may put one line at the head of
  `HANDOFF.md` (`v=1 ts=… model=… thinking=… mode=… reason=…`). `bin/omp-yoda`
  validates it (format, 24 h freshness, model against `omp models --json`,
  thinking normalized to `auto` when outside the model catalog) and adds
  `--model`/`--thinking` at process start unless the user passed them
  explicitly. Explicit user flags win; invalid, stale, duplicated, or
  misplaced lines change nothing. `/handoff-preflight` shows the line and its
  validity but never switches anything; the plugin never changes the model
  inside a session.

## [0.5.18] — 2026-11-25

### Fixed

- `/handoff` is not registered by the plugin anymore: the name belongs to an
  OMP builtin (alias of `/compact handoff`), and OMP drops extension commands
  that shadow builtins. Command names are now guarded by
  `npm run check:names`, which parses the builtin registry from the pinned OMP
  package and fails `npm run verify` on a collision.

### Added

- `workflowMode: off` — kill switch that leaves OMP on its own defaults.
  The plugin publishes no status key, sends no warnings, writes no session
  info, and runs no handoff or compaction; explicit thresholds are ignored.
  `bin/omp-yoda` execs OMP unchanged (no supervisor, no env overrides), and
  `OMP_WORKFLOW_MODE=off` overrides Settings for emergencies.

## [0.5.17] — 2026-11-24

### Fixed

- Auto-compaction fallback no longer stays blocked after a stalled handoff.
  It waits while handoff retries remain, or while a marker is held by a live
  supervisor, then fires at `autoCompactPercent`. A marker with no live
  supervisor no longer disables the fallback.

## [0.5.16] — 2026-11-24

### Changed

- `.omp-handoff-session.json` is now a map
  `{ "sessions": [{ terminal, sessionFile, cwd, pid, updatedAt }] }` instead
  of one flat object. Entries merge by `pid` (a second live TUI session no
  longer loses its terminal handle) and dead pids are pruned on write. The
  flat 0.5.15 format is still read as a single entry.

### Fixed

- A short-lived `omp "…"` run in the same cwd can no longer overwrite the
  terminal handle of a live session. The supervisor selects the entry whose
  `sessionFile` matches the marker and ignores entries with a dead pid;
  without `sessionFile` it takes the newest live entry.
- Session info read-modify-write is serialized by
  `.omp-handoff-session.lock/` and written atomically (temp file + rename),
  so concurrent sessions cannot drop each other's records.
- `waitForNewSession` follows the selected entry by `pid`/terminal instead of
  assuming one global `sessionFile`.
- Orchestrator spend attribution (`sessionFileFromInfo`) reads the map format,
  preferring the current pid.

## [0.5.15] — 2026-11-24

### Changed

- `/handoff-new` state limit lowered from 64k to 32k characters. `omp toks`
  measures 2.1–3.0 characters per token on Russian text, so 64k characters
  was ~21–30k tokens, not the documented ~16k. 32k characters is ~10–15k
  tokens.
- READMEs, AGENTS and the wiki now state that all percentages are relative
  to the active model's context window (`ctx.getContextUsage().percent`),
  with 1M and 100k recalculations.

### Added

- In `yoda-supervised`, the handoff threshold now verifies the supervisor
  lock (`owner.json`: pid alive, same directory) and warns once if it is
  missing: `bash bin/omp-yoda --dir <cwd>`.
- Warn once per session when `ORCA_TERMINAL_HANDLE` is empty, because the
  supervisor cannot start a new session without a terminal handle.
- If the agent ends turns without writing the marker, the handoff request is
  repeated after 2 completed turns with a warning; after 3 requests the
  repeat loop stops.

### Fixed

- An empty or whitespace-only `ORCA_TERMINAL_HANDLE` is stored as `null`
  instead of an empty string in `.omp-handoff-session.json`.
- `supervisorEnabled` is now consumed by the extension, not only by the
  launcher and supervisor.

## [0.5.14] — 2026-11-23

### Fixed

- **Worktree cleanup can no longer kill a live session.** `removeWorktree`
  refuses the current worktree, any worktree with a process whose cwd is
  inside it, and any worktree with a live Orca terminal. Background:
  `orca worktree rm` stops the PTYs of the removed worktree; running it from
  inside that worktree sent SIGTERM to a live OMP session on 2026-11-23.
- Cleanup no longer passes `--delete-branch` to Orca or uses `git branch -D`.
  The branch is retained by default; an explicit `deleteBranch` uses
  `git branch -d` after a merged check.

### Added

- Preflight guard in `removeWorktree`: `merge-base --is-ancestor`, clean
  worktree, not base/current, no live processes or terminals.
- Branch tip backup in `refs/omp-worktree-backup/*` before removal.
- Retry of a failed task preserves unmerged commits by renaming the old
  branch to `<branch>-failed-<timestamp>` and starting a fresh one.
- `test/worktree-remove.test.mjs` covering merged/unmerged/dirty/current/
  live-process/live-terminal/backup-ref/branch deletion.
- Tri-lingual README (English, Chinese, Russian), diagrams, screenshots,
  and a real terminal demo GIF.
- GitHub release metadata (`repository`, `bugs`, `homepage`, `engines`).

### Changed

- `/wrap` cleanup delegates to the same safe core and keeps the branch.
- Documentation and AGENTS workflow no longer recommend raw
  `--delete-branch`; cleanup must run outside the target worktree.

## [0.5.13] — 2026-11-23

- Status key `workflow`: `SUP OFF` when the supervisor is missing and
  `T2 verify` for an active orchestrator task.

## [0.5.12] — 2026-11-23

- Status key `workflow` with `YODA` / `YODA-SUP` and `⚠ HANDOFF`;
  `statusEnabled` as the 13th Settings key; native `context_pct` untouched.

## [0.5.11] — 2026-11-23

- `/handoff-preflight`: read-first verdict, then a menu of only unresolved
  actions, then a structured summary.

## [0.5.10] — 2026-11-23

- `/handoff-preflight` action menu: checks, commit, ff-merge.

## [0.5.9] — 2026-11-23

- `/handoff-preflight` checklist before the checks table.

## [0.5.8] — 2026-11-23

- `/handoff-new` embeds the state file into the new session message
  (64k limit, truncation marker, read-error fallback).

## [0.5.7] — 2026-11-23

- Preflight hardening: repo errors, upstream comparison, `[file]` argument.

## [0.5.6] — 2026-11-23

- `/handoff-preflight`: read-only checks before `/handoff-new`.

## [0.5.5] — 2026-11-23

- Supervisor Settings: `continuePrompt`, retries, log level.

## [0.5.4] — 2026-11-23

- Settings → Plugins (9 keys at the time), Settings > env priority.

## [0.5.3] — 2026-11-23

- Additive Orca integration: `terminal list/show`, status warning,
  `ORCA_CLI_COMMAND`; OMP never requires Orca.

## [0.5.2] — 2026-11-23

- One supervisor per directory: lock, stale reclaim, identity guard.

## [0.5.1] — 2026-11-23

- `/wrap`: guided finish (handoff, cleanup, next worktree, retro-review).

## [0.5.0] — 2026-11-22

- Orchestrator A–D: `AUTOPLAN.md`, `STATE.json`, budgets, policy, actions,
  worktree backends, CLI and extension tools.

## [0.3.0] — 2026-11

- Context guard, `/handoff`, `/handoff-new`, supervisor marker protocol,
  automatic handoff, Yoda modes.

[0.5.14]: https://github.com/metapeka/omp-agent-workflow/compare/v0.5.13...v0.5.14
