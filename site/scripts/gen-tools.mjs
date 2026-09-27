#!/usr/bin/env node
/**
 * Generates the data behind the docs pages from the app's source, so the docs
 * list exactly what the app does:
 *
 *   src/content/tools.json      every agent tool in electron/control/contract.ts
 *                               (name, description, inputs), grouped by the
 *                               section comments in that file
 *   src/content/app-data.json   keyboard shortcuts (src/lib/shortcuts.ts),
 *                               transitions, title templates, workspaces and
 *                               motion graphic templates and themes
 *
 * Run it from site/ after changing any of those files, and commit the JSON:
 *
 *   npm run gen:docs
 *
 * contract.ts is read as text rather than imported: it pulls in zod and the
 * editing core, which the site does not depend on. The smaller files have no
 * runtime imports and are loaded with Node's built-in TypeScript support
 * (Node 22.18 or later).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(site, "..");
const load = (rel) => import(pathToFileURL(join(repo, rel)).href);

const { TRANSITIONS } = await load("electron/core/transitions.ts");
const { TITLE_IDS, TITLE_TEMPLATES } = await load("electron/core/titles.ts");
const { SHORTCUTS } = await load("src/lib/shortcuts.ts");

const CONSTANTS = {
	TITLE_IDS: [...TITLE_IDS],
	TRANSITION_KINDS: TRANSITIONS.map((t) => t.kind),
};

// --- contract.ts --------------------------------------------------------------

const source = readFileSync(join(repo, "electron/control/contract.ts"), "utf8");
const start = source.indexOf("export const contract = {");
if (start < 0) throw new Error("contract.ts: `export const contract = {` not found");

/** Index of the bracket that closes the one at `open`, skipping strings and comments. */
function matching(text, open) {
	const pairs = { "{": "}", "(": ")", "[": "]" };
	const stack = [];
	for (let i = open; i < text.length; i++) {
		const ch = text[i];
		if (ch === '"' || ch === "'" || ch === "`") {
			i = endOfString(text, i);
			continue;
		}
		if (ch === "/" && text[i + 1] === "/") {
			i = text.indexOf("\n", i);
			continue;
		}
		if (ch === "/" && text[i + 1] === "*") {
			i = text.indexOf("*/", i) + 1;
			continue;
		}
		if (pairs[ch]) stack.push(pairs[ch]);
		else if (ch === stack.at(-1)) {
			stack.pop();
			if (stack.length === 0) return i;
		}
	}
	throw new Error("contract.ts: unbalanced brackets");
}

function endOfString(text, i) {
	const quote = text[i];
	for (let j = i + 1; j < text.length; j++) {
		if (text[j] === "\\") j++;
		else if (text[j] === quote) return j;
	}
	throw new Error("contract.ts: unterminated string");
}

/** The string literal starting at or after `from` (JSON-style escapes). */
function stringAt(text, from) {
	const i = text.slice(from).search(/["'`]/) + from;
	const end = endOfString(text, i);
	const raw = text.slice(i + 1, end);
	return raw.replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n");
}

/** Top-level `key: value` pairs of an object literal body (between its braces). */
function entries(body) {
	const out = [];
	let i = 0;
	while (i < body.length) {
		const rest = body.slice(i);
		const comment = rest.match(/^\s*\/\/[^\n]*\n/);
		if (comment) {
			out.push({ comment: comment[0].trim() });
			i += comment[0].length;
			continue;
		}
		const key = rest.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*/);
		if (!key) {
			i++;
			continue;
		}
		i += key[0].length;
		// The value runs to the next comma at depth 0.
		let j = i;
		for (; j < body.length; j++) {
			const ch = body[j];
			if (ch === '"' || ch === "'" || ch === "`") j = endOfString(body, j);
			else if (ch === "{" || ch === "(" || ch === "[") j = matching(body, j);
			else if (ch === ",") break;
		}
		out.push({ key: key[1], value: body.slice(i, j).trim() });
		i = j + 1;
	}
	return out;
}

/** A readable type for a zod expression, e.g. `number`, `"a" | "b"`, `string[]`. */
function typeOf(expr) {
	const e = expr.replace(/\s+/g, "");
	const enumMatch = e.match(/^z\.enum\((\[[^\]]*\]|[A-Z_]+)\)/);
	if (enumMatch) {
		const values = enumMatch[1].startsWith("[")
			? [...enumMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
			: (CONSTANTS[enumMatch[1]] ?? []);
		return values.length ? values.map((v) => `"${v}"`).join(" | ") : "enum";
	}
	if (/^z\.array\(z\.string\(\)/.test(e)) return "string[]";
	if (/^z\.array\(z\.number\(\)/.test(e)) return "number[]";
	if (/^z\.array\(z\.enum/.test(e)) return `(${typeOf(e.slice("z.array(".length))})[]`;
	if (/^z\.array\(z\.object/.test(e)) return "object[]";
	if (/^z\.array\(/.test(e)) return "array";
	if (/^ids\b/.test(e)) return "string[]";
	if (/^z\.number\(\)\.int\(\)/.test(e)) return "integer";
	if (/^z\.number/.test(e)) return "number";
	if (/^z\.string/.test(e)) return "string";
	if (/^z\.boolean/.test(e)) return "boolean";
	if (/^z\.object/.test(e) || /^z\.record/.test(e)) return "object";
	if (/^line\b/.test(e) || /^lineInputSchema/.test(e)) return "script line";
	if (/^(clipInput|clipPatch|textStyleSchema|settingsSchema|exportSchema|aiSchema)\b/.test(e))
		return "object";
	return "value";
}

function field(key, value) {
	const flat = value.replace(/\s+/g, "");
	const def = flat.match(/\.default\(([^()]*(?:\([^()]*\))?[^()]*)\)/);
	const described = value.match(/\.describe\(\s*(["'`])/);
	return {
		name: key,
		type: typeOf(value),
		required: !/\.optional\(\)|\.default\(/.test(flat),
		...(def ? { default: def[1] } : {}),
		...(/\.nullable\(\)/.test(flat) ? { nullable: true } : {}),
		...(described ? { note: stringAt(value, value.indexOf(".describe(")) } : {}),
	};
}

const body = source.slice(start + "export const contract = ".length);
const close = matching(body, 0);
const groups = [];
for (const entry of entries(body.slice(1, close))) {
	if (entry.comment) {
		const title = entry.comment.replace(/^\/\/\s*-*\s*/, "").replace(/\s*-+\s*$/, "");
		if (title) groups.push({ title, tools: [] });
		continue;
	}
	const obj = entry.value;
	const descAt = obj.search(/description\s*:/);
	const inputAt = obj.search(/input\s*:\s*\{/);
	if (descAt < 0 || inputAt < 0) throw new Error(`contract.ts: can't read ${entry.key}`);
	const brace = obj.indexOf("{", inputAt);
	const inputs = entries(obj.slice(brace + 1, matching(obj, brace)))
		.filter((e) => e.key)
		.map((e) => field(e.key, e.value));
	if (!groups.length) groups.push({ title: "Tools", tools: [] });
	groups.at(-1).tools.push({
		name: entry.key,
		description: stringAt(obj, descAt + "description".length),
		inputs,
	});
}

const count = groups.reduce((n, g) => n + g.tools.length, 0);
writeFileSync(
	join(site, "src/content/tools.json"),
	`${JSON.stringify({ source: "electron/control/contract.ts", count, groups }, null, "\t")}\n`,
);

// --- Other app data -------------------------------------------------------------

const workspaceSource = readFileSync(join(repo, "src/lib/workspace.ts"), "utf8");
const workspaces = [...workspaceSource.matchAll(/(\w+): workspace\("([^"]+)", "([^"]+)"/g)].map(
	(m) => ({ id: m[1], label: m[2], keys: m[3] }),
);

// Motion graphic templates and themes, read as text like contract.ts (they import zod).
const motionSource = readFileSync(join(repo, "electron/core/motionTemplates.ts"), "utf8");
const motionTemplates = [
	...motionSource.matchAll(
		/id: "([^"]+)",\s*name: "([^"]+)",\s*category: "([^"]+)",\s*description:\s*"((?:[^"\\]|\\.)*)",\s*overlay: (true|false)/g,
	),
].map((m) => ({
	id: m[1],
	name: m[2],
	category: m[3],
	description: m[4].replace(/\\(.)/g, "$1"),
	overlay: m[5] === "true",
}));
const motionThemes = [...motionSource.matchAll(/id: "([^"]+)",\s*label: "([^"]+)",\s*bg: "([^"]+)"/g)].map(
	(m) => ({ id: m[1], label: m[2] }),
);
if (!motionTemplates.length || !motionThemes.length)
	throw new Error("motionTemplates.ts: no templates or themes found");

const appData = {
	shortcuts: SHORTCUTS,
	transitions: TRANSITIONS.map((t) => ({ kind: t.kind, label: t.label })),
	titles: TITLE_IDS.map((id) => ({
		id,
		label: TITLE_TEMPLATES[id].label,
		animationIn: TITLE_TEMPLATES[id].animationIn ?? null,
		animationOut: TITLE_TEMPLATES[id].animationOut ?? null,
	})),
	workspaces,
	motionTemplates,
	motionThemes,
};
writeFileSync(join(site, "src/content/app-data.json"), `${JSON.stringify(appData, null, "\t")}\n`);

console.log(
	`tools.json: ${count} tools in ${groups.length} groups; app-data.json: ${SHORTCUTS.length} shortcut groups, ${appData.transitions.length} transitions, ${appData.titles.length} titles, ${workspaces.length} workspaces, ${motionTemplates.length} motion templates`,
);
