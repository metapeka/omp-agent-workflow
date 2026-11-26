# Запрос: `costs --json` для `omp-cache-monitor`

Статус: `[request]`, не контракт. Дата: 2026-11-26.
2026-11-27: передан в реализацию агенту cache-monitor (Orca worktree
`~/orca/workspaces/omp-cache-monitor/costs-json`, ветка `feat/costs-json`,
база 0.10.1); контракт ниже — вход задачи, менять его без согласования.
2026-11-27: реализовано в cache-monitor `0.11.0` (ff-merge `5c9eeb8` в
`main`, ветка сохранена): `lib/costs.mjs`, `bin/omp-cache-monitor.mjs`,
104 теста, установленный `bin` проверен из tarball; JSON-форма ниже
совпадает.
Адресат — `omp-cache-monitor` (соседний проект, отдельный runtime).
Цель — закрыть 0.6 economics в OAW без парсинга внутренностей cache-monitor.

## Зачем

OAW уже читает `message.assistant.usage.cost.total` из session JSONL
(`lib/orchestrator/cost.ts`): этого хватает на spend задачи. Для 0.6 нужно
сравнить **цену границы** handoff/компакции и **причину промахов кэша**:

- сколько стоил ход до и после смены модели/сессии;
- доля `cacheRead`/`cacheWrite` и `reasoningTokens` по ходу;
- где произошёл холодный префикс и сколько он стоил;
- как компакция изменила hit rate и spend.

Парсить `~/.omp` и внутренние файлы cache-monitor нельзя (D11/границы
продуктов): нужен явный CLI JSON.

## Предложение

```bash
omp-cache-monitor costs --json [--session FILE] [--since ISO8601]
```

Read-only, без сети, exit 0 при валидном ответе; `--json` — единственный
контракт. `schemaVersion: 1`; ломающее изменение — бамп и CHANGELOG.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-26T12:00:00.000Z",
  "session": "/path/to/session.jsonl",
  "totals": {
    "costUsd": 3.18,
    "inputTokens": 397000,
    "cacheReadTokens": 393000,
    "cacheWriteTokens": 0,
    "outputTokens": 18000,
    "reasoningTokens": 4000
  },
  "turns": [
    {
      "at": "2026-11-26T11:59:00.000Z",
      "model": "cline-pass/deepseek-v4.1-flash-1017",
      "costUsd": 0.0027,
      "inputTokens": 1000,
      "cacheReadTokens": 980,
      "cacheWriteTokens": 0,
      "outputTokens": 200,
      "reasoningTokens": 0,
      "hitPercent": 49.5
    }
  ],
  "models": [
    {
      "model": "cline-pass/deepseek-v4.1-flash-1017",
      "turns": 20,
      "costUsd": 0.104,
      "hitPercent": 49.7
    }
  ],
  "notes": ["cold prefix after model switch"]
}
```

Правила, которые важны OAW:

- `session` и `turns[].at` — ISO-8601 UTC; `turns` в хронологическом порядке;
- `hitPercent` — `cacheRead / (input + cacheRead)` или `null`, если
  знаменатель 0; не «магическое» число;
- `costUsd` — `usage.cost.total` провайдера, не пересчёт по прайсу;
- отсутствующая сессия/поле — `null`/`[]` и `notes`, не выдуманные 0;
- неизвестные поля читатель игнорирует (additive);
- таймаут команды 2 с, без сети.

## Что сделает OAW после появления API

1. `lib/orchestrator/cost.ts` продолжит читать JSONL как fallback.
2. `[сделано 0.6.0]` `/handoff-preflight` показывает цену границы без
   собственных эвристик: `usage-border` (медиана холодных/тёплых) и
   `usage-model` при >1 модели.
3. `[частично]` 0.6 economics: цена границы есть; сравнение стоимости
   компакции и hit rate «до/после handoff» — следующий шаг.
4. `[сделано 0.6.0]` контрактный тест формы ответа и graceful skip, если
   CLI нет: `lib/costs-client.ts`, `test/costs-client.test.mjs` (8 тестов).

## Альтернативы

- OMP tool от cache-monitor вместо CLI — допустимо, но CLI проще для
  hub/скриптов и тестов; можно оба, JSON один.
- Экспорт в файл — лишняя точка рассинхронизации.
- Парсинг внутренностей cache-monitor — запрещён границами продуктов.

## Решение владельца

Запрос сформулирован по решению 2026-11-26. Реализация в cache-monitor —
отдельная задача его владельца; OAW не меняет соседний репозиторий.
