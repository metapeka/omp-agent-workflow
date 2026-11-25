/**
 * Advisory `next-session:`: разбор, нормализация, флаги launcher.
 * Без OMP runtime, модели и сети.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	loadModelCatalog,
	nextSessionArgs,
	parseModelCatalog,
	parseNextSession,
} from "../lib/next-session.ts";

const NOW = new Date("2026-11-25T01:00:00Z");
const TS = "2026-11-25T00:40Z";

const CATALOG = parseModelCatalog({
	models: [
		{ selector: "cline-pass/flash", thinking: null },
		{ selector: "cline-pass/pro", thinking: ["high", "xhigh"] },
	],
});

function parse(text, options = {}) {
	return parseNextSession(text, { now: NOW, catalog: CATALOG, ...options });
}

const line = (body) => `next-session: ${body}`;

describe("parseNextSession", () => {
	it("accepts one valid leading line with all known keys", () => {
		const result = parse(
			line(
				`v=1 ts=${TS} model=cline-pass/pro thinking=high mode=plan reason=seams`,
			) + "\n\n# state\n",
		);
		assert.equal(result.status, "ok");
		assert.equal(result.problems.length, 0);
		assert.deepEqual(result.advice, {
			v: 1,
			ts: TS,
			model: "cline-pass/pro",
			thinking: "high",
			mode: "plan",
			reason: "seams",
			extra: {},
		});
	});

	it("ignores both lines when two are present", () => {
		const text = `${line(`v=1 ts=${TS} mode=plan`)}\n# state\n${line(
			`v=1 ts=${TS} mode=review`,
		)}\n`;
		const result = parse(text);
		assert.equal(result.status, "invalid");
		assert.equal(result.advice, null);
		assert.equal(result.problems[0].code, "duplicate");
		assert.match(result.problems[0].text, /строк 2/);
	});

	it("normalizes thinking outside the flash catalog to auto", () => {
		const result = parse(
			line(`v=1 ts=${TS} model=cline-pass/flash thinking=high`),
		);
		assert.equal(result.status, "ok");
		assert.equal(result.advice.thinking, "auto");
		assert.equal(result.problems[0].code, "thinking");
		assert.match(result.problems[0].text, /нормализовано в auto/);
	});

	it("drops an unknown model but keeps other keys", () => {
		const result = parse(
			line(
				`v=1 ts=${TS} model=nonexistent/x thinking=high mode=review`,
			),
		);
		assert.equal(result.status, "ok");
		assert.equal(result.advice.model, undefined);
		assert.equal(result.advice.thinking, "high");
		assert.equal(result.advice.mode, "review");
		assert.equal(result.problems[0].code, "model");
	});

	it("ignores the whole line for v=2", () => {
		const result = parse(line(`v=2 ts=${TS} mode=plan`));
		assert.equal(result.status, "invalid");
		assert.equal(result.advice, null);
		assert.equal(result.problems[0].code, "version");
	});

	it("ignores a recommendation older than 24 hours", () => {
		const result = parse(line("v=1 ts=2026-11-23T00:00Z mode=plan"));
		assert.equal(result.status, "invalid");
		assert.equal(result.problems[0].code, "timestamp");
		assert.match(result.problems[0].text, /старше 24 ч/);
	});

	it("rejects a reason with a space and drops the whole line", () => {
		const result = parse(line(`v=1 ts=${TS} reason=две фазы`));
		assert.equal(result.status, "invalid");
		assert.equal(result.problems[0].code, "syntax");
		assert.match(result.problems[0].text, /недопустимый токен/);
	});

	it("returns none without a line and leaves the file untouched", () => {
		const result = parse("# state\nnext session: without the dash\n");
		assert.equal(result.status, "none");
		assert.equal(result.line, null);
		assert.equal(result.advice, null);
	});

	it("requires the line to be the first line", () => {
		const result = parse(`\n${line(`v=1 ts=${TS} mode=plan`)}\n`);
		assert.equal(result.status, "invalid");
		assert.equal(result.problems[0].code, "position");
	});

	it("rejects duplicate keys", () => {
		const result = parse(line(`v=1 ts=${TS} mode=plan mode=review`));
		assert.equal(result.status, "invalid");
		assert.match(result.problems[0].text, /повторяется/);
	});

	it("keeps unknown keys in their original order", () => {
		const result = parse(line(`v=1 ts=${TS} zeta=1 alpha=2`));
		assert.equal(result.status, "ok");
		assert.deepEqual(Object.keys(result.advice.extra), ["zeta", "alpha"]);
	});

	it("keeps an unchecked model but flags the missing catalog", () => {
		const result = parse(line(`v=1 ts=${TS} model=cline-pass/pro`), {
			catalog: null,
		});
		assert.equal(result.status, "ok");
		assert.equal(result.advice.model, "cline-pass/pro");
		assert.equal(result.problems[0].code, "catalog");
	});

	it("normalizes a thinking level missing from the pro catalog", () => {
		const result = parse(
			line(`v=1 ts=${TS} model=cline-pass/pro thinking=low`),
		);
		assert.equal(result.advice.thinking, "auto");
		assert.equal(result.problems[0].code, "thinking");
	});

	it("drops an invalid mode and reason but keeps the advice", () => {
		const result = parse(
			line(`v=1 ts=${TS} mode=bogus reason=UPPER`),
		);
		assert.equal(result.status, "ok");
		assert.equal(result.advice.mode, undefined);
		assert.equal(result.advice.reason, undefined);
		assert.deepEqual(
			result.problems.map((item) => item.code),
			["mode", "reason"],
		);
	});

	it("rejects impossible calendar dates and far-future timestamps", () => {
		assert.equal(parse(line("v=1 ts=2026-02-31T00:00Z")).status, "invalid");
		const future = parse(line("v=1 ts=2026-11-27T00:00Z"));
		assert.equal(future.status, "invalid");
		assert.match(future.problems[0].text, /в будущем/);
	});

	it("tolerates BOM and CRLF", () => {
		const result = parse(
			`\uFEFF${line(`v=1 ts=${TS} mode=plan`)}\r\n`, 
		);
		assert.equal(result.status, "ok");
		assert.equal(result.advice.mode, "plan");
	});

	it("keeps the advisory inside the 32k state snapshot", () => {
		const body = line(`v=1 ts=${TS} mode=plan reason=head`);
		const text = `${body}\n${"x".repeat(40_000)}`;
		const snapshot = text.slice(0, 32_000);
		assert.ok(snapshot.startsWith(body));
		assert.equal(parse(snapshot).status, "ok");
	});
});

describe("nextSessionArgs", () => {
	const valid = () =>
		parse(
			line(
				`v=1 ts=${TS} model=cline-pass/pro thinking=high mode=plan`,
			),
		);

	it("prepends model and thinking when the user did not set them", () => {
		assert.deepEqual(nextSessionArgs(valid(), []), [
			"--model",
			"cline-pass/pro",
			"--thinking",
			"high",
		]);
	});

	it("lets explicit --model and --thinking win", () => {
		assert.deepEqual(
			nextSessionArgs(valid(), ["--model=other/model", "--thinking", "low"]),
			[],
		);
	});

	it("never applies an unvalidated model", () => {
		const unchecked = parse(line(`v=1 ts=${TS} model=cline-pass/pro`), {
			catalog: null,
		});
		assert.deepEqual(nextSessionArgs(unchecked, []), []);
	});

	it("applies thinking but not an unknown model", () => {
		const unknown = parse(
			line(`v=1 ts=${TS} model=nonexistent/x thinking=high`),
		);
		assert.deepEqual(nextSessionArgs(unknown, []), ["--thinking", "high"]);
	});

	it("returns nothing for a stale or invalid line", () => {
		assert.deepEqual(
			nextSessionArgs(
				parse(line("v=1 ts=2026-11-20T00:00Z model=cline-pass/pro")),
				[],
			),
			[],
		);
	});
});

describe("loadModelCatalog", () => {
	const dirs = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function fakeOmp(script) {
		const dir = mkdtempSync(join(tmpdir(), "cg-catalog-"));
		dirs.push(dir);
		const file = join(dir, "fake-omp");
		writeFileSync(file, `#!/bin/sh\n${script}\n`);
		chmodSync(file, 0o755);
		return file;
	}

	it("parses selectors and thinking arrays from omp models --json", () => {
		const bin = fakeOmp(
			`printf '%s' '{"models":[{"selector":"a/b","thinking":["low"]},{"selector":"c/d","thinking":null}]}'`,
		);
		const catalog = loadModelCatalog(bin);
		assert.deepEqual(catalog, {
			selectors: ["a/b", "c/d"],
			thinking: { "a/b": ["low"], "c/d": null },
		});
	});

	it("returns null for a failing or missing command", () => {
		assert.equal(loadModelCatalog(fakeOmp("exit 3")), null);
		assert.equal(loadModelCatalog("/nonexistent/omp-binary"), null);
	});

	it("returns null for malformed JSON", () => {
		assert.equal(loadModelCatalog(fakeOmp("printf '{oops'")), null);
	});
});

const CLI = fileURLToPath(new URL("../bin/omp-next-session", import.meta.url));
const YODA = fileURLToPath(new URL("../bin/omp-yoda", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const isoNow = () => `${new Date().toISOString().slice(0, 16)}Z`;

const MODELS_JSON =
	'{"models":[{"selector":"cline-pass/pro","thinking":["high","xhigh"]}]}';

function fakeOmp(dir, name = "fake-omp") {
	const file = join(dir, name);
	writeFileSync(
		file,
		`#!/bin/sh
if [ "$1" = "plugin" ] && [ "$2" = "config" ]; then printf '%s' '{"settings":{}}'; exit 0; fi
if [ "$1" = "models" ]; then printf '%s' '${MODELS_JSON}'; exit 0; fi
if [ -n "$OMP_CAPTURE" ]; then printf '%s\\n' "$@" > "$OMP_CAPTURE"; fi
exit 0
`,
	);
	chmodSync(file, 0o755);
	return file;
}

describe("bin/omp-next-session", () => {
	const dirs = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function fixture(body) {
		const dir = mkdtempSync(join(tmpdir(), "cg-advisory-"));
		dirs.push(dir);
		if (body !== null) writeFileSync(join(dir, "HANDOFF.md"), body);
		return { dir, omp: fakeOmp(dir) };
	}

	function run({ dir, omp }, args) {
		const result = spawnSync(
			process.execPath,
			[
				"--experimental-strip-types",
				"--disable-warning=ExperimentalWarning",
				CLI,
				"--dir",
				dir,
				"--omp",
				omp,
				"--",
				...args,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	}

	it("prints model and thinking flags for a fresh advisory", () => {
		const fx = fixture(
			`next-session: v=1 ts=${isoNow()} model=cline-pass/pro thinking=high mode=plan\n# state\n`,
		);
		assert.equal(run(fx, []), "--model\ncline-pass/pro\n--thinking\nhigh");
	});

	it("keeps explicit user flags", () => {
		const fx = fixture(
			`next-session: v=1 ts=${isoNow()} model=cline-pass/pro thinking=high\n# state\n`,
		);
		assert.equal(run(fx, ["--model=other/model"]), "--thinking\nhigh");
	});

	it("stays silent for a stale line or a missing state file", () => {
		const stale = fixture("next-session: v=1 ts=2020-01-01T00:00Z mode=plan\n");
		assert.equal(run(stale, []), "");
		const missing = fixture(null);
		assert.equal(run(missing, []), "");
	});
});

describe("bin/omp-yoda advisory", () => {
	it("prepends validated flags and keeps user args", () => {
		const dir = mkdtempSync(join(tmpdir(), "cg-yoda-"));
		try {
			const binDir = join(dir, "bin");
			mkdirSync(binDir);
			fakeOmp(binDir, "omp");
			writeFileSync(
				join(dir, "HANDOFF.md"),
				`next-session: v=1 ts=${isoNow()} model=cline-pass/pro thinking=high\n# state\n`,
			);
			const capture = join(dir, "args.txt");
			const env = { ...process.env };
			for (const key of [
				"OMP_WORKFLOW_MODE",
				"OMP_HANDOFF_AT",
				"OMP_CONTEXT_AUTO",
				"OMP_CONTEXT_WARN",
				"OMP_CONTEXT_SUGGEST",
				"OMP_STATUS_ENABLED",
				"OMP_ORCA_ENABLED",
				"OMP_ORCA_PREFLIGHT",
				"OMP_SUPERVISOR_ENABLED",
				"OMP_HANDOFF_PROMPT",
				"OMP_SUPERVISOR_RETRIES",
				"OMP_SUPERVISOR_LOG_LEVEL",
				"ORCA_TERMINAL_HANDLE",
			]) {
				delete env[key];
			}
			Object.assign(env, {
				PATH: `${binDir}:${process.env.PATH}`,
				OMP_YODA_DIR: dir,
				OMP_YODA_LOG: join(dir, "supervisor.log"),
				OMP_CAPTURE: capture,
				ORCA_CLI_COMMAND: "/nonexistent/orca",
			});

			const result = spawnSync("bash", [YODA, "hello"], {
				cwd: REPO_ROOT,
				env,
				encoding: "utf8",
				timeout: 60_000,
			});
			assert.equal(result.status, 0, result.stderr);
			assert.equal(readFileSync(capture, "utf8").trim(), [
				"--model",
				"cline-pass/pro",
				"--thinking",
				"high",
				"hello",
			].join("\n"));
			assert.match(result.stderr, /next-session → --model cline-pass\/pro/);
			assert.equal(existsSync(join(dir, ".omp-handoff-supervisor.lock")), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
