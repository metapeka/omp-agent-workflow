# Next session: omp-agent-workflow 0.5.3

Контекст для новой OMP-сессии. Источник истины — `HANDOFF.md`; вики —
`docs/README.md`; backlog — `TODO.md`.

## Состояние

- Репозиторий: `/home/db1/projects/omp-agent-workflow`, `main`, HEAD
  `46464cf`, версия `0.5.3`.
- `feat/orca-integration` слита ff-only; worktree и ветка удалены.
- Готово: 0.3 (guard/handoff/Yoda), 0.5 (orchestrator), 0.5.1 (`/wrap`),
  0.5.2 (supervisor singleton), 0.5.3 (additive Orca).
- 0.5.3: `/wrap` учитывает live-терминалы Orca (`terminal list`), supervisor
  проверяет handle (`terminal show`), launcher предупреждает по
  `orca status`; `ORCA_CLI_COMMAND` общий для supervisor, `/wrap`,
  worktree create/remove.
- Проверки: `npm test` 119/119, `npm run typecheck`, extension load exit 0,
  launcher с недоступным Orca стартует с warning.
- Reviewer `OrcaIntegrationReview`: ok; launcher probe (`status` без
  `--json`) и CLI override исправлены.
- Текущая сессия могла стартовать до merge: перезапустить `bin/omp-yoda`,
  чтобы загрузить 0.5.3 в OMP и supervisor.

## Следующий этап

1. Решение владельца: remote/GitHub, CI на remote, английский README,
   tarball, npm/marketplace.
2. P2 0.6: экономика handoff/компакции с `omp-cache-monitor`.
3. Опционально: TUI E2E `/wrap` на Orca-managed worktree;
   кроссплатформенная live-process проверка.

## Границы

- D11: OMP first; Orca — опция. Orca-вызовы best-effort с fallback.
- Не делать без решения: Orca Runs/gates/workers, Orca agent sessions вместо
  marker/session 0.3, обязательный Orca runtime, параллельные задачи/
  multi-repo, публикация/remote.
- Не менять схемы marker/session 0.3; `index.ts` и `/orchestrate` контракт.
- Один агент — один worktree; коммит через `commit` namespace.
- `STATE.json` — runtime; `HANDOFF.md` — коммитить.

## Проверки перед merge

```bash
npm test
npm run typecheck
omp --no-extensions -e ./index.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --no-tools --mode json -p 'Reply with exactly: OK'
bin/omp-yoda --version
ORCA_USER_DATA_PATH=/tmp/empty bin/omp-yoda --version   # warning, exit 0
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run
```

## Стартовый prompt

> Продолжаешь `omp-agent-workflow` 0.5.3. Прочитай `HANDOFF.md`,
> `ROADMAP.md`, `docs/README.md`, `docs/decisions.md` (D11). Orca —
> опциональная интеграция; OMP должен работать без неё. Не менять контракт
> 0.3, `index.ts`, cache-monitor и публикацию без решения владельца.
> Следующий шаг — release-решение или 0.6 economics.
