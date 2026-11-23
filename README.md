# omp-agent-workflow

OMP-расширение для работы агента: предупреждает о заполнении контекста и даёт
команду `/handoff` для сжатия с сохранением решений и следующих шагов.

Не заменяет native `context_pct` и не добавляет свой сегмент статус-строки.
Задача — предупредить заранее и дать детерминированное действие.

## Документация

Вики проекта — `docs/README.md`:

- `docs/architecture.md` — компоненты и факты OMP API: что extension может
  и не может;
- `docs/contracts.md` — стабильный контракт 0.3: режимы, env, файлы, команды;
- `docs/orchestrator.md` — дизайн 0.5: `AUTOPLAN.md`, `STATE.json`, бюджеты,
  stop-gates, subagent-петля;
- `docs/operations.md` — runbook: запуск, supervisor, worktree, сбои;
- `docs/decisions.md` — подтверждённые решения и отклонённые альтернативы.

## Настройки

Settings → Plugins → `omp-agent-workflow`. Приоритет: **Settings > env >
режим/дефолт**. Значения сохраняются в OMP plugin config и применяются на
следующем `session_start`; launcher читает их при старте.

| Ключ | Default | Смысл |
|---|---|---|
| `workflowMode` | `assisted` | `manual` / `assisted` / `yoda` / `yoda-supervised` |
| `handoffAtPercent` | режим: `55` / off | Порог HANDOFF, %; `0` = off |
| `handoffCooldownSeconds` | `300` | Пауза после handoff |
| `contextWarnPercent` | `35` | Warning о контексте |
| `contextSuggestPercent` | `50` | Предложить HANDOFF |
| `autoCompactPercent` | режим: `60` / `70` / off | Авто-компакция, %; `0` = off |
| `orcaEnabled` | `true` | Orca terminal list/show, live-терминалы `/wrap` и automatic handoff; `false` отключает supervisor, git/`/proc` fallback |
| `orcaPreflight` | `true` | Проверять terminal handle перед handoff |
| `supervisorEnabled` | `true` | Запускать supervisor из `bin/omp-yoda` |
| `continuePrompt` | текущий текст | Начало custom message новой сессии; state-файл добавляется после него |
| `supervisorRetries` | `3` | Попытки supervisor при send/preflight |
| `supervisorLogLevel` | `info` | `quiet` / `info` / `debug` |

Env-переменные (`OMP_WORKFLOW_MODE`, `OMP_HANDOFF_AT`, `OMP_CONTEXT_*`,
`OMP_HANDOFF_COOLDOWN_SECONDS`, `OMP_ORCA_ENABLED`, `OMP_ORCA_PREFLIGHT`,
`OMP_SUPERVISOR_ENABLED`, `OMP_HANDOFF_PROMPT`, `OMP_SUPERVISOR_RETRIES`,
`OMP_SUPERVISOR_LOG_LEVEL`, `ORCA_CLI_COMMAND`) остаются fallback, если ключ
не задан в Settings. Для порогов `0` и `off` означают выключение; значения
`handoffAtPercent`/`autoCompactPercent` по умолчанию зависят от режима.

## Режимы

| `OMP_WORKFLOW_MODE` | Авто-компакция | Handoff |
|---|---|---|
| `manual` | выкл | выкл |
| `assisted` (default) | 60% | выкл |
| `yoda` | 70% fallback | 55% |
| `yoda-supervised` | 70% fallback | 55% + supervisor |

Env-переменные `OMP_CONTEXT_AUTO` и `OMP_HANDOFF_AT` — fallback, если
соответствующий ключ не задан в Settings; Settings имеет приоритет.
`yoda` без supervisor умеет только компакцию; `yoda-supervised` делает
clean-window handoff.

## Пороги

| Контекст | Действие |
|---|---|
| 35% | Warning: планируй HANDOFF |
| 50% | Warning: пора HANDOFF, обнови `HANDOFF.md` и выполни `/handoff` |
| 60% | Авто-компакция после `agent_settled`, если агент idle и нет очереди |
| ниже 35% | Флаги сбрасываются, предупреждения снова активны |

Пороги можно переопределить в Settings → Plugins или env (fallback):

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
custom message из `continuePrompt` и содержимого state-файла. Встраивается
до 64 000 символов; при превышении добавляется маркер обрезки, при ошибке
чтения — просьба прочитать файл самому. Без `HANDOFF.md` отказывает.
`cwd` новой сессии — `ctx.cwd`, поэтому запускай `/handoff-new` из корня
передаваемого проекта.

`/handoff-preflight [файл]` — проверка состояния, затем меню действий.
Сначала печатается таблица и вердикт. В меню попадают только незакрытые
пункты: `checks` всегда, `commit` — при грязном дереве, `merge` — если
ветка не влита в `main`. У предложенных действий предвыбран «Сделать»;
«Пропустить» ничего не меняет. После действий печатается итог: действия,
ручные шаги и свежая таблица с вердиктом.

- `checks` — `npm run test` и `typecheck`, если скрипты есть.
- `commit` — `git add -A` (runtime-файлы `.omp-handoff-*` исключены) и
  сообщение из диалога; detached HEAD отклоняется.
- `merge` — только `git merge --ff-only` в чистый `main` worktree; ошибка
  не форсится.
- Упавшие проверки блокируют выбранные commit/merge в этом запуске.

Вручную/агентом остаются: завершить задачу, обновить `HANDOFF.md`, удалить
worktree после выхода.
Таблица проверяет: `HANDOFF.md` (или указанный файл) на месте и не старше
HEAD, дерево чистое, ветка не detached, коммиты запушены, ветка влита в
`main`, marker отсутствует или от текущей сессии. Блокеры advisory:
`/handoff-new` их не проверяет. На этом команда останавливается —
`/handoff-new` запускается отдельно.
Отмена меню останавливает команду; без `askDialog` (старый TUI-хост) меню
пропускается, команда остаётся read-only и печатает таблицу. В headless/sub
команда молчит.

Оба handoff-действия не пишут `HANDOFF.md` сами: сначала обнови файл.

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

Marker пишет агент; `sessionFile` защищает от stale-marker после handoff:

```json
{ "reason": "task-boundary", "sessionFile": "/path/to/session.jsonl" }
```

Запуск supervisor:

```bash
node bin/omp-handoff-supervisor.mjs --dir /path/to/worktree
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run
```

`--dry-run` показывает terminal, команду и prompt, ничего не отправляя.
Supervisor не является LLM: только marker, terminal handle и `orca terminal
send`.

Launcher `bin/omp-yoda` запускает supervisor на текущий каталог и OMP в
режиме `yoda-supervised`:

```bash
bin/omp-yoda --version
OMP_YODA_DIR=/path/to/worktree bin/omp-yoda
```

Лог supervisor — `${TMPDIR:-/tmp}/omp-yoda-supervisor.log`
(`OMP_YODA_LOG` переопределяет). Supervisor снимается вместе с OMP.

Supervisor — один на каталог: lock `.omp-handoff-supervisor.lock/` с
`owner.json`. Второй экземпляр для того же `--dir` пишет в stderr
`another supervisor is running` и выходит, не трогая marker. Lock снимается
на выходе и по сигналам; после падения перехватывается, когда pid из
`owner.json` уже мёртв.

После handoff действует cooldown: extension не просит новый handoff
(`OMP_HANDOFF_COOLDOWN_SECONDS`, по умолчанию 300), а supervisor удаляет
ранние и stale marker'ы (`--cooldown`, по умолчанию 300). Это защищает от
цикла «новая сессия сразу просит следующий handoff».

## Orchestrator 0.5

Оркестратор включается явно: `/orchestrate [AUTOPLAN.md]`. Наличие
`AUTOPLAN.md` само по себе ничего не запускает.

- `AUTOPLAN.md` — цель, бюджеты и задачи в fenced JSON-блоках
  `json plan` / `json task`; шаблон — `docs/AUTOPLAN.example.md`.
- `STATE.json` — runtime-состояние: current task, worktree, commit, checks,
  spend, stop reason; не коммитится.
- Tool `orchestrator` — детерминированные действия `status`, `next`,
  `start`, `verify`, `finish`, `rebase`, `stop`, `resume`.
- `finish` мержит только `--ff-only` в чистый base, требует verify и
  reviewer verdict.
- Бюджеты: `maxTasksPerSession`, `maxSpendUsd`, `maxMinutes`; stop-gates
  фиксируют причину.
- Handoff на границе задачи: агент обновляет `HANDOFF.md` и пишет marker;
  supervisor открывает новую сессию.
- CLI:

```bash
bin/omp-orchestrate status --json --dir /path/to/control-worktree
bin/omp-orchestrate start T1 --dir /path/to/control-worktree
bin/omp-orchestrate verify T1 --dir /path/to/control-worktree
bin/omp-orchestrate finish T1 --commit SHA --review ok --dir /path/to/control-worktree
# --review нужен только для задач с review:true
```

Авто-продолжение работает только в `yoda`/`yoda-supervised` и только после
явного `/orchestrate`. В `manual`/`assisted` следующую задачу запускает
человек. Полный контракт — `docs/orchestrator.md`.

## Wrap: завершение работы

`/wrap` — guided wizard для конца задачи/сессии. Он показывает карточки:
handoff, обновление `HANDOFF.md`, cleanup завершённых worktree, worktree для
следующей задачи, ретро-review.

- Ничего не меняется по выбору карточки: destructive/spend действия требуют
  `confirm` с точным path/branch/HEAD.
- Cleanup — только merged в base, чистый, не текущий worktree и без live
  процесса; удаление без `--force`, ветка — `git branch -d`.
- Текущий worktree не удаляется из-под работающего OMP: выйти и удалить
  вручную.
- Handoff-карточка не переключает сессию: после проверки `HANDOFF.md`
  выполняется `/handoff-new`.
- Publish/push не автоматизируются.

Детали и safety: `docs/wrap.md`.

Yoda-режимы и оркестрация: `docs/yoda-workflow.md`.
План automatic handoff: `docs/handoff-auto-plan.md`.
Состояние проекта: `HANDOFF.md`; план: `ROADMAP.md`; инструкции агенту:
`AGENTS.md`.

## Почему не авто на 50%

Компакция — это отдельный запрос, который переписывает префикс и стоит денег.
На 50% достаточно предупреждения; авто-компакция на 60% срабатывает только
после завершения хода, когда `ctx.isIdle()` и нет `hasPendingMessages()`.
Посреди tool-loop или незавершённого edit контекст не сжимается.

## Установка

Проект отдельный от `omp-cache-monitor`; в Orca зарегистрирован как
`omp-agent-workflow`, рабочие worktree — `~/orca/workspaces/omp-agent-workflow/`.

```bash
omp plugin link /home/db1/projects/omp-agent-workflow
```

Альтернатива — скопировать `index.ts` в
`~/.omp/agent/extensions/agent-workflow.ts`. Это даёт только context guard
0.3; для orchestrator нужны также `orchestrator.ts` и `lib/`, поэтому
рекомендуется `omp plugin link`. Ставить нужно одним способом.
После установки перезапустить OMP.

## Проверка

```bash
npm test
npm run typecheck
omp --no-extensions -e ./index.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --no-tools --mode json -p 'Reply with exactly: OK'
npm run orchestrate -- status --json --dir <control-worktree>
```

## Ограничения

- Работает только в TUI и только для главного агента; sub/print/json молчат.
- `getContextUsage()` может вернуть `null` сразу после компакции — проверки
  пропускаются до следующего хода.
- Пороги — эвристика, а не измеренная граница модели.
- Не управляет native warming/compaction; только просит OMP сжать контекст.
- Orchestrator: `task` subagent не получает `cwd`, изоляция задачи держится
  на абсолютном пути worktree и проверках. Один `current`, без параллельных
  задач. `baseRepo` должен быть чистым; иначе `stop: base-dirty`.

## Лицензия

MIT, см. `LICENSE`.
