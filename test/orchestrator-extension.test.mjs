/**
 * Extension-тесты orchestrator.ts: tool, команды, hooks.
 * Fake ExtensionAPI/context, реальный temp git repo, без OMP и модели.
 */
import assert from "node:assert/strict";
import {
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
import { runCommand } from "../lib/orchestrator/worktrees.ts";

const ENV_KEYS = ["OMP_WORKFLOW_MODE", "OMP_HANDOFF_AT"];
const NOW = new Date("2026-11-22T12:00:00.000Z");

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
		assert.equal(sent.length, 0);
		const state = readState(join(s.control, STATE_FILE));
		assert.equal(state.current, null);
		assert.equal(state.run.active, true);
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
