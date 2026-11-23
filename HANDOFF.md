# Передача: omp-agent-workflow

Дата: 2026-11-23. Основной репозиторий: `~/projects/omp-agent-workflow`.
`main`, версия `0.5.13`; ветки `feat/handoff-preflight`,
`feat/preflight-fixes`, `feat/handoff-state-embed`,
`feat/preflight-checklist`, `feat/preflight-actions`,
`feat/preflight-flow`, `feat/workflow-status-key` и
`feat/workflow-status-p2` слиты ff-only, worktrees удалены. Вики —
`docs/README.md`; backlog — `TODO.md`.

## Что готово

| Что | Состояние |
|---|---|
| Context guard | warning 35%, HANDOFF 50%, `/handoff`, `/handoff-new`, `/handoff-preflight` |
| Workflow modes | `manual` / `assisted` / `yoda` / `yoda-supervised` |
| Automatic handoff | session info, marker, supervisor, continuation prompt |
| Supervisor singleton | lock, stale reclaim, identity guard, release на сигналах |
| Launcher | читает Settings; supervisor гейт; warning по Orca |
| Orchestrator 0.5 | `AUTOPLAN.md`, `STATE.json`, actions, policy, budgets |
| Wrap 0.5.1 | `/wrap`, safe cleanup, next worktree, review |
| Orca additive 0.5.3 | terminal list/show, `status`, `ORCA_CLI_COMMAND` |
| Settings 0.5.4–0.5.5 | 13 ключей в Settings → Plugins |
| Preflight 0.5.6–0.5.7 | read-only проверка перед `/handoff-new` |
| State 0.5.8 | `/handoff-new` встраивает state-файл в новую сессию |
| Checklist 0.5.9 | `/handoff-preflight`: чек-лист, затем таблица проверок |
| Actions 0.5.10 | `/handoff-preflight`: проверки, commit, ff-merge; остальное вручную |
| Flow 0.5.11 | preflight: состояние → меню незакрытых действий → итог |
| Status 0.5.12 | ключ `workflow`: `YODA`/`YODA-SUP`, `⚠ HANDOFF` |
| Status 0.5.13 | `SUP OFF` и `T2 verify` в том же ключе |
| Проверки | `npm test` 172/172, `npm run typecheck`, extension load exit 0 |

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

- Лимит — 64 000 символов; при превышении добавляется маркер с числом
  показанных/полных символов и путём файла; surrogate pair не разрывается.
- Ошибка чтения — fallback: prompt + просьба прочитать файл самому.
- Текст `continuePrompt` остаётся настраиваемым и идёт первым.
- `cwd` новой сессии — `ctx.cwd`; запускать `/handoff-new` из корня
  передаваемого проекта.
- Ручной `/handoff-new` не запускает ход: без supervisor отправь в новой
  сессии «продолжай». Supervisor при automatic handoff отправляет
  continuation prompt сам.

## Статус-строка 0.5.12–0.5.13

Один ключ `workflow`, только main TUI. Текст: `YODA` / `YODA-SUP` по
`workflowMode`; `⚠ HANDOFF` — при `usage >= handoffAtPercent` или marker
текущей сессии. `SUP OFF` — в `yoda-supervised`, если lock/pid supervisor'а
не найден. `T2 verify` — пока `STATE.json.run.active` и есть `current`.
Stale marker другой сессии игнорируется. `statusEnabled=false` очищает ключ;
native `context_pct` не дублируется.

## Settings 0.5.5

`package.json#omp.settings` → Settings → Plugins. Приоритет:
**Settings > env > режим/дефолт** (D12). 13 ключей: `workflowMode`,
`statusEnabled`, `handoffAtPercent`, `handoffCooldownSeconds`,
`contextWarnPercent`, `contextSuggestPercent`, `autoCompactPercent`,
`orcaEnabled`, `orcaPreflight`, `supervisorEnabled`, `continuePrompt`,
`supervisorRetries`, `supervisorLogLevel`.

Launcher читает `omp plugin config list` при старте и передаёт supervisor'у
`OMP_ORCA_*`, `OMP_SUPERVISOR_ENABLED`, `OMP_HANDOFF_PROMPT`,
`OMP_SUPERVISOR_RETRIES`, `OMP_SUPERVISOR_LOG_LEVEL`. Lifecycle-логи
supervisor — stderr; `--dry-run` JSON остаётся чистым stdout.

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
| Тесты guard/preflight | `test/context-guard.test.mjs` |
| Тесты settings | `test/workflow-settings.test.mjs` |
| Решения | `docs/decisions.md` (D11, D12) |
| Runbook | `docs/operations.md` |

## Проверки

```bash
cd ~/projects/omp-agent-workflow
npm test                                  # 172/172
npm run typecheck
omp --no-extensions -e ./index.ts -e ./orchestrator.ts --no-session \
  --no-tools --mode json -p 'Reply with exactly: OK'   # exit 0, stderr пуст
omp plugin config list omp-agent-workflow --json | jq '.schema | keys'
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run | jq -r .command
```

## Следующие шаги

1. Перезапустить `bin/omp-yoda`: текущий OMP/supervisor загружены до merge
   0.5.13; ключ `workflow` (`SUP OFF`, `T2 verify`) появится в новой сессии.
2. 0.6 economics — отложено: нужен машиночитаемый API cache-monitor
   (`costs --json`/tool).
3. Решение владельца: remote/GitHub/CI, английский README, npm/marketplace.
4. Опционально: TUI E2E `/wrap`; Settings для orchestrator-бюджетов.

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
- Launcher читает Settings при старте; extension — на
  `session_start`/`session_switch`.
- `orcaEnabled=false` отключает automatic handoff.
- Supervisor advisory lock: PID reuse и узкая тройная гонка reclaim.
- Remote отсутствует: push/publish — только по решению владельца.
