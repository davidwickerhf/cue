import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpeg } from "../electron/core/media";
import { analyzeReference } from "../electron/core/reference";

describe("analysing a reference video", () => {
	it("finds the cuts, shot lengths, colours and makes a contact sheet", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-ref-"));
		const file = path.join(dir, "ref.mp4");
		// Three shots: red 2 s, grey 3 s, blue 1 s.
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=320x180:r=25:d=2",
			"-f",
			"lavfi",
			"-i",
			"color=c=gray:s=320x180:r=25:d=3",
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:s=320x180:r=25:d=1",
			"-filter_complex",
			"[0][1][2]concat=n=3:v=1:a=0",
			"-pix_fmt",
			"yuv420p",
			file,
		]);
		const r = await analyzeReference(file, dir);
		expect(r.cuts.length).toBe(2);
		expect(Math.abs(r.cuts[0] - 2000)).toBeLessThan(100);
		expect(Math.abs(r.cuts[1] - 5000)).toBeLessThan(100);
		expect(r.shots.count).toBe(3);
		expect(Math.abs(r.shots.medianMs - 2000)).toBeLessThan(100);
		expect(r.shots.cutsPerMinute).toBeCloseTo(20, 0);
		// Half the time is grey: black and white.
		expect(r.look.monochromeShare).toBeGreaterThan(0.3);
		expect(r.look.palette[0].share).toBeGreaterThan(0.2);
		expect(r.sheetTimesMs).toHaveLength(3);
		await expect(fs.access(r.png)).resolves.toBeUndefined();
	}, 120000);
});
