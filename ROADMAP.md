# ROADMAP — omp-agent-workflow

Дата: 2026-11-25. Версия: `0.5.19`. Статус: context guard, handoff, режимы,
orchestrator/subagent-петля, `/wrap`, supervisor singleton, additive
Orca-интеграция, Settings, handoff guards, kill switch и advisory
`next-session:` готовы; публичный GitHub-репозиторий и release `v0.5.14`
есть; npm/marketplace — по решению владельца.
Оперативный список — `TODO.md`.

## Принципы

- OMP first: Orca — опциональная среда (`terminal`, `worktree`, `status`),
  не зависимость. Любой Orca-вызов best-effort с fallback (D11).
- Детерминированная политика вместо «модель почувствовала»: пороги, границы
  задач, бюджеты и stop-gates.
- Один агент — один worktree; main остаётся известным хорошим состоянием.
- Handoff сохраняет решения и проверки, а не сырые логи.
- Продукт read-only по отношению к чужому коду: не греет кэш, не меняет
  промпты, не тратит деньги без задачи.

## Рынок и аналоги (2026-11-23)

Обзор публичных экосистем — [docs/research/market-landscape.md](docs/research/market-landscape.md)
([RU](docs/research/market-landscape.ru.md), [ZH](docs/research/market-landscape.zh-CN.md)).

- Прямого аналога нет; отдельные половины (guard/handoff и оркестрация)
  переполнены.
- OMP builtin уже содержит `/handoff`, авто-компакцию, `--max-cost` и
  `omp worktree add|list|clear`; наш продукт строится поверх.
- Уникальны: supervisor вне процесса, лестница режимов, детерминированный
  plan/state с бюджетами и stop-gates, cleanup guard с backup-ref.
- Следствие: не продавать handoff как дифференциатор; инвестировать в
  discovery (marketplace-каталог, сравнение) и в уникальную связку.

## Этап 0.1 — context guard (готово)

- Warning 35%, предложение HANDOFF 50%.
- `/handoff` — компакция с инструкциями сохранить цель, решения, файлы,
  проверки, блокеры и следующие шаги.
- Свой статус — только ключ `workflow` (0.5.12); native `context_pct` не
  дублируется.

## Этап 0.2 — automatic handoff (готово)

- Session info `.omp-handoff-session.json`: terminal handle, session file,
  cwd, pid.
- Marker `.omp-handoff-request.json`: reason, `sessionFile`.
- Supervisor читает marker, ждёт idle, отправляет `/handoff-new` через
  `orca terminal send`, затем continuation prompt.
- Cooldown 300 с и stale-marker guard против цикла.
- E2E в Orca: marker → supervisor → `/handoff-new` → новая сессия прочитала
  `HANDOFF.md`.

## Этап 0.3 — режимы Yoda (готово)

- `OMP_WORKFLOW_MODE=manual|assisted|yoda|yoda-supervised`.
- `yoda` — handoff 55%, auto-compaction fallback 70%.
- `yoda-supervised` — то же плюс внешний supervisor.
- `manual` выключает оба действия; `assisted` сохраняет прежнее поведение
  (auto 60%, без handoff).
- Launcher `bin/omp-yoda`.

## Этап 0.4 — standalone project (готово)

- [x] Отдельный git-репозиторий `~/projects/omp-agent-workflow`.
- [x] Регистрация проекта в Orca.
- [x] Перенос launcher в `bin/omp-yoda`.
- [x] `AGENTS.md`, `ROADMAP.md`, `HANDOFF.md`, CI.
- [x] Remote/GitHub: публичный репозиторий, CI, release `v0.5.14`.
- [x] Английский README + китайский и русский переводы, диаграммы, скриншоты.
- [ ] npm/marketplace — только по решению владельца.

## Этап 0.5 — orchestrator и subagent-петля (готово)

Дизайн и контракт: `docs/orchestrator.md`; решения — `docs/decisions.md`.

- [x] Дизайн: `AUTOPLAN.md` (JSON-блоки), `STATE.json`, действия, политика,
      бюджеты, stop-gates, handoff на границе.
- [x] Зафиксированы факты OMP API и ограничения — `docs/architecture.md`.
- [x] Этап A: `plan.ts`, `state.ts`, `budgets.ts`, `policy.ts` + unit-тесты.
- [x] Этап B: `cost.ts`, `worktrees.ts`, `actions.ts`,
      `bin/omp-orchestrate` + integration.
- [x] Этап C: `orchestrator.ts` (tool, `/orchestrate`, hooks), второй entry.
- [x] Этап D: E2E acceptance на 3 задачи, handoff на границе, stop-gate,
      версия `0.5.0`. Live TUI E2E: T1/T2 → handoff → T3 → plan-done.
- Orchestrator (main) читает `AUTOPLAN.md`/`HANDOFF.md`, выбирает задачу,
  спавнит implementer/verifier/reviewer/scout, мержит и обновляет state.
- `STATE.json`: current task, branch, commit, status, context %, spend, last
  handoff, stop reason; не коммитится.
- Бюджеты: `maxTasksPerSession`, `maxSpendUsd`, `maxMinutes`.
- Handoff на границе задачи; аварийная компакция на 70% (0.3).
- Acceptance: N задач подряд с тестами/typecheck; handoff не теряет state;
  stop-gate останавливает работу с причиной.

## Этап 0.5.1 — wrap wizard (готово)

- [x] `/wrap` в `orchestrator.ts` + `lib/orchestrator/wrap.ts`.
- [x] Карточки: handoff, update `HANDOFF.md`, cleanup merged worktree,
      следующий worktree, ретро-review; publish отключён.
- [x] Safety: только merged+clean+не текущий worktree, без live-процесса,
      повторная проверка под lock, без `--force`/`-D`.
- [x] Тесты core/extension; docs `docs/wrap.md`.
- Текущий worktree не удаляется из процесса: инструкция после выхода.

## Этап 0.5.2 — supervisor singleton (готово)

- [x] Lock-dir `.omp-handoff-supervisor.lock/` рядом с marker; `owner.json`
      (`pid`, `dir`, `startedAt`).
- [x] Второй supervisor для того же `--dir` выходит с кодом 0, marker цел.
- [x] Stale lock по мёртвому pid перехватывается; lock снимается на
      exit/SIGINT/SIGTERM/SIGHUP.
- [x] Тесты: live lock, stale reclaim, normal exit; runbook и артефакты.

## Этап 0.5.3 — additive Orca-интеграция (готово)

- [x] `/wrap` cleanup: live-терминалы Orca через `orca terminal list --json`
      (connected, не orphaned) вместе с `/proc` fallback.
- [x] Supervisor preflight: `orca terminal show --terminal <handle> --json`;
      мёртвый handle → ошибка, marker сохранён.
- [x] Launcher: warning, если Orca runtime недоступен; OMP всё равно стартует.
- [x] `ORCA_CLI_COMMAND` учитывается в `/wrap` и launcher.
- [x] D11: OMP first, Orca additive; anti-goals зафиксированы.

## Этап 0.5.4 — Settings (готово)

- [x] `omp.settings` в manifest: 9 ключей (mode, пороги, cooldown, Orca,
      supervisor).
- [x] `lib/workflow-settings.ts`: Settings > env > режим/дефолт; 0 = off.
- [x] Extension читает на `session_start`; `/wrap` учитывает `orcaEnabled`.
- [x] Launcher читает настройки, пропускает supervisor при выключении,
      передаёт `OMP_ORCA_*`/`OMP_SUPERVISOR_ENABLED`.
- [x] Supervisor: `orcaEnabled`/`supervisorEnabled` gate, `orcaPreflight`.
- [x] D12, тесты settings (6) и supervisor (2); docs.

## Этап 0.5.5 — Settings для supervisor (готово)

- [x] `continuePrompt` — настраиваемый текст новой сессии (`/handoff-new`,
      continuation prompt supervisor'а).
- [x] `supervisorRetries` — попытки send/preflight (env/CLI).
- [x] `supervisorLogLevel` — `quiet`/`info`/`debug`; lifecycle-логи под гейтом.
- [x] Launcher передаёт настройки через `OMP_HANDOFF_PROMPT`,
      `OMP_SUPERVISOR_RETRIES`, `OMP_SUPERVISOR_LOG_LEVEL`.
- [x] Тесты settings/supervisor; docs.

## Этап 0.5.6 — `/handoff-preflight` (готово)

- [x] Read-only команда: `HANDOFF.md`, чистое дерево, ветка/upstream,
      влитие в `main`, stale marker.
- [x] Блокеры и warnings разделены; ничего не пишет и не чинит.
- [x] Тесты на временных git-репозиториях; docs (README, contracts,
      operations, architecture).

## Этап 0.5.7 — preflight hardening (готово)

- [x] Ошибка git-репозитория отличается от «не репозиторий»; нет коммитов —
      отдельный блокер.
- [x] Ошибка `rev-list` upstream даёт warning, а не тихо пропадает.
- [x] `/handoff-preflight [файл]` учитывает аргумент, как `/handoff-new`.
- [x] git-вызовы с timeout 10 с; блокеры advisory (явно в docs).
- [x] Тесты: upstream ahead/behind/synced, detached, merged, custom state.

## Этап 0.5.8 — state в новую сессию (готово)

- [x] `/handoff-new` встраивает содержимое state-файла в custom message
      вместе с `continuePrompt`, а не передаёт только prompt.
- [x] Лимит 64 000 символов; при превышении — маркер обрезки с полным
      размером и путём файла; surrogate pair не разрывается.
      (0.5.15: снижен до 32 000 символов после замера `omp toks`.)
- [x] Ошибка чтения — fallback: prompt + просьба прочитать файл самому.
- [x] Тесты: контент в message, обрезка, альтернативный `[файл]`, fallback.
- [x] Документировано: `cwd` новой сессии — `ctx.cwd`.

## Этап 0.5.9 — чек-лист preflight (готово)

- [x] `/handoff-preflight` показывает интерактивный чек-лист: задача,
      коммиты, merge, worktree, `HANDOFF.md`, тесты/typecheck.
- [x] Неотмеченные пункты выводятся перед таблицей с уровнем warning.
- [x] Отмена диалога останавливает команду; без `askDialog` меню
      пропускается, таблица выводится сразу.
- [x] Команда по-прежнему read-only и останавливается после таблицы;
      `/handoff-new` запускается отдельно.
- [x] Тесты: чек-лист, все пункты отмечены, отмена; docs и версия.

## Этап 0.5.10 — действия preflight (готово)

- [x] `/handoff-preflight` — меню действий «Сделать / Пропустить»: проверки,
      commit, ff-merge.
- [x] Проверки: `npm run test`/`typecheck`, если скрипты есть.
- [x] Commit: `git add -A` + сообщение из `input`; merge: только
      `--ff-only` в чистый `main` worktree.
- [x] Упавшие проверки блокируют выбранные commit/merge в этом запуске.
- [x] Вручную/агентом: завершить задачу, обновить `HANDOFF.md`, убрать
      worktree после выхода.
- [x] Отмена меню останавливает команду; без `askDialog` — read-only
      таблица, как раньше.
- [x] Тесты: меню, проверки, commit, ff-merge, блокировка при провале,
      отмена; docs и версия.

## Этап 0.5.11 — preflight: проверка → меню → итог (готово)

- [x] Сначала read-only таблица и вердикт, затем меню.
- [x] В меню только незакрытые действия: checks всегда, commit при грязном
      дереве, merge при невлитой ветке.
- [x] Предвыбрано «Сделать»; «Пропустить» ничего не меняет.
- [x] Итог разбит на «действия», «вручную/агентом», «итог» с свежей
      таблицей и вердиктом.
- [x] Runtime-файлы `.omp-handoff-*` игнорируются в статусе и коммите.
- [x] Тесты: порядок, динамическое меню, runtime-файлы, итоговый формат.

## Этап 0.5.12 — ключ `workflow` в статус-строке (готово)

- [x] `statusEnabled` — 13-й ключ Settings, env `OMP_STATUS_ENABLED`.
- [x] Ключ `workflow`: `YODA`/`YODA-SUP` по режиму, `⚠ HANDOFF` по порогу
      или marker текущей сессии.
- [x] Stale marker другой сессии игнорируется; статус пересчитывается на
      `session_start`/`session_switch`, `turn_end`/`agent_end`,
      `session_compact`.
- [x] `statusEnabled=false` очищает ключ; native `context_pct` не дублируется.
- [x] Тесты, typecheck, README/вики/runbook.

## Этап 0.5.13 — P2-статус: supervisor и задача (готово)

- [x] `SUP OFF` в `yoda-supervised`, если lock/pid supervisor'а не найден.
- [x] `T2 verify` — `STATE.json.run.active` + `current`; статусы
      `run`/`verify`/`review`/`fail`.
- [x] Порядок: режим → `SUP OFF` → задача → `⚠ HANDOFF`; один ключ.
- [x] Тесты на live/dead supervisor, active/inactive run; docs.

## Этап 0.5.14 — безопасный cleanup worktree (готово)

- [x] `removeWorktree`: merged, clean (или явный `force`), не base/current,
      нет процессов с cwd внутри и живых терминалов Orca.
- [x] Без `--delete-branch`/`--force` по умолчанию; ветка остаётся, tip —
      `refs/omp-worktree-backup/*`; явное удаление — только `git branch -d`.
- [x] Retry failed-задачи: `force` + `requireMerged: false`; старая ветка
      переименовывается в `<branch>-failed-<timestamp>`, retry — с чистой.
- [x] Причина: `orca worktree rm` останавливает PTY target (SIGTERM живой
      сессии); зафиксировано в HANDOFF и D13.
- [x] Тесты (`test/worktree-remove.test.mjs`), typecheck, AGENTS/README/docs.

## Этап 0.5.15 — handoff guards (готово)

- [x] State 32 000 символов вместо 64 000: `omp toks` на русском даёт
      2.1–3.0 символа/токен, прежний комментарий «≈16k токенов» занижал
      расход в 1.3–1.9 раза.
- [x] `yoda-supervised`: на пороге handoff проверять lock/pid supervisor'а и
      каталог lock; warning с командой запуска, один раз на порог.
- [x] Пустой `ORCA_TERMINAL_HANDLE` → `null` в session info и warning, что
      automatic handoff не сработает.
- [x] Повтор запроса HANDOFF через 2 завершённых хода без marker; максимум
      3 запроса, затем статус `⚠ HANDOFF` без новых ходов.
- [x] README/AGENTS/docs: проценты относительны окна модели, примеры для
      1M и 100k.
- [x] Тесты на warning/retry/terminal handle, типаж-чек, docs.

## Этап 0.5.16 — session info по сессиям (готово)

- [x] `.omp-handoff-session.json` — карта `{sessions}`; merge по `pid`,
  живые чужие записи сохраняются, мёртвые вычищаются.
- [x] Lock `.omp-handoff-session.lock/` и атомарная запись temp+rename.
- [x] Supervisor выбирает запись по `marker.sessionFile`, dead pid не
  перехватывает marker живой сессии; flat 0.5.15 читается.
- [x] `lib/session-info.ts`, тесты двух сессий и одноразового запуска,
  typecheck, docs/contracts.

## Этап 0.5.17 — fallback-компакция (готово)

- [x] `checkAuto` больше не блокируется навсегда после запроса handoff:
  ждёт только неисчерпанные повторы или marker у живого supervisor.
- [x] После 3 запросов без marker или при marker без живого supervisor
  компакция срабатывает на `autoCompactPercent`.
- [x] Тесты: fallback после повторов и блокировка при живом supervisor;
  typecheck, docs.

## Этап 0.5.18 — kill switch (готово)

- [x] `workflowMode: off` в Settings и `OMP_WORKFLOW_MODE=off`; env `off`
  побеждает Settings, явные пороги игнорируются.
- [x] В off плагин молчит: без статус-ключа, предупреждений, session info,
  handoff-запросов и авто-компакции; команды остаются явными действиями.
- [x] `bin/omp-yoda` при off делает `exec omp` без supervisor и без
  env-порогов.
- [x] Тесты: разрешение настроек, тишина статуса, отсутствие side effects;
  docs/contracts, README (EN/RU/ZH), yoda-workflow.

## Этап 0.5.19 — advisory `next-session:` (готово)

- [x] `lib/next-session.ts`: fail-closed разбор строки (`v=1`, `ts` 24 ч,
      модель по `omp models --json`, `thinking` → `auto` вне каталога,
      `mode`/`reason` с валидацией, неизвестные ключи сохраняются).
- [x] `bin/omp-next-session` + `bin/omp-yoda`: `--model`/`--thinking`
      добавляются при старте; явные флаги пользователя выигрывают,
      непроверенная модель не применяется; пустой вывод — no-op.
- [x] `/handoff-preflight` показывает строку и валидность, ничего не
      переключает; модель внутри сессии не меняется.
- [x] D14: Settings-ключ и статус-строка не меняются; F2-пресеты —
      отдельное решение.
- [x] Тесты: 9 специфицированных кейсов + CLI/launcher; docs/contracts.

## Этап 0.5.20 — CLI JSON v1 и `doctor` (готово)

- [x] `status --json` получает верхнее `schemaVersion: 1`; стабильные поля
      зафиксированы в `docs/contracts.md`.
- [x] `bin/omp-orchestrate doctor [--json] [--strict]`: 16 read-only
      проверок в фиксированном порядке, каждый проб ≤ 2 с, без сети;
      отсутствие Orca/agent-team/cache-monitor — warn/skip; битые
      настройки/план/state — fail.
- [x] `--strict` повышает warn до fail; exit 0 без fail, 1 с fail;
      `--json` — `schemaVersion`/`ok`/`summary`/`checks[]`.
- [x] Тесты: golden-порядок и уровни, PATH-шимы, no-Orca exit 0, strict,
      битые входы, `off`, ensemble two-owners, CLI, отсутствие путей в
      `detail`.

## Этап 0.6 — экономика handoff (P2)

- Совместно с `omp-cache-monitor`: стоимость компакции/handoff и эффект на
  hit rate.
- Не добавлять TTL или warming без данных провайдера.

## Этап 1.0 — release

- Английский README.
- Установка из tarball.
- npm/marketplace — только с явного разрешения владельца.

## Назначение агентов

| Задача | Агент |
|---|---|
| Research API/конкурентов | `scout` |
| Реализация в worktree | `task` |
| Ревью поведенческих изменений | `reviewer` |
| Механические правки/данные | `sonic` |
| Top-level план и merge | main |

## Риски

- `ctx.newSession()` доступен только в command context; event-handler не
  может начать новую сессию.
- `getContextUsage()` может вернуть `null` сразу после компакции.
- Supervisor зависит от terminal handle Orca; вне Orca automatic handoff
  недоступен.
- Пороги — эвристика, а не измеренная граница модели.
