/**
 * Детерминированные тесты orchestrator 0.5 (этап A):
 * план, state/lock, бюджеты, политика. Без OMP, сети и модели.
 */
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { evaluateBudgets, elapsedMinutes } from "../lib/orchestrator/budgets.ts";
import {
	PlanError,
	hashPlan,
	parsePlan,
	readPlan,
	selectNextTask,
} from "../lib/orchestrator/plan.ts";
import { decide } from "../lib/orchestrator/policy.ts";
import {
	LOCK_DIR,
	LockError,
	STATE_FILE,
	StateError,
	acquireLock,
	createInitialState,
	readState,
	updateState,
	writeState,
} from "../lib/orchestrator/state.ts";

const NOW = new Date("2026-11-22T12:00:00.000Z");

function planText(plan, tasks, prose = "") {
	return [
		"# AUTOPLAN",
		prose,
		"```json plan",
		JSON.stringify(plan, null, 2),
		"```",
		...tasks.flatMap((task) => [
			`## ${task.id}`,
			"```json task",
			JSON.stringify(task, null, 2),
			"```",
		]),
	].join("\n");
}

const BASE_PLAN = {
	version: 1,
	goal: "orchestrator tests",
	worktreeRoot: "/tmp/omp-orchestrator-worktrees",
	verify: ["npm test"],
};

const T1 = {
	id: "T1",
	title: "first",
	acceptance: ["first works"],
};

const T2 = {
	id: "T2",
	title: "second",
	deps: ["T1"],
	acceptance: ["second works"],
};

function compile(plan = BASE_PLAN, tasks = [T1]) {
	return parsePlan(planText(plan, tasks));
}

function stateFor(plan, overrides = {}) {
	const state = createInitialState({
		planPath: plan.path,
		planHash: plan.hash,
		mode: "yoda-supervised",
		sessionFile: "/tmp/session.jsonl",
		now: NOW,
	});
	const budgets = overrides.budgets
		? { ...state.budgets, ...overrides.budgets }
		: state.budgets;
	Object.assign(state, overrides, { budgets });
	return state;
}

function done(id) {
	return { id, commit: `commit-${id}`, mergedAt: NOW.toISOString(), checks: [] };
}

let tempDirs = [];
function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "omp-orch-"));
	tempDirs.push(dir);
	return dir;
}

beforeEach(() => {
	tempDirs = [];
});

afterEach(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("AUTOPLAN parsing", () => {
	it("applies defaults and resolves task verify from plan", () => {
		const plan = compile();
		assert.equal(plan.config.baseBranch, "main");
		assert.equal(plan.config.baseRepo, null);
		assert.equal(plan.config.backend, "orca");
		assert.deepEqual(plan.config.budgets, {
			maxTasksPerSession: 3,
			maxSpendUsd: 5,
			maxMinutes: 120,
		});
		assert.equal(plan.tasks[0].branch, "feat/T1");
		assert.deepEqual(plan.tasks[0].deps, []);
		assert.deepEqual(plan.tasks[0].verify, ["npm test"]);
		assert.equal(plan.tasks[0].review, true);
		assert.equal(plan.tasks[0].gate, null);
	});

	it("keeps the hash stable across prose but changes it with tasks", () => {
		const a = compile(BASE_PLAN, [T1], "prose one");
		const b = compile(BASE_PLAN, [T1], "prose two");
		const c = compile(BASE_PLAN, [{ ...T1, title: "renamed" }], "prose one");
		assert.equal(a.hash, b.hash);
		assert.notEqual(a.hash, c.hash);
		assert.equal(hashPlan(a.config, a.tasks), a.hash);
	});

	it("rejects a missing plan block, duplicate ids and bad JSON", () => {
		assert.throws(
			() => parsePlan("# no blocks\n"),
			(err) => err instanceof PlanError && /json plan/.test(err.message),
		);
		assert.throws(
			() => compile(BASE_PLAN, [T1, T1]),
			/duplicate task id/,
		);
		assert.throws(
			() =>
				parsePlan(
					`\`\`\`json plan\n{not json}\n\`\`\`\n`,
				),
			/invalid JSON/,
		);
	});

	it("rejects unknown dependencies and cycles", () => {
		assert.throws(
			() => compile(BASE_PLAN, [{ ...T1, deps: ["T9"] }]),
			/unknown dependency/,
		);
		assert.throws(
			() =>
				compile(BASE_PLAN, [
					{ ...T1, deps: ["T2"] },
					{ ...T2, deps: ["T1"] },
				]),
			/dependency cycle/,
		);
	});

	it("rejects unsafe branches, gates and budgets", () => {
		assert.throws(
			() => compile(BASE_PLAN, [{ ...T1, branch: "../evil" }]),
			/unsafe git branch/,
		);
		assert.throws(
			() => compile(BASE_PLAN, [{ ...T1, branch: "main" }]),
			/protected/,
		);
		assert.throws(
			() => compile({ ...BASE_PLAN, backend: "svn" }, [T1]),
			/backend/,
		);
		assert.throws(
			() =>
				compile(
					{ ...BASE_PLAN, budgets: { maxTasksPerSession: 0 } },
					[T1],
				),
			/maxTasksPerSession/,
		);
		assert.throws(
			() => compile(BASE_PLAN, [{ ...T1, gate: "publish-now" }]),
			/gate/,
		);
		assert.throws(
			() => compile(BASE_PLAN, [{ ...T1, gate: "toString" }]),
			/gate/,
		);
		assert.throws(
			() => compile(BASE_PLAN, [{ ...T1, acceptance: [] }]),
			/acceptance/,
		);
	});

	it("reads a plan from disk", () => {
		const dir = tempDir();
		const path = join(dir, "AUTOPLAN.md");
		writeFileSync(path, planText(BASE_PLAN, [T1]));
		const plan = readPlan(path);
		assert.equal(plan.tasks.length, 1);
		assert.equal(plan.path, path);
	});
});

describe("next task selection", () => {
	it("respects dependencies and plan order", () => {
		const plan = compile(BASE_PLAN, [T2, T1]);
		const first = selectNextTask(plan, []);
		assert.equal(first.kind, "task");
		assert.equal(first.task.id, "T1");
		const second = selectNextTask(plan, ["T1"]);
		assert.equal(second.kind, "task");
		assert.equal(second.task.id, "T2");
	});

	it("reports plan completion", () => {
		const plan = compile(BASE_PLAN, [T1, T2]);
		const next = selectNextTask(plan, ["T1", "T2"]);
		assert.equal(next.kind, "plan-done");
	});
});

describe("STATE and lock", () => {
	it("round-trips a state and leaves no temp files", () => {
		const dir = tempDir();
		const plan = compile();
		const state = stateFor(plan);
		const path = join(dir, STATE_FILE);
		writeState(path, state);
		assert.deepEqual(readState(path), state);
		assert.equal(
			readdirSync(dir).some((name) => name.includes(".tmp-")),
			false,
		);
	});

	it("returns null for missing state and throws on corrupt state", () => {
		const dir = tempDir();
		assert.equal(readState(join(dir, STATE_FILE)), null);
		writeFileSync(join(dir, STATE_FILE), "{broken");
		assert.throws(
			() => readState(join(dir, STATE_FILE)),
			(err) => err instanceof StateError && err.code === "state-corrupt",
		);
	});

	it("holds one writer and releases the lock", () => {
		const dir = tempDir();
		const release = acquireLock(dir);
		assert.throws(() => acquireLock(dir), LockError);
		release();
		const again = acquireLock(dir);
		again();
	});

	it("recovers a stale lock but not a live one", () => {
		const dir = tempDir();
		const release = acquireLock(dir);
		assert.throws(() => acquireLock(dir), /held by pid/);
		assert.equal(existsSync(join(dir, LOCK_DIR)), true);
		release();

		const lockPath = join(dir, LOCK_DIR);
		mkdirSync(lockPath);
		writeFileSync(
			join(lockPath, "owner.json"),
			JSON.stringify({
				pid: process.pid,
				token: "stale",
				at: new Date(0).toISOString(),
			}),
		);
		const recovered = acquireLock(dir, { staleMs: 1000 });
		recovered();
	});

	it("updateState writes atomically and keeps state on mutation errors", () => {
		const dir = tempDir();
		const plan = compile();
		writeState(join(dir, STATE_FILE), stateFor(plan));

		const changed = updateState(dir, (state) => {
			state.budgets.spendUsd = 1.25;
			return "ok";
		});
		assert.equal(changed.result, "ok");
		assert.equal(readState(join(dir, STATE_FILE)).budgets.spendUsd, 1.25);

		assert.throws(() =>
			updateState(dir, (state) => {
				state.budgets.spendUsd = 99;
				throw new Error("boom");
			}),
		);
		assert.equal(readState(join(dir, STATE_FILE)).budgets.spendUsd, 1.25);

		const release = acquireLock(dir);
		release();
	});

	it("updateState reports state-missing", () => {
		const dir = tempDir();
		assert.throws(
			() => updateState(dir, () => undefined),
			(err) => err instanceof StateError && err.code === "state-missing",
		);
	});
});

describe("budgets", () => {
	const limits = { maxTasksPerSession: 3, maxSpendUsd: 5, maxMinutes: 120 };

	it("computes elapsed minutes and treats invalid dates as infinite", () => {
		assert.equal(
			elapsedMinutes("2026-11-22T10:00:00.000Z", new Date("2026-11-22T12:30:00.000Z")),
			150,
		);
		assert.equal(elapsedMinutes("not-a-date", NOW), Number.POSITIVE_INFINITY);
	});

	it("flags limits exactly at the threshold", () => {
		const plan = compile();
		const state = stateFor(plan, {
			run: {
				...stateFor(plan).run,
				startedAt: "2026-11-22T10:00:00.000Z",
			},
			budgets: { tasksThisSession: 3, spendUsd: 5, costOffsets: {} },
		});
		const flags = evaluateBudgets(limits, state, new Date("2026-11-22T12:00:00.000Z"));
		assert.equal(flags.tasksExceeded, true);
		assert.equal(flags.spendExceeded, true);
		assert.equal(flags.timeExceeded, true);
		assert.equal(flags.costUnavailable, false);
	});

	it("stays below the thresholds and reports unavailable cost", () => {
		const plan = compile();
		const state = stateFor(plan);
		const flags = evaluateBudgets(limits, state, NOW, { spendAvailable: false });
		assert.equal(flags.tasksExceeded, false);
		assert.equal(flags.spendExceeded, false);
		assert.equal(flags.timeExceeded, false);
		assert.equal(flags.costUnavailable, true);
	});
});

describe("policy", () => {
	function policy(plan, state, overrides = {}) {
		return decide({
			state,
			plan,
			mode: "yoda-supervised",
			contextPercent: null,
			handoffAt: 55,
			now: new Date("2026-11-22T12:10:00.000Z"),
			atBoundary: true,
			...overrides,
		});
	}

	it("stops on an existing stop reason", () => {
		const plan = compile();
		const state = stateFor(plan, {
			stop: { reason: "gate", detail: "human", at: NOW.toISOString() },
		});
		const decision = policy(plan, state);
		assert.equal(decision.kind, "stop");
		assert.equal(decision.reason, "gate");
	});

	it("stops when the plan hash changed", () => {
		const plan = compile();
		const state = stateFor(plan);
		state.plan.hash = "sha256:old";
		const decision = policy(plan, state);
		assert.equal(decision.kind, "stop");
		assert.equal(decision.reason, "plan-changed");
	});

	it("stops when all tasks are done", () => {
		const plan = compile(BASE_PLAN, [T1, T2]);
		const state = stateFor(plan, { completed: [done("T1"), done("T2")] });
		const decision = policy(plan, state);
		assert.equal(decision.kind, "stop");
		assert.equal(decision.reason, "plan-done");
	});

	it("stops on a gate and on exhausted attempts", () => {
		const gated = compile(BASE_PLAN, [{ ...T1, gate: "publish" }]);
		assert.equal(policy(gated, stateFor(gated)).reason, "gate");

		const failed = compile();
		assert.equal(
			policy(failed, stateFor(failed, { attempts: { T1: 2 } })).reason,
			"attempts-exceeded",
		);
	});

	it("hard-stops on spend, time and unavailable cost", () => {
		const plan = compile();
		assert.equal(
			policy(plan, stateFor(plan, { budgets: { spendUsd: 5 } })).reason,
			"budget-spend",
		);
		const oldRun = stateFor(plan);
		oldRun.run.startedAt = "2026-11-22T09:00:00.000Z";
		assert.equal(policy(plan, oldRun).reason, "budget-time");
		assert.equal(
			policy(plan, stateFor(plan), { spendAvailable: false }).reason,
			"cost-unavailable",
		);
	});

	it("hands off on a task limit only at a boundary and only supervised", () => {
		const plan = compile();
		const state = stateFor(plan, {
			budgets: { tasksThisSession: 3 },
		});
		assert.equal(policy(plan, state).kind, "handoff");

		const yoda = policy(plan, state, { mode: "yoda" });
		assert.equal(yoda.kind, "stop");
		assert.equal(yoda.reason, "budget-tasks");

		const midTask = policy(plan, state, { atBoundary: false });
		assert.equal(midTask.kind, "continue");
	});

	it("hands off on context at a boundary after at least one task", () => {
		const plan = compile();
		const state = stateFor(plan, { budgets: { tasksThisSession: 1 } });
		const handoff = policy(plan, state, { contextPercent: 55 });
		assert.equal(handoff.kind, "handoff");
		assert.equal(handoff.reason, "task-boundary");

		const below = policy(plan, state, { contextPercent: 54 });
		assert.equal(below.kind, "continue");

		const firstTask = policy(plan, stateFor(plan), { contextPercent: 90 });
		assert.equal(firstTask.kind, "continue");
	});

	it("continues with the next task below all limits", () => {
		const plan = compile(BASE_PLAN, [T1, T2]);
		const state = stateFor(plan, { completed: [done("T1")] });
		const decision = policy(plan, state, { contextPercent: 20 });
		assert.equal(decision.kind, "continue");
		assert.equal(decision.task.id, "T2");
	});
});
