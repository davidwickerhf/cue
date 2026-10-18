import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makePoster, posterPath, summarise } from "../electron/core/library";
import { ffmpeg } from "../electron/core/media";
import { ProjectStore } from "../electron/core/store";

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
		const [pic] = await store.importMedia([photo], "user");
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: pic.id, startMs: 4000, durationMs: 20000 },
				],
			},
			"user",
		);
		await store.flush();
		const file = store.filePath as string;
		await makePoster(file, store.current);
		expect(posterPath(file)).toContain(path.join(".cue-cache", "posters"));
		expect(existsSync(posterPath(file))).toBe(true);

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
