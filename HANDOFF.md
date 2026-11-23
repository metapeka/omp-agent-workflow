# Передача: omp-agent-workflow

Дата: 2026-11-23. Основной репозиторий: `~/projects/omp-agent-workflow`.
`main`, версия `0.5.6`; ветка `feat/handoff-preflight` слита ff-only,
worktree удалён. Вики — `docs/README.md`; backlog — `TODO.md`.

## Что готово

| Что | Состояние |
|---|---|
| Context guard | warning 35%, HANDOFF 50%, `/handoff`, `/handoff-new`, `/handoff-preflight` |
| Workflow modes | `manual` / `assisted` / `yoda` / `yoda-supervised` |
| Automatic handoff | session info, marker, supervisor, continuation prompt |
| Supervisor singleton | lock, stale reclaim, identity guard, release на сигналах |
| Launcher | читает Settings; supervisor гейт; warning по Orca |
| Orchestrator 0.5 | `AUTOPLAN.md`, `STATE.json`, actions, policy, budgets |
| Wrap 0.5.1 | `/wrap`, safe cleanup, next worktree, review |
| Orca additive 0.5.3 | terminal list/show, `status`, `ORCA_CLI_COMMAND` |
| Settings 0.5.4–0.5.5 | 12 ключей в Settings → Plugins |
| Preflight 0.5.6 | `/handoff-preflight`: read-only git/state/marker, блокеры и warnings |
| Проверки | `npm test` 138/138, `npm run typecheck`, extension load exit 0 |

## Settings 0.5.5

`package.json#omp.settings` → Settings → Plugins. Приоритет:
**Settings > env > режим/дефолт** (D12). Extension читает на
`session_start`/`session_switch`; launcher — при старте одним
`omp plugin config list`; supervisor получает env от launcher.

| Ключ | Default | Смысл |
|---|---|---|
| `workflowMode` | `assisted` | режим workflow |
| `handoffAtPercent` | режим: 55 / off | HANDOFF, %; 0 = off |
| `handoffCooldownSeconds` | 300 | пауза после handoff |
| `contextWarnPercent` | 35 | warning |
| `contextSuggestPercent` | 50 | предложить HANDOFF |
| `autoCompactPercent` | режим: 60 / 70 / off | авто-компакция; 0 = off |
| `orcaEnabled` | true | Orca terminal list/show, /wrap, automatic handoff |
| `orcaPreflight` | true | terminal show перед send |
| `supervisorEnabled` | true | supervisor в launcher |
| `continuePrompt` | текущий текст | continuation prompt новой сессии |
| `supervisorRetries` | 3 (1–10) | попытки send/preflight |
| `supervisorLogLevel` | `info` | `quiet` / `info` / `debug` |

- `continuePrompt` используется в `/handoff-new` и supervisor'ом.
- `supervisorRetries` — env `OMP_SUPERVISOR_RETRIES`; невалидное значение →
  3 (supervisor санитизирует).
- `supervisorLogLevel` — lifecycle-логи в stderr; `--dry-run` JSON остаётся
  чистым stdout. `quiet` — только ошибки.
- `orcaEnabled=false` отключает supervisor/automatic handoff.

Проверено вживую: schema 12 ключей; Settings `supervisorLogLevel=quiet` →
лог supervisor 0 байт, default — `started dir=...`; env fallback
`OMP_SUPERVISOR_LOG_LEVEL=quiet` работает; dry-run JSON парсится `jq`.

## 0.5.6 — `/handoff-preflight`

Read-only проверка перед `/handoff-new` в `ctx.cwd`: `HANDOFF.md` есть и
закоммичен, дерево чистое, ветка не detached, upstream ahead/behind, ветка
влита в `main`/`origin/main`, marker отсутствует или от текущей сессии.
Блокеры (грязное дерево, нет state, unpushed, detached HEAD) дают warning;
warnings (нет upstream, state старше HEAD, чужой marker) не блокируют.
Ничего не пишет, не коммитит и не переключает сессию. 8 тестов на временных
git-репозиториях.

## D11/D12

- OMP first: Orca — опция; без неё git/`/proc`/ручной `/handoff-new`.
- Не делать без решения: Orca Runs/gates/workers, Orca agent sessions вместо
  marker/session 0.3, обязательный Orca runtime, параллельные multi-repo,
  publish/remote.
- Settings — источник истины; env — fallback для CI/скриптов.

## Где что лежит

| Часть | Путь |
|---|---|
| Extension | `index.ts` |
| Settings resolver | `lib/workflow-settings.ts` |
| Orchestrator entry | `orchestrator.ts` |
| Wrap core | `lib/orchestrator/wrap.ts` |
| Worktree backend | `lib/orchestrator/worktrees.ts` (`orcaCli()`) |
| Supervisor | `bin/omp-handoff-supervisor.mjs` |
| Supervisor lock | `lib/supervisor-lock.mjs` |
| Launcher | `bin/omp-yoda` |
| Тесты settings | `test/workflow-settings.test.mjs` |
| Тесты guard/supervisor | `test/context-guard.test.mjs` |
| Решения | `docs/decisions.md` (D11, D12) |
| Runbook | `docs/operations.md` |

## Проверки

```bash
cd ~/projects/omp-agent-workflow
npm test                                  # 130/130
npm run typecheck
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --no-tools --mode json -p 'Reply with exactly: OK'   # exit 0, stderr пуст
omp plugin config list omp-agent-workflow --json | jq '.schema | keys'
OMP_SUPERVISOR_ENABLED=0 bin/omp-yoda --version        # supervisor off
bin/omp-yoda --version                                 # supervisor on
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run | jq -r .command
```

## Следующие шаги

1. Перезапустить `bin/omp-yoda`: текущий OMP/supervisor загружены до merge
   0.5.5; Settings UI увидит 12 ключей в новой сессии.
2. 0.6 economics — отложено: нужен машиночитаемый API cache-monitor
   (`costs --json` или tool); вопрос API отложен владельцем.
3. Решение владельца: remote/GitHub/CI, английский README, npm/marketplace.
4. Опционально: TUI E2E `/wrap`; Settings для orchestrator-бюджетов.

## Риски

- Установленный пакет без резолвимого OMP loader → Settings игнорируются,
  работает env fallback.
- Launcher читает Settings при старте; extension — на
  `session_start`/`session_switch`; mid-session изменения не применяются.
- UI показывает «(not set)» для mode-dependent порогов.
- `orcaEnabled=false` отключает automatic handoff.
- Supervisor advisory lock: PID reuse и узкая тройная гонка reclaim.
- Две OMP-сессии в одном `--dir` делят marker и `HANDOFF.md`.
- Remote отсутствует: push/publish — только по решению владельца.
