/**
 * Motion tracking in plain TypeScript: a planar corner-pin tracker, an object
 * tracker and a green/blue screen finder, with the maths around them
 * (homographies, joining anchored tracks, smoothing). Frames come in one at a
 * time, so a clip never has to sit in memory.
 *
 * Coordinates are frame pixels with the centre of the top-left pixel at (0, 0).
 * To track backwards, make a tracker on the later frame and feed it the frames
 * in reverse order.
 */

export type Pt = [number, number];
/** Corners in order top-left, top-right, bottom-right, bottom-left, in frame pixels. */
export type Quad = [Pt, Pt, Pt, Pt];
/** One byte of luma per pixel, row by row. */
export interface GrayFrame {
	width: number;
	height: number;
	data: Uint8Array;
}
/** rgb24: three bytes per pixel, row by row. */
export interface RgbFrame {
	width: number;
	height: number;
	data: Uint8Array;
}
export interface Step<T> {
	value: T | null;
	/** 0–1 how sure the tracker is about this frame. */
	confidence: number;
}
export interface ObjectPose {
	center: Pt;
	/** relative to the first frame */
	scale: number;
	/** degrees, relative to the first frame */
	rotation: number;
}

// ---------------------------------------------------------------------------
// Small maths

type Mat = number[];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampI = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);

function mul3(a: Mat, b: Mat): Mat {
	return [
		a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
		a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
		a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
		a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
		a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
		a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
		a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
		a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
		a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
	];
}

function unit(m: Mat): Mat | null {
	const s = m[8];
	if (!Number.isFinite(s) || Math.abs(s) < 1e-12) return null;
	const out = m.map((v) => v / s);
	return out.every(Number.isFinite) ? out : null;
}

function inv3(m: Mat): Mat | null {
	const [a, b, c, d, e, f, g, h, i] = m;
	const A = e * i - f * h;
	const B = -(d * i - f * g);
	const C = d * h - e * g;
	const det = a * A + b * B + c * C;
	if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;
	return unit([
		A / det,
		-(b * i - c * h) / det,
		(b * f - c * e) / det,
		B / det,
		(a * i - c * g) / det,
		-(a * f - c * d) / det,
		C / det,
		-(a * h - b * g) / det,
		(a * e - b * d) / det,
	]);
}

/** Solves a (n x n, row-major) x = b in place (result in b); false when singular. */
function solveLinear(a: Float64Array, b: Float64Array, n: number): boolean {
	for (let col = 0; col < n; col++) {
		let piv = col;
		let best = Math.abs(a[col * n + col]);
		for (let r = col + 1; r < n; r++) {
			const v = Math.abs(a[r * n + col]);
			if (v > best) {
				best = v;
				piv = r;
			}
		}
		if (best < 1e-12) return false;
		if (piv !== col) {
			for (let c = 0; c < n; c++) {
				const t = a[col * n + c];
				a[col * n + c] = a[piv * n + c];
				a[piv * n + c] = t;
			}
			const t = b[col];
			b[col] = b[piv];
			b[piv] = t;
		}
		const d = a[col * n + col];
		for (let r = col + 1; r < n; r++) {
			const f = a[r * n + col] / d;
			if (f === 0) continue;
			for (let c = col; c < n; c++) a[r * n + c] -= f * a[col * n + c];
			b[r] -= f * b[col];
		}
	}
	for (let r = n - 1; r >= 0; r--) {
		let s = b[r];
		for (let c = r + 1; c < n; c++) s -= a[r * n + c] * b[c];
		b[r] = s / a[r * n + r];
	}
	for (let r = 0; r < n; r++) if (!Number.isFinite(b[r])) return false;
	return true;
}

/** Deterministic random numbers in [0, 1) (mulberry32). */
function seeded(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function applyHomography(h: number[], p: Pt): Pt {
	const w = h[6] * p[0] + h[7] * p[1] + h[8];
	return [(h[0] * p[0] + h[1] * p[1] + h[2]) / w, (h[3] * p[0] + h[4] * p[1] + h[5]) / w];
}

function mapQuad(h: Mat, q: Quad): Quad {
	return [
		applyHomography(h, q[0]),
		applyHomography(h, q[1]),
		applyHomography(h, q[2]),
		applyHomography(h, q[3]),
	];
}

/** Signed area (positive for top-left, top-right, bottom-right, bottom-left in frame pixels). */
function polyArea(q: Pt[]): number {
	let s = 0;
	for (let i = 0; i < q.length; i++) {
		const a = q[i];
		const b = q[(i + 1) % q.length];
		s += a[0] * b[1] - b[0] * a[1];
	}
	return s / 2;
}

function isConvex(q: Pt[]): boolean {
	let sign = 0;
	for (let i = 0; i < q.length; i++) {
		const a = q[i];
		const b = q[(i + 1) % q.length];
		const c = q[(i + 2) % q.length];
		const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
		if (!Number.isFinite(cr) || Math.abs(cr) < 1e-9) return false;
		const s = cr > 0 ? 1 : -1;
		if (sign === 0) sign = s;
		else if (s !== sign) return false;
	}
	return true;
}

function insidePoly(q: Pt[], x: number, y: number): boolean {
	let inside = false;
	for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
		const [xi, yi] = q[i];
		const [xj, yj] = q[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/** The quad grown about its centre so each side moves out by `margin` of the quad's size. */
function expandQuad(q: Quad, margin: number): Quad {
	const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
	const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
	const s = 1 + 2 * margin;
	return q.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]) as Quad;
}

/** Corners sorted around their centre, starting at the one nearest the top-left. */
function orderQuad(pts: Pt[]): Quad {
	const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
	const cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
	const sorted = pts
		.slice()
		.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
	let first = 0;
	for (let i = 1; i < 4; i++)
		if (sorted[i][0] + sorted[i][1] < sorted[first][0] + sorted[first][1]) first = i;
	return [0, 1, 2, 3].map((i) => sorted[(first + i) % 4]) as Quad;
}

// ---------------------------------------------------------------------------
// Model fitting (homography, similarity, translation) and RANSAC

/** Hartley normalisation of a subset: centroid and the scale giving a mean distance of sqrt 2. */
function normaliser(p: Float64Array, idx: ArrayLike<number>, m: number): [number, number, number] {
	let cx = 0;
	let cy = 0;
	for (let k = 0; k < m; k++) {
		cx += p[2 * idx[k]];
		cy += p[2 * idx[k] + 1];
	}
	cx /= m;
	cy /= m;
	let d = 0;
	for (let k = 0; k < m; k++) d += Math.hypot(p[2 * idx[k]] - cx, p[2 * idx[k] + 1] - cy);
	d /= m;
	return [cx, cy, d > 1e-12 ? Math.SQRT2 / d : 1];
}

function denormalise(
	hn: Mat,
	s: [number, number, number],
	d: [number, number, number],
): Mat | null {
	const ts = [s[2], 0, -s[2] * s[0], 0, s[2], -s[2] * s[1], 0, 0, 1];
	const tdi = [1 / d[2], 0, d[0], 0, 1 / d[2], d[1], 0, 0, 1];
	return unit(mul3(tdi, mul3(hn, ts)));
}

/** Least-squares homography (normalised DLT with h8 = 1) over the chosen pairs. */
function fitHomography(src: Float64Array, dst: Float64Array, idx: ArrayLike<number>, m: number) {
	if (m < 4) return null;
	const s = normaliser(src, idx, m);
	const d = normaliser(dst, idx, m);
	const A = new Float64Array(64);
	const B = new Float64Array(8);
	const r = new Float64Array(8);
	for (let k = 0; k < m; k++) {
		const i = idx[k];
		const x = (src[2 * i] - s[0]) * s[2];
		const y = (src[2 * i + 1] - s[1]) * s[2];
		const u = (dst[2 * i] - d[0]) * d[2];
		const v = (dst[2 * i + 1] - d[1]) * d[2];
		for (let row = 0; row < 2; row++) {
			const t = row === 0 ? u : v;
			r.fill(0);
			const o = row * 3;
			r[o] = x;
			r[o + 1] = y;
			r[o + 2] = 1;
			r[6] = -x * t;
			r[7] = -y * t;
			for (let a = 0; a < 8; a++) {
				const ra = r[a];
				if (ra === 0) continue;
				B[a] += ra * t;
				for (let b = 0; b < 8; b++) A[a * 8 + b] += ra * r[b];
			}
		}
	}
	if (!solveLinear(A, B, 8)) return null;
	return denormalise([B[0], B[1], B[2], B[3], B[4], B[5], B[6], B[7], 1], s, d);
}

/** Levenberg–Marquardt on the reprojection error, in normalised coordinates. */
function polishHomography(
	h: Mat,
	src: Float64Array,
	dst: Float64Array,
	idx: ArrayLike<number>,
	m: number,
): Mat {
	if (m < 5) return h;
	const s = normaliser(src, idx, m);
	const d = normaliser(dst, idx, m);
	const ts = [s[2], 0, -s[2] * s[0], 0, s[2], -s[2] * s[1], 0, 0, 1];
	const td = [d[2], 0, -d[2] * d[0], 0, d[2], -d[2] * d[1], 0, 0, 1];
	const tsi = inv3(ts);
	if (!tsi) return h;
	const start = unit(mul3(td, mul3(h, tsi)));
	if (!start) return h;
	const xs = new Float64Array(m * 2);
	const us = new Float64Array(m * 2);
	for (let k = 0; k < m; k++) {
		const i = idx[k];
		xs[2 * k] = (src[2 * i] - s[0]) * s[2];
		xs[2 * k + 1] = (src[2 * i + 1] - s[1]) * s[2];
		us[2 * k] = (dst[2 * i] - d[0]) * d[2];
		us[2 * k + 1] = (dst[2 * i + 1] - d[1]) * d[2];
	}
	const cost = (p: Mat) => {
		let c = 0;
		for (let k = 0; k < m; k++) {
			const x = xs[2 * k];
			const y = xs[2 * k + 1];
			const w = p[6] * x + p[7] * y + 1;
			const eu = (p[0] * x + p[1] * y + p[2]) / w - us[2 * k];
			const ev = (p[3] * x + p[4] * y + p[5]) / w - us[2 * k + 1];
			c += eu * eu + ev * ev;
		}
		return c;
	};
	let p = start.slice();
	let c0 = cost(p);
	let lambda = 1e-3;
	const JtJ = new Float64Array(64);
	const Jte = new Float64Array(8);
	const J = new Float64Array(16);
	for (let it = 0; it < 10; it++) {
		JtJ.fill(0);
		Jte.fill(0);
		for (let k = 0; k < m; k++) {
			const x = xs[2 * k];
			const y = xs[2 * k + 1];
			const w = p[6] * x + p[7] * y + 1;
			const pu = (p[0] * x + p[1] * y + p[2]) / w;
			const pv = (p[3] * x + p[4] * y + p[5]) / w;
			const eu = pu - us[2 * k];
			const ev = pv - us[2 * k + 1];
			J.fill(0);
			J[0] = x / w;
			J[1] = y / w;
			J[2] = 1 / w;
			J[6] = (-pu * x) / w;
			J[7] = (-pu * y) / w;
			J[8 + 3] = x / w;
			J[8 + 4] = y / w;
			J[8 + 5] = 1 / w;
			J[8 + 6] = (-pv * x) / w;
			J[8 + 7] = (-pv * y) / w;
			for (let a = 0; a < 8; a++) {
				const ja = J[a];
				const jb = J[8 + a];
				Jte[a] += ja * eu + jb * ev;
				for (let b = 0; b < 8; b++) JtJ[a * 8 + b] += ja * J[b] + jb * J[8 + b];
			}
		}
		let improved = false;
		for (let tries = 0; tries < 5 && !improved; tries++) {
			const A = JtJ.slice();
			for (let a = 0; a < 8; a++) A[a * 9] *= 1 + lambda;
			const step = Jte.map((v) => -v);
			if (!solveLinear(A, step, 8)) {
				lambda *= 10;
				continue;
			}
			const q = [...p.slice(0, 8).map((v, i) => v + step[i]), 1];
			const c1 = cost(q);
			if (c1 < c0) {
				const rel = (c0 - c1) / Math.max(c0, 1e-18);
				p = q;
				c0 = c1;
				lambda = Math.max(lambda / 10, 1e-9);
				improved = true;
				if (rel < 1e-10) it = 99;
			} else lambda *= 10;
		}
		if (!improved) break;
	}
	return denormalise(p, s, d) ?? h;
}

function fitSimilarity(src: Float64Array, dst: Float64Array, idx: ArrayLike<number>, m: number) {
	if (m < 2) return null;
	let cx = 0;
	let cy = 0;
	let cu = 0;
	let cv = 0;
	for (let k = 0; k < m; k++) {
		const i = idx[k];
		cx += src[2 * i];
		cy += src[2 * i + 1];
		cu += dst[2 * i];
		cv += dst[2 * i + 1];
	}
	cx /= m;
	cy /= m;
	cu /= m;
	cv /= m;
	let a = 0;
	let b = 0;
	let sxx = 0;
	for (let k = 0; k < m; k++) {
		const i = idx[k];
		const x = src[2 * i] - cx;
		const y = src[2 * i + 1] - cy;
		const u = dst[2 * i] - cu;
		const v = dst[2 * i + 1] - cv;
		a += x * u + y * v;
		b += x * v - y * u;
		sxx += x * x + y * y;
	}
	if (sxx < 1e-6) return null;
	a /= sxx;
	b /= sxx;
	return [a, -b, cu - (a * cx - b * cy), b, a, cv - (b * cx + a * cy), 0, 0, 1];
}

function fitTranslation(src: Float64Array, dst: Float64Array, idx: ArrayLike<number>, m: number) {
	if (m < 1) return null;
	let tx = 0;
	let ty = 0;
	for (let k = 0; k < m; k++) {
		const i = idx[k];
		tx += dst[2 * i] - src[2 * i];
		ty += dst[2 * i + 1] - src[2 * i + 1];
	}
	return [1, 0, tx / m, 0, 1, ty / m, 0, 0, 1];
}

interface Model {
	min: number;
	fit(src: Float64Array, dst: Float64Array, idx: ArrayLike<number>, m: number): Mat | null;
	polish?(h: Mat, src: Float64Array, dst: Float64Array, idx: ArrayLike<number>, m: number): Mat;
	/** True when a minimal sample can't define a sensible model (collinear, mirrored, repeated). */
	degenerate(src: Float64Array, dst: Float64Array, idx: ArrayLike<number>): boolean;
}

const cross3 = (p: Float64Array, a: number, b: number, c: number) =>
	(p[2 * b] - p[2 * a]) * (p[2 * c + 1] - p[2 * a + 1]) -
	(p[2 * b + 1] - p[2 * a + 1]) * (p[2 * c] - p[2 * a]);

const MODELS = {
	homography: {
		min: 4,
		fit: fitHomography,
		polish: polishHomography,
		degenerate(src, dst, idx) {
			const t = [
				[0, 1, 2],
				[0, 1, 3],
				[0, 2, 3],
				[1, 2, 3],
			];
			for (const [a, b, c] of t) {
				const s = cross3(src, idx[a], idx[b], idx[c]);
				const d = cross3(dst, idx[a], idx[b], idx[c]);
				if (Math.abs(s) < 4 || Math.abs(d) < 4 || s > 0 !== d > 0) return true;
			}
			return false;
		},
	},
	similarity: {
		min: 2,
		fit: fitSimilarity,
		degenerate(src, _dst, idx) {
			return (
				Math.hypot(src[2 * idx[0]] - src[2 * idx[1]], src[2 * idx[0] + 1] - src[2 * idx[1] + 1]) < 4
			);
		},
	},
	translation: { min: 1, fit: fitTranslation, degenerate: () => false },
} satisfies Record<string, Model>;

type ModelKind = keyof typeof MODELS;

interface Fit {
	h: Mat;
	inliers: Uint8Array;
	count: number;
	/** RMS reprojection error of the inliers, in pixels. */
	rms: number;
}

function reprojErr2(h: Mat, src: Float64Array, dst: Float64Array, i: number): number {
	const x = src[2 * i];
	const y = src[2 * i + 1];
	const w = h[6] * x + h[7] * y + h[8];
	const u = (h[0] * x + h[1] * y + h[2]) / w - dst[2 * i];
	const v = (h[3] * x + h[4] * y + h[5]) / w - dst[2 * i + 1];
	const e = u * u + v * v;
	return w > 0 && Number.isFinite(e) ? e : Number.POSITIVE_INFINITY;
}

/**
 * Robust model fit: MSAC over minimal samples (adaptive stop), then least
 * squares on the inliers. Optional weights (0–1) say how much each pair's vote
 * counts and how often it is sampled.
 */
function ransac(
	model: Model,
	src: Float64Array,
	dst: Float64Array,
	n: number,
	thresh: number,
	rng: () => number,
	weights: Float32Array | null = null,
	maxIter = 200,
): Fit | null {
	if (n < model.min) return null;
	const t2 = thresh * thresh;
	const k = model.min;
	let wt = weights;
	if (wt) {
		let voters = 0;
		for (let i = 0; i < n; i++) if (wt[i] > 0) voters++;
		if (voters < k) wt = null;
	}
	let wsum = n;
	if (wt) {
		wsum = 0;
		for (let i = 0; i < n; i++) wsum += wt[i];
	}
	const sample = new Int32Array(k);
	let bestCost = Number.POSITIVE_INFINITY;
	let best: Mat | null = null;
	let iters = maxIter;
	for (let it = 0; it < iters; it++) {
		for (let a = 0; a < k; a++) {
			let r = 0;
			let again = true;
			while (again) {
				r = Math.floor(rng() * n);
				again = !!wt && rng() >= wt[r];
				for (let b = 0; b < a; b++) if (sample[b] === r) again = true;
			}
			sample[a] = r;
		}
		if (n > k && model.degenerate(src, dst, sample)) continue;
		const h = model.fit(src, dst, sample, k);
		if (!h) continue;
		let cost = 0;
		let count = 0;
		for (let i = 0; i < n && cost < bestCost; i++) {
			const e = reprojErr2(h, src, dst, i);
			const w = wt ? wt[i] : 1;
			if (e < t2) {
				cost += e * w;
				count += w;
			} else cost += t2 * w;
		}
		if (cost < bestCost) {
			bestCost = cost;
			best = h;
			const w = count / wsum;
			const miss = 1 - w ** k;
			const need = miss <= 1e-12 ? 1 : Math.ceil(Math.log(0.005) / Math.log(miss));
			iters = Math.min(maxIter, Math.max(12, need));
		}
	}
	if (!best) return null;
	let h = best;
	const inliers = new Uint8Array(n);
	const mark = (m: Mat) => {
		let c = 0;
		for (let i = 0; i < n; i++) {
			const ok = reprojErr2(m, src, dst, i) < t2;
			inliers[i] = ok ? 1 : 0;
			if (ok) c++;
		}
		return c;
	};
	let count = mark(h);
	for (let pass = 0; pass < 2; pass++) {
		const idx: number[] = [];
		for (let i = 0; i < n; i++) if (inliers[i]) idx.push(i);
		if (idx.length < k) break;
		let h2 = model.fit(src, dst, idx, idx.length);
		if (!h2) break;
		if (model.polish) h2 = model.polish(h2, src, dst, idx, idx.length);
		const prev = h;
		h = h2;
		const c2 = mark(h);
		if (c2 < k) {
			h = prev;
			count = mark(h);
			break;
		}
		count = c2;
	}
	let se = 0;
	for (let i = 0; i < n; i++) if (inliers[i]) se += reprojErr2(h, src, dst, i);
	return { h, inliers, count, rms: count ? Math.sqrt(se / count) : Number.POSITIVE_INFINITY };
}

/**
 * The 3x3 homography (row-major, h[8] = 1) mapping src points to dst points
 * (4+ pairs; least squares for more).
 */
export function homography(src: Pt[], dst: Pt[]): number[] | null {
	const n = Math.min(src.length, dst.length);
	if (n < 4) return null;
	const s = new Float64Array(n * 2);
	const d = new Float64Array(n * 2);
	const idx: number[] = [];
	for (let i = 0; i < n; i++) {
		s[2 * i] = src[i][0];
		s[2 * i + 1] = src[i][1];
		d[2 * i] = dst[i][0];
		d[2 * i + 1] = dst[i][1];
		idx.push(i);
	}
	const h = fitHomography(s, d, idx, n);
	if (!h) return null;
	return n > 4 ? polishHomography(h, s, d, idx, n) : h;
}

// ---------------------------------------------------------------------------
// Images, pyramids and Lucas–Kanade

interface Img {
	w: number;
	h: number;
	d: Float32Array;
}

function grayImg(f: GrayFrame): Img {
	const n = f.width * f.height;
	if (f.data.length < n) throw new Error("Tracker: frame data is shorter than width x height");
	const d = new Float32Array(n);
	const s = f.data;
	for (let i = 0; i < n; i++) d[i] = s[i];
	return { w: f.width, h: f.height, d };
}

/** Luma (BT.601) of an rgb24 frame, for the trackers. */
export function rgbToGray(frame: RgbFrame): GrayFrame {
	const n = frame.width * frame.height;
	const out = new Uint8Array(n);
	const s = frame.data;
	for (let i = 0, p = 0; i < n; i++, p += 3)
		out[i] = (s[p] * 77 + s[p + 1] * 150 + s[p + 2] * 29 + 128) >> 8;
	return { width: frame.width, height: frame.height, data: out };
}

/** Half-size image after a 5-tap binomial blur. */
function pyrDown(src: Img): Img {
	const { w, h, d } = src;
	const w2 = (w + 1) >> 1;
	const h2 = (h + 1) >> 1;
	const tmp = new Float32Array(w2 * h);
	for (let y = 0; y < h; y++) {
		const row = y * w;
		const trow = y * w2;
		for (let x2 = 0; x2 < w2; x2++) {
			const x = x2 * 2;
			if (x >= 2 && x + 2 < w) {
				const i = row + x;
				tmp[trow + x2] = d[i - 2] + 4 * (d[i - 1] + d[i + 1]) + 6 * d[i] + d[i + 2];
			} else {
				tmp[trow + x2] =
					d[row + clampI(x - 2, w)] +
					4 * (d[row + clampI(x - 1, w)] + d[row + clampI(x + 1, w)]) +
					6 * d[row + x] +
					d[row + clampI(x + 2, w)];
			}
		}
	}
	const out = new Float32Array(w2 * h2);
	for (let y2 = 0; y2 < h2; y2++) {
		const y = y2 * 2;
		const r0 = clampI(y - 2, h) * w2;
		const r1 = clampI(y - 1, h) * w2;
		const r2 = y * w2;
		const r3 = clampI(y + 1, h) * w2;
		const r4 = clampI(y + 2, h) * w2;
		const o = y2 * w2;
		for (let x = 0; x < w2; x++)
			out[o + x] =
				(tmp[r0 + x] + 4 * (tmp[r1 + x] + tmp[r3 + x]) + 6 * tmp[r2 + x] + tmp[r4 + x]) / 256;
	}
	return { w: w2, h: h2, d: out };
}

function buildPyramid(img: Img, maxLevels: number, minSize = 24): Img[] {
	const out = [img];
	while (out.length < maxLevels) {
		const last = out[out.length - 1];
		if (last.w < minSize * 2 || last.h < minSize * 2) break;
		out.push(pyrDown(last));
	}
	return out;
}

/** Bilinear samples of a size x size patch whose top-left sample is at (x0, y0); edges repeat. */
function samplePatch(img: Img, x0: number, y0: number, size: number, out: Float32Array): void {
	const { w, h, d } = img;
	const ix = Math.floor(x0);
	const iy = Math.floor(y0);
	const fx = x0 - ix;
	const fy = y0 - iy;
	const w00 = (1 - fx) * (1 - fy);
	const w01 = fx * (1 - fy);
	const w10 = (1 - fx) * fy;
	const w11 = fx * fy;
	let k = 0;
	if (ix >= 0 && iy >= 0 && ix + size < w && iy + size < h) {
		for (let r = 0; r < size; r++) {
			let i = (iy + r) * w + ix;
			for (let c = 0; c < size; c++, i++)
				out[k++] = w00 * d[i] + w01 * d[i + 1] + w10 * d[i + w] + w11 * d[i + w + 1];
		}
		return;
	}
	for (let r = 0; r < size; r++) {
		const ya = clampI(iy + r, h) * w;
		const yb = clampI(iy + r + 1, h) * w;
		for (let c = 0; c < size; c++) {
			const xa = clampI(ix + c, w);
			const xb = clampI(ix + c + 1, w);
			out[k++] = w00 * d[ya + xa] + w01 * d[ya + xb] + w10 * d[yb + xa] + w11 * d[yb + xb];
		}
	}
}

function bilinear(img: Img, x: number, y: number): number {
	const { w, h, d } = img;
	if (x < 0) x = 0;
	else if (x > w - 1) x = w - 1;
	if (y < 0) y = 0;
	else if (y > h - 1) y = h - 1;
	const ix = Math.min(Math.floor(x), w - 2 < 0 ? 0 : w - 2);
	const iy = Math.min(Math.floor(y), h - 2 < 0 ? 0 : h - 2);
	const fx = x - ix;
	const fy = y - iy;
	const i = iy * w + ix;
	const x1 = w > 1 ? 1 : 0;
	const y1 = h > 1 ? w : 0;
	return (
		(d[i] * (1 - fx) + d[i + x1] * fx) * (1 - fy) +
		(d[i + y1] * (1 - fx) + d[i + y1 + x1] * fx) * fy
	);
}

const LK_ITERS = 10;
const LK_EPS2 = 0.01 * 0.01;
/** Mean squared gradient below which a window is too flat to track. */
const LK_MIN_EIG = 1;
/** Mean absolute difference (grey levels, brightness offset removed) above which a match is dropped. */
const LK_MAX_RESIDUAL = 16;

/**
 * Pyramidal Lucas–Kanade for one point at a time, with subpixel bilinear
 * sampling and a per-window brightness offset solved alongside the motion.
 */
class Lk {
	readonly half: number;
	private readonly size: number;
	private readonly ext: number;
	private readonly tp: Float32Array;
	private readonly tc: Float32Array;
	private readonly gx: Float32Array;
	private readonly gy: Float32Array;
	private readonly jb: Float32Array;
	x = 0;
	y = 0;
	residual = 0;

	constructor(half: number) {
		this.half = half;
		this.size = half * 2 + 1;
		this.ext = this.size + 2;
		this.tp = new Float32Array(this.ext * this.ext);
		const n = this.size * this.size;
		this.tc = new Float32Array(n);
		this.gx = new Float32Array(n);
		this.gy = new Float32Array(n);
		this.jb = new Float32Array(n);
	}

	/** Finds (px, py) of `prev` in `next` from a displacement guess; result in x, y, residual. */
	track(
		prev: Img[],
		next: Img[],
		px: number,
		py: number,
		guessX: number,
		guessY: number,
		top: number,
	): boolean {
		const { half, size, ext, tp, tc, gx, gy, jb } = this;
		const n = size * size;
		top = Math.min(top, prev.length - 1, next.length - 1);
		let dx = guessX / (1 << top);
		let dy = guessY / (1 << top);
		for (let L = top; L >= 0; L--) {
			const J = next[L];
			const s = 1 / (1 << L);
			const x = px * s;
			const y = py * s;
			samplePatch(prev[L], x - half - 1, y - half - 1, ext, tp);
			let gxx = 0;
			let gxy = 0;
			let gyy = 0;
			let sx = 0;
			let sy = 0;
			let k = 0;
			for (let r = 1; r <= size; r++) {
				let i = r * ext + 1;
				for (let c = 0; c < size; c++, i++, k++) {
					const ix =
						(3 * (tp[i - ext + 1] - tp[i - ext - 1] + tp[i + ext + 1] - tp[i + ext - 1]) +
							10 * (tp[i + 1] - tp[i - 1])) /
						32;
					const iy =
						(3 * (tp[i + ext - 1] - tp[i - ext - 1] + tp[i + ext + 1] - tp[i - ext + 1]) +
							10 * (tp[i + ext] - tp[i - ext])) /
						32;
					gx[k] = ix;
					gy[k] = iy;
					tc[k] = tp[i];
					gxx += ix * ix;
					gxy += ix * iy;
					gyy += iy * iy;
					sx += ix;
					sy += iy;
				}
			}
			const tr = (gxx + gyy) / 2;
			const minEig = (tr - Math.sqrt(((gxx - gyy) / 2) ** 2 + gxy * gxy)) / n;
			if (!(minEig >= LK_MIN_EIG)) {
				if (L === 0) return false;
				dx *= 2;
				dy *= 2;
				continue;
			}
			// Inverse of [[gxx, gxy, sx], [gxy, gyy, sy], [sx, sy, n]] (motion plus brightness offset).
			const c00 = gyy * n - sy * sy;
			const c01 = -(gxy * n - sx * sy);
			const c02 = gxy * sy - sx * gyy;
			const c11 = gxx * n - sx * sx;
			const c12 = -(gxx * sy - gxy * sx);
			const det = gxx * c00 + gxy * c01 + sx * c02;
			if (!(Math.abs(det) > 1e-9)) return false;
			const i00 = c00 / det;
			const i01 = c01 / det;
			const i02 = c02 / det;
			const i11 = c11 / det;
			const i12 = c12 / det;
			for (let it = 0; it < LK_ITERS; it++) {
				samplePatch(J, x + dx - half, y + dy - half, size, jb);
				let bx = 0;
				let by = 0;
				let bs = 0;
				for (let q = 0; q < n; q++) {
					const e = tc[q] - jb[q];
					bx += e * gx[q];
					by += e * gy[q];
					bs += e;
				}
				const ux = i00 * bx + i01 * by + i02 * bs;
				const uy = i01 * bx + i11 * by + i12 * bs;
				dx += ux;
				dy += uy;
				if (!(Math.abs(dx) < J.w && Math.abs(dy) < J.h)) return false;
				if (ux * ux + uy * uy < LK_EPS2) break;
			}
			if (L > 0) {
				dx *= 2;
				dy *= 2;
			}
		}
		const J0 = next[0];
		const fx = px + dx;
		const fy = py + dy;
		if (!(fx >= 0 && fy >= 0 && fx <= J0.w - 1 && fy <= J0.h - 1)) return false;
		samplePatch(J0, fx - half, fy - half, size, jb);
		let mean = 0;
		for (let q = 0; q < n; q++) mean += tc[q] - jb[q];
		mean /= n;
		let res = 0;
		for (let q = 0; q < n; q++) res += Math.abs(tc[q] - jb[q] - mean);
		this.x = fx;
		this.y = fy;
		this.residual = res / n;
		return true;
	}
}

/** Shi–Tomasi corner response below which an area counts as flat. */
const MIN_TEXTURE = 2;
const QUALITY = 0.01;

/**
 * Good features to track (Shi–Tomasi minimum eigenvalue over 5x5 windows)
 * inside a polygon, strongest first, kept apart by `minDist`.
 */
function detectFeatures(
	img: Img,
	region: Pt[],
	maxCount: number,
	minDist: number,
	border: number,
	avoid: Float32Array | null,
): Float32Array {
	const { w, h, d } = img;
	const R = 2;
	border = Math.max(border, R + 2);
	let minx = Number.POSITIVE_INFINITY;
	let maxx = Number.NEGATIVE_INFINITY;
	let miny = Number.POSITIVE_INFINITY;
	let maxy = Number.NEGATIVE_INFINITY;
	for (const [x, y] of region) {
		minx = Math.min(minx, x);
		maxx = Math.max(maxx, x);
		miny = Math.min(miny, y);
		maxy = Math.max(maxy, y);
	}
	const x0 = Math.max(border, Math.floor(minx));
	const x1 = Math.min(w - 1 - border, Math.ceil(maxx));
	const y0 = Math.max(border, Math.floor(miny));
	const y1 = Math.min(h - 1 - border, Math.ceil(maxy));
	if (!(x1 - x0 >= 4 && y1 - y0 >= 4)) return new Float32Array(0);
	const bw = x1 - x0 + 1;
	const bh = y1 - y0 + 1;
	const gw = bw + 2 * R;
	const gh = bh + 2 * R;
	const axx = new Float32Array(gw * gh);
	const axy = new Float32Array(gw * gh);
	const ayy = new Float32Array(gw * gh);
	for (let j = 0; j < gh; j++) {
		const y = y0 - R + j;
		for (let i = 0; i < gw; i++) {
			const p = y * w + x0 - R + i;
			const gx =
				(d[p - w + 1] + 2 * d[p + 1] + d[p + w + 1] - d[p - w - 1] - 2 * d[p - 1] - d[p + w - 1]) /
				8;
			const gy =
				(d[p + w - 1] + 2 * d[p + w] + d[p + w + 1] - d[p - w - 1] - 2 * d[p - w] - d[p - w + 1]) /
				8;
			const k = j * gw + i;
			axx[k] = gx * gx;
			axy[k] = gx * gy;
			ayy[k] = gy * gy;
		}
	}
	// 5-wide running sums across, then down.
	const hxx = new Float32Array(bw * gh);
	const hxy = new Float32Array(bw * gh);
	const hyy = new Float32Array(bw * gh);
	const win = 2 * R + 1;
	for (let j = 0; j < gh; j++) {
		const o = j * gw;
		let a = 0;
		let b = 0;
		let c = 0;
		for (let t = 0; t < win; t++) {
			a += axx[o + t];
			b += axy[o + t];
			c += ayy[o + t];
		}
		for (let i = 0; i < bw; i++) {
			hxx[j * bw + i] = a;
			hxy[j * bw + i] = b;
			hyy[j * bw + i] = c;
			if (i + win < gw) {
				a += axx[o + i + win] - axx[o + i];
				b += axy[o + i + win] - axy[o + i];
				c += ayy[o + i + win] - ayy[o + i];
			}
		}
	}
	const sxx = new Float32Array(bw * bh);
	const sxy = new Float32Array(bw * bh);
	const syy = new Float32Array(bw * bh);
	for (let i = 0; i < bw; i++) {
		let a = 0;
		let b = 0;
		let c = 0;
		for (let t = 0; t < win; t++) {
			a += hxx[t * bw + i];
			b += hxy[t * bw + i];
			c += hyy[t * bw + i];
		}
		for (let j = 0; j < bh; j++) {
			sxx[j * bw + i] = a;
			sxy[j * bw + i] = b;
			syy[j * bw + i] = c;
			if (j + win < gh) {
				a += hxx[(j + win) * bw + i] - hxx[j * bw + i];
				b += hxy[(j + win) * bw + i] - hxy[j * bw + i];
				c += hyy[(j + win) * bw + i] - hyy[j * bw + i];
			}
		}
	}
	const score = new Float32Array(bw * bh);
	const norm = 1 / (win * win);
	let maxS = 0;
	const cuts: number[] = [];
	for (let j = 0; j < bh; j++) {
		// Where this row is inside the polygon (even–odd crossings).
		const y = y0 + j;
		cuts.length = 0;
		for (let e = 0, f = region.length - 1; e < region.length; f = e++) {
			const [xa, ya] = region[e];
			const [xb, yb] = region[f];
			if (ya > y !== yb > y) cuts.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
		}
		cuts.sort((a, b) => a - b);
		for (let q = 0; q + 1 < cuts.length; q += 2) {
			const i0 = Math.max(0, Math.ceil(cuts[q]) - x0);
			const i1 = Math.min(bw - 1, Math.floor(cuts[q + 1]) - x0);
			for (let i = i0; i <= i1; i++) {
				const k = j * bw + i;
				const a = sxx[k] * norm;
				const b = sxy[k] * norm;
				const c = syy[k] * norm;
				const lam = (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b);
				score[k] = lam;
				if (lam > maxS) maxS = lam;
			}
		}
	}
	const thr = Math.max(QUALITY * maxS, MIN_TEXTURE);
	const cand: number[] = [];
	for (let j = 1; j < bh - 1; j++) {
		for (let i = 1; i < bw - 1; i++) {
			const k = j * bw + i;
			const v = score[k];
			if (v < thr) continue;
			if (
				v < score[k - 1] ||
				v <= score[k + 1] ||
				v < score[k - bw] ||
				v <= score[k + bw] ||
				v < score[k - bw - 1] ||
				v < score[k - bw + 1] ||
				v <= score[k + bw - 1] ||
				v <= score[k + bw + 1]
			)
				continue;
			cand.push(k);
		}
	}
	cand.sort((a, b) => score[b] - score[a]);
	const cell = Math.max(1, minDist);
	const gcols = Math.ceil(bw / cell) + 1;
	const grows = Math.ceil(bh / cell) + 1;
	const grid: number[][] = Array.from({ length: gcols * grows }, () => []);
	const md2 = minDist * minDist;
	const far = (x: number, y: number) => {
		const cx = Math.floor((x - x0) / cell);
		const cy = Math.floor((y - y0) / cell);
		for (let gyy = Math.max(0, cy - 1); gyy <= Math.min(grows - 1, cy + 1); gyy++)
			for (let gxx = Math.max(0, cx - 1); gxx <= Math.min(gcols - 1, cx + 1); gxx++) {
				const list = grid[gyy * gcols + gxx];
				for (let q = 0; q < list.length; q += 2)
					if ((list[q] - x) ** 2 + (list[q + 1] - y) ** 2 < md2) return false;
			}
		return true;
	};
	const put = (x: number, y: number) => {
		const cx = Math.floor((x - x0) / cell);
		const cy = Math.floor((y - y0) / cell);
		if (cx < 0 || cy < 0 || cx >= gcols || cy >= grows) return;
		grid[cy * gcols + cx].push(x, y);
	};
	if (avoid) for (let q = 0; q < avoid.length; q += 2) put(avoid[q], avoid[q + 1]);
	const out: number[] = [];
	for (const k of cand) {
		if (out.length >= maxCount * 2) break;
		const x = x0 + (k % bw);
		const y = y0 + Math.floor(k / bw);
		if (!far(x, y)) continue;
		put(x, y);
		out.push(x, y);
	}
	return Float32Array.from(out);
}

/** The current frame resampled into a crop of key-frame pixels through `g` (key → current). */
function warpCrop(src: Img, g: Mat, ox: number, oy: number, cw: number, ch: number): Img {
	const out = new Float32Array(cw * ch);
	const { w, h, d } = src;
	const mx = w - 1;
	const my = h - 1;
	for (let y = 0; y < ch; y++) {
		const Y = oy + y;
		let nx = g[0] * ox + g[1] * Y + g[2];
		let ny = g[3] * ox + g[4] * Y + g[5];
		let nw = g[6] * ox + g[7] * Y + g[8];
		const o = y * cw;
		for (let x = 0; x < cw; x++) {
			let sx = nx / nw;
			let sy = ny / nw;
			nx += g[0];
			ny += g[3];
			nw += g[6];
			if (!(sx > 0)) sx = 0;
			else if (sx > mx) sx = mx;
			if (!(sy > 0)) sy = 0;
			else if (sy > my) sy = my;
			let ix = sx | 0;
			let iy = sy | 0;
			if (ix >= mx) ix = mx - 1;
			if (iy >= my) iy = my - 1;
			const fx = sx - ix;
			const fy = sy - iy;
			const i = iy * w + ix;
			out[o + x] =
				(d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) +
				(d[i + w] * (1 - fx) + d[i + w + 1] * fx) * fy;
		}
	}
	return { w: cw, h: ch, d: out };
}

// ---------------------------------------------------------------------------
// The feature tracker behind the plane and object trackers

const LEVELS = 4;
const KEY_LEVELS = 3;
const INLIER_PX = 1.5;
const FB_MAX2 = 1;
const MAX_CORE_FEATURES = 160;
const MAX_MARGIN_FEATURES = 100;
const MIN_LIVE_FEATURES = 60;
/** Frame-to-frame only predicts, so it follows at most this many points. */
const MAX_F2F_POINTS = 100;
/** The core of a region: the quad plus this share of its size. The rest of the margin votes less. */
const CORE_BAND = 0.03;
const MARGIN_WEIGHT = 0.3;
/** Frames in a row a key feature may disagree with the result before it stops voting. */
const STRIKES_OUT = 3;
/** Dense alignment: the gradient (grey levels a pixel) a template pixel needs; samples per level. */
const DENSE_MIN_GRAD = 4;
const DENSE_CAPS = [6000, 3000, 1500];
/** Grey levels: the most noise the dense alignment will put down to noise. */
const DENSE_MAX_SIGMA = 10;
/** Weighted correlation with the template below which a dense alignment doesn't count. */
const DENSE_MIN_NCC = 0.8;

interface DenseLevel {
	n: number;
	/** Sample positions in key-frame pixels. */
	x: Float32Array;
	y: Float32Array;
	/** Template values and their steepest-descent rows (8 per sample). */
	t: Float32Array;
	sd: Float32Array;
}

interface Dense {
	cx: number;
	cy: number;
	s: number;
	levels: DenseLevel[];
}

interface Key {
	/** First frame → key frame. */
	h: Mat;
	inv: Mat;
	ox: number;
	oy: number;
	pyr: Img[];
	/** Features in the key frame's pixels. */
	pts: Float32Array;
	n: number;
	/** 1 when a feature lies in the core (the quad and a thin band), else 0. */
	core: Uint8Array;
	strikes: Uint8Array;
	dense: Dense | null;
}

interface KeyMatch {
	/** Key frame → current frame. */
	g: Mat;
	count: number;
	visible: number;
	rms: number;
	/** The matched features: indices, key positions and current positions. */
	fid: Int32Array;
	src: Float64Array;
	dst: Float64Array;
	m: number;
}

/** Every k-th point, so at most `max` remain, spread like the input. */
function thin(pts: Float32Array, max: number): Float32Array {
	const n = pts.length >> 1;
	if (n <= max) return pts;
	const out = new Float32Array(max * 2);
	for (let i = 0; i < max; i++) {
		const j = Math.floor((i * n) / max);
		out[2 * i] = pts[2 * j];
		out[2 * i + 1] = pts[2 * j + 1];
	}
	return out;
}

function trackConfidence(count: number, total: number, rms: number, minInl: number): number {
	const ratio = total > 0 ? count / total : 0;
	const enough = Math.min(1, count / (3 * minInl));
	const tight = clamp01(1 - rms / 2);
	return clamp01(Math.min(1, ratio * 1.25) * enough * tight);
}

function quadShift(a: Quad, b: Quad): number {
	let s = 0;
	for (let i = 0; i < 4; i++) s = Math.max(s, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]));
	return s;
}

/**
 * The tracker behind both public trackers. Each frame: KLT features tracked
 * frame to frame predict the motion; features of a key frame are matched
 * against the current frame through a rectified warp (no drift); for planes,
 * a dense robust alignment of the key frame's core region (edges included)
 * refines the result. The transform maps first-frame pixels to the current frame.
 */
class FeatureTracker {
	private readonly model: Model;
	private readonly minInl: number;
	private readonly dense: boolean;
	private readonly lk = new Lk(10);
	/** A smaller window for the frame-to-frame prediction. */
	private readonly lkFast = new Lk(7);
	private readonly rng = seeded(0x5eed);
	private readonly w: number;
	private readonly hgt: number;
	private readonly orient: number;
	private prevPyr: Img[];
	private pts: Float32Array;
	private h: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1];
	private lastQuad: Quad | null;
	private goodQuad: Quad;
	private key: Key;
	private sinceKey = 0;
	private sinceFill = 0;
	private scratch = new Float32Array(0);
	private scratch2 = new Float32Array(0);

	constructor(
		first: GrayFrame,
		private readonly quad0: Quad,
		kind: ModelKind,
		private readonly margin: number,
	) {
		this.model = MODELS[kind];
		this.minInl = kind === "homography" ? 10 : kind === "similarity" ? 6 : 4;
		this.dense = kind === "homography";
		this.w = first.width;
		this.hgt = first.height;
		this.orient = Math.sign(polyArea(quad0)) || 1;
		if (!isConvex(quad0)) throw new Error("Tracker: the region must be a convex quad");
		const img = grayImg(first);
		this.prevPyr = buildPyramid(img, LEVELS);
		const key = this.makeKey(img, this.h, quad0);
		if (!key || (key.n < this.model.min + 2 && !key.dense))
			throw new Error("Tracker: not enough texture in the region to track");
		this.key = key;
		this.pts = thin(key.pts.slice(), MAX_F2F_POINTS);
		this.lastQuad = quad0;
		this.goodQuad = quad0;
	}

	private coreQuad(quad: Quad): Quad {
		return expandQuad(quad, Math.min(this.margin, CORE_BAND));
	}

	private makeKey(img: Img, h: Mat, quad: Quad): Key | null {
		const inv = inv3(h);
		if (!inv) return null;
		const region = expandQuad(quad, this.margin);
		const core = this.coreQuad(quad);
		const pad = this.lk.half + 4;
		let minx = Number.POSITIVE_INFINITY;
		let maxx = Number.NEGATIVE_INFINITY;
		let miny = Number.POSITIVE_INFINITY;
		let maxy = Number.NEGATIVE_INFINITY;
		for (const [x, y] of region) {
			minx = Math.min(minx, x);
			maxx = Math.max(maxx, x);
			miny = Math.min(miny, y);
			maxy = Math.max(maxy, y);
		}
		const ox = Math.max(0, Math.floor(minx) - pad);
		const oy = Math.max(0, Math.floor(miny) - pad);
		const x1 = Math.min(img.w - 1, Math.ceil(maxx) + pad);
		const y1 = Math.min(img.h - 1, Math.ceil(maxy) + pad);
		const cw = x1 - ox + 1;
		const ch = y1 - oy + 1;
		if (cw < 16 || ch < 16) return null;
		const crop = new Float32Array(cw * ch);
		for (let y = 0; y < ch; y++)
			crop.set(img.d.subarray((oy + y) * img.w + ox, (oy + y) * img.w + ox + cw), y * cw);
		const pyr = buildPyramid({ w: cw, h: ch, d: crop }, KEY_LEVELS, 12);
		const border = this.lk.half + 2;
		const spacing = (poly: Pt[], count: number) =>
			Math.min(14, Math.max(4, Math.sqrt(Math.abs(polyArea(poly)) / (count * 2))));
		// The core gets its own pass, so a busy background can't crowd out a plain bezel.
		const inner = detectFeatures(
			img,
			core,
			MAX_CORE_FEATURES,
			spacing(core, MAX_CORE_FEATURES),
			border,
			null,
		);
		const outer =
			this.margin > CORE_BAND
				? detectFeatures(
						img,
						region,
						MAX_MARGIN_FEATURES,
						spacing(region, MAX_CORE_FEATURES),
						border,
						inner,
					)
				: new Float32Array(0);
		const pts = new Float32Array(inner.length + outer.length);
		pts.set(inner);
		pts.set(outer, inner.length);
		const n = pts.length >> 1;
		const coreFlags = new Uint8Array(n);
		for (let i = 0; i < n; i++) coreFlags[i] = insidePoly(core, pts[2 * i], pts[2 * i + 1]) ? 1 : 0;
		return {
			h,
			inv,
			ox,
			oy,
			pyr,
			pts,
			n,
			core: coreFlags,
			strikes: new Uint8Array(n),
			dense: this.dense ? makeDense(pyr, ox, oy, core) : null,
		};
	}

	private matchKey(cur: Img, hPred: Mat): KeyMatch | null {
		const k = this.key;
		const g = unit(mul3(hPred, k.inv));
		if (!g) return null;
		const kp = k.pyr[0];
		const rect = warpCrop(cur, g, k.ox, k.oy, kp.w, kp.h);
		const rpyr = buildPyramid(rect, k.pyr.length, 12);
		const src = new Float64Array(k.n * 2);
		const dst = new Float64Array(k.n * 2);
		const fid = new Int32Array(k.n);
		const wts = new Float32Array(k.n);
		let visible = 0;
		let m = 0;
		const B = 2;
		for (let i = 0; i < k.n; i++) {
			const fx = k.pts[2 * i];
			const fy = k.pts[2 * i + 1];
			const [cx, cy] = applyHomography(g, [fx, fy]);
			if (!(cx >= B && cy >= B && cx <= this.w - 1 - B && cy <= this.hgt - 1 - B)) continue;
			visible++;
			if (!this.lk.track(k.pyr, rpyr, fx - k.ox, fy - k.oy, 0, 0, k.pyr.length - 1)) continue;
			if (this.lk.residual > LK_MAX_RESIDUAL) continue;
			const [qx, qy] = applyHomography(g, [this.lk.x + k.ox, this.lk.y + k.oy]);
			src[2 * m] = fx;
			src[2 * m + 1] = fy;
			dst[2 * m] = qx;
			dst[2 * m + 1] = qy;
			fid[m] = i;
			wts[m] = k.strikes[i] >= STRIKES_OUT ? 0 : k.core[i] ? 1 : MARGIN_WEIGHT;
			m++;
		}
		const fit = ransac(this.model, src, dst, m, INLIER_PX, this.rng, wts);
		if (!fit) return null;
		return { g: fit.h, count: fit.count, visible, rms: fit.rms, fid, src, dst, m };
	}

	private keyOk(km: KeyMatch | null): km is KeyMatch {
		return !!km && km.count >= this.minInl && km.count >= 0.3 * km.visible;
	}

	/**
	 * Inverse-compositional alignment of the key frame's core pixels to the
	 * current frame (coarse to fine), with a gain and offset for the light and
	 * Tukey weights so hands and reflections don't pull. `g` maps key → current.
	 */
	private directAlign(
		pyr: Img[],
		g0: Mat,
		start: number,
	): { g: Mat; ratio: number; visible: number } | null {
		const dn = this.key.dense;
		if (!dn) return null;
		const { cx, cy, s } = dn;
		const nm = [1 / s, 0, -cx / s, 0, 1 / s, -cy / s, 0, 0, 1];
		const ni = [s, 0, cx, 0, s, cy, 0, 0, 1];
		let g = g0.slice();
		let ratio = 0;
		let visible = 1;
		let ncc = 0;
		const H = new Float64Array(64);
		const b = new Float64Array(8);
		const top = Math.min(start, dn.levels.length - 1, pyr.length - 1);
		for (let L = top; L >= 0; L--) {
			const lv = dn.levels[L];
			const img = pyr[L];
			const { w, h, d } = img;
			const f = 1 / (1 << L);
			const { n, x, y, t, sd } = lv;
			if (this.scratch.length < n) {
				this.scratch = new Float32Array(n);
				this.scratch2 = new Float32Array(n);
			}
			const val = this.scratch;
			const wgt = this.scratch2;
			wgt.fill(1, 0, n);
			const med = new Float32Array(Math.min(n, 512));
			for (let it = 0; it < 12; it++) {
				let nv = 0;
				for (let i = 0; i < n; i++) {
					const X = x[i];
					const Y = y[i];
					const wz = g[6] * X + g[7] * Y + g[8];
					const u = ((g[0] * X + g[1] * Y + g[2]) / wz) * f;
					const v = ((g[3] * X + g[4] * Y + g[5]) / wz) * f;
					if (!(u >= 0 && v >= 0 && u < w - 1 && v < h - 1)) {
						val[i] = Number.NaN;
						continue;
					}
					const ix = u | 0;
					const iy = v | 0;
					const fx = u - ix;
					const fy = v - iy;
					const p = iy * w + ix;
					val[i] =
						(d[p] * (1 - fx) + d[p + 1] * fx) * (1 - fy) +
						(d[p + w] * (1 - fx) + d[p + w + 1] * fx) * fy;
					nv++;
				}
				if (nv < 30) return null;
				// Light: val ≈ gain * template + offset, fitted with the current weights.
				let sw = 0;
				let st = 0;
				let sv = 0;
				let stt = 0;
				let stv = 0;
				for (let i = 0; i < n; i++) {
					const vi = val[i];
					if (Number.isNaN(vi)) continue;
					const wi = wgt[i];
					sw += wi;
					st += wi * t[i];
					sv += wi * vi;
					stt += wi * t[i] * t[i];
					stv += wi * t[i] * vi;
				}
				let gain = 1;
				let off = 0;
				if (sw > 0) {
					const vt = stt / sw - (st / sw) ** 2;
					gain = vt > 1e-6 ? (stv / sw - (st / sw) * (sv / sw)) / vt : 1;
					if (!(gain > 0.3 && gain < 3)) gain = 1;
					off = (sv - gain * st) / sw;
				}
				// Robust scale from a spread-out subset of the residuals.
				let mk = 0;
				const stride = Math.max(1, Math.floor(n / med.length));
				for (let i = 0; i < n && mk < med.length; i += stride) {
					const vi = val[i];
					if (!Number.isNaN(vi)) med[mk++] = Math.abs(vi - gain * t[i] - off);
				}
				const sorted = med.subarray(0, mk).sort();
				// Capped, so a picture that doesn't match at all can't pass as merely noisy.
				const sigma = Math.min(DENSE_MAX_SIGMA, Math.max(1.5, 1.4826 * (sorted[mk >> 1] ?? 0)));
				const c = 4.685 * sigma;
				H.fill(0);
				b.fill(0);
				let inl = 0;
				for (let i = 0; i < n; i++) {
					const vi = val[i];
					if (Number.isNaN(vi)) {
						wgt[i] = 0;
						continue;
					}
					const r = (vi - gain * t[i] - off) / gain;
					const q = (r * gain) / c;
					if (q >= 1 || q <= -1) {
						wgt[i] = 0;
						continue;
					}
					const wi = (1 - q * q) ** 2;
					wgt[i] = wi;
					if (wi > 0.5) inl++;
					const o = i * 8;
					for (let a = 0; a < 8; a++) {
						const sa = sd[o + a] * wi;
						b[a] += sa * r;
						for (let bb = a; bb < 8; bb++) H[a * 8 + bb] += sa * sd[o + bb];
					}
				}
				for (let a = 0; a < 8; a++) for (let bb = 0; bb < a; bb++) H[a * 8 + bb] = H[bb * 8 + a];
				// Judged on the part of the surface still in the picture: one leaving the frame isn't lost.
				ratio = inl / Math.max(1, nv);
				visible = nv / n;
				if (L === 0) {
					// How well the inliers' light matches the template (weighted correlation).
					let sw2 = 0;
					let a1 = 0;
					let a2 = 0;
					let a11 = 0;
					let a22 = 0;
					let a12 = 0;
					for (let i = 0; i < n; i++) {
						const wi = wgt[i];
						if (!wi) continue;
						const ti = t[i];
						const vi = val[i];
						sw2 += wi;
						a1 += wi * ti;
						a2 += wi * vi;
						a11 += wi * ti * ti;
						a22 += wi * vi * vi;
						a12 += wi * ti * vi;
					}
					const v1 = a11 / sw2 - (a1 / sw2) ** 2;
					const v2 = a22 / sw2 - (a2 / sw2) ** 2;
					ncc =
						v1 > 1e-6 && v2 > 1e-6 ? (a12 / sw2 - (a1 / sw2) * (a2 / sw2)) / Math.sqrt(v1 * v2) : 0;
				}
				if (!solveLinear(H, b, 8)) return null;
				const dm = [1 + b[0], b[1], b[2], b[3], 1 + b[4], b[5], b[6], b[7], 1];
				const di = inv3(dm);
				if (!di) return null;
				const next = unit(mul3(g, mul3(ni, mul3(di, nm))));
				if (!next) return null;
				g = next;
				let step = 0;
				for (let a = 0; a < 8; a++) step += b[a] * b[a];
				if (s * Math.sqrt(step) < 0.004 * (1 << L)) break;
			}
		}
		return { g, ratio: ncc >= DENSE_MIN_NCC ? ratio : 0, visible };
	}

	private sane(q: Quad): boolean {
		if (!isConvex(q)) return false;
		const a = polyArea(q);
		if (Math.sign(a) !== this.orient || Math.abs(a) < 16) return false;
		const p = this.lastQuad;
		if (!p) return true;
		const ap = Math.abs(polyArea(p));
		const r = Math.abs(a) / ap;
		if (r < 0.75 || r > 1 / 0.75) return false;
		let mx = 0;
		let my = 0;
		for (let i = 0; i < 4; i++) {
			mx += (q[i][0] - p[i][0]) / 4;
			my += (q[i][1] - p[i][1]) / 4;
		}
		const lim = 0.25 * Math.sqrt(ap);
		for (let i = 0; i < 4; i++)
			if (Math.hypot(q[i][0] - p[i][0] - mx, q[i][1] - p[i][1] - my) > lim) return false;
		return true;
	}

	step(frame: GrayFrame): { h: Mat | null; confidence: number } {
		if (frame.width !== this.w || frame.height !== this.hgt)
			throw new Error("Tracker: every frame must have the size of the first");
		const pyr = buildPyramid(grayImg(frame), LEVELS);
		const top = pyr.length - 1;
		const model = this.model;
		const k = this.key;

		// Frame to frame: a prediction of where the surface went.
		let hPred = this.h;
		let f2f: {
			count: number;
			total: number;
			rms: number;
			live: Float32Array;
			src: Float64Array;
			dst: Float64Array;
		} | null = null;
		const n = this.pts.length >> 1;
		if (n >= model.min) {
			const src = new Float64Array(n * 2);
			const dst = new Float64Array(n * 2);
			const wts = new Float32Array(n);
			const core = this.lastQuad ? this.coreQuad(this.lastQuad) : null;
			let m = 0;
			for (let i = 0; i < n; i++) {
				const x = this.pts[2 * i];
				const y = this.pts[2 * i + 1];
				const lk = this.lkFast;
				if (!lk.track(this.prevPyr, pyr, x, y, 0, 0, top)) continue;
				if (lk.residual > LK_MAX_RESIDUAL) continue;
				const nx = lk.x;
				const ny = lk.y;
				if (!lk.track(pyr, this.prevPyr, nx, ny, x - nx, y - ny, top)) continue;
				if ((lk.x - x) ** 2 + (lk.y - y) ** 2 > FB_MAX2) continue;
				src[2 * m] = x;
				src[2 * m + 1] = y;
				dst[2 * m] = nx;
				dst[2 * m + 1] = ny;
				wts[m] = !core || insidePoly(core, x, y) ? 1 : MARGIN_WEIGHT;
				m++;
			}
			const fit = ransac(model, src, dst, m, INLIER_PX, this.rng, wts);
			if (fit && fit.count >= this.minInl && fit.count >= 0.3 * m) {
				const next = unit(mul3(fit.h, this.h));
				if (next) {
					hPred = next;
					const live: number[] = [];
					for (let i = 0; i < m; i++) if (fit.inliers[i]) live.push(dst[2 * i], dst[2 * i + 1]);
					f2f = {
						count: fit.count,
						total: m,
						rms: fit.rms,
						live: Float32Array.from(live),
						src: src.subarray(0, 2 * m),
						dst: dst.subarray(0, 2 * m),
					};
				}
			}
		}

		// Against the key frame: estimates that don't drift.
		let km = this.matchKey(pyr[0], hPred);
		if (this.keyOk(km)) {
			const hk = unit(mul3(km.g, k.h));
			if (hk && quadShift(mapQuad(hPred, this.quad0), mapQuad(hk, this.quad0)) > 3) {
				const again = this.matchKey(pyr[0], hk);
				if (this.keyOk(again)) km = again;
			}
		}
		const keyOk = this.keyOk(km);
		let featConf = 0;
		let gFeat: Mat | null = null;
		if (keyOk && km) {
			gFeat = km.g;
			featConf = trackConfidence(km.count, km.visible, km.rms, this.minInl);
		} else if (f2f) {
			gFeat = unit(mul3(hPred, k.inv));
			featConf = 0.5 * trackConfidence(f2f.count, f2f.total, f2f.rms, this.minInl);
		}
		let g: Mat | null = gFeat;
		let confidence = featConf;
		if (k.dense) {
			const startG = gFeat ?? unit(mul3(hPred, k.inv));
			const dr = startG ? this.directAlign(pyr, startG, gFeat ? 1 : 2) : null;
			if (dr && dr.ratio >= 0.5) {
				g = dr.g;
				// Less sure only once little of the surface is left in view.
				const dc = clamp01((dr.ratio - 0.3) / 0.5) * (0.4 + 0.6 * clamp01(dr.visible / 0.25));
				confidence = gFeat ? Math.max(0.5 * featConf + 0.5 * dc, 0.8 * dc) : 0.8 * dc;
			} else if (dr) confidence *= 0.6;
		}
		let h = g ? unit(mul3(g, k.h)) : null;
		const quad = h ? mapQuad(h, this.quad0) : null;
		if (!quad || !this.sane(quad)) {
			h = null;
			confidence = 0;
		}

		this.prevPyr = pyr;
		const border = this.lk.half + 2;
		if (h && quad && g) {
			const hPrev = this.h;
			this.h = h;
			this.lastQuad = quad;
			this.goodQuad = quad;
			// Key features that agree with the result feed the next frame; the rest collect strikes.
			const live: number[] = [];
			let agree = 0;
			const lim2 = (2 * INLIER_PX) ** 2;
			if (km) {
				for (let j = 0; j < km.m; j++) {
					const [px, py] = applyHomography(g, [km.src[2 * j], km.src[2 * j + 1]]);
					const i = km.fid[j];
					if ((px - km.dst[2 * j]) ** 2 + (py - km.dst[2 * j + 1]) ** 2 < lim2) {
						k.strikes[i] = 0;
						live.push(px, py);
						agree++;
					} else if (k.strikes[i] < 255) k.strikes[i]++;
				}
			}
			// Frame-to-frame points that agree carry on too (where no key feature already is).
			const back = inv3(hPrev);
			const step = back ? unit(mul3(h, back)) : null;
			if (f2f && step && live.length >> 1 < MIN_LIVE_FEATURES) {
				const keyLive = live.length;
				for (let j = 0; j < f2f.src.length >> 1; j++) {
					const [px, py] = applyHomography(step, [f2f.src[2 * j], f2f.src[2 * j + 1]]);
					if ((px - f2f.dst[2 * j]) ** 2 + (py - f2f.dst[2 * j + 1]) ** 2 >= lim2) continue;
					let near = false;
					for (let q = 0; q < keyLive && !near; q += 2)
						near = (live[q] - px) ** 2 + (live[q + 1] - py) ** 2 < 9;
					if (!near) live.push(px, py);
				}
			}
			let pts = Float32Array.from(live);
			this.sinceFill++;
			if (pts.length >> 1 < MIN_LIVE_FEATURES && this.sinceFill >= 5) {
				this.sinceFill = 0;
				const core = this.coreQuad(quad);
				const md = Math.min(14, Math.max(4, Math.sqrt(Math.abs(polyArea(core)) / 300)));
				let extra = detectFeatures(pyr[0], core, 150, md, border, pts);
				if ((pts.length + extra.length) >> 1 < MIN_LIVE_FEATURES && this.margin > CORE_BAND) {
					const both = new Float32Array(pts.length + extra.length);
					both.set(pts);
					both.set(extra, pts.length);
					const more = detectFeatures(pyr[0], expandQuad(quad, this.margin), 100, md, border, both);
					const all = new Float32Array(extra.length + more.length);
					all.set(extra);
					all.set(more, extra.length);
					extra = all;
				}
				const both = new Float32Array(pts.length + extra.length);
				both.set(pts);
				both.set(extra, pts.length);
				pts = both;
			}
			this.pts = thin(pts, MAX_F2F_POINTS);
			this.sinceKey++;
			if (this.sinceKey >= 8 && agree < 0.4 * k.n && confidence < 0.6) {
				const cand = this.makeKey(pyr[0], h, quad);
				if (cand && cand.n >= 2 * this.minInl && cand.n > 1.3 * agree) {
					this.key = cand;
					this.sinceKey = 0;
				}
			}
		} else {
			this.lastQuad = null;
			const region = expandQuad(this.goodQuad, this.margin);
			this.pts = detectFeatures(pyr[0], region, 150, 6, border, null);
		}
		return { h, confidence };
	}
}

/** Template samples for dense alignment: core pixels with enough gradient, per pyramid level. */
function makeDense(pyr: Img[], ox: number, oy: number, core: Quad): Dense | null {
	const area = Math.abs(polyArea(core));
	if (area < 100) return null;
	const cx = (core[0][0] + core[1][0] + core[2][0] + core[3][0]) / 4;
	const cy = (core[0][1] + core[1][1] + core[2][1] + core[3][1]) / 4;
	const s = Math.sqrt(area) / 2;
	const rng = seeded(0xd1ce);
	const levels: DenseLevel[] = [];
	for (let L = 0; L < Math.min(DENSE_CAPS.length, pyr.length); L++) {
		const { w, h, d } = pyr[L];
		const f = 1 << L;
		const idx: number[] = [];
		const g2 = DENSE_MIN_GRAD * DENSE_MIN_GRAD;
		for (let j = 1; j < h - 1; j++)
			for (let i = 1; i < w - 1; i++) {
				const p = j * w + i;
				const gx = (d[p + 1] - d[p - 1]) / 2;
				const gy = (d[p + w] - d[p - w]) / 2;
				if (gx * gx + gy * gy < g2) continue;
				if (!insidePoly(core, i * f + ox, j * f + oy)) continue;
				idx.push(p);
			}
		const cap = DENSE_CAPS[L];
		if (idx.length > cap) {
			for (let a = 0; a < cap; a++) {
				const r = a + Math.floor(rng() * (idx.length - a));
				const tmp = idx[a];
				idx[a] = idx[r];
				idx[r] = tmp;
			}
			idx.length = cap;
		}
		const n = idx.length;
		if (n < 40) break;
		const x = new Float32Array(n);
		const y = new Float32Array(n);
		const t = new Float32Array(n);
		const sd = new Float32Array(n * 8);
		const k = s / f;
		for (let q = 0; q < n; q++) {
			const p = idx[q];
			const i = p % w;
			const j = (p - i) / w;
			const X = i * f + ox;
			const Y = j * f + oy;
			x[q] = X;
			y[q] = Y;
			t[q] = d[p];
			const gx = ((d[p + 1] - d[p - 1]) / 2) * k;
			const gy = ((d[p + w] - d[p - w]) / 2) * k;
			const xh = (X - cx) / s;
			const yh = (Y - cy) / s;
			const o = q * 8;
			sd[o] = gx * xh;
			sd[o + 1] = gx * yh;
			sd[o + 2] = gx;
			sd[o + 3] = gy * xh;
			sd[o + 4] = gy * yh;
			sd[o + 5] = gy;
			sd[o + 6] = -(gx * xh * xh + gy * xh * yh);
			sd[o + 7] = -(gx * xh * yh + gy * yh * yh);
		}
		levels.push({ n, x, y, t, sd });
	}
	return levels.length ? { cx, cy, s, levels } : null;
}

/**
 * Planar tracker (corner pin): follows a flat surface given its four corners in the first frame.
 * `margin` (default 0.1 of the quad's size) is how far around the quad counts as the same surface.
 */
export function createPlaneTracker(
	first: GrayFrame,
	quad: Quad,
	options?: { margin?: number },
): { step(frame: GrayFrame): Step<Quad> } {
	const q = quad.map((p) => [p[0], p[1]]) as Quad;
	const t = new FeatureTracker(first, q, "homography", options?.margin ?? 0.1);
	return {
		step(frame) {
			const r = t.step(frame);
			return r.h
				? { value: mapQuad(r.h, q), confidence: r.confidence }
				: { value: null, confidence: 0 };
		},
	};
}

/**
 * Object tracker: follows a box (anything, not necessarily flat) with translation, uniform
 * scale and rotation (`scaleRotation: false` for translation only).
 */
export function createObjectTracker(
	first: GrayFrame,
	box: { x: number; y: number; width: number; height: number },
	options?: { scaleRotation?: boolean },
): { step(frame: GrayFrame): Step<ObjectPose> } {
	const { x, y, width, height } = box;
	const q: Quad = [
		[x, y],
		[x + width, y],
		[x + width, y + height],
		[x, y + height],
	];
	const kind = options?.scaleRotation === false ? "translation" : "similarity";
	const t = new FeatureTracker(first, q, kind, 0);
	const c: Pt = [x + width / 2, y + height / 2];
	return {
		step(frame) {
			const r = t.step(frame);
			if (!r.h) return { value: null, confidence: 0 };
			const h = r.h;
			return {
				value: {
					center: applyHomography(h, c),
					scale: Math.hypot(h[0], h[3]),
					rotation: (Math.atan2(h[3], h[0]) * 180) / Math.PI,
				},
				confidence: r.confidence,
			};
		},
	};
}

// ---------------------------------------------------------------------------
// Green / blue screen finder

function parseColor(color: string): [number, number, number] | null {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
	if (!m) return null;
	let hex = m[1];
	if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
	return [
		Number.parseInt(hex.slice(0, 2), 16),
		Number.parseInt(hex.slice(2, 4), 16),
		Number.parseInt(hex.slice(4, 6), 16),
	];
}

/** Connected components of a binary mask (8-connected, union–find); labels 1..count. */
function labelComponents(
	mask: Uint8Array,
	w: number,
	h: number,
): { labels: Int32Array; count: number } {
	const labels = new Int32Array(w * h);
	const parent: number[] = [0];
	const find = (a: number) => {
		while (parent[a] !== a) {
			parent[a] = parent[parent[a]];
			a = parent[a];
		}
		return a;
	};
	const join = (a: number, b: number) => {
		const ra = find(a);
		const rb = find(b);
		if (ra === rb) return ra;
		if (ra < rb) {
			parent[rb] = ra;
			return ra;
		}
		parent[ra] = rb;
		return rb;
	};
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			if (!mask[i]) continue;
			let l = 0;
			const see = (j: number) => {
				const nl = labels[j];
				if (!nl) return;
				l = l ? join(l, nl) : nl;
			};
			if (x > 0) see(i - 1);
			if (y > 0) {
				if (x > 0) see(i - w - 1);
				see(i - w);
				if (x < w - 1) see(i - w + 1);
			}
			if (!l) {
				l = parent.length;
				parent.push(l);
			}
			labels[i] = l;
		}
	}
	const remap = new Int32Array(parent.length);
	let count = 0;
	for (let i = 1; i < parent.length; i++) if (find(i) === i) remap[i] = ++count;
	for (let i = 0; i < labels.length; i++) if (labels[i]) labels[i] = remap[find(labels[i])];
	return { labels, count };
}

/** Convex hull (Andrew's monotone chain). */
function convexHull(points: Pt[]): Pt[] {
	const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (p.length < 3) return p;
	const cross = (o: Pt, a: Pt, b: Pt) =>
		(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const lower: Pt[] = [];
	for (const q of p) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0)
			lower.pop();
		lower.push(q);
	}
	const upper: Pt[] = [];
	for (let i = p.length - 1; i >= 0; i--) {
		const q = p[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0)
			upper.pop();
		upper.push(q);
	}
	upper.pop();
	lower.pop();
	return lower.concat(upper);
}

function intersectLines(p1: Pt, d1: Pt, p2: Pt, d2: Pt): [number, number] | null {
	const den = d1[0] * d2[1] - d1[1] * d2[0];
	if (Math.abs(den) < 1e-9) return null;
	const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
	const u = ((p2[0] - p1[0]) * d1[1] - (p2[1] - p1[1]) * d1[0]) / den;
	return [t, u];
}

/**
 * A convex polygon cut down to four corners: repeatedly drop the edge whose
 * neighbours, extended to meet, add the least area.
 */
function reduceToQuad(poly: Pt[]): Pt[] | null {
	const v = poly.slice();
	while (v.length > 4) {
		const n = v.length;
		let best = -1;
		let bestArea = Number.POSITIVE_INFINITY;
		let bestP: Pt | null = null;
		for (let i = 0; i < n; i++) {
			const a = v[(i - 1 + n) % n];
			const b = v[i];
			const c = v[(i + 1) % n];
			const d = v[(i + 2) % n];
			const d1: Pt = [b[0] - a[0], b[1] - a[1]];
			const d2: Pt = [c[0] - d[0], c[1] - d[1]];
			const tu = intersectLines(b, d1, c, d2);
			if (!tu || tu[0] < 0 || tu[1] < 0) continue;
			const P: Pt = [b[0] + d1[0] * tu[0], b[1] + d1[1] * tu[0]];
			const area = Math.abs((P[0] - b[0]) * (c[1] - b[1]) - (P[1] - b[1]) * (c[0] - b[0])) / 2;
			if (area < bestArea) {
				bestArea = area;
				best = i;
				bestP = P;
			}
		}
		if (best < 0 || !bestP) {
			// No pair of edges meets outside: drop the flattest vertex instead.
			let flat = 0;
			let flatArea = Number.POSITIVE_INFINITY;
			for (let i = 0; i < n; i++) {
				const a = v[(i - 1 + n) % n];
				const b = v[i];
				const c = v[(i + 1) % n];
				const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
				if (ar < flatArea) {
					flatArea = ar;
					flat = i;
				}
			}
			v.splice(flat, 1);
			continue;
		}
		if (best === n - 1) {
			v.splice(best, 1, bestP);
			v.splice(0, 1);
		} else v.splice(best, 2, bestP);
	}
	return v.length === 4 ? v : null;
}

interface Line {
	c: Pt;
	d: Pt;
	inliers: number;
}

/** Total-least-squares line through points, robust to a share of outliers (RANSAC, then refits). */
function fitLineRobust(xs: number[], ys: number[], rng: () => number): Line | null {
	const n = xs.length;
	if (n < 6) return null;
	const inl = new Uint8Array(n);
	let bestCount = 0;
	for (let it = 0; it < 60; it++) {
		const a = Math.floor(rng() * n);
		const b = Math.floor(rng() * n);
		if (a === b) continue;
		const dx = xs[b] - xs[a];
		const dy = ys[b] - ys[a];
		const len = Math.hypot(dx, dy);
		if (len < 4) continue;
		const nx = -dy / len;
		const ny = dx / len;
		let c = 0;
		for (let i = 0; i < n; i++) if (Math.abs((xs[i] - xs[a]) * nx + (ys[i] - ys[a]) * ny) < 1) c++;
		if (c > bestCount) {
			bestCount = c;
			for (let i = 0; i < n; i++)
				inl[i] = Math.abs((xs[i] - xs[a]) * nx + (ys[i] - ys[a]) * ny) < 1 ? 1 : 0;
		}
	}
	if (bestCount < 6) return null;
	let line: Line | null = null;
	for (let pass = 0; pass < 3; pass++) {
		let cx = 0;
		let cy = 0;
		let m = 0;
		for (let i = 0; i < n; i++)
			if (inl[i]) {
				cx += xs[i];
				cy += ys[i];
				m++;
			}
		if (m < 6) break;
		cx /= m;
		cy /= m;
		let sxx = 0;
		let sxy = 0;
		let syy = 0;
		for (let i = 0; i < n; i++)
			if (inl[i]) {
				const x = xs[i] - cx;
				const y = ys[i] - cy;
				sxx += x * x;
				sxy += x * y;
				syy += y * y;
			}
		const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
		const d: Pt = [Math.cos(ang), Math.sin(ang)];
		line = { c: [cx, cy], d, inliers: m };
		let se = 0;
		for (let i = 0; i < n; i++) if (inl[i]) se += ((xs[i] - cx) * -d[1] + (ys[i] - cy) * d[0]) ** 2;
		const thr = Math.max(0.5, 3 * Math.sqrt(se / m));
		for (let i = 0; i < n; i++)
			inl[i] = Math.abs((xs[i] - cx) * -d[1] + (ys[i] - cy) * d[0]) < thr ? 1 : 0;
	}
	return line;
}

/**
 * Subpixel edges of the keyed area: along each side of `q`, the keyness
 * profile across the side is cut at half height, and a robust line is fitted
 * to those crossings. Corners are where neighbouring lines meet.
 */
function refineQuad(
	K: Img,
	q: Quad,
	R: number,
	rng: () => number,
): { quad: Quad; support: number[] } | null {
	const orient = polyArea(q) >= 0 ? 1 : -1;
	const STEP = 0.5;
	const ns = Math.round((2 * R) / STEP) + 1;
	const prof = new Float32Array(ns);
	const lines: (Line | null)[] = [];
	const support: number[] = [];
	for (let e = 0; e < 4; e++) {
		const A = q[e];
		const B = q[(e + 1) % 4];
		const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
		if (len < 4) return null;
		const dx = (B[0] - A[0]) / len;
		const dy = (B[1] - A[1]) / len;
		const nx = dy * orient;
		const ny = -dx * orient;
		const step = Math.max(1, len / 300);
		const skip = R + 2;
		const xs: number[] = [];
		const ys: number[] = [];
		let tried = 0;
		for (let s = skip; s <= len - skip; s += step) {
			tried++;
			const px = A[0] + dx * s;
			const py = A[1] + dy * s;
			for (let j = 0; j < ns; j++) {
				const t = -R + j * STEP;
				prof[j] = bilinear(K, px + nx * t, py + ny * t);
			}
			const vin = (prof[0] + prof[1]) / 2;
			const vout = (prof[ns - 1] + prof[ns - 2]) / 2;
			if (vin < 0.55 || vin - vout < 0.35) continue;
			const level = (vin + vout) / 2;
			for (let j = 0; j < ns - 1; j++) {
				if (prof[j] >= level && prof[j + 1] < level) {
					const t = -R + (j + (prof[j] - level) / (prof[j] - prof[j + 1])) * STEP;
					xs.push(px + nx * t);
					ys.push(py + ny * t);
					break;
				}
			}
		}
		const line = fitLineRobust(xs, ys, rng);
		lines.push(line);
		support.push(tried ? (line ? line.inliers : 0) / tried : 0);
	}
	const out: Pt[] = [];
	for (let i = 0; i < 4; i++) {
		const e0 = (i + 3) % 4;
		const l0 = lines[e0] ?? {
			c: q[e0],
			d: [q[i][0] - q[e0][0], q[i][1] - q[e0][1]] as Pt,
			inliers: 0,
		};
		const l1 = lines[i] ?? {
			c: q[i],
			d: [q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1]] as Pt,
			inliers: 0,
		};
		const tu = intersectLines(l0.c, l0.d, l1.c, l1.d);
		if (!tu) return null;
		out.push([l0.c[0] + l0.d[0] * tu[0], l0.c[1] + l0.d[1] * tu[0]]);
	}
	return { quad: out as Quad, support };
}

/** The affine map taking three points to three others. */
function affine3(src: Pt[], dst: Pt[]): Mat | null {
	const A = new Float64Array(9);
	const bx = new Float64Array(3);
	const by = new Float64Array(3);
	for (let i = 0; i < 3; i++) {
		A[i * 3] = src[i][0];
		A[i * 3 + 1] = src[i][1];
		A[i * 3 + 2] = 1;
		bx[i] = dst[i][0];
		by[i] = dst[i][1];
	}
	const A2 = A.slice();
	if (!solveLinear(A, bx, 3) || !solveLinear(A2, by, 3)) return null;
	return [bx[0], bx[1], bx[2], by[0], by[1], by[2], 0, 0, 1];
}

/** Green/blue screen finder: the key-coloured quad in each frame (hands in front don't dent it). */
export function createScreenFinder(options: {
	color: string /* '#00ff00' */;
	similarity?: number;
	hint?: Quad | null;
}): { step(frame: RgbFrame): Step<Quad> } {
	const key = parseColor(options.color);
	if (!key) throw new Error(`Screen finder: can't read the colour ${options.color}`);
	const similarity = options.similarity ?? 0.18;
	const [kr, kg, kb] = key;
	const cbOf = (r: number, g: number, b: number) => -0.168736 * r - 0.331264 * g + 0.5 * b;
	const crOf = (r: number, g: number, b: number) => 0.5 * r - 0.418688 * g - 0.081312 * b;
	const gcb = cbOf(kr, kg, kb);
	const gcr = crOf(kr, kg, kb);
	const gmag = Math.hypot(gcb, gcr);
	if (gmag < 20) throw new Error("Screen finder: the key colour is too grey to key");
	const simSq = similarity * similarity * 255 * 255 * 2;
	const chan = [kr, kg, kb];
	const dom = chan.indexOf(Math.max(kr, kg, kb));
	const others = [0, 1, 2].filter((c) => c !== dom);
	const primary = chan[dom] - Math.max(chan[others[0]], chan[others[1]]) > 60;
	/** Clearly coloured, not grey: for a primary key, its channel leads the others by 20. */
	const strong = (r: number, g: number, b: number) => {
		if (primary) {
			const lead = dom === 0 ? r : dom === 1 ? g : b;
			const o1 = others[0] === 0 ? r : others[0] === 1 ? g : b;
			const o2 = others[1] === 0 ? r : others[1] === 1 ? g : b;
			return lead - Math.max(o1, o2) > 20;
		}
		return Math.hypot(cbOf(r, g, b), crOf(r, g, b)) > 20;
	};
	// The key actually used (in CbCr) and the keyness it gives: chroma projected on the
	// key's chroma, 1 at the key and 0 for greys. Keyness is linear in rgb, so a pixel
	// half over an edge reads half way, which is what makes the edges subpixel.
	let kcb = gcb;
	let kcr = gcr;
	let ka = 0;
	let kbeta = 0;
	let kgam = 0;
	const setKey = (cb: number, cr: number) => {
		kcb = cb;
		kcr = cr;
		const m2 = cb * cb + cr * cr;
		ka = (-0.168736 * cb + 0.5 * cr) / m2;
		kbeta = (-0.331264 * cb - 0.418688 * cr) / m2;
		kgam = (0.5 * cb - 0.081312 * cr) / m2;
	};
	setKey(gcb, gcr);
	const keyed = (r: number, g: number, b: number) => {
		const du = cbOf(r, g, b) - kcb;
		const dv = crOf(r, g, b) - kcr;
		return du * du + dv * dv < simSq && strong(r, g, b);
	};
	/**
	 * Real screens are rarely the pure colour asked for (a lit green screen is
	 * darker and greyer than #00ff00), so on acquiring, the key becomes the
	 * median chroma of the clearly coloured pixels near the asked hue (inside
	 * the hint when there is one).
	 */
	const calibrate = (data: Uint8Array, W: number, H: number, ds: number, region: Quad | null) => {
		const cbs: number[] = [];
		const crs: number[] = [];
		const cosMin = Math.cos((35 * Math.PI) / 180);
		for (let y = 0; y < H; y += ds)
			for (let x = 0; x < W; x += ds) {
				const p = (y * W + x) * 3;
				const r = data[p];
				const g = data[p + 1];
				const b = data[p + 2];
				if (!strong(r, g, b)) continue;
				const cb = cbOf(r, g, b);
				const cr = crOf(r, g, b);
				const m = Math.hypot(cb, cr);
				if (m < 0.2 * gmag || (cb * gcb + cr * gcr) / (m * gmag) < cosMin) continue;
				if (region && !insidePoly(region, x, y)) continue;
				cbs.push(cb);
				crs.push(cr);
			}
		if (cbs.length < 30) return;
		const mid = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
		const cb = mid(cbs);
		const cr = mid(crs);
		if (Math.hypot(cb, cr) >= 20) setKey(cb, cr);
	};
	const rng = seeded(0xc01);
	const hint = options.hint ?? null;
	let prev: Quad | null = null;
	let lost = 0;

	const fail = (): Step<Quad> => {
		lost++;
		if (lost > 12) prev = null;
		return { value: null, confidence: 0 };
	};

	return {
		step(frame) {
			const W = frame.width;
			const H = frame.height;
			const data = frame.data;
			if (data.length < W * H * 3)
				throw new Error("Screen finder: frame data is shorter than w x h x 3");
			const ds = Math.max(1, Math.ceil(W / 640));
			if (!prev) calibrate(data, W, H, ds, hint);
			const K: Img = { w: W, h: H, d: new Float32Array(W * H) };
			for (let i = 0, p = 0; i < W * H; i++, p += 3)
				K.d[i] = ka * data[p] + kbeta * data[p + 1] + kgam * data[p + 2];
			const mw = Math.ceil(W / ds);
			const mh = Math.ceil(H / ds);
			const mask = new Uint8Array(mw * mh);
			for (let my = 0; my < mh; my++)
				for (let mx = 0; mx < mw; mx++) {
					const p = (my * ds * W + mx * ds) * 3;
					if (keyed(data[p], data[p + 1], data[p + 2])) mask[my * mw + mx] = 1;
				}
			const { labels, count } = labelComponents(mask, mw, mh);
			if (!count) return fail();
			const size = new Int32Array(count + 1);
			const over = new Int32Array(count + 1);
			const target = prev ?? hint;
			const tq = target ? expandQuad(target, 0.03) : null;
			for (let my = 0, i = 0; my < mh; my++)
				for (let mx = 0; mx < mw; mx++, i++) {
					const l = labels[i];
					if (!l) continue;
					size[l]++;
					if (tq && insidePoly(tq, mx * ds, my * ds)) over[l]++;
				}
			const minSize = Math.max(16, mw * mh * 0.0005);
			const chosen = new Uint8Array(count + 1);
			let main = 0;
			if (tq) {
				for (let l = 1; l <= count; l++) if (over[l] > over[main]) main = l;
				if (main && over[main] > 0) {
					for (let l = 1; l <= count; l++)
						if (size[l] >= minSize / 4 && over[l] >= 0.5 * size[l]) chosen[l] = 1;
				} else if (prev) return fail();
				else main = 0;
			}
			if (!main) {
				for (let l = 1; l <= count; l++) if (size[l] > size[main]) main = l;
			}
			if (!main || size[main] < minSize) return fail();
			chosen[main] = 1;
			const pts: Pt[] = [];
			let area = 0;
			for (let my = 0; my < mh; my++) {
				let lo = -1;
				let hi = -1;
				for (let mx = 0; mx < mw; mx++) {
					const l = labels[my * mw + mx];
					if (l && chosen[l]) {
						if (lo < 0) lo = mx;
						hi = mx;
						area++;
					}
				}
				if (lo >= 0) {
					pts.push([lo * ds, my * ds]);
					if (hi !== lo) pts.push([hi * ds, my * ds]);
				}
			}
			const hull = convexHull(pts);
			if (hull.length < 4) return fail();
			const rough = reduceToQuad(hull);
			if (!rough) return fail();
			let quad = orderQuad(rough);
			let support = [0, 0, 0, 0];
			for (const R of [2 * ds + 3, 3]) {
				const r = refineQuad(K, quad, R, rng);
				if (!r || !isConvex(r.quad)) return fail();
				quad = orderQuad(r.quad);
				support = r.support;
			}
			let confidence = clamp01(((support[0] + support[1] + support[2] + support[3]) / 4) * 1.1);
			const qa = Math.abs(polyArea(quad));
			confidence *= clamp01((area * ds * ds) / qa / 0.9);

			// Corners hidden behind something: how keyed is the inside of each corner?
			const evidence = quad.map((c, i) => {
				const p = quad[(i + 3) % 4];
				const nx = quad[(i + 1) % 4];
				let hit = 0;
				let tot = 0;
				for (const u of [0.03, 0.06, 0.1])
					for (const v of [0.03, 0.06, 0.1]) {
						const x = c[0] + (p[0] - c[0]) * u + (nx[0] - c[0]) * v;
						const y = c[1] + (p[1] - c[1]) * u + (nx[1] - c[1]) * v;
						tot++;
						if (bilinear(K, x, y) > 0.5) hit++;
					}
				return hit / tot;
			});
			if (prev) {
				const diag = Math.hypot(quad[2][0] - quad[0][0], quad[2][1] - quad[0][1]);
				let worst = 0;
				for (let i = 1; i < 4; i++) if (evidence[i] < evidence[worst]) worst = i;
				const idx = [0, 1, 2, 3].filter((i) => i !== worst);
				const a = affine3(
					idx.map((i) => prev?.[i] as Pt),
					idx.map((i) => quad[i]),
				);
				if (a && evidence[worst] < 0.7) {
					const pred = applyHomography(a, (prev as Quad)[worst]);
					const dev = Math.hypot(pred[0] - quad[worst][0], pred[1] - quad[worst][1]);
					if (dev > Math.max(2, 0.015 * diag)) {
						quad[worst] = pred;
						confidence *= 0.6;
					} else confidence *= 0.85;
				}
			}
			confidence *= 0.7 + 0.3 * Math.min(...evidence);
			// A corner on the frame's edge is the frame cutting the screen off, not the screen's corner.
			const clipped = quad.some(([x, y]) => x < 1.5 || y < 1.5 || x > W - 2.5 || y > H - 2.5);
			if (clipped) confidence = Math.min(confidence, 0.2);
			if (!isConvex(quad)) return fail();
			quad = orderQuad(quad);
			prev = quad;
			lost = 0;
			return { value: quad, confidence: clamp01(confidence) };
		},
	};
}

// ---------------------------------------------------------------------------
// Joining and smoothing tracks

const sameQuad = (a: Quad, b: Quad) =>
	a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9);

/**
 * Joins tracks made from several anchors (keyframes the user or agent set)
 * into one: every anchor frame is exact, and between two anchors the forward
 * track from the earlier and the backward track from the later are
 * cross-faded (smoothstep weighted by distance and by confidence).
 *
 * forward[i] is the forward track from the last anchor at or before i, and
 * backward[i] the backward track from the next anchor at or after i, so an
 * anchor frame is one where both hold the same quad. Pass `anchors` (frame
 * indices) to say so outright; with no anchor found, the first frame anchors
 * the forward track and the last the backward one.
 */
export function blendAnchoredTracks(
	forward: (Quad | null)[],
	backward: (Quad | null)[],
	forwardConfidence: number[],
	backwardConfidence: number[],
	anchors?: number[],
): { quads: (Quad | null)[]; confidence: number[] } {
	const n = Math.max(forward.length, backward.length);
	let marks = anchors?.filter((a) => a >= 0 && a < n).sort((a, b) => a - b);
	if (!marks) {
		marks = [];
		for (let i = 0; i < n; i++) {
			const f = forward[i];
			const b = backward[i];
			if (f && b && sameQuad(f, b)) marks.push(i);
		}
	}
	const isMark = new Uint8Array(n);
	for (const a of marks) isMark[a] = 1;
	const quads: (Quad | null)[] = [];
	const confidence: number[] = [];
	let k = 0;
	for (let i = 0; i < n; i++) {
		const f = forward[i] ?? null;
		const b = backward[i] ?? null;
		const cf = f ? (forwardConfidence[i] ?? 1) : 0;
		const cb = b ? (backwardConfidence[i] ?? 1) : 0;
		if (isMark[i]) {
			const q = f ?? b;
			quads.push(q ? (q.map((p) => [p[0], p[1]]) as Quad) : null);
			confidence.push(q ? 1 : 0);
			continue;
		}
		while (k < marks.length && marks[k] < i) k++;
		// Anchors either side (none found: the ends stand in for them).
		const a = marks.length ? (k > 0 ? marks[k - 1] : -1) : 0;
		const z = marks.length ? (k < marks.length ? marks[k] : -1) : n - 1;
		let s: number;
		if (a < 0) s = 1;
		else if (z < 0) s = 0;
		else {
			const t = (i - a) / Math.max(1, z - a);
			s = t * t * (3 - 2 * t);
		}
		let wf = f ? (1 - s) * Math.max(cf, 1e-6) : 0;
		let wb = b ? s * Math.max(cb, 1e-6) : 0;
		if (wf + wb === 0) {
			// The side that should lead is missing: fall back on whichever exists.
			wf = f ? 1 : 0;
			wb = b ? 1 : 0;
		}
		const tot = wf + wb;
		if (!tot || (!f && !b)) {
			quads.push(null);
			confidence.push(0);
			continue;
		}
		const q: Pt[] = [];
		for (let c = 0; c < 4; c++) {
			const fx = f ? f[c][0] * wf : 0;
			const fy = f ? f[c][1] * wf : 0;
			const bx = b ? b[c][0] * wb : 0;
			const by = b ? b[c][1] * wb : 0;
			q.push([(fx + bx) / tot, (fy + by) / tot]);
		}
		quads.push(q as Quad);
		confidence.push(clamp01((wf * cf + wb * cb) / tot));
	}
	return { quads, confidence };
}

/**
 * Removes jitter without lag: a centred smoothing over each corner
 * coordinate; gaps (null) are filled by linear interpolation from neighbours,
 * leading/trailing nulls by holding.
 *
 * Each frame is a Gaussian-weighted local quadratic fit (local line near the
 * ends), so steady motion passes through unchanged.
 */
export function smoothQuads(quads: (Quad | null)[], strength = 0.5): Quad[] {
	const n = quads.length;
	const known: number[] = [];
	for (let i = 0; i < n; i++) if (quads[i]) known.push(i);
	if (!known.length) return [];
	const filled: Quad[] = [];
	let k = 0;
	for (let i = 0; i < n; i++) {
		const q = quads[i];
		if (q) {
			filled.push(q.map((p) => [p[0], p[1]]) as Quad);
			continue;
		}
		while (k < known.length && known[k] < i) k++;
		const a = k > 0 ? known[k - 1] : -1;
		const b = k < known.length ? known[k] : -1;
		const qa = a >= 0 ? (quads[a] as Quad) : null;
		const qb = b >= 0 ? (quads[b] as Quad) : null;
		if (qa && qb) {
			const t = (i - a) / (b - a);
			filled.push(
				qa.map((p, c) => [p[0] + (qb[c][0] - p[0]) * t, p[1] + (qb[c][1] - p[1]) * t]) as Quad,
			);
		} else {
			const q2 = (qa ?? qb) as Quad;
			filled.push(q2.map((p) => [p[0], p[1]]) as Quad);
		}
	}
	const st = clamp01(strength);
	if (st <= 0 || n < 3) return filled;
	const sigma = 0.5 + 4.5 * st;
	const radius = Math.max(1, Math.ceil(2.5 * sigma));
	const out: Quad[] = [];
	const coef: number[] = [];
	for (let i = 0; i < n; i++) {
		const lo = Math.max(0, i - radius);
		const hi = Math.min(n - 1, i + radius);
		const deg = i - lo >= radius / 2 && hi - i >= radius / 2 ? 2 : 1;
		const m = deg + 1;
		// Weighted normal equations X'WX; the smoothed value is row 0 of (X'WX)^-1 X'W y.
		const M = new Float64Array(m * m);
		for (let j = lo; j <= hi; j++) {
			const x = j - i;
			const wgt = Math.exp((-x * x) / (2 * sigma * sigma));
			for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) M[a * m + b] += wgt * x ** (a + b);
		}
		const e0 = new Float64Array(m);
		e0[0] = 1;
		if (!solveLinear(M, e0, m)) {
			out.push(filled[i]);
			continue;
		}
		coef.length = 0;
		for (let j = lo; j <= hi; j++) {
			const x = j - i;
			const wgt = Math.exp((-x * x) / (2 * sigma * sigma));
			let v = 0;
			for (let a = 0; a < m; a++) v += e0[a] * x ** a;
			coef.push(v * wgt);
		}
		const q: Pt[] = [];
		for (let c = 0; c < 4; c++) {
			let x = 0;
			let y = 0;
			for (let j = lo; j <= hi; j++) {
				x += coef[j - lo] * filled[j][c][0];
				y += coef[j - lo] * filled[j][c][1];
			}
			q.push([x, y]);
		}
		out.push(q as Quad);
	}
	return out;
}
