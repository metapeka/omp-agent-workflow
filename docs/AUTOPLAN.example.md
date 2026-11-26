# AUTOPLAN — пример

Шаблон для orchestrator 0.5. Скопировать в `AUTOPLAN.md` в control
worktree и заменить значения. Парсер читает только fenced JSON-блоки с
info string `json plan` и `json task`; проза игнорируется.

Правила:

- `id` уникален; `deps` ссылаются на существующие `id`;
- `branch` не может быть `main` и не должен существовать;
- `acceptance` — проверяемые утверждения, не «сделать хорошо»;
- `gate` останавливает run до задачи и требует человека;
- `execution` необязателен: `omp` (default) ведёт задачи в OAW,
  `external` — в Ensemble; OAW тогда отказывает `start/verify/finish/rebase`;
- `verify` задачи переопределяет `plan.verify`;
- hash считается по JSON, поэтому правка комментариев безопасна.

````markdown
# AUTOPLAN — <название>

Цель: <одно предложение>.
Non-goals: <что не делаем>.

```json plan
{
  "version": 1,
  "goal": "<цель run>",
  "baseBranch": "main",
  "baseRepo": null,
  "worktreeRoot": "~/orca/workspaces/<project>",
  "backend": "orca",
  "execution": "omp",
  "verify": ["npm test", "npm run typecheck"],
  "budgets": {
    "maxTasksPerSession": 3,
    "maxSpendUsd": 5,
    "maxMinutes": 120
  }
}
```

## T1 — <короткое имя>

<Зачем задача и что считается готовым.>

```json task
{
  "id": "T1",
  "title": "<короткое имя>",
  "deps": [],
  "branch": "feat/t1-example",
  "files": ["path/to/file.ts"],
  "acceptance": [
    "<проверяемое утверждение>",
    "<второе утверждение>"
  ],
  "verify": ["npm test"],
  "review": true,
  "gate": null
}
```

## T2 — <короткое имя>

```json task
{
  "id": "T2",
  "title": "<короткое имя>",
  "deps": ["T1"],
  "branch": "feat/t2-example",
  "files": ["path/to/other.ts"],
  "acceptance": ["<проверяемое утверждение>"],
  "verify": ["npm test", "npm run typecheck"],
  "review": true,
  "gate": null
}
```

## T3 — публикация

```json task
{
  "id": "T3",
  "title": "Публикация",
  "deps": ["T2"],
  "branch": "feat/t3-publish",
  "files": [],
  "acceptance": ["решение владельца записано"],
  "verify": [],
  "review": false,
  "gate": "publish"
}
```
````

## Значения `gate`

| Значение | Что требует |
|---|---|
| `null` | Автоматически |
| `publish` | Решение о npm/marketplace/visibility |
| `contract` | Изменение контракта 0.3 |
| `data` | Удаление/миграция данных |
| `human` | Любое продуктовое решение |

Задача с gate не стартует: `STATE.stop.reason = "gate"`. После решения
владельца gate убирается из плана (новый hash) и выполняется `resume`.

## Как проверить план до запуска

```bash
bin/omp-orchestrate status --json
bin/omp-orchestrate next --json
```

`status` показывает hash, ready task и бюджет; `next` не мутирует state.
