/**
 * Worktree backend: Orca (default) и git (fallback/тесты).
 *
 * Изоляция задачи держится на отдельном чекауте и ветке. Merge — только
 * ff-only в чистый base; retry/cleanup могут force-удалить worktree и ветку.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
}

/** Удалить worktree и force-ветку. Используется после merge и при retry. */
export async function removeWorktree(input: RemoveWorktreeInput): Promise<void> {
	if (resolve(input.path) === resolve(input.baseRepo)) {
		throw new Error(`refusing to remove base repo as worktree: ${input.path}`);
	}
	let removal: CommandResult;
	if (input.backend === "orca") {
		removal = await runCommand(
			orcaCli(),
			[
				"worktree",
				"rm",
				"--worktree",
				`path:${input.path}`,
				"--delete-branch",
				"--force",
				"--json",
			],
			{ timeoutMs: 300_000 },
		);
		if (removal.code !== 0) {
			removal = await git(
				input.baseRepo,
				["worktree", "remove", "--force", input.path],
				120_000,
			);
		}
	} else {
		removal = await git(
			input.baseRepo,
			["worktree", "remove", "--force", input.path],
			120_000,
		);
	}
	await git(input.baseRepo, ["branch", "-D", input.branch], 60_000);
	if (removal.code !== 0 && existsSync(input.path)) {
		throw new CommandError("git", ["worktree", "remove", input.path], removal);
	}
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
