# Next session: omp-agent-workflow 0.5.1

Контекст для новой OMP-сессии в проекте `omp-agent-workflow`.
Источник истины — `HANDOFF.md`; вики — `docs/README.md`.

## Состояние

- Репозиторий: `/home/db1/projects/omp-agent-workflow`, ветка `main`,
  версия `0.5.1`; `feat/wrap-wizard` слита ff-only.
- Worktree `~/orca/workspaces/omp-agent-workflow/wrap-wizard` совпадает с
  `main`; удалить после выхода из сессии.
- `main` содержит merge `/wrap` и уточнение про Orca-терминал.
- Готово: 0.3 (guard/handoff/Yoda), 0.5 (orchestrator), 0.5.1 (`/wrap`).
- `/wrap`: handoff, update `HANDOFF.md`, cleanup merged worktree, следующий
  worktree, ретро-review; destructive/spend только после confirm.
- Real Orca backend cleanup проверен: временный worktree `wrap-e2e` удалён
  вместе с веткой; Orca-created worktree держит shell, поэтому cleanup
  блокируется, пока терминал не закрыт.
- Проверки: `npm test` 103/103, `npm run typecheck`, загрузка extension,
  `omp plugin list` → `omp-agent-workflow@0.5.1`.
- Текущая сессия запущена через `bin/omp-yoda`:
  `OMP_WORKFLOW_MODE=yoda-supervised`, handoff 55%, auto-compaction off,
  supervisor на `wrap-wizard`.

## Следующий этап

1. Опционально: TUI cleanup на Orca-managed worktree; TUI confirm/cancel и
   real Orca backend cleanup уже проверены.
2. После выхода удалить worktree `wrap-wizard` и ветку `feat/wrap-wizard`.
3. Release-решение владельца: remote/GitHub, английский README, tarball,
   npm/marketplace.
4. P2: экономика handoff/компакции с `omp-cache-monitor`.

Перед изменениями прочитать `docs/decisions.md` — D1–D10 подтверждены.

## Границы

- Не менять контракт 0.3 (`docs/contracts.md`), `index.ts`, supervisor без
  решения владельца.
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
```

## Стартовый prompt

> Продолжаешь `omp-agent-workflow` 0.5.1. Прочитай `HANDOFF.md`,
> `ROADMAP.md`, `docs/README.md`, `docs/wrap.md`, `docs/decisions.md`.
> `/wrap` уже в `main`. Не меняй контракт 0.3, `index.ts`, supervisor,
> cache-monitor и публикацию без решения владельца. Следующий шаг — live
> TUI E2E `/wrap` в Orca или release-решение.
