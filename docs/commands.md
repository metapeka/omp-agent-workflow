# Команды и CLI

Статус: `[готово]`, версия `0.5.18`. Источник истины — код
(`index.ts`, `orchestrator.ts`, `bin/`); этот файл — подробный гид.
Контракт режимов и файлов — [contracts.md](contracts.md).

Все slash-команды работают только в main TUI: в sub-agent, `print` и `json`
они молча возвращаются. В режиме `off` команды остаются доступными: это
явные действия оператора, автоматика при этом выключена.

## Slash-команды

| Команда | Аргументы | Что делает | Побочные эффекты |
|---|---|---|---|
| `/handoff` | `[инструкции]` | Сжимает контекст: решения, файлы, проверки, блокеры, следующие шаги. Свои инструкции заменяют встроенные | Пишет только журнал сжатия; `HANDOFF.md` не создаёт и не правит |
| `/handoff-preflight` | `[файл state]` | Read-only проверка готовности: state, git, ветка, upstream, merge в base, актуальность state, marker. Затем меню только незакрытых действий | Меняет файлы только выбранными действиями (см. ниже) |
| `/handoff-new` | `[файл state]` | Ждёт idle, открывает новую сессию с `continuePrompt` + содержимым state (лимит 32 000 символов, при обрезке — маркер и путь) | Новая сессия; `parentSession` связывает её с текущей; без файла — отказ |
| `/wrap` | — | Интерактивное завершение: карточки handoff, обновление `HANDOFF.md`, cleanup merged worktree, следующий worktree, ретро-review, выйти | Действия только после подтверждения; merge/publish не делает |
| `/orchestrate` | `[путь к AUTOPLAN]` | Запускает или продолжает план: `start` следующей задачи, либо stop/handoff по политике | Создаёт worktree/ветку/STATE при старте задачи; шлёт prompt агенту |
| `/orchestrate-stop` | `[причина]` | Ставит `STATE.stop` с причиной (по умолчанию `human`) и завершает цикл | Пишет STATE; resume — только tool `orchestrator` |

### `/handoff-preflight`: что проверяет

| Проверка | Провал/предупреждение |
|---|---|
| `HANDOFF.md` существует | fail — сначала обнови state |
| git-репозиторий и коммиты | fail; не-репозиторий — warn и git-проверки пропускаются |
| worktree чистый | fail со списком файлов (runtime-файлы исключены) |
| ветка не detached | fail |
| upstream и расхождение | warn/fail: не запушено, отстаёт, нет upstream |
| ветка влита в base | warn — смерджи до handoff |
| state закоммичен и свежее HEAD | warn/fail |
| marker | warn: стоит (supervisor сам сработает) или от другой сессии |

Меню действий (если хост умеет `askDialog`) предлагает только незакрытое:

| Действие | Когда предлагается | Что делает |
|---|---|---|
| проверки | всегда | `npm test` и `npm run typecheck`, если скрипты есть |
| коммит | worktree грязный | `git add` без runtime-файлов, сообщение из input |
| merge | ветка не влита в base | ff-only merge в base worktree; конфликт — ошибка, без `--force` |

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

## CLI

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
| `HANDOFF.md` | агент/человек | `/handoff-preflight`, `/handoff-new`, `/wrap`, supervisor prompt |
| `AUTOPLAN.md` | агент/человек | `/orchestrate`, tool `orchestrator`, `/wrap` |
| `STATE.json` | tool `orchestrator`, `/orchestrate-stop` | policy, статус, `/wrap` |
| `.omp-handoff-request.json` | агент по запросу плагина | supervisor |
| `.omp-handoff-session.json` | плагин (main TUI) | supervisor, `--dry-run` |
| `.omp-handoff-supervisor.lock/` | supervisor | второй экземпляр |
| `.omp-handoff-session.lock/` | плагин | параллельные записи session info |

Runtime-файлы (`.omp-handoff-*`, `STATE.json`) исключены из git-проверок
preflight и из `.gitignore`.

## Чего команды не делают

- не переключают модель и не меняют провайдера;
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
