# Next session: omp-agent-workflow 0.5.4

Контекст для новой OMP-сессии. Источник истины — `HANDOFF.md`; вики —
`docs/README.md`; backlog — `TODO.md`.

## Состояние

- Репозиторий: `/home/db1/projects/omp-agent-workflow`, `main`, HEAD
  `c16c9b1`, версия `0.5.4`.
- `feat/settings-mvp` слита ff-only; worktree и ветка удалены.
- Готово: 0.3 (guard/handoff/Yoda), 0.5 (orchestrator), 0.5.1 (`/wrap`),
  0.5.2 (supervisor singleton), 0.5.3 (additive Orca), 0.5.4 (Settings).
- Settings: 9 ключей в `package.json#omp.settings`; приоритет
  Settings > env > режим/дефолт (D12). Launcher читает `omp plugin config
  list`; extension — `getPluginSettings` на `session_start`/`session_switch`.
- `orcaEnabled=false` отключает supervisor/automatic handoff.
- Проверки: `npm test` 127/127, typecheck, extension load exit 0,
  `omp plugin config list` показывает 9 ключей, launcher env fallback.
- Reviewer `SettingsReview`: ok; P2 (launcher env masking, session_switch
  sync) и P3 исправлены.
- Текущая сессия стартовала до merge: перезапустить `bin/omp-yoda`, чтобы
  OMP и supervisor загрузили 0.5.4 и Settings UI увидел схему.

## Следующий этап

1. Решение владельца: remote/GitHub, CI на remote, английский README,
   tarball, npm/marketplace.
2. P2 0.6: экономика handoff/компакции с `omp-cache-monitor`.
3. Опционально: TUI E2E `/wrap` на Orca-managed worktree; Settings для
   orchestrator-бюджетов (`reviewRequired`, `maxTasksPerSession`,
   `maxSpendUsd`, `maxMinutes`).

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
```

## Стартовый prompt

> Продолжаешь `omp-agent-workflow` 0.5.4. Прочитай `HANDOFF.md`,
> `ROADMAP.md`, `docs/README.md`, `docs/decisions.md` (D11/D12).
> Settings → Plugins — основной способ настройки, env — fallback. Не менять
> контракт 0.3, `index.ts`, cache-monitor и публикацию без решения владельца.
> Следующий шаг — release-решение или 0.6 economics.
