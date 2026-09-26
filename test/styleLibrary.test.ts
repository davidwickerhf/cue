import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	findLibraryAsset,
	LIBRARY_ASSETS,
	materializeLibraryAsset,
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
		expect(styles).toHaveLength(25);
		expect(LIBRARY_ASSETS).toHaveLength(33);
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
});
