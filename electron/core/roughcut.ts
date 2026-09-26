import type { TranscriptWord } from "./types";

/**
 * Rough cut from a script: finds where each line was said in transcribed
 * media, on device, by aligning words. No model needed, so it works offline
 * and gives the same answer every time.
 */

/** Lowercase words without punctuation; plurals and "'s" folded so small wording changes still match. */
export function tokenise(text: string): string[] {
	return text
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/['’]/g, "")
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.map(stem);
}

function stem(word: string): string {
	if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
	if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
	return word;
}

export interface RoughSource {
	assetId: string;
	words: TranscriptWord[];
	durationMs: number;
}

export interface LineMatch {
	assetId: string;
	/** Inclusive word indices in the source transcript. */
	fromWord: number;
	toWord: number;
	/** Source time of the matched speech, padded. */
	startMs: number;
	endMs: number;
	/** 0–1: how much of the line was found and how tightly. */
	confidence: number;
	/** What was actually said. */
	text: string;
}

const MATCH = 2;
const MISMATCH = -1;
// Skipping a word costs less than a wrong word, so a line survives a short aside ("can now").
const GAP = -0.6;

/**
 * Best local alignment (Smith–Waterman) of a line against one transcript:
 * rewards words in order, tolerates a few extra or missing words.
 */
function align(line: string[], tokens: string[]) {
	const n = line.length;
	const m = tokens.length;
	// Two rows of scores plus a full traceback table (small: lines are short).
	const back = new Uint8Array((n + 1) * (m + 1));
	let prev = new Float64Array(m + 1);
	let cur = new Float64Array(m + 1);
	let best = { score: 0, i: 0, j: 0 };
	for (let i = 1; i <= n; i++) {
		cur[0] = 0;
		for (let j = 1; j <= m; j++) {
			const diag = prev[j - 1] + (line[i - 1] === tokens[j - 1] ? MATCH : MISMATCH);
			const up = prev[j] + GAP;
			const left = cur[j - 1] + GAP;
			let score = 0;
			let dir = 0;
			if (diag > score) {
				score = diag;
				dir = 1;
			}
			if (up > score) {
				score = up;
				dir = 2;
			}
			if (left > score) {
				score = left;
				dir = 3;
			}
			cur[j] = score;
			back[i * (m + 1) + j] = dir;
			if (score > best.score) best = { score, i, j };
		}
		[prev, cur] = [cur, prev];
	}
	if (best.score <= 0) return null;
	let { i, j } = best;
	let matches = 0;
	let first = j;
	while (i > 0 && j > 0) {
		const dir = back[i * (m + 1) + j];
		if (dir === 0) break;
		if (dir === 1) {
			if (line[i - 1] === tokens[j - 1]) matches++;
			first = j;
			i--;
			j--;
		} else if (dir === 2) i--;
		else {
			first = j;
			j--;
		}
	}
	return { score: best.score, matches, from: first - 1, to: best.j - 1 };
}

/** Finds where a line was said across the sources, or null when nothing fits well enough. */
export function matchLine(
	text: string,
	sources: RoughSource[],
	options: { padMs?: number; minConfidence?: number } = {},
): LineMatch | null {
	const line = tokenise(text);
	if (!line.length) return null;
	const padMs = options.padMs ?? 150;
	const minConfidence = options.minConfidence ?? 0.5;
	let found: (LineMatch & { score: number }) | null = null;
	for (const source of sources) {
		// A transcript word can hold several tokens ("well-known"); remember whose each is.
		const tokens: string[] = [];
		const owner: number[] = [];
		source.words.forEach((w, index) => {
			for (const t of tokenise(w.text)) {
				tokens.push(t);
				owner.push(index);
			}
		});
		if (!tokens.length) continue;
		const hit = align(line, tokens);
		if (!hit || hit.matches === 0) continue;
		const span = hit.to - hit.from + 1;
		// Dice-style: all of the line, said without detours, scores 1.
		const confidence = (2 * hit.matches) / (line.length + span);
		// One stray shared word ("the") is not a match for a longer line.
		if (line.length > 2 && hit.matches < 2) continue;
		if (confidence < minConfidence) continue;
		if (
			found &&
			(confidence < found.confidence ||
				(confidence === found.confidence && hit.score <= found.score))
		)
			continue;
		const fromWord = owner[hit.from];
		const toWord = owner[hit.to];
		const words = source.words;
		// Pad into the silence around the words, never into the neighbouring words.
		const before = words[fromWord - 1]?.endMs ?? 0;
		const after = words[toWord + 1]?.startMs ?? (source.durationMs || Number.POSITIVE_INFINITY);
		found = {
			assetId: source.assetId,
			fromWord,
			toWord,
			startMs: Math.round(Math.max(0, before, words[fromWord].startMs - padMs)),
			endMs: Math.round(Math.min(after, words[toWord].endMs + padMs)),
			confidence: Math.round(confidence * 100) / 100,
			text: words
				.slice(fromWord, toWord + 1)
				.map((w) => w.text)
				.join(" "),
			score: hit.score,
		};
	}
	if (!found) return null;
	const { score: _score, ...match } = found;
	return match;
}

/** Matches every line, in order. */
export function planRoughCut(
	lines: string[],
	sources: RoughSource[],
	options: { padMs?: number; minConfidence?: number } = {},
): { line: string; match: LineMatch | null }[] {
	return lines.map((line) => ({ line, match: matchLine(line, sources, options) }));
}
