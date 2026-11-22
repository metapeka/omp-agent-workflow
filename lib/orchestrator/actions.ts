/**
 * Действия orchestrator 0.5: start/verify/finish/rebase/stop/resume.
 *
 * Все мутации идут под lock. Worktree создаётся до записи current; merge —
 * только ff-only в чистый base. Команды verify выполняются в worktree.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { readSessionCost } from "./cost.ts";
import { workflowModeFromEnv } from "./config.ts";
import {
	selectNextTask,
	readPlan,
	type NextTask,
} from "./plan.ts";
import { decide, type Decision } from "./policy.ts";
import {
	STATE_FILE,
	acquireLock,
	createInitialState,
	readState,
	writeState,
} from "./state.ts";
import {
	type Autoplan,
	type CheckResult,
	type OrchestratorState,
	type StopState,
	type TaskSpec,
	type WorkflowMode,
} from "./types.ts";
import {
	createWorktree,
	currentBranch,
	headCommit,
	isClean,
	mergeFastForward,
	rebaseOnto,
	removeWorktree,
	resolveBaseRepo,
	resolveWorktreeRoot,
	runCommand,
	worktreePath,
	type WorktreeBackend,
} from "./worktrees.ts";

export const SESSION_INFO_FILE = ".omp-handoff-session.json";

export class ActionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ActionError";
	}
}

export interface ActionContext {
	dir: string;
	planPath?: string;
	mode?: WorkflowMode;
	sessionFile?: string | null;
	handoffAt?: number | null;
	contextPercent?: number | null;
	now?: Date;
	backend?: WorktreeBackend;
	verifyTimeoutMs?: number;
}

interface Paths {
	planPath: string;
	statePath: string;
	label: string;
}

function pathsFor(ctx: ActionContext): Paths {
	const label = ctx.planPath ?? "AUTOPLAN.md";
	return {
		planPath: resolve(ctx.dir, label),
		statePath: join(ctx.dir, STATE_FILE),
		label,
	};
}

function sessionFileFromInfo(dir: string): string | null {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(dir, SESSION_INFO_FILE), "utf8"),
		);
		if (typeof parsed !== "object" || parsed === null) return null;
		const value = (parsed as Record<string, unknown>).sessionFile;
		return typeof value === "string" ? value : null;
	} catch {
		return null;
	}
}

function resolveSessionFile(
	ctx: ActionContext,
	state: OrchestratorState | null,
): string | null {
	if (ctx.sessionFile !== undefined) return ctx.sessionFile;
	if (state?.run?.sessionFile) return state.run.sessionFile;
	return sessionFileFromInfo(ctx.dir);
}

function resolveMode(
	ctx: ActionContext,
	state: OrchestratorState | null,
): WorkflowMode {
	if (ctx.mode) return ctx.mode;
	if (state?.run?.mode) return state.run.mode;
	return workflowModeFromEnv();
}

/** При смене sessionFile счётчик задач сбрасывается; spend/time — нет. */
function syncSession(
	state: OrchestratorState,
	sessionFile: string | null,
	mode: WorkflowMode,
	now: Date,
): void {
	if (!state.run) {
		state.run = {
			id: now.toISOString().replace(/[:.]/g, "-"),
			active: true,
			startedAt: now.toISOString(),
			sessionFile,
			mode,
		};
		return;
	}
	if (sessionFile && state.run.sessionFile && state.run.sessionFile !== sessionFile) {
		state.budgets.tasksThisSession = 0;
	}
	if (sessionFile) state.run.sessionFile = sessionFile;
	state.run.mode = mode;
}

function recordContext(
	state: OrchestratorState,
	ctx: ActionContext,
	now: Date,
): void {
	if (ctx.contextPercent === undefined) return;
	state.context = { percent: ctx.contextPercent, at: now.toISOString() };
}

function applyCost(state: OrchestratorState, sessionFile: string | null): boolean {
	const read = readSessionCost(sessionFile, state.budgets.costOffsets);
	state.budgets.costOffsets = read.offsets;
	state.budgets.spendUsd += read.deltaUsd;
	return read.available;
}

function setStop(
	state: OrchestratorState,
	reason: string,
	detail: string,
	now: Date,
): StopState {
	const stop = { reason, detail, at: now.toISOString() };
	state.stop = stop;
	if (state.run) state.run.active = false;
	return stop;
}

function taskById(plan: Autoplan, id: string): TaskSpec {
	const task = plan.tasks.find((candidate) => candidate.id === id);
	if (!task) throw new ActionError(`unknown task: ${id}`);
	return task;
}

async function runChecks(
	state: OrchestratorState,
	task: TaskSpec,
	ctx: ActionContext,
	now: Date,
): Promise<{ ok: boolean; checks: CheckResult[]; commit: string | null; output: string }> {
	const current = state.current;
	if (!current) throw new ActionError("no current task");
	const checks: CheckResult[] = [];
	let output = "";
	for (const cmd of task.verify) {
		const result = await runCommand("sh", ["-c", cmd], {
			cwd: current.worktree,
			timeoutMs: ctx.verifyTimeoutMs ?? 900_000,
		});
		checks.push({ cmd, code: result.code, at: now.toISOString() });
		output += `$ ${cmd}\n${result.stdout}${result.stderr}\n`;
	}
	let commit: string | null = null;
	try {
		commit = await headCommit(current.worktree);
	} catch {
		commit = null;
	}
	const ok = checks.every((check) => check.code === 0);
	current.checks = checks;
	current.commit = commit;
	current.status = ok ? "verified" : "failed";
	if (!ok) {
		const attempts = (state.attempts[task.id] ?? 0) + 1;
		state.attempts[task.id] = attempts;
		if (attempts >= 2) {
			setStop(
				state,
				"attempts-exceeded",
				`задача ${task.id}: ${attempts} неудачных verify`,
				now,
			);
		}
	}
	return { ok, checks, commit, output: output.slice(-8000) };
}

export function buildImplementerPrompt(task: TaskSpec, worktree: string): string {
	const lines = [
		`Задача ${task.id}: ${task.title}`,
		`Worktree: ${worktree}`,
		`Branch: ${task.branch}`,
		"Работай только в этом worktree. Используй абсолютные пути и bash { cwd }.",
		"Не трогай base-репозиторий, не мержи, не начинай другие задачи.",
		`Acceptance: ${task.acceptance.join(" | ")}`,
	];
	if (task.files.length > 0) lines.push(`Ожидаемые файлы: ${task.files.join(", ")}`);
	if (task.verify.length > 0) lines.push(`Проверки: ${task.verify.join(" && ")}`);
	lines.push(`Спецификация: ${JSON.stringify(task, null, 2)}`);
	lines.push("Сделай коммит в ветку задачи и верни SHA. Не оставляй незакоммиченных файлов.");
	return lines.join("\n");
}

export type StartResult =
	| {
			kind: "started";
			task: TaskSpec;
			worktree: string;
			branch: string;
			prompt: string;
	  }
	| { kind: "stop"; reason: string; detail: string }
	| { kind: "handoff"; reason: "task-boundary"; detail: string };

export async function start(
	ctx: ActionContext,
	id?: string,
): Promise<StartResult> {
	const { planPath, statePath, label } = pathsFor(ctx);
	const plan = readPlan(planPath);
	const now = ctx.now ?? new Date();
	const release = acquireLock(ctx.dir);
	try {
		let state = readState(statePath);
		const sessionFile = resolveSessionFile(ctx, state);
		const mode = resolveMode(ctx, state);
		if (!state) {
			state = createInitialState({
				planPath: label,
				planHash: plan.hash,
				mode,
				sessionFile,
				now,
			});
		} else {
			syncSession(state, sessionFile, mode, now);
		}

		if (state.stop) {
			return { kind: "stop", reason: state.stop.reason, detail: state.stop.detail };
		}
		if (state.plan.hash !== plan.hash) {
			const stop = setStop(
				state,
				"plan-changed",
				`plan hash ${plan.hash} != state ${state.plan.hash}`,
				now,
			);
			writeState(statePath, state);
			return { kind: "stop", reason: stop.reason, detail: stop.detail };
		}

		const baseRepo = await resolveBaseRepo(ctx.dir, plan.config.baseRepo);
		const backend = ctx.backend ?? plan.config.backend;
		if (state.current) {
			if (state.current.status !== "failed") {
				throw new ActionError(
					`current task ${state.current.id} is ${state.current.status}; finish or stop it first`,
				);
			}
			await removeWorktree({
				backend,
				baseRepo,
				path: state.current.worktree,
				branch: state.current.branch,
			});
			state.current = null;
		}

		state.run = state.run ?? {
			id: now.toISOString().replace(/[:.]/g, "-"),
			active: true,
			startedAt: now.toISOString(),
			sessionFile,
			mode,
		};
		state.run.active = true;
		recordContext(state, ctx, now);
		const spendAvailable = applyCost(state, sessionFile);
		const decision = decide({
			state,
			plan,
			mode,
			contextPercent: state.context?.percent ?? null,
			handoffAt: ctx.handoffAt ?? null,
			now,
			atBoundary: true,
			spendAvailable,
		});
		if (decision.kind !== "continue") {
			if (decision.kind === "stop") {
				setStop(state, decision.reason, decision.detail, now);
			}
			writeState(statePath, state);
			return decision;
		}
		if (id && decision.task.id !== id) {
			throw new ActionError(
				`next ready task is ${decision.task.id}, not ${id}`,
			);
		}

		const root = resolveWorktreeRoot(ctx.dir, plan.config.worktreeRoot);
		const expectedPath = worktreePath(root, decision.task.branch);
		const info = await createWorktree({
			backend,
			baseRepo,
			baseBranch: plan.config.baseBranch,
			branch: decision.task.branch,
			path: expectedPath,
		});
		state.current = {
			id: decision.task.id,
			branch: info.branch,
			worktree: info.path,
			status: "running",
			commit: null,
			startedAt: now.toISOString(),
			checks: [],
		};
		writeState(statePath, state);
		return {
			kind: "started",
			task: decision.task,
			worktree: info.path,
			branch: info.branch,
			prompt: buildImplementerPrompt(decision.task, info.path),
		};
	} finally {
		release();
	}
}

export interface VerifyResult {
	kind: "verified" | "verify-failed";
	ok: boolean;
	checks: CheckResult[];
	commit: string | null;
	output: string;
}

export async function verify(
	ctx: ActionContext,
	id?: string,
): Promise<VerifyResult> {
	const { planPath, statePath } = pathsFor(ctx);
	const plan = readPlan(planPath);
	const now = ctx.now ?? new Date();
	const release = acquireLock(ctx.dir);
	try {
		const state = readState(statePath);
		if (!state) throw new ActionError("STATE.json is missing; run start first");
		const sessionFile = resolveSessionFile(ctx, state);
		syncSession(state, sessionFile, resolveMode(ctx, state), now);
		if (state.plan.hash !== plan.hash) {
			const stop = setStop(
				state,
				"plan-changed",
				`plan hash ${plan.hash} != state ${state.plan.hash}`,
				now,
			);
			writeState(statePath, state);
			throw new ActionError(`plan-changed: ${stop.detail}`);
		}
		const current = state.current;
		if (!current) throw new ActionError("no current task");
		if (id && current.id !== id) {
			throw new ActionError(`current task is ${current.id}, not ${id}`);
		}
		const task = taskById(plan, current.id);
		recordContext(state, ctx, now);
		const result = await runChecks(state, task, ctx, now);
		applyCost(state, sessionFile);
		writeState(statePath, state);
		return {
			kind: result.ok ? "verified" : "verify-failed",
			ok: result.ok,
			checks: result.checks,
			commit: result.commit,
			output: result.output,
		};
	} finally {
		release();
	}
}

export interface FinishResult {
	kind: "merged";
	commit: string;
	decision: Decision;
	nextTask: TaskSpec | null;
	warning: string | null;
}

export type FinishOutcome =
	| FinishResult
	| { kind: "rebase-required"; detail: string }
	| { kind: "stop"; reason: string; detail: string }
	| { kind: "handoff"; reason: "task-boundary"; detail: string };

export async function finish(
	ctx: ActionContext,
	id: string,
	commit: string,
	review = "",
): Promise<FinishOutcome> {
	const { planPath, statePath } = pathsFor(ctx);
	const plan = readPlan(planPath);
	const now = ctx.now ?? new Date();
	const release = acquireLock(ctx.dir);
	try {
		const state = readState(statePath);
		if (!state) throw new ActionError("STATE.json is missing");
		const sessionFile = resolveSessionFile(ctx, state);
		const mode = resolveMode(ctx, state);
		syncSession(state, sessionFile, mode, now);
		if (state.plan.hash !== plan.hash) {
			const stop = setStop(
				state,
				"plan-changed",
				`plan hash ${plan.hash} != state ${state.plan.hash}`,
				now,
			);
			writeState(statePath, state);
			return { kind: "stop", reason: stop.reason, detail: stop.detail };
		}
		const current = state.current;
		if (!current) throw new ActionError("no current task");
		if (current.id !== id) {
			throw new ActionError(`current task is ${current.id}, not ${id}`);
		}
		const task = taskById(plan, id);
		if (current.status !== "verified" && current.status !== "reviewed") {
			throw new ActionError(`task ${id} is ${current.status}; verify first`);
		}
		if (task.review && review !== "ok") {
			throw new ActionError(`task ${id} requires reviewer verdict "ok"`);
		}
		if (task.verify.length > 0 && current.checks.length !== task.verify.length) {
			throw new ActionError(`task ${id} verification is incomplete; run verify`);
		}
		if (current.checks.some((check) => check.code !== 0)) {
			throw new ActionError(`task ${id} has failed checks`);
		}
		if (!current.commit || current.commit !== commit) {
			throw new ActionError(
				`commit ${commit} does not match verified ${current.commit ?? "none"}`,
			);
		}
		const liveHead = await headCommit(current.worktree);
		if (liveHead !== commit) {
			throw new ActionError(
				`worktree HEAD ${liveHead} != ${commit}; run verify again`,
			);
		}
		if (!(await isClean(current.worktree))) {
			throw new ActionError(`worktree has uncommitted changes: ${current.worktree}`);
		}
		const baseRepo = await resolveBaseRepo(ctx.dir, plan.config.baseRepo);
		const baseBranch = plan.config.baseBranch;
		const checkedOut = await currentBranch(baseRepo);
		if (checkedOut !== baseBranch) {
			throw new ActionError(
				`base repo must be on ${baseBranch}, not ${checkedOut}`,
			);
		}
		if (!(await isClean(baseRepo))) {
			const stop = setStop(
				state,
				"base-dirty",
				`base repo has uncommitted changes: ${baseRepo}`,
				now,
			);
			writeState(statePath, state);
			return { kind: "stop", reason: stop.reason, detail: stop.detail };
		}

		recordContext(state, ctx, now);
		const spendAvailable = applyCost(state, sessionFile);
		try {
			await mergeFastForward(baseRepo, current.branch);
		} catch {
			const baseHead = await headCommit(baseRepo);
			const ancestor = await runCommand(
				"git",
				["-C", baseRepo, "merge-base", "--is-ancestor", baseHead, commit],
				{ timeoutMs: 60_000 },
			);
			if (ancestor.code === 1) {
				return {
					kind: "rebase-required",
					detail: `${baseBranch} has diverged; run rebase and verify again`,
				};
			}
			const stop = setStop(
				state,
				"merge-conflict",
				`ff-only merge ${current.branch} into ${baseBranch} failed`,
				now,
			);
			writeState(statePath, state);
			return { kind: "stop", reason: stop.reason, detail: stop.detail };
		}

		const merged = current;
		state.completed.push({
			id: merged.id,
			commit,
			mergedAt: now.toISOString(),
			checks: merged.checks.map((check) => ({ ...check })),
		});
		state.current = null;
		state.budgets.tasksThisSession += 1;

		let warning: string | null = null;
		try {
			await removeWorktree({
				backend: ctx.backend ?? plan.config.backend,
				baseRepo,
				path: merged.worktree,
				branch: merged.branch,
			});
		} catch (error) {
			warning = error instanceof Error ? error.message : String(error);
		}

		const decision = decide({
			state,
			plan,
			mode,
			contextPercent: state.context?.percent ?? null,
			handoffAt: ctx.handoffAt ?? null,
			now,
			atBoundary: true,
			spendAvailable,
		});
		if (decision.kind === "stop") {
			setStop(state, decision.reason, decision.detail, now);
		}
		writeState(statePath, state);
		return {
			kind: "merged",
			commit,
			decision,
			nextTask: decision.kind === "continue" ? decision.task : null,
			warning,
		};
	} finally {
		release();
	}
}

export interface RebaseResult {
	kind: "rebased";
	ok: boolean;
	checks: CheckResult[];
	commit: string | null;
	output: string;
}

export type RebaseOutcome =
	| RebaseResult
	| { kind: "stop"; reason: string; detail: string };

export async function rebase(
	ctx: ActionContext,
	id?: string,
): Promise<RebaseOutcome> {
	const { planPath, statePath } = pathsFor(ctx);
	const plan = readPlan(planPath);
	const now = ctx.now ?? new Date();
	const release = acquireLock(ctx.dir);
	try {
		const state = readState(statePath);
		if (!state) throw new ActionError("STATE.json is missing");
		const current = state.current;
		if (!current) throw new ActionError("no current task");
		if (id && current.id !== id) {
			throw new ActionError(`current task is ${current.id}, not ${id}`);
		}
		if (!(await isClean(current.worktree))) {
			throw new ActionError(`worktree has uncommitted changes: ${current.worktree}`);
		}
		const sessionFile = resolveSessionFile(ctx, state);
		syncSession(state, sessionFile, resolveMode(ctx, state), now);
		if (state.plan.hash !== plan.hash) {
			const stop = setStop(
				state,
				"plan-changed",
				`plan hash ${plan.hash} != state ${state.plan.hash}`,
				now,
			);
			writeState(statePath, state);
			return { kind: "stop", reason: stop.reason, detail: stop.detail };
		}
		const task = taskById(plan, current.id);
		try {
			await rebaseOnto(current.worktree, plan.config.baseBranch);
		} catch (error) {
			const stop = setStop(
				state,
				"merge-conflict",
				error instanceof Error ? error.message : String(error),
				now,
			);
			writeState(statePath, state);
			return { kind: "stop", reason: stop.reason, detail: stop.detail };
		}
		const result = await runChecks(state, task, ctx, now);
		applyCost(state, sessionFile);
		writeState(statePath, state);
		return {
			kind: "rebased",
			ok: result.ok,
			checks: result.checks,
			commit: result.commit,
			output: result.output,
		};
	} finally {
		release();
	}
}

export interface StopResult {
	kind: "stopped";
	reason: string;
	detail: string;
}

export function stop(
	ctx: ActionContext,
	reason: string,
	detail?: string,
): StopResult {
	if (!reason.trim()) throw new ActionError("stop reason is required");
	const { statePath } = pathsFor(ctx);
	const now = ctx.now ?? new Date();
	const release = acquireLock(ctx.dir);
	try {
		const state = readState(statePath);
		if (!state) throw new ActionError("STATE.json is missing");
		const stopState = setStop(
			state,
			reason.trim(),
			(detail ?? reason).trim(),
			now,
		);
		writeState(statePath, state);
		return {
			kind: "stopped",
			reason: stopState.reason,
			detail: stopState.detail,
		};
	} finally {
		release();
	}
}

export function resume(ctx: ActionContext): { kind: "resumed" } {
	const { planPath, statePath } = pathsFor(ctx);
	const plan = readPlan(planPath);
	const now = ctx.now ?? new Date();
	const release = acquireLock(ctx.dir);
	try {
		const state = readState(statePath);
		if (!state) throw new ActionError("STATE.json is missing");
		if (state.plan.hash !== plan.hash) {
			setStop(
				state,
				"plan-changed",
				`plan hash ${plan.hash} != state ${state.plan.hash}`,
				now,
			);
			writeState(statePath, state);
			throw new ActionError("plan-changed; update state or revert the plan");
		}
		state.stop = null;
		state.run = state.run ?? {
			id: now.toISOString().replace(/[:.]/g, "-"),
			active: true,
			startedAt: now.toISOString(),
			sessionFile: resolveSessionFile(ctx, state),
			mode: resolveMode(ctx, state),
		};
		state.run.active = true;
		writeState(statePath, state);
		return { kind: "resumed" };
	} finally {
		release();
	}
}

export interface StatusResult {
	plan: {
		path: string;
		hash: string;
		goal: string;
		tasks: number;
		completed: number;
	};
	state: OrchestratorState | null;
	next: TaskSpec | null;
	stop: StopState | null;
}

export function status(ctx: ActionContext): StatusResult {
	const { planPath, statePath } = pathsFor(ctx);
	const plan = readPlan(planPath);
	const state = readState(statePath);
	const next = selectNextTask(
		plan,
		state?.completed.map((task) => task.id) ?? [],
	);
	return {
		plan: {
			path: plan.path,
			hash: plan.hash,
			goal: plan.config.goal,
			tasks: plan.tasks.length,
			completed: state?.completed.length ?? 0,
		},
		state,
		next: next.kind === "task" ? next.task : null,
		stop: state?.stop ?? null,
	};
}

export type NextResult =
	| { kind: "task"; task: TaskSpec }
	| { kind: "stop"; reason: string; detail: string };

/** Read-only: не двигает offsets и не пишет STATE. */
export function next(ctx: ActionContext): NextResult {
	const { planPath, statePath } = pathsFor(ctx);
	const plan = readPlan(planPath);
	const state = readState(statePath);
	const now = ctx.now ?? new Date();
	if (!state) {
		const selected: NextTask = selectNextTask(plan, []);
		if (selected.kind !== "task") {
			return { kind: "stop", reason: selected.kind, detail: selected.detail };
		}
		if (selected.task.gate) {
			return {
				kind: "stop",
				reason: "gate",
				detail: `задача ${selected.task.id}: ${selected.task.gate}`,
			};
		}
		return { kind: "task", task: selected.task };
	}
	const sessionFile = resolveSessionFile(ctx, state);
	const cost = readSessionCost(sessionFile, state.budgets.costOffsets);
	const projected: OrchestratorState = {
		...state,
		budgets: {
			...state.budgets,
			spendUsd: state.budgets.spendUsd + cost.deltaUsd,
		},
	};
	const decision = decide({
		state: projected,
		plan,
		mode: resolveMode(ctx, state),
		contextPercent: ctx.contextPercent ?? state.context?.percent ?? null,
		handoffAt: ctx.handoffAt ?? null,
		now,
		atBoundary: false,
		spendAvailable: cost.available,
	});
	if (decision.kind === "continue") return { kind: "task", task: decision.task };
	if (decision.kind === "stop") {
		return { kind: "stop", reason: decision.reason, detail: decision.detail };
	}
	return { kind: "stop", reason: "handoff", detail: decision.detail };
}
