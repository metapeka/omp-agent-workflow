/** Env-конфиг orchestrator: режим и порог boundary handoff. */
import { isWorkflowMode, type WorkflowMode } from "./types.ts";

export function workflowModeFromEnv(): WorkflowMode {
	const raw = process.env.OMP_WORKFLOW_MODE?.trim();
	return isWorkflowMode(raw) ? raw : "assisted";
}

/** Handoff-порог только для yoda-режимов; `off` и невалидное — null/55. */
export function handoffAtFromEnv(mode: WorkflowMode = workflowModeFromEnv()): number | null {
	if (mode !== "yoda" && mode !== "yoda-supervised") return null;
	const raw = process.env.OMP_HANDOFF_AT?.trim();
	if (!raw) return 55;
	if (raw.toLowerCase() === "off") return null;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 && value <= 100 ? value : 55;
}
