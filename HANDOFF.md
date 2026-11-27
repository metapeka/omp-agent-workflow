# Передача: OAW (`omp-agent-workflow`)

Дата: 2026-11-27. Основной репозиторий: `~/projects/omp-agent-workflow`.
OAW — короткое имя продукта; `workflow` — только его режимы и ключи
(`workflowMode`, статус-ключ). Вики — `docs/README.md`; backlog — `TODO.md`.

## Цель

Довести OAW до релиза 1.0: context guard, ручной и автоматический handoff,
оркестратор задач и экономика сессий без обязательных внешних сервисов.
1.0.0 собран: установка из tarball проверена, релизные заметки написаны
(`docs/release-notes-1.0.0.md`). Осталось решение владельца о публикации
(push, GitHub release `v1.0.0`, npm/marketplace — D10).

## Состояние

Версия `1.0.0`; в `main` слит локальный ff-only коммит релиза поверх
`origin/main` (`dae9e9d`), push не выполнялся — ждёт разрешения владельца.
Последний запушенный код — `cc0f522` (0.7.4); CI зелёный на нём и на docs
после него, Pages задеплоен. Открытых работ по коду нет. В `main`:

- 1.0.0 релиз: версия `1.0.0` в `package.json` и
  `.omp-plugin/marketplace.json`; пакет — 83 файла, в него входят
  `.omp-plugin/marketplace.json` и `CONTRIBUTING.md`; установка из tarball
  проверена (`npm pack` → распаковка → `omp plugin link <dir>/package`:
  `omp plugin list` 1.0.0, Settings 15 ключей, `omp plugin doctor` ok,
  extension load exit 0, `doctor --json` exit 0 — 10 pass/2 warn/4 skip,
  `omp-yoda --version` exit 0, `omp-preset --preset plan --flags` — модель
  и thinking, `next-session`/supervisor — exit 0); релизные заметки
  `docs/release-notes-1.0.0.md`, запись `[1.0.0]` в `CHANGELOG.md`, раздел
  tarball и ссылка на заметки в README EN/RU/ZH; README-факты исправлены
  (15 настроек, badge 389/389), вики-версия 1.0.0;
- CLI-скрипты под `node_modules`: тела переехали в
  `lib/cli/{orchestrate,next-session,preset}.ts`, `bin/` — шимы, которые
  регистрируют `lib/ts-loader.mjs` (`node:module.stripTypeScriptTypes`) и
  обходят отказ Node снимать типы под `node_modules`; один код-путь для
  клона, tarball и `node_modules`, Node ≥ 22.13; тела CLI теперь
  typechecked (`ActionContext`, union результатов); регрессия —
  `test/package-run.test.mjs` (3), всего 389 тестов;
- 0.7.4 леджер субагентов: `STATE.budgets.costTotals` — вклад каждого
  session-файла (root, вложенные subagent-сессии, сессии после handoff),
  `spendUsd` = Σ вкладов; перезапись на месте (компакция) заменяет вклад
  вместо двойного счёта; хвост прошлой сессии дочитывается при смене
  `run.sessionFile`; `status --json` отдаёт аддитивный
  `spend{measured,spentUsd,limitUsd,remainingUsd,exceeded,files[]}`,
  preflight — ту же проекцию; `start`/`finish` ставят stop `budget-spend`;
- 0.7.3 discovery: `.omp-plugin/marketplace.json` (каталог `metapeka-omp`,
  `source: "./"`, версия сверяется тестом с `package.json`) и страница
  сравнения `docs/comparison.md` (EN/RU/ZH) — против встроенных средств
  OMP и ближайших плагинов, «что выбрать», самопроверка, установка из
  маркетплейса; ссылки из README EN/RU/ZH и вики;
- 0.7.2 `economics --summary`: агрегат по цепочке (`sessions`, `handoffs`,
  `boundaries`, `turns`, `spendUsd`, `medianTurnUsd`, `avgBoundaryUsd`,
  `hitTrend`) аддитивным полем `summary` в JSON и блоком `Сводка:` в
  тексте; без флага отчёт и JSON прежние, без цен — `null` и note;
- 0.7.1 quality gate в `/handoff-preflight`: шесть ключевых разделов
  `HANDOFF.md` (цель/состояние/решения/файлы/проверки/дальше) и компакция
  после state — advisory-warning, фикс строкой в блоке «вручную»
  (`docs/guards.md`);
- 0.7.0 spend-aware handoff: `handoffAtSpendUsd` (15-й ключ) и
  `OMP_HANDOFF_AT_USD`, маркер `reason: "spend"`; P1 ревью (OMP переписывает
  JSONL на месте после компакции) закрыт `CostRead.restarted`;
- 0.6.x: цена границы handoff из `omp-cache-monitor costs --json` v1 и
  read-only `omp-orchestrate economics` (`CHANGELOG.md`).

GitHub: `metapeka/omp-agent-workflow` (public), тег и release `v0.5.14`.
Ветки 0.5.1–0.7.4 слиты ff-only, worktrees удалены, ветки `feat/*`
сохранены. Публикация по умолчанию локальная (D10); push 0.7.1–0.7.4
выполнен с явного разрешения владельца; npm/marketplace-публикация —
только по отдельному разрешению.

## Продукты OMP (сессия 2026-11-27)

Сессия вела соседние продукты, не OAW. Источники истины по ним —
`~/projects/omp-usage/HANDOFF.md` и `~/projects/omp-skill-library/HANDOFF.md`.

- skill-library 0.3.0: `relink` (перепривязка ссылок после переезда
  библиотеки) и opt-in hook `session_start` (`autoLink: off|report|apply`);
  миграция 28 навыков выполнена, `~/.agents/skills` — управляемые симлинки;
  плагин подключён, `autoLink=report`.
- usage 0.3.0: вкладка `Library` (status + findings `doctor`), колонка `Link`
  в Project skills; живой `library.get` — 28 ссылок, drift 0.
- `docs/products.md` обновлён во всех четырёх репозиториях (обе версии 0.3.0).
- Проверки: skill-library 58 тестов; usage 22 + 16; `orca plugin check panel`
  exit 0; OMP видит 35 навыков, Orca — 28.
- Не делали: публикацию/push (origin для usage и skill-library — позже по
  решению владельца), новые панели, Windows/contracts (P3).

## Что готово

| Что | Состояние |
|---|---|
| Context guard | warning 35%, HANDOFF 50%, `/handoff-new`, `/handoff-preflight`; `/handoff` — builtin OMP |
| Workflow modes | `off` / `manual` / `assisted` / `yoda` / `yoda-supervised` |
| Automatic handoff | session info, marker, supervisor, continuation prompt |
| Supervisor singleton | lock, stale reclaim, identity guard, release на сигналах |
| Launcher | читает Settings; supervisor гейт; warning по Orca |
| Orchestrator 0.5 | `AUTOPLAN.md`, `STATE.json`, actions, policy, budgets |
| Wrap 0.5.1 | `/wrap`, safe cleanup, next worktree, review |
| Orca additive 0.5.3 | terminal list/show, `status`, `ORCA_CLI_COMMAND` |
| Settings 0.5.4–0.5.5 | 15 ключей в Settings → Plugins (0.5.22 добавил `workflowPreset`, 0.7.0 — `handoffAtSpendUsd`) |
| Preflight 0.5.6–0.5.7 | read-only проверка перед `/handoff-new` |
| State 0.5.8 | `/handoff-new` встраивает state-файл в новую сессию |
| Checklist 0.5.9 | `/handoff-preflight`: чек-лист, затем таблица проверок |
| Actions 0.5.10 | `/handoff-preflight`: проверки, commit, ff-merge; остальное вручную |
| Flow 0.5.11 | preflight: состояние → меню незакрытых действий → итог |
| Status 0.5.12 | ключ `workflow`: `YODA`/`YODA-SUP`, `⚠ HANDOFF` |
| Status 0.5.13 | `SUP OFF` и `T2 verify` в том же ключе |
| Economics 0.6.1 | `omp-orchestrate economics`: цепочка `parentSession`, граница только у handoff-ребёнка, окна/hit/recovery/компакции, JSON v1; ветка `feat/handoff-economics` |
| Spend handoff 0.7.0 | `handoffAtSpendUsd` (15-й ключ) + `OMP_HANDOFF_AT_USD`: второй, независимый от контекста триггер по измеренному `usage.cost.total`; offsets читают только хвост JSONL (root + дочерние сессии), `restarted`/`session_compact` пересчитывают total, не сбрасывая spend; общий cooldown/supervisor/`⚠ HANDOFF`, marker `reason: "spend"` (оба триггера — `"context"`); влито `3ba713d` |
| Quality gate 0.7.1 | `lib/state-sections.ts`: шесть ключевых разделов `HANDOFF.md` по заголовкам и синонимам (EN/RU), код-блоки не в счёт; отсутствующий раздел — отдельный warn, нестандартный формат — одна строка; `lastCompactionAt` из того же JSONL-прохода, warn если компакция позже mtime state; фикс — строкой в «вручную»; `ready` не меняется |
| Economics summary 0.7.2 | `economics --summary`: `summarizeEconomics()` в `lib/handoff-economics.ts` — `sessions`/`handoffs`/`measuredSessions`/`boundaries`/`turns` (`null`, если не измерено ничего), измеренный `spendUsd` (сумма цен ходов прочитанных сессий), `medianTurnUsd`, `avgBoundaryUsd` и `hitTrend` (`up\|down\|flat` при пороге 0.5 pp включительно); аддитивное `summary` в JSON, блок `Сводка:` с отношением `BORDER` к обычному ходу; без флага отчёт прежний, частичное покрытие — note `N из M` |
| Discovery 0.7.3 | `.omp-plugin/marketplace.json`: каталог `metapeka-omp`, один плагин `source: "./"`, версия/имя/домашняя страница; `omp plugin marketplace add` парсит каталог, dry-run install резолвит `omp-agent-workflow@metapeka-omp` (упирается только в уже linked имя); `test/marketplace.test.mjs` (5) держит версию равной `package.json`. `docs/comparison.md` + RU/ZH: встроенные средства OMP, ближайшие плагины, «что выбрать», самопроверка, установка |
| Ledger 0.7.4 | `lib/orchestrator/ledger.ts`: `projectBudgets` (дельта прибавляется, `restarted` заменяет вклад файла) и `ledgerSnapshot`; `cost.ts` отдаёт `entries[]{kind,readable,fullTotalUsd}`; `state.budgets.costTotals` — вклад по файлам, старый state читается как пустая карта; `syncSession` дочитывает хвост прошлой сессии; `status --json` → аддитивный `spend`, preflight `run:` — та же проекция; `start`/`finish` → stop `budget-spend`; тесты `test/ledger.test.mjs` (5) + `orchestrator` (+5) + контракт |
| Release 1.0.0 | Пакет без сборки и runtime-зависимостей (83 файла: extension, `lib/`, `bin/`, docs, `.omp-plugin/`, `CONTRIBUTING.md`); установка из tarball проверена — `omp plugin link` распакованного каталога, Settings 15 ключей, `omp plugin doctor` ok, extension load exit 0, packaged `doctor --json` exit 0, launcher и preset — exit 0; релизные заметки `docs/release-notes-1.0.0.md`; CLI под `node_modules` работают через `lib/ts-loader.mjs` (шимы `bin/`), регрессия — `test/package-run.test.mjs` |
| Landscape 2026-11-23 | `docs/research/market-landscape.*` (EN/RU/ZH): прямого аналога нет; OMP builtin `/handoff` и worktree-команды учтены; ссылки из README, вики и ROADMAP |
| Safe cleanup 0.5.14 | `removeWorktree`: merged/clean/current/live guard, без `--delete-branch`/`--force`/`-D`, ветка остаётся, tip в backup-ref; retry failed переименовывает ветку в `-failed-<ts>` |
| Handoff guards 0.5.15 | state 32k символов (≈10–15k токенов); warning без supervisor/terminal handle; повтор запроса без marker (2 хода, максимум 3) |
| Session info 0.5.16 | `{sessions}` по pid, dead prune, lock + atomic rename; supervisor выбирает по `marker.sessionFile` |
| Fallback 0.5.17 | авто-компакция срабатывает после исчерпания handoff-повторов или при marker без живого supervisor |
| Kill switch 0.5.18 | `workflowMode: off` (`OMP_WORKFLOW_MODE=off`): плагин молчит, OMP на дефолтах, launcher делает exec omp без supervisor; env off побеждает Settings |
| Advisory 0.5.19 | `next-session:` первой строкой `HANDOFF.md`: launcher добавляет `--model`/`--thinking` при старте (явные флаги выигрывают), preflight показывает валидность; модель в сессии не меняется (D14) |
| Doctor 0.5.20 | `bin/omp-orchestrate doctor [--json] [--strict]`: 16 read-only проверок в фиксированном порядке, проба ≤ 2 с, без сети; нет Orca/agent-team/cache-monitor — warn/skip; битые настройки/план/state — fail; `status --json` и `doctor --json` — `schemaVersion: 1` |
| Execution 0.5.21 | `plan.execution: omp\|external` (D15): без поля — `omp`, hash старых планов не меняется; `external` — задачи ведёт Ensemble, `start/verify/finish/rebase` → stop `external-run` без lock/state/worktree; `status`/`next`/`doctor`/handoff работают; `doctor` warn, если external без активного прогона |
| Presets 0.5.22 | `routine`/`plan`/`review`/`budget` (D16): Settings `workflowPreset` (14-й ключ) и `--preset`; модель/thinking/пороги/continue prompt, явные значения и флаги выигрывают; явный `--preset` отменяет advisory; `plan` советует `model=flash mode=routine` |
| Имена команд 0.5.18 | `/handoff` убран (builtin OMP); `npm run check:names` сверяет 105 builtin-имён с нашими 5 в `verify`; коллизий 0 |
| Гид по командам | `docs/commands.md`: слэш-команды, tool `orchestrator`, меню preflight, карточки `/wrap`, CLI launcher/supervisor/orchestrate, владельцы имён |
| Замеры 2026-11-24/25 | `docs/research/model-modes.md`: цены 9 моделей, reasoning flash/pro, handoff-payload 20 сессий, цена границы, рекомендации R1–R8 |
| Пресеты 0.5.22 | `docs/research/workflow-presets.md`: F1/F2 сделаны; F4 `--plan-yolo` — только после замера |
| Метрики 0.5.23 | `lib/session-metrics.ts` + строки preflight: размер state против 32k, cache hit, reasoning share и spend сессии из root JSONL, прогресс плана с gate/deps, attempts, run spend |
| Цена границы 0.6.0 | `lib/costs-client.ts`: `omp-cache-monitor costs --json` (schemaVersion 1) с graceful skip; строка `usage-border` — медиана холодных ходов против тёплых, `usage-model` — разрез при >1 модели; CLI — `OMP_CACHE_MONITOR_CLI` или `PATH` |
| Flight recorder 0.5.24 | `workingTreeSnapshot()`: ветка, короткий HEAD, до 6 незакоммиченных путей в тексте запроса HANDOFF; runtime-файлы исключены; контракт marker/session не меняется; карта защит — `docs/guards.md` |
| Вывод preflight 0.5.25 | Таблица `GROUP  ST  DETAIL` (расчётная ширина, перенос деталей) и fallback-группы с иконками уже 70 колонок; глифы `theme.symbol` (unicode/nerd/ascii), unicode-фолбэк; `✔ ⦸ ✘` у действий и вердикта; формат — `docs/commands.md` |
| Push в меню 0.5.26 | Действие `push` при upstream и незапушенных коммитах: `git push` без `--force`, timeout 120 с; отказ remote не двигает ref; skip после упавших проверок/commit; тесты на успех/отказ/пропуск |
| Запрос cache-monitor | `docs/research/cache-monitor-costs-api.md`: `costs --json` v1 реализован в cache-monitor 0.11.0 (`5c9eeb8`); OAW 0.6.0 — клиент, тесты и строка preflight |
| Doctor (согласовано) | ТЗ для `bin/omp-orchestrate doctor` с соседним проектом: 16 проверок, `--json`/`--strict`, план опционален; Ф1 реализован в 0.5.20 |
| Joint plan 2026-11-26 | Три продукта; Ф0 контракт (`status`/`doctor`, `schemaVersion:1`), Ф1 doctor, Ф2 `execution: external` и Ф4 контрактные тесты (`test/contracts.test.mjs`) — сделаны (0.5.20–0.5.21, D15); Ф3 hub и `brief` — личные вне репозитория; границы и матрица конфликтов согласованы |
| Explainer 2026-11-24 | `docs/index.html` + `ru/` + `zh/`: кэш, сессии, handoff, инцидент и пороги на реальной 400-ходовой сессии; Pages `main /docs` |
| Release 0.5.14 | публичный GitHub-репозиторий, tag/release, tri-lingual README, CI green |
| Проверки | `npm run check:names` (OMP builtins: 105, наших 5, конфликтов 0), `npm test`, `npm run typecheck`, extension load exit 0, launcher `--preset`/`--preset=`, HTML tag/link check + browser screenshots |

## Инцидент 2026-11-23: SIGTERM при `orca worktree rm`

**Факты.** В `omp-cache-monitor` после merge `feat/ui-presets` команда
`orca worktree rm --worktree path:.../ui-presets --delete-branch` убила
SIGTERM живую OMP-сессию `01a206db` через 0.1 с; ранее то же случилось с
`.../coelacanth --force --delete-branch`. Orca довела удаление до конца.
Обе ветки были влиты, refs восстановлены вручную.

**Причина (проверено на одноразовых worktree).** Orca на `worktrees:remove`
вызывает `stopPtys(worktreeId)` / `stopTerminalsForWorktree` до удаления:
останавливаются все PTY удаляемого worktree, включая терминал, в котором
работает OMP. `worktreeMeta.cliProvenance.callerTerminalHandle` — только
lineage при create; на удаление не влияет: caller в другом worktree выжил,
а PTY target получил SIGTERM (trap записал `TERM`).

**setsid/другой терминал.** Detached-процесс под `setsid` переживает
остановку PTY (проверено), но терминал/сессия всё равно умирает, а cwd
исчезает под процессом. Запуск из другого терминала безопасен только если
живая сессия не привязана к target; поэтому guard запрещает target ==
текущий cwd и любые процессы/терминалы внутри.

**git без Orca.** `git worktree remove <path>` убирает каталог и git-запись,
но Orca сохраняет metadata: `orca worktree list/show` продолжают показывать
worktree. Запись убирается повторным `orca worktree rm --worktree
path:<path> --json` (проверено). Поэтому Orca-путь предпочтителен;
git-fallback возвращает warning с этой командой.

**Ветка.** Orca 1.4.269 и без `--delete-branch` сохраняет локальную ветку
(help: newer hosts keep branch; `--delete-branch` = safe delete). Workflow
теперь не передаёт `--delete-branch`, tip пишет в
`refs/omp-worktree-backup/*`.

**Воспроизведение (только disposable worktree).**

```bash
orca worktree create --repo path:<base> --name probe \
  --branch tmp/probe --base-branch main --no-parent --json
orca terminal create --worktree path:<wt> \
  --command 'trap "echo TERM; exit 143" TERM; sleep 300' --json
orca worktree rm --worktree path:<wt> --json    # PTY target получает SIGTERM
# безопасно: закрыть терминал, затем removeWorktree/guard, ветка остаётся
```

**Recovery.** `git branch <branch> <tip>` или
`git update-ref refs/heads/<branch> <backupRef>`.

**Осталось.** Поведение Orca документировано («stops its sessions»), но
опасно для caller внутри target: кандидат в issue — отказывать в удалении
при живом терминале или не убивать caller; workflow-фикс (guard) остаётся
обходом.

## `/handoff-preflight [файл]`

Сначала read-only таблица и вердикт, затем меню только незакрытых действий,
затем структурированный итог: действия, ручные шаги, свежая таблица.
Действия могут менять репозиторий; блокеры **advisory**: `/handoff-new`
их не проверяет.

- Меню: `checks` — всегда; `commit` — при грязном дереве; `merge` — если
  ветка не влита в `main`. У предложенных действий предвыбран «Сделать».
- `checks` — `npm run test`/`typecheck`, если скрипты есть; битый или
  нечитаемый `package.json` — провал проверок.
- `commit` — `git add -A` без runtime-файлов `.omp-handoff-*` + сообщение
  из `input`; detached HEAD отклоняется.
- `merge` — только `git merge --ff-only` в чистый `main` worktree; ошибка
  не форсится; упавшие проверки блокируют commit/merge в этом запуске.
- Runtime-файлы `.omp-handoff-session.json`, `.omp-handoff-request.json`,
  `.omp-handoff-supervisor.lock*`, `.omp-handoff-done.json` не считаются
  грязным деревом и не коммитятся.
- Вручную/агентом: завершить задачу, обновить `HANDOFF.md`, удалить worktree
  после выхода.
- Отмена меню останавливает команду. Без `askDialog` (старый TUI-хост) меню
  пропускается, команда read-only и печатает таблицу; в headless/sub
  команда молчит.
- Блокеры: нет state-файла (default `HANDOFF.md`); грязное дерево; detached
  HEAD; нет коммитов; git-репозиторий не читается; незапушенные коммиты при
  наличии upstream.
- Warnings: нет upstream или не удалось сравнить; ветка не влита в
  `main`/`origin/main`; state старше HEAD; upstream впереди; stale marker;
  marker текущей сессии (supervisor сработает сам).
- Ошибка git отличается от «не репозиторий»; git-вызовы с timeout 10 с.
- Аргумент — как у `/handoff-new`: `/handoff-preflight ALT.md`.

## `/handoff-new [файл]` 0.5.8

Custom message новой сессии собирается из `continuePrompt` и содержимого
state-файла; prompt без состояния больше не передаётся.

- Лимит — 32 000 символов; `omp toks` на русском тексте даёт 2.1–3.0
  символа/токен, то есть это ≈10–15k токенов, а не 16k при прежних 64k.
  При превышении добавляется маркер с числом показанных/полных символов и
  путём файла; surrogate pair не разрывается.
- Ошибка чтения — fallback: prompt + просьба прочитать файл самому.
- Текст `continuePrompt` остаётся настраиваемым и идёт первым.
- `cwd` новой сессии — `ctx.cwd`; запускать `/handoff-new` из корня
  передаваемого проекта.
- Ручной `/handoff-new` не запускает ход: без supervisor отправь в новой
  сессии «продолжай». Supervisor при automatic handoff отправляет
  continuation prompt сам.

## Handoff guards 0.5.15

Проверки на пороге handoff (`checkHandoff`), только main TUI:

- Если `workflowMode=yoda-supervised`, `supervisorEnabled` и `orcaEnabled`
  включены, но `.omp-handoff-supervisor.lock/owner.json` отсутствует, pid мёртв
  или lock принадлежит другому каталогу — один warning на порог:
  «Supervisor не запущен … `bash bin/omp-yoda --dir <cwd>`».
- Пустой/пробельный `ORCA_TERMINAL_HANDLE` пишется в
  `.omp-handoff-session.json` как `null`; на пороге — warning «terminal handle
  нет — automatic handoff не сработает» один раз за сессию.
- Marker нет через 2 завершённых хода после запроса — запрос повторяется с
  warning «HANDOFF запрошен N раз, marker не появился»; после 3 запросов
  повторы прекращаются, статус `⚠ HANDOFF` остаётся.
- В режимах без automatic handoff (`assisted`, `manual`, `yoda`) эти
  предупреждения не показываются.

## Session info 0.5.16

Дефект из аудита RMRP: `.omp-handoff-session.json` был один объект на cwd,
и короткий `omp "…"` затирал terminal handle живой сессии; supervisor
считал marker живой сессии stale.

Выбран вариант 1 (карта записей), а не «не затирать живой pid»: при двух
живых сессиях в одном cwd второй процесс не смог бы записать свой handle,
и его marker всё равно считался бы stale.

- Файл: `{ "sessions": [{ terminal, sessionFile, cwd, pid, updatedAt }] }`;
  плоский объект 0.5.15 читается как одна запись.
- `writeSessionInfo` объединяет по `pid`, живые чужие записи сохраняет,
  мёртвые pid вычищает; read-modify-write под
  `.omp-handoff-session.lock/`, запись атомарная (temp + rename).
- Supervisor выбирает запись по `marker.sessionFile`; запись с мёртвым pid
  не перехватывает marker живой сессии; без `sessionFile` — самая свежая
  живая. `waitForNewSession` отслеживает ту же запись по `pid`/terminal.
- `lib/session-info.ts` — parse/merge; `sessionFileFromInfo` в orchestrator
  читает карту (сначала свой pid, затем самый свежий `updatedAt`).

## Fallback-компакция 0.5.17

`checkAuto` раньше не срабатывал, пока `handoffRequested = true`, поэтому при
зависшем handoff (нет supervisor, marker не появился) настроенный
`autoCompactPercent` не включался вообще.

- Ждём, пока handoff ещё actionable: остались повторы (marker нет) или
  marker держит живой supervisor в `yoda-supervised`.
- После 3 запросов без marker — компакция срабатывает на
  `autoCompactPercent`.
- Marker без живого supervisor больше не блокирует fallback (в
  `yoda-supervised` supervisor мёртв/не запущен; в `yoda` его нет по
  определению).
- Рекомендация для окна 1M: `handoffAtPercent=30`, `autoCompactPercent=40`
  (400k вместо 600k): fallback должен быть до заметной деградации модели.
  Настройки через `omp plugin config`; код их не меняет.

## Advisory `next-session:` 0.5.19

Первая строка `HANDOFF.md`, до H1:
`next-session: v=1 ts=2026-11-25T00:40Z model=… thinking=… mode=plan reason=slug`.
Формат — аддитивный и опциональный; без строки ничего не меняется.

- `lib/next-session.ts` — fail-closed разбор: две строки, неверная позиция,
  повтор ключа, `v≠1`, `ts` не ISO-8601 UTC или старше 24 ч (и больше чем на
  24 ч в будущем) — рекомендации нет целиком. Значения без пробелов, `=` и
  `#`; неизвестные ключи сохраняются в порядке.
- `model` проверяется по `omp models --json`; неизвестная модель
  отбрасывается, остальные ключи действуют. Каталог недоступен — модель
  сохраняется с пометкой, но launcher её не применяет.
- `thinking` нормализуется по массиву каталога: вне массива (в том числе
  `null` у flash) → `auto`; строка не отбрасывается. Невалидный уровень,
  `mode` или `reason` — ключ игнорируется с проблемой.
- `bin/omp-next-session` печатает флаги, `bin/omp-yoda` добавляет
  `--model`/`--thinking` перед аргументами пользователя; явные
  `--model`/`--thinking` отменяют advisory. Exit code 0 всегда: запуск не
  ломается. В режиме `off` advisory не читается (exec omp).
- `/handoff-preflight` показывает строку и валидность; каталог читается
  только если в строке есть `model`. Ничего не переключает.
- Обрезка state до 32 000 символов сохраняет строку: она в голове файла —
  закреплено тестом.
- D14: Settings-ключ `workflowPreset` и статус-строка не меняются;
  F2-пресеты — отдельное решение.

## Статус-строка 0.5.12–0.5.13

Один ключ `workflow`, только main TUI. Текст: `YODA` / `YODA-SUP` по
`workflowMode`; `⚠ HANDOFF` — при `usage >= handoffAtPercent` или marker
текущей сессии. `SUP OFF` — в `yoda-supervised`, если lock/pid supervisor'а
не найден. `T2 verify` — пока `STATE.json.run.active` и есть `current`.
Stale marker другой сессии игнорируется. `statusEnabled=false` очищает ключ;
native `context_pct` не дублируется.

## Settings 0.5.5

`package.json#omp.settings` → Settings → Plugins. Приоритет:
**Settings > env > пресет > режим/дефолт** (D12, D16). 15 ключей:
`workflowMode`, `workflowPreset`, `statusEnabled`, `handoffAtPercent`,
`handoffAtSpendUsd`, `handoffCooldownSeconds`, `contextWarnPercent`,
`contextSuggestPercent`, `autoCompactPercent`, `orcaEnabled`, `orcaPreflight`,
`supervisorEnabled`, `continuePrompt`, `supervisorRetries`,
`supervisorLogLevel`.

Launcher читает `omp plugin config list` при старте и передаёт supervisor'у
`OMP_ORCA_*`, `OMP_SUPERVISOR_ENABLED`, `OMP_HANDOFF_PROMPT`,
`OMP_SUPERVISOR_RETRIES`, `OMP_SUPERVISOR_LOG_LEVEL`; при пресете —
`OMP_PRESET_OVERRIDE` для extension и preset prompt вместо default.
Lifecycle-логи supervisor — stderr; `--dry-run` JSON остаётся чистым stdout.

## D11/D12

- OMP first: Orca — опция; без неё git/`/proc`/ручной `/handoff-new`.
- Не делать без решения: Orca Runs/gates/workers, Orca agent sessions вместо
  marker/session 0.3, обязательный Orca runtime, параллельные multi-repo,
  publish/remote.
- Settings — источник истины; env — fallback для CI/скриптов.

## Где что лежит

| Часть | Путь |
|---|---|
| Extension + preflight | `index.ts` |
| Settings resolver | `lib/workflow-settings.ts` |
| Orchestrator entry | `orchestrator.ts` |
| Wrap core | `lib/orchestrator/wrap.ts` |
| Worktree backend | `lib/orchestrator/worktrees.ts` |
| Supervisor | `bin/omp-handoff-supervisor.mjs` |
| Supervisor lock | `lib/supervisor-lock.mjs` |
| Launcher | `bin/omp-yoda` |
| Advisory parser | `lib/next-session.ts` |
| Presets | `lib/presets.ts`, `bin/omp-preset` |
| Запрос cache-monitor | `docs/research/cache-monitor-costs-api.md` |
| Клиент costs | `lib/costs-client.ts` |
| Advisory CLI | `bin/omp-next-session` |
| Ключевые разделы state | `lib/state-sections.ts` |
| Каталог маркетплейса | `.omp-plugin/marketplace.json` |
| Страница сравнения | `docs/comparison.md` (+ `.ru.md`, `.zh-CN.md`) |
| Леджер субагентов | `lib/orchestrator/ledger.ts` |
| Тесты леджера | `test/ledger.test.mjs` |
| Тесты guard/preflight | `test/context-guard.test.mjs` |
| Тесты разделов state | `test/state-sections.test.mjs` |
| Тесты costs | `test/costs-client.test.mjs` |
| Тесты advisory | `test/next-session.test.mjs` |
| Тесты presets | `test/presets.test.mjs` |
| Тесты settings | `test/workflow-settings.test.mjs` |
| Тесты safe remove | `test/worktree-remove.test.mjs` |
| Решения | `docs/decisions.md` (D11–D14) |
| Карта защит | `docs/guards.md` |
| Runbook | `docs/operations.md` |

## Explainer site 2026-11-24

Live: [metapeka.github.io/omp-agent-workflow](https://metapeka.github.io/omp-agent-workflow/)
(EN), [/ru/](https://metapeka.github.io/omp-agent-workflow/ru/),
[/zh/](https://metapeka.github.io/omp-agent-workflow/zh/). GitHub Pages —
source `main /docs`, `.nojekyll`; homepage репозитория указывает на сайт.

- Файлы: `docs/index.html`, `docs/ru/index.html`, `docs/zh/index.html`,
  `docs/assets/site.css`, `docs/assets/explainer-banner.svg`; SVG-баннер
  в README всех трёх языков.
- Содержимое: prompt cache, session/context/cache, что убивает кэш, карта
  «провайдер → OMP → плагин → cache-monitor», таймлайн сбросов, таблица
  покрытия, реальные замеры, инцидент 2026-11-24, пороги 18/25/30/40/900,
  чек-лист.
- Замеры на 400-ходовой сессии: 397 cache-hit, hit 99.2%; диалог $2.77,
  сессия $3.18; Kimi K3 → DeepSeek — 35 719 input / 768 cache; холодный
  ход — 363 693 input / 0 cache ≈ $0.109. Деньги — `usage.cost.total` по
  фиксированному каталогу, не счёт.
- Проверки: HTML tag/link check; скриншоты EN/RU/ZH, light/dark, mobile
  390px; live Pages 200 для страниц, CSS и баннера; баннер отрендерился
  в GitHub README.

## Проверки

```bash
cd ~/projects/omp-agent-workflow
npm run check:names                       # 105 builtin, 5 наших, 0 конфликтов
npm test
npm run typecheck
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --mode json -p 'Reply with exactly: OK'   # exit 0, stderr пуст
OMP_WORKFLOW_MODE=off bin/omp-yoda --version           # без supervisor
bin/omp-yoda --preset plan --version                   # preset-флаги, exit 0
omp plugin config list omp-agent-workflow --json | jq '.schema | keys'
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run | jq -r .command
node --experimental-strip-types bin/omp-orchestrate doctor --json | jq .ok
node --experimental-strip-types bin/omp-orchestrate status --json | jq .schemaVersion
node --experimental-strip-types --test test/handoff-economics.test.mjs   # 37
node --experimental-strip-types --test test/marketplace.test.mjs        # 5
node --experimental-strip-types --test test/ledger.test.mjs           # 5
omp plugin marketplace add "$PWD" --json && \
  omp plugin marketplace remove metapeka-omp --json   # каталог парсится, конфиг возвращён
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://metapeka.github.io/omp-agent-workflow/       # 200

# tarball 1.0.0 (проверено 2026-11-27)
npm pack --pack-destination /tmp/oaw-rel1               # 83 файла
mkdir -p /tmp/oaw-accept && tar xzf /tmp/oaw-rel1/omp-agent-workflow-1.0.0.tgz -C /tmp/oaw-accept
omp plugin link /tmp/oaw-accept/package --json
omp plugin list --json | jq '.npm[]|select(.name=="omp-agent-workflow")|.version'   # 1.0.0
omp plugin config list omp-agent-workflow --json | jq '.schema|length'  # 15
omp plugin doctor --json | jq '.[]|select(.name=="plugin:omp-agent-workflow")'
omp --no-extensions -e /tmp/oaw-accept/package/index.ts \
  -e /tmp/oaw-accept/package/orchestrator.ts --no-session --mode json \
  -p 'Reply with exactly: OK'                          # exit 0
node /tmp/oaw-accept/package/bin/omp-orchestrate doctor --json | jq .ok   # true
/tmp/oaw-accept/package/bin/omp-yoda --version          # exit 0
/tmp/oaw-accept/package/bin/omp-preset --preset plan --flags
omp plugin link /home/db1/projects/omp-agent-workflow --json  # вернуть боевую ссылку

# CLI под node_modules (проверено 2026-11-27)
# копия рантайма в /tmp/.../node_modules/omp-agent-workflow:
node .../bin/omp-orchestrate --help                 # exit 0, stderr пуст
node .../bin/omp-orchestrate status --json --dir .  # exit 1, cannot read plan
node .../bin/omp-next-session --dir .               # exit 0
node .../bin/omp-preset --preset plan --prompt      # exit 0
node --experimental-strip-types --test test/package-run.test.mjs   # 3
```

## Следующие шаги

1. 1.0.0 собран и слит в `main` локально: установка из tarball проверена,
   релизные заметки `docs/release-notes-1.0.0.md` написаны. Осталось
   решение владельца: push 1.0.0, GitHub release/tag `v1.0.0`,
   npm/marketplace (D10). Не парсить внутренности cache-monitor.
2. Проверить 0.7.1 в TUI: `omp plugin list`, `/handoff-preflight` на этом
   файле (строки `HANDOFF.md: разделы 6/6`, отсутствие ложных warn по
   синонимам), state без раздела — warn по строке и фикс в «вручную»,
   сессия с компакцией после state — warn `компакция после state`;
   `npm run check:names`, `/handoff-preflight` с advisory-строкой,
   метриками и строкой `usage-border` (при `OMP_CACHE_MONITOR_CLI` или
   `omp-cache-monitor` в `PATH`; без CLI строки нет), `⚠ HANDOFF` при
   spend-пороге (`OMP_HANDOFF_AT_USD`), `SUP OFF` в TUI,
   `OMP_WORKFLOW_MODE=off bin/omp-yoda` без supervisor и
   `bin/omp-yoda --preset plan --version` (флаги модели, supervisor,
   exit 0). `doctor --json` на чистом репо — exit 0, без Orca — warn;
   `--strict` — exit 1. На пороге handoff проверить строку `Дерево:` в
   запросе (ветка, HEAD, грязные пути).
3. 0.6 economics закрыт содержательно (0.6.1): `omp-orchestrate economics`
   строит цепочку по `parentSession`, считает окна «до/после», hit rate,
   цену первого хода и `recoveryTurns`, ищет компакции. Компакций в
   локальных данных нет — вывод data-gated, отчёт пишет «нет записей».
   OAW не парсит внутренности cache-monitor.
4. F3-метрики сделаны в 0.5.23, flight recorder — в 0.5.24; F4
   `--plan-yolo` — только после замера.
5. Ответ Orca по [stablyai/orca#47665](https://github.com/stablyai/orca/issues/47665)
   (`orca worktree rm` шлёт SIGTERM caller'у внутри worktree).
6. TUI E2E `/wrap` — опционально. Публикация остаётся локальной (D10).

## Риски

- CLI под `node_modules` (tarball/marketplace-копия): шимы `bin/` регистрируют
  `lib/ts-loader.mjs`, который читает `.ts` через `fs` и снимает типы
  `node:module.stripTypeScriptTypes`; для остальных URL делегирует штатному
  загрузчику. Работает один код-путь — клон, tarball и `node_modules`;
  Node ≥ 22.13. Ограничения лоадера: только strip (без JSX/декораторов),
  типы снимаются на каждом запуске (~10–20 мс), стек-трейсы без source map;
  регрессия держится `test/package-run.test.mjs`.
- Установленный пакет без резолвимого OMP loader → Settings игнорируются,
  работает env fallback.
- `costs --json` — отдельный CLI соседнего продукта: `omp plugin link` bin в
  `PATH` не добавляет. На этой машине стоит симлинк
  `~/.local/bin/omp-cache-monitor`; на другой — `npm link` в cache-monitor
  или `OMP_CACHE_MONITOR_CLI`. Нет команды, timeout 2 с, exit ≠ 0 или другая
  `schemaVersion` → строк `usage-border`/`usage-model` нет; preflight
  остаётся read-only и не падает. Цена — фактический `usage.cost.total`,
  не ставка каталога; медиана не заменяет счёт провайдера.
- Spend-триггер видит только то, что OMP записал в session JSONL: провайдер
  без `usage.cost.total` даёт spend 0 и не срабатывает — это не ошибка, а
  отсутствие измерения. Offset-чтение привязано к пути файла: смена сессии
  начинает счёт заново, перезапись на месте обнаруживается по `restarted`
  (size < offset) и пересчитывает total, компакция форсирует пересчёт;
  недоступный файл не сбрасывает уже измеренную сумму.
- `/handoff-preflight` — эвристика и advisory; не заменяет проверки
  supervisor'а и не блокирует `/handoff-new`. Выбранные действия `commit`
  и `merge` меняют репозиторий: merge только ff-only в чистый `main`
  worktree, commit — `git add -A` без runtime-файлов `.omp-handoff-*`.
- Quality gate 0.7.1 — тоже эвристика: заголовки узнаются по синонимам,
  поэтому нестандартный, но осмысленный state может получить warn
  `нестандартный формат` или лишний/пропущенный раздел; ложных fail нет,
  вердикт не меняется. Компакция сравнивается с mtime файла, а не с
  коммитом: `touch` без правки скрывает предупреждение, правка без `touch`
  в пределах той же секунды — нет. Детектор компакции читает только
  текущую сессию; компакция в дочерней сессии не учитывается.
- `economics --summary` агрегирует только измеренное: цена — фактический
  `usage.cost.total` из отчёта cache-monitor, `avgBoundaryUsd` — среднее по
  границам с ценой первого хода, `hitTrend` — по границам с окнами; без
  данных поле `null`, частичное покрытие — `measuredSessions` и note
  `N из M`, а не заниженная «полная» сумма. Сводка не заменяет счёт
  провайдера и не экстраполирует: цепочка ограничена 20 узлами, а дочерние
  subagent-сессии в агрегат не входят.
- Discovery-артефакты — файлы репозитория, а не публикация: каталог
  читается из клона, поэтому обновление у пользователя — `omp plugin
  marketplace update`; npm/marketplace-публикация не выполнялась (D10).
  Dry-run install `omp-agent-workflow@metapeka-omp` упирается в уже linked
  имя — это проверка резолва, а не ошибка каталога. Страница сравнения
  опирается на обзор 2026-11-23 и новых замеров не содержит: при изменении
  возможностей соседей её нужно перечитывать.
- Леджер 0.7.4 считает только записанное в JSONL: провайдер без
  `usage.cost.total` даёт 0 при `measured: true` и не останавливает прогон —
  это отсутствие измерения, а не ошибка. Читается root плюс вложенные
  `<root-stem>/**/*.jsonl`; sibling-сессия с `parentSession` попадает в
  бюджет, только когда станет новым root. `status` показывает проекцию с
  непрочитанным хвостом, persisted `STATE` — значение последнего действия;
  расхождение исчезает на следующем действии. Старый state без `costTotals`
  при перезаписи файла добавит его целиком. Бюджет живёт на весь `STATE`:
  handoff и `resume` его не сбрасывают — новый бюджет только новым state.
- Встроенный state — снимок на момент `/handoff-new`: если `HANDOFF.md`
  устарел или обрезан, новая сессия должна перечитать файл, а не доверять
  снимку. Содержимое state попадает в файл сессии — секреты туда не писать.
- Пресет — набор дефолтов, не блокировка: явные Settings/env/флаги выигрывают
  по каждому ключу; явный `--preset` отменяет advisory на этот запуск.
  Модель применяется только после проверки по `omp models --json`; чужой
  провайдер без этих селекторов останется без `--model`, но получит
  `--thinking`.
- `execution: external` — только маркер владельца, не блокировка: OAW не
  запускает задачи, но и не мешает Ensemble. Если оба всё же живы, `doctor`
  предупреждает `two owners`; решение — остановить один.
- `doctor` — read-only: пробы ≤ 2 с, без сети, STATE не меняется; отсутствие
  Orca/agent-team/cache-monitor — warn/skip; `ensemble.active` виден только
  при рабочем `agent-team status --json`, иначе skip. `worktree.shared`
  не проверяется — данных нет в CLI.
- Имена команд: builtin OMP исполняется первым, extension с занятым именем
  хост отбрасывает; между плагинами побеждает загруженный позже. Новые
  команды — только через `npm run check:names`.
- Модель при `/handoff-new` не меняется: пресеты выбирают модель только при
  запуске процесса; TTL кэша и размер блока не проверены.
- Advisory `next-session:` — совет, не контракт поведения: устаревшая,
  невалидная или чужая строка игнорируется целиком; непроверенная модель не
  применяется. `thinking` вне каталога модели нормализуется в `auto`
  (для flash `null` означает «нет выбираемых уровней», поэтому запрошенный
  `off` тоже станет `auto`); F2-пресеты, если понадобится `off`, должны
  задавать его флагом launcher'а, а не advisory.
- Launcher при каждом старте может вызвать `omp models --json` (только если
  в строке есть `model`); при зависшем CLI это до 10 с.
- Launcher читает Settings при старте; extension — на
  `session_start`/`session_switch`.
- `orcaEnabled=false` отключает automatic handoff.
- Supervisor advisory lock: PID reuse и узкая тройная гонка reclaim.
- Cleanup отказывает при dirty/current/live — это защита: `finish` вернёт
  warning, worktree останется; повтор после выхода из сессии/закрытия PTY.
- `refs/omp-worktree-backup/*` накапливаются; удалять вручную, когда tip
  больше не нужен.
- git-fallback при недоступном Orca оставляет stale-запись в Orca; убрать —
  `orca worktree rm --worktree path:<path> --json`.
- Репозиторий публичный: не коммитить секреты, session/runtime-файлы и
  локальные абсолютные пути в новых документах. npm/marketplace пока не
  публиковались.
