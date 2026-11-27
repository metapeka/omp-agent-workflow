# OAW — omp-agent-workflow: инструкции агенту

## Роль

Ты поддерживаешь **OAW** (`omp-agent-workflow`) — OMP-расширение для context
guard, ручного и автоматического handoff, режимов `manual`/`assisted`/`yoda`/
`yoda-supervised` и внешнего supervisor.

Продукт отдельный от `omp-cache-monitor`: cache-monitor считает стоимость и
hit rate, этот проект управляет контекстом и сменой сессии. Не смешивать
контракты и не переносить код между репозиториями без решения владельца.

## Термины

| Термин | Что это |
|---|---|
| **OAW** | этот продукт, `omp-agent-workflow` |
| **OMP** | агент-рантайм, в котором работает OAW |
| **Orca** | опциональная среда: терминалы, worktree, браузер, плагины; OAW работает без неё |
| **Ensemble** | Orca-плагин `agent-team`, который ведёт задачи вместо OAW при `execution: external` |
| **workflow** | режимы и ключи OAW (`workflowMode`, статус-ключ); не второе имя продукта |

## Сначала прочитай

1. `HANDOFF.md` — текущее состояние, контракт, проверки, ограничения.
2. `ROADMAP.md` — этапы, приоритеты, назначение агентов.
3. `docs/README.md` — вики проекта и порядок чтения.
4. `docs/architecture.md` — компоненты и факты OMP API (что можно/нельзя).
5. `docs/contracts.md` — стабильный контракт 0.3; что запрещено менять.
6. `docs/orchestrator.md` — дизайн 0.5: `AUTOPLAN.md`, `STATE.json`, политика.
7. `README.md` — пользовательский контракт и установка.
8. `docs/yoda-workflow.md` — режимы, акторы, цикл, stop-gates.
9. `docs/handoff-auto-plan.md` — протокол automatic handoff.
10. `index.ts`, `bin/omp-handoff-supervisor.mjs`, `test/context-guard.test.mjs`.

## Текущее состояние

- Версия `1.0.0`, локальный git-репозиторий, основная ветка `main`.
- Вики проекта — `docs/README.md`; дизайн 0.5 утверждён 2026-11-22
  (`docs/orchestrator.md`), этапы A–D реализованы; 0.5.1 добавляет `/wrap`
  (`docs/wrap.md`); 0.5.2 — supervisor singleton; 0.5.3 — additive
  Orca-интеграция; 0.5.4 — Settings (9 ключей); 0.5.5 — Settings для
  supervisor (`continuePrompt`, retries, log level); 0.5.6–0.5.7 —
  `/handoff-preflight`; 0.5.8 — state-файл встраивается в новую сессию;
  0.5.9 — чек-лист перед таблицей `/handoff-preflight`; 0.5.10 — меню
  действий preflight: проверки, commit, ff-merge; 0.5.11 — preflight сначала
  проверяет и даёт вердикт, затем предлагает только незакрытые действия;
  0.5.12 — ключ `workflow` в статус-строке (`YODA`/`YODA-SUP`,
  `⚠ HANDOFF`) и `statusEnabled` (13-й ключ); 0.5.13 — `SUP OFF` и
  `T2 verify` в том же ключе; 0.5.14 — безопасный cleanup worktree:
  живой процесс/терминал и текущий worktree блокируют удаление, ветка
  остаётся, tip в backup-ref; 0.5.15 — handoff guards (state 32k,
  warning без supervisor/terminal handle, повтор запроса без marker);
  0.5.16 — session info как карта по pid, чтобы одноразовый запуск не
  затирал handle живой сессии; 0.5.17 — fallback-компакция срабатывает
  после исчерпания handoff-повторов или при marker без живого supervisor;
  0.5.18 — режим `off`: выключатель плагина, OMP на дефолтах, launcher не
  поднимает supervisor; 0.5.19 — advisory `next-session:`: launcher добавляет
  `--model`/`--thinking` при старте, preflight показывает валидность, модель
  внутри сессии не меняется (D14); 0.5.20 — CLI JSON v1:
  `status --json`/`doctor --json` с `schemaVersion: 1`, `doctor` — 16
  read-only проверок (проба ≤ 2 с, без сети, `--strict`); 0.5.21 —
  `plan.execution: omp|external` (D15): `external` ведёт Ensemble, OAW
  отказывает `start/verify/finish/rebase` со stop-reason `external-run`;
  0.5.22 — пресеты `routine|plan|review|budget` (D16): ключ Settings
  `workflowPreset` (14-й) и флаг `--preset`; 0.5.23 — метрики в
  `/handoff-preflight` (F3): размер state, cache hit, reasoning share и
  spend сессии, план/gate/deps, run spend; цена границы — реализована в
  0.6.0 через `omp-cache-monitor costs --json`.
- 0.5.24 — flight recorder: в текст запроса HANDOFF попадают ветка,
  короткий HEAD и до 6 незакоммиченных путей (read-only git, runtime-файлы
  исключены); handoff остаётся read-only, контракт marker/session не
  меняется; карта защит — `docs/guards.md`.
- 0.5.25 — вывод `/handoff-preflight`: таблица `GROUP  ST  DETAIL` (ширина
  по содержимому, перенос деталей) и fallback-группы с иконками уже 70
  колонок; глифы `theme.symbol` (unicode/nerd/ascii), действия и вердикт —
  `✔ ⦸ ✘`.
- 0.5.26 — действие `push` в меню preflight: предлагается при upstream и
  незапушенных коммитах, `git push` без `--force`, отказ remote не двигает
  ref; упавшие проверки/commit пропускают push.
- 0.6.0 — цена границы в `/handoff-preflight` из `omp-cache-monitor
  costs --json` v1: медиана холодных ходов против тёплых, разрез по моделям
  при >1 модели; CLI нет/упал/другая схема — строк нет (graceful skip);
  `OMP_CACHE_MONITOR_CLI` или bin в `PATH`.
- 0.6.1 — `omp-orchestrate economics`: цепочка `parentSession`, граница
  только у handoff-ребёнка, окна/hit/recovery/компакции, JSON v1;
  0.7.0 — spend-aware handoff: `handoffAtSpendUsd` (15-й ключ) и
  `OMP_HANDOFF_AT_USD`, триггер по измеренному `usage.cost.total` с
  инкрементальными offsets (перезапись/компакция пересчитывает total),
  marker `reason: "spend"`; 0.7.1 — quality gate разделов `HANDOFF.md` и
  компакции после state в preflight; 0.7.2 — `economics --summary`:
  агрегат цепочки, средняя цена границы и тренд hit rate (аддитивное поле
  `summary`); 0.7.3 — каталог маркетплейса `.omp-plugin/marketplace.json`
  и страница сравнения `docs/comparison.md` (EN/RU/ZH); 0.7.4 — леджер
  субагентов: `costTotals` по файлам, `spend` в `status --json`, stop
  `budget-spend` по всему кусту.
- 1.0.0 — релиз: установка из tarball проверена (распаковка +
  `omp plugin link`, Settings 15 ключей, extension load, `plugin doctor`,
  `doctor --json`, launcher), релизные заметки —
  `docs/release-notes-1.0.0.md`; CLI-скрипты не запускаются из дерева
  `node_modules` (Node не снимает типы) — ставить распаковкой или клоном.
- Подключён как OMP-плагин: `omp plugin link /home/db1/projects/omp-agent-workflow`.
- В Orca зарегистрирован как проект `omp-agent-workflow`; рабочие worktree —
  `~/orca/workspaces/omp-agent-workflow/<slug>`.
- `npm run verify` — `check:names`, тесты и typecheck; CI в
  `.github/workflows/ci.yml`.
- Launcher `bin/omp-yoda` запускает supervisor и OMP в режиме
  `yoda-supervised` (handoff 55%, auto-compaction выключена).

## Нельзя

- Публиковать npm/marketplace и менять видимость репозитория без явного
  разрешения владельца.
- Добавлять runtime-зависимости, `any`, фейковые TTL/пороги или «магическую»
  смену сессии из event-handler.
- Делать Orca обязательной: OMP работает без неё, Orca-вызовы best-effort с
  fallback. Нельзя заменять marker/session 0.3 на Orca agent sessions или
  Orca Runs/workers без нового решения.
- Менять контракт `.omp-handoff-session.json` /
  `.omp-handoff-request.json` без решения владельца.
- Коммитить секреты, session-файлы, логи, `node_modules`, временные файлы.
- Править линкованный боевой чекаут под эксперимент: для задач — worktree.

## Рабочий процесс

```bash
# новая задача
orca worktree create --repo name:omp-agent-workflow --name <slug> \
  --branch feat/<slug> --base-branch main --no-parent --json

# в worktree
npm run verify
omp --no-extensions -e ./index.ts --no-session --mode json \
  -p 'Reply with exactly: OK'        # exit 0, stderr пуст
bin/omp-yoda --version               # launcher находит supervisor и omp

# финал: merge ff-only из base-репозитория
git -C /home/db1/projects/omp-agent-workflow merge --ff-only feat/<slug>
# cleanup — только снаружи удаляемого worktree и без живых терминалов/процессов
orca worktree list --json                  # убедиться: в worktree нет PTY
orca worktree rm --worktree path:/home/db1/orca/workspaces/omp-agent-workflow/<slug> --json
git -C /home/db1/projects/omp-agent-workflow branch -d feat/<slug>  # только merged, -d
```

- Cleanup нельзя запускать из терминала/сессии внутри удаляемого worktree:
  Orca останавливает PTY этого worktree и присылает SIGTERM (инцидент
  2026-11-23). Сначала выйди из сессии, закрой её терминал, затем удаляй из
  base-репозитория.
- `--delete-branch` и `--force` вручную не использовать: ветка удаляется
  только явным `git branch -d` после проверки merged, tip сохраняется в
  backup-ref.

- Один агент — один worktree; не редактировать один файл параллельно.
- Коммит — через `commit` namespace, не `git add`/`git commit`.
- Поведенческое изменение — только с тестом; docs обновлять в том же worktree.
- После merge — проверить `omp plugin list`, `/handoff`, `/handoff-preflight`,
  `/handoff-new` и supervisor в TUI.

## Контракт режимов

| `OMP_WORKFLOW_MODE` | Авто-компакция | Handoff |
|---|---|---|
| `off` | дефолт OMP | выкл |
| `manual` | выкл | выкл |
| `assisted` (default) | 60% | выкл |
| `yoda` | 70% fallback | 55% |
| `yoda-supervised` | 70% fallback | 55% + supervisor |

`off` — выключатель: плагин не пишет статус/предупреждения/session info,
launcher не поднимает supervisor; явные пороги игнорируются, env `off`
побеждает Settings.

`OMP_CONTEXT_WARN`, `OMP_CONTEXT_SUGGEST`, `OMP_CONTEXT_AUTO`,
`OMP_HANDOFF_AT`, `OMP_HANDOFF_AT_USD`, `OMP_HANDOFF_COOLDOWN_SECONDS` — env
fallback, если ключ не задан в Settings. Приоритет: Settings > env > пресет >
режим/дефолт. `off` в значении порога отключает соответствующее действие.
`handoffAtSpendUsd` (15-й ключ) — независимый триггер по измеренному spend
сессии; пресеты его не задают.

`workflowPreset` (Settings, 14-й ключ) или явный `--preset` launcher'а
выбирает `routine|plan|review|budget`: модель, thinking, пороги и continue
prompt. Пресет заполняет только незаданные ключи; `--preset` важнее
Settings и отменяет advisory `next-session:` на этот запуск.

Проценты — от окна активной модели (`ctx.getContextUsage().percent`), не
абсолютные токены. Пример: 1M × 18/25/30/60% = 180k/250k/300k/600k;
100k × те же проценты = 18k/25k/30k/60k. Лимит state-файла для
`/handoff-new` — 32 000 символов (≈10–15k токенов на русском тексте).

## Контекст и handoff

| Контекст (1M) | Действие |
|---|---|
| до 250k | Работать нормально |
| 250–350k | Watch: не читать гигантские файлы и логи |
| 350–500k | Warning; предложить `HANDOFF`; сжимать на границе задачи |
| 500–600k | Компакция на безопасной границе |
| больше 600k | Форсировать handoff/compact |

- `HANDOFF` — триггер: обнови `HANDOFF.md`, затем `/handoff`.
- `/handoff-preflight [файл]` — сначала таблица и вердикт, затем меню только
  незакрытых действий (проверки, commit, ff-merge), затем итог; блокеры
  advisory: команда ничего не запрещает.
- `/handoff-new` — новая сессия; сначала должен существовать `HANDOFF.md`.
- Automatic handoff: агент пишет `.omp-handoff-request.json`, supervisor
  отправляет `/handoff-new` в terminal handle из `.omp-handoff-session.json`.
- Supervisor — один на каталог (`--dir`): lock `.omp-handoff-supervisor.lock/`;
  второй экземпляр выходит с кодом 0 и не трогает marker.
- Не сжимать посреди tool-loop или незавершённого edit; ждать `turn_end` и
  `ctx.isIdle()`.
- `context_pct` в native status line уже есть; свой процент не дублировать.
  Ключ `workflow` — режим, `SUP OFF`, `T2 verify`, `⚠ HANDOFF`.

## Делегирование

- `scout` — только исследование, без правок.
- `task` — реализация в отдельном worktree.
- `reviewer` — ревью поведенческих изменений до merge.
- `sonic` — механические правки/сбор данных.
- Перед спавном: один worktree на агента, полный контекст задачи, критерии
  приёмки. Не перекладывать top-level план на агента.

## Definition of done

- Поведение проверено: `npm test`, `npm run typecheck`, загрузка extension в
  OMP, нужный сценарий в TUI/Orca.
- CI зелёный; worktree удалён; `main` синхронизирован с `origin/main`
  (когда remote появится).
- `HANDOFF.md`/`ROADMAP.md`/`README.md` отражают реальность.
- Нет секретов, runtime-зависимостей и незакоммиченных файлов.
- В финале: что сделано, чем проверено, что осталось.

## Ссылки

- `docs/README.md` — вики проекта (архитектура, контракты, runbook, решения).
- `README.md` — установка и пользовательский контракт.
- `ROADMAP.md` — этапы и следующие задачи.
- `docs/orchestrator.md` — дизайн 0.5: оркестратор и subagent-петля.
- `docs/yoda-workflow.md` — режимы и оркестрация.
- `docs/handoff-auto-plan.md` — протокол handoff.
- `../omp-cache-monitor` — экономика кэша; только read-only интеграция.
- `docs/products.md` — карта четырёх продуктов OMP: границы, общие точки
  записи, JSON-контракты, правила кросс-продуктовых правок.
