# TODO — omp-agent-workflow

Оперативный список задач. Этапы и границы — `ROADMAP.md`; текущее
состояние — `HANDOFF.md`; контекст следующей сессии — `docs/next-session.md`.

Дата: 2026-11-23. Версия: `0.5.1`.

## Сейчас

- [ ] Remote/GitHub и CI на remote — только по решению владельца.
- [ ] Английский README — часть 1.0.
- [ ] npm/marketplace — только по решению владельца.
- [ ] Опционально: полный TUI E2E `/wrap` на Orca-managed worktree
      (confirm/cancel и branch retained); core Orca и TUI confirm/cancel
      уже проверены.
- [ ] После выхода удалить worktree `wrap-wizard` и ветку
      `feat/wrap-wizard`.

## Будущее

- [ ] 0.6: экономика handoff/компакции с `omp-cache-monitor` — стоимость,
      влияние на hit rate; без TTL/warming без данных провайдера.
- [ ] Интеграция с Orca orchestration Runs/gates — `[future]` 0.6+.
- [ ] Параллельные задачи и multi-repo — `[future]`.
- [ ] Свои agent definitions (`implementer`/`verifier`) через `.omp/agents`.
- [ ] Метрики/status: spend, handoff, пороги, стоимость компакции.
- [ ] Кроссплатформенная проверка live-процессов (сейчас `/proc`,
      Linux-only).
- [ ] Supervisor singleton/lock, если допускаются две сессии в одном cwd;
      сейчас каждый `omp-yoda` запускает свой supervisor.

## Закрытые задачи

- [x] 0.1 — context guard 35/50, `/handoff`.
- [x] 0.2 — automatic handoff: session info, marker, supervisor, cooldown,
      stale-marker guard.
- [x] 0.3 — режимы `manual`/`assisted`/`yoda`/`yoda-supervised`,
      launcher `bin/omp-yoda`.
- [x] 0.4 — отдельный репозиторий, Orca-проект, AGENTS/ROADMAP/HANDOFF, CI;
      остался только remote.
- [x] 0.5 — orchestrator A–D: `AUTOPLAN.md`, `STATE.json`, actions, policy,
      бюджеты, stop-gates, live E2E на 3 задачи.
- [x] 0.5.1 — `/wrap`: карточки, handoff-инструкция, safe cleanup,
      следующий worktree, review; commit `de03df9`.
- [x] Reviewer `WrapSafetyReview`: subdir-процессы, Orca ENOENT fallback,
      handoff cwd, state/lock cwd, plan hash/planError; commit `ca93956`.
- [x] TUI E2E `/wrap`: confirm/cancel, Yes удаляет, No/Esc оставляет;
      real Orca backend cleanup temp worktree прошёл.
- [x] Tarball `0.5.1`: `npm pack` + install в temp; `docs/wrap.md` и
      `lib/orchestrator/wrap.ts` в пакете; загрузка extension exit 0;
      `/wrap` открылся из установленного пакета.
- [x] Задача `/wrap` в worktree `wrap-wizard` закрыта 2026-11-23:
      merge, TUI/Orca E2E, tarball, docs; worktree удалить после выхода.
- [x] Документы: `docs/wrap.md`, README, runbook, `docs/next-session.md`
      под 0.5.1; commits `ae1bde2`, `ff83e67`.
