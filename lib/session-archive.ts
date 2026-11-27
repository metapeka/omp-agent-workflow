/**
 * Best-effort копия session JSONL перед handoff.
 *
 * OMP удаляет JSONL родительской сессии при `newSession`, поэтому «до»-окно
 * `omp-orchestrate economics` после `/handoff-new` иначе не восстановить.
 * Копия только локальная (права 600) и никуда не отправляется; сбой копии
 * не блокирует handoff — marker, supervisor и новая сессия работают как
 * раньше, просто «до» останется неизмеримым.
 *
 * Автоматической чистки нет: срок хранения копий решает владелец.
 */
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface SessionArchiveResult {
	/** Куда скопировано; `null` — копии нет. */
	path: string | null;
	/** `missing`/`empty` — копировать нечего; `error` — сбой. */
	skipped: "missing" | "empty" | "error" | null;
	error: string | null;
	bytes: number;
}

/** `$XDG_STATE_HOME` (или `~/.local/state`) + `omp-agent-workflow/sessions`. */
export function sessionArchiveDir(): string {
	const base =
		process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
	return join(base, "omp-agent-workflow", "sessions");
}

/**
 * Скопировать session-файл в локальный архив. Никогда не бросает: результат
 * описывает, что произошло.
 */
export function archiveSessionFile(
	sessionFile: string | null,
	options: { dir?: string; now?: Date } = {},
): SessionArchiveResult {
	const empty = (
		skipped: "missing" | "empty" | "error",
		error: string | null = null,
	): SessionArchiveResult => ({ path: null, skipped, error, bytes: 0 });

	if (sessionFile === null || sessionFile.trim() === "") {
		return empty("missing");
	}
	try {
		if (!existsSync(sessionFile)) return empty("missing");
		const size = statSync(sessionFile).size;
		if (size === 0) return empty("empty");

		const dir = options.dir ?? sessionArchiveDir();
		mkdirSync(dir, { recursive: true });
		const now = options.now ?? new Date();
		const stem = basename(sessionFile).replace(/\.jsonl$/i, "");
		const timestamp = now.toISOString().replace(/[:.]/g, "-");
		const path = join(dir, `${stem}.handoff-${timestamp}.jsonl`);
		copyFileSync(sessionFile, path);
		chmodSync(path, 0o600);
		return { path, skipped: null, error: null, bytes: size };
	} catch (error) {
		return empty("error", error instanceof Error ? error.message : String(error));
	}
}
