# Comparison: `omp-agent-workflow` and its neighbours

[Русский](comparison.ru.md) · [简体中文](comparison.zh-CN.md)

Date: 2026-11-27 (product 0.7.3). Capability data: public documentation and
source reading, survey of 2026-11-23 — [market landscape](research/market-landscape.md).
This is a capability comparison, **not a benchmark**: no latency or token
numbers were measured across tools, and “no” means “not a documented focus of
that tool”, not “bad”.

The question this page answers: **when is this plugin the right layer, and
when is something else a better fit?**

## What this plugin is not

- **Not a coding agent and not a model.** It is a workflow layer for OMP; you
  keep your model and your agent.
- **Not a replacement for `/compact`.** In `assisted` mode OMP's own
  compaction stays in charge; the handoff path exists for the case where the
  session itself should end, not only its history.
- **Not a multi-agent runtime.** Tasks are driven by one `current` entry in
  `AUTOPLAN.md`. If an external team runner owns the tasks, set
  `plan.execution: external` and OAW refuses `start/verify/finish/rebase`
  instead of competing ([decisions](decisions.md)).
- **Not a cost guarantee.** Every dollar in the reports is a measured
  `usage.cost.total` from the session JSONL; a provider that does not report
  cost shows `null`, not an estimate.

## Against the OMP builtins

OMP 19.1.1 already ships a strong baseline; the plugin deliberately does not
re-register `/handoff`.

| Capability | OMP builtin | `omp-agent-workflow` |
|---|---|---|
| In-session compaction / handoff | `/compact`, `/handoff` (compaction mode), automatic threshold near the window limit | builds on it; `/handoff-new` ends the session and seeds a new one with the state file |
| Session boundary with state | — | `/handoff-new` embeds `HANDOFF.md` (32k chars max) plus the continue prompt; `/handoff-preflight` verifies the state first |
| Policy per model | per-call flags, `--max-cost`, `--warn-cost` | 5 modes (`off`/`manual`/`assisted`/`yoda`/`yoda-supervised`) and 15 Settings keys, percent-of-window thresholds |
| Rotation on measured spend | `--max-cost` exits print mode | `handoffAtSpendUsd` triggers the same handoff path on `usage.cost.total`, with cooldown |
| Worktree lifecycle | `omp worktree add\|list\|clear` | plan → worktree → verify → ff-merge; cleanup refuses merged/clean/current/live violations and keeps a backup ref |
| Orchestration state | — | `AUTOPLAN.md` + `STATE.json`, budgets, stop-gates, `/wrap` |
| Economics of a handoff | — | `omp-orchestrate economics [--summary]` over the `parentSession` chain |

Choose the builtins alone when sessions are short, `/handoff` covers your
case, and you do not need a state document or an external watcher. The plugin
adds value at the boundary — long tasks, several sessions, money you want to
see.

## Against the closest plugins

Surveyed 2026-11-23 across the PI catalog, OMP marketplaces and GitHub; the
full method and all entries are in the
[landscape study](research/market-landscape.md).

| Project | Focus | Overlap with OAW | Where it differs |
|---|---|---|---|
| `context-relay` (OMP plugin) | automatic handoff around 60% with `HANDOFF.md` and restart | context guard, handoff | hook-level; no external supervisor, modes, plan state or cleanup guard |
| `omp-self-compact` (OMP plugin) | dedicated context-guard display | context guard | no cross-session handoff, no orchestration |
| `strategium` (OMP plugin) | orchestrator with agents, gates, cost debrief | orchestration, budgets | no context guard or cross-session handoff |
| `mstar-harness` (OMP plugin) | agent teams, worktrees, status | orchestration, worktrees | budgets advisory rather than enforcing; no handoff to a new session |
| `pi-context-budget`, `pi-handoff-chain` (PI) | guard + handoff + continuation | context guard, handoff | PI runtime, not OMP; no supervisor, plan state or cleanup guard |
| `cachetoast` (PI) | cost-driven rotation | rotation on money | no plan/worktree/verify loop, no cleanup guard |
| `claude-auto-handoff` (Claude Code hooks) | handoff into a new session | handoff | hooks for another harness; no OMP settings, no supervisor outside the session |

Closest overall: `context-relay` for the guard/handoff half, `strategium` for
the orchestration half. Neither combines a policy layer, a watcher outside
the agent process and a reversible worktree loop — that combination is the
reason this plugin exists.

## Choosing

- **This plugin** — long agent runs that outlive a context window, several
  handoffs per task, and work you cannot afford to lose; you want one
  deterministic policy instead of per-session improvisation.
- **OMP builtins only** — short sessions, one model, `/handoff` is enough,
  and you do not want a state document.
- **`context-relay`** — you only need an automatic guard-and-restart hook
  and are comfortable without supervision or plan state.
- **`strategium` / `mstar-harness`** — the team runner is the product you
  want. They can coexist with OAW: mark the plan `execution: external`, and
  OAW keeps context and handoff while the runner owns tasks.
- **PI peers (`pi-*`)** — a different runtime; the policies are not portable
  across harnesses.

## Verify the claims yourself

Every claim above is checkable locally, and the plugin ships the evidence:

```bash
omp plugin list --json                                  # what is loaded
omp plugin config list omp-agent-workflow --json        # the 15 Settings keys
bin/omp-orchestrate doctor --json                       # 16 read-only checks
bin/omp-orchestrate economics --summary --json          # measured chain spend
```

Design contracts: [contracts.md](contracts.md); guard map:
[guards.md](guards.md); preflight semantics: [commands.md](commands.md).

## Install

```bash
omp plugin marketplace add metapeka/omp-agent-workflow
omp plugin marketplace list          # the marketplace name to install from
omp plugin install omp-agent-workflow@<marketplace>
```

A local checkout works the same way: `omp plugin link /path/to/omp-agent-workflow`.
The catalog lives in [`.omp-plugin/marketplace.json`](../.omp-plugin/marketplace.json)
and is tested against the plugin manifest, so the advertised version cannot
drift from `package.json`.
