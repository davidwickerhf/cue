import { spawn } from "node:child_process";
import { ffmpegPath } from "./media";
import { trackedAt } from "./pin";
import {
	blendAnchoredTracks,
	createObjectTracker,
	createPlaneTracker,
	createScreenFinder,
	type GrayFrame,
	type Pt,
	type Quad,
	type RgbFrame,
	smoothQuads,
} from "./tracker";
import type { Corners, Tracker } from "./types";

export { localMsOf, placement, sourceMsOf, trackedAt } from "./pin";

/**
 * Runs the motion tracker over a clip's picture: frames come from ffmpeg at the
 * project's frame rate (in source time) and a working size, trackers run both
 * ways from every anchor, and the result is kept in shares of the source picture
 * so moving or scaling the clip later doesn't invalidate it. Also maps those
 * corners onto the canvas for pins and follows, and draws review sheets.
 */

/** Width the tracker works at: fine enough for sub-pixel corners at 1080p, fast. */
export const WORK_WIDTH = 960;

type Frame = GrayFrame | RgbFrame;

/** Decodes frames of a file (source ms from `fromMs`, `count` frames at `fps`) at the working size. */
async function decode(
	file: string,
	fromMs: number,
	count: number,
	fps: number,
	size: { width: number; height: number },
	rgb: boolean,
	onFrame: (frame: Frame, index: number) => void,
): Promise<number> {
	const bytes = size.width * size.height * (rgb ? 3 : 1);
	const args = [
		"-hide_banner",
		"-v",
		"error",
		"-ss",
		(fromMs / 1000).toFixed(4),
		"-i",
		file,
		"-an",
		"-vf",
		`fps=${fps},scale=${size.width}:${size.height}:flags=area,format=${rgb ? "rgb24" : "gray"}`,
		"-frames:v",
		String(count),
		"-f",
		"rawvideo",
		"-",
	];
	return new Promise((resolve, reject) => {
		const child = spawn(ffmpegPath(), args);
		let pending: Buffer = Buffer.alloc(0);
		let index = 0;
		let failed: Error | null = null;
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
			while (pending.length >= bytes) {
				const data = new Uint8Array(pending.subarray(0, bytes));
				pending = pending.subarray(bytes);
				try {
					onFrame({ width: size.width, height: size.height, data }, index++);
				} catch (e) {
					failed = e as Error;
					child.kill();
					return;
				}
			}
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (failed) reject(failed);
			else if (code !== 0 && index === 0)
				reject(new Error(`Couldn't read the clip: ${stderr.trim().slice(-300)}`));
			else resolve(index);
		});
	});
}

export interface TrackInput {
	file: string;
	/** The source picture's size. */
	width: number;
	height: number;
	fps: number;
	/** Source ms to track. */
	fromMs: number;
	toMs: number;
	mode: Tracker["mode"];
	color?: string;
	/** Source ms and corners in shares of the source picture. */
	anchors: { atMs: number; corners: Corners }[];
	onProgress?: (fraction: number) => void;
}

export type TrackResult = NonNullable<Tracker["result"]>;

/** Tracks a clip's picture; one result per frame over the range, in source ms and picture shares. */
export async function runTracking(input: TrackInput): Promise<TrackResult> {
	const step = 1000 / input.fps;
	const count = Math.max(1, Math.floor((input.toMs - input.fromMs) / step) + 1);
	const size = {
		width: WORK_WIDTH,
		height: Math.max(2, Math.round((WORK_WIDTH * input.height) / input.width / 2) * 2),
	};
	// The tracker measures from pixel centres; shares measure from the picture's edge.
	const toPx = (c: Corners): Quad =>
		c.map(([x, y]) => [x * size.width - 0.5, y * size.height - 0.5]) as Quad;
	const toShare = (q: Quad): Corners =>
		q.map(([x, y]) => [round((x + 0.5) / size.width), round((y + 0.5) / size.height)]) as Corners;
	const frameOf = (ms: number) =>
		Math.max(0, Math.min(count - 1, Math.round((ms - input.fromMs) / step)));
	const progress = input.onProgress ?? (() => {});
	let quads: (Quad | null)[];
	let confidence: number[];

	if (input.mode === "screen") {
		// Every frame on its own (with the last one as a prior); anchors pin frames by hand.
		const hint = input.anchors[0] ? toPx(input.anchors[0].corners) : null;
		const finder = createScreenFinder({ color: input.color ?? "#00ff00", hint });
		quads = new Array(count).fill(null);
		confidence = new Array(count).fill(0);
		await decode(input.file, input.fromMs, count, input.fps, size, true, (frame, i) => {
			const r = finder.step(frame as RgbFrame);
			quads[i] = r.value;
			confidence[i] = r.confidence;
			if (i % 8 === 0) progress(i / count);
		});
		for (const a of input.anchors) {
			const i = frameOf(a.atMs);
			quads[i] = toPx(a.corners);
			confidence[i] = 1;
		}
	} else {
		if (!input.anchors.length)
			throw new Error("Tracking a surface or an object needs its corners (or box) at one moment.");
		const anchors = [...input.anchors]
			.map((a) => ({ i: frameOf(a.atMs), quad: toPx(a.corners) }))
			.sort((a, b) => a.i - b.i)
			.filter((a, k, all) => k === 0 || a.i !== all[k - 1].i);
		const forward: (Quad | null)[] = new Array(count).fill(null);
		const backward: (Quad | null)[] = new Array(count).fill(null);
		const fConf = new Array(count).fill(0);
		const bConf = new Array(count).fill(0);
		const total = count * 2;
		let done = 0;
		const start = (first: GrayFrame, quad: Quad) =>
			input.mode === "object" ? objectAsPlane(first, quad) : createPlaneTracker(first, quad);
		// Forward from each anchor to the next one (or the end).
		for (let k = 0; k < anchors.length; k++) {
			const from = anchors[k].i;
			const to = k + 1 < anchors.length ? anchors[k + 1].i : count - 1;
			let tracker: { step(f: GrayFrame): { value: Quad | null; confidence: number } } | null = null;
			forward[from] = anchors[k].quad;
			fConf[from] = 1;
			await decode(
				input.file,
				input.fromMs + from * step,
				to - from + 1,
				input.fps,
				size,
				false,
				(frame, j) => {
					if (j === 0) tracker = start(frame as GrayFrame, anchors[k].quad);
					else if (tracker) {
						const r = tracker.step(frame as GrayFrame);
						forward[from + j] = r.value;
						fConf[from + j] = r.confidence;
					}
					if (++done % 8 === 0) progress(done / total);
				},
			);
		}
		// Backward from each anchor to the one before (or the start), in chunks read forwards.
		for (let k = anchors.length - 1; k >= 0; k--) {
			const from = anchors[k].i;
			const to = k > 0 ? anchors[k - 1].i : 0;
			backward[from] = anchors[k].quad;
			bConf[from] = 1;
			let tracker: { step(f: GrayFrame): { value: Quad | null; confidence: number } } | null = null;
			const CHUNK = 48;
			for (let end = from; end > to; end -= CHUNK) {
				const first = Math.max(to, end - CHUNK);
				const frames: GrayFrame[] = [];
				await decode(
					input.file,
					input.fromMs + first * step,
					end - first + 1,
					input.fps,
					size,
					false,
					(f) => {
						frames.push(f as GrayFrame);
					},
				);
				for (let j = frames.length - 1; j >= 0; j--) {
					const i = first + j;
					if (i === from) {
						tracker = start(frames[j], anchors[k].quad);
						continue;
					}
					if (i >= end || !tracker) continue;
					const r = tracker.step(frames[j]);
					backward[i] = r.value;
					bConf[i] = r.confidence;
					if (++done % 8 === 0) progress(done / total);
				}
			}
		}
		const blended = blendAnchoredTracks(
			forward,
			backward,
			fConf,
			bConf,
			anchors.map((a) => a.i),
		);
		quads = blended.quads;
		confidence = blended.confidence;
	}
	// A frame or two the tracker skipped between good ones is filled in between them:
	// as sure as its neighbours, a little less.
	for (let i = 0; i < count; i++) {
		if (quads[i]) continue;
		let p = i - 1;
		while (p >= 0 && !quads[p]) p--;
		let n = i + 1;
		while (n < count && !quads[n]) n++;
		if (p >= 0 && n < count && n - p <= 4)
			confidence[i] = 0.8 * Math.min(confidence[p], confidence[n]);
	}
	// Screens are found afresh each frame, so a little smoothing takes out the jitter;
	// tracked surfaces are already smooth frame to frame.
	const smooth = smoothQuads(quads, input.mode === "screen" ? 0.35 : 0.15);
	progress(1);
	return smooth.map((q, i) => ({
		atMs: Math.round((input.fromMs + i * step) * 10) / 10,
		corners: toShare(q),
		confidence: Math.round(confidence[i] * 100) / 100,
	}));
}

/** An object tracker reporting the box it follows as four corners, like the plane tracker. */
function objectAsPlane(first: GrayFrame, quad: Quad) {
	const xs = quad.map((p) => p[0]);
	const ys = quad.map((p) => p[1]);
	const box = {
		x: Math.min(...xs),
		y: Math.min(...ys),
		width: Math.max(...xs) - Math.min(...xs),
		height: Math.max(...ys) - Math.min(...ys),
	};
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	const tracker = createObjectTracker(first, box);
	return {
		step(frame: GrayFrame) {
			const r = tracker.step(frame);
			if (!r.value) return { value: null, confidence: 0 };
			const { center, scale, rotation } = r.value;
			const a = (rotation * Math.PI) / 180;
			const cos = Math.cos(a) * scale;
			const sin = Math.sin(a) * scale;
			const moved = quad.map(([x, y]) => {
				const dx = x - cx;
				const dy = y - cy;
				return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos] as Pt;
			}) as Quad;
			return { value: moved, confidence: r.confidence };
		},
	};
}

const round = (x: number) => Math.round(x * 100000) / 100000;

/**
 * A review sheet: frames of the tracked clip with the tracked corners drawn
 * (cyan where the tracker was sure, amber when unsure, red where it lost the
 * track), tiled into one PNG.
 */
export async function drawReview(
	file: string,
	picture: { width: number; height: number },
	result: TrackResult,
	times: number[],
	out: string,
	columns: number,
): Promise<void> {
	const w = 480;
	const h = Math.max(2, Math.round((w * picture.height) / picture.width / 2) * 2);
	const frames: Uint8Array[] = [];
	for (const ms of times) {
		let got: Uint8Array | null = null;
		await decode(file, ms, 1, 30, { width: w, height: h }, true, (f) => {
			got = f.data;
		});
		const data = got ?? new Uint8Array(w * h * 3);
		const { corners, confidence } = trackedAt(result, ms);
		const color: [number, number, number] =
			confidence >= 0.6 ? [40, 200, 255] : confidence >= 0.3 ? [255, 190, 40] : [255, 60, 60];
		const pts = corners.map(([x, y]) => [x * w, y * h] as Pt);
		for (let k = 0; k < 4; k++) line(data, w, h, pts[k], pts[(k + 1) % 4], color);
		for (const p of pts) dot(data, w, h, p, color);
		frames.push(data);
	}
	const rows = Math.ceil(frames.length / columns);
	while (frames.length < rows * columns) frames.push(new Uint8Array(w * h * 3).fill(15));
	await new Promise<void>((resolve, reject) => {
		const child = spawn(ffmpegPath(), [
			"-hide_banner",
			"-v",
			"error",
			"-y",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-s",
			`${w}x${h}`,
			"-i",
			"-",
			"-vf",
			`tile=${columns}x${rows}:padding=4:color=0x0f0f11`,
			"-frames:v",
			"1",
			"-q:v",
			"3",
			out,
		]);
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error("Couldn't draw the review.")),
		);
		for (const f of frames) child.stdin.write(f);
		child.stdin.end();
	});
}

function plot(data: Uint8Array, w: number, h: number, x: number, y: number, c: number[]) {
	if (x < 0 || y < 0 || x >= w || y >= h) return;
	const i = (Math.floor(y) * w + Math.floor(x)) * 3;
	data[i] = c[0];
	data[i + 1] = c[1];
	data[i + 2] = c[2];
}

function line(data: Uint8Array, w: number, h: number, a: Pt, b: Pt, c: number[]) {
	const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1;
	for (let k = 0; k <= n; k++) {
		const x = a[0] + ((b[0] - a[0]) * k) / n;
		const y = a[1] + ((b[1] - a[1]) * k) / n;
		plot(data, w, h, x, y, c);
		plot(data, w, h, x + 1, y, c);
		plot(data, w, h, x, y + 1, c);
	}
}

function dot(data: Uint8Array, w: number, h: number, p: Pt, c: number[]) {
	for (let dy = -3; dy <= 3; dy++)
		for (let dx = -3; dx <= 3; dx++)
			if (dx * dx + dy * dy <= 9) plot(data, w, h, p[0] + dx, p[1] + dy, c);
}

/** Fewer keyframes for the same curve: drops those the straight line between their neighbours already puts within `tolerance`. */
export function simplifyKeys<K extends { atMs: number; value: number }>(
	keys: K[],
	tolerance: number,
): K[] {
	if (keys.length <= 2) return keys;
	const keep = new Array(keys.length).fill(false);
	keep[0] = keep[keys.length - 1] = true;
	const stack: [number, number][] = [[0, keys.length - 1]];
	while (stack.length) {
		const [s, e] = stack.pop() as [number, number];
		let worst = -1;
		let at = -1;
		for (let i = s + 1; i < e; i++) {
			const t = (keys[i].atMs - keys[s].atMs) / Math.max(1e-6, keys[e].atMs - keys[s].atMs);
			const err = Math.abs(keys[s].value + (keys[e].value - keys[s].value) * t - keys[i].value);
			if (err > worst) {
				worst = err;
				at = i;
			}
		}
		if (worst > tolerance && at > 0) {
			keep[at] = true;
			stack.push([s, at], [at, e]);
		}
	}
	return keys.filter((_, i) => keep[i]);
}
