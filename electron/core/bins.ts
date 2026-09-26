import type { Asset, Bin, MediaClip, ProjectData } from "./types";

/**
 * Finding media in the library: which items are used, where, and which match
 * a search. Shared by the Media panel and list_media, so people and agents
 * see the same results. Pure, so it runs in both processes.
 */

/** "Interviews › Day 1": where a bin sits, for summaries and agents. */
export function binPath(data: ProjectData, id: string | undefined): string | null {
	const b = id ? data.bins?.find((x) => x.id === id) : undefined;
	if (!b) return null;
	const parent = b.parentId ? data.bins?.find((x) => x.id === b.parentId) : undefined;
	return parent ? `${parent.name} › ${b.name}` : b.name;
}

/** Every timeline with its clips, the open one first. */
function timelines(data: ProjectData) {
	const open = data.sequence ?? { id: "main", name: "Main" };
	return [
		{ ...open, clips: data.clips, open: true },
		...(data.sequences ?? []).map((q) => ({ ...q, open: false })),
	];
}

/** Media used by a clip on any timeline. */
export function usedAssetIds(data: ProjectData): Set<string> {
	const used = new Set<string>();
	for (const q of timelines(data))
		for (const c of q.clips) if (c.type === "media") used.add(c.assetId);
	return used;
}

export interface MediaUse {
	sequenceId: string;
	sequenceName: string;
	/** The timeline open in the editor. */
	open: boolean;
	clipId: string;
	trackId: string;
	startMs: number;
	durationMs: number;
}

/** Where a media item is used, timeline by timeline, in time order. */
export function mediaUses(data: ProjectData, assetId: string): MediaUse[] {
	return timelines(data).flatMap((q) =>
		q.clips
			.filter((c): c is MediaClip => c.type === "media" && c.assetId === assetId)
			.sort((a, b) => a.startMs - b.startMs)
			.map((c) => ({
				sequenceId: q.id,
				sequenceName: q.name,
				open: q.open,
				clipId: c.id,
				trackId: c.trackId,
				startMs: c.startMs,
				durationMs: c.durationMs,
			})),
	);
}

// Joining a long transcript on every keystroke would be slow; keep it per transcript.
const transcriptText = new WeakMap<object, string>();

/** Everything a search looks through: name, tags, note and transcript. */
function haystack(asset: Asset): string {
	let spoken = "";
	if (asset.transcript) {
		spoken = transcriptText.get(asset.transcript) ?? "";
		if (!spoken) {
			spoken = asset.transcript.words
				.map((w) => w.text)
				.join(" ")
				.toLowerCase();
			transcriptText.set(asset.transcript, spoken);
		}
	}
	return (
		`${asset.name}\n${(asset.tags ?? []).join("\n")}\n${asset.note ?? ""}`.toLowerCase() +
		`\n${spoken}`
	);
}

/** True when every word of the query appears somewhere in the item. */
export function matchesQuery(asset: Asset, query: string): boolean {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return true;
	const text = haystack(asset);
	return words.every((w) => text.includes(w));
}

export interface MediaFilter {
	/** Media directly in this bin; null for media not in any bin. Leave out for all. */
	binId?: string | null;
	tag?: string;
	kind?: "video" | "audio" | "image";
	/** Only media no timeline uses. */
	unused?: boolean;
	/** Only media rated at least this many stars. */
	minRating?: number;
	query?: string;
}

/** Media matching every condition of the filter (adjustment layers never count). */
export function filterMedia(data: ProjectData, filter: MediaFilter = {}): Asset[] {
	const used = filter.unused ? usedAssetIds(data) : null;
	const tag = filter.tag?.trim().toLowerCase();
	return data.assets.filter(
		(a) =>
			a.kind !== "adjustment" &&
			(filter.binId === undefined || (a.binId ?? null) === filter.binId) &&
			(!tag || (a.tags ?? []).some((t) => t.toLowerCase() === tag)) &&
			(!filter.kind || a.kind === filter.kind) &&
			!used?.has(a.id) &&
			(!filter.minRating || (a.rating ?? 0) >= filter.minRating) &&
			(!filter.query || matchesQuery(a, filter.query)),
	);
}

export type MediaSort = "name" | "added" | "duration" | "rating";

/** Sorted copy: names A–Z, newest first, longest first, best rated first. */
export function sortMedia(assets: Asset[], by: MediaSort): Asset[] {
	const byName = (a: Asset, b: Asset) =>
		a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
	const compare: Record<MediaSort, (a: Asset, b: Asset) => number> = {
		name: byName,
		added: (a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b),
		duration: (a, b) => b.durationMs - a.durationMs || byName(a, b),
		rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || byName(a, b),
	};
	return [...assets].sort(compare[by]);
}

/** Top-level bins with their sub-bins, both sorted by name. */
export function binTree(bins: Bin[] = []): { bin: Bin; children: Bin[] }[] {
	const byName = (a: Bin, b: Bin) => a.name.localeCompare(b.name, undefined, { numeric: true });
	return bins
		.filter((b) => !b.parentId)
		.sort(byName)
		.map((bin) => ({ bin, children: bins.filter((b) => b.parentId === bin.id).sort(byName) }));
}

/** Every tag in the library with how many items carry it, most used first. */
export function allTags(assets: Asset[]): { tag: string; count: number }[] {
	const counts = new Map<string, { tag: string; count: number }>();
	for (const a of assets)
		for (const tag of a.tags ?? []) {
			const key = tag.toLowerCase();
			const entry = counts.get(key) ?? { tag, count: 0 };
			entry.count++;
			counts.set(key, entry);
		}
	return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
