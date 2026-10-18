import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { makePoster, posterPath, summarise } from "../electron/core/library";
import { ffmpeg, ffmpegPath } from "../electron/core/media";
import { ProjectStore } from "../electron/core/store";

const run = promisify(execFile);

describe("project posters", () => {
	it("uses a photo from the edit, skipping graphics, with one poster per project file", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-posters-"));
		const photo = path.join(dir, "photo.png");
		await ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=320x180", "-frames:v", "1", photo]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Posters" });
		// The edit opens with a motion graphic (ffmpeg can't read it), then a photo.
		await store.createMotionGraphic(
			{
				spec: { durationMs: 4000, layers: [{ type: "text", text: "Title", size: 80 }] },
				place: { startMs: 0 },
			},
			"agent",
		);
		// And a white paper backdrop runs under the whole edit, on a track below.
		const paper = path.join(dir, "paper.png");
		await ffmpeg(["-f", "lavfi", "-i", "color=c=white:s=320x180", "-frames:v", "1", paper]);
		const [pic, backdrop] = await store.importMedia([photo, paper], "user");
		const below = store.apply({ type: "addTrack", kind: "video", name: "Paper" }, "user")
			.created?.[0] as string;
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: below, assetId: backdrop.id, startMs: 0, durationMs: 24000 },
				],
			},
			"user",
		);
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: pic.id, startMs: 4000, durationMs: 5000 },
				],
			},
			"user",
		);
		await store.flush();
		const file = store.filePath as string;
		await makePoster(file, store.current);
		expect(posterPath(file)).toContain(path.join(".cue-cache", "posters"));
		expect(existsSync(posterPath(file))).toBe(true);
		// The poster is the blue photo, not the white backdrop.
		const { stdout } = await run(
			ffmpegPath(),
			[
				"-v",
				"error",
				"-i",
				posterPath(file),
				"-vf",
				"scale=1:1",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"-",
			],
			{ encoding: "buffer" },
		);
		expect(stdout[2]).toBeGreaterThan(150);
		expect(stdout[0]).toBeLessThan(80);

		// A copy of the project in the same folder gets a poster of its own.
		const copy = path.join(dir, "Posters copy.cueproj");
		await fs.copyFile(file, copy);
		expect(posterPath(copy)).not.toBe(posterPath(file));
		const listed = await summarise(copy, (f) => f);
		expect(listed.exists).toBe(true);
		// Listing a project without a poster makes one in the background.
		for (let i = 0; i < 50 && !existsSync(posterPath(copy)); i++)
			await new Promise((resolve) => setTimeout(resolve, 100));
		expect(existsSync(posterPath(copy))).toBe(true);
	}, 60000);
});
