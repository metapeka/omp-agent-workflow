# Передача: omp-agent-workflow

Дата: 2026-11-23. Основной репозиторий: `~/projects/omp-agent-workflow`.
`main` HEAD `46464cf`, версия `0.5.3`. Ветка `feat/orca-integration` слита
ff-only; worktree `~/orca/workspaces/omp-agent-workflow/orca-integration`
удалён вместе с Orca-терминалом. Вики — `docs/README.md`; backlog — `TODO.md`.

## Что готово

| Что | Состояние |
|---|---|
| Context guard | warning 35%, HANDOFF 50%, `/handoff`, `/handoff-new` |
| Workflow modes | `manual` / `assisted` / `yoda` / `yoda-supervised` |
| Automatic handoff | session info, marker, supervisor, continuation prompt |
| Защита от цикла | cooldown 300 с, stale-marker guard по `sessionFile` |
| Launcher | `bin/omp-yoda` — supervisor + OMP, warning при недоступном Orca |
| Orchestrator 0.5 | этапы A–D: `lib/orchestrator/*`, `orchestrator.ts`, `bin/omp-orchestrate` |
| Wrap 0.5.1 | `/wrap` в `orchestrator.ts` + `lib/orchestrator/wrap.ts` |
| Supervisor singleton 0.5.2 | `lib/supervisor-lock.mjs`; lock, stale reclaim, identity guard |
| Orca additive 0.5.3 | terminal list/show, `status` warning, `ORCA_CLI_COMMAND`, fallbacks |
| Проверки | `npm test` 119/119, `npm run typecheck`, extension load exit 0 |
| Reviewer | `OrcaIntegrationReview`: verdict ok (2 P2 исправлены, test isolation) |

## Orca-интеграция 0.5.3 (OMP first, D11)

- `/wrap` cleanup: `orca terminal list --json` → live-терминалы worktree
  (`connected` и не `orphaned`) блокируют удаление; `/proc` — fallback.
- Supervisor: перед send — `orca terminal show --terminal <handle> --json`;
  мёртвый handle → marker сохранён, retry до `--max-attempts`, затем exit 1.
- Launcher: `orca status` (не `--json`, потому что JSON всегда exit 0);
  ошибка → warning, OMP всё равно стартует.
- `ORCA_CLI_COMMAND` учитывают supervisor, `/wrap` (terminal list, safe
  remove), `createWorktree`/`removeWorktree` и launcher.
- `removeWorktree` падает в git fallback и при невозможности spawn Orca CLI.
- Без Orca: git backend, `/proc`, ручной `/handoff-new`.

Файлы: `lib/orchestrator/wrap.ts`, `lib/orchestrator/worktrees.ts`,
`bin/omp-handoff-supervisor.mjs`, `bin/omp-yoda`.
Тесты: `test/wrap.test.mjs` (29), `test/context-guard.test.mjs` (33),
extension (19), orchestrator (38) — 119.

## D11: anti-goals (не делать без нового решения)

- Orca Runs/gates/workers вместо OMP orchestrator (D1).
- Orca agent sessions вместо marker/session 0.3.
- Обязательный `orca` при старте `bin/omp-yoda` или `/handoff`.
- Параллельные задачи/multi-repo (D8).
- Публикация npm/marketplace и remote — только с разрешения владельца (D10).

## Контракт

- Схемы `.omp-handoff-session.json` и `.omp-handoff-request.json` не
  менялись (0.3); добавлен только шаг preflight перед send.
- Lock supervisor — additive runtime-файл; gitignored.
- `index.ts` и `/orchestrate` контракт не менялись.
- `/wrap` не пишет `STATE.json`/marker, не мержит, не вызывает `newSession`.

## Где что лежит

| Часть | Путь |
|---|---|
| Extension | `index.ts` |
| Orchestrator entry | `orchestrator.ts` (tool, `/orchestrate`, `/wrap`) |
| Wrap core | `lib/orchestrator/wrap.ts` |
| Worktree backend | `lib/orchestrator/worktrees.ts` (`orcaCli()`) |
| Supervisor | `bin/omp-handoff-supervisor.mjs` |
| Supervisor lock | `lib/supervisor-lock.mjs` |
| Launcher | `bin/omp-yoda` |
| Тесты guard/supervisor/lock | `test/context-guard.test.mjs` |
| Тесты wrap | `test/wrap.test.mjs` |
| Runbook | `docs/operations.md` |
| Решения | `docs/decisions.md` (D11) |
| Дизайн 0.5 | `docs/orchestrator.md` |
| Wrap | `docs/wrap.md` |

## Проверки

```bash
cd ~/projects/omp-agent-workflow
npm test                                  # 119/119
npm run typecheck
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --no-tools --mode json -p 'Reply with exactly: OK'   # exit 0, stderr пуст
bin/omp-yoda --version
ORCA_USER_DATA_PATH=/tmp/empty bin/omp-yoda --version  # warning, OMP стартует
orca terminal list --json | jq '.result.terminals[].worktreePath'
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run
```

## Следующие шаги

1. Перезапустить сессию через `bin/omp-yoda`: текущий OMP (0.5.2) и его
   supervisor загружены до merge и не содержат preflight/terminal list.
2. Решение владельца: remote/GitHub/CI, английский README, npm/marketplace.
3. P2 0.6: экономика handoff/компакции с `omp-cache-monitor`.
4. Опционально: полный TUI E2E `/wrap` на Orca-managed worktree;
   кроссплатформенная live-process проверка (сейчас `/proc` fallback).

## Риски

- `orca terminal list` может быть недоступен/медленным (timeout 15 с):
  fallback на `/proc`; на не-Linux без Orca live-проверка пустая.
- `connected`/`orphaned` — эвристика Orca; при неясном поле терминал
  считается живым (консервативно, блокирует cleanup).
- Lock supervisor advisory: PID reuse и узкая тройная гонка reclaim
  описаны в отчёте `SupervisorLockReview`.
- Две OMP-сессии в одном `--dir` делят marker и `HANDOFF.md`.
- Supervisor привязан к Orca terminal handle; вне Orca — только ручной
  `/handoff-new`.
- Remote отсутствует: push/publish — только по решению владельца.
