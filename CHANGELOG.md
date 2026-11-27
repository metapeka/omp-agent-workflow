# Changelog

All notable changes to `omp-agent-workflow`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
semantic for the plugin contract, not for OMP itself.

## [1.0.1] — 2026-11-27

Safety without a sandbox: the one reproduced data loss (uncommitted work of
a failed task) is closed, and backup refs get a read-only listing.

### Added

- **WIP snapshot before a forced removal.** `start` on a `failed` task
  removes its worktree with `force`; the backup ref keeps commits but the
  directory (and every uncommitted file in it) went with the removal. Now
  `removeWorktree` captures the dirty tree first: a patch of tracked changes
  plus untracked files (built through a throwaway `GIT_INDEX_FILE`, so the
  working tree and the real index are untouched) and a `.status` sidecar
  with branch, HEAD, `git status` and the restore command, under
  `$XDG_STATE_HOME/omp-agent-workflow/wip/` (`--wip-dir` overrides). A
  failed snapshot aborts the removal; the path is printed by `start`
  (`wip`, `wip-status`) and included in the error if the removal fails after
  the snapshot.
- **`omp-orchestrate refs [--json]`.** Read-only listing of
  `refs/omp-worktree-backup/*` (short sha, commit date, branch, subject,
  `schemaVersion: 1`), so a removed worktree's tip can be found without
  remembering `git for-each-ref`. Plans are optional: `baseRepo` comes from
  `AUTOPLAN.md` or the git common dir. Text output ends with the oldest ref,
  its age in days and a ready `git update-ref -d` command (no threshold and
  no automatic pruning: retention stays an owner decision).
- [`docs/recovery.md`](docs/recovery.md): what survives a removal, how to
  restore a branch from a backup ref and WIP from a snapshot, snapshot
  hygiene, and what is not recoverable (ignored files, the parent session
  JSONL OMP deletes on `newSession`).

### Changed

- `lib/orchestrator/actions.ts`: `start` returns an additive `wip` field
  (snapshot or `null`) and appends the snapshot path to a stop/handoff detail
  produced right after a failed-task reset.
- Docs: `docs/guards.md` (two new rows and sections), `docs/commands.md`
  (`refs`, `--wip-dir`), `docs/contracts.md` (`refs --json` v1),
  `docs/README.md` (recovery page and reading route), version bumped to
  1.0.1 in `package.json` and the marketplace catalog.

## [1.0.0] — 2026-11-27

First stable release: the plugin surface built in 0.5–0.7 is frozen as the
1.0 contract. No runtime behaviour changes.

### Added

- **Tarball install.** `npm pack` produces a self-contained package
  (extension entries, `lib/`, `bin/`, docs). Unpack it and run
  `omp plugin link <dir>/package`; no registry and no build step
  are involved. Release notes: [`docs/release-notes-1.0.0.md`](docs/release-notes-1.0.0.md).

### Changed

- The package now ships `.omp-plugin/marketplace.json` and
  `CONTRIBUTING.md`: the catalog can be added from an unpacked tarball, and
  the README links resolve inside the package.

### Fixed

- **CLI under `node_modules`.** Node refuses to strip types there
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), which broke
  `bin/omp-orchestrate` and silently disabled the launcher's preset/advisory
  calls in an `npm install` or marketplace copy. The CLI bodies moved to
  `lib/cli/{orchestrate,next-session,preset}.ts`; the `bin/` entrypoints are
  thin shims that register `lib/ts-loader.mjs`, which strips types through
  `node:module.stripTypeScriptTypes`. One code path, works from a clone, an
  unpacked tarball and `node_modules`.
- CLI bodies are typechecked now that they live under `lib/` (`ActionContext`,
  result unions, `numberFlag` signatures); behaviour is unchanged.
- README EN/RU/ZH: 15 Settings keys (was 14 in the header line), Node
  requirement 22.13+ (the strip API), test badge no longer claims 192/192.
- `docs/README.md`: the wiki version line no longer says 0.6.0.

### Tests

- `npm run verify` — 389 tests, typecheck, `check:names` (105 OMP builtins,
  5 plugin commands, 0 collisions).
- `test/package-run.test.mjs` (3): the runtime copied into a temp
  `node_modules/omp-agent-workflow` runs `--help`, reaches the plan loader
  and runs `next-session`/`preset` without the Node refusal.
- Tarball round trip on this machine: pack → extract → `omp plugin link`
  → `omp plugin list` 1.0.0, Settings schema 15 keys, `omp plugin doctor`
  ok, extension load exit 0, packaged `bin/omp-orchestrate doctor --json`
  exit 0, `bin/omp-yoda --version` exit 0.

### Packaging

- No build step and no runtime dependencies: the package ships the same `.ts`
  sources; the loader strips them at run time. `bin/omp-yoda` calls the CLI
  shims without a `--experimental-strip-types` flag.

## [0.7.4] — 2026-11-27

### Added

- **Subagent ledger.** `STATE.budgets.costTotals` stores each session file's
  measured contribution — root, nested subagent sessions, and sessions left
  behind after a handoff; `spendUsd` is their sum. The budget now covers what
  the whole agent tree spent, not only the visible root session.
- `status --json` gains an additive `spend` block: `measured`, `spentUsd`,
  `limitUsd`, `remainingUsd`, `exceeded` and `files[]{session,kind,spendUsd,
  readable}` with `kind` = `root`/`subagent`/`previous`; human `status`
  prints the same number. `status` stays read-only.
- Preflight's run row uses the same ledger projection (root + subagents)
  instead of the raw `state.budgets.spendUsd`.

### Fixed

- Compaction that rewrites a session JSONL in place no longer double-counts:
  `restarted` replaces the file's contribution instead of adding the re-read
  sum, which used to trigger a false `budget-spend`.
- The tail of the previous session (messages after the last action) is
  flushed before `run.sessionFile` switches on handoff, so the last stretch
  of work is no longer lost from the budget.
- `next` uses the same projection, so its read-only verdict matches the gate.

### Tests

- `test/ledger.test.mjs` (5): per-file deltas, rewrite replaces, previous
  sessions keep contributions, exceeded/remaining, `measured: false` when a
  known file disappears.
- `test/orchestrator.test.mjs` (+5): rewrite keeps spend exact, subagent
  spend stops `start`, previous-session tail is counted, `status` projects
  without writing, merge over the limit stops and blocks the next start.
- `test/contracts.test.mjs`: status envelope includes `spend`; shape and
  `null` without state.

### Docs

- `docs/orchestrator.md` (ledger, STATE-global scope, gates),
  `docs/contracts.md` (`spend` block), `docs/guards.md` (three threats),
  `docs/commands.md`, README EN/RU/ZH.

## [0.7.3] — 2026-11-27

### Added

- `.omp-plugin/marketplace.json`: OMP marketplace catalog `metapeka-omp` with
  one plugin entry (`source: "./"`, description, version, category, tags,
  homepage, license). `omp plugin marketplace add <path>` parses it and the
  marketplace registers under the catalog name; an install dry run resolves
  `omp-agent-workflow@metapeka-omp` to the plugin name and stops only at the
  already-linked name conflict.
- `docs/comparison.md` plus RU/ZH translations: a discovery page that compares
  the plugin with OMP builtins and the nearest OMP/PI plugins, adds “choose
  this when” guidance, self-verification commands and marketplace install.
  Capability data comes from the 2026-11-23 landscape survey; no new claims
  and no benchmarks.
- README EN/RU/ZH: marketplace install block next to `omp plugin link`, and
  the comparison link next to the landscape study; the wiki index lists the
  page.

### Tests

- `test/marketplace.test.mjs` (5): the identity fields OMP requires, `./`
  source resolving to a directory with a matching `package.json`, catalog
  version equal to the plugin version, case-insensitive unique plugin names,
  https homepage.

## [0.7.2] — 2026-11-27

### Added

- `omp-orchestrate economics --summary`: an aggregate over the whole chain on
  top of the per-border report — `sessions`, `handoffs`, `measuredSessions`
  (sessions actually read through `costs --json`), `boundaries`, `turns`
  (`null` when nothing was measured; a measured empty session is honest `0`),
  measured `spendUsd` (sum of turn prices over the measured sessions),
  `medianTurnUsd`, `avgBoundaryUsd` (mean first-turn price at a border) and
  `hitTrend` (mean before/after hit rate, `deltaPp`, `direction`
  `up|down|flat` at an inclusive 0.5 pp threshold). JSON gains an additive
  `summary` object; without the flag the report and its JSON are
  byte-identical.
- Human output prints the aggregate as a borderless
  `SESSIONS … BORDER` table above the boundary detail, with the `BORDER`
  ratio to a normal turn and a `hit: before → after` line.
- Missing measurements stay `null`: an unmeasured chain gets
  `сводка: измеренных цен ходов нет`, and a chain with prices for only part
  of its sessions gets `сводка: цены ходов прочитаны у N из M сессий`
  instead of presenting a lower bound as the total. No zeros are invented and
  the optional cache-monitor CLI stays optional.

### Tests

- `test/handoff-economics.test.mjs` (37): aggregate values on the two-session
  fixture, unchanged report without the flag, data-gated nulls without the
  CLI, partial-coverage note, inclusive `up|down|flat` threshold, rendered
  block plus retained detail, CLI `--summary` in both JSON and text.

### Docs

- README EN/RU/ZH, `docs/commands.md` (flag, text block, JSON contract).

## [0.7.1] — 2026-11-27

### Added

- **Quality gate in `/handoff-preflight`.** Six canonical `HANDOFF.md`
  sections from the README protocol (`goal`, `state`, `decisions`, `files`,
  `checks`, `next step`) are matched by ATX headings and synonyms, including
  the English template; headings inside fenced code are ignored. A complete
  state prints one `разделы 6/6` pass row, every missing section prints its
  own `warn` row, and a custom format without a single recognised heading
  prints one `нестандартный формат` row instead of six.
- **Compaction-after-state warning.** `readSessionMetrics` now records
  `lastCompactionAt` in the same JSONL pass; preflight warns when the latest
  compaction in the current session is newer than the `HANDOFF.md` mtime, and
  stays quiet once the state is rewritten after it.
- Quality-gate findings never change `ready`; each one carries a `fix` string
  that preflight prints as a separate step in the `вручную/агентом` block, so
  the finding is paired with a concrete action and remains skippable.

### Changed

- The compaction-record matcher is now exported by `lib/session-metrics.ts`
  and reused by `lib/handoff-economics.ts` instead of being duplicated.

## [0.7.0] — 2026-11-27

### Added

- `handoffAtSpendUsd` (15th Settings key) and `OMP_HANDOFF_AT_USD` — a second
  handoff trigger on measured session spend (`usage.cost.total` from the session
  JSONL), independent of the context percentage. `0`/`off` disables it; the
  precedence is Settings > env > preset > mode: presets never set the key, `off`
  mode forces `null`, and an explicit value works in `manual` the same way an
  explicit `handoffAtPercent` does.
- Spend is accumulated incrementally through `lib/orchestrator/cost.ts`: byte
  offsets per session file (root plus child sessions under `<root-stem>/`), so
  `turn_end` and `agent_end` read only the new tail — never the whole JSONL.
  `session_start`/`session_switch` reset offsets and spend to zero;
  `session_compact` keeps the measured spend but forces a full recompute before
  the status update, because OMP rewrites the JSONL in place. `CostRead` now
  reports `restarted` when a file shrank below its saved offset; the extension
  then recomputes the total instead of adding the re-read bytes twice. A
  missing or unreadable file changes nothing (the measured total and its
  trigger survive). Only measured money counts, never price-list estimates.
- The request text becomes `HANDOFF: spend $X из порога $Y.` (plus `; контекст …`
  when available) and the marker records `reason: "spend"`. When both triggers
  fire the reason stays `"context"` and the text carries both facts. Cooldown,
  retry cap, supervisor gate, prerequisite warnings and `⚠ HANDOFF` status are
  shared; the status key now also lights up at the spend threshold.
- Tests: `test/workflow-settings.test.mjs` +1 (precedence, `0`/`off`, `off`
  mode, presets, `manual`, fractional/out-of-range values);
  `test/context-guard.test.mjs` +16 (below/at the threshold, spend-only and
  both triggers with marker reasons, `0`/`off`, retry, reset on
  `session_start`/`session_switch`, child sessions, missing/unreadable file,
  in-place rewrite regression, the child-session cooldown branch, status after
  compaction, accumulation across turns, and a tail-only read proven by
  rewriting the consumed prefix); `test/orchestrator.test.mjs` +1
  (`restarted` is reported without changing `deltaUsd`).
- Docs: tri-lingual READMEs, `docs/contracts.md` (15 keys, marker reason
  `context|spend`, incremental spend invariant), `docs/guards.md`.

## [0.6.1] — 2026-11-27

### Added

- `omp-orchestrate economics [--session FILE] [--turns N] [--json] [--dir PATH]` —
  read-only "before/after handoff" report over the `parentSession` chain (up
  to 20 nodes; cycles and missing files become notes, never crashes). A border
  is only a child that carries the `custom_message/handoff` record, so
  subagent children never count.
- Per border: the median cost per turn and the cache hit rate
  (`cacheRead/(input+cacheRead)` over the window) of the last N parent turns
  against the first N child turns, the first child turn price, and
  `recoveryTurns` — consecutive cold turns (`cacheRead == 0`) before the first
  warm one. `delta` is the absolute difference; missing prices stay `null`.
  Turns come from `omp-cache-monitor costs --json` through the existing
  `lib/costs-client.ts` (no parsing of the neighbour's internals).
- Compaction detector over the whole chain: `type:"compaction"`,
  `customType:"compaction"`, or `model_usage` with a `compaction…` purpose;
  cost from `usage.cost.total` when present. Local data has no compactions
  yet, so the report says "no records" instead of inventing zeros — the
  output is data-gated.
- `--json` is the contract (`schemaVersion: 1`: `generatedAt`, `session`,
  `turnsWindow`, `chain[]`, `boundaries[]`, `compactions[]`, `notes[]`);
  `chain[].startedAt` and `boundaries[].at` are `null` when the session
  metadata has no `timestamp`. `--session-file` is accepted as an alias of
  `--session`. Without `--session` the freshest live
  `.omp-handoff-session.json` entry in `--dir` is used. Exit codes: 0 —
  report (including the no-CLI graceful skip with empty `boundaries` and a
  note), 1 — missing/unreadable session, 2 — bad arguments (an empty or
  non-integer `--turns` is rejected before the session is resolved).
- Sessions are read incrementally through `lib/session-metrics.ts`
  (`sessionLines`): 10–20 MB JSONL and a 20-node chain do not load whole
  files, and broken lines are still skipped.
- Tests: `test/handoff-economics.test.mjs` (30) — chain order, handoff vs
  subagent children, medians/hit/recovery/delta, `--turns` clamping and
  validation order, missing/broken parent, mutual and self cycles,
  `MAX_CHAIN_NODES` truncation, compaction records, latest live session,
  `--session-file`, exit codes and human output without JSON.

### Docs

- README EN/RU/ZH, `docs/commands.md` (flags and JSON contract), `ROADMAP.md`
  (0.6 item closed as data-gated), `HANDOFF.md` and `docs/next-session.md`.

## [0.6.0] — 2026-11-27

### Added

- `/handoff-preflight` shows the handoff border price from
  `omp-cache-monitor costs --json` (schemaVersion 1): the median provider cost
  of cold turns (`cacheRead == 0` after the first turn) against warm turns
  (`cacheRead > 0`), plus a per-model row when the session used more than one
  model. Values are actual `usage.cost.total`, never list-price estimates.
- `lib/costs-client.ts`: strict envelope validation, border medians and a
  graceful skip (no command, timeout 2 s, exit ≠ 0, broken JSON, another
  schema) — preflight then renders exactly as before and stays read-only.
- The CLI is discovered via `OMP_CACHE_MONITOR_CLI` or `omp-cache-monitor` in
  `PATH`; `omp plugin link` alone does not put the bin in `PATH`.
- Tests: `test/costs-client.test.mjs` (8) — envelope parsing, medians, first
  turn excluded, unknown price stays `null`, exit codes, missing CLI, and both
  preflight row modes.

## [0.5.26] — 2026-11-26

### Added

- Preflight offers a `push` action when the current branch has an upstream
  and unpushed commits: `git push` without `--force`, 120 s timeout, the
  remote ref never moves on rejection, and a branch without upstream gets no
  action (the warning stays). The action runs only when the user selects it
  in the menu, like `commit` and `merge`.
- Failed selected checks skip `push` in the same run; a failed `commit`
  skips it too.
- Tests: push happens and the remote ref matches HEAD, no action when the
  upstream is synced, rejected push keeps the remote ref, push skipped after
  failed checks.

### Docs

- `commands.md` menu table, FAQ answer on preflight pushing, `guards.md`
  row; version `0.5.26`.

## [0.5.25] — 2026-11-26

### Changed

- `/handoff-preflight` renders an aligned `GROUP  ST  DETAIL` table with
  runtime column widths and wrapped detail lines; the verdict is its own
  line (`✔ preflight: OK …` / `✘ preflight: блокеры …`).
- Terminals narrower than 70 columns fall back to icon-grouped blocks with
  the verdict and counts first (`▸ 💾 usage`, `▸ ⎇ git`), so the panel stays
  readable instead of wrapping a table.
- Status and action glyphs come from OMP's symbol vocabulary
  (`theme.symbol`): the `ascii` Symbol Preset prints `[+]`/`[!]`/`[-]` and
  drops icons, `nerd` uses Nerd Font glyphs, headless hosts get the Unicode
  fallback. Action marks moved from `✓ – ✗` to the same `✔ ⦸ ✘`.
- No colour: `notify` renders the whole notice in the dim theme colour.

### Tests

- Formatter tests for wide (table), narrow (groups) and ascii modes and for
  detail wrapping; command tests assert content instead of render mode.

## [0.5.24] — 2026-11-26

### Added

- The HANDOFF request carries a read-only working-tree snapshot: branch,
  short HEAD and up to six uncommitted paths (`M src/a.ts`, `?? b.md`),
  the rest folded into `и ещё N`. Runtime `.omp-handoff-*` files are
  excluded, the path list is capped at 300 characters, and the snapshot
  costs three git calls with 3 s timeouts and no repository writes. A clean
  tree says `изменений нет`; outside a git repository the line is omitted.
  `HANDOFF.md` remains the only thing the new session sees, so the request
  tells the agent to list the WIP there (`workingTreeSnapshot()` in
  `index.ts`).
- `docs/guards.md`: guard map (threat → guard → point in the cycle →
  version), the handoff cycle diagram with the 0.5.24 insertion, and the
  explicit limits of the snapshot.

### Changed

- Wiki index and navigation link `guards.md`; `handoff-flow.md` documents
  the snapshot; the FAQ answer on uncommitted work reflects it; the
  contracts invariants list it; README EN/RU/ZH step 2 names it.
- Version `0.5.24`, ROADMAP stage, TODO, HANDOFF and next-session state.

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

### Changed

- Preflight action results carry an explicit status: `✓` done, `–` skipped
  with a reason, `✗` failed. A skipped action no longer looks like success.
- Each selected action prints a `PREFLIGHT: …` line before it runs
  (`npm test/typecheck`, `git add + git commit`, `git merge --ff-only`).
- An empty commit-message input now accepts the placeholder
  (`handoff: перед сменой сессии`); cancelling the input is a skip.
- The commit-message dialog opens a multi-line editor prefilled with the
  model-drafted subject; the title names the changed files. Hosts without
  the editor fall back to the single-line input with the same draft.
- The commit-message dialog is pre-filled with a model-drafted subject:
  a short side turn (`runEphemeralTurn`, tools off, 80 tokens) sees
  `git status --short` and `git diff --stat`, and the empty input accepts
  its line. Hosts without side turns, errors and empty replies fall back to
  the placeholder.

### Fixed

- Preflight `commit` no longer fails with `paths are ignored` when runtime
  files are listed in `.gitignore` (GridSnap 2026-11-26): it adds everything,
  then unstages the runtime paths and aborts if any stay in the index.
- `usage-last` keeps the session spend row when the last usage record has
  `output: 0` (aborted turn) instead of dropping reasoning and cost together.
- The plan check reads `STATE.plan.path` (a `--plan PATH` run) instead of
  always `AUTOPLAN.md`; a state pointing at a missing plan is a warning.
- `formatTokens` switches to `M` from 999 500, so near-1M values no longer
  render as `1000k`.
- The UTF-8 chunk-boundary test now splits a multibyte character across the
  1 MiB boundary and compares the parsed content.

### Docs

- `docs/faq.md`: handoff without commits, preflight action statuses and
  reasons, the commit-message dialog, supervisor/`SUP OFF`, worktree cleanup,
  diagnostics; linked from the wiki index and README.
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

[1.0.1]: https://github.com/metapeka/omp-agent-workflow/compare/v1.0.0...v1.0.1
[0.5.14]: https://github.com/metapeka/omp-agent-workflow/compare/v0.5.13...v0.5.14
