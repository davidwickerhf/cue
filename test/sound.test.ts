import { describe, expect, it } from "vitest";
import { fromOtio, toOtio } from "../electron/core/interchange";
import { applyOp } from "../electron/core/ops";
import { emptyProject } from "../electron/core/project";
import type { Asset, MediaClip, ProjectData } from "../electron/core/types";

const video: Asset = {
	id: "a_v",
	kind: "video",
	name: "v.mp4",
	path: "v.mp4",
	durationMs: 20000,
	width: 1920,
	height: 1080,
	hasAudio: true,
	origin: "import",
	createdAt: "",
	actor: "user",
};
const silent: Asset = { ...video, id: "a_s", name: "s.mp4", hasAudio: false };

function project(): ProjectData {
	let data = emptyProject("T");
	data = { ...data, settings: { ...data.settings, separateAudio: true } };
	data = applyOp(data, { type: "addAsset", asset: video }).data;
	return applyOp(data, { type: "addAsset", asset: silent }).data;
}
const media = (d: ProjectData) => d.clips.filter((c): c is MediaClip => c.type === "media");

describe("a video's sound on its own track", () => {
	it("puts the sound of a placed video on an audio track, linked and in sync", () => {
		const { data, created } = applyOp(project(), {
			type: "addClips",
			clips: [
				{ type: "media", trackId: "V1", assetId: video.id, startMs: 1000, durationMs: 4000 },
				{ type: "media", trackId: "V1", assetId: silent.id, startMs: 6000, durationMs: 2000 },
			],
		});
		const [picture, sound] = [
			media(data).find((c) => c.trackId === "V1" && c.assetId === video.id),
			media(data).find((c) => data.tracks.find((t) => t.id === c.trackId)?.kind === "audio"),
		] as MediaClip[];
		expect(picture.volume).toBe(0);
		expect(sound).toBeDefined();
		expect(sound.startMs).toBe(1000);
		expect(sound.durationMs).toBe(4000);
		expect(sound.groupId).toBe(picture.groupId);
		// The picture without sound stays as it is, and every new clip is reported.
		expect(media(data).filter((c) => c.assetId === silent.id)).toHaveLength(1);
		expect(created).toHaveLength(3);
	});

	it("keeps the sound on the picture when asked, or when the setting is off", () => {
		const off = applyOp(project(), {
			type: "addClips",
			clips: [{ type: "media", trackId: "V1", assetId: video.id, startMs: 0, linkedAudio: false }],
		}).data;
		expect(media(off)).toHaveLength(1);
		const p = project();
		const setting = applyOp(
			{ ...p, settings: { ...p.settings, separateAudio: false } },
			{
				type: "addClips",
				clips: [{ type: "media", trackId: "V1", assetId: video.id, startMs: 0 }],
			},
		).data;
		expect(media(setting)).toHaveLength(1);
	});

	it("separates sound on insert and overwrite edits too", () => {
		let data = applyOp(project(), {
			type: "insertEdit",
			assetId: video.id,
			trackId: "V1",
			atMs: 0,
			inMs: 0,
			outMs: 3000,
			mode: "insert",
		}).data;
		expect(media(data)).toHaveLength(2);
		data = applyOp(data, {
			type: "insertEdit",
			assetId: video.id,
			trackId: "V1",
			atMs: 1000,
			inMs: 5000,
			outMs: 6000,
			mode: "overwrite",
		}).data;
		// The overwritten stretch of sound was replaced, not layered.
		const sounds = media(data).filter(
			(c) => data.tracks.find((t) => t.id === c.trackId)?.kind === "audio",
		);
		const at1500 = sounds.filter((c) => c.startMs <= 1500 && c.startMs + c.durationMs > 1500);
		expect(at1500).toHaveLength(1);
		expect(at1500[0].inMs).toBe(5000);
	});

	it("survives an OpenTimelineIO round trip", () => {
		const data = applyOp(project(), {
			type: "addClips",
			clips: [{ type: "media", trackId: "V1", assetId: video.id, startMs: 0, durationMs: 4000 }],
		}).data;
		const back = fromOtio(JSON.parse(toOtio(data, "/proj")), "/proj");
		const kinds = back.tracks.filter((t) => t.clips.length).map((t) => t.kind);
		expect(kinds).toContain("video");
		expect(kinds).toContain("audio");
	});
});
