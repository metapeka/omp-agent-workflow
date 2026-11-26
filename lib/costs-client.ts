/**
 * Клиент `costs --json` из `omp-cache-monitor` (0.11.0, schemaVersion 1).
 *
 * OAW не парсит внутренности соседнего продукта (D11): единственный вход —
 * CLI, один JSON в stdout. Любая проблема (нет команды, timeout, exit ≠ 0,
 * битый JSON, другая схема) — `null`, и preflight работает как раньше.
 *
 * Команда ищется только по `OMP_CACHE_MONITOR_CLI` или в `PATH`: плагин,
 * подключённый через `omp plugin link`, bin в PATH не добавляет, поэтому
 * `npm link` в cache-monitor — явный способ включить интеграцию.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const CLI_NAME = "omp-cache-monitor";
/** Бюджет из запроса API: 2 с, без сети. */
const TIMEOUT_MS = 2_000;
/** Отчёт на 400+ ходов — сотни KiB; дефолтный 1 MiB режется. */
const MAX_BUFFER = 8 << 20;

export interface CostsTurn {
	at: string;
	model: string | null;
	costUsd: number | null;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	hitPercent: number | null;
}

export interface CostsTotals {
	costUsd: number | null;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	reasoningTokens: number;
}

export interface CostsModel {
	model: string | null;
	turns: number;
	costUsd: number | null;
	hitPercent: number | null;
}

export interface CostsReport {
	schemaVersion: 1;
	generatedAt: string;
	session: string;
	totals: CostsTotals;
	turns: CostsTurn[];
	models: CostsModel[];
	notes: string[];
}

export interface BorderMetrics {
	/** Медиана `costUsd` холодных ходов; `null` — цен нет или ходов нет. */
	coldUsd: number | null;
	/** Медиана `costUsd` тёплых ходов; `null` — цен нет или ходов нет. */
	warmUsd: number | null;
	/** Ходы с `cacheRead == 0` после первого; первый ход холоден по природе. */
	coldTurns: number;
	warmTurns: number;
}

export interface CostsSummary {
	report: CostsReport;
	border: BorderMetrics;
}

function recordOf(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tokens(value: unknown): number {
	const parsed = numberOrNull(value);
	return parsed !== null && parsed >= 0 ? parsed : 0;
}

function turnOf(value: unknown): CostsTurn | null {
	const turn = recordOf(value);
	if (!turn) return null;
	const at = turn["at"];
	const model = turn["model"];
	if (typeof at !== "string") return null;
	const hit = numberOrNull(turn["hitPercent"]);
	return {
		at,
		model: typeof model === "string" ? model : null,
		costUsd: numberOrNull(turn["costUsd"]),
		inputTokens: tokens(turn["inputTokens"]),
		cacheReadTokens: tokens(turn["cacheReadTokens"]),
		cacheWriteTokens: tokens(turn["cacheWriteTokens"]),
		outputTokens: tokens(turn["outputTokens"]),
		reasoningTokens: tokens(turn["reasoningTokens"]),
		hitPercent: hit !== null && hit >= 0 && hit <= 100 ? hit : null,
	};
}

function modelOf(value: unknown): CostsModel | null {
	const model = recordOf(value);
	if (!model) return null;
	const name = model["model"];
	const turns = numberOrNull(model["turns"]);
	if (turns === null || turns < 0) return null;
	const hit = numberOrNull(model["hitPercent"]);
	return {
		model: typeof name === "string" ? name : null,
		turns,
		costUsd: numberOrNull(model["costUsd"]),
		hitPercent: hit !== null && hit >= 0 && hit <= 100 ? hit : null,
	};
}

function totalsOf(value: unknown): CostsTotals | null {
	const totals = recordOf(value);
	if (!totals) return null;
	return {
		costUsd: numberOrNull(totals["costUsd"]),
		inputTokens: tokens(totals["inputTokens"]),
		cacheReadTokens: tokens(totals["cacheReadTokens"]),
		cacheWriteTokens: tokens(totals["cacheWriteTokens"]),
		outputTokens: tokens(totals["outputTokens"]),
		reasoningTokens: tokens(totals["reasoningTokens"]),
	};
}

/**
 * Строгий разбор конверта: чужая схема, отсутствующие массивы или битый ход
 * делают отчёт невалидным целиком — preflight ничего не показывает.
 */
function reportOf(value: unknown): CostsReport | null {
	const report = recordOf(value);
	if (!report) return null;
	if (report["schemaVersion"] !== 1) return null;
	const generatedAt = report["generatedAt"];
	const session = report["session"];
	const totals = totalsOf(report["totals"]);
	if (typeof generatedAt !== "string" || typeof session !== "string" || !totals) {
		return null;
	}
	const rawTurns = report["turns"];
	const rawModels = report["models"];
	const rawNotes = report["notes"];
	if (!Array.isArray(rawTurns) || !Array.isArray(rawModels) || !Array.isArray(rawNotes)) {
		return null;
	}
	const turns: CostsTurn[] = [];
	for (const raw of rawTurns) {
		const turn = turnOf(raw);
		if (!turn) return null;
		turns.push(turn);
	}
	const models: CostsModel[] = [];
	for (const raw of rawModels) {
		const model = modelOf(raw);
		if (!model) return null;
		models.push(model);
	}
	const notes = rawNotes.filter((note): note is string => typeof note === "string");
	return {
		schemaVersion: 1,
		generatedAt,
		session,
		totals,
		turns,
		models,
		notes,
	};
}

function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Цена границы по ходам отчёта: холодный ход — `cacheRead == 0` после
 * первого (первый холоден по природе и не считается), тёплый — `cacheRead > 0`.
 * Медиана, а не среднее: один дорогой ход не должен определять «цену».
 */
export function borderMetrics(turns: readonly CostsTurn[]): BorderMetrics {
	const cold: number[] = [];
	const warm: number[] = [];
	let coldTurns = 0;
	let warmTurns = 0;
	for (let index = 0; index < turns.length; index += 1) {
		const turn = turns[index];
		if (turn.cacheReadTokens > 0) {
			warmTurns += 1;
			if (turn.costUsd !== null) warm.push(turn.costUsd);
			continue;
		}
		if (index === 0) continue;
		coldTurns += 1;
		if (turn.costUsd !== null) cold.push(turn.costUsd);
	}
	return { coldUsd: median(cold), warmUsd: median(warm), coldTurns, warmTurns };
}

/** Команда CLI: явный env-override, затем `omp-cache-monitor` в PATH. */
export function resolveCostsCommand(
	env: NodeJS.ProcessEnv = process.env,
): { command: string } | null {
	const override = env["OMP_CACHE_MONITOR_CLI"];
	if (typeof override === "string" && override.trim().length > 0) {
		return { command: override };
	}
	const searchPath = env["PATH"] ?? "";
	for (const directory of searchPath.split(delimiter)) {
		if (directory.length === 0) continue;
		const candidate = join(directory, CLI_NAME);
		if (!existsSync(candidate)) continue;
		try {
			accessSync(candidate, constants.X_OK);
			return { command: candidate };
		} catch {
			// не исполняемый — ищем дальше
		}
	}
	return null;
}

/**
 * Отчёт и метрики границы; `null` при любой проблеме CLI. Read-only, без
 * записи файлов; `sessionFile === null` — интеграция выключена.
 */
export function readCostsSummary(
	sessionFile: string | null,
	env: NodeJS.ProcessEnv = process.env,
): CostsSummary | null {
	if (!sessionFile) return null;
	const resolved = resolveCostsCommand(env);
	if (!resolved) return null;
	const result = spawnSync(
		resolved.command,
		["costs", "--json", "--session", sessionFile],
		{ encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, env },
	);
	if (result.error || result.status !== 0) return null;
	const stdout = result.stdout;
	if (typeof stdout !== "string" || stdout.trim().length === 0) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return null;
	}
	const report = reportOf(parsed);
	if (!report) return null;
	return { report, border: borderMetrics(report.turns) };
}
