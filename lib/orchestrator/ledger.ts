/**
 * Леджер субагентов: один источник правды о деньгах прогона.
 *
 * `budgets.costTotals` хранит измеренный вклад каждого session-файла (root,
 * subagent-сессия, прошлые сессии после handoff). Spend = Σ вкладов, поэтому
 * перезапись файла на месте (компакция) заменяет вклад, а не добавляет его
 * второй раз. Offsets остаются только позицией чтения.
 *
 * Модуль чистый: вход — state/budgets и уже прочитанный `CostRead`; файлы не
 * трогает и ничего не пишет.
 */
import type { CostRead } from "./cost.ts";
import type { BudgetLimits, BudgetState } from "./types.ts";

export interface LedgerFile {
	session: string;
	/** `previous` — сессия уже не в текущем дереве (после handoff/смены). */
	kind: "root" | "subagent" | "previous";
	spendUsd: number;
	readable: boolean;
}

export interface LedgerSnapshot {
	/** false — session-файл не найден/не читается: сумма неполная. */
	measured: boolean;
	spentUsd: number;
	limitUsd: number;
	remainingUsd: number;
	exceeded: boolean;
	files: LedgerFile[];
}

function money(value: number): number {
	return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Применить прочитанное к копии budgets. Обычное чтение прибавляет дельту к
 * вкладу файла; перечитывание с нуля (`fullTotalUsd`) заменяет вклад.
 * Файлы, которых нет в текущем дереве, сохраняют вклад как `previous`.
 */
export function projectBudgets(
	budgets: BudgetState,
	read: CostRead | null,
): BudgetState {
	const totals: Record<string, number> = { ...budgets.costTotals };
	if (!read) {
		return {
			tasksThisSession: budgets.tasksThisSession,
			spendUsd: budgets.spendUsd,
			costOffsets: { ...budgets.costOffsets },
			costTotals: totals,
		};
	}
	let spend = budgets.spendUsd;
	for (const entry of read.entries) {
		const previous = budgets.costTotals[entry.file] ?? 0;
		const next = entry.fullTotalUsd ?? previous + entry.deltaUsd;
		if (next !== previous) spend += next - previous;
		totals[entry.file] = next;
	}
	return {
		tasksThisSession: budgets.tasksThisSession,
		spendUsd: money(spend),
		costOffsets: { ...read.offsets },
		costTotals: totals,
	};
}

/** Снимок для `status --json` и preflight; ничего не пишет. */
export function ledgerSnapshot(
	budgets: BudgetState,
	limits: BudgetLimits,
	read: CostRead | null,
): LedgerSnapshot {
	const present = new Set<string>();
	const files: LedgerFile[] = [];
	for (const entry of read?.entries ?? []) {
		present.add(entry.file);
		files.push({
			session: entry.file,
			kind: entry.kind,
			spendUsd: money(budgets.costTotals[entry.file] ?? 0),
			readable: entry.readable,
		});
	}
	for (const [file, total] of Object.entries(budgets.costTotals)) {
		if (present.has(file)) continue;
		files.push({
			session: file,
			kind: "previous",
			spendUsd: money(total),
			readable: false,
		});
	}
	files.sort(
		(a, b) => b.spendUsd - a.spendUsd || a.session.localeCompare(b.session),
	);
	const limit = limits.maxSpendUsd;
	return {
		measured: read?.available === true,
		spentUsd: money(budgets.spendUsd),
		limitUsd: limit,
		remainingUsd: money(Math.max(0, limit - budgets.spendUsd)),
		exceeded: limit > 0 && budgets.spendUsd >= limit,
		files,
	};
}
