import type { KeyframeProp, MediaClip } from "../../electron/core/types";
import { run } from "./api";
import { app, createStore } from "./state";

/** A keyframe by its property and clip-local time. */
export interface KeyRef {
	prop: KeyframeProp;
	atMs: number;
}

/**
 * Keyframe lanes: which clips show them (a view setting, never undone) and
 * the keyframes selected in them. A selection belongs to one clip, since
 * every keyframe edit is made on one clip.
 */
export const keyframeLanes = createStore<{
	open: string[];
	clipId: string | null;
	selected: KeyRef[];
}>({ open: [], clipId: null, selected: [] });

/** Opens the lanes of these clips, or closes them when they are all open already. */
export function toggleLanes(ids: string[]) {
	if (ids.length === 0) return;
	const { open } = keyframeLanes.get();
	const all = ids.every((id) => open.includes(id));
	keyframeLanes.set({
		open: all ? open.filter((id) => !ids.includes(id)) : [...new Set([...open, ...ids])],
	});
}

export function clearKeySelection() {
	const { selected, clipId } = keyframeLanes.get();
	if (selected.length || clipId) keyframeLanes.set({ clipId: null, selected: [] });
}

/** The selected keyframes that still exist (an undo may have removed some). */
export function selectedKeys(): { clip: MediaClip; keys: KeyRef[] } | null {
	const { clipId, selected } = keyframeLanes.get();
	const clip = app.get().state?.project?.data.clips.find((c) => c.id === clipId);
	if (clip?.type !== "media" || selected.length === 0) return null;
	const keys = selected.filter((r) =>
		clip.keyframes?.[r.prop]?.some((k) => Math.abs(k.atMs - r.atMs) <= 10),
	);
	return keys.length ? { clip, keys } : null;
}

/** Deletes the selected keyframes in one undo step; false when none are selected. */
export function deleteSelectedKeys(): boolean {
	const found = selectedKeys();
	clearKeySelection();
	if (!found) return false;
	void run("edit_keyframes", {
		clipId: found.clip.id,
		edits: found.keys.map((k) => ({ ...k, remove: true })),
	});
	return true;
}
