/**
 * Plugin settings: manifest `omp.settings` + env fallback.
 *
 * Precedence: явная настройка Settings > env > режим/дефолт. Значения из
 * `getPluginSettings` приходят только для явно заданных ключей, поэтому
 * режим (`assisted`/`yoda`) сохраняет свои дефолты, пока ключ не задан.
 */
import {
	PRESETS,
	resolvePreset,
	type PresetName,
} from "./presets.ts";

export type WorkflowMode =
	| "off"
	| "manual"
	| "assisted"
	| "yoda"
	| "yoda-supervised";
export type SupervisorLogLevel = "quiet" | "info" | "debug";
export type WorkflowPreset = "off" | PresetName;

export const DEFAULT_CONTINUE_PROMPT =
	"Прочитай HANDOFF.md и продолжи следующую задачу. Не начинай заново уже сделанное.";

export interface WorkflowSettings {
	workflowMode: WorkflowMode;
	/** `off` — без пресета; иначе набор значений по умолчанию. */
	workflowPreset: WorkflowPreset;
	/** Показывать ключ `workflow` в статус-строке. */
	statusEnabled: boolean;
	/** null — handoff выключен. */
	handoffAtPercent: number | null;
	/** null — handoff по spend выключен. */
	handoffAtSpendUsd: number | null;
	handoffCooldownSeconds: number;
	contextWarnPercent: number;
	contextSuggestPercent: number;
	/** null — авто-компакция выключена. */
	autoCompactPercent: number | null;
	orcaEnabled: boolean;
	orcaPreflight: boolean;
	supervisorEnabled: boolean;
	/** null — использовать env `ORCA_CLI_COMMAND` или `orca` из PATH. */
	orcaCli: string | null;
	continuePrompt: string;
	supervisorRetries: number;
	supervisorLogLevel: SupervisorLogLevel;
}

export type EnvLike = Record<string, string | undefined>;

export const PLUGIN_NAME = "omp-agent-workflow";

const MODES: readonly WorkflowMode[] = [
	"off",
	"manual",
	"assisted",
	"yoda",
	"yoda-supervised",
];

export function defaultAutoPercent(mode: WorkflowMode): number | null {
	if (mode === "off" || mode === "manual") return null;
	return mode === "assisted" ? 60 : 70;
}

export function defaultHandoffPercent(mode: WorkflowMode): number | null {
	return mode === "yoda" || mode === "yoda-supervised" ? 55 : null;
}

const isMode = (value: unknown): value is WorkflowMode =>
	typeof value === "string" && MODES.includes(value as WorkflowMode);

const LOG_LEVELS: readonly SupervisorLogLevel[] = ["quiet", "info", "debug"];
const isLogLevel = (value: unknown): value is SupervisorLogLevel =>
	typeof value === "string" &&
	LOG_LEVELS.includes(value as SupervisorLogLevel);

function boolFromEnv(env: EnvLike, name: string): boolean | undefined {
	const raw = env[name]?.trim().toLowerCase();
	if (raw === "1" || raw === "true" || raw === "on") return true;
	if (raw === "0" || raw === "false" || raw === "off") return false;
	return undefined;
}

function numberIn(
	value: unknown,
	min: number,
	max: number,
): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	if (value < min || value > max) return undefined;
	return value;
}

function envNumber(
	env: EnvLike,
	name: string,
	min: number,
	max: number,
): number | undefined {
	const raw = env[name]?.trim();
	if (!raw) return undefined;
	return numberIn(Number(raw), min, max);
}

/** `off` → null, число в диапазоне → число, иначе undefined. */
function envOffNumber(
	env: EnvLike,
	name: string,
	min: number,
	max: number,
): number | null | undefined {
	const raw = env[name]?.trim();
	if (!raw) return undefined;
	if (raw.toLowerCase() === "off") return null;
	const value = Number(raw);
	if (value === 0) return null;
	return numberIn(value, min, max);
}

/** 0 (или `off` в env) означает «выключено». */
function percentOff(
	rawValue: unknown,
	envValue: number | null | undefined,
	fallback: number | null,
): number | null {
	if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
		if (rawValue === 0) return null;
		const clamped = numberIn(rawValue, 1, 100);
		if (clamped !== undefined) return clamped;
	}
	if (envValue !== undefined) return envValue;
	return fallback;
}

/**
 * 0 (или `off` в env) означает «выключено». Порог в долларах, поэтому
 * диапазон начинается с нуля, а дробные значения (step 0.1) допустимы.
 */
function spendOff(
	rawValue: unknown,
	envValue: number | null | undefined,
	fallback: number | null,
): number | null {
	if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
		if (rawValue === 0) return null;
		const clamped = numberIn(rawValue, 0, 10_000);
		if (clamped !== undefined) return clamped;
	}
	if (envValue !== undefined) return envValue;
	return fallback;
}

/** Свести манифест-настройки, env и режимные дефолты в один объект. */
export function resolveSettings(
	raw: Record<string, unknown> = {},
	env: EnvLike = process.env,
): WorkflowSettings {
	// `off` из env — аварийный выключатель: побеждает даже явные Settings.
	const envMode = isMode(env.OMP_WORKFLOW_MODE)
		? env.OMP_WORKFLOW_MODE
		: undefined;
	const workflowMode: WorkflowMode =
		envMode === "off"
			? "off"
			: ((isMode(raw.workflowMode) ? raw.workflowMode : undefined) ??
				envMode ??
				"assisted");

	const presetName = workflowMode === "off" ? null : resolvePreset(raw, env);
	const preset = presetName === null ? null : PRESETS[presetName];

	const contextWarnPercent =
		numberIn(raw.contextWarnPercent, 1, 99) ??
		envNumber(env, "OMP_CONTEXT_WARN", 1, 99) ??
		preset?.contextWarnPercent ??
		35;
	const contextSuggestPercent =
		numberIn(raw.contextSuggestPercent, 1, 99) ??
		envNumber(env, "OMP_CONTEXT_SUGGEST", 1, 99) ??
		preset?.contextSuggestPercent ??
		50;

	// `off` — kill switch: автоматика выключена независимо от явных порогов.
	const offMode = workflowMode === "off";
	const handoffAtPercent = offMode
		? null
		: percentOff(
				raw.handoffAtPercent,
				envOffNumber(env, "OMP_HANDOFF_AT", 1, 100),
				preset?.handoffAtPercent ?? defaultHandoffPercent(workflowMode),
			);
	const handoffAtSpendUsd = offMode
		? null
		: spendOff(
				raw.handoffAtSpendUsd,
				envOffNumber(env, "OMP_HANDOFF_AT_USD", 0, 10_000),
				null,
			);
	const autoCompactPercent = offMode
		? null
		: percentOff(
				raw.autoCompactPercent,
				envOffNumber(env, "OMP_CONTEXT_AUTO", 1, 100),
				preset?.autoCompactPercent ?? defaultAutoPercent(workflowMode),
			);

	const cooldownRaw = numberIn(raw.handoffCooldownSeconds, 0, 86_400);
	const handoffCooldownSeconds =
		cooldownRaw ?? envNumber(env, "OMP_HANDOFF_COOLDOWN_SECONDS", 0, 86_400) ?? 300;

	const orcaCli =
		typeof raw.orcaCli === "string" && raw.orcaCli.trim().length > 0
			? raw.orcaCli.trim()
			: (env.ORCA_CLI_COMMAND?.trim() || null);

	const continuePrompt =
		typeof raw.continuePrompt === "string" && raw.continuePrompt.trim().length > 0
			? raw.continuePrompt.trim()
			: (env.OMP_HANDOFF_PROMPT?.trim() ||
				preset?.continuePrompt ||
				DEFAULT_CONTINUE_PROMPT);
	const supervisorRetries =
		numberIn(raw.supervisorRetries, 1, 10) ??
		envNumber(env, "OMP_SUPERVISOR_RETRIES", 1, 10) ??
		3;
	const rawLogLevel = raw.supervisorLogLevel;
	const envLogLevel = env.OMP_SUPERVISOR_LOG_LEVEL?.trim();
	const supervisorLogLevel = isLogLevel(rawLogLevel)
		? rawLogLevel
		: isLogLevel(envLogLevel)
			? envLogLevel
			: "info";

	return {
		workflowMode,
		workflowPreset: presetName ?? "off",
		statusEnabled:
			(typeof raw.statusEnabled === "boolean" ? raw.statusEnabled : undefined) ??
			boolFromEnv(env, "OMP_STATUS_ENABLED") ??
			true,
		handoffAtPercent,
		handoffAtSpendUsd,
		handoffCooldownSeconds,
		contextWarnPercent,
		contextSuggestPercent,
		autoCompactPercent,
		orcaEnabled:
			(typeof raw.orcaEnabled === "boolean" ? raw.orcaEnabled : undefined) ??
			boolFromEnv(env, "OMP_ORCA_ENABLED") ??
			true,
		orcaPreflight:
			(typeof raw.orcaPreflight === "boolean" ? raw.orcaPreflight : undefined) ??
			boolFromEnv(env, "OMP_ORCA_PREFLIGHT") ??
			true,
		supervisorEnabled:
			(typeof raw.supervisorEnabled === "boolean"
				? raw.supervisorEnabled
				: undefined) ??
			boolFromEnv(env, "OMP_SUPERVISOR_ENABLED") ??
			true,
		orcaCli,
		continuePrompt,
		supervisorRetries,
		supervisorLogLevel,
	};
}

/**
 * Прочитать явные настройки плагина из OMP. В окружении без OMP-рантайма
 * (unit-тесты, `node`) возвращает `{}` — остаются env и дефолты.
 */
export async function readPluginSettings(
	cwd: string,
): Promise<Record<string, unknown>> {
	try {
		// Static import cannot work: the loader ships with the OMP runtime (Bun)
		// and is absent in Node tests or foreign installs; failure falls back to env.
		const loader = await import(
			"@oh-my-pi/pi-coding-agent/extensibility/plugins/loader"
		);
		return await loader.getPluginSettings(PLUGIN_NAME, cwd);
	} catch {
		return {};
	}
}

export async function loadWorkflowSettings(
	cwd: string,
	env: EnvLike = process.env,
): Promise<WorkflowSettings> {
	return resolveSettings(await readPluginSettings(cwd), env);
}
