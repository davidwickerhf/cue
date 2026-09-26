import { useEffect } from "react";
import type { Clip } from "../../electron/core/types";
import { run } from "../lib/api";
import { playback } from "../lib/playback";
import { recorder } from "../lib/recorder";
import { app, appSettings, editor, findLine } from "../lib/state";

function typing(target: EventTarget | null) {
	const el = target as HTMLElement | null;
	return (
		!!el &&
		(el.tagName === "INPUT" ||
			el.tagName === "TEXTAREA" ||
			el.tagName === "SELECT" ||
			el.isContentEditable)
	);
}

/** Copied clips, positioned relative to the earliest one. */
let clipboard: Clip[] = [];

function pasteAt(ms: number) {
	if (clipboard.length === 0) return;
	const first = Math.min(...clipboard.map((c) => c.startMs));
	const clips = clipboard.map((c) => {
		const { id: _id, groupId: _g, ...rest } = c as Clip & { lineId?: string };
		const base = { ...rest, startMs: Math.round(ms + c.startMs - first) } as Record<
			string,
			unknown
		>;
		delete base.lineId;
		delete base.source;
		delete base.transitionIn;
		return base;
	});
	void run("add_clips", { clips });
}

/** Clip boundaries, for jumping between edit points. */
function editPoints(): number[] {
	const clips = app.get().state?.project?.data.clips ?? [];
	return [...new Set(clips.flatMap((c) => [c.startMs, c.startMs + c.durationMs]))].sort(
		(a, b) => a - b,
	);
}

/**
 * Keyboard shortcuts following Premiere Pro (then Resolve / Final Cut) so
 * nothing has to be relearned. The full list lives in lib/shortcuts.ts.
 */
export function useShortcuts() {
	useEffect(() => {
		let shuttleRate = 0;
		const onKey = (e: KeyboardEvent) => {
			if (typing(e.target) || appSettings.get().open) return;
			const state = app.get().state;
			const project = state?.project;
			if (!project) return;
			const selected = state.selectedClipIds;
			const frame = 1000 / project.data.canvas.fps;
			const key = e.key.toLowerCase();
			const mod = e.metaKey || e.ctrlKey;
			const selectedClips = project.data.clips.filter((c) => selected.includes(c.id));
			const handled = () => e.preventDefault();

			if (recorder.status.get().phase !== "idle") {
				if (key === "escape") recorder.cancel();
				else if (key === " " || key === "enter") void recorder.stop();
				handled();
				return;
			}
			if (key !== "j" && key !== "l") shuttleRate = 0;

			// Playback
			if (key === " ") {
				handled();
				playback.toggle();
			} else if (key === "l" && !mod) {
				shuttleRate = shuttleRate > 0 ? Math.min(4, shuttleRate * 2) : 1;
				playback.shuttle(shuttleRate);
			} else if (key === "j" && !mod) {
				shuttleRate = shuttleRate < 0 ? Math.max(-4, shuttleRate * 2) : -1;
				playback.shuttle(shuttleRate);
			} else if (key === "k" && !mod) playback.pause();
			else if ((key === "arrowleft" || key === "arrowright") && e.altKey && selected.length) {
				handled();
				void run("move_clips", {
					ids: selected,
					deltaMs: Math.round(key === "arrowleft" ? -frame : frame),
				});
			} else if (key === "arrowleft" || key === "arrowright") {
				handled();
				playback.seek(
					playback.currentMs + (key === "arrowleft" ? -1 : 1) * frame * (e.shiftKey ? 5 : 1),
				);
			} else if (key === "arrowup" || key === "arrowdown") {
				handled();
				const now = playback.currentMs;
				const points = editPoints();
				const next =
					key === "arrowdown"
						? points.find((p) => p > now + 1)
						: [...points].reverse().find((p) => p < now - 1);
				if (next !== undefined) playback.seek(next);
			} else if (key === "home") playback.seek(0);
			else if (key === "end") playback.seek(project.durationMs);
			else if (key === "i" && !mod) editor.set({ inPoint: Math.round(playback.currentMs) });
			else if (key === "o" && !mod) editor.set({ outPoint: Math.round(playback.currentMs) });
			else if (key === "x" && e.altKey) editor.set({ inPoint: null, outPoint: null });
			else if (key === "/" && !mod) {
				const { inPoint, outPoint } = editor.get();
				playback.play({ fromMs: inPoint ?? playback.currentMs, toMs: outPoint ?? undefined });
			}
			// Tools
			else if (key === "v" && !mod) editor.set({ tool: "select" });
			else if ((key === "c" || key === "b") && !mod) editor.set({ tool: "blade" });
			else if (key === "y" && !mod) editor.set({ tool: "slip" });
			else if (key === "n" && !mod) editor.set({ tool: "roll" });
			else if (key === "u" && !mod) editor.set({ tool: "slide" });
			else if (key === "s" && !mod) editor.set({ snapping: !editor.get().snapping });
			// Editing
			else if ((key === "k" || key === "b") && mod) {
				handled();
				const tracks = selected.length
					? [...new Set(selectedClips.map((c) => c.trackId))]
					: undefined;
				void run("split_at", { atMs: Math.round(playback.currentMs), trackIds: tracks });
			} else if ((key === "backspace" || key === "delete") && selected.length) {
				handled();
				void run("delete_clips", { ids: selected, ripple: e.shiftKey || editor.get().ripple });
			} else if ((key === "d" || key === "t") && mod && selected.length) {
				handled();
				for (const c of selectedClips)
					if (c.type === "media")
						void run("add_transition", { clipId: c.id, kind: "crossfade", durationMs: 500 });
			} else if (key === "l" && mod && selected.length) {
				handled();
				const linked = selectedClips.every(
					(c) => c.groupId && c.groupId === selectedClips[0].groupId,
				);
				void run(linked ? "ungroup_clips" : "group_clips", { ids: selected });
			} else if (key === "g" && mod && selected.length) {
				handled();
				void run(e.shiftKey ? "ungroup_clips" : "group_clips", { ids: selected });
			} else if (key === "a" && mod) {
				handled();
				window.cue.selectClips(project.data.clips.map((c) => c.id));
			} else if (key === "escape") window.cue.selectClips([]);
			else if (key === "m" && !mod)
				void run("add_marker", { atMs: Math.round(playback.currentMs), label: "Marker" });
			// Timeline
			else if (key === "=" || key === "+")
				editor.set({ zoom: Math.min(600, editor.get().zoom * 1.25) });
			else if (key === "-") editor.set({ zoom: Math.max(4, editor.get().zoom / 1.25) });
			else if (key === "\\") window.dispatchEvent(new CustomEvent("cue:fit"));
			// Voiceover
			else if (key === "r" && !mod) {
				const line = findLine(project, state.selectedLineId);
				if (line) void recorder.record(project, line);
			}
		};
		// The Edit menu's copy/cut/paste arrive as clipboard events rather than key presses.
		const onClipboard = (e: ClipboardEvent) => {
			if (typing(e.target) || typing(document.activeElement)) return;
			const state = app.get().state;
			const project = state?.project;
			if (!project) return;
			const selectedClips = project.data.clips.filter((c) => state.selectedClipIds.includes(c.id));
			if (e.type === "paste") pasteAt(playback.currentMs);
			else if (selectedClips.length) {
				clipboard = selectedClips;
				if (e.type === "cut") void run("delete_clips", { ids: selectedClips.map((c) => c.id) });
			}
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		document.addEventListener("copy", onClipboard);
		document.addEventListener("cut", onClipboard);
		document.addEventListener("paste", onClipboard);
		return () => {
			window.removeEventListener("keydown", onKey);
			document.removeEventListener("copy", onClipboard);
			document.removeEventListener("cut", onClipboard);
			document.removeEventListener("paste", onClipboard);
		};
	}, []);
}
