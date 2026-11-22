# Передача: omp-agent-workflow

Дата: 2026-11-22. Основной репозиторий: `~/projects/omp-agent-workflow`.
`main` содержит merge `feat/wrap-wizard` (ff-only), версия `0.5.1`.
Worktree `~/orca/workspaces/omp-agent-workflow/wrap-wizard` ещё существует и
совпадает с `main`; его можно удалить после выхода из сессии.

Вики проекта — `docs/README.md`. Дизайн 0.5 — `docs/orchestrator.md`;
`/wrap` — `docs/wrap.md`.

## Что готово

| Что | Состояние |
|---|---|
| Context guard | warning 35%, HANDOFF 50%, `/handoff`, `/handoff-new` |
| Workflow modes | `manual` / `assisted` / `yoda` / `yoda-supervised` |
| Automatic handoff | session info, marker, supervisor, continuation prompt |
| Защита от цикла | cooldown 300 с, stale-marker guard по `sessionFile` |
| Launcher | `bin/omp-yoda` — supervisor + OMP в режиме `yoda-supervised` |
| Orchestrator 0.5 | этапы A–D: `lib/orchestrator/*`, `orchestrator.ts`, `bin/omp-orchestrate` |
| Wrap 0.5.1 | `/wrap` в `orchestrator.ts` + `lib/orchestrator/wrap.ts`; карточки, safe cleanup, next worktree |
| Проверки | `npm test` 103/103, `npm run typecheck`, загрузка extension в OMP |
| Reviewer | WrapSafetyReview: subdir-процессы, Orca ENOENT, handoff cwd, state/lock cwd, planError guard исправлены; тесты добавлены |
| TUI smoke | `/wrap` открыл карточки в реальном TUI (temp repo), Esc отменил без мутаций |
| Документы | `README.md`, `AGENTS.md`, `ROADMAP.md`, `docs/` (`wrap.md`) |

## `/wrap` 0.5.1

Human-in-the-loop: выбор карточки ничего не меняет; destructive/spend требует
`confirm`.

| Карточка | Действие |
|---|---|
| Завершить сессию (handoff) | проверить `HANDOFF.md` в `ctx.cwd`, сказать выполнить `/handoff-new` |
| Обновить `HANDOFF.md` | `sendUserMessage` с промптом агенту (spend) |
| Удалить завершённые worktree | merged+clean+не текущий, без live-процесса; confirm с path/branch/HEAD |
| Создать worktree для следующей задачи | `input` slug → `feat/<slug>`; confirm |
| Ретро-review текущей ветки | `sendUserMessage` reviewer на `base...branch` (spend) |
| Publish / remote | disabled: решение владельца |
| Выйти | no-op |

Safety cleanup:

- `git worktree list --porcelain -z`, не пользовательская строка;
- `merge-base --is-ancestor`, `status --porcelain`, не base/current;
- повторная проверка под `.omp-orchestrator.lock`, HEAD не изменился;
- без `--force`, ветка — `git branch -d`; Orca `rm` без force;
- текущий worktree не удаляется из-под OMP — только инструкция после выхода.

`/wrap` не пишет `STATE.json`/marker, не мержит, не вызывает `newSession`,
не делает publish.

## Контракт

- `OMP_WORKFLOW_MODE`: `manual` / `assisted` / `yoda` / `yoda-supervised`.
- `/handoff` сжимает контекст; `/handoff-new` — новая сессия при наличии
  `HANDOFF.md`.
- Marker: `.omp-handoff-request.json` с `reason` и `sessionFile`.
- Session info: `.omp-handoff-session.json`.
- `/wrap` — additive 0.5.1; контракт 0.3, `index.ts`, supervisor не менялись.

## Где что лежит

| Часть | Путь |
|---|---|
| Extension | `index.ts` |
| Orchestrator entry | `orchestrator.ts` (tool, `/orchestrate`, `/wrap`) |
| Wrap core | `lib/orchestrator/wrap.ts` |
| Supervisor | `bin/omp-handoff-supervisor.mjs` |
| Launcher | `bin/omp-yoda` |
| Тесты wrap core | `test/wrap.test.mjs` |
| Тесты extension | `test/orchestrator-extension.test.mjs` |
| Дизайн wrap | `docs/wrap.md` |
| Дизайн 0.5 | `docs/orchestrator.md` |
| Контракт 0.3 | `docs/contracts.md` |
| Runbook | `docs/operations.md` |

## Проверки

```bash
cd ~/orca/workspaces/omp-agent-workflow/wrap-wizard
npm test                 # 103/103
npm run typecheck
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --no-tools --mode json -p 'Reply with exactly: OK'   # exit 0, stderr пуст
```

TUI smoke: `/wrap` в temp git repo открывает карточки; Esc отменяет; мутаций
нет. Реальный Orca cleanup (не git backend) ещё не прогонялся.

## Следующие шаги

1. Проверить `/wrap` в реальном Orca worktree: cleanup merged-соседа,
   confirm/cancel, `branch retained` при безопасном отказе.
2. После выхода из сессии удалить worktree `wrap-wizard` и ветку
   `feat/wrap-wizard`; `main` уже содержит merge.
3. Дальше — release/remote или 0.6 economics; публикация только по решению
   владельца.

## Риски

- Cleanup зависит от состояния между сбором фактов и confirm; защита —
  lock + повторная проверка HEAD/status/merged, но внешний `git`/Orca может
  изменить состояние сразу после проверки.
- `/proc`-проверка live-процессов Linux-only и best-effort; при недоступном
  `/proc` она не блокирует.
- Orca CLI может сохранить ветку, которую не может доказать merged; это
  safe-результат, не ошибка.
- Текущий worktree нельзя удалить из процесса: только ручная команда после
  выхода.
- `HANDOFF.md` freshness — эвристика по commit identity, не proof.
- `ctx.ui.select/confirm` блокируют ход; destructive confirm без timeout.
- Supervisor привязан к Orca terminal handle; вне Orca automatic handoff
  недоступен.
- Remote отсутствует: push/publish — только по решению владельца.
