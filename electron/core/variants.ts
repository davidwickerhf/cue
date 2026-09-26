import { applyOp } from "./ops";
import { clipEnd, projectDuration } from "./project";
import type { MediaClip, ProjectData } from "./types";

/**
 * Other versions of an edit, made without touching the open timeline: another
 * frame shape (vertical, square, wide) and shorter cuts (15, 30, 60 seconds).
 */

export const ASPECTS = {
	"9:16": { width: 1080, height: 1920, label: "Vertical 9:16" },
	"1:1": { width: 1080, height: 1080, label: "Square 1:1" },
	"4:5": { width: 1080, height: 1350, label: "Portrait 4:5" },
	"16:9": { width: 1920, height: 1080, label: "Wide 16:9" },
} as const;
export type Aspect = keyof typeof ASPECTS;

/**
 * The edit in another frame shape. Pictures that filled the old frame fill the
 * new one (centre crop, like reframe); titles keep their place as shares of
 * the frame.
 */
export function reframeData(data: ProjectData, aspect: Aspect): ProjectData {
	const { width, height } = ASPECTS[aspect];
	const canvas = width / height;
	let next = applyOp(unlockAll(data), { type: "setCanvas", canvas: { width, height } }).data;
	for (const clip of next.clips) {
		if (clip.type !== "media" || Math.abs(clip.transform.scale - 1) > 0.001) continue;
		const asset = next.assets.find((a) => a.id === clip.assetId);
		const track = next.tracks.find((t) => t.id === clip.trackId);
		if (!asset || track?.kind !== "video" || !asset.width || !asset.height) continue;
		const source = asset.width / asset.height;
		const cover = Math.max(source / canvas, canvas / source);
		next = applyOp(next, {
			type: "updateClip",
			id: clip.id,
			patch: { transform: { scale: Math.round(cover * 1000) / 1000, x: 0.5, y: 0.5 } },
		}).data;
	}
	return relock(next, data);
}

/**
 * The edit cut down to at most `targetMs`. With `keep` (e.g. the best moments
 * chosen by a model) only those stretches stay, in order; otherwise the edit
 * ends at the last cut before the target (or at the target if that cut is too
 * early). The ending fades out.
 */
export function shortenData(
	data: ProjectData,
	targetMs: number,
	keep?: { startMs: number; endMs: number }[],
): ProjectData {
	const length = projectDuration(data);
	if (length <= targetMs) return data;
	let next = unlockAll(data);
	if (keep?.length) {
		const ranges = [...keep].sort((a, b) => a.startMs - b.startMs);
		const drop: { startMs: number; endMs: number }[] = [];
		let at = 0;
		for (const r of ranges) {
			if (r.startMs > at + 1) drop.push({ startMs: at, endMs: r.startMs });
			at = Math.max(at, r.endMs);
		}
		if (at < length) drop.push({ startMs: at, endMs: length });
		if (drop.length) next = applyOp(next, { type: "removeRanges", ranges: drop }).data;
	}
	const now = projectDuration(next);
	if (now > targetMs) {
		const cuts = [...new Set(next.clips.flatMap((c) => [c.startMs, clipEnd(c)]))].filter(
			(t) => t <= targetMs && t >= targetMs * 0.6,
		);
		const end = cuts.length ? Math.max(...cuts) : targetMs;
		next = applyOp(next, { type: "removeRanges", ranges: [{ startMs: end, endMs: now }] }).data;
	}
	// A gentle ending: whatever reaches the end fades out.
	const end = projectDuration(next);
	for (const clip of next.clips) {
		if (clip.type !== "media" || clipEnd(clip) < end - 1) continue;
		const fade = Math.min(600, clip.durationMs / 2);
		if ((clip as MediaClip).fadeOutMs < fade)
			next = applyOp(next, {
				type: "updateClip",
				id: clip.id,
				patch: { fadeOutMs: Math.round(fade) },
			}).data;
	}
	return relock(next, data);
}

/** Ops refuse to touch locked tracks; a variant is a copy, so it may. */
function unlockAll(data: ProjectData): ProjectData {
	return { ...data, tracks: data.tracks.map((t) => ({ ...t, locked: false })) };
}

/** Puts back the locks the original tracks had. */
function relock(next: ProjectData, original: ProjectData): ProjectData {
	return {
		...next,
		tracks: next.tracks.map((t) => ({
			...t,
			locked: original.tracks.find((o) => o.id === t.id)?.locked ?? false,
		})),
	};
}

/** A file-name-friendly label, e.g. "9x16 30s". */
export function variantLabel(aspect?: Aspect, lengthSec?: number): string {
	return [aspect?.replace(":", "x"), lengthSec ? `${lengthSec}s` : ""].filter(Boolean).join(" ");
}
