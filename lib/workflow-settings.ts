/**
 * Plugin settings: manifest `omp.settings` + env fallback.
 *
 * Precedence: явная настройка Settings > env > режим/дефолт. Значения из
 * `getPluginSettings` приходят только для явно заданных ключей, поэтому
 * режим (`assisted`/`yoda`) сохраняет свои дефолты, пока ключ не задан.
 */
export type WorkflowMode = "manual" | "assisted" | "yoda" | "yoda-supervised";

export interface WorkflowSettings {
	workflowMode: WorkflowMode;
	/** null — handoff выключен. */
	handoffAtPercent: number | null;
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
}

export type EnvLike = Record<string, string | undefined>;

export const PLUGIN_NAME = "omp-agent-workflow";

const MODES: readonly WorkflowMode[] = [
	"manual",
	"assisted",
	"yoda",
	"yoda-supervised",
];

export function defaultAutoPercent(mode: WorkflowMode): number | null {
	if (mode === "manual") return null;
	return mode === "assisted" ? 60 : 70;
}

export function defaultHandoffPercent(mode: WorkflowMode): number | null {
	return mode === "yoda" || mode === "yoda-supervised" ? 55 : null;
}

const isMode = (value: unknown): value is WorkflowMode =>
	typeof value === "string" && MODES.includes(value as WorkflowMode);

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
	return numberIn(Number(raw), min, max);
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

/** Свести манифест-настройки, env и режимные дефолты в один объект. */
export function resolveSettings(
	raw: Record<string, unknown> = {},
	env: EnvLike = process.env,
): WorkflowSettings {
	const workflowMode =
		(isMode(raw.workflowMode) ? raw.workflowMode : undefined) ??
		(isMode(env.OMP_WORKFLOW_MODE) ? env.OMP_WORKFLOW_MODE : undefined) ??
		"assisted";

	const contextWarnPercent =
		numberIn(raw.contextWarnPercent, 1, 99) ??
		envNumber(env, "OMP_CONTEXT_WARN", 1, 99) ??
		35;
	const contextSuggestPercent =
		numberIn(raw.contextSuggestPercent, 1, 99) ??
		envNumber(env, "OMP_CONTEXT_SUGGEST", 1, 99) ??
		50;

	const handoffAtPercent = percentOff(
		raw.handoffAtPercent,
		envOffNumber(env, "OMP_HANDOFF_AT", 1, 100),
		defaultHandoffPercent(workflowMode),
	);
	const autoCompactPercent = percentOff(
		raw.autoCompactPercent,
		envOffNumber(env, "OMP_CONTEXT_AUTO", 1, 100),
		defaultAutoPercent(workflowMode),
	);

	const cooldownRaw = numberIn(raw.handoffCooldownSeconds, 0, 86_400);
	const handoffCooldownSeconds =
		cooldownRaw ?? envNumber(env, "OMP_HANDOFF_COOLDOWN_SECONDS", 0, 86_400) ?? 300;

	const orcaCli =
		typeof raw.orcaCli === "string" && raw.orcaCli.trim().length > 0
			? raw.orcaCli.trim()
			: (env.ORCA_CLI_COMMAND?.trim() || null);

	return {
		workflowMode,
		handoffAtPercent,
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
