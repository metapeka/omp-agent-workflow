/**
 * Type-stripping loader for the packaged CLI entrypoints.
 *
 * Node refuses to strip types from files under `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so `bin/omp-orchestrate`,
 * `bin/omp-next-session` and `bin/omp-preset` register this loader instead of
 * relying on the `--experimental-strip-types` flag. The loader handles
 * exactly `.ts` modules and delegates every other URL to Node's own loader,
 * which keeps the same code running from a clone, an unpacked tarball and an
 * `npm install` tree.
 */
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

function strip(source) {
	// The API emits one ExperimentalWarning per process; CLI stderr stays clean.
	const emitWarning = process.emitWarning;
	process.emitWarning = () => {};
	try {
		return stripTypeScriptTypes(source, { mode: "strip" });
	} finally {
		process.emitWarning = emitWarning;
	}
}

export async function load(url, context, nextLoad) {
	if (url.startsWith("file:") && url.endsWith(".ts")) {
		const source = await readFile(fileURLToPath(url), "utf8");
		return { format: "module", source: strip(source), shortCircuit: true };
	}
	return nextLoad(url, context);
}
