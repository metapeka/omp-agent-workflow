# ROADMAP — omp-agent-workflow

Дата: 2026-11-23. Версия: `0.5.11`. Статус: context guard, handoff, режимы,
orchestrator/subagent-петля, `/wrap`, supervisor singleton, additive
Orca-интеграция и Settings готовы; release/remote — по решению владельца.
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

## Этап 0.1 — context guard (готово)

- Warning 35%, предложение HANDOFF 50%.
- `/handoff` — компакция с инструкциями сохранить цель, решения, файлы,
  проверки, блокеры и следующие шаги.
- Не добавляет свой сегмент status line.

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

## Этап 0.4 — standalone project (готово, кроме remote)

- [x] Отдельный git-репозиторий `~/projects/omp-agent-workflow`.
- [x] Регистрация проекта в Orca.
- [x] Перенос launcher в `bin/omp-yoda`.
- [x] `AGENTS.md`, `ROADMAP.md`, `HANDOFF.md`, CI.
- [ ] Remote/GitHub и публикация — только по решению владельца.

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
