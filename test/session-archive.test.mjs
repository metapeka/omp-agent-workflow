/**
 * archiveSessionFile: локальная копия session JSONL перед handoff.
 *
 * OMP удаляет JSONL родителя при `newSession`; копия — best-effort, 600,
 * без авточистки. Сбой копии не должен бросать исключение.
 */
import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { archiveSessionFile, sessionArchiveDir } from "../lib/session-archive.ts";

const tempDirs = [];

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "omp-archive-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
	delete process.env.XDG_STATE_HOME;
});

describe("session archive", () => {
	it("copies the session file locally with owner-only permissions", () => {
		const source = join(tempDir(), "2026-11-27T05-12-26-135Z_abc.jsonl");
		writeFileSync(source, `${JSON.stringify({ type: "message" })}\n`);
		const dir = tempDir();

		const result = archiveSessionFile(source, {
			dir,
			now: new Date("2026-11-27T12:00:00.000Z"),
		});

		assert.equal(result.skipped, null);
		assert.equal(result.error, null);
		assert.ok(result.path);
		assert.equal(
			basename(result.path),
			"2026-11-27T05-12-26-135Z_abc.handoff-2026-11-27T12-00-00-000Z.jsonl",
		);
		assert.equal(readFileSync(result.path, "utf8"), readFileSync(source, "utf8"));
		assert.equal(statSync(result.path).mode & 0o777, 0o600);
		assert.equal(result.bytes, statSync(source).size);
	});

	it("skips a missing or empty session file without failing", () => {
		const dir = tempDir();
		const missing = archiveSessionFile(join(tempDir(), "nope.jsonl"), { dir });
		assert.deepEqual(missing, {
			path: null,
			skipped: "missing",
			error: null,
			bytes: 0,
		});
		assert.equal(archiveSessionFile(null, { dir }).skipped, "missing");

		const emptyFile = join(tempDir(), "empty.jsonl");
		writeFileSync(emptyFile, "");
		assert.equal(archiveSessionFile(emptyFile, { dir }).skipped, "empty");
		// Каталог архива не наполняется, когда копировать нечего.
		assert.deepEqual(readdirSync(dir), []);
	});

	it("reports a write failure instead of throwing", () => {
		const source = join(tempDir(), "s.jsonl");
		writeFileSync(source, "{}\n");
		const blocked = join(tempDir(), "occupied");
		writeFileSync(blocked, "not a directory\n");

		const result = archiveSessionFile(source, { dir: blocked });
		assert.equal(result.path, null);
		assert.equal(result.skipped, "error");
		assert.match(result.error, /ENOTDIR|EEXIST|not a directory/);
	});

	it("defaults to the XDG state directory", () => {
		const stateHome = tempDir();
		process.env.XDG_STATE_HOME = stateHome;
		assert.equal(
			sessionArchiveDir(),
			join(stateHome, "omp-agent-workflow", "sessions"),
		);
	});
});
