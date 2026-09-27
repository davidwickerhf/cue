import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { ffmpeg, probe } from "../electron/core/media";
import { readZip } from "../electron/core/motionFile";
import { ProjectStore } from "../electron/core/store";

const run = promisify(execFile);

describe("packaging a project", () => {
	it("zips the project with its media, trimming long footage to what the edit uses", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-pack-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: path.join(dir, "Film") });
		// Media outside the project folder: a 60 s film and a still.
		const outside = path.join(dir, "elsewhere");
		await fs.mkdir(outside);
		const film = path.join(outside, "film.mp4");
		const still = path.join(outside, "still.png");
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"testsrc=size=320x180:rate=25:duration=60",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			film,
		]);
		await ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", still]);
		const [video, image] = await store.importMedia([film, still], "user");
		store.apply(
			{
				type: "addClips",
				clips: [
					{
						type: "media",
						trackId: "V1",
						assetId: video.id,
						startMs: 0,
						durationMs: 3000,
						inMs: 20000,
						linkedAudio: false,
					},
					{
						type: "media",
						trackId: "V1",
						assetId: video.id,
						startMs: 3000,
						durationMs: 2000,
						inMs: 30000,
						linkedAudio: false,
					},
					{ type: "media", trackId: "V1", assetId: image.id, startMs: 5000, durationMs: 1000 },
				],
			} as never,
			"user",
		);
		const out = path.join(dir, "Film.zip");
		const report = await store.packageProject(
			out,
			{ trim: true, extras: { "README.txt": "Credits" } },
			"user",
		);
		expect(report.media).toBe(2);
		expect(report.trimmed).toEqual([{ name: video.name, fromMs: 19000, toMs: 33000 }]);

		const entries = [...readZip(await fs.readFile(out)).keys()];
		expect(entries).toContain("film/README.txt");
		expect(entries.some((e) => e.startsWith("film/media/film-trimmed"))).toBe(true);
		expect(entries.some((e) => e.includes(".cue-history") || e.includes(".cue-cache"))).toBe(false);

		// Unzipped anywhere, it opens with its media found and the clips on the same frames.
		const there = path.join(dir, "unzipped");
		await run("unzip", ["-q", out, "-d", there]);
		const other = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent2.json"),
			autoProxies: () => false,
		});
		await other.open(path.join(there, "film", "film.cueproj"));
		expect(other.snapshot()?.offline ?? []).toEqual([]);
		const clips = other.current.clips.filter((c) => c.type === "media");
		expect(clips.map((c) => (c.type === "media" ? c.inMs : -1))).toEqual([1000, 11000, 0]);
		const trimmedFile = path.join(
			there,
			"Film",
			report.trimmed.length ? "media" : "",
			"film-trimmed.mp4",
		);
		expect(Math.round((await probe(trimmedFile)).durationMs / 1000)).toBe(14);
	}, 120000);
});
