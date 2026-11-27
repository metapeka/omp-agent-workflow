/**
 * Quality gate 0.7.1: распознавание ключевых разделов HANDOFF.md.
 * Проверка advisory — заголовки узнаются по синонимам, код-блоки не в счёт.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scanStateSections } from "../lib/state-sections.ts";

describe("state sections", () => {
	it("finds all six canonical Russian headings", () => {
		const sections = scanStateSections(
			"# Передача\n\n## Цель\n\n## Состояние\n\n## Решения\n\n" +
				"## Файлы\n\n## Проверки\n\n## Дальше\n",
		);
		assert.deepEqual(sections.missing, []);
		assert.equal(sections.found.length, 6);
	});

	it("accepts the English template and inline emphasis", () => {
		const sections = scanStateSections(
			"# Goal\n## **State**\n## Decisions\n## Files\n## Checks\n## Next steps\n",
		);
		assert.deepEqual(sections.missing, []);
	});

	it("recognises the synonyms already used by this project", () => {
		const sections = scanStateSections(
			"# Что готово\n## D11/D12\n## Где что лежит\n## Проверки\n## Следующие шаги\n",
		);
		assert.deepEqual(sections.missing, ["goal"]);
	});

	it("ignores headings inside fenced code blocks", () => {
		const sections = scanStateSections(
			"```md\n## Цель\n## Решения\n```\n\n## Проверки\n",
		);
		assert.deepEqual(sections.found, ["checks"]);
		assert.ok(sections.missing.includes("goal"));
		assert.ok(sections.missing.includes("decisions"));
	});

	it("recognises a foreign handoff template instead of calling it unknown", () => {
		const sections = scanStateSections(
			"# HANDOFF — ACPI OEMID\n" +
				"## 1. Что закрыто в этой сессии\n" +
				"## 2. Главные выводы (не переделывать)\n" +
				"## 3. Что включено прямо сейчас\n" +
				"## 4. Проверено как\n" +
				"## 5. Открыто\n" +
				"## 6. Ловушки\n" +
				"## 7. Что делать первым в новой сессии\n",
		);
		assert.deepEqual(sections.found, ["state", "decisions", "checks", "next"]);
		assert.deepEqual(sections.missing, ["goal", "files"]);
	});

	it("reports an unrecognised custom format as no headings at all", () => {
		const sections = scanStateSections("state: in progress\nfiles: none\n");
		assert.deepEqual(sections.found, []);
		assert.equal(sections.missing.length, 6);
	});
});
