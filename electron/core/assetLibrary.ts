import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import catalog from "../../resources/assets/catalog.json";
import { BLEND_MODES } from "./project";
import type { BlendMode, ProjectData } from "./types";

/** How an asset is meant to be used: agents and import_library_asset follow it. */
const useSchema = z.object({
	/** Blend mode for the clip (multiply for paper over footage, screen for dust and light leaks). */
	blend: z.enum(BLEND_MODES).optional(),
	/** Clip opacity, 0–1. */
	opacity: z.number().min(0).max(1).optional(),
	/** Where it goes: the bottom picture track (boards), the top one (overlays) or an audio track. */
	track: z.enum(["bottom", "top", "audio"]).optional(),
	volume: z.number().min(0).max(2).optional(),
	/** Seamless loop: repeat it to fill a longer scene. */
	loop: z.boolean().optional(),
	/** For sounds: the moment (ms into the file) to line up with the event (a whoosh's peak). */
	syncMs: z.number().min(0).optional(),
	note: z.string(),
});

export const libraryAssetSchema = z.object({
	id: z.string(),
	name: z.string(),
	category: z.string(),
	description: z.string(),
	file: z.string().regex(/^[a-z0-9-]+\.(mp4|png|jpg|wav|m4a|mp3)$/),
	license: z.string(),
	licenseUrl: z.url(),
	tags: z.array(z.string()),
	sourcePage: z.url().optional(),
	/** The exact file the asset was made from (a pack or material download). */
	sourceFile: z.url().optional(),
	/** Who made it, and what was changed. */
	credit: z.string().optional(),
	downloadUrl: z.url().optional(),
	localPath: z.string().optional(),
	/** Length of a sound or loop. */
	durationMs: z.number().int().positive().optional(),
	use: useSchema.optional(),
});

export type LibraryAsset = z.infer<typeof libraryAssetSchema>;
export const LIBRARY_ASSETS: LibraryAsset[] = z.array(libraryAssetSchema).parse(catalog);

export type LibraryAssetKind = "video" | "image" | "audio";

/** What kind of media a library asset becomes: video, image (stills and overlays) or audio. */
export function libraryAssetKind(asset: Pick<LibraryAsset, "file">): LibraryAssetKind {
	if (/\.(wav|m4a|mp3)$/.test(asset.file)) return "audio";
	return asset.file.endsWith(".mp4") ? "video" : "image";
}

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

/** Where and how to place an imported library asset on the timeline. */
export interface LibraryPlacement {
	/** A track to add first (its id is then used for the clips). */
	newTrack?: { kind: "video" | "audio"; name: string; index: number };
	/** An existing track to use. */
	trackId?: string;
	clips: {
		startMs: number;
		durationMs: number;
		blend?: BlendMode;
		opacity?: number;
		volume?: number;
	}[];
}

/**
 * Plans the clips for a library asset placed at `startMs` (or with its sync point,
 * e.g. a whoosh's peak, at `atMs`), following the asset's `use`: sounds go on a free
 * "SFX" audio track, boards on a new bottom picture track, overlays on a new top one,
 * with the suggested blend, opacity and volume. Loops repeat to fill `durationMs`.
 */
export function planLibraryPlacement(
	data: Pick<ProjectData, "tracks" | "clips">,
	asset: LibraryAsset,
	mediaDurationMs: number,
	options: {
		trackId?: string;
		startMs?: number;
		atMs?: number;
		durationMs?: number;
		blend?: BlendMode;
		opacity?: number;
		volume?: number;
	},
): LibraryPlacement {
	const kind = libraryAssetKind(asset);
	const use = asset.use;
	const startMs = Math.max(
		0,
		Math.round(
			options.startMs ?? (options.atMs !== undefined ? options.atMs - (use?.syncMs ?? 0) : 0),
		),
	);
	const natural = kind === "image" ? 5000 : mediaDurationMs;
	const total = Math.max(1, Math.round(options.durationMs ?? natural));
	// Loops repeat back to back; anything else is at most as long as its media.
	const pieces: { startMs: number; durationMs: number }[] = [];
	if (kind !== "image" && use?.loop && total > natural) {
		for (let at = 0; at < total; at += natural)
			pieces.push({ startMs: startMs + at, durationMs: Math.min(natural, total - at) });
	} else pieces.push({ startMs, durationMs: kind === "image" ? total : Math.min(total, natural) });
	const endMs = pieces[pieces.length - 1].startMs + pieces[pieces.length - 1].durationMs;
	const blend = options.blend ?? use?.blend;
	const opacity = options.opacity ?? use?.opacity;
	const volume = options.volume ?? use?.volume;
	const clips = pieces.map((p) => ({
		...p,
		...(kind !== "audio" && blend && blend !== "normal" ? { blend } : {}),
		...(kind !== "audio" && opacity !== undefined ? { opacity } : {}),
		...(kind !== "image" && volume !== undefined ? { volume } : {}),
	}));
	if (options.trackId) return { trackId: options.trackId, clips };
	const free = (trackId: string) =>
		!data.clips.some(
			(c) => c.trackId === trackId && c.startMs < endMs && c.startMs + c.durationMs > startMs,
		);
	const pictureCount = data.tracks.filter((t) => t.kind !== "audio").length;
	if (kind === "audio") {
		const sfx = data.tracks.find(
			(t) => t.kind === "audio" && !t.locked && /^sfx/i.test(t.name) && free(t.id),
		);
		return sfx
			? { trackId: sfx.id, clips }
			: { newTrack: { kind: "audio", name: "SFX", index: data.tracks.length }, clips };
	}
	if (use?.track === "bottom")
		return { newTrack: { kind: "video", name: asset.name, index: pictureCount }, clips };
	if (use?.track === "top")
		return { newTrack: { kind: "video", name: asset.name, index: 0 }, clips };
	const top = data.tracks.find((t) => t.kind === "video" && !t.locked);
	return top && free(top.id)
		? { trackId: top.id, clips }
		: { newTrack: { kind: "video", name: "Video", index: 0 }, clips };
}
