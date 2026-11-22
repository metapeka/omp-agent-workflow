# Next session: orchestrator 0.5

Контекст для новой OMP-сессии в проекте `omp-agent-workflow`.
Вики: `docs/README.md`. Дизайн 0.5 утверждён 2026-11-22.

## Состояние

- Репозиторий: `/home/db1/projects/omp-agent-workflow`, `main`, версия
  `0.5.0`; ветка `feat/orchestrator` слита.
- Worktree `~/orca/workspaces/omp-agent-workflow/orchestrator` можно удалить
  после выхода из текущей сессии.
- Готово (0.3): context guard 35/50, `/handoff`, `/handoff-new`, automatic
  handoff, supervisor, cooldown/stale-marker guard, режимы
  `manual`/`assisted`/`yoda`/`yoda-supervised`, launcher `bin/omp-yoda`.
- Готово (docs): вики `docs/architecture.md`, `contracts.md`,
  `orchestrator.md`, `operations.md`, `decisions.md`,
  `AUTOPLAN.example.md`.
- Готово (0.5, этапы A–D): `lib/orchestrator/*`, `orchestrator.ts`,
  `bin/omp-orchestrate`; 70 тестов всего; Orca backend проверен create/rm.
- Проверки: `npm test` 70/70, `npm run typecheck`, загрузка extension,
  e2e supervisor в Orca.
- `omp plugin link` указывает на `main`; изменения в worktree не влияют на
  живую сессию до merge.

## Следующий этап

Реализация 0.5 завершена. Осталось:

1. Ручная проверка живого TUI-цикла: `/orchestrate` → subagents → merge →
   handoff → новая сессия.
2. Remote/GitHub, npm/marketplace, английский README — только по решению
   владельца.
3. P2: экономика handoff/компакции с `omp-cache-monitor`.

Перед изменениями прочитать `docs/decisions.md` — D1–D10 подтверждены.

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
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --no-tools --mode json -p 'Reply with exactly: OK'
bin/omp-orchestrate status --json --dir <control-worktree>
```

## Стартовый prompt

> Продолжаешь `omp-agent-workflow` в worktree `feat/orchestrator`.
> Прочитай `HANDOFF.md`, `ROADMAP.md`, `docs/README.md`,
> `docs/orchestrator.md`, `docs/contracts.md`, `docs/decisions.md`.
> Дизайн 0.5 утверждён, начни с этапа A. Не меняй контракт 0.3, `index.ts`,
> supervisor, cache-monitor и публикацию.
