/**
 * Wrap wizard: read-only факты, карточки и безопасные операции с worktree.
 *
 * UI-слой (`/wrap`) живёт в orchestrator.ts; здесь нет импортов OMP.
 * Ни одна функция не удаляет и не создаёт worktree без явных предусловий:
 * merged в base, чистый worktree, не текущий и не base repo, без force.
 */
import {
	existsSync,
	readdirSync,
	readlinkSync,
	realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import {
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";

import { readPlan } from "./plan.ts";
import { acquireLock, readState, STATE_FILE } from "./state.ts";
import type { Autoplan, OrchestratorState } from "./types.ts";
import {
	branchExists,
	createWorktree,
	resolveWorktreeRoot,
	runCommand,
	worktreePath,
	type CommandResult,
	type RunOptions,
	type WorktreeBackend,
} from "./worktrees.ts";

export type CommandRunner = (
	command: string,
	args: readonly string[],
	options?: RunOptions,
) => Promise<CommandResult>;

export interface WorktreeRecord {
	path: string;
	head: string | null;
	branch: string | null;
	detached: boolean;
	bare: boolean;
	locked: boolean;
	prunable: boolean;
	merged: boolean;
	dirty: boolean;
	liveProcesses: number;
}

export interface HandoffFacts {
	path: string;
	exists: boolean;
	dirty: boolean;
	lastCommitAt: string | null;
	stale: boolean;
}

export interface WrapFacts {
	cwd: string;
	toplevel: string | null;
	baseRepo: string | null;
	baseBranch: string;
	baseExists: boolean;
	branch: string | null;
	head: string | null;
	detached: boolean;
	dirty: boolean;
	changedFiles: number;
	merged: boolean;
	ahead: number;
	worktrees: WorktreeRecord[];
	remoteNames: string[];
	stateDir: string | null;
	state: OrchestratorState | null;
	stateError: string | null;
	plan: Autoplan | null;
	planDir: string | null;
	planError: string | null;
	handoff: HandoffFacts;
	gitError: string | null;
}

export type WrapCardId =
	| "handoff"
	| "update-handoff"
	| "cleanup"
	| "next-task"
	| "review"
	| "publish"
	| "exit";

export interface WrapCard {
	id: WrapCardId;
	label: string;
	description: string;
	enabled: boolean;
	reason: string | null;
}

export interface CleanupGuard {
	ok: boolean;
	reason: string | null;
	path: string;
	branch: string | null;
	head: string | null;
}

export interface RemoveSafeResult {
	ok: boolean;
	message: string;
	branch: string | null;
	branchDeleted: boolean;
	branchRetained: boolean;
}

export interface CreateNextResult {
	ok: boolean;
	message: string;
	branch?: string;
	path?: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const DEFAULT_BASE = "main";

function git(
	run: CommandRunner,
	repo: string,
	args: readonly string[],
	timeoutMs = 60_000,
): Promise<CommandResult> {
	return run("git", ["-C", repo, ...args], { timeoutMs });
}

function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function samePath(left: string | null, right: string | null): boolean {
	if (!left || !right) return false;
	return canonicalPath(left) === canonicalPath(right);
}

function isInside(root: string, path: string): boolean {
	const rel = relative(canonicalPath(root), canonicalPath(path));
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function parseCount(text: string): number {
	const value = Number.parseInt(text.trim(), 10);
	return Number.isFinite(value) ? value : 0;
}

function parseTimestamp(text: string): number | null {
	const value = Number.parseInt(text.trim(), 10);
	return Number.isFinite(value) ? value : null;
}

/** Разбор `git worktree list --porcelain -z` (поля через NUL, записи через пустой NUL). */
export function parseWorktreeList(output: string): WorktreeRecord[] {
	const records: WorktreeRecord[] = [];
	let current: WorktreeRecord | null = null;
	for (const field of output.split("\0")) {
		if (field === "") {
			if (current) records.push(current);
			current = null;
			continue;
		}
		if (field.startsWith("worktree ")) {
			if (current) records.push(current);
			current = {
				path: field.slice("worktree ".length),
				head: null,
				branch: null,
				detached: false,
				bare: false,
				locked: false,
				prunable: false,
				merged: false,
				dirty: false,
				liveProcesses: 0,
			};
			continue;
		}
		if (!current) continue;
		if (field.startsWith("HEAD ")) {
			current.head = field.slice("HEAD ".length);
		} else if (field.startsWith("branch refs/heads/")) {
			current.branch = field.slice("branch refs/heads/".length);
		} else if (field === "detached") {
			current.detached = true;
		} else if (field === "bare") {
			current.bare = true;
		} else if (field === "locked" || field.startsWith("locked ")) {
			current.locked = true;
		} else if (field === "prunable" || field.startsWith("prunable ")) {
			current.prunable = true;
		}
	}
	if (current) records.push(current);
	return records;
}

/**
 * Best-effort: pid-ы процессов, чей cwd — target или его подкаталог.
 * `/proc` может отсутствовать; тогда пустой список.
 */
export function processesInPath(target: string, procRoot = "/proc"): number[] {
	const wanted = canonicalPath(target);
	const pids: number[] = [];
	let entries: string[];
	try {
		entries = readdirSync(procRoot);
	} catch {
		return pids;
	}
	for (const entry of entries) {
		if (!/^\d+$/.test(entry)) continue;
		const pid = Number(entry);
		if (pid === process.pid) continue;
		try {
			const cwd = canonicalPath(readlinkSync(join(procRoot, entry, "cwd")));
			if (cwd === wanted || isInside(wanted, cwd)) pids.push(pid);
		} catch {
			// процесс завершился или cwd недоступен
		}
	}
	return pids;
}

async function inferBaseRepo(
	run: CommandRunner,
	cwd: string,
): Promise<string | null> {
	const common = await git(
		run,
		cwd,
		["rev-parse", "--path-format=absolute", "--git-common-dir"],
	);
	if (common.code !== 0) return null;
	const commonDir = common.stdout.trim();
	return commonDir ? dirname(resolve(cwd, commonDir)) : null;
}

function findState(
	facts: WrapFacts,
	cwd: string,
	baseRepo: string | null,
): void {
	const candidates = [cwd];
	if (baseRepo && !samePath(baseRepo, cwd)) candidates.push(baseRepo);
	for (const dir of candidates) {
		const path = join(dir, STATE_FILE);
		if (!existsSync(path)) continue;
		facts.stateDir = dir;
		try {
			facts.state = readState(path);
		} catch (error) {
			facts.stateError = error instanceof Error ? error.message : String(error);
		}
		return;
	}
}

function checkPlanHash(facts: WrapFacts): void {
	if (!facts.state || !facts.plan) return;
	if (facts.plan.hash === facts.state.plan.hash) return;
	facts.planError = `plan изменился: ${facts.plan.hash} != state ${facts.state.plan.hash}`;
}

function findPlan(facts: WrapFacts, cwd: string, baseRepo: string | null): void {
	if (facts.state?.plan.path) {
		const path = resolve(facts.stateDir ?? cwd, facts.state.plan.path);
		if (!existsSync(path)) {
			facts.planError = `${path}: plan not found`;
			return;
		}
		try {
			facts.plan = readPlan(path);
			facts.planDir = dirname(path);
			checkPlanHash(facts);
		} catch (error) {
			facts.planError = error instanceof Error ? error.message : String(error);
		}
		return;
	}
	const candidates = [join(cwd, "AUTOPLAN.md")];
	if (baseRepo && !samePath(baseRepo, cwd)) {
		candidates.push(join(baseRepo, "AUTOPLAN.md"));
	}
	const seen = new Set<string>();
	for (const path of candidates) {
		if (seen.has(path) || !existsSync(path)) continue;
		seen.add(path);
		try {
			facts.plan = readPlan(path);
			facts.planDir = dirname(path);
			checkPlanHash(facts);
		} catch (error) {
			facts.planError = error instanceof Error ? error.message : String(error);
		}
		return;
	}
}

async function detectBaseBranch(
	run: CommandRunner,
	baseRepo: string,
	configured: string | null,
): Promise<{ branch: string; exists: boolean }> {
	const candidates = configured ? [configured] : [DEFAULT_BASE, "master"];
	for (const branch of candidates) {
		const result = await git(run, baseRepo, [
			"rev-parse",
			"--verify",
			"--quiet",
			`refs/heads/${branch}`,
		]);
		if (result.code === 0) return { branch, exists: true };
	}
	return { branch: candidates[0] ?? DEFAULT_BASE, exists: false };
}

async function handoffFacts(
	run: CommandRunner,
	cwd: string,
): Promise<HandoffFacts> {
	const path = join(cwd, "HANDOFF.md");
	const exists = existsSync(path);
	const facts: HandoffFacts = {
		path,
		exists,
		dirty: false,
		lastCommitAt: null,
		stale: false,
	};
	if (!exists) return facts;

	const top = await git(run, dirname(path), ["rev-parse", "--show-toplevel"]);
	if (top.code !== 0) return facts;
	const toplevel = top.stdout.trim();
	const rel = relative(toplevel, path);
	if (rel.startsWith("..") || isAbsolute(rel)) return facts;

	const status = await git(run, toplevel, ["status", "--porcelain", "--", rel]);
	if (status.code === 0) facts.dirty = status.stdout.trim().length > 0;

	const log = await git(run, toplevel, ["log", "-1", "--format=%ct", "--", rel]);
	const last = parseTimestamp(log.stdout);
	if (log.code === 0 && last !== null) {
		facts.lastCommitAt = new Date(last * 1000).toISOString();
	}

	const head = await git(run, toplevel, ["rev-parse", "HEAD"]);
	const handoffHead = await git(run, toplevel, [
		"rev-list",
		"-1",
		"HEAD",
		"--",
		rel,
	]);
	if (
		head.code === 0 &&
		handoffHead.code === 0 &&
		head.stdout.trim() &&
		handoffHead.stdout.trim() &&
		head.stdout.trim() !== handoffHead.stdout.trim()
	) {
		facts.stale = true;
	}
	return facts;
}

async function enrichWorktree(
	run: CommandRunner,
	record: WorktreeRecord,
	baseRepo: string,
	baseBranch: string,
	baseExists: boolean,
	procRoot: string | undefined,
): Promise<void> {
	if (!record.branch || record.bare || record.prunable) return;

	if (baseExists) {
		const ancestor = await git(run, baseRepo, [
			"merge-base",
			"--is-ancestor",
			record.head ?? `refs/heads/${record.branch}`,
			`refs/heads/${baseBranch}`,
		]);
		record.merged = ancestor.code === 0;
	}

	const status = await git(run, record.path, ["status", "--porcelain"]);
	record.dirty = status.code !== 0 || status.stdout.trim().length > 0;
	record.liveProcesses = processesInPath(record.path, procRoot).length;
}

/** Собрать факты для `/wrap`; ошибки git не бросаются, а попадают в поля. */
export async function collectWrapFacts(
	cwd: string,
	options: { run?: CommandRunner; procRoot?: string } = {},
): Promise<WrapFacts> {
	const run = options.run ?? runCommand;
	const absolute = resolve(cwd);
	const facts: WrapFacts = {
		cwd: absolute,
		toplevel: null,
		baseRepo: null,
		baseBranch: DEFAULT_BASE,
		baseExists: false,
		branch: null,
		head: null,
		detached: false,
		dirty: false,
		changedFiles: 0,
		merged: false,
		ahead: 0,
		worktrees: [],
		remoteNames: [],
		stateDir: null,
		state: null,
		stateError: null,
		plan: null,
		planDir: null,
		planError: null,
		handoff: {
			path: join(absolute, "HANDOFF.md"),
			exists: false,
			dirty: false,
			lastCommitAt: null,
			stale: false,
		},
		gitError: null,
	};

	try {
		const top = await git(run, absolute, ["rev-parse", "--show-toplevel"]);
		if (top.code !== 0) {
			facts.gitError = top.stderr.trim() || "cwd is not inside a git repository";
			return facts;
		}
		facts.toplevel = top.stdout.trim() || null;
	} catch (error) {
		facts.gitError = error instanceof Error ? error.message : String(error);
		return facts;
	}
	const toplevel = facts.toplevel;
	if (!toplevel) {
		facts.gitError = "git toplevel is empty";
		return facts;
	}

	const branch = await git(run, toplevel, ["symbolic-ref", "--short", "HEAD"]);
	if (branch.code === 0) {
		facts.branch = branch.stdout.trim() || null;
	} else {
		facts.detached = true;
	}
	const head = await git(run, toplevel, ["rev-parse", "HEAD"]);
	facts.head = head.code === 0 ? head.stdout.trim() || null : null;

	const status = await git(run, toplevel, ["status", "--porcelain"]);
	facts.dirty = status.code !== 0 || status.stdout.trim().length > 0;
	facts.changedFiles = status.stdout
		.split("\n")
		.filter((line) => line.trim().length > 0).length;

	facts.baseRepo = await inferBaseRepo(run, toplevel);
	findState(facts, absolute, facts.baseRepo);
	findPlan(facts, absolute, facts.baseRepo);

	if (facts.plan?.config.baseRepo) {
		const configured = resolve(
			facts.planDir ?? facts.stateDir ?? toplevel,
			expandHome(facts.plan.config.baseRepo),
		);
		if (existsSync(configured)) facts.baseRepo = configured;
	}
	if (!facts.baseRepo) facts.baseRepo = toplevel;

	const base = await detectBaseBranch(
		run,
		facts.baseRepo,
		facts.plan?.config.baseBranch ?? null,
	);
	facts.baseBranch = base.branch;
	facts.baseExists = base.exists;

	if (facts.head && facts.baseExists) {
		const merged = await git(run, facts.baseRepo, [
			"merge-base",
			"--is-ancestor",
			facts.head,
			`refs/heads/${facts.baseBranch}`,
		]);
		facts.merged = merged.code === 0;
		const ahead = await git(run, facts.baseRepo, [
			"rev-list",
			"--count",
			`refs/heads/${facts.baseBranch}..${facts.head}`,
		]);
		facts.ahead = ahead.code === 0 ? parseCount(ahead.stdout) : 0;
	}

	const list = await git(run, facts.baseRepo, [
		"worktree",
		"list",
		"--porcelain",
		"-z",
	]);
	if (list.code === 0) {
		facts.worktrees = parseWorktreeList(list.stdout);
		for (const record of facts.worktrees) {
			await enrichWorktree(
				run,
				record,
				facts.baseRepo,
				facts.baseBranch,
				facts.baseExists,
				options.procRoot,
			);
		}
	}

	const remotes = await git(run, facts.baseRepo, ["remote"]);
	if (remotes.code === 0) {
		facts.remoteNames = remotes.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	facts.handoff = await handoffFacts(run, absolute);
	return facts;
}

function stateSummary(state: OrchestratorState | null): string {
	if (!state) return "нет";
	if (state.stop) return `stop ${state.stop.reason}`;
	if (state.current) return `current ${state.current.id} (${state.current.status})`;
	if (state.run?.active) return `run active (${state.completed.length} completed)`;
	return `run завершён (${state.completed.length} completed)`;
}

function handoffSummary(handoff: HandoffFacts): string {
	if (!handoff.exists) return "нет";
	if (handoff.dirty) return "есть, dirty";
	if (handoff.stale) return "есть, возможно устарел";
	return "есть";
}

function changesLabel(count: number): string {
	const mod10 = count % 10;
	const mod100 = count % 100;
	if (mod10 === 1 && mod100 !== 11) return `${count} изменение`;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
		return `${count} изменения`;
	}
	return `${count} изменений`;
}

/** Короткая сводка для заголовка select; не больше 4 строк. */
export function formatWrapSummary(facts: WrapFacts): string {
	const head = facts.head ? facts.head.slice(0, 7) : "—";
	const branch = facts.branch ?? "detached";
	const work = facts.dirty ? changesLabel(facts.changedFiles) : "clean";
	const base = facts.baseExists
		? facts.baseBranch
		: `${facts.baseBranch} (не найден)`;
	const state = facts.stateError
		? `ошибка: ${facts.stateError}`
		: stateSummary(facts.state);
	const gitNote = facts.gitError ? ` · git: ${facts.gitError}` : "";
	return [
		`Wrap: ${branch} → ${base}${gitNote}`,
		`HEAD ${head} · ahead ${facts.ahead} · merged: ${facts.merged ? "yes" : "no"} · ${work}`,
		`STATE: ${state}`,
		`HANDOFF.md: ${handoffSummary(facts.handoff)}`,
	].join("\n");
}

/** Проверка одного worktree; синхронно, только по собранным фактам. */
export function guardCleanup(facts: WrapFacts, target: string): CleanupGuard {
	const no = (reason: string): CleanupGuard => ({
		ok: false,
		reason,
		path: target,
		branch: null,
		head: null,
	});
	if (facts.gitError) return no(facts.gitError);
	if (facts.planError) return no(`план не прочитан: ${facts.planError}`);
	const record = facts.worktrees.find((item) => samePath(item.path, target));
	if (!record) return no(`worktree не найден: ${target}`);
	if (record.bare) return no(`${record.path}: bare worktree`);
	if (record.prunable) return no(`${record.path}: prunable worktree`);
	if (record.locked) return no(`${record.path}: worktree locked`);
	if (record.detached || !record.branch) {
		return no(`${record.path}: detached HEAD, ветку нельзя удалить безопасно`);
	}
	if (samePath(record.path, facts.toplevel)) {
		return no(
			`${record.path}: текущий worktree; выйди из него и удали вручную`,
		);
	}
	if (samePath(record.path, facts.baseRepo)) {
		return no(`${record.path}: это base repo, а не worktree`);
	}
	if (
		record.branch === facts.baseBranch ||
		record.branch === "main" ||
		record.branch === "master"
	) {
		return no(`${record.path}: base-ветку ${record.branch} не удаляем`);
	}
	if (!facts.baseExists) {
		return no(`base-ветка ${facts.baseBranch} не найдена`);
	}
	if (!record.merged) {
		return no(`${record.branch} не merged в ${facts.baseBranch}`);
	}
	if (record.dirty) return no(`${record.path}: есть незакоммиченные изменения`);
	if (record.liveProcesses > 0) {
		return no(
			`${record.path}: в worktree работает процесс (${record.liveProcesses}); закрой терминал/процесс и повтори`,
		);
	}
	const root = facts.plan?.config.worktreeRoot;
	if (root) {
		const resolvedRoot = resolveWorktreeRoot(
			facts.planDir ?? facts.stateDir ?? facts.cwd,
			root,
		);
		if (!isInside(resolvedRoot, record.path)) {
			return no(`${record.path}: вне worktreeRoot ${resolvedRoot}`);
		}
	}
	return {
		ok: true,
		reason: null,
		path: record.path,
		branch: record.branch,
		head: record.head,
	};
}

export function cleanupCandidates(facts: WrapFacts): WorktreeRecord[] {
	return facts.worktrees.filter((record) => guardCleanup(facts, record.path).ok);
}

/** Карточки меню; disabled-карточки остаются видимыми с причиной. */
export function buildWrapCards(facts: WrapFacts): WrapCard[] {
	const candidates = cleanupCandidates(facts);
	const handoffReady = facts.handoff.exists;
	const planReady = Boolean(
		facts.plan && !facts.planError && facts.baseRepo && facts.baseExists,
	);
	const reviewReady = Boolean(facts.branch && facts.ahead > 0);
	return [
		{
			id: "handoff",
			label: "Завершить сессию (handoff)",
			description: handoffReady
				? "Проверить HANDOFF.md и выполнить /handoff-new"
				: "Сначала обнови HANDOFF.md",
			enabled: handoffReady,
			reason: handoffReady ? null : "HANDOFF.md не найден",
		},
		{
			id: "update-handoff",
			label: "Обновить HANDOFF.md",
			description: "Попросить агента обновить состояние перед handoff",
			enabled: true,
			reason: null,
		},
		{
			id: "cleanup",
			label: "Удалить завершённые worktree",
			description: candidates.length
				? `${candidates.length} merged+clean: ${candidates
						.map((item) => item.branch)
						.join(", ")}`
				: "Нет merged+clean worktree, кроме текущего",
			enabled: candidates.length > 0,
			reason:
				candidates.length > 0
					? null
					: "нет worktree, который merged в base, чистый и не текущий",
		},
		{
			id: "next-task",
			label: "Создать worktree для следующей задачи",
			description: facts.plan
				? `Ветка feat/<slug> от ${facts.baseBranch}`
				: "Нужен AUTOPLAN.md с worktreeRoot",
			enabled: planReady,
			reason: planReady
				? null
				: facts.planError
					? facts.planError
					: facts.plan
						? "base repo или base-ветка не найдены"
						: "AUTOPLAN.md не найден",
		},
		{
			id: "review",
			label: "Ретро-review текущей ветки",
			description: reviewReady
				? `${facts.baseBranch}...${facts.branch}`
				: "Нет коммитов впереди base",
			enabled: reviewReady,
			reason: reviewReady
				? null
				: "текущая ветка не содержит коммитов впереди base",
		},
		{
			id: "publish",
			label: "Publish / remote",
			description: facts.remoteNames.length
				? "Требует решения владельца; не автоматизируется"
				: "Remote не настроен",
			enabled: false,
			reason: facts.remoteNames.length
				? "publish — только по решению владельца"
				: "remote не настроен",
		},
		{
			id: "exit",
			label: "Выйти",
			description: "Ничего не менять",
			enabled: true,
			reason: null,
		},
	];
}

async function recheckCleanup(
	run: CommandRunner,
	facts: WrapFacts,
	guard: CleanupGuard,
	procRoot: string | undefined,
): Promise<string | null> {
	if (!guard.branch) return "ветка не определена";
	if (!facts.baseRepo) return "base repo не найден";
	if (!existsSync(guard.path)) return `${guard.path}: worktree уже удалён`;
	if (samePath(guard.path, facts.toplevel)) {
		return `${guard.path}: текущий worktree`;
	}
	const list = await git(run, facts.baseRepo, [
		"worktree",
		"list",
		"--porcelain",
		"-z",
	]);
	if (list.code !== 0) return "не удалось перечитать git worktree list";
	const record = parseWorktreeList(list.stdout).find((item) =>
		samePath(item.path, guard.path),
	);
	if (!record) return `${guard.path}: worktree больше не зарегистрирован`;
	if (record.bare || record.prunable || record.locked) {
		return `${guard.path}: worktree стал bare/prunable/locked`;
	}
	if (record.branch !== guard.branch) {
		return `${guard.path}: ветка изменилась (${record.branch ?? "detached"})`;
	}
	if (guard.head && record.head && record.head !== guard.head) {
		return `${guard.path}: HEAD изменился после проверки`;
	}
	const status = await git(run, guard.path, ["status", "--porcelain"]);
	if (status.code !== 0 || status.stdout.trim().length > 0) {
		return `${guard.path}: появились незакоммиченные изменения`;
	}
	const head = await git(run, guard.path, ["rev-parse", "HEAD"]);
	const currentHead = head.code === 0 ? head.stdout.trim() : "";
	if (guard.head && currentHead && currentHead !== guard.head) {
		return `${guard.path}: HEAD изменился после проверки (${currentHead.slice(0, 7)})`;
	}
	const target = guard.head ?? `refs/heads/${guard.branch}`;
	const ancestor = await git(run, facts.baseRepo, [
		"merge-base",
		"--is-ancestor",
		target,
		`refs/heads/${facts.baseBranch}`,
	]);
	if (ancestor.code !== 0) {
		return `${guard.branch} больше не merged в ${facts.baseBranch}`;
	}
	const live = processesInPath(guard.path, procRoot);
	if (live.length > 0) {
		return `${guard.path}: в worktree работает процесс (${live.join(", ")}); закрой его и повтори`;
	}
	return null;
}

/**
 * Удалить merged+clean worktree и локальную ветку.
 *
 * Повторно проверяет предусловия под lock, не использует `--force` и
 * `git branch -D`. Если ветку не удалось удалить безопасно — сообщает retained.
 */
export async function removeMergedWorktreeSafe(options: {
	facts: WrapFacts;
	path: string;
	backend?: WorktreeBackend;
	run?: CommandRunner;
	procRoot?: string;
}): Promise<RemoveSafeResult> {
	const { facts } = options;
	const guard = guardCleanup(facts, options.path);
	const failed = (message: string): RemoveSafeResult => ({
		ok: false,
		message,
		branch: guard.branch,
		branchDeleted: false,
		branchRetained: false,
	});
	if (!guard.ok) return failed(guard.reason ?? "удаление запрещено");
	if (!facts.baseRepo) return failed("base repo не найден");
	if (!guard.branch) return failed("ветка не определена");

	const run = options.run ?? runCommand;
	const backend = options.backend ?? facts.plan?.config.backend ?? "orca";
	const lockDir = facts.stateDir ?? facts.cwd;
	const release = acquireLock(lockDir);
	try {
		const problem = await recheckCleanup(
			run,
			facts,
			guard,
			options.procRoot,
		);
		if (problem) return failed(problem);

		let removal: CommandResult | null = null;
		if (backend === "orca") {
			try {
				const orca = await run(
					"orca",
					[
						"worktree",
						"rm",
						"--worktree",
						`path:${guard.path}`,
						"--delete-branch",
						"--json",
					],
					{ timeoutMs: 300_000 },
				);
				if (orca.code === 0) removal = orca;
			} catch {
				// orca недоступен: пробуем git fallback без force
			}
		}
		if (!removal) {
			removal = await git(
				run,
				facts.baseRepo,
				["worktree", "remove", guard.path],
				120_000,
			);
		}
		if (removal.code !== 0 && existsSync(guard.path)) {
			return failed(
				(removal.stderr || removal.stdout).trim() ||
					`не удалось удалить ${guard.path}`,
			);
		}
		if (existsSync(guard.path)) {
			return failed(`worktree всё ещё существует: ${guard.path}`);
		}

		let branchDeleted = false;
		const branchRef = await git(run, facts.baseRepo, [
			"rev-parse",
			"--verify",
			"--quiet",
			`refs/heads/${guard.branch}`,
		]);
		if (branchRef.code !== 0) {
			branchDeleted = true;
		} else {
			const del = await git(
				run,
				facts.baseRepo,
				["branch", "-d", guard.branch],
				60_000,
			);
			branchDeleted = del.code === 0;
		}
		return {
			ok: true,
			message: branchDeleted
				? `worktree и ветка ${guard.branch} удалены`
				: `worktree удалён; ветка ${guard.branch} сохранена (safe delete не удался)`,
			branch: guard.branch,
			branchDeleted,
			branchRetained: !branchDeleted,
		};
	} finally {
		release();
	}
}

/** Создать worktree для следующей задачи; state не меняется. */
export async function createNextWorktree(options: {
	facts: WrapFacts;
	slug: string;
}): Promise<CreateNextResult> {
	const { facts } = options;
	const slug = options.slug.trim();
	if (!SLUG_RE.test(slug)) {
		return {
			ok: false,
			message:
				"slug: нужен [a-z0-9][a-z0-9-]{0,40}, например wrap-wizard",
		};
	}
	if (!facts.plan) {
		return { ok: false, message: "AUTOPLAN.md не найден: неизвестен worktreeRoot" };
	}
	if (facts.planError) {
		return { ok: false, message: `план не прочитан: ${facts.planError}` };
	}
	if (!facts.baseRepo) return { ok: false, message: "base repo не найден" };
	if (!facts.baseExists) {
		return {
			ok: false,
			message: `base-ветка ${facts.baseBranch} не найдена`,
		};
	}

	const branch = `feat/${slug}`;
	const root = resolveWorktreeRoot(
		facts.planDir ?? facts.stateDir ?? facts.cwd,
		facts.plan.config.worktreeRoot,
	);
	const path = worktreePath(root, branch);
	const lockDir = facts.stateDir ?? facts.cwd;
	const release = acquireLock(lockDir);
	try {
		if (existsSync(path)) {
			return { ok: false, message: `путь уже существует: ${path}` };
		}
		if (await branchExists(facts.baseRepo, branch)) {
			return { ok: false, message: `ветка уже существует: ${branch}` };
		}
		const created = await createWorktree({
			backend: facts.plan.config.backend,
			baseRepo: facts.baseRepo,
			baseBranch: facts.plan.config.baseBranch,
			branch,
			path,
		});
		return {
			ok: true,
			message: `worktree создан: ${created.path} (${created.branch})`,
			branch: created.branch,
			path: created.path,
		};
	} finally {
		release();
	}
}
