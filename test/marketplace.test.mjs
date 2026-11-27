/**
 * `.omp-plugin/marketplace.json` — каталог для `omp plugin marketplace add`.
 *
 * Формат принадлежит OMP: имя и owner обязательны, `source` — строка,
 * начинающаяся с `./`, иначе каталог не резолвится (см. OMP 19.1.1
 * catalog parser). Тест держит каталог в согласии с `package.json`, чтобы
 * версия в витрине не расходилась с версией плагина.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = join(ROOT, ".omp-plugin", "marketplace.json");

function loadJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function catalog() {
	return loadJson(CATALOG);
}

describe("marketplace catalog", () => {
	it("declares the catalog identity OMP requires", () => {
		const data = catalog();
		assert.match(data.name, /^[a-z0-9][a-z0-9._-]*$/);
		assert.equal(typeof data.owner, "object");
		assert.equal(typeof data.owner.name, "string");
		assert.ok(data.owner.name.length > 0);
		assert.ok(Array.isArray(data.plugins));
		assert.ok(data.plugins.length > 0);
	});

	it("points every plugin at a real plugin directory in this repo", () => {
		for (const plugin of catalog().plugins) {
			assert.match(plugin.name, /^[a-z0-9][a-z0-9._-]*$/);
			assert.equal(typeof plugin.source, "string");
			assert.ok(
				plugin.source.startsWith("./"),
				`${plugin.name}: source must start with "./"`,
			);
			const dir = resolve(ROOT, plugin.source);
			assert.ok(
				dir === ROOT || dir.startsWith(`${ROOT}/`),
				`${plugin.name}: source escapes the repository`,
			);
			assert.ok(existsSync(dir) && statSync(dir).isDirectory());
			const manifest = join(dir, "package.json");
			assert.ok(existsSync(manifest), `${plugin.name}: package.json missing`);
			const pkg = loadJson(manifest);
			assert.equal(pkg.name, plugin.name);
			assert.equal(typeof pkg.omp, "object");
		}
	});

	it("keeps the catalog version equal to the plugin version", () => {
		const pkg = loadJson(join(ROOT, "package.json"));
		for (const plugin of catalog().plugins) {
			assert.equal(plugin.version, pkg.version);
		}
	});

	it("has unique plugin names (case-insensitive, as OMP checks)", () => {
		const names = catalog().plugins.map((plugin) =>
			plugin.name.toLowerCase(),
		);
		assert.equal(new Set(names).size, names.length);
	});

	it("advertises an https homepage", () => {
		for (const plugin of catalog().plugins) {
			assert.match(plugin.homepage, /^https:\/\//);
		}
	});
});
