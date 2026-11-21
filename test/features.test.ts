import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { keyframeExpr, valueAt, zoomAt } from "../electron/core/anim";
import { ffmpeg, probe } from "../electron/core/media";
import { applyOp } from "../electron/core/ops";
import { emptyProject } from "../electron/core/project";
import { ProjectStore } from "../electron/core/store";
import type { Asset, MediaClip, ProjectData } from "../electron/core/types";

const video: Asset = {
	id: "a_v",
	kind: "video",
	name: "v.mp4",
	path: "v.mp4",
	durationMs: 10000,
	width: 1280,
	height: 720,
	hasAudio: true,
	origin: "import",
	createdAt: "",
	actor: "user",
};

function twoClips(): { data: ProjectData; left: MediaClip; right: MediaClip } {
	let data = applyOp(emptyProject("T"), { type: "addAsset", asset: video }).data;
	data = applyOp(data, {
		type: "addClips",
		clips: [
			{ type: "media", trackId: "V1", assetId: video.id, startMs: 0, durationMs: 4000, inMs: 0 },
			{
				type: "media",
				trackId: "V1",
				assetId: video.id,
				startMs: 4000,
				durationMs: 4000,
				inMs: 5000,
			},
		],
	}).data;
	const [left, right] = data.clips as MediaClip[];
	return { data, left, right };
}

describe("animation maths", () => {
	it("interpolates keyframes with ease and hold", () => {
		const k = [
			{ atMs: 0, value: 0, ease: "linear" as const },
			{ atMs: 1000, value: 10, ease: "hold" as const },
			{ atMs: 2000, value: 20, ease: "ease" as const },
		];
		expect(valueAt(k, 500, 0)).toBe(5);
		expect(valueAt(k, 1500, 0)).toBe(10);
		expect(valueAt(k, 5000, 0)).toBe(20);
		// The ffmpeg expression evaluates to the same numbers.
		const expr = keyframeExpr(k, 0, "T");
		const js = expr.replace(/\bif\(/g, "_if(").replace(/\blt\(/g, "_lt(");
		const fn = new Function("T", "_if", "_lt", `return ${js};`) as (
			T: number,
			i: unknown,
			l: unknown,
		) => number;
		const evalAt = (T: number) =>
			fn(
				T,
				(c: number, a: number, b: number) => (c ? a : b),
				(a: number, b: number) => (a < b ? 1 : 0),
			);
		expect(evalAt(0.5)).toBeCloseTo(5);
		expect(evalAt(1.5)).toBeCloseTo(10);
	});

	it("eases zooms in and out", () => {
		const z = [{ id: "z", startMs: 1000, endMs: 3000, scale: 2, x: 0.8, y: 0.2, easeMs: 500 }];
		expect(zoomAt(z, 500).scale).toBe(1);
		expect(zoomAt(z, 2000)).toEqual({ scale: 2, x: 0.8, y: 0.2 });
		expect(zoomAt(z, 1250).scale).toBeCloseTo(1.5);
	});
});

describe("editing operations", () => {
	it("crossfade overlaps the clips and can be removed again", () => {
		const { data, right } = twoClips();
		const withFade = applyOp(data, {
			type: "addTransition",
			clipId: right.id,
			transition: { kind: "crossfade", durationMs: 800 },
		}).data;
		const moved = withFade.clips.find((c) => c.id === right.id) as MediaClip;
		expect(moved.startMs).toBe(3200);
		expect(moved.fadeInMs).toBe(800);
		const back = applyOp(withFade, { type: "removeTransition", clipId: right.id }).data;
		expect((back.clips.find((c) => c.id === right.id) as MediaClip).startMs).toBe(4000);
	});

	it("a crossfade uses spare frames and leaves the rest of the track where it was", () => {
		let { data, right } = twoClips();
		data = applyOp(data, {
			type: "addClips",
			clips: [
				{
					type: "media",
					trackId: "V1",
					assetId: video.id,
					startMs: 8000,
					durationMs: 2000,
					inMs: 0,
				},
			],
		}).data;
		const third = data.clips[2] as MediaClip;
		// The incoming clip has 5 s of spare head: it starts earlier, its end and later clips stay.
		const head = applyOp(data, {
			type: "addTransition",
			clipId: right.id,
			transition: { kind: "crossfade", durationMs: 600 },
		}).data;
		const r = head.clips.find((c) => c.id === right.id) as MediaClip;
		expect(r).toMatchObject({ startMs: 3400, durationMs: 4600, inMs: 4400 });
		expect(r.transitionIn?.made).toBe("head");
		expect(head.clips.find((c) => c.id === third.id)?.startMs).toBe(8000);
		const undone = applyOp(head, { type: "removeTransition", clipId: right.id }).data;
		expect(undone.clips.find((c) => c.id === right.id)).toMatchObject({
			startMs: 4000,
			durationMs: 4000,
			inMs: 5000,
		});
		// The third clip has no spare head (in-point 0): the clip before it runs on under it instead.
		const tail = applyOp(data, {
			type: "addTransition",
			clipId: third.id,
			transition: { kind: "crossfade", durationMs: 600 },
		}).data;
		expect(tail.clips.find((c) => c.id === third.id)?.startMs).toBe(8000);
		expect(tail.clips.find((c) => c.id === right.id)?.durationMs).toBe(4600);
		expect((tail.clips.find((c) => c.id === third.id) as MediaClip).transitionIn?.made).toBe(
			"tail",
		);
		const tailBack = applyOp(tail, { type: "removeTransition", clipId: third.id }).data;
		expect(tailBack.clips.find((c) => c.id === right.id)?.durationMs).toBe(4000);
	});

	it("slip, roll and slide keep within the source", () => {
		const { data, left, right } = twoClips();
		const slipped = applyOp(data, { type: "slipClip", id: right.id, deltaMs: 2000 }).data;
		expect((slipped.clips.find((c) => c.id === right.id) as MediaClip).inMs).toBe(6000);
		const rolled = applyOp(data, {
			type: "rollEdit",
			leftId: left.id,
			rightId: right.id,
			toMs: 4500,
		}).data;
		const [l2, r2] = rolled.clips as MediaClip[];
		expect(l2.durationMs).toBe(4500);
		expect(r2).toMatchObject({ startMs: 4500, durationMs: 3500, inMs: 5500 });
		const slid = applyOp(data, { type: "slideClip", id: left.id, deltaMs: 500 }).data;
		expect((slid.clips.find((c) => c.id === left.id) as MediaClip).startMs).toBe(500);
		expect((slid.clips.find((c) => c.id === right.id) as MediaClip).startMs).toBe(4500);
	});

	it("groups move and delete together; detached audio is linked", () => {
		const { data, left } = twoClips();
		const detached = applyOp(data, { type: "detachAudio", id: left.id });
		const audioId = detached.created?.[0] as string;
		const moved = applyOp(detached.data, { type: "moveClips", ids: [left.id], deltaMs: 1000 }).data;
		expect(moved.clips.find((c) => c.id === audioId)?.startMs).toBe(1000);
		const deleted = applyOp(moved, { type: "removeClips", ids: [audioId] }).data;
		expect(deleted.clips.some((c) => c.id === left.id)).toBe(false);
	});

	it("keyframes and zooms are stored sorted and clamped", () => {
		const { data, left } = twoClips();
		let next = applyOp(data, {
			type: "setKeyframe",
			clipId: left.id,
			prop: "scale",
			keyframe: { atMs: 3000, value: 1.2, ease: "ease" },
		}).data;
		next = applyOp(next, {
			type: "setKeyframe",
			clipId: left.id,
			prop: "scale",
			keyframe: { atMs: 0, value: 1, ease: "ease" },
		}).data;
		next = applyOp(next, {
			type: "addZoom",
			clipId: left.id,
			startMs: 500,
			endMs: 9000,
			scale: 2,
		}).data;
		const c = next.clips.find((x) => x.id === left.id) as MediaClip;
		expect(c.keyframes?.scale?.map((k) => k.atMs)).toEqual([0, 3000]);
		expect(c.zooms?.[0].endMs).toBe(4000);
	});
});

describe("export with motion", () => {
	it("renders zoom, keyframes, colour and a crossfade", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-motion-"));
		const src = path.join(dir, "src.mp4");
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"testsrc2=s=640x360:r=30:d=6",
			"-f",
			"lavfi",
			"-i",
			"sine=f=330:d=6",
			"-shortest",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			src,
		]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
		});
		await store.create({ path: dir, name: "Motion" });
		const [asset] = await store.importMedia([src], "user");
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: asset.id, startMs: 0, durationMs: 3000 },
					{
						type: "media",
						trackId: "V1",
						assetId: asset.id,
						startMs: 3000,
						durationMs: 3000,
						inMs: 3000,
					},
				],
			},
			"user",
		);
		const [a, b] = store.current.clips as MediaClip[];
		store.apply(
			{ type: "addZoom", clipId: a.id, startMs: 500, endMs: 2500, scale: 2, x: 0.7, y: 0.3 },
			"user",
		);
		store.apply(
			{
				type: "setKeyframe",
				clipId: b.id,
				prop: "x",
				keyframe: { atMs: 0, value: 0.3, ease: "ease" },
			},
			"user",
		);
		store.apply(
			{
				type: "setKeyframe",
				clipId: b.id,
				prop: "x",
				keyframe: { atMs: 2000, value: 0.5, ease: "ease" },
			},
			"user",
		);
		store.apply(
			{
				type: "setKeyframe",
				clipId: b.id,
				prop: "volume",
				keyframe: { atMs: 0, value: 0, ease: "linear" },
			},
			"user",
		);
		store.apply(
			{
				type: "setKeyframe",
				clipId: b.id,
				prop: "volume",
				keyframe: { atMs: 1000, value: 1, ease: "linear" },
			},
			"user",
		);
		store.apply(
			{ type: "updateClip", id: b.id, patch: { color: { saturation: 0.2, temperature: 0.5 } } },
			"user",
		);
		store.apply(
			{ type: "addTransition", clipId: b.id, transition: { kind: "crossfade", durationMs: 600 } },
			"user",
		);
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "draft" } },
			"user",
		);
		const report = await store.export("video", "out.mp4", "user");
		const info = await probe(report.outputs[0]);
		expect(info.durationMs).toBeGreaterThan(5000);
		expect(info.hasAudio).toBe(true);
		// Pitch-preserving audio proxies exist for sped-up playback.
		const stretched = await store.audioProxy(asset.id, 1.5);
		expect((await probe(stretched)).durationMs).toBeLessThan(4300);
	}, 180000);
});
