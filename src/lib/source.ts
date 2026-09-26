import type { Asset, ProjectSnapshot } from "../../electron/core/types";
import { notify, run } from "./api";
import { playback } from "./playback";
import { app, createStore } from "./state";

/**
 * The source monitor: a clip from the media bin opened on its own, with its
 * own in and out marks, ready to insert (,) or overwrite (.) at the timeline
 * playhead, as in Premiere, Resolve and Avid.
 */
export const source = createStore<{
	assetId: string | null;
	/** The viewer shows the source instead of the timeline. */
	active: boolean;
	inMs: number | null;
	outMs: number | null;
	currentMs: number;
	playing: boolean;
}>({ assetId: null, active: false, inMs: null, outMs: null, currentMs: 0, playing: false });

let element: HTMLMediaElement | null = null;

export function attachSource(el: HTMLMediaElement | null) {
	element = el;
}

export function openSource(assetId: string) {
	playback.pause();
	const same = source.get().assetId === assetId;
	source.set({
		assetId,
		active: true,
		...(same ? {} : { inMs: null, outMs: null, currentMs: 0, playing: false }),
	});
}

export function showTimeline() {
	element?.pause();
	source.set({ active: false, playing: false });
}

export function closeSource() {
	element?.pause();
	source.set({ assetId: null, active: false, inMs: null, outMs: null, playing: false });
}

export function toggleSource() {
	if (!element) return;
	if (element.paused) void element.play();
	else element.pause();
}

export function seekSource(ms: number) {
	if (!element) return;
	const max = (element.duration || 0) * 1000;
	element.currentTime = Math.max(0, Math.min(max || ms, ms)) / 1000;
	source.set({ currentMs: element.currentTime * 1000 });
}

export function markSource(which: "in" | "out") {
	const ms = Math.round((element?.currentTime ?? 0) * 1000);
	source.set(which === "in" ? { inMs: ms } : { outMs: ms });
}

function currentAsset(project: ProjectSnapshot): Asset | undefined {
	return project.data.assets.find((a) => a.id === source.get().assetId);
}

/** The track a source edit lands on: the selected clip's track if it fits, else the first free one of the right kind. */
function targetTrack(project: ProjectSnapshot, asset: Asset): string | undefined {
	const kind = asset.kind === "audio" ? "audio" : "video";
	const selected = app.get().state?.selectedClipIds ?? [];
	const selectedTrack = project.data.clips.find((c) => selected.includes(c.id))?.trackId;
	const fits = (id?: string) => {
		const t = project.data.tracks.find((x) => x.id === id);
		return !!t && t.kind === kind && !t.locked;
	};
	if (fits(selectedTrack)) return selectedTrack;
	const tracks = project.data.tracks.filter((t) => t.kind === kind && !t.locked);
	// Prefer the lowest video track (V1) and, for sound, a track that is not the voiceover.
	return kind === "video" ? tracks.at(-1)?.id : (tracks.find((t) => !t.voiceover) ?? tracks[0])?.id;
}

export async function sourceEdit(mode: "insert" | "overwrite") {
	const project = app.get().state?.project;
	if (!project) return;
	const asset = currentAsset(project);
	if (!asset) return notify("Open a clip in the source monitor first (double-click it in Media).");
	const trackId = targetTrack(project, asset);
	if (!trackId)
		return notify(`Add an unlocked ${asset.kind === "audio" ? "audio" : "video"} track first.`);
	const { inMs, outMs } = source.get();
	await run("insert_edit", {
		mode,
		assetId: asset.id,
		trackId,
		atMs: Math.round(playback.currentMs),
		inMs: inMs ?? undefined,
		outMs: outMs ?? undefined,
	});
}
