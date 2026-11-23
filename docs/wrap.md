# Wrap: завершение работы `/wrap`

Статус: `[готово]`, версия `0.5.1`; проверка live-терминалов Orca — `0.5.3`.
Команда main TUI; контракт 0.3 (`docs/contracts.md`) не меняет.

`/wrap` — guided wizard, а не автомат. Он собирает факты, показывает карточки
и выполняет действие только после явного подтверждения. Никаких решений
«какие ветки сносить» без человека.

## Что читает

| Источник | Что берётся |
|---|---|
| git | toplevel, branch, HEAD, status, base repo, `worktree list --porcelain -z`, remote |
| `STATE.json` | run/current/stop/completed; ищется в `ctx.cwd`, затем в base repo |
| `AUTOPLAN.md` | `worktreeRoot`, `backend`, `baseBranch`; путь из `STATE.plan.path` или base |
| `HANDOFF.md` | наличие, dirty, устаревание по commit, а не по mtime |
| `orca terminal list --json` | live-терминалы worktree (`connected`, не `orphaned`), 0.5.3 |
| `/proc` | pid-ы процессов с cwd внутри worktree (best-effort, Linux; fallback) |

Если state или плана нет — `/wrap` работает с git-фактами, а plan-карточки
показывает как недоступные.

## Карточки

| Карточка | Действие | Подтверждение |
|---|---|---|
| Завершить сессию (handoff) | проверить `HANDOFF.md` и сказать выполнить `/handoff-new` | нет, сессия не переключается |
| Обновить `HANDOFF.md` | отправить агенту промпт обновить state | да, это spend |
| Удалить завершённые worktree | удалить merged+clean worktree и локальную ветку | да, с точным path/branch/HEAD |
| Создать worktree для следующей задачи | `input` slug → `feat/<slug>` от base | да |
| Ретро-review текущей ветки | отправить reviewer промпт на `base...branch` | да, это spend |
| Publish / remote | не автоматизируется | — |
| Выйти | ничего не менять | — |

Меню циклическое: после cleanup/create факты пересобираются. `Esc`/отмена
`select` выходит; `confirm=false` возвращает в меню.

## Safety

Удаление worktree разрешено только при всех условиях:

1. Запись взята из `git worktree list --porcelain -z`, не из строки пользователя.
2. Это не base repo и не текущий worktree.
3. Ветка не `main`/base; не detached; worktree не bare/locked/prunable.
4. `git merge-base --is-ancestor <HEAD> <base>` → merged.
5. `git status --porcelain` в worktree пуст (включая untracked).
6. Нет live-процесса с cwd внутри worktree и нет live-терминала Orca
   (`orca terminal list --json`: `connected` и не `orphaned`). `/proc` —
   fallback, если Orca недоступен. Orca-created worktree обычно держит
   shell-терминал; закрой его, иначе cleanup будет заблокирован
   (это защита, а не ошибка).
7. Путь внутри `plan.worktreeRoot`, если план есть.
8. Непосредственно перед удалением предусловия проверяются снова под
   `.omp-orchestrator.lock`; HEAD не должен измениться.
9. Удаление без `--force`: `orca worktree rm ... --json` (без
   `--delete-branch`) или `git worktree remove`; `--delete-branch` не
   передаётся. Ветка по умолчанию остаётся, tip сохраняется в
   `refs/omp-worktree-backup/*`; явное удаление — только `git branch -d`
   после merged-проверки (никогда `-D`).
10. Orca при удалении останавливает PTY удаляемого worktree (SIGTERM).
    Поэтому cleanup — только снаружи: текущая сессия внутри target не должна
    дожидаться этой команды.
11. Если `AUTOPLAN.md` не читается или его hash не совпадает с
    `STATE.plan.hash`, cleanup и создание worktree отключены: нельзя
    доверять `worktreeRoot`.
12. Текущий worktree из-под работающего OMP не удаляется: карточка только
    объясняет, что выйти и удалить нужно вручную.

Создание следующего worktree:

- slug `^[a-z0-9][a-z0-9-]{0,40}$`, ветка `feat/<slug>`;
- отказ при существующей ветке или пути;
- state не меняется, текущая сессия не переключается.

Handoff:

- `HANDOFF.md` проверяется в `ctx.cwd` — именно его читает `/handoff-new`;
- dirty и «возможно устарел» показываются предупреждением, но не блокируют;
- `/wrap` не пишет `.omp-handoff-request.json` и не вызывает `newSession`;
- после обновления `HANDOFF.md` пользователь выполняет `/handoff-new`.

Publish/push не выполняются: это решение владельца (D10).

## Runbook

```text
/wrap
  → карточка-сводка
  → Обновить HANDOFF.md (confirm)
  → Завершить сессию (handoff) → выполнить /handoff-new
```

Очистка завершённых задач:

```text
/wrap
  → Удалить завершённые worktree
  → выбрать path из списка merged+clean
  → confirm с path/branch/HEAD
```

Если карточка cleanup недоступна, причина в описании: ветка не merged,
worktree грязный, есть live-процесс, путь вне `worktreeRoot` или это текущий
worktree.

## Ограничения

- `/wrap` не мержит, не делает `finish`, не снимает `stop`, не меняет
  `STATE.json`.
- Не удаляет текущий worktree и не запускает helper-процесс после выхода.
- Не гарантирует отсутствие гонки с внешним `git`/Orca; поэтому lock и
  повторная проверка, а не «доверяем фактам».
- Orca CLI может сохранить ветку, которую не может доказать merged; это
  нормальный safe-результат, не ошибка. Ветка по умолчанию остаётся; tip
  ветки сохранён в `refs/omp-worktree-backup/*`.
- Тесты используют git backend и явный список Orca-терминалов; живой Orca
  нужен только для TUI-проверки.
