/**
 * Deterministic tests for index.ts: no OMP runtime, no model, no network.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import contextGuard from "../index.ts";

const SUPERVISOR = fileURLToPath(
	new URL("../bin/omp-handoff-supervisor.mjs", import.meta.url),
);

const ENV_KEYS = [
	"OMP_CONTEXT_WARN",
	"OMP_CONTEXT_SUGGEST",
	"OMP_CONTEXT_AUTO",
	"OMP_HANDOFF_AT",
	"OMP_HANDOFF_COOLDOWN_SECONDS",
	"OMP_WORKFLOW_MODE",
];

function install(env = {}) {
	for (const key of ENV_KEYS) delete process.env[key];
	for (const [key, value] of Object.entries(env)) process.env[key] = String(value);

	const handlers = new Map();
	const commands = new Map();
	const sent = [];
	const pi = {
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		async sendUserMessage(content) {
			sent.push(content);
		},
	};
	contextGuard(pi);
	return { handlers, commands, sent };
}

function view(percent, options = {}) {
	const {
		mode = "tui",
		kind = "main",
		idle = true,
		pending = false,
		complete = true,
		cwd = join(tmpdir(), "omp-agent-workflow-no-write"),
		sessionFile = "/tmp/session.jsonl",
		parentSession = null,
		newSessionResult = { cancelled: false },
	} = options;
	const notes = [];
	const compactions = [];
	const newSessions = [];
	const customMessages = [];
	let waits = 0;
	let finish = () => {};
	const ctx = {
		mode,
		cwd,
		agent: { kind },
		sessionManager: {
			getSessionFile() {
				return sessionFile;
			},
			getHeader() {
				return parentSession ? { parentSession } : null;
			},
		},
		ui: {
			notify(text, level) {
				notes.push({ text, level });
			},
		},
		getContextUsage() {
			return {
				tokens: Math.round(percent * 1000),
				contextWindow: 100_000,
				percent,
			};
		},
		isIdle() {
			return idle;
		},
		hasPendingMessages() {
			return pending;
		},
		async waitForIdle() {
			waits += 1;
		},
		async newSession(options) {
			newSessions.push(options);
			await options.setup?.({
				appendCustomMessageEntry(...args) {
					customMessages.push(args);
				},
			});
			return newSessionResult;
		},
		compact(instructions) {
			compactions.push(instructions);
			if (complete) return Promise.resolve();
			return new Promise((resolve) => {
				finish = () => resolve();
			});
		},
	};
	return {
		ctx,
		notes,
		compactions,
		newSessions,
		customMessages,
		waits: () => waits,
		finish: () => finish(),
	};
}

async function fire(handlers, name, event, ctx) {
	const list = handlers.get(name) ?? [];
	for (const handler of list) await handler(event, ctx);
}

async function command(commands, name, ctx, args = "") {
	const definition = commands.get(name);
	assert.ok(definition, `expected /${name}`);
	await definition.handler(args, ctx);
}

beforeEach(() => {
	for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
	for (const key of ENV_KEYS) delete process.env[key];
});

describe("context warnings", () => {
	it("warns once at the default warning threshold", async () => {
		const { handlers } = install();
		const v = view(36);

		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(v.notes.length, 1);
		assert.equal(v.notes[0].level, "warning");
		assert.match(v.notes[0].text, /Контекст 36%/);
		assert.match(v.notes[0].text, /планируй HANDOFF/);

		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(v.notes.length, 1);
	});

	it("suggests HANDOFF once at the default suggestion threshold", async () => {
		const { handlers } = install();
		const v = view(51);

		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(v.notes.length, 1);
		assert.equal(v.notes[0].level, "warning");
		assert.match(v.notes[0].text, /пора HANDOFF/);

		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(v.notes.length, 1);
	});

	it("stays silent for sub-agents and non-TUI modes", async () => {
		const { handlers } = install();
		for (const options of [{ kind: "sub" }, { mode: "print" }, { mode: "json" }]) {
			const v = view(90, options);
			await fire(handlers, "turn_end", {}, v.ctx);
			await fire(handlers, "agent_end", {}, v.ctx);
			assert.equal(v.notes.length, 0);
			assert.equal(v.compactions.length, 0);
		}
	});

	it("writes session info only for the main session", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-session-info-"));
		try {
			const { handlers } = install();
			const sub = view(40, { kind: "sub", cwd: dir });
			await fire(handlers, "session_start", {}, sub.ctx);
			assert.equal(existsSync(join(dir, ".omp-handoff-session.json")), false);

			const main = view(40, { cwd: dir });
			await fire(handlers, "session_start", {}, main.ctx);
			const info = JSON.parse(
				readFileSync(join(dir, ".omp-handoff-session.json"), "utf8"),
			);
			assert.equal(info.cwd, dir);
			assert.equal(info.sessionFile, "/tmp/session.jsonl");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("workflow modes", () => {
	it("yoda enables handoff at 55 without auto-compaction", async () => {
		const { handlers, sent } = install({ OMP_WORKFLOW_MODE: "yoda" });
		const v = view(56);
		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(sent.length, 1);
		assert.equal(v.compactions.length, 0);
	});

	it("manual disables auto-compaction and handoff", async () => {
		const { handlers, sent } = install({ OMP_WORKFLOW_MODE: "manual" });
		const v = view(61);
		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(sent.length, 0);
		assert.equal(v.compactions.length, 0);
	});

	it("assisted keeps auto-compaction and no handoff", async () => {
		const { handlers, sent } = install({ OMP_WORKFLOW_MODE: "assisted" });
		const v = view(61);
		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(sent.length, 0);
		assert.equal(v.compactions.length, 1);
	});
});

describe("automatic handoff request", () => {
	it("asks once at the threshold and resets after compaction", async () => {
		const { handlers, sent } = install({ OMP_HANDOFF_AT: "55" });
		const v = view(56);

		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(sent.length, 1);
		assert.match(sent[0], /HANDOFF/);
		assert.match(sent[0], /\.omp-handoff-request\.json/);

		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(sent.length, 1);

		await fire(handlers, "session_compact", {}, v.ctx);
		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(sent.length, 2);
	});

	it("does not ask below the threshold", async () => {
		const { handlers, sent } = install({ OMP_HANDOFF_AT: "55" });
		const v = view(54);
		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(sent.length, 0);
	});

	it("cools down in a child session after handoff", async () => {
		const { handlers, sent } = install({ OMP_HANDOFF_AT: "55" });
		const v = view(56, { parentSession: "/tmp/parent.jsonl" });
		await fire(handlers, "session_start", {}, v.ctx);
		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(sent.length, 0);
	});
});

describe("auto compaction", () => {
	it("compacts once at the default auto threshold and resets after compaction", async () => {
		const { handlers } = install();
		const v = view(61);

		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(v.compactions.length, 1);
		assert.match(v.compactions[0], /Сохрани цель/);
		assert.ok(v.notes.some((note) => /авто-компакция/.test(note.text)));

		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(v.compactions.length, 1);

		await fire(handlers, "session_compact", {}, v.ctx);
		assert.match(v.notes.at(-1).text, /Контекст сжат/);
		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(v.compactions.length, 2);
	});

	it("does not compact on a non-final agent_end", async () => {
		const { handlers } = install();
		const v = view(61);
		await fire(
			handlers,
			"agent_end",
			{ willContinue: true, awaitingAsyncWork: false },
			v.ctx,
		);
		assert.equal(v.compactions.length, 0);
		await fire(
			handlers,
			"agent_end",
			{ willContinue: false, awaitingAsyncWork: true },
			v.ctx,
		);
		assert.equal(v.compactions.length, 0);
	});

	it("does not compact while busy, pending, or below the threshold", async () => {
		for (const options of [{ idle: false }, { pending: true }]) {
			const { handlers } = install();
			const v = view(61, options);
			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(v.compactions.length, 0);
		}
	});

	it("can be disabled with OMP_CONTEXT_AUTO=off", async () => {
		const { handlers } = install({ OMP_CONTEXT_AUTO: "off" });
		const v = view(90);
		await fire(handlers, "turn_end", {}, v.ctx);
		assert.equal(v.compactions.length, 0);
	});
});

describe("/handoff-new", () => {
	it("creates a new session after HANDOFF.md exists", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-handoff-"));
		try {
			writeFileSync(join(dir, "HANDOFF.md"), "# state\n");
			const { commands } = install();
			const v = view(40, { cwd: dir, sessionFile: "/tmp/parent.jsonl" });

			await command(commands, "handoff-new", v.ctx);

			assert.equal(v.newSessions.length, 1);
			assert.equal(v.newSessions[0].parentSession, "/tmp/parent.jsonl");
			assert.equal(v.waits(), 1);
			assert.equal(v.customMessages.length, 1);
			assert.equal(v.customMessages[0][0], "handoff");
			assert.match(v.customMessages[0][1], /HANDOFF\.md/);
			assert.match(v.notes[0].text, /HANDOFF-NEW/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses without HANDOFF.md", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-handoff-"));
		try {
			const { commands } = install();
			const v = view(40, { cwd: dir });

			await command(commands, "handoff-new", v.ctx);

			assert.equal(v.newSessions.length, 0);
			assert.match(v.notes[0].text, /HANDOFF не найден/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reports a cancelled new session", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-handoff-"));
		try {
			writeFileSync(join(dir, "HANDOFF.md"), "# state\n");
			const { commands } = install();
			const v = view(40, {
				cwd: dir,
				newSessionResult: { cancelled: true },
			});

			await command(commands, "handoff-new", v.ctx);

			assert.equal(v.newSessions.length, 1);
			assert.match(v.notes.at(-1).text, /отменён/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("supervisor", () => {
	it("prints the handoff command in dry-run and keeps the marker", () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-supervisor-"));
		try {
			writeFileSync(
				join(dir, ".omp-handoff-session.json"),
				JSON.stringify({ terminal: "term_test" }),
			);
			writeFileSync(
				join(dir, ".omp-handoff-request.json"),
				JSON.stringify({ reason: "task-boundary" }),
			);

			const result = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once", "--dry-run"],
				{ encoding: "utf8" },
			);

			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /term_test/);
			assert.match(result.stdout, /\/handoff-new/);
			assert.match(result.stdout, /task-boundary/);
			assert.equal(existsSync(join(dir, ".omp-handoff-request.json")), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps a mismatched marker during the stale grace window", () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-supervisor-"));
		try {
			writeFileSync(
				join(dir, ".omp-handoff-session.json"),
				JSON.stringify({ terminal: "term_test", sessionFile: "/tmp/new.jsonl" }),
			);
			writeFileSync(
				join(dir, ".omp-handoff-request.json"),
				JSON.stringify({ reason: "task-boundary", sessionFile: "/tmp/old.jsonl" }),
			);

			const result = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once", "--stale-grace", "60"],
				{ encoding: "utf8" },
			);

			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /waiting for grace/);
			assert.equal(existsSync(join(dir, ".omp-handoff-request.json")), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("removes a mismatched marker after stale grace", () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-supervisor-"));
		try {
			writeFileSync(
				join(dir, ".omp-handoff-session.json"),
				JSON.stringify({ terminal: "term_test", sessionFile: "/tmp/new.jsonl" }),
			);
			writeFileSync(
				join(dir, ".omp-handoff-request.json"),
				JSON.stringify({ reason: "task-boundary", sessionFile: "/tmp/old.jsonl" }),
			);

			const result = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once", "--stale-grace", "0"],
				{ encoding: "utf8" },
			);

			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /stale marker removed/);
			assert.equal(existsSync(join(dir, ".omp-handoff-request.json")), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function writeSupervisorLock(dir, pid) {
		const lock = join(dir, ".omp-handoff-supervisor.lock");
		mkdirSync(lock);
		writeFileSync(
			join(lock, "owner.json"),
			JSON.stringify({ pid, dir, startedAt: new Date().toISOString() }),
		);
		return lock;
	}

	function writeHandoffFiles(dir) {
		writeFileSync(
			join(dir, ".omp-handoff-session.json"),
			JSON.stringify({ terminal: "term_test" }),
		);
		writeFileSync(
			join(dir, ".omp-handoff-request.json"),
			JSON.stringify({ reason: "task-boundary" }),
		);
	}

	it("refuses to run a second supervisor for the same dir", () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-supervisor-"));
		try {
			writeHandoffFiles(dir);
			const lock = writeSupervisorLock(dir, process.pid);

			const result = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once", "--dry-run"],
				{ encoding: "utf8" },
			);

			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stderr, /another supervisor is running/);
			assert.doesNotMatch(result.stdout, /handoff-new/);
			assert.equal(existsSync(lock), true);
			assert.equal(existsSync(join(dir, ".omp-handoff-request.json")), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reclaims a lock whose owner process is gone", () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-supervisor-"));
		try {
			writeHandoffFiles(dir);
			const lock = writeSupervisorLock(dir, 2_147_483_647);

			const result = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once", "--dry-run"],
				{ encoding: "utf8" },
			);

			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stderr, /removed stale lock/);
			assert.match(result.stdout, /handoff-new/);
			assert.equal(existsSync(lock), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("removes its lock on normal exit", () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-supervisor-"));
		try {
			writeHandoffFiles(dir);

			const result = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once", "--dry-run"],
				{ encoding: "utf8" },
			);

			assert.equal(result.status, 0, result.stderr);
			assert.equal(
				existsSync(join(dir, ".omp-handoff-supervisor.lock")),
				false,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("/handoff", () => {
	it("compacts with the supplied instructions", async () => {
		const { commands } = install();
		const v = view(40);
		await command(commands, "handoff", v.ctx, "custom instructions");

		assert.equal(v.compactions.length, 1);
		assert.equal(v.compactions[0], "custom instructions");
		assert.match(v.notes[0].text, /HANDOFF 40%/);
	});

	it("does not start a second compaction while one is in flight", async () => {
		const { commands } = install();
		const v = view(40, { complete: false });

		const first = command(commands, "handoff", v.ctx);
		await Promise.resolve();
		await command(commands, "handoff", v.ctx);

		assert.equal(v.compactions.length, 1);
		assert.match(v.notes.at(-1).text, /Сжатие уже идёт/);

		v.finish();
		await first;
	});
});
