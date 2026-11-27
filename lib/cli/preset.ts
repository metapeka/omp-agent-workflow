/**
 * Пресет-флаги для `bin/omp-yoda`.
 *
 *   bin/omp-preset --preset plan --omp omp --flags -- omp-args...
 *   bin/omp-preset --preset plan --prompt
 *
 * `--flags` печатает по одному аргументу на строку (`--model`, selector,
 * `--thinking`, level) с учётом явных флагов пользователя после `--`.
 * `--prompt` печатает preset continue prompt (пусто — общий default).
 * Неизвестный пресет — exit 2. Модель применяется только после проверки по
 * `omp models --json`.
 */
import { parseArgs } from "node:util";

import { loadModelCatalog } from "../next-session.ts";
import {
	PRESETS,
	isPresetName,
	presetLaunchArgs,
} from "../presets.ts";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		preset: { type: "string" },
		omp: { type: "string", default: "omp" },
		flags: { type: "boolean", default: false },
		prompt: { type: "boolean", default: false },
	},
});

const preset = values.preset;
if (!isPresetName(preset)) {
	console.error(
		`omp-preset: --preset must be routine|plan|review|budget, got "${preset ?? ""}"`,
	);
	process.exit(2);
}

if (values.prompt) {
	const prompt = PRESETS[preset].continuePrompt;
	if (prompt) console.log(prompt);
} else {
	const catalog = loadModelCatalog(values.omp);
	for (const arg of presetLaunchArgs(preset, positionals, catalog)) {
		console.log(arg);
	}
}
