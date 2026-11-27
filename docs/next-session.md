# Next session: OAW (`omp-agent-workflow`) 1.0.2

Контекст для новой OMP-сессии. Источник истины — `HANDOFF.md`; вики —
`docs/README.md`; backlog — `TODO.md`.

## Состояние

- Репозиторий `~/projects/omp-agent-workflow`, `main` @ `8208966`
  (`main` = `origin/main`, дерево чистое), версия `1.0.2`: тег и release
  `v1.0.2` опубликованы, tarball asset'ом (89 файлов, sha256
  `52529e2f…17a8`; скачан и распакован — `package.json` 1.0.2,
  `.omp-plugin/marketplace.json` на месте), CI зелёный, Pages задеплоен.
  Предыдущие релизы: 1.0.1 (`1b4874f`) — страховка без sandbox (WIP-снимок
  перед `force`-удалением, `omp-orchestrate refs`, копия session JSONL,
  `docs/recovery.md`), 1.0.0 — стабильный релиз. npm/marketplace — по
  решению владельца (D10).
- 1.0.2 — preflight в чужом репозитории: `actionsForPreflight` предлагает
  `checks` только при `scripts.test`/`typecheck` (общий `readCheckScripts`),
  пустое меню печатает итог сразу, синонимы разделов state узнают чужие
  шаблоны; заметки — `docs/release-notes-1.0.2.md`.
- `npm run verify` — 409 тестов, typecheck, `check:names` зелёные.
- Задокументирован промах провайдера 2026-11-27: Pages `#provider-miss`
  (EN/RU/ZH) — `dc_aievent`, `cline-pass`, `deepseek-v4.1-flash-1017`,
  252k префикс, `cacheRead 0` на одном ходе ($0.0756), вина провайдера.
- Готово: 0.3 guard/handoff/Yoda, 0.5 orchestrator (A–D), 0.5.1 `/wrap`,
  0.5.2 supervisor singleton, 0.5.3 additive Orca, 0.5.4–0.5.5 Settings,
  0.5.6–0.5.13 preflight/state/actions/flow/статус-ключ, 0.5.14 safe
  cleanup, 0.5.15–0.5.17 handoff guards + session info по pid +
  fallback-компакция, 0.5.18 kill switch, 0.5.19 advisory, 0.5.20 CLI JSON
  v1 + `doctor`, 0.5.21 `execution`, 0.5.22 пресеты, 0.5.23 метрики,
  0.5.24 flight recorder, 0.5.25 вывод preflight, 0.5.26 `push` в меню,
  0.6.0 цена границы, 0.6.1 `economics`, 0.7.0 spend-триггер, 0.7.1
  quality gate, 0.7.2 `--summary`, 0.7.3 discovery, 0.7.4 леджер,
  1.0.0 релиз (tarball, CLI под `node_modules`), 1.0.1 страховка без
  sandbox, 1.0.2 preflight в чужом репозитории.
- Проверки живостью 2026-11-27: preflight-таблица и меню (в т.ч. репозиторий
  без `package.json` — диалога нет), `/wrap`, `YODA-SUP`, `⚠ HANDOFF`,
  marker → `/handoff-new` → continuation (1.2 с), extension load.
- Не забыть: WIP-снимок не покрывает ignored-файлы; backup-ref пишет
  только OAW (`/wrap`, `finish`, retry), прямой `orca worktree rm` — нет;
  запущенные OMP-сессии держат старый код плагина в памяти — фикс 1.0.2
  действует после перезапуска TUI.

## Следующий этап

1. Живой прогон приёмки `execution: external` — C1 по
   [acceptance-ensemble.md](acceptance-ensemble.md): нужна team-сессия
   Ensemble (панель или первый промпт `@team …`); без неё `agent-team`
   отвечает «This terminal is not part of an agent team». Ожидание для
   Ensemble 0.5.5 — `ensemble.active: warn`; A1–A9 пройдены 2026-11-27 на
   `/tmp`-фикстуре.
2. Запросить у Ensemble машиночитаемый статус `agent-team status --json`
   (`schemaVersion`, `active`, `runs[]`); до него `pass`/`two owners` в
   живом прогоне недостижимы, `doctor --strict` в `external` — exit 1.
   Не парсить локализованный текст и не читать `~/.orca-ensemble/`.
3. F4 `--plan-yolo` — только после замера; не начинать без данных.
4. Hub старта сессии и `brief` — личный runbook вне продукта (joint plan
   Ф3); `doctor --json` уже готов как источник проверок.
5. npm/marketplace-публикация — только по отдельному решению (D10).
6. Orca issue [stablyai/orca#47665](https://github.com/stablyai/orca/issues/47665)
   (SIGTERM caller'у внутри удаляемого worktree) — на 2026-11-27 open, без
   ответа.

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

> Продолжаешь `omp-agent-workflow` 1.0.2. Прочитай `HANDOFF.md`,
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
