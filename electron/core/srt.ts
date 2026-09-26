import type { LineInput } from "./project";

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function toMs(stamp: string): number {
	const match = TIME.exec(stamp);
	if (!match) throw new Error(`Invalid SRT timestamp "${stamp}".`);
	const [, h, m, s, frac] = match;
	return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(frac.padEnd(3, "0"));
}

/**
 * Turns subtitles into script lines. Each cue's length becomes the target; the
 * gap until the next cue becomes the maximum, so a slower read still fits.
 */
export function parseSrt(text: string, idPrefix = "L"): LineInput[] {
	const blocks = text.replace(/\r/g, "").trim().split(/\n\s*\n/);
	const cues = blocks
		.map((block) => block.split("\n"))
		.map((rows) => {
			const timeRow = rows.findIndex((row) => row.includes("-->"));
			if (timeRow < 0) return null;
			const [start, end] = rows[timeRow].split("-->").map((part) => toMs(part.trim()));
			return { start, end, text: rows.slice(timeRow + 1).join(" ").trim() };
		})
		.filter((cue): cue is { start: number; end: number; text: string } => cue !== null && cue.text.length > 0)
		.sort((a, b) => a.start - b.start);

	return cues.map((cue, index) => {
		const next = cues[index + 1];
		const targetMs = Math.max(1, cue.end - cue.start);
		const maxMs = next ? Math.max(targetMs, next.start - cue.start) : targetMs + 2000;
		return {
			id: `${idPrefix}${String(index + 1).padStart(2, "0")}`,
			text: cue.text,
			startMs: cue.start,
			targetMs,
			maxMs,
		};
	});
}
