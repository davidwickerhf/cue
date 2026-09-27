import { spawn } from "node:child_process";
import { ffmpegPath } from "./media";

/**
 * What happens on screen in a recording, without looking at it with a model: frames are
 * shrunk to a small grey picture, compared with the one before, and the changes are
 * sorted into events an editor acts on (a click's result, a page change, a scroll,
 * typing, the pointer moving, nothing happening). Fast enough for a whole recording.
 */

export type ActivityKind = "screen-change" | "ui-change" | "scroll" | "typing" | "pointer" | "idle";

export interface ActivityEvent {
	kind: ActivityKind;
	/** Source time of the media. */
	atMs: number;
	endMs: number;
	/** Where it happened, as shares of the picture. */
	region?: { x: number; y: number; width: number; height: number };
	/** Scroll: how far the content moved, as a share of the picture's height (+ = content up). */
	scroll?: number;
	/** 0–1: how much of the picture changed (screen and UI changes). */
	strength: number;
}

export const ACTIVITY_WIDTH = 192;
export const ACTIVITY_HEIGHT = 108;

/** Grey frames of the media at `fps`, as raw bytes (w×h each). */
export async function activityFrames(
	file: string,
	opts: { fromMs?: number; toMs?: number; fps?: number } = {},
): Promise<{ frames: Uint8Array[]; fps: number; fromMs: number }> {
	const fps = opts.fps ?? 10;
	const fromMs = opts.fromMs ?? 0;
	const args = [
		"-hide_banner",
		"-loglevel",
		"error",
		...(fromMs ? ["-ss", (fromMs / 1000).toFixed(3)] : []),
		"-i",
		file,
		...(opts.toMs !== undefined ? ["-t", ((opts.toMs - fromMs) / 1000).toFixed(3)] : []),
		"-an",
		"-vf",
		`fps=${fps},scale=${ACTIVITY_WIDTH}:${ACTIVITY_HEIGHT}:flags=area,format=gray`,
		"-f",
		"rawvideo",
		"-",
	];
	const size = ACTIVITY_WIDTH * ACTIVITY_HEIGHT;
	return new Promise((resolve, reject) => {
		const child = spawn(ffmpegPath(), args);
		const frames: Uint8Array[] = [];
		let pending = Buffer.alloc(0);
		let err = "";
		child.stdout.on("data", (chunk: Buffer) => {
			pending = Buffer.concat([pending, chunk]);
			while (pending.length >= size) {
				frames.push(new Uint8Array(pending.subarray(0, size)));
				pending = pending.subarray(size);
			}
		});
		child.stderr.on("data", (c) => {
			err += c;
		});
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve({ frames, fps, fromMs })
				: reject(new Error(`Could not read the video: ${err.slice(-300)}`)),
		);
	});
}

interface FrameChange {
	/** Share of pixels that changed. */
	area: number;
	/** Bounding box of the changed pixels (shares), when any changed. */
	box?: { x0: number; y0: number; x1: number; y1: number };
	/** Best vertical shift (rows, + = content moved up) and how much better it explains the change. */
	shift: number;
	shiftGain: number;
}

const W = ACTIVITY_WIDTH;
const H = ACTIVITY_HEIGHT;
/** A pixel changed when it moved by more than this (0–255): above video noise. */
const PIXEL = 18;

export function compareFrames(prev: Uint8Array, next: Uint8Array): FrameChange {
	let changed = 0;
	let x0 = W;
	let y0 = H;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x;
			if (Math.abs(prev[i] - next[i]) > PIXEL) {
				changed++;
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
		}
	const area = changed / (W * H);
	// Scroll: does moving the old picture up or down by a few rows explain the change?
	let shift = 0;
	let shiftGain = 0;
	if (area > 0.02) {
		const error = (dy: number) => {
			let e = 0;
			let n = 0;
			for (let y = Math.max(0, dy); y < Math.min(H, H + dy); y += 2)
				for (let x = 0; x < W; x += 2) {
					e += Math.abs(prev[y * W + x] - next[(y - dy) * W + x]);
					n++;
				}
			return e / Math.max(1, n);
		};
		const still = error(0);
		let best = still;
		for (let dy = -24; dy <= 24; dy++) {
			if (dy === 0) continue;
			const e = error(dy);
			if (e < best) {
				best = e;
				shift = dy;
			}
		}
		shiftGain = still > 0 ? (still - best) / still : 0;
		if (shiftGain < 0.45) shift = 0;
	}
	return {
		area,
		shift,
		shiftGain,
		...(x1 >= 0 ? { box: { x0: x0 / W, y0: y0 / H, x1: (x1 + 1) / W, y1: (y1 + 1) / H } } : {}),
	};
}

/** Sorts frame-to-frame changes into events (source time). */
export function classifyActivity(
	changes: FrameChange[],
	fps: number,
	fromMs = 0,
	opts: { idleMs?: number } = {},
): ActivityEvent[] {
	const ms = (i: number) => Math.round(fromMs + (i * 1000) / fps);
	const events: ActivityEvent[] = [];
	const idleMs = opts.idleMs ?? 1500;
	let i = 0;
	while (i < changes.length) {
		const c = changes[i];
		// Scroll: consecutive frames explained by a vertical shift.
		if (c.shift !== 0) {
			let j = i;
			let total = 0;
			while (
				j < changes.length &&
				changes[j].shift !== 0 &&
				Math.sign(changes[j].shift) === Math.sign(c.shift)
			) {
				total += changes[j].shift;
				j++;
			}
			events.push({
				kind: "scroll",
				atMs: ms(i),
				endMs: ms(j),
				scroll: total / H,
				strength: Math.min(1, Math.abs(total) / H),
			});
			i = j;
			continue;
		}
		// Most of the picture changes at once: a new page or view.
		if (c.area > 0.35) {
			events.push({
				kind: "screen-change",
				atMs: ms(i),
				endMs: ms(i + 1),
				strength: c.area,
				region: region(c),
			});
			i++;
			continue;
		}
		// A small area changes: a click's result, or typing when it repeats in one place.
		if (c.area > 0.004 && c.box) {
			let j = i + 1;
			let box = c.box;
			let peak = c.area;
			let steps = 1;
			while (
				j < changes.length &&
				changes[j].area > 0.002 &&
				changes[j].shift === 0 &&
				changes[j].area <= 0.35 &&
				changes[j].box
			) {
				const b = changes[j].box as NonNullable<FrameChange["box"]>;
				if (!near(box, b)) break;
				box = {
					x0: Math.min(box.x0, b.x0),
					y0: Math.min(box.y0, b.y0),
					x1: Math.max(box.x1, b.x1),
					y1: Math.max(box.y1, b.y1),
				};
				peak = Math.max(peak, changes[j].area);
				steps++;
				j++;
			}
			const narrow = box.y1 - box.y0 < 0.12;
			events.push({
				kind: steps >= 4 && narrow ? "typing" : "ui-change",
				atMs: ms(i),
				endMs: ms(j),
				strength: peak,
				region: { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 },
			});
			i = j;
			continue;
		}
		// Only a tiny spot changes: the pointer moving.
		if (c.area > 0.0003 && c.box) {
			let j = i + 1;
			while (j < changes.length && changes[j].area > 0.0003 && changes[j].area <= 0.004) j++;
			const last = changes[j - 1].box ?? c.box;
			events.push({
				kind: "pointer",
				atMs: ms(i),
				endMs: ms(j),
				strength: c.area,
				region: region({ ...changes[j - 1], box: last }),
			});
			i = j;
			continue;
		}
		// Nothing: a still stretch, reported when long enough to matter.
		let j = i;
		while (j < changes.length && changes[j].area <= 0.0003) j++;
		if (ms(j) - ms(i) >= idleMs)
			events.push({ kind: "idle", atMs: ms(i), endMs: ms(j), strength: 0 });
		i = Math.max(j, i + 1);
	}
	return events;
}

function region(c: FrameChange) {
	if (!c.box) return undefined;
	return { x: c.box.x0, y: c.box.y0, width: c.box.x1 - c.box.x0, height: c.box.y1 - c.box.y0 };
}

function near(a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a) {
	const pad = 0.08;
	return !(b.x0 > a.x1 + pad || b.x1 < a.x0 - pad || b.y0 > a.y1 + pad || b.y1 < a.y0 - pad);
}

/**
 * Real recordings are noisier than their events: an eased scroll comes out as a run of
 * small shifts with redraws in between, and a page re-rendering touches the whole
 * picture a little at a time. Big "UI changes" become screen changes, and bursts of
 * scroll and screen changes close together become one scroll (when they move the page)
 * or one screen change.
 */
export function tidyActivity(events: ActivityEvent[], gapMs = 400): ActivityEvent[] {
	const big = (e: ActivityEvent) => !!e.region && e.region.width * e.region.height > 0.5;
	const relabelled = events.map((e) =>
		e.kind === "ui-change" && big(e) ? { ...e, kind: "screen-change" as const } : e,
	);
	const out: ActivityEvent[] = [];
	let i = 0;
	while (i < relabelled.length) {
		const e = relabelled[i];
		if (e.kind !== "scroll" && e.kind !== "screen-change") {
			out.push(e);
			i++;
			continue;
		}
		// A burst: scroll and screen changes each starting within gapMs of the last one's end.
		let j = i + 1;
		let end = e.endMs;
		while (
			j < relabelled.length &&
			(relabelled[j].kind === "scroll" || relabelled[j].kind === "screen-change") &&
			relabelled[j].atMs - end <= gapMs
		) {
			end = Math.max(end, relabelled[j].endMs);
			j++;
		}
		const burst = relabelled.slice(i, j);
		const scrolled = burst.reduce((sum, b) => sum + (b.scroll ?? 0), 0);
		if (Math.abs(scrolled) >= 0.05)
			out.push({
				kind: "scroll",
				atMs: e.atMs,
				endMs: end,
				scroll: scrolled,
				strength: Math.min(1, Math.abs(scrolled)),
			});
		else
			out.push({
				kind: "screen-change",
				atMs: e.atMs,
				endMs: end,
				strength: Math.max(...burst.map((b) => b.strength)),
				...(burst.find((b) => b.region)?.region
					? { region: burst.find((b) => b.region)?.region }
					: {}),
			});
		i = j;
	}
	return out;
}

/** Every activity event in a media file (or part of it). */
export async function detectActivity(
	file: string,
	opts: { fromMs?: number; toMs?: number; fps?: number; idleMs?: number } = {},
): Promise<ActivityEvent[]> {
	const { frames, fps, fromMs } = await activityFrames(file, opts);
	const changes = frames.slice(1).map((f, k) => compareFrames(frames[k], f));
	// Change k is between frames k and k+1: it happened at frame k+1.
	return tidyActivity(
		classifyActivity([{ area: 0, shift: 0, shiftGain: 0 }, ...changes], fps, fromMs, opts),
	);
}

/** What an editor usually does with each kind of event. */
export const ACTIVITY_SUGGESTIONS: Record<ActivityKind, string> = {
	"screen-change":
		"a cut point: a soft whoosh or the chapter's title; keep the new screen on long enough to read",
	"ui-change":
		"a click result: a tick or pop just before it, and a zoom (add_zoom) toward its region if it's small",
	scroll: "a soft whoosh under it; long scrolls can be sped up",
	typing: "typing sounds under it; speed up long typing (speed 2–4) or cut to the result",
	pointer: "the pointer moving to something: let a zoom follow it, or cut the wander",
	idle: "nothing happens: cut it (remove_ranges) or speed it up, unless the narration needs the time",
};
