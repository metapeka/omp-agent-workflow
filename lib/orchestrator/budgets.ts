/** Бюджеты run: задачи в сессии, spend и время. */
import type { BudgetLimits, OrchestratorState } from "./types.ts";

export interface BudgetFlags {
	tasksExceeded: boolean;
	spendExceeded: boolean;
	timeExceeded: boolean;
	costUnavailable: boolean;
	elapsedMinutes: number;
}

export interface BudgetOptions {
	/** false, когда session file недоступен, а лимит spend задан. */
	spendAvailable?: boolean;
}

/** Минуты с ISO-времени; невалидная дата — бесконечность (stop). */
export function elapsedMinutes(startedAt: string, now: Date): number {
	const start = Date.parse(startedAt);
	if (!Number.isFinite(start)) return Number.POSITIVE_INFINITY;
	return Math.max(0, (now.getTime() - start) / 60_000);
}

/**
 * Жёсткие границы: `>=` на пороге. Лимит задач проверяется политикой
 * только на границе задачи, поэтому здесь он лишь флаг.
 */
export function evaluateBudgets(
	limits: BudgetLimits,
	state: OrchestratorState,
	now: Date,
	options: BudgetOptions = {},
): BudgetFlags {
	const elapsed = state.run
		? elapsedMinutes(state.run.startedAt, now)
		: 0;
	return {
		tasksExceeded: state.budgets.tasksThisSession >= limits.maxTasksPerSession,
		spendExceeded: state.budgets.spendUsd >= limits.maxSpendUsd,
		timeExceeded: elapsed >= limits.maxMinutes,
		costUnavailable: options.spendAvailable === false,
		elapsedMinutes: elapsed,
	};
}
