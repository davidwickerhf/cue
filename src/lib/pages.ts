import { createStore } from "./state";
import { BUILT_IN, layout, switchWorkspace } from "./workspace";

/**
 * Pages, like DaVinci Resolve's: a place for each job, switched from the page
 * bar at the bottom of the window or with ⌥1–⌥9. Most pages are the editor laid
 * out for the job (a workspace); Motion (one motion graphic at a time, like an
 * After Effects composition) and Deliver (export) are screens of their own.
 * The same project flows through all of them.
 */

export type PageId =
	| "edit"
	| "motion"
	| "titles"
	| "colour"
	| "audio"
	| "voice"
	| "review"
	| "deliver"
	| "agent";

export interface Page {
	id: PageId;
	label: string;
	/** The workspace it lays the editor out as; none for pages with their own screen. */
	workspace?: string;
	keys: string;
	/** One line for the page bar's tooltip. */
	about: string;
}

/** In the order a video is usually made (the page bar's order). */
export const PAGES: Page[] = [
	{
		id: "edit",
		label: "Edit",
		workspace: "editing",
		keys: "⌥1",
		about: "Cut the story: media, timeline and viewer",
	},
	{
		id: "motion",
		label: "Motion",
		keys: "⌥8",
		about: "Design one motion graphic: its layers, text, colours and timing",
	},
	{
		id: "titles",
		label: "Titles",
		workspace: "titles",
		keys: "⌥5",
		about: "Titles, captions and text on screen",
	},
	{
		id: "colour",
		label: "Colour",
		workspace: "colour",
		keys: "⌥3",
		about: "Grade shot by shot with scopes and before/after",
	},
	{
		id: "audio",
		label: "Audio",
		workspace: "audio",
		keys: "⌥2",
		about: "Mix, clean up and level the sound",
	},
	{
		id: "voice",
		label: "Voice",
		workspace: "voiceover",
		keys: "⌥4",
		about: "Script and voiceover takes, with a teleprompter",
	},
	{
		id: "review",
		label: "Review",
		workspace: "review",
		keys: "⌥7",
		about: "Watch it through and leave notes",
	},
	{
		id: "deliver",
		label: "Deliver",
		keys: "⌥9",
		about: "Export for the web, a master, variants or sound",
	},
	{
		id: "agent",
		label: "Agent",
		workspace: "agent",
		keys: "⌥6",
		about: "Work with your agent, with the history beside it",
	},
];

const pageOf = (workspace: string | undefined): PageId =>
	PAGES.find((p) => p.workspace === workspace)?.id ?? "edit";

export const pageState = createStore<{ page: PageId; motionAssetId: string | null }>({
	page: pageOf(layout.get().id),
	motionAssetId: null,
});

/** Goes to a page (the page bar, ⌥1–⌥9, set_view page). Motion can open on a graphic. */
export function goToPage(id: PageId, options: { motionAssetId?: string } = {}) {
	const page = PAGES.find((p) => p.id === id);
	if (!page) return;
	if (page.workspace && BUILT_IN[page.workspace]) switchWorkspace(page.workspace);
	pageState.set({
		page: id,
		...(options.motionAssetId !== undefined ? { motionAssetId: options.motionAssetId } : {}),
	});
}

/** The page for ⌥ and a digit (the numbers the workspaces always had, Motion 8, Deliver 9). */
export function pageForDigit(digit: number): PageId | undefined {
	return PAGES.find((p) => p.keys === `⌥${digit}`)?.id;
}

/** Pages that show the editor's viewer (render_frame and captures need it on screen). */
export const hasViewer = (page: PageId) => page !== "motion" && page !== "deliver";

// Switching workspace from the workspace menu (or an agent) moves to its page.
layout.subscribe(() => {
	const page = PAGES.find((p) => p.workspace && p.workspace === layout.get().id);
	const current = pageState.get().page;
	if (page && page.id !== current && hasViewer(current)) pageState.set({ page: page.id });
});
