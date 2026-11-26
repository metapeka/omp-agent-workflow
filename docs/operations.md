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
omp --no-extensions -e ./index.ts --no-session --mode json \
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

- читает Settings → Plugins (`omp plugin config list`); env остаётся fallback;
- запускает supervisor на `OMP_YODA_DIR` (default `$PWD`), если
  `supervisorEnabled` и `orcaEnabled` включены;
- передаёт supervisor'у `continuePrompt`, `supervisorRetries`,
  `supervisorLogLevel` через `OMP_HANDOFF_PROMPT`/`OMP_SUPERVISOR_RETRIES`/
  `OMP_SUPERVISOR_LOG_LEVEL`;
- при выключенном supervisor печатает причину и запускает OMP без него;
- ставит `OMP_WORKFLOW_MODE=yoda-supervised`, `OMP_HANDOFF_AT=55`,
  `OMP_CONTEXT_AUTO=off`, если не переопределено;
- снимает supervisor при выходе OMP;
- лог: `${TMPDIR:-/tmp}/omp-yoda-supervisor.log`;
- если `orca` доступен, но `orca status` возвращает ошибку — предупреждение
  «automatic handoff не сработает»; OMP всё равно запускается;
- путь к Orca CLI — Settings `orcaCli` (нет в UI MVP) или `ORCA_CLI_COMMAND`
  (default `orca`).
- если первая строка `HANDOFF.md` — валидная `next-session:` (свежая, модель
  из `omp models --json`), добавляет `--model`/`--thinking` перед аргументами
  пользователя; явные флаги выигрывают, невалидная/устаревшая строка ничего
  не меняет. В режиме `off` строка не читается. Подробности —
  [contracts.md](contracts.md#handoffmd-advisory-next-session-0519).

Проверить, что supervisor жив:

```bash
pgrep -af omp-handoff-supervisor
tail -f /tmp/omp-yoda-supervisor.log
```

Supervisor — один на каталог:

- lock-dir `<dir>/.omp-handoff-supervisor.lock/` с `owner.json`
  (`pid`, `dir`, `startedAt`);
- второй экземпляр для того же `--dir` пишет в stderr
  `another supervisor is running ...` и выходит с кодом 0, marker не трогает;
- lock снимается на выходе и по `SIGINT`/`SIGTERM`/`SIGHUP`;
- после `SIGKILL`/падения lock перехватывается, когда `pid` из `owner.json`
  уже мёртв; пока `owner.json` не записан, lock считается инициализирующимся
  `--lock-grace` секунд (default 10);
- две OMP-сессии в одном каталоге делят marker и `HANDOFF.md` — это
  конфигурационная ошибка, а не повод запускать два supervisor'а.

Перед `orca terminal send` supervisor проверяет handle через
`orca terminal show --terminal <handle> --json`, если `orcaPreflight` включён.
Если terminal больше не жив, handoff не отправляется, marker сохраняется,
supervisor завершается с кодом 1 — обнови `.omp-handoff-session.json` или
перезапусти OMP из Orca.

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

# удалить: без --delete-branch/--force, не изнутри worktree
orca worktree rm --worktree path:<path> --json
# ветка остаётся; удалить только после проверки merged
git -C /home/db1/projects/omp-agent-workflow branch -d feat/<slug>
```

Правила:

- один агент — один worktree;
- `main` (`~/projects/omp-agent-workflow`) — известное хорошее состояние;
- коммит — через `commit` namespace, не `git add`/`git commit` в общем
  worktree;
- cleanup запускать только снаружи удаляемого worktree: `orca worktree rm`
  останавливает PTY этого worktree (SIGTERM), поэтому живая сессия внутри
  него не должна дожидаться команды; `--delete-branch` не использовать.
- после merge удалить worktree; ветку — только явно и `git branch -d`;
  `removeWorktree` сохраняет tip в `refs/omp-worktree-backup/*`.

## Статус-строка

Ключ `workflow`: `YODA`/`YODA-SUP` по режиму, `SUP OFF` при недоступном
supervisor в `yoda-supervised`, `T2 verify` для активной задачи
orchestrator и `⚠ HANDOFF` при пороге или marker текущей сессии.
В `manual`/`assisted` ключ пуст; `statusEnabled=false` очищает его.
Stale marker другой сессии warning не показывает. `context_pct` и cache
не дублируются.

Если OMP рисует hook-статус дважды, оставить один путь: `status` в
`statusLine.rightSegments` + `statusLine.showHookStatus=false`, либо убрать
`status` из сегментов.

## Handoff вручную

1. Обновить `HANDOFF.md`: цель, состояние, решения, файлы, проверки,
   следующие шаги.
2. `/handoff-preflight [файл]` — сначала таблица и вердикт, затем меню
   только незакрытых действий: проверки, commit, ff-merge. Итог показывает
   действия, ручные шаги и свежее состояние. Блокеры advisory.
3. `/handoff` — сжать контекст (не пишет `HANDOFF.md`).
4. `/handoff-new` — новая сессия; без `HANDOFF.md` отказывает.

> **Важно.** В OMP без Orca `/handoff-new` только внедряет state в новую
> сессию и не запускает ход. Отправь в ней «продолжай» — state уже в
> контексте. В Orca automatic handoff делается сам: supervisor после
> `/handoff-new` отправляет continuation prompt.

Полное описание обоих путей — [handoff-flow.md](handoff-flow.md).

Проверить marker:

```bash
cat .omp-handoff-request.json
cat .omp-handoff-session.json
```

## Automatic handoff

Поток: порог → агент обновляет `HANDOFF.md` и пишет marker → supervisor
отправляет `/handoff-new` → supervisor отправляет continuation prompt →
новая сессия начинает работу сама.

Диагностика:

| Симптом | Причина | Действие |
|---|---|---|
| Marker есть, handoff нет | Supervisor не запущен | `bin/omp-yoda` или `node bin/omp-handoff-supervisor.mjs --dir .` |
| Supervisor молчит | Нет terminal handle (не Orca) | Запустить в Orca-терминале или вручную `/handoff-new` |
| Marker игнорируется | `sessionFile` от старой сессии или запись с мёртвым pid | Проверить `.sessions[]` по `sessionFile`, удалить stale marker, обновить state |
| Второй supervisor сразу вышел | Lock держит живой supervisor того же `--dir` | Ожидаемо: один supervisor на каталог; смотреть `owner.json` |
| Цикл handoff | Нет cooldown/старый marker | Проверить `OMP_HANDOFF_COOLDOWN_SECONDS`, логи, stale guard |
| `/handoff-new` отказывает | Нет `HANDOFF.md` | Обновить файл |

Dry-run supervisor показывает точную команду, ничего не отправляя:

```bash
node bin/omp-handoff-supervisor.mjs --dir . --once --dry-run
```

## Orchestrator `[готово]`

CLI и extension (`/orchestrate`, tool `orchestrator`) работают; живой
TUI-цикл — ручная проверка.

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
bin/omp-orchestrate doctor --json
bin/omp-orchestrate doctor --strict
```

Если run остановлен:

1. Прочитать `STATE.stop` (reason/detail) и `HANDOFF.md`.
2. Устранить причину: грязный base, конфликт, gate, бюджет.
3. `bin/omp-orchestrate resume` или `/orchestrate`.
4. Не удалять `STATE.json` вручную: потеря state = `state-missing`.

## Wrap: завершение работы

```text
/wrap
```

Карточки: handoff, обновить `HANDOFF.md`, cleanup merged worktree, следующий
worktree, ретро-review. Destructive/spend действия требуют confirm.

- Cleanup: только merged+clean+не текущий worktree, без live-процесса,
  без live-терминала Orca (`orca terminal list --json`, `connected` и не
  `orphaned`) и без `--force`; ветка удаляется `git branch -d`. `/proc` —
  fallback, если Orca недоступен. Orca-created worktree держит
  shell-терминал — закрой его, иначе cleanup заблокирован.
- Если Orca сохранила ветку — это safe-результат.
- Текущий worktree не удаляется из-под OMP: выйти и удалить вручную.
- Handoff: `/wrap` проверяет `HANDOFF.md` в `ctx.cwd`, но не переключает
  сессию; после карточки выполнить `/handoff-new`.
- Publish/push не автоматизируются.

Если cleanup недоступен, причина в описании карточки. Полный safety —
[wrap.md](wrap.md).

## Проверки поведения

| Что | Как |
|---|---|
| Загрузка extension | `omp --no-extensions -e ./index.ts ... -p '...'`; для 0.5 — `-e ./orchestrator.ts` |
| Команды TUI | `/handoff`, `/handoff-new`, `/handoff-preflight`; 0.5 — `/orchestrate`, `/orchestrate-stop`; 0.5.1 — `/wrap` |
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
- **Две сессии в одном каталоге.** Session info хранит обе записи, но marker
  и `HANDOFF.md` общие: handoff затрагивает одну сессию. Вторую сессию лучше
  держать в своём worktree.
- **Advisory не применилась.** Проверить `/handoff-preflight`: строка должна
  быть первой, `v=1`, `ts` не старше 24 ч, `model` из `omp models --json`.
  Явные `--model`/`--thinking` в команде launcher'а отменяют advisory; `off`
  отключает чтение. Пустой вывод `bin/omp-next-session` — строка отброшена.

## Логи и артефакты

| Артефакт | Путь |
|---|---|
| Supervisor | `${TMPDIR:-/tmp}/omp-yoda-supervisor.log` |
| Session JSONL | `~/.omp/agent/sessions/<cwd-slug>/*.jsonl` |
| Session info | `<worktree>/.omp-handoff-session.json` |
| Lock session info | `<worktree>/.omp-handoff-session.lock/` |
| Marker | `<worktree>/.omp-handoff-request.json` |
| Lock supervisor | `<worktree>/.omp-handoff-supervisor.lock/owner.json` |
| State 0.5 | `<control-worktree>/STATE.json` |
| Lock 0.5 | `<control-worktree>/.omp-orchestrator.lock` |
