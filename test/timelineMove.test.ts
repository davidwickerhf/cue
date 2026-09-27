import { describe, expect, it } from "vitest";
import { applyOp } from "../electron/core/ops";
import { emptyProject } from "../electron/core/project";
import type { Asset, Clip, ProjectData } from "../electron/core/types";

const video: Asset = {
	id: "a_v",
	kind: "video",
	name: "shot.mp4",
	path: "shot.mp4",
	durationMs: 20000,
	width: 1920,
	height: 1080,
	hasAudio: true,
	origin: "import",
	createdAt: "",
	actor: "user",
};

/** A project with two video tracks, and V1 holding clips at 0–4 s and 6–10 s (with their sound on A2). */
function setup(): ProjectData {
	let data = applyOp(emptyProject("T"), { type: "addAsset", asset: video }).data;
	data = applyOp(data, { type: "updateSettings", settings: { separateAudio: true } }).data;
	data = applyOp(data, { type: "addTrack", kind: "video" }).data;
	data = applyOp(data, { type: "addTrack", kind: "audio" }).data;
	data = applyOp(data, {
		type: "addClips",
		clips: [
			{ type: "media", trackId: "V1", assetId: "a_v", id: "c_a", startMs: 0, durationMs: 4000 },
			{ type: "media", trackId: "V1", assetId: "a_v", id: "c_b", startMs: 6000, durationMs: 4000 },
		],
	}).data;
	return data;
}

const byId = (data: ProjectData, id: string) => data.clips.find((c) => c.id === id) as Clip;

describe("moving clips", () => {
	it("moves a picture to another track while its linked sound keeps its track", () => {
		const data = setup();
		const sound = data.clips.find(
			(c) => c.groupId === byId(data, "c_a").groupId && c.id !== "c_a",
		) as Clip;
		expect(sound).toBeDefined();
		const next = applyOp(data, {
			type: "moveClips",
			ids: ["c_a", sound.id],
			deltaMs: 1000,
			tracks: { c_a: "V2" },
		}).data;
		expect(byId(next, "c_a")).toMatchObject({ trackId: "V2", startMs: 1000 });
		expect(byId(next, sound.id)).toMatchObject({ trackId: sound.trackId, startMs: 1000 });
	});

	it("makes a new track when asked, in one step", () => {
		const data = setup();
		const result = applyOp(data, {
			type: "moveClips",
			ids: ["c_b"],
			deltaMs: 0,
			tracks: { c_b: "new" },
		});
		const [trackId] = result.created ?? [];
		expect(result.data.tracks.find((t) => t.id === trackId)?.kind).toBe("video");
		// New picture tracks go on top.
		expect(result.data.tracks[0].id).toBe(trackId);
		expect(byId(result.data, "c_b").trackId).toBe(trackId);
	});

	it("overwrites what a moved clip lands on instead of stacking on it", () => {
		const data = setup();
		// c_b (6–10 s) moved to 2–6 s over c_a (0–4 s): c_a keeps 0–2 s.
		const next = applyOp(data, {
			type: "moveClips",
			ids: ["c_b"],
			deltaMs: -4000,
			overwrite: true,
		}).data;
		const v1 = next.clips.filter((c) => c.trackId === "V1").sort((a, b) => a.startMs - b.startMs);
		expect(v1.map((c) => [c.startMs, c.startMs + c.durationMs])).toEqual([
			[0, 2000],
			[2000, 6000],
		]);
		// Without overwrite they overlap, as before.
		const stacked = applyOp(data, { type: "moveClips", ids: ["c_b"], deltaMs: -4000 }).data;
		expect(stacked.clips.filter((c) => c.trackId === "V1").length).toBe(2);
		expect(byId(stacked, "c_a").durationMs).toBe(4000);
	});

	it("covers a clip entirely: the covered one goes", () => {
		const data = applyOp(setup(), {
			type: "addClips",
			clips: [
				{
					type: "media",
					trackId: "V2",
					assetId: "a_v",
					id: "c_c",
					startMs: 500,
					durationMs: 1000,
					linkedAudio: false,
				},
			],
		}).data;
		const next = applyOp(data, {
			type: "moveClips",
			ids: ["c_a"],
			deltaMs: 0,
			tracks: { c_a: "V2" },
			overwrite: true,
		}).data;
		expect(next.clips.some((c) => c.id === "c_c")).toBe(false);
		expect(byId(next, "c_a").trackId).toBe("V2");
	});
});
