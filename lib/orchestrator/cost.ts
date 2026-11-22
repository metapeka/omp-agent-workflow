/**
 * Стоимость run по session JSONL.
 *
 * OMP пишет `message.assistant.usage.cost.total` в JSONL. Дочерние сессии
 * (task/subagents) лежат в каталоге рядом с корневой сессией:
 * `<root-dir>/<root-stem>/**.jsonl`.
 *
 * Чтение инкрементальное: state хранит byte offsets. Усечённый файл
 * перечитывается с нуля; неполная последняя строка не двигает offset.
 */
import {
	closeSync,
	existsSync,
	openSync,
	readSync,
	readdirSync,
	statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface CostRead {
	available: boolean;
	deltaUsd: number;
	offsets: Record<string, number>;
	files: string[];
}

function collectJsonl(dir: string, out: string[]): void {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) collectJsonl(path, out);
		else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(path);
	}
}

function sessionFiles(rootFile: string): string[] {
	const files = [rootFile];
	const childDir = join(dirname(rootFile), basename(rootFile, ".jsonl"));
	if (existsSync(childDir)) collectJsonl(childDir, files);
	return files;
}

function costOfLine(line: string): number {
	if (line.trim().length === 0) return 0;
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return 0;
	}
	if (typeof parsed !== "object" || parsed === null) return 0;
	const entry = parsed as Record<string, unknown>;
	if (entry.type !== "message") return 0;
	const message = entry.message;
	if (typeof message !== "object" || message === null) return 0;
	const record = message as Record<string, unknown>;
	if (record.role !== "assistant") return 0;
	const usage = record.usage;
	if (typeof usage !== "object" || usage === null) return 0;
	const cost = (usage as Record<string, unknown>).cost;
	if (typeof cost !== "object" || cost === null) return 0;
	const total = (cost as Record<string, unknown>).total;
	return typeof total === "number" && Number.isFinite(total) && total >= 0
		? total
		: 0;
}

function readFromOffset(path: string, offset: number): {
	deltaUsd: number;
	nextOffset: number;
} {
	let size: number;
	try {
		size = statSync(path).size;
	} catch {
		return { deltaUsd: 0, nextOffset: 0 };
	}
	const start = size < offset ? 0 : offset;
	if (start >= size) return { deltaUsd: 0, nextOffset: start };
	const length = size - start;
	const chunk = Buffer.alloc(length);
	let bytesRead = 0;
	let fd: number | null = null;
	try {
		fd = openSync(path, "r");
		bytesRead = readSync(fd, chunk, 0, length, start);
	} catch {
		return { deltaUsd: 0, nextOffset: start };
	} finally {
		if (fd !== null) {
			try {
				closeSync(fd);
			} catch {
				// файл уже закрыт/удалён
			}
		}
	}
	let consumed = 0;
	let deltaUsd = 0;
	for (;;) {
		const newline = chunk.indexOf(0x0a, consumed);
		if (newline < 0 || newline >= bytesRead) break;
		const line = chunk.subarray(consumed, newline).toString("utf8");
		deltaUsd += costOfLine(line);
		consumed = newline + 1;
	}
	return { deltaUsd, nextOffset: start + consumed };
}

/**
 * Прочитать новый spend. Свежий session file может ещё не существовать:
 * тогда spend = 0 и `available: true`. `available: false` — только когда
 * для этого файла уже были offsets (файл удалён/недоступен) или путь
 * вообще не задан. Политика вернёт `cost-unavailable` только в этом случае.
 */
export function readSessionCost(
	rootFile: string | null,
	previous: Readonly<Record<string, number>>,
): CostRead {
	if (!rootFile) {
		return { available: false, deltaUsd: 0, offsets: { ...previous }, files: [] };
	}
	const root = resolve(rootFile);
	if (!existsSync(root)) {
		const known = previous[root] !== undefined;
		return {
			available: !known,
			deltaUsd: 0,
			offsets: { ...previous },
			files: [],
		};
	}

	const files = sessionFiles(root);
	const offsets: Record<string, number> = {};
	let deltaUsd = 0;
	for (const file of files) {
		const key = resolve(file);
		const read = readFromOffset(key, previous[key] ?? 0);
		offsets[key] = read.nextOffset;
		deltaUsd += read.deltaUsd;
	}
	return { available: true, deltaUsd, offsets, files };
}
