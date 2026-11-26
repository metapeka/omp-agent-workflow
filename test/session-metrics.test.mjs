/**
 * F3-метрики preflight: разбор session JSONL, оценка границы и строки
 * `usage`/`plan`/`run` в `/handoff-preflight`. Контракт preflight —
 * read-only, поэтому проверяем только чтение и вывод.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { runPreflight } from "../index.ts";
import {
	cacheHitPercent,
	formatTokens,
	formatUsd,
	lastReasoningShare,
	readSessionMetrics,
} from "../lib/session-metrics.ts";

let tempDirs = [];

function tempDir(prefix = "omp-metrics-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

function git(dir, args) {
	const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout;
}

function repo(files = {}) {
	const dir = tempDir();
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, ["config", "user.email", "metrics@example.com"]);
	git(dir, ["config", "user.name", "metrics"]);
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content);
	}
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-q", "-m", "init"]);
	return dir;
}

function assistantUsage(usage, extra = {}) {
	return JSON.stringify({
		type: "message",
		message: {
			role: "assistant",
			model: "deepseek-v4.1-flash-1017",
			usage,
			...extra,
		},
	});
}

function sessionFile(rows) {
	const path = join(tempDir("omp-session-"), "session.jsonl");
	writeFileSync(path, `${rows.join("\n")}\n`);
	return path;
}

describe("session metrics", () => {
	it("reads only assistant chat usage, not model_usage service records", () => {
		const path = sessionFile([
			assistantUsage(
				{
					input: 100,
					output: 50,
					cacheRead: 900,
					cacheWrite: 0,
					reasoningTokens: 10,
					cost: {
						input: 0.000026,
						output: 0.00005,
						cacheRead: 0.000018,
						total: 0.000094,
					},
				},
				{ contextSnapshot: { nonMessageTokens: 15_000 } },
			),
			JSON.stringify({
				type: "model_usage",
				purpose: "title-fork",
				usage: { input: 7, output: 7, cacheRead: 0, cost: { total: 0.5 } },
			}),
			JSON.stringify({ type: "message", message: { role: "user" } }),
			"not json",
		]);
		const metrics = readSessionMetrics(path);
		assert.equal(metrics.available, true);
		assert.equal(metrics.requests, 1);
		assert.equal(metrics.input, 100);
		assert.equal(metrics.cacheRead, 900);
		assert.equal(metrics.output, 50);
		assert.equal(metrics.reasoning, 10);
		assert.equal(metrics.costUsd, 0.000094);
		assert.equal(cacheHitPercent(metrics), 90);
		assert.equal(lastReasoningShare(metrics), 20);
	});

	it("reports unavailable for a missing file and empty for a fresh session", () => {
		assert.equal(readSessionMetrics(null).available, false);
		assert.equal(
			readSessionMetrics(join(tempDir(), "absent.jsonl")).available,
			false,
		);
		const empty = readSessionMetrics(sessionFile([""]));
		assert.equal(empty.available, true);
		assert.equal(empty.requests, 0);
		assert.equal(cacheHitPercent(empty), null);
		assert.equal(lastReasoningShare(empty), null);
	});

	it("treats a null reasoning count as zero", () => {
		const metrics = readSessionMetrics(
			sessionFile([
				assistantUsage({
					input: 10,
					output: 5,
					cacheRead: 0,
					reasoningTokens: null,
					cost: { input: 0.001, output: 0.001, cacheRead: 0, total: 0.002 },
				}),
			]),
		);
		assert.equal(metrics.last.reasoning, 0);
		assert.equal(lastReasoningShare(metrics), 0);
	});

	it("keeps UTF-8 intact across chunk boundaries", () => {
		const padding = JSON.stringify({
			type: "message",
			message: { role: "user", content: "я".repeat(700_000) },
		});
		assert.ok(Buffer.byteLength(padding) > (1 << 20));
		const usage = assistantUsage(
			{
				input: 200,
				output: 20,
				cacheRead: 800,
				reasoningTokens: 5,
				cost: { input: 0.0001, output: 0.0001, cacheRead: 0.0001, total: 0.0003 },
			},
			{ contextSnapshot: { nonMessageTokens: 12_000 } },
		);
		const metrics = readSessionMetrics(sessionFile([padding, usage]));
		assert.equal(metrics.requests, 1);
		assert.equal(metrics.cacheRead, 800);
	});

	it("formats tokens and dollars without false precision", () => {
		assert.deepEqual(
			[950, 1200, 34_000, 4_200_000, 12_000_000].map(formatTokens),
			["950", "1.2k", "34k", "4.2M", "12M"],
		);
		assert.deepEqual(
			[0, 0.0003, 0.1234, 1.2345].map(formatUsd),
			["$0", "$0.0003", "$0.123", "$1.23"],
		);
	});
});

describe("preflight metrics", () => {
	it("warns when the state file grows past the soft limit", () => {
		const dir = repo({ "HANDOFF.md": "x".repeat(25_000) });
		const report = runPreflight(dir, null);
		const state = report.checks.find((check) => check.id === "state");
		assert.equal(state.status, "warn");
		assert.match(state.text, /25000 символов \/ 32000 — сократи state/);
	});

	it("shows plan progress, next task gate and run spend", () => {
		const plan = `# AUTOPLAN
\`\`\`json plan
{
  "version": 1,
  "goal": "metrics",
  "worktreeRoot": "worktrees",
  "verify": ["true"],
  "budgets": { "maxSpendUsd": 5 }
}
\`\`\`
## T1
\`\`\`json task
{ "id": "T1", "title": "first", "acceptance": ["works"] }
\`\`\`
## T2
\`\`\`json task
{ "id": "T2", "title": "second", "deps": ["T1"], "gate": "publish",
  "acceptance": ["works"] }
\`\`\`
`;
		const state = {
			version: 1,
			plan: { path: "AUTOPLAN.md", hash: "sha256:x" },
			run: {
				id: "run-1",
				active: true,
				startedAt: "2026-11-26T00:00:00.000Z",
				sessionFile: null,
				mode: "yoda",
			},
			current: {
				id: "T2",
				branch: "feat/t2",
				worktree: "/tmp/t2",
				status: "running",
				commit: null,
				startedAt: "2026-11-26T00:00:00.000Z",
				checks: [],
			},
			completed: [
				{
					id: "T1",
					commit: "abc1234",
					mergedAt: "2026-11-26T00:10:00.000Z",
					checks: [],
				},
			],
			attempts: { T2: 1 },
			budgets: { tasksThisSession: 1, spendUsd: 4.8, costOffsets: {} },
			context: null,
			lastHandoff: null,
			stop: null,
		};
		const dir = repo({
			"HANDOFF.md": "# state\n",
			"AUTOPLAN.md": plan,
			"STATE.json": `${JSON.stringify(state, null, 2)}\n`,
		});
		const report = runPreflight(dir, null);
		const planCheck = report.checks.find((check) => check.id === "plan");
		assert.match(planCheck.text, /план: 1\/2 задач, следующая T2, gate publish, deps T1/);
		const attempts = report.checks.find((check) => check.id === "attempts");
		assert.equal(attempts.status, "warn");
		assert.match(attempts.text, /T2×1/);
		const run = report.checks.find((check) => check.id === "run");
		assert.equal(run.status, "warn");
		assert.match(run.text, /run: T2 run, spend \$4\.80 \/ \$5\.00/);
	});

	it("stays quiet about the plan when AUTOPLAN.md is absent", () => {
		const dir = repo({ "HANDOFF.md": "# state\n" });
		const report = runPreflight(dir, null);
		const plan = report.checks.find((check) => check.id === "plan");
		assert.equal(plan.status, "pass");
		assert.match(plan.text, /нет AUTOPLAN\.md/);
		assert.equal(
			report.checks.some((check) => check.id === "run"),
			false,
		);
	});

	it("adds usage rows from the session file", () => {
		const dir = repo({ "HANDOFF.md": "# state\n" });
		const rows = [];
		for (let index = 0; index < 6; index += 1) {
			rows.push(
				assistantUsage(
					{
						input: 4_000,
						output: 100,
						cacheRead: 30_000,
						reasoningTokens: index === 5 ? 60 : 20,
						cost: {
							input: 0.00104,
							output: 0.0001,
							cacheRead: 0.0006,
							total: 0.00174,
						},
					},
					{ contextSnapshot: { nonMessageTokens: 15_000 } },
				),
			);
		}
		const report = runPreflight(dir, sessionFile(rows));
		const cache = report.checks.find((check) => check.id === "usage-cache");
		assert.equal(cache.status, "pass");
		assert.match(cache.text, /cache hit 88\.2%/);
		const last = report.checks.find((check) => check.id === "usage-last");
		assert.match(last.text, /reasoning 60% последнего хода/);
		assert.match(last.text, /\$0\.010 за сессию/);
	});

	it("warns about a low cache hit on a long session", () => {
		const dir = repo({ "HANDOFF.md": "# state\n" });
		const rows = [];
		for (let index = 0; index < 6; index += 1) {
			rows.push(
				assistantUsage({
					input: 20_000,
					output: 100,
					cacheRead: 5_000,
					reasoningTokens: 10,
					cost: { input: 0.005, output: 0.0001, cacheRead: 0.0001, total: 0.0052 },
				}),
			);
		}
		const report = runPreflight(dir, sessionFile(rows));
		const cache = report.checks.find((check) => check.id === "usage-cache");
		assert.equal(cache.status, "warn");
		assert.match(cache.text, /cache hit 20\.0%/);
	});
});
