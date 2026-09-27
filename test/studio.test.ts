import { describe, expect, it } from "vitest";
import { zoomView } from "../electron/core/anim";
import {
	autoZooms,
	cursorClips,
	normalise,
	onCanvas,
	recordingTime,
	simplify,
	smoothPath,
} from "../electron/core/cursor";
import { applyOp } from "../electron/core/ops";
import { emptyProject, parseProject } from "../electron/core/project";
import type { Asset, MediaClip, Zoom } from "../electron/core/types";

describe("pointer timing", () => {
	const clock = { startedAt: 1000, pauses: [{ from: 3000, to: 5000 }] };

	it("leaves out pauses and what came before the recording", () => {
		expect(recordingTime(500, clock)).toBeNull();
		expect(recordingTime(2000, clock)).toBe(1000);
		expect(recordingTime(4000, clock)).toBeNull();
		expect(recordingTime(6000, clock)).toBe(3000);
	});

	it("turns screen points into shares of the recorded area, with clicks", () => {
		const { path, clicks } = normalise(
			[
				{ t: 900, k: "move", x: 100, y: 100 },
				{ t: 1500, k: "move", x: 960, y: 540 },
				{ t: 1600, k: "down", x: 960, y: 540 },
			],
			{ startedAt: 1000, pauses: [] },
			{ x: 0, y: 0, w: 1920, h: 1080 },
		);
		// Where the pointer was at the start is kept, at time 0.
		expect(path[0]).toMatchObject({ atMs: 0 });
		expect(path[1]).toEqual({ atMs: 500, x: 0.5, y: 0.5 });
		expect(clicks).toEqual([{ atMs: 600, x: 0.5, y: 0.5 }]);
	});

	it("follows a recorded window as it moves", () => {
		const { path } = normalise(
			[
				{ t: 1000, k: "bounds", x: 100, y: 100, w: 200, h: 100 },
				{ t: 1100, k: "move", x: 200, y: 150 },
				{ t: 1200, k: "bounds", x: 300, y: 100, w: 200, h: 100 },
				{ t: 1300, k: "move", x: 400, y: 150 },
			],
			{ startedAt: 1000, pauses: [] },
			null,
		);
		expect(path.map((p) => p.x)).toEqual([0.5, 0.5]);
	});
});

describe("smooth cursor", () => {
	it("glides towards a jump instead of teleporting, and settles", () => {
		const out = smoothPath(
			[
				{ atMs: 0, x: 0.1, y: 0.1 },
				{ atMs: 500, x: 0.9, y: 0.9 },
			],
			1500,
		);
		const after = out.find((p) => p.atMs >= 540);
		expect(after?.x).toBeGreaterThan(0.1);
		expect(after?.x).toBeLessThan(0.9);
		expect(out.at(-1)?.x).toBeCloseTo(0.9, 2);
	});

	it("keeps only the keyframes the eye can see", () => {
		const line = Array.from({ length: 100 }, (_, i) => ({
			atMs: i * 10,
			x: i / 100,
			y: 0.5,
			s: 0.05,
		}));
		expect(simplify(line, 0.001)).toHaveLength(2);
	});
});

describe("auto-zoom", () => {
	it("joins clicks close together and keeps zooms apart", () => {
		const zooms = autoZooms(
			[
				{ atMs: 2000, x: 0.2, y: 0.2 },
				{ atMs: 3000, x: 0.25, y: 0.22 },
				{ atMs: 5000, x: 0.9, y: 0.9 },
			],
			20000,
		);
		expect(zooms).toHaveLength(2);
		expect(zooms[0].x).toBeCloseTo(0.225, 3);
		expect(zooms[0].endMs).toBeLessThanOrEqual(zooms[1].startMs);
	});

	it("ignores clicks outside the recorded area", () => {
		expect(autoZooms([{ atMs: 1000, x: 1.4, y: 0.5 }], 10000)).toEqual([]);
	});
});

describe("zoom framing", () => {
	it("centres the focus but never shows past the picture's edge", () => {
		expect(zoomView({ scale: 2, x: 0.5, y: 0.5 })).toEqual({ scale: 2, dx: -0.5, dy: -0.5 });
		// Focus near the right edge: the picture's right edge stays on the frame's.
		const edge = zoomView({ scale: 2, x: 0.95, y: 0.5 });
		expect(edge.dx).toBe(-1);
		expect(2 * 1 + edge.dx).toBe(1);
	});

	it("puts the cursor where the zoomed picture shows it", () => {
		const zooms: Zoom[] = [
			{ id: "z", startMs: 0, endMs: 4000, scale: 2, x: 0.5, y: 0.5, easeMs: 1 },
		];
		const place = { left: 0.1, top: 0.1, width: 0.8, height: 0.8 };
		// The focus stays in the middle of the picture.
		expect(onCanvas({ x: 0.5, y: 0.5 }, 2000, zooms, place)).toMatchObject({
			x: 0.5,
			y: 0.5,
			zoom: 2,
		});
		// A quarter in shows at the picture's edge when zoomed 2×.
		expect(onCanvas({ x: 0.25, y: 0.5 }, 2000, zooms, place).x).toBeCloseTo(0.1, 5);
	});

	it("drops the cursor while it is off the picture and chunks long runs", () => {
		const path = Array.from({ length: 300 }, (_, i) => ({
			atMs: i * 33,
			x: i < 100 || i >= 150 ? 0.5 + 0.3 * Math.sin(i / 7) : 1.5,
			y: 0.5,
		}));
		const clips = cursorClips(
			path,
			[],
			{ left: 0, top: 0, width: 1, height: 1 },
			{ size: 0.05, image: { size: 80, tipX: 7.5, tipY: 1.5 }, aspect: 16 / 9 },
			20,
		);
		expect(clips.length).toBeGreaterThan(2);
		for (const c of clips) expect(c.keyframes.x.length).toBeLessThanOrEqual(20);
		// Nothing drawn while the pointer was on another screen.
		const gapStart = 100 * 33;
		const gapEnd = 150 * 33;
		expect(
			clips.some((c) => c.startMs < gapEnd - 40 && c.startMs + c.durationMs > gapStart + 40),
		).toBe(false);
	});
});

describe("studio clips", () => {
	it("creates clips with keyframes and a rounded frame", () => {
		const image: Asset = {
			id: "a_c",
			kind: "image",
			name: "cursor.png",
			path: "cursor.png",
			durationMs: 0,
			width: 80,
			height: 80,
			hasAudio: false,
			origin: "recording",
			createdAt: "",
			actor: "user",
		};
		let data = applyOp(emptyProject("T"), { type: "addAsset", asset: image }).data;
		data = applyOp(data, {
			type: "addClips",
			clips: [
				{
					type: "media",
					trackId: "V1",
					assetId: image.id,
					startMs: 0,
					durationMs: 1000,
					keyframes: { x: [{ atMs: 0, value: 0.2, ease: "linear" }] },
					frame: { radius: 20 },
				},
			],
		}).data;
		const clip = data.clips[0] as MediaClip;
		expect(clip.keyframes?.x?.[0].value).toBe(0.2);
		// A project with only some properties keyframed opens again.
		const reopened = parseProject(JSON.parse(JSON.stringify(data)));
		expect((reopened.clips[0] as MediaClip).keyframes?.x).toHaveLength(1);
		expect(clip.frame).toEqual({ radius: 20, shadow: 0.5 });
		data = applyOp(data, { type: "updateClip", id: clip.id, patch: { frame: null } }).data;
		expect((data.clips[0] as MediaClip).frame).toBeUndefined();
	});
});
