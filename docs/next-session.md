# Next session: OAW (`omp-agent-workflow`) 0.6.0

Контекст для новой OMP-сессии. Источник истины — `HANDOFF.md`; вики —
`docs/README.md`; backlog — `TODO.md`.

## Состояние

- Репозиторий: `~/projects/omp-agent-workflow`, `main`, версия `0.6.0`.
- Ветки 0.5.1–0.6.0 (включая `feat/doctor`, `feat/oaw-name`,
  `feat/execution`, `feat/presets`, `feat/handoff-flight-recorder`,
  `feat/preflight-output`, `feat/preflight-push`, `feat/costs-preflight`)
  слиты ff-only; worktrees удалены.
- Готово: 0.3 (guard/handoff/Yoda), 0.5 (orchestrator), 0.5.1 (`/wrap`),
  0.5.2 (supervisor singleton), 0.5.3 (additive Orca), 0.5.4–0.5.5
  (Settings, 14 ключей), 0.5.6–0.5.11 (`/handoff-preflight`: таблица, меню
  действий, итог), 0.5.12–0.5.13 (ключ `workflow`), 0.5.14 (safe cleanup),
  0.5.15–0.5.17 (handoff guards, session info по pid, fallback-компакция),
  0.5.18 (kill switch `off`), 0.5.19 (advisory `next-session:`),
  0.5.20 (CLI JSON v1 и `doctor`: 16 read-only проверок, `--strict`),
  0.5.21 (`execution: omp|external`: `external` ведёт Ensemble, OAW
  отказывает `start/verify/finish/rebase`),
  0.5.22 (пресеты `routine/plan/review/budget`: `--preset` и
  `workflowPreset`), 0.5.23 (метрики preflight: размер state, cache hit,
  reasoning share и spend сессии, план/gate/deps, run spend; цена
  границы — с 0.6.0), 0.5.24 (flight recorder: ветка, HEAD и до
  6 незакоммиченных путей в тексте запроса HANDOFF; карта защит —
  `docs/guards.md`), 0.5.25 (вывод preflight: таблица `GROUP  ST  DETAIL`
  с переносом и fallback-группы с иконками; глифы `theme.symbol`), 0.5.26
  (действие `push` в меню preflight: только при upstream и незапушенных
  коммитах, без `--force`), 0.6.0 (цена границы из
  `omp-cache-monitor costs --json`: медиана холодных/тёплых, разрез по
  моделям, graceful skip без CLI; `lib/costs-client.ts`).
- `/handoff-new [файл]` встраивает `continuePrompt` + содержимое state-файла
  (лимит 32k, маркер обрезки, fallback при ошибке чтения). `cwd` новой
  сессии — `ctx.cwd`.
- `/handoff-preflight [файл]` — таблица и вердикт, меню только незакрытых
  действий (проверки, commit, ff-merge), затем итог; runtime-файлы
  `.omp-handoff-*` игнорируются; строка `next-session:` показывается с
  валидностью.
- Advisory: `bin/omp-yoda` добавляет `--model`/`--thinking` из первой строки
  `HANDOFF.md`, если пользователь не передал их сам и не выбран `--preset`;
  невалидная/устаревшая строка ничего не меняет; модель в сессии не
  меняется (D14). Пресет `plan` советует advisory `model=flash mode=routine`
  через continue prompt (D16).
- Проверки: `npm run verify` (тесты, typecheck, `check:names`),
  extension load exit 0, schema 14 ключей, `doctor --json` exit 0,
  `bin/omp-yoda --preset plan --version` exit 0;
  `test/contracts.test.mjs` фиксирует конверт `status`/`doctor` v1 для hub.
- Текущая сессия могла стартовать до merge: перезапустить `bin/omp-yoda`.

## Следующий этап

1. **0.6 economics**: запрос `costs --json` готов в
   `docs/research/cache-monitor-costs-api.md`; реализация — у cache-monitor.
   Не парсить его внутренности.
2. F3-метрики сделаны в 0.5.23; F4 `--plan-yolo` — только после замера.
3. Публикация остаётся локальной (`omp plugin link`; D10).
4. Hub старта сессии и `brief` — личный runbook, вне продукта (joint plan
   Ф3); `doctor --json` уже готов как источник проверок.
5. Orca/Ensemble приёмка: на репозитории с `execution: external` проверить
   `doctor`, отказы OAW и живой прогон Ensemble.

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
bin/omp-yoda --preset plan --version
OMP_SUPERVISOR_ENABLED=0 bin/omp-yoda --version
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run | jq -r .command
```

## Стартовый prompt

> Продолжаешь `omp-agent-workflow` 0.6.0. Прочитай `HANDOFF.md`,
> `ROADMAP.md`, `docs/README.md`, `docs/decisions.md` (D11–D16).
> Settings → Plugins — основной способ настройки, env — fallback.
> `/handoff-preflight` advisory. `next-session:` применяет только launcher
> при старте; `--preset` важнее Settings и отменяет advisory.
> `execution: external` в `AUTOPLAN.md` отдаёт задачи Ensemble и блокирует
> `start/verify/finish/rebase` в OAW. 0.6 economics: `costs --json` есть
> (cache-monitor 0.11.0), цена границы — в preflight; не парсить внутренности
> cache-monitor. Публикация — по разрешению владельца (D10); 0.6.0 запушен.
