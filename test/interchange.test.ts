import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { fromOtio, toEdl, toFcpxml, toMlt, toOtio } from "../electron/core/interchange";
import { scanProjects, summarise } from "../electron/core/library";
import { ffmpeg } from "../electron/core/media";
import { applyOp } from "../electron/core/ops";
import { emptyProject } from "../electron/core/project";
import { ProjectStore } from "../electron/core/store";
import type { Asset, MediaClip, ProjectData } from "../electron/core/types";

const run = promisify(execFile);
const video: Asset = {
	id: "a_v",
	kind: "video",
	name: "v.mp4",
	path: "media/v.mp4",
	durationMs: 10000,
	width: 1280,
	height: 720,
	hasAudio: true,
	origin: "import",
	createdAt: "",
	actor: "user",
};
const music: Asset = {
	id: "a_m",
	kind: "audio",
	name: "m.wav",
	path: "/abs/m.wav",
	durationMs: 60000,
	width: 0,
	height: 0,
	hasAudio: true,
	origin: "import",
	createdAt: "",
	actor: "user",
};

function sample(): ProjectData {
	let data = emptyProject("Demo & <test>");
	data = applyOp(data, { type: "addAsset", asset: video }).data;
	data = applyOp(data, { type: "addAsset", asset: music }).data;
	data = applyOp(data, {
		type: "addClips",
		clips: [
			{ type: "media", trackId: "V1", assetId: video.id, startMs: 0, durationMs: 4000, inMs: 1000 },
			{
				type: "media",
				trackId: "V1",
				assetId: video.id,
				startMs: 6000,
				durationMs: 2000,
				inMs: 0,
				speed: 2,
				volume: 0.5,
			},
			{ type: "media", trackId: "A2", assetId: music.id, startMs: 0, durationMs: 8000, inMs: 0 },
			{ type: "text", trackId: "T1", startMs: 500, durationMs: 2000, text: "Hello" },
		],
	}).data;
	return applyOp(data, { type: "addMarker", atMs: 1000, label: "Check" }).data;
}

describe("timeline interchange", () => {
	it("round-trips through OpenTimelineIO", () => {
		const data = sample();
		const otio = JSON.parse(toOtio(data, "/proj"));
		expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
		// Bottom video track first, plus a linked audio track for V1's sound.
		const kinds = otio.tracks.children.map((t: { kind: string }) => t.kind);
		expect(kinds.filter((k: string) => k === "Video")).toHaveLength(2);
		const back = fromOtio(otio, "/proj");
		const v1 = back.tracks.find((t) => t.name === data.tracks.find((d) => d.id === "V1")?.name);
		const clips = v1?.clips as Extract<
			(typeof back.tracks)[number]["clips"][number],
			{ type: "media" }
		>[];
		expect(clips.map((c) => [c.startMs, c.durationMs, c.inMs, c.speed])).toEqual([
			[0, 4000, 1000, 1],
			[6000, 2000, 0, 2],
		]);
		expect(clips[0].file).toBe("/proj/media/v.mp4");
		expect(clips[1].volume).toBe(0.5);
		// Linked audio tracks are not duplicated on the way back in.
		expect(back.tracks.filter((t) => t.kind === "audio").map((t) => t.name)).toEqual(
			data.tracks.filter((t) => t.kind === "audio").map((t) => t.name),
		);
		expect(back.tracks.find((t) => t.kind === "text")?.clips[0]).toMatchObject({
			type: "text",
			text: "Hello",
			startMs: 500,
		});
		expect(back.markers).toEqual([{ atMs: 1000, label: "Check" }]);
		// Order matches Cue: text on top, then video, then audio.
		expect(back.tracks.map((t) => t.kind)).toEqual(data.tracks.map((t) => t.kind));
	});

	it("reads OTIO from other editors (older clip schema, audio on its own track)", () => {
		const rt = (value: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: 25, value });
		const tl = {
			OTIO_SCHEMA: "Timeline.1",
			name: "Resolve",
			tracks: {
				OTIO_SCHEMA: "Stack.1",
				children: [
					{
						OTIO_SCHEMA: "Track.1",
						kind: "Video",
						name: "Video 1",
						children: [
							{ OTIO_SCHEMA: "Gap.1", source_range: { start_time: rt(0), duration: rt(25) } },
							{
								OTIO_SCHEMA: "Clip.1",
								name: "a",
								source_range: { start_time: rt(50), duration: rt(50) },
								media_reference: { OTIO_SCHEMA: "ExternalReference.1", target_url: "clips/a.mov" },
							},
						],
					},
					{ OTIO_SCHEMA: "Track.1", kind: "Audio", name: "Audio 1", children: [] },
				],
			},
		};
		const back = fromOtio(tl, "/edits");
		const clip = back.tracks[0].clips[0];
		expect(clip).toMatchObject({
			type: "media",
			file: "/edits/clips/a.mov",
			startMs: 1000,
			durationMs: 2000,
			inMs: 2000,
			volume: 0,
		});
		expect(back.fps).toBe(25);
	});

	it("writes well-formed FCPXML and MLT", async () => {
		const data = sample();
		const fcp = toFcpxml(data, "/proj");
		expect(fcp).toContain('<fcpxml version="1.10">');
		expect(fcp).toContain('offset="180/30s"'); // second clip at 6 s
		expect(fcp).toContain("<timeMap>");
		expect(fcp).toContain("Demo &amp; &lt;test&gt;");
		const mlt = toMlt(data, "/proj");
		expect(mlt).toContain('<mlt LC_NUMERIC="C"');
		expect(mlt).toContain("timewarp");
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-xml-"));
		for (const [name, text] of [
			["a.fcpxml", fcp],
			["a.mlt", mlt],
		]) {
			await fs.writeFile(path.join(dir, name), text);
			await run("xmllint", ["--noout", path.join(dir, name)]);
		}
	});

	it("writes a CMX3600 EDL", () => {
		const { text, skipped } = toEdl(sample(), "/proj");
		const events = text.split("\n").filter((l) => /^\d{3} {2}/.test(l));
		expect(events).toHaveLength(3);
		expect(events[0]).toContain("B     C        00:00:01:00 00:00:05:00 00:00:00:00 00:00:04:00");
		expect(text).toContain("M2   AX");
		expect(skipped).toEqual([sample().tracks.find((t) => t.id === "T1")?.name]);
	});
});

describe("project files and library", () => {
	it("imports an OTIO timeline into a project as one undo step, and saves as .cueproj", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-otio-"));
		const media = path.join(dir, "clip.mp4");
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"testsrc=size=320x180:rate=30:duration=4",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=4",
			"-shortest",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			media,
		]);
		const store = new ProjectStore({
			mediaUrl: (f) => `cue-media://${f}`,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: path.join(dir, "One") });
		expect(store.filePath?.endsWith("one.cueproj")).toBe(true);
		const rt = (value: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: 30, value });
		await fs.writeFile(
			path.join(dir, "in.otio"),
			JSON.stringify({
				OTIO_SCHEMA: "Timeline.1",
				name: "X",
				tracks: {
					OTIO_SCHEMA: "Stack.1",
					children: [
						{
							OTIO_SCHEMA: "Track.1",
							kind: "Video",
							name: "Cam",
							children: [
								{
									OTIO_SCHEMA: "Clip.2",
									name: "c",
									source_range: { start_time: rt(30), duration: rt(60) },
									media_references: {
										DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", target_url: "clip.mp4" },
									},
									active_media_reference_key: "DEFAULT_MEDIA",
								},
							],
						},
					],
				},
			}),
		);
		const before = store.current.clips.length;
		const result = await store.importTimeline(path.join(dir, "in.otio"), "user");
		expect(result).toMatchObject({ tracks: 1, clips: 1, missing: [] });
		const clip = store.current.clips.find((c) => c.type === "media") as MediaClip;
		expect([clip.startMs, clip.durationMs, clip.inMs]).toEqual([0, 2000, 1000]);
		store.undo("user");
		expect(store.current.clips.length).toBe(before);
		expect(store.current.tracks.some((t) => t.name === "Cam")).toBe(false);

		// Save As keeps media links working from the new folder.
		store.redo("user");
		const copy = await store.saveAs(path.join(dir, "elsewhere", "Two"));
		expect(copy.endsWith("Two.cueproj")).toBe(true);
		// Outside the new project folder, so the link becomes absolute.
		expect(store.current.assets[0].path).toBe(media);
		await store.flush();

		const found = await scanProjects(dir);
		expect(found.sort()).toEqual(
			[path.join(dir, "elsewhere", "Two.cueproj"), path.join(dir, "One", "one.cueproj")].sort(),
		);
		const summary = await summarise(copy, (f) => f);
		expect(summary).toMatchObject({ exists: true, durationMs: 2000, clipCount: 1 });
	}, 30000);
});
