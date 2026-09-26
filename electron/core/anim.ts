import type { Keyframe, Zoom } from "./types";

/**
 * Animation maths shared by the preview (browser) and the exporter (ffmpeg
 * expressions), so both produce the same motion. No Node imports here.
 */

export const smooth = (t: number) => t * t * (3 - 2 * t);

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
		return a.value + (b.value - a.value) * (a.ease === "ease" ? smooth(p) : p);
	}
	return last.value;
}

/** Zoom state at clip-local time `t`: scale 1 means no zoom. */
export function zoomAt(zooms: Zoom[] | undefined, t: number): { scale: number; x: number; y: number } {
	if (zooms) {
		for (const z of zooms) {
			if (t < z.startMs || t > z.endMs) continue;
			const ease = Math.max(1, Math.min(z.easeMs, (z.endMs - z.startMs) / 2));
			const p = t < z.startMs + ease ? (t - z.startMs) / ease : t > z.endMs - ease ? (z.endMs - t) / ease : 1;
			const k = smooth(Math.max(0, Math.min(1, p)));
			return { scale: 1 + (z.scale - 1) * k, x: 0.5 + (z.x - 0.5) * k, y: 0.5 + (z.y - 0.5) * k };
		}
	}
	return { scale: 1, x: 0.5, y: 0.5 };
}

/** Sorted, de-duplicated keyframes with `next` inserted (replacing one within 10 ms). */
export function withKeyframe(list: Keyframe[] | undefined, next: Keyframe): Keyframe[] {
	return [...(list ?? []).filter((k) => Math.abs(k.atMs - next.atMs) > 10), next].sort((a, b) => a.atMs - b.atMs);
}

// ---------------------------------------------------------------------------
// ffmpeg expressions (the variable is local seconds, e.g. `t` or `(t-3.2)`)
// ---------------------------------------------------------------------------

const n = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(5)).toString() : "0");

/** Piecewise expression equal to `valueAt` for keyframes given in ms, over variable `T` in seconds. */
export function keyframeExpr(keyframes: Keyframe[] | undefined, fallback: number, T: string): string {
	if (!keyframes || keyframes.length === 0) return n(fallback);
	const pts = keyframes.map((k) => ({ ...k, s: k.atMs / 1000 }));
	let expr = n(pts[pts.length - 1].value);
	for (let i = pts.length - 2; i >= 0; i--) {
		const a = pts[i];
		const b = pts[i + 1];
		const p = `((${T})-${n(a.s)})/${n(Math.max(0.001, b.s - a.s))}`;
		const eased = a.ease === "hold" ? "0" : a.ease === "ease" ? `(${p})*(${p})*(3-2*(${p}))` : p;
		const segment = `${n(a.value)}+(${n(b.value - a.value)})*(${eased})`;
		expr = `if(lt(${T},${n(b.s)}),${segment},${expr})`;
	}
	return `if(lt(${T},${n(pts[0].s)}),${n(pts[0].value)},${expr})`;
}

/** Expressions for the zoom scale and focus over variable `T` (seconds). */
export function zoomExprs(zooms: Zoom[] | undefined, T: string): { scale: string; x: string; y: string } | null {
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
