/**
 * Project deltas: after an edit, main sends the window only what changed
 * (clips by id, other data keys when they differ, the small snapshot fields)
 * instead of the whole project (about 170 KB at 500 clips). Shared by main
 * (diff) and the renderer (apply), so it must stay free of Node imports.
 */
import type { Clip, ProjectData, ProjectSnapshot } from "./types";

export interface ClipsDelta {
	/** Changed or new clips, whole. */
	upsert: Clip[];
	remove: string[];
	/** Where each new clip sits in the new list, when the others kept their order. */
	added?: Record<string, number>;
	/** The full id order, only when kept clips were reordered. */
	order?: string[];
}

type OtherData = Omit<ProjectData, "clips">;

export interface ProjectPatch {
	/** The revision the patch applies to; the window refetches when it has another. */
	baseRevision: number;
	path: string;
	revision: number;
	dirty: boolean;
	canUndo: boolean;
	canRedo: boolean;
	durationMs: number;
	clips?: ClipsDelta;
	/** Other top-level data keys whose value changed (or appeared). */
	data?: Partial<OtherData>;
	/** Top-level data keys that no longer exist. */
	dataRemoved?: string[];
	lines?: ProjectSnapshot["lines"];
	assetUrls?: ProjectSnapshot["assetUrls"];
	proxyUrls?: ProjectSnapshot["proxyUrls"];
	offline?: ProjectSnapshot["offline"];
	/** Present (possibly null) only when it changed. */
	proposal?: ProjectSnapshot["proposal"];
}

/** Same value: by reference first (ops return new objects only for changed parts), then by content. */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	return JSON.stringify(a) === JSON.stringify(b);
}

export function diffClips(prev: Clip[], next: Clip[]): ClipsDelta | null {
	if (prev === next) return null;
	const before = new Map(prev.map((c) => [c.id, c]));
	const upsert: Clip[] = [];
	const added: Record<string, number> = {};
	let isNew = false;
	next.forEach((c, i) => {
		const old = before.get(c.id);
		if (!old) {
			upsert.push(c);
			added[c.id] = i;
			isNew = true;
		} else if (!same(old, c)) upsert.push(c);
	});
	const after = new Set(next.map((c) => c.id));
	const remove = prev.filter((c) => !after.has(c.id)).map((c) => c.id);
	// Did the clips on both sides keep their relative order?
	const keptBefore = prev.filter((c) => after.has(c.id));
	const keptAfter = next.filter((c) => before.has(c.id));
	const reordered = keptBefore.some((c, i) => c.id !== keptAfter[i]?.id);
	if (!upsert.length && !remove.length && !reordered) return null;
	const delta: ClipsDelta = { upsert, remove };
	if (reordered) delta.order = next.map((c) => c.id);
	else if (isNew) delta.added = added;
	return delta;
}

export function applyClips(prev: Clip[], delta: ClipsDelta): Clip[] {
	const changed = new Map(delta.upsert.map((c) => [c.id, c]));
	const removed = new Set(delta.remove);
	if (delta.order) {
		const byId = new Map(prev.map((c) => [c.id, c]));
		return delta.order.map((id) => {
			const c = changed.get(id) ?? byId.get(id);
			if (!c) throw new Error(`Clip ${id} is missing from the patch.`);
			return c;
		});
	}
	const next = prev.filter((c) => !removed.has(c.id)).map((c) => changed.get(c.id) ?? c);
	// Insert new clips at their final places, lowest index first.
	const inserts = Object.entries(delta.added ?? {}).sort((a, b) => a[1] - b[1]);
	for (const [id, index] of inserts) next.splice(index, 0, changed.get(id) as Clip);
	return next;
}

/**
 * What changed from `prev` to `next`, or null when a patch can't describe it
 * (another project), in which case the whole snapshot is sent.
 */
export function diffSnapshot(prev: ProjectSnapshot, next: ProjectSnapshot): ProjectPatch | null {
	if (prev.path !== next.path || prev.dir !== next.dir) return null;
	const patch: ProjectPatch = {
		baseRevision: prev.revision,
		path: next.path,
		revision: next.revision,
		dirty: next.dirty,
		canUndo: next.canUndo,
		canRedo: next.canRedo,
		durationMs: next.durationMs,
	};
	if (prev.data !== next.data) {
		const clips = diffClips(prev.data.clips, next.data.clips);
		if (clips) patch.clips = clips;
		const data: Record<string, unknown> = {};
		const a = prev.data as unknown as Record<string, unknown>;
		const b = next.data as unknown as Record<string, unknown>;
		for (const key of Object.keys(b)) {
			if (key === "clips") continue;
			if (!(key in a) || !same(a[key], b[key])) data[key] = b[key];
		}
		if (Object.keys(data).length) patch.data = data as Partial<OtherData>;
		const gone = Object.keys(a).filter((key) => !(key in b));
		if (gone.length) patch.dataRemoved = gone;
	}
	if (!same(prev.lines, next.lines)) patch.lines = next.lines;
	if (!same(prev.assetUrls, next.assetUrls)) patch.assetUrls = next.assetUrls;
	if (!same(prev.proxyUrls, next.proxyUrls)) patch.proxyUrls = next.proxyUrls;
	if (!same(prev.offline, next.offline)) patch.offline = next.offline;
	if (!same(prev.proposal, next.proposal)) patch.proposal = next.proposal;
	return patch;
}

/**
 * The snapshot after `patch`, reusing every unchanged object from `base` so
 * React skips work for them. Null when the patch was made for another version.
 */
export function applyPatch(base: ProjectSnapshot, patch: ProjectPatch): ProjectSnapshot | null {
	if (base.path !== patch.path || base.revision !== patch.baseRevision) return null;
	let data = base.data;
	if (patch.clips || patch.data || patch.dataRemoved) {
		const next = { ...base.data, ...patch.data } as Record<string, unknown>;
		for (const key of patch.dataRemoved ?? []) delete next[key];
		if (patch.clips) {
			try {
				next.clips = applyClips(base.data.clips, patch.clips);
			} catch {
				return null;
			}
		}
		data = next as unknown as ProjectData;
	}
	return {
		...base,
		revision: patch.revision,
		dirty: patch.dirty,
		canUndo: patch.canUndo,
		canRedo: patch.canRedo,
		durationMs: patch.durationMs,
		data,
		lines: patch.lines ?? base.lines,
		assetUrls: patch.assetUrls ?? base.assetUrls,
		proxyUrls: patch.proxyUrls ?? base.proxyUrls,
		offline: patch.offline ?? base.offline,
		proposal: "proposal" in patch ? (patch.proposal ?? null) : base.proposal,
	};
}
