import { createStore, editor, type SidebarPanel } from "./state";

/**
 * Workspaces, as in Premiere and Resolve. Each one sets up the editor for a
 * kind of work: panel sizes, which panel is docked beside the viewer, how tall
 * each kind of track is, which viewer overlays are on and which inspector
 * sections are open. The current layout and saved workspaces persist.
 */

/** A pane docked between the viewer and the inspector. */
export type Dock = "none" | "mixer" | "scopes" | "agent" | "history" | "markers" | "notes";

export interface Layout {
	/** The workspace this layout came from (built-in id or saved name). */
	id?: string;
	sidebarWidth: number;
	inspectorWidth: number;
	timelineHeight: number;
	panel: SidebarPanel;
	sidebarOpen: boolean;
	inspectorOpen: boolean;
	dock: Dock;
	dockWidth: number;
	/** Track heights by kind (a track the user resized keeps its own height). */
	tracks: { video: number; audio: number; text: number };
	/**
	 * Viewer overlays. sourceTwoUp puts the source monitor beside the viewer
	 * instead of over it; compare shows the before/after controls; clipStrip
	 * shows the timeline's shots under the viewer, for grading one by one.
	 */
	overlays: {
		safeAreas: boolean;
		teleprompter: boolean;
		compare: boolean;
		sourceTwoUp: boolean;
		clipStrip: boolean;
	};
	/** Inspector sections open by default; every other section starts collapsed. Empty: all open. */
	sections: string[];
}

const BASE: Layout = {
	sidebarWidth: 300,
	inspectorWidth: 300,
	timelineHeight: 320,
	panel: "media",
	sidebarOpen: true,
	inspectorOpen: true,
	dock: "none",
	dockWidth: 320,
	tracks: { video: 58, audio: 50, text: 34 },
	overlays: {
		safeAreas: false,
		teleprompter: false,
		compare: false,
		sourceTwoUp: false,
		clipStrip: false,
	},
	sections: [],
};

const workspace = (label: string, keys: string, layout: Partial<Layout>) => ({
	label,
	/** Shortcut shown in the menu. */
	keys,
	layout: { ...BASE, ...layout },
});

export const BUILT_IN: Record<string, ReturnType<typeof workspace>> = {
	editing: workspace("Editing", "⌥1", {
		overlays: { ...BASE.overlays, sourceTwoUp: true },
	}),
	audio: workspace("Audio", "⌥2", {
		sidebarWidth: 260,
		timelineHeight: 440,
		dock: "mixer",
		dockWidth: 380,
		tracks: { video: 30, audio: 96, text: 26 },
		sections: ["Audio", "Timing"],
	}),
	colour: workspace("Colour", "⌥3", {
		sidebarWidth: 240,
		inspectorWidth: 340,
		timelineHeight: 230,
		dock: "scopes",
		dockWidth: 300,
		tracks: { video: 72, audio: 30, text: 28 },
		overlays: { ...BASE.overlays, compare: true, clipStrip: true },
		sections: ["Colour", "Effects", "Mask", "Chroma key"],
	}),
	voiceover: workspace("Voiceover", "⌥4", {
		sidebarWidth: 380,
		timelineHeight: 300,
		panel: "script",
		inspectorOpen: false,
		tracks: { video: 34, audio: 72, text: 26 },
		overlays: { ...BASE.overlays, teleprompter: true },
	}),
	titles: workspace("Titles", "⌥5", {
		sidebarWidth: 320,
		inspectorWidth: 340,
		timelineHeight: 280,
		panel: "text",
		tracks: { video: 40, audio: 30, text: 56 },
		overlays: { ...BASE.overlays, safeAreas: true },
		sections: ["Text", "Style", "Layout", "Animation", "Timing"],
	}),
	agent: workspace("Agent", "⌥6", {
		sidebarWidth: 420,
		panel: "agent",
		dock: "history",
		dockWidth: 300,
		inspectorOpen: false,
	}),
	review: workspace("Review", "⌥7", {
		sidebarOpen: false,
		inspectorOpen: false,
		timelineHeight: 200,
		dock: "notes",
		dockWidth: 320,
		tracks: { video: 34, audio: 28, text: 24 },
	}),
};

const LAYOUT_KEY = "cue.layout";
const SAVED_KEY = "cue.workspaces";

/** A layout from storage or an older version, completed with defaults. */
const complete = (l: Partial<Layout>): Layout => ({
	...BASE,
	...l,
	tracks: { ...BASE.tracks, ...l.tracks },
	overlays: { ...BASE.overlays, ...l.overlays },
	sections: l.sections ?? [],
});

function load<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : fallback;
	} catch {
		return fallback;
	}
}

// A first launch starts in the Editing workspace, with all of its settings.
export const layout = createStore<Layout>(
	complete(load(LAYOUT_KEY, { ...BUILT_IN.editing.layout, id: "editing" })),
);
export const savedWorkspaces = createStore<{ list: Record<string, Layout> }>({
	list: Object.fromEntries(
		Object.entries(load<Record<string, Partial<Layout>>>(SAVED_KEY, {})).map(([k, v]) => [
			k,
			complete(v),
		]),
	),
});

layout.subscribe(() => {
	try {
		localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout.get()));
	} catch {}
});

// The panel and inspector toggles live in the editor store; keep both in step.
editor.set({ panel: layout.get().panel, inspectorOpen: layout.get().inspectorOpen });
editor.subscribe(() => {
	const { panel, inspectorOpen } = editor.get();
	const current = layout.get();
	if (current.panel !== panel || current.inspectorOpen !== inspectorOpen)
		layout.set({ panel, inspectorOpen });
});

export const clampLayout = (l: Partial<Layout>): Partial<Layout> => ({
	...l,
	...(l.sidebarWidth !== undefined
		? { sidebarWidth: Math.min(560, Math.max(220, l.sidebarWidth)) }
		: {}),
	...(l.inspectorWidth !== undefined
		? { inspectorWidth: Math.min(520, Math.max(240, l.inspectorWidth)) }
		: {}),
	...(l.dockWidth !== undefined ? { dockWidth: Math.min(640, Math.max(220, l.dockWidth)) } : {}),
	...(l.timelineHeight !== undefined
		? { timelineHeight: Math.min(720, Math.max(160, l.timelineHeight)) }
		: {}),
});

/**
 * Inspector sections the user opened or closed, by title. A workspace resets
 * them to its own choice; the user's clicks win until the next switch.
 */
export const sections = createStore<{ collapsed: Record<string, boolean> }>({ collapsed: {} });

export function toggleSection(title: string) {
	const collapsed = sections.get().collapsed;
	sections.set({ collapsed: { ...collapsed, [title]: !isCollapsed(title) } });
}

export function isCollapsed(title: string): boolean {
	const own = sections.get().collapsed[title];
	if (own !== undefined) return own;
	const open = layout.get().sections;
	return open.length > 0 && !open.includes(title);
}

export function applyWorkspace(next: Layout, id?: string) {
	const l = complete({ ...next, id: id ?? next.id });
	layout.set(l);
	sections.set({ collapsed: {} });
	editor.set({ panel: l.panel, inspectorOpen: l.inspectorOpen });
}

/** Switches to a built-in workspace by id (menu, ⌥1–⌥7, agents). */
export function switchWorkspace(id: string) {
	const w = BUILT_IN[id];
	if (w) applyWorkspace(w.layout, id);
}

export function saveWorkspace(name: string) {
	const list = { ...savedWorkspaces.get().list, [name]: { ...layout.get(), id: name } };
	savedWorkspaces.set({ list });
	layout.set({ id: name });
	localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}

export function deleteWorkspace(name: string) {
	const list = { ...savedWorkspaces.get().list };
	delete list[name];
	savedWorkspaces.set({ list });
	localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}

/**
 * Before/after in the viewer: hold shows the original while pressed; split
 * shows the original left of a divider and the graded picture right of it.
 * UI state only, never saved with the project.
 */
export const compareView = createStore<{ split: boolean; at: number }>({ split: false, at: 0.5 });
