# Operations runbook

Практические команды и разбор сбоев. Контракт — [contracts.md](contracts.md),
дизайн 0.5 — [orchestrator.md](orchestrator.md).

## Установка и проверка

```bash
omp plugin link /home/db1/projects/omp-agent-workflow
omp plugin list
```

После установки перезапустить OMP. Ставить одним способом: link **или**
копия в `~/.omp/agent/extensions/`, не оба.

Проверки перед merge:

```bash
cd ~/projects/omp-agent-workflow
npm test
npm run typecheck
omp --no-extensions -e ./index.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'        # exit 0, stderr пуст
bin/omp-yoda --version               # launcher находит supervisor и omp
```

`omp plugin link` указывает на `main`. Изменения в task-worktree не влияют
на живую сессию до merge.

## Запуск

Обычный OMP:

```bash
OMP_WORKFLOW_MODE=yoda-supervised bin/omp-yoda
```

Launcher:

- запускает supervisor на `OMP_YODA_DIR` (default `$PWD`);
- ставит `OMP_WORKFLOW_MODE=yoda-supervised`, `OMP_HANDOFF_AT=55`,
  `OMP_CONTEXT_AUTO=off`, если не переопределено;
- снимает supervisor при выходе OMP;
- лог: `${TMPDIR:-/tmp}/omp-yoda-supervisor.log`.

Проверить, что supervisor жив:

```bash
pgrep -af omp-handoff-supervisor
tail -f /tmp/omp-yoda-supervisor.log
```

## Worktree

Проект зарегистрирован в Orca как `omp-agent-workflow`; рабочие worktree —
`~/orca/workspaces/omp-agent-workflow/<slug>`.

```bash
# создать
orca worktree create --repo name:omp-agent-workflow --name <slug> \
  --branch feat/<slug> --base-branch main --no-parent --json

# показать
orca worktree list --json
orca worktree show --worktree path:<path> --json

# удалить
orca worktree rm --worktree path:<path> --delete-branch --json
```

Правила:

- один агент — один worktree;
- `main` (`~/projects/omp-agent-workflow`) — известное хорошее состояние;
- коммит — через `commit` namespace, не `git add`/`git commit` в общем
  worktree;
- после merge удалить worktree и ветку.

## Handoff вручную

1. Обновить `HANDOFF.md`: цель, состояние, решения, файлы, проверки,
   следующие шаги.
2. `/handoff` — сжать контекст (не пишет `HANDOFF.md`).
3. `/handoff-new` — новая сессия; без `HANDOFF.md` отказывает.

Проверить marker:

```bash
cat .omp-handoff-request.json
cat .omp-handoff-session.json
```

## Automatic handoff

Поток: порог → агент обновляет `HANDOFF.md` и пишет marker → supervisor
отправляет `/handoff-new` → новая сессия читает `HANDOFF.md`.

Диагностика:

| Симптом | Причина | Действие |
|---|---|---|
| Marker есть, handoff нет | Supervisor не запущен | `bin/omp-yoda` или `node bin/omp-handoff-supervisor.mjs --dir .` |
| Supervisor молчит | Нет terminal handle (не Orca) | Запустить в Orca-терминале или вручную `/handoff-new` |
| Marker игнорируется | `sessionFile` от старой сессии | Удалить stale marker, обновить state |
| Цикл handoff | Нет cooldown/старый marker | Проверить `OMP_HANDOFF_COOLDOWN_SECONDS`, логи, stale guard |
| `/handoff-new` отказывает | Нет `HANDOFF.md` | Обновить файл |

Dry-run supervisor показывает точную команду, ничего не отправляя:

```bash
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run
```

## Orchestrator `[partial]`

CLI и extension (`/orchestrate`, tool `orchestrator`) работают; E2E — этап D.

```bash
# старт/статус
bin/omp-orchestrate status --json
bin/omp-orchestrate next --json

# задача
bin/omp-orchestrate start T1 --json
bin/omp-orchestrate verify T1 --json
bin/omp-orchestrate finish T1 --commit SHA --review ok --json

# аварии
bin/omp-orchestrate rebase T1 --json
bin/omp-orchestrate stop --reason gate --json
bin/omp-orchestrate resume --json
```

Если run остановлен:

1. Прочитать `STATE.stop` (reason/detail) и `HANDOFF.md`.
2. Устранить причину: грязный base, конфликт, gate, бюджет.
3. `bin/omp-orchestrate resume` или `/orchestrate`.
4. Не удалять `STATE.json` вручную: потеря state = `state-missing`.

## Проверки поведения

| Что | Как |
|---|---|
| Загрузка extension | `omp --no-extensions -e ./index.ts ... -p '...'`; для 0.5 — `-e ./orchestrator.ts` |
| Команды TUI | `/handoff`, `/handoff-new`; 0.5 — `/orchestrate`, `/orchestrate-stop` |
| Supervisor e2e | Marker → `/handoff-new` → новая сессия ответила `OK` |
| Worktree | `git -C <path> status`, `git -C <path> log -1` |
| Merge | `git -C <base> log --oneline -3`; ff-only, без merge-коммита |
| Stop-gate | `STATE.stop`, отсутствие новых `task`-спавнов |

## Частые ошибки

- **Правка линкованного чекаута под эксперимент.** Для задач — worktree;
  `main` не трогать.
- **Два способа установки.** Link и копия одновременно → две версии
  extension.
- **Ручной `git worktree add` вне Orca.** Для проекта использовать
  `orca worktree create`; git backend — только fallback/тесты.
- **`STATE.json` в git.** Runtime-файл; коммитится `HANDOFF.md`.
- **Handoff без `HANDOFF.md`.** `/handoff-new` откажет.
- **Ожидание automatic handoff вне Orca.** Нет terminal handle — только
  ручная команда.

## Логи и артефакты

| Артефакт | Путь |
|---|---|
| Supervisor | `${TMPDIR:-/tmp}/omp-yoda-supervisor.log` |
| Session JSONL | `~/.omp/agent/sessions/<cwd-slug>/*.jsonl` |
| Session info | `<worktree>/.omp-handoff-session.json` |
| Marker | `<worktree>/.omp-handoff-request.json` |
| State 0.5 | `<control-worktree>/STATE.json` |
| Lock 0.5 | `<control-worktree>/.omp-orchestrator.lock` |
