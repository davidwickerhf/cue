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
});
