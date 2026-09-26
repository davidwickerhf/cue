import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	checkCaptureOptions,
	mp4Args,
	mp4Name,
	planPlacement,
	recordingFiles,
	recordingStamp,
} from "../electron/core/capture";
import { ffmpeg } from "../electron/core/media";
import { ProjectStore } from "../electron/core/store";
import type { Clip, MediaClip, Track } from "../electron/core/types";

const track = (id: string, kind: Track["kind"], extra: Partial<Track> = {}): Track => ({
	id,
	kind,
	name: id,
	muted: false,
	locked: false,
	hidden: false,
	volume: 1,
	...extra,
});
const clipOn = (trackId: string, startMs: number, durationMs: number): Clip =>
	({
		id: `c_${trackId}_${startMs}`,
		type: "media",
		trackId,
		assetId: "a",
		startMs,
		durationMs,
		inMs: 0,
		speed: 1,
	}) as MediaClip;

describe("recording file names", () => {
	it("stamps names so they sort by time and have no colons", () => {
		const date = new Date(2026, 8, 6, 9, 3, 7);
		expect(recordingStamp(date)).toBe("2026-09-06 09.03.07");
		const files = recordingFiles("/p", date, { screen: true, camera: true });
		expect(files).toEqual({
			screen: "/p/recordings/2026-09-06 09.03.07 screen.webm",
			camera: "/p/recordings/2026-09-06 09.03.07 camera.webm",
		});
		expect(recordingFiles("/p", date, { screen: false, camera: true })).toEqual({
			screen: undefined,
			camera: "/p/recordings/2026-09-06 09.03.07 camera.webm",
		});
	});

	it("never reuses a name, including the converted MP4", () => {
		const date = new Date(2026, 8, 6, 9, 3, 7);
		const taken = new Set(["/p/recordings/2026-09-06 09.03.07 screen.mp4"]);
		const files = recordingFiles("/p", date, { screen: true, camera: false }, (f) => taken.has(f));
		expect(files.screen).toBe("/p/recordings/2026-09-06 09.03.07 2 screen.webm");
		expect(mp4Name(files.screen as string)).toBe("/p/recordings/2026-09-06 09.03.07 2 screen.mp4");
	});

	it("needs a screen or the camera", () => {
		expect(() =>
			checkCaptureOptions({ sourceId: null, camera: false, microphone: true, bubble: true }),
		).toThrow(/screen or window/);
		expect(() =>
			checkCaptureOptions({ sourceId: null, camera: true, microphone: false, bubble: false }),
		).not.toThrow();
	});
});

describe("conversion to MP4", () => {
	it("makes constant frame rate, even-sized H.264 with frequent keyframes", () => {
		const args = mp4Args("in.webm", "out.mp4", { fps: 30, hardware: false });
		expect(args.slice(0, 4)).toEqual(["-fflags", "+genpts", "-i", "in.webm"]);
		expect(args[args.indexOf("-vf") + 1]).toBe("scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30");
		expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
		expect(args[args.indexOf("-g") + 1]).toBe("30");
		expect(args).toContain("+faststart");
		expect(args.at(-1)).toBe("out.mp4");
		const hw = mp4Args("in.webm", "out.mp4", { fps: 29.97, hardware: true });
		expect(hw[hw.indexOf("-c:v") + 1]).toBe("h264_videotoolbox");
		expect(hw[hw.indexOf("-g") + 1]).toBe("30");
	});
});

describe("placing a recording", () => {
	const tracks = [
		track("T1", "text"),
		track("V2", "video"),
		track("V1", "video"),
		track("A1", "audio"),
	];

	it("uses the lowest free video track and the one above for the camera", () => {
		expect(planPlacement(tracks, [], 1000, { mainMs: 5000, overlayMs: 5000 })).toEqual({
			main: { trackId: "V1" },
			overlay: { trackId: "V2" },
		});
	});

	it("skips busy and locked tracks", () => {
		const clips = [clipOn("V1", 0, 3000)];
		// V1 is busy at 2 s, so the screen goes on V2 and the camera gets a new track above it.
		expect(planPlacement(tracks, clips, 2000, { mainMs: 5000, overlayMs: 5000 })).toEqual({
			main: { trackId: "V2" },
			overlay: { newTrackAt: 1 },
		});
		// After the clip ends V1 is free again.
		expect(planPlacement(tracks, clips, 3000, { mainMs: 5000 })).toEqual({
			main: { trackId: "V1" },
		});
		const locked = [track("V1", "video", { locked: true }), track("A1", "audio")];
		expect(planPlacement(locked, [], 0, { mainMs: 1000 })).toEqual({ main: { newTrackAt: 0 } });
	});

	it("makes new tracks below titles when every video track is busy", () => {
		const clips = [clipOn("V1", 0, 10000), clipOn("V2", 0, 10000)];
		expect(planPlacement(tracks, clips, 500, { mainMs: 1000, overlayMs: 1000 })).toEqual({
			main: { newTrackAt: 1 },
			overlay: { newTrackAt: 1 },
		});
		// No video tracks at all: new ones go between the titles and the sound.
		expect(
			planPlacement([track("T1", "text"), track("A1", "audio")], [], 0, { mainMs: 1000 }),
		).toEqual({ main: { newTrackAt: 1 } });
	});

	it("imports a recording as MP4 and links the camera bubble above the screen", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-capture-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Rec" });
		const files = recordingFiles(dir, new Date(), { screen: true, camera: true });
		await fs.mkdir(path.join(dir, "recordings"), { recursive: true });
		// Stand-ins for MediaRecorder's output: VP8/Opus WebM, the screen with sound.
		await ffmpeg([
			...["-f", "lavfi", "-i", "testsrc=s=641x361:r=30:d=2"],
			...["-f", "lavfi", "-i", "sine=f=440:d=2"],
			...["-c:v", "libvpx", "-c:a", "libopus", "-shortest", files.screen as string],
		]);
		await ffmpeg([
			...["-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=2"],
			...["-c:v", "libvpx", files.camera as string],
		]);
		const { assets, clipIds } = await store.addScreenRecording(
			{ main: files.screen as string, overlay: files.camera, atMs: 1000, bubble: true },
			"user",
		);
		expect(assets.map((a) => a.name)).toEqual([
			path.basename(mp4Name(files.screen as string)),
			path.basename(mp4Name(files.camera as string)),
		]);
		// Converted and the raw WebM removed; odd sizes rounded to even.
		expect(existsSync(files.screen as string)).toBe(false);
		expect(assets[0]).toMatchObject({
			width: 640,
			height: 360,
			hasAudio: true,
			origin: "recording",
		});
		expect(Math.abs(assets[0].durationMs - 2000)).toBeLessThan(150);
		const clips = clipIds.map((id) => store.current.clips.find((c) => c.id === id) as MediaClip);
		const order = store.current.tracks.map((t) => t.id);
		expect(clips.map((c) => c.startMs)).toEqual([1000, 1000]);
		// The camera is on the track right above the screen, linked, and small in the corner.
		expect(order.indexOf(clips[1].trackId)).toBe(order.indexOf(clips[0].trackId) - 1);
		expect(clips[0].groupId).toBeDefined();
		expect(clips[1].groupId).toBe(clips[0].groupId);
		expect(clips[1].transform.scale).toBeLessThan(0.5);
		expect(clips[1].transform.x).toBeGreaterThan(0.5);
		expect(clips[1].transform.y).toBeGreaterThan(0.5);
		// One undo step takes it all back.
		store.undo("user");
		expect(store.current.clips.filter((c) => clipIds.includes(c.id))).toEqual([]);
	}, 60000);
});
