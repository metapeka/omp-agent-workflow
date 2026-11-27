/**
 * Меню preflight: проверки предлагаются только при запускаемых скриптах.
 * Раньше `checks` стоял «всегда» и в репозитории без package.json давал
 * гарантированный `⦸ проверки: пропущено`.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
	actionsForPreflight,
	readCheckScripts,
	runPreflight,
} from "../index.ts";

function dir(files = {}) {
	const base = mkdtempSync(join(tmpdir(), "oaw-preflight-actions-"));
	for (const [name, body] of Object.entries(files)) {
		writeFileSync(join(base, name), body);
	}
	return base;
}

describe("preflight actions", () => {
	it("offers checks when package.json has test or typecheck", () => {
		const cwd = dir({
			"package.json": JSON.stringify({ scripts: { test: "node -v" } }),
		});
		assert.deepEqual(
			actionsForPreflight(runPreflight(cwd, null), cwd).map(
				(action) => action.id,
			),
			["checks"],
		);
	});

	it("does not offer checks without package.json", () => {
		const cwd = dir();
		assert.deepEqual(actionsForPreflight(runPreflight(cwd, null), cwd), []);
		assert.equal(readCheckScripts(cwd).problem, "missing");
	});

	it("does not offer checks when test/typecheck scripts are absent", () => {
		const cwd = dir({
			"package.json": JSON.stringify({ scripts: { build: "true" } }),
		});
		assert.deepEqual(actionsForPreflight(runPreflight(cwd, null), cwd), []);
	});

	it("offers checks for a broken package.json so the failure is visible", () => {
		const cwd = dir({ "package.json": "{oops" });
		assert.equal(readCheckScripts(cwd).problem, "invalid");
		assert.deepEqual(
			actionsForPreflight(runPreflight(cwd, null), cwd).map(
				(action) => action.id,
			),
			["checks"],
		);
	});
});
