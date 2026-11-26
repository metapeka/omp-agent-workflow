# Workflow presets и метрики выбора (предложение)

Статус: F1 `[готово]` в 0.5.19; F2 `[готово]` в 0.5.22; F3 `[готово]` в
0.5.23 (кроме денежной оценки границы); F4 — `[design]`, не контракт.
Дата: 2026-11-26. Связанные документы:
[model-modes.md](model-modes.md) (цены, замеры, рекомендации R1–R8),
[contracts.md](../contracts.md) (контракт 0.3), [orchestrator.md](../orchestrator.md)
(`AUTOPLAN.md`/`STATE.json`).

Цель: не терять решения при выборе режима работы — пресеты, которые
применяются при запуске сессии, и метрики, по которым выбирается пресет.

## Ограничение, из которого всё следует

| Факт | Следствие |
|---|---|
| `/handoff-new` создаёт новую сессию в том же OMP-процессе | модель при handoff не меняется |
| Модель выбирается флагами запуска (`--model`, `--plan`, `--slow`, `--smol`, `--thinking`) | пресет применяется launcher'ом, а не event-handler |
| `--profile` у omp занят (изолированные auth/sessions/настройки) | наш флаг называть `--preset` |
| `omp` умеет `--plan-yolo` + `--plan-yolo-into` | возможен plan на pro → исполнение на flash, но это одна смена модели посреди сессии |
| `--prewalk` переключает на smol после появления todo | ещё один промах; в пресеты не брать |
| `thinking=off` — тормоз, не выключатель | бюджет без нуля reasoning; см. R3 |

## Фичи

### F1. `next-session:` advisory + launcher

| Параметр | Значение |
|---|---|
| Что | агент пишет первой строкой `HANDOFF.md` рекомендацию; `omp-yoda` её читает и ставит `--model/--thinking` при следующем запуске |
| Синтаксис | `next-session: v=1 ts=… model=… thinking=… mode=… reason=…` (см. `model-modes.md`) |
| Preflight | показывает строку и её валидность; ничего не переключает |
| Launcher | валидирует `v`, `ts` (24 ч), модель по `omp models --json`; невалидное — игнор |
| Размер | S: парсер + тесты (9 кейсов), чтение в launcher |
| Риск | новый формат state — только по решению владельца; аддитивно |
| Статус | `[готово]` 0.5.19 (D14): `lib/next-session.ts`, `bin/omp-next-session`, `bin/omp-yoda`, `/handoff-preflight`; 31 тест |

### F2. Пресеты `routine` / `plan` / `review` / `budget`

| Параметр | routine | plan | review | budget |
|---|---|---|---|---|
| Модель при запуске | flash | pro | flash | flash |
| Thinking | off | auto | auto | off |
| Warn / Suggest / Handoff / Auto | 35/50/55/70 | 25/40/70/80 | 35/50/55/70 | 35/50/50/60 |
| Supervisor | on | on | on | on |
| Continue prompt | default | «план → HANDOFF с advisory» | «ревью диффа» | default |
| Advisory следующей сессии | — | `model=flash mode=routine` | — | — |
| Цена волны 20 ходов | $0.104 | $0.160 | $0.186 + advisor | ≈$0.104 |

Правила:

- имя — `--preset` у `omp-yoda`; в Settings — `workflowPreset` (новый ключ),
  env `OMP_WORKFLOW_PRESET` как fallback;
- приоритет: явный Settings-ключ > env > пресет > режимный дефолт; пресет
  задаёт только те значения, которые не заданы явно (паттерн cache-monitor);
- launcher снимает `--preset` из argv, остальные флаги передаёт `omp` как есть;
- пресет не меняет модель внутри процесса и не трогает marker/supervisor-контракт;
- размер M: `lib/workflow-settings.ts`, `index.ts` (схема), `bin/omp-yoda`, тесты.
- реализовано 0.5.22 (D16): `lib/presets.ts`, `bin/omp-preset`, 14-й ключ
  Settings `workflowPreset`, флаг `--preset`; явный `--preset` важнее
  Settings и отменяет advisory; пресет применяет модель только если она
  есть в `omp models --json`. Пресет не пишет `next-session:` сам: `plan`
  даёт continue prompt с просьбой записать advisory `model=flash mode=routine`.

### F3. Метрики в preflight

| Строка | Источник | Зачем |
|---|---|---|
| state, символов / лимит 32k | `HANDOFF.md` | бюджет handoff |
| cache hit сессии | `usage.cacheRead/(input+cacheRead)` | причина промахов |
| reasoning share последнего хода | `usage.reasoningTokens / output` | оправдан ли `auto` |
| spend сессии | `usage.cost.total` по root JSONL | цена разговора |
| задачи/gates/deps | `STATE.json`, `AUTOPLAN.md` | план или рутина |
| spend run | `STATE.budgets.spendUsd` (ведёт `lib/orchestrator/cost.ts`) | бюджет волны |

Размер S–M: только чтение и вывод, контракт не меняется.

Реализовано 0.5.23 (`lib/session-metrics.ts` + строки preflight):

- JSONL читается чанками по 1 MiB через `StringDecoder`; считаются только
  `message.assistant.usage` — записи `model_usage` покрывают служебные
  вызовы (`title-fork`, `sharpshooter:extract`), не чат. Дочерние сессии
  (subagents) не читаются: метрики относятся к корневому разговору.
- cache hit: warn ниже 80% только на заметной выборке (prompt ≥ 50k
  токенов и ≥ 5 запросов), иначе pass — короткая сессия ещё не показатель.
- state: > 24 000 символов — warn «сократи state»; ≥ 32 000 — warn
  «обрежется при handoff».
- план: путь плана — `STATE.plan.path` или `AUTOPLAN.md`; нет плана без
  state — pass «работа без оркестратора»; state ссылается на отсутствующий
  файл — warn; при наличии — `N/M задач, следующая T…, gate …, deps …`;
  попытки `STATE.attempts` — warn; run spend ≥ 90% бюджета — warn.
- денежная оценка границы **не сделана**: см. блок ниже.

Отложенная строка — «оценка границы warm/cold, $»: достоверно её не из
чего считать без таблицы цен cache-monitor.

Почему отложено (замер 2026-11-26 на живой сессии flash): `usage.cost` —
фактические списания реселлера, и одна и та же модель в одной сессии
стоила от $0.35 до $1.02 за 1M output-токенов (input $0.09–0.26, cacheRead
$0.007–0.020); коэффициент сдвигается на всех компонентах сразу. Листовые
цены `omp models --json` (`pricingStatus: fixed`) при этом расходятся с
записанными списаниями ≈1.6×. Оценка из локальных данных даёт ошибку до
2×, поэтому цена перехода — только из `costs --json` cache-monitor, когда
там появится таблица ставок.

### F4. `--plan-yolo` для plan-heavy (эксперимент)

| Параметр | Значение |
|---|---|
| Что | `omp --plan-yolo --plan-yolo-into cline-pass/deepseek-v4.1-flash-1017` |
| Выигрыш | plan на pro и исполнение на flash без второго процесса |
| Цена | одна смена модели посреди сессии: холодный префикс ≈ $0.004–0.008 |
| Риск | качество auto-approve плана не проверено; включать только после замера |
| Статус | `[experiment]` |

## Метрики выбора пресета

| Сигнал | Источник | Правило |
|---|---|---|
| Задач осталось / gates / deps | `AUTOPLAN.md`, `STATE.json` | >3 задач или gate → plan |
| Неудачные verify / попытки | `STATE.attempts` | ≥1 → review |
| Diff: файлов и строк | preflight git | >20 файлов → review |
| reasoning share хода | session JSONL | >40% на рутине → budget |
| $/ход | `usage.cost` | >$0.01 → budget |
| cache hit | `usage.cacheRead` | <80% → разбирать причину, не пресет |
| state, символов | `HANDOFF.md` | >24k → сократить до handoff |

## Порядок внедрения и решения

| Шаг | Что | Зависимость | Решение владельца |
|---|---|---|---|
| 1 | F1 advisory + launcher | формат state | сделано 0.5.19 (D14) |
| 2 | F2 пресеты | F1 для plan→flash | сделано 0.5.22 (D16) |
| 3 | F3 метрики preflight | — | нет — сделано 0.5.23 (без цены границы) |
| 4 | F4 plan-yolo | замер | да: эксперимент |

## Не делать

- advisor постоянно (только ревью плана/диффа);
- prewalk;
- смена модели из event-handler;
- второй ключ статус-строки;
- автопереключение режима по эвристике без подтверждения.

## Открытые вопросы

1. ~~Нужен ли `workflowPreset` в Settings или достаточно флага launcher'а.~~
   Закрыто 0.5.22: оба — `--preset` и `workflowPreset` (D16).
2. ~~Показывать ли пресет в статус-строке (`YODA:plan`).~~ Закрыто 0.5.19:
   контракт по-прежнему закрепляет один ключ `workflow`; advisory в статусе
   не показывается.
3. Читать advisory только в launcher'е или ещё в supervisor'е (перезапуск
   процесса supervisor'ом — отдельный риск).
4. Проверять ли `--plan-yolo` замером до включения в пресет `plan`.
5. ~~Нужен ли пресет `budget` отдельно или это `routine` с `off` по умолчанию.~~
   Закрыто 0.5.22: `budget` отдельный, пороги 35/50/50/60.

## Следующий шаг

F1–F3 реализованы (0.5.19, 0.5.22, 0.5.23). Цена границы ждёт таблицу
ставок cache-monitor (`costs --json`). F4 `--plan-yolo` — только после
замера.

Публикация остаётся локальной; npm/marketplace не одобрены.
