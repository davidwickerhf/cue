import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { seedOf, steppedMs, wiggleAt } from "../electron/core/anim";
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

describe("hand-made motion", () => {
	it("wiggles the same way every time, within its size, and steps time", () => {
		const w = { position: 10, rotation: 2, speed: 1 };
		const seed = seedOf("c_abc");
		expect(wiggleAt(w, seed, 1234)).toEqual(wiggleAt(w, seed, 1234));
		const samples = Array.from({ length: 200 }, (_, i) => wiggleAt(w, seed, i * 37));
		expect(Math.max(...samples.map((p) => Math.abs(p.x)))).toBeLessThanOrEqual(10);
		expect(Math.max(...samples.map((p) => Math.abs(p.rotation)))).toBeLessThanOrEqual(2);
		expect(new Set(samples.map((p) => p.x.toFixed(3))).size).toBeGreaterThan(50);
		// On twos: every time within one 12 fps step holds the same value.
		expect(steppedMs(90, 12)).toBe(83.33333333333333);
		expect(steppedMs(160, 12)).toBe(steppedMs(90, 12));
		expect(steppedMs(160, undefined)).toBe(160);
	});

	it("turns a picture in export, and fades it with opacity keyframes", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-turn-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Turn" });
		const file = path.join(dir, "white.png");
		await ffmpeg(["-f", "lavfi", "-i", "color=c=white:s=160x160", "-frames:v", "1", file]);
		const [white] = await store.importMedia([file], "user");
		store.apply(
			{
				type: "setCanvas",
				canvas: { width: 320, height: 320, fps: 10, background: "#000000" },
			} as never,
			"user",
		);
		store.apply(
			{
				type: "addClips",
				clips: [
					{
						type: "media",
						trackId: "V1",
						assetId: white.id,
						startMs: 0,
						durationMs: 2000,
						transform: { scale: 0.5, rotation: 45 },
						keyframes: {
							opacity: [
								{ atMs: 1000, value: 1, ease: "linear" },
								{ atMs: 2000, value: 0, ease: "linear" },
							],
						},
					},
				],
			} as never,
			"user",
		);
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "draft" } } as never,
			"user",
		);
		const out = (await store.export("video", "turn.mp4", "user")).outputs[0];
		// A square 160 px wide turned 45° reaches 113 px from the centre along the axes, but its corners are cut.
		expect((await pixel(out, 0.5, 160, 160 - 100, 320))[0]).toBeGreaterThan(200);
		expect((await pixel(out, 0.5, 160 - 75, 160 - 75, 320))[0]).toBeLessThan(40);
		// Half-way through the fade it is about half as bright.
		const mid = (await pixel(out, 1.5, 160, 160, 320))[0];
		expect(mid).toBeGreaterThan(80);
		expect(mid).toBeLessThan(180);
	}, 120000);
});
