import { useEffect } from "react";
import { run } from "../lib/api";
import { playback } from "../lib/playback";
import { recorder } from "../lib/recorder";
import { app, editor, findLine } from "../lib/state";

function typing(target: EventTarget | null) {
	const el = target as HTMLElement | null;
	return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/** Editor keyboard shortcuts (menus handle ⌘Z / ⌘⇧Z / ⌘S / ⌘I). */
export function useShortcuts() {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (typing(e.target)) return;
			const state = app.get().state;
			const project = state?.project;
			if (!project) return;
			const selected = state.selectedClipIds;
			const frame = 1000 / project.data.canvas.fps;
			const recording = recorder.status.get().phase !== "idle";
			const key = e.key.toLowerCase();
			const mod = e.metaKey || e.ctrlKey;

			if (recording) {
				if (key === "escape") recorder.cancel();
				else if (key === " " || key === "enter") void recorder.stop();
				e.preventDefault();
				return;
			}
			if (key === " ") {
				e.preventDefault();
				playback.toggle();
			} else if (key === "arrowleft" || key === "arrowright") {
				e.preventDefault();
				const step = e.shiftKey ? 1000 : frame;
				playback.seek(playback.currentMs + (key === "arrowleft" ? -step : step));
			} else if (key === "home") playback.seek(0);
			else if (key === "end") playback.seek(project.durationMs);
			else if (key === "s" && !mod) void run("split_at", { atMs: playback.currentMs, trackIds: selected.length ? [...new Set(project.data.clips.filter((c) => selected.includes(c.id)).map((c) => c.trackId))] : undefined });
			else if ((key === "backspace" || key === "delete") && selected.length) {
				e.preventDefault();
				void run("delete_clips", { ids: selected, ripple: e.shiftKey || editor.get().ripple });
			} else if (key === "d" && mod && selected.length) {
				e.preventDefault();
				void run("duplicate_clips", { ids: selected });
			} else if (key === "a" && mod) {
				e.preventDefault();
				window.cue.selectClips(project.data.clips.map((c) => c.id));
			} else if (key === "escape") window.cue.selectClips([]);
			else if (key === "b") editor.set({ tool: editor.get().tool === "blade" ? "select" : "blade" });
			else if (key === "v") editor.set({ tool: "select" });
			else if (key === "n") editor.set({ snapping: !editor.get().snapping });
			else if (key === "=" || key === "+") editor.set({ zoom: Math.min(600, editor.get().zoom * 1.25) });
			else if (key === "-") editor.set({ zoom: Math.max(4, editor.get().zoom / 1.25) });
			else if (key === "r" && !mod) {
				const line = findLine(project, state.selectedLineId);
				if (line) void recorder.record(project, line);
			} else if (key === "k" && !mod) playback.pause();
			else if (key === "l" && !mod) {
				if (!playback.playing) playback.play();
			} else if (key === "j" && !mod) playback.seek(playback.currentMs - 5000);
			else if (key === "i" && !mod) editor.set({ inPoint: Math.round(playback.currentMs) });
			else if (key === "o" && !mod) editor.set({ outPoint: Math.round(playback.currentMs) });
			else if (key === "x" && !mod) editor.set({ inPoint: null, outPoint: null });
			else if (key === "/" && !mod) {
				const { inPoint, outPoint } = editor.get();
				playback.play({ fromMs: inPoint ?? playback.currentMs, toMs: outPoint ?? undefined });
			} else if (key === "m" && !mod) void run("add_marker", { atMs: playback.currentMs, label: "Marker" });
			else if (key === "arrowup" || key === "arrowdown") {
				const lines = project.lines;
				const index = lines.findIndex((l) => l.id === state.selectedLineId);
				const next = lines[Math.min(lines.length - 1, Math.max(0, index + (key === "arrowup" ? -1 : 1)))];
				if (next) {
					e.preventDefault();
					window.cue.selectLine(next.id);
					playback.seek(Math.max(0, next.startMs - 500));
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
}
