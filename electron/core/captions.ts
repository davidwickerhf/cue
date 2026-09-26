import type { TextClip } from "./types";

const stamp = (ms: number, sep: "," | ".") => {
	const t = Math.max(0, Math.round(ms));
	const h = Math.floor(t / 3600000);
	const m = Math.floor((t % 3600000) / 60000);
	const s = Math.floor((t % 60000) / 1000);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(t % 1000).padStart(3, "0")}`;
};

/** SubRip text for caption clips, in timeline order. */
export function toSrt(clips: TextClip[]): string {
	return [...clips]
		.sort((a, b) => a.startMs - b.startMs)
		.map((c, i) => `${i + 1}\n${stamp(c.startMs, ",")} --> ${stamp(c.startMs + c.durationMs, ",")}\n${c.text.trim()}\n`)
		.join("\n");
}

/** WebVTT text for caption clips. */
export function toVtt(clips: TextClip[]): string {
	const cues = [...clips]
		.sort((a, b) => a.startMs - b.startMs)
		.map((c) => `${stamp(c.startMs, ".")} --> ${stamp(c.startMs + c.durationMs, ".")}\n${c.text.trim()}\n`);
	return `WEBVTT\n\n${cues.join("\n")}`;
}
