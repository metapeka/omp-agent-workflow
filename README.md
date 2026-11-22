# omp-agent-workflow

OMP-расширение для работы агента: предупреждает о заполнении контекста и даёт
команду `/handoff` для сжатия с сохранением решений и следующих шагов.

Не заменяет native `context_pct` и не добавляет свой сегмент статус-строки.
Задача — предупредить заранее и дать детерминированное действие.

## Пороги

| Контекст | Действие |
|---|---|
| 35% | Warning: планируй HANDOFF |
| 50% | Warning: пора HANDOFF, обнови `HANDOFF.md` и выполни `/handoff` |
| 60% | Авто-компакция после `agent_settled`, если агент idle и нет очереди |
| ниже 35% | Флаги сбрасываются, предупреждения снова активны |

Пороги можно переопределить:

```bash
OMP_CONTEXT_WARN=30
OMP_CONTEXT_SUGGEST=45
OMP_CONTEXT_AUTO=55      # или off
OMP_HANDOFF_AT=55        # или off; просить handoff на пороге
```

## Команды

`/handoff` сжимает контекст с инструкциями сохранить цель, решения, изменённые
файлы, проверки, блокеры и следующие шаги. Аргументы команды заменяют
стандартные инструкции:

```text
/handoff сохрани только архитектурные решения и следующие шаги
```

`/handoff-new` начинает новую сессию после того, как `HANDOFF.md` обновлён.
Команда ждёт idle, проверяет state и вызывает `ctx.newSession`, добавляя
custom message «прочитай HANDOFF.md и продолжай». Без `HANDOFF.md` отказывает.

Обе команды не пишут `HANDOFF.md` сами: сначала обнови файл.

## Автоматический handoff

1. На `OMP_HANDOFF_AT` extension просит агента завершить задачу, обновить
   `HANDOFF.md` и записать `.omp-handoff-request.json`.
2. Supervisor видит marker и session info, ждёт idle и отправляет
   `/handoff-new` в terminal handle.
3. `/handoff-new` открывает новую сессию; supervisor отправляет continuation
   prompt.

Session info пишется расширением:

```json
{ "terminal": "term_...", "sessionFile": "...", "cwd": "...", "pid": 123 }
```

Marker пишет агент:

```json
{ "reason": "task-boundary" }
```

Запуск supervisor:

```bash
node bin/omp-handoff-supervisor.mjs --dir /path/to/worktree
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run
```

`--dry-run` показывает terminal, команду и prompt, ничего не отправляя.
Supervisor не является LLM: только marker, terminal handle и `orca terminal
send`.

Yoda-режимы и оркестрация: `docs/yoda-workflow.md`.
План automatic handoff: `docs/handoff-auto-plan.md`.

## Почему не авто на 50%

Компакция — это отдельный запрос, который переписывает префикс и стоит денег.
На 50% достаточно предупреждения; авто-компакция на 60% срабатывает только
после завершения хода, когда `ctx.isIdle()` и нет `hasPendingMessages()`.
Посреди tool-loop или незавершённого edit контекст не сжимается.

## Установка

```bash
omp plugin link /home/db1/projects/omp-agent-workflow
```

Альтернатива — скопировать `index.ts` в
`~/.omp/agent/extensions/agent-workflow.ts`. Ставить нужно одним способом.
После установки перезапустить OMP.

## Проверка

```bash
npm test
npm run typecheck
omp --no-extensions -e ./index.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'
```

## Ограничения

- Работает только в TUI и только для главного агента; sub/print/json молчат.
- `getContextUsage()` может вернуть `null` сразу после компакции — проверки
  пропускаются до следующего хода.
- Пороги — эвристика, а не измеренная граница модели.
- Не управляет native warming/compaction; только просит OMP сжать контекст.

## Лицензия

MIT, см. `LICENSE`.
