import { useSyncExternalStore } from "react";
import type { AppState, Clip, LineView, ProjectSnapshot } from "../../electron/core/types";

/** A tiny external store with selector hooks (no extra dependency). */
export function createStore<T extends object>(initial: T) {
	let state = initial;
	const listeners = new Set<() => void>();
	const get = () => state;
	const set = (patch: Partial<T> | ((current: T) => Partial<T>)) => {
		const next = typeof patch === "function" ? patch(state) : patch;
		state = { ...state, ...next };
		for (const listener of listeners) listener();
	};
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	function use<S>(selector: (value: T) => S): S {
		return useSyncExternalStore(subscribe, () => selector(state));
	}
	return { get, set, subscribe, use };
}

// ---------------------------------------------------------------------------
// App state mirrored from the main process
// ---------------------------------------------------------------------------

export const app = createStore<{ state: AppState | null }>({ state: null });

/** Keeps object identity for parts that did not change, so React skips re-rendering them. */
function merge(prev: AppState | null, next: AppState): AppState {
	if (!prev) return next;
	const sameProject = prev.project && next.project && prev.project.revision === next.project.revision && prev.project.path === next.project.path;
	return {
		...next,
		project: sameProject && prev.project ? (prev.project.dirty === next.project?.dirty ? prev.project : { ...prev.project, dirty: next.project?.dirty ?? false }) : next.project,
		activity: prev.activity[0]?.id === next.activity[0]?.id ? prev.activity : next.activity,
		selectedClipIds: prev.selectedClipIds.join() === next.selectedClipIds.join() ? prev.selectedClipIds : next.selectedClipIds,
		recent: JSON.stringify(prev.recent) === JSON.stringify(next.recent) ? prev.recent : next.recent,
		jobs: JSON.stringify(prev.jobs) === JSON.stringify(next.jobs) ? prev.jobs : next.jobs,
	};
}

export function startSync() {
	void window.cue.getState().then((state) => app.set((current) => ({ state: merge(current.state, state) })));
	return window.cue.onState((state) => app.set((current) => ({ state: merge(current.state, state) })));
}

export const useApp = <S,>(selector: (state: AppState) => S): S | undefined =>
	app.use((value) => (value.state ? selector(value.state) : undefined));

export const useProject = (): ProjectSnapshot | null => app.use((value) => value.state?.project ?? null);

export function findClip(project: ProjectSnapshot | null, id: string): Clip | undefined {
	return project?.data.clips.find((clip) => clip.id === id);
}

export function findLine(project: ProjectSnapshot | null, id: string | null): LineView | undefined {
	return id ? project?.lines.find((line) => line.id === id) : undefined;
}

// ---------------------------------------------------------------------------
// Editor-only state (not saved in the project)
// ---------------------------------------------------------------------------

export type SidebarPanel = "media" | "script" | "text" | "generate" | "agent" | "settings";
export type Tool = "select" | "blade";

export const editor = createStore({
	panel: "script" as SidebarPanel,
	tool: "select" as Tool,
	/** Pixels per second on the timeline. */
	zoom: 60,
	snapping: true,
	ripple: false,
	previewMode: "all" as "all" | "voiceover" | "muted",
	inspectorOpen: true,
	/** In and out points for playing or exporting a range. */
	inPoint: null as number | null,
	outPoint: null as number | null,
});
