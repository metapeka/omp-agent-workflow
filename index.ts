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
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/** Сжать контекст, не потеряв цель, решения, файлы и проверки. */
const HANDOFF_INSTRUCTIONS =
	"Сохрани цель задачи, текущее состояние, принятые решения, изменённые файлы, " +
	"выполненные проверки, блокеры и следующие шаги. Сырые логи и длинные выводы " +
	"инструментов отбрось.";

const DEFAULT_WARN = 35;
const DEFAULT_SUGGEST = 50;
const DEFAULT_AUTO = 60;
const DEFAULT_HANDOFF = 55;
const DEFAULT_HANDOFF_COOLDOWN = 300;

type WorkflowMode = "manual" | "assisted" | "yoda" | "yoda-supervised";

/** Режим workflow: manual/assisted/yoda/yoda-supervised. */
function workflowModeFromEnv(): WorkflowMode {
	const raw = process.env.OMP_WORKFLOW_MODE?.trim();
	return raw === "manual" || raw === "yoda" || raw === "yoda-supervised"
		? raw
		: "assisted";
}
const SESSION_INFO = ".omp-handoff-session.json";
const HANDOFF_NEW_PROMPT =
	"Прочитай HANDOFF.md и продолжи следующую задачу. Не начинай заново уже сделанное.";

/** Процент из env; невалидное значение откатывается к дефолту. */
function percentFromEnv(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 && value <= 100 ? value : fallback;
}

/** Авто-компакция: число или `off` (null). */
function autoPercentFromEnv(fallback: number | null): number | null {
	const raw = process.env.OMP_CONTEXT_AUTO?.trim();
	if (!raw) return fallback;
	if (raw.toLowerCase() === "off") return null;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 && value <= 100 ? value : fallback;
}

/** Порог автоматического запроса handoff: число или `off` (null). */
function handoffPercentFromEnv(fallback: number | null): number | null {
	const raw = process.env.OMP_HANDOFF_AT?.trim();
	if (!raw) return fallback;
	if (raw.toLowerCase() === "off") return null;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 && value <= 100 ? value : fallback;
}

/** Пауза между handoff, чтобы новая сессия не ушла в цикл. */
function handoffCooldownMsFromEnv(): number {
	const raw = process.env.OMP_HANDOFF_COOLDOWN_SECONDS?.trim();
	if (!raw) return DEFAULT_HANDOFF_COOLDOWN * 1000;
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0) return DEFAULT_HANDOFF_COOLDOWN * 1000;
	return value * 1000;
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
	const mode = workflowModeFromEnv();
	const defaultAuto =
		mode === "manual" ? null : mode === "assisted" ? DEFAULT_AUTO : 70;
	const defaultHandoff =
		mode === "yoda" || mode === "yoda-supervised" ? DEFAULT_HANDOFF : null;
	const warnAt = percentFromEnv("OMP_CONTEXT_WARN", DEFAULT_WARN);
	const suggestAt = percentFromEnv("OMP_CONTEXT_SUGGEST", DEFAULT_SUGGEST);
	const autoAt = autoPercentFromEnv(defaultAuto);
	const handoffAt = handoffPercentFromEnv(defaultHandoff);
	const handoffCooldownMs = handoffCooldownMsFromEnv();

	let warned = false;
	let suggested = false;
	let autoCompacted = false;
	let compacting = false;
	let handoffRequested = false;
	let handoffCooldownUntil = 0;

	/** После падения ниже warning пороги снова активны. */
	const resetIfBelow = (percent: number): void => {
		if (percent < warnAt) {
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

		if (usage.percent >= suggestAt && !suggested) {
			suggested = true;
			warned = true;
			notify(
				ctx,
				`Контекст ${usageText(usage)}: пора HANDOFF. Обнови HANDOFF.md, затем /handoff.`,
				"warning",
			);
			return;
		}
		if (usage.percent >= warnAt && !warned) {
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
		if (!isMainTui(ctx) || handoffAt === null) return;
		if (Date.now() < handoffCooldownUntil) return;
		const usage = readUsage(ctx);
		if (!usage) return;
		if (usage.percent < handoffAt) {
			handoffRequested = false;
			handoffCooldownUntil = 0;
			return;
		}
		if (handoffRequested || !ctx.isIdle() || ctx.hasPendingMessages()) return;

		handoffRequested = true;
		handoffCooldownUntil = Date.now() + handoffCooldownMs;
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
		if (!isMainTui(ctx) || autoAt === null || handoffRequested) return;
		const usage = readUsage(ctx);
		if (!usage) return;
		resetIfBelow(usage.percent);
		if (usage.percent < autoAt || autoCompacted || compacting) return;
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
		warned = false;
		suggested = false;
		autoCompacted = false;
		compacting = false;
		handoffRequested = false;
		try {
			// Дочерняя сессия после /handoff-new не должна сразу уйти в новый handoff.
			if (ctx.sessionManager.getHeader()?.parentSession) {
				handoffCooldownUntil = Date.now() + handoffCooldownMs;
			}
		} catch {
			// старый runner без getHeader
		}
		writeSessionInfo(ctx);
		checkWarnings(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		checkWarnings(ctx);
		await checkHandoff(ctx);
		await checkAuto(ctx);
	});

	pi.on("agent_end", async (event, ctx) => {
		// Авто-продолжение или фоновая работа: это не финальная точка.
		if (event.willContinue || event.awaitingAsyncWork) return;
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
		warned = false;
		suggested = false;
		autoCompacted = false;
		compacting = false;
		handoffRequested = false;
		handoffCooldownUntil = 0;
		writeSessionInfo(ctx);
		checkWarnings(ctx);
	});

	pi.registerCommand("handoff-new", {
		description: "Начать новую сессию после обновления HANDOFF.md",
		handler: async (args, ctx) => {
			if (!isMainTui(ctx)) return;
			const statePath = resolve(ctx.cwd, args.trim() || "HANDOFF.md");
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
						sessionManager.appendCustomMessageEntry("handoff", HANDOFF_NEW_PROMPT, true);
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
