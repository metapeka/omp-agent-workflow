# omp-agent-workflow

**Deterministic context guard, true session handoff, and worktree orchestration for [OMP](https://github.com/oh-my-pi/pi-coding-agent).**

[English](README.md) · [简体中文](README.zh-CN.md) · [Русский](README.ru.md)

[![tests](https://img.shields.io/badge/tests-182%2F182-brightgreen)](test)
[![CI](https://github.com/metapeka/omp-agent-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/metapeka/omp-agent-workflow/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-0.5.14-blue)](package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![OMP](https://img.shields.io/badge/OMP-plugin-8a2be2)](package.json)

![Orchestrator loop demo](docs/assets/demo.gif)

*Real 13-second recording: `status → start → commit → verify → finish` on a throwaway git repo. The worktree is removed, the branch is kept.*

---

## 🧠 What it is

`omp-agent-workflow` is **not another coding agent**. It is the continuity and discipline layer around the agent you already use:

- 🧭 **Context guard** — warns at 35%, suggests a handoff at 50%, and triggers a deterministic action at 60/70% instead of hoping the model notices.
- 🔁 **Real handoff** — starts a **new session**, embeds `HANDOFF.md` + `STATE.json` into its first message, and continues the task. This is not `/compact` in the same thread.
- 👷 **External supervisor** — a plain Node watcher (not an LLM) that survives the OMP process and sends `/handoff-new` to the terminal handle when the marker appears.
- 🧩 **Orchestrator** — `AUTOPLAN.md` → worktree → implement → verify → fast-forward merge → safe cleanup → next task, with budgets, gates, and stop reasons in `STATE.json`.
- 🛡️ **Safe by default** — cleanup refuses dirty, unmerged, current, live-process, or live-terminal worktrees; the branch tip is saved in a backup ref.
- 🎛️ **Human-in-the-loop `/wrap`** — one menu to finish a session: handoff, cleanup, next worktree, retro-review.

It works with plain OMP. Orca is optional and additive.

---

## ✨ Why it is different

Most tools optimize **the model call**. This project optimizes **the session boundary** — the moment where agents usually lose decisions, waste context, or destroy work.

| # | Difference | What it means in practice |
|---|---|---|
| 1 | **Deterministic thresholds** | 35/50/60/70% are settings, not vibes. Same behavior on every model. |
| 2 | **Handoff to a fresh session** | The new session starts clean and receives the state file; the old one does not keep dragging a 500k-token history. |
| 3 | **Supervisor outside the agent** | If the OMP session dies, the watcher still exists. It is a file protocol + terminal handle, not a prompt. |
| 4 | **Plan → worktree → verify → merge** | Every task is isolated, checked, and merged ff-only. One `current` task; no silent parallel chaos. |
| 5 | **Cleanup that cannot self-destruct** | Live sessions and current worktrees are hard blockers; branches are retained by default; tips are recoverable. |
| 6 | **OMP-native, Orca-optional** | Settings live in OMP, status uses one extra key, and everything degrades gracefully without Orca. |

> In one sentence: **it makes long agent work resumable, bounded, and reversible.**

---

## 📊 How it compares

| Capability | **omp-agent-workflow** | Claude Code | Codex CLI | Aider | OpenCode | Cline | Orca |
|---|---|---|---|---|---|---|---|
| Context budget guard with configurable thresholds | ✅ deterministic 3-zone guard | ⚠️ manual `/compact` / `/clear` | ⚠️ compact + resume | ⚠️ repo map + token budget | ⚠️ built-in context handling | ⚠️ context management | — |
| Handoff to a **fresh** session with state embedded | ✅ new session + state file | ⚠️ resume/compact in the same thread | ⚠️ resume/fork | — | ⚠️ sessions, manual | — | — |
| External supervisor that survives the session | ✅ | — | — | — | — | — | — |
| Plan → worktree → verify → ff-merge loop | ✅ | ⚠️ manual / subagents | ⚠️ manual | ⚠️ manual commits | ⚠️ | ⚠️ | ⚠️ worktrees only |
| Cleanup guard + backup ref | ✅ merged/clean/current/live checks | — | — | — | — | — | ⚠️ worktree remove |
| Human-in-the-loop finish wizard | ✅ `/wrap` | ⚠️ | — | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Settings UI + env fallback | ✅ OMP Settings, 13 keys | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Works as a layer over OMP | ✅ | — own agent | — own agent | — own agent | — own agent | — own agent | ✅ host |

**Legend:** ✅ first-class · ⚠️ manual or partial · — not a documented first-class feature.

*Based on public vendor documentation as of November 2026. This is a capability comparison, not a benchmark. “—” does not mean a tool is bad; it means the capability is not its documented focus.*

### The unique combination

We have not found another tool that does **all five** together:

1. deterministic context budgets,
2. handoff to a **new** session with embedded state,
3. an **external** supervisor,
4. plan/worktree/verify/merge orchestration,
5. a cleanup guard that protects live sessions and keeps recovery cheap.

Each item exists somewhere. The product is the **glue and the guarantees**.

---

## 🔁 How it works

![Context lifecycle](docs/assets/lifecycle.svg)

### Handoff protocol (file-based, no magic)

1. The agent updates `HANDOFF.md`: goal, state, decisions, files, checks, next step.
2. At a safe boundary it writes `.omp-handoff-request.json` (marker).
3. The supervisor sees the marker and sends `/handoff-new` to the terminal handle from `.omp-handoff-session.json`.
4. `/handoff-new` builds a new session message from `continuePrompt` + the state file (64k limit, truncation marker, read-error fallback).
5. The new session reads `HANDOFF.md` and continues. No compact event in the middle of a tool loop; the plugin waits for `turn_end` and `ctx.isIdle()`.

```text
OMP session A ── marker ──▶ supervisor ── /handoff-new ──▶ OMP session B
      │                                                        │
      └──────────── HANDOFF.md + STATE.json ───────────────────┘
```

### Orchestrator loop

![Orchestrator loop](docs/assets/orchestrator-loop.svg)

```bash
bin/omp-orchestrate status
bin/omp-orchestrate start T1
# agent works in the printed worktree, commits, returns the SHA
bin/omp-orchestrate verify T1
bin/omp-orchestrate finish T1 --commit <sha> --review ok
```

`finish` merges **ff-only** into a clean base, records the commit, then removes the worktree — but only if the cleanup guard agrees. Otherwise it returns a warning and keeps the worktree.

### `/wrap` — finish like a human

![wrap menu](docs/assets/tui-wrap.png)

The wizard shows the facts first, then offers only actions that make sense. Cleanup candidates must be merged, clean, non-current, outside the base repo, and free of live processes or Orca terminals. Confirmation includes path, branch, and HEAD.

---

## 🚀 Quick start

**Requirements:** Node.js 22+, OMP 19+, git. Orca is optional.

```bash
# 1. get the code
git clone https://github.com/metapeka/omp-agent-workflow.git
cd omp-agent-workflow

# 2. install dependencies and verify
npm ci
npm test
npm run typecheck

# 3. link it as an OMP plugin
omp plugin link "$PWD"
omp plugin list

# 4. start OMP with the recommended mode
bin/omp-yoda                  # supervisor + OMP in yoda-supervised
# or, without the launcher:
OMP_WORKFLOW_MODE=yoda omp
```

Then use:

```text
/handoff              # update HANDOFF.md + request a handoff
/handoff-preflight    # check blockers/warnings before a new session
/handoff-new          # start a new session with the state embedded
/wrap                 # finish the task: cleanup, next worktree, retro-review
```

---

## ⚙️ Configuration

Settings → Plugins → `omp-agent-workflow`. Priority: **Settings > env > mode default**.

| Key | Default | Meaning |
|---|---|---|
| `workflowMode` | `assisted` | `manual` / `assisted` / `yoda` / `yoda-supervised` |
| `statusEnabled` | `true` | Show the `workflow` status key |
| `handoffAtPercent` | `55` (yoda) / off | Handoff threshold; `0` = off |
| `handoffCooldownSeconds` | `300` | Cooldown after a handoff |
| `contextWarnPercent` | `35` | First warning |
| `contextSuggestPercent` | `50` | Suggest a handoff |
| `autoCompactPercent` | `60` / `70` / off | Auto-compaction threshold |
| `orcaEnabled` | `true` | Orca terminal checks; `false` falls back to git/`/proc` |
| `orcaPreflight` | `true` | Verify the terminal handle before handoff |
| `supervisorEnabled` | `true` | Start the supervisor from `bin/omp-yoda` |
| `continuePrompt` | built-in | First part of the new session message |
| `supervisorRetries` | `3` | Send/preflight retries |
| `supervisorLogLevel` | `info` | `quiet` / `info` / `debug` |

Env fallbacks: `OMP_WORKFLOW_MODE`, `OMP_STATUS_ENABLED`, `OMP_HANDOFF_AT`, `OMP_CONTEXT_*`, `OMP_HANDOFF_COOLDOWN_SECONDS`, `OMP_ORCA_ENABLED`, `OMP_ORCA_PREFLIGHT`, `OMP_SUPERVISOR_ENABLED`, `OMP_HANDOFF_PROMPT`, `OMP_SUPERVISOR_RETRIES`, `OMP_SUPERVISOR_LOG_LEVEL`, `ORCA_CLI_COMMAND`.

### Modes

| Mode | Auto-compaction | Handoff | Supervisor |
|---|---|---|---|
| `manual` | off | off | off |
| `assisted` (default) | 60% | off | off |
| `yoda` | 70% fallback | 55% | off |
| `yoda-supervised` | 70% fallback | 55% | ✅ |

### Status line

One extra key; native `context_pct` is not duplicated.

```text
YODA                  yoda mode
YODA-SUP              yoda-supervised, supervisor alive
YODA-SUP · SUP OFF    supervisor missing
YODA-SUP · T2 verify  orchestrator task T2 is being verified
YODA · ⚠ HANDOFF      handoff threshold reached
```

![workflow status key](docs/assets/tui-status.png)

---

## 🛡️ Safety model

- **No compaction mid-turn.** The plugin waits for `turn_end` and `ctx.isIdle()`.
- **One current task.** Parallel tasks are intentionally rejected in 0.5.
- **Merge is ff-only.** Divergence becomes `rebase-required`, not a silent merge commit.
- **Cleanup is conservative.** It refuses unmerged, dirty, current, live-process, and live-terminal worktrees.
- **Branches are retained by default.** The tip is saved in `refs/omp-worktree-backup/*`; deletion is explicit and uses `git branch -d`.
- **Orca kills PTYs of the removed worktree.** Cleanup from inside the target is a hard error: that is exactly the 2026-11-23 incident where `orca worktree rm` sent SIGTERM to a live OMP session.
- **No runtime dependencies.** Only Node built-ins; dev dependencies are typescript and type definitions.

Detailed engineering notes: [`docs/operations.md`](docs/operations.md), [`docs/decisions.md`](docs/decisions.md) (Russian).

---

## 🧩 Commands

| Command | What it does |
|---|---|
| `/handoff` | Update state and request a handoff at a safe boundary |
| `/handoff-preflight [file]` | Read-only checks + a menu of only unresolved actions |
| `/handoff-new [file]` | Start a new session with `continuePrompt` + state file |
| `/wrap` | Human-in-the-loop finish: cleanup, next worktree, review, handoff |
| `/orchestrate status\|next\|start\|verify\|finish\|rebase\|stop\|resume` | Orchestrator control |
| `bin/omp-yoda` | Launcher: supervisor + OMP in `yoda-supervised` |
| `bin/omp-handoff-supervisor.mjs` | External marker watcher (not an LLM) |
| `bin/omp-orchestrate` | Headless CLI for the same actions |

---

## 🖼️ Screenshots

### `/wrap` — finish the task

![wrap](docs/assets/tui-wrap.png)

The card is enabled only when a merged, clean, non-current worktree without live terminals exists. Everything destructive asks for confirmation.

### `/handoff-preflight` — know before you switch

![preflight](docs/assets/tui-preflight.png)

Blockers are **advisory**: they explain what is missing and offer only actions that are still open. `/handoff-new` does not secretly block on them.

### Real CLI: plan → verify → merge

![orchestrate](docs/assets/terminal-orchestrate.png)

### The supervisor is a watcher, not a model

![supervisor](docs/assets/terminal-supervisor.png)

> The CLI speaks Russian today; JSON output is language-neutral. Localization is on the roadmap.

---

## 📚 Documentation and layout

| Path | Contents |
|---|---|
| [`docs/README.md`](docs/README.md) | Engineering wiki (Russian): architecture, contracts, runbook |
| [`docs/orchestrator.md`](docs/orchestrator.md) | `AUTOPLAN.md`, `STATE.json`, budgets, stop gates |
| [`docs/operations.md`](docs/operations.md) | Install, supervisor, worktrees, incidents |
| [`docs/decisions.md`](docs/decisions.md) | Accepted decisions and rejected alternatives |
| [`docs/AUTOPLAN.example.md`](docs/AUTOPLAN.example.md) | Copy-paste plan template |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Local checks and safety-sensitive areas |
| [`HANDOFF.md`](HANDOFF.md) | Current project state and the SIGTERM incident analysis |
| [`ROADMAP.md`](ROADMAP.md) / [`TODO.md`](TODO.md) | Direction and backlog |

---

## ❓ FAQ and limitations

**Is it a coding agent?** No. It is a workflow layer for OMP. You still use your model and agent.

**Does it replace `/compact`?** No, it complements it. `assisted` mode still uses compaction; `yoda` prefers a handoff at 55%.

**Does it require Orca?** No. Orca adds terminal/worktree integration and richer live checks; without it, git and `/proc` fallbacks are used.

**Can I run parallel tasks?** Not in 0.5. One `current` task keeps merge, budgets, and handoff deterministic.

**Will it delete my branch?** Not by default. It keeps the branch and saves the tip in a backup ref. Deletion is explicit and only `git branch -d` after a merged check.

**Are the thresholds measured?** They are heuristics, configurable, and deterministic. Treat them as policy, not physics.

**Why is some UI Russian?** The project started in Russian. English/Chinese docs are the primary entry point now; UI localization is a separate task.

---

## 🧪 Development

```bash
npm ci
npm test          # 182 tests
npm run typecheck
```

Tests use real temporary git repositories, no live Orca or model calls. The extension smoke test:

```bash
omp --no-extensions -e ./index.ts -e ./orchestrator.ts \
  --no-session --no-tools --mode json -p 'Reply with exactly: OK'
```

Contributions: keep behavior changes covered by tests, update docs in the same commit, and never commit session/runtime files.

---

## 📄 License

MIT © 2026 metapeka. See [LICENSE](LICENSE).
