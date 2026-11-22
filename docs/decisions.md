# Решения (ADR log)

Дата: 2026-11-22. Статус: подтверждено владельцем.
Формат: решение → причина → следствие. Меняем только новым решением с датой.

## D1. OMP-native оркестрация

**Статус:** accepted.
**Решение:** orchestrator — main-агент OMP + `task` subagents; worktree через
`orca worktree`; не используем `orca orchestration` Runs/workers и не
запускаем headless `omp -p` на задачу.
**Причина:** продукт — OMP-расширение; меньше связности с независимо
меняющимся Orca API; проще тестировать без сети.
**Следствие:** main не может задать subagent `cwd`; изоляция через
абсолютные пути и проверки. Orca orchestration — `[future]` 0.6+.

## D2. `AUTOPLAN.md` с JSON-блоками

**Статус:** accepted.
**Решение:** один Markdown-файл; `plan` и `task` — fenced JSON-блоки.
**Причина:** без YAML-зависимости и без парсинга прозы; правка прозы не
ломает hash.
**Следствие:** строгая валидация, `planHash`, stop `plan-changed`.

## D3. Автономность только после `/orchestrate`

**Статус:** accepted.
**Решение:** auto-continue только в `yoda`/`yoda-supervised` и только после
явного `/orchestrate`. В `manual`/`assisted` — никогда.
**Причина:** наличие `AUTOPLAN.md` не должно запускать траты и merge
неожиданно.
**Следствие:** `run.active` в `STATE.json`; `session_start` без флага не
спавнит ничего.

## D4. Marker на границе пишет агент

**Статус:** accepted.
**Решение:** policy сообщает `handoffRequired`; агент обновляет `HANDOFF.md`
и пишет marker `{reason:"task-boundary", sessionFile}`.
**Причина:** supervisor может сменить сессию до обновления `HANDOFF.md`;
существующий протокол 0.3 не меняется.
**Следствие:** машинный state уже на диске; worst case — устаревший
человеческий summary.

## D5. Бюджеты

**Статус:** accepted.
**Решение:** `maxTasksPerSession` → handoff в supervised, stop в `yoda`;
`maxSpendUsd`/`maxMinutes` → stop; spend run-глобальный по JSONL
(root + subagents), native `--max-cost` — backstop.
**Причина:** handoff даёт чистую сессию; деньги/время — жёсткие границы.
**Следствие:** `costOffsets` в state; `cost-unavailable` — stop, не тихое
отключение лимита.

## D6. Merge и review

**Статус:** accepted.
**Решение:** только `git merge --ff-only` в чистый base; HEAD должен
совпадать с `--commit`; reviewer обязателен по умолчанию (`review: true`);
non-ff → `rebase` + повторный verify; конфликт → stop, worktree сохранить.
**Причина:** `main` — известное хорошее состояние; squash/auto-rebase
скрывают историю и проверки.
**Следствие:** грязный base — `stop: base-dirty`; менять политику только
новым решением.

## D7. `STATE.json` не коммитится

**Статус:** accepted.
**Решение:** runtime-файл в control worktree, gitignored, один writer,
один run; `HANDOFF.md` коммитится.
**Причина:** state меняется каждый task, в git был бы шум; человеческое
состояние — `HANDOFF.md`.
**Следствие:** потеря state → `state-missing`, без replay задач.

## D8. Scope 0.5

**Статус:** accepted.
**Решение:** один репозиторий, одна задача одновременно, без параллельных
workers и multi-repo.
**Причина:** сначала доказать петлю на N задачах; параллельность усложняет
merge, бюджеты и handoff.
**Следствие:** `current` — единственный; параллель — `[future]`.

## D9. Версия и упаковка

**Статус:** accepted.
**Решение:** `0.5.0`; новый entry `orchestrator.ts`; `index.ts` не
меняется; `package.json` `files += "lib"`.
**Причина:** изоляция 0.3-контракта и тестов.
**Следствие:** spike загрузки второго entry перед этапом C; fallback —
импорт ядра из `index.ts` (требует отдельного решения).

## D10. Границы продукта

**Статус:** accepted.
**Решение:** не менять контракт 0.3, supervisor, `index.ts`; не трогать
`omp-cache-monitor`; не публиковать npm/marketplace, не добавлять remote и
не менять видимость без решения владельца.
**Причина:** стабильность работающего handoff и границы ответственности.
**Следствие:** новые функции — additive; любое изменение схемы — отдельное
решение и тест на старый файл.

## Отклонённые альтернативы

| Альтернатива | Почему нет |
|---|---|
| `task: isolated` для implementer | OMP сам применяет изменения в base до verify/review |
| Headless `omp -p` на задачу | Нет task UI и простого сбора результата; больше движущихся частей |
| Orca orchestration Runs/workers | Дублирует продукт, привязывает к Orca API; вернуться при необходимости |
| YAML frontmatter в `AUTOPLAN.md` | Нужен парсер/зависимость; JSON-блоки строже |
| Tool сразу пишет marker | Может сменить сессию до обновления `HANDOFF.md` |
| Squash/auto-rebase в `finish` | Скрывает историю и требует повторного verify без явного шага |
| Коммитить `STATE.json` | Шум и конфликты; state — runtime |
| Параллельные задачи в 0.5 | Merge/бюджеты/handoff становятся недетерминированными |

## Открытые вопросы `[future]`

- Интеграция с `orca orchestration` (Runs, gates, workers) — 0.6+.
- Параллельные задачи и multi-repo.
- Поставка собственных agent definitions (`implementer`/`verifier`) через
  `.omp/agents`.
- Remote/GitHub, CI на remote, npm/marketplace — только по решению
  владельца.
- Экономика handoff/компакции совместно с `omp-cache-monitor` (P2).
