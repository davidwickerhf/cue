import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import catalog from "../../resources/assets/catalog.json";

const assetSchema = z.object({
	id: z.string(),
	name: z.string(),
	category: z.string(),
	description: z.string(),
	file: z.string().regex(/^[a-z0-9-]+\.(mp4|png)$/),
	license: z.string(),
	licenseUrl: z.url(),
	tags: z.array(z.string()),
	sourcePage: z.url().optional(),
	downloadUrl: z.url().optional(),
	localPath: z.string().optional(),
});

export type LibraryAsset = z.infer<typeof assetSchema>;
export const LIBRARY_ASSETS: LibraryAsset[] = z.array(assetSchema).parse(catalog);

export function findLibraryAsset(id: string): LibraryAsset {
	const asset = LIBRARY_ASSETS.find((item) => item.id === id);
	if (!asset) throw new Error(`No library asset "${id}". Use list_library_assets.`);
	return asset;
}

/** Copy a curated asset into the project so an edit still works offline or after Cue updates. */
export async function materializeLibraryAsset(
	asset: LibraryAsset,
	projectDir: string,
	options: { originalRoot?: string; fetcher?: typeof fetch } = {},
): Promise<string> {
	const folder = path.join(projectDir, "library-assets");
	const target = path.join(folder, asset.file);
	if ((await fs.stat(target).catch(() => null))?.size) return target;
	await fs.mkdir(folder, { recursive: true });
	const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
	try {
		if (asset.localPath) {
			const developmentSource = path.join(process.cwd(), asset.localPath);
			const source = options.originalRoot
				? path.join(options.originalRoot, path.basename(asset.localPath))
				: (await fs.stat(developmentSource).catch(() => null))
					? developmentSource
					: path.join(process.resourcesPath, "library-assets", path.basename(asset.localPath));
			await fs.copyFile(source, temporary);
		} else if (asset.downloadUrl) {
			const response = await (options.fetcher ?? fetch)(asset.downloadUrl, {
				signal: AbortSignal.timeout(120000),
			});
			if (!response.ok) throw new Error(`Download failed (${response.status}).`);
			const reported = Number(response.headers.get("content-length"));
			if (reported > 40_000_000) throw new Error("The library clip is unexpectedly large.");
			const bytes = Buffer.from(await response.arrayBuffer());
			if (bytes.length === 0 || bytes.length > 40_000_000)
				throw new Error("The library clip could not be downloaded safely.");
			await fs.writeFile(temporary, bytes);
		} else {
			throw new Error(`No source for library asset "${asset.id}".`);
		}
		await fs.rename(temporary, target);
		return target;
	} finally {
		await fs.rm(temporary, { force: true }).catch(() => {});
	}
}
