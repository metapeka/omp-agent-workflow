/**
 * Read-only список `refs/omp-worktree-backup/*`.
 *
 * Backup-ref пишет `removeWorktree` перед удалением worktree: коммиты
 * переживают cleanup и `git gc`. Команда ничего не меняет — только
 * показывает tip'ы, subject и дату; восстановление описано в
 * `docs/recovery.md`.
 */
import { resolve } from "node:path";

import { PlanError, readPlan } from "./plan.ts";
import { resolveBaseRepo, runCommand } from "./worktrees.ts";

export const BACKUP_REF_PREFIX = "refs/omp-worktree-backup/";

export interface BackupRefEntry {
	/** Полное имя ref, например `refs/omp-worktree-backup/feat-x-1795755435123`. */
	ref: string;
	/** Имя ветки без префикса и метки времени (`feat/x` из `feat-x-<epoch-ms>`). */
	branch: string;
	sha: string;
	short: string;
	subject: string;
	committedAt: string;
}

export interface BackupRefsReport {
	schemaVersion: 1;
	dir: string;
	baseRepo: string;
	refs: BackupRefEntry[];
}

/**
 * План читается только ради `config.baseRepo`; нет плана — base repo
 * выводится из git (`--git-common-dir`). Ничего не пишет.
 */
export async function backupRefs(options: {
	dir: string;
	planPath?: string;
}): Promise<BackupRefsReport> {
	const dir = resolve(options.dir);
	let configured: string | null = null;
	try {
		configured = readPlan(
			resolve(dir, options.planPath ?? "AUTOPLAN.md"),
		).config.baseRepo;
	} catch (error) {
		if (!(error instanceof PlanError)) throw error;
	}
	const baseRepo = await resolveBaseRepo(dir, configured);
	const result = await runCommand(
		"git",
		[
			"-C",
			baseRepo,
			"for-each-ref",
			"--sort=-committerdate",
			`--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(contents:subject)`,
			BACKUP_REF_PREFIX,
		],
		{ timeoutMs: 60_000 },
	);
	if (result.code !== 0) {
		throw new Error(
			`cannot list ${BACKUP_REF_PREFIX}: ${
				(result.stderr || result.stdout).trim() || `exit ${result.code}`
			}`,
		);
	}
	const refs = result.stdout
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line): BackupRefEntry => {
			const [ref = "", sha = "", committedAt = "", subject = ""] =
				line.split("\0");
			const slug = ref.slice(BACKUP_REF_PREFIX.length).replace(/-\d{10,}$/, "");
			return {
				ref,
				branch: slug,
				sha,
				short: sha.slice(0, 7),
				subject,
				committedAt,
			};
		});
	return { schemaVersion: 1, dir, baseRepo, refs };
}
