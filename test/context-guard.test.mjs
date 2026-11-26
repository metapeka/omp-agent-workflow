/**
 * Deterministic tests for index.ts: no OMP runtime, no model, no network.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import contextGuard from "../index.ts";
import { createInitialState, writeState } from "../lib/orchestrator/state.ts";
import {
	acquireLock,
	readOwner,
	reclaimStaleLock,
	releaseLock,
} from "../lib/supervisor-lock.mjs";

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
	"OMP_STATUS_ENABLED",
	"OMP_ORCA_ENABLED",
	"OMP_ORCA_PREFLIGHT",
	"OMP_SUPERVISOR_ENABLED",
	"OMP_HANDOFF_PROMPT",
	"OMP_SUPERVISOR_RETRIES",
	"OMP_SUPERVISOR_LOG_LEVEL",
	"ORCA_TERMINAL_HANDLE",
];

// Supervisor gates читают ambient env; тесты стартуют от чистого состояния.
for (const key of [
	"OMP_ORCA_ENABLED",
	"OMP_ORCA_PREFLIGHT",
	"OMP_SUPERVISOR_ENABLED",
	"OMP_HANDOFF_PROMPT",
	"OMP_SUPERVISOR_RETRIES",
	"OMP_SUPERVISOR_LOG_LEVEL",
]) {
	delete process.env[key];
}

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
		askDialog = null,
		input = null,
		ephemeral = null,
	} = options;
	const notes = [];
	const statuses = [];
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
			setStatus(key, text) {
				statuses.push({ key, text });
			},
			...(askDialog ? { askDialog } : {}),
			...(input ? { input } : {}),
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
		...(ephemeral ? { runEphemeralTurn: ephemeral } : {}),
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
		statuses,
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
			assert.equal(info.sessions.length, 1);
			assert.equal(info.sessions[0].cwd, dir);
			assert.equal(info.sessions[0].sessionFile, "/tmp/session.jsonl");
			assert.equal(info.sessions[0].terminal, null);
			assert.equal(info.sessions[0].pid, process.pid);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writes a trimmed terminal handle from the environment", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-session-info-"));
		try {
			const { handlers } = install({ ORCA_TERMINAL_HANDLE: "  term_abc  " });
			const main = view(40, { cwd: dir });
			await fire(handlers, "session_start", {}, main.ctx);
			const info = JSON.parse(
				readFileSync(join(dir, ".omp-handoff-session.json"), "utf8"),
			);
			assert.equal(info.sessions[0].terminal, "term_abc");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps other live sessions and prunes dead pids", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-session-info-"));
		const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
			stdio: "ignore",
		});
		try {
			writeFileSync(
				join(dir, ".omp-handoff-session.json"),
				JSON.stringify({
					sessions: [
						{
							terminal: "term_live",
							sessionFile: "/tmp/live.jsonl",
							cwd: dir,
							pid: child.pid,
							updatedAt: "2026-11-24T07:08:00.000Z",
						},
						{
							terminal: "term_oneshot",
							sessionFile: "/tmp/oneshot.jsonl",
							cwd: dir,
							pid: 2_147_483_647,
							updatedAt: "2026-11-24T07:26:00.000Z",
						},
					],
				}),
			);
			const { handlers } = install({ ORCA_TERMINAL_HANDLE: "term_ours" });
			const main = view(40, { cwd: dir, sessionFile: "/tmp/ours.jsonl" });
			await fire(handlers, "session_start", {}, main.ctx);

			const info = JSON.parse(
				readFileSync(join(dir, ".omp-handoff-session.json"), "utf8"),
			);
			assert.equal(info.sessions.length, 2);
			assert.equal(info.sessions.some((entry) => entry.terminal === "term_oneshot"), false);
			const live = info.sessions.find((entry) => entry.terminal === "term_live");
			assert.equal(live.sessionFile, "/tmp/live.jsonl");
			const ours = info.sessions.find((entry) => entry.pid === process.pid);
			assert.equal(ours.sessionFile, "/tmp/ours.jsonl");
			assert.equal(ours.terminal, "term_ours");
		} finally {
			child.kill();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("updates the current pid entry on session switch", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-session-info-"));
		try {
			const { handlers } = install({ ORCA_TERMINAL_HANDLE: "term_x" });
			const first = view(40, { cwd: dir, sessionFile: "/tmp/first.jsonl" });
			await fire(handlers, "session_start", {}, first.ctx);
			const second = view(40, { cwd: dir, sessionFile: "/tmp/second.jsonl" });
			await fire(handlers, "session_switch", {}, second.ctx);

			const info = JSON.parse(
				readFileSync(join(dir, ".omp-handoff-session.json"), "utf8"),
			);
			assert.equal(info.sessions.length, 1);
			assert.equal(info.sessions[0].sessionFile, "/tmp/second.jsonl");
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

	it("retries when the marker does not appear and stops at the cap", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-handoff-retry-"));
		try {
			const { handlers, sent } = install({ OMP_HANDOFF_AT: "55" });
			const v = view(56, { cwd: dir });

			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(sent.length, 1);

			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(sent.length, 1, "no retry before the turn deadline");

			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(sent.length, 2);
			assert.ok(
				v.notes.some((note) => /HANDOFF запрошен 2 раз, marker не появился/.test(note.text)),
			);

			await fire(handlers, "turn_end", {}, v.ctx);
			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(sent.length, 3);
			assert.ok(
				v.notes.some((note) => /HANDOFF запрошен 3 раз, marker не появился/.test(note.text)),
			);

			await fire(handlers, "turn_end", {}, v.ctx);
			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(sent.length, 3, "request cap stops the loop");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not retry once the session marker exists", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-handoff-marker-"));
		try {
			writeFileSync(
				join(dir, ".omp-handoff-request.json"),
				JSON.stringify({ reason: "context", sessionFile: "/tmp/session.jsonl" }),
			);
			const { handlers, sent } = install({ OMP_HANDOFF_AT: "55" });
			const v = view(56, { cwd: dir });
			for (let turn = 0; turn < 4; turn += 1) {
				await fire(handlers, "turn_end", {}, v.ctx);
			}
			assert.equal(sent.length, 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("warns when yoda-supervised has no running supervisor", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-handoff-sup-"));
		try {
			const { handlers, sent } = install({
				OMP_WORKFLOW_MODE: "yoda-supervised",
				ORCA_TERMINAL_HANDLE: "term_test",
			});
			const v = view(56, { cwd: dir });
			await fire(handlers, "turn_end", {}, v.ctx);
			await fire(handlers, "turn_end", {}, v.ctx);

			const warnings = v.notes.filter((note) => /Supervisor не запущен/.test(note.text));
			assert.equal(warnings.length, 1);
			assert.match(warnings[0].text, /OMP_YODA_DIR=.*bin\/omp-yoda/);
			assert.equal(sent.length, 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("warns once when the terminal handle is missing", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-handoff-term-"));
		try {
			const { handlers } = install({ OMP_WORKFLOW_MODE: "yoda-supervised" });
			const v = view(56, { cwd: dir });
			await fire(handlers, "turn_end", {}, v.ctx);
			await fire(handlers, "turn_end", {}, v.ctx);

			const warnings = v.notes.filter((note) => /terminal handle нет/.test(note.text));
			assert.equal(warnings.length, 1);
			assert.match(warnings[0].text, /automatic handoff не сработает/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
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

	it("compacts after handoff retries are exhausted", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-auto-fallback-"));
		try {
			const { handlers, sent } = install({
				OMP_HANDOFF_AT: "30",
				OMP_CONTEXT_AUTO: "60",
			});
			const v = view(61, { cwd: dir });
			for (let turn = 0; turn < 4; turn += 1) {
				await fire(handlers, "turn_end", {}, v.ctx);
			}
			assert.equal(sent.length, 2);
			assert.equal(v.compactions.length, 0, "waits while retries remain");

			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(sent.length, 3);
			assert.equal(v.compactions.length, 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("waits for a live supervisor that holds the marker", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-auto-sup-"));
		try {
			const lockDir = join(dir, ".omp-handoff-supervisor.lock");
			mkdirSync(lockDir, { recursive: true });
			writeFileSync(
				join(lockDir, "owner.json"),
				JSON.stringify({ pid: process.pid, dir }),
			);
			const { handlers, sent } = install({
				OMP_WORKFLOW_MODE: "yoda-supervised",
				OMP_HANDOFF_AT: "30",
				OMP_CONTEXT_AUTO: "60",
				ORCA_TERMINAL_HANDLE: "term_test",
			});
			const v = view(61, { cwd: dir, sessionFile: "/tmp/session.jsonl" });
			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(sent.length, 1);
			writeFileSync(
				join(dir, ".omp-handoff-request.json"),
				JSON.stringify({ reason: "context", sessionFile: "/tmp/session.jsonl" }),
			);
			for (let turn = 0; turn < 6; turn += 1) {
				await fire(handlers, "turn_end", {}, v.ctx);
			}
			assert.equal(v.compactions.length, 0, "supervisor may still act");

			rmSync(lockDir, { recursive: true, force: true });
			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(v.compactions.length, 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
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

	it("embeds HANDOFF.md content in the custom message", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-handoff-"));
		try {
			writeFileSync(
				join(dir, "HANDOFF.md"),
				"# state\nUNIQUE-STATE-MARKER-42\nnext: test\n",
			);
			const { commands } = install();
			const v = view(40, { cwd: dir });

			await command(commands, "handoff-new", v.ctx);

			assert.equal(v.customMessages.length, 1);
			const message = v.customMessages[0][1];
			assert.match(message, /UNIQUE-STATE-MARKER-42/);
			assert.match(message, /next: test/);
			assert.match(message, /Прочитай HANDOFF\.md/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("truncates a state file above the 32k limit", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-handoff-"));
		try {
			const head = "A".repeat(40_000);
			const tail = "TAIL-MUST-BE-ABSENT";
			writeFileSync(join(dir, "HANDOFF.md"), `${head}${tail}`);
			const { commands } = install();
			const v = view(40, { cwd: dir });

			await command(commands, "handoff-new", v.ctx);

			const message = v.customMessages[0][1];
			assert.match(
				message,
				new RegExp(`state обрезан: показаны 32000 из ${head.length + tail.length}`),
			);
			assert.doesNotMatch(message, /TAIL-MUST-BE-ABSENT/);
			assert.ok(message.length < 33_000, `message length ${message.length}`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("uses an alternative state file from the command argument", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-handoff-"));
		try {
			writeFileSync(join(dir, "HANDOFF.md"), "DEFAULT-STATE\n");
			writeFileSync(join(dir, "ALT.md"), "ALTERNATIVE-STATE-MARKER\n");
			const { commands } = install();
			const v = view(40, { cwd: dir });

			await command(commands, "handoff-new", v.ctx, "ALT.md");

			const message = v.customMessages[0][1];
			assert.match(message, /ALTERNATIVE-STATE-MARKER/);
			assert.doesNotMatch(message, /DEFAULT-STATE/);
			assert.match(message, /ALT\.md/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("falls back to the prompt when the state file cannot be read", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-handoff-"));
		try {
			mkdirSync(join(dir, "STATE"));
			const { commands } = install();
			const v = view(40, { cwd: dir });

			await command(commands, "handoff-new", v.ctx, "STATE");

			const message = v.customMessages[0][1];
			assert.match(message, /Не удалось прочитать STATE/);
			assert.match(message, /Прочитай state-файл сам/);
			assert.match(message, /Прочитай HANDOFF\.md/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("workflow status key", () => {
	const temp = () => mkdtempSync(join(tmpdir(), "cg-status-"));
	const liveSupervisor = (dir, pid = process.pid) => {
		mkdirSync(join(dir, ".omp-handoff-supervisor.lock"), { recursive: true });
		writeFileSync(
			join(dir, ".omp-handoff-supervisor.lock", "owner.json"),
			JSON.stringify({ pid }),
		);
	};
	const currentTask = (dir, active = true) => {
		const state = createInitialState({
			planPath: "AUTOPLAN.md",
			planHash: "hash",
			mode: "yoda",
			sessionFile: null,
			now: new Date(),
		});
		state.run.active = active;
		state.current = {
			id: "T2",
			branch: "feat/t2",
			worktree: "/tmp/wt",
			status: "verified",
			commit: null,
			startedAt: new Date().toISOString(),
			checks: [],
		};
		writeState(join(dir, "STATE.json"), state);
	};

	it("publishes YODA-SUP on session_start", async () => {
		const dir = temp();
		try {
			liveSupervisor(dir);
			const { handlers } = install({ OMP_WORKFLOW_MODE: "yoda-supervised" });
			const v = view(10, { cwd: dir });
			await fire(handlers, "session_start", {}, v.ctx);
			assert.deepEqual(v.statuses.at(-1), {
				key: "workflow",
				text: "YODA-SUP",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("stays silent in off mode: no status, warnings, handoff or session info", async () => {
		const dir = temp();
		try {
			const { handlers, sent } = install({ OMP_WORKFLOW_MODE: "off" });
			const v = view(95, { cwd: dir });
			await fire(handlers, "session_start", {}, v.ctx);
			await fire(handlers, "turn_end", {}, v.ctx);
			await fire(handlers, "agent_end", {}, v.ctx);
			assert.deepEqual(v.statuses.at(-1), {
				key: "workflow",
				text: undefined,
			});
			assert.equal(v.notes.length, 0);
			assert.equal(v.compactions.length, 0);
			assert.equal(sent.length, 0);
			assert.equal(existsSync(join(dir, ".omp-handoff-session.json")), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ignores explicit thresholds in off mode", async () => {
		const dir = temp();
		try {
			const { handlers, sent } = install({
				OMP_WORKFLOW_MODE: "off",
				OMP_HANDOFF_AT: "10",
				OMP_CONTEXT_AUTO: "20",
				OMP_CONTEXT_WARN: "5",
				OMP_CONTEXT_SUGGEST: "6",
			});
			const v = view(95, { cwd: dir });
			await fire(handlers, "session_start", {}, v.ctx);
			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(v.notes.length, 0);
			assert.equal(v.compactions.length, 0);
			assert.equal(sent.length, 0);
			assert.equal(v.statuses.at(-1).text, undefined);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("stays empty in assisted mode", async () => {
		const dir = temp();
		try {
			const { handlers } = install();
			const v = view(10, { cwd: dir });
			await fire(handlers, "session_start", {}, v.ctx);
			assert.deepEqual(v.statuses.at(-1), {
				key: "workflow",
				text: undefined,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("adds the handoff warning at the threshold", async () => {
		const dir = temp();
		try {
			const { handlers } = install({ OMP_WORKFLOW_MODE: "yoda" });
			const v = view(60, { cwd: dir });
			await fire(handlers, "session_start", {}, v.ctx);
			assert.equal(v.statuses.at(-1).text, "YODA · ⚠ HANDOFF");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("honors a marker for the current session", async () => {
		const dir = temp();
		try {
			writeFileSync(
				join(dir, ".omp-handoff-request.json"),
				JSON.stringify({ reason: "task-boundary", sessionFile: "/tmp/session.jsonl" }),
			);
			liveSupervisor(dir);
			const { handlers } = install({ OMP_WORKFLOW_MODE: "yoda-supervised" });
			const v = view(10, { cwd: dir, sessionFile: "/tmp/session.jsonl" });
			await fire(handlers, "session_start", {}, v.ctx);
			assert.equal(v.statuses.at(-1).text, "YODA-SUP · ⚠ HANDOFF");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ignores a marker from another session", async () => {
		const dir = temp();
		try {
			writeFileSync(
				join(dir, ".omp-handoff-request.json"),
				JSON.stringify({ reason: "task-boundary", sessionFile: "/tmp/old.jsonl" }),
			);
			liveSupervisor(dir);
			const { handlers } = install({ OMP_WORKFLOW_MODE: "yoda-supervised" });
			const v = view(10, { cwd: dir, sessionFile: "/tmp/session.jsonl" });
			await fire(handlers, "session_start", {}, v.ctx);
			assert.equal(v.statuses.at(-1).text, "YODA-SUP");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("clears the key when statusEnabled is false", async () => {
		const dir = temp();
		try {
			const { handlers } = install({
				OMP_WORKFLOW_MODE: "yoda",
				OMP_STATUS_ENABLED: "0",
			});
			const v = view(60, { cwd: dir });
			await fire(handlers, "session_start", {}, v.ctx);
			assert.deepEqual(v.statuses.at(-1), {
				key: "workflow",
				text: undefined,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("clears the handoff warning after the marker is removed", async () => {
		const dir = temp();
		try {
			const marker = join(dir, ".omp-handoff-request.json");
			writeFileSync(
				marker,
				JSON.stringify({ reason: "task-boundary", sessionFile: "/tmp/session.jsonl" }),
			);
			const { handlers } = install({ OMP_WORKFLOW_MODE: "yoda" });
			const v = view(10, { cwd: dir });
			await fire(handlers, "session_start", {}, v.ctx);
			assert.equal(v.statuses.at(-1).text, "YODA · ⚠ HANDOFF");
			rmSync(marker, { force: true });
			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(v.statuses.at(-1).text, "YODA");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("shows SUP OFF without a live supervisor", async () => {
		const dir = temp();
		try {
			const { handlers } = install({ OMP_WORKFLOW_MODE: "yoda-supervised" });
			const v = view(10, { cwd: dir });
			await fire(handlers, "session_start", {}, v.ctx);
			assert.equal(v.statuses.at(-1).text, "YODA-SUP · SUP OFF");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("shows SUP OFF for a dead supervisor pid", async () => {
		const dir = temp();
		try {
			liveSupervisor(dir, 2_147_483_647);
			const { handlers } = install({ OMP_WORKFLOW_MODE: "yoda-supervised" });
			const v = view(10, { cwd: dir });
			await fire(handlers, "session_start", {}, v.ctx);
			assert.equal(v.statuses.at(-1).text, "YODA-SUP · SUP OFF");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("shows the active orchestrator task", async () => {
		const dir = temp();
		try {
			currentTask(dir);
			const { handlers } = install({ OMP_WORKFLOW_MODE: "yoda" });
			const v = view(10, { cwd: dir });
			await fire(handlers, "session_start", {}, v.ctx);
			assert.equal(v.statuses.at(-1).text, "YODA · T2 verify");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("hides the orchestrator task when the run is inactive", async () => {
		const dir = temp();
		try {
			currentTask(dir, false);
			const { handlers } = install({ OMP_WORKFLOW_MODE: "yoda" });
			const v = view(10, { cwd: dir });
			await fire(handlers, "session_start", {}, v.ctx);
			assert.equal(v.statuses.at(-1).text, "YODA");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("updates on turn_end", async () => {
		const dir = temp();
		try {
			writeFileSync(
				join(dir, ".omp-handoff-request.json"),
				JSON.stringify({ reason: "task-boundary", sessionFile: "/tmp/session.jsonl" }),
			);
			const { handlers } = install({ OMP_WORKFLOW_MODE: "yoda" });
			const v = view(10, { cwd: dir });
			await fire(handlers, "turn_end", {}, v.ctx);
			assert.equal(v.statuses.at(-1).text, "YODA · ⚠ HANDOFF");
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

	it("selects the live session from a multi-session map", () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-supervisor-"));
		try {
			writeFileSync(
				join(dir, ".omp-handoff-session.json"),
				JSON.stringify({
					sessions: [
						{
							terminal: "term_live",
							sessionFile: "/tmp/live.jsonl",
							cwd: dir,
							pid: process.pid,
							updatedAt: "2026-11-24T07:08:00.000Z",
						},
						{
							terminal: "term_oneshot",
							sessionFile: "/tmp/oneshot.jsonl",
							cwd: dir,
							pid: 2_147_483_647,
							updatedAt: "2026-11-24T07:26:00.000Z",
						},
					],
				}),
			);
			writeFileSync(
				join(dir, ".omp-handoff-request.json"),
				JSON.stringify({
					reason: "context",
					sessionFile: "/tmp/live.jsonl",
				}),
			);

			const result = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once", "--dry-run"],
				{ encoding: "utf8" },
			);

			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /term_live/);
			assert.doesNotMatch(result.stdout, /term_oneshot/);
			assert.doesNotMatch(result.stderr, /mismatch|stale/);
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
			assert.match(result.stderr, /waiting for grace/);
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
			assert.match(result.stderr, /stale marker removed/);
			assert.equal(existsSync(join(dir, ".omp-handoff-request.json")), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps the marker when the terminal handle is not live", () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-supervisor-"));
		try {
			writeFileSync(
				join(dir, ".omp-handoff-session.json"),
				JSON.stringify({ terminal: "term_dead" }),
			);
			writeFileSync(
				join(dir, ".omp-handoff-request.json"),
				JSON.stringify({ reason: "task-boundary" }),
			);
			const fake = join(dir, "orca-fake");
			writeFileSync(fake, "#!/bin/sh\nexit 1\n", { mode: 0o755 });

			const result = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once"],
				{
					encoding: "utf8",
					env: { ...process.env, ORCA_CLI_COMMAND: fake },
				},
			);

			assert.equal(result.status, 1, result.stderr);
			assert.match(result.stderr, /is not live/);
			assert.equal(existsSync(join(dir, ".omp-handoff-request.json")), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("exits without taking the lock when disabled by settings", () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-supervisor-"));
		try {
			const result = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once"],
				{
					encoding: "utf8",
					env: { ...process.env, OMP_SUPERVISOR_ENABLED: "0" },
				},
			);

			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stderr, /disabled by OMP_SUPERVISOR_ENABLED/);
			assert.equal(
				existsSync(join(dir, ".omp-handoff-supervisor.lock")),
				false,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips the handle preflight when orcaPreflight is off", () => {
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
			const log = join(dir, "orca-calls.log");
			const fake = join(dir, "orca-fake");
			writeFileSync(
				fake,
				`#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexit 1\n`,
				{ mode: 0o755 },
			);

			const result = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once"],
				{
					encoding: "utf8",
					env: {
						...process.env,
						ORCA_CLI_COMMAND: fake,
						OMP_ORCA_PREFLIGHT: "0",
					},
				},
			);

			assert.equal(result.status, 1, result.stderr);
			const calls = readFileSync(log, "utf8");
			assert.match(calls, /terminal send/);
			assert.doesNotMatch(calls, /terminal show/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("uses OMP_HANDOFF_PROMPT in the dry-run plan", () => {
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
				{
					encoding: "utf8",
					env: {
						...process.env,
						OMP_HANDOFF_PROMPT: "custom prompt",
						OMP_SUPERVISOR_LOG_LEVEL: "quiet",
					},
				},
			);

			assert.equal(result.status, 0, result.stderr);
			assert.equal(JSON.parse(result.stdout).prompt, "custom prompt");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("honors supervisorLogLevel", () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-supervisor-"));
		try {
			const quiet = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once", "--dry-run"],
				{
					encoding: "utf8",
					env: { ...process.env, OMP_SUPERVISOR_LOG_LEVEL: "quiet" },
				},
			);
			const info = spawnSync(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--once", "--dry-run"],
				{
					encoding: "utf8",
					env: { ...process.env, OMP_SUPERVISOR_LOG_LEVEL: "info" },
				},
			);

			assert.doesNotMatch(quiet.stderr, /started dir=/);
			assert.match(info.stderr, /started dir=/);
			assert.equal(quiet.status, 1);
			assert.equal(info.status, 1);
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

describe("supervisor lock", () => {
	const makeDir = () => mkdtempSync(join(tmpdir(), "cg-lock-"));
	const lockName = ".omp-handoff-supervisor.lock";
	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	it("treats a lock without owner.json as initializing", () => {
		const dir = makeDir();
		try {
			const lockPath = join(dir, lockName);
			mkdirSync(lockPath);
			const result = acquireLock({ lockPath, dir, graceMs: 10_000, pid: 111 });
			assert.equal(result.ok, false);
			assert.equal(result.reason, "initializing");
			assert.equal(existsSync(lockPath), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reclaims an ownerless lock after the grace window", () => {
		const dir = makeDir();
		try {
			const lockPath = join(dir, lockName);
			mkdirSync(lockPath);
			const old = new Date(Date.now() - 60_000);
			utimesSync(lockPath, old, old);
			const result = acquireLock({ lockPath, dir, graceMs: 10_000, pid: 4242 });
			assert.equal(result.ok, true);
			assert.equal(readOwner(lockPath).pid, 4242);
			releaseLock({ lockPath, pid: 4242 });
			assert.equal(existsSync(lockPath), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses a lock held by a live process", () => {
		const dir = makeDir();
		try {
			const lockPath = join(dir, lockName);
			mkdirSync(lockPath);
			writeFileSync(
				join(lockPath, "owner.json"),
				JSON.stringify({ pid: process.pid, dir, startedAt: "live" }),
			);
			const result = acquireLock({ lockPath, dir, graceMs: 0 });
			assert.equal(result.ok, false);
			assert.equal(result.reason, "running");
			assert.equal(result.owner.pid, process.pid);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reclaims a lock whose owner is dead", () => {
		const dir = makeDir();
		try {
			const lockPath = join(dir, lockName);
			mkdirSync(lockPath);
			writeFileSync(
				join(lockPath, "owner.json"),
				JSON.stringify({ pid: 2_147_483_647, dir, startedAt: "stale" }),
			);
			const result = acquireLock({ lockPath, dir, graceMs: 0, pid: 777 });
			assert.equal(result.ok, true);
			assert.equal(result.reclaimed.pid, 2_147_483_647);
			assert.equal(readOwner(lockPath).pid, 777);
			releaseLock({ lockPath, pid: 777 });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("restores a live lock taken over during stale reclaim", () => {
		const dir = makeDir();
		try {
			const lockPath = join(dir, lockName);
			mkdirSync(lockPath);
			const liveOwner = { pid: process.pid, dir, startedAt: "live" };
			writeFileSync(join(lockPath, "owner.json"), JSON.stringify(liveOwner));
			const staleOwner = { pid: 2_147_483_647, dir, startedAt: "stale" };

			const outcome = reclaimStaleLock(lockPath, staleOwner);

			assert.equal(outcome, "foreign");
			assert.equal(existsSync(lockPath), true);
			assert.deepEqual(readOwner(lockPath), liveOwner);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("releases its lock on SIGTERM", async () => {
		const dir = makeDir();
		const lockPath = join(dir, lockName);
		const child = spawn(
			process.execPath,
			[SUPERVISOR, "--dir", dir, "--interval", "0.25"],
			{ stdio: "ignore" },
		);
		try {
			const deadline = Date.now() + 3_000;
			while (!existsSync(join(lockPath, "owner.json"))) {
				if (Date.now() > deadline) assert.fail("supervisor did not take the lock");
				await delay(25);
			}
			child.kill("SIGTERM");
			const code = await new Promise((resolve) => child.once("exit", resolve));
			assert.equal(code, 0);
			assert.equal(existsSync(lockPath), false);
		} finally {
			child.kill("SIGKILL");
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps exactly one of two concurrent starters", async () => {
		const dir = makeDir();
		const lockPath = join(dir, lockName);
		mkdirSync(lockPath);
		writeFileSync(
			join(lockPath, "owner.json"),
			JSON.stringify({ pid: 2_147_483_647, dir, startedAt: "stale" }),
		);
		const children = [1, 2].map(() =>
			spawn(
				process.execPath,
				[SUPERVISOR, "--dir", dir, "--interval", "0.25"],
				{ stdio: "ignore" },
			),
		);
		try {
			await delay(1_500);
			const alive = children.filter(
				(child) => child.exitCode === null && child.signalCode === null,
			);
			assert.equal(alive.length, 1);
			assert.equal(readOwner(lockPath).pid, alive[0].pid);
		} finally {
			for (const child of children) child.kill("SIGTERM");
			await Promise.all(
				children.map((child) =>
					child.exitCode === null && child.signalCode === null
						? new Promise((resolve) => child.once("exit", resolve))
						: null,
				),
			);
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

/** Временный git-репозиторий: все файлы в одном коммите. */
function preflightRepo(files) {
	const dir = mkdtempSync(join(tmpdir(), "cg-preflight-"));
	const run = (...args) => {
		const result = spawnSync(
			"git",
			[
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{ cwd: dir, encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	run("init", "-q", "-b", "main");
	run("config", "user.name", "Test");
	run("config", "user.email", "test@example.com");
	run("config", "commit.gpgsign", "false");
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content);
	}
	run("add", "-A");
	run("commit", "-q", "-m", "init");
	return { dir, run };
}

function actionDialog(selectedIds = []) {
	const asked = [];
	const askDialog = async (questions) => {
		asked.push(questions);
		return {
			kind: "submit",
			results: questions.map((question) => ({
				id: question.id,
				question: question.question,
				options: ["Сделать", "Пропустить"],
				multi: false,
				selectedOptions: [
					selectedIds.includes(question.id) ? "Сделать" : "Пропустить",
				],
			})),
		};
	};
	return { asked, askDialog };
}

describe("/handoff-preflight", () => {
	it("passes a clean committed repo", async () => {
		const { dir } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"index.ts": "export {};\n",
		});
		try {
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(v.notes.length, 1);
			assert.equal(v.notes[0].level, "info");
			assert.match(v.notes[0].text, /preflight: OK/);
			assert.match(v.notes[0].text, /HANDOFF\.md: закоммичен в HEAD/);
			assert.match(v.notes[0].text, /git: чисто/);
			assert.match(v.notes[0].text, /marker: нет/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("shows a valid next-session advisory without switching anything", async () => {
		const ts = `${new Date().toISOString().slice(0, 16)}Z`;
		const { dir } = preflightRepo({
			"HANDOFF.md": `next-session: v=1 ts=${ts} mode=plan reason=seams\n# state\n`,
			"index.ts": "export {};\n",
		});
		try {
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.match(
				v.notes[0].text,
				/✓ next-session: v=1 ts=.* mode=plan reason=seams/,
			);
			assert.match(v.notes[0].text, /preflight: OK/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("warns about an invalid next-session line", async () => {
		const { dir } = preflightRepo({
			"HANDOFF.md": "next-session: v=2 ts=2026-11-25T00:40Z mode=plan\n# state\n",
			"index.ts": "export {};\n",
		});
		try {
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.match(v.notes[0].text, /⚠ next-session: версия v=2/);
			assert.match(v.notes[0].text, /preflight: OK/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ignores handoff runtime files in the worktree check", async () => {
		const { dir } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"index.ts": "export {};\n",
		});
		try {
			writeFileSync(join(dir, ".omp-handoff-session.json"), "{}\n");
			writeFileSync(join(dir, ".omp-handoff-request.json"), "{}\n");
			mkdirSync(join(dir, ".omp-handoff-supervisor.lock.stale-1"));
			writeFileSync(
				join(dir, ".omp-handoff-supervisor.lock.stale-1", "owner.json"),
				"{}\n",
			);
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.match(v.notes[0].text, /git: чисто/);
			assert.equal(v.notes[0].level, "info");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("shows the state first and offers only needed actions", async () => {
		const { dir } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"index.ts": "export {};\n",
		});
		try {
			const { commands } = install();
			const { asked, askDialog } = actionDialog();
			const v = view(40, { cwd: dir, askDialog });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(asked.length, 1);
			assert.deepEqual(
				asked[0].map((question) => question.id),
				["checks"],
			);
			assert.match(v.notes[0].text, /состояние до действий/);
			assert.match(v.notes.at(-1).text, /PREFLIGHT · действия/);
			assert.match(v.notes.at(-1).text, /— не выбраны/);
			assert.match(v.notes.at(-1).text, /PREFLIGHT · итог/);
			assert.match(v.notes.at(-1).text, /preflight: OK/);
			assert.doesNotMatch(v.notes.at(-1).text, /коммит:|проверки:|merge:/);
			assert.equal(v.notes.at(-1).level, "info");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("offers commit for a dirty worktree", async () => {
		const { dir } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"code.ts": "export {};\n",
		});
		try {
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			const { commands } = install();
			const { asked, askDialog } = actionDialog();
			const v = view(40, { cwd: dir, askDialog });
			await command(commands, "handoff-preflight", v.ctx);

			assert.deepEqual(
				asked[0].map((question) => question.id),
				["checks", "commit"],
			);
			assert.match(v.notes[0].text, /git: изменено файлов 1/);
			assert.match(v.notes.at(-1).text, /preflight: блокеры/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("runs selected checks", async () => {
		const { dir } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"package.json": JSON.stringify({
				scripts: { test: "exit 0", typecheck: "exit 0" },
			}),
		});
		try {
			const { commands } = install();
			const { askDialog } = actionDialog(["checks"]);
			const v = view(40, { cwd: dir, askDialog });
			await command(commands, "handoff-preflight", v.ctx);

			assert.match(v.notes.at(-1).text, /✓ проверки: выполнено — test OK; typecheck OK/);
			assert.match(v.notes.at(-1).text, /preflight: OK/);
			assert.equal(v.notes.at(-1).level, "info");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("commits changes with the entered message", async () => {
		const { dir, run } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"code.ts": "export {};\n",
		});
		try {
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			const { commands } = install();
			const { asked, askDialog } = actionDialog(["commit"]);
			const v = view(40, {
				cwd: dir,
				askDialog,
				input: async () => "test: handoff",
			});
			await command(commands, "handoff-preflight", v.ctx);

			assert.deepEqual(
				asked[0].map((question) => question.id),
				["checks", "commit"],
			);
			assert.equal(run("log", "-1", "--format=%s"), "test: handoff");
			assert.equal(run("status", "--porcelain"), "");
			assert.match(v.notes.at(-1).text, /✓ коммит: создан [0-9a-f]+ — test: handoff/);
			assert.match(v.notes.at(-1).text, /PREFLIGHT · итог/);
			assert.match(v.notes.at(-1).text, /git: чисто/);
			assert.match(v.notes.at(-1).text, /preflight: OK/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("uses the placeholder message on an empty commit input", async () => {
		const { dir, run } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"code.ts": "export {};\n",
		});
		try {
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			const { commands } = install();
			const { askDialog } = actionDialog(["commit"]);
			const v = view(40, { cwd: dir, askDialog, input: async () => "" });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(run("log", "-1", "--format=%s"), "handoff: перед сменой сессии");
			assert.match(v.notes.at(-1).text, /✓ коммит: создан [0-9a-f]+/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("uses a model-drafted commit message", async () => {
		const { dir, run } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"code.ts": "export {};\n",
		});
		try {
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			const prompts = [];
			const ephemeral = async (options) => {
				prompts.push(options);
				return {
					replyText: "feat(preflight): draft commit subject\nsecond line",
					assistantMessage: {},
				};
			};
			const { commands } = install();
			const { askDialog } = actionDialog(["commit"]);
			const v = view(40, {
				cwd: dir,
				askDialog,
				input: async () => "",
				ephemeral,
			});
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(
				run("log", "-1", "--format=%s"),
				"feat(preflight): draft commit subject",
			);
			assert.match(prompts[0].promptText, /code\.ts/);
			assert.equal(prompts[0].tools, false);
			assert.match(v.notes.at(-1).text, /✓ коммит: создан [0-9a-f]+ — feat\(preflight\)/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("falls back when the draft turn fails", async () => {
		const { dir, run } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"code.ts": "export {};\n",
		});
		try {
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			const { commands } = install();
			const { askDialog } = actionDialog(["commit"]);
			const v = view(40, {
				cwd: dir,
				askDialog,
				input: async () => "",
				ephemeral: async () => {
					throw new Error("no model");
				},
			});
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(run("log", "-1", "--format=%s"), "handoff: перед сменой сессии");
			assert.match(v.notes.at(-1).text, /✓ коммит: создан [0-9a-f]+/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reports a cancelled commit input as skipped", async () => {
		const { dir, run } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"code.ts": "export {};\n",
		});
		try {
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			const { commands } = install();
			const { askDialog } = actionDialog(["commit"]);
			const v = view(40, { cwd: dir, askDialog, input: async () => undefined });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(run("log", "-1", "--format=%s"), "init");
			assert.match(
				v.notes.at(-1).text,
				/– коммит: пропущено — ввод сообщения отменён/,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fast-forwards the branch into the main worktree", async () => {
		const parent = mkdtempSync(join(tmpdir(), "cg-action-merge-"));
		const mainDir = join(parent, "main");
		const featureDir = join(parent, "feature");
		mkdirSync(mainDir);
		const gitAt = (cwd, ...args) => {
			const result = spawnSync(
				"git",
				[
					"-c",
					"user.name=Test",
					"-c",
					"user.email=test@example.com",
					"-c",
					"commit.gpgsign=false",
					...args,
				],
				{ cwd, encoding: "utf8" },
			);
			assert.equal(result.status, 0, result.stderr);
			return result.stdout.trim();
		};
		try {
			gitAt(mainDir, "init", "-q", "-b", "main");
			writeFileSync(join(mainDir, "HANDOFF.md"), "# state\n");
			writeFileSync(join(mainDir, "code.ts"), "export {};\n");
			gitAt(mainDir, "add", "-A");
			gitAt(mainDir, "commit", "-q", "-m", "init");
			gitAt(mainDir, "worktree", "add", "-q", "-b", "feat", featureDir);
			writeFileSync(join(featureDir, "feature.ts"), "export {};\n");
			gitAt(featureDir, "add", "-A");
			gitAt(featureDir, "commit", "-q", "-m", "feat");
			writeFileSync(join(mainDir, ".omp-handoff-session.json"), "{}\n");

			const { commands } = install();
			const { asked, askDialog } = actionDialog(["merge"]);
			const v = view(40, { cwd: featureDir, askDialog });
			await command(commands, "handoff-preflight", v.ctx);

			assert.deepEqual(
				asked[0].map((question) => question.id),
				["checks", "merge"],
			);
			assert.match(v.notes.at(-1).text, /✓ merge: main @ [0-9a-f]+/);
			assert.match(v.notes.at(-1).text, /влита в main/);
			assert.equal(
				gitAt(mainDir, "rev-parse", "HEAD"),
				gitAt(featureDir, "rev-parse", "HEAD"),
			);
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});

	it("does not commit or merge when selected checks fail", async () => {
		const { dir, run } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"package.json": JSON.stringify({
				scripts: { test: "exit 1", typecheck: "exit 0" },
			}),
		});
		try {
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			let inputs = 0;
			const { commands } = install();
			const { askDialog } = actionDialog(["checks", "commit", "merge"]);
			const v = view(40, {
				cwd: dir,
				askDialog,
				input: async () => {
					inputs += 1;
					return "must not commit";
				},
			});
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(inputs, 0);
			assert.equal(run("log", "-1", "--format=%s"), "init");
			assert.match(v.notes.at(-1).text, /✗ проверки: ошибка — test FAIL/);
			assert.match(v.notes.at(-1).text, /– коммит: пропущено — проверки не прошли/);
			assert.equal(v.notes.at(-1).level, "warning");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails checks on broken package.json and skips commit", async () => {
		const { dir, run } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"package.json": "{not json\n",
		});
		try {
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			let inputs = 0;
			const { commands } = install();
			const { askDialog } = actionDialog(["checks", "commit"]);
			const v = view(40, {
				cwd: dir,
				askDialog,
				input: async () => {
					inputs += 1;
					return "must not commit";
				},
			});
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(inputs, 0);
			assert.equal(run("log", "-1", "--format=%s"), "init");
			assert.match(v.notes.at(-1).text, /✗ проверки: ошибка — package.json битый JSON/);
			assert.match(v.notes.at(-1).text, /– коммит: пропущено — проверки не прошли/);
			assert.equal(v.notes.at(-1).level, "warning");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not commit handoff runtime files", async () => {
		const { dir, run } = preflightRepo({ "HANDOFF.md": "# state\n" });
		try {
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			writeFileSync(join(dir, ".omp-handoff-session.json"), "{}\n");
			const { commands } = install();
			const { askDialog } = actionDialog(["commit"]);
			const v = view(40, {
				cwd: dir,
				askDialog,
				input: async () => "test: files",
			});
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(run("log", "-1", "--format=%s"), "test: files");
			assert.deepEqual(run("show", "--name-only", "--format=", "HEAD").split("\n"), [
				"code.ts",
			]);
			assert.match(run("status", "--porcelain"), /\?\? \.omp-handoff-session\.json/);
			assert.match(v.notes.at(-1).text, /git: чисто/);
			assert.match(v.notes.at(-1).text, /preflight: OK/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("commits when runtime files are gitignored", async () => {
		const { dir, run } = preflightRepo({
			"HANDOFF.md": "# state\n",
			".gitignore": ".omp-handoff-*\n",
			"code.ts": "export {};\n",
		});
		try {
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			writeFileSync(join(dir, ".omp-handoff-session.json"), "{}\n");
			writeFileSync(join(dir, ".omp-handoff-supervisor.lock"), "x\n");
			const { commands } = install();
			const { askDialog } = actionDialog(["commit"]);
			const v = view(40, {
				cwd: dir,
				askDialog,
				input: async () => "test: ignored runtime",
			});
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(run("log", "-1", "--format=%s"), "test: ignored runtime");
			assert.deepEqual(run("show", "--name-only", "--format=", "HEAD").split("\n"), [
				"code.ts",
			]);
			assert.match(v.notes.at(-1).text, /✓ коммит: создан [0-9a-f]+ — test: ignored runtime/);
			assert.match(v.notes.at(-1).text, /preflight: OK/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses to commit on detached HEAD", async () => {
		const { dir, run } = preflightRepo({ "HANDOFF.md": "# state\n" });
		try {
			run("checkout", "-q", "--detach");
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			let inputs = 0;
			const { commands } = install();
			const { askDialog } = actionDialog(["commit"]);
			const v = view(40, {
				cwd: dir,
				askDialog,
				input: async () => {
					inputs += 1;
					return "must not commit";
				},
			});
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(inputs, 0);
			assert.equal(run("log", "-1", "--format=%s"), "init");
			assert.match(v.notes.at(-1).text, /коммит: ошибка — detached HEAD/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("stops when the action menu is cancelled", async () => {
		const { dir } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"index.ts": "export {};\n",
		});
		try {
			const { commands } = install();
			const v = view(40, { cwd: dir, askDialog: async () => undefined });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(v.notes.length, 2);
			assert.match(v.notes[0].text, /состояние до действий/);
			assert.match(v.notes.at(-1).text, /PREFLIGHT отменён/);
			assert.doesNotMatch(v.notes.at(-1).text, /итог/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("blocks on uncommitted changes", async () => {
		const { dir } = preflightRepo({
			"HANDOFF.md": "# state\n",
			"code.ts": "export {};\n",
		});
		try {
			writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(v.notes[0].level, "warning");
			assert.match(v.notes[0].text, /блокеры/);
			assert.match(v.notes[0].text, /изменено файлов 1 — code\.ts/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("blocks when HANDOFF.md is modified but not committed", async () => {
		const { dir } = preflightRepo({ "HANDOFF.md": "# state\n" });
		try {
			writeFileSync(join(dir, "HANDOFF.md"), "# changed\n");
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(v.notes[0].level, "warning");
			assert.match(v.notes[0].text, /HANDOFF\.md: изменён, не закоммичен/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("blocks when HANDOFF.md is missing", async () => {
		const { dir } = preflightRepo({ "code.ts": "export {};\n" });
		try {
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(v.notes[0].level, "warning");
			assert.match(v.notes[0].text, /HANDOFF\.md: нет/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("warns when HANDOFF.md is older than HEAD", async () => {
		const { dir, run } = preflightRepo({ "HANDOFF.md": "# state\n" });
		try {
			writeFileSync(join(dir, "code.ts"), "export {};\n");
			run("add", "-A");
			run("commit", "-q", "-m", "code");
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(v.notes[0].level, "info");
			assert.match(v.notes[0].text, /старше HEAD на 1 коммит/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("flags a marker from another session", async () => {
		const { dir } = preflightRepo({
			"HANDOFF.md": "# state\n",
			".gitignore": ".omp-handoff-request.json\n",
		});
		try {
			const marker = join(dir, ".omp-handoff-request.json");
			writeFileSync(
				marker,
				JSON.stringify({ reason: "context", sessionFile: "/tmp/old.jsonl" }),
			);
			const { commands } = install();
			const v = view(40, { cwd: dir, sessionFile: "/tmp/session.jsonl" });
			await command(commands, "handoff-preflight", v.ctx);
			assert.match(v.notes[0].text, /marker: от другой сессии/);

			writeFileSync(
				marker,
				JSON.stringify({ reason: "context", sessionFile: "/tmp/session.jsonl" }),
			);
			const current = view(40, { cwd: dir, sessionFile: "/tmp/session.jsonl" });
			await command(commands, "handoff-preflight", current.ctx);
			assert.match(current.notes[0].text, /supervisor сам запустит/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips git checks outside a repository", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-preflight-nogit-"));
		try {
			writeFileSync(join(dir, "HANDOFF.md"), "# state\n");
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(v.notes[0].level, "info");
			assert.match(v.notes[0].text, /git: не репозиторий/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("blocks a repository without commits", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-preflight-empty-"));
		try {
			spawnSync("git", ["init", "-q"], { cwd: dir });
			writeFileSync(join(dir, "HANDOFF.md"), "# state\n");
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(v.notes[0].level, "warning");
			assert.match(v.notes[0].text, /нет коммитов/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("blocks detached HEAD", async () => {
		const { dir, run } = preflightRepo({ "HANDOFF.md": "# state\n" });
		try {
			run("checkout", "-q", "--detach");
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(v.notes[0].level, "warning");
			assert.match(v.notes[0].text, /detached HEAD/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("passes a synced upstream and blocks an unpushed commit", async () => {
		const { dir, run } = preflightRepo({ "HANDOFF.md": "# state\n" });
		try {
			const branch = run("rev-parse", "--abbrev-ref", "HEAD");
			run("branch", "base");
			run("branch", "--set-upstream-to=base", branch);
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.match(v.notes[0].text, /upstream base: синхронизирован/);
			assert.equal(v.notes[0].level, "info");

			writeFileSync(join(dir, "later.txt"), "later\n");
			run("add", "-A");
			run("commit", "-q", "-m", "later");
			const ahead = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", ahead.ctx);
			assert.equal(ahead.notes[0].level, "warning");
			assert.match(ahead.notes[0].text, /не запушено 1 коммит/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("warns when upstream is ahead", async () => {
		const { dir, run } = preflightRepo({ "HANDOFF.md": "# state\n" });
		try {
			const branch = run("rev-parse", "--abbrev-ref", "HEAD");
			run("branch", "base");
			run("branch", "--set-upstream-to=base", branch);
			run("checkout", "-q", "-b", "other");
			writeFileSync(join(dir, "other.txt"), "other\n");
			run("add", "-A");
			run("commit", "-q", "-m", "other");
			run("checkout", "-q", branch);
			run("branch", "-f", "base", "other");

			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(v.notes[0].level, "info");
			assert.match(v.notes[0].text, /отстаёт на 1 коммит/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("warns until the branch is merged into main", async () => {
		const { dir, run } = preflightRepo({ "HANDOFF.md": "# state\n" });
		try {
			const mainBranch = run("rev-parse", "--abbrev-ref", "HEAD");
			run("checkout", "-q", "-b", "feat");
			writeFileSync(join(dir, "feat.txt"), "feat\n");
			run("add", "-A");
			run("commit", "-q", "-m", "feat");

			const { commands } = install();
			const before = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", before.ctx);
			assert.match(before.notes[0].text, /не влита в main/);
			assert.equal(before.notes[0].level, "info");

			run("checkout", "-q", mainBranch);
			run("merge", "--ff-only", "-q", "feat");
			run("checkout", "-q", "feat");
			const after = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", after.ctx);
			assert.match(after.notes[0].text, /влита в main/);
			assert.equal(after.notes[0].level, "info");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("checks a custom state file argument", async () => {
		const { dir } = preflightRepo({ "ALT.md": "# alt\n" });
		try {
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx, "ALT.md");

			assert.equal(v.notes[0].level, "info");
			assert.match(v.notes[0].text, /ALT\.md: закоммичен в HEAD/);
			assert.doesNotMatch(v.notes[0].text, /HANDOFF\.md: нет/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when git is unavailable", async () => {
		const { dir } = preflightRepo({ "HANDOFF.md": "# state\n" });
		const path = process.env.PATH;
		try {
			process.env.PATH = join(dir, "no-git-here");
			const { commands } = install();
			const v = view(40, { cwd: dir });
			await command(commands, "handoff-preflight", v.ctx);

			assert.equal(v.notes[0].level, "warning");
			assert.match(v.notes[0].text, /не удалось проверить репозиторий/);
		} finally {
			if (path === undefined) delete process.env.PATH;
			else process.env.PATH = path;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("stays silent for sub-agents and non-TUI modes", async () => {
		const { dir } = preflightRepo({ "HANDOFF.md": "# state\n" });
		try {
			const { commands } = install();
			for (const options of [{ kind: "sub" }, { mode: "print" }]) {
				const v = view(40, { cwd: dir, ...options });
				await command(commands, "handoff-preflight", v.ctx);
				assert.equal(v.notes.length, 0);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
