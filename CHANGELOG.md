# Changelog

All notable changes to `omp-agent-workflow`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
semantic for the plugin contract, not for OMP itself.

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
