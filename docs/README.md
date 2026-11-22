# omp-agent-workflow — вики проекта

Карта знаний по проекту. Цель — не переоткрывать каждый раз, как устроен
OMP, Orca и контракт workflow. Источник истины — код, тесты и git; эта вики
объясняет, где что лежит и почему сделано именно так.

Версия: `0.3.0` (context guard, handoff, supervisor, режимы).
Этап `0.5` — orchestrator и subagent-петля: дизайн утверждён, этапы A–C
(plan/state/cost/worktree/actions/extension) реализованы, этап D (E2E и
release) впереди. См. [orchestrator.md](orchestrator.md).

## С чего начать

| Кто ты | Читай по порядку |
|---|---|
| Новый агент в сессии | `HANDOFF.md` → `ROADMAP.md` → [architecture.md](architecture.md) → [orchestrator.md](orchestrator.md) |
| Меняешь 0.3 (guard/handoff/supervisor) | [contracts.md](contracts.md) → [architecture.md](architecture.md) → [operations.md](operations.md) |
| Реализуешь 0.5 | [orchestrator.md](orchestrator.md) → [decisions.md](decisions.md) → [AUTOPLAN.example.md](AUTOPLAN.example.md) |
| Разбираешь сбой в TUI/Orca | [operations.md](operations.md) |
| Принимаешь решение по продукту | [decisions.md](decisions.md) |

## Страницы

| Страница | Что внутри |
|---|---|
| [architecture.md](architecture.md) | Компоненты, потоки данных, факты OMP API 19.1.0, что extension может и не может, источники истины, границы проекта |
| [contracts.md](contracts.md) | Стабильный контракт 0.3: режимы, env, файлы marker/session, команды, инварианты; что нельзя менять |
| [orchestrator.md](orchestrator.md) | Дизайн 0.5: роли, `AUTOPLAN.md`, `STATE.json`, действия, политика, бюджеты, stop-gates, handoff на границе, этапы A–D |
| [operations.md](operations.md) | Runbook: установка, запуск, supervisor, worktree, проверки, типовые сбои |
| [decisions.md](decisions.md) | Подтверждённые решения D1–D10, отклонённые альтернативы, открытые вопросы |
| [AUTOPLAN.example.md](AUTOPLAN.example.md) | Шаблон плана с JSON-блоками и комментариями |

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
- `AGENTS.md` — правила работы агента в этом репозитории.
- `ROADMAP.md` — этапы и приоритеты.
- `HANDOFF.md` — человекочитаемое состояние текущей работы.
- `docs/yoda-workflow.md` — режимы и акторы.
- `docs/handoff-auto-plan.md` — протокол automatic handoff.
- `docs/next-session.md` — стартовый контекст следующей сессии.
