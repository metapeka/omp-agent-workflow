/**
 * `omp-orchestrate economics`: цепочка по `parentSession`, границы только у
 * детей с маркером `custom_message/handoff`, окна ходов, медианы, recovery,
 * компакции, notes и graceful skip без cache-monitor.
 *
 * Ходы подменяются fake CLI: `OMP_CACHE_MONITOR_CLI` указывает на shell-скрипт,
 * который печатает `<session>.costs.json`. Сеть и настоящий cache-monitor не
 * нужны.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	EconomicsSessionError,
	MAX_CHAIN_NODES,
	buildEconomicsReport,
	recoveryTurns,
	renderEconomics,
	resolveLatestSession,
	summarizeEconomics,
	windowMetrics,
} from "../lib/handoff-economics.ts";

const CLI = fileURLToPath(new URL("../bin/omp-orchestrate", import.meta.url));
const MISSING_CLI = join(tmpdir(), "does-not-exist-omp-cache-monitor");

let tempDirs = [];
let savedCli;

beforeEach(() => {
	savedCli = process.env.OMP_CACHE_MONITOR_CLI;
	process.env.OMP_CACHE_MONITOR_CLI = MISSING_CLI;
});

afterEach(() => {
	if (savedCli === undefined) delete process.env.OMP_CACHE_MONITOR_CLI;
	else process.env.OMP_CACHE_MONITOR_CLI = savedCli;
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

function tempDir(prefix = "omp-economics-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

/** Shell-шим cache-monitor: аргументы как у настоящего CLI, данные — рядом. */
function fakeCli() {
	const dir = tempDir("omp-economics-cli-");
	const file = join(dir, "omp-cache-monitor");
	writeFileSync(
		file,
		`#!/bin/sh
session=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session) shift; session="$1" ;;
  esac
  shift
done
if [ -z "$session" ] || [ ! -f "$session.costs.json" ]; then
  echo "no costs" >&2
  exit 1
fi
cat "$session.costs.json"
`,
	);
	chmodSync(file, 0o755);
	return file;
}

function writeSession(file, { id, timestamp, parent = null, handoff = false, lines = [] }) {
	const records = [
		{
			type: "session",
			version: 3,
			id,
			timestamp,
			cwd: "/tmp/work",
			...(parent ? { parentSession: parent } : {}),
		},
	];
	if (handoff) {
		records.push({
			type: "custom_message",
			customType: "handoff",
			content: "продолжай",
			timestamp,
		});
	}
	records.push(...lines);
	writeFileSync(
		file,
		`${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
	);
	return file;
}

function turn(at, costUsd, inputTokens, cacheReadTokens) {
	const denominator = inputTokens + cacheReadTokens;
	return {
		at,
		model: "test-model",
		costUsd,
		inputTokens,
		cacheReadTokens,
		cacheWriteTokens: 0,
		outputTokens: 10,
		reasoningTokens: 0,
		hitPercent:
			denominator === 0
				? null
				: Math.round((cacheReadTokens / denominator) * 1000) / 10,
	};
}

function writeCosts(file, turns) {
	const report = {
		schemaVersion: 1,
		generatedAt: "2026-11-27T00:00:00.000Z",
		session: file,
		totals: {
			costUsd: turns.reduce((sum, item) => sum + (item.costUsd ?? 0), 0),
			inputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			outputTokens: 0,
			reasoningTokens: 0,
		},
		turns,
		models: [],
		notes: [],
	};
	writeFileSync(`${file}.costs.json`, JSON.stringify(report));
}

function runCli(args, env = process.env) {
	const result = spawnSync(
		process.execPath,
		["--experimental-strip-types", CLI, ...args],
		{ encoding: "utf8", env },
	);
	return result;
}

/** Родитель → ребёнок с handoff: окна по 2 хода, ребёнок холодный дважды. */
function chainFixture() {
	const dir = tempDir();
	const parent = join(dir, "2026-11-22T21-34-28-816Z_01a2052e-aaa.jsonl");
	const child = join(dir, "2026-11-23T01-04-08-741Z_01a205ee-bbb.jsonl");
	writeSession(parent, {
		id: "01a2052e",
		timestamp: "2026-11-22T21:34:28.816Z",
	});
	writeSession(child, {
		id: "01a205ee",
		timestamp: "2026-11-23T01:04:08.741Z",
		parent,
		handoff: true,
	});
	writeCosts(parent, [
		turn("2026-11-22T21:35:00.000Z", 0.001, 0, 100),
		turn("2026-11-22T21:36:00.000Z", 0.002, 0, 100),
		turn("2026-11-22T21:37:00.000Z", 0.003, 0, 100),
		turn("2026-11-22T21:38:00.000Z", 0.004, 0, 100),
		turn("2026-11-22T21:39:00.000Z", 0.005, 0, 100),
	]);
	writeCosts(child, [
		turn("2026-11-23T01:04:30.000Z", 0.05, 100, 0),
		turn("2026-11-23T01:05:00.000Z", 0.04, 100, 0),
		turn("2026-11-23T01:06:00.000Z", 0.002, 0, 100),
		turn("2026-11-23T01:07:00.000Z", 0.002, 0, 100),
	]);
	return { dir, parent, child };
}

describe("handoff economics: chain and boundaries", () => {
	it("builds the chain oldest→newest and one boundary for a handoff child", () => {
		const { parent, child } = chainFixture();
		const report = buildEconomicsReport({
			sessionFile: child,
			turns: 2,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
			now: () => new Date("2026-11-27T00:00:00.000Z"),
		});

		assert.equal(report.schemaVersion, 1);
		assert.equal(report.session, child);
		assert.equal(report.turnsWindow, 2);
		assert.equal(report.generatedAt, "2026-11-27T00:00:00.000Z");
		assert.deepEqual(
			report.chain.map((node) => node.session),
			[parent, child],
		);
		assert.deepEqual(
			report.chain.map((node) => node.handoff),
			[false, true],
		);
		assert.equal(report.chain[1].parentSession, parent);
		assert.equal(report.chain[0].startedAt, "2026-11-22T21:34:28.816Z");

		assert.equal(report.boundaries.length, 1);
		const boundary = report.boundaries[0];
		assert.equal(boundary.from, parent);
		assert.equal(boundary.to, child);
		assert.equal(boundary.at, "2026-11-23T01:04:08.741Z");
		assert.deepEqual(boundary.before, {
			turns: 2,
			costPerTurnUsd: 0.0045,
			hitPercent: 100,
		});
		assert.deepEqual(boundary.after, {
			turns: 2,
			costPerTurnUsd: 0.045,
			hitPercent: 0,
		});
		assert.deepEqual(boundary.boundary, {
			firstTurnUsd: 0.05,
			recoveryTurns: 2,
		});
		assert.deepEqual(boundary.delta, {
			costPerTurnUsd: 0.0405,
			hitPercent: -100,
		});
		assert.deepEqual(report.compactions, []);
		assert.ok(report.notes.includes("компакций не найдено"));
	});

	it("windowMetrics uses the median of priced turns and token sums for hit", () => {
		const turns = [
			turn("a", 0.001, 0, 100),
			turn("b", null, 100, 300),
			turn("c", 0.003, 0, 200),
			turn("d", 0.009, 0, 100),
		];
		assert.deepEqual(windowMetrics(turns), {
			turns: 4,
			costPerTurnUsd: 0.003,
			hitPercent: 87.5,
		});
		assert.deepEqual(windowMetrics([]), {
			turns: 0,
			costPerTurnUsd: null,
			hitPercent: null,
		});
	});

	it("recoveryTurns counts leading cold turns and stops at the first warm one", () => {
		assert.equal(
			recoveryTurns([
				turn("a", 0.1, 100, 0),
				turn("b", 0.1, 100, 0),
				turn("c", 0.1, 0, 100),
				turn("d", 0.1, 100, 0),
			]),
			2,
		);
		assert.equal(recoveryTurns([turn("a", 0.1, 0, 100)]), 0);
		assert.equal(recoveryTurns([]), 0);
	});

	it("a subagent child without the handoff marker is not a boundary", () => {
		const dir = tempDir();
		const parent = join(dir, "parent.jsonl");
		const child = join(dir, "subagent.jsonl");
		writeSession(parent, { id: "p", timestamp: "2026-11-22T00:00:00.000Z" });
		writeSession(child, {
			id: "s",
			timestamp: "2026-11-22T01:00:00.000Z",
			parent,
		});
		writeCosts(parent, [turn("a", 0.001, 0, 100)]);
		writeCosts(child, [turn("b", 0.002, 0, 100)]);
		const report = buildEconomicsReport({
			sessionFile: child,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		assert.equal(report.chain.length, 2);
		assert.deepEqual(report.boundaries, []);
		assert.ok(report.notes.includes("границ handoff в цепочке нет"));
	});

	it("clamps --turns into 1..100", () => {
		const { child } = chainFixture();
		const env = { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() };
		const wide = buildEconomicsReport({ sessionFile: child, turns: 999, env });
		assert.equal(wide.turnsWindow, 100);
		// Ходов меньше окна — turns фактический, без падения.
		assert.equal(wide.boundaries[0].before.turns, 5);
		assert.equal(wide.boundaries[0].after.turns, 4);
		const narrow = buildEconomicsReport({ sessionFile: child, turns: 0, env });
		assert.equal(narrow.turnsWindow, 1);
		assert.equal(narrow.boundaries[0].before.turns, 1);
	});

	it("truncates the chain at MAX_CHAIN_NODES with a note", () => {
		const dir = tempDir();
		const files = [];
		for (let index = 0; index < MAX_CHAIN_NODES + 2; index += 1) {
			const file = join(dir, `s${String(index).padStart(2, "0")}.jsonl`);
			writeSession(file, {
				id: `s${index}`,
				timestamp: `2026-11-22T00:${String(index).padStart(2, "0")}:00.000Z`,
				parent: index === 0 ? null : files[index - 1],
			});
			files.push(file);
		}
		const report = buildEconomicsReport({
			sessionFile: files[files.length - 1],
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: MISSING_CLI },
		});
		assert.equal(report.chain.length, MAX_CHAIN_NODES);
		assert.equal(report.chain[report.chain.length - 1].session, files[files.length - 1]);
		assert.ok(
			report.notes.some((note) =>
				note.includes(`обрезана на ${MAX_CHAIN_NODES} узлах`),
			),
		);
	});

	it("notes a self-cycle and stops", () => {
		const dir = tempDir();
		const file = join(dir, "self.jsonl");
		writeSession(file, {
			id: "self",
			timestamp: "2026-11-23T00:00:00.000Z",
			parent: file,
		});
		const report = buildEconomicsReport({
			sessionFile: file,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: MISSING_CLI },
		});
		assert.equal(report.chain.length, 1);
		assert.ok(report.notes.some((note) => note.startsWith("цикл parentSession")));
	});
});

describe("handoff economics: broken and missing input", () => {
	it("notes a missing parent and still reports the start session", () => {
		const dir = tempDir();
		const child = join(dir, "child.jsonl");
		const ghost = join(dir, "ghost.jsonl");
		writeSession(child, {
			id: "c",
			timestamp: "2026-11-23T00:00:00.000Z",
			parent: ghost,
			handoff: true,
		});
		writeCosts(child, [turn("a", 0.001, 0, 100)]);
		const report = buildEconomicsReport({
			sessionFile: child,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		assert.equal(report.chain.length, 1);
		assert.equal(report.chain[0].session, child);
		assert.deepEqual(report.boundaries, []);
		assert.ok(
			report.notes.some((note) => note.includes("родительская сессия отсутствует")),
		);
		assert.ok(report.notes.includes("границ handoff в цепочке нет"));
	});

	it("notes a cycle instead of looping forever", () => {
		const dir = tempDir();
		const a = join(dir, "a.jsonl");
		const b = join(dir, "b.jsonl");
		writeSession(a, { id: "a", timestamp: "2026-11-23T00:00:00.000Z", parent: b });
		writeSession(b, { id: "b", timestamp: "2026-11-22T00:00:00.000Z", parent: a });
		const report = buildEconomicsReport({
			sessionFile: a,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		assert.equal(report.chain.length, 2);
		assert.ok(report.notes.some((note) => note.startsWith("цикл parentSession")));
	});

	it("notes a parent whose JSONL has no session metadata", () => {
		const dir = tempDir();
		const parent = join(dir, "broken.jsonl");
		const child = join(dir, "child.jsonl");
		writeFileSync(parent, "not json\n{\"type\":\"message\"}\n");
		writeSession(child, {
			id: "c",
			timestamp: "2026-11-23T00:00:00.000Z",
			parent,
		});
		const report = buildEconomicsReport({
			sessionFile: child,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		assert.equal(report.chain.length, 2);
		assert.equal(report.chain[0].startedAt, null);
		assert.ok(
			report.notes.some((note) => note.includes("метаданные сессии не найдены")),
		);
	});

	it("throws for a missing start session", () => {
		assert.throws(
			() =>
				buildEconomicsReport({
					sessionFile: join(tempDir(), "nope.jsonl"),
				}),
			(error) =>
				error instanceof EconomicsSessionError &&
				error.message.includes("сессия не найдена"),
		);
	});

	it("throws for a start file without session metadata", () => {
		const file = join(tempDir(), "garbage.jsonl");
		writeFileSync(file, "garbage\n");
		assert.throws(
			() => buildEconomicsReport({ sessionFile: file }),
			(error) => error instanceof EconomicsSessionError,
		);
	});

	it("without cache-monitor the boundaries are empty and notes explain why", () => {
		const { child } = chainFixture();
		const report = buildEconomicsReport({
			sessionFile: child,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: MISSING_CLI },
		});
		assert.deepEqual(report.boundaries, []);
		assert.ok(report.chain.length === 2);
		assert.ok(
			report.notes.some((note) => note.includes("omp-cache-monitor не найден")),
		);
	});

	it("a broken costs report skips the boundary with a note", () => {
		const { parent, child } = chainFixture();
		writeFileSync(`${parent}.costs.json`, "{not json");
		const report = buildEconomicsReport({
			sessionFile: child,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		assert.deepEqual(report.boundaries, []);
		assert.ok(!report.notes.includes("границ handoff в цепочке нет"));
		assert.ok(
			report.notes.some(
				(note) =>
					note.includes("costs --json недоступен") &&
					note.includes("01a2052e-aaa"),
			),
		);
	});

	it("notes turns without prices instead of inventing zeros", () => {
		const { parent, child } = chainFixture();
		writeCosts(parent, [turn("a", null, 100, 100)]);
		const report = buildEconomicsReport({
			sessionFile: child,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		const boundary = report.boundaries[0];
		assert.equal(boundary.before.costPerTurnUsd, null);
		assert.equal(boundary.delta.costPerTurnUsd, null);
		assert.ok(
			report.notes.some((note) => note.startsWith("нет цен ходов в окне")),
		);
	});
});

describe("handoff economics: compactions", () => {
	it("collects compaction records across the chain in chronological order", () => {
		const dir = tempDir();
		const parent = join(dir, "parent.jsonl");
		const child = join(dir, "child.jsonl");
		writeSession(parent, {
			id: "p",
			timestamp: "2026-11-22T00:00:00.000Z",
			lines: [
				{
					type: "compaction",
					timestamp: "2026-11-22T05:00:00.000Z",
					usage: { cost: { total: 0.002 } },
				},
			],
		});
		writeSession(child, {
			id: "c",
			timestamp: "2026-11-23T00:00:00.000Z",
			parent,
			handoff: true,
			lines: [
				{
					type: "custom_message",
					customType: "compaction",
					timestamp: "2026-11-23T01:00:00.000Z",
				},
				{
					type: "model_usage",
					purpose: "compaction:auto",
					timestamp: "2026-11-23T02:00:00.000Z",
					usage: { cost: { total: 0.003 } },
				},
				{
					type: "model_usage",
					purpose: "title",
					timestamp: "2026-11-23T03:00:00.000Z",
					usage: { cost: { total: 9.9 } },
				},
			],
		});
		writeCosts(parent, [turn("a", 0.001, 0, 100)]);
		writeCosts(child, [turn("b", 0.001, 0, 100)]);
		const report = buildEconomicsReport({
			sessionFile: child,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		assert.deepEqual(
			report.compactions.map((item) => [item.at, item.costUsd]),
			[
				["2026-11-22T05:00:00.000Z", 0.002],
				["2026-11-23T01:00:00.000Z", null],
				["2026-11-23T02:00:00.000Z", 0.003],
			],
		);
		assert.ok(
			report.compactions.every((item) =>
				[parent, child].includes(item.session),
			),
		);
		assert.ok(!report.notes.includes("компакций не найдено"));
	});
});

describe("handoff economics: latest live session", () => {
	it("picks the freshest live entry from .omp-handoff-session.json", () => {
		const dir = tempDir();
		const older = join(dir, "older.jsonl");
		const newer = join(dir, "newer.jsonl");
		writeFileSync(
			join(dir, ".omp-handoff-session.json"),
			JSON.stringify({
				sessions: [
					{
						sessionFile: newer,
						pid: process.pid,
						updatedAt: "2026-11-26T22:05:35.245Z",
					},
					{
						sessionFile: older,
						pid: process.pid,
						updatedAt: "2026-11-25T00:00:00.000Z",
					},
				],
			}),
		);
		assert.equal(resolveLatestSession(dir), newer);
	});

	it("ignores dead pids and a missing file", () => {
		const dir = tempDir();
		const dead = spawnSync(process.execPath, ["-e", "0"], { encoding: "utf8" });
		writeFileSync(
			join(dir, ".omp-handoff-session.json"),
			JSON.stringify({
				sessions: [
					{
						sessionFile: join(dir, "dead.jsonl"),
						pid: dead.pid,
						updatedAt: "2026-11-26T22:05:35.245Z",
					},
				],
			}),
		);
		assert.equal(resolveLatestSession(dir), null);
		assert.equal(resolveLatestSession(join(dir, "nowhere")), null);
	});
});

describe("handoff economics: CLI", () => {
	it("prints the JSON contract with exit 0", () => {
		const { child } = chainFixture();
		const cli = fakeCli();
		const result = runCli(
			["economics", "--json", "--session", child, "--turns", "2"],
			{ ...process.env, OMP_CACHE_MONITOR_CLI: cli },
		);
		assert.equal(result.status, 0, result.stderr);
		const report = JSON.parse(result.stdout);
		assert.equal(report.schemaVersion, 1);
		assert.equal(report.session, child);
		assert.equal(report.turnsWindow, 2);
		assert.ok(Array.isArray(report.chain));
		assert.ok(Array.isArray(report.boundaries));
		assert.ok(Array.isArray(report.compactions));
		assert.ok(Array.isArray(report.notes));
		for (const node of report.chain) {
			assert.equal(typeof node.session, "string");
			assert.equal(typeof node.handoff, "boolean");
			assert.ok(node.startedAt === null || typeof node.startedAt === "string");
			assert.ok(
				node.parentSession === null ||
					typeof node.parentSession === "string",
			);
		}
		const boundary = report.boundaries[0];
		assert.equal(typeof boundary.from, "string");
		assert.equal(typeof boundary.to, "string");
		assert.equal(typeof boundary.before.turns, "number");
		assert.equal(typeof boundary.boundary.recoveryTurns, "number");
		assert.equal(typeof boundary.delta.costPerTurnUsd, "number");
	});

	it("loads the latest live session with --dir and no --session", () => {
		const { dir, child } = chainFixture();
		writeFileSync(
			join(dir, ".omp-handoff-session.json"),
			JSON.stringify({
				sessions: [
					{
						sessionFile: child,
						pid: process.pid,
						updatedAt: "2026-11-26T22:05:35.245Z",
					},
				],
			}),
		);
		const result = runCli(
			["economics", "--json", "--dir", dir],
			{ ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(JSON.parse(result.stdout).session, child);
	});

	it("without a session exits 1 and prints no JSON", () => {
		const dir = tempDir();
		const result = runCli(["economics", "--json", "--dir", dir]);
		assert.equal(result.status, 1);
		assert.equal(result.stdout.trim(), "");
		assert.match(result.stderr, /сессия не найдена/);
	});

	it("exits 1 for a missing --session file", () => {
		const result = runCli([
			"economics",
			"--json",
			"--session",
			join(tempDir(), "nope.jsonl"),
		]);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /сессия не найдена/);
	});

	it("exits 2 for an invalid --turns and prints no JSON", () => {
		const { child } = chainFixture();
		const result = runCli([
			"economics",
			"--json",
			"--session",
			child,
			"--turns",
			"abc",
		]);
		assert.equal(result.status, 2);
		assert.equal(result.stdout.trim(), "");
		assert.match(result.stderr, /--turns/);
	});

	it("validates --turns before looking for a session", () => {
		const empty = tempDir();
		const result = runCli([
			"economics",
			"--json",
			"--dir",
			empty,
			"--turns",
			"abc",
		]);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /--turns/);
	});

	it("rejects an empty --turns value instead of clamping it", () => {
		const { child } = chainFixture();
		const result = runCli([
			"economics",
			"--json",
			"--session",
			child,
			"--turns=",
		]);
		assert.equal(result.status, 2);
		assert.equal(result.stdout.trim(), "");
		assert.match(result.stderr, /--turns/);
	});

	it("accepts --session-file as an alias of --session", () => {
		const { child } = chainFixture();
		const result = runCli(
			["economics", "--json", "--session-file", child, "--turns", "2"],
			{ ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		);
		assert.equal(result.status, 0, result.stderr);
		const report = JSON.parse(result.stdout);
		assert.equal(report.session, child);
		assert.equal(report.boundaries.length, 1);
	});

	it("skips gracefully without cache-monitor: exit 0, empty boundaries", () => {
		const { child } = chainFixture();
		const result = runCli(
			["economics", "--json", "--session", child],
			{ ...process.env, OMP_CACHE_MONITOR_CLI: MISSING_CLI },
		);
		assert.equal(result.status, 0, result.stderr);
		const report = JSON.parse(result.stdout);
		assert.deepEqual(report.boundaries, []);
		assert.ok(report.notes.some((note) => note.includes("omp-cache-monitor")));
	});
});

describe("handoff economics: human output", () => {
	it("renders one block per boundary and no JSON", () => {
		const { child } = chainFixture();
		const report = buildEconomicsReport({
			sessionFile: child,
			turns: 2,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		const text = renderEconomics(report);
		assert.ok(text.startsWith("HANDOFF ECONOMICS · 1 граница · окно 2 хода"));
		assert.ok(text.includes("FROM"));
		assert.ok(text.includes("$0.0045/ход"));
		assert.ok(text.includes("$0.0450/ход"));
		assert.ok(text.includes("+$0.0405"));
		assert.ok(text.includes("hit"));
		assert.ok(text.includes("-100.0 pp"));
		assert.ok(text.includes("граница: первый ход $0.0500 · холодных подряд 2"));
		assert.ok(text.includes("Компакции: нет записей."));
		assert.ok(!text.includes("schemaVersion"));
	});

	it("renders two boundaries as separate blocks with one header", () => {
		const dir = tempDir();
		const first = join(dir, "2026-11-21T00-00-00-000Z_aaaa0001.jsonl");
		const second = join(dir, "2026-11-22T00-00-00-000Z_bbbb0002.jsonl");
		const third = join(dir, "2026-11-23T00-00-00-000Z_cccc0003.jsonl");
		writeSession(first, { id: "a", timestamp: "2026-11-21T00:00:00.000Z" });
		writeSession(second, {
			id: "b",
			timestamp: "2026-11-22T00:00:00.000Z",
			parent: first,
			handoff: true,
		});
		writeSession(third, {
			id: "c",
			timestamp: "2026-11-23T00:00:00.000Z",
			parent: second,
			handoff: true,
		});
		for (const file of [first, second, third]) {
			writeCosts(file, [turn("a", 0.001, 0, 100)]);
		}
		const report = buildEconomicsReport({
			sessionFile: third,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		assert.equal(report.boundaries.length, 2);
		const text = renderEconomics(report);
		assert.ok(text.startsWith("HANDOFF ECONOMICS · 2 границы"));
		const lines = text.split("\n");
		assert.equal(lines.filter((line) => line.startsWith("FROM")).length, 1);
		assert.equal(
			lines.filter((line) => line.startsWith("граница:")).length,
			2,
		);
		assert.ok(text.includes("aaaa0001"));
		assert.ok(text.includes("bbbb0002"));
		assert.ok(text.includes("cccc0003"));
		// Каждая граница — свой блок: между ними пустая строка.
		assert.ok(
			lines.filter((line) => line === "").length >= 2,
		);
	});

	it("renders the no-boundary and no-compaction states honestly", () => {
		const dir = tempDir();
		const session = join(dir, "solo.jsonl");
		writeSession(session, { id: "solo", timestamp: "2026-11-23T00:00:00.000Z" });
		const report = buildEconomicsReport({
			sessionFile: session,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: MISSING_CLI },
		});
		const text = renderEconomics(report);
		assert.ok(text.includes("границ нет"));
		assert.ok(text.includes("Компакции: нет записей."));
		assert.ok(text.includes("omp-cache-monitor не найден"));
	});
});

describe("handoff economics: chain summary", () => {
	it("aggregates sessions, money and the hit trend across the chain", () => {
		const { parent, child } = chainFixture();
		const report = buildEconomicsReport({
			sessionFile: child,
			turns: 2,
			summary: true,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		assert.deepEqual(report.summary, {
			sessions: 2,
			handoffs: 1,
			boundaries: 1,
			turns: 9,
			// 0.001+0.002+0.003+0.004+0.005 + 0.05+0.04+0.002+0.002
			spendUsd: 0.109,
			medianTurnUsd: 0.003,
			avgBoundaryUsd: 0.05,
			hitTrend: {
				beforePercent: 100,
				afterPercent: 0,
				deltaPp: -100,
				direction: "down",
			},
		});
		assert.equal(report.chain[0].session, parent);
	});

	it("keeps the report unchanged without the flag", () => {
		const { child } = chainFixture();
		const report = buildEconomicsReport({
			sessionFile: child,
			turns: 2,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		assert.equal(report.summary, undefined);
		assert.ok(!("summary" in JSON.parse(JSON.stringify(report))));
	});

	it("stays data-gated without prices: nulls, no invented zeros", () => {
		const { child } = chainFixture();
		const report = buildEconomicsReport({
			sessionFile: child,
			summary: true,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: MISSING_CLI },
		});
		assert.deepEqual(report.summary, {
			sessions: 2,
			handoffs: 1,
			boundaries: 0,
			turns: 0,
			spendUsd: null,
			medianTurnUsd: null,
			avgBoundaryUsd: null,
			hitTrend: {
				beforePercent: null,
				afterPercent: null,
				deltaPp: null,
				direction: null,
			},
		});
		assert.ok(
			report.notes.some((note) =>
				note.includes("сводка: измеренных цен ходов нет"),
			),
		);
	});

	it("classifies the trend direction at the flat threshold", () => {
		const chain = [
			{ session: "/a", startedAt: null, handoff: false, parentSession: null },
			{ session: "/b", startedAt: null, handoff: true, parentSession: "/a" },
		];
		const boundary = (beforePercent, afterPercent) => ({
			from: "/a",
			to: "/b",
			at: null,
			before: { turns: 1, costPerTurnUsd: null, hitPercent: beforePercent },
			after: { turns: 1, costPerTurnUsd: null, hitPercent: afterPercent },
			boundary: { firstTurnUsd: null, recoveryTurns: 0 },
			delta: { costPerTurnUsd: null, hitPercent: null },
		});
		const direction = (before, after) =>
			summarizeEconomics(chain, [boundary(before, after)], []).hitTrend;

		assert.equal(direction(50, 70).direction, "up");
		assert.equal(direction(70, 50).direction, "down");
		assert.equal(direction(90, 90.2).direction, "flat");
		assert.equal(direction(90.4, 90).direction, "flat");
		assert.deepEqual(direction(90, 90.2).deltaPp, 0.2);

		const empty = summarizeEconomics(chain.slice(0, 1), [], []);
		assert.equal(empty.boundaries, 0);
		assert.equal(empty.hitTrend.direction, null);
		assert.equal(empty.spendUsd, null);
	});
});

describe("handoff economics: summary output", () => {
	it("renders the aggregate table and keeps the boundary detail", () => {
		const { child } = chainFixture();
		const report = buildEconomicsReport({
			sessionFile: child,
			turns: 2,
			summary: true,
			env: { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() },
		});
		const text = renderEconomics(report);
		assert.ok(text.startsWith("HANDOFF ECONOMICS · 1 граница · окно 2 хода"));
		assert.ok(text.includes("Сводка:"));
		assert.ok(text.includes("SESSIONS"));
		assert.ok(text.includes("BOUNDARIES"));
		assert.ok(text.includes("$0.1090"));
		assert.ok(text.includes("$0.0500 (×16.7)"));
		assert.ok(
			text.includes("hit: 100.0% → 0.0% (-100.0 pp), падение"),
		);
		// Детали границы остаются: сводка добавляется, а не заменяет отчёт.
		assert.ok(text.includes("граница: первый ход $0.0500 · холодных подряд 2"));
	});

	it("passes --summary through the CLI both as JSON and text", () => {
		const { child } = chainFixture();
		const env = { ...process.env, OMP_CACHE_MONITOR_CLI: fakeCli() };
		const json = runCli(
			["economics", "--json", "--summary", "--session", child, "--turns", "2"],
			env,
		);
		assert.equal(json.status, 0, json.stderr);
		const report = JSON.parse(json.stdout);
		assert.equal(report.summary.sessions, 2);
		assert.equal(report.summary.spendUsd, 0.109);
		assert.equal(report.summary.hitTrend.direction, "down");

		const plain = runCli(
			["economics", "--summary", "--session", child, "--turns", "2"],
			env,
		);
		assert.equal(plain.status, 0, plain.stderr);
		assert.ok(plain.stdout.includes("Сводка:"));
		assert.ok(!plain.stdout.includes("schemaVersion"));

		const without = runCli(
			["economics", "--json", "--session", child, "--turns", "2"],
			env,
		);
		assert.equal(without.status, 0, without.stderr);
		assert.equal(JSON.parse(without.stdout).summary, undefined);
	});
});
