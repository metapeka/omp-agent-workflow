/**
 * CLI JSON contract v1: внешние обёртки (hub, Orca/Ensemble) читают только
 * `status --json` и `doctor --json`. Тесты фиксируют конверт и стабильные
 * поля, а не внутренности.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createInitialState, STATE_FILE, writeState } from "../lib/orchestrator/state.ts";
import { readPlan } from "../lib/orchestrator/plan.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NOW = new Date("2026-11-26T12:00:00.000Z");

const PLAN = `# AUTOPLAN
\`\`\`json plan
{
  "version": 1,
  "goal": "contracts",
  "worktreeRoot": "worktrees",
  "verify": ["true"]
}
\`\`\`
## T1
\`\`\`json task
{ "id": "T1", "title": "first", "acceptance": ["works"] }
\`\`\`
`;

let tempDirs = [];

function tempDir(prefix = "omp-contract-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

function makeRepo(plan = PLAN) {
	const dir = tempDir();
	execFileSync("git", ["init", "-q", "-b", "main", dir]);
	execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
	execFileSync("git", ["-C", dir, "config", "user.name", "Test"]);
	writeFileSync(join(dir, "README.md"), "base\n");
	execFileSync("git", ["-C", dir, "add", "."]);
	execFileSync("git", ["-C", dir, "commit", "-qm", "base"]);
	writeFileSync(join(dir, "AUTOPLAN.md"), plan);
	return dir;
}

function runCli(dir, args, env = process.env) {
	return spawnSync(
		process.execPath,
		[
			"--experimental-strip-types",
			"--disable-warning=ExperimentalWarning",
			join(ROOT, "bin/omp-orchestrate"),
			...args,
			"--dir",
			dir,
		],
		{ cwd: dir, encoding: "utf8", env },
	);
}

function statusJson(dir) {
	const result = runCli(dir, ["status", "--json"]);
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

function hasKeys(object, keys) {
	for (const key of keys) assert.ok(key in object, `missing ${key}`);
}

describe("CLI JSON v1", () => {
	it("keeps the status envelope and stable plan fields without state", () => {
		const dir = makeRepo();
		const parsed = statusJson(dir);

		assert.deepEqual(Object.keys(parsed).sort(), [
			"next",
			"plan",
			"schemaVersion",
			"spend",
			"state",
			"stop",
		]);
		assert.equal(parsed.schemaVersion, 1);
		hasKeys(parsed.plan, ["path", "hash", "goal", "tasks", "completed"]);
		assert.equal(parsed.plan.tasks, 1);
		assert.equal(parsed.state, null);
		assert.equal(parsed.stop, null);
		assert.equal(parsed.next.id, "T1");
		assert.equal(parsed.spend, null);
	});

	it("exposes state.run, current, completed and stop when state exists", () => {
		const dir = makeRepo();
		const plan = readPlan(join(dir, "AUTOPLAN.md"));
		const state = createInitialState({
			planPath: plan.path,
			planHash: plan.hash,
			mode: "assisted",
			sessionFile: null,
			now: NOW,
		});
		state.current = {
			id: "T1",
			branch: "feat/T1",
			worktree: "/tmp/contract-worktree",
			status: "running",
			commit: null,
			startedAt: NOW.toISOString(),
			checks: [],
		};
		writeState(join(dir, STATE_FILE), state);

		const parsed = statusJson(dir);
		assert.equal(parsed.state.version, 1);
		assert.equal(parsed.state.run.active, true);
		hasKeys(parsed.state.run, ["id", "active", "startedAt", "mode"]);
		hasKeys(parsed.state.current, [
			"id",
			"status",
			"branch",
			"worktree",
			"commit",
		]);
		assert.deepEqual(parsed.state.completed, []);
		assert.equal(parsed.state.stop, null);
		assert.equal(parsed.next.id, "T1");
		// 0.7.4: аддитивный блок леджера; без session-файла сумма не измерена.
		assert.deepEqual(Object.keys(parsed.spend).sort(), [
			"exceeded",
			"files",
			"limitUsd",
			"measured",
			"remainingUsd",
			"spentUsd",
		]);
		assert.equal(parsed.spend.measured, false);
		assert.equal(parsed.spend.spentUsd, 0);
		assert.equal(parsed.spend.limitUsd, 5);
		assert.equal(parsed.spend.exceeded, false);
		assert.deepEqual(parsed.spend.files, []);
	});

	it("ignores unknown additive plan fields", () => {
		const plan = PLAN.replace(
			'"verify": ["true"]',
			'"verify": ["true"], "futureField": { "x": 1 }',
		);
		assert.notEqual(plan, PLAN);
		const parsed = statusJson(makeRepo(plan));
		assert.equal(parsed.plan.tasks, 1);
	});

	it("keeps the doctor envelope and check shape", () => {
		const dir = makeRepo();
		const env = {
			...process.env,
			PATH: "/usr/bin:/bin",
			ORCA_CLI_COMMAND: "/nonexistent-orca",
		};
		delete env.OMP_BIN;
		delete env.ORCA_TERMINAL_HANDLE;
		const result = runCli(dir, ["doctor", "--json"], env);
		const parsed = JSON.parse(result.stdout);

		assert.deepEqual(Object.keys(parsed).sort(), [
			"checks",
			"ok",
			"schemaVersion",
			"strict",
			"summary",
		]);
		assert.equal(parsed.schemaVersion, 1);
		assert.equal(parsed.ok, parsed.summary.fail === 0);
		assert.equal(result.status, parsed.ok ? 0 : 1);
		assert.deepEqual(Object.keys(parsed.summary).sort(), [
			"fail",
			"pass",
			"skip",
			"total",
			"warn",
		]);
		assert.equal(parsed.checks.length, parsed.summary.total);
		for (const check of parsed.checks) {
			assert.deepEqual(Object.keys(check).sort(), ["detail", "id", "level"]);
			assert.ok(
				["pass", "warn", "skip", "fail"].includes(check.level),
				check.level,
			);
			assert.equal(typeof check.detail, "string");
			assert.ok(check.detail.length > 0);
		}
	});
});
