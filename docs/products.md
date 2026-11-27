# Продукты OMP: разделение и контракты

Снимок: 2026-11-27. Карта границ между четырьмя продуктами OMP. Роль и
устройство самого продукта — в `AGENTS.md`/`README.md`; здесь только то, что
нельзя менять из чужой сессии.

## Принцип

- Один продукт = отдельный git-репозиторий = отдельный Orca-проект = своя
  версия, CI и release. Подкаталог пакета продуктом не становится.
- Своя сессия и свои worktree: `~/orca/workspaces/<product>/<slug>`, ветка
  `feat/<slug>` от `main`, один агент — один worktree; файл не правится из
  двух сессий одновременно.
- Общая сессия, общий worktree и общее рабочее состояние — не канал
  интеграции. Канал — версионированный JSON по CLI.
- Импорт кода и типов из соседнего продукта запрещён. Читать чужие docs и
  вызывать чужой CLI read-only можно.
- Кросс-продуктовую правку делает сессия владельца репозитория. Потребитель
  не правит чужой репозиторий и не парсит его внутренние файлы.

## Продукты

| Продукт | Репозиторий | Роль | Версия | Remote |
|---|---|---|---|---|
| OAW | `omp-agent-workflow` | context guard, handoff, supervisor, оркестратор задач, CLI JSON | 0.7.1 | `origin` GitHub |
| cache-monitor | `omp-cache-monitor` | hit rate кэша, `/cache-monitor`, `costs --json` | 0.11.0 | `origin` GitHub |
| usage | `omp-usage` | CLI `usage-metrics`, Orca-панель `local.usage-panel` | 0.2.0 | локальный, origin нет |
| skill-library | `omp-skill-library` | CLI v1 `status/doctor/link/scan/adopt`, симлинк-проекция | 0.1.0 | локальный, origin нет |

Сессии: `usage-*` — usage, `skill-*` — skill-library; у OAW и cache-monitor
отдельного префикса нет, worktree по задаче.

## Контракты

| JSON | Производитель | Потребитель | Схема |
|---|---|---|---|
| `omp-cache-monitor costs --json` | cache-monitor | OAW `/handoff-preflight` (`lib/costs-client.ts`) | 1 |
| `status --json`, `doctor --json`, `omp-orchestrate … --json` | OAW | оператор, скрипты | 1 |
| `usage-metrics --json` | usage | панель `local.usage-panel` | 1 |
| `usage-metrics inventory --json` | usage | панель | 2 |
| `usage-metrics cost --json` | usage (`omp stats -j`) | панель | 1 |
| `skill-library status/doctor --json` | skill-library | панель omp-usage (`managed`), скрипты | 1 |

Правила: изменение аддитивное; ломающее — новая `schemaVersion` и правка
консьюмера в том же коммите у владельца; консьюмер проверяет
`schemaVersion` и деградирует (пропуск строк/пустые массивы), а не падает;
ошибка — exit ≠ 0 и stderr; выдуманные значения запрещены.

## Общие точки записи

| Точка | Пишет | Остальные |
|---|---|---|
| `~/.agents/skills`, `~/.omp/agent/skills` | skill-library (симлинки по манифесту) | только читают |
| `<repo>/.agents/skills`, `<repo>/.omp/skills` | skill-library `reconcile` | манифест `.skill-library.json` коммитит проект |
| `omp plugin link` OAW и cache-monitor | каждый плагин сам | линк смотрит на боевой `main` |
| `.omp-handoff-session.json`, `.omp-handoff-request.json` | OAW | не трогают |
| `~/.omp` (сессии, JSONL, `omp stats`) | OMP | usage и cache-monitor только читают |
| `~/.local/bin/<cli>` | продукт-владелец | — |

## Запрещено

- Править чужой репозиторий или его worktree из своей сессии.
- Импортировать код/типы соседа; парсить внутренние файлы вместо JSON CLI.
- Держать одну сессию/worktree на два продукта.
- Склеивать версии и релизы; публиковать npm/marketplace и менять видимость
  репозитория без разрешения владельца.
- Считать подкаталог пакета отдельным продуктом.

## Твой продукт

- Владеет: `index.ts` (пороги, `/handoff`, `/handoff-new`,
  `/handoff-preflight`, статус-ключ `workflow`), supervisor, launcher,
  `orchestrator`/`omp-orchestrate`, marker/session-файлы, CLI JSON v1.
- Производит: `status --json`, `doctor --json`, `omp-orchestrate … --json` —
  `schemaVersion: 1`.
- Потребляет: `omp-cache-monitor costs --json` v1; CLI нет или другая схема —
  строки пропускаются, preflight не падает.
- Не делает: не считает hit rate и цену кэша, не ведёт навыки, не агрегирует
  usage; чужие репозитории не правит.
- Свои имена команд проверяет `npm run check:names` (уникальность между
  продуктами).

## Обновление карты

Состав продуктов или контракт меняется — правь этот файл во всех затронутых
репозиториях одним решением; расхождение копий — дефект ревью.
