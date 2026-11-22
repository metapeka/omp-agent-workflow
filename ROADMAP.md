# ROADMAP — omp-agent-workflow

Дата: 2026-11-23. Версия: `0.5.3`. Статус: context guard, handoff, режимы,
orchestrator/subagent-петля, `/wrap`, supervisor singleton и additive
Orca-интеграция готовы; release/remote — по решению владельца. Оперативный
список — `TODO.md`.

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
