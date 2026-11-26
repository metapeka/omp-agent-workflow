/**
 * Пресеты F2: таблица наборов, приоритет Settings > env > preset > режим,
 * launcher-флаги и CLI `bin/omp-preset`.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	FLASH_MODEL,
	PRESETS,
	PRESET_OVERRIDE_ENV,
	PRO_MODEL,
	isPresetName,
	presetLaunchArgs,
	resolvePreset,
} from "../lib/presets.ts";
import { resolveSettings } from "../lib/workflow-settings.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CATALOG = {
	selectors: [FLASH_MODEL, PRO_MODEL],
	thinking: { [FLASH_MODEL]: null, [PRO_MODEL]: ["high", "xhigh"] },
};

let tempDirs = [];
afterEach(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

function tempDir(prefix = "omp-preset-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function ompShim() {
	const dir = tempDir();
	const path = join(dir, "omp");
	writeFileSync(
		path,
		`#!/bin/sh
if [ "$1" = "models" ]; then
  printf '%s' '${JSON.stringify({
		models: [
			{ selector: FLASH_MODEL, thinking: null },
			{ selector: PRO_MODEL, thinking: ["high", "xhigh"] },
		],
	})}'
  exit 0
fi
exit 1
`,
	);
	chmodSync(path, 0o755);
	return path;
}

describe("preset table", () => {
	it("has the approved models, thinking, thresholds and prompts", () => {
		assert.deepEqual(Object.keys(PRESETS), [
			"routine",
			"plan",
			"review",
			"budget",
		]);
		assert.deepEqual(
			[
				PRESETS.routine.model,
				PRESETS.routine.thinking,
				PRESETS.routine.contextWarnPercent,
				PRESETS.routine.contextSuggestPercent,
				PRESETS.routine.handoffAtPercent,
				PRESETS.routine.autoCompactPercent,
				PRESETS.routine.continuePrompt,
			],
			[FLASH_MODEL, "off", 35, 50, 55, 70, null],
		);
		assert.deepEqual(
			[
				PRESETS.plan.model,
				PRESETS.plan.thinking,
				PRESETS.plan.contextWarnPercent,
				PRESETS.plan.contextSuggestPercent,
				PRESETS.plan.handoffAtPercent,
				PRESETS.plan.autoCompactPercent,
			],
			[PRO_MODEL, "auto", 25, 40, 70, 80],
		);
		assert.match(PRESETS.plan.continuePrompt, /next-session:/);
		assert.deepEqual(
			[
				PRESETS.review.model,
				PRESETS.review.thinking,
				PRESETS.review.contextWarnPercent,
				PRESETS.review.contextSuggestPercent,
				PRESETS.review.handoffAtPercent,
				PRESETS.review.autoCompactPercent,
			],
			[FLASH_MODEL, "auto", 35, 50, 55, 70],
		);
		assert.deepEqual(
			[
				PRESETS.budget.model,
				PRESETS.budget.thinking,
				PRESETS.budget.handoffAtPercent,
				PRESETS.budget.autoCompactPercent,
			],
			[FLASH_MODEL, "off", 50, 60],
		);
	});

	it("validates preset names", () => {
		assert.equal(isPresetName("plan"), true);
		assert.equal(isPresetName("off"), false);
		assert.equal(isPresetName("svn"), false);
		assert.equal(isPresetName(undefined), false);
	});
});

describe("settings resolution", () => {
	it("keeps mode defaults without a preset", () => {
		const settings = resolveSettings({}, {});
		assert.equal(settings.workflowPreset, "off");
		assert.equal(settings.contextWarnPercent, 35);
		assert.equal(settings.contextSuggestPercent, 50);
		assert.equal(settings.handoffAtPercent, null);
		assert.equal(settings.autoCompactPercent, 60);
	});

	it("applies preset thresholds and continue prompt", () => {
		const settings = resolveSettings(
			{ workflowMode: "yoda-supervised", workflowPreset: "plan" },
			{},
		);
		assert.equal(settings.workflowPreset, "plan");
		assert.equal(settings.contextWarnPercent, 25);
		assert.equal(settings.contextSuggestPercent, 40);
		assert.equal(settings.handoffAtPercent, 70);
		assert.equal(settings.autoCompactPercent, 80);
		assert.match(settings.continuePrompt, /Продолжи план/);
	});

	it("lets explicit settings and env beat the preset per key", () => {
		const explicit = resolveSettings(
			{
				workflowMode: "yoda-supervised",
				workflowPreset: "plan",
				contextWarnPercent: 18,
				handoffAtPercent: 30,
				autoCompactPercent: 40,
			},
			{},
		);
		assert.equal(explicit.contextWarnPercent, 18);
		assert.equal(explicit.contextSuggestPercent, 40);
		assert.equal(explicit.handoffAtPercent, 30);
		assert.equal(explicit.autoCompactPercent, 40);

		const fromEnv = resolveSettings(
			{},
			{ OMP_WORKFLOW_PRESET: "review", OMP_CONTEXT_WARN: "22" },
		);
		assert.equal(fromEnv.workflowPreset, "review");
		assert.equal(fromEnv.contextWarnPercent, 22);
		assert.equal(fromEnv.contextSuggestPercent, 50);
		assert.equal(fromEnv.handoffAtPercent, 55);
		assert.equal(fromEnv.autoCompactPercent, 70);
	});

	it("honours explicit off and the launcher override", () => {
		const off = resolveSettings(
			{ workflowPreset: "off" },
			{ OMP_WORKFLOW_PRESET: "plan" },
		);
		assert.equal(off.workflowPreset, "off");
		assert.equal(off.handoffAtPercent, null);

		const override = resolveSettings(
			{ workflowMode: "yoda-supervised", workflowPreset: "plan" },
			{ [PRESET_OVERRIDE_ENV]: "budget" },
		);
		assert.equal(override.workflowPreset, "budget");
		assert.equal(override.handoffAtPercent, 50);
		assert.equal(override.autoCompactPercent, 60);
	});

	it("ignores a preset in workflowMode off", () => {
		const settings = resolveSettings(
			{ workflowPreset: "plan" },
			{ OMP_WORKFLOW_MODE: "off" },
		);
		assert.equal(settings.workflowMode, "off");
		assert.equal(settings.workflowPreset, "off");
		assert.equal(settings.handoffAtPercent, null);
		assert.equal(settings.autoCompactPercent, null);
	});

	it("falls back from a missing setting to env, not the reverse", () => {
		assert.equal(
			resolvePreset({ workflowPreset: "bogus" }, { OMP_WORKFLOW_PRESET: "plan" }),
			"plan",
		);
		assert.equal(resolvePreset({}, { OMP_WORKFLOW_PRESET: "bogus" }), null);
	});
});

describe("preset launch flags", () => {
	it("adds the preset model and thinking", () => {
		assert.deepEqual(presetLaunchArgs("plan", [], CATALOG), [
			"--model",
			PRO_MODEL,
			"--thinking",
			"auto",
		]);
		assert.deepEqual(presetLaunchArgs("budget", [], CATALOG), [
			"--model",
			FLASH_MODEL,
			"--thinking",
			"off",
		]);
	});

	it("lets explicit user flags win per key", () => {
		assert.deepEqual(
			presetLaunchArgs("plan", ["--model", "custom/model"], CATALOG),
			["--thinking", "auto"],
		);
		assert.deepEqual(
			presetLaunchArgs("review", ["--thinking=high"], CATALOG),
			["--model", FLASH_MODEL],
		);
		assert.deepEqual(
			presetLaunchArgs("plan", ["--model=custom", "--thinking", "low"], CATALOG),
			[],
		);
	});

	it("does not apply a model missing from the catalog", () => {
		assert.deepEqual(presetLaunchArgs("plan", [], null), [
			"--thinking",
			"auto",
		]);
	});
});

describe("bin/omp-yoda", () => {
	function launcherShim() {
		const dir = tempDir("omp-yoda-shim-");
		symlinkSync(process.execPath, join(dir, "node"));
		writeFileSync(
			join(dir, "omp"),
			`#!/bin/sh
case "$1" in
  plugin)
    printf '{"settings":{"supervisorEnabled":false,"orcaEnabled":false}}'
    exit 0
    ;;
  models)
    printf '%s' '${JSON.stringify({
			models: [
				{ selector: FLASH_MODEL, thinking: null },
				{ selector: PRO_MODEL, thinking: ["high", "xhigh"] },
			],
		})}'
    exit 0
    ;;
esac
printf 'OVERRIDE=%s\\n' "\${OMP_PRESET_OVERRIDE-<unset>}"
printf 'ARGS=%s\\n' "$*"
`,
		);
		chmodSync(join(dir, "omp"), 0o755);
		return dir;
	}

	function runLauncher(shim, args, env = {}) {
		return execFileSync(join(ROOT, "bin/omp-yoda"), args, {
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${shim}:/usr/bin:/bin`,
				OMP_YODA_DIR: "/tmp",
				...env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
	}

	it("does not leak an inherited override and applies only explicit preset", () => {
		const shim = launcherShim();
		const stale = runLauncher(shim, ["--version"], {
			OMP_PRESET_OVERRIDE: "review",
		});
		assert.match(stale, /OVERRIDE=<unset>/);
		assert.match(stale, /ARGS=--version/);
		assert.doesNotMatch(stale, /--model/);

		const explicit = runLauncher(shim, ["--preset", "plan", "--version"]);
		assert.match(explicit, /OVERRIDE=plan/);
		assert.match(explicit, new RegExp(`ARGS=--model ${PRO_MODEL} --thinking auto --version`));
	});

	it("rejects an empty preset value", () => {
		const shim = launcherShim();
		assert.throws(
			() => runLauncher(shim, ["--preset=", "--version"]),
			(error) => error.status === 2 && /--preset требует значение/.test(error.stderr),
		);
		assert.throws(
			() => runLauncher(shim, ["--preset", "", "--version"]),
			(error) => error.status === 2,
		);
	});
});

describe("bin/omp-preset", () => {
	it("prints flags, prompt and fails on an unknown preset", () => {
		const omp = ompShim();
		const cli = join(ROOT, "bin/omp-preset");
		const flags = execFileSync(
			process.execPath,
			[
				"--experimental-strip-types",
				"--disable-warning=ExperimentalWarning",
				cli,
				"--preset",
				"plan",
				"--omp",
				omp,
				"--flags",
				"--",
				"--thinking",
				"high",
			],
			{ encoding: "utf8" },
		);
		assert.deepEqual(flags.trim().split("\n"), ["--model", PRO_MODEL]);

		const prompt = execFileSync(
			process.execPath,
			[
				"--experimental-strip-types",
				"--disable-warning=ExperimentalWarning",
				cli,
				"--preset",
				"plan",
				"--prompt",
			],
			{ encoding: "utf8" },
		);
		assert.match(prompt, /Продолжи план/);

		const bad = spawnSync(
			process.execPath,
			[
				"--experimental-strip-types",
				"--disable-warning=ExperimentalWarning",
				cli,
				"--preset",
				"svn",
				"--prompt",
			],
			{ encoding: "utf8" },
		);
		assert.equal(bad.status, 2);
		assert.match(bad.stderr, /routine\|plan\|review\|budget/);
	});
});
