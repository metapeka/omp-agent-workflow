/**
 * Пресеты запуска `routine` / `plan` / `review` / `budget` (F2).
 *
 * Пресет — это набор значений по умолчанию, а не режим: явная настройка
 * Settings, env или флаг пользователя всегда выигрывают. Модель/thinking
 * применяет только launcher при старте процесса; внутри сессии они не
 * меняются. Пороги читает extension через `resolveSettings`.
 */
import type { ModelCatalog } from "./next-session.ts";

export const PRESET_NAMES = ["routine", "plan", "review", "budget"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

/** Launcher-only канал: явный `--preset` важнее Settings. */
export const PRESET_OVERRIDE_ENV = "OMP_PRESET_OVERRIDE";

export const FLASH_MODEL = "cline-pass/deepseek-v4.1-flash-1017";
export const PRO_MODEL = "cline-pass/deepseek-v4-pro";

export type PresetThinking = "off" | "auto";

export interface PresetSpec {
	model: string;
	thinking: PresetThinking;
	contextWarnPercent: number;
	contextSuggestPercent: number;
	handoffAtPercent: number;
	autoCompactPercent: number;
	/** null — общий `DEFAULT_CONTINUE_PROMPT`. */
	continuePrompt: string | null;
}

const PLAN_PROMPT =
	"Продолжи план из HANDOFF.md, не расширяя область. Когда план готов к исполнению, " +
	`запиши первой строкой HANDOFF.md advisory: next-session: v=1 ts=<UTC> model=${FLASH_MODEL} mode=routine reason=plan.`;

const REVIEW_PROMPT =
	"Сделай ревью diff из HANDOFF.md: риск-зоны, регрессии и нерасширенная область. " +
	"Не меняй код без явной необходимости.";

export const PRESETS: Record<PresetName, PresetSpec> = {
	routine: {
		model: FLASH_MODEL,
		thinking: "off",
		contextWarnPercent: 35,
		contextSuggestPercent: 50,
		handoffAtPercent: 55,
		autoCompactPercent: 70,
		continuePrompt: null,
	},
	plan: {
		model: PRO_MODEL,
		thinking: "auto",
		contextWarnPercent: 25,
		contextSuggestPercent: 40,
		handoffAtPercent: 70,
		autoCompactPercent: 80,
		continuePrompt: PLAN_PROMPT,
	},
	review: {
		model: FLASH_MODEL,
		thinking: "auto",
		contextWarnPercent: 35,
		contextSuggestPercent: 50,
		handoffAtPercent: 55,
		autoCompactPercent: 70,
		continuePrompt: REVIEW_PROMPT,
	},
	budget: {
		model: FLASH_MODEL,
		thinking: "off",
		contextWarnPercent: 35,
		contextSuggestPercent: 50,
		handoffAtPercent: 50,
		autoCompactPercent: 60,
		continuePrompt: null,
	},
};

export function isPresetName(value: unknown): value is PresetName {
	return (
		typeof value === "string" &&
		(PRESET_NAMES as readonly string[]).includes(value)
	);
}

/**
 * Выбор пресета. Приоритет: launcher `--preset` (env override) → явный
 * Settings → env `OMP_WORKFLOW_PRESET` → нет пресета. Явный `off` в Settings
 * отключает пресет и не проваливается в env.
 */
export function resolvePreset(
	raw: Record<string, unknown>,
	env: Record<string, string | undefined>,
): PresetName | null {
	const override = env[PRESET_OVERRIDE_ENV];
	if (isPresetName(override)) return override;
	const setting = raw.workflowPreset;
	if (setting === "off") return null;
	if (isPresetName(setting)) return setting;
	const fromEnv = env.OMP_WORKFLOW_PRESET;
	return isPresetName(fromEnv) ? fromEnv : null;
}

const hasFlag = (args: readonly string[], name: string): boolean =>
	args.some((arg) => arg === name || arg.startsWith(`${name}=`));

/**
 * `--model`/`--thinking` для `omp`. Явные флаги пользователя выигрывают;
 * непроверенная по каталогу модель не применяется (как у advisory).
 */
export function presetLaunchArgs(
	name: PresetName,
	userArgs: readonly string[],
	catalog: ModelCatalog | null,
): string[] {
	const preset = PRESETS[name];
	const args: string[] = [];
	const known =
		catalog !== null && catalog.selectors.includes(preset.model);
	if (known && !hasFlag(userArgs, "--model")) {
		args.push("--model", preset.model);
	}
	if (!hasFlag(userArgs, "--thinking")) {
		args.push("--thinking", preset.thinking);
	}
	return args;
}
