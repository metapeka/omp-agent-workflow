# Рынок: context guard, handoff и оркестрация worktree

[English](market-landscape.md) · **Русский** · [简体中文](market-landscape.zh-CN.md)

Дата: 2026-11-23. Область: публичные экосистемы PI, OMP и GitHub. Вопрос:
есть ли продукт с тем же набором функций, что у `omp-agent-workflow`?

## Коротко

- **Прямого аналога** не нашлось ни в одной из трёх экосистем.
- Отдельные половины переполнены: guard/handoff и мультиагентная
  оркестрация реализованы многократно, но почти никогда вместе.
- OMP уже содержит `/handoff`, авто-компакцию, `--max-cost` и
  `omp worktree add|list|clear` **как builtin**. Наш плагин не регистрирует
  `/handoff`, а строит поверх него `/handoff-new`, `/handoff-preflight` и
  supervisor.
- Ни один найденный проект не совмещает: supervisor вне процесса агента,
  детерминированную машину план/state с бюджетами и stop-gates, а также
  guard очистки worktree с backup-ref.
- Уникальны в этом обзоре: лестница режимов (`manual` → `assisted` →
  `yoda` → `yoda-supervised`), ключ статуса, привязанный к режиму, и
  безопасный GC в стиле `/wrap`.

Обозначения функций в таблицах:

| Код | Возможность |
|---|---|
| F1 | Context guard: пороги, политика warning/компакции |
| F2 | Handoff: state-документ, продолжение в **новой** сессии |
| F3 | Режимы workflow / политика надзора |
| F4 | Мультиагентная оркестрация: план, роли, gates |
| F5 | Жизненный цикл worktree: создание, изоляция, merge, очистка |
| F6 | Учёт стоимости/бюджетов со stop-gates |
| F7 | Статус-строка и поверхность настроек |

## Метод и ограничения

Три независимых read-only прохода (каталог PI, маркетплейсы и экосистема
плагинов OMP, поиск по GitHub среди агентских harnesses), затем точечная
сверка по реестрам пакетов, GitHub API, исходникам OMP
(`can1357/oh-my-pi`, `main` на 2026-11-23, релиз `v19.1.1`) и локальному
бинарнику OMP 19.1.1.

Ограничения:

- Цифры для пакетов PI — **месячные скачивания npm** с pi.dev, а не число
  установок расширения.
- `omp.sh/docs/*` во время исследования отдавали таймаут; поведение OMP
  подтверждено по документации репозитория, исходникам и локальному
  бинарнику.
- Звёзды, лицензии и активность — на 2026-11-23. Значения, которые не
  удалось подтвердить первоисточником, помечены `[UNVERIFIED]`.
- Это сравнение возможностей по публичной документации и исходникам.
  Бенчмарки не запускались.

## Экосистема PI

`pi.dev/packages` содержит около **5 344 npm-пакетов** (2026-11-23). Сам PI —
`@earendil-works/pi-coding-agent` (последний 1.6.0, 2026-11-20; MIT;
локально установлен 1.5.2).

Встроенное в PI, что относится к продукту:

- авто-компакция при превышении `contextWindow - reserveTokens` (резерв по
  умолчанию 16 384 токена), `/compact [instructions]`, переопределения по
  модели;
- сохранённое дерево сессий JSONL с `--continue`, `--resume`, `/new`,
  `/fork`, `/clone`, `/tree`, `/export`;
- футер с расходом контекста и стоимостью сессии;
- **нет** subagents и plan mode by design, нет жизненного цикла worktree.

| Проект | Тип | Тяга (2026-11-23) | Пересечение | Чего нет против нас |
|---|---|---|---|---|
| [@woksin/pi-context-budget](https://github.com/woksin/pi-context-budget) | расширение + CLI | 3.1K/мес, 0★, v0.13.0 | F1, F2, F7 | F3–F6 |
| [pi-handoff-chain](https://github.com/martintsan/pi-handoff-chain) | расширение | 52/мес, v1.2.0 | F1, F2 | F3–F6 |
| [pi-posthorse](https://github.com/fitchmultz/pi-posthorse) | расширение | 9.3K/мес, 289★, v0.10.39 | F1 (rollover без summary) | F2 в новой сессии, F3–F6 |
| [pi-cowboy](https://github.com/electric-dragon-80000v/pi-cowboy) | расширение | 5.1K/мес, 67★, v0.39.0 | F4, F5 | F1–F3, F6; очистка удаляет ветку |
| [pi-spine](https://github.com/beettlle/pi-spine) | расширение + CLI | 2.3K/мес, 3★, v2.33.1 | F4, F5 | F1–F3, F6 |
| [@quintinshaw/pi-dynamic-workflows](https://github.com/QuintinShaw/pi-dynamic-workflows) | расширение + SDK | 82.5K/мес, 595★, v3.15.3 | F4 | F1–F3, F5, F6 |
| [pi-orchestrator-config](https://github.com/myk-org/pi-config) | расширение + агенты | 11.3K/мес, 9★, v5.0.0 | F3, F4, F5 | F1, F2, F6 |
| [@sassywares/pi-extensions](https://github.com/sassywares/sassy-pi-extensions) | набор расширений | 2.8K/мес, v0.4.4 | F2, F4 | F1, F3, F5, F6 |
| [pi-sessions](https://github.com/thurstonsand/pi-sessions) | расширение | 5.2K/мес, 16★, v0.24.0 | F2, F7 | F1, F3–F6 |
| [@adlc/context-handoff](https://github.com/voodootikigod/adlc) | CLI + hooks | 13.3K/мес, v1.13.0 | F1, F2 | F3–F6; PI-гейт выключен по умолчанию |

Ближайшие совпадения в PI: `@woksin/pi-context-budget` (guard + handoff +
продолжение), `pi-handoff-chain` (watermark → reset → новая сессия с
`HANDOFF.md`) и, по оркестрации, `@quintinshaw/pi-dynamic-workflows`.
Ни один не соединяет обе половины; ни у одного нет supervisor и guard
очистки.

## Экосистема OMP

**Центрального реестра плагинов нет.** Marketplace — любой git-репозиторий
(или локальный каталог, или прямой JSON URL) с
`.omp-plugin/marketplace.json`; `.claude-plugin/marketplace.json` из Claude
Code принимается как fallback. Установка — `omp plugin marketplace add
<source>` плюс `omp plugin install <plugin>`, либо
`omp install npm:<package>`. Найдено около 30 публичных каталогов
(`anthropics/claude-plugins-official`, производные `oh-my-pi`, сообщества
вроде `sethforprivacy/omp-plugins`, `AppVerk/av-marketplace`,
`kodlian/omp-jeremy`, `btspoony/mstar-harness`, …).

Встроенное в OMP 19.1.1 (проверено по `can1357/oh-my-pi` и локальному
бинарнику):

- `/handoff [focus]` — **builtin**-команда, реализованная как режим
  компакции (`builtin-lifecycle.ts`); `handoff` входит в
  `compaction.methodOrder` по умолчанию (`remote, snapcompact, handoff,
  shake, soft`); триггер по умолчанию reserve-based (≈85% для больших
  окон).
- `/compact`, автоматическая компакция, provider-native и image-based
  стратегии.
- `--warn-cost` и `--max-cost` (exit code 3 в print mode).
- Subagents (`task`, Agent Hub), сессии с `--resume`/`--restore`,
  `omp worktree add|list|clear` (`clear --all` сносит и живые записи).
- **Нет** handoff в новую сессию, режимов workflow, план/state-файла с
  бюджетами, guard очистки.

| Проект | Тип | Тяга (2026-11-23) | Пересечение | Чего нет против нас |
|---|---|---|---|---|
| OMP builtin | builtin | v19.1.1, MIT | F1, F2 (в сессии), F4, F5 (без guard), F6 (cost cap), F7 | F2 в новой сессии, F3, F5 guard, бюджет плана |
| [context-relay](https://github.com/Ship-With-AI/context-relay) | hooks + расширение | 0★, 2026-10-26 | F1, F2 | F3–F6 |
| [omp-self-compact](https://github.com/priaculun/omp-self-compact) | плагин | 0★, 2026-10-11 | F1, F7 | F2–F6 |
| [continuity](https://github.com/thewolff/jo-wolff-plugins) | плагин | 1★, 2026-11-20 | F1, F2 | F3–F6 |
| [strategium](https://github.com/frandev94/strategium) | плагин | 0★, v0.2.51 | F3, F4, F6, F7 | F1, F2, F5 guard |
| [mstar-harness](https://github.com/btspoony/mstar-harness) | плагин + CLI | 73★, 2026-11-23 | F3, F4, F5, F7 | F1, F2; бюджеты advisory |
| [omp-jeremy](https://github.com/kodlian/omp-jeremy) | 4 плагина | orchestrator v0.6.1 | F4, F5 | F1–F3, F6 |
| [omp-fabric](https://github.com/tickernelz/omp-fabric) | плагин | 17★, 2026-11-23 | F4, F6 | F1–F3, F5 |
| [omp-compact](https://github.com/arksdev/omp-compact) | плагин | 16★, v2.5.4 | нет — только отображение | всё; коллизия имён с контекстной компакцией |
| [orca-omp-agent-panel](https://github.com/Tautcius/orca-omp-agent-panel) | расширение + панель Orca | 0★ | F7 (read-only UI) | остальное |

Ближайшие совпадения в OMP: `context-relay` (автоматический handoff около
60% с `HANDOFF.md` и перезапуском, но на уровне hooks) и `strategium`
(оркестратор, агенты, gates, cost debrief, но без context guard и
межсессионного handoff). `omp-self-compact` — единственный профильный peer
по guard.

## GitHub: соседние harnesses

Поиск вёлся по экосистемам Claude Code, Codex, OpenCode, Cline, Gemini CLI,
Aider и Amp через GitHub search и первоисточники.

| Проект | Тип | Тяга (2026-11-23) | Пересечение | Чего нет против нас |
|---|---|---|---|---|
| [pf-handoff](https://github.com/turvodnik/pf-handoff) | hook kit (Claude Code + Codex) | 6★, 2026-10-27 | F1 (40/60/75%), F2 (in-place), F7 | F2 в новой сессии, F3–F6 |
| [claude-auto-handoff](https://github.com/alexknowshtml/claude-auto-handoff) | hooks | 128★, v0.8.6 | F1, F2 в новой сессии | F3–F6 |
| [Continuous-Claude-v3](https://github.com/parcadei/Continuous-Claude-v3) | hooks, skills, память | 3 950★, 2026-11-16 | F1 (частично), F2, F4 (частично) | F5, F6; тяжёлые предпосылки |
| [claw-orchestrator](https://github.com/Enderfga/claw-orchestrator) | отдельный runtime | 617★, v7.22 | F4, F5 (частично), F6, F2 (частично) | F1, F3, F5 guard |
| [pi-toolkit](https://github.com/Newbluecake/pi-toolkit) | расширение PI | 5★, 2026-11-20 | F1 (75/88%), F2 (in-place), F4, F6 | F3, F5 guard, handoff в новую сессию |
| [fresh-session-continuation](https://github.com/erans/fresh-session-continuation) | расширение PI | 7★, 2026-11-05 | F2 | F1, F3–F6 |
| [powercontext](https://github.com/oceanbase/powercontext) | context server | 1 793★, v1.6.0 | F2 (формальный протокол) | F1, F3–F6; тяжёлый |
| [deja-vu](https://github.com/vshulcz/deja-vu) | MCP/CLI-память | 1 658★, 2026-11-23 | F2 (через память) | F1, F3–F6 |
| [cachetoast](https://github.com/rhunterharris/cachetoast) | плагин/installer | 6★, 2026-10-21 | F1 (по стоимости), F2, F6 (частично) | F3–F5 |

Также присутствуют, но не ранжированы: `mstar-harness`, `omp-best-of`,
`claude-handoff`, `ccompactor`, `dougs-ai-tools` (Apache-2.0, зоны 40%,
отказывается при запущенных jobs), `catchup` (перенос транскрипта между
harness'ами).

## Насколько распространена каждая возможность

| Возможность | Распространённость | Примеры |
|---|---|---|
| Handoff-документ / state-файл | Очень частая (~20+ проектов) | pf-handoff, Continuous-Claude-v3, deja-vu, powercontext, catchup, ccompactor |
| Пороги контекста в процентах | Редкая (3 инструмента) | pf-handoff 40/60/75, pi-toolkit 75/88, dougs context-nudge 40% |
| Автоматический handoff в **новую** сессию | Редкая (3) | claude-auto-handoff, fresh-session-continuation, cachetoast |
| Внешний supervisor вне процесса агента | **Не найдено** | — |
| Лестница режимов workflow | **Нет** (только permission-режимы) | pi-automode и подобные — пресеты разрешений |
| План + бюджеты + stop-gates | Редко | claw-orchestrator (`maxBudgetUsd`), strategium, mstar-harness (advisory) |
| Жизненный цикл worktree **с guard очистки** | **Нет**; конкуренты изолируют и мержат | pi-cowboy удаляет ветку при очистке; OMP `clear --all` сносит живые записи |

## Выводы для продукта

1. **Не продавать handoff как дифференциатор.** OMP и PI уже содержат
   примитивы компакции и handoff; `/handoff` в OMP — builtin, и плагин
   намеренно его не регистрирует. Ценность — в `/handoff-new` +
   `/handoff-preflight` + supervisor и в политике вокруг них.
2. **Уникальная связка**: детерминированная 3-зонная политика с
   приоритетом Settings > env > режим, handoff, исполняемый не-LLM
   watcher'ом вне процесса агента, и обратимость (ff-only merge, отказ при
   dirty/unmerged/current/live worktree, tip ветки в
   `refs/omp-worktree-backup/*`).
3. **Слабое место — обнаружение.** У OMP нет центрального реестра, каталог
   PI огромен; публикация через marketplace-каталог и понятная страница
   сравнения важнее очередной функции.
4. **Следить за направлениями:** ротация по стоимости (cachetoast), жёсткие
   USD-ledger'ы на поддерево агентов (omp-fabric, claw-orchestrator),
   межharness-handoff (catchup, pi-cowboy), формальные протоколы handoff
   (powercontext).

## Источники

- Каталог: `https://pi.dev/packages` (2026-11-23); метаданные npm для
  каждого пакета; `https://github.com/earendil-works/pi`.
- OMP: `https://github.com/can1357/oh-my-pi` —
  `docs/marketplace.md`, `docs/compaction.md`,
  `docs/handoff-generation-pipeline.md`, `docs/settings.md`,
  `docs/cli-reference.md`, `docs/agent-hub.md`;
  `packages/coding-agent/src/slash-commands/builtin-lifecycle.ts`;
  локальный `omp --version` 19.1.1 и `omp worktree --help`.
- GitHub API (`api.github.com`) для звёзд, дат push и лицензий, запрос
  2026-11-23.
- `[UNVERIFIED]`: отдельные лицензии и звёзды мелких репозиториев; точные
  значения по умолчанию Claude Code/Codex/Cline/Gemini/Aider там, где
  документация вендора не читалась напрямую.
