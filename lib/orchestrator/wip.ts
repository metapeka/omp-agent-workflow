/**
 * WIP-снимок перед `force`-удалением worktree.
 *
 * Backup-ref спасает коммиты, но не незакоммиченные файлы: `force` удаляет
 * каталог вместе с ними (проба 2026-11-27: коммит в backup-ref пережил
 * удаление, WIP-файл — нет). Поэтому перед таким удалением пишется патч
 * через временный индекс (`GIT_INDEX_FILE`), чтобы рабочее дерево и
 * настоящий индекс не менялись; рядом — `.status` с `git status`.
 *
 * Ignored-файлы (`node_modules` и т.п.) в снимок не входят осознанно:
 * патч повторяет `git add -A`, а не полный образ диска.
 * Сбой снимка — отказ от удаления: молча терять WIP нельзя.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { CommandResult, CommandRunner } from "./worktrees.ts";

export interface WipSnapshot {
	/** Патч: tracked-изменения против HEAD плюс untracked; применяется `git apply --3way`. */
	patchPath: string;
	/** Ветка, HEAD, `git status` и команда восстановления — для оператора. */
	statusPath: string;
	repo: string;
	branch: string;
	head: string;
	/** Сколько путей показал `git status` (tracked + untracked, без ignored). */
	files: number;
	patchBytes: number;
}

export interface WipCaptureInput {
	worktree: string;
	baseRepo: string;
	branch: string;
	/** Каталог снимков; по умолчанию `wipStateDir()`. */
	dir?: string;
	now?: Date;
	run: CommandRunner;
}

/** `$XDG_STATE_HOME` (или `~/.local/state`) + `omp-agent-workflow/wip`. */
export function wipStateDir(): string {
	const base =
		process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
	return join(base, "omp-agent-workflow", "wip");
}

function commandDetail(result: CommandResult): string {
	return (result.stderr || result.stdout).trim() || `exit ${result.code}`;
}

function slug(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

/**
 * Снять WIP грязного worktree в патч; `null` — дерево чистое, снимать нечего.
 * Ошибки чтения/записи пробрасываются: вызывающий обязан отказать в удалении.
 */
export async function captureWorkInProgress(
	input: WipCaptureInput,
): Promise<WipSnapshot | null> {
	const { worktree, run } = input;
	const timeoutMs = 120_000;
	const git = (args: readonly string[], env?: NodeJS.ProcessEnv) =>
		run("git", ["-C", worktree, ...args], env ? { timeoutMs, env } : { timeoutMs });

	const status = await git([
		"status",
		"--porcelain=v1",
		"--untracked-files=all",
		"--branch",
	]);
	if (status.code !== 0) {
		throw new Error(`cannot read ${worktree} status: ${commandDetail(status)}`);
	}
	const lines = status.stdout.split("\n").filter((line) => line !== "");
	const paths = lines.filter((line) => !line.startsWith("## "));
	if (paths.length === 0) return null;

	const headResult = await git(["rev-parse", "HEAD"]);
	if (headResult.code !== 0) {
		throw new Error(
			`cannot resolve HEAD in ${worktree}: ${commandDetail(headResult)}`,
		);
	}
	const head = headResult.stdout.trim();
	const now = input.now ?? new Date();
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const dir = input.dir ?? wipStateDir();
	const name = `${slug(basename(input.baseRepo))}-${slug(input.branch)}-${stamp}`;
	mkdirSync(dir, { recursive: true });
	const patchPath = join(dir, `${name}.patch`);
	const statusPath = join(dir, `${name}.status`);
	const indexFile = join(dir, `${name}.index`);

	let patch = "";
	const env = { ...process.env, GIT_INDEX_FILE: indexFile };
	try {
		const seeded = await git(["read-tree", "HEAD"], env);
		if (seeded.code !== 0) {
			throw new Error(`cannot seed WIP index: ${commandDetail(seeded)}`);
		}
		const staged = await git(["add", "-A"], env);
		if (staged.code !== 0) {
			throw new Error(`cannot stage WIP snapshot: ${commandDetail(staged)}`);
		}
		const diff = await git(
			["diff", "--cached", "--binary", "--no-color", "HEAD"],
			env,
		);
		if (diff.code !== 0) {
			throw new Error(`cannot write WIP patch: ${commandDetail(diff)}`);
		}
		patch = diff.stdout;
	} finally {
		rmSync(indexFile, { force: true });
	}

	writeFileSync(patchPath, patch);
	writeFileSync(
		statusPath,
		[
			"# OAW WIP snapshot",
			`repo: ${input.baseRepo}`,
			`worktree: ${worktree}`,
			`branch: ${input.branch}`,
			`head: ${head}`,
			`captured: ${now.toISOString()}`,
			`dirty: ${paths.length}`,
			"",
			"# git status --porcelain (tracked + untracked, без ignored)",
			...lines,
			"",
			"# восстановление в новом worktree той же базы:",
			`#   git -C <worktree> apply --3way ${patchPath}`,
			"# ignored-файлы (node_modules и т.п.) в патч не входят.",
			"",
		].join("\n"),
	);

	return {
		patchPath,
		statusPath,
		repo: input.baseRepo,
		branch: input.branch,
		head,
		files: paths.length,
		patchBytes: Buffer.byteLength(patch, "utf8"),
	};
}
