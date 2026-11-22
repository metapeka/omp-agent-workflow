/**
 * STATE.json: схема v1, атомарная запись и lock одного писателя.
 *
 * Runtime-файл не коммитится. Потеря состояния — ошибка `state-missing`,
 * а не повод переигрывать задачи.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { isWorkflowMode, type OrchestratorState, type WorkflowMode } from "./types.ts";

export const STATE_FILE = "STATE.json";
export const LOCK_DIR = ".omp-orchestrator.lock";
const LOCK_OWNER = "owner.json";
const DEFAULT_STALE_MS = 10 * 60_000;

export class StateError extends Error {
	readonly code: "state-missing" | "state-corrupt";

	constructor(message: string, code: "state-missing" | "state-corrupt") {
		super(message);
		this.name = "StateError";
		this.code = code;
	}
}

export class LockError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LockError";
	}
}

interface LockOwner {
	pid: number;
	token: string;
	at: string;
}

export interface LockOptions {
	now?: () => number;
	staleMs?: number;
	isAlive?: (pid: number) => boolean;
}

function defaultIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "EPERM";
	}
}

function readLockOwner(lockPath: string): LockOwner | null {
	try {
		const raw = readFileSync(join(lockPath, LOCK_OWNER), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return null;
		const record = parsed as Record<string, unknown>;
		if (
			typeof record.pid !== "number" ||
			typeof record.token !== "string" ||
			typeof record.at !== "string"
		) {
			return null;
		}
		return { pid: record.pid, token: record.token, at: record.at };
	} catch {
		return null;
	}
}

/**
 * Взять lock-каталог. Возвращает функцию освобождения; чужие lock-и не
 * удаляются. Stale lock (возраст/мёртвый pid) перехватывается один раз.
 */
export function acquireLock(dir: string, options: LockOptions = {}): () => void {
	const lockPath = join(dir, LOCK_DIR);
	const now = options.now ?? Date.now;
	const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
	const isAlive = options.isAlive ?? defaultIsAlive;
	const token = randomUUID();

	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			mkdirSync(lockPath);
			try {
				writeFileSync(
					join(lockPath, LOCK_OWNER),
					`${JSON.stringify({
						pid: process.pid,
						token,
						at: new Date(now()).toISOString(),
					})}\n`,
					{ encoding: "utf8", mode: 0o600 },
				);
			} catch (error) {
				rmSync(lockPath, { recursive: true, force: true });
				throw error;
			}
			return () => {
				const owner = readLockOwner(lockPath);
				if (owner?.token === token) {
					rmSync(lockPath, { recursive: true, force: true });
				}
			};
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") {
				throw new LockError(
					`cannot acquire ${lockPath}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
			const owner = readLockOwner(lockPath);
			const age = owner ? now() - Date.parse(owner.at) : Number.POSITIVE_INFINITY;
			const stale =
				!owner || !Number.isFinite(age) || age > staleMs || !isAlive(owner.pid);
			if (!stale) {
				throw new LockError(
					`${lockPath} is held by pid ${owner.pid} since ${owner.at}`,
				);
			}
			rmSync(lockPath, { recursive: true, force: true });
		}
	}
	throw new LockError(`${lockPath}: lock is still held after stale recovery`);
}

function expectRecord(value: unknown, where: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new StateError(`${where}: expected object`, "state-corrupt");
	}
	return value as Record<string, unknown>;
}

function expectString(record: Record<string, unknown>, key: string, where: string): string {
	const value = record[key];
	if (typeof value !== "string") {
		throw new StateError(`${where}.${key}: expected string`, "state-corrupt");
	}
	return value;
}

function expectNullableString(
	record: Record<string, unknown>,
	key: string,
	where: string,
): string | null {
	const value = record[key];
	if (value === null) return null;
	return expectString(record, key, where);
}

function expectBoolean(record: Record<string, unknown>, key: string, where: string): boolean {
	const value = record[key];
	if (typeof value !== "boolean") {
		throw new StateError(`${where}.${key}: expected boolean`, "state-corrupt");
	}
	return value;
}

function expectNumber(record: Record<string, unknown>, key: string, where: string): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new StateError(`${where}.${key}: expected finite number`, "state-corrupt");
	}
	return value;
}

function validateState(value: unknown): OrchestratorState {
	const root = expectRecord(value, "state");
	if (root.version !== 1) {
		throw new StateError("state.version: expected 1", "state-corrupt");
	}
	const plan = expectRecord(root.plan, "state.plan");
	expectString(plan, "path", "state.plan");
	expectString(plan, "hash", "state.plan");

	const run = root.run === null ? null : expectRecord(root.run, "state.run");
	if (run) {
		expectString(run, "id", "state.run");
		expectBoolean(run, "active", "state.run");
		expectString(run, "startedAt", "state.run");
		expectNullableString(run, "sessionFile", "state.run");
		if (!isWorkflowMode(run.mode)) {
			throw new StateError("state.run.mode: invalid mode", "state-corrupt");
		}
	}

	const current =
		root.current === null ? null : expectRecord(root.current, "state.current");
	if (current) {
		expectString(current, "id", "state.current");
		expectString(current, "branch", "state.current");
		expectString(current, "worktree", "state.current");
		expectString(current, "status", "state.current");
		expectNullableString(current, "commit", "state.current");
		expectString(current, "startedAt", "state.current");
	}

	if (!Array.isArray(root.completed)) {
		throw new StateError("state.completed: expected array", "state-corrupt");
	}
	for (const [index, item] of root.completed.entries()) {
		const task = expectRecord(item, `state.completed[${index}]`);
		expectString(task, "id", `state.completed[${index}]`);
		expectString(task, "commit", `state.completed[${index}]`);
		expectString(task, "mergedAt", `state.completed[${index}]`);
		if (!Array.isArray(task.checks)) {
			throw new StateError(
				`state.completed[${index}].checks: expected array`,
				"state-corrupt",
			);
		}
	}

	const attempts = expectRecord(root.attempts, "state.attempts");
	for (const [key, value] of Object.entries(attempts)) {
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
			throw new StateError(
				`state.attempts.${key}: expected non-negative number`,
				"state-corrupt",
			);
		}
	}

	const budgets = expectRecord(root.budgets, "state.budgets");
	expectNumber(budgets, "tasksThisSession", "state.budgets");
	expectNumber(budgets, "spendUsd", "state.budgets");
	const offsets = expectRecord(budgets.costOffsets, "state.budgets.costOffsets");
	for (const [key, value] of Object.entries(offsets)) {
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
			throw new StateError(
				`state.budgets.costOffsets.${key}: expected non-negative number`,
				"state-corrupt",
			);
		}
	}

	if (root.context !== null) {
		const context = expectRecord(root.context, "state.context");
		const percent = context.percent;
		if (
			percent !== null &&
			(typeof percent !== "number" || !Number.isFinite(percent))
		) {
			throw new StateError(
				"state.context.percent: expected number or null",
				"state-corrupt",
			);
		}
		expectString(context, "at", "state.context");
	}

	if (root.lastHandoff !== null && root.lastHandoff !== undefined) {
		const handoff = expectRecord(root.lastHandoff, "state.lastHandoff");
		expectString(handoff, "at", "state.lastHandoff");
		expectString(handoff, "reason", "state.lastHandoff");
	}

	if (root.stop !== null && root.stop !== undefined) {
		const stop = expectRecord(root.stop, "state.stop");
		expectString(stop, "reason", "state.stop");
		expectString(stop, "detail", "state.stop");
		expectString(stop, "at", "state.stop");
	}

	return value as OrchestratorState;
}

/** null — файла нет; битый JSON/схема — StateError. */
export function readState(path: string): OrchestratorState | null {
	if (!existsSync(path)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new StateError(`${path}: invalid JSON (${message})`, "state-corrupt");
	}
	return validateState(parsed);
}

/** Атомарная запись: temp в том же каталоге + rename. */
export function writeState(path: string, state: OrchestratorState): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temp, path);
	} catch (error) {
		try {
			unlinkSync(temp);
		} catch {
			// temp уже удалён/не создан
		}
		throw error;
	}
}

export interface CreateStateOptions {
	planPath: string;
	planHash: string;
	mode: WorkflowMode;
	sessionFile: string | null;
	now: Date;
	runId?: string;
}

export function createInitialState(options: CreateStateOptions): OrchestratorState {
	const at = options.now.toISOString();
	return {
		version: 1,
		plan: { path: options.planPath, hash: options.planHash },
		run: {
			id: options.runId ?? at.replace(/[:.]/g, "-"),
			active: true,
			startedAt: at,
			sessionFile: options.sessionFile,
			mode: options.mode,
		},
		current: null,
		completed: [],
		attempts: {},
		budgets: { tasksThisSession: 0, spendUsd: 0, costOffsets: {} },
		context: null,
		lastHandoff: null,
		stop: null,
	};
}

/**
 * Выполнить мутацию под lock и записать state. Если мутация бросила —
 * файл не меняется. Отсутствие state — StateError("state-missing").
 */
export function updateState<T>(
	dir: string,
	mutate: (state: OrchestratorState) => T,
	options: LockOptions = {},
): { state: OrchestratorState; result: T } {
	const path = join(dir, STATE_FILE);
	const release = acquireLock(dir, options);
	try {
		const state = readState(path);
		if (!state) {
			throw new StateError(`${path}: state file is missing`, "state-missing");
		}
		const result = mutate(state);
		writeState(path, state);
		return { state, result };
	} finally {
		release();
	}
}
