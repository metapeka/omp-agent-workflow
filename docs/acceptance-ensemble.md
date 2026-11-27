# Приёмка `execution: external`: OAW + Ensemble

Дата: 2026-11-27. OAW `1.0.2` (A1–A9 сняты на 1.0.1); проверено на Orca `1.4.278`, Ensemble
`0.5.5`, OMP `19.2.1`, Node `22.23.5`. Контракт —
[contracts.md](contracts.md), решение — D15 в [decisions.md](decisions.md),
карта защит — [guards.md](guards.md).

Цель: доказать, что при `plan.execution: "external"` задачи ведёт Ensemble,
а OAW не создаёт и не меняет `STATE.json` и worktree, отказывает
`start`/`verify`/`finish`/`rebase`, но продолжает работать как контекстный
плагин (`status`, `next`, `doctor`, handoff).

## Матрица проверок

| # | Утверждение | Ожидание |
|---|---|---|
| A1 | `status --json` работает без `STATE.json` | exit 0, `schemaVersion: 1`, `state: null`, `next: T1` |
| A2 | `next --json` не мутирует состояние | exit 0, `kind: task`, тот же план |
| A3 | `start`/`verify`/`finish`/`rebase` отказывают | exit 0, `{"kind":"stop","reason":"external-run","detail":"plan execution is external; Ensemble owns tasks"}` |
| A4 | После A3 нет `STATE.json` и worktree | файлов и каталога `worktreeRoot` нет |
| A5 | `stop`/`resume` без state | exit 1, `STATE.json is missing`; задачи не запускаются, state не создаётся |
| A6 | `stop` со старым state | exit 0, `run.active: false` — снимает leftover-claim перед передачей задач Ensemble |
| A7 | `doctor` при `external` без подтверждённого прогона | `ensemble.active: warn`, exit 0; `--strict` → `fail`, exit 1 |
| A8 | `doctor` при `external` и активном прогоне (JSON-статус) | `ensemble.active: pass`, `external ensemble run active` |
| A9 | `doctor` при активном Ensemble и живом `STATE.run` | `ensemble.active: warn`, `two owners`; `--strict` → `fail` |
| C1 | Живой Ensemble 0.5.5 | `ensemble.active: warn`, причина — нет JSON-статуса (см. «Известный разрыв») |

A1–A9 — детерминированные, без живого Ensemble. C1 — живой прогон.

## Предусловия

- OAW линкован: `omp plugin list` → `omp-agent-workflow@1.0.2`.
- Orca запущена, `orca plugin list` → `duegin.ensemble` в состоянии
  `running`.
- Репозиторий-фикстура: `AUTOPLAN.md` с `plan.execution: "external"`,
  `backend: "git"`, `worktreeRoot` вне репозитория; ветка `feat/t1-…` не
  существует.
- Для A3–A4 достаточно обычного терминала. Для живого прогона (C1) команды
  запускаются **из терминала лида команды**: `agent-team` без
  `ORCA_TERMINAL_HANDLE` отвечает «runs only inside Orca…», а вне team
  session — «This terminal is not part of an agent team» с exit 1.

## Часть A — детерминированная (без Ensemble)

Файл `AUTOPLAN.md` и прогон:

````bash
D=$(mktemp -d); cd "$D"; git init -q -b main
cat > AUTOPLAN.md <<'EOF'
# AUTOPLAN — external acceptance

```json plan
{
  "version": 1,
  "goal": "external-run rehearsal",
  "baseBranch": "main",
  "baseRepo": null,
  "worktreeRoot": "/tmp/oaw-ext-acceptance-wt",
  "backend": "git",
  "execution": "external",
  "verify": ["true"],
  "budgets": { "maxTasksPerSession": 1, "maxSpendUsd": 1, "maxMinutes": 10 }
}
```

```json task
{
  "id": "T1",
  "title": "trivial",
  "deps": [],
  "branch": "feat/t1-trivial",
  "files": [],
  "acceptance": ["no change needed"],
  "verify": ["true"],
  "review": false,
  "gate": null
}
```
EOF
git add AUTOPLAN.md && git -c user.email=t@t -c user.name=t commit -qm init

CLI=~/projects/omp-agent-workflow/bin/omp-orchestrate
node "$CLI" status --json
node "$CLI" next --json
node "$CLI" start T1 --json
node "$CLI" verify T1 --json
node "$CLI" finish T1 --commit deadbeef --review ok --json
node "$CLI" rebase T1 --json
node "$CLI" stop --reason manual --json     # A5: exit 1
node "$CLI" resume --json                   # A5: exit 1
node "$CLI" doctor --json                   # A7
node "$CLI" doctor --strict --json          # A7: exit 1
ls STATE.json /tmp/oaw-ext-acceptance-wt    # A4: нет
````

Наблюдено 2026-11-27 (Orca 1.4.278, Ensemble 0.5.5): A1–A5 совпали
полностью; `doctor` — 16 проверок, `pass 11 / warn 3 / skip 2 / fail 0`,
`ensemble.active: warn "execution=external; agent-team status exited 1"`
(терминал без team session); `--strict` — exit 1.

`stop`/`resume` при `external` и вовсе без `STATE.json` возвращают
`STATE.json is missing` (exit 1): state они не создают — это ожидаемо,
задачи не запускаются.

## Часть B — OAW-сторона контракта (JSON-статус)

Если Ensemble (или шим на `PATH`) отдаёт JSON, OAW обязан различать
активность и `two owners`. Шим ставится первым в `PATH`:

````bash
mkdir -p /tmp/oaw-shim
printf '#!/bin/sh\nprintf %%s %s\n' '{"runs":[{"status":"running"}]}' > /tmp/oaw-shim/agent-team
chmod +x /tmp/oaw-shim/agent-team

PATH=/tmp/oaw-shim:$PATH node "$CLI" doctor --json   # A8: pass
````

Для A9 нужен живой `STATE.run`: в фикстуре без `execution` выполнить
`start T1` (или положить валидный `STATE.json` с `run.active: true`), затем
добавить `"execution": "external"` в план. `doctor` в этом состоянии
предупреждает `ensemble run active; STATE.run also active (two owners)`,
`--strict` — `fail`. OAW парсит поле `active`, массив `runs[]` (по
`active`/`status`) и вложенные `run`/`result`; версию схемы не требует.

## Часть C — живой Ensemble

1. В фикстуре завести team-сессию Ensemble: панель Ensemble или первая
   фраза агента `@team …` (лид получает `agent-team`).
2. Из терминала лида: `node "$CLI" doctor --json`.
3. Из того же терминала повторить A3–A4: `start`/`verify`/`finish`/`rebase`
   → `external-run`; `STATE.json` и worktree не появились.
4. Записать в HANDOFF: версию Ensemble, строку `ensemble.active` и её
   `detail`; при отличии — точный вывод.

Ожидание для Ensemble `0.5.5`: C1 — `warn` с `detail`
`execution=external; agent-team status is not JSON` (в team-сессии) или
`… exited 1` (не в team). `pass` и `two owners` в живом прогоне
недостижимы — см. ниже; это не провал части A/B.

## Известный разрыв: у `agent-team status` нет JSON

**Что.** `agent-team status` в Ensemble `0.5.5` печатает локализованный
человеческий текст (`Team file: …`, `Mode: …`, сводку прогона) и не имеет
режима `--json`: README описывает `agent-team status` без флагов, а слой
CLI (`src/cli/agent-team.ts`) пишет только поле `text` ответа воркера —
даже если инструмент вернул `structuredContent` (`src/worker/collab.ts`,
`statusTool`), до `stdout` он не доходит. Поэтому OAW-проба
`agent-team status --json` получает текст и честно сообщает
`agent-team status is not JSON`.

**Почему это важно.** `doctor` обещает `pass` при активном Ensemble и
`warn two owners` при живом `STATE.run` (D15). Без машинного статуса оба
состояния неотличимы от «активность не подтверждена».

**Следствие.** С живым Ensemble `0.5.5` поле `ensemble.active` всегда
`warn`, а `doctor --strict` в `external` всегда exit 1. Отказы
`start/verify/finish/rebase` и сохранность `STATE.json`/worktree от этого
не страдают: они проверяются по `AUTOPLAN.md`, а не по Ensemble.

**Рекомендация.** Запросить у Ensemble машиночитаемый статус
(`agent-team status --json`: `schemaVersion`, `active`, `runs[]` с
`status` и `workspaceId`) и оставить пробу capability-gated: JSON есть —
`pass`/`two owners`, нет — `warn`. Не парсить текст (локализован, меняется
с версией) и не читать `~/.orca-ensemble/` (внутренний формат, общее
рабочее состояние как канал связи отвергнут; файлы прогонов к тому же
устаревают — прогон от 2026-11-26 остался `"status": "active"` после
рестарта Orca). `two owners` — не «не реализовано», а «ждёт машинного
статуса».

## Чистка

````bash
rm -rf "$D" /tmp/oaw-ext-acceptance-wt /tmp/oaw-shim
````

Живой прогон в Orca закрывать сразу после записи результата: team-сессия
начинает работать по brief. Worktree и ветки от детерминированной части не
создаются (кроме A9-фикстуры — удалять вместе с временным каталогом).

## Журнал 2026-11-27

| Что | Результат |
|---|---|
| A1–A5, A7 на `/tmp`-фикстуре | совпали; `status` JSON v1, `state: null`; четыре действия — `external-run`, state/worktree нет; `stop`/`resume` — `STATE.json is missing` (exit 1); `doctor` — `ensemble.active: warn`, `--strict` exit 1 |
| A6 | `stop --reason manual` на state с `run.active: true` → `stopped`, `run.active: false` |
| A8 | JSON-шим `{"runs":[{"status":"running"}]}` → `pass`, `external ensemble run active` |
| A9 | тот же шим + `run.active: true` → `warn`, `two owners`; `--strict` exit 1 |
| C1 | не выполнен: ожидается `warn` из-за отсутствия JSON-статуса (разрыв выше); живой прогон — по шагам части C |
