import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { motionRenderSize, type TextRender } from "../electron/core/exporter";
import { ffmpeg, ffmpegPath } from "../electron/core/media";
import {
	applyMotion,
	type LottieJson,
	motionDurationMs,
	motionFrameAt,
	motionInfo,
} from "../electron/core/motion";
import { readMotionFile, readZip } from "../electron/core/motionFile";
import { ProjectStore } from "../electron/core/store";
import type { MediaClip, TextClip } from "../electron/core/types";

const run = promisify(execFile);

/** A small After Effects-style export: a title, a precomp with a text layer, fills, a gradient, a solid. */
function sample(): LottieJson {
	const text = (nm: string, t: string) => ({
		ty: 5,
		nm,
		ks: {},
		t: { d: { k: [{ t: 0, s: { t, s: 40, f: "Inter", fc: [1, 1, 1] } }] } },
	});
	return {
		v: "5.12.1",
		fr: 30,
		ip: 0,
		op: 90,
		w: 1920,
		h: 1080,
		layers: [
			text("Title", "Hello\rworld"),
			{ ty: 0, nm: "Card", refId: "comp_0", ks: {} },
			{ ty: 1, nm: "Bg", sc: "#1A2B3C", ks: {} },
		],
		assets: [
			{
				id: "comp_0",
				layers: [
					text("Title", "Second"),
					{
						ty: 4,
						nm: "Shape",
						shapes: [
							{
								ty: "gr",
								it: [
									{ ty: "fl", c: { a: 0, k: [1, 0, 0, 1] } },
									{
										ty: "st",
										c: {
											a: 1,
											k: [
												{ t: 0, s: [1, 0, 0, 1] },
												{ t: 30, s: [0, 0, 1, 1] },
											],
										},
									},
								],
							},
							{ ty: "gf", g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] } } },
						],
					},
				],
			},
		],
		markers: [{ tm: 60, cm: "outro", dr: 30 }],
	};
}

describe("motion graphics: reading", () => {
	it("finds text layers (precomps too, numbered when names repeat), colours and markers", () => {
		const info = motionInfo(sample());
		expect(info.texts.map((t) => [t.id, t.text])).toEqual([
			["Title", "Hello\nworld"],
			["Title 2", "Second"],
		]);
		expect(info.texts[1].comp).toBe("comp_0");
		// Red is used most (fill, stroke key, gradient stop).
		expect(info.colors[0]).toBe("#ff0000");
		expect(info.colors).toEqual(
			expect.arrayContaining(["#ffffff", "#0000ff", "#1a2b3c", "#ff0000"]),
		);
		expect(info.markers).toEqual([{ name: "outro", startMs: 2000, durationMs: 1000 }]);
		expect(motionDurationMs(info)).toBe(3000);
	});

	it("rewrites text and swaps colours in a copy, leaving the file alone", () => {
		const doc = sample();
		const out = applyMotion(doc, {
			text: { "Title 2": "Changed\nlines" },
			colors: { "#ff0000": "#00ffff", "#1a2b3c": "#ffffff" },
		});
		expect(out.assets[0].layers[0].t.d.k[0].s.t).toBe("Changed\rlines");
		expect(out.layers[0].t.d.k[0].s.t).toBe("Hello\rworld");
		const shape = out.assets[0].layers[1].shapes;
		expect(shape[0].it[0].c.k).toEqual([0, 1, 1, 1]);
		expect(shape[0].it[1].c.k[0].s).toEqual([0, 1, 1, 1]);
		expect(shape[1].g.k.k.slice(0, 4)).toEqual([0, 0, 1, 1]);
		expect(out.layers[2].sc).toBe("#ffffff");
		// The original is untouched, and no changes means the same document.
		expect(doc.assets[0].layers[1].shapes[0].it[0].c.k).toEqual([1, 0, 0, 1]);
		expect(applyMotion(doc, {})).toBe(doc);
	});

	it("reads .lottie archives and puts their pictures inside the animation", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-lottie-"));
		const doc = {
			...sample(),
			assets: [...sample().assets, { id: "img_0", w: 2, h: 2, u: "/images/", p: "dot.png", e: 0 }],
		};
		const png = Buffer.from("89504e470d0a1a0a", "hex");
		const file = path.join(dir, "card.lottie");
		await fs.writeFile(
			file,
			zip({
				"manifest.json": Buffer.from(JSON.stringify({ animations: [{ id: "card" }] })),
				"animations/card.json": Buffer.from(JSON.stringify(doc)),
				"images/dot.png": png,
			}),
		);
		expect([...readZip(await fs.readFile(file)).keys()]).toContain("images/dot.png");
		const read = await readMotionFile(file);
		const image = read.assets.find((a: LottieJson) => a.id === "img_0");
		expect(image.p).toBe(`data:image/png;base64,${png.toString("base64")}`);
		expect(image.e).toBe(1);
		// Plain JSON saved with a .lottie name reads too; other JSON is refused.
		await fs.writeFile(path.join(dir, "plain.lottie"), JSON.stringify(sample()));
		expect((await readMotionFile(path.join(dir, "plain.lottie"))).w).toBe(1920);
		await fs.writeFile(path.join(dir, "other.json"), JSON.stringify({ hello: 1 }));
		await expect(readMotionFile(path.join(dir, "other.json"))).rejects.toThrow(/not a Lottie/);
	});
});

describe("motion graphics: time", () => {
	const info = { fps: 30, inFrame: 0, outFrame: 90, markers: [] };
	const clip = { inMs: 0, speed: 1, durationMs: 6000 };

	it("plays, then holds the last frame", () => {
		expect(motionFrameAt(info, clip, 1000)).toBeCloseTo(30);
		expect(motionFrameAt(info, clip, 5000)).toBe(89);
	});

	it("loops when asked", () => {
		expect(motionFrameAt(info, { ...clip, motion: { loop: true } }, 4000)).toBeCloseTo(30);
	});

	it("holds before an outro marker and plays the outro as the clip ends", () => {
		const withOutro = { ...info, markers: [{ name: "outro", startMs: 2000, durationMs: 1000 }] };
		// A 6 s clip: intro 0–2 s, hold until 5 s, outro 5–6 s.
		expect(motionFrameAt(withOutro, clip, 1000)).toBeCloseTo(30);
		expect(motionFrameAt(withOutro, clip, 4000)).toBeCloseTo(59);
		expect(motionFrameAt(withOutro, clip, 5500)).toBeCloseTo(75);
		// A clip as long as the animation just plays it.
		expect(motionFrameAt(withOutro, { ...clip, durationMs: 3000 }, 2500)).toBeCloseTo(75);
	});
});

describe("motion graphics in a project", () => {
	it("imports, edits per clip, runs past its end and exports", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-motion-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Motion" });
		const source = path.join(dir, "download", "lower-third.json");
		await fs.mkdir(path.dirname(source), { recursive: true });
		await fs.writeFile(source, JSON.stringify({ ...sample(), w: 320, h: 180 }));
		const [asset] = await store.importMedia([source], "user");
		expect(asset.kind).toBe("lottie");
		expect(asset.durationMs).toBe(3000);
		// The project keeps its own copy.
		expect(asset.path).toMatch(/^graphics\//);
		await fs.rm(path.dirname(source), { recursive: true });

		store.apply({ type: "updateSettings", settings: { separateAudio: false } } as never, "user");
		store.apply(
			{ type: "setCanvas", canvas: { width: 320, height: 180, fps: 10 } } as never,
			"user",
		);
		const { created } = store.apply(
			{
				type: "addClips",
				clips: [{ type: "media", trackId: "V1", assetId: asset.id, startMs: 0, durationMs: 5000 }],
			},
			"user",
		);
		const id = created?.[0] as string;
		let clip = store.current.clips.find((c) => c.id === id) as MediaClip;
		// Unlike video, a graphic may run past its end (it holds or loops).
		expect(clip.durationMs).toBe(5000);

		const patch = (motion: unknown) =>
			store.apply({ type: "updateClip", id, patch: { motion } } as never, "user");
		patch({ text: { Title: "Breaking" }, colors: { "#FF0000": "#00ff00" } });
		patch({ text: { "Title 2": "News" }, loop: true });
		clip = store.current.clips.find((c) => c.id === id) as MediaClip;
		expect(clip.motion).toEqual({
			loop: true,
			text: { Title: "Breaking", "Title 2": "News" },
			colors: { "#ff0000": "#00ff00" },
		});
		// "" drops a text change; a colour mapped to itself drops the swap; null clears.
		patch({ text: { Title: "" }, colors: { "#ff0000": "#ff0000" } });
		clip = store.current.clips.find((c) => c.id === id) as MediaClip;
		expect(clip.motion).toEqual({ loop: true, text: { "Title 2": "News" } });
		patch(null);
		clip = store.current.clips.find((c) => c.id === id) as MediaClip;
		expect(clip.motion).toBeUndefined();
		expect(() =>
			store.apply(
				{
					type: "addClips",
					clips: [{ type: "media", trackId: "A1", assetId: asset.id, startMs: 0 }],
				},
				"user",
			),
		).toThrow(/audio track/);

		// Drawn as big as it appears: a 320×180 graphic filling a 320×180 frame at scale 2.
		expect(
			motionRenderSize(asset, { ...clip, transform: { ...clip.transform, scale: 2 } }, 320, 180),
		).toEqual({
			width: 640,
			height: 360,
		});

		// The window draws the frames; here ffmpeg stands in with solid green frames.
		const requested: { clips: string[]; sizes?: Record<string, unknown> } = { clips: [] };
		const renderText = async (
			clips: (TextClip | MediaClip)[],
			_canvas?: { width: number; height: number },
			sizes?: Record<string, { width: number; height: number }>,
		) => {
			requested.clips = clips.map((c) => c.id);
			requested.sizes = sizes;
			const out: Record<string, TextRender> = {};
			for (const c of clips) {
				const size = sizes?.[c.id];
				if (!size) continue;
				const frames = path.join(dir, `frames-${c.id}`);
				await fs.mkdir(frames, { recursive: true });
				await ffmpeg([
					"-f",
					"lavfi",
					"-i",
					`color=c=0x00ff00:s=${size.width}x${size.height}:r=10:d=5,format=rgba`,
					path.join(frames, "%05d.png"),
				]);
				out[c.id] = { kind: "sequence", pattern: path.join(frames, "%05d.png"), fps: 10 };
			}
			return out;
		};
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "draft" } } as never,
			"user",
		);
		const report = await store.export("video", "motion.mp4", "user", renderText);
		expect(requested.clips).toEqual([id]);
		expect(requested.sizes?.[id]).toEqual({ width: 320, height: 180 });
		const { stdout } = await run(
			ffmpegPath(),
			[
				"-v",
				"error",
				"-ss",
				"4",
				"-i",
				report.outputs[0],
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
		const i = (90 * 320 + 160) * 3;
		expect(stdout[i + 1]).toBeGreaterThan(200);
		expect(stdout[i]).toBeLessThan(60);
	}, 120000);
});

/** A zip archive (deflated entries), as .lottie files are. */
function zip(files: Record<string, Buffer>): Buffer {
	const locals: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const [name, data] of Object.entries(files)) {
		const packed = deflateRawSync(data);
		const n = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(packed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(n.length, 26);
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50, 0);
		entry.writeUInt16LE(20, 4);
		entry.writeUInt16LE(20, 6);
		entry.writeUInt16LE(8, 10);
		entry.writeUInt32LE(packed.length, 20);
		entry.writeUInt32LE(data.length, 24);
		entry.writeUInt16LE(n.length, 28);
		entry.writeUInt32LE(offset, 42);
		locals.push(local, n, packed);
		central.push(entry, n);
		offset += 30 + n.length + packed.length;
	}
	const dir = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(dir.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, dir, end]);
}
