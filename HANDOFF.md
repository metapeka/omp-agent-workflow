# Передача: omp-agent-workflow

Дата: 2026-11-23. Основной репозиторий: `~/projects/omp-agent-workflow`.
`main` HEAD `c16c9b1`, версия `0.5.4`. Ветка `feat/settings-mvp` слита
ff-only; worktree удалён вместе с Orca-терминалом. Вики — `docs/README.md`;
backlog — `TODO.md`.

## Что готово

| Что | Состояние |
|---|---|
| Context guard | warning 35%, HANDOFF 50%, `/handoff`, `/handoff-new` |
| Workflow modes | `manual` / `assisted` / `yoda` / `yoda-supervised` |
| Automatic handoff | session info, marker, supervisor, continuation prompt |
| Supervisor singleton | lock, stale reclaim с identity guard, release на сигналах |
| Launcher | `bin/omp-yoda`; читает Settings, warning по Orca, supervisor гейт |
| Orchestrator 0.5 | `AUTOPLAN.md`, `STATE.json`, actions, policy, budgets |
| Wrap 0.5.1 | `/wrap`, safe cleanup, next worktree, review |
| Orca additive 0.5.3 | terminal list/show, `status`, `ORCA_CLI_COMMAND`, fallbacks |
| Settings 0.5.4 | Settings → Plugins: 9 ключей; Settings > env > режим |
| Проверки | `npm test` 127/127, `npm run typecheck`, extension load exit 0 |

## Settings 0.5.4

`package.json#omp.settings` → Settings → Plugins. Приоритет:
**Settings > env > режим/дефолт** (D12). Значения читаются extension на
`session_start` и `session_switch`; launcher — при старте через
`omp plugin config list` (явные ключи, без manifest-дефолтов).

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

- `lib/workflow-settings.ts`: разбор, валидация, mode-дефолты, env fallback.
- Extension: dynamic import `getPluginSettings`; вне OMP-рантайма — env.
- Launcher: один `config list`; `supervisorEnabled=false` или
  `orcaEnabled=false` → supervisor не стартует, OMP работает.
- Supervisor: гейты `OMP_ORCA_ENABLED`/`OMP_SUPERVISOR_ENABLED`,
  `OMP_ORCA_PREFLIGHT`; `no/off/false/0` = false.
- `/wrap`: `orcaEnabled` управляет terminal list; `orcaCli` → env.
- Тесты: `test/workflow-settings.test.mjs` (6), supervisor gates (2);
  ambient `OMP_*` scrub в тестах.

Проверено вживую: `omp plugin config list` показывает 9 ключей;
`OMP_SUPERVISOR_ENABLED=0 bin/omp-yoda --version` не запускает supervisor;
`getPluginSettings` в OMP вернул заданные значения, resolver их применил.

## D11/D12 (границы)

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
| Orchestrator entry | `orchestrator.ts` (tool, `/orchestrate`, `/wrap`) |
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
npm test                                  # 127/127
npm run typecheck
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --no-tools --mode json -p 'Reply with exactly: OK'   # exit 0, stderr пуст
omp plugin config list omp-agent-workflow --json | jq '.schema | keys'
OMP_SUPERVISOR_ENABLED=0 bin/omp-yoda --version        # supervisor off
bin/omp-yoda --version                                 # supervisor on
```

## Следующие шаги

1. Перезапустить `bin/omp-yoda`: текущий OMP и supervisor загружены до merge
   0.5.4; Settings UI подхватит схему в новой сессии.
2. Решение владельца: remote/GitHub/CI, английский README, npm/marketplace.
3. P2 0.6: экономика handoff/компакции с `omp-cache-monitor`.
4. Опционально: TUI E2E `/wrap` на Orca-managed worktree; настройки
   orchestrator-бюджетов в Settings (второй этап).

## Риски

- В установленном пакете без резолвимого `@oh-my-pi/pi-coding-agent` loader
  динамический import падает → Settings игнорируются, работает env fallback.
- Launcher читает Settings только при старте; extension — на
  `session_start`/`session_switch`. Изменения mid-session не применяются.
- UI показывает «(not set)» для `handoffAtPercent`/`autoCompactPercent`:
  их эффективные значения зависят от режима.
- `orcaEnabled=false` отключает automatic handoff (не только terminal list).
- Supervisor advisory lock: PID reuse и узкая тройная гонка reclaim.
- Две OMP-сессии в одном `--dir` делят marker и `HANDOFF.md`.
- Remote отсутствует: push/publish — только по решению владельца.
