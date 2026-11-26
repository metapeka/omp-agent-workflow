# Команды и CLI OAW

Статус: `[готово]`, версия `0.5.25`. Источник истины — код
(`index.ts`, `orchestrator.ts`, `bin/`); этот файл — подробный гид.
Контракт режимов и файлов — [contracts.md](contracts.md).

Наши slash-команды (`/handoff-preflight`, `/handoff-new`, `/wrap`,
`/orchestrate`, `/orchestrate-stop`) работают только в main TUI: в sub-agent,
`print` и `json` они молча возвращаются. В режиме `off` команды остаются
доступными: это явные действия оператора, автоматика при этом выключена.
`/handoff` — builtin OMP, к плагину не относится.

## Slash-команды

| Команда | Аргументы | Что делает | Побочные эффекты |
|---|---|---|---|
| `/handoff` | `[фокус]` | **Builtin OMP**, не наш: алиас `/compact handoff` — сжатие в фоне с handoff-резюме | Пишет журнал сжатия; `HANDOFF.md` не создаёт и не правит |
| `/handoff-preflight` | `[файл state]` | Read-only проверка готовности: state (и его размер), сессия (cache hit, reasoning, spend), план/run (`AUTOPLAN.md`/`STATE.json`), git, ветка, upstream, merge в base, актуальность state, marker. Затем меню только незакрытых действий | Меняет файлы только выбранными действиями (см. ниже) |
| `/handoff-new` | `[файл state]` | Ждёт idle, открывает новую сессию с `continuePrompt` + содержимым state (лимит 32 000 символов, при обрезке — маркер и путь) | Новая сессия; `parentSession` связывает её с текущей; без файла — отказ |
| `/wrap` | — | Интерактивное завершение: карточки handoff, обновление `HANDOFF.md`, cleanup merged worktree, следующий worktree, ретро-review, выйти | Действия только после подтверждения; merge/publish не делает |
| `/orchestrate` | `[путь к AUTOPLAN]` | Запускает или продолжает план: `start` следующей задачи, либо stop/handoff по политике | Создаёт worktree/ветку/STATE при старте задачи; шлёт prompt агенту |
| `/orchestrate-stop` | `[причина]` | Ставит `STATE.stop` с причиной (по умолчанию `human`) и завершает цикл | Пишет STATE; resume — только tool `orchestrator` |

### `/handoff-preflight`: что проверяет

| Проверка | Провал/предупреждение |
|---|---|
| `HANDOFF.md` существует | fail — сначала обнови state |
| размер state | pass `N символов / 32000`; warn: > 24 000 «сократи state», ≥ 32 000 «обрежется при handoff» |
| advisory `next-session:` | warn: строка невалидна/устарела; валидная — pass (ничего не переключает) |
| cache hit сессии | pass; warn ниже 80% при prompt ≥ 50k токенов и ≥ 5 запросов |
| reasoning последнего хода и spend сессии | pass — измеренные величины из root session JSONL; spend показывается и при нулевом output последнего хода |
| план: задачи, gates, deps | путь — `STATE.plan.path` или `AUTOPLAN.md`; нет плана без state — pass «работа без оркестратора»; state ссылается на отсутствующий план — warn; план не читается — warn |
| попытки `STATE.attempts` | warn при ≥ 1 |
| run: текущая задача и spend | pass; warn при ≥ 90% `maxSpendUsd` |
| git-репозиторий и коммиты | fail; не-репозиторий — warn и git-проверки пропускаются |
| worktree чистый | fail со списком файлов (runtime-файлы исключены) |
| ветка не detached | fail |
| upstream и расхождение | warn/fail: не запушено, отстаёт, нет upstream |
| ветка влита в base | warn — смерджи до handoff |
| state закоммичен и свежее HEAD | warn/fail |
| marker | warn: стоит (supervisor сам сработает) или от другой сессии |

### Формат вывода `/handoff-preflight`

- Терминал ≥ 70 колонок: таблица `GROUP  ST  DETAIL` — ширина колонки группы
  считается по содержимому, длинные детали переносятся с отступом, вердикт —
  отдельная строка `✔ preflight: OK …` / `✘ preflight: блокеры …`.
- Уже 70 колонок: группы с иконками (`▸ 💾 usage`, `▸ ⎇ git`), вердикт и
  счётчики сверху, без выравнивания.
- Глифы — из словаря OMP (`theme.symbol`): `ascii` Symbol Preset печатает
  `[+]`/`[!]`/`[-]` и убирает иконки, `nerd` — Nerd Font; в headless и
  тестах — unicode-фолбэк. Цвет не используется: `notify` рендерится как
  dim-текст.
- Действия и вердикт используют те же глифы: `✔` сделано, `⦸` пропущено,
  `✘` ошибка.

Цена границы handoff **не показывается**: `usage.cost` — фактические
списания, их ставка на одну модель гуляет ~2× в пределах сессии, а
листовые цены `omp models --json` расходятся с ними ≈1.6×. Строка
появится вместе с таблицей ставок cache-monitor (`costs --json`).

Меню действий (если хост умеет `askDialog`) предлагает только незакрытое:

| Действие | Когда предлагается | Что делает |
|---|---|---|
| проверки | всегда | `npm test` и `npm run typecheck`, если скрипты есть; нет `package.json` или скриптов — «пропущено» с причиной |
| коммит | worktree грязный | `git add` без runtime-файлов; сообщение — черновик агента по `git status`/`git diff --stat` (side turn, tools off) в редакторе с заголовком «файлы»; пустой Enter принимает черновик, отмена — пропуск |
| merge | ветка не влита в base | ff-only merge в base worktree; конфликт — ошибка, без `--force` |

Перед каждым выбранным действием печатается строка `PREFLIGHT: …`
(`npm test/typecheck`, `git add + git commit`, `git merge --ff-only`), а в
итоге действие помечается статусом: `✓` выполнено, `–` пропущено (с
причиной), `✗` ошибка. Пропуск больше не выглядит как успех.

Без `askDialog` команда остаётся read-only и печатает таблицу.

## Tool `orchestrator` (для агента)

Регистрируется плагином, доступен только main TUI, `approval: exec`.
Все действия детерминированы и работают с `AUTOPLAN.md`/`STATE.json`.

| `action` | Параметры | Результат |
|---|---|---|
| `status` | — | Текущая задача, stop, бюджеты |
| `next` | — | Следующая готовая задача или stop |
| `start` | `task?` | Worktree+ветка+STATE, prompt агенту |
| `verify` | `task` | Запускает проверки задачи, пишет результат |
| `finish` | `task`, `commit`, `review?` | ff-only merge в base, обновление STATE; после — continuation или handoff |
| `rebase` | `task` | Rebase ветки на base; при конфликте — `rebase-required` |
| `stop` | `reason?`, `detail?` | Записывает stop и останавливает цикл |
| `resume` | — | Снимает stop, продолжает |

Политика stop/handoff: `docs/orchestrator.md` (задачи в сессии, spend,
время, gates, attempts, boundary-handoff).

## `/wrap`: карточки

| Карточка | Условие | Действие |
|---|---|---|
| Завершить сессию (handoff) | есть `HANDOFF.md` | Подсказывает выполнить `/handoff-new` |
| Обновить `HANDOFF.md` | всегда | Просит агента обновить state |
| Удалить завершённые worktree | merged + clean + не текущий | Удаляет каталог; ветка остаётся, tip в backup-ref |
| Создать worktree для следующей задачи | есть `AUTOPLAN.md` с `worktreeRoot` | `feat/<slug>` от base |
| Ретро-review текущей ветки | есть коммиты впереди base | Спрашивает подтверждение и шлёт reviewer-prompt |
| Publish / remote | — | Всегда выключена: только по решению владельца |
| Выйти | всегда | Ничего не меняет |

## Пространство имён и коллизии

Проверено 2026-11-25 на OMP 19.1.1 (`@oh-my-pi/pi-coding-agent` 19.1.0).

| Имя | Владелец | Статус |
|---|---|---|
| `/handoff` | OMP builtin (`/compact handoff`) | наш плагин его **не регистрирует** |
| `/handoff-preflight` | omp-agent-workflow | свободно |
| `/handoff-new` | omp-agent-workflow | свободно |
| `/wrap` | omp-agent-workflow | свободно |
| `/orchestrate` | omp-agent-workflow | свободно |
| `/orchestrate-stop` | omp-agent-workflow | свободно |
| tool `orchestrator` | omp-agent-workflow | свободно среди установленных плагинов |
| `/cache-monitor` | omp-cache-monitor | чужое, не пересекается |
| `/orca-model` | orca-agent-status extension | чужое, не пересекается |

Правила OMP, на которые опираемся:

1. Builtin-команды исполняются первыми
   (`input-controller` → `executeBuiltinSlashCommand`).
2. Extension-команда, чьё имя занято builtin, **отбрасывается** с warning
   «conflicts with built-in commands. Skipping» (`ExtensionRunner.getRegisteredCommands`).
   Именно поэтому `/handoff` в 0.5.18 убран из плагина.
3. Между двумя расширениями с одинаковым именем побеждает загруженное позже
   (Map по имени), без предупреждения — поэтому имена держим с префиксами
   `handoff-*`/`orchestrate*`.

Проверка в CI: `npm run check:names` читает реестр builtin'ов из
установленного пакета OMP и падает при пересечении. Входит в `npm run verify`.

При добавлении команды: запустить `npm run check:names`; если имя занято —
выбрать префикс, а не переименовывать builtin.

## CLI

### `bin/omp-orchestrate` — headless orchestrator

```
bin/omp-orchestrate status|next|start [TASK]|verify [TASK]|finish TASK --commit SHA|rebase [TASK]|stop --reason R|resume|doctor
```

| Флаг | Назначение |
|---|---|
| `--dir PATH` | control worktree (по умолчанию cwd) |
| `--plan PATH` | `AUTOPLAN.md` |
| `--mode MODE` | режим для политики |
| `--session-file PATH` | JSONL для spend |
| `--handoff-at N` | порог boundary handoff |
| `--context N` | текущий процент контекста |
| `--backend orca\|git` | backend worktree |
| `--verify-timeout SEC` | таймаут verify (по умолчанию 900) |
| `--strict` | `doctor`: повысить `warn` до `fail` |
| `--json` | машинный вывод |

`doctor` — read-only диагностика среды: 16 проверок в фиксированном порядке,
каждый проб ≤ 2 с, без сети, `STATE.json` не меняется. Отсутствие Orca,
agent-team или cache-monitor — `warn`/`skip`; битые настройки, план или state
— `fail` (exit 1). `--json` — контракт v1 (`schemaVersion: 1`, `ok`,
`summary`, `checks[]`), список проверок и стабильные поля `status` — в
[contracts.md](contracts.md#cli-json-v1-status-и-doctor-0520).

При `execution: external` в `AUTOPLAN.md` `start`, `verify`, `finish` и
`rebase` возвращают `stop: external-run`: задачи ведёт Ensemble (Orca
обязательна), OAW оставляет контекст и handoff. `status`, `next` и `doctor`
работают.

Требует `node --experimental-strip-types` (шим в `bin/` уже содержит shebang).


### `bin/omp-yoda` — launcher

```
bin/omp-yoda [флаги omp]
```

| Что | Поведение |
|---|---|
| Режим | Settings `workflowMode` > env `OMP_WORKFLOW_MODE` > `yoda-supervised` |
| `off` | `exec omp` без supervisor и без env-порогов; env `off` побеждает Settings |
| Supervisor | стартует, если `supervisorEnabled` и `orcaEnabled` не выключены |
| Env для supervisor | `OMP_HANDOFF_AT=55`, `OMP_CONTEXT_AUTO=off`, `OMP_HANDOFF_PROMPT`, `OMP_SUPERVISOR_RETRIES`, `OMP_SUPERVISOR_LOG_LEVEL` (Settings важнее) |
| `OMP_YODA_DIR` | каталог, который обслуживает supervisor (по умолчанию `$PWD`) |
| `OMP_YODA_LOG` | лог supervisor (по умолчанию `$TMPDIR/omp-yoda-supervisor.log`) |
| Аргументы | передаются `omp` как есть (`--model`, `--thinking`, `--version`, …) |
| Advisory | `next-session:` из `HANDOFF.md` → `--model`/`--thinking`; явные флаги пользователя выигрывают |
| `--preset NAME` | `routine`/`plan`/`review`/`budget`: модель, thinking, пороги и continue prompt; явный флаг важнее Settings `workflowPreset` и отменяет advisory. `--preset` снимается из argv, остальное уходит `omp` |

### `bin/omp-preset` — пресет-флаги для launcher

Внутренний helper `bin/omp-yoda`; печатает по одному аргументу на строку.

| Флаг | По умолчанию | Что делает |
|---|---|---|
| `--preset NAME` | — | обязателен: `routine`/`plan`/`review`/`budget`; иначе exit 2 |
| `--omp PATH` | `omp` | бинарь для `omp models --json` |
| `--flags` | режим по умолчанию | `--model`/`--thinking` с учётом явных флагов после `--` |
| `--prompt` | — | preset continue prompt; пусто — общий default |
| `--` | — | дальше — аргументы omp |

### `bin/omp-next-session` — advisory для launcher

Внутренний helper `bin/omp-yoda`; печатает по одному флагу на строку.

| Флаг | По умолчанию | Что делает |
|---|---|---|
| `--dir` | `$PWD` | каталог с `HANDOFF.md` |
| `--state` | `HANDOFF.md` | имя state-файла |
| `--omp` | `omp` | бинарь для `omp models --json` |
| `--` | — | дальше — аргументы omp; явные `--model`/`--thinking` отменяют advisory |

Пустой вывод — строки нет, она невалидна/устарела или модель не прошла
каталог. Exit code 0 во всех случаях: запуск не ломается.

### `bin/omp-handoff-supervisor.mjs`

| Флаг | По умолчанию | Что делает |
|---|---|---|
| `--dir` | `$PWD` | каталог с marker/session info |
| `--marker` | `.omp-handoff-request.json` | файл запроса |
| `--session` | `.omp-handoff-session.json` | карта сессий по pid |
| `--interval` | `2` | период опроса, секунды |
| `--once` | off | один проход и выход |
| `--dry-run` | off | печатает план (`terminal`, `/handoff-new`, prompt), ничего не отправляет |
| `--prompt` | env или встроенный | continuation prompt после handoff |
| `--no-prompt` | off | не отправлять continuation |
| `--max-attempts` | `3` | попытки отправки `/handoff-new` |
| `--cooldown` | `300` | пауза после успешного handoff |
| `--stale-grace` | `5` | сколько секунд marker может опережать запись session info |
| `--lock` | `.omp-handoff-supervisor.lock` | lock-dir одного supervisor на каталог |
| `--lock-grace` | `10` | перехват stale lock |

Второй экземпляр на тот же `--dir` выходит с кодом 0 и не трогает marker.
После успеха supervisor удаляет marker и просит новую сессию продолжить.

## Файлы, с которыми работают команды

| Путь | Кто пишет | Кто читает |
|---|---|---|
| `HANDOFF.md` | агент/человек; первая строка может быть advisory `next-session:` | `/handoff-preflight`, `/handoff-new`, `/wrap`, supervisor prompt, `bin/omp-yoda` |
| `AUTOPLAN.md` | агент/человек | `/orchestrate`, tool `orchestrator`, `/wrap` |
| `STATE.json` | tool `orchestrator`, `/orchestrate-stop` | policy, статус, `/wrap` |
| `.omp-handoff-request.json` | агент по запросу плагина | supervisor |
| `.omp-handoff-session.json` | плагин (main TUI) | supervisor, `--dry-run` |
| `.omp-handoff-supervisor.lock/` | supervisor | второй экземпляр |
| `.omp-handoff-session.lock/` | плагин | параллельные записи session info |

Runtime-файлы (`.omp-handoff-*`, `STATE.json`) исключены из git-проверок
preflight и из `.gitignore`.

## Чего команды не делают

- не переключают модель внутри сессии: `/handoff-new` остаётся в том же
  процессе; `next-session:` применяет только `bin/omp-yoda` при старте;
- не пушат и не публикуют (publish — только решение владельца);
- не форсируют merge и не удаляют ветки (`-d` только после merged);
- не начинают новую сессию из event-handler — только `/handoff-new`;
- не меняют чужие репозитории и не греют кэш.

## Связанные документы

- [contracts.md](contracts.md) — режимы, env, схемы marker/session.
- [handoff-flow.md](handoff-flow.md) — кто и когда вызывает `/handoff-new`.
- [orchestrator.md](orchestrator.md) — действия, политика, stop-gates.
- [wrap.md](wrap.md) — карточки и safety cleanup.
- [operations.md](operations.md) — runbook и типовые сбои.
