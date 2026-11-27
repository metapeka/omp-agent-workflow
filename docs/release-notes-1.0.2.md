# omp-agent-workflow 1.0.2 — preflight в чужом репозитории

Дата: 2026-11-27. Предыдущий релиз:
[v1.0.1](https://github.com/metapeka/omp-agent-workflow/releases/tag/v1.0.1).

## Что исправлено

1.0.2 закрывает две находки из аудита стороннего репозитория без
`package.json` и с чужим форматом `HANDOFF.md`.

- **Меню не предлагает проверки, которые нечего запускать.**
  `actionsForPreflight` показывает «проверки» только при
  `scripts.test`/`scripts.typecheck` (общий `readCheckScripts` с
  `performChecks`). Раньше в docs/audit-каталоге диалог спрашивал
  «Прогнать npm test и typecheck?» и отвечал `⦸ проверки: пропущено —
  package.json нет`. Битый `package.json` по-прежнему предлагается, чтобы
  ошибка была видна.
- **Пустое меню печатает итог сразу.** Если ни одного действия нет,
  диалог не открывается: выводятся `действия` («не выбраны»),
  `вручную/агентом` и таблица состояния.
- **Чужой шаблон state узнаётся.** Синонимы разделов покрывают
  `Проверено как` (проверки), `Открыто`/`Что делать` (дальше),
  `Что закрыто`/`Что включено` (состояние), `Главные выводы` (решения);
  строка «нестандартный формат» теперь говорит «нет разделов шаблона OAW
  (вне OAW допустимо)» и не требует переписывать файл.

## Проверено

- `npm run verify`: `check:names`, 409 тестов, `tsc --noEmit` — зелёные.
- Extension load: `omp --no-extensions -e ./index.ts --no-session --mode
  json -p 'Reply with exactly: OK'` — exit 0, stderr пуст.
- Живой TUI: репозиторий без `package.json` — меню не открывается, итог
  печатается сразу; репозиторий с `scripts.test` — диалог `handoff 1/1`
  с «Прогнать npm test и typecheck?».

## Установка

```bash
curl -LO https://github.com/metapeka/omp-agent-workflow/releases/download/v1.0.2/omp-agent-workflow-1.0.2.tgz
tar xzf omp-agent-workflow-1.0.2.tgz -C ~/opt/omp-agent-workflow
omp plugin link ~/opt/omp-agent-workflow/package
```

Или из клона: `npm pack` и `omp plugin link ./package`, либо
`omp plugin link /path/to/checkout` для разработки.
