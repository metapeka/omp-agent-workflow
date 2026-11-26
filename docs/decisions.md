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

## D11. OMP first, Orca — additive integration

**Статус:** accepted (2026-11-23).
**Решение:** продукт — OMP-расширение; Orca используется только как
опциональная среда: `terminal show/send/list`, `worktree list/create/rm`,
`status`. OMP обязан работать без Orca: `manual`/`assisted`, git backend,
`/proc` fallback.
**Причина:** контракт 0.3 не зависит от Orca API; тесты и CI идут без Orca;
изменения Orca не должны ломать handoff.
**Следствие:** любой Orca-вызов — best-effort с fallback; Orca runtime не
может быть обязательным для запуска или работы.

Не делать без нового решения:

- Orca Runs/gates/workers вместо OMP orchestrator (D1);
- Orca agent sessions вместо marker/session 0.3;
- обязательный `orca` при старте `bin/omp-yoda` или `/handoff`;
- параллельные задачи/multi-repo (D8).

## D12. Settings — источник истины, env — fallback

**Статус:** accepted (2026-11-23).
**Решение:** пользовательские настройки живут в `package.json#omp.settings`
(Settings → Plugins). Приоритет: **Settings > env > режим/дефолт**.
Extension читает их на `session_start`; launcher — при старте и передаёт
supervisor'у `OMP_ORCA_*`/`OMP_SUPERVISOR_ENABLED`. Отсутствие OMP-рантайма
(unit-тесты, чужой запуск) откатывается на env.
**Причина:** UI должен быть основным способом настройки; env нужен для
CI/скриптов и обратной совместимости.
**Следствие:** новый ключ добавляется в manifest, `workflow-settings.ts`,
launcher/supervisor (если процесс отдельный), тесты и docs. `0`/`off`
означает выключение для порогов.

## D13. Cleanup worktree — безопасный по умолчанию, ветка остаётся

**Статус:** accepted (2026-11-23).
**Причина:** `orca worktree rm` останавливает PTY удаляемого worktree и
присылает SIGTERM; при cleanup изнутри worktree живая OMP-сессия умирает
(инцидент 2026-11-23). Старый `removeWorktree` дополнительно делал
`--delete-branch --force` и безусловный `git branch -D`.
**Решение:** `removeWorktree` требует merged (`merge-base --is-ancestor`),
чистый worktree, target не base и не текущий cwd, отсутствие процессов с cwd
внутри и живых терминалов Orca; не передаёт `--delete-branch`/`--force` без
явного запроса. Tip ветки сохраняется в `refs/omp-worktree-backup/*`; ветка
по умолчанию остаётся, явное удаление — только `git branch -d` после
merged-проверки. Retry failed-задачи — `force` + `requireMerged: false`:
старая ветка переименовывается в `<branch>-failed-<timestamp>`, новый
attempt стартует с чистой ветки; коммиты не теряются. Orca-путь удаляет и
metadata; git-fallback оставляет stale-запись, которую убирает последующий
`orca worktree rm`.
**Следствие:** docs/AGENTS больше не советуют сырой `--delete-branch`;
cleanup выполняется снаружи удаляемого worktree.

## D14. Advisory `next-session:` вместо смены модели в процессе

**Статус:** accepted (2026-11-25).
**Решение:** рекомендация следующей сессии — одна опциональная строка
`next-session: v=1 ts=… model=… thinking=… mode=… reason=…` первой строкой
`HANDOFF.md`. `bin/omp-yoda` читает её и добавляет `--model`/`--thinking`
при запуске процесса; явные флаги пользователя выигрывают. Модель
проверяется по `omp models --json`, `thinking` вне каталога модели
нормализуется в `auto`. `/handoff-preflight` показывает строку и её
валидность, но ничего не переключает. Extension строку не пишет и модель
не меняет.
**Причина:** OMP не даёт сменить модель из event-handler, а `/handoff-new`
создаёт сессию в том же процессе; сведения о следующем шаге должны
переживать handoff, но не превращаться в скрытое автопереключение. Разбор
fail-closed: две строки, `v≠1`, `ts` старше 24 ч, повтор ключа или неверная
позиция — рекомендации нет целиком.
**Следствие:** формат аддитивен и опционален. Settings-ключ
`workflowPreset` и статус-строка не меняются (ответы на открытые вопросы
F1); F2-пресеты `routine`/`plan`/`review`/`budget` остаются отдельным
решением.

## D15. `execution: omp|external` — явный владелец задач

**Статус:** accepted (2026-11-26).
**Решение:** в `plan`-блоке `AUTOPLAN.md` появляется необязательное поле
`execution: "omp" | "external"`. Нет поля — `omp` (поведение прежнее, hash
плана не меняется). `external` означает, что задачи ведёт Ensemble
(`agent-team`, Orca-плагин); OAW в этом плане отказывает
`start`/`verify`/`finish`/`rebase` со stop-reason `external-run` и не
создаёт/не меняет `STATE.json` и worktree. `status`, `next`, `doctor` и
handoff работают; `stop`/`resume` задачи не запускают. Неизвестное значение
— `PlanError`. `doctor`: `external` без активного Ensemble — `warn`
(включая недоступный `agent-team`), активный Ensemble при `external` —
`pass`, активный Ensemble вместе с `STATE.run.active` — `warn two owners`.
**Причина:** два оркестратора на одном плане/worktree дают гонки и потерю
коммитов. Поле делает владельца явным и переживает смену сессии; OAW
остаётся работоспособным без Orca (D11), а `external` — единственный режим,
где Orca обязательна, потому что Ensemble существует только как её плагин.
**Следствие:** формат аддитивен; старый план без поля совместим по hash.
Автоблокировки по факту живого Ensemble нет — только предупреждения
`doctor`; меню выбора режима старта остаётся в личном hub/промте, не в
продукте.

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
