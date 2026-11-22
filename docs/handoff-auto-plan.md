# Automatic handoff: план и список задач

Дата: 2026-11-22. Продукт: `omp-agent-workflow`.
Цель: агент сам доводит задачу до границы, сохраняет state и переходит в
новую сессию без участия владельца.

## Список задач

- [x] `/handoff` — компакция с инструкциями сохранить решения.
- [x] warning 35/50 и авто-компакция 60 в context guard.
- [x] `/handoff-new` — проверить `HANDOFF.md`, дождаться idle, вызвать
      `ctx.newSession({ parentSession })`, внедрить custom message.
- [x] session info — файл `.omp-handoff-session.json` с terminal handle,
      session file, cwd, pid.
- [x] marker protocol — `.omp-handoff-request.json` с reason/requestedAt.
- [x] supervisor — внешний watcher, который по marker вызывает
      `orca terminal send --text /handoff-new --enter`.
- [x] auto prompt — на `OMP_HANDOFF_AT` попросить агента обновить
      `HANDOFF.md` и записать marker; не делать новый session из event-handler.
- [ ] Yoda mode config — `manual`/`assisted`/`yoda`/`yoda-supervised`.
- [x] tests — 15 тестов: command, marker, supervisor dry-run, no duplicate.
- [x] docs — README, AGENTS, остановки и бюджеты.

Осталось: Yoda mode config и end-to-end прогон supervisor в реальном
Orca-терминале.

## Протокол

1. Агент заканчивает задачу и обновляет `HANDOFF.md`.
2. Агент пишет `.omp-handoff-request.json`:
   `{"reason":"task-boundary","requestedAt":"..."}`.
3. Supervisor видит marker и session info, ждёт idle, отправляет
   `/handoff-new` в terminal handle.
4. `/handoff-new` ждёт idle, проверяет `HANDOFF.md`, вызывает `newSession`,
   добавляет custom message «прочитай HANDOFF.md и продолжай».
5. Supervisor проверяет, что новая сессия стартовала, marker удалён, двух
   активных сессий нет.

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
