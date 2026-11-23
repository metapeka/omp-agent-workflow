# omp-agent-workflow — инструкции агенту

## Роль

Ты поддерживаешь `omp-agent-workflow` — OMP-расширение для context guard,
ручного и автоматического handoff, режимов `manual`/`assisted`/`yoda`/
`yoda-supervised` и внешнего supervisor.

Продукт отдельный от `omp-cache-monitor`: cache-monitor считает стоимость и
hit rate, этот проект управляет контекстом и сменой сессии. Не смешивать
контракты и не переносить код между репозиториями без решения владельца.

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

- Версия `0.5.13`, локальный git-репозиторий, основная ветка `main`.
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
  `T2 verify` в том же ключе.
- Подключён как OMP-плагин: `omp plugin link /home/db1/projects/omp-agent-workflow`.
- В Orca зарегистрирован как проект `omp-agent-workflow`; рабочие worktree —
  `~/orca/workspaces/omp-agent-workflow/<slug>`.
- `npm test` — 172 теста; `npm run typecheck`; CI в `.github/workflows/ci.yml`.
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
npm test
npm run typecheck
omp --no-extensions -e ./index.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'        # exit 0, stderr пуст
bin/omp-yoda --version               # launcher находит supervisor и omp

# финал
git -C /home/db1/projects/omp-agent-workflow merge --ff-only feat/<slug>
orca worktree rm --worktree path:/home/db1/orca/workspaces/omp-agent-workflow/<slug> \
  --delete-branch
```

- Один агент — один worktree; не редактировать один файл параллельно.
- Коммит — через `commit` namespace, не `git add`/`git commit`.
- Поведенческое изменение — только с тестом; docs обновлять в том же worktree.
- После merge — проверить `omp plugin list`, `/handoff`, `/handoff-preflight`,
  `/handoff-new` и supervisor в TUI.

## Контракт режимов

| `OMP_WORKFLOW_MODE` | Авто-компакция | Handoff |
|---|---|---|
| `manual` | выкл | выкл |
| `assisted` (default) | 60% | выкл |
| `yoda` | 70% fallback | 55% |
| `yoda-supervised` | 70% fallback | 55% + supervisor |

`OMP_CONTEXT_WARN`, `OMP_CONTEXT_SUGGEST`, `OMP_CONTEXT_AUTO`,
`OMP_HANDOFF_AT`, `OMP_HANDOFF_COOLDOWN_SECONDS` — env fallback, если ключ
не задан в Settings. Приоритет: Settings > env > режим/дефолт.
`off` отключает соответствующее действие.

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
