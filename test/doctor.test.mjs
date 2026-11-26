/**
 * `doctor`: фиксированный порядок, золотые id/уровни, strict, отсутствие
 * Orca = warn без fail, битые настройки/план/state = fail, PATH-шимы.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	DOCTOR_SCHEMA_VERSION,
	doctor,
} from "../lib/orchestrator/doctor.ts";
import { createInitialState, STATE_FILE, writeState } from "../lib/orchestrator/state.ts";
import { readPlan } from "../lib/orchestrator/plan.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHECK_IDS = [
	"node.version",
	"omp.version",
	"plugin.linked",
	"plugin.version",
	"plugin.settings",
	"git.repo",
	"git.head",
	"handoff.state",
	"autoplan",
	"state",
	"worktree.root",
	"orca.cli",
	"supervisor.lock",
	"terminal.handle",
	"cache.monitor",
	"ensemble.active",
];

const PLAN = `# AUTOPLAN
\`\`\`json plan
{
  "version": 1,
  "goal": "doctor fixture",
  "worktreeRoot": "worktrees",
  "verify": ["true"]
}
\`\`\`
## T1
\`\`\`json task
{ "id": "T1", "title": "first", "acceptance": ["works"] }
\`\`\`
`;

const CONFIG = {
	settings: {
		workflowMode: "assisted",
		contextWarnPercent: 18,
	},
	schema: {
		workflowMode: {
			type: "enum",
			values: ["off", "manual", "assisted", "yoda", "yoda-supervised"],
		},
		contextWarnPercent: { type: "number", min: 1, max: 99 },
	},
};

const PLUGIN_LIST = {
	marketplace: [],
	npm: [
		{
			name: "omp-agent-workflow",
			version: "0.5.20",
			path: "/nonexistent/omp-agent-workflow",
			enabled: true,
		},
		{
			name: "omp-cache-monitor",
			version: "0.10.1",
			path: "/nonexistent/omp-cache-monitor",
			enabled: true,
		},
	],
};

let tempDirs = [];

function tempDir(prefix = "omp-doctor-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

function writeShim(dir, name, body) {
	const path = join(dir, name);
	writeFileSync(path, body);
	chmodSync(path, 0o755);
	return path;
}

function makeShims(options = {}) {
	const shim = tempDir("omp-doctor-shim-");
	writeFileSync(join(shim, "plugin-list.json"), JSON.stringify(options.plugins ?? PLUGIN_LIST));
	writeFileSync(join(shim, "plugin-config.json"), JSON.stringify(options.config ?? CONFIG));
	writeShim(
		shim,
		"omp",
		`#!/bin/sh
case "$1" in
  --version) printf 'omp/19.2.1\\n' ;;
  plugin)
    case "$2" in
      list) cat "$SHIM_DIR/plugin-list.json" ;;
      config) cat "$SHIM_DIR/plugin-config.json" ;;
    esac ;;
esac
`,
	);
	if (options.orca) {
		writeShim(shim, "orca", "#!/bin/sh\n[ \"$1\" = status ] && printf '{\"ok\":true}\\n'\n");
	}
	if (options.ensemble) {
		writeFileSync(join(shim, "ensemble.json"), JSON.stringify(options.ensemble));
		writeShim(shim, "agent-team", "#!/bin/sh\ncat \"$SHIM_DIR/ensemble.json\"\n");
	}
	return shim;
}

function shimEnv(shim, extra = {}) {
	const env = {
		...process.env,
		PATH: `${shim}:/usr/bin:/bin`,
		SHIM_DIR: shim,
	};
	for (const key of [
		"OMP_BIN",
		"OMP_WORKFLOW_MODE",
		"OMP_ORCA_ENABLED",
		"OMP_ORCA_PREFLIGHT",
		"OMP_CONTEXT_WARN",
		"OMP_CONTEXT_SUGGEST",
		"OMP_CONTEXT_AUTO",
		"OMP_HANDOFF_AT",
		"ORCA_TERMINAL_HANDLE",
		"ORCA_CLI_COMMAND",
	]) {
		delete env[key];
	}
	// /usr/bin/orca — чужой бинарь, который висит на `status`; abs путь
	// гарантирует ENOENT, если тест не подложил свой шим.
	return { ...env, ORCA_CLI_COMMAND: "/nonexistent-orca", ...extra };
}

function makeRepo() {
	const dir = tempDir("omp-doctor-repo-");
	execFileSync("git", ["init", "-q", "-b", "main", dir]);
	execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
	execFileSync("git", ["-C", dir, "config", "user.name", "Test"]);
	writeFileSync(join(dir, "README.md"), "base\n");
	execFileSync("git", ["-C", dir, "add", "."]);
	execFileSync("git", ["-C", dir, "commit", "-qm", "base"]);
	return dir;
}

function fixture(options = {}) {
	const dir = makeRepo();
	if (options.plan !== null) writeFileSync(join(dir, "AUTOPLAN.md"), options.plan ?? PLAN);
	if (options.handoff !== null) {
		writeFileSync(join(dir, "HANDOFF.md"), options.handoff ?? "# Handoff\nstate\n");
	}
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: options.packageName ?? "omp-agent-workflow",
			version: options.version ?? "0.5.20",
		}),
	);
	if (options.state === "broken") writeFileSync(join(dir, STATE_FILE), "{not json");
	if (options.state === "active") {
		const plan = readPlan(join(dir, "AUTOPLAN.md"));
		const state = createInitialState({
			planPath: plan.path,
			planHash: plan.hash,
			mode: "assisted",
			sessionFile: null,
			now: new Date("2026-11-26T00:00:00Z"),
		});
		writeState(join(dir, STATE_FILE), state);
	}
	return dir;
}

function runDoctor(dir, shim, extra = {}) {
	return doctor({
		dir,
		env: shimEnv(shim, extra.env),
		strict: extra.strict,
	});
}

function levels(result) {
	return result.checks.map((check) => `${check.id}:${check.level}`);
}

function assertNoPaths(result, dir) {
	for (const check of result.checks) {
		assert.equal(check.detail.includes(dir), false, check.detail);
		assert.equal(check.detail.includes(homedir()), false, check.detail);
	}
}

describe("doctor", () => {
	it("reports 16 checks in a fixed order without Orca and without fail", () => {
		const dir = fixture();
		const shim = makeShims();
		const result = runDoctor(dir, shim);

		assert.equal(result.schemaVersion, DOCTOR_SCHEMA_VERSION);
		assert.deepEqual(
			result.checks.map((check) => check.id),
			CHECK_IDS,
		);
		assert.deepEqual(levels(result), [
			"node.version:pass",
			"omp.version:pass",
			"plugin.linked:pass",
			"plugin.version:pass",
			"plugin.settings:pass",
			"git.repo:pass",
			"git.head:pass",
			"handoff.state:pass",
			"autoplan:pass",
			"state:skip",
			"worktree.root:pass",
			"orca.cli:warn",
			"supervisor.lock:skip",
			"terminal.handle:skip",
			"cache.monitor:pass",
			"ensemble.active:skip",
		]);
		assert.deepEqual(result.summary, {
			pass: 11,
			warn: 1,
			skip: 4,
			fail: 0,
			total: 16,
		});
		assert.equal(result.ok, true);
		assert.equal(result.strict, false);
		assertNoPaths(result, dir);
	});

	it("keeps exit-0 semantics for warn without --strict and fails with it", () => {
		const dir = fixture();
		const shim = makeShims();
		const relaxed = runDoctor(dir, shim);
		assert.equal(relaxed.ok, true);

		const strict = runDoctor(dir, shim, { strict: true });
		assert.equal(strict.ok, false);
		assert.equal(strict.strict, true);
		assert.equal(strict.summary.warn, 0);
		assert.equal(strict.summary.fail, relaxed.summary.warn);
		assert.equal(
			strict.checks.find((check) => check.id === "orca.cli").level,
			"fail",
		);
	});

	it("warns about supervisor and terminal handle in yoda-supervised", () => {
		const dir = fixture();
		const shim = makeShims({
			config: {
				...CONFIG,
				settings: { ...CONFIG.settings, workflowMode: "yoda-supervised" },
			},
		});
		const result = runDoctor(dir, shim);
		assert.equal(result.ok, true);
		assert.equal(result.summary.warn, 3);
		assert.equal(
			result.checks.find((check) => check.id === "supervisor.lock").level,
			"warn",
		);
		assert.equal(
			result.checks.find((check) => check.id === "terminal.handle").level,
			"warn",
		);

		const strict = runDoctor(dir, shim, { strict: true });
		assert.equal(strict.ok, false);
		assert.equal(strict.summary.fail, 3);
	});

	it("fails on invalid settings values", () => {
		const config = {
			...CONFIG,
			settings: { ...CONFIG.settings, contextWarnPercent: 200 },
		};
		const dir = fixture();
		const result = runDoctor(dir, makeShims({ config }));
		const settings = result.checks.find((check) => check.id === "plugin.settings");
		assert.equal(settings.level, "fail");
		assert.match(settings.detail, /contextWarnPercent: above max/);
		assert.equal(result.ok, false);
	});

	it("warns on a linked version that differs from the source", () => {
		const dir = fixture({ version: "0.5.21" });
		const result = runDoctor(dir, makeShims());
		const version = result.checks.find((check) => check.id === "plugin.version");
		assert.equal(version.level, "warn");
		assert.equal(result.ok, true);
	});

	it("fails on a broken plan and redacts the path", () => {
		const dir = fixture({ plan: "# nothing\n```json plan\n{broken}\n```\n" });
		const result = runDoctor(dir, makeShims());
		const plan = result.checks.find((check) => check.id === "autoplan");
		assert.equal(plan.level, "fail");
		assert.equal(result.ok, false);
		assert.equal(
			result.checks.find((check) => check.id === "worktree.root").level,
			"skip",
		);
		assertNoPaths(result, dir);
	});

	it("fails on a corrupt STATE.json and skips a missing one", () => {
		const brokenDir = fixture({ state: "broken" });
		const broken = runDoctor(brokenDir, makeShims());
		assert.equal(
			broken.checks.find((check) => check.id === "state").level,
			"fail",
		);
		assert.equal(broken.ok, false);

		const cleanDir = fixture();
		const clean = runDoctor(cleanDir, makeShims());
		assert.equal(
			clean.checks.find((check) => check.id === "state").level,
			"skip",
		);
	});

	it("skips plan checks when AUTOPLAN.md is absent", () => {
		const dir = fixture({ plan: null });
		const result = runDoctor(dir, makeShims());
		assert.equal(
			result.checks.find((check) => check.id === "autoplan").level,
			"skip",
		);
		assert.equal(
			result.checks.find((check) => check.id === "worktree.root").level,
			"skip",
		);
		assert.equal(result.ok, true);
	});

	it("warns when HANDOFF.md is missing", () => {
		const dir = fixture({ handoff: null });
		const result = runDoctor(dir, makeShims());
		assert.equal(
			result.checks.find((check) => check.id === "handoff.state").level,
			"warn",
		);
	});

	it("skips workflow checks in mode off", () => {
		const dir = fixture({ plan: null });
		const shim = makeShims({
			config: { ...CONFIG, settings: { workflowMode: "off" } },
		});
		const result = runDoctor(dir, shim);
		assert.deepEqual(levels(result).slice(7, 15), [
			"handoff.state:skip",
			"autoplan:skip",
			"state:skip",
			"worktree.root:skip",
			"orca.cli:skip",
			"supervisor.lock:skip",
			"terminal.handle:skip",
			"cache.monitor:pass",
		]);
		assert.equal(result.ok, true);
	});

	it("warns on an active ensemble run and marks two owners", () => {
		const dir = fixture({ state: "active" });
		const shim = makeShims({
			ensemble: { runs: [{ status: "running" }] },
			orca: true,
		});
		const result = runDoctor(dir, shim, {
			env: { ORCA_CLI_COMMAND: "orca" },
		});
		const ensemble = result.checks.find(
			(check) => check.id === "ensemble.active",
		);
		assert.equal(ensemble.level, "warn");
		assert.match(ensemble.detail, /two owners/);
		assert.equal(result.ok, true);

		const strict = runDoctor(dir, shim, { strict: true });
		assert.equal(strict.ok, false);
		assert.equal(
			strict.checks.find((check) => check.id === "ensemble.active").level,
			"fail",
		);
	});

	it("warns when execution is external without an active ensemble run", () => {
		const plan = PLAN.replace(
			'"verify": ["true"]',
			'"verify": ["true"],\n  "execution": "external"',
		);
		assert.notEqual(plan, PLAN);
		const dir = fixture({ plan });
		const result = runDoctor(dir, makeShims());
		const ensemble = result.checks.find(
			(check) => check.id === "ensemble.active",
		);
		assert.equal(ensemble.level, "warn");
		assert.match(ensemble.detail, /execution=external/);
		assert.equal(result.ok, true);
	});

	it("passes execution external with an active ensemble run", () => {
		const plan = PLAN.replace(
			'"verify": ["true"]',
			'"verify": ["true"],\n  "execution": "external"',
		);
		const dir = fixture({ plan });
		const result = runDoctor(
			dir,
			makeShims({ ensemble: { active: true } }),
		);
		const ensemble = result.checks.find(
			(check) => check.id === "ensemble.active",
		);
		assert.equal(ensemble.level, "pass");
		assert.match(ensemble.detail, /external ensemble run active/);
		assert.equal(result.ok, true);
	});

	it("reports a recognized inactive ensemble run as pass", () => {
		const dir = fixture();
		const shim = makeShims({ ensemble: { active: false } });
		const result = runDoctor(dir, shim);
		assert.equal(
			result.checks.find((check) => check.id === "ensemble.active").level,
			"pass",
		);
	});

	it("skips plugin.version for a project that is not the plugin source", () => {
		const dir = fixture({ packageName: "some-app" });
		const result = runDoctor(dir, makeShims());
		assert.equal(
			result.checks.find((check) => check.id === "plugin.version").level,
			"skip",
		);
	});

	it("reads marketplace summaries as installed plugins", () => {
		const plugins = {
			marketplace: [
				{
					id: "omp-agent-workflow",
					entries: [{ version: "0.5.20", enabled: true }],
				},
			],
			npm: [
				{
					name: "omp-cache-monitor",
					version: "0.10.1",
					enabled: true,
				},
			],
		};
		const dir = fixture();
		const result = runDoctor(dir, makeShims({ plugins }));
		assert.equal(
			result.checks.find((check) => check.id === "plugin.linked").level,
			"pass",
		);
		assert.equal(
			result.checks.find((check) => check.id === "plugin.version").level,
			"pass",
		);
		assert.equal(
			result.checks.find((check) => check.id === "cache.monitor").level,
			"pass",
		);
	});

	it("expands ~ in worktreeRoot and tests its real parent", () => {
		if (typeof process.getuid === "function" && process.getuid() === 0) {
			return;
		}
		const home = tempDir("omp-doctor-home-");
		chmodSync(home, 0o555);
		const plan = PLAN.replace(
			'"worktreeRoot": "worktrees"',
			'"worktreeRoot": "~/worktrees"',
		);
		assert.notEqual(plan, PLAN);
		const dir = fixture({ plan });
		const previousHome = process.env.HOME;
		process.env.HOME = home;
		let result;
		try {
			result = runDoctor(dir, makeShims());
		} finally {
			process.env.HOME = previousHome;
		}
		const root = result.checks.find((check) => check.id === "worktree.root");
		assert.equal(root.level, "fail");
		assert.match(root.detail, /parent is not writable/);
	});

	it("redacts a plan path outside --dir", () => {
		const dir = fixture();
		const outside = tempDir("omp-doctor-plan-");
		const result = doctor({
			dir,
			planPath: outside,
			env: shimEnv(makeShims()),
		});
		const plan = result.checks.find((check) => check.id === "autoplan");
		assert.equal(plan.level, "fail");
		assert.equal(plan.detail.includes(outside), false);
		assert.match(plan.detail, /<plan>/);
	});

	it("runs through the CLI with JSON, exit code and status schemaVersion", () => {
		const dir = fixture();
		const shim = makeShims();
		const env = shimEnv(shim);
		const run = (args) =>
			execFileSync(process.execPath, args, {
				cwd: dir,
				env,
				encoding: "utf8",
			});

		const report = JSON.parse(
			run([
				"--experimental-strip-types",
				"--disable-warning=ExperimentalWarning",
				join(ROOT, "bin/omp-orchestrate"),
				"doctor",
				"--json",
				"--dir",
				dir,
			]),
		);
		assert.equal(report.schemaVersion, 1);
		assert.equal(report.ok, true);
		assert.equal(report.checks.length, 16);

		const status = JSON.parse(
			run([
				"--experimental-strip-types",
				"--disable-warning=ExperimentalWarning",
				join(ROOT, "bin/omp-orchestrate"),
				"status",
				"--json",
				"--dir",
				dir,
			]),
		);
		assert.equal(status.schemaVersion, 1);
		assert.equal(status.plan.tasks, 1);

		assert.throws(
			() =>
				execFileSync(
					process.execPath,
					[
						"--experimental-strip-types",
						"--disable-warning=ExperimentalWarning",
						join(ROOT, "bin/omp-orchestrate"),
						"doctor",
						"--strict",
						"--dir",
						dir,
					],
					{ cwd: dir, env, encoding: "utf8" },
				),
			(error) => error.status === 1,
		);
	});
});
