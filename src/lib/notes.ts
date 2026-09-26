import type { Note } from "../../electron/core/notes";
import { run } from "./api";
import { createStore } from "./state";

/**
 * The latest director's notes, shared by the Notes pane and the timeline
 * ruler (which marks where they are). Empty while the pane is closed.
 */
export const notes = createStore<{ list: Note[]; loading: boolean; measured: boolean }>({
	list: [],
	loading: false,
	measured: false,
});

let latest = 0;

/** Reviews the open timeline again; later calls win over slower earlier ones. */
export async function refreshNotes(measureAudio = false) {
	const ticket = ++latest;
	notes.set({ loading: true });
	const result = await run<{ notes: Note[] }>("review_edit", { measureAudio });
	if (ticket !== latest) return;
	notes.set({
		loading: false,
		...(result ? { list: result.notes } : {}),
		...(measureAudio && result ? { measured: true } : {}),
	});
}

export function clearNotes() {
	latest++;
	notes.set({ list: [], loading: false, measured: false });
}
