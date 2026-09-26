import { createStore, editor, type SidebarPanel } from "./state";

/**
 * Window layouts ("workspaces"), as in Premiere and Resolve: panel sizes and
 * which panels are open. The current layout and saved workspaces persist.
 */
export interface Layout {
	sidebarWidth: number;
	inspectorWidth: number;
	timelineHeight: number;
	panel: SidebarPanel;
	inspectorOpen: boolean;
}

export const BUILT_IN: Record<string, { label: string; layout: Layout }> = {
	editing: {
		label: "Editing",
		layout: {
			sidebarWidth: 300,
			inspectorWidth: 300,
			timelineHeight: 320,
			panel: "media",
			inspectorOpen: true,
		},
	},
	audio: {
		label: "Audio",
		layout: {
			sidebarWidth: 340,
			inspectorWidth: 300,
			timelineHeight: 440,
			panel: "mixer",
			inspectorOpen: false,
		},
	},
	colour: {
		label: "Colour",
		layout: {
			sidebarWidth: 260,
			inspectorWidth: 380,
			timelineHeight: 240,
			panel: "media",
			inspectorOpen: true,
		},
	},
	voiceover: {
		label: "Voiceover",
		layout: {
			sidebarWidth: 360,
			inspectorWidth: 300,
			timelineHeight: 300,
			panel: "script",
			inspectorOpen: false,
		},
	},
	titles: {
		label: "Titles",
		layout: {
			sidebarWidth: 320,
			inspectorWidth: 340,
			timelineHeight: 280,
			panel: "text",
			inspectorOpen: true,
		},
	},
	agent: {
		label: "Agent",
		layout: {
			sidebarWidth: 400,
			inspectorWidth: 300,
			timelineHeight: 300,
			panel: "agent",
			inspectorOpen: true,
		},
	},
};

const LAYOUT_KEY = "cue.layout";
const SAVED_KEY = "cue.workspaces";

function load<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
	} catch {
		return fallback;
	}
}

export const layout = createStore<Layout>(load(LAYOUT_KEY, BUILT_IN.editing.layout));
export const savedWorkspaces = createStore<{ list: Record<string, Layout> }>({
	list: load(SAVED_KEY, {}),
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
	...(l.timelineHeight !== undefined
		? { timelineHeight: Math.min(720, Math.max(160, l.timelineHeight)) }
		: {}),
});

export function applyWorkspace(next: Layout) {
	layout.set(next);
	editor.set({ panel: next.panel, inspectorOpen: next.inspectorOpen });
}

export function saveWorkspace(name: string) {
	const list = { ...savedWorkspaces.get().list, [name]: layout.get() };
	savedWorkspaces.set({ list });
	localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}

export function deleteWorkspace(name: string) {
	const list = { ...savedWorkspaces.get().list };
	delete list[name];
	savedWorkspaces.set({ list });
	localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}
