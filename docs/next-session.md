# Next session: omp-agent-workflow 0.5.5

Контекст для новой OMP-сессии. Источник истины — `HANDOFF.md`; вики —
`docs/README.md`; backlog — `TODO.md`.

## Состояние

- Репозиторий: `/home/db1/projects/omp-agent-workflow`, `main`, HEAD
  `d1c4d63`, версия `0.5.5`.
- `feat/settings-supervisor` слита ff-only; worktree и ветка удалены.
- Готово: 0.3 (guard/handoff/Yoda), 0.5 (orchestrator), 0.5.1 (`/wrap`),
  0.5.2 (supervisor singleton), 0.5.3 (additive Orca), 0.5.4–0.5.5
  (Settings, 12 ключей).
- Settings: `continuePrompt`, `supervisorRetries`, `supervisorLogLevel`
  добавлены; launcher передаёт их supervisor'у через env.
- Проверки: `npm test` 130/130, typecheck, extension load exit 0,
  schema 12 ключей, dry-run JSON чистый, log level quiet/info проверены.
- Reviewer `SettingsSupervisorReview`: ok; dry-run stdout и count исправлены.
- Текущая сессия могла стартовать до merge: перезапустить `bin/omp-yoda`.

## Следующий этап

1. **0.6 economics отложено**: нужен машиночитаемый контракт cache-monitor
   (`/cache-monitor costs --json` или tool). Без него не начинать.
2. Решение владельца: remote/GitHub, CI, английский README, tarball, npm.
3. Опционально: TUI E2E `/wrap`; Settings для orchestrator-бюджетов
   (`reviewRequired`, `maxTasksPerSession`, `maxSpendUsd`, `maxMinutes`).

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

> Продолжаешь `omp-agent-workflow` 0.5.5. Прочитай `HANDOFF.md`,
> `ROADMAP.md`, `docs/README.md`, `docs/decisions.md` (D11/D12).
> Settings → Plugins — основной способ настройки, env — fallback.
> 0.6 economics отложено до машиночитаемого API cache-monitor; не трогать
> cache-monitor. Не менять контракт 0.3 и публикацию без решения владельца.
