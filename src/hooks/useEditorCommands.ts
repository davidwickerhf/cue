import { useEffect } from "react";
import type { TextClip } from "../../electron/core/types";
import { playback } from "../lib/playback";
import { recorder } from "../lib/recorder";
import { app, findLine } from "../lib/state";
import { rasterise } from "../lib/textDraw";

/** Carries out commands from the main process (and therefore from agents). */
export function useEditorCommands() {
	useEffect(() => {
		const offCommand = window.cue.onCommand(async (command) => {
			const project = app.get().state?.project ?? null;
			switch (command.type) {
				case "play":
					playback.play({ fromMs: command.fromMs, toMs: command.toMs });
					break;
				case "pause":
					playback.pause();
					break;
				case "seek":
					playback.seek(command.ms);
					break;
				case "stop":
					await recorder.stop();
					break;
				case "previewAsset": {
					const url = project?.assetUrls[command.assetId];
					if (url) playback.previewAsset(url);
					break;
				}
				case "record": {
					const line = findLine(project, command.lineId);
					if (!project || !line) {
						if (command.requestId) window.cue.failRecording(command.requestId, `No line ${command.lineId}.`);
						return;
					}
					window.cue.selectLine(line.id);
					await recorder.record(project, line, { prerollMs: command.prerollMs, requestId: command.requestId });
					break;
				}
				case "renderText": {
					try {
						if (!project) throw new Error("No project open.");
						const { width, height } = project.data.canvas;
						const images: Record<string, { still?: ArrayBuffer; frames?: ArrayBuffer[] }> = {};
						for (const id of command.clipIds) {
							const clip = project.data.clips.find((c): c is TextClip => c.id === id && c.type === "text");
							if (clip) images[id] = await rasterise(clip, width, height, command.fps);
						}
						window.cue.reply(command.requestId, null, images);
					} catch (error) {
						window.cue.reply(command.requestId, (error as Error).message);
					}
					break;
				}
				case "captureFrame": {
					try {
						await playback.seekAndSettle(command.atMs);
						const frame = document.querySelector<HTMLElement>("[data-stage-frame]");
						if (!frame) throw new Error("The preview is not visible.");
						const r = frame.getBoundingClientRect();
						window.cue.reply(command.requestId, null, { x: r.x, y: r.y, width: r.width, height: r.height });
					} catch (error) {
						window.cue.reply(command.requestId, (error as Error).message);
					}
					break;
				}
			}
		});
		// Tell the main process where the playhead is (for agents) a few times a second at most.
		let lastSent = 0;
		let lastPlaying = false;
		const offClock = playback.clock.subscribe(() => {
			const { playing, currentMs } = playback.clock.get();
			const now = performance.now();
			if (playing === lastPlaying && now - lastSent < 250) return;
			lastSent = now;
			lastPlaying = playing;
			window.cue.reportRecorder({ playing, currentMs: Math.round(currentMs) });
		});
		return () => {
			offCommand();
			offClock();
		};
	}, []);
}
