# Next session: orchestrator 0.5

Контекст для новой OMP-сессии в проекте `omp-agent-workflow`.
Вики: `docs/README.md`. Дизайн 0.5 утверждён 2026-11-22.

## Состояние

- Репозиторий: `/home/db1/projects/omp-agent-workflow`, `main` на `f79ad85`,
  версия `0.3.0`.
- Текущая работа: worktree
  `~/orca/workspaces/omp-agent-workflow/orchestrator`, ветка
  `feat/orchestrator`.
- Готово (0.3): context guard 35/50, `/handoff`, `/handoff-new`, automatic
  handoff, supervisor, cooldown/stale-marker guard, режимы
  `manual`/`assisted`/`yoda`/`yoda-supervised`, launcher `bin/omp-yoda`.
- Готово (docs): вики `docs/architecture.md`, `contracts.md`,
  `orchestrator.md`, `operations.md`, `decisions.md`,
  `AUTOPLAN.example.md`.
- Готово (0.5, этап A): `lib/orchestrator/{plan,state,budgets,policy,types}.ts`,
  44 теста всего; этапы B–D впереди.
- Проверки: `npm test` 44/44, `npm run typecheck`, загрузка extension,
  e2e supervisor в Orca.
- `omp plugin link` указывает на `main`; изменения в worktree не влияют на
  живую сессию до merge.

## Следующий этап

Реализация 0.5 по `docs/orchestrator.md`, этапы B–D:

1. B: `cost.ts`, `worktrees.ts`, `actions.ts`, `bin/omp-orchestrate` +
   integration на temp git repo.
2. C: `orchestrator.ts` (tool `orchestrator`, `/orchestrate`,
   `/orchestrate-stop`, hooks), второй entry в `package.json`; spike
   загрузки.
3. D: docs/example, версия `0.5.0`, E2E 3 задачи в Orca, handoff на границе,
   stop-gate.

Перед кодом прочитать `docs/decisions.md` — D1–D10 подтверждены.

## Границы

- Не менять контракт 0.3 (`docs/contracts.md`), `index.ts`, supervisor.
- `omp-cache-monitor` — только read-only.
- Не публиковать npm/marketplace, не менять видимость, не добавлять remote
  без решения владельца.
- Один агент — один worktree; коммит через `commit` namespace.
- `STATE.json` — runtime, не коммитить; `HANDOFF.md` — коммитить.

## Проверки перед merge

```bash
npm test
npm run typecheck
omp --no-extensions -e ./index.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'
```

Для 0.5 добавить:

```bash
omp --no-extensions -e ./orchestrator.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'
bin/omp-orchestrate status --json
```

## Стартовый prompt

> Продолжаешь `omp-agent-workflow` в worktree `feat/orchestrator`.
> Прочитай `HANDOFF.md`, `ROADMAP.md`, `docs/README.md`,
> `docs/orchestrator.md`, `docs/contracts.md`, `docs/decisions.md`.
> Дизайн 0.5 утверждён, начни с этапа A. Не меняй контракт 0.3, `index.ts`,
> supervisor, cache-monitor и публикацию.
