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

	it("exports a GIF and sound as MP3 and AAC", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-formats-"));
		const src = path.join(dir, "src.mp4");
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"testsrc=s=320x180:r=30:d=2",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=2",
			"-pix_fmt",
			"yuv420p",
			"-shortest",
			src,
		]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Formats" });
		store.apply({ type: "setCanvas", canvas: { width: 320, height: 180 } }, "user");
		const [asset] = await store.importMedia([src], "user");
		store.apply(
			{
				type: "addClips",
				clips: [{ type: "media", trackId: "V1", assetId: asset.id, startMs: 0, durationMs: 2000 }],
			},
			"user",
		);
		const probe = async (file: string) =>
			String((await run(ffmpegPath(), ["-hide_banner", "-i", file]).catch((e) => e)).stderr);
		const gif = (await store.export("gif", "clip.gif", "user")).outputs[0];
		expect(await probe(gif)).toContain("Video: gif");
		const mp3 = (await store.export("audio", "mix.mp3", "user")).outputs[0];
		expect(await probe(mp3)).toContain("Audio: mp3");
		const m4a = (await store.export("audio", "mix.m4a", "user")).outputs[0];
		expect(await probe(m4a)).toContain("Audio: aac");
	}, 90000);

	it("splits a clip at its shot changes", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-scenes-"));
		const src = path.join(dir, "shots.mp4");
		// Three one-second shots with hard cuts at 1 s and 2 s.
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"testsrc=s=320x180:r=30:d=1",
			"-f",
			"lavfi",
			"-i",
			"mandelbrot=s=320x180:r=30",
			"-f",
			"lavfi",
			"-i",
			"smptebars=s=320x180:r=30:d=1",
			"-filter_complex",
			"[1:v]trim=duration=1,setpts=PTS-STARTPTS[m];[0:v][m][2:v]concat=n=3:v=1[v]",
			"-map",
			"[v]",
			"-pix_fmt",
			"yuv420p",
			src,
		]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Scenes" });
		const [asset] = await store.importMedia([src], "user");
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: asset.id, startMs: 500, durationMs: 3000 },
				],
			},
			"user",
		);
		const clip = store.current.clips.find((c) => c.type === "media") as MediaClip;
		const { cuts } = await store.splitAtScenes(clip.id, "user");
		// ffmpeg builds differ by a frame or so (Linux finds the first cut at 1.6 s).
		expect(cuts).toHaveLength(2);
		expect(Math.abs(cuts[0] - 1500)).toBeLessThanOrEqual(150);
		expect(Math.abs(cuts[1] - 2500)).toBeLessThanOrEqual(150);
		expect(store.current.clips.filter((c) => c.trackId === "V1")).toHaveLength(3);
		// One undo step puts it back.
		store.undo("user");
		expect(store.current.clips.filter((c) => c.trackId === "V1")).toHaveLength(1);
	}, 90000);

	it("exports wipes, slides, zoom and blur transitions", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-transitions-"));
		const red = path.join(dir, "red.mp4");
		const blue = path.join(dir, "blue.mp4");
		for (const [file, color] of [
			[red, "red"],
			[blue, "blue"],
		])
			await ffmpeg([
				"-f",
				"lavfi",
				"-i",
				`color=c=${color}:s=320x180:r=30:d=3`,
				"-pix_fmt",
				"yuv420p",
				file,
			]);
		const isRed = ([r, g, b]: number[]) => r > 150 && g < 90 && b < 90;
		const isBlue = ([r, g, b]: number[]) => b > 150 && r < 90 && g < 90;
		for (const kind of [
			"wipe-left",
			"wipe-right",
			"slide-left",
			"slide-right",
			"zoom",
			"blur",
		] as const) {
			const store = new ProjectStore({
				mediaUrl: (f) => f,
				recentFile: path.join(dir, "recent.json"),
				autoProxies: () => false,
			});
			await store.create({ path: path.join(dir, kind), name: kind });
			store.apply({ type: "setCanvas", canvas: { width: 320, height: 180 } }, "user");
			const [a, b] = await store.importMedia([red, blue], "user");
			store.apply(
				{
					type: "addClips",
					clips: [
						{ type: "media", trackId: "V1", assetId: a.id, startMs: 0, durationMs: 2000 },
						{ type: "media", trackId: "V1", assetId: b.id, startMs: 2000, durationMs: 2000 },
					],
				},
				"user",
			);
			const incoming = store.current.clips.find(
				(c) => c.type === "media" && c.assetId === b.id,
			) as MediaClip;
			store.apply(
				{ type: "addTransition", clipId: incoming.id, transition: { kind, durationMs: 1000 } },
				"user",
			);
			const moved = store.current.clips.find((c) => c.id === incoming.id) as MediaClip;
			expect(moved.startMs).toBe(1000);
			store.apply(
				{ type: "updateExport", export: { hardware: false, videoQuality: "high" } },
				"user",
			);
			const out = (await store.export("video", `${kind}.mp4`, "user")).outputs[0];
			// Halfway through (1.5 s): the incoming blue has covered half the frame.
			const leftPx = await pixel(out, 1.5, 40, 90, 320);
			const rightPx = await pixel(out, 1.5, 280, 90, 320);
			if (kind === "wipe-left" || kind === "slide-left") {
				expect(isRed(leftPx)).toBe(true);
				expect(isBlue(rightPx)).toBe(true);
			} else if (kind === "wipe-right" || kind === "slide-right") {
				expect(isBlue(leftPx)).toBe(true);
				expect(isRed(rightPx)).toBe(true);
			} else {
				// Fading in: a mix of both.
				expect(isRed(leftPx) || isBlue(leftPx)).toBe(false);
			}
			// Afterwards only the incoming clip shows.
			expect(isBlue(await pixel(out, 2.5, 160, 90, 320))).toBe(true);
		}
	}, 180000);

	it("makes vertical and shorter variants without touching the edit", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-variants-"));
		const red = path.join(dir, "red.mp4");
		const blue = path.join(dir, "blue.mp4");
		for (const [file, color] of [
			[red, "red"],
			[blue, "blue"],
		])
			await ffmpeg([
				"-f",
				"lavfi",
				"-i",
				`color=c=${color}:s=320x180:r=30:d=6`,
				"-pix_fmt",
				"yuv420p",
				file,
			]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: path.join(dir, "P"), name: "Promo" });
		store.apply({ type: "setCanvas", canvas: { width: 320, height: 180 } }, "user");
		const [a, b] = await store.importMedia([red, blue], "user");
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: a.id, startMs: 0, durationMs: 3000 },
					{ type: "media", trackId: "V1", assetId: b.id, startMs: 3000, durationMs: 5000 },
				],
			},
			"user",
		);
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "draft" } },
			"user",
		);
		const before = JSON.stringify(store.current);
		const { variants } = await store.makeVariants(
			{ aspects: ["9:16"], lengthsSec: [4], saveProjects: true },
			"user",
		);
		// The open edit is untouched.
		expect(JSON.stringify(store.current)).toBe(before);
		expect(variants).toHaveLength(1);
		const [v] = variants;
		expect(v.label).toBe("9x16 4s");
		// Ends at the last cut before 4 s (3 s), which is at least 60% of it.
		expect(v.durationMs).toBe(3000);
		const info = String(
			(await run(ffmpegPath(), ["-hide_banner", "-i", v.video as string]).catch((e) => e)).stderr,
		);
		expect(info).toContain("1080x1920");
		// The red picture fills the vertical frame (centre crop), top to bottom.
		expect((await pixel(v.video as string, 1, 540, 100, 1080))[0]).toBeGreaterThan(150);
		const saved = JSON.parse(await fs.readFile(v.project as string, "utf8"));
		expect(saved.canvas.width).toBe(1080);
	}, 120000);

	it("draws boxes, arrows, redactions and blur boxes into the export", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-overlays-"));
		const src = path.join(dir, "bars.mp4");
		// Vertical stripes: something with sharp edges to blur.
		await ffmpeg(["-f", "lavfi", "-i", "smptebars=s=320x180:r=30:d=2", "-pix_fmt", "yuv420p", src]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Overlays" });
		store.apply({ type: "setCanvas", canvas: { width: 320, height: 180 } }, "user");
		const [asset] = await store.importMedia([src], "user");
		store.apply(
			{
				type: "addClips",
				clips: [{ type: "media", trackId: "V1", assetId: asset.id, startMs: 0, durationMs: 2000 }],
			},
			"user",
		);
		const at = { startMs: 0, durationMs: 2000 };
		await store.addOverlay(
			{ kind: "redact", ...at, x: 0.2, y: 0.3, width: 0.2, height: 0.2 },
			"user",
		);
		await store.addOverlay(
			{ kind: "blur", ...at, x: 0.7, y: 0.3, width: 0.3, height: 0.3 },
			"user",
		);
		await store.addOverlay(
			{ kind: "box", ...at, x: 0.5, y: 0.75, width: 0.5, height: 0.3, color: "#ff00ff" },
			"user",
		);
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "high" } },
			"user",
		);
		const renderText = async (clips: import("../electron/core/types").TextClip[]) => {
			// Tests have no window: draw the shapes with ffmpeg instead (a box of the same place and colour).
			const out: Record<string, import("../electron/core/exporter").TextRender> = {};
			for (const c of clips) {
				if (!c.shape) continue;
				const file = path.join(dir, `${c.id}.png`);
				const w = Math.round(Math.abs(c.shape.width) * 320);
				const h = Math.round(Math.abs(c.shape.height) * 180);
				const x = Math.round(c.style.x * 320 - w / 2);
				const y = Math.round(c.style.y * 180 - h / 2);
				const fill = c.shape.fill
					? `0x${c.shape.fill.slice(1)}`
					: `0x${(c.shape.stroke ?? "#ffffff").slice(1)}`;
				await ffmpeg([
					"-f",
					"lavfi",
					"-i",
					`color=c=${fill}:s=${w}x${h},format=rgba,pad=320:180:${x}:${y}:color=black@0`,
					"-frames:v",
					"1",
					file,
				]);
				out[c.id] = { kind: "still", file };
			}
			return out;
		};
		const out = (await store.export("video", "overlays.mp4", "user", renderText)).outputs[0];
		// The redaction is black.
		const [r, g, b] = await pixel(out, 1, 64, 54, 320);
		expect(Math.max(r, g, b)).toBeLessThan(40);
		// The blur box softens the stripe edges inside it; outside it they stay sharp.
		const across = async (y: number) => {
			const row = await Promise.all(
				Array.from({ length: 40 }, (_, i) => pixel(out, 1, 180 + i * 2, y, 320)),
			);
			// Largest jump between neighbours: sharp edges jump a lot.
			return Math.max(...row.slice(1).map((p, i) => Math.abs(p[0] - row[i][0])));
		};
		expect(await across(54)).toBeLessThan((await across(100)) * 0.7);
		// The box outline is magenta.
		const [mr, mg, mb] = await pixel(out, 1, 84, 136, 320);
		expect(mr > 180 && mb > 180 && mg < 90).toBe(true);
	}, 120000);

	it("arranges clips side by side and picture in picture", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-layouts-"));
		const red = path.join(dir, "red.mp4");
		const blue = path.join(dir, "blue.mp4");
		for (const [file, color] of [
			[red, "red"],
			[blue, "blue"],
		])
			await ffmpeg([
				"-f",
				"lavfi",
				"-i",
				`color=c=${color}:s=320x180:r=30:d=2`,
				"-pix_fmt",
				"yuv420p",
				file,
			]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Layouts" });
		store.apply({ type: "setCanvas", canvas: { width: 320, height: 180 } }, "user");
		const [a, b] = await store.importMedia([red, blue], "user");
		const top = store.apply({ type: "addTrack", kind: "video", index: 0 }, "user")
			.created?.[0] as string;
		const [bottomClip, topClip] = store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: a.id, startMs: 0, durationMs: 2000 },
					{ type: "media", trackId: top, assetId: b.id, startMs: 0, durationMs: 2000 },
				],
			},
			"user",
		).created as string[];
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "high" } },
			"user",
		);
		const isRed = ([r, g, bl]: number[]) => r > 150 && g < 90 && bl < 90;
		const isBlue = ([r, g, bl]: number[]) => bl > 150 && r < 90 && g < 90;

		await store.arrangeClips("side-by-side", [bottomClip, topClip], "user");
		let out = (await store.export("video", "side.mp4", "user")).outputs[0];
		expect(isRed(await pixel(out, 1, 60, 90, 320))).toBe(true);
		expect(isBlue(await pixel(out, 1, 260, 90, 320))).toBe(true);

		// Picture in picture: the clip on the higher track (blue) is the small one.
		await store.arrangeClips("pip-br", [bottomClip, topClip], "user");
		out = (await store.export("video", "pip.mp4", "user")).outputs[0];
		expect(isRed(await pixel(out, 1, 60, 60, 320))).toBe(true);
		expect(isBlue(await pixel(out, 1, 260, 145, 320))).toBe(true);
	}, 120000);
});
