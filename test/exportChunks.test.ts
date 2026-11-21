import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { chunkWindows, exportsInChunks } from "../electron/core/exporter";
import { ffmpeg, ffmpegPath, probe } from "../electron/core/media";
import { ProjectStore } from "../electron/core/store";
import type { MediaClip } from "../electron/core/types";

const run = promisify(execFile);

/** The frame at `sec` as RGB bytes. */
async function frame(file: string, sec: number, w: number, h: number): Promise<Buffer> {
	const { stdout } = await run(
		ffmpegPath(),
		["-v", "error", "-ss", String(sec), "-i", file, "-frames:v", "1", "-s", `${w}x${h}`].concat([
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		]),
		{ encoding: "buffer", maxBuffer: 1 << 26 },
	);
	return stdout;
}

const meanDiff = (a: Buffer, b: Buffer) => {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
	return sum / a.length;
};

/** Horizontal centre of the red pixels in a frame. */
function redCentre(rgb: Buffer, w: number): number {
	let sum = 0;
	let count = 0;
	for (let i = 0; i < rgb.length; i += 3) {
		if (rgb[i] > 170 && rgb[i + 1] < 70 && rgb[i + 2] < 70) {
			sum += (i / 3) % w;
			count++;
		}
	}
	return count ? sum / count : -1;
}

describe("exports in chunks", () => {
	it("splits frames into whole windows", () => {
		expect(chunkWindows(0, 1300, 600)).toEqual([
			{ first: 0, frames: 600 },
			{ first: 600, frames: 600 },
			{ first: 1200, frames: 100 },
		]);
		expect(chunkWindows(450, 600, 600)).toEqual([{ first: 450, frames: 150 }]);
		expect(exportsInChunks(10, 30000)).toBe(false);
		expect(exportsInChunks(10, 70000)).toBe(true);
		expect(exportsInChunks(200, 30000)).toBe(true);
	});

	/** A 320×180 project in a new folder, with a 72 s tone on its audio track. */
	async function project(name: string) {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-chunks-test-"));
		const tone = path.join(dir, "tone.wav");
		await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=72", tone]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name });
		store.apply({ type: "setCanvas", canvas: { width: 320, height: 180 } }, "user");
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "high" } },
			"user",
		);
		const [sound] = await store.importMedia([tone], "user");
		const audioTrack = store.current.tracks.find((t) => t.kind === "audio")?.id as string;
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: audioTrack, assetId: sound.id, startMs: 0, durationMs: 70000 },
				],
			},
			"user",
		);
		return { dir, store };
	}

	it("keeps video in time with its source across the seams, with its sound", async () => {
		const { dir, store } = await project("Video");
		const source = path.join(dir, "source.mp4");
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"testsrc2=s=320x180:r=30:d=72",
			"-pix_fmt",
			"yuv420p",
			source,
		]);
		const [video] = await store.importMedia([source], "user");
		store.apply(
			{
				type: "addClips",
				// Read from 2 s into its source, so every seam lands mid-source.
				clips: [
					{
						type: "media",
						trackId: "V1",
						assetId: video.id,
						startMs: 0,
						durationMs: 70000,
						inMs: 2000,
					},
				],
			},
			"user",
		);
		const out = (await store.export("video", "out.mp4", "user")).outputs[0];
		const info = await probe(out);
		expect(info.durationMs).toBeGreaterThan(69800);
		expect(info.durationMs).toBeLessThan(70300);
		const audio = await run(ffmpegPath(), [
			"-v",
			"error",
			"-i",
			out,
			"-map",
			"0:a",
			"-f",
			"null",
			"-",
		]);
		expect(audio.stderr).toBe("");
		for (const sec of [19.5, 20.1, 39.9, 40.1, 60.2]) {
			const got = await frame(out, sec, 320, 180);
			// Matches the source at the same moment, and not a moment a frame or more away.
			expect(meanDiff(got, await frame(source, sec + 2, 320, 180))).toBeLessThan(6);
			expect(meanDiff(got, await frame(source, sec + 2.5, 320, 180))).toBeGreaterThan(6);
		}
	}, 180000);

	it("keeps keyframed pictures on their path across the seams", async () => {
		const { dir, store } = await project("Keyframes");
		const box = path.join(dir, "box.png");
		await ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=40x40", "-frames:v", "1", box]);
		const [picture] = await store.importMedia([box], "user");
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: picture.id, startMs: 15000, durationMs: 30000 },
				],
			},
			"user",
		);
		const moving = store.current.clips.find(
			(c) => c.type === "media" && c.assetId === picture.id,
		) as MediaClip;
		store.apply(
			{ type: "updateClip", id: moving.id, patch: { transform: { scale: 0.25 } } },
			"user",
		);
		// Across two seams (20 s and 40 s): x from 0.2 to 0.8, linear, over the clip's 30 s.
		for (const [atMs, value] of [
			[0, 0.2],
			[30000, 0.8],
		])
			store.apply(
				{
					type: "setKeyframe",
					clipId: moving.id,
					prop: "x",
					keyframe: { atMs, value, ease: "linear" },
				},
				"user",
			);
		const out = (await store.export("video", "out.mp4", "user")).outputs[0];
		for (const sec of [16, 19.9, 20.1, 30, 39.9, 40.1, 44]) {
			const expected = (0.2 + (0.6 * (sec - 15)) / 30) * 320;
			expect(Math.abs(redCentre(await frame(out, sec, 320, 180), 320) - expected)).toBeLessThan(3);
		}
		// Gone once the clip has ended.
		expect(redCentre(await frame(out, 50, 320, 180), 320)).toBe(-1);
	}, 180000);

	it("keeps an adjustment layer's vignette in chunks that start inside it", async () => {
		const { dir, store } = await project("Look");
		const white = path.join(dir, "white.png");
		await ffmpeg(["-f", "lavfi", "-i", "color=c=white:s=320x180", "-frames:v", "1", white]);
		const [picture] = await store.importMedia([white], "user");
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: picture.id, startMs: 0, durationMs: 70000 },
				],
			},
			"user",
		);
		// From 5 s to the end: every chunk after the first starts inside it.
		store.apply({ type: "addAdjustment", startMs: 5000, durationMs: 65000 }, "user");
		const look = store.current.clips.find(
			(c) => c.type === "media" && c.assetId === "a_adjust",
		) as MediaClip;
		store.apply({ type: "updateClip", id: look.id, patch: { effects: { vignette: 0.8 } } }, "user");
		const out = (await store.export("video", "out.mp4", "user")).outputs[0];
		const brightness = (rgb: Buffer, x: number, y: number) => {
			const i = (y * 320 + x) * 3;
			return (rgb[i] + rgb[i + 1] + rgb[i + 2]) / 3;
		};
		// Before it: plain white corners.
		expect(brightness(await frame(out, 2, 320, 180), 3, 3)).toBeGreaterThan(240);
		for (const sec of [10, 25, 45, 65]) {
			const rgb = await frame(out, sec, 320, 180);
			expect(brightness(rgb, 3, 3)).toBeLessThan(brightness(rgb, 160, 90) - 30);
		}
	}, 180000);
});
