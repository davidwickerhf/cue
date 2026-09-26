import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chunkCaptions } from "../electron/core/ai";
import { ffmpeg, probe } from "../electron/core/media";
import { applyOp } from "../electron/core/ops";
import { deriveLines, emptyProject, normaliseLine, parseProject, stemName } from "../electron/core/project";
import { parseSrt } from "../electron/core/srt";
import { ProjectStore } from "../electron/core/store";
import type { Asset, MediaClip, ProjectData } from "../electron/core/types";

const lines = [
	{ id: "B1", text: "Second", startMs: 5000, targetMs: 3000, maxMs: 4000 },
	{ id: "A1", text: "First", startMs: 0, targetMs: 2000 },
];

function withMedia(): { data: ProjectData; video: Asset } {
	const video: Asset = {
		id: "a_video",
		kind: "video",
		name: "clip.mp4",
		path: "clip.mp4",
		durationMs: 10000,
		width: 1280,
		height: 720,
		hasAudio: true,
		origin: "import",
		createdAt: "",
		actor: "user",
	};
	let data = applyOp(emptyProject("Demo"), { type: "addAsset", asset: video, placeOn: { trackId: "V1", startMs: 0 } }).data;
	data = applyOp(data, { type: "setLines", lines }).data;
	return { data, video };
}

describe("project model", () => {
	it("fills line defaults and sorts by start", () => {
		const data = applyOp(emptyProject("Demo"), { type: "setLines", lines }).data;
		expect(data.lines.map((line) => line.id)).toEqual(["A1", "B1"]);
		expect(data.lines[0].maxMs).toBe(2500);
		expect(normaliseLine({ id: "x", text: "t", startMs: 0 }).targetMs).toBe(6000);
	});

	it("rejects duplicate line ids", () => {
		expect(() => applyOp(emptyProject("Demo"), { type: "setLines", lines: [lines[0], { ...lines[1], id: "B1" }] })).toThrow(/Duplicate/);
	});

	it("parses a saved project with partial settings", () => {
		const data = parseProject({ version: 2, name: "x", lines, settings: { prerollMs: 500 } });
		expect(data.settings.prerollMs).toBe(500);
		expect(data.settings.padMs).toBe(250);
		expect(data.export.stemPattern).toBe("{id}.wav");
	});

	it("names stems from the pattern", () => {
		expect(stemName("{index}-{id}.wav", "B2a", 4)).toBe("05-B2a.wav");
	});
});

describe("timeline editing", () => {
	it("splits a clip and keeps the source continuous", () => {
		const { data } = withMedia();
		const [clip] = data.clips as MediaClip[];
		const result = applyOp(data, { type: "splitClip", id: clip.id, atMs: 4000 });
		const [left, right] = result.data.clips as MediaClip[];
		expect(left.durationMs).toBe(4000);
		expect(right.startMs).toBe(4000);
		expect(right.inMs).toBe(4000);
		expect(right.durationMs).toBe(6000);
	});

	it("trims and extends within the source length", () => {
		const { data } = withMedia();
		const [clip] = data.clips as MediaClip[];
		let next = applyOp(data, { type: "trimClip", id: clip.id, edge: "start", toMs: 2000 }).data;
		let trimmed = next.clips[0] as MediaClip;
		expect(trimmed).toMatchObject({ startMs: 2000, inMs: 2000, durationMs: 8000 });
		next = applyOp(next, { type: "trimClip", id: clip.id, edge: "start", toMs: 0 }).data;
		trimmed = next.clips[0] as MediaClip;
		expect(trimmed).toMatchObject({ startMs: 0, inMs: 0, durationMs: 10000 });
		next = applyOp(next, { type: "trimClip", id: clip.id, edge: "end", toMs: 60000 }).data;
		expect((next.clips[0] as MediaClip).durationMs).toBe(10000);
	});

	it("ripple-deletes and closes the gap", () => {
		const { data } = withMedia();
		const [clip] = data.clips as MediaClip[];
		const split = applyOp(data, { type: "splitClip", id: clip.id, atMs: 3000 });
		const withThird = applyOp(split.data, { type: "duplicateClips", ids: split.created ?? [] }).data;
		const [first, , third] = withThird.clips;
		const after = applyOp(withThird, { type: "removeClips", ids: [first.id], ripple: true }).data;
		const moved = after.clips.find((c) => c.id === third.id);
		expect(third.startMs).toBe(10000);
		expect(moved?.startMs).toBe(7000);
	});

	it("refuses edits on locked tracks and wrong track kinds", () => {
		const { data, video } = withMedia();
		const locked = applyOp(data, { type: "updateTrack", id: "V1", patch: { locked: true } }).data;
		expect(() => applyOp(locked, { type: "moveClips", ids: [locked.clips[0].id], deltaMs: 100 })).toThrow(/locked/);
		expect(() => applyOp(data, { type: "addClips", clips: [{ type: "text", trackId: "V1", startMs: 0, text: "Hi" }] })).toThrow(/text tracks/);
		expect(() => applyOp(data, { type: "addClips", clips: [{ type: "media", trackId: "T1", assetId: video.id, startMs: 0 }] })).toThrow();
	});

	it("choosing a take places it on the voiceover track at the line start", () => {
		const { data } = withMedia();
		const take: Asset = { id: "a_take", kind: "audio", name: "AI", path: "t.wav", durationMs: 3000, width: 0, height: 0, hasAudio: true, origin: "tts", createdAt: "", lineId: "B1", speechStartMs: 400, speechEndMs: 2600, actor: "agent" };
		const next = applyOp(data, { type: "addTake", asset: take }).data;
		const view = deriveLines(next).find((l) => l.id === "B1");
		const clip = next.clips.find((c) => c.id === view?.clipId) as MediaClip;
		expect(clip.trackId).toBe("A1");
		expect(clip.inMs).toBe(150);
		expect(view?.placementMs).toBe(5000);
		expect(view?.speechMs).toBe(2200);
		expect(view?.status).toBe("ok");
		const moved = applyOp(next, { type: "updateLine", id: "B1", patch: { startMs: 6000 } }).data;
		expect(deriveLines(moved).find((l) => l.id === "B1")?.placementMs).toBe(6000);
	});
});

describe("ripple cuts and detaching audio", () => {
	it("removes ranges across tracks and moves lines and markers after them", () => {
		const { data } = withMedia();
		let next = applyOp(data, { type: "addMarker", atMs: 8000, label: "m" }).data;
		next = applyOp(next, { type: "removeRanges", ranges: [{ startMs: 2000, endMs: 3000 }, { startMs: 2500, endMs: 3500 }] }).data;
		const video = next.clips.filter((c) => c.trackId === "V1") as MediaClip[];
		expect(video).toHaveLength(2);
		expect(video[1]).toMatchObject({ startMs: 2000, inMs: 3500, durationMs: 6500 });
		expect(next.lines.find((l) => l.id === "B1")?.startMs).toBe(3500);
		expect(next.markers[0].atMs).toBe(6500);
	});

	it("detaches a video's audio onto an audio track and mutes the video clip", () => {
		const { data } = withMedia();
		const [clip] = data.clips as MediaClip[];
		const result = applyOp(data, { type: "detachAudio", id: clip.id });
		const audio = result.data.clips.find((c) => c.id === result.created?.[0]) as MediaClip;
		expect(audio.trackId).toBe("A2");
		expect(audio.inMs).toBe(clip.inMs);
		expect((result.data.clips[0] as MediaClip).volume).toBe(0);
	});
});

describe("srt and captions", () => {
	it("uses cue length as target and the gap to the next cue as max", () => {
		const parsed = parseSrt("1\n00:00:00,800 --> 00:00:07,250\nHello there.\n\n2\n00:00:07,500 --> 00:00:20,450\nSecond line\ncontinues.\n");
		expect(parsed[0]).toMatchObject({ id: "L01", startMs: 800, targetMs: 6450, maxMs: 6700 });
		expect(parsed[1].text).toBe("Second line continues.");
	});

	it("chunks transcript words into caption-sized pieces", () => {
		const words = "This is a fairly long sentence that should be split into readable captions. Next.".split(" ");
		const chunks = chunkCaptions([{ startMs: 0, endMs: 8000, text: "", words: words.map((word, i) => ({ word, startMs: i * 500, endMs: i * 500 + 400 })) }], 30);
		expect(chunks.length).toBeGreaterThan(2);
		expect(chunks.every((c) => c.text.length <= 40)).toBe(true);
	});
});

describe("silence removal", () => {
	it("finds the pause in a clip and closes it on every track", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-silence-"));
		const audio = path.join(dir, "speech.wav");
		await ffmpeg([
			"-f", "lavfi", "-i", "sine=frequency=300:duration=2:sample_rate=48000",
			"-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=2",
			"-f", "lavfi", "-i", "sine=frequency=300:duration=2:sample_rate=48000",
			"-filter_complex", "[0][1][2]concat=n=3:v=0:a=1", audio,
		]);
		const store = new ProjectStore({ mediaUrl: (f) => f, recentFile: path.join(dir, "recent.json") });
		await store.create({ path: dir, name: "Silence" });
		const [asset] = await store.importMedia([audio], "user", { trackId: "A1", startMs: 0 });
		const result = await store.removeSilence("agent", { thresholdDb: -40, minSilenceMs: 500, keepMs: 100 });
		expect(result.ranges).toHaveLength(1);
		expect(result.removedMs).toBeGreaterThan(1600);
		const clips = store.current.clips.filter((c) => c.type === "media" && c.assetId === asset.id);
		expect(clips).toHaveLength(2);
		expect(Math.round(clips[1].startMs / 100)).toBe(Math.round((2000 + 100) / 100));
	}, 60000);
});

describe("store with real media", () => {
	it("imports, records, edits and exports", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-test-"));
		const video = path.join(dir, "source.mp4");
		const tone = path.join(dir, "tone.wav");
		await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=6", "-f", "lavfi", "-i", "sine=f=220:d=6", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video]);
		await ffmpeg([
			"-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=0.5",
			"-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=48000",
			"-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=0.5",
			"-filter_complex", "[0][1][2]concat=n=3:v=0:a=1", tone,
		]);
		const store = new ProjectStore({ mediaUrl: (file) => file, recentFile: path.join(dir, "recent.json") });
		await store.create({ path: dir, name: "Test", video, lines });
		expect(store.current.canvas).toMatchObject({ width: 640, height: 360 });
		const take = await store.addRecording({ lineId: "A1", audio: await fs.readFile(tone), extension: "wav", recordedAtMs: 100, actor: "agent" });
		expect(take.speechStartMs).toBeGreaterThan(400);
		expect(take.speechEndMs).toBeLessThan(1600);
		const view = store.snapshot()?.lines.find((l) => l.id === "A1");
		expect(view?.status).toBe("ok");
		expect(view?.placementMs).toBeGreaterThan(500);

		store.apply({ type: "addClips", clips: [{ type: "text", trackId: "T1", startMs: 500, durationMs: 2000, text: "Title" }] }, "user");
		const stems = await store.export("stems", undefined, "agent");
		expect(stems.missing).toEqual(["B1"]);
		const manifest = JSON.parse(await fs.readFile(path.join(dir, "stems", "durations.json"), "utf8"));
		expect(manifest.A1).toBeGreaterThan(1.3);

		const overlay = path.join(dir, "text.png");
		await ffmpeg(["-f", "lavfi", "-i", "color=c=white@0.5:s=640x360,format=rgba", "-frames:v", "1", overlay]);
		const report = await store.export("video", "export/out.mp4", "user", async (clips) => Object.fromEntries(clips.map((c) => [c.id, { kind: "still" as const, file: overlay }])));
		const info = await probe(report.outputs[0]);
		expect(info.width).toBe(640);
		expect(info.hasAudio).toBe(true);
		expect(info.durationMs).toBeGreaterThan(5500);

		// Crop, ducking and denoise all go through the real export graph.
		const videoClip = store.current.clips.find((c) => c.trackId === "V1") as MediaClip;
		store.apply({ type: "updateClip", id: videoClip.id, patch: { transform: { crop: { left: 0.1, right: 0.1 } }, denoise: true } }, "user");
		store.apply({ type: "addClips", clips: [{ type: "media", trackId: "A2", assetId: videoClip.assetId, startMs: 0 }] }, "user");
		const ducked = await store.export("video", "export/ducked.mp4", "user", async (clips) => Object.fromEntries(clips.map((c) => [c.id, { kind: "still" as const, file: overlay }])));
		expect((await probe(ducked.outputs[0])).width).toBe(640);

		store.apply({ type: "addTrack", kind: "text", name: "Captions" }, "user");
		const captionsTrack = store.current.tracks.find((t) => t.name === "Captions")?.id as string;
		store.apply({ type: "addClips", clips: [{ type: "text", trackId: captionsTrack, startMs: 1000, durationMs: 1500, text: "Hello" }] }, "user");
		const captions = await store.export("captions", undefined, "user");
		expect(await fs.readFile(captions.outputs[0], "utf8")).toContain("00:00:01,000 --> 00:00:02,500");

		const peaks = await store.peaks(take.id);
		expect(peaks.length).toBeGreaterThan(80);
		const thumbs = await store.thumbnails(store.current.assets[0].id);
		expect(thumbs.urls.length).toBeGreaterThan(2);

		await store.flush();
		const saved = parseProject(JSON.parse(await fs.readFile(store.snapshot()?.path ?? "", "utf8")));
		expect(saved.assets).toHaveLength(2);
		expect(store.undo("user")).toBe(true);
	}, 60000);
});
