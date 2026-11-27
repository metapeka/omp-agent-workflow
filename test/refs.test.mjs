/**
 * `omp-orchestrate refs`: read-only список backup-ref удалённых worktree.
 *
 * Backup-ref пишет `removeWorktree`; команда только показывает tip'ы и
 * ничего не меняет (восстановление — docs/recovery.md).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { backupRefs } from "../lib/orchestrator/refs.ts";
import { runCommand } from "../lib/orchestrator/worktrees.ts";

const BIN = fileURLToPath(new URL("../bin/omp-orchestrate", import.meta.url));
const tempDirs = [];

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "omp-refs-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

async function mustRun(command, args, cwd) {
	const result = await runCommand(command, args, { cwd, timeoutMs: 120_000 });
	assert.equal(
		result.code,
		0,
		`${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
	);
	return result;
}

async function gitRepo() {
	const dir = tempDir();
	await mustRun("git", ["init", "-b", "main", dir]);
	await mustRun("git", ["-C", dir, "config", "user.email", "test@example.com"]);
	await mustRun("git", ["-C", dir, "config", "user.name", "Test"]);
	writeFileSync(join(dir, "README.md"), "base\n");
	await mustRun("git", ["-C", dir, "add", "."]);
	await mustRun("git", ["-C", dir, "commit", "-m", "base work"]);
	return dir;
}

describe("backup refs", () => {
	it("lists backup refs with branch, short sha, subject and date", async () => {
		const base = await gitRepo();
		await mustRun("git", [
			"-C",
			base,
			"update-ref",
			"refs/omp-worktree-backup/feat-alpha-1795755435123",
			"HEAD",
		]);
		await mustRun("git", [
			"-C",
			base,
			"update-ref",
			"refs/omp-worktree-backup/feat-beta-1795755435999",
			"HEAD",
		]);

		const report = await backupRefs({ dir: base });
		assert.equal(report.schemaVersion, 1);
		assert.equal(report.baseRepo, resolve(base));
		assert.equal(report.refs.length, 2);
		const branches = report.refs.map((ref) => ref.branch).sort();
		assert.deepEqual(branches, ["feat-alpha", "feat-beta"]);
		for (const ref of report.refs) {
			assert.match(ref.ref, /^refs\/omp-worktree-backup\//);
			assert.equal(ref.sha.length, 40);
			assert.equal(ref.short, ref.sha.slice(0, 7));
			assert.equal(ref.subject, "base work");
			assert.match(ref.committedAt, /^\d{4}-\d{2}-\d{2}T/);
		}
	});

	it("returns an empty list when no worktree was ever removed", async () => {
		const base = await gitRepo();
		const report = await backupRefs({ dir: base });
		assert.deepEqual(report.refs, []);
	});

	it("prints the same report as JSON from the CLI", async () => {
		const base = await gitRepo();
		await mustRun("git", [
			"-C",
			base,
			"update-ref",
			"refs/omp-worktree-backup/feat-gone-1795755435123",
			"HEAD",
		]);
		const result = spawnSync(
			process.execPath,
			[BIN, "refs", "--json", "--dir", base],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		const payload = JSON.parse(result.stdout);
		assert.equal(payload.schemaVersion, 1);
		assert.equal(payload.refs.length, 1);
		assert.equal(payload.refs[0].branch, "feat-gone");

		const text = spawnSync(process.execPath, [BIN, "refs", "--dir", base], {
			encoding: "utf8",
		});
		assert.equal(text.status, 0, text.stderr);
		assert.match(text.stdout, /backup refs: 1/);
		assert.match(text.stdout, /feat-gone/);
	});
});
