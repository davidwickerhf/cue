import type { Curve, Ease, Keyframe, Wiggle, Zoom } from "./types";

/**
 * Animation maths shared by the preview (browser) and the exporter (ffmpeg
 * expressions), so both produce the same motion. No Node imports here.
 */

export const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Every named ease as the cubic bezier it equals exactly (smoothstep, cubic
 * in and out), so the curve editor can start from one and splits stay exact.
 */
export const EASE_CURVES: Record<Exclude<Ease, "hold" | "bezier">, Curve> = {
	linear: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
	ease: [1 / 3, 0, 2 / 3, 1],
	"ease-in": [1 / 3, 0, 2 / 3, 0],
	"ease-out": [1 / 3, 1, 2 / 3, 1],
};

/** A custom curve without handles yet: CSS's `ease`. */
export const DEFAULT_CURVE: Curve = [0.25, 0.1, 0.25, 1];

/** The bezier a segment follows, or undefined for hold. */
export function curveOf(k: Keyframe): Curve | undefined {
	if (k.ease === "hold") return undefined;
	if (k.ease === "bezier") return k.curve ?? DEFAULT_CURVE;
	return EASE_CURVES[k.ease] ?? EASE_CURVES.ease;
}

/** Polynomial coefficients [a, b, c] of one bezier axis: ((a·s + b)·s + c)·s. */
function coeffs(p1: number, p2: number): [number, number, number] {
	const c = 3 * p1;
	const b = 3 * (p2 - p1) - c;
	return [1 - c - b, b, c];
}

// The bezier is solved for x by halving a bracket BISECT times and then
// interpolating inside it. It is a fixed number of steps so the ffmpeg
// expression below can do exactly the same arithmetic as the preview.
const BISECT = 7;

/** The curve parameter s where the bezier's x equals `p` (0–1). */
function solveBezier(curve: Curve, p: number): number {
	const [a, b, c] = coeffs(curve[0], curve[2]);
	const X = (s: number) => ((a * s + b) * s + c) * s;
	const q = Math.min(1, Math.max(0, p));
	let lo = 0;
	for (let i = 1; i <= BISECT; i++) {
		const mid = lo + 2 ** -i;
		if (X(mid) < q) lo = mid;
	}
	const w = 2 ** -BISECT;
	const x0 = X(lo);
	return lo + ((q - x0) / Math.max(0.000001, X(lo + w) - x0)) * w;
}

/** How far along (0–1, may overshoot) a bezier ease is at time share `p`. */
export function bezierAt(curve: Curve, p: number): number {
	const [a, b, c] = coeffs(curve[1], curve[3]);
	const s = solveBezier(curve, p);
	return ((a * s + b) * s + c) * s;
}

/** How far from one keyframe to the next the value is at time share `p` (0–1). */
export function easeAt(k: Keyframe, p: number): number {
	switch (k.ease) {
		case "hold":
			return 0;
		case "linear":
			return p;
		case "ease-in":
			return p * p * p;
		case "ease-out":
			return 1 - (1 - p) ** 3;
		case "bezier":
			return bezierAt(k.curve ?? DEFAULT_CURVE, p);
		default:
			return smooth(p);
	}
}

/** Value of a keyframed property at clip-local time `t`, or `fallback` without keyframes. */
export function valueAt(keyframes: Keyframe[] | undefined, t: number, fallback: number): number {
	if (!keyframes || keyframes.length === 0) return fallback;
	const points = keyframes;
	if (t <= points[0].atMs) return points[0].value;
	const last = points[points.length - 1];
	if (t >= last.atMs) return last.value;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		if (t < a.atMs || t > b.atMs) continue;
		if (a.ease === "hold") return a.value;
		const p = (t - a.atMs) / Math.max(1, b.atMs - a.atMs);
		return a.value + (b.value - a.value) * easeAt(a, p);
	}
	return last.value;
}

/** Zoom state at clip-local time `t`: scale 1 means no zoom. */
export function zoomAt(
	zooms: Zoom[] | undefined,
	t: number,
): { scale: number; x: number; y: number } {
	if (zooms) {
		for (const z of zooms) {
			if (t < z.startMs || t > z.endMs) continue;
			const ease = Math.max(1, Math.min(z.easeMs, (z.endMs - z.startMs) / 2));
			const p =
				t < z.startMs + ease
					? (t - z.startMs) / ease
					: t > z.endMs - ease
						? (z.endMs - t) / ease
						: 1;
			const k = smooth(Math.max(0, Math.min(1, p)));
			return { scale: 1 + (z.scale - 1) * k, x: 0.5 + (z.x - 0.5) * k, y: 0.5 + (z.y - 0.5) * k };
		}
	}
	return { scale: 1, x: 0.5, y: 0.5 };
}

/**
 * Where a zoom puts the picture, as the export draws it: scaled by `scale` and
 * moved by `dx`, `dy` (shares of the frame) so the focus is centred but the
 * frame stays covered. A source point u shows at scale * u + dx.
 */
export function zoomView(z: { scale: number; x: number; y: number }): {
	scale: number;
	dx: number;
	dy: number;
} {
	const shift = (f: number) => Math.min(0, Math.max(1 - z.scale, 0.5 - z.scale * f));
	return { scale: z.scale, dx: shift(z.x), dy: shift(z.y) };
}

/** Sorted, de-duplicated keyframes with `next` inserted (replacing one within 10 ms). */
export function withKeyframe(list: Keyframe[] | undefined, next: Keyframe): Keyframe[] {
	return [...(list ?? []).filter((k) => Math.abs(k.atMs - next.atMs) > 10), next].sort(
		(a, b) => a.atMs - b.atMs,
	);
}

/**
 * Cuts keyframes at clip-local `atMs`: the left part keeps what comes before
 * (ending on the value at the cut), the right part starts at 0 with that value.
 */
export function splitKeyframes(
	list: Keyframe[] | undefined,
	atMs: number,
): [Keyframe[] | undefined, Keyframe[] | undefined] {
	if (!list || list.length === 0) return [list, list];
	const value = valueAt(list, atMs, list[0].value);
	// The ease of the segment the cut falls in carries on across it.
	const i = list.findLastIndex((k) => k.atMs <= atMs);
	const from = list[Math.max(0, i)];
	const carry: Pick<Keyframe, "ease" | "curve"> = from.curve
		? { ease: from.ease, curve: from.curve }
		: { ease: from.ease };
	const left = list.filter((k) => k.atMs < atMs - 10);
	const right = list.filter((k) => k.atMs > atMs + 10).map((k) => ({ ...k, atMs: k.atMs - atMs }));
	let rightEase = carry;
	// A curved segment is cut into two beziers that together trace the same path.
	const to = list[i + 1];
	const curve = i >= 0 && to && from.ease !== "linear" ? curveOf(from) : undefined;
	if (curve && to) {
		const halves = splitCurve(curve, (atMs - from.atMs) / Math.max(1, to.atMs - from.atMs));
		if (halves) {
			const at = left.indexOf(from);
			if (at >= 0) left[at] = { ...from, ease: "bezier", curve: halves[0] };
			rightEase = { ease: "bezier", curve: halves[1] };
		}
	}
	return [
		[...left, { atMs: Math.round(atMs), value, ...carry }],
		[{ atMs: 0, value, ...rightEase }, ...right],
	];
}

/**
 * The two halves of a bezier ease cut at time share `p`, each rescaled to
 * run 0–1 again (de Casteljau). Undefined when a half has no change in value
 * to scale by.
 */
export function splitCurve(curve: Curve, p: number): [Curve, Curve] | undefined {
	if (p <= 0 || p >= 1) return undefined;
	const s = solveBezier(curve, p);
	const lerp = (a: number[], b: number[]) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
	const p0 = [0, 0];
	const p1 = [curve[0], curve[1]];
	const p2 = [curve[2], curve[3]];
	const p3 = [1, 1];
	const p01 = lerp(p0, p1);
	const p12 = lerp(p1, p2);
	const p23 = lerp(p2, p3);
	const p012 = lerp(p01, p12);
	const p123 = lerp(p12, p23);
	const m = lerp(p012, p123);
	if (Math.abs(m[1]) < 1e-4 || Math.abs(1 - m[1]) < 1e-4 || m[0] <= 0 || m[0] >= 1)
		return undefined;
	const x = (v: number) => Math.min(1, Math.max(0, v));
	const r = (v: number) => Math.round(v * 1e5) / 1e5;
	return [
		[r(x(p01[0] / m[0])), r(p01[1] / m[1]), r(x(p012[0] / m[0])), r(p012[1] / m[1])],
		[
			r(x((p123[0] - m[0]) / (1 - m[0]))),
			r((p123[1] - m[1]) / (1 - m[1])),
			r(x((p23[0] - m[0]) / (1 - m[0]))),
			r((p23[1] - m[1]) / (1 - m[1])),
		],
	];
}

/** Cuts zooms at clip-local `atMs`, keeping each part on its side of the cut. */
export function splitZooms(
	zooms: Zoom[] | undefined,
	atMs: number,
): [Zoom[] | undefined, Zoom[] | undefined] {
	if (!zooms || zooms.length === 0) return [zooms, zooms];
	const left = zooms
		.filter((z) => z.startMs < atMs)
		.map((z) => ({ ...z, endMs: Math.min(z.endMs, Math.round(atMs)) }));
	const right = zooms
		.filter((z) => z.endMs > atMs)
		.map((z) => ({
			...z,
			id: z.startMs < atMs ? `${z.id}b` : z.id,
			startMs: Math.max(0, Math.round(z.startMs - atMs)),
			endMs: Math.round(z.endMs - atMs),
		}));
	return [left.length ? left : undefined, right.length ? right : undefined];
}

// ---------------------------------------------------------------------------
// ffmpeg expressions (the variable is local seconds, e.g. `t` or `(t-3.2)`)
// ---------------------------------------------------------------------------

const n = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(5)).toString() : "0");
/** A number that is safe to put after an operator (negatives in brackets). */
const num = (v: number) => (v < 0 ? `(${n(v)})` : n(v));

/**
 * `bezierAt` as an ffmpeg expression of progress `p`: the same bisection,
 * unrolled, with registers st()/ld() holding the bracket (0: low end, 1 and
 * 2: scratch, 3: p). `;` runs the steps in order and yields the last value.
 */
function bezierExpr(curve: Curve, p: string): string {
	const [ax, bx, cx] = coeffs(curve[0], curve[2]);
	const [ay, by, cy] = coeffs(curve[1], curve[3]);
	const poly = (a: number, b: number, c: number, s: string) =>
		`((${num(a)}*${s}+${num(b)})*${s}+${num(c)})*${s}`;
	const steps = [`st(3,clip(${p},0,1))`, "st(0,0)"];
	for (let i = 1; i <= BISECT; i++)
		steps.push(
			// Powers of two print exactly, so the bracket matches the preview's.
			`st(1,ld(0)+${2 ** -i})`,
			`if(lt(${poly(ax, bx, cx, "ld(1)")},ld(3)),st(0,ld(1)),0)`,
		);
	const w = String(2 ** -BISECT);
	steps.push(
		`st(1,${poly(ax, bx, cx, "ld(0)")})`,
		`st(2,${poly(ax, bx, cx, `(ld(0)+${w})`)})`,
		`st(2,ld(0)+(ld(3)-ld(1))/max(0.000001,ld(2)-ld(1))*${w})`,
		poly(ay, by, cy, "ld(2)"),
	);
	return `(${steps.join(";")})`;
}

/** The ease of a segment as an expression of its progress `p` (0–1). */
function easeExpr(k: Keyframe, p: string): string {
	switch (k.ease) {
		case "hold":
			return "0";
		case "linear":
			return p;
		case "ease-in":
			return `(${p})*(${p})*(${p})`;
		case "ease-out":
			return `(1-(1-(${p}))*(1-(${p}))*(1-(${p})))`;
		case "bezier":
			return bezierExpr(k.curve ?? DEFAULT_CURVE, p);
		default:
			return `(${p})*(${p})*(3-2*(${p}))`;
	}
}

/** Piecewise expression equal to `valueAt` for keyframes given in ms, over variable `T` in seconds. */
export function keyframeExpr(
	keyframes: Keyframe[] | undefined,
	fallback: number,
	T: string,
): string {
	if (!keyframes || keyframes.length === 0) return n(fallback);
	const pts = keyframes.map((k) => ({ ...k, s: k.atMs / 1000 }));
	if (pts.length === 1) return n(pts[0].value);
	const segment = (i: number) => {
		const a = pts[i];
		const b = pts[i + 1];
		const p = `((${T})-${n(a.s)})/${n(Math.max(0.001, b.s - a.s))}`;
		return `${n(a.value)}+(${n(b.value - a.value)})*(${easeExpr(a, p)})`;
	};
	// ffmpeg's expressions can't nest much deeper than ~60 levels, so the segment is
	// found by halving (log2 of the keyframes deep) rather than one if per keyframe.
	const tree = (lo: number, hi: number): string => {
		if (hi - lo === 1) return segment(lo);
		const mid = (lo + hi) >> 1;
		return `if(lt(${T},${n(pts[mid].s)}),${tree(lo, mid)},${tree(mid, hi)})`;
	};
	const last = pts[pts.length - 1];
	return `if(lt(${T},${n(pts[0].s)}),${n(pts[0].value)},if(lt(${T},${n(last.s)}),${tree(0, pts.length - 1)},${n(last.value)}))`;
}

/** Expressions for the zoom scale and focus over variable `T` (seconds). */
export function zoomExprs(
	zooms: Zoom[] | undefined,
	T: string,
): { scale: string; x: string; y: string } | null {
	if (!zooms || zooms.length === 0) return null;
	let k = "0";
	let fx = "0.5";
	let fy = "0.5";
	let sc = "1";
	for (const z of [...zooms].reverse()) {
		const s0 = z.startMs / 1000;
		const s1 = z.endMs / 1000;
		const e = Math.max(0.001, Math.min(z.easeMs, (z.endMs - z.startMs) / 2) / 1000);
		const p = `if(lt(${T},${n(s0 + e)}),(${T}-${n(s0)})/${n(e)},if(gt(${T},${n(s1 - e)}),(${n(s1)}-${T})/${n(e)},1))`;
		const eased = `(${p})*(${p})*(3-2*(${p}))`;
		const inside = `between(${T},${n(s0)},${n(s1)})`;
		k = `if(${inside},${eased},${k})`;
		sc = `if(${inside},${n(z.scale)},${sc})`;
		fx = `if(${inside},${n(z.x)},${fx})`;
		fy = `if(${inside},${n(z.y)},${fy})`;
	}
	return {
		scale: `(1+(${sc}-1)*(${k}))`,
		x: `(0.5+(${fx}-0.5)*(${k}))`,
		y: `(0.5+(${fy}-0.5)*(${k}))`,
	};
}

// ---------------------------------------------------------------------------
// Hand-made motion: wiggle and stepped time
// ---------------------------------------------------------------------------

/** A number from a clip's id, so each clip wiggles its own way but always the same way. */
export function seedOf(id: string): number {
	let h = 7;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100003;
	return h / 100003;
}

// Three sines at unrelated rates read as random drift rather than a swing.
const WIGGLE_RATES = [1, 1.73, 2.61];
const WIGGLE_WEIGHTS = [0.55, 0.3, 0.15];

/** A wiggle's offset at a clip-local time: pixels of a 1080-line frame, and degrees. */
export function wiggleAt(
	w: Wiggle | undefined,
	seed: number,
	ms: number,
): { x: number; y: number; rotation: number } {
	if (!w) return { x: 0, y: 0, rotation: 0 };
	const a = (ms / 1000) * w.speed * Math.PI * 2;
	const wave = (phase: number) =>
		WIGGLE_RATES.reduce(
			(sum, rate, i) => sum + WIGGLE_WEIGHTS[i] * Math.sin(a * rate + phase * (i + 1) * 6.283),
			0,
		);
	return {
		x: w.position * wave(seed),
		y: w.position * wave(seed + 0.37),
		rotation: w.rotation * wave(seed + 0.71),
	};
}

/** The same wiggle as FFmpeg expressions of a time in seconds `T`. */
export function wiggleExpr(
	w: Wiggle | undefined,
	seed: number,
	T: string,
): { x: string; y: string; rotation: string } {
	if (!w) return { x: "0", y: "0", rotation: "0" };
	const a = `(${T})*${(w.speed * Math.PI * 2).toFixed(6)}`;
	const wave = (phase: number) =>
		WIGGLE_RATES.map(
			(rate, i) => `${WIGGLE_WEIGHTS[i]}*sin(${a}*${rate}+${(phase * (i + 1) * 6.283).toFixed(6)})`,
		).join("+");
	return {
		x: `${w.position}*(${wave(seed)})`,
		y: `${w.position}*(${wave(seed + 0.37)})`,
		rotation: `${w.rotation}*(${wave(seed + 0.71)})`,
	};
}

/** A clip-local time held to whole steps of `fps` (motion "on twos" at 12). */
export function steppedMs(ms: number, fps: number | undefined): number {
	return fps ? (Math.floor((ms * fps) / 1000) * 1000) / fps : ms;
}

/** The same as an FFmpeg expression of a time in seconds. */
export function steppedExpr(T: string, fps: number | undefined): string {
	return fps ? `(floor((${T})*${fps})/${fps})` : T;
}
