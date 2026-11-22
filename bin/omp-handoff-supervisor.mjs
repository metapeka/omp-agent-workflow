#!/usr/bin/env node
/**
 * omp-handoff-supervisor — внешний watcher для automatic handoff.
 *
 * Агент пишет .omp-handoff-request.json, когда задача завершена и HANDOFF.md
 * обновлён. Supervisor ждёт marker, отправляет /handoff-new в terminal handle
 * из .omp-handoff-session.json, затем просит новую сессию продолжить.
 *
 * Запускать в фоне рядом с OMP:
 *   node bin/omp-handoff-supervisor.mjs --dir /path/to/worktree
 *
 * Не является LLM: только marker, terminal handle и команда.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_PROMPT =
	"Прочитай HANDOFF.md и продолжи следующую задачу. Не начинай заново уже сделанное.";

const { values } = parseArgs({
	options: {
		dir: { type: "string", default: process.cwd() },
		marker: { type: "string", default: ".omp-handoff-request.json" },
		session: { type: "string", default: ".omp-handoff-session.json" },
		interval: { type: "string", default: "2" },
		once: { type: "boolean", default: false },
		"dry-run": { type: "boolean", default: false },
		prompt: { type: "string", default: DEFAULT_PROMPT },
		"no-prompt": { type: "boolean", default: false },
		"max-attempts": { type: "string", default: "3" },
	},
});

const dir = resolve(values.dir);
const markerPath = resolve(dir, values.marker);
const sessionPath = resolve(dir, values.session);
const intervalMs = Math.max(250, Number(values.interval) * 1000);
const maxAttempts = Math.max(1, Number(values["max-attempts"]));
const orca = process.env.ORCA_CLI_COMMAND || "orca";

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function readJson(path) {
	try {
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		console.error(`[handoff-supervisor] cannot read ${path}: ${error.message}`);
		return null;
	}
}

function runOrca(args) {
	return spawnSync(orca, args, { encoding: "utf8", timeout: 30_000 });
}

function fail(message) {
	console.error(`[handoff-supervisor] ${message}`);
	process.exitCode = 1;
}

async function main() {
	let attempts = 0;

	for (;;) {
		const marker = readJson(markerPath);
		const session = readJson(sessionPath);

		if (!marker || !session) {
			if (values.once) {
				fail(`waiting for ${markerPath} and ${sessionPath}`);
				return;
			}
			await sleep(intervalMs);
			continue;
		}

		const terminal = session.terminal;
		if (typeof terminal !== "string" || terminal.length === 0) {
			fail(`${sessionPath} has no terminal handle; start OMP from Orca`);
			return;
		}

		const plan = {
			terminal,
			command: "/handoff-new",
			prompt: values["no-prompt"] ? null : values.prompt,
			marker,
		};

		if (values["dry-run"]) {
			console.log(JSON.stringify(plan, null, 2));
			if (values.once) return;
			await sleep(intervalMs);
			continue;
		}

		const sent = runOrca([
			"terminal",
			"send",
			"--terminal",
			terminal,
			"--text",
			"/handoff-new",
			"--enter",
			"--wait-submit",
			"10",
			"--json",
		]);
		if (sent.status !== 0) {
			attempts += 1;
			fail(
				`handoff send failed (${attempts}/${maxAttempts}): ${(sent.stderr || sent.stdout || "").trim()}`,
			);
			if (attempts >= maxAttempts) return;
			await sleep(intervalMs);
			continue;
		}

		rmSync(markerPath, { force: true });
		console.log(`[handoff-supervisor] /handoff-new sent to ${terminal}`);

		if (!values["no-prompt"]) {
			await sleep(1500);
			const prompt = runOrca([
				"terminal",
				"send",
				"--terminal",
				terminal,
				"--text",
				values.prompt,
				"--enter",
				"--wait-submit",
				"10",
				"--json",
			]);
			if (prompt.status !== 0) {
				fail(`prompt send failed: ${(prompt.stderr || prompt.stdout || "").trim()}`);
				return;
			}
			console.log("[handoff-supervisor] continuation prompt sent");
		}

		if (values.once) return;
		attempts = 0;
		await sleep(intervalMs);
	}
}

await main();
