/**
 * Singleton lock для supervisor: один процесс на каталог.
 *
 * Lock-dir лежит рядом с marker: `<dir>/.omp-handoff-supervisor.lock/` с
 * `owner.json` {pid, dir, startedAt}. Stale lock (pid мёртв) перехватывается
 * через rename с проверкой identity: если между чтением owner и rename lock
 * успел взять живой supervisor, его lock возвращается на место.
 */
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function readOwner(lockPath) {
	try {
		return JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"));
	} catch {
		return null;
	}
}

export function pidAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: процесс существует, но принадлежит другому пользователю.
		return error.code === "EPERM";
	}
}

function lockAgeMs(lockPath) {
	try {
		return Date.now() - statSync(lockPath).mtimeMs;
	} catch {
		return 0;
	}
}

function sameOwner(left, right) {
	if (left === null || right === null) return left === right;
	return left.pid === right.pid && left.startedAt === right.startedAt;
}

/**
 * Убрать stale lock. Возвращает "removed", только если удалён именно тот
 * owner, которого проверил вызывающий; "foreign" — lock успел взять живой
 * supervisor (lock возвращён на место); "gone" — lock уже снят.
 */
export function reclaimStaleLock(lockPath, owner) {
	const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
	try {
		renameSync(lockPath, stalePath);
	} catch (error) {
		if (error.code === "ENOENT") return "gone";
		throw error;
	}

	const moved = readOwner(stalePath);
	if (!sameOwner(owner, moved)) {
		try {
			renameSync(stalePath, lockPath);
		} catch {
			// lockPath уже занят; чужой owner остаётся в stalePath (gitignored).
		}
		return "foreign";
	}

	rmSync(stalePath, { recursive: true, force: true });
	return "removed";
}

/**
 * Взять lock.
 *
 * Возвращает `{ok:true}` либо `{ok:false, reason}`:
 * - `running` — lock держит живой процесс;
 * - `initializing` — lock-dir создан, owner.json ещё не записан;
 * - `contended` — три попытки перехвата проиграны другим стартерам.
 *
 * Ошибки файловой системы (ENOENT/EACCES/ENOSPC) пробрасываются: решение
 * о сообщении и коде выхода — за вызывающим.
 */
export function acquireLock({ lockPath, dir, graceMs = 10_000, pid = process.pid }) {
	let created = false;
	let reclaimed = null;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			mkdirSync(lockPath);
			created = true;
			writeFileSync(
				join(lockPath, "owner.json"),
				JSON.stringify({ pid, dir, startedAt: new Date().toISOString() }),
			);
			return { ok: true, reclaimed };
		} catch (error) {
			if (created) {
				// mkdir прошёл, write — нет: не оставляем ownerless lock.
				rmSync(lockPath, { recursive: true, force: true });
				throw error;
			}
			if (error.code !== "EEXIST") throw error;
		}

		const owner = readOwner(lockPath);
		if (owner && pidAlive(owner.pid)) {
			return { ok: false, reason: "running", owner };
		}
		if (!owner && lockAgeMs(lockPath) < graceMs) {
			return { ok: false, reason: "initializing" };
		}
		const outcome = reclaimStaleLock(lockPath, owner);
		if (outcome === "removed") reclaimed = owner;
		if (outcome === "foreign") continue;
	}

	return { ok: false, reason: "contended" };
}

/** Снять lock, только если он всё ещё наш. */
export function releaseLock({ lockPath, pid = process.pid }) {
	const owner = readOwner(lockPath);
	if (owner && owner.pid !== pid) return;
	rmSync(lockPath, { recursive: true, force: true });
}
