/**
 * Session info для automatic handoff.
 *
 * Один cwd может обслуживать несколько TUI-сессий и одноразовые запуски,
 * поэтому 0.5.16 хранит массив записей, а не один объект: короткий запуск
 * не затирает terminal handle живой сессии.
 */
export interface SessionEntry {
	terminal?: unknown;
	sessionFile?: unknown;
	cwd?: unknown;
	pid?: unknown;
	updatedAt?: unknown;
	[key: string]: unknown;
}

/** PID существует; EPERM — процесс жив, но принадлежит другому пользователю. */
export function pidAlive(pid: unknown): boolean {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function isSessionEntry(value: unknown): value is SessionEntry {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.terminal === "string" ||
		typeof entry.sessionFile === "string"
	);
}

/** Новый `{sessions}` или плоский объект 0.5.15 и раньше. */
export function parseSessionInfo(raw: unknown): SessionEntry[] {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
	const record = raw as Record<string, unknown>;
	if (Array.isArray(record.sessions)) {
		return record.sessions.filter(isSessionEntry);
	}
	return isSessionEntry(record) ? [record] : [];
}

/**
 * Убрать записи мёртвых pid и обновить/добавить запись текущего процесса.
 * `isAlive` — seam для тестов; в расширении передаётся `pidAlive`.
 */
export function mergeSessionInfo(
	entries: SessionEntry[],
	next: SessionEntry,
	isAlive: (pid: unknown) => boolean = pidAlive,
): SessionEntry[] {
	const kept = entries.filter(
		(entry) => entry.pid === next.pid || isAlive(entry.pid),
	);
	const index = kept.findIndex((entry) => entry.pid === next.pid);
	if (index >= 0) kept[index] = next;
	else kept.push(next);
	return kept;
}
