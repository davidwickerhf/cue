/**
 * What to make of a take just recorded: does it fit the line's slot, and if not, what to
 * suggest. Pure, so the dialog and its tests agree.
 */

export type TakeVerdict = "fits" | "long" | "too-long" | "short" | "silent";

export interface TakeReview {
	verdict: TakeVerdict;
	/** One sentence for the dialog. */
	message: string;
	/** What Cue suggests doing with the new take. */
	recommend: "use" | "fit" | "discard";
	/** The edit change that fits the take: ripple from fromMs by deltaMs (+ makes room, − closes a gap). */
	fit?: { fromMs: number; deltaMs: number; label: string };
}

/** The pause kept after a line before the next one starts. */
export const LINE_GAP_MS = 350;

export function reviewTake(input: {
	speechMs: number;
	peakDb: number | null;
	line: { startMs: number; targetMs: number; maxMs: number };
	/** Where the next line starts (none for the last line). */
	nextStartMs?: number;
}): TakeReview {
	const { speechMs, peakDb, line, nextStartMs } = input;
	const s = (ms: number) => `${(Math.abs(ms) / 1000).toFixed(1)} s`;
	if (speechMs < 300 || (peakDb !== null && peakDb < -45))
		return {
			verdict: "silent",
			message: "No speech was heard in this take (check the microphone).",
			recommend: "discard",
		};
	// The room this line really has: up to the next line (with a breath), else its maximum.
	const room = nextStartMs !== undefined ? nextStartMs - line.startMs - LINE_GAP_MS : line.maxMs;
	const over = speechMs - room;
	if (over > 0) {
		const fit =
			nextStartMs !== undefined
				? {
						fromMs: nextStartMs,
						deltaMs: Math.ceil(over / 100) * 100,
						label: `Make room: move everything after this line ${s(over)} later`,
					}
				: undefined;
		// Up to a quarter longer than the slot: worth fitting. More: probably a take to redo.
		if (over <= room * 0.25)
			return {
				verdict: "long",
				message: `${s(speechMs)} of speech runs ${s(over)} past the time before the next line.`,
				recommend: fit ? "fit" : "use",
				fit,
			};
		return {
			verdict: "too-long",
			message: `${s(speechMs)} of speech is ${s(over)} longer than this line's room (${s(room)}). A tighter reading would fit better.`,
			recommend: "discard",
			fit,
		};
	}
	// Much shorter than planned leaves a pause before the next line; offer to close it.
	const slack = room - speechMs;
	if (nextStartMs !== undefined && speechMs < line.targetMs * 0.8 && slack > 800) {
		const close = Math.floor((slack - 300) / 100) * 100;
		return {
			verdict: "short",
			message: `${s(speechMs)} of speech leaves a ${s(slack)} pause before the next line.`,
			recommend: "use",
			fit: {
				fromMs: nextStartMs,
				deltaMs: -close,
				label: `Close the gap: move everything after this line ${s(close)} earlier`,
			},
		};
	}
	return { verdict: "fits", message: `${s(speechMs)} of speech fits this line.`, recommend: "use" };
}
