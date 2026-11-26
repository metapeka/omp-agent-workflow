/**
 * Клиент `costs --json` cache-monitor: разбор конверта, цена границы и
 * graceful skip в `/handoff-preflight`. Сеть не нужна: CLI подменяется
 * исполняемым скриптом через `OMP_CACHE_MONITOR_CLI`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { runPreflight } from "../index.ts";
import {
	borderMetrics,
	readCostsSummary,
	resolveCostsCommand,
} from "../lib/costs-client.ts";

const MISSING_CLI = join(tmpdir(), "does-not-exist-omp-cache-monitor");

let tempDirs = [];
let savedCli;

beforeEach(() => {
	savedCli = process.env.OMP_CACHE_MONITOR_CLI;
	// Иначе на машине с установленным CLI тесты пойдут в настоящий бинарь.
	process.env.OMP_CACHE_MONITOR_CLI = MISSING_CLI;
});

afterEach(() => {
	if (savedCli === undefined) delete process.env.OMP_CACHE_MONITOR_CLI;
	else process.env.OMP_CACHE_MONITOR_CLI = savedCli;
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

function tempDir(prefix = "omp-costs-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function git(dir, args) {
	const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout;
}

function repo(files = { "HANDOFF.md": "# state\n" }) {
	const dir = tempDir();
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, ["config", "user.email", "costs@example.com"]);
	git(dir, ["config", "user.name", "costs"]);
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content);
	}
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-q", "-m", "init"]);
	return dir;
}

function cli(script, exitCode = 0) {
	const path = join(tempDir(), "omp-cache-monitor");
	writeFileSync(
		path,
		`#!/usr/bin/env node\n${script}\nprocess.exit(${exitCode});\n`,
	);
	chmodSync(path, 0o755);
	return path;
}

function cliJson(body, exitCode = 0) {
	return cli(`process.stdout.write(${JSON.stringify(JSON.stringify(body))});`, exitCode);
}

function turn({ at, cacheRead = 0, cost = null, model = "model-a" }) {
	return {
		at,
		model,
		costUsd: cost,
		inputTokens: 100,
		cacheReadTokens: cacheRead,
		cacheWriteTokens: 0,
		outputTokens: 10,
		reasoningTokens: 0,
		hitPercent: null,
	};
}

function report({ turns = [], models = [] } = {}) {
	return {
		schemaVersion: 1,
		generatedAt: "2026-11-27T00:00:00.000Z",
		session: "/tmp/session.jsonl",
		totals: {
			costUsd: null,
			inputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			outputTokens: 0,
			reasoningTokens: 0,
		},
		turns,
		models,
		notes: [],
	};
}

describe("costs client", () => {
	it("prefers the env override and falls back to PATH", () => {
		assert.deepEqual(
			resolveCostsCommand({ OMP_CACHE_MONITOR_CLI: "/custom/cli", PATH: "" }),
			{ command: "/custom/cli" },
		);
		const dir = tempDir();
		const path = join(dir, "omp-cache-monitor");
		writeFileSync(path, "#!/bin/sh\nexit 0\n");
		chmodSync(path, 0o755);
		assert.deepEqual(resolveCostsCommand({ PATH: dir }), { command: path });
		assert.equal(resolveCostsCommand({ PATH: join(dir, "nope") }), null);
	});

	it("computes the border from medians and skips the first turn", () => {
		const border = borderMetrics([
			turn({ at: "t1", cacheRead: 100, cost: 0.001 }),
			turn({ at: "t2", cacheRead: 0, cost: 0.01 }),
			turn({ at: "t3", cacheRead: 100, cost: 0.002 }),
		]);
		assert.equal(border.coldTurns, 1);
		assert.equal(border.warmTurns, 2);
		assert.equal(border.coldUsd, 0.01);
		assert.equal(border.warmUsd, 0.0015);
	});

	it("keeps an unknown price as null instead of zero", () => {
		const border = borderMetrics([
			turn({ at: "t1", cacheRead: 100, cost: null }),
			turn({ at: "t2", cacheRead: 0, cost: null }),
		]);
		assert.equal(border.coldUsd, null);
		assert.equal(border.warmUsd, null);
		assert.equal(border.coldTurns, 1);
	});

	it("reads a valid schemaVersion 1 report", () => {
		process.env.OMP_CACHE_MONITOR_CLI = cliJson(
			report({
				turns: [
					turn({ at: "t1", cacheRead: 100, cost: 0.001 }),
					turn({ at: "t2", cacheRead: 0, cost: 0.01 }),
				],
			}),
		);
		const summary = readCostsSummary("/tmp/session.jsonl");
		assert.equal(summary.report.schemaVersion, 1);
		assert.equal(summary.report.turns.length, 2);
		assert.equal(summary.border.coldUsd, 0.01);
	});

	it("skips on a non-zero exit, broken JSON or another schema", () => {
		process.env.OMP_CACHE_MONITOR_CLI = cliJson(report(), 1);
		assert.equal(readCostsSummary("/tmp/session.jsonl"), null);

		process.env.OMP_CACHE_MONITOR_CLI = cli("process.stdout.write('{');");
		assert.equal(readCostsSummary("/tmp/session.jsonl"), null);

		process.env.OMP_CACHE_MONITOR_CLI = cliJson({
			...report({ turns: [turn({ at: "t1", cacheRead: 1, cost: 1 })] }),
			schemaVersion: 2,
		});
		assert.equal(readCostsSummary("/tmp/session.jsonl"), null);
	});

	it("skips when the CLI is missing and when there is no session", () => {
		assert.equal(readCostsSummary("/tmp/session.jsonl"), null);
		process.env.OMP_CACHE_MONITOR_CLI = cliJson(report());
		assert.equal(readCostsSummary(null), null);
	});
});

describe("preflight costs rows", () => {
	it("adds the border row and a row per model", () => {
		const dir = repo();
		process.env.OMP_CACHE_MONITOR_CLI = cliJson(
			report({
				turns: [
					turn({ at: "t1", cacheRead: 100, cost: 0.001 }),
					turn({ at: "t2", cacheRead: 0, cost: 0.01 }),
					turn({ at: "t3", cacheRead: 100, cost: 0.002, model: "model-b" }),
				],
				models: [
					{ model: "model-a", turns: 2, costUsd: 0.011, hitPercent: 49.5 },
					{ model: "model-b", turns: 1, costUsd: 0.002, hitPercent: 99.9 },
				],
			}),
		);
		const checks = runPreflight(dir, "/tmp/session.jsonl").checks;
		const border = checks.find((check) => check.id === "usage-border");
		assert.ok(border);
		assert.match(border.text, /холодный ход \$0\.010 ·/);
		assert.match(border.text, /тёплый ход \$0\.0015/);
		assert.match(border.text, /холодных 1 из 3/);
		const models = checks.filter((check) => check.id === "usage-model");
		assert.equal(models.length, 2);
		assert.match(models[0].text, /model-a — 2 хода · \$0\.011 · hit 49\.5%/);
	});

	it("prints no extra rows when the CLI fails", () => {
		const dir = repo();
		process.env.OMP_CACHE_MONITOR_CLI = cliJson(report(), 1);
		const preflight = runPreflight(dir, "/tmp/session.jsonl");
		assert.equal(preflight.checks.some((check) => check.id === "usage-border"), false);
		assert.equal(preflight.checks.some((check) => check.id === "usage-model"), false);
		assert.equal(preflight.ready, true);
	});
});
