# OAW — omp-agent-workflow: вики проекта

Карта знаний по OAW (`omp-agent-workflow`). Цель — не переоткрывать каждый
раз, как устроен OMP, Orca и контракт workflow. Источник истины — код,
тесты и git; эта вики объясняет, где что лежит и почему сделано именно так.

Версия: `0.6.0` (context guard 0.3 + orchestrator 0.5 + wrap + supervisor
singleton + additive Orca + Settings + status key + safe cleanup + handoff
guards + multi-session info + fallback compaction + kill switch + advisory
`next-session:` + CLI JSON v1 и `doctor` + `execution` + пресеты + метрики
preflight + flight recorder handoff + цена границы из `costs --json`).
Этап `0.5` — orchestrator и subagent-петля: реализован (этапы A–D); live
TUI E2E пройден 2026-11-22. См. [orchestrator.md](orchestrator.md).
`0.5.1` — `/wrap`: guided завершение работы, см. [wrap.md](wrap.md).
`0.5.2` — один supervisor на каталог, см. [operations.md](operations.md).
`0.5.3` — Orca только как опция (D11): terminal list/show, status warning.
`0.5.4` — Settings → Plugins (D12): 9 ключей, Settings > env.
`0.5.5` — Settings для supervisor: `continuePrompt`, retries, log level.
`0.5.6` — `/handoff-preflight`: read-only проверка перед `/handoff-new`.
`0.5.7` — preflight hardening: repo-error, upstream compare, `[файл]`.
`0.5.8` — `/handoff-new` встраивает содержимое state-файла в custom message
(лимит 32k, маркер обрезки, fallback при ошибке чтения).
`0.5.9` — `/handoff-preflight` показывает чек-лист перед таблицей проверок;
отмена останавливает команду, без `askDialog` меню пропускается.
`0.5.10` — `/handoff-preflight` меню действий: проверки, commit, ff-merge;
вручную остаются задача, `HANDOFF.md`, worktree.
`0.5.11` — preflight сначала проверяет и даёт вердикт, затем предлагает
только незакрытые действия; итог разбит на действия, ручные шаги и состояние.
`0.5.12` — ключ `workflow` в статус-строке: `YODA`/`YODA-SUP` и
`⚠ HANDOFF`; `statusEnabled` — 13-й ключ Settings; `context_pct` не
дублируется.
`0.5.13` — P2-статус: `SUP OFF` при недоступном supervisor и `T2 verify`
для активной задачи orchestrator; тот же ключ `workflow`.
`0.5.14` — безопасный cleanup worktree: `removeWorktree` проверяет
merged/clean/current/live-процессы/терминалы, не использует
`--delete-branch`/`--force`/`-D`, сохраняет tip в backup-ref и по умолчанию
оставляет ветку. Причина: `orca worktree rm` останавливает PTY удаляемого
worktree и присылает SIGTERM живой OMP-сессии.
`0.5.15` — handoff guards: state 32k символов (≈10–15k токенов), warning без
supervisor/terminal handle на пороге, повтор запроса без marker через 2 хода
(максимум 3 запроса).
`0.5.16` — session info как карта по `pid`: одноразовый запуск не затирает
handle живой сессии, dead prune, lock + atomic rename, supervisor выбирает
запись по `marker.sessionFile`; flat 0.5.15 читается.
`0.5.17` — fallback-компакция после исчерпания handoff-повторов или при
marker без живого supervisor; рекомендация для 1M — `autoCompactPercent=40`.
`0.5.18` — `workflowMode: off`: выключатель плагина, OMP работает на своих
дефолтах; `OMP_WORKFLOW_MODE=off` побеждает Settings. `/handoff` не
регистрируется (builtin OMP); имена команд проверяет `npm run check:names`.
`0.5.19` — advisory `next-session:` в первой строке `HANDOFF.md`: launcher
добавляет `--model`/`--thinking` при старте, preflight показывает
валидность, модель в сессии не меняется (D14).
`0.5.20` — CLI JSON v1: `status --json` и `doctor --json` получают
`schemaVersion: 1`; `doctor` — 16 read-only проверок среды (фиксированный
порядок, каждый проб ≤ 2 с, без сети), `--strict` повышает warn до fail;
отсутствие Orca/agent-team — warn/skip, не fail. Контракт —
[contracts.md](contracts.md#cli-json-v1-status-и-doctor-0520).
`0.5.21` — `plan.execution: "omp" | "external"`: `external` назначает
владельцем задач Ensemble, OAW отказывает `start/verify/finish/rebase` со
stop-reason `external-run` и не трогает `STATE.json`/worktree; `doctor`
предупреждает, если `external` без активного прогона. D15.
`0.5.22` — пресеты запуска `routine`/`plan`/`review`/`budget`: ключ
Settings `workflowPreset` (14-й) и флаг `--preset`; задают модель,
thinking, пороги и continue prompt, явные настройки/флаги выигрывают;
`plan` советует advisory `model=flash mode=routine`. D16.
`0.5.23` — метрики в `/handoff-preflight` (F3): размер state против
лимита 32k, cache hit, reasoning share и spend сессии из root session
JSONL (`lib/session-metrics.ts`), прогресс плана с gate/deps и spend run
из `AUTOPLAN.md`/`STATE.json`. Цена границы handoff отложена до таблицы
ставок cache-monitor: записанные `usage.cost` гуляют ~2× на одной модели.
`0.5.24` — flight recorder в запросе HANDOFF: ветка, короткий HEAD и до 6
незакоммиченных путей (runtime-файлы исключены, бюджет 300 символов);
handoff остаётся read-only, контракт marker/session не меняется. Карта всех
защит и точек в цикле — [guards.md](guards.md).
`0.5.25` — вывод `/handoff-preflight`: таблица `GROUP  ST  DETAIL` с
расчётной шириной и переносом на широком терминале, группы с иконками и
вердиктом сверху уже 70 колонок; глифы из `theme.symbol`, `ascii`-пресет
даёт `[+]`/`[!]`/`[-]`. Формат — [commands.md](commands.md).
`0.5.26` — preflight предлагает действие `push`, когда у ветки есть upstream
и незапушенные коммиты: `git push` без `--force`, только по выбору в меню;
упавшие проверки или commit пропускают push.
`0.6.0` — цена границы handoff в preflight из `omp-cache-monitor
costs --json` v1: медиана холодных ходов против тёплых, разрез по моделям
при >1 модели; CLI нет/упал/другая схема — строк нет (graceful skip).

## С чего начать

| Кто ты | Читай по порядку |
|---|---|
| Новый агент в сессии | `HANDOFF.md` → `ROADMAP.md` → [architecture.md](architecture.md) → [orchestrator.md](orchestrator.md) |
| Меняешь 0.3 (guard/handoff/supervisor) | [contracts.md](contracts.md) → [architecture.md](architecture.md) → [operations.md](operations.md) |
| Реализуешь 0.5 | [orchestrator.md](orchestrator.md) → [decisions.md](decisions.md) → [AUTOPLAN.example.md](AUTOPLAN.example.md) |
| Разбираешь сбой в TUI/Orca | [operations.md](operations.md) |
| Быстрый ответ на типовой вопрос | [faq.md](faq.md) |
| Разбираешься, как проходит handoff | [handoff-flow.md](handoff-flow.md) → [contracts.md](contracts.md) |
| Ищешь, где стоят защиты от поломки/затирания | [guards.md](guards.md) → [handoff-flow.md](handoff-flow.md) |
| Понимаешь кэш, сессии и цену сброса | [Pages: EN](https://metapeka.github.io/omp-agent-workflow/) → [RU](https://metapeka.github.io/omp-agent-workflow/ru/) → [ZH](https://metapeka.github.io/omp-agent-workflow/zh/) |
| Принимаешь решение по продукту | [decisions.md](decisions.md) |

## Страницы

| Страница | Что внутри |
|---|---|
| [architecture.md](architecture.md) | Компоненты, потоки данных, факты OMP API 19.1.0, что extension может и не может, источники истины, границы проекта |
| [contracts.md](contracts.md) | Стабильный контракт 0.3: режимы, env, файлы marker/session, команды, инварианты; CLI JSON v1 (`status`/`doctor`); что нельзя менять |
| [commands.md](commands.md) | Гид по командам: `/handoff`, `/handoff-preflight`, `/handoff-new`, `/wrap`, `/orchestrate`, tool `orchestrator`, CLI launcher и supervisor, файлы |
| [faq.md](faq.md) | Короткие ответы: handoff без коммита, меню и статусы preflight, сообщение коммита, supervisor, worktree, диагностика |
| [orchestrator.md](orchestrator.md) | Дизайн 0.5: роли, `AUTOPLAN.md`, `STATE.json`, действия, политика, бюджеты, stop-gates, handoff на границе, этапы A–D |
| [wrap.md](wrap.md) | `/wrap` 0.5.1: карточки, safety для cleanup, handoff, следующая задача |
| [operations.md](operations.md) | Runbook: установка, запуск, supervisor, worktree, проверки, типовые сбои |
| [handoff-flow.md](handoff-flow.md) | Два пути handoff: OMP без Orca (вручную) и Orca + supervisor (автоматически); кто вызывает `/handoff-new` и кто стартует новую сессию; снимок дерева в запросе (0.5.24) |
| [guards.md](guards.md) | Карта защит: угроза → защита → точка в цикле → версия; чем защита не является; flight recorder 0.5.24 |
| [decisions.md](decisions.md) | Подтверждённые решения D1–D10, отклонённые альтернативы, открытые вопросы |
| [AUTOPLAN.example.md](AUTOPLAN.example.md) | Шаблон плана с JSON-блоками и комментариями |
| [research/market-landscape.md](research/market-landscape.md) | Рынок на 2026-11-23: PI, OMP и GitHub; ближайшие аналоги, чего нет ни у кого, выводы для позиционирования; переводы [RU](research/market-landscape.ru.md), [ZH](research/market-landscape.zh-CN.md) |
| [research/model-modes.md](research/model-modes.md) | `[design]` Цены cline-pass, стоимость хода на 100k, замер handoff-payload (20 сессий), цена границы handoff, режим v1 и синтаксис `next-session:`; не контракт |
| [research/workflow-presets.md](research/workflow-presets.md) | `[готово F1/F2]` Пресеты `routine/plan/review/budget`, `--preset` и `workflowPreset`, `next-session:` в launcher, метрики выбора, `--plan-yolo`; F3–F4 `[design]` |
| [Pages](https://metapeka.github.io/omp-agent-workflow/) | HTML-разбор: prompt cache, сессии, где помогает плагин, инцидент 2026-11-24, пороги; EN + [RU](https://metapeka.github.io/omp-agent-workflow/ru/) + [ZH](https://metapeka.github.io/omp-agent-workflow/zh/) |

## Правила этой вики

- Описываем текущую реальность и явно помечаем планы: `[готово]`,
  `[design]`, `[future]`.
- Не дублируем контракт в трёх местах: стабильные схемы — в
  `contracts.md`, дизайн 0.5 — в `orchestrator.md`, остальные страницы
  ссылаются.
- Поведенческое изменение → тест и обновление этой вики в том же worktree.
- Секреты, session-файлы и логи в вики не попадают.
- Публикация npm/marketplace и смена видимости — только по решению
  владельца.

## Внешние документы

- `README.md` — пользовательская установка и краткий контракт.
- `TODO.md` — оперативный backlog: сейчас, будущее, закрытые задачи.
- `AGENTS.md` — правила работы агента в этом репозитории.
- `ROADMAP.md` — этапы и приоритеты.
- `HANDOFF.md` — человекочитаемое состояние текущей работы.
- `docs/yoda-workflow.md` — режимы и акторы.
- `docs/handoff-auto-plan.md` — протокол automatic handoff.
- `docs/next-session.md` — стартовый контекст следующей сессии.
