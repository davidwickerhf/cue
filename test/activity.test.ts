import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectActivity } from "../electron/core/activity";
import { ffmpeg } from "../electron/core/media";

// A fake screen recording, 8 s at 30 fps:
// 0–1.5 s still · 1.5 s a small box appears (a click's result) · 3 s the whole screen
// switches (a new page) · 4.5–5.5 s the content scrolls up · 5.5–8 s still.
async function fakeRecording(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-activity-"));
	const page = path.join(dir, "page.png");
	// A tall page with stripes so a scroll is visible.
	await ffmpeg([
		"-f",
		"lavfi",
		"-i",
		"color=c=0xf0f0f0:s=640x1440",
		"-vf",
		"drawgrid=w=640:h=60:t=6:c=0x404040,drawbox=x=40:y=100:w=300:h=40:c=0x2060d0:t=fill",
		"-frames:v",
		"1",
		page,
	]);
	const out = path.join(dir, "screen.mp4");
	const scroll = "if(between(t,4.5,5.5),(t-4.5)*300,if(gt(t,5.5),300,0))";
	await ffmpeg([
		"-loop",
		"1",
		"-framerate",
		"30",
		"-t",
		"8",
		"-i",
		page,
		"-filter_complex",
		`[0]crop=640:360:0:'${scroll}',` +
			"drawbox=x=420:y=40:w=120:h=40:c=0xd03020:t=fill:enable='between(t,1.5,8)'," +
			"drawbox=x=0:y=0:w=640:h=360:c=0x203040:t=fill:enable='between(t,3,4.5)'",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-r",
		"30",
		out,
	]);
	return out;
}

describe("screen activity", () => {
	it("finds the click result, the page change, the scroll and the still stretches", async () => {
		const events = await detectActivity(await fakeRecording());
		const kinds = events.map((e) => `${e.kind}@${(e.atMs / 1000).toFixed(1)}`);
		const first = (kind: string) => events.find((e) => e.kind === kind);
		expect(first("idle")?.atMs).toBeLessThan(300);
		const ui = events.find((e) => e.kind === "ui-change" && e.atMs > 1300 && e.atMs < 1800);
		expect(ui, kinds.join(" ")).toBeTruthy();
		expect(ui?.region?.x).toBeGreaterThan(0.55);
		expect(ui?.region?.y).toBeLessThan(0.3);
		expect(
			events.some((e) => e.kind === "screen-change" && Math.abs(e.atMs - 3000) < 250),
			kinds.join(" "),
		).toBe(true);
		const scroll = first("scroll");
		expect(scroll, kinds.join(" ")).toBeTruthy();
		expect(Math.abs((scroll?.atMs ?? 0) - 4500)).toBeLessThan(400);
		expect(scroll?.scroll).toBeGreaterThan(0);
		expect(
			events.some((e) => e.kind === "idle" && e.atMs > 5400 && e.endMs - e.atMs > 1500),
			kinds.join(" "),
		).toBe(true);
	}, 30000);
});
