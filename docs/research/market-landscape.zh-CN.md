# 市场概览：上下文守卫、交接（handoff）与 worktree 编排

[English](market-landscape.md) · [Русский](market-landscape.ru.md) · **简体中文**

日期：2026-11-23。范围：PI、OMP 与 GitHub 公开生态。问题：
是否存在与 `omp-agent-workflow` 功能组合相同的产品？

## 摘要

- 在三个生态中都**没有找到直接等价的产品**。
- 两个半边各自拥挤：上下文守卫/交接与多智能体编排都被反复实现，
  但几乎从未合在一起。
- OMP 已**内置** `/handoff`、自动压缩、`--max-cost` 以及
  `omp worktree add|list|clear`。本插件不注册 `/handoff`，而是在其上
  提供 `/handoff-new`、`/handoff-preflight` 与 supervisor。
- 没有项目同时具备：运行在 agent 进程之外的 supervisor、带预算与
  stop-gate 的确定性 plan/state 状态机、带 backup-ref 的 worktree
  清理守卫。
- 本次调研中的独有项：模式阶梯（`manual` → `assisted` → `yoda` →
  `yoda-supervised`）、与模式绑定的状态键、`/wrap` 式安全 GC。

表格中的功能代码：

| 代码 | 能力 |
|---|---|
| F1 | 上下文守卫：阈值、警告/压缩策略 |
| F2 | 交接：state 文档、在**新**会话中继续 |
| F3 | 工作流模式 / 监督策略 |
| F4 | 多智能体编排：计划、角色、门禁 |
| F5 | worktree 生命周期：创建、隔离、合并、清理 |
| F6 | 成本/预算核算与 stop-gate |
| F7 | 状态栏与设置界面 |

## 方法与局限

进行了三轮独立的只读调研（PI 目录、OMP marketplace 与插件生态、
跨 agent harness 的 GitHub 搜索），随后用包注册表、GitHub API、
OMP 源码（`can1357/oh-my-pi`，`main`，2026-11-23，release `v19.1.1`）
与本地 OMP 19.1.1 二进制逐项抽查。

局限：

- PI 包的下载量是 pi.dev 展示的 **npm 月下载量**，不是扩展安装数。
- 调研期间 `omp.sh/docs/*` 超时；OMP 行为改由仓库文档、源码与本地
  二进制确认。
- 星标、许可证与活跃度为 2026-11-23 的状态。未能从一手来源确认的
  数值标为 `[UNVERIFIED]`。
- 这是基于公开文档与源码阅读的能力对比，未运行基准测试。

## PI 生态

`pi.dev/packages` 约有 **5,344 个 npm 包**（2026-11-23）。PI 本体是
`@earendil-works/pi-coding-agent`（最新 1.6.0，2026-11-20；MIT；
本地安装 1.5.2）。

PI 内置、与本产品相关的部分：

- 当上下文超过 `contextWindow - reserveTokens` 时自动压缩（默认预留
  16,384 token），`/compact [instructions]`，按模型覆盖；
- 持久化 JSONL 会话树，支持 `--continue`、`--resume`、`/new`、
  `/fork`、`/clone`、`/tree`、`/export`；
- 页脚显示上下文用量与会话成本；
- **按设计没有** subagent 与 plan mode，也没有 worktree 生命周期。

| 项目 | 类型 | 热度（2026-11-23） | 重叠 | 相对本产品缺失 |
|---|---|---|---|---|
| [@woksin/pi-context-budget](https://github.com/woksin/pi-context-budget) | 扩展 + CLI | 3.1K/月，0★，v0.13.0 | F1、F2、F7 | F3–F6 |
| [pi-handoff-chain](https://github.com/martintsan/pi-handoff-chain) | 扩展 | 52/月，v1.2.0 | F1、F2 | F3–F6 |
| [pi-posthorse](https://github.com/fitchmultz/pi-posthorse) | 扩展 | 9.3K/月，289★，v0.10.39 | F1（rollover，无摘要） | 新会话 F2、F3–F6 |
| [pi-cowboy](https://github.com/electric-dragon-80000v/pi-cowboy) | 扩展 | 5.1K/月，67★，v0.39.0 | F4、F5 | F1–F3、F6；清理会删除分支 |
| [pi-spine](https://github.com/beettlle/pi-spine) | 扩展 + CLI | 2.3K/月，3★，v2.33.1 | F4、F5 | F1–F3、F6 |
| [@quintinshaw/pi-dynamic-workflows](https://github.com/QuintinShaw/pi-dynamic-workflows) | 扩展 + SDK | 82.5K/月，595★，v3.15.3 | F4 | F1–F3、F5、F6 |
| [pi-orchestrator-config](https://github.com/myk-org/pi-config) | 扩展 + agent | 11.3K/月，9★，v5.0.0 | F3、F4、F5 | F1、F2、F6 |
| [@sassywares/pi-extensions](https://github.com/sassywares/sassy-pi-extensions) | 扩展合集 | 2.8K/月，v0.4.4 | F2、F4 | F1、F3、F5、F6 |
| [pi-sessions](https://github.com/thurstonsand/pi-sessions) | 扩展 | 5.2K/月，16★，v0.24.0 | F2、F7 | F1、F3–F6 |
| [@adlc/context-handoff](https://github.com/voodootikigod/adlc) | CLI + hooks | 13.3K/月，v1.13.0 | F1、F2 | F3–F6；PI 门禁默认关闭 |

PI 中最接近的项目：`@woksin/pi-context-budget`（守卫 + 交接 + 继续）、
`pi-handoff-chain`（watermark → reset → 以 `HANDOFF.md` 启动新会话），
以及编排方向的 `@quintinshaw/pi-dynamic-workflows`。它们都没有把两半
合起来，也没有 supervisor 或清理守卫。

## OMP 生态

**没有中央插件注册表。** Marketplace 是任何包含
`.omp-plugin/marketplace.json` 的 git 仓库（或本地目录、直接 JSON URL）；
Claude Code 的 `.claude-plugin/marketplace.json` 可作为 fallback。
安装方式为 `omp plugin marketplace add <source>` 加
`omp plugin install <plugin>`，或 `omp install npm:<package>`。
共发现约 30 个公开目录（`anthropics/claude-plugins-official`、
`oh-my-pi` 衍生目录、社区目录如 `sethforprivacy/omp-plugins`、
`AppVerk/av-marketplace`、`kodlian/omp-jeremy`、
`btspoony/mstar-harness` 等）。

OMP 19.1.1 内置（已在 `can1357/oh-my-pi` 与本地二进制中确认）：

- `/handoff [focus]` 是**内置**命令，实现为压缩模式
  （`builtin-lifecycle.ts`）；`handoff` 位于默认
  `compaction.methodOrder`（`remote, snapcompact, handoff, shake,
  soft`）；默认触发基于预留（大窗口约 85%）。
- `/compact`、自动压缩、provider-native 与 image-based 策略。
- `--warn-cost` 与 `--max-cost`（print mode 下退出码 3）。
- Subagent（`task`、Agent Hub）、`--resume`/`--restore` 会话、
  `omp worktree add|list|clear`（`clear --all` 连活跃记录一起删除）。
- **没有**新会话交接、工作流模式、带预算的 plan/state 文件、清理守卫。

| 项目 | 类型 | 热度（2026-11-23） | 重叠 | 相对本产品缺失 |
|---|---|---|---|---|
| OMP builtin | 内置 | v19.1.1，MIT | F1、F2（会话内）、F4、F5（无守卫）、F6（成本上限）、F7 | 新会话 F2、F3、F5 守卫、计划预算 |
| [context-relay](https://github.com/Ship-With-AI/context-relay) | hooks + 扩展 | 0★，2026-10-26 | F1、F2 | F3–F6 |
| [omp-self-compact](https://github.com/priaculun/omp-self-compact) | 插件 | 0★，2026-10-11 | F1、F7 | F2–F6 |
| [continuity](https://github.com/thewolff/jo-wolff-plugins) | 插件 | 1★，2026-11-20 | F1、F2 | F3–F6 |
| [strategium](https://github.com/frandev94/strategium) | 插件 | 0★，v0.2.51 | F3、F4、F6、F7 | F1、F2、F5 守卫 |
| [mstar-harness](https://github.com/btspoony/mstar-harness) | 插件 + CLI | 73★，2026-11-23 | F3、F4、F5、F7 | F1、F2；预算为建议性 |
| [omp-jeremy](https://github.com/kodlian/omp-jeremy) | 4 个插件 | orchestrator v0.6.1 | F4、F5 | F1–F3、F6 |
| [omp-fabric](https://github.com/tickernelz/omp-fabric) | 插件 | 17★，2026-11-23 | F4、F6 | F1–F3、F5 |
| [omp-compact](https://github.com/arksdev/omp-compact) | 插件 | 16★，v2.5.4 | 无 — 仅展示 | 全部；与上下文压缩同名但无关 |
| [orca-omp-agent-panel](https://github.com/Tautcius/orca-omp-agent-panel) | 扩展 + Orca 面板 | 0★ | F7（只读 UI） | 其余全部 |

OMP 中最接近的项目：`context-relay`（约 60% 自动交接、`HANDOFF.md`、
重启，但停留在 hook 层）与 `strategium`（编排器、agent、门禁、
cost debrief，但没有上下文守卫与跨会话交接）。`omp-self-compact`
是唯一专注上下文守卫的同类。

## GitHub：相邻 harness

检索覆盖 Claude Code、Codex、OpenCode、Cline、Gemini CLI、Aider 与
Amp，来源为 GitHub search 与一手仓库。

| 项目 | 类型 | 热度（2026-11-23） | 重叠 | 相对本产品缺失 |
|---|---|---|---|---|
| [pf-handoff](https://github.com/turvodnik/pf-handoff) | hook kit（Claude Code + Codex） | 6★，2026-10-27 | F1（40/60/75%）、F2（原地）、F7 | 新会话 F2、F3–F6 |
| [claude-auto-handoff](https://github.com/alexknowshtml/claude-auto-handoff) | hooks | 128★，v0.8.6 | F1、新会话 F2 | F3–F6 |
| [Continuous-Claude-v3](https://github.com/parcadei/Continuous-Claude-v3) | hooks、skills、记忆 | 3,950★，2026-11-16 | F1（部分）、F2、F4（部分） | F5、F6；前置依赖重 |
| [claw-orchestrator](https://github.com/Enderfga/claw-orchestrator) | 独立 runtime | 617★，v7.22 | F4、F5（部分）、F6、F2（部分） | F1、F3、F5 守卫 |
| [pi-toolkit](https://github.com/Newbluecake/pi-toolkit) | PI 扩展 | 5★，2026-11-20 | F1（75/88%）、F2（原地）、F4、F6 | F3、F5 守卫、新会话交接 |
| [fresh-session-continuation](https://github.com/erans/fresh-session-continuation) | PI 扩展 | 7★，2026-11-05 | F2 | F1、F3–F6 |
| [powercontext](https://github.com/oceanbase/powercontext) | context server | 1,793★，v1.6.0 | F2（正式协议） | F1、F3–F6；偏重 |
| [deja-vu](https://github.com/vshulcz/deja-vu) | MCP/CLI 记忆 | 1,658★，2026-11-23 | F2（经记忆） | F1、F3–F6 |
| [cachetoast](https://github.com/rhunterharris/cachetoast) | 插件/安装器 | 6★，2026-10-21 | F1（按成本）、F2、F6（部分） | F3–F5 |

其他存在但未排名：`mstar-harness`、`omp-best-of`、`claude-handoff`、
`ccompactor`、`dougs-ai-tools`（Apache-2.0，40% 区间，有运行中 job 时
拒绝）、`catchup`（跨 harness 转录迁移）。

## 各能力的普遍程度

| 能力 | 普遍程度 | 证据 |
|---|---|---|
| 交接文档 / state 文件 | 非常普遍（约 20+ 项目） | pf-handoff、Continuous-Claude-v3、deja-vu、powercontext、catchup、ccompactor |
| 百分比上下文阈值 | 罕见（3 个工具） | pf-handoff 40/60/75、pi-toolkit 75/88、dougs context-nudge 40% |
| 自动交接至**新**会话 | 罕见（3 个） | claude-auto-handoff、fresh-session-continuation、cachetoast |
| agent 进程之外的 supervisor | **未发现** | — |
| 工作流模式阶梯 | **没有**（只有权限模式） | pi-automode 等只是权限预设 |
| 计划 + 预算 + stop-gate | 罕见 | claw-orchestrator（`maxBudgetUsd`）、strategium、mstar-harness（建议性） |
| 带清理守卫的 worktree 生命周期 | **没有**；竞品只做隔离与合并 | pi-cowboy 清理时删除分支；OMP `clear --all` 删除活跃记录 |

## 对本产品的结论

1. **不要把 handoff 当作差异化卖点。** OMP 与 PI 都已内置压缩与
   交接原语；OMP 的 `/handoff` 是内置命令，本插件有意不注册它。
   价值在于 `/handoff-new` + `/handoff-preflight` + supervisor 及其
   策略。
2. **独有组合**：确定性三区策略（Settings > env > 模式）、由 agent
   进程之外的**非 LLM** watcher 执行交接、可逆性（仅 ff-only 合并，
   拒绝 dirty/unmerged/current/live worktree，分支 tip 保存在
   `refs/omp-worktree-backup/*`）。
3. **短板是发现渠道。** OMP 没有中央注册表，PI 目录极其庞大；
   通过 marketplace 目录发布并提供清晰的对比页，比再增加一个功能
   更重要。
4. **值得关注的方向**：按成本轮换（cachetoast）、跨子 agent 的硬性
   USD ledger（omp-fabric、claw-orchestrator）、跨 harness 交接
   （catchup、pi-cowboy）、正式交接协议（powercontext）。

## 来源

- 目录：`https://pi.dev/packages`（2026-11-23）；各包的 npm registry
  元数据；`https://github.com/earendil-works/pi`。
- OMP：`https://github.com/can1357/oh-my-pi` —
  `docs/marketplace.md`、`docs/compaction.md`、
  `docs/handoff-generation-pipeline.md`、`docs/settings.md`、
  `docs/cli-reference.md`、`docs/agent-hub.md`；
  `packages/coding-agent/src/slash-commands/builtin-lifecycle.ts`；
  本地 `omp --version` 19.1.1 与 `omp worktree --help`。
- GitHub API（`api.github.com`）查询星标、push 日期与许可证，
  时间 2026-11-23。
- `[UNVERIFIED]`：部分小型仓库的许可证与星标；未直接阅读厂商文档的
  Claude Code/Codex/Cline/Gemini/Aider 默认值。
