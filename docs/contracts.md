# Контракт 0.3

Статус: `[готово]`, версия `0.3.0`.
Этот контракт заморожен. 0.5 добавляет новые файлы и действия, но не меняет
схемы, env и поведение 0.3 без отдельного решения владельца.

## Режимы

`OMP_WORKFLOW_MODE`:

| Режим | Авто-компакция | Handoff | Supervisor |
|---|---|---|---|
| `manual` | выкл | выкл | нет |
| `assisted` (default) | 60% | выкл | нет |
| `yoda` | 70% fallback | 55% | нет |
| `yoda-supervised` | 70% fallback | 55% | да |

`yoda` без supervisor не может начать новую сессию: marker останется
необработанным. Clean-window handoff требует `yoda-supervised` или ручного
`/handoff-new`.

## Settings

`package.json#omp.settings` даёт 12 ключей; UI — Settings → Plugins. Приоритет:
**Settings > env > режим/дефолт**. Значения читаются extension на
`session_start` и `session_switch`, launcher — при старте. Для порогов `0`
и `off` означают выключение; `handoffAtPercent`/`autoCompactPercent` без
явного значения берутся из режима.

| Ключ | Тип | Default |
|---|---|---|
| `workflowMode` | enum | `assisted` |
| `handoffAtPercent` | number 0–95 | режим: `55` / off |
| `handoffCooldownSeconds` | number 0–86400 | `300` |
| `contextWarnPercent` | number 1–99 | `35` |
| `contextSuggestPercent` | number 1–99 | `50` |
| `autoCompactPercent` | number 0–100 | режим: `60` / `70` / off |
| `orcaEnabled` | boolean | `true` (false отключает supervisor/automatic handoff) |
| `orcaPreflight` | boolean | `true` |
| `supervisorEnabled` | boolean | `true` |
| `continuePrompt` | string | текущий текст |
| `supervisorRetries` | number 1–10 | `3` |
| `supervisorLogLevel` | enum | `info` |

## Env (fallback)

| Переменная | Default | Смысл |
|---|---|---|
| `OMP_WORKFLOW_MODE` | `assisted` | Режим |
| `OMP_CONTEXT_WARN` | `35` | Warning «планируй HANDOFF» |
| `OMP_CONTEXT_SUGGEST` | `50` | Warning «пора HANDOFF» |
| `OMP_CONTEXT_AUTO` | режим: `60` / `70` / `off` | Авто-компакция; `off` выключает |
| `OMP_HANDOFF_AT` | режим: `55` / `off` | Запрос handoff; `off` выключает |
| `OMP_HANDOFF_COOLDOWN_SECONDS` | `300` | Пауза после handoff |
| `OMP_ORCA_ENABLED` | `true` | Orca terminal list/show; `false` — fallback |
| `OMP_ORCA_PREFLIGHT` | `true` | Проверять handle перед handoff |
| `OMP_SUPERVISOR_ENABLED` | `true` | Запускать supervisor из launcher |
| `OMP_HANDOFF_PROMPT` | текущий текст | Continuation prompt новой сессии |
| `OMP_SUPERVISOR_RETRIES` | `3` | Попытки send/preflight |
| `OMP_SUPERVISOR_LOG_LEVEL` | `info` | `quiet`/`info`/`debug` |
| `OMP_YODA_DIR` | `$PWD` | Каталог supervisor/launcher |
| `OMP_YODA_LOG` | `${TMPDIR:-/tmp}/omp-yoda-supervisor.log` | Лог supervisor |

Невалидное число откатывается к default. `off` — только для auto/handoff.

## Команды

### `/handoff [инструкции]`

- Только main TUI.
- Сжимает контекст с инструкцией сохранить цель, решения, файлы, проверки,
  блокеры, следующие шаги.
- Аргумент заменяет стандартную инструкцию.
- Не пишет `HANDOFF.md` сам.
- Не запускает вторую компакцию, пока идёт первая.

### `/handoff-new [файл]`

- Только main TUI.
- Требует существующий `HANDOFF.md` (или указанный файл); иначе отказ.
- Ждёт idle, вызывает `ctx.newSession({ parentSession, setup })`, добавляет
  custom message «прочитай HANDOFF.md и продолжи».
- Сообщает об отмене, если `newSession` вернул `cancelled`.

## Файлы

### `.omp-handoff-session.json`

Пишет extension на `session_start`/`session_switch` только для main-сессии.
Subagent-сессии файл не трогают. Читает supervisor.

```json
{
  "terminal": "term_...",
  "sessionFile": "/home/u/.omp/agent/sessions/.../session.jsonl",
  "cwd": "/path/to/worktree",
  "pid": 12345,
  "updatedAt": "2026-11-22T12:00:00.000Z"
}
```

- `terminal` — `ORCA_TERMINAL_HANDLE` или `null` вне Orca.
- `sessionFile` — всегда main-сессия; иначе supervisor отбросит marker как stale.
- Файл gitignored, не коммитится.

### `.omp-handoff-request.json`

Пишет агент (в 0.5 также orchestrator-инструкция). Читает supervisor.

```json
{
  "reason": "context | task-boundary",
  "sessionFile": "/home/u/.omp/agent/sessions/.../session.jsonl"
}
```

- `sessionFile` обязателен: supervisor отбрасывает marker от другой сессии.
- Supervisor удаляет marker после успешного handoff.
- Cooldown 300 с защищает от цикла «новая сессия сразу просит следующий».

### `.omp-handoff-done.json`

Legacy-имя в `.gitignore`; текущий supervisor его не пишет. Не использовать
как признак завершённого handoff — источник истины: удалённый marker и
новая `sessionFile` в session info.

## Supervisor

Запуск:

```bash
node bin/omp-handoff-supervisor.mjs --dir /path/to/worktree
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run
```

Алгоритм:

0. Взять lock `<dir>/.omp-handoff-supervisor.lock/` (owner.json: pid, dir,
   startedAt). Если lock держит живой supervisor — выйти с кодом 0, не
   трогая marker. Stale lock (pid мёртв) перехватывается с проверкой
   identity; lock без owner.json считается инициализирующимся
   `--lock-grace` секунд.
1. Прочитать marker и session info.
2. Проверить terminal handle, `sessionFile`, cooldown, свежесть marker.
   Mismatched `sessionFile` удаляется только после `--stale-grace` секунд
   (default 5), чтобы не удалить валидный marker из-за гонки с session info.
3. Проверить terminal handle через
   `orca terminal show --terminal <handle> --json`; мёртвый handle — ошибка,
   marker сохраняется. Отправить `/handoff-new` через
   `orca terminal send --terminal <handle>`
   (`--wait-submit 10`, до `--max-attempts` попыток).
4. `/handoff-new` сам ждёт idle и открывает новую сессию; supervisor ждёт
   новую `sessionFile` до 15 с.
5. Если новая сессия не появилась — marker сохраняется для повтора.
6. После успеха удалить marker, запомнить время и отправить continuation
   prompt (если не `--no-prompt`).
7. Сбросить счётчик попыток и ждать следующий marker.

Флаги: `--dir`, `--marker`, `--session`, `--interval`, `--once`,
`--dry-run`, `--prompt`, `--no-prompt`, `--max-attempts`, `--cooldown`,
`--stale-grace`, `--lock`, `--lock-grace`.

Supervisor не LLM: только файлы, terminal handle и `orca terminal send`.
Вне Orca terminal handle отсутствует — automatic handoff недоступен.

## Инварианты

- `ctx.newSession()` только в command context.
- Event-handler не начинает новую сессию.
- Один marker — один handoff; stale marker не принимается.
- Две активные сессии после handoff не допускаются.
- Пороги — эвристика, не измеренная граница модели.
- `getContextUsage()` может вернуть `null` после компакции; проверки
  пропускаются до следующего хода.

## Что 0.5 может добавить

| Добавление | Совместимость |
|---|---|
| `AUTOPLAN.md`, `STATE.json`, `.omp-orchestrator.lock` | Новые файлы, 0.3 не читает |
| `orchestrator.ts` как второй extension entry | `index.ts` не меняется |
| Marker с `reason: "task-boundary"` | Схема marker не меняется |
| `/orchestrate`, `/orchestrate-stop`, tool `orchestrator` | Новые имена |
| `bin/omp-orchestrate` | Новый CLI |

Запрещено без решения владельца:

- менять поля или семантику `.omp-handoff-session.json` /
  `.omp-handoff-request.json`;
- менять значения/поведение env режима 0.3;
- переписывать supervisor или `/handoff-new`;
- менять `index.ts` под эксперимент 0.5.

## Совместимость при будущих изменениях

- Новое поле в marker/session info — только additive, reader игнорирует
  неизвестное.
- Новая причина marker — новое значение `reason`, не новый файл.
- Новый режим — новое значение `OMP_WORKFLOW_MODE`, старые значения
  сохраняют поведение.
- Любое изменение схемы — тест на старый файл плюс запись в
  [decisions.md](decisions.md).
