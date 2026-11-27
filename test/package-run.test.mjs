/**
 * CLI entrypoints from a `node_modules` install.
 *
 * Node refuses type stripping for files under `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). `npm install` and an OMP
 * marketplace copy both place the plugin there, so `bin/omp-orchestrate`,
 * `bin/omp-next-session` and `bin/omp-preset` must boot through
 * `lib/ts-loader.mjs` instead of relying on `--experimental-strip-types`.
 * The test copies the runtime exactly as npm packs it and runs each CLI.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["index.ts", "orchestrator.ts", "package.json"];
const DIRS = ["lib", "bin"];

let sandbox;
let plugin;

before(() => {
	sandbox = mkdtempSync(join(tmpdir(), "oaw-node-modules-"));
	plugin = join(sandbox, "node_modules", "omp-agent-workflow");
	mkdirSync(plugin, { recursive: true });
	for (const file of FILES) {
		copyFileSync(join(ROOT, file), join(plugin, file));
	}
	for (const dir of DIRS) {
		cpSync(join(ROOT, dir), join(plugin, dir), { recursive: true });
	}
});

after(() => {
	rmSync(sandbox, { recursive: true, force: true });
});

function cli(name, args) {
	return spawnSync(process.execPath, [join(plugin, "bin", name), ...args], {
		encoding: "utf8",
		cwd: sandbox,
	});
}

describe("CLI from a node_modules install", () => {
	it("runs omp-orchestrate without Node's type-stripping refusal", () => {
		const result = cli("omp-orchestrate", ["--help"]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Использование/);
		assert.doesNotMatch(
			result.stderr,
			/ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/,
		);
		assert.equal(result.stderr.trim(), "");
	});

	it("reaches the plan loader instead of failing to boot", () => {
		const result = cli("omp-orchestrate", ["status", "--json", "--dir", sandbox]);
		assert.doesNotMatch(
			result.stderr,
			/ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/,
		);
		assert.match(result.stderr, /cannot read plan/);
		assert.equal(result.status, 1);
	});

	it("runs omp-next-session and omp-preset", () => {
		const next = cli("omp-next-session", ["--dir", sandbox]);
		assert.equal(next.status, 0, next.stderr);
		assert.equal(next.stdout, "");

		const prompt = cli("omp-preset", ["--preset", "plan", "--prompt"]);
		assert.equal(prompt.status, 0, prompt.stderr);
		assert.ok(prompt.stdout.trim().length > 0);
		assert.equal(prompt.stderr.trim(), "");
	});
});
