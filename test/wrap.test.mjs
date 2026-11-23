/**
 * Wrap wizard core: факты, карточки, guards, безопасные операции.
 * Реальный temp git repo; без OMP, Orca и модели.
 */
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { readPlan } from "../lib/orchestrator/plan.ts";
import { acquireLock, createInitialState, writeState } from "../lib/orchestrator/state.ts";
import {
	branchExists,
	countLiveTerminals,
	createWorktree,
	parseOrcaTerminals,
	processesInPath,
	removeWorktree,
	runCommand,
	worktreePath,
} from "../lib/orchestrator/worktrees.ts";
import {
	buildWrapCards,
	cleanupCandidates,
	collectWrapFacts as collectWrapFactsImpl,
	createNextWorktree,
	formatWrapSummary,
	guardCleanup,
	parseWorktreeList,
	removeMergedWorktreeSafe as removeMergedWorktreeSafeImpl,
} from "../lib/orchestrator/wrap.ts";

/** Тесты не зависят от живого Orca: терминалы задаются явно. */
process.env.ORCA_CLI_COMMAND = "orca";

const collectWrapFacts = (cwd, options = {}) =>
	collectWrapFactsImpl(cwd, { orcaTerminals: [], ...options });
const removeMergedWorktreeSafe = (options) =>
	removeMergedWorktreeSafeImpl({ orcaTerminals: [], ...options });

const NOW = new Date("2026-11-22T12:00:00.000Z");

let tempDirs = [];
function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "omp-wrap-"));
	tempDirs.push(dir);
	return dir;
}

async function mustRun(command, args, cwd) {
	const result = await runCommand(command, args, { cwd, timeoutMs: 120_000 });
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

async function commitFile(repo, name, content) {
	writeFileSync(join(repo, name), content);
	await mustRun("git", ["-C", repo, "add", name]);
	await mustRun("git", ["-C", repo, "commit", "-m", `change ${name}`]);
}

async function addWorktree(base, root, branch, options = {}) {
	const path = join(root, branch.replace(/[^A-Za-z0-9._-]+/g, "-"));
	await mustRun("git", [
		"-C",
		base,
		"worktree",
		"add",
		"-b",
		branch,
		path,
		"main",
	]);
	if (options.commit) await commitFile(path, "work.txt", "work\n");
	if (options.dirty) writeFileSync(join(path, "dirty.txt"), "dirty\n");
	return path;
}

function planText(plan) {
	return [
		"# AUTOPLAN",
		"```json plan",
		JSON.stringify(plan, null, 2),
		"```",
	].join("\n");
}

function writePlan(dir, root, overrides = {}) {
	const plan = {
		version: 1,
		goal: "wrap tests",
		worktreeRoot: root,
		backend: "git",
		baseBranch: "main",
		verify: ['node -e "process.exit(0)"'],
		...overrides,
	};
	writeFileSync(join(dir, "AUTOPLAN.md"), planText(plan));
	return plan;
}

function writeStateFile(base, options = {}) {
	const plan = readPlan(join(base, "AUTOPLAN.md"));
	const state = createInitialState({
		planPath: "AUTOPLAN.md",
		planHash: plan.hash,
		mode: "yoda-supervised",
		sessionFile: options.sessionFile ?? null,
		now: NOW,
	});
	if (options.stop) {
		state.stop = {
			reason: options.stop,
			detail: "test stop",
			at: NOW.toISOString(),
		};
	}
	writeState(join(base, "STATE.json"), state);
	return state;
}

beforeEach(() => {
	tempDirs = [];
});

afterEach(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("wrap facts", () => {
	it("reads branch, base and worktrees from the base repo", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		await mustRun("git", ["-C", base, "add", "AUTOPLAN.md"]);
		await mustRun("git", ["-C", base, "commit", "-m", "plan"]);
		const facts = await collectWrapFacts(base);

		assert.equal(facts.gitError, null);
		assert.equal(facts.branch, "main");
		assert.equal(facts.baseBranch, "main");
		assert.equal(facts.baseExists, true);
		assert.equal(facts.merged, true);
		assert.equal(facts.ahead, 0);
		assert.equal(facts.dirty, false);
		assert.equal(facts.plan?.config.backend, "git");
		assert.ok(facts.worktrees.some((item) => item.branch === "main"));
		assert.equal(facts.handoff.exists, false);
	});

	it("finds control state and plan from a task worktree", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		writeStateFile(base, { stop: "plan-done" });
		const worktree = await addWorktree(base, root, "feat/current");

		const facts = await collectWrapFacts(worktree);
		assert.equal(facts.toplevel, worktree);
		assert.equal(facts.branch, "feat/current");
		assert.equal(facts.baseRepo, base);
		assert.equal(facts.stateDir, base);
		assert.equal(facts.state?.stop?.reason, "plan-done");
		assert.equal(facts.plan?.config.backend, "git");
		assert.equal(facts.merged, true);
	});

	it("does not treat a base HANDOFF.md as the current worktree handoff", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const worktree = await addWorktree(base, root, "feat/current");
		writeFileSync(join(base, "HANDOFF.md"), "base\n");
		await mustRun("git", ["-C", base, "add", "HANDOFF.md"]);
		await mustRun("git", ["-C", base, "commit", "-m", "handoff"]);

		const facts = await collectWrapFacts(worktree);
		assert.equal(facts.handoff.exists, false);
		assert.equal(guardCleanup(facts, worktree).ok, false);
	});

	it("reads HANDOFF.md relative to cwd, not the worktree root", async () => {
		const base = await gitRepo();
		writeFileSync(join(base, "HANDOFF.md"), "handoff\n");
		await mustRun("git", ["-C", base, "add", "HANDOFF.md"]);
		await mustRun("git", ["-C", base, "commit", "-m", "handoff"]);
		mkdirSync(join(base, "sub"));

		const facts = await collectWrapFacts(join(base, "sub"));
		assert.equal(facts.handoff.path, join(base, "sub", "HANDOFF.md"));
		assert.equal(facts.handoff.exists, false);
	});

	it("marks handoff dirty and stale", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		writeFileSync(join(base, "HANDOFF.md"), "state\n");
		await mustRun("git", ["-C", base, "add", "HANDOFF.md"]);
		await mustRun("git", ["-C", base, "commit", "-m", "handoff"]);
		await commitFile(base, "after.txt", "after\n");

		let facts = await collectWrapFacts(base);
		assert.equal(facts.handoff.exists, true);
		assert.equal(facts.handoff.dirty, false);
		assert.equal(facts.handoff.stale, true);

		writeFileSync(join(base, "HANDOFF.md"), "changed\n");
		facts = await collectWrapFacts(base);
		assert.equal(facts.handoff.dirty, true);
	});

	it("parses porcelain -z paths with spaces", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const path = join(root, "wt with space");
		await mustRun("git", [
			"-C",
			base,
			"worktree",
			"add",
			"-b",
			"feat/space",
			path,
			"main",
		]);
		const output = await mustRun("git", [
			"-C",
			base,
			"worktree",
			"list",
			"--porcelain",
			"-z",
		]);
		const records = parseWorktreeList(output.stdout);
		assert.ok(records.some((item) => item.path === path));
		assert.ok(records.some((item) => item.branch === "feat/space"));
	});

	it("finds live processes by cwd in a fake proc root", () => {
		const target = tempDir();
		const procRoot = tempDir();
		mkdirSync(join(procRoot, "999999"));
		symlinkSync(target, join(procRoot, "999999", "cwd"));
		mkdirSync(join(target, "sub"));
		mkdirSync(join(procRoot, "999998"));
		symlinkSync(join(target, "sub"), join(procRoot, "999998", "cwd"));
		assert.deepEqual(processesInPath(target, procRoot).sort(), [999998, 999999]);
	});

	it("parses Orca terminals and counts only live ones by worktree", () => {
		const output = JSON.stringify({
			ok: true,
			result: {
				terminals: [
					{ handle: "t1", worktreePath: "/w/a", connected: true, orphaned: false },
					{ handle: "t2", worktreePath: "/w/a", connected: false },
					{ handle: "t3", worktreePath: "/w/a", connected: true, orphaned: true },
					{ handle: "t4", worktreePath: "/w/b", connected: true },
					{ handle: "t5" },
				],
			},
		});
		const terminals = parseOrcaTerminals(output);
		assert.equal(terminals.length, 5);
		assert.equal(countLiveTerminals(terminals, "/w/a"), 1);
		assert.equal(countLiveTerminals(terminals, "/w/b"), 1);
		assert.equal(countLiveTerminals(terminals, "/w/c"), 0);
		assert.deepEqual(parseOrcaTerminals("not json"), []);
		assert.deepEqual(parseOrcaTerminals(JSON.stringify({ result: {} })), []);
	});

	it("parses detached, locked and prunable worktree records", () => {
		const output = [
			"worktree /a",
			"HEAD abc",
			"detached",
			"",
			"worktree /b",
			"HEAD def",
			"branch refs/heads/feat/x",
			"locked reason",
			"",
			"worktree /c",
			"HEAD ghi",
			"branch refs/heads/feat/y",
			"prunable reason",
			"",
		].join("\0");
		const records = parseWorktreeList(output);
		assert.equal(records.length, 3);
		assert.equal(records[0].detached, true);
		assert.equal(records[1].branch, "feat/x");
		assert.equal(records[1].locked, true);
		assert.equal(records[2].prunable, true);
	});
});

describe("wrap cards", () => {
	it("disables plan actions without AUTOPLAN and handoff without HANDOFF.md", async () => {
		const base = await gitRepo();
		const facts = await collectWrapFacts(base);
		const cards = buildWrapCards(facts);
		const byId = new Map(cards.map((card) => [card.id, card]));

		assert.equal(byId.get("handoff").enabled, false);
		assert.equal(byId.get("cleanup").enabled, false);
		assert.equal(byId.get("next-task").enabled, false);
		assert.equal(byId.get("review").enabled, false);
		assert.equal(byId.get("publish").enabled, false);
		assert.equal(byId.get("update-handoff").enabled, true);
		assert.equal(byId.get("exit").enabled, true);
		assert.match(formatWrapSummary(facts), /Wrap: main/);
	});

	it("enables cleanup for a merged clean worktree and plan actions with a plan", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		writeFileSync(join(base, "HANDOFF.md"), "handoff\n");
		await mustRun("git", ["-C", base, "add", "HANDOFF.md"]);
		await mustRun("git", ["-C", base, "commit", "-m", "handoff"]);
		const worktree = await addWorktree(base, root, "feat/merged");

		const facts = await collectWrapFacts(base);
		const cards = buildWrapCards(facts);
		const byId = new Map(cards.map((card) => [card.id, card]));

		assert.equal(byId.get("cleanup").enabled, true);
		assert.equal(byId.get("next-task").enabled, true);
		assert.equal(byId.get("handoff").enabled, true);
		assert.ok(cleanupCandidates(facts).some((item) => item.path === worktree));
	});

	it("disables cleanup and next task when the plan changed since state", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		writeStateFile(base);
		const worktree = await addWorktree(base, root, "feat/merged");
		writePlan(base, root, { goal: "changed plan" });

		const facts = await collectWrapFacts(base);
		const cards = buildWrapCards(facts);
		const byId = new Map(cards.map((card) => [card.id, card]));

		assert.match(facts.planError, /plan изменился/);
		assert.match(guardCleanup(facts, worktree).reason, /план не прочитан/);
		assert.equal(byId.get("cleanup").enabled, false);
		assert.equal(byId.get("next-task").enabled, false);
	});
});

describe("wrap cleanup guards", () => {
	it("allows only merged, clean, non-current worktrees", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const merged = await addWorktree(base, root, "feat/merged");
		const unmerged = await addWorktree(base, root, "feat/unmerged", {
			commit: true,
		});
		const dirty = await addWorktree(base, root, "feat/dirty", { dirty: true });

		const facts = await collectWrapFacts(base);
		assert.equal(guardCleanup(facts, merged).ok, true);
		assert.match(guardCleanup(facts, unmerged).reason, /не merged/);
		assert.match(guardCleanup(facts, dirty).reason, /незакоммиченные/);
		assert.match(guardCleanup(facts, base).reason, /base repo|текущий/);

		const current = await addWorktree(base, root, "feat/current");
		const currentFacts = await collectWrapFacts(current);
		assert.match(
			guardCleanup(currentFacts, current).reason,
			/текущий worktree/,
		);
	});

	it("refuses a worktree outside plan.worktreeRoot", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const otherRoot = tempDir();
		writePlan(base, root);
		const outside = await addWorktree(base, otherRoot, "feat/outside");
		const facts = await collectWrapFacts(base);
		assert.match(guardCleanup(facts, outside).reason, /вне worktreeRoot/);
	});

	it("resolves relative plan.worktreeRoot from the plan directory", async () => {
		const base = await gitRepo();
		const otherRoot = tempDir();
		mkdirSync(join(base, "wts"));
		writeFileSync(
			join(base, "AUTOPLAN.md"),
			planText({
				version: 1,
				goal: "relative root",
				worktreeRoot: "wts",
				backend: "git",
				baseBranch: "main",
				verify: ['node -e "process.exit(0)"'],
			}),
		);
		const target = await addWorktree(base, join(base, "wts"), "feat/merged");
		const control = await addWorktree(base, otherRoot, "feat/control");

		const facts = await collectWrapFacts(control);
		assert.equal(facts.planDir, base);
		assert.equal(guardCleanup(facts, target).ok, true);
	});

	it("refuses a worktree with a live Orca terminal", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const merged = await addWorktree(base, root, "feat/merged");
		const facts = await collectWrapFacts(base, {
			orcaTerminals: [
				{
					handle: "term_live",
					worktreePath: merged,
					connected: true,
					orphaned: false,
				},
			],
		});

		assert.match(guardCleanup(facts, merged).reason, /терминал Orca/);
		assert.equal(cleanupCandidates(facts).length, 0);
	});
});

describe("wrap cleanup execution", () => {
	it("removes a merged clean worktree and keeps its branch", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const merged = await addWorktree(base, root, "feat/merged");
		const facts = await collectWrapFacts(base);

		const result = await removeMergedWorktreeSafe({
			facts,
			path: merged,
			backend: "git",
		});
		assert.equal(result.ok, true, result.message);
		assert.equal(result.branchDeleted, false);
		assert.equal(result.branchRetained, true);
		assert.equal(existsSync(merged), false);
		assert.equal(await branchExists(base, "feat/merged"), true);
	});

	it("deletes the branch only on explicit request with git branch -d", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const merged = await addWorktree(base, root, "feat/merged");
		const facts = await collectWrapFacts(base);

		const result = await removeMergedWorktreeSafe({
			facts,
			path: merged,
			backend: "git",
			deleteBranch: true,
		});
		assert.equal(result.ok, true, result.message);
		assert.equal(result.branchDeleted, true);
		assert.equal(existsSync(merged), false);
		assert.equal(await branchExists(base, "feat/merged"), false);
	});

	it("leaves an unmerged worktree and branch intact", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const unmerged = await addWorktree(base, root, "feat/unmerged", {
			commit: true,
		});
		const facts = await collectWrapFacts(base);

		const result = await removeMergedWorktreeSafe({
			facts,
			path: unmerged,
			backend: "git",
		});
		assert.equal(result.ok, false);
		assert.equal(existsSync(unmerged), true);
		assert.equal(await branchExists(base, "feat/unmerged"), true);
	});

	it("rechecks dirtiness after facts collection", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const merged = await addWorktree(base, root, "feat/merged");
		const facts = await collectWrapFacts(base);
		writeFileSync(join(merged, "late.txt"), "late\n");

		const result = await removeMergedWorktreeSafe({
			facts,
			path: merged,
			backend: "git",
		});
		assert.equal(result.ok, false);
		assert.match(result.message, /незакоммиченные/);
		assert.equal(existsSync(merged), true);
	});

	it("rechecks the worktree HEAD after facts collection", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const merged = await addWorktree(base, root, "feat/merged");
		const facts = await collectWrapFacts(base);
		await commitFile(merged, "late.txt", "late\n");

		const result = await removeMergedWorktreeSafe({
			facts,
			path: merged,
			backend: "git",
		});
		assert.equal(result.ok, false);
		assert.match(result.message, /HEAD изменился/);
		assert.equal(existsSync(merged), true);
	});

	it("removes through Orca without --delete-branch or --force", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const merged = await addWorktree(base, root, "feat/merged");
		const facts = await collectWrapFacts(base);
		const orcaCalls = [];
		const fakeRun = async (command, args, options) => {
			if (command === "orca") {
				orcaCalls.push(args);
				if (args[0] === "terminal") {
					return {
						code: 0,
						stdout: JSON.stringify({ result: { terminals: [] } }),
						stderr: "",
					};
				}
				const result = await runCommand(
					"git",
					["-C", base, "worktree", "remove", merged],
					options,
				);
				return { ...result, code: 0 };
			}
			return runCommand(command, args, options);
		};

		const result = await removeMergedWorktreeSafe({
			facts,
			path: merged,
			backend: "orca",
			run: fakeRun,
		});
		assert.equal(result.ok, true, result.message);
		assert.equal(result.branchRetained, true);
		assert.equal(existsSync(merged), false);
		assert.equal(await branchExists(base, "feat/merged"), true);
		const removalCall = orcaCalls.find(
			(args) => args[0] === "worktree" && args[1] === "rm",
		);
		assert.ok(removalCall);
		assert.equal(removalCall.includes("--delete-branch"), false);
		assert.equal(removalCall.includes("--force"), false);
	});

	it("falls back to git when orca is unavailable and keeps the branch", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const merged = await addWorktree(base, root, "feat/merged");
		const facts = await collectWrapFacts(base);
		const fakeRun = async (command, args, options) => {
			if (command === "orca") throw new Error("spawn orca ENOENT");
			return runCommand(command, args, options);
		};

		const result = await removeMergedWorktreeSafe({
			facts,
			path: merged,
			backend: "orca",
			run: fakeRun,
		});
		assert.equal(result.ok, true, result.message);
		assert.equal(existsSync(merged), false);
		assert.equal(await branchExists(base, "feat/merged"), true);
		assert.equal(result.branchRetained, true);
	});

	it("refuses when a live process has cwd in the worktree", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const merged = await addWorktree(base, root, "feat/merged");
		const facts = await collectWrapFacts(base);
		const procRoot = tempDir();
		mkdirSync(join(merged, "sub"));
		mkdirSync(join(procRoot, "999999"));
		symlinkSync(join(merged, "sub"), join(procRoot, "999999", "cwd"));

		const result = await removeMergedWorktreeSafe({
			facts,
			path: merged,
			backend: "git",
			procRoot,
		});
		assert.equal(result.ok, false);
		assert.match(result.message, /работает процесс/);
		assert.equal(existsSync(merged), true);
	});

	it("refuses when an Orca terminal is still attached", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const merged = await addWorktree(base, root, "feat/merged");
		const facts = await collectWrapFacts(base);

		const result = await removeMergedWorktreeSafe({
			facts,
			path: merged,
			backend: "git",
			orcaTerminals: [
				{
					handle: "term_live",
					worktreePath: merged,
					connected: true,
					orphaned: false,
				},
			],
		});
		assert.equal(result.ok, false);
		assert.match(result.message, /терминал Orca/);
		assert.equal(existsSync(merged), true);
	});

	it("refuses while the orchestrator lock is held", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const merged = await addWorktree(base, root, "feat/merged");
		const facts = await collectWrapFacts(base);
		const release = acquireLock(base);
		try {
			await assert.rejects(
				removeMergedWorktreeSafe({ facts, path: merged, backend: "git" }),
				/held by pid|lock/,
			);
		} finally {
			release();
		}
		assert.equal(existsSync(merged), true);
	});
});

describe("wrap next worktree", () => {
	it("creates a git worktree and refuses duplicates", async () => {
		const base = await gitRepo();
		const root = tempDir();
		writePlan(base, root);
		const facts = await collectWrapFacts(base);

		const created = await createNextWorktree({ facts, slug: "next-task" });
		assert.equal(created.ok, true, created.message);
		assert.equal(existsSync(created.path), true);
		assert.equal(await branchExists(base, "feat/next-task"), true);
		assert.equal(
			created.path,
			worktreePath(root, "feat/next-task"),
		);

		const again = await createNextWorktree({ facts, slug: "next-task" });
		assert.equal(again.ok, false);
		assert.match(again.message, /уже существует/);
	});

	it("rejects invalid slugs and a missing plan", async () => {
		const base = await gitRepo();
		const facts = await collectWrapFacts(base);
		const noPlan = await createNextWorktree({ facts, slug: "next" });
		assert.equal(noPlan.ok, false);
		assert.match(noPlan.message, /AUTOPLAN/);

		const root = tempDir();
		writePlan(base, root);
		const withPlan = await collectWrapFacts(base);
		const bad = await createNextWorktree({ facts: withPlan, slug: "Bad Slug" });
		assert.equal(bad.ok, false);
		assert.match(bad.message, /slug/);
	});
});

describe("orca cli override", () => {
	it("uses ORCA_CLI_COMMAND for worktree create", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const target = join(root, "wt");
		const log = join(tempDir(), "orca-calls.log");
		const fake = join(tempDir(), "orca-custom");
		const payload = JSON.stringify({
			result: { worktree: { path: target, branch: "feat/cli" } },
		});
		writeFileSync(
			fake,
			`#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nprintf '%s\\n' '${payload}'\n`,
			{ mode: 0o755 },
		);
		const previous = process.env.ORCA_CLI_COMMAND;
		process.env.ORCA_CLI_COMMAND = fake;
		try {
			const info = await createWorktree({
				backend: "orca",
				baseRepo: base,
				baseBranch: "main",
				branch: "feat/cli",
				path: target,
			});
			assert.equal(info.path, target);
			assert.match(readFileSync(log, "utf8"), /worktree create/);
		} finally {
			if (previous === undefined) delete process.env.ORCA_CLI_COMMAND;
			else process.env.ORCA_CLI_COMMAND = previous;
		}
	});

	it("falls back to git when the Orca CLI cannot spawn", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const merged = await addWorktree(base, root, "feat/merged");
		const previous = process.env.ORCA_CLI_COMMAND;
		process.env.ORCA_CLI_COMMAND = join(tempDir(), "missing-orca");
		try {
			await removeWorktree({
				backend: "orca",
				baseRepo: base,
				path: merged,
				branch: "feat/merged",
			});
		} finally {
			if (previous === undefined) delete process.env.ORCA_CLI_COMMAND;
			else process.env.ORCA_CLI_COMMAND = previous;
		}
		assert.equal(existsSync(merged), false);
		assert.equal(await branchExists(base, "feat/merged"), true);
	});
});
