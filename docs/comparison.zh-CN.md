# 对比：`omp-agent-workflow` 与相邻工具

[English](comparison.md) · [Русский](comparison.ru.md)

日期：2026-11-27（产品 0.7.3）。能力数据来自公开文档与源码阅读，调研于
2026-11-23 完成——[市场概览](research/market-landscape.zh-CN.md)。这是能力
对比，**不是基准测试**：没有跨工具测量延迟或 token，表中的“无”表示“不是
该工具文档中的重点”，而不是“差”。

本页回答的问题：**什么时候这个插件是合适的层，什么时候别的工具更合适？**

## 这个插件不是什么

- **不是编码代理，也不是模型。** 它是 OMP 的 workflow 层；模型和代理仍由
  你掌握。
- **不是 `/compact` 的替代品。** 在 `assisted` 模式下，压缩仍由 OMP 自己
  负责；handoff 路径针对的是需要结束整个会话、而不只是历史的场景。
- **不是多代理运行时。** 任务由 `AUTOPLAN.md` 中的一条 `current` 记录驱动。
  如果外部团队运行器负责任务，请设置 `plan.execution: external`，OAW 会拒绝
  `start/verify/finish/rebase`，而不是竞争（[决策](decisions.md)）。
- **不是成本保证。** 报告中的每一美元都是会话 JSONL 中实测的
  `usage.cost.total`；不提供价格的提供商会显示 `null`，而不是估算。

## 与 OMP 内置能力对比

OMP 19.1.1 已提供很强的基础；插件有意不再注册 `/handoff`。

| 能力 | OMP 内置 | `omp-agent-workflow` |
|---|---|---|
| 会话内压缩 / handoff | `/compact`、`/handoff`（压缩模式）、接近窗口上限的自动阈值 | 在此基础上构建；`/handoff-new` 结束会话并用 state 文件播种新会话 |
| 带状态的会话边界 | — | `/handoff-new` 嵌入 `HANDOFF.md`（最多 32k 字符）和 continue prompt；`/handoff-preflight` 先检查 state |
| 按模型的策略 | 调用级参数、`--max-cost`、`--warn-cost` | 5 种模式（`off`/`manual`/`assisted`/`yoda`/`yoda-supervised`）与 15 个 Settings 键，阈值为窗口百分比 |
| 按实测支出轮换 | `--max-cost` 结束打印模式 | `handoffAtSpendUsd` 依据 `usage.cost.total` 触发同一 handoff 路径，带 cooldown |
| worktree 生命周期 | `omp worktree add\|list\|clear` | 计划 → worktree → 验证 → ff-merge；cleanup 在 merged/clean/current/live 违规时拒绝，并保留 backup ref |
| 编排状态 | — | `AUTOPLAN.md` + `STATE.json`、预算、stop-gates、`/wrap` |
| handoff 的经济性 | — | `omp-orchestrate economics [--summary]`，沿 `parentSession` 链 |

只用内置能力的情况：会话很短、`/handoff` 已够用、不需要 state 文档和外部
watcher。插件的价值在边界：长任务、多个会话、想要看清的钱。

## 与最接近的插件对比

2026-11-23 调研覆盖 PI 目录、OMP 各市场与 GitHub；完整方法与全部条目见
[市场概览](research/market-landscape.zh-CN.md)。

| 项目 | 重点 | 与 OAW 的重叠 | 差异 |
|---|---|---|---|
| `context-relay`（OMP 插件） | 约 60% 时自动 handoff，使用 `HANDOFF.md` 并重启 | guard、handoff | 钩子级；没有外部守护进程、模式、计划状态和 cleanup 守卫 |
| `omp-self-compact`（OMP 插件） | 专门的 context guard 展示 | guard | 没有跨会话 handoff 和编排 |
| `strategium`（OMP 插件） | 带代理、门禁、成本复盘的编排器 | 编排、预算 | 没有 context guard 和跨会话 handoff |
| `mstar-harness`（OMP 插件） | 代理团队、worktree、状态 | 编排、worktree | 预算只是建议而非强制；没有向新会话的 handoff |
| `pi-context-budget`、`pi-handoff-chain`（PI） | guard + handoff + 续接 | guard、handoff | PI 运行时而非 OMP；没有守护进程、计划状态和 cleanup 守卫 |
| `cachetoast`（PI） | 按成本驱动轮换 | 按花费轮换 | 没有计划/worktree/验证循环和 cleanup 守卫 |
| `claude-auto-handoff`（Claude Code 钩子） | 向新会话 handoff | handoff | 其他运行时的钩子；没有 OMP Settings 和进程外守护进程 |

整体上最接近：`context-relay` 覆盖 guard/handoff 一半，`strategium` 覆盖
编排一半。没有任何一个同时结合策略层、代理进程之外的 watcher 和可回滚的
worktree 循环——这个组合正是插件存在的理由。

## 如何选择

- **本插件** — 长跑任务会超出上下文窗口；一次任务包含多次 handoff；工作
  不能丢失；需要一套确定性策略而不是每会话临时决定。
- **只用 OMP 内置** — 会话短、单一模型、`/handoff` 足够、不需要 state 文档。
- **`context-relay`** — 只需要自动 guard-and-restart 钩子，不需要监督和计划
  状态。
- **`strategium` / `mstar-harness`** — 你要的就是团队运行器。它们可以与 OAW
  共存：把计划标为 `execution: external`，OAW 保留上下文与 handoff，任务交给
  运行器。
- **PI 相邻工具（`pi-*`）** — 不同运行时；策略不能跨 harness 移植。

## 自行验证这些说法

每条说法都可在本地验证，插件本身提供证据：

```bash
omp plugin list --json                                  # 已加载的插件
omp plugin config list omp-agent-workflow --json        # 15 个 Settings 键
bin/omp-orchestrate doctor --json                       # 16 项只读检查
bin/omp-orchestrate economics --summary --json          # 链上实测支出
```

契约：[contracts.md](contracts.md)；守卫图：[guards.md](guards.md)；
preflight 语义：[commands.md](commands.md)。

## 安装

```bash
omp plugin marketplace add metapeka/omp-agent-workflow
omp plugin marketplace list          # 用于安装的市场名称
omp plugin install omp-agent-workflow@<marketplace>
```

本地检出同样可用：`omp plugin link /path/to/omp-agent-workflow`。
目录文件位于 [`.omp-plugin/marketplace.json`](../.omp-plugin/marketplace.json)，
并由测试与插件清单比对，因此宣传的版本不会与 `package.json` 脱节。
