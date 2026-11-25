/**
 * Advisory `next-session:` в state-файле (`HANDOFF.md`).
 *
 * Строка — первая строка файла, до заголовка H1: её видит и следующий агент,
 * и человек. Формат `v=1 ts=… model=… thinking=… mode=… reason=…`, значения
 * без пробелов, `=` и `#`. Разбор fail-closed: две строки, неверная позиция,
 * повтор ключа, `v≠1` или устаревший `ts` — рекомендации нет целиком.
 *
 * Никакой код не переключает модель по строке: launcher (`bin/omp-yoda`)
 * только добавляет `--model`/`--thinking` при старте процесса, extension
 * показывает строку и её валидность в `/handoff-preflight`. Модель внутри
 * сессии не меняется (ограничение OMP: `/handoff-new` — тот же процесс).
 */
import { spawnSync } from "node:child_process";

export const NEXT_SESSION_PREFIX = "next-session:";
/** Рекомендация старше этого возраста игнорируется: совет не должен переживать правду. */
export const NEXT_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const THINKING_LEVELS = [
	"off",
	"auto",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const SESSION_MODES = ["routine", "plan", "review"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

/** Каталог `omp models --json`: selector → доступные уровни thinking (`null` — нет выбора). */
export interface ModelCatalog {
	selectors: readonly string[];
	thinking: Readonly<Record<string, readonly string[] | null>>;
}

export type NextSessionProblemCode =
	| "duplicate"
	| "position"
	| "syntax"
	| "version"
	| "timestamp"
	| "model"
	| "catalog"
	| "thinking"
	| "mode"
	| "reason";

export interface NextSessionProblem {
	code: NextSessionProblemCode;
	text: string;
}

export interface NextSessionAdvice {
	v: 1;
	ts: string;
	model?: string;
	thinking?: ThinkingLevel;
	mode?: SessionMode;
	reason?: string;
	/** Неизвестные ключи в исходном порядке; при перезаписи строки сохраняются. */
	extra: Record<string, string>;
}

export interface NextSessionParse {
	status: "none" | "ok" | "invalid";
	/** Сырая строка рекомендации, если она есть (для показа; файл не переписывается). */
	line: string | null;
	advice: NextSessionAdvice | null;
	problems: NextSessionProblem[];
}

const TOKEN = /^([A-Za-z][A-Za-z0-9_-]*)=([^\s=#]+)$/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})Z$/;
const REASON = /^[a-z0-9._-]{1,32}$/;

const isThinking = (value: string): value is ThinkingLevel =>
	(THINKING_LEVELS as readonly string[]).includes(value);
const isMode = (value: string): value is SessionMode =>
	(SESSION_MODES as readonly string[]).includes(value);

/** Разбор ответа `omp models --json`; `null` — каталог не распознан. */
export function parseModelCatalog(raw: unknown): ModelCatalog | null {
	if (typeof raw !== "object" || raw === null || !("models" in raw)) return null;
	const models = raw.models;
	if (!Array.isArray(models)) return null;
	const selectors: string[] = [];
	const thinking: Record<string, readonly string[] | null> = {};
	for (const entry of models) {
		if (typeof entry !== "object" || entry === null) continue;
		if (!("selector" in entry)) continue;
		const selector = entry.selector;
		if (typeof selector !== "string" || !selector) continue;
		selectors.push(selector);
		const levels = "thinking" in entry ? entry.thinking : undefined;
		thinking[selector] = Array.isArray(levels)
			? levels.filter((level): level is string => typeof level === "string")
			: null;
	}
	return { selectors, thinking };
}

/**
 * Каталог моделей best-effort: launcher и preflight не должны падать, если
 * `omp` нет в PATH или команда не ответила. Таймаут — как у git в preflight.
 */
export function loadModelCatalog(command = "omp"): ModelCatalog | null {
	const result = spawnSync(command, ["models", "--json"], {
		encoding: "utf8",
		timeout: 10_000,
		env: { ...process.env, LC_ALL: "C", LANG: "C" },
	});
	if (result.error || result.status !== 0) return null;
	const stdout = typeof result.stdout === "string" ? result.stdout : "";
	if (!stdout.trim()) return null;
	try {
		return parseModelCatalog(JSON.parse(stdout));
	} catch {
		return null;
	}
}

function splitLines(text: string): string[] {
	return text
		.replace(/^\uFEFF/, "")
		.split("\n")
		.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function timestampMs(value: string): number | null {
	const match = TIMESTAMP.exec(value);
	if (!match) return null;
	const [, year, month, day, hour, minute] = match;
	const ms = Date.UTC(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
	);
	const date = new Date(ms);
	const valid =
		date.getUTCFullYear() === Number(year) &&
		date.getUTCMonth() === Number(month) - 1 &&
		date.getUTCDate() === Number(day) &&
		date.getUTCHours() === Number(hour) &&
		date.getUTCMinutes() === Number(minute);
	return valid ? ms : null;
}

const invalid = (line: string, code: NextSessionProblemCode, text: string): NextSessionParse => ({
	status: "invalid",
	line,
	advice: null,
	problems: [{ code, text }],
});

/**
 * Разбор state-файла целиком. `catalog` — подсказка для `model`/`thinking`;
 * без каталога `model` сохраняется, но помечается `catalog` и launcher его
 * не применяет (невалидное не применяем).
 */
export function parseNextSession(
	text: string,
	options: { now?: Date; catalog?: ModelCatalog | null } = {},
): NextSessionParse {
	const now = options.now ?? new Date();
	const catalog = options.catalog ?? null;
	const lines = splitLines(text);
	const hits: number[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (lines[index].startsWith(NEXT_SESSION_PREFIX)) hits.push(index);
	}
	if (hits.length === 0) {
		return { status: "none", line: null, advice: null, problems: [] };
	}

	const line = lines[hits[0]];
	if (hits.length > 1) {
		return invalid(
			line,
			"duplicate",
			`next-session: строк ${hits.length} — рекомендации нет, обе остаются текстом`,
		);
	}
	if (hits[0] !== 0) {
		return invalid(
			line,
			"position",
			"next-session: строка должна быть первой строкой state-файла",
		);
	}

	const payload = line.slice(NEXT_SESSION_PREFIX.length).trim();
	if (!payload) return invalid(line, "syntax", "next-session: пустая строка без ключей");

	const known = new Map<string, string>();
	const extra: Record<string, string> = {};
	const seen = new Set<string>();
	for (const token of payload.split(/\s+/)) {
		const match = TOKEN.exec(token);
		if (!match) {
			return invalid(
				line,
				"syntax",
				`next-session: недопустимый токен «${token}» — строка отброшена`,
			);
		}
		const [, key, value] = match;
		if (seen.has(key)) {
			return invalid(line, "syntax", `next-session: ключ ${key} повторяется`);
		}
		seen.add(key);
		if (
			key === "v" ||
			key === "ts" ||
			key === "model" ||
			key === "thinking" ||
			key === "mode" ||
			key === "reason"
		) {
			known.set(key, value);
		} else {
			extra[key] = value;
		}
	}

	const version = known.get("v");
	if (version === undefined) return invalid(line, "version", "next-session: v=1 обязателен");
	if (version !== "1") {
		return invalid(
			line,
			"version",
			`next-session: версия v=${version} не поддерживается — игнор целиком`,
		);
	}

	const ts = known.get("ts");
	if (ts === undefined) return invalid(line, "timestamp", "next-session: ts обязателен");
	const tsMs = timestampMs(ts);
	if (tsMs === null) {
		return invalid(
			line,
			"timestamp",
			`next-session: ts=${ts} не ISO-8601 UTC (YYYY-MM-DDTHH:MMZ)`,
		);
	}
	const age = now.getTime() - tsMs;
	if (age > NEXT_SESSION_MAX_AGE_MS) {
		return invalid(
			line,
			"timestamp",
			`next-session: ts=${ts} старше 24 ч — устаревшая рекомендация игнорируется`,
		);
	}
	if (-age > NEXT_SESSION_MAX_AGE_MS) {
		return invalid(
			line,
			"timestamp",
			`next-session: ts=${ts} больше чем на 24 ч в будущем`,
		);
	}

	const problems: NextSessionProblem[] = [];

	let model = known.get("model");
	if (model !== undefined) {
		if (catalog === null) {
			problems.push({
				code: "catalog",
				text: `next-session: каталог моделей недоступен — model=${model} не проверен`,
			});
		} else if (!catalog.selectors.includes(model)) {
			problems.push({
				code: "model",
				text: `next-session: model=${model} нет в каталоге — model игнорируется`,
			});
			model = undefined;
		}
	}

	const requestedThinking = known.get("thinking");
	let thinking: ThinkingLevel | undefined;
	if (requestedThinking !== undefined) {
		if (isThinking(requestedThinking)) thinking = requestedThinking;
		else {
			problems.push({
				code: "thinking",
				text: `next-session: thinking=${requestedThinking} вне списка уровней — игнорируется`,
			});
		}
	}
	if (thinking !== undefined && model !== undefined && catalog !== null) {
		const levels = catalog.thinking[model] ?? [];
		if (!levels.includes(thinking)) {
			problems.push({
				code: "thinking",
				text: `next-session: thinking=${thinking} вне каталога ${model} — нормализовано в auto`,
			});
			thinking = "auto";
		}
	}

	const requestedMode = known.get("mode");
	let mode: SessionMode | undefined;
	if (requestedMode !== undefined) {
		if (isMode(requestedMode)) mode = requestedMode;
		else {
			problems.push({
				code: "mode",
				text: `next-session: mode=${requestedMode} вне routine|plan|review — игнорируется`,
			});
		}
	}

	const requestedReason = known.get("reason");
	let reason: string | undefined;
	if (requestedReason !== undefined) {
		if (REASON.test(requestedReason)) reason = requestedReason;
		else {
			problems.push({
				code: "reason",
				text: `next-session: reason=${requestedReason} — нужен slug [a-z0-9._-]{1,32}, игнорируется`,
			});
		}
	}

	return {
		status: "ok",
		line,
		advice: { v: 1, ts, model, thinking, mode, reason, extra },
		problems,
	};
}

/** Человеческая сводка для preflight: только заданные ключи. */
export function describeNextSession(advice: NextSessionAdvice): string {
	const parts = [`v=${advice.v}`, `ts=${advice.ts}`];
	if (advice.model !== undefined) parts.push(`model=${advice.model}`);
	if (advice.thinking !== undefined) parts.push(`thinking=${advice.thinking}`);
	if (advice.mode !== undefined) parts.push(`mode=${advice.mode}`);
	if (advice.reason !== undefined) parts.push(`reason=${advice.reason}`);
	return parts.join(" ");
}

function hasFlag(userArgs: readonly string[], name: string): boolean {
	return userArgs.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

/**
 * Флаги для `omp`, которые добавляет launcher. Явные флаги пользователя
 * выигрывают; `model` применяется только после проверки по каталогу.
 */
export function nextSessionArgs(
	parsed: NextSessionParse,
	userArgs: readonly string[],
): string[] {
	if (parsed.status !== "ok" || parsed.advice === null) return [];
	const blocked = new Set(parsed.problems.map((item) => item.code));
	const advice = parsed.advice;
	const args: string[] = [];
	if (
		advice.model !== undefined &&
		!blocked.has("model") &&
		!blocked.has("catalog") &&
		!hasFlag(userArgs, "--model")
	) {
		args.push("--model", advice.model);
	}
	if (advice.thinking !== undefined && !hasFlag(userArgs, "--thinking")) {
		args.push("--thinking", advice.thinking);
	}
	return args;
}
