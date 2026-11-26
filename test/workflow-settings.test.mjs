/**
 * Deterministic tests for plugin settings resolution: no OMP runtime.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	DEFAULT_CONTINUE_PROMPT,
	defaultAutoPercent,
	defaultHandoffPercent,
	resolveSettings,
} from "../lib/workflow-settings.ts";

const EMPTY = {};

describe("workflow settings", () => {
	it("uses assisted defaults with an empty environment", () => {
		const s = resolveSettings(EMPTY, EMPTY);
		assert.equal(s.workflowMode, "assisted");
		assert.equal(s.statusEnabled, true);
		assert.equal(s.contextWarnPercent, 35);
		assert.equal(s.contextSuggestPercent, 50);
		assert.equal(s.autoCompactPercent, 60);
		assert.equal(s.handoffAtPercent, null);
		assert.equal(s.handoffAtSpendUsd, null);
		assert.equal(s.handoffCooldownSeconds, 300);
		assert.equal(s.orcaEnabled, true);
		assert.equal(s.orcaPreflight, true);
		assert.equal(s.supervisorEnabled, true);
		assert.equal(s.orcaCli, null);
		assert.equal(s.continuePrompt, DEFAULT_CONTINUE_PROMPT);
		assert.equal(s.supervisorRetries, 3);
		assert.equal(s.supervisorLogLevel, "info");
	});

	it("keeps per-mode defaults until a setting overrides them", () => {
		assert.equal(defaultAutoPercent("manual"), null);
		assert.equal(defaultHandoffPercent("manual"), null);
		assert.equal(defaultAutoPercent("assisted"), 60);
		assert.equal(defaultHandoffPercent("assisted"), null);
		assert.equal(defaultAutoPercent("yoda"), 70);
		assert.equal(defaultHandoffPercent("yoda"), 55);
		assert.equal(defaultAutoPercent("yoda-supervised"), 70);
		assert.equal(defaultHandoffPercent("yoda-supervised"), 55);

		const yoda = resolveSettings(EMPTY, { OMP_WORKFLOW_MODE: "yoda" });
		assert.equal(yoda.autoCompactPercent, 70);
		assert.equal(yoda.handoffAtPercent, 55);
	});

	it("turns automation off in off mode, overriding explicit thresholds", () => {
		assert.equal(defaultAutoPercent("off"), null);
		assert.equal(defaultHandoffPercent("off"), null);

		const fromEnv = resolveSettings(EMPTY, {
			OMP_WORKFLOW_MODE: "off",
			OMP_HANDOFF_AT: "10",
			OMP_CONTEXT_AUTO: "20",
		});
		assert.equal(fromEnv.workflowMode, "off");
		assert.equal(fromEnv.handoffAtPercent, null);
		assert.equal(fromEnv.autoCompactPercent, null);

		const explicit = resolveSettings(
			{ workflowMode: "off", handoffAtPercent: 40, autoCompactPercent: 50 },
			EMPTY,
		);
		assert.equal(explicit.workflowMode, "off");
		assert.equal(explicit.handoffAtPercent, null);
		assert.equal(explicit.autoCompactPercent, null);

		// Аварийный выключатель: env `off` побеждает явные Settings.
		const pinned = resolveSettings(
			{ workflowMode: "yoda-supervised" },
			{ OMP_WORKFLOW_MODE: "off" },
		);
		assert.equal(pinned.workflowMode, "off");
		assert.equal(pinned.handoffAtPercent, null);
		assert.equal(pinned.autoCompactPercent, null);
	});

	it("resolves the spend threshold: settings > env > preset > mode", () => {
		assert.equal(resolveSettings(EMPTY, EMPTY).handoffAtSpendUsd, null);

		const fromEnv = resolveSettings(EMPTY, { OMP_HANDOFF_AT_USD: "2.5" });
		assert.equal(fromEnv.handoffAtSpendUsd, 2.5);

		const explicit = resolveSettings(
			{ handoffAtSpendUsd: 1.5 },
			{ OMP_HANDOFF_AT_USD: "2.5" },
		);
		assert.equal(explicit.handoffAtSpendUsd, 1.5);

		// Явный 0 в Settings — выключение, даже если env задаёт порог.
		const disabled = resolveSettings(
			{ handoffAtSpendUsd: 0 },
			{ OMP_HANDOFF_AT_USD: "2.5" },
		);
		assert.equal(disabled.handoffAtSpendUsd, null);
		assert.equal(
			resolveSettings(EMPTY, { OMP_HANDOFF_AT_USD: "0" }).handoffAtSpendUsd,
			null,
		);
		assert.equal(
			resolveSettings(EMPTY, { OMP_HANDOFF_AT_USD: "off" }).handoffAtSpendUsd,
			null,
		);

		// off-режим выключает триггер независимо от явных значений.
		const off = resolveSettings(
			{ workflowMode: "off", handoffAtSpendUsd: 1 },
			{ OMP_HANDOFF_AT_USD: "2" },
		);
		assert.equal(off.handoffAtSpendUsd, null);

		// Пресеты поле не задают.
		for (const workflowPreset of ["routine", "plan", "review", "budget"]) {
			assert.equal(
				resolveSettings({ workflowPreset }, EMPTY).handoffAtSpendUsd,
				null,
			);
		}

		// Явное значение в manual действует: это не авто-порог режима.
		assert.equal(
			resolveSettings({ workflowMode: "manual", handoffAtSpendUsd: 4 }, EMPTY)
				.handoffAtSpendUsd,
			4,
		);

		// Дробный минимум принимается, вне диапазона — env fallback, затем null.
		assert.equal(
			resolveSettings({ handoffAtSpendUsd: 0.01 }, EMPTY).handoffAtSpendUsd,
			0.01,
		);
		assert.equal(
			resolveSettings({ handoffAtSpendUsd: -1 }, { OMP_HANDOFF_AT_USD: "3" })
				.handoffAtSpendUsd,
			3,
		);
		assert.equal(
			resolveSettings({ handoffAtSpendUsd: 20_000 }, EMPTY).handoffAtSpendUsd,
			null,
		);
		assert.equal(
			resolveSettings(EMPTY, { OMP_HANDOFF_AT_USD: "oops" }).handoffAtSpendUsd,
			null,
		);
	});

	it("falls back to environment values", () => {
		const s = resolveSettings(EMPTY, {
			OMP_WORKFLOW_MODE: "yoda-supervised",
			OMP_STATUS_ENABLED: "0",
			OMP_CONTEXT_WARN: "30",
			OMP_CONTEXT_SUGGEST: "45",
			OMP_CONTEXT_AUTO: "75",
			OMP_HANDOFF_AT: "65",
			OMP_HANDOFF_COOLDOWN_SECONDS: "60",
			OMP_ORCA_ENABLED: "0",
			OMP_ORCA_PREFLIGHT: "off",
			OMP_SUPERVISOR_ENABLED: "false",
			ORCA_CLI_COMMAND: "/opt/orca/bin/orca",
		});
		assert.equal(s.workflowMode, "yoda-supervised");
		assert.equal(s.statusEnabled, false);
		assert.equal(s.contextWarnPercent, 30);
		assert.equal(s.contextSuggestPercent, 45);
		assert.equal(s.autoCompactPercent, 75);
		assert.equal(s.handoffAtPercent, 65);
		assert.equal(s.handoffCooldownSeconds, 60);
		assert.equal(s.orcaEnabled, false);
		assert.equal(s.orcaPreflight, false);
		assert.equal(s.supervisorEnabled, false);
		assert.equal(s.orcaCli, "/opt/orca/bin/orca");
	});

	it("prefers explicit settings over environment", () => {
		const s = resolveSettings(
			{
				workflowMode: "manual",
				statusEnabled: true,
				contextWarnPercent: 20,
				contextSuggestPercent: 40,
				autoCompactPercent: 0,
				handoffAtPercent: 0,
				handoffCooldownSeconds: 10,
				orcaEnabled: false,
				orcaPreflight: false,
				supervisorEnabled: false,
				orcaCli: "/custom/orca",
			},
			{
				OMP_WORKFLOW_MODE: "yoda",
				OMP_STATUS_ENABLED: "0",
				OMP_CONTEXT_WARN: "30",
				OMP_CONTEXT_SUGGEST: "50",
				OMP_CONTEXT_AUTO: "80",
				OMP_HANDOFF_AT: "70",
				OMP_HANDOFF_COOLDOWN_SECONDS: "300",
				OMP_ORCA_ENABLED: "1",
				ORCA_CLI_COMMAND: "/env/orca",
			},
		);
		assert.equal(s.workflowMode, "manual");
		assert.equal(s.statusEnabled, true);
		assert.equal(s.contextWarnPercent, 20);
		assert.equal(s.contextSuggestPercent, 40);
		assert.equal(s.autoCompactPercent, null);
		assert.equal(s.handoffAtPercent, null);
		assert.equal(s.handoffCooldownSeconds, 10);
		assert.equal(s.orcaEnabled, false);
		assert.equal(s.orcaPreflight, false);
		assert.equal(s.supervisorEnabled, false);
		assert.equal(s.orcaCli, "/custom/orca");
	});

	it("treats off and zero as disabled and ignores invalid values", () => {
		const off = resolveSettings(EMPTY, {
			OMP_WORKFLOW_MODE: "yoda",
			OMP_CONTEXT_AUTO: "off",
			OMP_HANDOFF_AT: "off",
		});
		assert.equal(off.autoCompactPercent, null);
		assert.equal(off.handoffAtPercent, null);

		const zero = resolveSettings(EMPTY, {
			OMP_WORKFLOW_MODE: "yoda",
			OMP_CONTEXT_AUTO: "0",
			OMP_HANDOFF_AT: "0",
		});
		assert.equal(zero.autoCompactPercent, null);
		assert.equal(zero.handoffAtPercent, null);

		const invalid = resolveSettings(
			{
				workflowMode: "bogus",
				contextWarnPercent: 500,
				contextSuggestPercent: "40",
				autoCompactPercent: -1,
			},
			{ OMP_CONTEXT_WARN: "oops", OMP_WORKFLOW_MODE: "yoda" },
		);
		assert.equal(invalid.workflowMode, "yoda");
		assert.equal(invalid.contextWarnPercent, 35);
		assert.equal(invalid.contextSuggestPercent, 50);
		assert.equal(invalid.autoCompactPercent, 70);
	});

	it("resolves supervisor prompt, retries and log level", () => {
		const fromEnv = resolveSettings(EMPTY, {
			OMP_HANDOFF_PROMPT: "from env",
			OMP_SUPERVISOR_RETRIES: "5",
			OMP_SUPERVISOR_LOG_LEVEL: "debug",
		});
		assert.equal(fromEnv.continuePrompt, "from env");
		assert.equal(fromEnv.supervisorRetries, 5);
		assert.equal(fromEnv.supervisorLogLevel, "debug");

		const explicit = resolveSettings(
			{
				continuePrompt: "  from settings  ",
				supervisorRetries: 7,
				supervisorLogLevel: "quiet",
			},
			{
				OMP_HANDOFF_PROMPT: "from env",
				OMP_SUPERVISOR_RETRIES: "5",
				OMP_SUPERVISOR_LOG_LEVEL: "debug",
			},
		);
		assert.equal(explicit.continuePrompt, "from settings");
		assert.equal(explicit.supervisorRetries, 7);
		assert.equal(explicit.supervisorLogLevel, "quiet");

		const invalid = resolveSettings(
			{ supervisorRetries: 99, supervisorLogLevel: "loud" },
			{ OMP_SUPERVISOR_RETRIES: "0", OMP_SUPERVISOR_LOG_LEVEL: "verbose" },
		);
		assert.equal(invalid.supervisorRetries, 3);
		assert.equal(invalid.supervisorLogLevel, "info");
	});

	it("clamps cooldown and rejects negative values", () => {
		assert.equal(
			resolveSettings({ handoffCooldownSeconds: -5 }, EMPTY)
				.handoffCooldownSeconds,
			300,
		);
		assert.equal(
			resolveSettings(EMPTY, { OMP_HANDOFF_COOLDOWN_SECONDS: "-1" })
				.handoffCooldownSeconds,
			300,
		);
		assert.equal(
			resolveSettings({ handoffCooldownSeconds: 0 }, EMPTY)
				.handoffCooldownSeconds,
			0,
		);
	});
});
