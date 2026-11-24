# Changelog

All notable changes to `omp-agent-workflow`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
semantic for the plugin contract, not for OMP itself.

## [Unreleased]

### Added

- `docs/research/market-landscape.md` (+ Russian and Chinese translations):
  public landscape of PI, OMP and GitHub, closest analogues, feature
  prevalence, and positioning conclusions. Linked from the READMEs, the
  wiki index and the roadmap.
- Upstream Orca issue `stablyai/orca#47665` documenting that
  `orca worktree rm` sends SIGTERM to a caller running inside the removed
  worktree.

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
