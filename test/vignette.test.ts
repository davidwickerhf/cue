import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { vignetteMask } from "../electron/core/exporter";
import { ffmpeg, ffmpegPath } from "../electron/core/media";
import { ProjectStore } from "../electron/core/store";
import type { Effects } from "../electron/core/types";
import { vignetteAlpha, vignetteGeq } from "../electron/core/vignette";

const run = promisify(execFile);
const W = 320;
const H = 180;

type Shape = Pick<
	Effects,
	"vignette" | "vignetteMidpoint" | "vignetteRoundness" | "vignetteFeather"
>;

/** The mask's alpha channel, one byte per pixel. */
async function maskAlpha(
	e: Shape,
): Promise<{ file: string; at: (x: number, y: number) => number }> {
	const file = await vignetteMask(e as Effects, W, H);
	const { stdout } = await run(
		ffmpegPath(),
		["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
		{ encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
	);
	return { file, at: (x, y) => stdout[(y * W + x) * 4 + 3] };
}

/** A pixel on the diagonal at distance `s` (0 centre, 1 corner) of the default ellipse. */
const diag = (s: number): [number, number] => [
	Math.round(W / 2 + (s * W) / 2),
	Math.round(H / 2 + (s * H) / 2),
];

describe("vignette mask", () => {
	it("is the original mask when midpoint, roundness and feather are absent or at their defaults", async () => {
		for (const amount of [0.05, 0.32, 0.4, 0.75, 1]) {
			// The expression the exporter built before these controls existed.
			const inner = Math.round(70 - amount * 45) / 100;
			const dark = 0.35 + amount * 0.55;
			const d = "sqrt(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2))/sqrt(2)";
			const old = `255*${dark.toFixed(4)}*clip((${d}-${inner})/${(1 - inner).toFixed(4)},0,1)`;
			expect(vignetteGeq({ vignette: amount }, W, H)).toBe(old);
			expect(
				vignetteGeq(
					{ vignette: amount, vignetteMidpoint: 0.5, vignetteRoundness: 0, vignetteFeather: 0.5 },
					W,
					H,
				),
			).toBe(old);
		}
		// And it is cached under its old name, so existing exports reuse it.
		const { file } = await maskAlpha({ vignette: 0.4, vignetteRoundness: 0 });
		expect(path.basename(file)).toBe(`cue-vignette-a-0.400-${W}x${H}.png`);
		const shaped = await vignetteMask({ vignette: 0.4, vignetteRoundness: -1 } as Effects, W, H);
		expect(path.basename(shaped)).toBe(`cue-vignette-a-0.400-m0.500-r-1.000-f0.500-${W}x${H}.png`);
	}, 60000);

	it("follows the frame's rectangle at roundness -1 and makes a circle at +1", async () => {
		const base = await maskAlpha({ vignette: 0.6 });
		const square = await maskAlpha({ vignette: 0.6, vignetteRoundness: -1 });
		const round = await maskAlpha({ vignette: 0.6, vignetteRoundness: 1 });
		const full = Math.round(255 * (0.35 + 0.6 * 0.55));
		for (const m of [base, square, round]) {
			// The middle stays clear and the corners get the full darkness.
			expect(m.at(W / 2, H / 2)).toBe(0);
			expect(Math.abs(m.at(W - 1, H - 1) - full)).toBeLessThanOrEqual(3);
		}
		// The ellipse darkens the middle of every edge the same.
		expect(Math.abs(base.at(W - 1, H / 2) - base.at(W / 2, H - 1))).toBeLessThanOrEqual(3);
		// The rectangle darkens the middle of the edges almost as much as the corners.
		expect(square.at(W - 1, H / 2)).toBeGreaterThan(full * 0.9);
		expect(square.at(W / 2, H - 1)).toBeGreaterThan(full * 0.9);
		expect(square.at(W - 1, H / 2)).toBeGreaterThan(base.at(W - 1, H / 2) + 50);
		// The circle reaches the short edges of a wide frame later than its long ones.
		expect(round.at(W / 2, H - 1)).toBeLessThan(base.at(W / 2, H - 1) - 30);
		expect(round.at(W - 1, H / 2)).toBeGreaterThan(base.at(W - 1, H / 2) + 30);
	}, 60000);

	it("has a hard edge at feather 0 and spreads further at feather 1", async () => {
		const base = await maskAlpha({ vignette: 0.6 });
		const hard = await maskAlpha({ vignette: 0.6, vignetteFeather: 0 });
		const soft = await maskAlpha({ vignette: 0.6, vignetteFeather: 1 });
		const full = Math.round(255 * (0.35 + 0.6 * 0.55));
		// Amount 0.6 ramps from 0.43 to 1; a hard edge sits at its middle, 0.715.
		expect(hard.at(...diag(0.66))).toBe(0);
		expect(Math.abs(hard.at(...diag(0.77)) - full)).toBeLessThanOrEqual(3);
		const between = base.at(...diag(0.66));
		expect(between).toBeGreaterThan(40);
		expect(between).toBeLessThan(full - 40);
		// Soft: it starts nearer the middle and the corners stay lighter.
		expect(base.at(...diag(0.3))).toBe(0);
		expect(soft.at(...diag(0.3))).toBeGreaterThan(10);
		expect(soft.at(W - 1, H - 1)).toBeLessThan(full - 30);
	}, 60000);

	it("keeps the darkening nearer the corners at a higher midpoint", async () => {
		const low = await maskAlpha({ vignette: 0.4, vignetteMidpoint: 0 });
		const base = await maskAlpha({ vignette: 0.4 });
		const high = await maskAlpha({ vignette: 0.4, vignetteMidpoint: 1 });
		const p = diag(0.6);
		expect(low.at(...p)).toBeGreaterThan(base.at(...p) + 30);
		expect(high.at(...p)).toBe(0);
		expect(high.at(W - 1, H - 1)).toBeGreaterThan(base.at(W - 1, H - 1) * 0.8);
	}, 60000);

	it("draws the same mask in the preview (vignetteAlpha) as in the export", async () => {
		const shapes: Shape[] = [
			{ vignette: 0.4 },
			{ vignette: 0.7, vignetteRoundness: -0.6, vignetteFeather: 0.2 },
			{ vignette: 0.5, vignetteRoundness: 0.4, vignetteMidpoint: 0.3, vignetteFeather: 0.9 },
		];
		for (const e of shapes) {
			const m = await maskAlpha(e);
			for (const [x, y] of [
				[W / 2, H / 2],
				[W - 1, H - 1],
				[0, H / 2],
				[W / 2, 0],
				[40, 30],
				[250, 160],
				...[0.4, 0.55, 0.7, 0.85].map(diag),
			]) {
				expect(Math.abs(m.at(x, y) - vignetteAlpha(e, x, y, W, H) * 255)).toBeLessThanOrEqual(2);
			}
		}
	}, 60000);
});

describe("vignette shape in export", () => {
	it("exports a clip's roundness, kept when the amount changes", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-vignette-shape-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Vignette shape" });
		const file = path.join(dir, "white.png");
		await ffmpeg(["-f", "lavfi", "-i", `color=c=white:s=${W}x${H}`, "-frames:v", "1", file]);
		const [white] = await store.importMedia([file], "user");
		store.apply({ type: "setCanvas", canvas: { width: W, height: H, fps: 10 } } as never, "user");
		store.apply(
			{
				type: "addClips",
				clips: [{ type: "media", trackId: "V1", assetId: white.id, startMs: 0, durationMs: 1000 }],
			} as never,
			"user",
		);
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "high" } } as never,
			"user",
		);
		const clip = store.current.clips[0];
		const patch = (effects: Partial<Effects>) =>
			store.apply({ type: "updateClip", id: clip.id, patch: { effects } } as never, "user");
		patch({ vignette: 0.3, vignetteRoundness: -1 });
		patch({ vignette: 0.6 });
		const effects =
			store.current.clips[0].type === "media" ? store.current.clips[0].effects : undefined;
		expect(effects).toMatchObject({ vignette: 0.6, vignetteRoundness: -1 });
		expect(() => patch({ vignetteRoundness: 2 })).toThrow();

		const out = (await store.export("video", "shape.mp4", "user")).outputs[0];
		const { stdout } = await run(
			ffmpegPath(),
			[
				"-v",
				"error",
				"-ss",
				"0.5",
				"-i",
				out,
				"-frames:v",
				"1",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"gray",
				"-",
			],
			{ encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
		);
		const at = (x: number, y: number) => stdout[y * W + x];
		const expected = (x: number, y: number) =>
			255 * (1 - vignetteAlpha(effects as Effects, x, y, W, H));
		expect(at(W / 2, H / 2)).toBeGreaterThan(245);
		// The middle of the right edge is nearly as dark as a corner (an ellipse would leave it lighter).
		expect(Math.abs(at(W - 2, H / 2) - expected(W - 2, H / 2))).toBeLessThan(20);
		expect(Math.abs(at(2, 2) - expected(2, 2))).toBeLessThan(20);
		expect(at(W - 2, H / 2)).toBeLessThan(
			255 * (1 - vignetteAlpha({ vignette: 0.6 }, W - 2, H / 2, W, H)) - 40,
		);
	}, 120000);
});
