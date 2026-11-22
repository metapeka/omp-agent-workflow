# Передача: omp-agent-workflow

Дата: 2026-11-23. Основной репозиторий: `~/projects/omp-agent-workflow`.
`main` HEAD `a5ddfea`, версия `0.5.2`. Ветка `feat/supervisor-lock` слита
ff-only; worktree `~/orca/workspaces/omp-agent-workflow/supervisor-lock`
удалён. Вики проекта — `docs/README.md`; backlog — `TODO.md`.

## Что готово

| Что | Состояние |
|---|---|
| Context guard | warning 35%, HANDOFF 50%, `/handoff`, `/handoff-new` |
| Workflow modes | `manual` / `assisted` / `yoda` / `yoda-supervised` |
| Automatic handoff | session info, marker, supervisor, continuation prompt |
| Защита от цикла | cooldown 300 с, stale-marker guard по `sessionFile` |
| Launcher | `bin/omp-yoda` — supervisor + OMP в режиме `yoda-supervised` |
| Orchestrator 0.5 | этапы A–D: `lib/orchestrator/*`, `orchestrator.ts`, `bin/omp-orchestrate` |
| Wrap 0.5.1 | `/wrap` в `orchestrator.ts` + `lib/orchestrator/wrap.ts` |
| Supervisor singleton 0.5.2 | `lib/supervisor-lock.mjs`; lock на `--dir`, stale reclaim, identity guard |
| Проверки | `npm test` 113/113, `npm run typecheck`, extension load exit 0 |
| Reviewer | `SupervisorLockReview`: verdict ok; blocking-гонка reclaim закрыта, P3 (лог) исправлен |

## Supervisor singleton 0.5.2

- lock-dir `<dir>/.omp-handoff-supervisor.lock/` с `owner.json`
  (`pid`, `dir`, `startedAt`);
- второй экземпляр для того же `--dir` пишет
  `another supervisor is running` и выходит с кодом 0, marker не трогает;
- stale lock (pid мёртв) перехватывается через rename с проверкой identity:
  если lock успел взять живой supervisor, его каталог возвращается на место;
- lock без `owner.json` считается инициализирующимся `--lock-grace` секунд
  (default 10);
- lock снимается на выходе и по `SIGINT`/`SIGTERM`/`SIGHUP`;
- ошибки создания (`ENOENT`/`EACCES`/`ENOSPC`) — сообщение и exit 1, без
  stack trace; ownerless lock не остаётся;
- флаги: `--lock`, `--lock-grace`.

Файлы: `lib/supervisor-lock.mjs`, `bin/omp-handoff-supervisor.mjs`.
Тесты: 7 новых в `test/context-guard.test.mjs` (identity guard, initializing,
grace, live owner, dead owner, SIGTERM, два конкурентных стартера).

Проверено: 20 раундов × 3 стартера и 1 раунд × 20 стартеров на stale lock —
ровно один живой supervisor, один лог `removed stale lock`, без `.stale-*`
остатков; `--dir` в несуществующий каталог → exit 1 с сообщением; tarball
содержит `lib/supervisor-lock.mjs`.

## Контракт

- Схемы `.omp-handoff-session.json` и `.omp-handoff-request.json` не
  менялись (0.3).
- Lock supervisor — additive runtime-файл, не контракт; gitignored.
- `index.ts`, supervisor CLI-контракт (`--dir`, marker, session, cooldown)
  и supervisor-протокол не менялись; изменено только поведение при
  конкурирующих экземплярах.
- `/wrap` не пишет `STATE.json`/marker, не мержит, не вызывает `newSession`.

## Где что лежит

| Часть | Путь |
|---|---|
| Extension | `index.ts` |
| Orchestrator entry | `orchestrator.ts` (tool, `/orchestrate`, `/wrap`) |
| Wrap core | `lib/orchestrator/wrap.ts` |
| Supervisor | `bin/omp-handoff-supervisor.mjs` |
| Supervisor lock | `lib/supervisor-lock.mjs` |
| Launcher | `bin/omp-yoda` |
| Тесты guard/supervisor/lock | `test/context-guard.test.mjs` |
| Тесты orchestrator | `test/orchestrator.test.mjs` |
| Тесты extension | `test/orchestrator-extension.test.mjs` |
| Дизайн wrap | `docs/wrap.md` |
| Дизайн 0.5 | `docs/orchestrator.md` |
| Контракт 0.3 | `docs/contracts.md` |
| Runbook | `docs/operations.md` |

## Проверки

```bash
cd ~/projects/omp-agent-workflow
npm test                 # 113/113
npm run typecheck
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --no-tools --mode json -p 'Reply with exactly: OK'   # exit 0, stderr пуст
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run
```

Конкурирующие supervisor'ы:

```bash
node bin/omp-handoff-supervisor.mjs --dir /tmp/sup-test &   # pid A
node bin/omp-handoff-supervisor.mjs --dir /tmp/sup-test      # exit 0, "another supervisor"
kill %1                                                      # lock снят
```

## Следующие шаги

1. Перезапустить `bin/omp-yoda`: supervisor, запущенный до merge, держит в
   памяти старый код и не берёт lock; новый экземпляр возьмёт lock только
   после рестарта сессии.
2. Решение владельца: remote/GitHub/CI, английский README, npm/marketplace.
3. P2 0.6: экономика handoff/компакции с `omp-cache-monitor`.
4. Опционально: кроссплатформенная live-process проверка (сейчас `/proc`);
   полный TUI E2E `/wrap` на Orca-managed worktree.

## Риски

- Lock advisory: PID может быть переиспользован после падения; stale reclaim
  считает такой процесс живым до его смерти.
- Узкая гонка: delayed reclaimer может на мгновение унести живой lock; если
  третий стартер займёт путь до rename-back, restore не удастся. В стрессe
  20×20 не воспроизвелось; см. отчёт reviewer.
- Две OMP-сессии в одном `--dir` делят marker и `HANDOFF.md` — это
  конфигурационная ошибка; lock лишь не даёт двум supervisor'ам работать
  одновременно.
- `/proc`-проверка live-процессов Linux-only и best-effort.
- Supervisor привязан к Orca terminal handle; вне Orca automatic handoff
  недоступен.
- `HANDOFF.md` freshness — эвристика по commit identity, не proof.
- `ctx.ui.select/confirm` блокируют ход; destructive confirm без timeout.
- Remote отсутствует: push/publish — только по решению владельца.
