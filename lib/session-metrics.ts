/**
 * Метрики сессии из session JSONL для preflight (F3, `docs/research/
 * workflow-presets.md`).
 *
 * Источник — `message.assistant.usage`: записи `model_usage` в JSONL
 * покрывают только служебные вызовы (`title-fork`,
 * `sharpshooter:extract`), не чат. Тот же источник использует
 * `lib/orchestrator/cost.ts`.
 *
 * Чтение линейное, чанками по 1 MiB, без загрузки файла целиком: сессии
 * бывают по 10–20 MB. Дочерние сессии (subagents) не читаются — метрики
 * относятся к корневому разговору.
 *
 * Денежная оценка границы handoff здесь не считается намеренно:
 * `usage.cost` — фактические списания провайдера/ресселлера, и ставка на
 * одну и ту же модель гуляет примерно вдвое в пределах одной сессии
 * (наблюдение 2026-11-26: flash $0.35–1.02 за 1M output-токенов), а
 * листовые цены `omp models --json` расходятся с ними ≈1.6×. Цена
 * перехода — только из таблицы cache-monitor (`costs --json`), когда она
 * появится. Здесь — измеренные величины: токены, cache hit, spend.
 */
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

export interface SessionMetrics {
	/** Файл существует и прочитан (даже если запросов ещё нет). */
	available: boolean;
	requests: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
	costUsd: number;
	/** Последний ответ модели: reasoning share считается по нему. */
	last: { output: number; reasoning: number } | null;
}

function emptyMetrics(): SessionMetrics {
	return {
		available: false,
		requests: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		reasoning: 0,
		costUsd: 0,
		last: null,
	};
}

const CHUNK = 1 << 20;

/** Строки файла без загрузки целиком; UTF-8 не рвётся на границе чанка. */
function* lines(path: string): Generator<string> {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return;
	}
	const decoder = new StringDecoder("utf8");
	const chunk = Buffer.alloc(CHUNK);
	let carry = "";
	try {
		for (;;) {
			let read: number;
			try {
				read = readSync(fd, chunk, 0, chunk.length, null);
			} catch {
				return;
			}
			if (read <= 0) break;
			const text = carry + decoder.write(chunk.subarray(0, read));
			let start = 0;
			for (;;) {
				const newline = text.indexOf("\n", start);
				if (newline < 0) break;
				yield text.slice(start, newline);
				start = newline + 1;
			}
			carry = text.slice(start);
		}
		const tail = carry + decoder.end();
		if (tail.length > 0) yield tail;
	} finally {
		try {
			closeSync(fd);
		} catch {
			// файл уже закрыт/удалён
		}
	}
}

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: 0;
}

function recordOf(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

/** Usage ассистента из строки JSONL; иначе `null`. */
function usageOfLine(line: string): Record<string, unknown> | null {
	// быстрый фильтр до JSON.parse: большинство строк — toolResult/content
	if (!line.includes('"usage"')) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	const entry = recordOf(parsed);
	if (!entry || entry.type !== "message") return null;
	const message = recordOf(entry.message);
	if (!message || message.role !== "assistant") return null;
	return recordOf(message.usage);
}

/**
 * Суммарные метрики сессии. `sessionFile === null` или файла нет —
 * `available: false`; пустая сессия — `available: true`, `requests: 0`.
 */
export function readSessionMetrics(sessionFile: string | null): SessionMetrics {
	const metrics = emptyMetrics();
	if (!sessionFile || !existsSync(sessionFile)) return metrics;
	metrics.available = true;
	for (const line of lines(sessionFile)) {
		const usage = usageOfLine(line);
		if (!usage) continue;
		const cost = recordOf(usage.cost);
		const output = num(usage.output);
		const reasoning = num(usage.reasoningTokens);
		metrics.requests += 1;
		metrics.input += num(usage.input);
		metrics.output += output;
		metrics.cacheRead += num(usage.cacheRead);
		metrics.cacheWrite += num(usage.cacheWrite);
		metrics.reasoning += reasoning;
		metrics.costUsd += cost ? num(cost.total) : 0;
		metrics.last = { output, reasoning };
	}
	return metrics;
}

/** Доля попаданий в кэш провайдера от всего prompt: 0–100 или `null`. */
export function cacheHitPercent(metrics: SessionMetrics): number | null {
	const prompt = metrics.input + metrics.cacheRead;
	if (prompt <= 0) return null;
	return (metrics.cacheRead / prompt) * 100;
}

/** Share reasoning в output последнего ответа: 0–100 или `null`. */
export function lastReasoningShare(metrics: SessionMetrics): number | null {
	const last = metrics.last;
	if (!last || last.output <= 0) return null;
	if (last.reasoning <= 0) return 0;
	return (last.reasoning / last.output) * 100;
}

/** `950`, `1.2k`, `34k`, `4.2M` — без ложной точности. */
export function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000)
		return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
	if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`;
	if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
	return String(Math.round(tokens));
}

/** `$0`, `$0.0003`, `$0.123`, `$1.23`. */
export function formatUsd(usd: number): string {
	if (!Number.isFinite(usd) || usd <= 0) return "$0";
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	if (usd < 1) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(2)}`;
}
