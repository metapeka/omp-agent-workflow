# omp-agent-workflow — вики проекта

Карта знаний по проекту. Цель — не переоткрывать каждый раз, как устроен
OMP, Orca и контракт workflow. Источник истины — код, тесты и git; эта вики
объясняет, где что лежит и почему сделано именно так.

Версия: `0.5.16` (context guard 0.3 + orchestrator 0.5 + wrap + supervisor
singleton + additive Orca + Settings + status key + safe cleanup + handoff
guards + multi-session info).
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

## С чего начать

| Кто ты | Читай по порядку |
|---|---|
| Новый агент в сессии | `HANDOFF.md` → `ROADMAP.md` → [architecture.md](architecture.md) → [orchestrator.md](orchestrator.md) |
| Меняешь 0.3 (guard/handoff/supervisor) | [contracts.md](contracts.md) → [architecture.md](architecture.md) → [operations.md](operations.md) |
| Реализуешь 0.5 | [orchestrator.md](orchestrator.md) → [decisions.md](decisions.md) → [AUTOPLAN.example.md](AUTOPLAN.example.md) |
| Разбираешь сбой в TUI/Orca | [operations.md](operations.md) |
| Разбираешься, как проходит handoff | [handoff-flow.md](handoff-flow.md) → [contracts.md](contracts.md) |
| Принимаешь решение по продукту | [decisions.md](decisions.md) |

## Страницы

| Страница | Что внутри |
|---|---|
| [architecture.md](architecture.md) | Компоненты, потоки данных, факты OMP API 19.1.0, что extension может и не может, источники истины, границы проекта |
| [contracts.md](contracts.md) | Стабильный контракт 0.3: режимы, env, файлы marker/session, команды, инварианты; что нельзя менять |
| [orchestrator.md](orchestrator.md) | Дизайн 0.5: роли, `AUTOPLAN.md`, `STATE.json`, действия, политика, бюджеты, stop-gates, handoff на границе, этапы A–D |
| [wrap.md](wrap.md) | `/wrap` 0.5.1: карточки, safety для cleanup, handoff, следующая задача |
| [operations.md](operations.md) | Runbook: установка, запуск, supervisor, worktree, проверки, типовые сбои |
| [handoff-flow.md](handoff-flow.md) | Два пути handoff: OMP без Orca (вручную) и Orca + supervisor (автоматически); кто вызывает `/handoff-new` и кто стартует новую сессию |
| [decisions.md](decisions.md) | Подтверждённые решения D1–D10, отклонённые альтернативы, открытые вопросы |
| [AUTOPLAN.example.md](AUTOPLAN.example.md) | Шаблон плана с JSON-блоками и комментариями |
| [research/market-landscape.md](research/market-landscape.md) | Рынок на 2026-11-23: PI, OMP и GitHub; ближайшие аналоги, чего нет ни у кого, выводы для позиционирования; переводы [RU](research/market-landscape.ru.md), [ZH](research/market-landscape.zh-CN.md) |

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
