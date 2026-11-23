# Market landscape: context guard, handoff and worktree orchestration

**English** · [Русский](market-landscape.ru.md) · [简体中文](market-landscape.zh-CN.md)

Date: 2026-11-23. Scope: public PI, OMP and GitHub ecosystems. Question:
is there a product with the same feature bundle as `omp-agent-workflow`?

## TL;DR

- **No direct equivalent** was found in any of the three ecosystems.
- Individual halves are crowded: context guards/handoff and multi-agent
  orchestration are each implemented many times, but almost never together.
- OMP already ships `/handoff`, auto-compaction, `--max-cost` and
  `omp worktree add|list|clear` **as builtins**. Our plugin builds on the
  builtin `/handoff` and adds `/handoff-new`, `/handoff-preflight` and the
  supervisor.
- Nothing found implements all of: external supervisor outside the agent
  process, a deterministic plan/state machine with budgets and stop-gates,
  and a worktree cleanup guard with backup refs.
- Unique in this survey: mode ladder (`manual` → `assisted` → `yoda` →
  `yoda-supervised`), status key tied to the mode, `/wrap`-style safe GC.

Feature keys used in the tables:

| Key | Capability |
|---|---|
| F1 | Context guard: thresholds, warning/compaction policy |
| F2 | Handoff: state document, continuation in a **new** session |
| F3 | Workflow modes / supervision policy |
| F4 | Multi-agent orchestration: plan state, roles, gates |
| F5 | Worktree lifecycle: create, isolate, merge, cleanup |
| F6 | Cost/budget accounting with stop-gates |
| F7 | Status line and settings surface |

## Method and limitations

Three independent read-only research passes (PI catalog, OMP marketplace and
plugin ecosystem, GitHub-wide search across agent harnesses), followed by
spot checks against package registries, the GitHub API, the OMP sources
(`can1357/oh-my-pi`, `main` as of 2026-11-23, release `v19.1.1`) and the
locally installed OMP 19.1.1 binary.

Limitations:

- Download numbers for PI packages are **npm monthly downloads** shown on
  pi.dev, not install counts of the extension.
- `omp.sh/docs/*` timed out during research; OMP behaviour was confirmed from
  repository docs, source files and the local binary instead.
- Stars, licenses and activity are as of 2026-11-23. Values we could not
  confirm from a primary source are marked `[UNVERIFIED]`.
- This is a capability comparison based on public documentation and source
  reading. No benchmarks were run.

## PI ecosystem

`pi.dev/packages` lists about **5,344 npm packages** (2026-11-23). PI itself
is `@earendil-works/pi-coding-agent` (latest 1.6.0, 2026-11-20; MIT; our
local install is 1.5.2).

Builtin PI, relevant to this product:

- auto-compaction when the context exceeds `contextWindow - reserveTokens`
  (default reserve 16,384 tokens), `/compact [instructions]`, model
  overrides;
- persisted JSONL session tree with `--continue`, `--resume`, `/new`,
  `/fork`, `/clone`, `/tree`, `/export`;
- footer with context usage and session cost;
- **no** subagents or plan mode by design, no worktree lifecycle.

| Project | Type | Traction (2026-11-23) | Overlap | Missing vs this product |
|---|---|---|---|---|
| [@woksin/pi-context-budget](https://github.com/woksin/pi-context-budget) | extension + CLI wrapper | 3.1K/mo, 0★, v0.13.0 | F1, F2, F7 | F3–F6 |
| [pi-handoff-chain](https://github.com/martintsan/pi-handoff-chain) | extension | 52/mo, v1.2.0 | F1, F2 | F3–F6 |
| [pi-posthorse](https://github.com/fitchmultz/pi-posthorse) | extension | 9.3K/mo, 289★, v0.10.39 | F1 (rollover, no summary) | F2 in a new session, F3–F6 |
| [pi-cowboy](https://github.com/electric-dragon-80000v/pi-cowboy) | extension | 5.1K/mo, 67★, v0.39.0 | F4, F5 | F1–F3, F6; cleanup deletes the branch |
| [pi-spine](https://github.com/beettlle/pi-spine) | extension + CLI | 2.3K/mo, 3★, v2.33.1 | F4, F5 | F1–F3, F6 |
| [@quintinshaw/pi-dynamic-workflows](https://github.com/QuintinShaw/pi-dynamic-workflows) | extension + SDK | 82.5K/mo, 595★, v3.15.3 | F4 | F1–F3, F5, F6 |
| [pi-orchestrator-config](https://github.com/myk-org/pi-config) | extension + agents | 11.3K/mo, 9★, v5.0.0 | F3, F4, F5 | F1, F2, F6 |
| [@sassywares/pi-extensions](https://github.com/sassywares/sassy-pi-extensions) | extension bundle | 2.8K/mo, v0.4.4 | F2, F4 | F1, F3, F5, F6 |
| [pi-sessions](https://github.com/thurstonsand/pi-sessions) | extension | 5.2K/mo, 16★, v0.24.0 | F2, F7 | F1, F3–F6 |
| [@adlc/context-handoff](https://github.com/voodootikigod/adlc) | CLI + hooks | 13.3K/mo, v1.13.0 | F1, F2 | F3–F6; PI gate off by default |

Closest PI matches: `@woksin/pi-context-budget` (guard + handoff +
continuation), `pi-handoff-chain` (watermark → reset → new session seeded with
`HANDOFF.md`), and, for orchestration, `@quintinshaw/pi-dynamic-workflows`.
None combines the two halves, and none has a supervisor or a cleanup guard.

## OMP ecosystem

There is **no central plugin registry**. A marketplace is any git repository
(or local directory, or direct JSON URL) containing
`.omp-plugin/marketplace.json`; Claude Code's `.claude-plugin/marketplace.json`
is accepted as a fallback. Installation is `omp plugin marketplace add <source>`
plus `omp plugin install <plugin>`, or `omp install npm:<package>`. About 30
public catalogs were found
(`anthropics/claude-plugins-official`, `oh-my-pi` derivatives, community
marketplaces such as `sethforprivacy/omp-plugins`, `AppVerk/av-marketplace`,
`kodlian/omp-jeremy`, `btspoony/mstar-harness`, …).

Builtin OMP 19.1.1 (verified in `can1357/oh-my-pi` and the local binary):

- `/handoff [focus]` is a **builtin** command implemented as a compaction
  mode (`builtin-lifecycle.ts`); `handoff` is in the default
  `compaction.methodOrder` (`remote, snapcompact, handoff, shake, soft`);
  the default trigger is reserve-based (≈85% for large windows).
- `/compact`, automatic compaction, provider-native and image-based
  strategies.
- `--warn-cost` and `--max-cost` (exit code 3 in print mode).
- Subagents (`task`, Agent Hub), sessions with `--resume`/`--restore`,
  `omp worktree add|list|clear` (`clear --all` also removes live entries).
- **No** handoff into a new session, no workflow modes, no plan/state file
  with budgets, no cleanup guard.

| Project | Type | Traction (2026-11-23) | Overlap | Missing vs this product |
|---|---|---|---|---|
| OMP builtin | builtin | v19.1.1, MIT | F1, F2 (in-session), F4, F5 (no guard), F6 (cost cap), F7 | F2 new session, F3, F5 guard, plan/state budgets |
| [context-relay](https://github.com/Ship-With-AI/context-relay) | hooks + extension | 0★, 2026-10-26 | F1, F2 | F3–F6 |
| [omp-self-compact](https://github.com/priaculun/omp-self-compact) | plugin | 0★, 2026-10-11 | F1, F7 | F2–F6 |
| [continuity](https://github.com/thewolff/jo-wolff-plugins) | plugin | 1★, 2026-11-20 | F1, F2 | F3–F6 |
| [strategium](https://github.com/frandev94/strategium) | plugin | 0★, v0.2.51 | F3, F4, F6, F7 | F1, F2, F5 guard |
| [mstar-harness](https://github.com/btspoony/mstar-harness) | plugin + CLI | 73★, 2026-11-23 | F3, F4, F5, F7 | F1, F2; budgets advisory |
| [omp-jeremy](https://github.com/kodlian/omp-jeremy) | 4 plugins | orchestrator v0.6.1 | F4, F5 | F1–F3, F6 |
| [omp-fabric](https://github.com/tickernelz/omp-fabric) | plugin | 17★, 2026-11-23 | F4, F6 | F1–F3, F5 |
| [omp-compact](https://github.com/arksdev/omp-compact) | plugin | 16★, v2.5.4 | none — display only | all; name collision with context compaction |
| [orca-omp-agent-panel](https://github.com/Tautcius/orca-omp-agent-panel) | extension + Orca panel | 0★ | F7 (read-only UI) | the rest |

Closest OMP matches: `context-relay` (automatic handoff around 60% with a
`HANDOFF.md` and restart, but hook-level) and `strategium` (orchestrator,
agents, gates, cost debrief, but no context guard and no cross-session
handoff). `omp-self-compact` is the only dedicated context-guard peer.

## GitHub-wide (adjacent harnesses)

Searched Claude Code, Codex, OpenCode, Cline, Gemini CLI, Aider and Amp
ecosystems via GitHub search and primary repositories.

| Project | Type | Traction (2026-11-23) | Overlap | Missing vs this product |
|---|---|---|---|---|
| [pf-handoff](https://github.com/turvodnik/pf-handoff) | hook kit (Claude Code + Codex) | 6★, 2026-10-27 | F1 (40/60/75%), F2 (in-place), F7 | F2 new session, F3–F6 |
| [claude-auto-handoff](https://github.com/alexknowshtml/claude-auto-handoff) | hooks | 128★, v0.8.6 | F1, F2 new session | F3–F6 |
| [Continuous-Claude-v3](https://github.com/parcadei/Continuous-Claude-v3) | hooks, skills, memory | 3,950★, 2026-11-16 | F1 (partial), F2, F4 (partial) | F5, F6; heavy prerequisites |
| [claw-orchestrator](https://github.com/Enderfga/claw-orchestrator) | standalone runtime | 617★, v7.22 | F4, F5 (partial), F6, F2 (partial) | F1, F3, F5 guard |
| [pi-toolkit](https://github.com/Newbluecake/pi-toolkit) | PI extension | 5★, 2026-11-20 | F1 (75/88%), F2 (in-place), F4, F6 | F3, F5 guard, new-session handoff |
| [fresh-session-continuation](https://github.com/erans/fresh-session-continuation) | PI extension | 7★, 2026-11-05 | F2 | F1, F3–F6 |
| [powercontext](https://github.com/oceanbase/powercontext) | context server | 1,793★, v1.6.0 | F2 (formal protocol) | F1, F3–F6; heavyweight |
| [deja-vu](https://github.com/vshulcz/deja-vu) | MCP/CLI memory | 1,658★, 2026-11-23 | F2 (via memory) | F1, F3–F6 |
| [cachetoast](https://github.com/rhunterharris/cachetoast) | plugin/installer | 6★, 2026-10-21 | F1 (cost-driven), F2, F6 (partial) | F3–F5 |

Also present but not ranked: `mstar-harness`, `omp-best-of`,
`claude-handoff`, `ccompactor`, `dougs-ai-tools` (Apache-2.0, 40% bands,
refuses while jobs run), `catchup` (cross-harness transcript transfer).

## How common each capability is

| Capability | Prevalence | Evidence |
|---|---|---|
| Handoff document / state file | Very common (~20+ projects) | pf-handoff, Continuous-Claude-v3, deja-vu, powercontext, catchup, ccompactor |
| Percentage-based context thresholds | Rare (3 tools) | pf-handoff 40/60/75, pi-toolkit 75/88, dougs context-nudge 40% |
| Automatic handoff into a **new** session | Rare (3) | claude-auto-handoff, fresh-session-continuation, cachetoast |
| External supervisor outside the agent process | **None found** | — |
| Workflow mode ladder | **None** (only tool-permission modes) | pi-automode and similar are permission presets |
| Plan state + budgets + stop-gates | Rare | claw-orchestrator (`maxBudgetUsd`), strategium, mstar-harness (advisory) |
| Worktree lifecycle **with cleanup guard** | **None**; competitors isolate and merge | pi-cowboy deletes the branch on cleanup; OMP `clear --all` removes live entries |

## Conclusions for this product

1. **Do not sell handoff as the differentiator.** OMP and PI both ship
   compaction and handoff primitives; OMP's `/handoff` is builtin and this
   plugin intentionally does not register it. The value is in
   `/handoff-new` + `/handoff-preflight` + the supervisor and in the policy
   around them.
2. **The unique bundle** is: deterministic 3-zone policy with
   Settings > env > mode precedence, handoff executed by a non-LLM watcher
   outside the agent process, and reversibility (ff-only merge, refuse
   dirty/unmerged/current/live worktrees, branch tip in
   `refs/omp-worktree-backup/*`).
3. **Discovery is the weak spot.** OMP has no central registry and PI's
   catalog is huge; publishing through a marketplace catalog and a clear
   comparison page matters more than another feature.
4. **Watch these directions:** cost-driven rotation (cachetoast), hard USD
   ledgers shared across subagents (omp-fabric, claw-orchestrator),
   cross-harness handoff (catchup, pi-cowboy), formal handoff protocols
   (powercontext).

## Sources

- Catalog: `https://pi.dev/packages` (2026-11-23); npm registry metadata for
  each package; `https://github.com/earendil-works/pi`.
- OMP: `https://github.com/can1357/oh-my-pi` —
  `docs/marketplace.md`, `docs/compaction.md`,
  `docs/handoff-generation-pipeline.md`, `docs/settings.md`,
  `docs/cli-reference.md`, `docs/agent-hub.md`;
  `packages/coding-agent/src/slash-commands/builtin-lifecycle.ts`;
  local `omp --version` 19.1.1 and `omp worktree --help`.
- GitHub API (`api.github.com`) for stars, push dates and licenses,
  queried 2026-11-23.
- `[UNVERIFIED]` items: some small-repo licenses and stars; exact Claude
  Code/Codex/Cline/Gemini/Aider defaults where vendor docs were not read
  directly.
