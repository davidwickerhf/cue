// Reads the advance width of every printable Latin character from the bundled
// motion graphic fonts (src/assets/motion-fonts/*.ttf) into
// electron/core/fontMetrics.json, so layouts can measure text exactly without
// loading fonts (compiling runs in the main process and the window alike).
//   node scripts/build-font-metrics.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.join(import.meta.dirname, "..", "src", "assets", "motion-fonts");
const out = path.join(import.meta.dirname, "..", "electron", "core", "fontMetrics.json");

function tables(buf) {
	const count = buf.readUInt16BE(4);
	const map = {};
	for (let i = 0; i < count; i++) {
		const at = 12 + i * 16;
		map[buf.toString("latin1", at, at + 4)] = buf.readUInt32BE(at + 8);
	}
	return map;
}

/** Unicode → glyph index, from the first format 4 subtable. */
function cmap(buf, offset) {
	const n = buf.readUInt16BE(offset + 2);
	for (let i = 0; i < n; i++) {
		const sub = offset + buf.readUInt32BE(offset + 4 + i * 8 + 4);
		if (buf.readUInt16BE(sub) !== 4) continue;
		const segX2 = buf.readUInt16BE(sub + 6);
		const ends = sub + 14;
		const starts = ends + segX2 + 2;
		const deltas = starts + segX2;
		const ranges = deltas + segX2;
		return (code) => {
			for (let s = 0; s < segX2 / 2; s++) {
				const end = buf.readUInt16BE(ends + s * 2);
				if (code > end) continue;
				const start = buf.readUInt16BE(starts + s * 2);
				if (code < start) return 0;
				const delta = buf.readInt16BE(deltas + s * 2);
				const range = buf.readUInt16BE(ranges + s * 2);
				if (!range) return (code + delta) & 0xffff;
				const glyph = buf.readUInt16BE(ranges + s * 2 + range + (code - start) * 2);
				return glyph ? (glyph + delta) & 0xffff : 0;
			}
			return 0;
		};
	}
	throw new Error("No format 4 cmap");
}

const metrics = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".ttf")).sort()) {
	const buf = readFileSync(path.join(dir, file));
	const t = tables(buf);
	const em = buf.readUInt16BE(t.head + 18);
	const hmetrics = buf.readUInt16BE(t.hhea + 34);
	const glyphOf = cmap(buf, t.cmap);
	const advance = (glyph) => buf.readUInt16BE(t.hmtx + Math.min(glyph, hmetrics - 1) * 4);
	const chars = {};
	// Printable ASCII and Latin-1, plus curly quotes and dashes.
	const codes = [
		...Array.from({ length: 95 }, (_, i) => 32 + i),
		...Array.from({ length: 96 }, (_, i) => 160 + i),
		0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x00d7,
	];
	for (const code of codes) {
		const glyph = glyphOf(code);
		if (glyph) chars[String.fromCharCode(code)] = Math.round((advance(glyph) / em) * 1000) / 1000;
	}
	metrics[file.replace(/\.ttf$/, "")] = chars;
}
writeFileSync(out, `${JSON.stringify(metrics)}\n`);
console.log(`Wrote ${Object.keys(metrics).length} fonts to ${path.relative(process.cwd(), out)}`);
