/**
 * Music-driven montage: picture cut exactly on the beat, cycling through the
 * footage and taking a different part of it each time.
 */

export interface MontageSource {
	assetId: string;
	kind: "video" | "image";
	/** 0 for images. */
	durationMs: number;
	/** Shot changes (source ms), so a cut can start on a fresh shot. */
	scenes?: number[];
}

export interface MontageClip {
	assetId: string;
	/** Timeline position. */
	startMs: number;
	durationMs: number;
	/** Source in-point (0 for images). */
	inMs: number;
	/** Above 1 only when a video is shorter than its beat slot. */
	speed: number;
	kind: "video" | "image";
}

export interface MontagePlan {
	/** Where the music starts in its source, so timeline 0 lands on a beat. */
	musicInMs: number;
	/** Timeline length, ending on a cut. */
	durationMs: number;
	clips: MontageClip[];
}

/**
 * Plans the cuts. `beats` are the music's beats in its source time; a cut
 * falls on every `every`-th beat, up to `lengthMs` of timeline (or the end of
 * the music).
 */
export function planMontage(input: {
	beats: number[];
	musicDurationMs: number;
	sources: MontageSource[];
	every?: number;
	lengthMs?: number;
}): MontagePlan {
	const every = Math.max(1, input.every ?? 2);
	const sources = input.sources.filter((s) => s.kind === "image" || s.durationMs > 0);
	const beats = [...input.beats].sort((a, b) => a - b);
	if (beats.length < 2) throw new Error("Not enough beats to cut to.");
	if (!sources.length) throw new Error("No pictures to cut to the music.");
	const musicInMs = beats[0];
	const available = input.musicDurationMs - musicInMs;
	const limit = Math.min(input.lengthMs ?? available, available);
	// Cut points on the timeline: every Nth beat, within the length.
	const cuts: number[] = [0];
	for (let i = every; i < beats.length; i += every) {
		const at = beats[i] - musicInMs;
		if (at > limit + 1) break;
		cuts.push(Math.round(at));
	}
	if (cuts.length < 2) throw new Error("The music is too short for that many beats per cut.");
	const used = new Map<string, { from: number; to: number }[]>();
	const clips: MontageClip[] = [];
	for (let k = 0; k + 1 < cuts.length; k++) {
		const slot = cuts[k + 1] - cuts[k];
		const clip = pick(sources, k, slot, used);
		clips.push({ ...clip, startMs: cuts[k], durationMs: slot });
	}
	return { musicInMs, durationMs: cuts.at(-1) as number, clips };
}

/** The next source in turn, and a part of it not used yet. */
function pick(
	sources: MontageSource[],
	k: number,
	slot: number,
	used: Map<string, { from: number; to: number }[]>,
): Omit<MontageClip, "startMs" | "durationMs"> {
	// Round-robin, but prefer a video that still has an unused stretch long enough.
	for (let step = 0; step < sources.length; step++) {
		const s = sources[(k + step) % sources.length];
		if (s.kind === "image") return { assetId: s.assetId, kind: "image", inMs: 0, speed: 1 };
		const inMs = freshStart(s, slot, used.get(s.assetId) ?? []);
		if (inMs === null) continue;
		used.set(s.assetId, [...(used.get(s.assetId) ?? []), { from: inMs, to: inMs + slot }]);
		return { assetId: s.assetId, kind: "video", inMs, speed: 1 };
	}
	// Everything is used up: repeat the longest video from where it was least used.
	const s = sources[k % sources.length];
	if (s.durationMs >= slot) {
		const inMs = Math.round(((k * 0.37) % 1) * (s.durationMs - slot));
		return { assetId: s.assetId, kind: "video", inMs, speed: 1 };
	}
	// Shorter than the slot: stretch it (slow motion) so the cut still lands on the beat.
	return {
		assetId: s.assetId,
		kind: "video",
		inMs: 0,
		speed: Math.max(0.1, Math.floor((s.durationMs / slot) * 100) / 100),
	};
}

/** First start (a shot change, then an even grid) whose slot fits and overlaps nothing used. */
function freshStart(
	s: MontageSource,
	slot: number,
	used: { from: number; to: number }[],
): number | null {
	if (s.durationMs < slot) return null;
	const last = s.durationMs - slot;
	// A little after each shot change, so the cut doesn't catch the last frame of the one before.
	const scenes = [0, ...(s.scenes ?? []).map((t) => t + 80)].filter((t) => t <= last);
	const grid: number[] = [];
	for (let t = 0; t <= last; t += slot) grid.push(t);
	for (const start of [...scenes, ...grid]) {
		const from = Math.round(start);
		if (!used.some((u) => from < u.to && from + slot > u.from)) return from;
	}
	return null;
}
