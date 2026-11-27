/**
 * Экономика handoff: read-only отчёт «до/после» по цепочке сессий OMP.
 *
 * Цепочка строится вверх по `parentSession` из метаданных сессии; границей
 * считается только ребёнок с записью `{"type":"custom_message",
 * "customType":"handoff"}` — subagent-дети её не пишут. Ходы и деньги берутся
 * из `omp-cache-monitor costs --json` через `readCostsSummary`: OAW не парсит
 * внутренности соседнего продукта (D11). Нет CLI/битый отчёт — границы
 * пустые и note, но exit 0: отчёт валиден без цен.
 *
 * Модуль ничего не пишет и не ходит в сеть; `now` и `env` — seams для тестов.
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { CostsTurn } from "./costs-client.ts";
import { readCostsSummary, resolveCostsCommand } from "./costs-client.ts";
import { parseSessionInfo, pidAlive } from "./session-info.ts";
import { isCompactionRecord, sessionLines } from "./session-metrics.ts";

/** Лимит цепочки: защита от огромного/циклического генеалогического дерева. */
export const MAX_CHAIN_NODES = 20;
/** Окно по умолчанию и его границы: 1..100 ходов. */
export const DEFAULT_TURNS = 10;
export const MIN_TURNS = 1;
export const MAX_TURNS = 100;

export const SESSION_INFO_FILE = ".omp-handoff-session.json";

export interface EconomicsChainNode {
	session: string;
	startedAt: string | null;
	handoff: boolean;
	parentSession: string | null;
}

export interface EconomicsWindow {
	turns: number;
	costPerTurnUsd: number | null;
	hitPercent: number | null;
}

export interface EconomicsBoundary {
	from: string;
	to: string;
	at: string | null;
	before: EconomicsWindow;
	after: EconomicsWindow;
	boundary: { firstTurnUsd: number | null; recoveryTurns: number };
	delta: {
		costPerTurnUsd: number | null;
		hitPercent: number | null;
	};
}

export interface EconomicsCompaction {
	session: string;
	at: string;
	costUsd: number | null;
}

/** Сдвиг hit rate ниже этого порога считается плоским трендом. */
export const HIT_TREND_FLAT_PP = 0.5;

/** Тренд hit rate по границам: среднее «до» и «после» плюс направление. */
export interface EconomicsHitTrend {
	beforePercent: number | null;
	afterPercent: number | null;
	deltaPp: number | null;
	direction: "up" | "down" | "flat" | null;
}

/** Агрегат по всей цепочке (`--summary`); нет данных — `null`, не ноль. */
export interface EconomicsSummary {
	sessions: number;
	handoffs: number;
	boundaries: number;
	turns: number;
	spendUsd: number | null;
	medianTurnUsd: number | null;
	avgBoundaryUsd: number | null;
	hitTrend: EconomicsHitTrend;
}

export interface EconomicsReport {
	schemaVersion: 1;
	generatedAt: string;
	session: string;
	turnsWindow: number;
	chain: EconomicsChainNode[];
	boundaries: EconomicsBoundary[];
	compactions: EconomicsCompaction[];
	/** Только при `summary: true` во входе: аддитивное поле 0.7.2. */
	summary?: EconomicsSummary;
	notes: string[];
}

/** Стартовая сессия отсутствует/нечитаема: CLI отдаёт exit 1, без JSON. */
export class EconomicsSessionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EconomicsSessionError";
	}
}

export interface EconomicsInput {
	sessionFile: string;
	turns?: number;
	/** Добавить агрегат по цепочке (`--summary`); без флага отчёт прежний. */
	summary?: boolean;
	env?: NodeJS.ProcessEnv;
	now?: () => Date;
}

interface SessionMeta {
	startedAt: string | null;
	parentSession: string | null;
}

interface SessionScan {
	meta: SessionMeta | null;
	handoff: boolean;
	compactions: EconomicsCompaction[];
}

function recordOf(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `usage.cost.total` — единственное место цены вспомогательного вызова. */
function usageCostOf(record: Record<string, unknown>): number | null {
	const usage = recordOf(record["usage"]);
	if (!usage) return null;
	const cost = recordOf(usage["cost"]);
	if (!cost) return null;
	return numberOrNull(cost["total"]);
}

/**
 * Один проход по JSONL: метаданные `type:"session"`, маркер handoff и
 * компакции. Битые строки пропускаются — усечённый хвост не рушит отчёт.
 */
function scanSession(file: string): SessionScan {
	// sessionLines молча возвращает пустое на unreadable-файле; для стартовой
	// сессии это должно быть ошибкой, поэтому явно требуем чтение.
	accessSync(file, constants.R_OK);
	let meta: SessionMeta | null = null;
	let handoff = false;
	const compactions: EconomicsCompaction[] = [];
	for (const line of sessionLines(file)) {
		if (line.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		const record = recordOf(parsed);
		if (!record) continue;
		const type = record["type"];
		if (type === "session" && meta === null) {
			const startedAt = record["timestamp"];
			const parent = record["parentSession"];
			meta = {
				startedAt: typeof startedAt === "string" ? startedAt : null,
				parentSession:
					typeof parent === "string" && parent.length > 0 ? parent : null,
			};
			continue;
		}
		if (type === "custom_message" && record["customType"] === "handoff") {
			handoff = true;
			continue;
		}
		if (!isCompactionRecord(record)) continue;
		const at = record["timestamp"];
		if (typeof at !== "string") continue;
		compactions.push({ session: file, at, costUsd: usageCostOf(record) });
	}
	return { meta, handoff, compactions };
}

/** Медиана; `null` — значений нет. */
function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundMoney(value: number): number {
	return Math.round(value * 1_000_000) / 1_000_000;
}

function roundHit(value: number): number {
	return Math.round(value * 10) / 10;
}

/** Окно ходов: медиана цены хода и hit rate по сумме токенов окна. */
export function windowMetrics(turns: readonly CostsTurn[]): EconomicsWindow {
	const priced: number[] = [];
	let input = 0;
	let cacheRead = 0;
	for (const turn of turns) {
		if (turn.costUsd !== null) priced.push(turn.costUsd);
		input += turn.inputTokens;
		cacheRead += turn.cacheReadTokens;
	}
	const costPerTurnUsd = median(priced);
	const denominator = input + cacheRead;
	return {
		turns: turns.length,
		costPerTurnUsd:
			costPerTurnUsd === null ? null : roundMoney(costPerTurnUsd),
		hitPercent:
			denominator === 0 ? null : roundHit((cacheRead / denominator) * 100),
	};
}

/** Первые ходы ребёнка с `cacheRead == 0` подряд до первого тёплого. */
export function recoveryTurns(turns: readonly CostsTurn[]): number {
	let count = 0;
	for (const turn of turns) {
		if (turn.cacheReadTokens > 0) break;
		count += 1;
	}
	return count;
}

function nonNull(values: readonly (number | null)[]): number[] {
	return values.filter((value): value is number => value !== null);
}

function mean(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Агрегат по цепочке: `spendUsd` — сумма измеренных цен ходов всех сессий,
 * `medianTurnUsd` — медиана цены хода по цепочке, `avgBoundaryUsd` — средняя
 * цена первого хода на границах, `hitTrend` — среднее hit rate окон «до/после».
 * Всё, что не измерено, остаётся `null`: нули не подставляются.
 */
export function summarizeEconomics(
	chain: readonly EconomicsChainNode[],
	boundaries: readonly EconomicsBoundary[],
	sessionTurns: readonly (readonly CostsTurn[])[],
): EconomicsSummary {
	const allTurns = sessionTurns.flat();
	const priced = nonNull(allTurns.map((turn) => turn.costUsd));
	const medianTurn = median(priced);
	const avgBoundary = mean(
		nonNull(boundaries.map((boundary) => boundary.boundary.firstTurnUsd)),
	);
	const before = mean(
		nonNull(boundaries.map((boundary) => boundary.before.hitPercent)),
	);
	const after = mean(
		nonNull(boundaries.map((boundary) => boundary.after.hitPercent)),
	);
	const delta = before === null || after === null ? null : roundHit(after - before);
	return {
		sessions: chain.length,
		handoffs: chain.filter((node) => node.handoff).length,
		boundaries: boundaries.length,
		turns: allTurns.length,
		spendUsd:
			priced.length === 0
				? null
				: roundMoney(priced.reduce((total, value) => total + value, 0)),
		medianTurnUsd: medianTurn === null ? null : roundMoney(medianTurn),
		avgBoundaryUsd:
			avgBoundary === null ? null : roundMoney(avgBoundary),
		hitTrend: {
			beforePercent: before === null ? null : roundHit(before),
			afterPercent: after === null ? null : roundHit(after),
			deltaPp: delta,
			direction:
				delta === null
					? null
					: delta > HIT_TREND_FLAT_PP
						? "up"
						: delta < -HIT_TREND_FLAT_PP
							? "down"
							: "flat",
		},
	};
}

function clampTurns(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DEFAULT_TURNS;
	return Math.min(MAX_TURNS, Math.max(MIN_TURNS, Math.trunc(value)));
}

/**
 * Стартовая сессия без `--session`: самая свежая живая запись
 * `.omp-handoff-session.json` в `dir`. Мёртвые pid не предлагаются.
 */
export function resolveLatestSession(dir: string): string | null {
	const file = resolve(dir, SESSION_INFO_FILE);
	if (!existsSync(file)) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
	const entries = parseSessionInfo(raw).filter(
		(entry) =>
			typeof entry.sessionFile === "string" && pidAlive(entry.pid),
	);
	if (entries.length === 0) return null;
	const stamp = (entry: { updatedAt?: unknown }): number =>
		typeof entry.updatedAt === "string"
			? Date.parse(entry.updatedAt) || 0
			: 0;
	const sorted = [...entries].sort((a, b) => stamp(b) - stamp(a));
	const latest = sorted[0];
	return typeof latest.sessionFile === "string" ? latest.sessionFile : null;
}

/** Upward walk по `parentSession`; oldest → newest, с защитой от циклов. */
function collectChain(
	sessionFile: string,
	notes: string[],
): { chain: EconomicsChainNode[]; scans: Map<string, SessionScan> } {
	const scans = new Map<string, SessionScan>();
	const nodes: EconomicsChainNode[] = [];
	const seen = new Set<string>();
	let current: string | null = resolve(sessionFile);
	while (current !== null) {
		if (seen.has(current)) {
			notes.push(`цикл parentSession: ${basename(current)} повторяется`);
			break;
		}
		seen.add(current);
		if (!existsSync(current)) {
			if (nodes.length === 0) {
				throw new EconomicsSessionError(
					`сессия не найдена: ${current}`,
				);
			}
			notes.push(`родительская сессия отсутствует: ${basename(current)}`);
			break;
		}
		if (nodes.length >= MAX_CHAIN_NODES) {
			notes.push(
				`цепочка обрезана на ${MAX_CHAIN_NODES} узлах: дальше не идём`,
			);
			break;
		}
		let scan: SessionScan;
		try {
			scan = scanSession(current);
		} catch {
			if (nodes.length === 0) {
				throw new EconomicsSessionError(
					`сессия не читается: ${current}`,
				);
			}
			notes.push(`сессия не читается: ${basename(current)}`);
			break;
		}
		scans.set(current, scan);
		if (scan.meta === null) {
			if (nodes.length === 0) {
				throw new EconomicsSessionError(
					`сессия без метаданных: ${current}`,
				);
			}
			notes.push(`метаданные сессии не найдены: ${basename(current)}`);
		}
		nodes.push({
			session: current,
			startedAt: scan.meta?.startedAt ?? null,
			handoff: scan.handoff,
			parentSession: scan.meta?.parentSession ?? null,
		});
		current = scan.meta?.parentSession ?? null;
	}
	return { chain: nodes.reverse(), scans };
}

function costsCommandUsable(env: NodeJS.ProcessEnv): boolean {
	const resolved = resolveCostsCommand(env);
	if (!resolved) return false;
	// Override может быть путём на несуществующий бинарь: spawn упал бы молча.
	if (!resolved.command.includes("/")) return true;
	try {
		accessSync(resolved.command, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function pushNote(notes: string[], note: string): void {
	if (!notes.includes(note)) notes.push(note);
}

/**
 * Отчёт по цепочке. `turns` клампится в 1..100; стартовая сессия обязана
 * читаться, иначе `EconomicsSessionError`.
 */
export function buildEconomicsReport(input: EconomicsInput): EconomicsReport {
	const env = input.env ?? process.env;
	const now = input.now ?? (() => new Date());
	const turnsWindow = clampTurns(input.turns);
	const startFile = resolve(input.sessionFile);
	const notes: string[] = [];
	const { chain, scans } = collectChain(startFile, notes);

	// Компакции — по всем узлам цепочки, в хронологическом порядке.
	const compactions: EconomicsCompaction[] = [];
	for (const node of chain) {
		const scan = scans.get(node.session);
		if (scan) compactions.push(...scan.compactions);
	}
	compactions.sort((a, b) => a.at.localeCompare(b.at));

	const cliMissing = !costsCommandUsable(env);
	const turnsBySession = new Map<string, CostsTurn[] | null>();
	const readTurns = (file: string): CostsTurn[] | null => {
		if (turnsBySession.has(file)) return turnsBySession.get(file) ?? null;
		const summary = readCostsSummary(file, env);
		const turns = summary ? summary.report.turns : null;
		turnsBySession.set(file, turns);
		return turns;
	};

	const boundaries: EconomicsBoundary[] = [];
	// Найденная пара и посчитанная граница — разные вещи: без отчёта costs
	// пара есть, а границы нет, и «границ нет» было бы враньём.
	let handoffPairs = 0;
	if (!cliMissing) {
		for (let index = 1; index < chain.length; index += 1) {
			const parent = chain[index - 1];
			const child = chain[index];
			if (!child.handoff) continue;
			handoffPairs += 1;
			const parentTurns = readTurns(parent.session);
			const childTurns = readTurns(child.session);
			if (!parentTurns || !childTurns) {
				const broken = !parentTurns ? parent : child;
				pushNote(
					notes,
					`costs --json недоступен для ${basename(broken.session)}`,
				);
				continue;
			}
			const beforeTurns = parentTurns.slice(-turnsWindow);
			const afterTurns = childTurns.slice(0, turnsWindow);
			const before = windowMetrics(beforeTurns);
			const after = windowMetrics(afterTurns);
			const firstTurnUsd =
				childTurns.length > 0 ? childTurns[0].costUsd : null;
			boundaries.push({
				from: parent.session,
				to: child.session,
				at: child.startedAt,
				before,
				after,
				boundary: {
					firstTurnUsd:
						firstTurnUsd === null ? null : roundMoney(firstTurnUsd),
					recoveryTurns: recoveryTurns(childTurns ?? []),
				},
				delta: {
					costPerTurnUsd:
						before.costPerTurnUsd === null ||
						after.costPerTurnUsd === null
							? null
							: roundMoney(
									after.costPerTurnUsd - before.costPerTurnUsd,
								),
					hitPercent:
						before.hitPercent === null || after.hitPercent === null
							? null
							: roundHit(after.hitPercent - before.hitPercent),
				},
			});
			if (before.turns > 0 && before.costPerTurnUsd === null) {
				pushNote(
					notes,
					`нет цен ходов в окне: ${basename(parent.session)}`,
				);
			}
			if (after.turns > 0 && after.costPerTurnUsd === null) {
				pushNote(
					notes,
					`нет цен ходов в окне: ${basename(child.session)}`,
				);
			}
		}
	}
	if (cliMissing) {
		notes.push(
			"omp-cache-monitor не найден — границы не считаются (read-only)",
		);
	} else if (boundaries.length === 0 && handoffPairs === 0) {
		notes.push("границ handoff в цепочке нет");
	}
	if (compactions.length === 0) notes.push("компакций не найдено");

	// Агрегат читает ходы всех узлов тем же кэшем: без `--summary` лишних
	// вызовов cache-monitor нет, без CLI — те же nulls, что у границ.
	let summary: EconomicsSummary | undefined;
	if (input.summary === true) {
		const sessionTurns: CostsTurn[][] = [];
		for (const node of chain) {
			const turns = readTurns(node.session);
			if (turns) sessionTurns.push(turns);
		}
		summary = summarizeEconomics(chain, boundaries, sessionTurns);
		if (summary.spendUsd === null) {
			pushNote(notes, "сводка: измеренных цен ходов нет");
		}
	}

	return {
		schemaVersion: 1,
		generatedAt: now().toISOString(),
		session: startFile,
		turnsWindow,
		chain,
		boundaries,
		compactions,
		summary,
		notes,
	};
}

function shortId(file: string): string {
	const name = basename(file).replace(/\.jsonl$/, "");
	const parts = name.split("_");
	return parts.length > 1 ? parts[parts.length - 1].slice(0, 8) : name.slice(0, 8);
}

function formatMoney(value: number | null, digits = 4): string {
	return value === null ? "—" : `$${value.toFixed(digits)}`;
}

function formatHit(value: number | null): string {
	return value === null ? "—" : `${value.toFixed(1)}%`;
}

function signedMoney(value: number | null): string {
	if (value === null) return "—";
	const sign = value > 0 ? "+" : value < 0 ? "-" : "";
	return `${sign}$${Math.abs(value).toFixed(4)}`;
}

function signedPoints(value: number | null): string {
	if (value === null) return "—";
	const sign = value > 0 ? "+" : "";
	return `${sign}${value.toFixed(1)} pp`;
}

function plural(count: number, one: string, few: string, many: string): string {
	const mod10 = count % 10;
	const mod100 = count % 100;
	if (mod10 === 1 && mod100 !== 11) return one;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
	return many;
}

/** Таблица без рамок: ширины по фактическому содержимому, 2 пробела. */
function columnWidths(rows: readonly (readonly string[])[]): number[] {
	const widths: number[] = [];
	for (const row of rows) {
		for (let column = 0; column < row.length; column += 1) {
			widths[column] = Math.max(widths[column] ?? 0, row[column].length);
		}
	}
	return widths;
}

function formatTableRow(
	row: readonly string[],
	widths: readonly number[],
): string {
	return row
		.map((cell, column) =>
			column === row.length - 1 ? cell : cell.padEnd(widths[column]),
		)
		.join("  ")
		.trimEnd();
}

/** Сводка одной таблицей: счётчики цепочки, деньги, тренд hit rate. */
function renderSummary(summary: EconomicsSummary): string[] {
	const headerRow = [
		"SESSIONS",
		"HANDOFFS",
		"BOUNDARIES",
		"TURNS",
		"SPEND",
		"TURN",
		"BORDER",
	];
	const border =
		summary.avgBoundaryUsd === null
			? "—"
			: `${formatMoney(summary.avgBoundaryUsd)}${
					summary.medianTurnUsd !== null && summary.medianTurnUsd > 0
						? ` (×${(
								summary.avgBoundaryUsd / summary.medianTurnUsd
							).toFixed(1)})`
						: ""
				}`;
	const row = [
		String(summary.sessions),
		String(summary.handoffs),
		String(summary.boundaries),
		String(summary.turns),
		formatMoney(summary.spendUsd),
		formatMoney(summary.medianTurnUsd),
		border,
	];
	const widths = columnWidths([headerRow, row]);
	const trend = summary.hitTrend;
	const trendWord =
		trend.direction === "up"
			? "рост"
			: trend.direction === "down"
				? "падение"
				: trend.direction === "flat"
					? "без изменений"
					: "нет данных";
	return [
		"Сводка:",
		formatTableRow(headerRow, widths),
		formatTableRow(row, widths),
		`hit: ${formatHit(trend.beforePercent)} → ${formatHit(trend.afterPercent)} (${signedPoints(trend.deltaPp)}), ${trendWord}`,
	];
}

/** Человекочитаемый отчёт: один блок на границу, компакции — строкой. */
export function renderEconomics(report: EconomicsReport): string {
	const lines: string[] = [];
	const boundaryCount = report.boundaries.length;
	const borderWord = plural(boundaryCount, "граница", "границы", "границ");
	const turnsWord = plural(report.turnsWindow, "ход", "хода", "ходов");
	const header =
		boundaryCount === 0
			? `HANDOFF ECONOMICS · границ нет · окно ${report.turnsWindow} ${turnsWord}`
			: `HANDOFF ECONOMICS · ${boundaryCount} ${borderWord} · окно ${report.turnsWindow} ${turnsWord}`;
	lines.push(header);

	if (report.summary) {
		lines.push("");
		lines.push(...renderSummary(report.summary));
	}

	if (boundaryCount > 0) {
		const headerRow = ["FROM", "TO", "BEFORE", "AFTER", "DELTA"];
		const blocks = report.boundaries.map((boundary) => {
			const costRow = [
				shortId(boundary.from),
				shortId(boundary.to),
				`${formatMoney(boundary.before.costPerTurnUsd)}/ход`,
				`${formatMoney(boundary.after.costPerTurnUsd)}/ход`,
				`${signedMoney(boundary.delta.costPerTurnUsd)}${
					boundary.before.costPerTurnUsd !== null &&
					boundary.before.costPerTurnUsd > 0 &&
					boundary.after.costPerTurnUsd !== null
						? ` (×${(
								boundary.after.costPerTurnUsd /
								boundary.before.costPerTurnUsd
							).toFixed(1)})`
						: ""
				}`,
			];
			const hitRow = [
				"hit",
				"",
				formatHit(boundary.before.hitPercent),
				formatHit(boundary.after.hitPercent),
				signedPoints(boundary.delta.hitPercent),
			];
			return {
				rows: [costRow, hitRow],
				foot: `граница: первый ход ${formatMoney(boundary.boundary.firstTurnUsd)} · холодных подряд ${boundary.boundary.recoveryTurns}`,
			};
		});
		const widths = columnWidths([
			headerRow,
			...blocks.flatMap((block) => block.rows),
		]);
		lines.push("");
		lines.push(formatTableRow(headerRow, widths));
		blocks.forEach((block, index) => {
			if (index > 0) lines.push("");
			for (const row of block.rows) lines.push(formatTableRow(row, widths));
			lines.push(block.foot);
		});
	}

	if (report.compactions.length === 0) {
		lines.push("Компакции: нет записей.");
	} else {
		lines.push("Компакции:");
		for (const compaction of report.compactions) {
			lines.push(
				`  ${shortId(compaction.session)}  ${compaction.at}  ${formatMoney(compaction.costUsd)}`,
			);
		}
	}

	if (report.notes.length > 0) {
		const visible = report.notes.filter((note) => note !== "компакций не найдено");
		if (visible.length > 0) {
			lines.push("Заметки:");
			for (const note of visible) lines.push(`- ${note}`);
		}
	}
	return lines.join("\n");
}
