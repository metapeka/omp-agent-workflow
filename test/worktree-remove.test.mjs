/**
 * removeWorktree: безопасное удаление worktree.
 *
 * Регрессия инцидента 2026-11-23: `orca worktree rm` останавливает PTY
 * удаляемого worktree и убивает живую OMP-сессию SIGTERM. Поэтому живой
 * процесс/терминал и текущий worktree — жёсткий отказ; ветка по умолчанию
 * остаётся, tip сохраняется в backup-ref.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
	branchExists,
	processesInPath,
	removeWorktree,
	runCommand,
} from "../lib/orchestrator/worktrees.ts";

const tempDirs = [];

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "omp-remove-"));
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
	await mustRun("git", ["-C", dir, "commit", "-m", "base"]);
	return dir;
}

async function addWorktree(base, root, branch, options = {}) {
	const path = join(root, branch.replace(/[^A-Za-z0-9._-]+/g, "-"));
	await mustRun("git", [
		"-C",
		base,
		"worktree",
		"add",
		"-b",
		branch,
		path,
		"main",
	]);
	if (options.commit) {
		writeFileSync(join(path, "work.txt"), "work\n");
		await mustRun("git", ["-C", path, "add", "work.txt"]);
		await mustRun("git", ["-C", path, "commit", "-m", "work"]);
	}
	if (options.dirty) writeFileSync(join(path, "dirty.txt"), "dirty\n");
	return path;
}

function removeArgs(base, path, branch, extra = {}) {
	return {
		backend: "git",
		baseRepo: base,
		baseBranch: "main",
		path,
		branch,
		currentWorktree: base,
		terminals: [],
		wipDir: tempDir(),
		...extra,
	};
}

describe("removeWorktree safety", () => {
	it("removes a merged clean worktree, keeps the branch and saves its tip", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const path = await addWorktree(base, root, "feat/merged");
		const tip = (
			await mustRun("git", ["-C", base, "rev-parse", "main"])
		).stdout.trim();

		const result = await removeWorktree(
			removeArgs(base, path, "feat/merged"),
		);
		assert.equal(existsSync(path), false);
		assert.equal(result.branchRetained, true);
		assert.equal(result.branchDeleted, false);
		assert.equal(await branchExists(base, "feat/merged"), true);
		assert.equal(result.tip, tip);
		const backup = await runCommand("git", [
			"-C",
			base,
			"rev-parse",
			"--verify",
			result.backupRef,
		]);
		assert.equal(backup.code, 0);
		assert.equal(backup.stdout.trim(), tip);
	});

	it("refuses an unmerged branch and leaves worktree and branch intact", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const path = await addWorktree(base, root, "feat/unmerged", {
			commit: true,
		});

		await assert.rejects(
			() => removeWorktree(removeArgs(base, path, "feat/unmerged")),
			/not merged/,
		);
		assert.equal(existsSync(path), true);
		assert.equal(await branchExists(base, "feat/unmerged"), true);
	});

	it("refuses a dirty worktree unless force is explicit", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const path = await addWorktree(base, root, "feat/dirty", { dirty: true });

		await assert.rejects(
			() => removeWorktree(removeArgs(base, path, "feat/dirty")),
			/uncommitted changes/,
		);
		assert.equal(existsSync(path), true);

		const forced = await removeWorktree(
			removeArgs(base, path, "feat/dirty", { force: true }),
		);
		assert.equal(existsSync(path), false);
		assert.equal(forced.branchRetained, true);
		assert.equal(await branchExists(base, "feat/dirty"), true);
	});

	it("captures WIP before a forced removal and the patch restores it", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const path = await addWorktree(base, root, "feat/wip");
		writeFileSync(join(path, "README.md"), "changed\n");
		writeFileSync(join(path, "fresh.txt"), "fresh\n");
		mkdirSync(join(path, "sub"));
		writeFileSync(join(path, "sub", "nested.txt"), "nested\n");

		const forced = await removeWorktree(
			removeArgs(base, path, "feat/wip", { force: true }),
		);
		assert.equal(existsSync(path), false);
		assert.ok(forced.wip, "WIP snapshot expected");
		assert.equal(forced.wip.files, 3);
		assert.equal(forced.wip.head.length, 40);
		const patch = readFileSync(forced.wip.patchPath, "utf8");
		assert.match(patch, /\+changed/);
		assert.match(patch, /\+fresh/);
		assert.match(patch, /\+nested/);
		const status = readFileSync(forced.wip.statusPath, "utf8");
		assert.match(status, /branch: feat\/wip/);
		assert.match(status, /git -C <worktree> apply --3way/);

		const restored = await addWorktree(base, root, "feat/restore");
		await mustRun("git", ["-C", restored, "apply", "--3way", forced.wip.patchPath]);
		assert.equal(readFileSync(join(restored, "README.md"), "utf8"), "changed\n");
		assert.equal(readFileSync(join(restored, "fresh.txt"), "utf8"), "fresh\n");
		assert.equal(
			readFileSync(join(restored, "sub", "nested.txt"), "utf8"),
			"nested\n",
		);
	});

	it("writes no WIP snapshot when a forced removal finds a clean tree", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const wipDir = tempDir();
		const path = await addWorktree(base, root, "feat/clean");

		const forced = await removeWorktree(
			removeArgs(base, path, "feat/clean", { force: true, wipDir }),
		);
		assert.equal(existsSync(path), false);
		assert.equal(forced.wip, null);
		assert.equal(existsSync(wipDir), true);
		assert.deepEqual(readdirSync(wipDir), []);
	});

	it("refuses a forced removal when the WIP snapshot cannot be written", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const blocked = join(tempDir(), "not-a-dir");
		writeFileSync(blocked, "occupied\n");
		const path = await addWorktree(base, root, "feat/nosnapshot", {
			dirty: true,
		});

		await assert.rejects(
			() =>
				removeWorktree(
					removeArgs(base, path, "feat/nosnapshot", {
						force: true,
						wipDir: blocked,
					}),
				),
			/EEXIST|ENOTDIR|exist/i,
		);
		assert.equal(existsSync(path), true);
		assert.equal(await branchExists(base, "feat/nosnapshot"), true);
	});

	it("refuses the current worktree", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const path = await addWorktree(base, root, "feat/current");

		await assert.rejects(
			() =>
				removeWorktree(
					removeArgs(base, path, "feat/current", { currentWorktree: path }),
				),
			/current worktree/,
		);
		assert.equal(existsSync(path), true);
		assert.equal(await branchExists(base, "feat/current"), true);
	});

	it(
		"refuses a worktree with a live process (the SIGTERM incident)",
		{ skip: !existsSync("/proc") },
		async () => {
			const base = await gitRepo();
			const root = tempDir();
			const path = await addWorktree(base, root, "feat/live");
			const child = spawn("sleep", ["30"], {
				cwd: path,
				stdio: "ignore",
				detached: true,
			});
			try {
				let pids = [];
				for (let attempt = 0; attempt < 100; attempt += 1) {
					pids = processesInPath(path);
					if (pids.length > 0) break;
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
				assert.ok(pids.includes(child.pid), `pid ${child.pid} not in ${pids}`);

				await assert.rejects(
					() => removeWorktree(removeArgs(base, path, "feat/live")),
					/работает процесс/,
				);
				assert.equal(existsSync(path), true);
				assert.equal(await branchExists(base, "feat/live"), true);
			} finally {
				child.kill("SIGKILL");
			}
		},
	);

	it("refuses a worktree with a live Orca terminal", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const path = await addWorktree(base, root, "feat/terminal");

		await assert.rejects(
			() =>
				removeWorktree(
					removeArgs(base, path, "feat/terminal", {
						terminals: [
							{
								handle: "term_live",
								worktreePath: path,
								connected: true,
								orphaned: false,
							},
						],
					}),
				),
			/терминал Orca/,
		);
		assert.equal(existsSync(path), true);
		assert.equal(await branchExists(base, "feat/terminal"), true);
	});

	it("deletes a merged branch only on explicit deleteBranch with git branch -d", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const path = await addWorktree(base, root, "feat/merged");
		const tip = (
			await mustRun("git", ["-C", base, "rev-parse", "main"])
		).stdout.trim();

		const result = await removeWorktree(
			removeArgs(base, path, "feat/merged", { deleteBranch: true }),
		);
		assert.equal(existsSync(path), false);
		assert.equal(result.branchDeleted, true);
		assert.equal(await branchExists(base, "feat/merged"), false);
		const backup = await runCommand("git", [
			"-C",
			base,
			"rev-parse",
			"--verify",
			result.backupRef,
		]);
		assert.equal(backup.stdout.trim(), tip);
	});

	it("refuses deleteBranch for an unmerged branch", async () => {
		const base = await gitRepo();
		const root = tempDir();
		const path = await addWorktree(base, root, "feat/unmerged", {
			commit: true,
		});

		await assert.rejects(
			() =>
				removeWorktree(
					removeArgs(base, path, "feat/unmerged", { deleteBranch: true }),
				),
			/not merged/,
		);
		assert.equal(existsSync(path), true);
		assert.equal(await branchExists(base, "feat/unmerged"), true);
	});
});
