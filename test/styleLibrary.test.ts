import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	findLibraryAsset,
	LIBRARY_ASSETS,
	libraryAssetKind,
	libraryAssetSchema,
	materializeLibraryAsset,
	planLibraryPlacement,
} from "../electron/core/assetLibrary";
import { BUILT_IN_RECIPES } from "../electron/core/recipes";

const temporary: string[] = [];
afterEach(async () => {
	for (const folder of temporary.splice(0)) await fs.rm(folder, { recursive: true, force: true });
});
const project = async () => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), "cue-library-"));
	temporary.push(folder);
	return folder;
};

describe("style and asset library", () => {
	it("keeps every style preview and recommended asset resolvable", async () => {
		const ids = new Set(LIBRARY_ASSETS.map((asset) => asset.id));
		const styles = BUILT_IN_RECIPES.filter((item) => item.format === "style");
		expect(styles).toHaveLength(27);
		expect(LIBRARY_ASSETS).toHaveLength(61);
		for (const asset of LIBRARY_ASSETS) {
			expect(
				(await fs.stat(path.join("resources/assets/posters", `${asset.id}.jpg`))).size,
			).toBeGreaterThan(0);
			expect(
				(await fs.stat(path.join("site/public/assets", `${asset.id}.jpg`))).size,
			).toBeGreaterThan(0);
		}
		for (const style of styles) {
			expect(style.preview).toBeDefined();
			for (const file of [style.preview?.video, style.preview?.poster]) {
				expect(
					(await fs.stat(path.join("resources/styles/previews", file ?? ""))).size,
				).toBeGreaterThan(0);
			}
			for (const id of style.assetIds ?? []) expect(ids.has(id)).toBe(true);
			for (const file of [style.preview?.video, style.preview?.poster])
				expect((await fs.stat(path.join("site/public/styles", file ?? ""))).size).toBeGreaterThan(
					0,
				);
		}
	});

	it("copies an original graphic into the project", async () => {
		const folder = await project();
		const file = await materializeLibraryAsset(findLibraryAsset("cartographic-grid"), folder);
		expect(file).toBe(path.join(folder, "library-assets/cartographic-grid.png"));
		expect((await fs.stat(file)).size).toBeGreaterThan(0);
	});

	it("downloads a curated clip and leaves no partial file on failure", async () => {
		const folder = await project();
		const asset = findLibraryAsset("city-night-drive");
		const sample = Buffer.from("sample video data");
		const file = await materializeLibraryAsset(asset, folder, {
			fetcher: async () => new Response(sample, { status: 200 }),
		});
		expect(await fs.readFile(file)).toEqual(sample);
		const failed = await project();
		await expect(
			materializeLibraryAsset(asset, failed, {
				fetcher: async () => new Response("failed", { status: 502 }),
			}),
		).rejects.toThrow("Download failed");
		expect(await fs.readdir(path.join(failed, "library-assets"))).toEqual([]);
	});

	it("accepts textures and sounds with usage notes, and bundles every local file", async () => {
		const parsed = libraryAssetSchema.parse({
			id: "paper-test",
			name: "Paper",
			category: "Textures",
			description: "A paper board.",
			file: "paper-test.jpg",
			localPath: "resources/assets/textures/paper-test.jpg",
			license: "CC0 1.0",
			licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
			tags: ["paper"],
			use: { blend: "multiply", opacity: 0.7, track: "top", note: "Multiply over footage." },
		});
		expect(libraryAssetKind(parsed)).toBe("image");
		for (const file of ["hit.wav", "bed.m4a", "loop.mp3"])
			expect(libraryAssetSchema.shape.file.safeParse(file).success).toBe(true);
		expect(libraryAssetSchema.shape.file.safeParse("script.exe").success).toBe(false);
		expect(
			libraryAssetSchema.safeParse({ ...parsed, use: { blend: "dodge", note: "" } }).success,
		).toBe(false);

		const textures = LIBRARY_ASSETS.filter((asset) => asset.category === "Textures");
		const sounds = LIBRARY_ASSETS.filter((asset) => asset.category === "Sound effects");
		expect(textures.length).toBeGreaterThanOrEqual(8);
		expect(sounds.length).toBeGreaterThanOrEqual(12);
		for (const asset of [...textures, ...sounds]) {
			expect(asset.localPath, asset.id).toBeDefined();
			expect(asset.use?.note, asset.id).toBeTruthy();
			expect(asset.credit, asset.id).toBeTruthy();
			expect(["CC0 1.0", "Cue original asset"]).toContain(asset.license);
			if (asset.license === "CC0 1.0") expect(asset.sourceFile, asset.id).toBeDefined();
			const size = (await fs.stat(asset.localPath ?? "")).size;
			expect(size, asset.id).toBeGreaterThan(0);
			expect(size, asset.id).toBeLessThan(3_000_000);
		}
		for (const sound of sounds) {
			expect(libraryAssetKind(sound)).toBe("audio");
			expect(sound.use?.track).toBe("audio");
			expect(sound.durationMs).toBeGreaterThan(0);
		}
	});

	it("copies a sound into the project", async () => {
		const folder = await project();
		const file = await materializeLibraryAsset(findLibraryAsset("sfx-paper-slap"), folder);
		expect(file).toBe(path.join(folder, "library-assets/sfx-paper-slap.wav"));
		expect((await fs.stat(file)).size).toBeGreaterThan(1000);
	});

	it("plans where library assets go on the timeline", () => {
		const track = (id: string, kind: "video" | "audio", name = id) => ({
			id,
			kind,
			name,
			muted: false,
			locked: false,
			hidden: false,
			volume: 1,
		});
		const data = {
			tracks: [
				track("V1", "video"),
				track("V2", "video"),
				track("A1", "audio"),
				track("A2", "audio", "SFX"),
			],
			clips: [{ trackId: "A2", startMs: 0, durationMs: 1000 }] as never[],
		};
		// A whoosh's peak lands on the cut; the busy SFX track is skipped for a new one.
		const whoosh = findLibraryAsset("sfx-whoosh-soft");
		const early = planLibraryPlacement(data, whoosh, 679, { atMs: 800 });
		expect(early.clips[0].startMs).toBe(800 - (whoosh.use?.syncMs ?? 0));
		expect(early.newTrack).toEqual({ kind: "audio", name: "SFX", index: 4 });
		const later = planLibraryPlacement(data, whoosh, 679, { startMs: 5000, volume: 0.6 });
		expect(later).toEqual({
			trackId: "A2",
			clips: [{ startMs: 5000, durationMs: 679, volume: 0.6 }],
		});
		// A paper board goes on a new bottom picture track, overlays on a new top one with their blend.
		const board = planLibraryPlacement(data, findLibraryAsset("paper-kraft"), 0, {
			startMs: 0,
			durationMs: 12000,
		});
		expect(board.newTrack).toMatchObject({ kind: "video", index: 2 });
		expect(board.clips).toEqual([{ startMs: 0, durationMs: 12000 }]);
		// Loops repeat to fill the time asked for.
		const dust = planLibraryPlacement(data, findLibraryAsset("film-dust"), 6000, {
			startMs: 1000,
			durationMs: 14000,
		});
		expect(dust.newTrack).toMatchObject({ kind: "video", index: 0 });
		expect(dust.clips).toEqual([
			{ startMs: 1000, durationMs: 6000, blend: "screen", opacity: 0.6 },
			{ startMs: 7000, durationMs: 6000, blend: "screen", opacity: 0.6 },
			{ startMs: 13000, durationMs: 2000, blend: "screen", opacity: 0.6 },
		]);
		// An explicit track and blend win over the suggestions.
		const over = planLibraryPlacement(data, findLibraryAsset("paper-off-white"), 0, {
			trackId: "V1",
			blend: "multiply",
			opacity: 0.7,
		});
		expect(over).toEqual({
			trackId: "V1",
			clips: [{ startMs: 0, durationMs: 5000, blend: "multiply", opacity: 0.7 }],
		});
	});
});
