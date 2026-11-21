import { describe, expect, it } from "vitest";
import {
	applyHomography,
	blendAnchoredTracks,
	createObjectTracker,
	createPlaneTracker,
	createScreenFinder,
	type GrayFrame,
	homography,
	type Pt,
	type Quad,
	type RgbFrame,
	rgbToGray,
	smoothQuads,
} from "../electron/core/tracker";

// A tiny synthetic renderer: textured planes warped by known, smoothly changing
// homographies (with camera shake) over a static textured background, bilinear
// sampling, antialiased edges and mild noise. Everything is seeded.

type M = number[];

function rand(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const gauss = (r: () => number) => (r() + r() + r() + r() - 2) * Math.sqrt(3);

// Unit-variance noise, precomputed; each frame reads it from its own offset.
const NOISE = (() => {
	const r = rand(99);
	return Float32Array.from({ length: 1 << 20 }, () => gauss(r));
})();
const noiseAt = (t: number, i: number) => NOISE[(i + t * 104729) & ((1 << 20) - 1)];

interface Tex {
	w: number;
	h: number;
	d: Float32Array;
}

/** Smooth value noise over several octaves, plus sharp-edged blobs and boxes (the corners). */
function texture(w: number, h: number, seed: number, shapes = 60): Tex {
	const r = rand(seed);
	const d = new Float32Array(w * h).fill(128);
	for (const [cell, amp] of [
		[48, 60],
		[24, 40],
		[12, 25],
		[6, 12],
	]) {
		const gw = Math.ceil(w / cell) + 2;
		const gh = Math.ceil(h / cell) + 2;
		const g = Float32Array.from({ length: gw * gh }, () => r() * 2 - 1);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const fx = x / cell;
				const fy = y / cell;
				const ix = Math.floor(fx);
				const iy = Math.floor(fy);
				let tx = fx - ix;
				let ty = fy - iy;
				tx = tx * tx * (3 - 2 * tx);
				ty = ty * ty * (3 - 2 * ty);
				const v =
					(g[iy * gw + ix] * (1 - tx) + g[iy * gw + ix + 1] * tx) * (1 - ty) +
					(g[(iy + 1) * gw + ix] * (1 - tx) + g[(iy + 1) * gw + ix + 1] * tx) * ty;
				d[y * w + x] += v * amp;
			}
	}
	for (let s = 0; s < shapes; s++) {
		const cx = r() * w;
		const cy = r() * h;
		const sz = 4 + r() * 22;
		const val = 20 + r() * 215;
		const disc = r() < 0.5;
		for (let y = Math.max(0, Math.floor(cy - sz)); y < Math.min(h, cy + sz); y++)
			for (let x = Math.max(0, Math.floor(cx - sz)); x < Math.min(w, cx + sz); x++)
				if (!disc || (x - cx) ** 2 + (y - cy) ** 2 < sz * sz) d[y * w + x] = val;
	}
	for (let i = 0; i < d.length; i++) d[i] = Math.min(255, Math.max(0, d[i]));
	return { w, h, d };
}

function sample(t: Tex, x: number, y: number): number {
	x = Math.min(t.w - 1.001, Math.max(0, x));
	y = Math.min(t.h - 1.001, Math.max(0, y));
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const i = iy * t.w + ix;
	return (
		(t.d[i] * (1 - fx) + t.d[i + 1] * fx) * (1 - fy) +
		(t.d[i + t.w] * (1 - fx) + t.d[i + t.w + 1] * fx) * fy
	);
}

function mul(a: M, b: M): M {
	const o: M = [];
	for (let r = 0; r < 3; r++)
		for (let c = 0; c < 3; c++)
			o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
	return o;
}

function inv(m: M): M {
	const [a, b, c, d, e, f, g, h, i] = m;
	const A = e * i - f * h;
	const B = -(d * i - f * g);
	const C = d * h - e * g;
	const det = a * A + b * B + c * C;
	return [
		A / det,
		-(b * i - c * h) / det,
		(b * f - c * e) / det,
		B / det,
		(a * i - c * g) / det,
		-(a * f - c * d) / det,
		C / det,
		-(a * h - b * g) / det,
		(a * e - b * d) / det,
	];
}

const ap = (m: M, x: number, y: number): Pt => {
	const w = m[6] * x + m[7] * y + m[8];
	return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
};
const T = (x: number, y: number): M => [1, 0, x, 0, 1, y, 0, 0, 1];
const S = (s: number): M => [s, 0, 0, 0, s, 0, 0, 0, 1];
const Rot = (a: number): M => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const P = (p1: number, p2: number): M => [1, 0, 0, 0, 1, 0, p1, p2, 1];
const rectQuad = (x0: number, y0: number, x1: number, y1: number): Quad => [
	[x0, y0],
	[x1, y0],
	[x1, y1],
	[x0, y1],
];
const mapQ = (m: M, q: Quad): Quad => q.map(([x, y]) => ap(m, x, y)) as Quad;
const TAU = Math.PI * 2;

/** Plane → frame for frame t: drifting, rotating, zooming, tilting, with per-frame shake. */
function planeMotion(
	t: number,
	W: number,
	H: number,
	pw: number,
	ph: number,
	seed: number,
	base: number,
): M {
	const k = W / 640;
	const r = rand(seed + t * 7919);
	const shx = gauss(r) * 1.2;
	const shy = gauss(r) * 1.2;
	const s = base * (1 + 0.12 * Math.sin((TAU * t) / 60)) * k;
	const th = ((8 * Math.PI) / 180) * Math.sin((TAU * t) / 45);
	const tx = W / 2 + k * (30 * Math.sin((TAU * t) / 50) + shx);
	const ty = H / 2 + k * (18 * Math.cos((TAU * t) / 40) - 18 + shy);
	const p1 = 4e-4 * Math.sin((TAU * t) / 60);
	const p2 = 3e-4 * Math.cos((TAU * t) / 70);
	return mul(T(tx, ty), mul(Rot(th), mul(S(s), mul(P(p1, p2), T(-pw / 2, -ph / 2)))));
}

interface Hand {
	x: number;
	y: number;
	rx: number;
	ry: number;
}

const BOARD_W = 640;
const BOARD_H = 480;
const POSTER = rectQuad(160, 120, 480, 360);

interface SceneOptions {
	hand?: (t: number) => Hand | null;
	/** Gain and offset of the picture at frame t. */
	light?: (t: number) => [number, number];
	/** Extra motion added to the plane (a whip pan, say). */
	extra?: (t: number) => Pt;
}

/** A textured board (the plane) with a poster region on it, over a static background. */
function makePlaneScene(W: number, H: number, opts: SceneOptions = {}) {
	const hand = opts.hand;
	const motion = (t: number) => {
		const [ex, ey] = opts.extra?.(t) ?? [0, 0];
		return mul(T(ex, ey), planeMotion(t, W, H, BOARD_W, BOARD_H, 5, 0.62));
	};
	const board = texture(BOARD_W, BOARD_H, 11);
	const bg = texture(640, 360, 22, 30);
	const handTex = texture(128, 128, 33, 0);
	const k = W / 640;
	return {
		quad: (t: number) => mapQ(motion(t), POSTER),
		frame(t: number): GrayFrame {
			const m = motion(t);
			const mi = inv(m);
			const data = new Uint8Array(W * H);
			const hd = hand?.(t) ?? null;
			const light = opts.light?.(t) ?? [1, 0];
			for (let y = 0; y < H; y++)
				for (let x = 0; x < W; x++) {
					const wz = mi[6] * x + mi[7] * y + mi[8];
					const u = (mi[0] * x + mi[1] * y + mi[2]) / wz;
					const v = (mi[3] * x + mi[4] * y + mi[5]) / wz;
					let val =
						u >= 0 && v >= 0 && u <= BOARD_W - 1 && v <= BOARD_H - 1
							? sample(board, u, v)
							: sample(bg, x / k, y / k);
					if (hd) {
						const e = Math.hypot((x - hd.x) / hd.rx, (y - hd.y) / hd.ry);
						const cov = Math.min(1, Math.max(0, (1 - e) * hd.rx + 0.5));
						if (cov > 0) {
							const hv =
								150 + (sample(handTex, 64 + (x - hd.x) / 2, 64 + (y - hd.y) / 2) - 128) * 0.3;
							val = val * (1 - cov) + hv * cov;
						}
					}
					val = val * light[0] + light[1];
					data[y * W + x] = Math.max(0, Math.min(255, Math.round(val + noiseAt(t, y * W + x) * 2)));
				}
			return { width: W, height: H, data };
		},
	};
}

function cornerErrors(a: Quad, b: Quad): number[] {
	return a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]));
}

function runPlane(W: number, H: number, frames: number, opts: SceneOptions = {}) {
	const scene = makePlaneScene(W, H, opts);
	const tracker = createPlaneTracker(scene.frame(0), scene.quad(0));
	const errs: number[] = [];
	let nulls = 0;
	let minConf = 1;
	let ms = 0;
	for (let t = 1; t < frames; t++) {
		const f = scene.frame(t);
		const t0 = performance.now();
		const r = tracker.step(f);
		ms += performance.now() - t0;
		minConf = Math.min(minConf, r.confidence);
		if (!r.value) {
			nulls++;
			continue;
		}
		errs.push(...cornerErrors(r.value, scene.quad(t)));
	}
	const mean = errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length);
	return { mean, max: Math.max(...errs), nulls, minConf, ms };
}

describe("homography", () => {
	const H0: M = [1.2, 0.1, 30, -0.05, 0.9, 20, 1e-4, -2e-4, 1];
	it("recovers a known matrix from four and from many pairs", () => {
		const src: Pt[] = [
			[10, 10],
			[500, 30],
			[480, 400],
			[20, 380],
		];
		const h4 = homography(
			src,
			src.map(([x, y]) => ap(H0, x, y)),
		);
		expect(h4).not.toBeNull();
		for (let i = 0; i < 9; i++) expect(Math.abs((h4 as M)[i] - H0[i])).toBeLessThan(1e-6);
		const many: Pt[] = [];
		for (let i = 0; i < 25; i++) many.push([(i % 5) * 110 + 5, Math.floor(i / 5) * 90 + 7]);
		const hm = homography(
			many,
			many.map(([x, y]) => ap(H0, x, y)),
		);
		for (let i = 0; i < 9; i++) expect(Math.abs((hm as M)[i] - H0[i])).toBeLessThan(1e-6);
	});
	it("round-trips points", () => {
		const src: Pt[] = [
			[0, 0],
			[100, 0],
			[100, 100],
			[0, 100],
		];
		const dst = src.map(([x, y]) => ap(H0, x, y));
		const f = homography(src, dst) as M;
		const b = homography(dst, src) as M;
		const p: Pt = [37.5, 81.25];
		const q = applyHomography(b, applyHomography(f, p));
		expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeLessThan(1e-8);
		expect(homography(src.slice(0, 3), dst.slice(0, 3))).toBeNull();
	});
});

describe("plane tracker", () => {
	it("follows a poster within a pixel over 60 frames", () => {
		const r = runPlane(640, 360, 60);
		console.log("plane clean", r);
		expect(r.nulls).toBe(0);
		expect(r.mean).toBeLessThan(1);
		expect(r.max).toBeLessThan(3);
		expect(r.minConf).toBeGreaterThan(0.5);
	});
	it("keeps its hold while a hand crosses the poster", () => {
		const r = runPlane(640, 360, 60, {
			hand: (t) => {
				if (t < 20 || t >= 35) return null;
				const u = (t - 20) / 14;
				return { x: 220 + u * 200, y: 170 + u * 30, rx: 50, ry: 42 };
			},
		});
		console.log("plane occluded", r);
		expect(r.nulls).toBe(0);
		expect(r.mean).toBeLessThan(2);
	});
	it("copes with a lighting change and a whip pan", () => {
		const r = runPlane(640, 360, 60, {
			light: (t) => [1 - 0.25 * (t / 59), 30 * (t / 59)],
			extra: (t) => {
				// 60 px sideways in 4 frames (15 px a frame), then back more slowly.
				const u = t < 30 ? 0 : t < 34 ? (t - 30) / 4 : Math.max(0, 1 - (t - 34) / 10);
				return [60 * u, -12 * u];
			},
		});
		console.log("plane light + whip", r);
		expect(r.nulls).toBe(0);
		expect(r.mean).toBeLessThan(1);
		expect(r.max).toBeLessThan(3);
	});

	it("reports a lost surface and picks it up again", () => {
		const scene = makePlaneScene(640, 360);
		const tracker = createPlaneTracker(scene.frame(0), scene.quad(0));
		const black: GrayFrame = { width: 640, height: 360, data: new Uint8Array(640 * 360).fill(12) };
		const after: number[] = [];
		for (let t = 1; t < 40; t++) {
			const dark = t >= 20 && t < 24;
			const r = tracker.step(dark ? black : scene.frame(t));
			if (dark) {
				expect(r.value).toBeNull();
				expect(r.confidence).toBe(0);
			} else if (t >= 25) {
				expect(r.value).not.toBeNull();
				if (r.value) after.push(...cornerErrors(r.value, scene.quad(t)));
			}
		}
		console.log("plane after black", { max: Math.max(...after) });
		expect(Math.max(...after)).toBeLessThan(1);
	});

	it("pins a laptop's green screen from its bezel", () => {
		const lap = lapMotion;
		const gray = (t: number) => rgbToGray(lapFrame(t));
		const tracker = createPlaneTracker(gray(0), mapQ(lap(0), SCREEN));
		const errs: number[] = [];
		let minConf = 1;
		for (let t = 1; t < 60; t++) {
			const r = tracker.step(gray(t));
			expect(r.value).not.toBeNull();
			if (r.value) errs.push(...cornerErrors(r.value, mapQ(lap(t), SCREEN)));
			minConf = Math.min(minConf, r.confidence);
		}
		const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
		console.log("plane laptop", { mean, max: Math.max(...errs), minConf });
		expect(mean).toBeLessThan(1);
		expect(Math.max(...errs)).toBeLessThan(3);
	});

	it("keeps pinning while the poster slides partly out of frame", () => {
		const r = runPlane(640, 360, 60, {
			extra: (t) => [Math.min(1, Math.max(0, (t - 10) / 30)) * 250, 0],
		});
		console.log("plane out of frame", r);
		expect(r.nulls).toBe(0);
		expect(r.mean).toBeLessThan(1);
		expect(r.max).toBeLessThan(3);
	});

	it("tracks 960x540 fast enough", () => {
		const r = runPlane(960, 540, 60);
		console.log(
			`plane 960x540: ${r.ms.toFixed(0)} ms for 59 frames (${((59 * 1000) / r.ms).toFixed(1)} fps), mean ${r.mean.toFixed(3)} px`,
		);
		expect(r.mean).toBeLessThan(1.5);
		if (r.ms > 4000) console.warn("plane tracking slower than 4 s for 60 frames (slow machine?)");
		expect(r.ms).toBeLessThan(10000);
	});
});

function objectScene(pose: (t: number) => { cx: number; cy: number; s: number; th: number }) {
	const W = 640;
	const H = 360;
	const bg = texture(W, H, 44, 40);
	const obj = texture(160, 160, 55, 40);
	return (t: number): GrayFrame => {
		const p = pose(t);
		const c = Math.cos(p.th);
		const sn = Math.sin(p.th);
		const data = new Uint8Array(W * H);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const dx = x - p.cx;
				const dy = y - p.cy;
				const rr = Math.hypot(dx, dy);
				let val = sample(bg, x, y);
				const cov = Math.min(1, Math.max(0, OBJ_R * p.s - rr + 0.5));
				if (cov > 0) {
					const u = (c * dx + sn * dy) / p.s;
					const v = (-sn * dx + c * dy) / p.s;
					val = val * (1 - cov) + sample(obj, 80 + u, 80 + v) * cov;
				}
				data[y * W + x] = Math.max(0, Math.min(255, Math.round(val + noiseAt(t, y * W + x) * 2)));
			}
		return { width: W, height: H, data };
	};
}

const OBJ_R = 60;

describe("object tracker", () => {
	it("follows a moving object with translation only", () => {
		const pose = (t: number) => ({ cx: 200 + 4 * t, cy: 150 + 20 * Math.sin(t / 8), s: 1, th: 0 });
		const render = objectScene(pose);
		const R = OBJ_R;
		const tracker = createObjectTracker(
			render(0),
			{ x: 200 - R, y: 150 - R, width: 2 * R, height: 2 * R },
			{ scaleRotation: false },
		);
		let ce = 0;
		for (let t = 1; t < 40; t++) {
			const r = tracker.step(render(t));
			expect(r.value).not.toBeNull();
			if (!r.value) continue;
			expect(r.value.scale).toBe(1);
			expect(r.value.rotation).toBe(0);
			const p = pose(t);
			ce = Math.max(ce, Math.hypot(r.value.center[0] - p.cx, r.value.center[1] - p.cy));
		}
		console.log("object translation", { maxCenter: ce });
		expect(ce).toBeLessThan(1);
	});

	it("follows a rotating, scaling object", () => {
		const R = OBJ_R;
		const pose = (t: number) => ({
			cx: 260 + 120 * Math.sin((TAU * t) / 120) + 3 * Math.sin(t * 1.7),
			cy: 180 + 40 * Math.sin((TAU * t) / 80),
			s: 1 + 0.15 * Math.sin((TAU * t) / 70),
			th: ((20 * Math.PI) / 180) * Math.sin((TAU * t) / 60),
		});
		const render = objectScene(pose);
		const p0 = pose(0);
		const tracker = createObjectTracker(render(0), {
			x: p0.cx - R * p0.s,
			y: p0.cy - R * p0.s,
			width: 2 * R * p0.s,
			height: 2 * R * p0.s,
		});
		let ce = 0;
		let se = 0;
		let re = 0;
		let n = 0;
		for (let t = 1; t < 60; t++) {
			const r = tracker.step(render(t));
			expect(r.value).not.toBeNull();
			if (!r.value) continue;
			const p = pose(t);
			ce = Math.max(ce, Math.hypot(r.value.center[0] - p.cx, r.value.center[1] - p.cy));
			se = Math.max(se, Math.abs(r.value.scale / (p.s / p0.s) - 1));
			re = Math.max(re, Math.abs(r.value.rotation - ((p.th - p0.th) * 180) / Math.PI));
			n++;
		}
		console.log("object", { maxCenter: ce, maxScale: se, maxRot: re });
		expect(n).toBe(59);
		expect(ce).toBeLessThan(1);
		expect(se).toBeLessThan(0.02);
		expect(re).toBeLessThan(1);
	});
});

// Green screens: a laptop (dark bezel around a green screen) on a plane.
const LAP_W = 420;
const LAP_H = 280;
const BEZEL = rectQuad(0, 0, LAP_W, LAP_H);
const SCREEN = rectQuad(16, 16, LAP_W - 16, LAP_H - 16);

/** A quad's sides as (point, inward normal), for coverage, and its bounding box. */
function edgesOf(q: Quad) {
	const e = new Float64Array(16);
	for (let i = 0; i < 4; i++) {
		const [ax, ay] = q[i];
		const [bx, by] = q[(i + 1) % 4];
		const len = Math.hypot(bx - ax, by - ay);
		e.set([ax, ay, -(by - ay) / len, (bx - ax) / len], i * 4);
	}
	const xs = q.map((p) => p[0]);
	const ys = q.map((p) => p[1]);
	return {
		e,
		x0: Math.floor(Math.min(...xs)) - 1,
		x1: Math.ceil(Math.max(...xs)) + 1,
		y0: Math.floor(Math.min(...ys)) - 1,
		y1: Math.ceil(Math.max(...ys)) + 1,
	};
}

function cover(q: ReturnType<typeof edgesOf>, x: number, y: number): number {
	if (x < q.x0 || x > q.x1 || y < q.y0 || y > q.y1) return 0;
	const e = q.e;
	let c = 1;
	for (let i = 0; i < 16; i += 4) {
		const v = 0.5 + (x - e[i]) * e[i + 2] + (y - e[i + 1]) * e[i + 3];
		if (v <= 0) return 0;
		if (v < 1) c *= v;
	}
	return c;
}

const screenTextures = (() => {
	let made: { bg: Tex[]; bezel: Tex } | null = null;
	return () => {
		made ??= {
			bg: [texture(640, 360, 61, 30), texture(640, 360, 62, 30), texture(640, 360, 63, 30)],
			bezel: texture(128, 128, 64, 10),
		};
		return made;
	};
})();

const backgrounds = new Map<number, Float32Array>();

/** The static background of the screen scenes, rgb, not green. */
function screenBackground(W: number, H: number): Float32Array {
	let out = backgrounds.get(W);
	if (out) return out;
	const { bg } = screenTextures();
	const k = W / 640;
	out = new Float32Array(W * H * 3);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const r = sample(bg[0], x / k, y / k);
			const b = sample(bg[2], x / k, y / k);
			const p = (y * W + x) * 3;
			out[p] = r;
			out[p + 1] = Math.min(sample(bg[1], x / k, y / k), (r + b) / 2 + 5);
			out[p + 2] = b;
		}
	backgrounds.set(W, out);
	return out;
}

/** Laptops (dark, faintly textured bezel around a green screen), antialiased, over the background. */
function renderScreens(
	W: number,
	H: number,
	t: number,
	laptops: M[],
	hand: Hand | null = null,
	green: [number, number, number] = [20, 220, 40],
): RgbFrame {
	const [gr, gg, gb] = green;
	const data = new Uint8Array(W * H * 3);
	const bgc = screenBackground(W, H);
	const bezelTex = screenTextures().bezel;
	const quads = laptops.map((m) => ({
		outer: edgesOf(mapQ(m, BEZEL)),
		inner: edgesOf(mapQ(m, SCREEN)),
		mi: inv(m),
	}));
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const p = (y * W + x) * 3;
			let cr = bgc[p];
			let cg = bgc[p + 1];
			let cb = bgc[p + 2];
			for (const q of quads) {
				const co = cover(q.outer, x, y);
				if (co <= 0) continue;
				const ci = cover(q.inner, x, y);
				let bz = 35;
				if (ci < 1) {
					const mi = q.mi;
					const wz = mi[6] * x + mi[7] * y + mi[8];
					const u = (mi[0] * x + mi[1] * y + mi[2]) / wz;
					const v = (mi[3] * x + mi[4] * y + mi[5]) / wz;
					bz += (sample(bezelTex, u % bezelTex.w, v % bezelTex.h) - 128) * 0.15;
				}
				cr = cr * (1 - co) + (bz * (1 - ci) + gr * ci) * co;
				cg = cg * (1 - co) + (bz * (1 - ci) + gg * ci) * co;
				cb = cb * (1 - co) + (bz * (1 - ci) + gb * ci) * co;
			}
			if (hand) {
				const e = Math.hypot((x - hand.x) / hand.rx, (y - hand.y) / hand.ry);
				const cov = Math.min(1, Math.max(0, (1 - e) * hand.rx + 0.5));
				cr = cr * (1 - cov) + 225 * cov;
				cg = cg * (1 - cov) + 180 * cov;
				cb = cb * (1 - cov) + 150 * cov;
			}
			data[p] = Math.max(0, Math.min(255, Math.round(cr + noiseAt(t, p) * 1.5)));
			data[p + 1] = Math.max(0, Math.min(255, Math.round(cg + noiseAt(t, p + 1) * 1.5)));
			data[p + 2] = Math.max(0, Math.min(255, Math.round(cb + noiseAt(t, p + 2) * 1.5)));
		}
	return { width: W, height: H, data };
}

const lapMotion = (t: number, W = 640, H = 360) => planeMotion(t, W, H, LAP_W, LAP_H, 9, 0.9);
const lapFrames = new Map<number, RgbFrame>();
/** The single-laptop sequence at 640x360, rendered once and shared. */
function lapFrame(t: number): RgbFrame {
	let f = lapFrames.get(t);
	if (!f) {
		f = renderScreens(640, 360, t, [lapMotion(t)]);
		lapFrames.set(t, f);
	}
	return f;
}

describe("screen finder", () => {
	const lap = lapMotion;

	it("finds the green quad within a pixel", () => {
		const finder = createScreenFinder({ color: "#00ff00" });
		const errs: number[] = [];
		for (let t = 0; t < 60; t++) {
			const r = finder.step(lapFrame(t));
			expect(r.value).not.toBeNull();
			if (r.value) errs.push(...cornerErrors(r.value, mapQ(lap(t), SCREEN)));
		}
		const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
		console.log("screen clean", { mean, max: Math.max(...errs) });
		expect(mean).toBeLessThan(1);
	});

	it("holds a corner a hand covers", () => {
		const finder = createScreenFinder({ color: "#00ff00" });
		const hidden: number[] = [];
		const all: number[] = [];
		for (let t = 0; t < 50; t++) {
			const truth = mapQ(lap(t), SCREEN);
			const hand =
				t >= 15 && t < 40
					? {
							x: truth[2][0] - 6 + 20 * Math.sin(t / 4),
							y: truth[2][1] - 4,
							rx: 34,
							ry: 30,
						}
					: null;
			const f = renderScreens(640, 360, t, [lap(t)], hand);
			const r = finder.step(f);
			expect(r.value).not.toBeNull();
			if (!r.value) continue;
			const e = cornerErrors(r.value, truth);
			all.push(...e);
			if (hand) hidden.push(e[2]);
		}
		console.log("screen hand", {
			maxHidden: Math.max(...hidden),
			mean: all.reduce((a, b) => a + b) / all.length,
		});
		expect(Math.max(...hidden)).toBeLessThan(4);
	});

	it("keys a real, darker green from '#00ff00'", () => {
		const finder = createScreenFinder({ color: "#00ff00" });
		const errs: number[] = [];
		for (let t = 0; t < 20; t++) {
			const f = renderScreens(640, 360, t, [lap(t)], null, [60, 172, 82]);
			const r = finder.step(f);
			expect(r.value).not.toBeNull();
			if (r.value) errs.push(...cornerErrors(r.value, mapQ(lap(t), SCREEN)));
		}
		const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
		console.log("screen dark green", { mean, max: Math.max(...errs) });
		expect(mean).toBeLessThan(1);
	});

	it("uses the hint to pick between two screens", () => {
		const left = mul(T(-150, 20), planeMotion(0, 640, 360, LAP_W, LAP_H, 9, 0.6));
		const right = mul(T(170, 10), planeMotion(3, 640, 360, LAP_W, LAP_H, 9, 0.45));
		const f = renderScreens(640, 360, 0, [left, right]);
		const truthR = mapQ(right, SCREEN);
		const truthL = mapQ(left, SCREEN);
		const hint = truthR.map(([x, y], i) => [x + (i % 2 ? 8 : -6), y + (i < 2 ? -7 : 5)]) as Quad;
		const r = createScreenFinder({ color: "#00ff00", hint }).step(f);
		expect(r.value).not.toBeNull();
		expect(Math.max(...cornerErrors(r.value as Quad, truthR))).toBeLessThan(1.5);
		const big = createScreenFinder({ color: "#00ff00" }).step(f);
		expect(Math.max(...cornerErrors(big.value as Quad, truthL))).toBeLessThan(1.5);
	});

	it("keeps up at 960x540", () => {
		const finder = createScreenFinder({ color: "#00ff00" });
		const frames = Array.from({ length: 20 }, (_, t) =>
			renderScreens(960, 540, t, [lap(t, 960, 540)]),
		);
		const t0 = performance.now();
		let err = 0;
		frames.forEach((f, t) => {
			const r = finder.step(f);
			if (r.value) err = Math.max(err, ...cornerErrors(r.value, mapQ(lap(t, 960, 540), SCREEN)));
		});
		const ms = performance.now() - t0;
		console.log(`screen 960x540: ${(ms / 20).toFixed(1)} ms/frame, max err ${err.toFixed(3)}`);
		expect(err).toBeLessThan(2);
		expect(ms / 20).toBeLessThan(150);
	});
});

describe("blendAnchoredTracks", () => {
	const truth = (i: number): Quad => rectQuad(10 + i * 2, 20 + i, 110 + i * 2, 80 + i);
	const shift = (q: Quad, d: number): Quad => q.map(([x, y]) => [x + d, y - d]) as Quad;

	it("keeps anchors exact and crossfades between them", () => {
		const n = 21;
		// Forward drifts away from anchor 0, backward from anchor 20.
		const fwd = Array.from({ length: n }, (_, i) => shift(truth(i), i * 0.3));
		const bwd = Array.from({ length: n }, (_, i) => shift(truth(i), -(20 - i) * 0.3));
		fwd[20] = truth(20);
		bwd[0] = truth(0);
		const res = blendAnchoredTracks(fwd, bwd, Array(n).fill(1), Array(n).fill(1));
		expect(cornerErrors(res.quads[0] as Quad, truth(0))).toEqual([0, 0, 0, 0]);
		expect(cornerErrors(res.quads[20] as Quad, truth(20))).toEqual([0, 0, 0, 0]);
		const xs = res.quads.map((q) => (q as Quad)[0][0] - truth(0)[0][0]);
		for (let i = 1; i < n - 1; i++) {
			const second = xs[i + 1] - 2 * xs[i] + xs[i - 1];
			expect(Math.abs(second)).toBeLessThan(0.35);
		}
		// Mid-way both drifts are equal and opposite, so they cancel.
		expect(Math.max(...cornerErrors(res.quads[10] as Quad, truth(10)))).toBeLessThan(1e-9);
	});

	it("finds anchors in the middle and leans on the surer track", () => {
		const n = 21;
		const fwd: (Quad | null)[] = [];
		const bwd: (Quad | null)[] = [];
		for (let i = 0; i < n; i++) {
			fwd.push(i < 10 ? shift(truth(i), i * 0.2) : shift(truth(i), (i - 10) * 0.2));
			bwd.push(i <= 10 ? shift(truth(i), -(10 - i) * 0.2) : shift(truth(i), -(20 - i) * 0.2));
		}
		fwd[10] = truth(10);
		bwd[10] = truth(10);
		fwd[0] = truth(0);
		bwd[20] = truth(20);
		fwd[20] = truth(20);
		bwd[0] = truth(0);
		const fc = Array(n).fill(1);
		const bc = Array(n).fill(1);
		for (let i = 11; i < 20; i++) bc[i] = 0.1;
		const res = blendAnchoredTracks(fwd, bwd, fc, bc);
		for (const a of [0, 10, 20]) {
			expect(Math.max(...cornerErrors(res.quads[a] as Quad, truth(a)))).toBe(0);
			expect(res.confidence[a]).toBe(1);
		}
		// Between 10 and 20 the backward track is unsure, so forward dominates past the middle.
		const q15 = (res.quads[15] as Quad)[0][0] - truth(15)[0][0];
		expect(q15).toBeGreaterThan(0.5);
		fwd[5] = null;
		bwd[5] = null;
		expect(blendAnchoredTracks(fwd, bwd, fc, bc).quads[5]).toBeNull();
	});
});

describe("smoothQuads", () => {
	it("halves jitter on a noisy ramp without lag and fills gaps", () => {
		const r = rand(3);
		const n = 90;
		const ramp = (i: number): Quad => rectQuad(3 * i, 2 * i, 3 * i + 100, 2 * i + 50);
		const noisy: (Quad | null)[] = [];
		for (let i = 0; i < n; i++)
			noisy.push(ramp(i).map(([x, y]) => [x + gauss(r), y + gauss(r)]) as Quad);
		const rms = (qs: (Quad | null)[]) => {
			let s = 0;
			let c = 0;
			qs.forEach((q, i) => {
				if (!q) return;
				for (const e of cornerErrors(q, ramp(i))) {
					s += e * e;
					c++;
				}
			});
			return Math.sqrt(s / c);
		};
		const sm = smoothQuads(noisy, 0.5);
		console.log("smooth", { before: rms(noisy), after: rms(sm) });
		expect(rms(sm)).toBeLessThan(0.5 * rms(noisy));
		const clean = Array.from({ length: n }, (_, i) => ramp(i));
		expect(rms(smoothQuads(clean, 1))).toBeLessThan(1e-6);
		const gappy: (Quad | null)[] = clean.slice();
		gappy[0] = null;
		gappy[40] = null;
		gappy[41] = null;
		gappy[n - 1] = null;
		const filled = smoothQuads(gappy, 0);
		expect(cornerErrors(filled[40], ramp(40)).every((e) => e < 1e-9)).toBe(true);
		expect(filled[0]).toEqual(ramp(1));
		expect(filled[n - 1]).toEqual(ramp(n - 2));
	});
});
