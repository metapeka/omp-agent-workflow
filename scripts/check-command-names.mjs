#!/usr/bin/env node
/**
 * Fail when a plugin slash command collides with an OMP builtin name.
 *
 * OMP resolves builtins first and drops extension commands whose names are
 * reserved (ExtensionRunner.getRegisteredCommands), so a collision silently
 * removes a plugin command from the TUI. This check reads the builtin registry
 * that ships with the pinned `@oh-my-pi/pi-coding-agent` dev dependency and
 * compares it with our `registerCommand()` calls.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const omp = join(root, "node_modules", "@oh-my-pi", "pi-coding-agent");

function builtinNames() {
	const dir = join(omp, "src", "slash-commands");
	const names = new Set();
	for (const file of readdirSync(dir)) {
		if (!/^builtin-.*\.ts$/.test(file) || file === "builtin-completions.ts") {
			continue;
		}
		const text = readFileSync(join(dir, file), "utf8");
		for (const match of text.matchAll(/^\s*name:\s*"([a-z0-9-]+)"/gm)) {
			names.add(match[1]);
		}
		for (const match of text.matchAll(/^\s*aliases:\s*\[([^\]]*)\]/gm)) {
			for (const alias of match[1].matchAll(/"([^"]+)"/g)) names.add(alias[1]);
		}
	}
	return names;
}

function pluginCommands() {
	const names = new Set();
	for (const file of ["index.ts", "orchestrator.ts"]) {
		const text = readFileSync(join(root, file), "utf8");
		for (const match of text.matchAll(/registerCommand\(\s*"([^"]+)"/g)) {
			names.add(match[1]);
		}
	}
	return names;
}

const reserved = builtinNames();
const ours = [...pluginCommands()].sort();
const conflicts = ours.filter((name) => reserved.has(name));

console.log(
	`OMP builtins: ${reserved.size} names; plugin commands: ${ours.length}`,
);
for (const name of ours) {
	console.log(`  /${name}${reserved.has(name) ? "  ← CONFLICT" : "  ok"}`);
}
if (conflicts.length > 0) {
	console.error(
		`command name conflict with OMP builtin: ${conflicts.join(", ")}. ` +
			"Rename the plugin command (builtins are resolved first).",
	);
	process.exit(1);
}
