# Контракт 0.3

Статус: `[готово]`, версия `0.3.0`.
Этот контракт заморожен. 0.5 добавляет новые файлы и действия, но не меняет
схемы, env и поведение 0.3 без отдельного решения владельца.

## Режимы

`OMP_WORKFLOW_MODE`:

| Режим | Авто-компакция | Handoff | Supervisor |
|---|---|---|---|
| `off` | дефолт OMP | выкл | нет |
| `manual` | выкл | выкл | нет |
| `assisted` (default) | 60% | выкл | нет |
| `yoda` | 70% fallback | 55% | нет |
| `yoda-supervised` | 70% fallback | 55% | да |

`off` — выключатель: статус-ключ не публикуется, предупреждения и авто-действия
выключены, `.omp-handoff-session.json` не пишется, supervisor launcher'ом не
запускается. Явные пороги игнорируются; `OMP_WORKFLOW_MODE=off` побеждает
Settings (аварийное выключение). Команды остаются доступными: это явные
действия пользователя.

`yoda` без supervisor не может начать новую сессию: marker останется
необработанным. Clean-window handoff требует `yoda-supervised` или ручного
`/handoff-new`.

## Settings

`package.json#omp.settings` даёт 13 ключей; UI — Settings → Plugins. Приоритет:
**Settings > env > режим/дефолт**. Значения читаются extension на
`session_start` и `session_switch`, launcher — при старте. Для порогов `0`
и `off` означают выключение; `handoffAtPercent`/`autoCompactPercent` без
явного значения берутся из режима.

| Ключ | Тип | Default |
|---|---|---|
| `workflowMode` | enum | `assisted` |
| `statusEnabled` | boolean | `true` (false очищает ключ `workflow`) |
| `handoffAtPercent` | number 0–95 | режим: `55` / off |
| `handoffCooldownSeconds` | number 0–86400 | `300` |
| `contextWarnPercent` | number 1–99 | `35` |
| `contextSuggestPercent` | number 1–99 | `50` |
| `autoCompactPercent` | number 0–100 | режим: `60` / `70` / off |
| `orcaEnabled` | boolean | `true` (false отключает supervisor/automatic handoff) |
| `orcaPreflight` | boolean | `true` |
| `supervisorEnabled` | boolean | `true` |
| `continuePrompt` | string | текущий текст; state-файл добавляется после него |
| `supervisorRetries` | number 1–10 | `3` |
| `supervisorLogLevel` | enum | `info` |

## Статус-строка (0.5.12–0.5.13)

- Один ключ `workflow`, только main TUI.
- Текст: `YODA` / `YODA-SUP` по `workflowMode`; `SUP OFF` — в
  `yoda-supervised`, если lock/pid supervisor'а не найден; `T2 verify` —
  пока `STATE.json.run.active` и есть `current`.
- `⚠ HANDOFF` — при `usage >= handoffAtPercent` или marker с текущим
  `sessionFile`.
- Stale marker другой сессии игнорируется.
- `statusEnabled=false` вызывает `setStatus(key, undefined)`.
- `context_pct`, cache и другие native/чужие метрики не дублируются;
  ключ не зависит от `omp-cache-monitor`.

## Env (fallback)

| Переменная | Default | Смысл |
|---|---|---|
| `OMP_WORKFLOW_MODE` | `assisted` | Режим |
| `OMP_STATUS_ENABLED` | `true` | Публиковать ключ `workflow` |
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

Полный гид по командам, аргументам, действиям preflight и CLI —
[commands.md](commands.md). Здесь зафиксированы только контрактные детали.

### `/handoff [фокус]`

- Builtin OMP: алиас `/compact handoff`. Плагин **не регистрирует** это имя:
  extension-команда с builtin-именем отбрасывается хостом с warning.
- Сжимает контекст в текущей сессии; `HANDOFF.md` не пишет.
- Инструкции плагина (`HANDOFF_INSTRUCTIONS`) применяются только в его
  авто-компакции, не в этой команде.

### `/handoff-new [файл]`

- Только main TUI.
- Требует существующий `HANDOFF.md` (или указанный файл); иначе отказ.
- Ждёт idle, вызывает `ctx.newSession({ parentSession, setup })`, добавляет
  custom message: `continuePrompt` + содержимое state-файла.
- Содержимое читается через `readFileSync`; лимит — 32 000 символов, при
  превышении сообщение содержит маркер обрезки и путь файла. Ошибка чтения
  даёт fallback: prompt + просьба прочитать файл самому.
- `cwd` новой сессии — `ctx.cwd`; `/handoff-new` не ищет «последний
  редактированный репозиторий». Запускать из корня передаваемого проекта.
- Внедрение state не запускает ход: `custom_message` попадает в контекст,
  но модель не вызывается. В automatic handoff continuation prompt
  отправляет supervisor; при ручном `/handoff-new` первое сообщение
  («продолжай») отправляет пользователь.
- Сообщает об отмене, если `newSession` вернул `cancelled`.

### `/handoff-preflight [файл]`

- Только main TUI. Сначала печатает read-only таблицу и вердикт, затем
  меню действий (`askDialog`) только для незакрытых пунктов, выполняет
  выбранные и печатает структурированный итог. Блокеры advisory:
  `/handoff-new` их не проверяет.
- Меню: `checks` — всегда; `commit` — если дерево грязное; `merge` — если
  ветка не влита в `main`. У предложенных действий предвыбран «Сделать».
- Действия: `checks` — `npm run test`/`typecheck`, если скрипты есть;
  `commit` — `git add -A` без runtime-файлов `.omp-handoff-*` и коммит с
  сообщением из `input`; `merge` — `git merge --ff-only` текущей ветки в
  чистый `main` worktree.
- Безопасность: merge не форсится и требует fast-forward; detached HEAD
  отклоняется; битый/нечитаемый `package.json` считается провалом проверок;
  упавшие проверки блокируют выбранные commit/merge в этом запуске.
- Итог: разделы «действия», «вручную/агентом», «итог» с таблицей и
  вердиктом. Вручную остаются: завершить задачу, обновить `HANDOFF.md`,
  удалить worktree после выхода.
- Отмена меню останавливает команду. Без `askDialog` (старый TUI-хост)
  меню пропускается, команда остаётся read-only и печатает таблицу; в
  headless/sub команда молчит.
- Runtime-файлы `.omp-handoff-session.json`, `.omp-handoff-request.json`,
  `.omp-handoff-supervisor.lock*`, `.omp-handoff-done.json` не считаются
  грязным деревом и не коммитятся.
- Блокеры (`fail`): нет state-файла (default `HANDOFF.md`); грязное дерево;
  detached HEAD; нет коммитов; git-репозиторий не читается; незапушенные
  коммиты при наличии upstream.
- Warnings: нет upstream или не удалось сравнить; ветка не влита в
  `main`/`origin/main`; state старше HEAD; `upstream` впереди; stale marker
  от другой сессии; marker текущей сессии (supervisor сработает сам).
- Проверка state старше HEAD — эвристика по последнему коммиту,
  затрагивающему файл; она не доказывает, что state устарел.
- Не путать с настройкой `orcaPreflight` (terminal show перед supervisor send).

**Логика и границы.** Факты — git: state существует и закоммичен, дерево
чисто (кроме `.omp-handoff-*`), ветка не detached, upstream, `HEAD` уже в
`main` (`merge-base --is-ancestor`), marker. Свежесть — эвристика: число
коммитов после последнего изменения `HANDOFF.md`; `0` — «актуален», больше —
warning. Содержимое state не проверяется: старый текст в свежем коммите даст
OK, несвязанные коммиты после state — ложный warning. Upstream сравнивается
по локальным refs без fetch; всё считается от `ctx.cwd`.

## Файлы

### `.omp-handoff-session.json`

Пишет extension на `session_start`/`session_switch` только для main-сессии.
Subagent-сессии файл не трогают. Читают supervisor и orchestrator (spend).

```json
{
  "sessions": [
    {
      "terminal": "term_...",
      "sessionFile": "/home/u/.omp/agent/sessions/.../session.jsonl",
      "cwd": "/path/to/worktree",
      "pid": 12345,
      "updatedAt": "2026-11-24T12:00:00.000Z"
    }
  ]
}
```

- Один cwd может обслуживать несколько TUI-сессий: записи объединяются по
  `pid`, живая чужая запись не затирается, мёртвые pid вычищаются при записи.
- `terminal` — `ORCA_TERMINAL_HANDLE` или `null` вне Orca.
- Supervisor выбирает запись по `marker.sessionFile`; без него — самую свежую
  живую. Запись с мёртвым pid не перехватывает marker живой сессии.
- Плоский объект 0.5.15 и раньше читается как одна запись.
- Запись атомарная (temp + rename) под `.omp-handoff-session.lock/`; файл
  gitignored и не коммитится.

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

### `HANDOFF.md`: advisory `next-session:` (0.5.19)

Опциональная строка первой строкой state-файла, до заголовка H1:

```text
next-session: v=1 ts=2026-11-25T00:40Z model=cline-pass/deepseek-v4-pro thinking=auto mode=plan reason=seams
```

| Ключ | Обяз. | Допустимые значения |
|---|---|---|
| `v` | да | `1` |
| `ts` | да | ISO-8601 UTC `YYYY-MM-DDTHH:MMZ`, не старше 24 ч |
| `model` | нет | selector из `omp models --json` |
| `thinking` | нет | `off`/`auto`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`; вне каталога модели нормализуется в `auto` |
| `mode` | нет | `routine`/`plan`/`review` |
| `reason` | нет | slug `[a-z0-9._-]{1,32}` |

- Fail-closed: две строки, неверная позиция, повтор ключа, `v≠1` или
  устаревший `ts` — рекомендации нет целиком; файл не переписывается.
- Значения без пробелов, `=` и `#`; неизвестные ключи сохраняются парсером.
- Extension только показывает строку и её валидность в
  `/handoff-preflight`; модель внутри сессии не меняется. `bin/omp-yoda`
  добавляет `--model`/`--thinking` при запуске; явные флаги пользователя
  выигрывают, непроверенная модель не применяется.
- Без строки ничего не меняется: формат аддитивен и опционален.

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
