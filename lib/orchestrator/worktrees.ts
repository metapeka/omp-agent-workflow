/**
 * Worktree backend: Orca (default) и git (fallback/тесты).
 *
 * Изоляция задачи держится на отдельном чекауте и ветке. Merge — только
 * ff-only в чистый base. Удаление worktree по умолчанию безопасное: без
 * --force, без удаления ветки, только merged+clean и без живых процессов
 * или терминалов Orca; tip ветки сохраняется в backup-ref.
 */
import { spawn } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readlinkSync,
	realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type WorktreeBackend = "orca" | "git";

export interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface RunOptions {
	cwd?: string;
	timeoutMs?: number;
	env?: NodeJS.ProcessEnv;
}

export class CommandError extends Error {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;

	constructor(command: string, args: readonly string[], result: CommandResult) {
		super(
			`${command} ${args.join(" ")} exited ${result.code}: ${
				(result.stderr || result.stdout).trim() || "no output"
			}`,
		);
		this.name = "CommandError";
		this.code = result.code;
		this.stdout = result.stdout;
		this.stderr = result.stderr;
	}
}

/** Запуск процесса без shell; timeout убивает процесс. */
export function runCommand(
	command: string,
	args: readonly string[],
	options: RunOptions = {},
): Promise<CommandResult> {
	const { promise, resolve, reject } = Promise.withResolvers<CommandResult>();
	const child = spawn(command, [...args], {
		cwd: options.cwd,
		env: options.env ?? process.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	const timer = options.timeoutMs
		? setTimeout(() => {
				timedOut = true;
				child.kill("SIGKILL");
			}, options.timeoutMs)
		: undefined;
	child.stdout?.on("data", (chunk: Buffer) => {
		stdout += chunk.toString("utf8");
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		stderr += chunk.toString("utf8");
	});
	child.on("error", (error) => {
		clearTimeout(timer);
		reject(
			new CommandError(command, args, {
				code: -1,
				stdout,
				stderr: `${stderr}${error.message}`,
			}),
		);
	});
	child.on("close", (code) => {
		clearTimeout(timer);
		resolve({
			code: timedOut ? -2 : (code ?? -1),
			stdout,
			stderr: timedOut ? `${stderr}\ntimeout` : stderr,
		});
	});
	return promise;
}

async function runChecked(
	command: string,
	args: readonly string[],
	options: RunOptions = {},
): Promise<CommandResult> {
	const result = await runCommand(command, args, options);
	if (result.code !== 0) throw new CommandError(command, args, result);
	return result;
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

/** Канонический путь; несуществующий нормализуется через resolve. */
export function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

export function samePath(left: string | null, right: string | null): boolean {
	if (!left || !right) return false;
	return canonicalPath(left) === canonicalPath(right);
}

export function isInside(root: string, path: string): boolean {
	const rel = relative(canonicalPath(root), canonicalPath(path));
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
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

export interface OrcaTerminalRecord {
	handle: string;
	worktreePath: string | null;
	connected: boolean;
	orphaned: boolean;
}

function orcaTerminalListFromPayload(payload: unknown): unknown[] {
	if (typeof payload !== "object" || payload === null) return [];
	if ("result" in payload) {
		const result = payload.result;
		if (
			typeof result === "object" &&
			result !== null &&
			"terminals" in result &&
			Array.isArray(result.terminals)
		) {
			return result.terminals;
		}
	}
	if ("terminals" in payload && Array.isArray(payload.terminals)) {
		return payload.terminals;
	}
	return [];
}

/** Разобрать `orca terminal list --json`; мусор → пустой список. */
export function parseOrcaTerminals(stdout: string): OrcaTerminalRecord[] {
	let payload: unknown;
	try {
		payload = JSON.parse(stdout);
	} catch {
		return [];
	}
	const records: OrcaTerminalRecord[] = [];
	for (const raw of orcaTerminalListFromPayload(payload)) {
		if (typeof raw !== "object" || raw === null) continue;
		records.push({
			handle: "handle" in raw && typeof raw.handle === "string" ? raw.handle : "",
			worktreePath:
				"worktreePath" in raw && typeof raw.worktreePath === "string"
					? raw.worktreePath
					: null,
			connected: !("connected" in raw) || raw.connected !== false,
			orphaned: "orphaned" in raw && raw.orphaned === true,
		});
	}
	return records;
}

/** Сколько живых (connected, не orphaned) терминалов Orca в каталоге. */
export function countLiveTerminals(
	terminals: readonly OrcaTerminalRecord[],
	target: string,
): number {
	return terminals.filter(
		(terminal) =>
			terminal.connected &&
			!terminal.orphaned &&
			terminal.worktreePath !== null &&
			samePath(terminal.worktreePath, target),
	).length;
}

export type CommandRunner = (
	command: string,
	args: readonly string[],
	options?: RunOptions,
) => Promise<CommandResult>;

/**
 * `orca terminal list --json` через переданный runner.
 * `null` — Orca CLI недоступен (спавн не удался); ошибка сервера → throw.
 */
export async function queryOrcaTerminals(
	run: CommandRunner,
): Promise<OrcaTerminalRecord[] | null> {
	try {
		const result = await run(orcaCli(), ["terminal", "list", "--json"], {
			timeoutMs: 15_000,
		});
		if (result.code !== 0) {
			throw new CommandError("orca", ["terminal", "list", "--json"], result);
		}
		return parseOrcaTerminals(result.stdout);
	} catch (error) {
		if (error instanceof CommandError && error.code === -1) return null;
		throw error;
	}
}

/** Base repo: явный путь из плана или родитель `.git` общего каталога. */
export async function resolveBaseRepo(
	cwd: string,
	configured: string | null,
): Promise<string> {
	if (configured) {
		const path = resolve(cwd, expandHome(configured));
		if (!existsSync(path)) {
			throw new Error(`baseRepo not found: ${path}`);
		}
		return path;
	}
	const result = await runChecked(
		"git",
		["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
		{ timeoutMs: 60_000 },
	);
	const commonDir = result.stdout.trim();
	if (!commonDir) throw new Error(`cannot resolve git common dir in ${cwd}`);
	return dirname(resolve(cwd, commonDir));
}

export function resolveWorktreeRoot(cwd: string, configured: string): string {
	return resolve(cwd, expandHome(configured));
}

export function worktreePath(root: string, branch: string): string {
	const slug = branch.replace(/[^A-Za-z0-9._-]+/g, "-");
	return join(root, slug);
}

async function git(
	baseRepo: string,
	args: readonly string[],
	timeoutMs = 120_000,
): Promise<CommandResult> {
	return runCommand("git", ["-C", baseRepo, ...args], { timeoutMs });
}

export async function currentBranch(repo: string): Promise<string> {
	const result = await runChecked("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], {
		timeoutMs: 60_000,
	});
	return result.stdout.trim();
}

export async function headCommit(repo: string): Promise<string> {
	const result = await runChecked("git", ["-C", repo, "rev-parse", "HEAD"], {
		timeoutMs: 60_000,
	});
	return result.stdout.trim();
}

export async function isClean(repo: string): Promise<boolean> {
	const result = await git(repo, ["status", "--porcelain"], 60_000);
	if (result.code !== 0) {
		throw new CommandError("git", ["status", "--porcelain"], result);
	}
	return result.stdout.trim().length === 0;
}

export async function branchExists(
	baseRepo: string,
	branch: string,
): Promise<boolean> {
	const result = await git(
		baseRepo,
		["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
		60_000,
	);
	return result.code === 0;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** Достать путь нового worktree из ответа Orca без привязки к одному слою. */
export function orcaWorktreePath(payload: unknown): string | null {
	const root = jsonRecord(payload);
	if (!root) return null;
	const queue: unknown[] = [root];
	while (queue.length > 0) {
		const value = queue.shift();
		const record = jsonRecord(value);
		if (!record) continue;
		if (
			typeof record.path === "string" &&
			(typeof record.branch === "string" ||
				typeof record.displayName === "string" ||
				typeof record.worktreeId === "string")
		) {
			return record.path;
		}
		for (const key of ["result", "worktree", "data", "worktrees"]) {
			if (key in record) queue.push(record[key]);
		}
		for (const child of Object.values(record)) {
			if (typeof child === "object" && child !== null) queue.push(child);
		}
	}
	return null;
}

export interface CreateWorktreeInput {
	backend: WorktreeBackend;
	baseRepo: string;
	baseBranch: string;
	branch: string;
	path: string;
}

/** Путь к Orca CLI: `ORCA_CLI_COMMAND` или `orca` из PATH. */
export function orcaCli(): string {
	return process.env.ORCA_CLI_COMMAND || "orca";
}

export interface WorktreeInfo {
	path: string;
	branch: string;
	backend: WorktreeBackend;
}

export async function createWorktree(
	input: CreateWorktreeInput,
): Promise<WorktreeInfo> {
	if (existsSync(input.path)) {
		throw new Error(`worktree path already exists: ${input.path}`);
	}
	if (await branchExists(input.baseRepo, input.branch)) {
		throw new Error(`branch already exists: ${input.branch}`);
	}
	if (input.backend === "git") {
		await runChecked(
			"git",
			[
				"-C",
				input.baseRepo,
				"worktree",
				"add",
				"-b",
				input.branch,
				input.path,
				input.baseBranch,
			],
			{ timeoutMs: 300_000 },
		);
		return { path: input.path, branch: input.branch, backend: "git" };
	}

	const slug = input.branch.replace(/[^A-Za-z0-9._-]+/g, "-");
	const result = await runChecked(
		orcaCli(),
		[
			"worktree",
			"create",
			"--repo",
			`path:${input.baseRepo}`,
			"--name",
			slug,
			"--branch",
			input.branch,
			"--base-branch",
			input.baseBranch,
			"--no-parent",
			"--json",
		],
		{ timeoutMs: 600_000 },
	);
	let payload: unknown;
	try {
		payload = JSON.parse(result.stdout);
	} catch {
		throw new Error(
			`orca worktree create returned non-JSON output: ${result.stdout.trim()}`,
		);
	}
	const path = orcaWorktreePath(payload);
	if (!path) {
		throw new Error(
			`orca worktree create: cannot find worktree path in ${result.stdout.trim()}`,
		);
	}
	return { path, branch: input.branch, backend: "orca" };
}

export interface RemoveWorktreeInput {
	backend: WorktreeBackend;
	baseRepo: string;
	path: string;
	branch: string;
	/** Base-ветка для проверки merged; по умолчанию `main`. */
	baseBranch?: string;
	/** Явно разрешить грязный worktree; живые процессы/терминалы запрещены всегда. */
	force?: boolean;
	/** Явно разрешить `git branch -d` после проверки merged. */
	deleteBranch?: boolean;
	/** Требовать merged (default true). */
	requireMerged?: boolean;
	/** Текущий worktree сессии; по умолчанию `process.cwd()`. */
	currentWorktree?: string;
	/** Тесты: готовый список терминалов Orca; `undefined` — запросить у Orca. */
	terminals?: readonly OrcaTerminalRecord[];
	procRoot?: string;
	run?: CommandRunner;
}

export interface RemoveWorktreeResult {
	path: string;
	branch: string;
	tip: string;
	backupRef: string;
	branchDeleted: boolean;
	branchRetained: boolean;
	usedGitFallback: boolean;
	/** Stale-запись Orca: как её убрать. */
	warning: string | null;
}

function backupRefName(branch: string): string {
	const slug = branch.replace(/[^A-Za-z0-9._-]+/g, "-");
	return `refs/omp-worktree-backup/${slug}-${Date.now()}`;
}

/**
 * Удалить worktree безопасно.
 *
 * По умолчанию: без `--force`, без удаления ветки, только merged в base,
 * чистый worktree, не текущий, без живых процессов и терминалов Orca.
 * Tip ветки сохраняется в `refs/omp-worktree-backup/*`; ветка удаляется
 * только при `deleteBranch: true` и только через `git branch -d`.
 *
 * Orca останавливает терминалы удаляемого worktree (SIGTERM их PTY),
 * поэтому живая сессия внутри target — отказ, а не «попробуем».
 */
export async function removeWorktree(
	input: RemoveWorktreeInput,
): Promise<RemoveWorktreeResult> {
	const path = resolve(input.path);
	const baseRepo = resolve(input.baseRepo);
	const baseBranch = input.baseBranch ?? "main";
	const force = input.force === true;
	const deleteBranch = input.deleteBranch === true;
	const requireMerged = input.requireMerged !== false;
	const run = input.run ?? runCommand;
	const runGit = (
		repo: string,
		args: readonly string[],
		timeoutMs = 60_000,
	): Promise<CommandResult> =>
		run("git", ["-C", repo, ...args], { timeoutMs });

	if (samePath(path, baseRepo)) {
		throw new Error(`refusing to remove base repo as worktree: ${path}`);
	}

	const currentWorktree = resolve(input.currentWorktree ?? process.cwd());
	if (samePath(path, currentWorktree) || isInside(path, currentWorktree)) {
		throw new Error(
			`refusing to remove the current worktree: ${path}; выйди из него и удали снаружи`,
		);
	}

	const top = await runGit(path, ["rev-parse", "--show-toplevel"]);
	if (top.code !== 0 || !samePath(top.stdout.trim(), path)) {
		throw new Error(`${path}: not a git worktree working tree`);
	}
	const checkedOut = await runGit(path, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const branch = checkedOut.stdout.trim();
	if (checkedOut.code !== 0 || branch !== input.branch) {
		throw new Error(
			`${path}: HEAD is ${branch || "detached"}, expected ${input.branch}`,
		);
	}
	const head = await runGit(path, ["rev-parse", "HEAD"]);
	const tip = head.stdout.trim();
	if (head.code !== 0 || !tip) {
		throw new Error(`${path}: cannot resolve HEAD`);
	}

	const baseRef = `refs/heads/${baseBranch}`;
	const baseExists = await runGit(baseRepo, [
		"rev-parse",
		"--verify",
		"--quiet",
		baseRef,
	]);
	if (baseExists.code !== 0) {
		throw new Error(`base branch ${baseBranch} not found in ${baseRepo}`);
	}
	const ancestor = await runGit(baseRepo, [
		"merge-base",
		"--is-ancestor",
		tip,
		baseRef,
	]);
	const merged = ancestor.code === 0;
	if (ancestor.code !== 0 && ancestor.code !== 1) {
		throw new Error(
			`cannot check whether ${input.branch} is merged: ${
				(ancestor.stderr || ancestor.stdout).trim()
			}`,
		);
	}
	if (!merged && (requireMerged || deleteBranch)) {
		throw new Error(
			`${input.branch} is not merged into ${baseBranch}; работа сохранена, удаление запрещено`,
		);
	}

	if (!force) {
		const status = await runGit(path, ["status", "--porcelain"]);
		if (status.code !== 0 || status.stdout.trim().length > 0) {
			throw new Error(
				`${path}: worktree has uncommitted changes; commit или force явно`,
			);
		}
	}

	const liveProcesses = processesInPath(path, input.procRoot);
	if (liveProcesses.length > 0) {
		throw new Error(
			`${path}: в worktree работает процесс (pid ${liveProcesses
				.slice(0, 5)
				.join(", ")}); закрой его и повтори`,
		);
	}

	let liveTerminals = 0;
	if (input.terminals) {
		liveTerminals = countLiveTerminals(input.terminals, path);
	} else {
		try {
			const terminals = await queryOrcaTerminals(run);
			liveTerminals = terminals ? countLiveTerminals(terminals, path) : 0;
		} catch (error) {
			if (input.backend === "orca") {
				throw new Error(
					`cannot verify live Orca terminals for ${path}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
	}
	if (liveTerminals > 0) {
		throw new Error(
			`${path}: в worktree работает терминал Orca (${liveTerminals}); закрой его и повтори`,
		);
	}

	const backupRef = backupRefName(input.branch);
	const backup = await runGit(baseRepo, [
		"update-ref",
		backupRef,
		tip,
	]);
	if (backup.code !== 0) {
		throw new Error(
			`cannot save backup ref ${backupRef}: ${
				(backup.stderr || backup.stdout).trim()
			}`,
		);
	}

	let removal: CommandResult | null = null;
	let usedGitFallback = false;
	let orcaError: string | null = null;
	if (input.backend === "orca") {
		try {
			const args = [
				"worktree",
				"rm",
				"--worktree",
				`path:${path}`,
				...(force ? ["--force"] : []),
				"--json",
			];
			removal = await run(orcaCli(), args, { timeoutMs: 300_000 });
			if (removal.code !== 0) {
				orcaError =
					(removal.stderr || removal.stdout).trim() ||
					`orca worktree rm exited ${removal.code}`;
			}
		} catch (error) {
			orcaError = error instanceof Error ? error.message : String(error);
		}
		if (removal?.code === 0 && existsSync(path)) {
			orcaError = "orca worktree rm reported success but path still exists";
		}
	}
	if (existsSync(path)) {
		usedGitFallback = input.backend === "orca";
		const gitArgs = [
			"worktree",
			"remove",
			...(force ? ["--force"] : []),
			path,
		];
		const gitRemoval = await run("git", ["-C", baseRepo, ...gitArgs], {
			timeoutMs: 120_000,
		});
		if (gitRemoval.code !== 0 || existsSync(path)) {
			throw new CommandError("git", gitArgs, gitRemoval);
		}
	}

	let branchDeleted = false;
	let branchRetained = false;
	if (deleteBranch) {
		const del = await runGit(baseRepo, ["branch", "-d", input.branch]);
		branchDeleted = del.code === 0;
		branchRetained = !branchDeleted;
	} else {
		branchRetained = true;
	}

	const warning = usedGitFallback
		? `Orca могла сохранить запись об удалённом worktree${
				orcaError ? ` (${orcaError})` : ""
			}; убери её: orca worktree rm --worktree path:${path} --json`
		: null;
	return {
		path,
		branch: input.branch,
		tip,
		backupRef,
		branchDeleted,
		branchRetained,
		usedGitFallback,
		warning,
	};
}

/** Merge только fast-forward; иначе CommandError. */
export async function mergeFastForward(
	baseRepo: string,
	branch: string,
): Promise<void> {
	await runChecked(
		"git",
		["-C", baseRepo, "merge", "--ff-only", branch],
		{ timeoutMs: 300_000 },
	);
}

/**
 * Rebase worktree на base. Конфликт откатывается (`rebase --abort`),
 * чтобы worktree остался пригодным для ручного разбора.
 */
export async function rebaseOnto(
	worktree: string,
	baseBranch: string,
): Promise<void> {
	const result = await runCommand(
		"git",
		["-C", worktree, "rebase", baseBranch],
		{ timeoutMs: 300_000 },
	);
	if (result.code === 0) return;
	await runCommand("git", ["-C", worktree, "rebase", "--abort"], {
		timeoutMs: 60_000,
	});
	throw new CommandError("git", ["rebase", baseBranch], result);
}
