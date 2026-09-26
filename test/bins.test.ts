import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterMedia, mediaUses, sortMedia } from "../electron/core/bins";
import { fromOtio, toOtio } from "../electron/core/interchange";
import { ffmpeg, parseMediaInfo, probe } from "../electron/core/media";
import { applyOp } from "../electron/core/ops";
import { emptyProject, parseProject } from "../electron/core/project";
import { ProjectStore } from "../electron/core/store";
import type { Asset, ProjectData } from "../electron/core/types";

const asset = (id: string, patch: Partial<Asset> = {}): Asset => ({
	id,
	kind: "video",
	name: `${id}.mp4`,
	path: `${id}.mp4`,
	durationMs: 5000,
	width: 1920,
	height: 1080,
	hasAudio: true,
	origin: "import",
	createdAt: "2026-01-01T00:00:00.000Z",
	actor: "user",
	...patch,
});

function library(): ProjectData {
	let data = emptyProject("Bins");
	for (const a of [asset("a_1"), asset("a_2"), asset("a_3", { kind: "audio", name: "song.wav" })])
		data = applyOp(data, { type: "addAsset", asset: a }).data;
	return data;
}

describe("bins", () => {
	it("creates, nests one level, renames and removes bins, moving their media up", () => {
		let data = library();
		const top = applyOp(data, { type: "createBin", name: "Interviews" });
		const topId = top.created?.[0] as string;
		data = top.data;
		const sub = applyOp(data, { type: "createBin", name: "Day 1", parentId: topId });
		const subId = sub.created?.[0] as string;
		data = sub.data;
		expect(sub.summary).toBe('Created bin "Interviews › Day 1"');
		expect(() => applyOp(data, { type: "createBin", name: "Deeper", parentId: subId })).toThrow(
			/one level/,
		);
		expect(() => applyOp(data, { type: "createBin", name: "interviews" })).toThrow(/already/);

		data = applyOp(data, { type: "moveMedia", assetIds: ["a_1", "a_2"], binId: subId }).data;
		data = applyOp(data, { type: "moveMedia", assetIds: ["a_3"], binId: topId }).data;
		expect(data.assets.map((a) => a.binId)).toEqual([subId, subId, topId]);

		data = applyOp(data, { type: "renameBin", id: subId, name: "Monday" }).data;
		expect(data.bins?.find((b) => b.id === subId)?.name).toBe("Monday");

		// Removing the sub-bin files its media in the parent.
		const removedSub = applyOp(data, { type: "removeBin", id: subId });
		expect(removedSub.data.assets.map((a) => a.binId)).toEqual([topId, topId, topId]);
		expect(removedSub.summary).toMatch(/2 items moved to its parent/);

		// Removing the top bin sends its media to the top level and its sub-bins up a level.
		const removedTop = applyOp(data, { type: "removeBin", id: topId }).data;
		expect(removedTop.bins).toEqual([{ id: subId, name: "Monday" }]);
		expect(removedTop.assets.map((a) => a.binId)).toEqual([subId, subId, undefined]);
		expect("binId" in removedTop.assets[2]).toBe(false);
	});

	it("moves media to the top level and rejects unknown bins or media", () => {
		let data = applyOp(library(), { type: "createBin", id: "b_x", name: "B-roll" }).data;
		data = applyOp(data, { type: "moveMedia", assetIds: ["a_1"], binId: "b_x" }).data;
		data = applyOp(data, { type: "moveMedia", assetIds: ["a_1"], binId: null }).data;
		expect(data.assets[0].binId).toBeUndefined();
		expect(() => applyOp(data, { type: "moveMedia", assetIds: ["a_1"], binId: "nope" })).toThrow(
			/No bin/,
		);
		expect(() => applyOp(data, { type: "moveMedia", assetIds: ["zzz"], binId: null })).toThrow(
			/No media/,
		);
	});
});

describe("tag_media", () => {
	it("merges tags without repeats, removes case-insensitively, rates and notes", () => {
		let data = library();
		data = applyOp(data, {
			type: "tagMedia",
			assetIds: ["a_1", "a_2"],
			add: [" Drone ", "sunset", "drone"],
		}).data;
		data = applyOp(data, {
			type: "tagMedia",
			assetIds: ["a_1"],
			add: ["Hero  shot", "SUNSET"],
			remove: ["DRONE"],
			rating: 5,
			note: "  Best take  ",
		}).data;
		expect(data.assets[0]).toMatchObject({
			tags: ["sunset", "Hero shot"],
			rating: 5,
			note: "Best take",
		});
		expect(data.assets[1].tags).toEqual(["Drone", "sunset"]);
		// Clearing: rating 0, an empty note and removing every tag leave no fields behind.
		data = applyOp(data, {
			type: "tagMedia",
			assetIds: ["a_1"],
			remove: ["sunset", "hero shot"],
			rating: 0,
			note: "",
		}).data;
		expect(data.assets[0]).not.toHaveProperty("tags");
		expect(data.assets[0]).not.toHaveProperty("rating");
		expect(data.assets[0]).not.toHaveProperty("note");
	});

	it("filters, searches and sorts the library", () => {
		let data = library();
		data = applyOp(data, { type: "tagMedia", assetIds: ["a_2"], add: ["drone"], rating: 4 }).data;
		data = applyOp(data, {
			type: "setTranscript",
			assetId: "a_3",
			transcript: {
				model: "t",
				createdAt: "",
				words: [
					{ text: "pricing", startMs: 0, endMs: 100 },
					{ text: "matters", startMs: 100, endMs: 200 },
				],
			},
		}).data;
		data = applyOp(data, {
			type: "addClips",
			clips: [{ type: "media", trackId: "V1", assetId: "a_1", startMs: 1000 }],
		}).data;
		const ids = (list: Asset[]) => list.map((a) => a.id);
		expect(ids(filterMedia(data, { tag: "DRONE" }))).toEqual(["a_2"]);
		expect(ids(filterMedia(data, { unused: true }))).toEqual(["a_2", "a_3"]);
		expect(ids(filterMedia(data, { query: "pricing" }))).toEqual(["a_3"]);
		expect(ids(filterMedia(data, { kind: "audio" }))).toEqual(["a_3"]);
		expect(ids(filterMedia(data, { minRating: 1 }))).toEqual(["a_2"]);
		expect(ids(filterMedia(data, { binId: null }))).toHaveLength(3);
		expect(ids(sortMedia(data.assets, "rating"))[0]).toBe("a_2");
		expect(mediaUses(data, "a_1")).toMatchObject([
			{ sequenceId: "main", startMs: 1000, open: true },
		]);
	});
});

describe("project files without bins", () => {
	it("load with no bins and repair broken references", () => {
		const old = parseProject({
			version: 2,
			name: "Old",
			assets: [asset("a_1")],
		});
		expect(old.bins).toEqual([]);
		expect(old.assets[0].binId).toBeUndefined();
		expect(old.assets[0].tags).toBeUndefined();

		const broken = parseProject({
			version: 2,
			name: "Broken",
			assets: [asset("a_1", { binId: "gone" }), asset("a_2", { binId: "b_2" })],
			bins: [
				{ id: "b_1", name: "Top" },
				{ id: "b_2", name: "Sub", parentId: "b_1" },
				{ id: "b_3", name: "Too deep", parentId: "b_2" },
				{ id: "b_4", name: "Orphan", parentId: "missing" },
			],
		});
		expect(broken.assets.map((a) => a.binId)).toEqual([undefined, "b_2"]);
		expect(broken.bins).toEqual([
			{ id: "b_1", name: "Top" },
			{ id: "b_2", name: "Sub", parentId: "b_1" },
			{ id: "b_3", name: "Too deep" },
			{ id: "b_4", name: "Orphan" },
		]);
	});
});

describe("interchange", () => {
	it("carries bins, tags, ratings and notes through OpenTimelineIO", () => {
		let data = library();
		data = applyOp(data, { type: "createBin", id: "b_1", name: "Interviews" }).data;
		data = applyOp(data, { type: "createBin", id: "b_2", name: "Day 1", parentId: "b_1" }).data;
		data = applyOp(data, { type: "moveMedia", assetIds: ["a_1"], binId: "b_2" }).data;
		data = applyOp(data, {
			type: "tagMedia",
			assetIds: ["a_1"],
			add: ["hero"],
			rating: 5,
			note: "Use first",
		}).data;
		data = applyOp(data, {
			type: "addClips",
			clips: [
				{ type: "media", trackId: "V1", assetId: "a_1", startMs: 0, durationMs: 2000 },
				{ type: "media", trackId: "V1", assetId: "a_2", startMs: 2000, durationMs: 2000 },
			],
		}).data;
		const back = fromOtio(JSON.parse(toOtio(data, "/tmp/p")), "/tmp/p");
		const clips = back.tracks.flatMap((t) => t.clips).filter((c) => c.type === "media");
		expect(clips.map((c) => (c.type === "media" ? c.library : null))).toEqual([
			{ bin: "Interviews › Day 1", tags: ["hero"], rating: 5, note: "Use first" },
			undefined,
		]);
	});
});

describe("media info", () => {
	it("reads codecs, frame rate, bitrate, audio and the recording date from ffmpeg", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-info-"));
		const video = path.join(dir, "clip.mp4");
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"testsrc=s=320x240:r=25:d=1",
			"-f",
			"lavfi",
			"-i",
			"sine=f=440:d=1:sample_rate=44100",
			"-ac",
			"2",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-metadata",
			"creation_time=2024-05-06T07:08:09Z",
			"-shortest",
			video,
		]);
		const probed = await probe(video);
		expect(probed.width).toBe(320);
		expect(probed.info).toMatchObject({
			format: "mov",
			videoCodec: "h264",
			pixelFormat: "yuv420p",
			fps: 25,
			audioCodec: "aac",
			audioChannels: 2,
			channelLayout: "stereo",
			sampleRate: 44100,
		});
		expect(probed.info.bitrateKbps).toBeGreaterThan(0);
		expect(probed.info.creationTime?.startsWith("2024-05-06T07:08:09")).toBe(true);

		const wav = path.join(dir, "voice.wav");
		await ffmpeg(["-f", "lavfi", "-i", "sine=d=1:sample_rate=48000", "-ac", "1", wav]);
		expect((await probe(wav)).info).toMatchObject({
			format: "wav",
			audioCodec: "pcm_s16le",
			audioChannels: 1,
			sampleRate: 48000,
		});
		expect((await probe(wav)).info.videoCodec).toBeUndefined();

		const png = path.join(dir, "still.png");
		await ffmpeg(["-f", "lavfi", "-i", "testsrc=s=64x64:d=1", "-frames:v", "1", png]);
		const still = (await probe(png)).info;
		expect(still.videoCodec).toBe("png");
		// Stills report ffmpeg's default rate, which means nothing for them.
		expect(still.fps).toBeUndefined();
	}, 30000);

	it("parses pixel formats with details, rotation, surround sound and cover art", () => {
		const info = parseMediaInfo(
			[
				"Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_0001.MOV':",
				"  Metadata:",
				"    creation_time   : 2025-03-01T10:00:00.000000Z",
				"    com.apple.quicktime.creationdate: 2025-03-01T11:00:00+0100",
				"  Duration: 00:00:04.20, start: 0.000000, bitrate: 15123 kb/s",
				"  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160, 15000 kb/s, 29.97 fps, 29.97 tbr, 600 tbn (default)",
				"    Side data:",
				"      displaymatrix: rotation of -90.00 degrees",
				"  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, 5.1(side), fltp, 384 kb/s (default)",
				"  Stream #0:2: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 600x600, 90k tbr, 90k tbn (attached pic)",
			].join("\n"),
			new Date("2026-01-01T00:00:00Z"),
		);
		expect(info).toEqual({
			probedAt: "2026-01-01T00:00:00.000Z",
			format: "mov",
			bitrateKbps: 15123,
			creationTime: "2025-03-01T11:00:00+0100",
			rotation: 90,
			videoCodec: "hevc",
			videoProfile: "Main 10",
			pixelFormat: "yuv420p10le",
			fps: 29.97,
			audioCodec: "aac",
			sampleRate: 48000,
			audioChannels: 6,
			channelLayout: "5.1(side)",
		});
	});

	it("stores info at import and backfills older projects once", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-backfill-"));
		const clip = path.join(dir, "clip.mp4");
		await ffmpeg(["-f", "lavfi", "-i", "testsrc=s=160x120:r=30:d=1", "-pix_fmt", "yuv420p", clip]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Backfill" });
		const [imported] = await store.importMedia([clip], "user");
		expect(imported.info?.videoCodec).toBe("h264");
		expect(imported.info?.fps).toBe(30);
		await store.flush();
		const file = store.snapshot()?.path as string;

		// An older project: the same media without info or size.
		const saved = JSON.parse(await fs.readFile(file, "utf8"));
		for (const a of saved.assets) {
			delete a.info;
			delete a.size;
		}
		await fs.writeFile(file, JSON.stringify(saved));
		await store.open(file);
		await store.backfillInfo();
		const [asset] = store.current.assets;
		expect(asset.info?.videoCodec).toBe("h264");
		expect(asset.size).toBeGreaterThan(0);
		// Not an undo step.
		expect(store.snapshot()?.canUndo).toBe(false);
		const probedAt = asset.info?.probedAt;
		await store.backfillInfo();
		expect(store.current.assets[0].info?.probedAt).toBe(probedAt);
	}, 30000);
});
