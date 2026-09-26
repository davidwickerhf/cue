/**
 * Keyboard conventions borrowed from the editors people already know
 * (Premiere Pro first, then DaVinci Resolve and Final Cut Pro), so nothing
 * has to be relearned. Shown in Settings → Shortcuts.
 */
export const SHORTCUTS: {
	title: string;
	items: { label: string; keys: string[]; note?: string }[];
}[] = [
	{
		title: "Playback",
		items: [
			{ label: "Play / pause", keys: ["Space"] },
			{
				label: "Shuttle back / stop / forward",
				keys: ["J", "K", "L"],
				note: "Press L again to play faster",
			},
			{ label: "Previous / next frame", keys: ["←", "→"] },
			{ label: "Back / forward 5 frames", keys: ["⇧←", "⇧→"] },
			{ label: "Previous / next edit point", keys: ["↑", "↓"] },
			{ label: "Go to start / end", keys: ["Home", "End"] },
			{ label: "Mark in / out", keys: ["I", "O"] },
			{ label: "Play in to out", keys: ["/"] },
			{ label: "Clear in and out", keys: ["⌥X"] },
		],
	},
	{
		title: "Tools",
		items: [
			{ label: "Selection", keys: ["V"] },
			{ label: "Blade (razor)", keys: ["C"], note: "B works too" },
			{
				label: "Slip",
				keys: ["Y"],
				note: "Drag a clip to change which part of the source it shows",
			},
			{ label: "Rolling edit", keys: ["N"], note: "Drag a cut between two clips" },
			{ label: "Slide", keys: ["U"], note: "Drag a clip between its neighbours" },
			{ label: "Snapping", keys: ["S"] },
		],
	},
	{
		title: "Editing",
		items: [
			{ label: "Split at playhead", keys: ["⌘K"], note: "⌘B also works" },
			{ label: "Delete", keys: ["⌫"] },
			{ label: "Ripple delete", keys: ["⇧⌫"] },
			{ label: "Copy / cut / paste at playhead", keys: ["⌘C", "⌘X", "⌘V"] },
			{ label: "Duplicate by dragging", keys: ["⌥ drag"] },
			{ label: "Add crossfade", keys: ["⌘D"], note: "⌘T also works" },
			{ label: "Link / unlink", keys: ["⌘L"] },
			{ label: "Group / ungroup", keys: ["⌘G", "⇧⌘G"] },
			{ label: "Nudge clip one frame", keys: ["⌥←", "⌥→"] },
			{ label: "Select all / none", keys: ["⌘A", "Esc"] },
			{ label: "Add marker", keys: ["M"] },
			{ label: "Undo / redo", keys: ["⌘Z", "⇧⌘Z"] },
		],
	},
	{
		title: "Source monitor",
		items: [
			{ label: "Open a clip", keys: ["Double-click in Media"] },
			{
				label: "Mark in / out, play",
				keys: ["I", "O", "Space"],
				note: "While the source is showing",
			},
			{ label: "Insert / overwrite at the playhead", keys: [",", "."] },
			{ label: "Back to the timeline", keys: ["Esc"] },
		],
	},
	{
		title: "Timeline",
		items: [
			{ label: "Zoom in / out", keys: ["=", "-"] },
			{ label: "Zoom to fit", keys: ["\\"] },
			{ label: "Zoom around pointer", keys: ["⌘ scroll"] },
		],
	},
	{
		title: "Voiceover",
		items: [
			{ label: "Record the selected line", keys: ["R"] },
			{ label: "Stop and keep the take", keys: ["Space"] },
			{ label: "Discard the take", keys: ["Esc"] },
		],
	},
	{
		title: "App",
		items: [
			{ label: "Settings", keys: ["⌘,"] },
			{ label: "New / open project", keys: ["⌘N", "⌘O"] },
			{ label: "Import media", keys: ["⌘I"] },
		],
	},
];
