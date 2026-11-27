/**
 * Леджер субагентов 0.7.4: spend = Σ вкладов session-файлов.
 *
 * Перезапись файла на месте (компакция) заменяет вклад, а не добавляет его
 * второй раз; сессии, выпавшие из текущего дерева после handoff, сохраняют
 * вклад как `previous`; статус отдаёт лимит, остаток и разрез по файлам.
 */
import assert from "node:assert/strict";
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { readSessionCost } from "../lib/orchestrator/cost.ts";
import { ledgerSnapshot, projectBudgets } from "../lib/orchestrator/ledger.ts";
import { createInitialState } from "../lib/orchestrator/state.ts";

const NOW = new Date("2026-11-27T00:00:00.000Z");
const LIMITS = { maxTasksPerSession: 2, maxSpendUsd: 0.5, maxMinutes: 60 };

function costLine(total) {
	return `${JSON.stringify({
		type: "message",
		message: { role: "assistant", usage: { cost: { total } } },
	})}\n`;
}

function emptyBudgets() {
	return createInitialState({
		planPath: "AUTOPLAN.md",
		planHash: "hash",
		mode: "yoda",
		sessionFile: null,
		now: NOW,
	}).budgets;
}

let tempDirs = [];
function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "omp-ledger-"));
	tempDirs.push(dir);
	return dir;
}

beforeEach(() => {
	tempDirs = [];
});

afterEach(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function close(actual, expected, message) {
	assert.ok(
		Math.abs(actual - expected) < 1e-9,
		`${message ?? ""} expected ${expected}, got ${actual}`,
	);
}

describe("agent ledger: accounting", () => {
	it("adds root and subagent deltas to per-file contributions", () => {
		const root = join(tempDir(), "session.jsonl");
		const childDir = join(dirname(root), basename(root, ".jsonl"));
		mkdirSync(childDir);
		writeFileSync(root, costLine(0.1));
		writeFileSync(join(childDir, "sub.jsonl"), costLine(0.2));

		const first = readSessionCost(root, {});
		const budgets = projectBudgets(emptyBudgets(), first);
		close(budgets.spendUsd, 0.3);
		close(budgets.costTotals[root], 0.1);
		close(budgets.costTotals[join(childDir, "sub.jsonl")], 0.2);

		const again = readSessionCost(root, budgets.costOffsets);
		const same = projectBudgets(budgets, again);
		close(same.spendUsd, 0.3);

		appendFileSync(root, costLine(0.05));
		const tail = readSessionCost(root, same.costOffsets);
		close(projectBudgets(same, tail).spendUsd, 0.35);
	});

	it("replaces a rewritten file's contribution instead of doubling it", () => {
		const root = join(tempDir(), "session.jsonl");
		writeFileSync(root, costLine(0.1) + costLine(0.1));
		const first = projectBudgets(emptyBudgets(), readSessionCost(root, {}));
		close(first.spendUsd, 0.2);

		// Компакция переписала файл на месте: короче сохранённого offset.
		writeFileSync(root, costLine(0.07));
		const read = readSessionCost(root, first.costOffsets);
		assert.equal(read.restarted, true);
		const rewritten = projectBudgets(first, read);
		close(rewritten.spendUsd, 0.07);
		close(rewritten.costTotals[root], 0.07);

		appendFileSync(root, costLine(0.02));
		const appended = projectBudgets(
			rewritten,
			readSessionCost(root, rewritten.costOffsets),
		);
		close(appended.spendUsd, 0.09);
	});

	it("keeps sessions that left the current tree as previous contributions", () => {
		const dir = tempDir();
		const sessionA = join(dir, "a.jsonl");
		writeFileSync(sessionA, costLine(0.1));
		const afterA = projectBudgets(emptyBudgets(), readSessionCost(sessionA, {}));

		const sessionB = join(dir, "b.jsonl");
		writeFileSync(sessionB, costLine(0.25));
		const afterB = projectBudgets(afterA, readSessionCost(sessionB, {}));
		close(afterB.spendUsd, 0.35);

		const snapshot = ledgerSnapshot(
			afterB,
			LIMITS,
			readSessionCost(sessionB, afterB.costOffsets),
		);
		assert.equal(snapshot.measured, true);
		close(snapshot.spentUsd, 0.35);
		assert.equal(snapshot.limitUsd, 0.5);
		close(snapshot.remainingUsd, 0.15);
		assert.equal(snapshot.exceeded, false);
		const kinds = Object.fromEntries(
			snapshot.files.map((file) => [basename(file.session), file.kind]),
		);
		assert.equal(kinds["b.jsonl"], "root");
		assert.equal(kinds["a.jsonl"], "previous");
		assert.equal(
			snapshot.files.find((file) => file.kind === "previous").readable,
			false,
		);
	});

	it("marks the aggregate as exceeded and measured/unmeasured honestly", () => {
		const root = join(tempDir(), "session.jsonl");
		writeFileSync(root, costLine(0.6));
		const budgets = projectBudgets(emptyBudgets(), readSessionCost(root, {}));
		const exceeded = ledgerSnapshot(
			budgets,
			LIMITS,
			readSessionCost(root, budgets.costOffsets),
		);
		assert.equal(exceeded.exceeded, true);
		close(exceeded.remainingUsd, 0);

		const unmeasured = ledgerSnapshot(budgets, LIMITS, null);
		assert.equal(unmeasured.measured, false);
		close(unmeasured.spentUsd, 0.6);
		// Сумма известна по прошлым проходам: файл остаётся в разрезе как previous.
		assert.equal(unmeasured.files.length, 1);
		assert.equal(unmeasured.files[0].kind, "previous");
	});

	it("keeps the measured sum when a previously known file disappears", () => {
		const dir = tempDir();
		const root = join(dir, "session.jsonl");
		writeFileSync(root, costLine(0.12));
		const budgets = projectBudgets(emptyBudgets(), readSessionCost(root, {}));

		rmSync(root);
		const read = readSessionCost(root, budgets.costOffsets);
		assert.equal(read.available, false);
		const after = projectBudgets(budgets, read);
		close(after.spendUsd, 0.12);
		const snapshot = ledgerSnapshot(after, LIMITS, read);
		assert.equal(snapshot.measured, false);
		close(snapshot.spentUsd, 0.12);
	});
});
