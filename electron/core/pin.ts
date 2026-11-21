import { valueAt } from "./anim";
import type { CornerPin, Corners, MediaClip, Tracker } from "./types";

/**
 * Corner pin maths shared by the preview (a CSS matrix3d) and the export (ffmpeg's
 * perspective filter): where the four corners are at a moment, and the
 * homography that stretches a picture onto them.
 */

type P = [number, number];

/** The corners at a clip-local time: straight lines between keys, held before the first and after the last. */
export function cornersAt(pin: CornerPin, localMs: number): Corners {
	const keys = pin.keys;
	if (localMs <= keys[0].atMs) return keys[0].corners;
	const last = keys[keys.length - 1];
	if (localMs >= last.atMs) return last.corners;
	// Keys are in order; tracked pins have one per frame, so search rather than scan.
	let lo = 0;
	let hi = keys.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (keys[mid].atMs <= localMs) lo = mid;
		else hi = mid;
	}
	const a = keys[lo];
	const b = keys[hi];
	const t = (localMs - a.atMs) / Math.max(1e-6, b.atMs - a.atMs);
	return a.corners.map((c, i) => [
		c[0] + (b.corners[i][0] - c[0]) * t,
		c[1] + (b.corners[i][1] - c[1]) * t,
	]) as Corners;
}

/**
 * The projective map of the unit square onto a quad (top-left, top-right,
 * bottom-right, bottom-left): [a, b, c, d, e, f, g, h] with
 * x = (a u + b v + c) / (g u + h v + 1), y = (d u + e v + f) / (g u + h v + 1).
 */
export function squareToQuad(q: P[]): number[] {
	const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
	const dx3 = x0 - x1 + x2 - x3;
	const dy3 = y0 - y1 + y2 - y3;
	if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9)
		return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0];
	const dx1 = x1 - x2;
	const dx2 = x3 - x2;
	const dy1 = y1 - y2;
	const dy2 = y3 - y2;
	const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
	const g = (dx3 * dy2 - dx2 * dy3) / den;
	const h = (dx1 * dy3 - dx3 * dy1) / den;
	return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}

export function mapSquare(m: number[], u: number, v: number): P {
	const w = m[6] * u + m[7] * v + 1;
	return [(m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w];
}

/** The CSS matrix3d that puts an element of size w×h (transform origin 0 0) onto a quad in pixels. */
export function cssMatrix(w: number, h: number, quad: P[]): string {
	const [a, b, c, d, e, f, g, hh] = squareToQuad(quad);
	const v = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
	return `matrix3d(${v.map((x) => +x.toFixed(8)).join(",")})`;
}

/** Whether four corners make a usable (convex, not folded) quad. */
export function isConvex(q: P[]): boolean {
	let sign = 0;
	for (let i = 0; i < 4; i++) {
		const [ax, ay] = q[i];
		const [bx, by] = q[(i + 1) % 4];
		const [cx, cy] = q[(i + 2) % 4];
		const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
		if (Math.abs(cross) < 1e-12) return false;
		const s = Math.sign(cross);
		if (sign && s !== sign) return false;
		sign = s;
	}
	return true;
}

/**
 * Fewer keys for the same motion: drops keys that the straight line between their
 * neighbours already puts within `tolerance` (canvas shares) of every corner.
 */
export function simplifyPin(keys: CornerPin["keys"], tolerance = 0.0002): CornerPin["keys"] {
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
			let err = 0;
			for (let c = 0; c < 4; c++)
				for (let k = 0; k < 2; k++) {
					const line = keys[s].corners[c][k] + (keys[e].corners[c][k] - keys[s].corners[c][k]) * t;
					err = Math.max(err, Math.abs(line - keys[i].corners[c][k]));
				}
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

/**
 * ffmpeg perspective corners (x0 y0 x1 y1 x2 y2 x3 y3, destination sense: top-left,
 * top-right, bottom-left, bottom-right) as expressions of the filter's frame
 * number `in`, for a picture scaled to (W-2·pad)×(H-2·pad) and padded with a
 * transparent border on a W×H canvas: the border's corners are sent past the
 * pin's corners by the same homography, so nothing outside the quad is drawn.
 */
export function pinExprs(pin: CornerPin, fps: number, W: number, H: number, pad: number): string[] {
	const eu = pad / Math.max(1, W - 2 * pad);
	const ev = pad / Math.max(1, H - 2 * pad);
	const keys = simplifyPin(pin.keys).map((k) => {
		const m = squareToQuad(k.corners.map(([x, y]) => [x * W, y * H]));
		// ffmpeg's order: top-left, top-right, bottom-left, bottom-right.
		const out = [
			mapSquare(m, -eu, -ev),
			mapSquare(m, 1 + eu, -ev),
			mapSquare(m, -eu, 1 + ev),
			mapSquare(m, 1 + eu, 1 + ev),
		];
		return { f: (k.atMs / 1000) * fps, v: out.flat() };
	});
	const num = (x: number) => String(+x.toFixed(3));
	// ffmpeg's expressions can't nest much deeper than ~60 levels (nor add up more than
	// ~100 terms), so the segments are found by halving: log2(keys) levels deep.
	const segment = (c: number, i: number) => {
		const a = keys[i];
		const b = keys[i + 1];
		const span = Math.max(1e-6, b.f - a.f);
		return `${num(a.v[c])}+(${num(b.v[c] - a.v[c])})*(in-${num(a.f)})/${num(span)}`;
	};
	const tree = (c: number, lo: number, hi: number): string => {
		if (hi - lo === 1) return segment(c, lo);
		const mid = (lo + hi) >> 1;
		return `if(lt(in,${num(keys[mid].f)}),${tree(c, lo, mid)},${tree(c, mid, hi)})`;
	};
	return Array.from({ length: 8 }, (_, c) => {
		const first = keys[0];
		const last = keys[keys.length - 1];
		if (keys.length === 1) return num(first.v[c]);
		return `if(lt(in,${num(first.f)}),${num(first.v[c])},if(lt(in,${num(last.f)}),${tree(c, 0, keys.length - 1)},${num(last.v[c])}))`;
	});
}

/** A pin cut in two at a clip-local time: the right half's keys start again from 0. */
export function splitPin(pin: CornerPin | undefined, atMs: number): [CornerPin?, CornerPin?] {
	if (!pin) return [undefined, undefined];
	const at = cornersAt(pin, atMs);
	const left = pin.keys.filter((k) => k.atMs < atMs);
	const right = pin.keys.filter((k) => k.atMs > atMs).map((k) => ({ ...k, atMs: k.atMs - atMs }));
	return [
		{ keys: [...left, { atMs, corners: at }] },
		{ keys: [{ atMs: 0, corners: at }, ...right] },
	];
}

const round = (x: number) => Math.round(x * 100000) / 100000;

/** The tracked corners at a source time (straight lines between frames). */
export function trackedAt(
	result: NonNullable<Tracker["result"]>,
	sourceMs: number,
): { corners: Corners; confidence: number } {
	if (sourceMs <= result[0].atMs) return result[0];
	const last = result[result.length - 1];
	if (sourceMs >= last.atMs) return last;
	let lo = 0;
	let hi = result.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (result[mid].atMs <= sourceMs) lo = mid;
		else hi = mid;
	}
	const a = result[lo];
	const b = result[hi];
	const t = (sourceMs - a.atMs) / Math.max(1e-6, b.atMs - a.atMs);
	return {
		corners: a.corners.map((c, i) => [
			c[0] + (b.corners[i][0] - c[0]) * t,
			c[1] + (b.corners[i][1] - c[1]) * t,
		]) as Corners,
		confidence: Math.min(a.confidence, b.confidence),
	};
}

/**
 * Where a clip puts its (uncropped) picture on the canvas at a clip-local time, as a
 * function from picture shares to canvas shares, and back. Same placement as the
 * export: fitted, scaled and turned about the centre, which sits at x, y.
 */
export function placement(
	clip: MediaClip,
	picture: { width: number; height: number },
	canvas: { width: number; height: number },
	localMs: number,
) {
	const W = canvas.width;
	const H = canvas.height;
	const t = clip.transform;
	const kf = clip.keyframes;
	const scale = valueAt(kf?.scale, localMs, t.scale);
	const x = valueAt(kf?.x, localMs, t.x) * W;
	const y = valueAt(kf?.y, localMs, t.y) * H;
	const rot = (valueAt(kf?.rotation, localMs, t.rotation ?? 0) * Math.PI) / 180;
	const fit = Math.min(W / picture.width, H / picture.height) * scale;
	const pw = picture.width * fit;
	const ph = picture.height * fit;
	const cos = Math.cos(rot);
	const sin = Math.sin(rot);
	return {
		toCanvas([u, v]: [number, number]): [number, number] {
			const dx = (u - 0.5) * pw;
			const dy = (v - 0.5) * ph;
			return [round((x + dx * cos - dy * sin) / W), round((y + dx * sin + dy * cos) / H)];
		},
		toPicture([cx, cy]: [number, number]): [number, number] {
			const dx = cx * W - x;
			const dy = cy * H - y;
			return [round((dx * cos + dy * sin) / pw + 0.5), round((-dx * sin + dy * cos) / ph + 0.5)];
		},
	};
}

/** Source ms of a clip at a clip-local time. */
export const sourceMsOf = (clip: MediaClip, localMs: number) => clip.inMs + localMs * clip.speed;
/** Clip-local ms of a clip at a source time. */
export const localMsOf = (clip: MediaClip, sourceMs: number) => (sourceMs - clip.inMs) / clip.speed;
