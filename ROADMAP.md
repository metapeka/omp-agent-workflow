# ROADMAP — omp-agent-workflow

Дата: 2026-11-22. Версия: `0.3.0`. Статус: context guard, handoff и режимы
готовы; оркестратор и subagent-петля — следующий этап.

## Принципы

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

## Этап 0.4 — standalone project (текущий)

- [x] Отдельный git-репозиторий `~/projects/omp-agent-workflow`.
- [x] Регистрация проекта в Orca.
- [x] Перенос launcher в `bin/omp-yoda`.
- [x] `AGENTS.md`, `ROADMAP.md`, `HANDOFF.md`, CI.
- [ ] Remote/GitHub и публикация — только по решению владельца.

## Этап 0.5 — orchestrator и subagent-петля (дизайн утверждён)

Дизайн и контракт: `docs/orchestrator.md`; решения — `docs/decisions.md`.

- [x] Дизайн: `AUTOPLAN.md` (JSON-блоки), `STATE.json`, действия, политика,
      бюджеты, stop-gates, handoff на границе.
- [x] Зафиксированы факты OMP API и ограничения — `docs/architecture.md`.
- [x] Этап A: `plan.ts`, `state.ts`, `budgets.ts`, `policy.ts` + unit-тесты.
- [x] Этап B: `cost.ts`, `worktrees.ts`, `actions.ts`,
      `bin/omp-orchestrate` + integration (55 тестов всего).
- [ ] Этап C: `orchestrator.ts` (tool, `/orchestrate`, hooks), второй entry.
- [ ] Этап D: docs/example, версия `0.5.0`, E2E 3 задачи в Orca.
- Orchestrator (main) читает `AUTOPLAN.md`/`HANDOFF.md`, выбирает задачу,
  спавнит implementer/verifier/reviewer/scout, мержит и обновляет state.
- `STATE.json`: current task, branch, commit, status, context %, spend, last
  handoff, stop reason; не коммитится.
- Бюджеты: `maxTasksPerSession`, `maxSpendUsd`, `maxMinutes`.
- Handoff на границе задачи; аварийная компакция на 70% (0.3).
- Acceptance: N задач подряд с тестами/typecheck; handoff не теряет state;
  stop-gate останавливает работу с причиной.

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
