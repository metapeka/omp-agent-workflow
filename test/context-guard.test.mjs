/**
 * Deterministic tests for index.ts: no OMP runtime, no model, no network.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import contextGuard from "../index.ts";

const ENV_KEYS = [
	"OMP_CONTEXT_WARN",
	"OMP_CONTEXT_SUGGEST",
	"OMP_CONTEXT_AUTO",
];

function install(env = {}) {
	for (const key of ENV_KEYS) delete process.env[key];
	for (const [key, value] of Object.entries(env)) process.env[key] = String(value);

	const handlers = new Map();
	const commands = new Map();
	const pi = {
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
	};
	contextGuard(pi);
	return { handlers, commands };
}

function view(percent, options = {}) {
	const {
		mode = "tui",
		kind = "main",
		idle = true,
		pending = false,
		complete = true,
	} = options;
	const notes = [];
	const compactions = [];
	let finish = () => {};
	const ctx = {
		mode,
		agent: { kind },
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
		compact(instructions) {
			compactions.push(instructions);
			if (complete) return Promise.resolve();
			return new Promise((resolve) => {
				finish = () => resolve();
			});
		},
	};
	return { ctx, notes, compactions, finish: () => finish() };
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
