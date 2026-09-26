import type { MediaClip, ProjectData } from "./types";

/**
 * Analysis behind Cue's AI tools: beats in music, and a timestamped
 * transcript of the edit that a language model can reason about.
 */

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

export interface Beats {
	bpm: number;
	/** Beat times in the source, in ms. */
	beats: number[];
	/** How clear the pulse is, 0–1 (low for speech or ambient sound). */
	confidence: number;
}

/**
 * Tempo and beat grid from a loudness envelope (`perSecond` values a second):
 * onset strength from rises in log energy, tempo by autocorrelation between
 * 70 and 180 BPM, then the grid phase that lands on the most onsets. Beats are
 * nudged to the nearest onset so they follow a drummer who drifts.
 */
export function detectBeats(envelope: number[], perSecond: number): Beats {
	const n = envelope.length;
	if (n < perSecond * 4) return { bpm: 0, beats: [], confidence: 0 };
	const log = envelope.map((v) => Math.log1p(v));
	const onset = new Float64Array(n);
	for (let i = 1; i < n; i++) onset[i] = Math.max(0, log[i] - log[i - 1]);
	// Remove the local mean so loud passages don't dominate.
	const win = Math.round(perSecond * 0.5);
	const strength = new Float64Array(n);
	let sum = 0;
	for (let i = 0; i < n; i++) {
		sum += onset[i];
		if (i >= win) sum -= onset[i - win];
		strength[i] = Math.max(0, onset[i] - sum / Math.min(i + 1, win));
	}
	const minLag = Math.round((60 / 180) * perSecond);
	const maxLag = Math.round((60 / 70) * perSecond);
	let bestLag = 0;
	let best = 0;
	let total = 0;
	for (let lag = minLag; lag <= maxLag; lag++) {
		let acc = 0;
		for (let i = lag; i < n; i++) acc += strength[i] * strength[i - lag];
		// Mild preference for tempos near 120 BPM, as people tap.
		const bpm = (60 * perSecond) / lag;
		acc *= Math.exp(-(Math.log2(bpm / 120) ** 2) / 2);
		total += acc;
		if (acc > best) {
			best = acc;
			bestLag = lag;
		}
	}
	if (!bestLag || best <= 0) return { bpm: 0, beats: [], confidence: 0 };
	let bestPhase = 0;
	let bestScore = -1;
	for (let phase = 0; phase < bestLag; phase++) {
		let score = 0;
		for (let i = phase; i < n; i += bestLag) score += strength[i];
		if (score > bestScore) {
			bestScore = score;
			bestPhase = phase;
		}
	}
	const radius = Math.max(1, Math.round(bestLag / 6));
	const beats: number[] = [];
	for (let i = bestPhase; i < n; i += bestLag) {
		let at = i;
		for (let j = Math.max(0, i - radius); j <= Math.min(n - 1, i + radius); j++)
			if (strength[j] > strength[at]) at = j;
		beats.push(Math.round((at * 1000) / perSecond));
	}
	const lags = maxLag - minLag + 1;
	const confidence = Math.max(0, Math.min(1, (best / (total / lags) - 1) / 3));
	return { bpm: Math.round(((60 * perSecond) / bestLag) * 10) / 10, beats, confidence };
}

/** Where a source time of an asset appears on the timeline (every use of it). */
export function sourceToTimeline(data: ProjectData, assetId: string, sourceMs: number): number[] {
	return data.clips
		.filter((c): c is MediaClip => c.type === "media" && c.assetId === assetId && !c.disabled)
		.flatMap((c) =>
			sourceMs >= c.inMs && sourceMs < c.inMs + c.durationMs * c.speed
				? [Math.round(c.startMs + (sourceMs - c.inMs) / c.speed)]
				: [],
		);
}

// ---------------------------------------------------------------------------
// Transcript of the edit
// ---------------------------------------------------------------------------

export interface Segment {
	startMs: number;
	endMs: number;
	text: string;
}

/**
 * What is said on the timeline, in timeline time: transcribed words mapped
 * through the clips that use them, grouped into short phrases.
 */
export function editTranscript(data: ProjectData): Segment[] {
	const words: { at: number; end: number; text: string }[] = [];
	for (const asset of data.assets) {
		if (!asset.transcript?.words.length) continue;
		const clips = data.clips.filter(
			(c): c is MediaClip => c.type === "media" && c.assetId === asset.id && !c.disabled,
		);
		for (const clip of clips) {
			for (const w of asset.transcript.words) {
				const mid = (w.startMs + w.endMs) / 2;
				if (mid < clip.inMs || mid >= clip.inMs + clip.durationMs * clip.speed) continue;
				const at = clip.startMs + (w.startMs - clip.inMs) / clip.speed;
				words.push({ at, end: at + (w.endMs - w.startMs) / clip.speed, text: w.text });
			}
		}
	}
	words.sort((a, b) => a.at - b.at);
	const segments: Segment[] = [];
	let current: { startMs: number; endMs: number; words: string[] } | null = null;
	for (const w of words) {
		const gap = current ? w.at - current.endMs : 0;
		if (!current || gap > 700 || current.words.length >= 14) {
			if (current)
				segments.push({
					startMs: Math.round(current.startMs),
					endMs: Math.round(current.endMs),
					text: current.words.join(" "),
				});
			current = { startMs: w.at, endMs: w.end, words: [] };
		}
		current.words.push(w.text.trim());
		current.endMs = w.end;
		if (/[.!?]$/.test(w.text.trim()) && current.words.length >= 4) {
			segments.push({
				startMs: Math.round(current.startMs),
				endMs: Math.round(current.endMs),
				text: current.words.join(" "),
			});
			current = null;
		}
	}
	if (current)
		segments.push({
			startMs: Math.round(current.startMs),
			endMs: Math.round(current.endMs),
			text: current.words.join(" "),
		});
	return segments;
}

/** Transcript lines for a prompt: "[12.4–15.0] text". */
export function transcriptForPrompt(segments: Segment[], limit = 18000): string {
	let out = "";
	for (const s of segments) {
		const line = `[${(s.startMs / 1000).toFixed(1)}–${(s.endMs / 1000).toFixed(1)}] ${s.text}\n`;
		if (out.length + line.length > limit) break;
		out += line;
	}
	return out;
}

/** The first JSON array or object in a model's reply (they like to wrap it in prose or fences). */
export function extractJson<T>(text: string): T {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
	const body = fenced ?? text;
	const start = body.search(/[[{]/);
	if (start < 0) throw new Error("The model did not return JSON.");
	const open = body[start];
	const close = open === "[" ? "]" : "}";
	const end = body.lastIndexOf(close);
	return JSON.parse(body.slice(start, end + 1)) as T;
}
