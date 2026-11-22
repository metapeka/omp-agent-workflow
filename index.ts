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
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/** Сжать контекст, не потеряв цель, решения, файлы и проверки. */
const HANDOFF_INSTRUCTIONS =
	"Сохрани цель задачи, текущее состояние, принятые решения, изменённые файлы, " +
	"выполненные проверки, блокеры и следующие шаги. Сырые логи и длинные выводы " +
	"инструментов отбрось.";

const DEFAULT_WARN = 35;
const DEFAULT_SUGGEST = 50;
const DEFAULT_AUTO = 60;

/** Процент из env; невалидное значение откатывается к дефолту. */
function percentFromEnv(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 && value <= 100 ? value : fallback;
}

/** Авто-компакция: число или `off` (null). */
function autoPercentFromEnv(): number | null {
	const raw = process.env.OMP_CONTEXT_AUTO?.trim();
	if (!raw) return DEFAULT_AUTO;
	if (raw.toLowerCase() === "off") return null;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 && value <= 100 ? value : DEFAULT_AUTO;
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
	const warnAt = percentFromEnv("OMP_CONTEXT_WARN", DEFAULT_WARN);
	const suggestAt = percentFromEnv("OMP_CONTEXT_SUGGEST", DEFAULT_SUGGEST);
	const autoAt = autoPercentFromEnv();

	let warned = false;
	let suggested = false;
	let autoCompacted = false;
	let compacting = false;

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

	/** Авто-компакция на 60% только после завершения хода и без очереди. */
	const checkAuto = async (ctx: ExtensionContext): Promise<void> => {
		if (!isMainTui(ctx) || autoAt === null) return;
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
		checkWarnings(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		checkWarnings(ctx);
		await checkAuto(ctx);
	});

	pi.on("agent_end", async (event, ctx) => {
		// Авто-продолжение или фоновая работа: это не финальная точка.
		if (event.willContinue || event.awaitingAsyncWork) return;
		await checkAuto(ctx);
	});

	pi.on("session_before_compact", async () => {
		compacting = true;
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
		notify(ctx, "Контекст сжат.", "info");
	});

	pi.on("session_switch", async (_event, ctx) => {
		warned = false;
		suggested = false;
		autoCompacted = false;
		compacting = false;
		checkWarnings(ctx);
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
