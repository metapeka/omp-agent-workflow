# Contributing

Thanks for taking a look. This is a small, opinionated workflow plugin; the
most useful contributions are bug reports with a reproducible OMP/Orca setup
and focused fixes with tests.

## Ground rules

- **One behavior change, one test.** Tests use real temporary git
  repositories and never call a model or a live Orca by default.
- **Docs in the same change.** If a command, threshold, file, or safety rule
  changes, update `README.md`, `README.zh-CN.md`, `README.ru.md`, and the
  relevant `docs/*.md` in the same commit.
- **No runtime dependencies.** The plugin must keep working with Node
  built-ins only. Dev dependencies are typescript and type definitions.
- **Never commit runtime files:** `STATE.json`, `.omp-handoff-*`,
  `.omp-orchestrator.lock*`, session logs, or secrets.

## Local checks

```bash
npm ci
npm run check:names
npm test
npm run typecheck
```

`npm run check:names` fails when a plugin slash command shadows an OMP
builtin; builtin names win and the extension command is dropped.

Extension smoke test:

```bash
omp --no-extensions -e ./index.ts -e ./orchestrator.ts \
  --no-session --mode json -p 'Reply with exactly: OK'
```

## Safety-sensitive areas

Changes touching context thresholds, handoff markers, supervisor locks, or
worktree removal need extra care:

- Context compaction must wait for `turn_end` and `ctx.isIdle()`.
- A handoff must never be triggered from a tool loop or an unfinished edit.
- Cleanup must keep the `merged + clean + not current + no live
  process/terminal` guard and retain the branch by default.
- `orca worktree rm` stops the PTYs of the removed worktree. Never run
  cleanup from inside the target; the guard exists because of the
  2026-11-23 SIGTERM incident.

## Pull requests

1. Describe the user-visible behavior and the failure mode.
2. Add or update the narrowest test that catches it.
3. Run `npm run check:names`, `npm test` and `npm run typecheck`.
4. Keep unrelated refactors out of the PR.

## Reporting issues

Include:

- OMP version (`omp --version`), Node version, OS;
- whether Orca is enabled and its version;
- the command/sequence, expected result, actual result;
- relevant `STATE.json`/marker excerpts with secrets removed.

Security-sensitive reports: open a minimal issue without secrets, or contact
the maintainer through the repository profile.
