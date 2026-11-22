# Next session: orchestrator

Это контекст для новой OMP-сессии в отдельном проекте `omp-agent-workflow`.
Проект больше не часть `omp-cache-monitor`.

## Состояние

- Репозиторий: `/home/db1/projects/omp-agent-workflow`, ветка `main`.
- Версия `0.3.0`; коммиты оформления проекта — `9e63ca1`, `0ba82e7`.
- Готово: context guard (35/50), `/handoff`, `/handoff-new`, automatic
  handoff, supervisor, cooldown/stale-marker guard, режимы
  `manual`/`assisted`/`yoda`/`yoda-supervised`, launcher `bin/omp-yoda`.
- Проверки: `npm test` 19/19, `npm run typecheck`, загрузка extension в OMP,
  e2e supervisor в Orca.
- Проект зарегистрирован в Orca; рабочие worktree —
  `~/orca/workspaces/omp-agent-workflow/<slug>`.
- `omp plugin link` указывает на `main`; изменения в worktree не влияют на
  живую сессию до merge.

## Следующий этап

`ROADMAP.md`, этап 0.5 — orchestrator и subagent-петля:

1. Прочитать `AGENTS.md`, `HANDOFF.md`, `ROADMAP.md`, `README.md`,
   `docs/yoda-workflow.md`, `docs/handoff-auto-plan.md`.
2. Составить план: `AUTOPLAN.md`, `STATE.json`, выбор задачи, worktree на
   задачу, implementer/verifier/reviewer, handoff на границе задачи,
   stop-gates и бюджеты.
3. Сначала показать план и открытые вопросы; не менять контракт 0.3 и не
   начинать код без подтверждения.

## Границы

- Не выходить за пределы проекта: cache-monitor только read-only.
- Не публиковать npm/marketplace, не менять видимость, не добавлять remote
  без решения владельца.
- Один агент — один worktree; коммит через `commit` namespace.
- Handoff сохраняет решения, проверки и следующие шаги, а не сырые логи.

## Проверки перед merge

```bash
npm test
npm run typecheck
omp --no-extensions -e ./index.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'
```

## Стартовый prompt

> Ты продолжаешь `omp-agent-workflow` в отдельном проекте. Прочитай
> `AGENTS.md`, `HANDOFF.md`, `ROADMAP.md`, `docs/next-session.md`.
> Текущая версия 0.3.0: context guard, handoff и режимы готовы. Следующий
> этап — orchestrator и subagent-петля (ROADMAP 0.5). Сначала составь
> конкретный план и список вопросов, код не меняй до подтверждения. Не
> трогай контракт 0.3, cache-monitor и публикацию.
