/**
 * AUTOPLAN.md: парсинг, валидация, hash и выбор следующей задачи.
 *
 * Формат: Markdown + fenced JSON-блоки с info string `json plan` и
 * `json task`. Проза игнорируется, поэтому правка комментариев не меняет
 * hash плана.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type {
	Autoplan,
	BudgetLimits,
	Gate,
	PlanConfig,
	TaskSpec,
} from "./types.ts";

export class PlanError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlanError";
	}
}

const BLOCK_RE = /```json[ \t]+(plan|task)[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const GATES: Record<Gate, true> = {
	publish: true,
	contract: true,
	data: true,
	human: true,
};

const DEFAULT_BUDGETS: BudgetLimits = {
	maxTasksPerSession: 3,
	maxSpendUsd: 5,
	maxMinutes: 120,
};

type JsonRecord = Record<string, unknown>;

function fail(message: string): never {
	throw new PlanError(message);
}

function asRecord(value: unknown, where: string): JsonRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail(`${where}: expected object`);
	}
	return value as JsonRecord;
}

function readString(
	record: JsonRecord,
	key: string,
	where: string,
	fallback?: string,
): string {
	const value = record[key];
	if (value === undefined) {
		if (fallback !== undefined) return fallback;
		fail(`${where}.${key}: required string`);
	}
	if (typeof value !== "string" || value.trim().length === 0) {
		fail(`${where}.${key}: expected non-empty string`);
	}
	return value;
}

function readNullableString(
	record: JsonRecord,
	key: string,
	where: string,
): string | null {
	const value = record[key];
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || value.trim().length === 0) {
		fail(`${where}.${key}: expected non-empty string or null`);
	}
	return value;
}

function readStringArray(
	record: JsonRecord,
	key: string,
	where: string,
	fallback?: string[],
	options: { minItems?: number } = {},
): string[] {
	const value = record[key];
	if (value === undefined) {
		if (fallback !== undefined) return [...fallback];
		fail(`${where}.${key}: required string[]`);
	}
	if (!Array.isArray(value)) fail(`${where}.${key}: expected string[]`);
	const minItems = options.minItems ?? 0;
	if (value.length < minItems) {
		fail(`${where}.${key}: expected at least ${minItems} item(s)`);
	}
	const result: string[] = [];
	for (const [index, item] of value.entries()) {
		if (typeof item !== "string" || item.trim().length === 0) {
			fail(`${where}.${key}[${index}]: expected non-empty string`);
		}
		result.push(item);
	}
	return result;
}

function readBoolean(
	record: JsonRecord,
	key: string,
	where: string,
	fallback: boolean,
): boolean {
	const value = record[key];
	if (value === undefined) return fallback;
	if (typeof value !== "boolean") fail(`${where}.${key}: expected boolean`);
	return value;
}

function readPositiveNumber(
	record: JsonRecord,
	key: string,
	where: string,
	fallback: number,
	options: { integer?: boolean } = {},
): number {
	const value = record[key];
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		fail(`${where}.${key}: expected positive number`);
	}
	if (options.integer && !Number.isInteger(value)) {
		fail(`${where}.${key}: expected integer`);
	}
	return value;
}

function validateBranch(branch: string, where: string, baseBranch: string): void {
	if (!BRANCH_RE.test(branch) || branch.includes("..") || branch.includes("//")) {
		fail(`${where}.branch: unsafe git branch "${branch}"`);
	}
	if (branch.endsWith("/") || branch.endsWith(".lock")) {
		fail(`${where}.branch: unsafe git branch "${branch}"`);
	}
	if (branch === baseBranch || branch === "main" || branch === "master") {
		fail(`${where}.branch: task branch must not be protected "${branch}"`);
	}
}

function parseBudgets(raw: unknown, where: string): BudgetLimits {
	if (raw === undefined) return { ...DEFAULT_BUDGETS };
	const record = asRecord(raw, `${where}.budgets`);
	return {
		maxTasksPerSession: readPositiveNumber(
			record,
			"maxTasksPerSession",
			`${where}.budgets`,
			DEFAULT_BUDGETS.maxTasksPerSession,
			{ integer: true },
		),
		maxSpendUsd: readPositiveNumber(
			record,
			"maxSpendUsd",
			`${where}.budgets`,
			DEFAULT_BUDGETS.maxSpendUsd,
		),
		maxMinutes: readPositiveNumber(
			record,
			"maxMinutes",
			`${where}.budgets`,
			DEFAULT_BUDGETS.maxMinutes,
		),
	};
}

function parsePlanConfig(raw: unknown): PlanConfig {
	const record = asRecord(raw, "plan");
	if (record.version !== 1) fail("plan.version: expected 1");
	const baseBranch = readString(record, "baseBranch", "plan", "main");
	if (
		!BRANCH_RE.test(baseBranch) ||
		baseBranch.includes("..") ||
		baseBranch.includes("//")
	) {
		fail(`plan.baseBranch: unsafe git branch "${baseBranch}"`);
	}
	const backendRaw = record.backend;
	const backend = backendRaw === undefined ? "orca" : backendRaw;
	if (backend !== "orca" && backend !== "git") {
		fail("plan.backend: expected \"orca\" or \"git\"");
	}
	const executionRaw = record.execution;
	if (
		executionRaw !== undefined &&
		executionRaw !== "omp" &&
		executionRaw !== "external"
	) {
		fail("plan.execution: expected \"omp\" or \"external\"");
	}
	return {
		version: 1,
		goal: readString(record, "goal", "plan"),
		baseBranch,
		baseRepo: readNullableString(record, "baseRepo", "plan"),
		worktreeRoot: readString(record, "worktreeRoot", "plan"),
		backend,
		execution: executionRaw as "omp" | "external" | undefined,
		verify: readStringArray(record, "verify", "plan"),
		budgets: parseBudgets(record.budgets, "plan"),
	};
}

function parseGate(record: JsonRecord, where: string): Gate | null {
	const value = record.gate;
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || !Object.hasOwn(GATES, value)) {
		fail(
			`${where}.gate: expected null or one of ${Object.keys(GATES).join(", ")}`,
		);
	}
	return value as Gate;
}

function parseTask(
	raw: unknown,
	index: number,
	config: PlanConfig,
): TaskSpec {
	const where = `task[${index}]`;
	const record = asRecord(raw, where);
	const id = readString(record, "id", where);
	if (!TASK_ID_RE.test(id)) fail(`${where}.id: invalid id "${id}"`);
	const branch = readString(record, "branch", where, `feat/${id}`);
	validateBranch(branch, where, config.baseBranch);
	return {
		id,
		title: readString(record, "title", where),
		deps: readStringArray(record, "deps", where, []),
		branch,
		files: readStringArray(record, "files", where, []),
		acceptance: readStringArray(record, "acceptance", where, undefined, {
			minItems: 1,
		}),
		verify: readStringArray(record, "verify", where, config.verify),
		review: readBoolean(record, "review", where, true),
		gate: parseGate(record, where),
	};
}

function validateDependencies(tasks: readonly TaskSpec[]): void {
	const ids = new Set<string>();
	for (const task of tasks) {
		if (ids.has(task.id)) fail(`duplicate task id "${task.id}"`);
		ids.add(task.id);
	}

	for (const task of tasks) {
		const seen = new Set<string>();
		for (const dep of task.deps) {
			if (dep === task.id) fail(`task "${task.id}": depends on itself`);
			if (seen.has(dep)) fail(`task "${task.id}": duplicate dependency "${dep}"`);
			seen.add(dep);
			if (!ids.has(dep)) fail(`task "${task.id}": unknown dependency "${dep}"`);
		}
	}

	const byId = new Map(tasks.map((task) => [task.id, task]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string, path: string[]): void => {
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			fail(`dependency cycle: ${[...path, id].join(" -> ")}`);
		}
		visiting.add(id);
		const task = byId.get(id);
		if (!task) fail(`unknown task "${id}"`);
		for (const dep of task.deps) visit(dep, [...path, id]);
		visiting.delete(id);
		visited.add(id);
	};
	for (const task of tasks) visit(task.id, []);
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (typeof value === "object" && value !== null) {
		const record = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(record).sort()) {
			sorted[key] = canonical(record[key]);
		}
		return sorted;
	}
	return value;
}

/** Стабильный hash плана: меняется только при изменении JSON-задач. */
export function hashPlan(
	config: PlanConfig,
	tasks: readonly TaskSpec[],
): string {
	const payload = JSON.stringify(canonical({ config, tasks }));
	return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

/** Разобрать и провалидировать AUTOPLAN.md. */
export function parsePlan(text: string, planPath = "AUTOPLAN.md"): Autoplan {
	const planBlocks: string[] = [];
	const taskBlocks: string[] = [];
	BLOCK_RE.lastIndex = 0;
	for (;;) {
		const match = BLOCK_RE.exec(text);
		if (!match) break;
		if (match[1] === "plan") planBlocks.push(match[2]);
		else taskBlocks.push(match[2]);
	}
	if (planBlocks.length === 0) {
		fail(`${planPath}: missing \`json plan\` block`);
	}
	if (planBlocks.length > 1) {
		fail(`${planPath}: expected exactly one \`json plan\` block`);
	}

	const readJson = (raw: string, where: string): unknown => {
		try {
			return JSON.parse(raw);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			fail(`${where}: invalid JSON (${message})`);
		}
	};

	const config = parsePlanConfig(readJson(planBlocks[0], "plan"));
	const tasks = taskBlocks.map((raw, index) =>
		parseTask(readJson(raw, `task[${index}]`), index, config),
	);
	validateDependencies(tasks);
	return {
		path: planPath,
		hash: hashPlan(config, tasks),
		config,
		tasks,
	};
}

/** Прочитать AUTOPLAN.md с диска. */
export function readPlan(planPath = "AUTOPLAN.md"): Autoplan {
	let text: string;
	try {
		text = readFileSync(planPath, "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new PlanError(`${planPath}: cannot read plan (${message})`);
	}
	return parsePlan(text, planPath);
}

export type NextTask =
	| { kind: "task"; task: TaskSpec }
	| { kind: "plan-done"; detail: string }
	| { kind: "no-ready-task"; detail: string };

/** Следующая задача с выполненными зависимостями; порядок — как в плане. */
export function selectNextTask(
	plan: Autoplan,
	completedIds: readonly string[],
): NextTask {
	const completed = new Set(completedIds);
	if (plan.tasks.every((task) => completed.has(task.id))) {
		return { kind: "plan-done", detail: "все задачи плана выполнены" };
	}
	for (const task of plan.tasks) {
		if (completed.has(task.id)) continue;
		if (task.deps.every((dep) => completed.has(dep))) {
			return { kind: "task", task };
		}
	}
	const blocked = plan.tasks
		.filter((task) => !completed.has(task.id))
		.map((task) => {
			const missing = task.deps.filter((dep) => !completed.has(dep));
			return `${task.id} (missing: ${missing.join(", ") || "none"})`;
		});
	return {
		kind: "no-ready-task",
		detail: `нет задачи с готовыми зависимостями: ${blocked.join("; ")}`,
	};
}
