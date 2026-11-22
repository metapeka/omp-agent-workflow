# Next session: omp-agent-workflow 0.5.2

Контекст для новой OMP-сессии в проекте `omp-agent-workflow`.
Источник истины — `HANDOFF.md`; вики — `docs/README.md`; backlog — `TODO.md`.

## Состояние

- Репозиторий: `/home/db1/projects/omp-agent-workflow`, ветка `main`,
  HEAD `a5ddfea`, версия `0.5.2`.
- `feat/supervisor-lock` слита ff-only; worktree
  `~/orca/workspaces/omp-agent-workflow/supervisor-lock` и ветка удалены.
- Готово: 0.3 (guard/handoff/Yoda), 0.5 (orchestrator), 0.5.1 (`/wrap`),
  0.5.2 (supervisor singleton).
- 0.5.2: `lib/supervisor-lock.mjs`; lock-dir
  `.omp-handoff-supervisor.lock/` с `owner.json`; второй supervisor для того
  же `--dir` выходит с кодом 0; stale reclaim с identity guard; release на
  exit/SIGINT/SIGTERM/SIGHUP; `--lock`, `--lock-grace`.
- Проверки: `npm test` 113/113, `npm run typecheck`, extension load exit 0,
  dry-run supervisor, стресс конкурирующих стартеров.
- Reviewer `SupervisorLockReview`: verdict ok; blocking-гонка закрыта,
  P3 (лог reclaim при проигранной гонке) исправлен.
- Текущий `bin/omp-yoda` мог быть запущен до merge: его supervisor держит
  старый код и не берёт lock. После рестарта сессии новый код активен.

## Следующий этап

1. Решение владельца: remote/GitHub, CI на remote, английский README,
   tarball, npm/marketplace.
2. P2 0.6: экономика handoff/компакции с `omp-cache-monitor` — стоимость,
   влияние на hit rate; без TTL/warming без данных провайдера.
3. Опционально: кроссплатформенная live-process проверка (сейчас `/proc`,
   Linux-only); полный TUI E2E `/wrap` на Orca-managed worktree.

Перед изменениями прочитать `docs/decisions.md` — D1–D10 подтверждены;
изменение supervisor согласовано владельцем для 0.5.2.

## Границы

- Не менять контракт 0.3 (`docs/contracts.md`): схемы marker/session.
- `omp-cache-monitor` — только read-only.
- Не публиковать npm/marketplace, не менять видимость, не добавлять remote
  без решения владельца.
- Один агент — один worktree; коммит через `commit` namespace.
- `STATE.json` — runtime, не коммитить; `HANDOFF.md` — коммитить.
- `/wrap` не мержит и не пишет state; cleanup — только merged+clean+не
  текущий worktree, без `--force`.

## Проверки перед merge

```bash
npm test
npm run typecheck
omp --no-extensions -e ./index.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --no-tools --mode json -p 'Reply with exactly: OK'
bin/omp-orchestrate status --json --dir <control-worktree>
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run
```

## Стартовый prompt

> Продолжаешь `omp-agent-workflow` 0.5.2. Прочитай `HANDOFF.md`,
> `ROADMAP.md`, `docs/README.md`, `docs/operations.md`, `docs/decisions.md`.
> Supervisor singleton уже в `main`; контракт 0.3, `index.ts`, схемы
> marker/session, cache-monitor и публикацию не менять без решения
> владельца. Следующий шаг — release-решение или 0.6 economics.
