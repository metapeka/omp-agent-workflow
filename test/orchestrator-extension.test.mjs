/**
 * Extension-тесты orchestrator.ts: tool, команды, hooks.
 * Fake ExtensionAPI/context, реальный temp git repo, без OMP и модели.
 */
import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { z } from "zod";

import orchestrator from "../orchestrator.ts";
import { readPlan } from "../lib/orchestrator/plan.ts";
import {
	STATE_FILE,
	createInitialState,
	readState,
	writeState,
} from "../lib/orchestrator/state.ts";
import { branchExists, runCommand } from "../lib/orchestrator/worktrees.ts";
import {
	buildWrapCards,
	collectWrapFacts,
} from "../lib/orchestrator/wrap.ts";

const ENV_KEYS = ["OMP_WORKFLOW_MODE", "OMP_HANDOFF_AT"];
const NOW = new Date("2026-11-22T12:00:00.000Z");

// Тесты не зависят от живого Orca: terminal list → пустой, cleanup → fallback.
process.env.ORCA_CLI_COMMAND = "false";

const BASE_PLAN = {
	version: 1,
	goal: "orchestrator extension tests",
	worktreeRoot: "/tmp/omp-orchestrator-worktrees",
	verify: ["node -e \"process.exit(0)\""],
};

const T1 = { id: "T1", title: "first", acceptance: ["first works"] };
const T2 = {
	id: "T2",
	title: "second",
	deps: ["T1"],
	acceptance: ["second works"],
};

function planText(plan, tasks) {
	return [
		"# AUTOPLAN",
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

function costLine(total) {
	return `${JSON.stringify({
		type: "message",
		message: { role: "assistant", usage: { cost: { total } } },
	})}\n`;
}

let tempDirs = [];
function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "omp-orch-ext-"));
	tempDirs.push(dir);
	return dir;
}

async function mustRun(command, args) {
	const result = await runCommand(command, args, { timeoutMs: 120_000 });
	assert.equal(
		result.code,
		0,
		`${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
	);
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
	await mustRun("git", ["-C", repo, "commit", "-m", "change"]);
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
		...(options.plan ?? {}),
	};
	writeFileSync(
		join(control, "AUTOPLAN.md"),
		planText(plan, options.tasks ?? [T1]),
	);
	return {
		base,
		control,
		sessionFile,
		ctx: {
			dir: control,
			sessionFile,
			mode: options.mode ?? "yoda-supervised",
			now: NOW,
			handoffAt: 55,
		},
	};
}

function install(env = { OMP_WORKFLOW_MODE: "yoda-supervised" }) {
	for (const key of ENV_KEYS) delete process.env[key];
	for (const [key, value] of Object.entries(env)) process.env[key] = value;
	const handlers = new Map();
	const tools = new Map();
	const commands = new Map();
	const sent = [];
	const pi = {
		zod: z,
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
		registerTool(definition) {
			tools.set(definition.name, definition);
		},
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		async sendUserMessage(text) {
			sent.push(text);
		},
	};
	orchestrator(pi);
	return { handlers, tools, commands, sent };
}

function view(s, options = {}) {
	const notes = [];
	const ctx = {
		mode: "tui",
		cwd: s.control,
		agent: { kind: options.kind ?? "main" },
		ui: {
			notify(text) {
				notes.push(text);
			},
		},
		sessionManager: {
			getSessionFile() {
				return s.sessionFile;
			},
			getHeader() {
				return null;
			},
		},
		getContextUsage() {
			return {
				tokens: 20_000,
				contextWindow: 100_000,
				percent: options.percent ?? 20,
			};
		},
		isIdle() {
			return true;
		},
		hasPendingMessages() {
			return false;
		},
	};
	return { ctx, notes };
}

async function fire(handlers, name, event, ctx) {
	let result;
	for (const handler of handlers.get(name) ?? []) {
		const value = await handler(event, ctx);
		if (value !== undefined) result = value;
	}
	return result;
}

async function callTool(tools, params, ctx) {
	const definition = tools.get("orchestrator");
	assert.ok(definition, "orchestrator tool is registered");
	return definition.execute("call", params, undefined, undefined, ctx);
}

beforeEach(() => {
	tempDirs = [];
	for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
	for (const key of ENV_KEYS) delete process.env[key];
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("orchestrator extension", () => {
	it("starts the first task from /orchestrate and sends the prompt", async () => {
		const s = await scenario();
		const { commands, sent } = install();
		const v = view(s);

		await commands.get("orchestrate").handler("", v.ctx);

		assert.equal(sent.length, 1);
		assert.match(sent[0], /T1/);
		assert.match(sent[0], /Worktree:/);
		const state = readState(join(s.control, STATE_FILE));
		assert.equal(state.current.id, "T1");
		assert.equal(state.current.status, "running");
	});

	it("nudges the next task once after finish", async () => {
		const s = await scenario({ tasks: [T1, T2] });
		const { tools, handlers, sent } = install();
		const v = view(s);

		const started = await callTool(tools, { action: "start", task: "T1" }, v.ctx);
		assert.equal(started.details.kind, "started");
		await commitFile(started.details.worktree, "work.txt", "done\n");
		const verified = await callTool(tools, { action: "verify", task: "T1" }, v.ctx);
		assert.equal(verified.details.ok, true);

		const finished = await callTool(
			tools,
			{ action: "finish", task: "T1", commit: verified.details.commit, review: "ok" },
			v.ctx,
		);
		assert.equal(finished.details.kind, "merged");
		assert.equal(finished.details.decision.kind, "continue");
		assert.equal(finished.details.nextTask.id, "T2");
		assert.equal(finished.details.started, undefined);
		assert.equal(sent.length, 0);

		await fire(handlers, "agent_end", { willContinue: false }, v.ctx);
		assert.equal(sent.length, 1);
		assert.match(sent[0], /T2/);
		assert.match(sent[0], /action=start/);

		const nextStarted = await callTool(tools, { action: "start", task: "T2" }, v.ctx);
		assert.equal(nextStarted.details.kind, "started");
		await fire(handlers, "agent_end", { willContinue: false }, v.ctx);
		assert.equal(sent.length, 1);
	});

	it("does not auto-start the next task in manual mode", async () => {
		const s = await scenario({ tasks: [T1, T2], mode: "manual" });
		const { tools, handlers, sent } = install({ OMP_WORKFLOW_MODE: "manual" });
		const v = view(s);

		const started = await callTool(tools, { action: "start", task: "T1" }, v.ctx);
		await commitFile(started.details.worktree, "work.txt", "done\n");
		const verified = await callTool(tools, { action: "verify", task: "T1" }, v.ctx);
		const finished = await callTool(
			tools,
			{ action: "finish", task: "T1", commit: verified.details.commit, review: "ok" },
			v.ctx,
		);
		assert.equal(finished.details.kind, "merged");
		assert.equal(finished.details.decision.kind, "continue");
		assert.equal(finished.details.started, undefined);
		assert.equal(sent.length, 0);
		await fire(handlers, "agent_end", { willContinue: false }, v.ctx);
		assert.equal(sent.length, 0);
	});

	it("blocks subagent spawn after stop and refuses /orchestrate", async () => {
		const s = await scenario();
		const { tools, handlers, commands, sent } = install();
		const v = view(s);

		await callTool(tools, { action: "start", task: "T1" }, v.ctx);
		await callTool(tools, { action: "stop", reason: "human" }, v.ctx);
		const blocked = await fire(
			handlers,
			"before_subagent_spawn",
			{ agent: "task", invocationKind: "task", patterns: [] },
			v.ctx,
		);
		assert.equal(blocked.block, true);
		assert.match(blocked.reason, /human/);

		await commands.get("orchestrate").handler("", v.ctx);
		assert.equal(sent.length, 0);
		assert.ok(v.notes.some((note) => /остановлен/.test(note)));
	});

	it("hands off at the task boundary without starting the next task", async () => {
		const s = await scenario({
			tasks: [T1, T2],
			plan: { budgets: { maxTasksPerSession: 1 } },
		});
		const { tools, handlers, sent } = install();
		const v = view(s);

		const started = await callTool(tools, { action: "start", task: "T1" }, v.ctx);
		await commitFile(started.details.worktree, "work.txt", "done\n");
		const verified = await callTool(tools, { action: "verify", task: "T1" }, v.ctx);
		const finished = await callTool(
			tools,
			{ action: "finish", task: "T1", commit: verified.details.commit, review: "ok" },
			v.ctx,
		);
		assert.equal(finished.details.decision.kind, "handoff");
		assert.equal(finished.details.started, undefined);
		await fire(handlers, "agent_end", { willContinue: false }, v.ctx);
		assert.equal(sent.length, 1);
		assert.match(sent[0], /HANDOFF/);
		assert.match(sent[0], /\.omp-handoff-request\.json/);
		assert.match(sent[0], /task-boundary/);
		const state = readState(join(s.control, STATE_FILE));
		assert.equal(state.current, null);
		assert.equal(state.run.active, true);
	});

	it("skips the handoff nudge when the agent already wrote the marker", async () => {
		const s = await scenario({
			tasks: [T1, T2],
			plan: { budgets: { maxTasksPerSession: 1 } },
		});
		const { tools, handlers, sent } = install();
		const v = view(s);

		const started = await callTool(tools, { action: "start", task: "T1" }, v.ctx);
		await commitFile(started.details.worktree, "work.txt", "done\n");
		const verified = await callTool(tools, { action: "verify", task: "T1" }, v.ctx);
		const finished = await callTool(
			tools,
			{ action: "finish", task: "T1", commit: verified.details.commit, review: "ok" },
			v.ctx,
		);
		assert.equal(finished.details.decision.kind, "handoff");
		writeFileSync(
			join(s.control, ".omp-handoff-request.json"),
			JSON.stringify({ reason: "task-boundary", sessionFile: s.sessionFile }),
		);
		await fire(handlers, "agent_end", { willContinue: false }, v.ctx);
		assert.equal(sent.length, 0);
	});

	it("requires review and reports errors without throwing", async () => {
		const s = await scenario();
		const { tools } = install();
		const v = view(s);

		const started = await callTool(tools, { action: "start", task: "T1" }, v.ctx);
		await commitFile(started.details.worktree, "work.txt", "done\n");
		const verified = await callTool(tools, { action: "verify", task: "T1" }, v.ctx);
		const result = await callTool(
			tools,
			{ action: "finish", task: "T1", commit: verified.details.commit, review: "changes" },
			v.ctx,
		);
		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /reviewer/);
	});

	it("refuses the tool in a subagent session", async () => {
		const s = await scenario();
		const { tools } = install();
		const v = view(s, { kind: "sub" });

		const result = await callTool(tools, { action: "status" }, v.ctx);
		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /main TUI/);
	});

	it("notifies about an unfinished task on session start", async () => {
		const s = await scenario();
		const { tools, handlers } = install();
		const v = view(s);
		await callTool(tools, { action: "start", task: "T1" }, v.ctx);
		await fire(handlers, "session_start", {}, v.ctx);
		assert.ok(v.notes.some((note) => /Незавершённая задача T1/.test(note)));
	});

	it("nudges an active run with no current task", async () => {
		const s = await scenario();
		const plan = readPlan(join(s.control, "AUTOPLAN.md"));
		writeState(
			join(s.control, STATE_FILE),
			createInitialState({
				planPath: "AUTOPLAN.md",
				planHash: plan.hash,
				mode: "yoda-supervised",
				sessionFile: s.sessionFile,
				now: NOW,
			}),
		);
		const { handlers, sent } = install();
		const v = view(s);

		await fire(handlers, "session_start", {}, v.ctx);
		assert.equal(sent.length, 0);
		await fire(handlers, "agent_end", { willContinue: false }, v.ctx);
		assert.equal(sent.length, 1);
		assert.match(sent[0], /action=next/);
	});
});

async function addWrapWorktree(base, root, branch, commit = false) {
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
	if (commit) await commitFile(path, "work.txt", "work\n");
	return path;
}

async function wrapScenario(options = {}) {
	const base = await gitRepo();
	const root = tempDir();
	const plan = {
		...BASE_PLAN,
		backend: "git",
		baseRepo: base,
		worktreeRoot: root,
		...(options.plan ?? {}),
	};
	writeFileSync(join(base, "AUTOPLAN.md"), planText(plan, []));
	await mustRun("git", ["-C", base, "add", "AUTOPLAN.md"]);
	await mustRun("git", ["-C", base, "commit", "-m", "plan"]);
	const worktree = await addWrapWorktree(
		base,
		root,
		"feat/current",
		options.commit ?? false,
	);
	if (options.handoff !== false) {
		writeFileSync(join(worktree, "HANDOFF.md"), "handoff\n");
	}
	return {
		base,
		root,
		worktree,
		plan,
		sessionFile: join(tempDir(), "session.jsonl"),
	};
}

function wrapView(s, options = {}) {
	const notes = [];
	const selects = [];
	const confirms = [];
	const inputs = [];
	const ctx = {
		mode: "tui",
		cwd: s.worktree,
		agent: { kind: options.kind ?? "main" },
		ui: {
			notify(text, level) {
				notes.push({ text, level });
			},
			async select(title, items) {
				selects.push({ title, items });
				return options.select?.shift();
			},
			async confirm(title, message) {
				confirms.push({ title, message });
				return options.confirm?.shift() ?? false;
			},
			async input(title, placeholder) {
				inputs.push({ title, placeholder });
				return options.input?.shift();
			},
		},
		sessionManager: {
			getSessionFile() {
				return s.sessionFile;
			},
			getHeader() {
				return null;
			},
		},
		getContextUsage() {
			return { tokens: 1_000, contextWindow: 100_000, percent: 1 };
		},
		isIdle() {
			return true;
		},
		hasPendingMessages() {
			return false;
		},
		async waitForIdle() {},
	};
	return { ctx, notes, selects, confirms, inputs };
}

async function wrapLabel(cwd, id) {
	const facts = await collectWrapFacts(cwd);
	const card = buildWrapCards(facts).find((item) => item.id === id);
	assert.ok(card, `wrap card ${id} is registered`);
	return card.label;
}

describe("wrap command", () => {
	it("opens the card menu and cancels without mutations", async () => {
		const s = await wrapScenario();
		const { commands } = install();
		const v = wrapView(s, { select: [undefined] });

		await commands.get("wrap").handler("", v.ctx);

		assert.equal(v.selects.length, 1);
		assert.match(v.selects[0].title, /Wrap: feat\/current/);
		assert.ok(
			v.selects[0].items.some((item) =>
				/Завершить сессию/.test(item.label),
			),
		);
		assert.equal(v.confirms.length, 0);
		assert.equal(existsSync(s.worktree), true);
	});

	it("reports handoff readiness without switching the session", async () => {
		const s = await wrapScenario();
		const label = await wrapLabel(s.worktree, "handoff");
		const { commands } = install();
		const v = wrapView(s, { select: [label] });

		await commands.get("wrap").handler("", v.ctx);

		assert.ok(v.notes.some((note) => /handoff-new/.test(note.text)));
		assert.equal(v.confirms.length, 0);
	});

	it("does not claim handoff readiness when HANDOFF.md is missing", async () => {
		const s = await wrapScenario({ handoff: false });
		const handoff = await wrapLabel(s.worktree, "handoff");
		const exit = await wrapLabel(s.worktree, "exit");
		const { commands } = install();
		const v = wrapView(s, { select: [handoff, exit] });

		await commands.get("wrap").handler("", v.ctx);

		assert.ok(
			v.notes.some((note) => /HANDOFF\.md не найден/.test(note.text)),
		);
		assert.equal(v.confirms.length, 0);
	});

	it("sends the HANDOFF update prompt only after confirmation", async () => {
		const s = await wrapScenario();
		const label = await wrapLabel(s.worktree, "update-handoff");
		const { commands, sent } = install();

		let v = wrapView(s, { select: [label], confirm: [false] });
		await commands.get("wrap").handler("", v.ctx);
		assert.equal(sent.length, 0);

		v = wrapView(s, { select: [label], confirm: [true] });
		await commands.get("wrap").handler("", v.ctx);
		assert.equal(sent.length, 1);
		assert.match(sent[0], /HANDOFF\.md/);
	});

	it("sends the review prompt with the base...branch range", async () => {
		const s = await wrapScenario({ commit: true });
		const label = await wrapLabel(s.worktree, "review");
		const { commands, sent } = install();
		const v = wrapView(s, { select: [label], confirm: [true] });

		await commands.get("wrap").handler("", v.ctx);

		assert.equal(sent.length, 1);
		assert.match(sent[0], /main\.\.\.feat\/current/);
		assert.match(sent[0], /reviewer/);
	});

	it("removes a merged clean worktree only after confirmation", async () => {
		const s = await wrapScenario();
		const merged = await addWrapWorktree(s.base, s.root, "feat/merged");
		const cleanup = await wrapLabel(s.worktree, "cleanup");
		const exit = await wrapLabel(s.worktree, "exit");
		const { commands } = install();
		const v = wrapView(s, {
			select: [cleanup, merged, exit],
			confirm: [true],
		});

		await commands.get("wrap").handler("", v.ctx);

		assert.equal(v.confirms.length, 1);
		assert.match(v.confirms[0].message, new RegExp(merged.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.equal(existsSync(merged), false);
		assert.equal(await branchExists(s.base, "feat/merged"), false);
	});

	it("keeps the worktree when cleanup confirmation is denied", async () => {
		const s = await wrapScenario();
		const merged = await addWrapWorktree(s.base, s.root, "feat/merged");
		const cleanup = await wrapLabel(s.worktree, "cleanup");
		const exit = await wrapLabel(s.worktree, "exit");
		const { commands } = install();
		const v = wrapView(s, {
			select: [cleanup, merged, exit],
			confirm: [false],
		});

		await commands.get("wrap").handler("", v.ctx);

		assert.equal(existsSync(merged), true);
		assert.equal(await branchExists(s.base, "feat/merged"), true);
	});

	it("creates the next task worktree after input and confirmation", async () => {
		const s = await wrapScenario();
		const next = await wrapLabel(s.worktree, "next-task");
		const exit = await wrapLabel(s.worktree, "exit");
		const { commands } = install();
		const v = wrapView(s, {
			select: [next, exit],
			input: ["next-task"],
			confirm: [true],
		});

		await commands.get("wrap").handler("", v.ctx);

		assert.equal(v.inputs.length, 1);
		assert.equal(v.confirms.length, 1);
		assert.equal(existsSync(join(s.root, "feat-next-task")), true);
		assert.equal(await branchExists(s.base, "feat/next-task"), true);
	});

	it("does not run in a subagent session", async () => {
		const s = await wrapScenario();
		const { commands } = install();
		const v = wrapView(s, { kind: "sub", select: [undefined] });

		await commands.get("wrap").handler("", v.ctx);

		assert.equal(v.selects.length, 0);
		assert.equal(v.notes.length, 0);
	});
});
