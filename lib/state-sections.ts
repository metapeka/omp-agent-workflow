/**
 * Ключевые разделы `HANDOFF.md` (README: цель, состояние, решения, файлы,
 * проверки, следующий шаг). Проверка advisory: заголовки узнаются по
 * синонимам, включая английские; содержимое код-блоков не считается.
 *
 * Нестандартный формат без единого узнаваемого раздела — отдельный случай:
 * вызывающий печатает одну строку вместо шести, чтобы чужой шаблон не
 * утонул в предупреждениях.
 */

export type StateSectionKey =
	| "goal"
	| "state"
	| "decisions"
	| "files"
	| "checks"
	| "next";

export const STATE_SECTION_ORDER: readonly StateSectionKey[] = [
	"goal",
	"state",
	"decisions",
	"files",
	"checks",
	"next",
];

export const STATE_SECTION_LABELS: Record<StateSectionKey, string> = {
	goal: "цель",
	state: "состояние",
	decisions: "решения",
	files: "файлы",
	checks: "проверки",
	next: "дальше",
};

const PATTERNS: Record<StateSectionKey, RegExp> = {
	goal: /цел|goal|purpose|objective|мисси/i,
	state: /состоян|готов|статус|прогресс|итог|state|status|progress|summary/i,
	decisions: /решени|договор|decision|\badr\b|(?:^|\W)d\d+\b/i,
	files: /файл|где что|структур|layout|files?|paths?|modules?|компонент/i,
	checks: /проверк|тест|check|test|verif|валидац/i,
	next: /следующ|дальше|next|todo|roadmap|шаг/i,
};

export interface StateSections {
	found: StateSectionKey[];
	missing: StateSectionKey[];
}

/** Заголовки ATX вне fenced-блоков; инлайн-разметка срезается. */
function headings(text: string): string[] {
	const result: string[] = [];
	let fence: string | null = null;
	for (const line of text.split(/\r?\n/)) {
		const fenceLine = /^\s*(`{3,}|~{3,})/.exec(line);
		if (fenceLine) {
			const marker = fenceLine[1][0];
			if (fence === null) fence = marker;
			else if (fence === marker) fence = null;
			continue;
		}
		if (fence !== null) continue;
		const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading) result.push(heading[1].replace(/[`*_]/g, ""));
	}
	return result;
}

export function scanStateSections(text: string): StateSections {
	const found = new Set<StateSectionKey>();
	for (const heading of headings(text)) {
		for (const key of STATE_SECTION_ORDER) {
			if (PATTERNS[key].test(heading)) found.add(key);
		}
	}
	return {
		found: STATE_SECTION_ORDER.filter((key) => found.has(key)),
		missing: STATE_SECTION_ORDER.filter((key) => !found.has(key)),
	};
}
