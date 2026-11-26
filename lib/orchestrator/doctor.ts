/**
 * `doctor`: read-only диагностика среды 0.5 с машинным контрактом v1.
 *
 * Zero runtime deps, без сети, STATE.json и рабочие файлы не меняются.
 * Каждый внешний проб ограничен `timeoutMs` (default 2 с), проверки идут
 * в фиксированном порядке. Отсутствие Orca, agent-team или cache-monitor —
 * warn/skip, не fail: workflow работает без Orca (D11).
 */
import { spawnSync } from "node:child_process";
import {
	accessSync,
	constants,
	existsSync,
	readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
	resolveSettings,
	type WorkflowSettings,
} from "../workflow-settings.ts";
import { readPlan } from "./plan.ts";
import { STATE_FILE, readState } from "./state.ts";
import type { Autoplan } from "./types.ts";
import { resolveWorktreeRoot } from "./worktrees.ts";

export const DOCTOR_SCHEMA_VERSION = 1;
export const HANDOFF_WARN_CHARS = 24_000;
export const PROBE_TIMEOUT_MS = 2_000;
export const PROBE_BUDGET_MS = 9_000;
const TESTED_OMP_MAJOR = 19;
const SUPERVISOR_LOCK = ".omp-handoff-supervisor.lock";
const HANDOFF_FILE = "HANDOFF.md";

export type DoctorLevel = "pass" | "warn" | "skip" | "fail";

export interface DoctorCheck {
	id: string;
	level: DoctorLevel;
	detail: string;
}

export interface DoctorSummary {
	pass: number;
	warn: number;
	skip: number;
	fail: number;
	total: number;
}

export interface DoctorResult {
	schemaVersion: 1;
	ok: boolean;
	strict: boolean;
	summary: DoctorSummary;
	checks: DoctorCheck[];
}

export interface DoctorContext {
	dir: string;
	planPath?: string;
	env?: NodeJS.ProcessEnv;
	strict?: boolean;
	timeoutMs?: number;
}

interface Probe {
	/** Бинаря нет, процесс не стартовал или убит по timeout. */
	unavailable: boolean;
	code: number | null;
	stdout: string;
	stderr: string;
}

interface ProbeContext {
	dir: string;
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
	deadline: number;
}

function probe(
	command: string,
	args: readonly string[],
	ctx: ProbeContext,
): Probe {
	const left = Math.min(ctx.timeoutMs, ctx.deadline - Date.now());
	if (left <= 0) {
		return { unavailable: true, code: null, stdout: "", stderr: "" };
	}
	const result = spawnSync(command, [...args], {
		cwd: ctx.dir,
		env: ctx.env,
		encoding: "utf8",
		timeout: left,
		maxBuffer: 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	const error = result.error as NodeJS.ErrnoException | undefined;
	const unavailable =
		error !== undefined ||
		result.status === null ||
		result.signal !== null;
	return {
		unavailable,
		code: typeof result.status === "number" ? result.status : null,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function redact(value: string, dir: string): string {
	let text = value.replace(/\s+/g, " ").trim();
	text = text.split(resolve(dir)).join(".");
	const home = homedir();
	if (home.length > 1) text = text.split(home).join("~");
	return text;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface PluginEntry {
	name: string;
	version: string;
	path: string | null;
	enabled: boolean;
}

/** `omp plugin list --json`: npm-записи и marketplace-summaries. */
function parsePluginList(text: string): PluginEntry[] {
	const parsed: unknown = JSON.parse(text);
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("plugin list: expected object");
	}
	const entries: PluginEntry[] = [];
	const visit = (value: unknown): void => {
		if (!Array.isArray(value)) return;
		for (const item of value) {
			if (typeof item !== "object" || item === null) continue;
			const record = item as Record<string, unknown>;
			const firstEntry = Array.isArray(record.entries)
				? record.entries.find(
						(entry) => typeof entry === "object" && entry !== null,
					)
				: undefined;
			const summary =
				typeof firstEntry === "object" && firstEntry !== null
					? (firstEntry as Record<string, unknown>)
					: record;
			const name =
				typeof record.name === "string"
					? record.name
					: typeof record.id === "string"
						? record.id
						: null;
			if (name === null) continue;
			entries.push({
				name,
				version:
					typeof summary.version === "string"
						? summary.version
						: typeof record.version === "string"
							? record.version
							: "unknown",
				path: typeof record.path === "string" ? record.path : null,
				enabled:
					summary.enabled !== false && record.enabled !== false,
			});
		}
	};
	for (const value of Object.values(parsed as Record<string, unknown>)) {
		visit(value);
	}
	return entries;
}

function findPlugin(entries: readonly PluginEntry[], name: string): PluginEntry | null {
	return entries.find((entry) => entry.name === name) ?? null;
}

function readPackageVersion(
	dir: string,
): { name: string; version: string } | null {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(dir, "package.json"), "utf8"),
		);
		if (typeof parsed !== "object" || parsed === null) return null;
		const record = parsed as Record<string, unknown>;
		if (typeof record.name !== "string" || typeof record.version !== "string") {
			return null;
		}
		return { name: record.name, version: record.version };
	} catch {
		return null;
	}
}

function pidAlive(pid: unknown): boolean {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function nearestExisting(path: string): string {
	let current = resolve(path);
	while (!existsSync(current)) {
		const parent = resolve(current, "..");
		if (parent === current) return current;
		current = parent;
	}
	return current;
}

function canWrite(path: string): boolean {
	try {
		accessSync(path, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

/** Валидация явных значений против manifest-схемы: enum, тип, min/max. */
function validateSettings(
	settings: Record<string, unknown>,
	schema: Record<string, unknown>,
): string[] {
	const problems: string[] = [];
	for (const [key, value] of Object.entries(settings)) {
		const raw = schema[key];
		if (typeof raw !== "object" || raw === null) continue;
		const spec = raw as Record<string, unknown>;
		const type = spec.type;
		if (type === "boolean" && typeof value !== "boolean") {
			problems.push(`${key}: expected boolean`);
			continue;
		}
		if (type === "string" && typeof value !== "string") {
			problems.push(`${key}: expected string`);
			continue;
		}
		if (type === "enum") {
			const values = Array.isArray(spec.values) ? spec.values : [];
			if (!values.includes(value)) problems.push(`${key}: not in enum`);
			continue;
		}
		if (type === "number") {
			if (typeof value !== "number" || !Number.isFinite(value)) {
				problems.push(`${key}: expected number`);
				continue;
			}
			const min = typeof spec.min === "number" ? spec.min : null;
			const max = typeof spec.max === "number" ? spec.max : null;
			if (min !== null && value < min) problems.push(`${key}: below min`);
			if (max !== null && value > max) problems.push(`${key}: above max`);
		}
	}
	return problems;
}

/** `agent-team status --json` в неизвестной схеме: active/runs/result. */
function ensembleActiveFrom(value: unknown): boolean | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	if (record.active === true) return true;
	if (Array.isArray(record.runs)) {
		return record.runs.some((run) => {
			if (typeof run !== "object" || run === null) return false;
			const item = run as Record<string, unknown>;
			if (item.active === true) return true;
			const status = typeof item.status === "string" ? item.status : "";
			return /^(running|active|in[-_]?progress)$/i.test(status);
		});
	}
	for (const key of ["run", "result"] as const) {
		const nested = ensembleActiveFrom(record[key]);
		if (nested !== null) return nested;
	}
	if (record.active === false) return false;
	return null;
}

export function doctor(ctx: DoctorContext): DoctorResult {
	const dir = resolve(ctx.dir);
	const env = ctx.env ?? process.env;
	const timeoutMs = ctx.timeoutMs ?? PROBE_TIMEOUT_MS;
	const strict = ctx.strict === true;
	const probeCtx: ProbeContext = {
		dir,
		env,
		timeoutMs,
		deadline: Date.now() + PROBE_BUDGET_MS,
	};
	const planPath = resolve(dir, ctx.planPath ?? "AUTOPLAN.md");
	const omp = env.OMP_BIN?.trim() || "omp";

	const checks: DoctorCheck[] = [];
	const run = (
		id: string,
		body: () => { level: DoctorLevel; detail: string },
	): { level: DoctorLevel; detail: string } => {
		let check: DoctorCheck;
		try {
			check = { id, ...body() };
		} catch (error) {
			check = { id, level: "fail", detail: redact(errorText(error), dir) };
		}
		checks.push(check);
		return check;
	};

	let settings: WorkflowSettings | null = null;
	let pluginList: PluginEntry[] | null = null;
	let plan: Autoplan | null = null;
	let stateActive = false;

	run("node.version", () => {
		const major = Number(process.versions.node.split(".")[0]);
		return major >= 22
			? { level: "pass", detail: `node ${process.version}` }
			: {
					level: "fail",
					detail: `node ${process.version}; v22+ required`,
				};
	});

	run("omp.version", () => {
		const result = probe(omp, ["--version"], probeCtx);
		if (result.unavailable) {
			return { level: "fail", detail: "omp CLI not found" };
		}
		if (result.code !== 0) {
			return {
				level: "fail",
				detail: `omp --version exited ${result.code ?? "signal"}`,
			};
		}
		const match = /(\d+)\.(\d+)\.(\d+)/.exec(result.stdout);
		if (!match) {
			return { level: "warn", detail: "omp version is unparseable" };
		}
		const version = `${match[1]}.${match[2]}.${match[3]}`;
		return Number(match[1]) === TESTED_OMP_MAJOR
			? { level: "pass", detail: `omp ${version}` }
			: {
					level: "warn",
					detail: `omp ${version} outside tested ${TESTED_OMP_MAJOR}.x`,
				};
	});

	run("plugin.linked", () => {
		const result = probe(omp, ["plugin", "list", "--json"], probeCtx);
		if (result.unavailable) {
			return { level: "fail", detail: "omp plugin list unavailable" };
		}
		if (result.code !== 0) {
			return {
				level: "fail",
				detail: `omp plugin list exited ${result.code ?? "signal"}`,
			};
		}
		try {
			pluginList = parsePluginList(result.stdout);
		} catch {
			return { level: "fail", detail: "plugin list output is not JSON" };
		}
		const entry = findPlugin(pluginList, "omp-agent-workflow");
		if (!entry) return { level: "fail", detail: "omp-agent-workflow is not linked" };
		if (!entry.enabled) {
			return { level: "fail", detail: "omp-agent-workflow is linked but disabled" };
		}
		return { level: "pass", detail: `linked ${entry.version}` };
	});

	run("plugin.version", () => {
		if (pluginList === null) {
			return { level: "skip", detail: "plugin list unavailable" };
		}
		const entry = findPlugin(pluginList, "omp-agent-workflow");
		if (!entry) return { level: "skip", detail: "plugin not linked" };
		const local = readPackageVersion(dir);
		if (local === null || local.name !== "omp-agent-workflow") {
			return {
				level: "skip",
				detail: "no plugin source package.json in --dir",
			};
		}
		return local.version === entry.version
			? { level: "pass", detail: `${local.version} matches linked` }
			: {
					level: "warn",
					detail: `linked ${entry.version}, source ${local.version}; relink`,
				};
	});

	run("plugin.settings", () => {
		const result = probe(
			omp,
			["plugin", "config", "list", "omp-agent-workflow", "--json"],
			probeCtx,
		);
		if (result.unavailable) {
			settings = resolveSettings({}, env);
			return { level: "fail", detail: "plugin config list unavailable" };
		}
		if (result.code !== 0) {
			settings = resolveSettings({}, env);
			return {
				level: "fail",
				detail: `plugin config list exited ${result.code ?? "signal"}`,
			};
		}
		let parsed: Record<string, unknown>;
		try {
			const raw: unknown = JSON.parse(result.stdout);
			if (typeof raw !== "object" || raw === null) throw new Error("object");
			parsed = raw as Record<string, unknown>;
		} catch {
			settings = resolveSettings({}, env);
			return { level: "fail", detail: "plugin config output is not JSON" };
		}
		const rawSettings =
			typeof parsed.settings === "object" && parsed.settings !== null
				? (parsed.settings as Record<string, unknown>)
				: {};
		const schema =
			typeof parsed.schema === "object" && parsed.schema !== null
				? (parsed.schema as Record<string, unknown>)
				: {};
		settings = resolveSettings(rawSettings, env);
		const schemaKeys = Object.keys(schema);
		if (schemaKeys.length === 0 || !schema.workflowMode) {
			return { level: "fail", detail: "manifest settings schema is empty" };
		}
		const problems = validateSettings(rawSettings, schema);
		if (problems.length > 0) {
			return { level: "fail", detail: problems.join("; ") };
		}
		return {
			level: "pass",
			detail: `${schemaKeys.length} keys, ${Object.keys(rawSettings).length} explicit`,
		};
	});

	run("git.repo", () => {
		const result = probe("git", ["rev-parse", "--show-toplevel"], probeCtx);
		if (result.unavailable) {
			return { level: "fail", detail: "git CLI not found" };
		}
		if (result.code !== 0 || result.stdout.trim().length === 0) {
			return { level: "fail", detail: "not a git repository" };
		}
		return { level: "pass", detail: "git repository" };
	});

	run("git.head", () => {
		const branchResult = probe(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			probeCtx,
		);
		if (branchResult.code !== 0) {
			return { level: "fail", detail: "HEAD is unreadable" };
		}
		const headResult = probe(
			"git",
			["rev-parse", "--short=7", "HEAD"],
			probeCtx,
		);
		const short = headResult.stdout.trim();
		if (headResult.code !== 0 || short.length === 0) {
			return { level: "fail", detail: "HEAD is unreadable" };
		}
		const branch = branchResult.stdout.trim();
		return branch === "HEAD"
			? { level: "pass", detail: `detached ${short}` }
			: { level: "pass", detail: `${branch}@${short}` };
	});

	run("handoff.state", () => {
		if (settings?.workflowMode === "off") {
			return { level: "skip", detail: "workflowMode=off" };
		}
		const path = join(dir, HANDOFF_FILE);
		if (!existsSync(path)) {
			return { level: "warn", detail: `${HANDOFF_FILE} missing` };
		}
		let text: string;
		try {
			text = readFileSync(path, "utf8");
		} catch (error) {
			return { level: "warn", detail: redact(errorText(error), dir) };
		}
		return text.length <= HANDOFF_WARN_CHARS
			? { level: "pass", detail: `${text.length} chars` }
			: {
					level: "warn",
					detail: `${text.length} chars > ${HANDOFF_WARN_CHARS}; trim`,
				};
	});

	run("autoplan", () => {
		if (!existsSync(planPath)) {
			return { level: "skip", detail: "no AUTOPLAN.md; plan optional" };
		}
		try {
			plan = readPlan(planPath);
		} catch (error) {
			const detail =
				error instanceof Error ? redact(errorText(error), dir) : "plan is unreadable";
			return {
				level: "fail",
				detail: detail.split(planPath).join("<plan>"),
			};
		}
		return {
			level: "pass",
			detail: `${plan.tasks.length} task(s), hash ${plan.hash.slice(0, 8)}`,
		};
	});

	run("state", () => {
		const path = join(dir, STATE_FILE);
		if (!existsSync(path)) {
			return { level: "skip", detail: `${STATE_FILE} absent` };
		}
		try {
			const state = readState(path);
			if (state === null) {
				return { level: "skip", detail: `${STATE_FILE} absent` };
			}
			stateActive = state.run?.active === true;
			const current = state.current ? `current ${state.current.id}` : "no current";
			return {
				level: "pass",
				detail: `run ${state.run?.active ? "active" : "inactive"}, ${state.completed.length} done, ${current}`,
			};
		} catch (error) {
			return {
				level: "fail",
				detail: error instanceof Error ? redact(errorText(error), dir) : "state is unreadable",
			};
		}
	});

	run("worktree.root", () => {
		if (plan === null) {
			return { level: "skip", detail: "needs AUTOPLAN.md" };
		}
		const root = resolveWorktreeRoot(dir, plan.config.worktreeRoot);
		if (existsSync(root)) {
			return canWrite(root)
				? { level: "pass", detail: "writable" }
				: { level: "fail", detail: "worktree root is not writable" };
		}
		const parent = nearestExisting(root);
		return canWrite(parent)
			? { level: "pass", detail: "absent; parent writable" }
			: {
					level: "fail",
					detail: "absent; parent is not writable",
				};
	});

	run("orca.cli", () => {
		if (settings?.workflowMode === "off") {
			return { level: "skip", detail: "workflowMode=off" };
		}
		if (settings !== null && !settings.orcaEnabled) {
			return { level: "skip", detail: "orcaEnabled=false" };
		}
		const orca = settings?.orcaCli || env.ORCA_CLI_COMMAND?.trim() || "orca";
		const result = probe(orca, ["status"], probeCtx);
		if (result.unavailable) {
			return { level: "warn", detail: "orca CLI not found; optional" };
		}
		if (result.code !== 0) {
			return {
				level: "warn",
				detail: `orca status exited ${result.code ?? "signal"}; optional`,
			};
		}
		return { level: "pass", detail: "orca available" };
	});

	run("supervisor.lock", () => {
		const mode = settings?.workflowMode ?? "assisted";
		if (mode !== "yoda-supervised") {
			return { level: "skip", detail: `mode ${mode}` };
		}
		const lockPath = join(dir, SUPERVISOR_LOCK, "owner.json");
		if (!existsSync(lockPath)) {
			return { level: "warn", detail: "supervisor not running" };
		}
		let owner: unknown;
		try {
			owner = JSON.parse(readFileSync(lockPath, "utf8"));
		} catch {
			return { level: "warn", detail: "supervisor lock is unreadable" };
		}
		const pid =
			typeof owner === "object" && owner !== null
				? (owner as Record<string, unknown>).pid
				: null;
		return pidAlive(pid)
			? { level: "pass", detail: `pid ${String(pid)}` }
			: { level: "warn", detail: "supervisor lock has dead pid" };
	});

	run("terminal.handle", () => {
		const mode = settings?.workflowMode ?? "assisted";
		if (mode !== "yoda-supervised") {
			return { level: "skip", detail: `mode ${mode}` };
		}
		if (settings !== null && !settings.orcaEnabled) {
			return {
				level: "warn",
				detail: "orcaEnabled=false; automatic handoff disabled",
			};
		}
		const handle = env.ORCA_TERMINAL_HANDLE?.trim();
		return handle
			? { level: "pass", detail: "ORCA_TERMINAL_HANDLE set" }
			: { level: "warn", detail: "ORCA_TERMINAL_HANDLE not set" };
	});

	run("cache.monitor", () => {
		if (pluginList === null) {
			return { level: "skip", detail: "plugin list unavailable" };
		}
		const entry = findPlugin(pluginList, "omp-cache-monitor");
		if (!entry) {
			return { level: "warn", detail: "not installed; needed for 0.6" };
		}
		return entry.enabled
			? { level: "pass", detail: entry.version }
			: { level: "warn", detail: "installed but disabled" };
	});

	run("ensemble.active", () => {
		const result = probe("agent-team", ["status", "--json"], probeCtx);
		if (result.unavailable) {
			return { level: "skip", detail: "agent-team CLI unavailable" };
		}
		if (result.code !== 0) {
			return {
				level: "skip",
				detail: `agent-team status exited ${result.code ?? "signal"}`,
			};
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(result.stdout);
		} catch {
			return { level: "skip", detail: "agent-team status is not JSON" };
		}
		const active = ensembleActiveFrom(parsed);
		if (active === null) {
			return { level: "skip", detail: "unrecognized agent-team status" };
		}
		if (!active) return { level: "pass", detail: "no active ensemble run" };
		if (stateActive) {
			return {
				level: "warn",
				detail: "ensemble run active; STATE.run also active (two owners)",
			};
		}
		return { level: "warn", detail: "ensemble run active" };
	});

	const finalChecks = strict
		? checks.map((check) =>
				check.level === "warn" ? { ...check, level: "fail" as const } : check,
			)
		: checks;
	const summary: DoctorSummary = {
		pass: 0,
		warn: 0,
		skip: 0,
		fail: 0,
		total: finalChecks.length,
	};
	for (const check of finalChecks) summary[check.level] += 1;
	return {
		schemaVersion: DOCTOR_SCHEMA_VERSION,
		ok: summary.fail === 0,
		strict,
		summary,
		checks: finalChecks,
	};
}

/** Однострочный отчёт для TUI/CLI; JSON — контракт, текст — удобство. */
export function renderDoctor(result: DoctorResult): string {
	const lines = [
		`doctor: ${result.ok ? "ok" : "fail"}${result.strict ? " (strict)" : ""}`,
	];
	for (const check of result.checks) {
		lines.push(
			`${check.level.padEnd(5)} ${check.id.padEnd(18)} ${check.detail}`,
		);
	}
	const summary = result.summary;
	lines.push(
		`summary: ${summary.pass} pass, ${summary.warn} warn, ${summary.skip} skip, ${summary.fail} fail of ${summary.total}`,
	);
	return lines.join("\n");
}
