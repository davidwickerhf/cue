import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { ffmpeg, ffmpegPath } from "../electron/core/media";
import { ProjectStore } from "../electron/core/store";
import type { MediaClip } from "../electron/core/types";

const run = promisify(execFile);

/** RGB of one pixel of the frame at `sec`. */
async function pixel(file: string, sec: number, x: number, y: number, w: number) {
	const { stdout } = await run(
		ffmpegPath(),
		[
			"-v",
			"error",
			"-ss",
			String(sec),
			"-i",
			file,
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ encoding: "buffer", maxBuffer: 1 << 26 },
	);
	const i = (y * w + x) * 3;
	return [stdout[i], stdout[i + 1], stdout[i + 2]];
}

describe("compositing", () => {
	it("keys a green screen, masks it and grades it with an adjustment layer", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-comp-"));
		const green = path.join(dir, "green.mp4");
		const blue = path.join(dir, "blue.mp4");
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"color=c=0x00ff00:s=320x180:r=30:d=6",
			"-vf",
			"drawbox=x=140:y=70:w=40:h=40:color=red:t=fill,drawbox=x=0:y=0:w=30:h=30:color=yellow:t=fill",
			"-pix_fmt",
			"yuv420p",
			green,
		]);
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:s=320x180:r=30:d=6",
			"-pix_fmt",
			"yuv420p",
			blue,
		]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Comp" });
		store.apply({ type: "setCanvas", canvas: { width: 320, height: 180 } }, "user");
		const [fg, bg] = await store.importMedia([green, blue], "user");
		const top = store.apply({ type: "addTrack", kind: "video", name: "Top", index: 0 }, "user")
			.created?.[0] as string;
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: bg.id, startMs: 0, durationMs: 6000 },
					{ type: "media", trackId: top, assetId: fg.id, startMs: 0, durationMs: 6000 },
				],
			},
			"user",
		);
		const clip = store.current.clips.find(
			(c) => c.type === "media" && c.assetId === fg.id,
		) as MediaClip;
		store.apply(
			{
				type: "updateClip",
				id: clip.id,
				patch: {
					key: { color: "#00ff00" },
					mask: { shape: "ellipse", width: 0.6, height: 0.6, feather: 0.05 },
				},
			},
			"user",
		);
		store.apply({ type: "addAdjustment", startMs: 2000, durationMs: 2000 }, "user");
		const adj = store.current.clips.find(
			(c) => c.type === "media" && c.assetId === "a_adjust",
		) as MediaClip;
		store.apply({ type: "updateClip", id: adj.id, patch: { color: { saturation: 0 } } }, "user");
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "high" } },
			"user",
		);
		const out = (await store.export("video", "out.mp4", "user")).outputs[0];

		const isBlue = ([r, g, b]: number[]) => b > 150 && r < 80 && g < 80;
		const isRed = ([r, g, b]: number[]) => r > 150 && g < 80 && b < 80;
		// The keyed green lets the blue background through; the red box stays.
		expect(isBlue(await pixel(out, 1, 100, 90, 320))).toBe(true);
		expect(isRed(await pixel(out, 1, 160, 90, 320))).toBe(true);
		// Outside the mask the foreground is gone as well.
		expect(isBlue(await pixel(out, 1, 5, 5, 320))).toBe(true);
		// Under the adjustment layer the red box turns grey.
		const [r, g, b] = await pixel(out, 3, 160, 90, 320);
		expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(25);
		// And after it, colour is back.
		expect(isRed(await pixel(out, 5, 160, 90, 320))).toBe(true);
	}, 90000);

	it("animates keyframes over time and exports adjustment layers with audio", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-kf-"));
		const box = path.join(dir, "box.mp4");
		const tone = path.join(dir, "tone.wav");
		await ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=40x40:r=30:d=5", "-pix_fmt", "yuv420p", box]);
		await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=5", tone]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Keyframes" });
		store.apply({ type: "setCanvas", canvas: { width: 320, height: 180 } }, "user");
		const [pic, sound] = await store.importMedia([box, tone], "user");
		const audioTrack = store.current.tracks.find((t) => t.kind === "audio")?.id as string;
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: pic.id, startMs: 0, durationMs: 5000 },
					{ type: "media", trackId: audioTrack, assetId: sound.id, startMs: 0, durationMs: 5000 },
				],
			},
			"user",
		);
		const clip = store.current.clips.find(
			(c) => c.type === "media" && c.assetId === pic.id,
		) as MediaClip;
		store.apply({ type: "updateClip", id: clip.id, patch: { transform: { scale: 0.25 } } }, "user");
		for (const [atMs, value] of [
			[0, 0.2],
			[4000, 0.8],
		])
			store.apply(
				{
					type: "setKeyframe",
					clipId: clip.id,
					prop: "x",
					keyframe: { atMs, value, ease: "linear" },
				},
				"user",
			);
		store.apply({ type: "addAdjustment", startMs: 0, durationMs: 1000 }, "user");
		const adj = store.current.clips.find(
			(c) => c.type === "media" && c.assetId === "a_adjust",
		) as MediaClip;
		store.apply({ type: "updateClip", id: adj.id, patch: { color: { saturation: 0 } } }, "user");
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "high" } },
			"user",
		);
		const out = (await store.export("video", "out.mp4", "user")).outputs[0];
		const isRed = ([r, g, b]: number[]) => r > 150 && g < 80 && b < 80;
		// Halfway through the move the box is in the middle, not already at the end.
		expect(isRed(await pixel(out, 2, 160, 90, 320))).toBe(true);
		expect(isRed(await pixel(out, 2, 256, 90, 320))).toBe(false);
		expect(isRed(await pixel(out, 4.5, 256, 90, 320))).toBe(true);
		// The export has sound as well.
		const probe = await run(ffmpegPath(), ["-i", out, "-hide_banner"]).catch((e) => e);
		expect(String(probe.stderr)).toContain("Audio:");
	}, 90000);

	it("exports blur, sharpen, vignette, glow and stabilisation", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-fx-"));
		const src = path.join(dir, "src.mp4");
		// A white frame with a black square, moving a little (something to stabilise).
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"color=c=white:s=320x180:r=30:d=3",
			"-vf",
			"drawbox=x='120+3*sin(t*9)':y=60:w=80:h=60:color=black:t=fill",
			"-pix_fmt",
			"yuv420p",
			src,
		]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Effects" });
		store.apply({ type: "setCanvas", canvas: { width: 320, height: 180 } }, "user");
		const [asset] = await store.importMedia([src], "user");
		store.apply(
			{
				type: "addClips",
				clips: [{ type: "media", trackId: "V1", assetId: asset.id, startMs: 0, durationMs: 3000 }],
			},
			"user",
		);
		const clip = store.current.clips.find((c) => c.type === "media") as MediaClip;
		store.apply(
			{
				type: "updateClip",
				id: clip.id,
				patch: { effects: { blur: 1, sharpen: 0.2, glow: 0.3, stabilize: true } },
			},
			"user",
		);
		store.apply({ type: "addAdjustment", startMs: 0, durationMs: 3000 }, "user");
		const adj = store.current.clips.find(
			(c) => c.type === "media" && c.assetId === "a_adjust",
		) as MediaClip;
		store.apply({ type: "updateClip", id: adj.id, patch: { effects: { vignette: 1 } } }, "user");
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "high" } },
			"user",
		);
		const out = (await store.export("video", "fx.mp4", "user")).outputs[0];
		// Blurred edges of the square: some pixels across it are neither white nor black.
		const across = await Promise.all(
			[108, 112, 116, 120, 124, 128, 132].map(async (x) => (await pixel(out, 1.5, x, 90, 320))[0]),
		);
		expect(across.filter((v) => v > 40 && v < 215).length).toBeGreaterThan(1);
		// The vignette darkens the corners of the white frame.
		const [corner] = await pixel(out, 1.5, 2, 2, 320);
		const [middle] = await pixel(out, 1.5, 60, 90, 320);
		expect(corner).toBeLessThan(middle - 20);
		// Turning every effect off leaves no effects object.
		store.apply(
			{
				type: "updateClip",
				id: adj.id,
				patch: { effects: { vignette: 0 } },
			},
			"user",
		);
		expect((store.current.clips.find((c) => c.id === adj.id) as MediaClip).effects).toBeUndefined();
	}, 90000);
});
