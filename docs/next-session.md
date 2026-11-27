# Next session: OAW (`omp-agent-workflow`) 1.0.1

Контекст для новой OMP-сессии. Источник истины — `HANDOFF.md`; вики —
`docs/README.md`; backlog — `TODO.md`.

## Состояние

- Репозиторий: `~/projects/omp-agent-workflow`, `main`, версия `1.0.1`
  (`1b4874f`, `main` = `origin/main`): тег и release `v1.0.1` опубликованы,
  tarball asset (sha256 `7365f73a…7c4ad`), CI зелёный. 1.0.0 запушен, тег
  и release `v1.0.0` есть; npm/marketplace — по решению владельца (D10).
- `npm run verify` — 403 теста, typecheck, `check:names` зелёные.
- Готово: 0.3 guard/handoff/Yoda, 0.5 orchestrator (A–D), 0.5.1 `/wrap`,
  0.5.2 supervisor singleton, 0.5.3 additive Orca, 0.5.4–0.5.5 Settings,
  0.5.6–0.5.13 preflight/state/actions/flow/статус-ключ, 0.5.14 safe
  cleanup, 0.5.15–0.5.17 handoff guards + session info по pid +
  fallback-компакция, 0.5.18 kill switch, 0.5.19 advisory, 0.5.20 CLI JSON
  v1 + `doctor`, 0.5.21 `execution`, 0.5.22 пресеты, 0.5.23 метрики,
  0.5.24 flight recorder, 0.5.25 вывод preflight, 0.5.26 `push` в меню,
  0.6.0 цена границы, 0.6.1 `economics`, 0.7.0 spend-триггер, 0.7.1
  quality gate, 0.7.2 `--summary`, 0.7.3 discovery, 0.7.4 леджер,
  1.0.0 релиз (tarball, CLI под `node_modules`), 1.0.1 страховка:
  WIP-снимок перед `force`-удалением, `omp-orchestrate refs`
  (+ подсказка самого старого ref), копия session JSONL перед handoff,
  `docs/recovery.md`.
- Проверки живостью 2026-11-27: preflight-таблица и меню, `/wrap`,
  `YODA-SUP`, `⚠ HANDOFF`, marker → `/handoff-new` → continuation (1.2 с).
- Не забыть: WIP-снимок не покрывает ignored-файлы; backup-ref пишет
  только OAW (`/wrap`, `finish`, retry), прямой `orca worktree rm` — нет.

## Следующий этап

1. Orca/Ensemble-приёмка: на репозитории с `execution: external` проверить
   `doctor` (`two owners`), отказы OAW и живой прогон Ensemble.
2. F4 `--plan-yolo` — только после замера; не начинать без данных.
3. Hub старта сессии и `brief` — личный runbook вне продукта (joint plan
   Ф3); `doctor --json` уже готов как источник проверок.
4. npm/marketplace-публикация — только по отдельному решению (D10).

## Границы

- D11: OMP first, Orca — опция; D12: Settings > env; D14: advisory —
  опциональная строка, launcher применяет флаги при старте.
- Не менять схемы marker/session 0.3, `index.ts`/`/orchestrate` контракт;
  новые поля JSON — аддитивно, ломающее — бамп `schemaVersion`.
- Не делать без решения: Orca Runs/gates/workers, Orca agent sessions,
  обязательный Orca runtime, параллельные multi-repo, publish/remote.
- Один агент — один worktree; коммит через `commit` namespace.
- `STATE.json` — runtime; `HANDOFF.md` — коммитить; секреты и JSONL — нет.

## Проверки перед merge

```bash
npm run check:names
npm test
npm run typecheck
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --mode json -p 'Reply with exactly: OK'
omp plugin config list omp-agent-workflow --json | jq '.schema | length'   # 15
bin/omp-yoda --version
bin/omp-yoda --preset plan --version
OMP_SUPERVISOR_ENABLED=0 bin/omp-yoda --version
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run | jq -r .command
node bin/omp-orchestrate refs
```

## Стартовый prompt

> Продолжаешь `omp-agent-workflow` 1.0.1. Прочитай `HANDOFF.md`,
> `ROADMAP.md`, `docs/README.md`, `docs/recovery.md`, `docs/decisions.md`
> (D11–D16). Settings → Plugins — основной способ настройки, env — fallback.
> `/handoff-preflight` advisory. `next-session:` применяет только launcher
> при старте; `--preset` важнее Settings и отменяет advisory.
> `execution: external` отдаёт задачи Ensemble и блокирует
> `start/verify/finish/rebase` в OAW. `omp-orchestrate economics` —
> read-only «до/после handoff», не парсить внутренности cache-monitor.
> Страховка: `force`-удаление грязного worktree сначала пишет WIP-патч;
> скрытая потеря — ignored-файлы; восстановление — `docs/recovery.md`.
> Публикация и push — по разрешению владельца (D10).
