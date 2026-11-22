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
 *
 * Один supervisor на каталог: lock-dir `.omp-handoff-supervisor.lock/` рядом с
 * marker. Второй экземпляр для того же `--dir` выходит, не трогая marker.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { acquireLock, releaseLock } from "../lib/supervisor-lock.mjs";

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
		cooldown: { type: "string", default: "300" },
		"stale-grace": { type: "string", default: "5" },
		lock: { type: "string", default: ".omp-handoff-supervisor.lock" },
		"lock-grace": { type: "string", default: "10" },
	},
});

const dir = resolve(values.dir);
const markerPath = resolve(dir, values.marker);
const sessionPath = resolve(dir, values.session);
const lockPath = resolve(dir, values.lock);
const intervalMs = Math.max(250, Number(values.interval) * 1000);
const maxAttempts = Math.max(1, Number(values["max-attempts"]));
const cooldownMs = Math.max(0, Number(values.cooldown) * 1000);
const staleGraceMs = Math.max(0, Number(values["stale-grace"]) * 1000);
const lockGraceMs = Math.max(0, Number(values["lock-grace"]) * 1000);
let lockHeld = false;
let lastHandoffAt = 0;
let staleCandidate = null;
const orca = process.env.ORCA_CLI_COMMAND || "orca";

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function releaseOwnLock() {
	if (!lockHeld) return;
	lockHeld = false;
	releaseLock({ lockPath });
}

process.on("exit", releaseOwnLock);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(signal, () => {
		releaseOwnLock();
		process.exit(0);
	});
}

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

/** Дождаться, пока extension запишет session info новой сессии. */
async function waitForNewSession(previous, timeoutMs = 15_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const current = readJson(sessionPath);
		if (
			current &&
			typeof current.sessionFile === "string" &&
			current.sessionFile !== previous
		) {
			return current;
		}
		await sleep(250);
	}
	return readJson(sessionPath);
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
			staleCandidate = null;
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

		if (
			typeof marker.sessionFile === "string" &&
			marker.sessionFile !== session.sessionFile
		) {
			const now = Date.now();
			if (
				!staleCandidate ||
				staleCandidate.sessionFile !== marker.sessionFile
			) {
				staleCandidate = { sessionFile: marker.sessionFile, since: now };
			}
			if (now - staleCandidate.since < staleGraceMs) {
				console.log(
					"[handoff-supervisor] marker/session mismatch; waiting for grace",
				);
				if (values.once) return;
				await sleep(intervalMs);
				continue;
			}
			rmSync(markerPath, { force: true });
			staleCandidate = null;
			console.log("[handoff-supervisor] stale marker removed (other session)");
			if (values.once) return;
			await sleep(intervalMs);
			continue;
		}
		staleCandidate = null;

		if (Date.now() - lastHandoffAt < cooldownMs) {
			// После handoff новая сессия не должна просить следующий handoff
			// раньше cooldown. Убираем marker, чтобы не было цикла.
			rmSync(markerPath, { force: true });
			console.log("[handoff-supervisor] early marker removed during cooldown");
			if (values.once) return;
			await sleep(intervalMs);
			continue;
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

		const previousSessionFile =
			typeof session.sessionFile === "string" ? session.sessionFile : null;
		const shown = runOrca([
			"terminal",
			"show",
			"--terminal",
			terminal,
			"--json",
		]);
		if (shown.status !== 0) {
			attempts += 1;
			fail(
				`terminal ${terminal} is not live (${attempts}/${maxAttempts}): ${(shown.stderr || shown.stdout || "").trim()}`,
			);
			if (values.once || attempts >= maxAttempts) return;
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

		const next = await waitForNewSession(previousSessionFile, 30_000);
		if (
			!next ||
			typeof next.sessionFile !== "string" ||
			next.sessionFile === previousSessionFile
		) {
			attempts += 1;
			fail(
				`new session was not detected (${attempts}/${maxAttempts}); marker kept for retry`,
			);
			if (values.once || attempts >= maxAttempts) return;
			await sleep(intervalMs);
			continue;
		}

		rmSync(markerPath, { force: true });
		lastHandoffAt = Date.now();
		console.log(`[handoff-supervisor] /handoff-new sent to ${terminal}`);
		console.log("[handoff-supervisor] new session detected");

		if (!values["no-prompt"]) {
			await sleep(300);
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

let lock = null;
try {
	lock = acquireLock({ lockPath, dir, graceMs: lockGraceMs });
} catch (error) {
	console.error(`[handoff-supervisor] cannot create ${lockPath}: ${error.message}`);
	process.exitCode = 1;
}

if (lock?.reclaimed) {
	console.error(
		`[handoff-supervisor] removed stale lock (pid=${lock.reclaimed.pid ?? "unknown"})`,
	);
}

if (lock?.ok) {
	lockHeld = true;
	try {
		await main();
	} finally {
		releaseOwnLock();
	}
} else if (lock?.reason === "running") {
	console.error(
		`[handoff-supervisor] another supervisor is running for ${dir} (pid=${lock.owner?.pid}); exiting`,
	);
} else if (lock?.reason === "initializing") {
	console.error(
		`[handoff-supervisor] lock ${lockPath} is initializing; exiting`,
	);
} else if (lock) {
	console.error(`[handoff-supervisor] cannot acquire ${lockPath}; exiting`);
}
