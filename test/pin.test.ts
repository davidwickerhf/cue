import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
	cornersAt,
	mapSquare,
	pinExprs,
	placement,
	simplifyPin,
	splitPin,
	squareToQuad,
} from "../electron/core/pin";
import { DEFAULT_TRANSFORM } from "../electron/core/project";
import type { CornerPin, Corners, MediaClip } from "../electron/core/types";

const quad: Corners = [
	[0.3, 0.2],
	[0.72, 0.26],
	[0.7, 0.78],
	[0.26, 0.7],
];

describe("corner pin", () => {
	it("maps the unit square's corners onto the quad", () => {
		const m = squareToQuad(quad);
		const got = [mapSquare(m, 0, 0), mapSquare(m, 1, 0), mapSquare(m, 1, 1), mapSquare(m, 0, 1)];
		for (let i = 0; i < 4; i++) {
			expect(got[i][0]).toBeCloseTo(quad[i][0], 9);
			expect(got[i][1]).toBeCloseTo(quad[i][1], 9);
		}
	});

	it("moves corners in straight lines between keys and holds at the ends", () => {
		const other = quad.map(([x, y]) => [x + 0.1, y - 0.05]) as Corners;
		const pin: CornerPin = {
			keys: [
				{ atMs: 1000, corners: quad },
				{ atMs: 3000, corners: other },
			],
		};
		expect(cornersAt(pin, 0)).toEqual(quad);
		expect(cornersAt(pin, 5000)).toEqual(other);
		expect(cornersAt(pin, 2000)[0][0]).toBeCloseTo(0.35, 9);
	});

	it("simplifies a straight move to its two ends, keeps a turn", () => {
		const keys = Array.from({ length: 50 }, (_, i) => ({
			atMs: i * 40,
			corners: quad.map(([x, y]) => [x + i * 0.001, y]) as Corners,
		}));
		expect(simplifyPin(keys)).toHaveLength(2);
		const bent = keys.map((k, i) =>
			i < 25
				? k
				: { ...k, corners: k.corners.map(([x, y]) => [x, y + (i - 25) * 0.002]) as Corners },
		);
		expect(simplifyPin(bent).length).toBeGreaterThan(2);
	});

	it("splits a pin where a clip is cut", () => {
		const other = quad.map(([x, y]) => [x + 0.1, y]) as Corners;
		const [left, right] = splitPin(
			{
				keys: [
					{ atMs: 0, corners: quad },
					{ atMs: 2000, corners: other },
				],
			},
			1000,
		);
		expect(left?.keys.at(-1)?.atMs).toBe(1000);
		expect(right?.keys[0].atMs).toBe(0);
		expect(right?.keys[0].corners[0][0]).toBeCloseTo(0.35, 9);
		expect(right?.keys[1].atMs).toBe(1000);
	});

	it("places a clip's picture on the canvas and back", () => {
		const clip = {
			transform: { ...DEFAULT_TRANSFORM, x: 0.4, y: 0.55, scale: 0.8, rotation: 12 },
		} as MediaClip;
		const place = placement(clip, { width: 1280, height: 720 }, { width: 1920, height: 1080 }, 0);
		const p = place.toCanvas([0.2, 0.7]);
		const back = place.toPicture(p);
		expect(back[0]).toBeCloseTo(0.2, 3);
		expect(back[1]).toBeCloseTo(0.7, 3);
		expect(place.toCanvas([0.5, 0.5])).toEqual([0.4, 0.55]);
	});

	it("draws the pinned picture inside its corners only, in ffmpeg, over hundreds of keys", () => {
		// A white picture pinned onto a quad that drifts right over 300 frames.
		const keys = Array.from({ length: 300 }, (_, i) => ({
			atMs: (i * 1000) / 30,
			corners: quad.map(([x, y]) => [x + 0.0003 * i + 0.00002 * Math.sin(i), y]) as Corners,
		}));
		const W = 320;
		const H = 180;
		const pad = 4;
		const [x0, y0, x1, y1, x2, y2, x3, y3] = pinExprs({ keys }, 30, W, H, pad);
		const graph = `color=white:s=${W - 2 * pad}x${H - 2 * pad}:r=30:d=10,format=rgba,pad=${W}:${H}:${pad}:${pad}:color=black@0,perspective=sense=destination:eval=frame:x0='${x0}':y0='${y0}':x1='${x1}':y1='${y1}':x2='${x2}':y2='${y2}':x3='${x3}':y3='${y3}',select='eq(n\\,299)'`;
		const out = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-filter_complex",
				graph,
				"-frames:v",
				"1",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				"-",
			],
			{ maxBuffer: 1 << 24 },
		);
		const at = (x: number, y: number) => out[(Math.round(y) * W + Math.round(x)) * 4 + 3];
		const c = keys[299].corners;
		const cx = ((c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4) * W;
		const cy = ((c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4) * H;
		expect(at(cx, cy)).toBe(255);
		// Well outside the quad: transparent (no smeared edge pixels).
		expect(at(5, 5)).toBe(0);
		expect(at(W - 5, H - 5)).toBe(0);
		expect(at(cx, 3)).toBe(0);
	});
});
