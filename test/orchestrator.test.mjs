/**
 * Детерминированные тесты orchestrator 0.5:
 * план, state/lock, бюджеты, политика, cost/worktree/actions/CLI.
 * Без OMP, сети и модели.
 */
import assert from "node:assert/strict";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	finish,
	next as nextAction,
	rebase,
	resume,
	start,
	status as statusAction,
	stop,
	verify,
} from "../lib/orchestrator/actions.ts";
import { evaluateBudgets, elapsedMinutes } from "../lib/orchestrator/budgets.ts";
import { readSessionCost } from "../lib/orchestrator/cost.ts";
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
import {
	branchExists,
	orcaWorktreePath,
	runCommand,
} from "../lib/orchestrator/worktrees.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
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

const T3 = {
	id: "T3",
	title: "third",
	deps: ["T2"],
	acceptance: ["third works"],
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

async function mustRun(command, args, cwd) {
	const result = await runCommand(command, args, {
		cwd,
		timeoutMs: 120_000,
	});
	assert.equal(
		result.code,
		0,
		`${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
	);
	return result;
}

async function gitRepo() {
	const dir = tempDir();
	await mustRun("git", ["init", "-b", "main", dir]);
	await mustRun("git", ["-C", dir, "config", "user.email", "test@example.com"]);
	await mustRun("git", ["-C", dir, "config", "user.name", "Test"]);
	writeFileSync(join(dir, "README.md"), "base\n");
	await mustRun("git", ["-C", dir, "add", "."]);
	await mustRun("git", ["-C", dir, "commit", "-m", "base"]);
	return dir;
}

async function commitFile(repo, name, content, message = "change") {
	writeFileSync(join(repo, name), content);
	await mustRun("git", ["-C", repo, "add", name]);
	await mustRun("git", ["-C", repo, "commit", "-m", message]);
}

function costLine(total) {
	return `${JSON.stringify({
		type: "message",
		message: { role: "assistant", usage: { cost: { total } } },
	})}\n`;
}

async function scenario(options = {}) {
	const base = await gitRepo();
	const control = tempDir();
	const worktreeRoot = tempDir();
	const sessionFile = join(tempDir(), "session.jsonl");
	writeFileSync(sessionFile, costLine(0.1));
	const plan = {
		...BASE_PLAN,
		backend: "git",
		baseRepo: base,
		worktreeRoot,
		verify: [options.verify ?? 'node -e "process.exit(0)"'],
		...(options.plan ?? {}),
	};
	const tasks = options.tasks ?? [T1];
	writeFileSync(join(control, "AUTOPLAN.md"), planText(plan, tasks));
	return {
		base,
		control,
		worktreeRoot,
		sessionFile,
		ctx: {
			dir: control,
			sessionFile,
			mode: "yoda-supervised",
			now: NOW,
			handoffAt: 55,
		},
	};
}

describe("session cost", () => {
	it("sums root and child sessions incrementally", () => {
		const root = join(tempDir(), "session.jsonl");
		const childDir = join(dirname(root), basename(root, ".jsonl"));
		mkdirSync(childDir);
		writeFileSync(root, costLine(0.1));
		writeFileSync(join(childDir, "sub.jsonl"), costLine(0.2));

		const first = readSessionCost(root, {});
		assert.equal(first.available, true);
		assert.ok(Math.abs(first.deltaUsd - 0.3) < 1e-9);
		assert.equal(first.files.length, 2);

		const second = readSessionCost(root, first.offsets);
		assert.equal(second.deltaUsd, 0);

		appendFileSync(root, costLine(0.05));
		const third = readSessionCost(root, second.offsets);
		assert.ok(Math.abs(third.deltaUsd - 0.05) < 1e-9);
	});

	it("does not consume an incomplete line", () => {
		const root = join(tempDir(), "session.jsonl");
		writeFileSync(root, costLine(0.1));
		const first = readSessionCost(root, {});
		appendFileSync(
			root,
			'{"type":"message","message":{"role":"assistant","usage":{"cost":{"total":0.07}}}}',
		);
		const partial = readSessionCost(root, first.offsets);
		assert.equal(partial.deltaUsd, 0);
		appendFileSync(root, "\n");
		const complete = readSessionCost(root, partial.offsets);
		assert.ok(Math.abs(complete.deltaUsd - 0.07) < 1e-9);
	});

	it("reports unavailable without a session file", () => {
		assert.equal(readSessionCost(null, {}).available, false);
		assert.equal(readSessionCost(join(tempDir(), "missing.jsonl"), {}).available, false);
	});

	it("finds a worktree path in a nested Orca response", () => {
		assert.equal(
			orcaWorktreePath({
				result: { worktree: { path: "/tmp/wt", branch: "feat/T1" } },
			}),
			"/tmp/wt",
		);
		assert.equal(orcaWorktreePath({ result: {} }), null);
	});
});

describe("actions on a real git repo", () => {
	it("starts, verifies, merges ff-only and cleans up", async () => {
		const s = await scenario();
		const started = await start(s.ctx, "T1");
		assert.equal(started.kind, "started");
		assert.ok(existsSync(started.worktree));
		let state = readState(join(s.control, STATE_FILE));
		assert.equal(state.current.id, "T1");
		assert.equal(state.current.status, "running");
		assert.ok(Math.abs(state.budgets.spendUsd - 0.1) < 1e-9);

		await commitFile(started.worktree, "work.txt", "done\n");
		const verified = await verify(s.ctx, "T1");
		assert.equal(verified.ok, true);
		assert.ok(verified.commit);
		state = readState(join(s.control, STATE_FILE));
		assert.equal(state.current.status, "verified");

		appendFileSync(s.sessionFile, costLine(0.05));
		const merged = await finish(s.ctx, "T1", verified.commit, "ok");
		assert.equal(merged.kind, "merged");
		assert.equal(merged.decision.kind, "stop");
		assert.equal(merged.decision.reason, "plan-done");
		assert.equal(merged.nextTask, null);
		assert.equal(existsSync(started.worktree), false);
		assert.equal(await branchExists(s.base, "feat/T1"), false);

		state = readState(join(s.control, STATE_FILE));
		assert.equal(state.current, null);
		assert.equal(state.completed.length, 1);
		assert.ok(Math.abs(state.budgets.spendUsd - 0.15) < 1e-9);
		assert.equal(state.stop.reason, "plan-done");
	});

	it("retries a failed verify once, then stops after two attempts", async () => {
		const s = await scenario({ verify: 'node -e "process.exit(1)"' });
		const firstStart = await start(s.ctx, "T1");
		assert.equal(firstStart.kind, "started");
		const firstVerify = await verify(s.ctx, "T1");
		assert.equal(firstVerify.ok, false);
		let state = readState(join(s.control, STATE_FILE));
		assert.equal(state.current.status, "failed");
		assert.equal(state.attempts.T1, 1);
		assert.equal(state.stop, null);

		const secondStart = await start(s.ctx, "T1");
		assert.equal(secondStart.kind, "started");
		const secondVerify = await verify(s.ctx, "T1");
		assert.equal(secondVerify.ok, false);
		state = readState(join(s.control, STATE_FILE));
		assert.equal(state.attempts.T1, 2);
		assert.equal(state.stop.reason, "attempts-exceeded");

		const blocked = await start(s.ctx, "T1");
		assert.equal(blocked.kind, "stop");
		assert.equal(blocked.reason, "attempts-exceeded");
	});

	it("stops on a dirty base instead of merging", async () => {
		const s = await scenario();
		const started = await start(s.ctx, "T1");
		await commitFile(started.worktree, "work.txt", "done\n");
		const verified = await verify(s.ctx, "T1");
		writeFileSync(join(s.base, "dirty.txt"), "dirty\n");
		const merged = await finish(s.ctx, "T1", verified.commit, "ok");
		assert.equal(merged.kind, "stop");
		assert.equal(merged.reason, "base-dirty");
		assert.equal(readState(join(s.control, STATE_FILE)).current.status, "verified");
	});

	it("requires rebase on a diverged base and verifies again", async () => {
		const s = await scenario();
		const started = await start(s.ctx, "T1");
		await commitFile(started.worktree, "work.txt", "done\n");
		const verified = await verify(s.ctx, "T1");
		await commitFile(s.base, "other.txt", "other\n", "base moved");

		const blocked = await finish(s.ctx, "T1", verified.commit, "ok");
		assert.equal(blocked.kind, "rebase-required");

		const rebased = await rebase(s.ctx, "T1");
		assert.equal(rebased.kind, "rebased");
		assert.equal(rebased.ok, true);
		assert.ok(rebased.commit && rebased.commit !== verified.commit);

		const merged = await finish(s.ctx, "T1", rebased.commit, "ok");
		assert.equal(merged.kind, "merged");
		assert.equal(merged.decision.reason, "plan-done");
	});

	it("stops before starting a gated task and resumes", async () => {
		const s = await scenario({ tasks: [{ ...T1, gate: "publish" }] });
		assert.equal(nextAction(s.ctx).reason, "gate");
		const blocked = await start(s.ctx, "T1");
		assert.equal(blocked.kind, "stop");
		assert.equal(blocked.reason, "gate");
		assert.equal(readState(join(s.control, STATE_FILE)).stop.reason, "gate");

		assert.equal(resume(s.ctx).kind, "resumed");
		assert.equal(readState(join(s.control, STATE_FILE)).stop, null);
		stop(s.ctx, "human", "pause");
		assert.equal(readState(join(s.control, STATE_FILE)).stop.reason, "human");
	});

	it("reports status and next without mutating state", async () => {
		const s = await scenario();
		const before = statusAction(s.ctx);
		assert.equal(before.plan.tasks, 1);
		assert.equal(before.next.id, "T1");
		assert.equal(existsSync(join(s.control, STATE_FILE)), false);
		assert.equal(nextAction(s.ctx).kind, "task");
		assert.equal(existsSync(join(s.control, STATE_FILE)), false);
	});

	it("runs three tasks across a boundary handoff", async () => {
		const s = await scenario({
			tasks: [T1, T2, T3],
			plan: { budgets: { maxTasksPerSession: 2 } },
		});

		async function runTask(id, ctx) {
			const started = await start(ctx, id);
			assert.equal(started.kind, "started");
			await commitFile(started.worktree, `${id}.txt`, `${id}\n`);
			const verified = await verify(ctx, id);
			assert.equal(verified.ok, true);
			return finish(ctx, id, verified.commit, "ok");
		}

		const first = await runTask("T1", s.ctx);
		assert.equal(first.kind, "merged");
		assert.equal(first.decision.kind, "continue");

		const second = await runTask("T2", s.ctx);
		assert.equal(second.kind, "merged");
		assert.equal(second.decision.kind, "handoff");
		let state = readState(join(s.control, STATE_FILE));
		assert.equal(state.current, null);
		assert.equal(state.run.active, true);
		assert.equal(state.budgets.tasksThisSession, 2);
		assert.equal(state.completed.length, 2);

		const secondSession = join(tempDir(), "session2.jsonl");
		writeFileSync(secondSession, costLine(0.02));
		const nextCtx = { ...s.ctx, sessionFile: secondSession };
		const third = await runTask("T3", nextCtx);
		assert.equal(third.kind, "merged");
		assert.equal(third.decision.kind, "stop");
		assert.equal(third.decision.reason, "plan-done");

		state = readState(join(s.control, STATE_FILE));
		assert.deepEqual(
			state.completed.map((task) => task.id),
			["T1", "T2", "T3"],
		);
		assert.equal(state.stop.reason, "plan-done");
		assert.equal(state.budgets.tasksThisSession, 1);
	});

	it("runs the CLI status command", async () => {
		const s = await scenario();
		const result = await runCommand(
			process.execPath,
			[
				"--experimental-strip-types",
				join(ROOT, "bin/omp-orchestrate"),
				"status",
				"--json",
				"--dir",
				s.control,
			],
			{ cwd: s.control, timeoutMs: 120_000 },
		);
		assert.equal(result.code, 0, result.stderr);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.plan.tasks, 1);
		assert.equal(parsed.next.id, "T1");
	});
});

