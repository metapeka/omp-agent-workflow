# omp-agent-workflow 1.0.0 — стабильный контракт

Дата: 2026-11-27. Предыдущий релиз:
[v0.7.4](https://github.com/metapeka/omp-agent-workflow/releases/tag/v0.7.4).

## Что нового

1.0 фиксирует поверхность, собранную в 0.5–0.7. Runtime-поведение не
менялось; изменились упаковка и документация.

- Context guard: warning 35%, HANDOFF 50%, `/handoff-new`,
  `/handoff-preflight` (таблица, меню действий, quality gate), `/wrap`.
- Режимы `off`/`manual`/`assisted`/`yoda`/`yoda-supervised`; внешний
  supervisor — один на каталог, marker/session 0.3 без изменений.
- Orchestrator: `AUTOPLAN.md`, `STATE.json`, бюджеты, stop-gates, леджер
  субагентов (root + вложенные сессии + хвост прошлой сессии),
  `execution: omp|external`.
- Settings (15 ключей) > env > пресет > режим; пресеты
  `routine`/`plan`/`review`/`budget`; advisory `next-session:`.
- CLI JSON v1: `status --json`, `doctor --json` (16 read-only проверок),
  `economics`/`economics --summary`.
- 0 runtime-зависимостей; Node ≥ 22, OMP ≥ 19; Orca опциональна.

## Установка

### Tarball (проверено на этом релизе)

```bash
npm pack                                  # omp-agent-workflow-1.0.0.tgz
mkdir -p ~/opt/omp-agent-workflow
tar xzf omp-agent-workflow-1.0.0.tgz -C ~/opt/omp-agent-workflow
omp plugin link ~/opt/omp-agent-workflow/package
omp plugin list                            # omp-agent-workflow@1.0.0
```

Перезапустить OMP после `link`. Распакованный каталог нужно сохранить:
launcher и CLI запускаются оттуда —
`~/opt/omp-agent-workflow/package/bin/omp-yoda`.

### Клон репозитория

```bash
git clone https://github.com/metapeka/omp-agent-workflow.git
cd omp-agent-workflow
npm ci && npm run verify
omp plugin link "$PWD"
```

### Маркетплейс

Каталог `metapeka-omp` лежит в `.omp-plugin/marketplace.json` и входит в
tarball. Публикация в npm/маркетплейс не выполнялась (D10) — только по
решению владельца.

## Совместимость

- Контракт marker/session 0.3 и `.omp-handoff-request.json` не менялись.
- Settings — 15 ключей, схема прежняя; приоритет Settings > env >
  пресет > режим/дефолт.
- В пакете 83 файла: `index.ts`, `orchestrator.ts`, `lib/`, `bin/`,
  `docs/`, три README, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`,
  `.omp-plugin/marketplace.json`, `package.json`.
- CLI-скрипты требуют Node ≥ 22.13 (`node:module.stripTypeScriptTypes`);
  сборки и runtime-зависимостей нет. Шимы `bin/` сами снимают типы, поэтому
  CLI работают из клона, распакованного tarball и `node_modules`.

## Проверки (2026-11-27)

- `npm run verify`: 389 тестов, `tsc --noEmit`, `check:names` — 105
  builtin-команд OMP, 5 команд плагина, 0 коллизий.
- Tarball: `npm pack` → распаковка → `omp plugin link` →
  `omp plugin list` показывает 1.0.0; `omp plugin config list
  omp-agent-workflow --json` — 15 ключей; `omp plugin doctor --json` — ok;
  extension load — exit 0, ответ `OK`; `bin/omp-orchestrate doctor --json`
  — exit 0 (10 pass, 2 warn, 4 skip); `bin/omp-yoda --version` — exit 0;
  `bin/omp-preset --preset plan --flags` печатает модель и thinking.
- `bin/omp-orchestrate status --json` без `AUTOPLAN.md` — exit 1 с
  `cannot read plan`: план обязателен для `status`, поэтому установку
  проверяет `doctor`.
- `node_modules`: копия рантайма в `<tmp>/node_modules/omp-agent-workflow`
  → `bin/omp-orchestrate --help` exit 0 с чистым stderr,
  `status --json` доходит до плана (`cannot read plan`, без
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), `bin/omp-next-session` и
  `bin/omp-preset` exit 0 — `test/package-run.test.mjs` (3).

## CLI и `node_modules`

Node не снимает типы с файлов под `node_modules`
(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), а `npm install` и копия из
маркетплейса кладут плагин именно туда. Поэтому шимы `bin/omp-orchestrate`,
`bin/omp-next-session` и `bin/omp-preset` регистрируют собственный лоадер
`lib/ts-loader.mjs`: он читает `.ts` через `fs` и снимает типы
`node:module.stripTypeScriptTypes`, обходя ограничение. Те же шимы работают
и из клона/распакованного tarball — второй путь кода не появляется.

Проверено: расширение из `node_modules` грузится (OMP-загрузчик), CLI из
той же копии запускаются (см. «Проверки»); Node ≥ 22.13 (API
`stripTypeScriptTypes`).

## История изменений

[`CHANGELOG.md`](../CHANGELOG.md).
