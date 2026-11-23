# Automatic handoff: план и список задач

Дата: 2026-11-22. Продукт: `omp-agent-workflow`.
Цель: агент сам доводит задачу до границы, сохраняет state и переходит в
новую сессию без участия владельца.

## Список задач

- [x] `/handoff` — компакция с инструкциями сохранить решения.
- [x] warning 35/50 и авто-компакция 60 в context guard.
- [x] `/handoff-new` — проверить `HANDOFF.md`, дождаться idle, вызвать
      `ctx.newSession({ parentSession })`, внедрить custom message с
      содержимым state-файла.
- [x] session info — файл `.omp-handoff-session.json` с terminal handle,
      session file, cwd, pid.
- [x] marker protocol — `.omp-handoff-request.json` с reason/requestedAt.
- [x] supervisor — внешний watcher, который по marker вызывает
      `orca terminal send --text /handoff-new --enter`.
- [x] auto prompt — на `OMP_HANDOFF_AT` попросить агента обновить
      `HANDOFF.md` и записать marker; не делать новый session из event-handler.
- [x] Yoda mode config — `manual`/`assisted`/`yoda`/`yoda-supervised`.
- [x] tests — 22 теста: command, marker, supervisor, session info, no duplicate.
- [x] docs — README, AGENTS, остановки и бюджеты.

E2E пройден в реальном Orca-терминале: marker → supervisor → `/handoff-new`
→ новая сессия прочитала `HANDOFF.md` и ответила `OK`.

Осталось: оркестратор и subagent-петля Yoda; режимы и handoff готовы.

Контракт marker/session info: `docs/contracts.md`. Дизайн 0.5 (marker
`task-boundary`, handoff на границе): `docs/orchestrator.md`. Два пути —
ручной и автоматический: [handoff-flow.md](handoff-flow.md).

## Протокол

1. Агент заканчивает задачу и обновляет `HANDOFF.md`.
2. Агент пишет `.omp-handoff-request.json`:
   `{"reason":"task-boundary","sessionFile":"..."}`. `sessionFile` обязателен:
   supervisor отбрасывает marker от прошлой сессии.
3. Supervisor видит marker и session info, ждёт idle, отправляет
   `/handoff-new` в terminal handle.
4. `/handoff-new` ждёт idle, проверяет `HANDOFF.md`, вызывает `newSession`,
   добавляет custom message: `continuePrompt` + содержимое state-файла
   (до 64 000 символов, при превышении — маркер обрезки). Ход при этом не
   запускается: custom message — контекст, а не user message.
5. Supervisor проверяет, что новая сессия стартовала, и отправляет
   continuation prompt — первый user message, который запускает агента.
   Без supervisor это сообщение («продолжай») отправляет человек.
6. Supervisor проверяет, что marker удалён и двух активных сессий нет.
7. Cooldown: extension не просит новый handoff 300 с
   (`OMP_HANDOFF_COOLDOWN_SECONDS`), supervisor столько же не принимает
   ранние/stale marker'ы (`--cooldown`). Иначе новая сессия может уйти в цикл.

## Почему так

- `ctx.newSession()` доступен только в command context; event-handler не
  может начать новую сессию.
- Supervisor не обязан быть LLM: shell/Node watcher надёжнее и дешевле.
- Marker + session info отделяют решение агента от исполнения смены сессии.

## Критерий готовности

- `/handoff-new` создаёт новую сессию и не теряет `HANDOFF.md`.
- Supervisor в `--dry-run` показывает точную команду и handle.
- В реальном TUI: задача → marker → supervisor → новая сессия → агент читает
  state и продолжает.
- При отсутствии `HANDOFF.md` команда отказывает и просит сначала обновить
  state.
- Нет двух активных сессий и повторных handoff без нового marker.
