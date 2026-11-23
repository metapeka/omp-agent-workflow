/**
 * context-guard — предупреждения о заполнении контекста и команда `/handoff`.
 *
 * Не добавляет свой сегмент в status line: native `context_pct` уже показывает
 * процент. Задача расширения — предупредить заранее и дать детерминированную
 * команду сжатия с инструкциями сохранить решения и следующие шаги.
 *
 * Пороги по умолчанию: 35% warning, 50% предложение HANDOFF, 60% авто-компакция
 * после завершения хода. Переопределяются через OMP_CONTEXT_WARN,
 * OMP_CONTEXT_SUGGEST, OMP_CONTEXT_AUTO (число или `off`).
 *
 * Установка: `omp plugin link <каталог>` или копия в
 * `~/.omp/agent/extensions/context-guard.ts` (одно из двух).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

/** Сжать контекст, не потеряв цель, решения, файлы и проверки. */
const HANDOFF_INSTRUCTIONS =
	"Сохрани цель задачи, текущее состояние, принятые решения, изменённые файлы, " +
	"выполненные проверки, блокеры и следующие шаги. Сырые логи и длинные выводы " +
	"инструментов отбрось.";

const SESSION_INFO = ".omp-handoff-session.json";
const STATE_FILE = "HANDOFF.md";
const REQUEST_MARKER = ".omp-handoff-request.json";

/** Лимит state-файла в новой сессии: 64k символов ≈ 16k токенов. */
const HANDOFF_STATE_LIMIT = 64_000;

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
): { ok: boolean; out: string; error: string } {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		timeout: 10_000,
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

function commits(n: number): string {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return `${n} коммит`;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} коммита`;
	return `${n} коммитов`;
}

/** Read-only проверка перед `/handoff-new`: ничего не пишет и не чинит. */
export function runPreflight(
	cwd: string,
	sessionFile: string | null,
	stateFile = STATE_FILE,
): PreflightReport {
	const checks: PreflightCheck[] = [];
	const add = (status: PreflightStatus, text: string): void => {
		checks.push({ status, text });
	};

	if (existsSync(resolve(cwd, stateFile))) add("pass", `${stateFile}: есть`);
	else add("fail", `${stateFile}: нет — сначала обнови state`);

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

	const dirty = git(cwd, ["status", "--porcelain"]);
	if (!dirty.ok) {
		add("warn", "git status: не удалось прочитать");
	} else if (!dirty.out) {
		add("pass", "git: чисто");
	} else {
		const lines = dirty.out.split("\n");
		const names = lines.slice(0, 3).map((line) => line.slice(3).trim()).join(", ");
		const rest = lines.length > 3 ? ` и ещё ${lines.length - 3}` : "";
		add("fail", `git: изменено файлов ${lines.length} — ${names}${rest}`);
	}

	const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const branchName = branch.ok ? branch.out : "";
	if (!branchName || branchName === "HEAD") {
		add("fail", "git: detached HEAD — переключись на ветку");
	} else {
		const head = git(cwd, ["rev-parse", "--short", "HEAD"]);
		add("pass", `ветка: ${branchName}${head.ok ? ` @ ${head.out}` : ""}`);
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
					add("fail", `upstream ${upstream.out}: не запушено ${commits(ahead)}`);
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
		const dest = git(cwd, ["rev-parse", "--verify", "--quiet", "origin/main"]).ok
			? "origin/main"
			: "main";
		if (git(cwd, ["rev-parse", "--verify", "--quiet", dest]).ok) {
			if (git(cwd, ["merge-base", "--is-ancestor", "HEAD", dest]).ok)
				add("pass", `ветка влита в ${dest}`);
			else add("warn", `ветка не влита в ${dest} — смерджи до handoff`);
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

export function formatPreflight(report: PreflightReport): string {
	const verdict = report.ready
		? "preflight: OK — можно /handoff-new"
		: "preflight: блокеры — /handoff-new рано";
	const icons: Record<PreflightStatus, string> = {
		pass: "✓",
		warn: "⚠",
		fail: "✗",
	};
	return [
		verdict,
		...report.checks.map((c) => `${icons[c.status]} ${c.text}`),
	].join("\n");
}

/** Пункты, которые человек отмечает перед handoff; проверки ниже остаются автоматическими. */
const HANDOFF_CHECKLIST: ReadonlyArray<{
	id: string;
	label: string;
	question: string;
}> = [
	{
		id: "task",
		label: "задача завершена",
		question: "Текущая задача завершена — сессию можно закрывать?",
	},
	{
		id: "commits",
		label: "изменения закоммичены",
		question: "Все изменения закоммичены?",
	},
	{
		id: "merge",
		label: "ветка влита в main",
		question: "Ветка влита в main?",
	},
	{
		id: "worktree",
		label: "worktree убран",
		question: "Worktree и временные файлы убраны?",
	},
	{
		id: "state",
		label: "HANDOFF.md обновлён",
		question: "HANDOFF.md обновлён под следующую сессию?",
	},
	{
		id: "checks",
		label: "тесты и typecheck прошли",
		question: "npm test и typecheck прошли?",
	},
];

type ChecklistOutcome =
	| { status: "skipped" }
	| { status: "cancelled" }
	| { status: "answered"; pending: readonly string[] };

/**
 * Чек-лист перед handoff: один диалог с вопросами Да/Нет.
 * Без `askDialog` (старый хост, headless) меню пропускается: проверки не
 * блокируются, таблица выводится как раньше.
 */
async function askHandoffChecklist(
	ctx: ExtensionContext,
): Promise<ChecklistOutcome> {
	const askDialog = ctx.ui.askDialog;
	if (!askDialog) return { status: "skipped" };
	let result: ExtensionAskDialogResult | undefined;
	try {
		result = await askDialog(
			HANDOFF_CHECKLIST.map((item, index) => ({
				id: item.id,
				header: `handoff ${index + 1}/${HANDOFF_CHECKLIST.length}`,
				question: item.question,
				options: [
					{ label: "Да", description: "Пункт выполнен" },
					{ label: "Нет", description: "Пункт остаётся в чек-листе" },
				],
				recommended: 0,
			})),
		);
	} catch {
		return { status: "skipped" };
	}
	if (!result || result.kind !== "submit") return { status: "cancelled" };
	const done = new Set(
		result.results
			.filter((item) => !item.timedOut && item.selectedOptions[0] === "Да")
			.map((item) => item.id),
	);
	return {
		status: "answered",
		pending: HANDOFF_CHECKLIST.filter((item) => !done.has(item.id)).map(
			(item) => item.label,
		),
	};
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

/** Файл для supervisor: terminal handle и текущая сессия. */
function writeSessionInfo(ctx: ExtensionContext): void {
	if (!isMainTui(ctx)) return;
	try {
		const info = {
			terminal: process.env.ORCA_TERMINAL_HANDLE ?? null,
			sessionFile: ctx.sessionManager.getSessionFile() ?? null,
			cwd: ctx.cwd,
			pid: process.pid,
			updatedAt: new Date().toISOString(),
		};
		writeFileSync(resolve(ctx.cwd, SESSION_INFO), `${JSON.stringify(info, null, 2)}\n`);
	} catch {
		// readonly cwd или нет прав — supervisor просто не найдёт файл
	}
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
	let handoffCooldownUntil = 0;

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

	/** Warning на 35% и предложение HANDOFF на 50%, по одному разу. */
	const checkWarnings = (ctx: ExtensionContext): void => {
		if (!isMainTui(ctx)) return;
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
	 * На пороге handoff просим агента завершить задачу, обновить state и
	 * поставить marker. Новую сессию отсюда начать нельзя — это делает
	 * supervisor через /handoff-new.
	 */
	const checkHandoff = async (ctx: ExtensionContext): Promise<void> => {
		if (!isMainTui(ctx) || settings.handoffAtPercent === null) return;
		if (Date.now() < handoffCooldownUntil) return;
		const usage = readUsage(ctx);
		if (!usage) return;
		if (usage.percent < settings.handoffAtPercent) {
			handoffRequested = false;
			handoffCooldownUntil = 0;
			return;
		}
		if (handoffRequested || !ctx.isIdle() || ctx.hasPendingMessages()) return;

		handoffRequested = true;
		handoffCooldownUntil = Date.now() + settings.handoffCooldownSeconds * 1000;
		const marker = JSON.stringify({
			reason: "context",
			sessionFile: ctx.sessionManager.getSessionFile() ?? null,
		});
		const text =
			`HANDOFF: контекст ${usageText(usage)}. Заверши текущую задачу, обнови HANDOFF.md, ` +
			`запиши .omp-handoff-request.json с ${marker} и заверши ход. ` +
			"Не начинай новую задачу.";
		try {
			await pi.sendUserMessage(text);
		} catch (error) {
			handoffRequested = false;
			const message = error instanceof Error ? error.message : String(error);
			notify(ctx, `Не удалось запросить HANDOFF: ${message}`, "warning");
		}
	};

	/** Авто-компакция на 60% только после завершения хода и без очереди. */
	const checkAuto = async (ctx: ExtensionContext): Promise<void> => {
		if (!isMainTui(ctx) || settings.autoCompactPercent === null || handoffRequested) return;
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
		handoffRequested = false;
		try {
			// Дочерняя сессия после /handoff-new не должна сразу уйти в новый handoff.
			if (ctx.sessionManager.getHeader()?.parentSession) {
				handoffCooldownUntil = Date.now() + settings.handoffCooldownSeconds * 1000;
			}
		} catch {
			// старый runner без getHeader
		}
		writeSessionInfo(ctx);
		checkWarnings(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refreshSettings(ctx);
		checkWarnings(ctx);
		await checkHandoff(ctx);
		await checkAuto(ctx);
	});

	pi.on("agent_end", async (event, ctx) => {
		// Авто-продолжение или фоновая работа: это не финальная точка.
		if (event.willContinue || event.awaitingAsyncWork) return;
		await refreshSettings(ctx);
		await checkHandoff(ctx);
		await checkAuto(ctx);
	});

	pi.on("auto_compaction_start", async () => {
		compacting = true;
	});

	pi.on("auto_compaction_end", async (event, ctx) => {
		compacting = false;
		if (event.errorMessage) {
			autoCompacted = false;
			notify(ctx, `Компакция не удалась: ${event.errorMessage}`, "warning");
		}
	});

	pi.on("session_compact", async (_event, ctx) => {
		compacting = false;
		warned = false;
		suggested = false;
		autoCompacted = false;
		handoffRequested = false;
		handoffCooldownUntil = 0;
		notify(ctx, "Контекст сжат.", "info");
	});

	pi.on("session_switch", async (_event, ctx) => {
		await refreshSettings(ctx, true);
		warned = false;
		suggested = false;
		autoCompacted = false;
		compacting = false;
		handoffRequested = false;
		handoffCooldownUntil = 0;
		writeSessionInfo(ctx);
		checkWarnings(ctx);
	});

	pi.registerCommand("handoff-preflight", {
		description: "Чек-лист и проверка готовности к /handoff-new: git, state, marker",
		handler: async (args, ctx) => {
			if (!isMainTui(ctx)) return;
			const stateFile = args.trim() || STATE_FILE;
			const checklist = await askHandoffChecklist(ctx);
			if (checklist.status === "cancelled") {
				notify(ctx, "PREFLIGHT отменён: чек-лист не заполнен.", "info");
				return;
			}
			const report = runPreflight(
				ctx.cwd,
				ctx.sessionManager.getSessionFile() ?? null,
				stateFile,
			);
			const table = formatPreflight(report);
			const pending = checklist.status === "answered" ? checklist.pending : null;
			let prefix: string | null = null;
			if (pending !== null) {
				prefix =
					pending.length === 0
						? "чек-лист: всё отмечено"
						: `чек-лист: не отмечено — ${pending.join(", ")}`;
			}
			notify(
				ctx,
				prefix ? `${prefix}\n${table}` : table,
				pending && pending.length > 0
					? "warning"
					: report.ready
						? "info"
						: "warning",
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

	pi.registerCommand("handoff", {
		description: "Сжать контекст, сохранив решения и следующие шаги",
		handler: async (args, ctx) => {
			if (!isMainTui(ctx)) return;
			if (compacting) {
				notify(ctx, "Сжатие уже идёт.", "info");
				return;
			}
			const usage = readUsage(ctx);
			const custom = args.trim() || HANDOFF_INSTRUCTIONS;
			compacting = true;
			notify(
				ctx,
				`HANDOFF${usage ? ` ${usageText(usage)}` : ""}: сжимаю контекст; обнови HANDOFF.md.`,
				"info",
			);
			try {
				await ctx.compact(custom);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notify(ctx, `HANDOFF не удался: ${message}`, "warning");
			} finally {
				compacting = false;
			}
		},
	});
}
