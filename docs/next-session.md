# Next session: omp-agent-workflow 0.5.20

Контекст для новой OMP-сессии. Источник истины — `HANDOFF.md`; вики —
`docs/README.md`; backlog — `TODO.md`.

## Состояние

- Репозиторий: `~/projects/omp-agent-workflow`, `main`, версия `0.5.20`.
- Ветки 0.5.1–0.5.20 (включая `feat/doctor`) слиты ff-only;
  worktrees удалены.
- Готово: 0.3 (guard/handoff/Yoda), 0.5 (orchestrator), 0.5.1 (`/wrap`),
  0.5.2 (supervisor singleton), 0.5.3 (additive Orca), 0.5.4–0.5.5
  (Settings, 13 ключей), 0.5.6–0.5.11 (`/handoff-preflight`: таблица, меню
  действий, итог), 0.5.12–0.5.13 (ключ `workflow`), 0.5.14 (safe cleanup),
  0.5.15–0.5.17 (handoff guards, session info по pid, fallback-компакция),
  0.5.18 (kill switch `off`), 0.5.19 (advisory `next-session:`),
  0.5.20 (CLI JSON v1 и `doctor`: 16 read-only проверок, `--strict`).
- `/handoff-new [файл]` встраивает `continuePrompt` + содержимое state-файла
  (лимит 32k, маркер обрезки, fallback при ошибке чтения). `cwd` новой
  сессии — `ctx.cwd`.
- `/handoff-preflight [файл]` — таблица и вердикт, меню только незакрытых
  действий (проверки, commit, ff-merge), затем итог; runtime-файлы
  `.omp-handoff-*` игнорируются; строка `next-session:` показывается с
  валидностью.
- Advisory: `bin/omp-yoda` добавляет `--model`/`--thinking` из первой строки
  `HANDOFF.md`, если пользователь не передал их сам; невалидная/устаревшая
  строка ничего не меняет; модель в сессии не меняется (D14).
- Проверки: `npm run verify` (тесты, typecheck, `check:names`),
  extension load exit 0, schema 13 ключей, `doctor --json` exit 0.
- Текущая сессия могла стартовать до merge: перезапустить `bin/omp-yoda`.

## Следующий этап

1. **F2-пресеты** `routine`/`plan`/`review`/`budget`: имя `--preset`,
   ключ `workflowPreset`, наборы — решение владельца
   (`docs/research/workflow-presets.md`).
2. `execution: omp|external` в `AUTOPLAN.md` — решение владельца (D10);
   doctor уже видит Ensemble по `agent-team status --json`.
3. **0.6 economics отложено**: нужен машиночитаемый API cache-monitor
   (`costs --json` или tool). Не начинать без него.
4. Публикация npm/marketplace — только по решению владельца.

## Границы

- D11: OMP first, Orca — опция; D12: Settings > env; D14: advisory —
  опциональная строка, launcher применяет флаги при старте.
- Не менять схемы marker/session 0.3, `index.ts`/`/orchestrate` контракт.
- Не делать без решения: Orca Runs/gates/workers, Orca agent sessions,
  обязательный Orca runtime, параллельные multi-repo, publish/remote.
- Один агент — один worktree; коммит через `commit` namespace.
- `STATE.json` — runtime; `HANDOFF.md` — коммитить.

## Проверки перед merge

```bash
npm run check:names
npm test
npm run typecheck
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --mode json -p 'Reply with exactly: OK'
omp plugin config list omp-agent-workflow --json | jq '.schema | keys'
bin/omp-yoda --version
OMP_SUPERVISOR_ENABLED=0 bin/omp-yoda --version
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run | jq -r .command
```

## Стартовый prompt

> Продолжаешь `omp-agent-workflow` 0.5.20. Прочитай `HANDOFF.md`,
> `ROADMAP.md`, `docs/README.md`, `docs/decisions.md` (D11–D14).
> Settings → Plugins — основной способ настройки, env — fallback.
> `/handoff-preflight` advisory. `next-session:` применяет только launcher
> при старте. 0.6 economics отложено до API cache-monitor; не трогать
> cache-monitor. Публикация — только по решению владельца.
