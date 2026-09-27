import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { ffmpeg, ffmpegPath } from "../electron/core/media";
import { ProjectStore } from "../electron/core/store";

const run = promisify(execFile);

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

describe("looks: blend modes and grain", () => {
	it("multiplies a texture over the picture below, and grains an adjustment layer", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-look-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Look" });
		const img = async (name: string, color: string) => {
			const file = path.join(dir, `${name}.png`);
			await ffmpeg(["-f", "lavfi", "-i", `color=c=${color}:s=320x180`, "-frames:v", "1", file]);
			return file;
		};
		const [red, grey] = await store.importMedia(
			[await img("red", "0xff0000"), await img("grey", "0x808080")],
			"user",
		);
		store.apply(
			{ type: "setCanvas", canvas: { width: 320, height: 180, fps: 10 } } as never,
			"user",
		);
		const top = store.apply({ type: "addTrack", kind: "video", name: "Texture" } as never, "user")
			.created?.[0] as string;
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: red.id, startMs: 0, durationMs: 2000 },
					{
						type: "media",
						trackId: top,
						assetId: grey.id,
						startMs: 0,
						durationMs: 1000,
						blend: "multiply",
					},
				],
			} as never,
			"user",
		);
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "draft" } } as never,
			"user",
		);
		const out = (await store.export("video", "look.mp4", "user")).outputs[0];
		// Multiplied: red times middle grey is a darker red, not grey.
		const [r, g, b] = await pixel(out, 0.5, 160, 90, 320);
		expect(r).toBeGreaterThan(100);
		expect(r).toBeLessThan(160);
		expect(Math.max(g, b)).toBeLessThan(40);
		// Once the texture ends, the red is back in full.
		expect((await pixel(out, 1.5, 160, 90, 320))[0]).toBeGreaterThan(220);

		// Grain on an adjustment layer: neighbouring pixels of a flat colour now differ.
		store.apply(
			{ type: "addAdjustment", trackId: top, startMs: 0, durationMs: 2000 } as never,
			"user",
		);
		const adj = store.current.clips.find(
			(c) => c.trackId === top && c.startMs === 0 && c.durationMs === 2000,
		);
		store.apply(
			{ type: "updateClip", id: adj?.id, patch: { effects: { grain: 1 } } } as never,
			"user",
		);
		const grained = (await store.export("video", "grain.mp4", "user")).outputs[0];
		const row = await Promise.all(
			[10, 11, 12, 13, 14, 15].map((x) => pixel(grained, 1.5, x, 90, 320)),
		);
		expect(new Set(row.map((p) => p[0])).size).toBeGreaterThan(1);
	}, 120000);
});
