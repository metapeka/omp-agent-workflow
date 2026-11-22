/**
 * Детерминированная политика: stop → handoff → continue.
 *
 * Модель не решает, когда менять сессию или останавливаться; она только
 * выполняет решение и обновляет state.
 */
import { evaluateBudgets } from "./budgets.ts";
import { selectNextTask } from "./plan.ts";
import type {
	Autoplan,
	OrchestratorState,
	TaskSpec,
	WorkflowMode,
} from "./types.ts";

export interface PolicyInput {
	state: OrchestratorState;
	plan: Autoplan;
	mode: WorkflowMode;
	contextPercent: number | null;
	handoffAt: number | null;
	now: Date;
	/** true после успешного finish; лимит задач действует только здесь. */
	atBoundary: boolean;
	spendAvailable?: boolean;
}

export type Decision =
	| { kind: "continue"; task: TaskSpec }
	| { kind: "handoff"; reason: "task-boundary"; detail: string }
	| { kind: "stop"; reason: string; detail: string };

function stop(reason: string, detail: string): Decision {
	return { kind: "stop", reason, detail };
}

/** Решение по state и плану. Чистая функция, без I/O и времени извне. */
export function decide(input: PolicyInput): Decision {
	const { state, plan, mode, atBoundary } = input;
	if (state.stop) {
		return stop(state.stop.reason, state.stop.detail);
	}
	if (state.plan.hash !== plan.hash) {
		return stop(
			"plan-changed",
			`plan hash ${plan.hash} != state ${state.plan.hash}; требуется решение человека`,
		);
	}

	const completed = state.completed.map((task) => task.id);
	const next = selectNextTask(plan, completed);
	if (next.kind === "plan-done") return stop("plan-done", next.detail);
	if (next.kind === "no-ready-task") {
		return stop("no-ready-task", next.detail);
	}

	const task = next.task;
	const attempts = state.attempts[task.id] ?? 0;
	if (attempts >= 2) {
		return stop(
			"attempts-exceeded",
			`задача ${task.id}: ${attempts} неудачных попыток`,
		);
	}
	if (task.gate) {
		return stop(
			"gate",
			`задача ${task.id} требует решения человека: ${task.gate}`,
		);
	}

	const budgets = evaluateBudgets(plan.config.budgets, state, input.now, {
		spendAvailable: input.spendAvailable,
	});
	if (budgets.costUnavailable) {
		return stop(
			"cost-unavailable",
			"session file недоступен, но maxSpendUsd задан; бюджет нельзя проверить",
		);
	}
	if (budgets.spendExceeded) {
		return stop(
			"budget-spend",
			`spend ${state.budgets.spendUsd.toFixed(4)} >= ${plan.config.budgets.maxSpendUsd} USD`,
		);
	}
	if (budgets.timeExceeded) {
		return stop(
			"budget-time",
			`прошло ${budgets.elapsedMinutes.toFixed(1)} мин >= ${plan.config.budgets.maxMinutes}`,
		);
	}

	if (atBoundary && budgets.tasksExceeded) {
		const detail = `задач в сессии ${state.budgets.tasksThisSession} >= ${plan.config.budgets.maxTasksPerSession}`;
		if (mode === "yoda-supervised") {
			return { kind: "handoff", reason: "task-boundary", detail };
		}
		return stop("budget-tasks", detail);
	}

	if (
		atBoundary &&
		mode === "yoda-supervised" &&
		state.budgets.tasksThisSession > 0 &&
		input.handoffAt !== null &&
		input.contextPercent !== null &&
		input.contextPercent >= input.handoffAt
	) {
		return {
			kind: "handoff",
			reason: "task-boundary",
			detail: `контекст ${input.contextPercent}% >= ${input.handoffAt}% на границе задачи`,
		};
	}

	return { kind: "continue", task };
}
