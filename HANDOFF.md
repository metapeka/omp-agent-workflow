# Передача: OAW (`omp-agent-workflow`)

Дата: 2026-11-26. Основной репозиторий: `~/projects/omp-agent-workflow`.
OAW — короткое имя продукта; `workflow` — только его режимы и ключи
(`workflowMode`, статус-ключ).
`main`, версия `0.5.24`; последний код — flight recorder в запросе HANDOFF
(`workingTreeSnapshot()`, см. CHANGELOG 0.5.24).
Ветки 0.5.1–0.5.24 (включая `feat/doctor`, `feat/oaw-name`,
`feat/execution`, `feat/contracts`, `feat/state-contracts`, `feat/presets`,
`feat/handoff-flight-recorder`) слиты ff-only, worktrees удалены. GitHub:
`metapeka/omp-agent-workflow`
(public), тег и release `v0.5.14`, CI на Node 22 зелёный. Вики —
`docs/README.md`; backlog — `TODO.md`.

Сессия 2026-11-26 (вторая) закрыта: F3-метрики preflight проверены
(`npm run verify`, `check:names`, extension load) и закоммичены `4eeff3d`;
review-находки исправлены (spend при нулевом output, `STATE.plan.path`,
`formatTokens`, UTF-8 тест); найден и исправлен боевой дефект preflight
`commit`: в репозитории, где `.omp-handoff-*` в `.gitignore` (GridSnap),
явный exclude-pathspec ронял `git add` — теперь add-all + снятие
runtime-путей с индекса. Дерево чистое после коммитов. Публикация
остаётся локальной (D10); запрос `costs --json` для 0.6 сформулирован и
ждёт cache-monitor (в 0.10.1 CLI нет — только `/cache-monitor costs` в TUI).

`main` совпадал с `origin/main` (`cb00d0d`) до коммитов 0.5.24; их push не
делался (D10) — на момент записи `main` опережает origin только на них.

Сессия 2026-11-26 (третья): добавлен flight recorder — в текст запроса
HANDOFF попадают ветка, короткий HEAD и до 6 незакоммиченных путей
(read-only git, runtime-файлы исключены, бюджет 300 символов); handoff
по-прежнему не трогает git и дерево. Карта защит и точек в цикле —
`docs/guards.md`; обновлены вики, `handoff-flow.md`, FAQ, contracts,
README EN/RU/ZH. Проверено `npm run verify`.

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
| Settings 0.5.4–0.5.5 | 14 ключей в Settings → Plugins (0.5.22 добавил `workflowPreset`) |
| Preflight 0.5.6–0.5.7 | read-only проверка перед `/handoff-new` |
| State 0.5.8 | `/handoff-new` встраивает state-файл в новую сессию |
| Checklist 0.5.9 | `/handoff-preflight`: чек-лист, затем таблица проверок |
| Actions 0.5.10 | `/handoff-preflight`: проверки, commit, ff-merge; остальное вручную |
| Flow 0.5.11 | preflight: состояние → меню незакрытых действий → итог |
| Status 0.5.12 | ключ `workflow`: `YODA`/`YODA-SUP`, `⚠ HANDOFF` |
| Status 0.5.13 | `SUP OFF` и `T2 verify` в том же ключе |
| Landscape 2026-11-23 | `docs/research/market-landscape.*` (EN/RU/ZH): прямого аналога нет; OMP builtin `/handoff` и worktree-команды учтены; ссылки из README, вики и ROADMAP |
| Safe cleanup 0.5.14 | `removeWorktree`: merged/clean/current/live guard, без `--delete-branch`/`--force`/`-D`, ветка остаётся, tip в backup-ref; retry failed переименовывает ветку в `-failed-<ts>` |
| Handoff guards 0.5.15 | state 32k символов (≈10–15k токенов); warning без supervisor/terminal handle; повтор запроса без marker (2 хода, максимум 3) |
| Session info 0.5.16 | `{sessions}` по pid, dead prune, lock + atomic rename; supervisor выбирает по `marker.sessionFile` |
| Fallback 0.5.17 | авто-компакция срабатывает после исчерпания handoff-повторов или при marker без живого supervisor |
| Kill switch 0.5.18 | `workflowMode: off` (`OMP_WORKFLOW_MODE=off`): плагин молчит, OMP на дефолтах, launcher делает exec omp без supervisor; env off побеждает Settings |
| Advisory 0.5.19 | `next-session:` первой строкой `HANDOFF.md`: launcher добавляет `--model`/`--thinking` при старте (явные флаги выигрывают), preflight показывает валидность; модель в сессии не меняется (D14) |
| Doctor 0.5.20 | `bin/omp-orchestrate doctor [--json] [--strict]`: 16 read-only проверок в фиксированном порядке, проба ≤ 2 с, без сети; нет Orca/agent-team/cache-monitor — warn/skip; битые настройки/план/state — fail; `status --json` и `doctor --json` — `schemaVersion: 1` |
| Execution 0.5.21 | `plan.execution: omp|external` (D15): без поля — `omp`, hash старых планов не меняется; `external` — задачи ведёт Ensemble, `start/verify/finish/rebase` → stop `external-run` без lock/state/worktree; `status`/`next`/`doctor`/handoff работают; `doctor` warn, если external без активного прогона |
| Presets 0.5.22 | `routine`/`plan`/`review`/`budget` (D16): Settings `workflowPreset` (14-й ключ) и `--preset`; модель/thinking/пороги/continue prompt, явные значения и флаги выигрывают; явный `--preset` отменяет advisory; `plan` советует `model=flash mode=routine` |
| Имена команд 0.5.18 | `/handoff` убран (builtin OMP); `npm run check:names` сверяет 105 builtin-имён с нашими 5 в `verify`; коллизий 0 |
| Гид по командам | `docs/commands.md`: слэш-команды, tool `orchestrator`, меню preflight, карточки `/wrap`, CLI launcher/supervisor/orchestrate, владельцы имён |
| Замеры 2026-11-24/25 | `docs/research/model-modes.md`: цены 9 моделей, reasoning flash/pro, handoff-payload 20 сессий, цена границы, рекомендации R1–R8 |
| Пресеты 0.5.22 | `docs/research/workflow-presets.md`: F1/F2 сделаны; F4 `--plan-yolo` — только после замера |
| Метрики 0.5.23 | `lib/session-metrics.ts` + строки preflight: размер state против 32k, cache hit, reasoning share и spend сессии из root JSONL, прогресс плана с gate/deps, attempts, run spend; цена границы — `[blocked]` до `costs --json` |
| Flight recorder 0.5.24 | `workingTreeSnapshot()`: ветка, короткий HEAD, до 6 незакоммиченных путей в тексте запроса HANDOFF; runtime-файлы исключены; контракт marker/session не меняется; карта защит — `docs/guards.md` |
| Запрос cache-monitor | `docs/research/cache-monitor-costs-api.md`: `costs --json` v1 для 0.6 economics; в cache-monitor 0.10.1 CLI нет (только `/cache-monitor costs` в TUI) |
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
**Settings > env > пресет > режим/дефолт** (D12, D16). 14 ключей:
`workflowMode`, `workflowPreset`, `statusEnabled`, `handoffAtPercent`,
`handoffCooldownSeconds`, `contextWarnPercent`, `contextSuggestPercent`,
`autoCompactPercent`, `orcaEnabled`, `orcaPreflight`, `supervisorEnabled`,
`continuePrompt`, `supervisorRetries`, `supervisorLogLevel`.

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
| Advisory CLI | `bin/omp-next-session` |
| Тесты guard/preflight | `test/context-guard.test.mjs` |
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
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://metapeka.github.io/omp-agent-workflow/       # 200
```

## Следующие шаги

1. Новая сессия загрузит 0.5.24; проверить `omp plugin list`, отсутствие
   `/handoff` в наших командах (builtin работает), `/handoff-preflight`
   с advisory-строкой и метриками (state/usage/plan), `SUP OFF` в TUI,
   `OMP_WORKFLOW_MODE=off bin/omp-yoda` без supervisor и
   `bin/omp-yoda --preset plan --version` (флаги модели, supervisor,
   exit 0). `doctor --json` на чистом репо — exit 0, без Orca — warn;
   `--strict` — exit 1. На пороге handoff проверить строку `Дерево:` в
   запросе (ветка, HEAD, грязные пути).
2. 0.6 economics: запрос `costs --json` сформулирован в
   `docs/research/cache-monitor-costs-api.md`; реализация — у
   cache-monitor (в 0.10.1 ещё нет). OAW не парсит его внутренности.
3. F3-метрики сделаны в 0.5.23, flight recorder — в 0.5.24; F4
   `--plan-yolo` — только после замера.
4. Ответ Orca по [stablyai/orca#47665](https://github.com/stablyai/orca/issues/47665)
   (`orca worktree rm` шлёт SIGTERM caller'у внутри worktree).
5. TUI E2E `/wrap` — опционально. Публикация остаётся локальной (D10).

## Риски

- Установленный пакет без резолвимого OMP loader → Settings игнорируются,
  работает env fallback.
- `/handoff-preflight` — эвристика и advisory; не заменяет проверки
  supervisor'а и не блокирует `/handoff-new`. Выбранные действия `commit`
  и `merge` меняют репозиторий: merge только ff-only в чистый `main`
  worktree, commit — `git add -A` без runtime-файлов `.omp-handoff-*`.
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
