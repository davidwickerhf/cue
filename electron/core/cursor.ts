import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { zoomAt, zoomView } from "./anim";
import type { Keyframe, Zoom } from "./types";

/**
 * The "studio" look of screen recordings (as in Recordly or Screen Studio):
 * the pointer is recorded separately by cue-cursor (native/cue-cursor.swift),
 * then drawn back as a smooth, larger cursor, with zooms that follow the clicks
 * and a ripple on each click. Everything here is ordinary clips, keyframes and
 * zooms, so it can be edited afterwards like anything else.
 */

/** A line from cue-cursor: Unix time in ms, global screen points (origin top left). */
export interface CursorEvent {
	t: number;
	k: "move" | "down" | "up" | "bounds";
	x: number;
	y: number;
	w?: number;
	h?: number;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** When the recording ran, on the same clock as the events (Date.now()). */
export interface RecordingClock {
	startedAt: number;
	/** Paused stretches, which are not in the recording. */
	pauses: { from: number; to: number }[];
}

/** A pointer position in recording time, as shares of the recorded area (may lie outside 0–1). */
export interface CursorPoint {
	atMs: number;
	x: number;
	y: number;
}

// ---------------------------------------------------------------------------
// The helper
// ---------------------------------------------------------------------------

export function cursorBinary(): string | null {
	const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	const candidates = [
		process.env.CUE_CURSOR,
		resources && path.join(resources, "native", "cue-cursor"),
		typeof __dirname === "string" && path.join(__dirname, "..", "build", "native", "cue-cursor"),
		path.join(process.cwd(), "build", "native", "cue-cursor"),
	].filter((p): p is string => !!p);
	return candidates.find((p) => existsSync(p)) ?? null;
}

/** Records the pointer until stop() is called; resolves with every event. */
export function recordCursor(windowId?: number): { stop: () => Promise<CursorEvent[]> } | null {
	const bin = process.platform === "darwin" ? cursorBinary() : null;
	if (!bin) return null;
	const child = spawn(bin, windowId ? ["--window", String(windowId)] : [], {
		stdio: ["pipe", "pipe", "ignore"],
	});
	const events: CursorEvent[] = [];
	let rest = "";
	child.stdout.on("data", (d: Buffer) => {
		const lines = (rest + d.toString("utf8")).split("\n");
		rest = lines.pop() ?? "";
		for (const line of lines) {
			try {
				events.push(JSON.parse(line) as CursorEvent);
			} catch {}
		}
	});
	const closed = new Promise<void>((resolve) => {
		child.on("close", () => resolve());
		child.on("error", () => resolve());
	});
	return {
		stop: async () => {
			child.stdin.end();
			// It exits when its input closes; don't wait forever if it doesn't.
			const timer = setTimeout(() => child.kill(), 1500);
			await closed;
			clearTimeout(timer);
			return events;
		},
	};
}

/** The studio's wallpapers and cursor image: inside the app, or in the repo. */
export function studioDir(): string | null {
	const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	const candidates = [
		resources && path.join(resources, "studio"),
		typeof __dirname === "string" && path.join(__dirname, "..", "resources", "studio"),
		path.join(process.cwd(), "resources", "studio"),
	].filter((p): p is string => !!p);
	return candidates.find((p) => existsSync(path.join(p, "cursor.png"))) ?? null;
}

// ---------------------------------------------------------------------------
// From events to a plan
// ---------------------------------------------------------------------------

/** Recording time of a wall-clock moment, or null while paused or outside the recording. */
export function recordingTime(t: number, clock: RecordingClock): number | null {
	if (t < clock.startedAt) return null;
	let paused = 0;
	for (const p of clock.pauses) {
		if (t >= p.to) paused += p.to - p.from;
		else if (t >= p.from) return null;
	}
	return t - clock.startedAt - paused;
}

/**
 * Pointer path and clicks in recording time, as shares of the recorded area.
 * `region` is the screen's bounds; a recorded window's bounds come with the
 * events (it can move).
 */
export function normalise(
	events: CursorEvent[],
	clock: RecordingClock,
	region: Rect | null,
): { path: CursorPoint[]; clicks: CursorPoint[] } {
	let area = region;
	const path: CursorPoint[] = [];
	const clicks: CursorPoint[] = [];
	let before: CursorEvent | null = null;
	for (const e of [...events].sort((a, b) => a.t - b.t)) {
		if (e.k === "bounds") {
			if (e.w && e.h) area = { x: e.x, y: e.y, w: e.w, h: e.h };
			continue;
		}
		const atMs = recordingTime(e.t, clock);
		if (atMs === null) {
			// Remember where the pointer was when recording started.
			if (e.t < clock.startedAt) before = e;
			continue;
		}
		if (!area) continue;
		if (before && !path.length) {
			path.push({ atMs: 0, x: (before.x - area.x) / area.w, y: (before.y - area.y) / area.h });
			before = null;
		}
		const p = { atMs, x: (e.x - area.x) / area.w, y: (e.y - area.y) / area.h };
		path.push(p);
		if (e.k === "down") clicks.push(p);
	}
	if (before && area && !path.length)
		path.push({ atMs: 0, x: (before.x - area.x) / area.w, y: (before.y - area.y) / area.h });
	return { path, clicks };
}

const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

/**
 * The pointer every `stepMs`, eased like a camera operator's hand: a critically
 * damped spring pulls a smooth position towards the real one, so jitter and
 * jumps become glides. `smoothing` is the spring's time in ms (0 follows exactly).
 */
export function smoothPath(
	path: CursorPoint[],
	durationMs: number,
	smoothing = 90,
	stepMs = 1000 / 30,
): CursorPoint[] {
	if (!path.length) return [];
	const out: CursorPoint[] = [];
	let i = 0;
	let x = path[0].x;
	let y = path[0].y;
	let vx = 0;
	let vy = 0;
	const omega = smoothing > 0 ? 2 / (smoothing / 1000) : 0;
	for (let t = 0; t <= durationMs + 0.5; t += stepMs) {
		while (i + 1 < path.length && path[i + 1].atMs <= t) i++;
		const target = path[i];
		if (!omega) {
			x = target.x;
			y = target.y;
		} else {
			// One step of a critically damped spring (exact for a constant target).
			const dt = stepMs / 1000;
			const e = Math.exp(-omega * dt);
			const step = (pos: number, vel: number, goal: number) => {
				const d = pos - goal;
				const tmp = (vel + omega * d) * dt;
				return [goal + (d + tmp) * e, (vel - omega * tmp) * e] as const;
			};
			[x, vx] = step(x, vx, target.x);
			[y, vy] = step(y, vy, target.y);
			// A pointer that jumped off the recorded area (another screen) jumps back without gliding.
			if (!inside(target)) {
				x = target.x;
				y = target.y;
				vx = 0;
				vy = 0;
			}
		}
		out.push({ atMs: Math.round(t), x, y });
	}
	return out;
}

export interface ZoomOptions {
	/** How far to push in, 1.2–4. */
	scale?: number;
	/** Time before a click to start zooming in. */
	leadMs?: number;
	/** Time after the last click of a run before zooming out. */
	holdMs?: number;
	/** Clicks closer than this (in time) share a zoom. */
	joinMs?: number;
	/** …as long as they are within this distance (shares of the area). */
	joinDistance?: number;
	easeMs?: number;
}

/**
 * Zooms into where the clicks are: a run of clicks close together in time and
 * place becomes one push-in on their centre. Zooms never overlap.
 */
export function autoZooms(
	clicks: CursorPoint[],
	durationMs: number,
	options: ZoomOptions = {},
): Omit<Zoom, "id">[] {
	const scale = options.scale ?? 1.8;
	const lead = options.leadMs ?? 500;
	const hold = options.holdMs ?? 1800;
	const joinMs = options.joinMs ?? 2600;
	const joinDistance = options.joinDistance ?? 0.28;
	const easeMs = options.easeMs ?? 450;
	const runs: CursorPoint[][] = [];
	for (const c of clicks.filter(inside).sort((a, b) => a.atMs - b.atMs)) {
		const run = runs.at(-1);
		const last = run?.at(-1);
		const centre = run && {
			x: run.reduce((n, p) => n + p.x, 0) / run.length,
			y: run.reduce((n, p) => n + p.y, 0) / run.length,
		};
		if (
			run &&
			last &&
			centre &&
			c.atMs - last.atMs < joinMs &&
			Math.hypot(c.x - centre.x, c.y - centre.y) < joinDistance
		)
			run.push(c);
		else runs.push([c]);
	}
	const zooms: Omit<Zoom, "id">[] = [];
	for (const run of runs) {
		let startMs = Math.max(0, run[0].atMs - lead);
		const endMs = Math.min(durationMs, (run.at(-1)?.atMs ?? 0) + hold);
		const prev = zooms.at(-1);
		if (prev && startMs < prev.endMs) {
			// Too close to the last one: that one ends where this one starts.
			const cut = Math.max(prev.startMs + 2 * prev.easeMs, startMs);
			prev.endMs = Math.min(prev.endMs, cut);
			startMs = prev.endMs;
		}
		if (endMs - startMs < 2 * easeMs) continue;
		const x = run.reduce((n, p) => n + p.x, 0) / run.length;
		const y = run.reduce((n, p) => n + p.y, 0) / run.length;
		zooms.push({
			startMs: Math.round(startMs),
			endMs: Math.round(endMs),
			scale,
			x: Math.round(x * 1000) / 1000,
			y: Math.round(y * 1000) / 1000,
			easeMs,
		});
	}
	return zooms;
}

/** Where the recorded picture sits on the canvas, as shares: left, top, width, height. */
export interface Placement {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** A source point (shares of the recording) on the canvas at recording time `atMs`. */
export function onCanvas(
	p: { x: number; y: number },
	atMs: number,
	zooms: Zoom[] | undefined,
	place: Placement,
): { x: number; y: number; zoom: number } {
	const z = zoomView(zoomAt(zooms, atMs));
	return {
		x: place.left + (z.scale * p.x + z.dx) * place.width,
		y: place.top + (z.scale * p.y + z.dy) * place.height,
		zoom: z.scale,
	};
}

export interface CursorOptions {
	/** Cursor height as a share of the canvas height, before zooming. */
	size: number;
	/** The cursor image's size (square) and where its tip is, in its pixels. */
	image: { size: number; tipX: number; tipY: number };
	/** Canvas aspect (width / height). */
	aspect: number;
}

/** One cursor clip: a run of the pointer inside the picture, with its keyframes. */
export interface CursorClip {
	startMs: number;
	durationMs: number;
	keyframes: { x: Keyframe[]; y: Keyframe[]; scale: Keyframe[] };
}

/**
 * Cursor clips that follow the smoothed pointer, through the zooms, drawn at
 * the picture's `place`. The pointer is left out where it is off the picture.
 * Keyframes are thinned to what the eye can see and each clip holds at most
 * `maxKeys`, so expressions stay small on export.
 */
export function cursorClips(
	path: CursorPoint[],
	zooms: Zoom[],
	place: Placement,
	options: CursorOptions,
	maxKeys = 60,
): CursorClip[] {
	const { size, image, aspect } = options;
	// From the tip to the centre of the image, in canvas shares at scale 1.
	const toCentreX = ((image.size / 2 - image.tipX) / image.size) * (size / aspect);
	const toCentreY = ((image.size / 2 - image.tipY) / image.size) * size;
	type P = { atMs: number; x: number; y: number; s: number };
	const runs: P[][] = [];
	let run: P[] | null = null;
	for (const p of path) {
		const c = onCanvas(p, p.atMs, zooms, place);
		const visible =
			inside(p) &&
			c.x >= place.left &&
			c.x <= place.left + place.width &&
			c.y >= place.top &&
			c.y <= place.top + place.height;
		if (!visible) {
			run = null;
			continue;
		}
		const s = size * c.zoom;
		const point = {
			atMs: p.atMs,
			x: c.x + toCentreX * c.zoom,
			y: c.y + toCentreY * c.zoom,
			s,
		};
		if (!run) {
			run = [];
			runs.push(run);
		}
		run.push(point);
	}
	const clips: CursorClip[] = [];
	for (const r of runs) {
		if (r.length < 2) continue;
		const kept = simplify(r, 0.0012);
		// Chunks of at most maxKeys keyframes, each starting where the last ended.
		for (let i = 0; i < kept.length - 1; i += maxKeys - 1) {
			const chunk = kept.slice(i, i + maxKeys);
			const start = chunk[0].atMs;
			const end = chunk.at(-1)?.atMs ?? start;
			if (end - start < 1) continue;
			const key = (atMs: number, value: number): Keyframe => ({
				atMs: atMs - start,
				value: Math.round(value * 10000) / 10000,
				ease: "linear",
			});
			clips.push({
				startMs: start,
				durationMs: end - start,
				keyframes: {
					x: chunk.map((p) => key(p.atMs, p.x)),
					y: chunk.map((p) => key(p.atMs, p.y)),
					scale: chunk.map((p) => key(p.atMs, p.s)),
				},
			});
		}
	}
	return clips;
}

/**
 * Ramer–Douglas–Peucker over position and scale: drops points that lie within
 * `tolerance` of the straight path between the points kept.
 */
export function simplify<P extends { atMs: number; x: number; y: number; s: number }>(
	points: P[],
	tolerance: number,
): P[] {
	if (points.length < 3) return points;
	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;
	const stack: [number, number][] = [[0, points.length - 1]];
	while (stack.length) {
		const [a, b] = stack.pop() as [number, number];
		const A = points[a];
		const B = points[b];
		let worst = -1;
		let far = 0;
		for (let i = a + 1; i < b; i++) {
			const P = points[i];
			const k = (P.atMs - A.atMs) / Math.max(1, B.atMs - A.atMs);
			const d = Math.max(
				Math.abs(P.x - (A.x + (B.x - A.x) * k)),
				Math.abs(P.y - (A.y + (B.y - A.y) * k)),
				Math.abs(P.s - (A.s + (B.s - A.s) * k)),
			);
			if (d > far) {
				far = d;
				worst = i;
			}
		}
		if (worst > 0 && far > tolerance) {
			keep[worst] = 1;
			stack.push([a, worst], [worst, b]);
		}
	}
	return points.filter((_, i) => keep[i]);
}
