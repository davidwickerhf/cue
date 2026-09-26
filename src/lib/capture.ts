import type { CaptureResult } from "../../electron/controller";
import { SCREEN_ACCESS_HELP, type StudioChoice } from "../../electron/core/capture";
import { notify } from "./api";
import { playback } from "./playback";
import { createStore } from "./state";

export type CapturePhase = "idle" | "countdown" | "recording" | "paused" | "saving";

export interface CaptureChoice {
	/** A screen or window id, "screen" for the main screen, or null for the camera alone. */
	sourceId: string | null;
	camera: boolean;
	microphone: boolean;
	bubble: boolean;
	cameraId?: string;
	microphoneId?: string;
	maxSeconds?: number;
	/** The Recordly-style finish (wallpaper, smooth cursor, auto-zooms); null for the plain recording. */
	studio?: StudioChoice | null;
}

function stopAll(stream: MediaStream | null | undefined) {
	for (const track of stream?.getTracks() ?? []) track.stop();
}

/** Codecs to try, best first: H.264 is hardware-encoded on Macs, VP9 and VP8 are the fallbacks. */
function mimeFor(withAudio: boolean): string {
	const audio = withAudio ? ",opus" : "";
	return (
		[
			`video/webm;codecs=h264${audio}`,
			`video/webm;codecs=vp9${audio}`,
			`video/webm;codecs=vp8${audio}`,
			"video/webm",
		].find((m) => MediaRecorder.isTypeSupported(m)) ?? ""
	);
}

/** Turns getDisplayMedia / getUserMedia failures into something a person can act on. */
function explain(error: unknown, what: "screen" | "camera" | "microphone"): Error {
	const name = (error as Error)?.name;
	if (what === "screen" && (name === "NotAllowedError" || name === "NotReadableError"))
		return new Error(SCREEN_ACCESS_HELP);
	if (name === "NotAllowedError")
		return new Error(
			`${what === "camera" ? "Camera" : "Microphone"} access is off. Allow Cue in System Settings → Privacy & Security → ${what === "camera" ? "Camera" : "Microphone"}.`,
		);
	if (name === "NotFoundError" || name === "OverconstrainedError")
		return new Error(`No ${what} was found.`);
	return error instanceof Error ? error : new Error(String(error));
}

/**
 * Screen and camera recording in the editor window. Streams are opened for the
 * dialog's live preview and reused for the recording; MediaRecorder chunks go
 * to the main process as they come, so a long recording never sits in memory.
 */
class ScreenCapture {
	readonly status = createStore({
		phase: "idle" as CapturePhase,
		count: 0,
		elapsedMs: 0,
		maxSeconds: null as number | null,
		error: null as string | null,
	});
	/** Changes when the preview streams change, so video elements pick them up. */
	readonly streams = createStore({
		screen: null as MediaStream | null,
		camera: null as MediaStream | null,
	});
	private mic: MediaStream | null = null;
	private recorders: MediaRecorder[] = [];
	private sessionId: string | null = null;
	private requestId: string | undefined;
	private choice: CaptureChoice | null = null;
	private atMs = 0;
	private timer = 0;
	private startedAt = 0;
	private pausedMs = 0;
	private pausedAt = 0;
	private cancelled = false;
	private opened = {
		sourceId: undefined as string | null | undefined,
		cameraId: "",
		hideCursor: false,
	};
	private pointer: Promise<boolean> | null = null;
	/** Wall-clock start and pauses, to line the pointer up with the picture. */
	private clock = { startedAt: 0, pauses: [] as { from: number; to: number }[] };

	/** The real pointer is left out when the studio draws its own (and the pointer can be recorded). */
	private async hidesCursor(choice: CaptureChoice): Promise<boolean> {
		if (!choice.studio?.cursor || !choice.sourceId) return false;
		this.pointer ??= window.cue.pointerAvailable().catch(() => false);
		return this.pointer;
	}

	/** Opens (or swaps) the screen and camera streams for the preview and recording. */
	async preview(choice: CaptureChoice): Promise<void> {
		const { screen, camera } = this.streams.get();
		const hideCursor = await this.hidesCursor(choice);
		if (choice.sourceId !== this.opened.sourceId || hideCursor !== this.opened.hideCursor) {
			stopAll(screen);
			this.streams.set({ screen: null });
			this.opened.sourceId = choice.sourceId;
			this.opened.hideCursor = hideCursor;
			if (choice.sourceId) {
				window.cue.setCaptureSource(choice.sourceId);
				try {
					const stream = await navigator.mediaDevices.getDisplayMedia({
						video: {
							frameRate: { ideal: 30, max: 30 },
							...(hideCursor ? { cursor: "never" } : {}),
						} as MediaTrackConstraints,
						audio: false,
					});
					// A newer choice may have been made while this one opened.
					if (this.opened.sourceId !== choice.sourceId || this.opened.hideCursor !== hideCursor)
						stopAll(stream);
					else this.streams.set({ screen: stream });
				} catch (error) {
					this.opened.sourceId = undefined;
					throw explain(error, "screen");
				}
			}
		}
		const cameraKey = choice.camera ? choice.cameraId || "default" : "";
		if (cameraKey !== this.opened.cameraId) {
			stopAll(camera);
			this.streams.set({ camera: null });
			this.opened.cameraId = cameraKey;
			if (choice.camera) {
				try {
					if (!(await window.cue.requestCamera()))
						throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
					const stream = await navigator.mediaDevices.getUserMedia({
						video: {
							deviceId: choice.cameraId ? { exact: choice.cameraId } : undefined,
							width: { ideal: 1920 },
							height: { ideal: 1080 },
							frameRate: { ideal: 30 },
						},
						audio: false,
					});
					if (this.opened.cameraId !== cameraKey) stopAll(stream);
					else this.streams.set({ camera: stream });
				} catch (error) {
					this.opened.cameraId = "";
					throw explain(error, "camera");
				}
			}
		}
	}

	/** Stops the preview streams (dialog closed without recording). */
	release() {
		if (this.status.get().phase !== "idle") return;
		const { screen, camera } = this.streams.get();
		stopAll(screen);
		stopAll(camera);
		stopAll(this.mic);
		this.mic = null;
		this.streams.set({ screen: null, camera: null });
		this.opened = { sourceId: undefined, cameraId: "", hideCursor: false };
	}

	/** Countdown, then record until stop() (or maxSeconds). */
	async start(choice: CaptureChoice, requestId?: string): Promise<void> {
		if (this.status.get().phase !== "idle") {
			if (requestId)
				void window.cue.captureCancel(null, "A recording is already running.", requestId);
			return;
		}
		this.requestId = requestId;
		this.choice = choice;
		this.cancelled = false;
		this.status.set({ phase: "countdown", count: 3, elapsedMs: 0, error: null });
		try {
			if (!choice.sourceId && !choice.camera)
				throw new Error("Choose a screen or window, or turn the camera on.");
			await this.preview(choice);
			if (choice.microphone) {
				if (!(await window.cue.requestMicrophone()))
					throw explain(Object.assign(new Error(), { name: "NotAllowedError" }), "microphone");
				try {
					this.mic = await navigator.mediaDevices.getUserMedia({
						audio: {
							deviceId: choice.microphoneId ? { exact: choice.microphoneId } : undefined,
							echoCancellation: true,
							noiseSuppression: true,
						},
					});
				} catch (error) {
					throw explain(error, "microphone");
				}
			}
			for (let n = 3; n > 0; n--) {
				this.status.set({ count: n });
				await new Promise((r) => setTimeout(r, 1000));
				if (this.cancelled) return;
			}
			// Hide the countdown and let the screen catch up, so the recording doesn't open on a "1".
			this.status.set({ count: 0 });
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			await new Promise((r) => setTimeout(r, 250));
			if (this.cancelled) return;
			await this.begin(choice);
		} catch (error) {
			const message = (error as Error).message;
			this.status.set({ phase: "idle", error: message });
			if (this.requestId) void window.cue.captureCancel(null, message, this.requestId);
			this.requestId = undefined;
			this.release();
			notify(message, "danger");
		}
	}

	private async begin(choice: CaptureChoice) {
		const { screen, camera } = this.streams.get();
		if (choice.sourceId && !screen?.active) throw new Error(SCREEN_ACCESS_HELP);
		const session = await window.cue.captureBegin({
			screen: !!screen,
			camera: !!camera,
			requestId: this.requestId,
			sourceId: choice.sourceId,
			pointer: !!choice.studio && !!screen,
		});
		this.sessionId = session.id;
		// The microphone goes with the main picture (the screen, or the camera alone).
		const mainVideo = (screen ?? camera) as MediaStream;
		const mainStream = new MediaStream([
			...mainVideo.getVideoTracks(),
			...(this.mic?.getAudioTracks() ?? []),
		]);
		const parts: [MediaStream, "main" | "overlay", number][] = [[mainStream, "main", 8_000_000]];
		if (screen && camera) parts.push([camera, "overlay", 4_000_000]);
		this.recorders = parts.map(([stream, part, bitrate]) => {
			const mimeType = mimeFor(stream.getAudioTracks().length > 0);
			const recorder = new MediaRecorder(stream, {
				mimeType: mimeType || undefined,
				videoBitsPerSecond: bitrate,
				audioBitsPerSecond: 160_000,
			});
			let writing = Promise.resolve();
			recorder.ondataavailable = (event) => {
				if (event.data.size === 0) return;
				const id = session.id;
				// Chunks are written in order even though reading each one is asynchronous.
				writing = writing.then(async () =>
					window.cue.captureChunk(id, part, await event.data.arrayBuffer()),
				);
				(recorder as MediaRecorder & { writing?: Promise<void> }).writing = writing;
			};
			return recorder;
		});
		this.atMs = Math.round(playback.currentMs);
		playback.pause();
		// Started together so the camera stays in sync with the screen.
		for (const r of this.recorders) r.start(1000);
		this.clock = { startedAt: Date.now(), pauses: [] };
		this.startedAt = performance.now();
		this.pausedMs = 0;
		this.status.set({ phase: "recording", maxSeconds: choice.maxSeconds ?? null });
		// If the shared screen or window goes away (closed, or sharing stopped), finish.
		mainVideo.getVideoTracks()[0]?.addEventListener("ended", () => void this.stop());
		this.timer = window.setInterval(() => {
			const { phase } = this.status.get();
			if (phase !== "recording") return;
			const elapsedMs = performance.now() - this.startedAt - this.pausedMs;
			this.status.set({ elapsedMs });
			if (choice.maxSeconds && elapsedMs >= choice.maxSeconds * 1000) void this.stop();
		}, 200);
	}

	pause() {
		if (this.status.get().phase !== "recording") return;
		for (const r of this.recorders) if (r.state === "recording") r.pause();
		this.pausedAt = performance.now();
		this.clock.pauses.push({ from: Date.now(), to: Number.POSITIVE_INFINITY });
		this.status.set({ phase: "paused" });
	}

	resume() {
		if (this.status.get().phase !== "paused") return;
		for (const r of this.recorders) if (r.state === "paused") r.resume();
		this.pausedMs += performance.now() - this.pausedAt;
		const pause = this.clock.pauses.at(-1);
		if (pause) pause.to = Date.now();
		this.status.set({ phase: "recording" });
	}

	/** Stops, writes the last chunks, and has the main process import the recording. */
	async stop(): Promise<CaptureResult | undefined> {
		const { phase } = this.status.get();
		if (phase === "countdown") {
			this.cancel();
			return;
		}
		if ((phase !== "recording" && phase !== "paused") || !this.sessionId) return;
		const id = this.sessionId;
		window.clearInterval(this.timer);
		this.status.set({ phase: "saving" });
		await Promise.all(
			this.recorders.map(
				(r) =>
					new Promise<void>((resolve) => {
						if (r.state === "inactive") return resolve();
						r.addEventListener("stop", () => resolve(), { once: true });
						r.stop();
					}),
			),
		);
		// The final dataavailable fires before stop; wait for every chunk to be written.
		await Promise.all(
			this.recorders.map((r) => (r as MediaRecorder & { writing?: Promise<void> }).writing),
		);
		const bubble = !!this.choice?.bubble;
		const studio = this.choice?.studio ?? null;
		const clock = {
			startedAt: this.clock.startedAt,
			// Stopped while paused: the pause runs to the end.
			pauses: this.clock.pauses.map((p) => ({ from: p.from, to: Math.min(p.to, Date.now()) })),
		};
		this.recorders = [];
		this.sessionId = null;
		this.requestId = undefined;
		this.status.set({ phase: "idle" });
		this.release();
		notify("Importing the recording…");
		try {
			const result = await window.cue.captureFinish(id, {
				atMs: this.atMs,
				bubble,
				clock,
				studio,
			});
			notify("Recording added to the timeline", "success");
			return result;
		} catch (error) {
			notify(
				`Could not import the recording: ${(error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")}`,
				"danger",
			);
		}
	}

	/** Stops without keeping anything. */
	cancel() {
		const { phase } = this.status.get();
		if (phase === "idle" || phase === "saving") return;
		this.cancelled = true;
		window.clearInterval(this.timer);
		for (const r of this.recorders) {
			r.ondataavailable = null;
			if (r.state !== "inactive") r.stop();
		}
		void window.cue.captureCancel(
			this.sessionId,
			"The user cancelled the recording.",
			this.requestId,
		);
		this.recorders = [];
		this.sessionId = null;
		this.requestId = undefined;
		this.status.set({ phase: "idle" });
		this.release();
	}
}

export const capture = new ScreenCapture();
