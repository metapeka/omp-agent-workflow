# Сравнение: `omp-agent-workflow` и соседи

[English](comparison.md) · [简体中文](comparison.zh-CN.md)

Дата: 2026-11-27 (продукт 0.7.3). Данные о возможностях — публичная
документация и чтение исходников, обзор от 2026-11-23 —
[обзор рынка](research/market-landscape.ru.md). Это сравнение
возможностей, **не бенчмарк**: задержки и токены между инструментами не
замерялись, а «нет» значит «не заявленный фокус инструмента», а не «плохо».

Вопрос, на который отвечает страница: **когда этот плагин — нужный слой, а
когда лучше подойдёт другое.**

## Чем этот плагин не является

- **Не агент и не модель.** Это слой workflow для OMP: модель и агент
  остаются вашими.
- **Не замена `/compact`.** В режиме `assisted` компакцией управляет сам
  OMP; путь handoff нужен там, где должна закончиться сессия, а не только
  её история.
- **Не multi-agent рантайм.** Задачи ведёт одна запись `current` в
  `AUTOPLAN.md`. Если задачи ведёт внешний командный раннер, поставьте
  `plan.execution: external` — OAW откажет `start/verify/finish/rebase`,
  а не будет конкурировать ([решения](decisions.md)).
- **Не гарантия расходов.** Каждый доллар в отчётах — измеренный
  `usage.cost.total` из JSONL сессии; провайдер без цены даёт `null`, а не
  оценку.

## Против встроенных возможностей OMP

OMP 19.1.1 уже даёт сильную базу; плагин сознательно не перерегистрирует
`/handoff`.

| Возможность | Встроено в OMP | `omp-agent-workflow` |
|---|---|---|
| Компакция / handoff внутри сессии | `/compact`, `/handoff` (режим компакции), авто-порог у границы окна | строится поверх; `/handoff-new` завершает сессию и засевает новую state-файлом |
| Граница сессии с состоянием | — | `/handoff-new` встраивает `HANDOFF.md` (до 32k символов) и continue prompt; `/handoff-preflight` сначала проверяет state |
| Политика под модель | флаги вызова, `--max-cost`, `--warn-cost` | 5 режимов (`off`/`manual`/`assisted`/`yoda`/`yoda-supervised`) и 15 ключей Settings, пороги в процентах окна |
| Ротация по измеренным деньгам | `--max-cost` завершает print-режим | `handoffAtSpendUsd` запускает тот же handoff по `usage.cost.total`, с cooldown |
| Жизненный цикл worktree | `omp worktree add\|list\|clear` | план → worktree → verify → ff-merge; cleanup отказывает при merged/clean/current/live и сохраняет backup-ref |
| Состояние оркестрации | — | `AUTOPLAN.md` + `STATE.json`, бюджеты, stop-gates, `/wrap` |
| Экономика handoff | — | `omp-orchestrate economics [--summary]` по цепочке `parentSession` |

Только встроенные средства — когда сессии короткие, `/handoff` покрывает
случай и state-документ с внешним watcher'ом не нужен. Плагин добавляет
ценность на границе: длинные задачи, несколько сессий, деньги, которые
хочется видеть.

## Против ближайших плагинов

Обзор от 2026-11-23 по каталогу PI, маркетплейсам OMP и GitHub; полный
метод и все записи — в [обзоре рынка](research/market-landscape.ru.md).

| Проект | Фокус | Пересечение с OAW | Чем отличается |
|---|---|---|---|
| `context-relay` (плагин OMP) | автоматический handoff около 60% с `HANDOFF.md` и перезапуском | guard, handoff | уровень хуков; нет внешнего supervisor'а, режимов, state плана и cleanup-guard |
| `omp-self-compact` (плагин OMP) | отдельный индикатор context guard | guard | нет межсессионного handoff и оркестрации |
| `strategium` (плагин OMP) | оркестратор с агентами, гейтами, разбором расходов | оркестрация, бюджеты | нет context guard и межсессионного handoff |
| `mstar-harness` (плагин OMP) | команды агентов, worktree, статус | оркестрация, worktree | бюджеты советуют, а не ограничивают; нет handoff в новую сессию |
| `pi-context-budget`, `pi-handoff-chain` (PI) | guard + handoff + продолжение | guard, handoff | рантайм PI, не OMP; нет supervisor'а, state плана и cleanup-guard |
| `cachetoast` (PI) | ротация по деньгам | ротация по расходу | нет цикла план/worktree/verify и cleanup-guard |
| `claude-auto-handoff` (хуки Claude Code) | handoff в новую сессию | handoff | хуки другого рантайма; нет OMP Settings и внешнего supervisor'а |

Ближайшие в целом: `context-relay` — по половине guard/handoff,
`strategium` — по оркестрации. Ни один не соединяет политику, watcher вне
процесса агента и обратимый цикл worktree — эта комбинация и есть причина
существования плагина.

## Как выбрать

- **Этот плагин** — длинные прогоны, которые переживают окно контекста;
  несколько handoff'ов на задачу; работа, которую нельзя терять; нужна одна
  детерминированная политика вместо импровизации в каждой сессии.
- **Только встроенные средства OMP** — короткие сессии, одна модель,
  `/handoff` достаточно, state-документ не нужен.
- **`context-relay`** — нужен только автоматический хук guard-and-restart,
  без надзора и состояния плана.
- **`strategium` / `mstar-harness`** — нужен именно командный раннер. С OAW
  они сосуществуют: пометьте план `execution: external`, и OAW сохранит
  контекст и handoff, а задачи останутся раннеру.
- **PI-соседи (`pi-*`)** — другой рантайм; политики между harness'ами не
  переносятся.

## Проверить утверждения самому

Каждое утверждение проверяется локально, а плагин отдаёт доказательства:

```bash
omp plugin list --json                                  # что загружено
omp plugin config list omp-agent-workflow --json        # 15 ключей Settings
bin/omp-orchestrate doctor --json                       # 16 read-only проверок
bin/omp-orchestrate economics --summary --json          # измеренный spend цепочки
```

Контракты: [contracts.md](contracts.md); карта защит:
[guards.md](guards.md); семантика preflight: [commands.md](commands.md).

## Установка

```bash
omp plugin marketplace add metapeka/omp-agent-workflow
omp plugin marketplace list          # имя маркетплейса для установки
omp plugin install omp-agent-workflow@<marketplace>
```

Локальный чекаут работает так же: `omp plugin link /path/to/omp-agent-workflow`.
Каталог лежит в [`.omp-plugin/marketplace.json`](../.omp-plugin/marketplace.json)
и проверяется тестом против манифеста плагина, поэтому заявленная версия
не расходится с `package.json`.
