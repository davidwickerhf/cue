import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpeg, probe } from "../electron/core/media";
import { activeSequence, allSequences, applyOp } from "../electron/core/ops";
import { emptyProject, parseProject } from "../electron/core/project";
import { ProjectStore } from "../electron/core/store";
import type { Asset, MediaClip } from "../electron/core/types";

const video: Asset = {
	id: "a_v",
	kind: "video",
	name: "v.mp4",
	path: "v.mp4",
	durationMs: 20000,
	width: 1920,
	height: 1080,
	hasAudio: true,
	origin: "import",
	createdAt: "",
	actor: "user",
};

describe("sequences", () => {
	it("nests clips, switches timelines and survives a save", () => {
		let data = applyOp(emptyProject("S"), { type: "addAsset", asset: video }).data;
		data = applyOp(data, {
			type: "addClips",
			clips: [
				{ type: "media", trackId: "V1", assetId: video.id, startMs: 1000, durationMs: 2000 },
				{
					type: "media",
					trackId: "V1",
					assetId: video.id,
					startMs: 3000,
					durationMs: 2000,
					inMs: 5000,
				},
				{ type: "media", trackId: "V1", assetId: video.id, startMs: 8000, durationMs: 1000 },
			],
		}).data;
		const [a, b] = data.clips;
		const nested = applyOp(data, { type: "nestClips", ids: [a.id, b.id], name: "Intro" });
		data = nested.data;
		// One clip stands in for the two, at the same place and length.
		const stand = data.clips.find((c) => c.id === nested.created?.[0]) as MediaClip;
		expect([stand.startMs, stand.durationMs]).toEqual([1000, 4000]);
		expect(data.clips).toHaveLength(2);
		const seqId = nested.created?.[1] as string;
		expect(allSequences(data).map((q) => q.name)).toEqual(["Main", "Intro"]);

		data = applyOp(data, { type: "openSequence", id: seqId }).data;
		expect(activeSequence(data).name).toBe("Intro");
		expect(data.clips.map((c) => c.startMs).sort((x, y) => x - y)).toEqual([0, 2000]);

		// Saved and loaded while inside the nested sequence.
		const reloaded = parseProject(JSON.parse(JSON.stringify(data)));
		const back = applyOp(reloaded, { type: "openSequence", id: "main" }).data;
		expect(activeSequence(back).id).toBe("main");
		expect(back.clips).toHaveLength(2);
		expect(() => applyOp(back, { type: "deleteSequence", id: seqId })).toThrow(/nested/);
	});

	it("renders nested sequences and re-renders after editing inside them", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-seq-"));
		const src = path.join(dir, "src.mp4");
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"testsrc2=s=320x180:r=30:d=6",
			"-f",
			"lavfi",
			"-i",
			"sine=f=440:d=6",
			"-shortest",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			src,
		]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Seq" });
		store.apply({ type: "setCanvas", canvas: { width: 320, height: 180 } }, "user");
		const [asset] = await store.importMedia([src], "user");
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "V1", assetId: asset.id, startMs: 0, durationMs: 2000 },
					{
						type: "media",
						trackId: "V1",
						assetId: asset.id,
						startMs: 2000,
						durationMs: 2000,
						inMs: 3000,
					},
				],
			},
			"user",
		);
		const ids = store.current.clips.map((c) => c.id);
		const [, seqId] = store.apply({ type: "nestClips", ids, name: "Part" }, "user")
			.created as string[];
		expect(await store.renderNested()).toBe(1);
		const nestedAsset = () => store.current.assets.find((x) => x.sequenceId === seqId) as Asset;
		const firstRender = nestedAsset().path;
		expect((await probe(path.join(dir, firstRender))).durationMs).toBeGreaterThan(3800);
		// Unchanged: nothing to do.
		expect(await store.renderNested()).toBe(0);

		store.apply({ type: "openSequence", id: seqId }, "user");
		store.apply(
			{ type: "trimClip", id: store.current.clips[1].id, edge: "end", toMs: 3000 },
			"user",
		);
		store.apply({ type: "openSequence", id: "main" }, "user");
		expect(await store.renderNested()).toBe(1);
		expect(nestedAsset().path).not.toBe(firstRender);
		expect(nestedAsset().durationMs).toBe(3000);
		// The clip that showed the whole sequence follows its new length.
		const stand = store.current.clips.find(
			(c) => c.type === "media" && c.assetId === nestedAsset().id,
		) as MediaClip;
		expect(stand.durationMs).toBe(3000);

		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "draft" } },
			"user",
		);
		const out = (await store.export("video", "out.mp4", "user")).outputs[0];
		expect((await probe(out)).hasAudio).toBe(true);
	}, 120000);
});
