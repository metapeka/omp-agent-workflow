# Передача: omp-agent-workflow

Дата: 2026-11-22. Репозиторий: `~/projects/omp-agent-workflow`, ветка `main`,
коммит `9e63ca1`, версия `0.3.0`. Проект зарегистрирован в Orca; рабочие
worktree — `~/orca/workspaces/omp-agent-workflow/<slug>`.

## Что готово

| Что | Состояние |
|---|---|
| Context guard | warning 35%, HANDOFF 50%, `/handoff`, `/handoff-new` |
| Workflow modes | `manual` / `assisted` / `yoda` / `yoda-supervised` |
| Automatic handoff | session info, marker, supervisor, continuation prompt |
| Защита от цикла | cooldown 300 с, stale-marker guard по `sessionFile` |
| Launcher | `bin/omp-yoda` — supervisor + OMP в режиме `yoda-supervised` |
| Проверки | `npm test` 19/19, `npm run typecheck`, загрузка extension в OMP |
| E2E | supervisor → `/handoff-new` в реальном Orca-терминале; новая сессия прочитала `HANDOFF.md` |
| Документы | `README.md`, `AGENTS.md`, `ROADMAP.md`, `docs/` |
| CI | `.github/workflows/ci.yml` (Node 22: `npm ci`, test, typecheck) |

## Контракт

- `OMP_WORKFLOW_MODE`: `manual` (ничего), `assisted` (auto 60%, без handoff),
  `yoda` (handoff 55%, auto fallback 70%), `yoda-supervised` (то же + внешний
  supervisor).
- `OMP_HANDOFF_AT` — порог запроса handoff; `off` отключает.
- `OMP_CONTEXT_AUTO` — порог авто-компакции; `off` отключает.
- `OMP_HANDOFF_COOLDOWN_SECONDS` — пауза после handoff, default 300.
- `/handoff` сжимает контекст; `/handoff-new` создаёт новую сессию только при
  существующем `HANDOFF.md`.
- Marker: `.omp-handoff-request.json` с `reason` и `sessionFile`; supervisor
  отбрасывает marker от другой сессии.
- Session info: `.omp-handoff-session.json` с `terminal`, `sessionFile`,
  `cwd`, `pid`, `updatedAt`.
- Supervisor не LLM: только marker, terminal handle и `orca terminal send`.

## Где что лежит

| Часть | Путь |
|---|---|
| Extension | `index.ts` |
| Supervisor | `bin/omp-handoff-supervisor.mjs` |
| Launcher | `bin/omp-yoda` |
| Тесты | `test/context-guard.test.mjs` |
| Режимы и оркестрация | `docs/yoda-workflow.md` |
| Протокол handoff | `docs/handoff-auto-plan.md` |
| Пользовательский контракт | `README.md` |
| План | `ROADMAP.md` |
| Инструкции агенту | `AGENTS.md` |

## Проверки

```bash
cd ~/projects/omp-agent-workflow
npm test                 # 19/19
npm run typecheck
omp --no-extensions -e ./index.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'        # exit 0, stderr пуст
bin/omp-yoda --version               # supervisor стартует, OMP получает режим
```

В TUI: `/handoff`, `/handoff-new`; automatic handoff — marker → supervisor →
новая сессия. Вне Orca supervisor не получит terminal handle.

## Следующие шаги

1. Реализовать orchestrator и subagent-петлю по `ROADMAP.md`, этап 0.5:
   `AUTOPLAN.md`, `STATE.json`, бюджеты, stop-gates.
2. Добавить тесты на orchestration state/handoff-решение.
3. Проверить цикл N задач в Orca с реальными worktree.
4. Решить с владельцем: remote/GitHub, npm, marketplace, английский README.
5. P2: совместно с `omp-cache-monitor` измерить стоимость компакции/handoff.

## Риски

- `ctx.newSession()` доступен только в command context; event-handler не
  может начать новую сессию.
- `getContextUsage()` может вернуть `null` сразу после компакции — проверки
  пропускаются до следующего хода.
- Supervisor привязан к Orca terminal handle; вне Orca automatic handoff
  недоступен.
- Пороги — эвристика; стоимость компакции не измерена.
- Remote отсутствует: `main` пока локальный, push/publish — только по
  решению владельца.
