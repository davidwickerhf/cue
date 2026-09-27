import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpeg, probe } from "../electron/core/media";
import { ProjectStore } from "../electron/core/store";

const newStore = (dir: string, name: string) =>
	new ProjectStore({
		mediaUrl: (f) => f,
		recentFile: path.join(dir, `${name}-recent.json`),
		autoProxies: () => false,
	});

describe("projects placed as media", () => {
	it("renders another project into this one and follows its changes", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-projmedia-"));
		const clipFile = path.join(dir, "blue.mp4");
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:s=320x180:r=25:d=4",
			"-pix_fmt",
			"yuv420p",
			clipFile,
		]);

		// B: the "graphics" project, 2 s of blue.
		const b = newStore(dir, "b");
		await b.create({ path: path.join(dir, "Graphics") });
		b.apply({ type: "setCanvas", canvas: { width: 320, height: 180, fps: 25 } } as never, "user");
		b.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "draft" } } as never,
			"user",
		);
		const [blue] = await b.importMedia([clipFile], "user");
		b.apply(
			{
				type: "addClips",
				clips: [{ type: "media", trackId: "V1", assetId: blue.id, startMs: 0, durationMs: 2000 }],
			} as never,
			"user",
		);
		await b.flush();
		const bFile = b.filePath as string;

		// A places B on its timeline.
		const a = newStore(dir, "a");
		await a.create({ path: path.join(dir, "Edit") });
		a.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "draft" } } as never,
			"user",
		);
		const asset = await a.addProjectMedia(bFile, { place: { trackId: "V1", startMs: 0 } }, "user");
		expect(asset.projectSource?.path).toBe(bFile);
		expect(asset.durationMs).toBe(2000);
		const render = path.join(a.projectDir, asset.path);
		expect(Math.round((await probe(render)).durationMs / 100)).toBe(20);
		expect(a.current.clips.some((c) => c.type === "media" && c.assetId === asset.id)).toBe(true);
		await expect(a.addProjectMedia(a.filePath as string, {}, "user")).rejects.toThrow(/itself/);

		// Nothing changed: nothing to do.
		expect(await a.refreshProjectMedia()).toBe(0);
		// B grows to 3 s: A renders it again, and its clip that reached the end follows.
		const clip = b.current.clips[0];
		b.apply({ type: "updateClip", id: clip.id, patch: { durationMs: 3000 } } as never, "user");
		await b.flush();
		const later = new Date(Date.now() + 5000);
		await fs.utimes(bFile, later, later);
		expect(await a.refreshProjectMedia()).toBe(1);
		const updated = a.current.assets.find((x) => x.id === asset.id);
		expect(updated?.durationMs).toBe(3000);
		const placed = a.current.clips.find((c) => c.type === "media" && c.assetId === asset.id);
		expect(placed?.durationMs).toBe(3000);
		expect(
			Math.round((await probe(path.join(a.projectDir, updated?.path ?? ""))).durationMs / 100),
		).toBe(30);
	}, 120000);
});
