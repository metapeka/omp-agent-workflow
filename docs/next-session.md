# Next session: omp-agent-workflow 0.5.14

Контекст для новой OMP-сессии. Источник истины — `HANDOFF.md`; вики —
`docs/README.md`; backlog — `TODO.md`.

## Состояние

- Репозиторий: `/home/db1/projects/omp-agent-workflow`, `main`, версия
  `0.5.14`.
- `feat/handoff-preflight`, `feat/preflight-fixes`,
  `feat/handoff-state-embed`, `feat/preflight-checklist`,
  `feat/preflight-actions`, `feat/preflight-flow`,
  `feat/workflow-status-key`, `feat/workflow-status-p2` и
  `feat/safe-worktree-remove` слиты ff-only; worktrees удалены.
- Готово: 0.3 (guard/handoff/Yoda), 0.5 (orchestrator), 0.5.1 (`/wrap`),
  0.5.2 (supervisor singleton), 0.5.3 (additive Orca), 0.5.4–0.5.5
  (Settings, 13 ключей), 0.5.6–0.5.7 (`/handoff-preflight`), 0.5.8
  (state-файл в custom message новой сессии), 0.5.9 (чек-лист preflight),
  0.5.10 (меню действий preflight), 0.5.11 (проверка → меню → итог),
  0.5.12 (ключ `workflow`: `YODA`/`YODA-SUP`, `⚠ HANDOFF`), 0.5.13
  (`SUP OFF`, `T2 verify`), 0.5.14 (безопасный cleanup worktree,
  ветка остаётся).
- `/handoff-new [файл]` встраивает `continuePrompt` + содержимое state-файла
  (лимит 32k, маркер обрезки, fallback при ошибке чтения). `cwd` новой
  сессии — `ctx.cwd`.
- `/handoff-preflight [файл]` — таблица и вердикт, затем меню только
  незакрытых действий (проверки, commit, ff-merge), затем итог с действиями,
  ручными шагами и свежим состоянием. Runtime-файлы `.omp-handoff-*`
  игнорируются.
- Проверки: `npm test` 181/181, typecheck, extension load exit 0,
  schema 13 ключей.
- Текущая сессия могла стартовать до merge: перезапустить `bin/omp-yoda`.

## Следующий этап

1. **0.6 economics отложено**: нужен машиночитаемый API cache-monitor
   (`/cache-monitor costs --json` или tool). Не начинать без него.
2. Решение владельца: remote/GitHub, CI, английский README, tarball, npm.
3. Опционально: TUI E2E `/wrap`; Settings для orchestrator-бюджетов.

## Границы

- D11: OMP first, Orca — опция; D12: Settings > env.
- Не менять схемы marker/session 0.3, `index.ts`/`/orchestrate` контракт.
- Не делать без решения: Orca Runs/gates/workers, Orca agent sessions,
  обязательный Orca runtime, параллельные multi-repo, publish/remote.
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
omp plugin config list omp-agent-workflow --json | jq '.schema | keys'
bin/omp-yoda --version
OMP_SUPERVISOR_ENABLED=0 bin/omp-yoda --version
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run | jq -r .command
```

## Стартовый prompt

> Продолжаешь `omp-agent-workflow` 0.5.14. Прочитай `HANDOFF.md`,
> `ROADMAP.md`, `docs/README.md`, `docs/decisions.md` (D11/D12/D13).
> Settings → Plugins — основной способ настройки, env — fallback.
> `/handoff-preflight` advisory. 0.6 economics отложено до API cache-monitor;
> не трогать cache-monitor. Публикация — только по решению владельца.
