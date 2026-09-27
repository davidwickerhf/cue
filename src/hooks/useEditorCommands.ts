import { useEffect } from "react";
import { steppedMs } from "../../electron/core/anim";
import { type MotionInfo, motionFrameAt } from "../../electron/core/motion";
import type { TextClip } from "../../electron/core/types";
import { librarySelection } from "../lib/assetLibrary";
import { capture } from "../lib/capture";
import { motionSettled, rasteriseMotion } from "../lib/motion";
import { playback } from "../lib/playback";
import { recorder } from "../lib/recorder";
import { openSource } from "../lib/source";
import { app, editor, findLine, type SidebarPanel } from "../lib/state";
import { styleSelection } from "../lib/styleLibrary";
import { rasterise } from "../lib/textDraw";
import { viewerZoom, zoomViewer } from "../lib/viewer";
import { compareView, type Dock, layout, sequenceCompare, switchWorkspace } from "../lib/workspace";

/** Carries out commands from the main process (and therefore from agents). */
export function useEditorCommands() {
	useEffect(() => {
		let capturing: { scale: number } | null = null;
		const endCapture = () => {
			delete document.body.dataset.capturing;
			if (capturing && capturing.scale !== 1) viewerZoom.set({ scale: capturing.scale });
			capturing = null;
		};
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
				case "recordScreen":
					void capture.start(
						{
							sourceId: command.sourceId,
							camera: command.camera,
							microphone: command.microphone,
							bubble: command.bubble,
							maxSeconds: command.maxSeconds,
							studio: command.studio,
							cameraId: command.cameraId,
							microphoneId: command.microphoneId,
						},
						command.requestId,
					);
					break;
				case "stopScreen":
					await capture.stop();
					break;
				case "listDevices": {
					try {
						const devices = await navigator.mediaDevices.enumerateDevices();
						// Labels are empty until the camera or microphone has been allowed once.
						const list = (kind: MediaDeviceKind, fallback: string) =>
							devices
								.filter((d) => d.kind === kind && d.deviceId !== "default")
								.map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
						window.cue.reply(command.requestId, null, {
							cameras: list("videoinput", "Camera"),
							microphones: list("audioinput", "Microphone"),
						});
					} catch (error) {
						window.cue.reply(command.requestId, (error as Error).message);
					}
					break;
				}
				case "setInOut":
					editor.set({
						...(command.inMs !== undefined ? { inPoint: command.inMs } : {}),
						...(command.outMs !== undefined ? { outPoint: command.outMs } : {}),
					});
					break;
				case "setView":
					if (command.workspace) switchWorkspace(command.workspace);
					if (command.panel) editor.set({ panel: command.panel as SidebarPanel });
					if (command.dock) layout.set({ dock: command.dock as Dock });
					if (command.zoom) editor.set({ zoom: command.zoom });
					if (command.fitTimeline) window.dispatchEvent(new CustomEvent("cue:fit"));
					if (command.openSource) openSource(command.openSource);
					if (command.overlays)
						layout.set({ overlays: { ...layout.get().overlays, ...command.overlays } });
					if (command.beforeAfter)
						compareView.set({
							split: command.beforeAfter.split,
							...(command.beforeAfter.at !== undefined ? { at: command.beforeAfter.at } : {}),
						});
					if (command.compareSequences !== undefined)
						sequenceCompare.set({ pair: command.compareSequences });
					if (command.viewerZoom !== undefined && project) {
						const zoom = command.viewerZoom;
						const width = project.data.canvas.width;
						// After a workspace switch has resized the viewer.
						requestAnimationFrame(() => requestAnimationFrame(() => zoomViewer(zoom, width)));
					}
					break;
				case "showStyle":
					styleSelection.set({ id: command.id });
					editor.set({ panel: "generate" });
					layout.set({ sidebarOpen: true });
					break;
				case "showLibraryAsset":
					librarySelection.set({ id: command.id });
					editor.set({ panel: "library" });
					layout.set({ sidebarOpen: true });
					break;
				case "pauseScreen":
					if (command.paused) capture.pause();
					else capture.resume();
					break;
				case "previewAsset": {
					const url = project?.assetUrls[command.assetId];
					if (url) playback.previewAsset(url);
					break;
				}
				case "record": {
					const line = findLine(project, command.lineId);
					if (!project || !line) {
						if (command.requestId)
							window.cue.failRecording(command.requestId, `No line ${command.lineId}.`);
						return;
					}
					window.cue.selectLine(line.id);
					await recorder.record(project, line, {
						prerollMs: command.prerollMs,
						requestId: command.requestId,
					});
					break;
				}
				case "renderText": {
					try {
						if (!project) throw new Error("No project open.");
						const width = command.width ?? project.data.canvas.width;
						const height = command.height ?? project.data.canvas.height;
						const images: Record<string, { still?: ArrayBuffer; frames?: ArrayBuffer[] }> = {};
						for (const id of command.clipIds) {
							const clip =
								command.clips?.find((c) => c.id === id) ??
								project.data.clips.find((c): c is TextClip => c.id === id && c.type === "text");
							if (clip?.type === "media") {
								const asset = project.data.assets.find((a) => a.id === clip.assetId);
								const url = project.assetUrls[clip.assetId];
								const size = command.sizes?.[id];
								if (asset?.motion && url && size) {
									const count = Math.max(1, Math.ceil((clip.durationMs / 1000) * command.fps));
									const frames = Array.from({ length: count }, (_, i) =>
										motionFrameAt(
											asset.motion as MotionInfo,
											clip,
											steppedMs((i * 1000) / command.fps, clip.stepFps),
										),
									);
									images[id] = {
										frames: await rasteriseMotion(
											url,
											clip.motion,
											frames,
											size.width,
											size.height,
										),
									};
								}
							} else if (clip) images[id] = await rasterise(clip, width, height, command.fps);
						}
						window.cue.reply(command.requestId, null, images);
					} catch (error) {
						window.cue.reply(command.requestId, (error as Error).message);
					}
					break;
				}
				case "captureFrame": {
					try {
						// Only the picture: no guides or handles, and the whole frame (not a zoomed-in part).
						capturing = { scale: viewerZoom.get().scale };
						document.body.dataset.capturing = "";
						if (capturing.scale !== 1) viewerZoom.set({ scale: 1 });
						await playback.seekAndSettle(command.atMs);
						// Motion graphics still loading are drawn once ready (the viewer redraws itself),
						// and pictures must have decoded, or the still would miss them.
						await motionSettled();
						await Promise.all(
							[...document.querySelectorAll<HTMLImageElement>("[data-stage-frame] img")]
								.filter((img) => img.src && img.style.display !== "none")
								.map((img) => img.decode().catch(() => {})),
						);
						// Big pictures take a few frames to be drawn in full after decoding.
						for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
						await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
						const frame = document.querySelector<HTMLElement>("[data-stage-frame]");
						if (!frame) throw new Error("The preview is not visible.");
						const r = frame.getBoundingClientRect();
						window.cue.reply(command.requestId, null, {
							x: r.x,
							y: r.y,
							width: r.width,
							height: r.height,
						});
					} catch (error) {
						endCapture();
						window.cue.reply(command.requestId, (error as Error).message);
					}
					break;
				}
				case "captureDone":
					endCapture();
					break;
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
		// And the in/out marks and open panel, so agents know what the user is looking at.
		let lastView = "";
		const offView = editor.subscribe(() => {
			const { inPoint, outPoint, panel } = editor.get();
			const key = `${inPoint}|${outPoint}|${panel}`;
			if (key === lastView) return;
			lastView = key;
			window.cue.reportRecorder({ inMs: inPoint, outMs: outPoint, panel });
		});
		return () => {
			offCommand();
			offClock();
			offView();
		};
	}, []);
}
