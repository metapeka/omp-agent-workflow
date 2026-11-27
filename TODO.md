# TODO — omp-agent-workflow

Оперативный список задач. Этапы и границы — `ROADMAP.md`; текущее
состояние — `HANDOFF.md`; контекст следующей сессии — `docs/next-session.md`.

Дата: 2026-11-27. Версия: `1.0.1`.

## Сейчас

- [x] 1.0.1 — страховка без sandbox, начата с единственной
      воспроизведённой потери данных: WIP-патч (tracked + untracked через
      временный `GIT_INDEX_FILE`) и `.status` перед `force`-удалением
      worktree упавшей задачи, сбой снимка отменяет удаление, путь — в
      `start`/error detail; `omp-orchestrate refs [--json]` (read-only
      backup-refs); `docs/recovery.md`; проверено `npm run verify` —
      396 тестов, typecheck, `check:names`; commit `0582edf`.
- [x] 1.0.1 — `refs` подсказывает гигиену: текст печатает самый старый
      backup-ref, его возраст и готовую `git update-ref -d`; порогов и
      авточистки нет — срок хранения решает владелец; commit `1d5891b`.
- [x] 1.0.1 — `docs/next-session.md` переписан под 1.0.1: состояние,
      очередь (push/tag, session JSONL, внешняя приёмка Ensemble),
      проверки, стартовый prompt.
- [ ] 1.0.1 — push и тег `v1.0.1` (по решению владельца; локально `main`
      впереди `origin/main`).
- [ ] Решение владельца: копия session JSONL перед handoff (best-effort при
      записи marker) или принять, что «до»-окно economics после
      `/handoff-new` не восстанавливается.
- [x] 1.0.0 — релиз: английский README (+RU/ZH), установка из tarball
      (`npm pack` → распаковка → `omp plugin link`), релизные заметки
      `docs/release-notes-1.0.0.md`, запись `[1.0.0]` в `CHANGELOG.md`;
      проверено: 386 тестов, Settings 15 ключей, `omp plugin doctor` ok,
      extension load exit 0, `doctor --json` exit 0, `omp-yoda --version`
      exit 0. CLI работают и из `node_modules` (`lib/ts-loader.mjs`,
      шимы `bin/`; регрессия — `test/package-run.test.mjs`).
- [x] Remote/GitHub и CI на remote: публичный `metapeka/omp-agent-workflow`,
      release `v0.5.14`, CI green (2026-11-23).
- [x] Английский README — часть 1.0; добавлены китайский и русский.
- [x] npm/marketplace — не публикуем, только `omp plugin link` (D10,
      2026-11-26). Изменение — отдельным разрешением владельца.
- [x] GitHub release/tag `v1.0.0` и push 1.0.0 — 2026-11-27, CI зелёный,
      Pages задеплоен.
- [x] Живая проверка 1.0.0: TUI (`/handoff-preflight`, `/wrap`, `YODA-SUP`,
      `⚠ HANDOFF`) и automatic handoff E2E (marker → `/handoff-new` →
      continuation, 1.2 с); CI на `npm run verify`; tarball 1.0.0 приложен
      к релизу как asset; FAQ: `AUTOPLAN.md` не runtime, economics после
      удалённого родителя.
- [ ] Опционально: полный TUI E2E `/wrap` на Orca-managed worktree
      (confirm/cancel и branch retained); core Orca и TUI confirm/cancel
      уже проверены.

## Будущее

### 0.7 — план 2026-11-27

- [x] 0.7.0 spend-aware handoff: Settings `handoffAtSpendUsd` (15-й ключ),
      env `OMP_HANDOFF_AT_USD`, `0`/`off` = выкл; триггер по фактическому
      `usage.cost.total` (инкрементальные offsets), cooldown/supervisor/
      `⚠ HANDOFF`, marker `reason: spend`; тесты, docs.
- [x] 0.7.1 quality gate: ключевые секции `HANDOFF.md` и компакция после
      обновления state — advisory-warning в preflight.
- [x] 0.7.2 `economics --summary`: агрегат цепочки (сессии, handoff'ы,
      границы, spend, медиана хода, средняя цена границы с отношением,
      тренд hit), `summary` в JSON, блок `Сводка:` в тексте; тесты, docs.
- [x] 0.7.3 discovery: `.omp-plugin/marketplace.json` (каталог
      `metapeka-omp`, версия сверяется тестом) + `docs/comparison.md`
      (EN/RU/ZH), установка из маркетплейса в README; npm-публикация — по
      разрешению владельца.
- [x] 0.7.4 ledger субагентов: `costTotals` по файлам, перезапись заменяет
      вклад (компакция не удваивает), хвост прошлой сессии на handoff,
      `status --json` → `spend`, stop `budget-spend` на `start`/`finish`;
      тесты, docs.

Не делаем: TTL-countdown без данных, warming/optimizer, `/compact` payback,
TUI-дашборды, cross-harness handoff, PR-автоматизация, уведомления.

- [x] 0.6: экономика handoff/компакции с `omp-cache-monitor` — стоимость,
      влияние на hit rate; без TTL/warming без данных провайдера.
      Вход готов: `docs/research/model-modes.md` — цены 9 моделей, замеры
      reasoning (n=3) и handoff-payload (20 сессий), цена границы, режим v1.
      Запрос API: `docs/research/cache-monitor-costs-api.md` (`costs --json`).
      **2026-11-27: запрос передан агенту cache-monitor** (Orca worktree
      `~/orca/workspaces/omp-cache-monitor/costs-json`, ветка
      `feat/costs-json`, база 0.10.1). Чек-лист:
  - [x] cache-monitor: CLI `costs --json` v1, тесты, docs — 0.11.0,
        ветка `feat/costs-json`, 104 теста, установленный `bin` проверен
        из tarball
  - [x] ревью и ff-merge в `main` cache-monitor (`5c9eeb8`); ветка
        `feat/costs-json` остаётся
  - [x] OAW: контрактный тест формы ответа + graceful skip без CLI —
        `lib/costs-client.ts`, `test/costs-client.test.mjs` (8 тестов)
  - [x] OAW: preflight показывает цену границы (медиана холодных/тёплых) и
        разрез по моделям; `lib/orchestrator/cost.ts` остаётся fallback
  - [x] OAW: `npm run verify`, HANDOFF/CHANGELOG/ROADMAP — версия 0.6.0
- [x] F1 advisory `next-session:` + launcher (0.5.19, D14): parser,
      `bin/omp-next-session`, `--model`/`--thinking` при старте, показ в
      preflight; тесты.
- [x] F2 пресеты (`routine`/`plan`/`review`/`budget`) — 0.5.22 (D16):
      `--preset`, Settings `workflowPreset`, `bin/omp-preset`, тесты.
- [x] F3 метрики preflight — 0.5.23: размер state, cache hit, reasoning
      share, spend сессии, план/gate/deps, attempts, run spend. Цена
      границы — с 0.6.0 из `costs --json` (медиана холодных/тёплых).
- [ ] F4 `--plan-yolo` — `[design]`, только после замера.
- [ ] Интеграция с Orca orchestration Runs/gates — `[future]` 0.6+.
- [ ] Параллельные задачи и multi-repo — `[future]`.
- [ ] Свои agent definitions (`implementer`/`verifier`) через `.omp/agents`.
- [ ] Метрики/status: spend и стоимость компакции; handoff-индикатор и режим
      сделаны в 0.5.12.
- [ ] Кроссплатформенная проверка live-процессов (сейчас `/proc`,
      Linux-only).

## Закрытые задачи

- [x] 0.1 — context guard 35/50, `/handoff`.
- [x] 0.2 — automatic handoff: session info, marker, supervisor, cooldown,
      stale-marker guard.
- [x] 0.3 — режимы `manual`/`assisted`/`yoda`/`yoda-supervised`,
      launcher `bin/omp-yoda`.
- [x] 0.4 — отдельный репозиторий, Orca-проект, AGENTS/ROADMAP/HANDOFF, CI;
      остался только remote.
- [x] 0.5 — orchestrator A–D: `AUTOPLAN.md`, `STATE.json`, actions, policy,
      бюджеты, stop-gates, live E2E на 3 задачи.
- [x] 0.5.1 — `/wrap`: карточки, handoff-инструкция, safe cleanup,
      следующий worktree, review; commit `de03df9`.
- [x] 0.5.2 — supervisor singleton: lock-dir `.omp-handoff-supervisor.lock/`,
      stale reclaim по мёртвому pid, release на exit/сигналах; тесты и runbook.
- [x] 0.5.3 — additive Orca: `terminal list` в `/wrap` cleanup,
      `terminal show` preflight в supervisor, `status` warning в launcher,
      `ORCA_CLI_COMMAND`; D11 (OMP first) и anti-goals.
- [x] 0.5.4 — Settings → Plugins: 9 ключей (`workflowMode`, пороги,
      cooldown, `orcaEnabled`, `orcaPreflight`, `supervisorEnabled`);
      Settings > env > режим/дефолт; launcher/supervisor учитывают флаги.
- [x] 0.5.5 — Settings этап 2: `continuePrompt`, `supervisorRetries`,
      `supervisorLogLevel`; launcher пробрасывает env, supervisor логирует
      по уровню.
- [x] 0.5.6 — `/handoff-preflight`: read-only state/git/marker проверка.
- [x] 0.5.7 — preflight hardening: repo-error, upstream compare, `[файл]`,
      timeout, нет коммитов; тесты upstream/detached/merged.
- [x] 0.5.8 — `/handoff-new` встраивает state-файл в custom message:
      64k-лимит (0.5.15: 32k), маркер обрезки, fallback при ошибке чтения; тесты и docs.
- [x] 0.5.9 — `/handoff-preflight`: интерактивный чек-лист перед таблицей,
      неотмеченные пункты, отмена; тесты и docs.
- [x] 0.5.10 — `/handoff-preflight`: меню действий «Сделать/Пропустить»,
      проверки, commit, ff-merge; падение проверок блокирует commit/merge.
- [x] 0.5.11 — preflight: проверка → вердикт → меню только незакрытых
      действий → итог; runtime-файлы игнорируются.
- [x] 0.5.12 — ключ `workflow` в статус-строке: `YODA`/`YODA-SUP`,
      `⚠ HANDOFF` по порогу/marker; `statusEnabled` (13-й ключ), stale
      marker игнорируется, `context_pct` не дублируется; тесты и docs.
- [x] 0.5.13 — P2-статус: `SUP OFF` при мёртвом/отсутствующем supervisor
      и `T2 verify` при `run.active`; тесты и docs.
- [x] 0.5.14 — безопасный cleanup worktree: guard merged/clean/current/live,
      без `--delete-branch`/`--force`/`-D`, ветка остаётся, tip в backup-ref;
      retry failed-задачи: `force`+`requireMerged:false`, старая ветка
      переименовывается; тесты и docs.
- [x] 0.5.15 — handoff guards: state 32k символов (≈10–15k токенов), warning
      без supervisor/terminal handle, повтор запроса без marker через 2 хода
      (максимум 3); README/AGENTS про относительные проценты; тесты и docs.
- [x] 0.5.16 — session info как карта по pid: одноразовый запуск не затирает
      handle живой сессии, dead prune, lock + atomic rename, supervisor
      выбирает по `marker.sessionFile`; тесты и docs/contracts.
- [x] 0.5.17 — fallback-компакция после исчерпания handoff-повторов или при
      marker без живого supervisor; рекомендация для 1M — compact 40. Тесты.
- [x] 0.5.18 — `workflowMode: off`: плагин молчит, OMP на дефолтах; env `off`
      побеждает Settings; launcher делает exec omp без supervisor. Тесты и
      docs (contracts, README EN/RU/ZH, yoda-workflow).
- [x] 0.5.19 — advisory `next-session:`: fail-closed парсер, каталог моделей,
      launcher `--model`/`--thinking` при старте (явные флаги выигрывают),
      показ в preflight, D14; 31 новый тест.
- [x] 0.5.20 — CLI JSON v1 и `doctor`: `schemaVersion: 1` в `status`/`doctor`,
      16 read-only проверок (проба ≤ 2 с, без сети), `--strict`, PATH-шимы
      для `omp`/`orca`/`agent-team`; docs/contracts и гид по командам.
      Joint plan Ф0+Ф1 закрыты; Ф2 — в 0.5.21.
- [x] 0.5.21 — `execution: omp|external` (D15): default `omp`, hash старых
      планов не меняется; `external` → stop `external-run` в
      `start/verify/finish/rebase` без state/worktree; `doctor` warn, если
      external без активного Ensemble; тесты и docs/contracts.
- [x] Joint plan Ф4 — `test/contracts.test.mjs`: конверт и стабильные поля
      `status --json` (с `STATE.json` и без), игнор неизвестных полей плана,
      конверт/форма `doctor --json`; README-счётчики заменены на `200+`.
- [x] 0.5.22 — пресеты `routine/plan/review/budget` (D16): `lib/presets.ts`,
      `bin/omp-preset`, Settings `workflowPreset` (14-й ключ), `--preset`
      важнее Settings и отменяет advisory; модель только по каталогу;
      `autoCompactPercent=40` в Settings владельца; тесты и docs.
- [x] 0.5.23 — F3 метрики preflight: `lib/session-metrics.ts` (чанковый
      разбор root session JSONL, `message.assistant.usage`), размер state
      против 32k, cache hit/reasoning/spend, план с gate/deps, attempts,
      run spend; цена границы отложена до `costs --json`; тесты и docs.
- [x] 0.5.24 — flight recorder в запросе HANDOFF: `workingTreeSnapshot()`
      (ветка, HEAD, до 6 путей, runtime-файлы исключены, бюджет 300
      символов), снимок только в тексте запроса; тесты и docs
      (`guards.md`, handoff-flow, FAQ, contracts, README EN/RU/ZH).
- [x] 0.5.25 — вывод `/handoff-preflight`: таблица `GROUP  ST  DETAIL` с
      расчётной шириной и переносом; fallback-группы с иконками уже 70
      колонок; глифы `theme.symbol` (`✔ ⦸ ✘`, ascii `[+]`), unicode-фолбэк;
      тесты на оба режима и ascii, docs (`commands.md`, FAQ, вики).
- [x] 0.5.26 — действие `push` в меню preflight: только при upstream и
      незапушенных коммитах, `git push` без `--force`, отказ remote не
      форсится, skip после упавших проверок/commit; тесты и docs.
- [x] Reviewer `WrapSafetyReview`: subdir-процессы, Orca ENOENT fallback,
      handoff cwd, state/lock cwd, plan hash/planError; commit `ca93956`.
- [x] TUI E2E `/wrap`: confirm/cancel, Yes удаляет, No/Esc оставляет;
      real Orca backend cleanup temp worktree прошёл.
- [x] Tarball `0.5.1`: `npm pack` + install в temp; `docs/wrap.md` и
      `lib/orchestrator/wrap.ts` в пакете; загрузка extension exit 0;
      `/wrap` открылся из установленного пакета.
- [x] Задача `/wrap` в worktree `wrap-wizard` закрыта 2026-11-23:
      merge, TUI/Orca E2E, tarball, docs; worktree удалить после выхода.
- [x] Документы: `docs/wrap.md`, README, runbook, `docs/next-session.md`
      под 0.5.1; commits `ae1bde2`, `ff83e67`.
