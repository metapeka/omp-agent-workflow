/**
 * Orchestrator 0.5 — OMP entry.
 *
 * Регистрирует tool `orchestrator`, команды `/orchestrate`,
 * `/orchestrate-stop` и hooks. Контракт 0.3 не меняет: это отдельный
 * extension entry, `index.ts` остаётся context guard.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
	ActionError,
	finish,
	next,
	rebase,
	resume,
	start,
	status,
	stop,
	verify,
	type ActionContext,
	type StartResult,
} from "./lib/orchestrator/actions.ts";
import { handoffAtFromEnv, workflowModeFromEnv } from "./lib/orchestrator/config.ts";
import { PlanError } from "./lib/orchestrator/plan.ts";
import {
	STATE_FILE,
	LockError,
	StateError,
	readState,
} from "./lib/orchestrator/state.ts";
import type { TaskSpec } from "./lib/orchestrator/types.ts";
import { CommandError } from "./lib/orchestrator/worktrees.ts";

type OrchestratorAction =
	| "status"
	| "next"
	| "start"
	| "verify"
	| "finish"
	| "rebase"
	| "stop"
	| "resume";

interface OrchestratorParams {
	action: OrchestratorAction;
	plan?: string;
	task?: string;
	commit?: string;
	review?: string;
	reason?: string;
	detail?: string;
}

function isMainTui(ctx: ExtensionContext): boolean {
	return ctx.mode === "tui" && ctx.agent.kind === "main";
}

function notify(ctx: ExtensionContext, text: string): void {
	try {
		ctx.ui.notify(text, "info");
	} catch {
		// контекст без UI
	}
}

function actionContext(ctx: ExtensionContext, planPath?: string): ActionContext {
	const mode = workflowModeFromEnv();
	let percent: number | null = null;
	try {
		percent = ctx.getContextUsage()?.percent ?? null;
	} catch {
		percent = null;
	}
	return {
		dir: ctx.cwd,
		planPath,
		mode,
		sessionFile: ctx.sessionManager.getSessionFile() ?? null,
		handoffAt: handoffAtFromEnv(mode),
		contextPercent: percent,
	};
}

function orchestrationPrompt(
	started: Extract<StartResult, { kind: "started" }>,
	planPath: string,
): string {
	return [
		`Оркестратор: задача ${started.task.id} уже создана.`,
		`План: ${planPath}`,
		`Worktree: ${started.worktree}`,
		`Branch: ${started.branch}`,
		"Не редактируй код сам. Спавни implementer через task с промптом ниже.",
		"--- implementer prompt ---",
		started.prompt,
		"---",
		`После коммита вызови tool orchestrator: action=verify, task=${started.task.id}.`,
		"Затем независимый verifier и reviewer; при verdict ok вызови action=finish с commit SHA и review=ok.",
		"Не мержи вручную и не начинай другие задачи.",
	].join("\n");
}

function textResult(value: unknown): { content: { type: "text"; text: string }[]; details: unknown } {
	return {
		content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
		details: value,
	};
}

function errorResult(message: string): {
	content: { type: "text"; text: string }[];
	details: { error: string };
	isError: true;
} {
	return {
		content: [{ type: "text", text: `orchestrator: ${message}` }],
		details: { error: message },
		isError: true,
	};
}

function knownMessage(error: unknown): string | null {
	if (
		error instanceof ActionError ||
		error instanceof PlanError ||
		error instanceof StateError ||
		error instanceof LockError ||
		error instanceof CommandError
	) {
		return error.message;
	}
	return null;
}

function continuationPrompt(task: TaskSpec, planPath: string): string {
	return [
		`Оркестратор: следующая задача ${task.id} — ${task.title}.`,
		`План: ${planPath}`,
		`Вызови tool orchestrator: action=start, task=${task.id}.`,
		"Затем выполни задачу по выданному промпту: implementer → verify → reviewer → finish.",
	].join("\n");
}

function resumePrompt(planPath: string): string {
	return [
		"Оркестратор: run активен, текущей задачи нет.",
		`Прочитай ${planPath} и HANDOFF.md.`,
		"Вызови tool orchestrator: action=next; если есть задача — action=start с её id.",
		"Не начинай уже завершённые задачи.",
	].join("\n");
}

function handoffPrompt(detail: string, sessionFile: string): string {
	return [
		`HANDOFF: граница задачи достигнута (${detail}).`,
		"1. Обнови HANDOFF.md: цель, состояние, завершённые задачи, следующую задачу, проверки и риски.",
		"2. Запиши .omp-handoff-request.json ровно с этим содержимым:",
		JSON.stringify({ reason: "task-boundary", sessionFile }, null, 2),
		"3. Заверши ход. Не начинай следующую задачу и не мержи вручную.",
	].join("\n");
}

export default function orchestrator(pi: ExtensionAPI): void {
	const z = pi.zod;
	let pendingContinuation: string | null = null;
	let pendingHandoff = false;

	async function runAction(
		context: ActionContext,
		params: OrchestratorParams,
	): Promise<unknown> {
		switch (params.action) {
			case "status":
				return status(context);
			case "next":
				return next(context);
			case "start": {
				const result = await start(context, params.task);
				pendingContinuation = null;
				pendingHandoff = false;
				return result;
			}
			case "verify":
				return verify(context, params.task);
			case "rebase":
				return rebase(context, params.task);
			case "stop":
				return stop(context, params.reason ?? "human", params.detail);
			case "resume":
				return resume(context);
			case "finish": {
				if (!params.task) throw new ActionError("finish: task is required");
				if (!params.commit) throw new ActionError("finish: commit is required");
				if (!params.review) throw new ActionError("finish: review is required");
				const merged = await finish(
					context,
					params.task,
					params.commit,
					params.review,
				);
				if (merged.kind === "merged" && merged.decision.kind === "continue") {
					pendingHandoff = false;
					if (context.mode === "yoda" || context.mode === "yoda-supervised") {
						pendingContinuation = continuationPrompt(
							merged.decision.task,
							context.planPath ?? "AUTOPLAN.md",
						);
					}
				}
				if (
					merged.kind === "merged" &&
					merged.decision.kind === "handoff" &&
					(context.mode === "yoda" || context.mode === "yoda-supervised") &&
					context.sessionFile
				) {
					pendingContinuation = handoffPrompt(
						merged.decision.detail,
						context.sessionFile,
					);
					pendingHandoff = true;
				}
				return merged;
			}
		}
	}

	pi.registerTool({
		name: "orchestrator",
		label: "Orchestrator",
		description:
			"Детерминированный state orchestrator 0.5: status/next/start/verify/finish/rebase/stop/resume. " +
			"Используется main-агентом; worktree создаёт код, не модель.",
		loadMode: "essential",
		approval: "exec",
		parameters: z.object({
			action: z.enum([
				"status",
				"next",
				"start",
				"verify",
				"finish",
				"rebase",
				"stop",
				"resume",
			]),
			plan: z.string().optional().describe("Путь к AUTOPLAN.md"),
			task: z.string().optional().describe("ID задачи"),
			commit: z.string().optional().describe("SHA после verify"),
			review: z.string().optional().describe("Вердикт reviewer: ok"),
			reason: z.string().optional().describe("Причина stop"),
			detail: z.string().optional().describe("Детали stop"),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!isMainTui(ctx)) {
				return errorResult("orchestrator доступен только main TUI");
			}
			const args = params as OrchestratorParams;
			try {
				const result = await runAction(actionContext(ctx, args.plan), args);
				return textResult(result);
			} catch (error) {
				const message = knownMessage(error);
				if (message) return errorResult(message);
				throw error;
			}
		},
	});

	pi.registerCommand("orchestrate", {
		description: "Запустить/продолжить AUTOPLAN в main TUI",
		handler: async (args, ctx) => {
			if (!isMainTui(ctx)) return;
			const planPath = args.trim() || undefined;
			const context = actionContext(ctx, planPath);
			try {
				const state = readState(join(ctx.cwd, STATE_FILE));
				if (state?.stop) {
					notify(
						ctx,
						`Orchestrator остановлен: ${state.stop.reason}. Сначала resume.`,
					);
					return;
				}
				const started = await start(context);
				if (started.kind === "started") {
					notify(ctx, `Orchestrator: ${started.task.id} → ${started.worktree}`);
					await pi.sendUserMessage(
						orchestrationPrompt(started, planPath ?? "AUTOPLAN.md"),
					);
					return;
				}
				if (started.kind === "stop") {
					notify(ctx, `Orchestrator stop: ${started.reason} — ${started.detail}`);
					return;
				}
				notify(ctx, `Orchestrator handoff: ${started.detail}`);
			} catch (error) {
				const message = knownMessage(error) ?? String(error);
				notify(ctx, `Orchestrator: ${message}`);
			}
		},
	});

	pi.registerCommand("orchestrate-stop", {
		description: "Остановить orchestrator с причиной",
		handler: async (args, ctx) => {
			if (!isMainTui(ctx)) return;
			try {
				const result = stop(
					actionContext(ctx),
					args.trim() || "human",
					args.trim() || "manual stop",
				);
				notify(ctx, `Orchestrator stop: ${result.reason}`);
			} catch (error) {
				notify(ctx, `Orchestrator: ${knownMessage(error) ?? String(error)}`);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		pendingContinuation = null;
		pendingHandoff = false;
		if (!isMainTui(ctx)) return;
		try {
			const state = readState(join(ctx.cwd, STATE_FILE));
			if (state?.stop) {
				notify(ctx, `Orchestrator остановлен: ${state.stop.reason}`);
			} else if (state?.run?.active && state.current) {
				notify(
					ctx,
					`Незавершённая задача ${state.current.id} (${state.current.status}); /orchestrate для продолжения.`,
				);
			} else if (state?.run?.active) {
				const mode = workflowModeFromEnv();
				if (mode === "yoda" || mode === "yoda-supervised") {
					pendingContinuation = resumePrompt(state.plan.path);
				}
			}
		} catch {
			// state ещё не создан/повреждён — команда /orchestrate сообщит
		}
	});

	pi.on("session_switch", async () => {
		pendingContinuation = null;
		pendingHandoff = false;
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!isMainTui(ctx)) return;
		if (event.willContinue || event.awaitingAsyncWork) return;
		if (!pendingContinuation) return;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return;
		try {
			const state = readState(join(ctx.cwd, STATE_FILE));
			if (state?.stop) {
				pendingContinuation = null;
				pendingHandoff = false;
				return;
			}
		} catch {
			// продолжение не блокируем: state мог быть создан позже
		}
		if (pendingHandoff) {
			const markerPath = join(ctx.cwd, ".omp-handoff-request.json");
			if (existsSync(markerPath)) {
				try {
					const parsed: unknown = JSON.parse(readFileSync(markerPath, "utf8"));
					const marker =
						typeof parsed === "object" && parsed !== null
							? (parsed as Record<string, unknown>)
							: null;
					const current = ctx.sessionManager.getSessionFile();
					if (
						marker &&
						typeof marker.sessionFile === "string" &&
						current &&
						marker.sessionFile === current
					) {
						pendingContinuation = null;
						pendingHandoff = false;
						return;
					}
				} catch {
					// битый marker: отправим инструкцию ещё раз
				}
			}
		}
		const message = pendingContinuation;
		if (!message) return;
		try {
			await pi.sendUserMessage(message);
			pendingContinuation = null;
			pendingHandoff = false;
		} catch (error) {
			notify(
				ctx,
				`Orchestrator continuation: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});

	pi.on("before_subagent_spawn", async (_event, ctx) => {
		if (!isMainTui(ctx)) return;
		try {
			const state = readState(join(ctx.cwd, STATE_FILE));
			if (state?.stop) {
				return {
					block: true,
					reason: `orchestrator stop: ${state.stop.reason} — ${state.stop.detail}`,
				};
			}
		} catch {
			// нет state — обычная работа
		}
	});
}
