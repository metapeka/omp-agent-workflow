/**
 * context-guard — предупреждения о заполнении контекста и handoff-команды.
 *
 * Status line: один ключ `workflow` — режим Yoda и ожидаемый handoff. Процент
 * контекста не дублируем: native `context_pct` уже показывает его. Задача
 * расширения — предупредить заранее и дать детерминированную команду сжатия.
 *
 * Пороги по умолчанию: 35% warning, 50% предложение HANDOFF, 60% авто-компакция
 * после завершения хода. Переопределяются через OMP_CONTEXT_WARN,
 * OMP_CONTEXT_SUGGEST, OMP_CONTEXT_AUTO (число или `off`).
 *
 * Установка: `omp plugin link <каталог>` или копия в
 * `~/.omp/agent/extensions/context-guard.ts` (одно из двух).
 */
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionAskDialogResult,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";

import {
	loadWorkflowSettings,
	resolveSettings,
	type WorkflowSettings,
} from "./lib/workflow-settings.ts";
import {
	mergeSessionInfo,
	parseSessionInfo,
} from "./lib/session-info.ts";
import {
	readState,
	STATE_FILE as ORCHESTRATOR_STATE_FILE,
} from "./lib/orchestrator/state.ts";
import { readPlan, selectNextTask } from "./lib/orchestrator/plan.ts";
import type {
	Autoplan,
	OrchestratorState,
} from "./lib/orchestrator/types.ts";
import {
	describeNextSession,
	loadModelCatalog,
	parseNextSession,
} from "./lib/next-session.ts";
import {
	cacheHitPercent,
	formatTokens,
	formatUsd,
	lastReasoningShare,
	readSessionMetrics,
} from "./lib/session-metrics.ts";
import { readCostsSummary } from "./lib/costs-client.ts";
import { readSessionCost } from "./lib/orchestrator/cost.ts";

/** Сжать контекст, не потеряв цель, решения, файлы и проверки. */
const HANDOFF_INSTRUCTIONS =
	"Сохрани цель задачи, текущее состояние, принятые решения, изменённые файлы, " +
	"выполненные проверки, блокеры и следующие шаги. Сырые логи и длинные выводы " +
	"инструментов отбрось.";

const SESSION_INFO = ".omp-handoff-session.json";
const SESSION_LOCK = ".omp-handoff-session.lock";
const STATE_FILE = "HANDOFF.md";
const REQUEST_MARKER = ".omp-handoff-request.json";
/** Ключ статус-строки: режим Yoda и ожидаемый handoff, без context_pct. */
const STATUS_KEY = "workflow";
const RUNTIME_PATHS = [
	SESSION_INFO,
	SESSION_LOCK,
	REQUEST_MARKER,
	".omp-handoff-supervisor.lock",
	".omp-handoff-supervisor.lock.stale-*",
	".omp-handoff-done.json",
];
const RUNTIME_EXCLUDES = RUNTIME_PATHS.map((path) => `:(exclude)${path}`);

/**
 * Лимит state-файла в новой сессии: 32k символов. Офлайн-токенизаторы
 * (`omp toks`) дают 2.1–3.0 символа на токен для русского текста, то есть
 * 32k символов ≈ 10–15k токенов — безопасно для окна 100k и не съедает
 * заметную долю промпта на 1M.
 */
const HANDOFF_STATE_LIMIT = 32_000;
/** С этого размера state просим сократить: лимит близко, payload тяжелеет. */
const STATE_WARN_CHARS = 24_000;

/** Повторный запрос HANDOFF после стольких завершённых ходов без marker. */
const HANDOFF_RETRY_TURNS = 2;
/** Всего запросов до остановки: первый + повторы, чтобы не крутить цикл. */
const HANDOFF_MAX_REQUESTS = 3;
/** Сколько незакоммиченных путей показывать в handoff-запросе. */
const HANDOFF_TREE_MAX_PATHS = 6;
/** Бюджет символов на список путей: запрос не должен раздувать промпт. */
const HANDOFF_TREE_MAX_CHARS = 300;

/**
 * Read-only снимок дерева для handoff-запроса: ветка, HEAD и
 * незакоммиченные пути. Сам handoff git не трогает, поэтому без этой строки
 * работа в дереве не видна новой сессии, если её нет в `HANDOFF.md`.
 * Не git-репозиторий, ошибка бинаря или пустая ветка — пустая строка.
 */
function workingTreeSnapshot(cwd: string): string {
	const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], 3_000);
	if (!branch.ok || !branch.out) return "";
	const head = git(cwd, ["rev-parse", "--short", "HEAD"], 3_000);
	const headText = head.ok && head.out ? ` @ ${head.out}` : "";
	const status = git(cwd, ["status", "--porcelain"], 3_000);
	if (!status.ok) {
		return `Дерево: ветка ${branch.out}${headText}; состояние не прочитать.`;
	}
	const entries = status.out
		.split("\n")
		.filter(Boolean)
		.map((line) => ({
			code: line.slice(0, 2).trim() || "??",
			path: line.slice(3).trim(),
		}))
		.filter((entry) => entry.path && !entry.path.startsWith(".omp-handoff-"))
		.map((entry) => `${entry.code} ${entry.path}`);
	if (!entries.length) return `Дерево: ветка ${branch.out}${headText}, изменений нет.`;
	const shown: string[] = [];
	let budget = HANDOFF_TREE_MAX_CHARS;
	for (const entry of entries.slice(0, HANDOFF_TREE_MAX_PATHS)) {
		if (entry.length > budget) break;
		shown.push(entry);
		budget -= entry.length + 2;
	}
	const rest = entries.length - shown.length;
	const listed = shown.length
		? ` (${shown.join(", ")}${rest > 0 ? `, и ещё ${rest}` : ""})`
		: "";
	return (
		`Дерево: ветка ${branch.out}${headText}, незакоммиченных файлов: ${entries.length}${listed}. ` +
		"Перечисли их в HANDOFF.md — новая сессия видит только файл."
	);
}

/**
 * Сообщение для новой сессии: continuation prompt + содержимое state-файла.
 * Без содержимого новая сессия видит только просьбу прочитать файл и может
 * начать работу, не прочитав его. Обрезка сохраняет маркер и путь файла.
 */
function handoffMessage(
	prompt: string,
	stateName: string,
	statePath: string,
): string {
	let state: string;
	try {
		const content = readFileSync(statePath, "utf8");
		if (content.length <= HANDOFF_STATE_LIMIT) {
			state = content;
		} else {
			let cut = content.slice(0, HANDOFF_STATE_LIMIT);
			const last = cut.charCodeAt(cut.length - 1);
			// не разрываем surrogate pair
			if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
			state =
				`${cut}\n\n[state обрезан: показаны ${cut.length} из ${content.length} ` +
				`символов; остальное прочитай из ${statePath}]`;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return (
			`${prompt}\n\nНе удалось прочитать ${stateName} (${statePath}): ${message}. ` +
			"Прочитай state-файл сам до начала работы."
		);
	}
	return `${prompt}\n\n--- ${stateName} (${statePath}) ---\n${state}\n--- конец ${stateName} ---`;
}

export type PreflightStatus = "pass" | "warn" | "fail";

export interface PreflightCheck {
	status: PreflightStatus;
	id?: string;
	text: string;
}

export interface PreflightReport {
	ready: boolean;
	checks: PreflightCheck[];
}

/** Запуск git best-effort: ошибка бинаря/репозитория — `ok: false`, не исключение. */
function git(
	cwd: string,
	args: string[],
	timeout = 10_000,
): { ok: boolean; out: string; error: string } {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		timeout,
		env: { ...process.env, LC_ALL: "C", LANG: "C" },
	});
	const stdout = typeof result.stdout === "string" ? result.stdout : "";
	const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
	const error = result.error ? result.error.message : stderr;
	return {
		ok: !result.error && result.status === 0,
		out: stdout.trimEnd(),
		error,
	};
}

function plural(n: number, one: string, few: string, many: string): string {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return one;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
	return many;
}

function commits(n: number): string {
	return `${n} ${plural(n, "коммит", "коммита", "коммитов")}`;
}

/**
 * Advisory `next-session:` в state-файле: показываем строку и её валидность,
 * ничего не переключаем (контракт preflight — read-only). Каталог моделей
 * читается только если в строке есть `model`; иначе вызов `omp` не нужен.
 */
function advisoryCheck(
	text: string,
): { status: PreflightStatus; text: string } | null {
	let parsed = parseNextSession(text);
	if (parsed.status === "none") return null;
	if (parsed.advice?.model !== undefined) {
		parsed = parseNextSession(text, { catalog: loadModelCatalog() });
	}
	const problems = parsed.problems.map((problem) =>
		problem.text.replace(/^next-session:\s*/, ""),
	);
	if (parsed.status === "invalid") {
		return {
			status: "warn",
			text: `next-session: ${problems.join("; ")}`,
		};
	}
	if (parsed.advice === null) return null;
	const details = problems.length ? ` — ${problems.join("; ")}` : "";
	return {
		status: parsed.problems.length ? "warn" : "pass",
		text: `next-session: ${describeNextSession(parsed.advice)}${details}`,
	};
}

/** Строка размера state: лимит 32k обрезает, 24k — уже пора сокращать. */
function stateSizeCheck(
	stateFile: string,
	chars: number,
): PreflightCheck {
	const base = `${stateFile}: ${chars} символов / ${HANDOFF_STATE_LIMIT}`;
	if (chars >= HANDOFF_STATE_LIMIT) {
		return { status: "warn", id: "state", text: `${base} — обрежется при handoff` };
	}
	if (chars > STATE_WARN_CHARS) {
		return { status: "warn", id: "state", text: `${base} — сократи state` };
	}
	return { status: "pass", id: "state", text: base };
}

/**
 * Метрики сессии из JSONL: cache hit, reasoning share последнего хода,
 * spend. Только измеренные величины; цена границы — вне этого модуля.
 * Read-only, файла нет — строк нет.
 */
function sessionChecks(sessionFile: string | null): PreflightCheck[] {
	const metrics = readSessionMetrics(sessionFile);
	if (!metrics.available || metrics.requests === 0) return [];
	const checks: PreflightCheck[] = [];

	const hit = cacheHitPercent(metrics);
	const prompt = metrics.input + metrics.cacheRead;
	if (hit !== null) {
		// На короткой сессии hit ещё не показателен: warn только после ~5 запросов.
		const meaningful = prompt >= 50_000 && metrics.requests >= 5;
		checks.push({
			status: meaningful && hit < 80 ? "warn" : "pass",
			id: "usage-cache",
			text:
				`usage: cache hit ${hit.toFixed(1)}% — prompt ${formatTokens(prompt)} ` +
				`(input ${formatTokens(metrics.input)}, cacheRead ${formatTokens(metrics.cacheRead)})`,
		});
	}

	const share = lastReasoningShare(metrics);
	const last = metrics.last;
	// Spend не зависит от reasoning: ход без output всё равно стоит денег.
	const reasoning =
		share !== null && last
			? `reasoning ${Math.round(share)}% последнего хода ` +
				`(${formatTokens(last.reasoning)} из ${formatTokens(last.output)}), `
			: "";
	checks.push({
		status: "pass",
		id: "usage-last",
		text: `usage: ${reasoning}${formatUsd(metrics.costUsd)} за сессию`,
	});

	return checks;
}

/**
 * Цена границы handoff и разрезы по моделям из `costs --json` cache-monitor.
 * CLI нет, он упал или отдал другую схему — строк нет: preflight не падает и
 * не выдумывает деньги. Данные — фактический `usage.cost.total`, не оценка
 * по прайсу.
 */
function costsChecks(sessionFile: string | null): PreflightCheck[] {
	const summary = readCostsSummary(sessionFile);
	if (!summary) return [];
	const { border } = summary;
	const turns = summary.report.turns;
	const checks: PreflightCheck[] = [];

	if (border.coldUsd !== null || border.warmUsd !== null) {
		const parts: string[] = [];
		if (border.coldTurns === 0) {
			parts.push("холодных ходов нет");
		} else {
			const cold = border.coldUsd === null ? "цены нет" : formatUsd(border.coldUsd);
			parts.push(`холодный ход ${cold}`);
			parts.push(`холодных ${border.coldTurns} из ${turns.length}`);
		}
		if (border.warmUsd === null) parts.push("тёплый ход: цены нет");
		else parts.push(`тёплый ход ${formatUsd(border.warmUsd)}`);
		checks.push({
			status: "pass",
			id: "usage-border",
			text: `usage-border: ${parts.join(" · ")}`,
		});
	}

	// Одна модель — уже покрыта строкой выше; разрез нужен только при выборе.
	if (summary.report.models.length > 1) {
		for (const model of summary.report.models) {
			const name = model.model ?? "(без модели)";
			const cost = model.costUsd === null ? "цены нет" : formatUsd(model.costUsd);
			const hit =
				model.hitPercent === null ? "hit n/a" : `hit ${model.hitPercent.toFixed(1)}%`;
			checks.push({
				status: "pass",
				id: "usage-model",
				text:
					`models: ${name} — ${model.turns} ` +
					`${plural(model.turns, "ход", "хода", "ходов")} · ${cost} · ${hit}`,
			});
		}
	}

	return checks;
}

/**
 * План и run из `AUTOPLAN.md` + `STATE.json`: задачи/gates/deps и spend
 * волны. План опционален; отсутствие не предупреждение.
 */
function orchestratorChecks(cwd: string): PreflightCheck[] {
	const checks: PreflightCheck[] = [];

	let state: OrchestratorState | null = null;
	const statePath = resolve(cwd, ORCHESTRATOR_STATE_FILE);
	if (existsSync(statePath)) {
		try {
			state = readState(statePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			checks.push({
				status: "warn",
				id: "run",
				text: `state: ${ORCHESTRATOR_STATE_FILE} не читается — ${message}`,
			});
		}
	}

	let plan: Autoplan | null = null;
	// План мог быть запущен с другим путём: `--plan PATH` пишет label в state.
	const planLabel = state?.plan.path ?? "AUTOPLAN.md";
	const planPath = resolve(cwd, planLabel);
	if (existsSync(planPath)) {
		try {
			plan = readPlan(planPath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			checks.push({
				status: "warn",
				id: "plan",
				text: `план: ${planLabel} не читается — ${message}`,
			});
		}
	} else if (state?.plan.path) {
		checks.push({
			status: "warn",
			id: "plan",
			text: `план: ${planLabel} не найден, хотя ${ORCHESTRATOR_STATE_FILE} на него ссылается`,
		});
	} else {
		checks.push({
			status: "pass",
			id: "plan",
			text: "план: нет AUTOPLAN.md — работа без оркестратора",
		});
	}

	if (plan) {
		const completed = state ? state.completed.map((task) => task.id) : [];
		const nextTask = selectNextTask(plan, completed);
		let line = `план: ${completed.length}/${plan.tasks.length} задач`;
		if (nextTask.kind === "task") {
			const gate = nextTask.task.gate ? `, gate ${nextTask.task.gate}` : "";
			const deps = nextTask.task.deps.length
				? `, deps ${nextTask.task.deps.join(",")}`
				: "";
			line += `, следующая ${nextTask.task.id}${gate}${deps}`;
		} else if (nextTask.kind === "plan-done") {
			line += ", все выполнены";
		} else {
			line += ", нет готовой задачи — проверь deps";
		}
		checks.push({ status: "pass", id: "plan", text: line });
	}

	const attempts = state
		? Object.entries(state.attempts).filter(([, count]) => count > 0)
		: [];
	if (attempts.length > 0) {
		checks.push({
			status: "warn",
			id: "attempts",
			text: `попытки: ${attempts.map(([id, count]) => `${id}×${count}`).join(", ")}`,
		});
	}

	if (state && (state.run?.active || state.budgets.spendUsd > 0)) {
		const configured = plan?.config.budgets.maxSpendUsd ?? 0;
		const spend = state.budgets.spendUsd;
		const task = state.current
			? `${state.current.id} ${taskStatusLabel(state.current.status)}`
			: "нет текущей задачи";
		const limit = configured > 0 ? ` / ${formatUsd(configured)}` : "";
		checks.push({
			status: configured > 0 && spend >= configured * 0.9 ? "warn" : "pass",
			id: "run",
			text: `run: ${task}, spend ${formatUsd(spend)}${limit}`,
		});
	}

	return checks;
}

/** Read-only проверка перед `/handoff-new`: ничего не пишет и не чинит. */
export function runPreflight(
	cwd: string,
	sessionFile: string | null,
	stateFile = STATE_FILE,
): PreflightReport {
	const checks: PreflightCheck[] = [];
	const add = (status: PreflightStatus, text: string, id?: string): void => {
		checks.push(id ? { status, id, text } : { status, text });
	};

	const statePath = resolve(cwd, stateFile);
	let stateText: string | null = null;
	if (existsSync(statePath)) {
		try {
			stateText = readFileSync(statePath, "utf8");
		} catch {
			stateText = null;
		}
	}
	if (stateText !== null) {
		const size = stateSizeCheck(stateFile, stateText.length);
		add(size.status, size.text, size.id);
		const advisory = advisoryCheck(stateText);
		if (advisory) add(advisory.status, advisory.text, "next-session");
	} else {
		add("fail", `${stateFile}: нет — сначала обнови state`, "state");
	}

	for (const check of sessionChecks(sessionFile)) checks.push(check);
	for (const check of costsChecks(sessionFile)) checks.push(check);
	for (const check of orchestratorChecks(cwd)) checks.push(check);

	const repo = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
	if (!repo.ok || repo.out !== "true") {
		if (/not a git repository/i.test(repo.error)) {
			add("warn", "git: не репозиторий — git-проверки пропущены");
			return { ready: !checks.some((c) => c.status === "fail"), checks };
		}
		add(
			"fail",
			`git: не удалось проверить репозиторий${repo.error ? ` — ${repo.error}` : ""}`,
		);
		return { ready: false, checks };
	}

	const hasCommit = git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
	if (!hasCommit.ok) {
		add("fail", "git: нет коммитов — сделай первый коммит");
		return { ready: false, checks };
	}

	const dirty = git(cwd, [
		"status",
		"--porcelain",
		"--",
		".",
		...RUNTIME_EXCLUDES,
	]);
	if (!dirty.ok) {
		add("warn", "git status: не удалось прочитать", "worktree");
	} else if (!dirty.out) {
		add("pass", "git: чисто", "worktree");
	} else {
		const lines = dirty.out.split("\n");
		const names = lines.slice(0, 3).map((line) => line.slice(3).trim()).join(", ");
		const rest = lines.length > 3 ? ` и ещё ${lines.length - 3}` : "";
		add("fail", `git: изменено файлов ${lines.length} — ${names}${rest}`, "worktree");
	}

	const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const branchName = branch.ok ? branch.out : "";
	if (!branchName || branchName === "HEAD") {
		add("fail", "git: detached HEAD — переключись на ветку", "branch");
	} else {
		const head = git(cwd, ["rev-parse", "--short", "HEAD"]);
		add("pass", `ветка: ${branchName}${head.ok ? ` @ ${head.out}` : ""}`, "branch");
	}

	const upstream = git(cwd, [
		"rev-parse",
		"--abbrev-ref",
		"--symbolic-full-name",
		"@{u}",
	]);
	if (upstream.ok && upstream.out) {
		const counts = git(cwd, [
			"rev-list",
			"--left-right",
			"--count",
			"@{u}...HEAD",
		]);
		if (!counts.ok) {
			add("warn", `upstream ${upstream.out}: не удалось сравнить`);
		} else {
			const [behindRaw, aheadRaw] = counts.out.split(/\s+/);
			const behind = Number(behindRaw);
			const ahead = Number(aheadRaw);
			if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
				add("warn", `upstream ${upstream.out}: не удалось разобрать счётчики`);
			} else if (ahead === 0 && behind === 0) {
				add("pass", `upstream ${upstream.out}: синхронизирован`);
			} else {
				if (ahead > 0)
					add("fail", `upstream ${upstream.out}: не запушено ${commits(ahead)}`, "upstream");
				if (behind > 0)
					add(
						"warn",
						`upstream ${upstream.out}: отстаёт на ${commits(behind)} — сделай pull`,
					);
			}
		}
	} else {
		add("warn", "upstream: нет — пуш проверить нечем");
	}

	if (branchName && branchName !== "HEAD" && branchName !== "main") {
		const dest = git(cwd, ["rev-parse", "--verify", "--quiet", "main"]).ok
			? "main"
			: "origin/main";
		if (git(cwd, ["rev-parse", "--verify", "--quiet", dest]).ok) {
			if (git(cwd, ["merge-base", "--is-ancestor", "HEAD", dest]).ok)
				add("pass", `ветка влита в ${dest}`, "merge");
			else
				add("warn", `ветка не влита в ${dest} — смерджи до handoff`, "merge");
		}
	}

	const stateStatus = git(cwd, ["status", "--porcelain", "--", stateFile]);
	if (stateStatus.ok && stateStatus.out) {
		add("fail", `${stateFile}: изменён, не закоммичен`);
	} else {
		const stateCommit = git(cwd, ["log", "-1", "--format=%h", "--", stateFile]);
		if (!stateCommit.ok || !stateCommit.out) {
			add("warn", `${stateFile}: не закоммичен — state не в git`);
		} else {
			const after = git(cwd, [
				"rev-list",
				"--count",
				`${stateCommit.out}..HEAD`,
			]);
			const n = Number(after.out);
			if (after.ok && Number.isFinite(n) && n > 0) {
				add("warn", `${stateFile}: старше HEAD на ${commits(n)} — проверь актуальность`);
			} else {
				add("pass", `${stateFile}: закоммичен в HEAD`);
			}
		}
	}

	const markerPath = resolve(cwd, REQUEST_MARKER);
	if (!existsSync(markerPath)) {
		add("pass", "marker: нет");
	} else {
		let markerSession: string | null = null;
		try {
			const parsed: unknown = JSON.parse(readFileSync(markerPath, "utf8"));
			if (parsed && typeof parsed === "object" && "sessionFile" in parsed) {
				const value = parsed.sessionFile;
				if (typeof value === "string") markerSession = value;
			}
		} catch {
			// битый marker считаем чужим
		}
		if (markerSession && sessionFile && markerSession === sessionFile) {
			add("warn", "marker: стоит — supervisor сам запустит /handoff-new");
		} else {
			add("warn", `marker: от другой сессии — удали ${REQUEST_MARKER}`);
		}
	}

	return { ready: !checks.some((c) => c.status === "fail"), checks };
}

const DIVIDER = "────────────────────────────────────────────────";
/** Ниже этой ширины таблица не влезает — печатаем группы с иконками. */
const PREFLIGHT_NARROW_COLUMNS = 70;

export interface PreflightSymbols {
	status: Record<PreflightStatus, string>;
	skip: string;
	groups: Record<string, string>;
}

export interface PreflightFormatOptions {
	symbols?: PreflightSymbols;
	columns?: number;
}

/** Фолбэк, когда хост не даёт тему: значения unicode-пресета OMP. */
export const UNICODE_PREFLIGHT_SYMBOLS: PreflightSymbols = {
	status: { pass: "✔", warn: "⚠", fail: "✘" },
	skip: "⦸",
	groups: {
		file: "📄",
		usage: "💾",
		plan: "🗺",
		git: "⎇",
		"git status": "⎇",
		"ветка": "⑂",
		upstream: "⤴",
		marker: "📌",
		"next-session": "🧭",
	},
};

type PreflightSymbolKey =
	| "status.success"
	| "status.warning"
	| "status.error"
	| "status.disabled"
	| "icon.cache"
	| "icon.file"
	| "icon.plan"
	| "icon.git"
	| "icon.branch"
	| "icon.pr"
	| "icon.pin"
	| "icon.context";

/**
 * Глифы из словаря OMP (`theme.symbol`) вместо литералов: при `ascii`-пресете
 * статусы становятся `[+]`/`[!]` и иконки выключаются, при `nerd` — Nerd Font.
 * Живой TUI даёт тему; headless/тесты — нет, тогда unicode-фолбэк.
 */
export function preflightSymbols(ctx: ExtensionContext): PreflightSymbols {
	const theme = ctx.ui?.theme;
	if (!theme || typeof theme.symbol !== "function") return UNICODE_PREFLIGHT_SYMBOLS;
	let preset = "unicode";
	try {
		preset = theme.getSymbolPreset() ?? "unicode";
	} catch {
		// старый хост без getSymbolPreset
	}
	const pick = (key: PreflightSymbolKey, fallback: string): string => {
		try {
			const value = theme.symbol(key);
			return value ? value : fallback;
		} catch {
			return fallback;
		}
	};
	const status = {
		pass: pick("status.success", UNICODE_PREFLIGHT_SYMBOLS.status.pass),
		warn: pick("status.warning", UNICODE_PREFLIGHT_SYMBOLS.status.warn),
		fail: pick("status.error", UNICODE_PREFLIGHT_SYMBOLS.status.fail),
	};
	const skip = pick("status.disabled", UNICODE_PREFLIGHT_SYMBOLS.skip);
	if (preset === "ascii") return { status, skip, groups: {} };
	return {
		status,
		skip,
		groups: {
			file: pick("icon.file", "📄"),
			usage: pick("icon.cache", "💾"),
			plan: pick("icon.plan", "🗺"),
			git: pick("icon.git", "⎇"),
			"git status": pick("icon.git", "⎇"),
			"ветка": pick("icon.branch", "⑂"),
			upstream: pick("icon.pr", "⤴"),
			marker: pick("icon.pin", "📌"),
			"next-session": pick("icon.context", "🧭"),
		},
	};
}

/** Ширина чата с запасом на поля панели; вне TTY — 76. */
function terminalColumns(): number {
	const width = process.stdout.columns;
	return Number.isFinite(width) && width && width > 0 ? Math.max(40, width - 4) : 76;
}

/** Ширина строки для выравнивания: символы группы и деталей — одноклеточные. */
function cellWidth(text: string): number {
	return Array.from(text).length;
}

function wrapText(text: string, width: number): string[] {
	if (width < 8) return [text];
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const candidate = line ? `${line} ${word}` : word;
		if (!line || cellWidth(candidate) <= width) line = candidate;
		else {
			lines.push(line);
			line = word;
		}
	}
	if (line) lines.push(line);
	return lines.length ? lines : [""];
}

interface PreflightRow {
	group: string;
	detail: string;
	status: PreflightStatus;
}

/** `git: чисто` → группа `git`, деталь `чисто`; строка без `:` идёт в деталь. */
function preflightRows(report: PreflightReport): PreflightRow[] {
	return report.checks.map((check) => {
		const match = /^([^:]{1,24}):\s*(.*)$/.exec(check.text);
		if (!match) {
			return {
				group: /^ветка/.test(check.text) ? "merge" : "—",
				detail: check.text,
				status: check.status,
			};
		}
		let group = match[1];
		let detail = match[2];
		if (group.startsWith("upstream ")) {
			detail = `${group.slice("upstream ".length)}: ${detail}`;
			group = "upstream";
		}
		return { group, detail, status: check.status };
	});
}

function groupIcon(group: string, symbols: PreflightSymbols): string {
	if (/\.md$/i.test(group)) return symbols.groups.file ?? "";
	return symbols.groups[group] ?? "";
}

/** Вариант D: вердикт первым, дальше группы с иконками, без выравнивания. */
function formatGroupedPreflight(
	rows: readonly PreflightRow[],
	title: string,
	verdict: string,
	symbols: PreflightSymbols,
): string {
	const warns = rows.filter((row) => row.status === "warn").length;
	const fails = rows.filter((row) => row.status === "fail").length;
	const summary = [
		`${rows.length} ${plural(rows.length, "проверка", "проверки", "проверок")}`,
		warns ? `${warns} ${plural(warns, "замечание", "замечания", "замечаний")}` : "",
		fails ? `${fails} ${plural(fails, "блокер", "блокера", "блокеров")}` : "",
	]
		.filter(Boolean)
		.join(" · ");
	const lines = [DIVIDER, `PREFLIGHT · ${title}`, verdict, summary];
	let last = "";
	for (const row of rows) {
		if (row.group !== last) {
			last = row.group;
			const icon = groupIcon(row.group, symbols);
			lines.push("", `▸ ${icon ? `${icon} ` : ""}${row.group}`);
		}
		lines.push(`  ${symbols.status[row.status]} ${row.detail}`);
	}
	lines.push(DIVIDER);
	return lines.join("\n");
}

/**
 * Вариант C: `GROUP  ST  DETAIL` с расчётной шириной колонок и переносом
 * длинных деталей; уже `PREFLIGHT_NARROW_COLUMNS` — вариант D.
 */
export function formatPreflight(
	report: PreflightReport,
	title = "состояние",
	options: PreflightFormatOptions = {},
): string {
	const symbols = options.symbols ?? UNICODE_PREFLIGHT_SYMBOLS;
	const columns = options.columns ?? 76;
	const verdict = report.ready
		? "preflight: OK — можно /handoff-new"
		: "preflight: блокеры — /handoff-new рано";
	const mark = report.ready ? symbols.status.pass : symbols.status.fail;
	const rows = preflightRows(report);
	if (columns < PREFLIGHT_NARROW_COLUMNS) {
		return formatGroupedPreflight(rows, title, `${mark} ${verdict}`, symbols);
	}
	const groupWidth = Math.max(5, ...rows.map((row) => cellWidth(row.group)));
	const detailWidth = Math.max(12, columns - groupWidth - 4);
	const lines = [
		DIVIDER,
		`PREFLIGHT · ${title}`,
		`${"GROUP".padEnd(groupWidth)} ST  DETAIL`,
	];
	for (const row of rows) {
		const wrapped = wrapText(row.detail, detailWidth);
		lines.push(
			`${row.group.padEnd(groupWidth)} ${symbols.status[row.status]}  ${wrapped[0]}`,
		);
		for (const extra of wrapped.slice(1)) {
			lines.push(`${" ".repeat(groupWidth + 3)}${extra}`);
		}
	}
	lines.push(DIVIDER, `${mark} ${verdict}`);
	return lines.join("\n");
}

/** Действия, которые preflight умеет выполнить сам; остальное — вручную/агентом. */
interface HandoffAction {
	id: "checks" | "commit" | "merge" | "push";
	label: string;
	question: string;
	description: string;
}

const CHECKS_ACTION: HandoffAction = {
	id: "checks",
	label: "проверки",
	question: "Прогнать npm test и typecheck?",
	description: "npm run test и npm run typecheck, если скрипты есть",
};

const COMMIT_ACTION: HandoffAction = {
	id: "commit",
	label: "коммит",
	question: "Закоммитить изменения?",
	description: "git add -A (без runtime-файлов) и сообщение из input",
};

const MERGE_ACTION: HandoffAction = {
	id: "merge",
	label: "merge",
	question: "Слить ветку в main (ff-only)?",
	description: "fast-forward в чистый main worktree; при конфликте — ошибка",
};

const PUSH_ACTION: HandoffAction = {
	id: "push",
	label: "push",
	question: "Запушить коммиты в upstream?",
	description: "git push без --force в upstream текущей ветки; ошибка не форсится",
};

const MANUAL_HANDOFF_STEPS = [
	"завершить задачу — сессию можно закрывать",
	"обновить HANDOFF.md под следующую сессию",
	"удалить worktree после выхода",
];

/** Оставляет в меню только то, что действительно требует действия. */
function actionsForPreflight(report: PreflightReport): HandoffAction[] {
	const byId = new Map<string, PreflightCheck>();
	for (const check of report.checks) {
		if (check.id) byId.set(check.id, check);
	}
	const actions: HandoffAction[] = [CHECKS_ACTION];
	if (byId.get("worktree")?.status === "fail") actions.push(COMMIT_ACTION);
	if (byId.get("merge")?.status === "warn") actions.push(MERGE_ACTION);
	const upstream = byId.get("upstream");
	if (upstream?.status === "fail" && /не запушено/.test(upstream.text)) {
		actions.push(PUSH_ACTION);
	}
	return actions;
}

type ActionOutcome =
	| { status: "skipped" }
	| { status: "cancelled" }
	| { status: "answered"; selected: ReadonlySet<string> };

/**
 * Меню действий перед handoff. Без `askDialog` (старый TUI-хост) меню
 * пропускается: команда остаётся read-only и печатает таблицу.
 */
async function askHandoffActions(
	ctx: ExtensionContext,
	actions: readonly HandoffAction[],
): Promise<ActionOutcome> {
	const askDialog = ctx.ui.askDialog;
	if (!askDialog || actions.length === 0) return { status: "skipped" };
	let result: ExtensionAskDialogResult | undefined;
	try {
		result = await askDialog(
			actions.map((action, index) => ({
				id: action.id,
				header: `handoff ${index + 1}/${actions.length}`,
				question: action.question,
				options: [
					{ label: "Сделать", description: action.description },
					{ label: "Пропустить", description: "Ничего не менять" },
				],
				recommended: 0,
			})),
		);
	} catch {
		return { status: "skipped" };
	}
	if (!result || result.kind !== "submit") return { status: "cancelled" };
	return {
		status: "answered",
		selected: new Set(
			result.results
				.filter((item) => !item.timedOut && item.selectedOptions[0] === "Сделать")
				.map((item) => item.id),
		),
	};
}

/** Итог: действия, ручные шаги и свежая таблица состояния. */
function formatPreflightResult(
	report: PreflightReport,
	actions: readonly HandoffActionReport[],
	options: PreflightFormatOptions = {},
): string {
	const symbols = options.symbols ?? UNICODE_PREFLIGHT_SYMBOLS;
	const marks: Record<HandoffActionReport["status"], string> = {
		done: symbols.status.pass,
		skipped: symbols.skip,
		failed: symbols.status.fail,
	};
	const actionLines =
		actions.length > 0
			? actions.map((action) => `${marks[action.status]} ${action.text}`)
			: ["— не выбраны"];
	const sections = [
		[DIVIDER, "PREFLIGHT · действия", ...actionLines].join("\n"),
		[
			DIVIDER,
			"PREFLIGHT · вручную/агентом",
			...MANUAL_HANDOFF_STEPS.map((step) => `• ${step}`),
		].join("\n"),
		formatPreflight(report, "итог", options),
	];
	return sections.join("\n\n");
}

export interface HandoffActionReport {
	id: string;
	status: "done" | "skipped" | "failed";
	text: string;
}

/**
 * Черновик сообщения коммита: агент видит diff и предлагает subject, человек
 * только правит. Нет side-turn API, ошибка или пустой ответ — placeholder.
 */
async function draftCommitMessage(ctx: ExtensionContext): Promise<string> {
	const fallback = "handoff: перед сменой сессии";
	const ephemeral = ctx.runEphemeralTurn;
	if (!ephemeral) return fallback;
	const status = git(ctx.cwd, ["status", "--short"]);
	const stat = git(ctx.cwd, ["diff", "--stat", "HEAD"]);
	if (!status.ok || !status.out) return fallback;
	const ui = ctx.ui;
	const working = typeof ui.setWorkingMessage === "function";
	if (working) ui.setWorkingMessage("PREFLIGHT: черновик сообщения коммита…");
	try {
		const result = await ephemeral({
			promptText:
				"Напиши subject git-коммита для этих изменений: одна строка на " +
				"английском, conventional commits (feat/fix/docs/refactor/test/chore), " +
				"до 72 символов, без кавычек и точки в конце. Только строка.\n\n" +
				`Файлы:\n${status.out}\n` +
				(stat.ok && stat.out ? `Статистика:\n${stat.out}\n` : ""),
			tools: false,
			maxTokens: 80,
			minimizeEffort: true,
		});
		const line = result.replyText
			.trim()
			.split("\n")[0]
			.replace(/^["'`]+|["'`]+$/g, "")
			.trim();
		if (!line || line.length > 100) return fallback;
		return line;
	} catch {
		return fallback;
	} finally {
		if (working) ui.setWorkingMessage();
	}
}

/** Коммит всех изменений с сообщением из input-диалога. */
async function performCommit(ctx: ExtensionContext): Promise<HandoffActionReport> {
	const branch = git(ctx.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (!branch.ok || !branch.out || branch.out === "HEAD") {
		return {
			id: "commit",
			status: "failed",
			text: "коммит: ошибка — detached HEAD, переключись на ветку",
		};
	}
	const status = git(ctx.cwd, [
		"status",
		"--porcelain",
		"--",
		".",
		...RUNTIME_EXCLUDES,
	]);
	if (!status.ok) {
		return {
			id: "commit",
			status: "failed",
			text: `коммит: ошибка — git status: ${status.error}`,
		};
	}
	if (!status.out) {
		return { id: "commit", status: "skipped", text: "коммит: пропущено — нечего коммитить" };
	}
	const draft = await draftCommitMessage(ctx);
	const changed = status.out.split("\n").filter(Boolean);
	const summary =
		changed.length > 3
			? `${changed.length} файла`
			: changed.map((line) => line.slice(3)).join(", ");
	const title = `Сообщение коммита (git commit -m) · ${summary}`;
	let answer: string | undefined;
	if (typeof ctx.ui.editor === "function") {
		// Поле с предзаполненным черновиком: видно, что будет записано.
		answer = await ctx.ui.editor(title, draft);
	} else {
		answer = await ctx.ui.input(
			"Сообщение коммита (git commit -m; пусто = предложенное)",
			draft,
		);
	}
	if (answer === undefined) {
		return {
			id: "commit",
			status: "skipped",
			text: "коммит: пропущено — ввод сообщения отменён",
		};
	}
	const message = answer.trim() || draft;
	// Явный `:(exclude)`-pathspec заставляет git падать «paths are ignored»,
	// если runtime-файлы перечислены в .gitignore (тест GridSnap 2026-11-26).
	// Поэтому добавляем всё и снимаем runtime-пути с индекса.
	const add = git(ctx.cwd, ["add", "-A", "--", "."], 60_000);
	if (!add.ok) {
		return { id: "commit", status: "failed", text: `коммит: ошибка — git add: ${add.error}` };
	}
	for (const path of RUNTIME_PATHS) {
		git(ctx.cwd, ["reset", "-q", "--", path], 10_000);
	}
	const stagedRuntime = git(ctx.cwd, [
		"diff",
		"--cached",
		"--name-only",
		"--",
		...RUNTIME_PATHS,
	]);
	if (stagedRuntime.ok && stagedRuntime.out) {
		git(ctx.cwd, ["reset", "-q"], 10_000);
		return {
			id: "commit",
			status: "failed",
			text: `коммит: ошибка — runtime-файлы в индексе, отменено (${stagedRuntime.out.replace(/\n/g, ", ")})`,
		};
	}
	const commit = git(ctx.cwd, ["commit", "-m", message], 120_000);
	if (!commit.ok) {
		return { id: "commit", status: "failed", text: `коммит: ошибка — git commit: ${commit.error}` };
	}
	const head = git(ctx.cwd, ["rev-parse", "--short", "HEAD"]);
	return {
		id: "commit",
		status: "done",
		text: `коммит: создан ${head.ok ? head.out : "OK"} — ${message}`,
	};
}

/** Находит worktree, в котором checked out `main`. */
function mainWorktree(cwd: string): string | null {
	const list = git(cwd, ["worktree", "list", "--porcelain"]);
	if (!list.ok) return null;
	let path: string | null = null;
	for (const line of list.out.split("\n")) {
		if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
		else if (line === "branch refs/heads/main" && path) return path;
		else if (line === "") path = null;
	}
	return null;
}

/** `git push` в upstream текущей ветки: без `--force`, ошибка не форсится. */
function performPush(cwd: string): HandoffActionReport {
	const upstream = git(cwd, [
		"rev-parse",
		"--abbrev-ref",
		"--symbolic-full-name",
		"@{u}",
	]);
	if (!upstream.ok || !upstream.out) {
		return {
			id: "push",
			status: "failed",
			text: "push: ошибка — у ветки нет upstream",
		};
	}
	const ahead = git(cwd, ["rev-list", "--count", "@{u}..HEAD"]);
	const count = Number(ahead.out);
	if (!ahead.ok || !Number.isFinite(count)) {
		return {
			id: "push",
			status: "failed",
			text: "push: ошибка — не удалось посчитать коммиты",
		};
	}
	if (count === 0) {
		return { id: "push", status: "skipped", text: "push: пропущено — нечего пушить" };
	}
	const result = git(cwd, ["push"], 120_000);
	if (!result.ok) {
		const reason = result.error || result.out || "git push";
		return { id: "push", status: "failed", text: `push: ошибка — ${reason}` };
	}
	return {
		id: "push",
		status: "done",
		text: `push: ${commits(count)} в ${upstream.out}`,
	};
}

/** Fast-forward merge текущей ветки в main worktree; без force. */
function performMerge(cwd: string): HandoffActionReport {
	const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (!branch.ok || !branch.out || branch.out === "HEAD") {
		return {
			id: "merge",
			status: "failed",
			text: "merge: ошибка — не удалось определить ветку",
		};
	}
	if (branch.out === "main") {
		return { id: "merge", status: "skipped", text: "merge: пропущено — уже на main" };
	}
	const target = mainWorktree(cwd);
	if (!target) {
		return { id: "merge", status: "failed", text: "merge: ошибка — main worktree не найден" };
	}
	const status = git(target, [
		"status",
		"--porcelain",
		"--",
		".",
		...RUNTIME_EXCLUDES,
	]);
	if (!status.ok) {
		return {
			id: "merge",
			status: "failed",
			text: "merge: ошибка — main worktree не читается",
		};
	}
	if (status.out) {
		return { id: "merge", status: "failed", text: "merge: ошибка — main worktree грязный" };
	}
	const ff = git(target, ["merge-base", "--is-ancestor", "main", branch.out]);
	if (!ff.ok) {
		return {
			id: "merge",
			status: "failed",
			text: "merge: ошибка — не fast-forward, смерджи вручную",
		};
	}
	const merge = git(target, ["merge", "--ff-only", branch.out], 120_000);
	if (!merge.ok) {
		return {
			id: "merge",
			status: "failed",
			text: `merge: ошибка — ${merge.error || "git merge"}`,
		};
	}
	const head = git(target, ["rev-parse", "--short", "HEAD"]);
	return { id: "merge", status: "done", text: `merge: main @ ${head.ok ? head.out : "OK"}` };
}

/** Запускает npm-скрипт без блокировки event loop TUI. */
function runNpmScript(
	cwd: string,
	name: string,
): Promise<{ ok: boolean; text: string }> {
	const { promise, resolve } = Promise.withResolvers<{ ok: boolean; text: string }>();
	let settled = false;
	let timer: NodeJS.Timeout | undefined;
	const finish = (ok: boolean, text: string): void => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		resolve({ ok, text });
	};
	const child = spawn("npm", ["run", name], {
		cwd,
		env: { ...process.env, CI: "1" },
		stdio: "ignore",
	});
	timer = setTimeout(() => {
		child.kill("SIGKILL");
		finish(false, `${name} FAIL (timeout)`);
	}, 300_000);
	child.on("error", (error) => finish(false, `${name} FAIL (${error.message})`));
	child.on("close", (code) =>
		finish(
			code === 0,
			code === 0 ? `${name} OK` : `${name} FAIL (exit ${code})`,
		),
	);
	return promise;
}

/** Запускает scripts.test и scripts.typecheck из package.json, если они есть. */
async function performChecks(cwd: string): Promise<HandoffActionReport> {
	let text: string;
	try {
		text = readFileSync(resolve(cwd, "package.json"), "utf8");
	} catch (error) {
		const code =
			error &&
			typeof error === "object" &&
			"code" in error &&
			typeof error.code === "string"
				? error.code
				: null;
		if (code === "ENOENT") {
			return {
				id: "checks",
				status: "skipped",
				text: "проверки: пропущено — package.json нет, тесты не запускались",
			};
		}
		const message = error instanceof Error ? error.message : String(error);
		return {
			id: "checks",
			status: "failed",
			text: `проверки: ошибка — package.json не читается: ${message}`,
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {
			id: "checks",
			status: "failed",
			text: "проверки: ошибка — package.json битый JSON",
		};
	}
	let raw: unknown = null;
	if (parsed && typeof parsed === "object" && "scripts" in parsed) {
		raw = parsed.scripts;
	}
	const scripts: Record<string, string> = {};
	if (raw && typeof raw === "object") {
		for (const [name, command] of Object.entries(raw)) {
			if (typeof command === "string") scripts[name] = command;
		}
	}
	const names = ["test", "typecheck"].filter((name) => name in scripts);
	if (names.length === 0) {
		return {
			id: "checks",
			status: "skipped",
			text: "проверки: пропущено — нет scripts.test/typecheck",
		};
	}
	const results: string[] = [];
	let ok = true;
	for (const name of names) {
		const result = await runNpmScript(cwd, name);
		ok = ok && result.ok;
		results.push(result.text);
	}
	return {
		id: "checks",
		status: ok ? "done" : "failed",
		text: `проверки: ${ok ? "выполнено" : "ошибка"} — ${results.join("; ")}`,
	};
}

async function runHandoffActions(
	ctx: ExtensionContext,
	actions: readonly HandoffAction[],
	selected: ReadonlySet<string>,
): Promise<HandoffActionReport[]> {
	const reports: HandoffActionReport[] = [];
	let checksFailed = false;
	let commitFailed = false;
	const start: Record<HandoffAction["id"], string> = {
		checks: "PREFLIGHT: запускаю npm test/typecheck…",
		commit: "PREFLIGHT: git add + git commit…",
		merge: "PREFLIGHT: git merge --ff-only…",
		push: "PREFLIGHT: git push…",
	};
	for (const action of actions) {
		if (!selected.has(action.id)) continue;
		if (action.id === "commit" && checksFailed) {
			reports.push({
				id: action.id,
				status: "skipped",
				text: "коммит: пропущено — проверки не прошли",
			});
			continue;
		}
		if (action.id === "merge" && (checksFailed || commitFailed)) {
			reports.push({
				id: action.id,
				status: "skipped",
				text: "merge: пропущено — предыдущий шаг не завершён",
			});
			continue;
		}
		if (action.id === "push" && (checksFailed || commitFailed)) {
			reports.push({
				id: action.id,
				status: "skipped",
				text: "push: пропущено — предыдущий шаг не завершён",
			});
			continue;
		}
		notify(ctx, start[action.id], "info");
		const report =
			action.id === "checks"
				? await performChecks(ctx.cwd)
				: action.id === "commit"
					? await performCommit(ctx)
					: action.id === "merge"
						? performMerge(ctx.cwd)
						: performPush(ctx.cwd);
		reports.push(report);
		if (action.id === "checks") checksFailed = report.status === "failed";
		if (action.id === "commit") commitFailed = report.status === "failed";
	}
	return reports;
}

/** Краткий вид контекста: `42% (420k/1000k)`. */
function usageText(usage: {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}): string {
	const percent =
		usage.percent === null
			? "?"
			: `${usage.percent < 10 ? usage.percent.toFixed(1) : Math.round(usage.percent)}%`;
	const tokens = usage.tokens === null ? "?" : `${Math.round(usage.tokens / 1000)}k`;
	const window = `${Math.round(usage.contextWindow / 1000)}k`;
	return `${percent} (${tokens}/${window})`;
}

/** Есть ли UI и главный агент: в sub/print/json ничего не показываем. */
function isMainTui(ctx: ExtensionContext): boolean {
	return ctx.mode === "tui" && ctx.agent.kind === "main";
}

/**
 * Сериализовать read-modify-write session info между процессами в одном cwd.
 * Lock-dir удаляется в finally; зависший lock старше 2 с перехватывается.
 */
function withSessionLock<T>(
	cwd: string,
	fn: (lockDir: string) => T,
): T | null {
	const lockPath = resolve(cwd, SESSION_LOCK);
	const deadline = Date.now() + 500;
	for (;;) {
		try {
			mkdirSync(lockPath);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
			try {
				if (Date.now() - statSync(lockPath).mtimeMs > 2_000) {
					rmSync(lockPath, { recursive: true, force: true });
					continue;
				}
			} catch {
				continue; // lock исчез между mkdir и stat
			}
			if (Date.now() >= deadline) return null;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
		}
	}
	try {
		return fn(lockPath);
	} finally {
		rmSync(lockPath, { recursive: true, force: true });
	}
}

/**
 * Дописать запись текущей сессии, не затирая другие живые сессии в этом cwd:
 * файл — карта `{sessions}`, мёртвые pid вычищаются при записи.
 */
function writeSessionInfo(
	ctx: ExtensionContext,
	settings?: WorkflowSettings,
): void {
	if (!isMainTui(ctx)) return;
	if (settings?.workflowMode === "off") return;
	const path = resolve(ctx.cwd, SESSION_INFO);
	const next = {
		terminal: process.env.ORCA_TERMINAL_HANDLE?.trim() || null,
		sessionFile: ctx.sessionManager.getSessionFile() ?? null,
		cwd: ctx.cwd,
		pid: process.pid,
		updatedAt: new Date().toISOString(),
	};
	try {
		withSessionLock(ctx.cwd, (lockDir) => {
			let current: unknown = null;
			try {
				current = JSON.parse(readFileSync(path, "utf8"));
			} catch {
				// нет файла или битый JSON — начинаем с пустой карты
			}
			const sessions = mergeSessionInfo(parseSessionInfo(current), next);
			// Атомарно: supervisor не должен прочитать полузаписанный JSON.
			const temp = resolve(lockDir, "session.json");
			writeFileSync(temp, `${JSON.stringify({ sessions }, null, 2)}\n`);
			renameSync(temp, path);
		});
	} catch {
		// readonly cwd или нет прав — supervisor просто не найдёт файл
	}
}

/** Marker относится к текущей сессии? Без sessionFile — считаем pending. */
function handoffMarkerPending(cwd: string, sessionFile: string | null): boolean {
	const path = resolve(cwd, REQUEST_MARKER);
	if (!existsSync(path)) return false;
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as {
			sessionFile?: unknown;
		};
		if (
			typeof raw.sessionFile === "string" &&
			sessionFile &&
			raw.sessionFile !== sessionFile
		) {
			return false;
		}
		return true;
	} catch {
		return true;
	}
}

/** Supervisor жив: lock есть, owner.pid существует и lock — от этого каталога. */
function supervisorAlive(cwd: string): boolean {
	try {
		const raw = JSON.parse(
			readFileSync(
				resolve(cwd, ".omp-handoff-supervisor.lock", "owner.json"),
				"utf8",
			),
		) as { pid?: unknown; dir?: unknown };
		if (
			typeof raw.pid !== "number" ||
			!Number.isInteger(raw.pid) ||
			raw.pid <= 0
		) {
			return false;
		}
		// Lock скопированного/подмонтированного каталога не подтверждает
		// supervisor для текущего cwd.
		if (typeof raw.dir === "string" && resolve(raw.dir) !== resolve(cwd)) {
			return false;
		}
		process.kill(raw.pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Короткий статус текущей задачи orchestrator. */
function taskStatusLabel(status: string): string {
	if (status === "running") return "run";
	if (status === "verified") return "verify";
	if (status === "reviewed") return "review";
	if (status === "failed") return "fail";
	return status;
}

/** `T2 verify`, только пока run.active и есть current. */
function orchestratorTaskText(cwd: string): string | undefined {
	try {
		const state = readState(resolve(cwd, ORCHESTRATOR_STATE_FILE));
		if (!state?.run?.active || !state.current) return undefined;
		return `${state.current.id} ${taskStatusLabel(state.current.status)}`;
	} catch {
		return undefined;
	}
}

/** Текст ключа `workflow`: режим, supervisor, задача, handoff. */
function workflowStatusText(
	settings: WorkflowSettings,
	options: {
		handoffPending: boolean;
		supervisorOff: boolean;
		task: string | undefined;
	},
): string | undefined {
	if (settings.workflowMode === "off") return undefined;
	if (!settings.statusEnabled) return undefined;
	const parts: string[] = [];
	if (settings.workflowMode === "yoda") parts.push("YODA");
	else if (settings.workflowMode === "yoda-supervised") parts.push("YODA-SUP");
	if (options.supervisorOff) parts.push("SUP OFF");
	if (options.task) parts.push(options.task);
	if (options.handoffPending) parts.push("⚠ HANDOFF");
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** UI-вызовы не должны ронять обработчик. */
function notify(
	ctx: ExtensionContext,
	text: string,
	level: "info" | "warning",
): void {
	try {
		ctx.ui.notify(text, level);
	} catch {
		// контекст без UI
	}
}

export default function contextGuard(pi: ExtensionAPI): void {
	let settings: WorkflowSettings = resolveSettings({}, process.env);
	let settingsCwd: string | null = null;

	const refreshSettings = async (
		ctx: ExtensionContext,
		force = false,
	): Promise<void> => {
		if (!force && settingsCwd === ctx.cwd) return;
		settings = await loadWorkflowSettings(ctx.cwd, process.env);
		settingsCwd = ctx.cwd;
	};

	let warned = false;
	let suggested = false;
	let autoCompacted = false;
	let compacting = false;
	let handoffRequested = false;
	let handoffRequestCount = 0;
	let handoffTurnsSinceRequest = 0;
	let handoffCooldownUntil = 0;
	/** Измеренный `usage.cost.total` текущей сессии и offsets его JSONL. */
	let sessionSpendUsd = 0;
	let spendOffsets: Record<string, number> = {};
	let spendSessionFile: string | null = null;
	let supervisorWarned = false;
	let terminalWarned = false;

	/** После падения ниже warning пороги снова активны. */
	const resetIfBelow = (percent: number): void => {
		if (percent < settings.contextWarnPercent) {
			warned = false;
			suggested = false;
			autoCompacted = false;
		}
	};

	const readUsage = (ctx: ExtensionContext) => {
		try {
			const usage = ctx.getContextUsage();
			if (!usage || usage.percent === null) return null;
			return usage;
		} catch {
			return null;
		}
	};

	/** Обнулить spend на границе сессии; offsets принадлежат прошлому файлу. */
	const resetSpend = (ctx: ExtensionContext): void => {
		sessionSpendUsd = 0;
		spendOffsets = {};
		try {
			spendSessionFile = ctx.sessionManager.getSessionFile() ?? null;
		} catch {
			spendSessionFile = null;
		}
	};

	/**
	 * Пересчитать total с нуля: компакция/перезапись делает byte offsets
	 * недействительными. Файла нет или он не читается — уже измеренный spend
	 * сохраняется, а не обнуляется.
	 */
	const recomputeSpend = (sessionFile: string): void => {
		if (!existsSync(sessionFile)) return;
		const fresh = readSessionCost(sessionFile, {});
		if (!fresh.available) return;
		sessionSpendUsd = fresh.deltaUsd;
		spendOffsets = fresh.offsets;
	};

	/**
	 * Дочитать только новый хвост session JSONL (offsets из прошлого чтения).
	 * Если файл усечён/перезаписан (`restarted`) или запрошен `recompute` —
	 * total считается заново, а не прибавляется к накопленному. Файла нет
	 * или он не читается — spend не меняется.
	 */
	const refreshSpend = (ctx: ExtensionContext, recompute = false): void => {
		if (settings.handoffAtSpendUsd === null) return;
		let sessionFile: string | null = null;
		try {
			sessionFile = ctx.sessionManager.getSessionFile() ?? null;
		} catch {
			sessionFile = null;
		}
		if (sessionFile !== spendSessionFile) resetSpend(ctx);
		if (sessionFile === null) return;
		if (recompute) {
			recomputeSpend(sessionFile);
			return;
		}
		const read = readSessionCost(sessionFile, spendOffsets);
		if (!read.available) return;
		if (read.restarted) {
			recomputeSpend(sessionFile);
			return;
		}
		spendOffsets = read.offsets;
		if (read.deltaUsd > 0) sessionSpendUsd += read.deltaUsd;
	};

	/** Обновить ключ `workflow`: режим + ожидаемый handoff. */
	const updateStatus = (ctx: ExtensionContext): void => {
		if (!isMainTui(ctx)) return;
		const usage = readUsage(ctx);
		const pending =
			(settings.handoffAtPercent !== null &&
				usage !== null &&
				usage.percent !== null &&
				usage.percent >= settings.handoffAtPercent) ||
			(settings.handoffAtSpendUsd !== null &&
				sessionSpendUsd >= settings.handoffAtSpendUsd) ||
			handoffMarkerPending(
				ctx.cwd,
				ctx.sessionManager.getSessionFile() ?? null,
			);
		const text = workflowStatusText(settings, {
			handoffPending: pending,
			supervisorOff:
				settings.workflowMode === "yoda-supervised" && !supervisorAlive(ctx.cwd),
			task: orchestratorTaskText(ctx.cwd),
		});
		try {
			ctx.ui.setStatus(STATUS_KEY, text);
		} catch {
			// старый хост без статус-строки
		}
	};

	/** Warning на 35% и предложение HANDOFF на 50%, по одному разу. */
	const checkWarnings = (ctx: ExtensionContext): void => {
		if (!isMainTui(ctx)) return;
		if (settings.workflowMode === "off") return;
		const usage = readUsage(ctx);
		if (!usage) return;
		resetIfBelow(usage.percent);

		if (usage.percent >= settings.contextSuggestPercent && !suggested) {
			suggested = true;
			warned = true;
			notify(
				ctx,
				`Контекст ${usageText(usage)}: пора HANDOFF. Обнови HANDOFF.md, затем /handoff.`,
				"warning",
			);
			return;
		}
		if (usage.percent >= settings.contextWarnPercent && !warned) {
			warned = true;
			notify(
				ctx,
				`Контекст ${usageText(usage)}: планируй HANDOFF — обнови HANDOFF.md и сожми.`,
				"warning",
			);
		}
	};

	/**
	 * На пороге handoff предупредить, что supervisor/terminal handle не готовы:
	 * иначе marker останется лежать, а сессия молча остановится.
	 */
	const warnHandoffPrereqs = (ctx: ExtensionContext): void => {
		const supervisorRequired =
			settings.workflowMode === "yoda-supervised" &&
			settings.supervisorEnabled &&
			settings.orcaEnabled;
		if (!supervisorRequired) return;
		if (supervisorAlive(ctx.cwd)) {
			supervisorWarned = false;
		} else if (!supervisorWarned) {
			supervisorWarned = true;
			notify(
				ctx,
				"Supervisor не запущен: automatic handoff не сработает. " +
					`Запусти \`OMP_YODA_DIR=${ctx.cwd} bin/omp-yoda\`.`,
				"warning",
			);
		}
		if ((process.env.ORCA_TERMINAL_HANDLE?.trim() || null) === null && !terminalWarned) {
			terminalWarned = true;
			notify(
				ctx,
				"terminal handle нет — automatic handoff не сработает. Запусти OMP из Orca.",
				"warning",
			);
		}
	};

	const resetHandoff = (): void => {
		handoffRequested = false;
		handoffRequestCount = 0;
		handoffTurnsSinceRequest = 0;
		handoffCooldownUntil = 0;
		supervisorWarned = false;
	};

	/**
	 * На пороге handoff просим агента завершить задачу, обновить state и
	 * поставить marker. Новую сессию отсюда начать нельзя — это делает
	 * supervisor через /handoff-new. Если marker не появился за
	 * HANDOFF_RETRY_TURNS ходов, запрос повторяется (до HANDOFF_MAX_REQUESTS)
	 * с предупреждением, чтобы сессия не зависла молча.
	 */
	const checkHandoff = async (ctx: ExtensionContext): Promise<void> => {
		if (!isMainTui(ctx)) return;
		if (
			settings.handoffAtPercent === null &&
			settings.handoffAtSpendUsd === null
		) {
			resetHandoff();
			return;
		}
		// Свежий spend — перед каждой проверкой; читается только новый хвост.
		refreshSpend(ctx);
		const usage = readUsage(ctx);
		const contextTriggered =
			settings.handoffAtPercent !== null &&
			usage !== null &&
			usage.percent !== null &&
			usage.percent >= settings.handoffAtPercent;
		const spendTriggered =
			settings.handoffAtSpendUsd !== null &&
			sessionSpendUsd >= settings.handoffAtSpendUsd;
		if (!contextTriggered && !spendTriggered) {
			resetHandoff();
			return;
		}
		warnHandoffPrereqs(ctx);

		const sessionFile = ctx.sessionManager.getSessionFile() ?? null;
		// Marker уже стоит: handoff принят, ждём supervisor.
		if (handoffMarkerPending(ctx.cwd, sessionFile)) return;

		const retryDue =
			handoffRequested &&
			handoffRequestCount < HANDOFF_MAX_REQUESTS &&
			handoffTurnsSinceRequest >= HANDOFF_RETRY_TURNS;
		if (handoffRequested && !retryDue) return;
		// Cooldown гасит новый запрос, но не повтор с собственным дедлайном.
		if (!retryDue && Date.now() < handoffCooldownUntil) return;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

		// Запись должна существовать до того, как агент поставит marker.
		writeSessionInfo(ctx, settings);
		handoffRequested = true;
		handoffTurnsSinceRequest = 0;
		handoffCooldownUntil = Date.now() + settings.handoffCooldownSeconds * 1000;
		const markerReason = contextTriggered ? "context" : "spend";
		const marker = JSON.stringify({ reason: markerReason, sessionFile });
		const tree = workingTreeSnapshot(ctx.cwd);
		const spendText =
			settings.handoffAtSpendUsd === null
				? null
				: `spend ${formatUsd(sessionSpendUsd)} из порога ${formatUsd(settings.handoffAtSpendUsd)}`;
		const contextText = usage === null ? null : `контекст ${usageText(usage)}`;
		const triggerText = [
			spendTriggered ? spendText : null,
			// Контекст — справочно, если доступен, даже когда сработал spend.
			contextText,
		]
			.filter((part): part is string => part !== null)
			.join("; ");
		const text =
			`HANDOFF: ${triggerText}. Заверши текущую задачу, обнови HANDOFF.md, ` +
			`запиши .omp-handoff-request.json с ${marker} и заверши ход. ` +
			(tree ? `${tree} ` : "") +
			"Не начинай новую задачу.";
		try {
			await pi.sendUserMessage(text);
			handoffRequestCount += 1;
			if (retryDue) {
				notify(
					ctx,
					`HANDOFF запрошен ${handoffRequestCount} раз, marker не появился. ` +
						"Проверь supervisor.",
					"warning",
				);
			}
		} catch (error) {
			handoffRequested = false;
			handoffTurnsSinceRequest = 0;
			const message = error instanceof Error ? error.message : String(error);
			notify(ctx, `Не удалось запросить HANDOFF: ${message}`, "warning");
		}
	};

	/**
	 * Авто-компакция на пороге только после завершения хода и без очереди.
	 * Пока handoff ещё может сработать, компакция ждёт: остались повторы или
	 * marker уже у живого supervisor. После исчерпания запросов fallback
	 * обязан сработать, иначе зависший handoff блокирует компакцию навсегда.
	 */
	const checkAuto = async (ctx: ExtensionContext): Promise<void> => {
		if (!isMainTui(ctx) || settings.autoCompactPercent === null) return;
		const markerPending = handoffMarkerPending(
			ctx.cwd,
			ctx.sessionManager.getSessionFile() ?? null,
		);
		const handoffActive =
			handoffRequested &&
			(markerPending
				? settings.workflowMode === "yoda-supervised" &&
					supervisorAlive(ctx.cwd)
				: handoffRequestCount < HANDOFF_MAX_REQUESTS);
		if (handoffActive) return;
		const usage = readUsage(ctx);
		if (!usage) return;
		resetIfBelow(usage.percent);
		if (usage.percent < settings.autoCompactPercent || autoCompacted || compacting) return;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

		autoCompacted = true;
		compacting = true;
		notify(
			ctx,
			`Контекст ${usageText(usage)}: авто-компакция с сохранением решений.`,
			"info",
		);
		try {
			// OMP 19.1 принимает строку инструкций напрямую.
			await ctx.compact(HANDOFF_INSTRUCTIONS);
			// session_compact мог сбросить флаг; не запускаем второй проход сразу.
			autoCompacted = true;
		} catch (error) {
			autoCompacted = false;
			const message = error instanceof Error ? error.message : String(error);
			notify(ctx, `Авто-компакция не удалась: ${message}`, "warning");
		} finally {
			compacting = false;
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		await refreshSettings(ctx, true);
		warned = false;
		suggested = false;
		autoCompacted = false;
		compacting = false;
		resetHandoff();
		resetSpend(ctx);
		try {
			// Дочерняя сессия после /handoff-new не должна сразу уйти в новый handoff.
			if (ctx.sessionManager.getHeader()?.parentSession) {
				handoffCooldownUntil = Date.now() + settings.handoffCooldownSeconds * 1000;
			}
		} catch {
			// старый runner без getHeader
		}
		writeSessionInfo(ctx, settings);
		checkWarnings(ctx);
		updateStatus(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refreshSettings(ctx);
		checkWarnings(ctx);
		if (handoffRequested) handoffTurnsSinceRequest += 1;
		await checkHandoff(ctx);
		await checkAuto(ctx);
		updateStatus(ctx);
	});

	pi.on("agent_end", async (event, ctx) => {
		// Авто-продолжение или фоновая работа: это не финальная точка.
		if (event.willContinue || event.awaitingAsyncWork) return;
		await refreshSettings(ctx);
		await checkHandoff(ctx);
		await checkAuto(ctx);
		updateStatus(ctx);
	});

	pi.on("auto_compaction_start", async () => {
		compacting = true;
	});

	pi.on("auto_compaction_end", async (event, ctx) => {
		compacting = false;
		if (event.errorMessage) {
			autoCompacted = false;
			if (settings.workflowMode !== "off") {
				notify(ctx, `Компакция не удалась: ${event.errorMessage}`, "warning");
			}
		}
	});

	pi.on("session_compact", async (_event, ctx) => {
		compacting = false;
		warned = false;
		suggested = false;
		autoCompacted = false;
		resetHandoff();
		// Компакция может переписать JSONL на месте, не уменьшая размер:
		// offsets недействительны, total считается заново до статуса.
		refreshSpend(ctx, true);
		if (settings.workflowMode !== "off") {
			notify(ctx, "Контекст сжат.", "info");
		}
		updateStatus(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await refreshSettings(ctx, true);
		warned = false;
		suggested = false;
		autoCompacted = false;
		compacting = false;
		resetHandoff();
		resetSpend(ctx);
		writeSessionInfo(ctx, settings);
		checkWarnings(ctx);
		updateStatus(ctx);
	});

	pi.registerCommand("handoff-preflight", {
		description: "Действия и проверка готовности к /handoff-new: git, state, marker",
		handler: async (args, ctx) => {
			if (!isMainTui(ctx)) return;
			const stateFile = args.trim() || STATE_FILE;
			const sessionFile = ctx.sessionManager.getSessionFile() ?? null;
			const symbols = preflightSymbols(ctx);
			const columns = terminalColumns();
			const initial = runPreflight(ctx.cwd, sessionFile, stateFile);
			if (!ctx.ui.askDialog) {
				notify(
					ctx,
					formatPreflight(initial, "состояние", { symbols, columns }),
					initial.ready ? "info" : "warning",
				);
				return;
			}
			notify(
				ctx,
				formatPreflight(initial, "состояние до действий", { symbols, columns }),
				initial.ready ? "info" : "warning",
			);
			const available = actionsForPreflight(initial);
			const outcome = await askHandoffActions(ctx, available);
			if (outcome.status === "cancelled") {
				notify(ctx, "PREFLIGHT отменён: действия не выбраны.", "info");
				return;
			}
			if (outcome.status === "skipped") return;
			if (outcome.selected.size > 0) {
				notify(ctx, "PREFLIGHT: выполняю выбранные действия…", "info");
			}
			const actions = await runHandoffActions(
				ctx,
				available,
				outcome.selected,
			);
			const report = runPreflight(ctx.cwd, sessionFile, stateFile);
			const failed = actions.some((action) => action.status === "failed");
			notify(
				ctx,
				formatPreflightResult(report, actions, { symbols, columns }),
				failed || !report.ready ? "warning" : "info",
			);
		},
	});

	pi.registerCommand("handoff-new", {
		description: "Начать новую сессию после обновления HANDOFF.md",
		handler: async (args, ctx) => {
			if (!isMainTui(ctx)) return;
			const stateName = args.trim() || STATE_FILE;
			const statePath = resolve(ctx.cwd, stateName);
			if (!existsSync(statePath)) {
				notify(ctx, `HANDOFF не найден: ${statePath}. Сначала обнови state.`, "warning");
				return;
			}

			const usage = readUsage(ctx);
			notify(
				ctx,
				`HANDOFF-NEW${usage ? ` ${usageText(usage)}` : ""}: жду idle и открываю новую сессию.`,
				"info",
			);
			await ctx.waitForIdle();
			const parentSession = ctx.sessionManager.getSessionFile();
			try {
				const result = await ctx.newSession({
					...(parentSession ? { parentSession } : {}),
					setup: async (sessionManager) => {
						sessionManager.appendCustomMessageEntry(
							"handoff",
							handoffMessage(settings.continuePrompt, stateName, statePath),
							true,
						);
					},
				});
				if (result.cancelled) notify(ctx, "HANDOFF-NEW отменён.", "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notify(ctx, `HANDOFF-NEW не удался: ${message}`, "warning");
			}
		},
	});

	// `/handoff` не регистрируем: имя занято builtin OMP (`/compact handoff`),
	// а extension-команда с builtin-именем отбрасывается хостом с warning.
}
