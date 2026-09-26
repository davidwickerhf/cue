import type { LineView, ProjectSnapshot } from "../../electron/core/types";
import { notify } from "./api";
import { playback } from "./playback";
import { createStore } from "./state";

export type RecordPhase = "idle" | "countdown" | "recording" | "saving";

/**
 * Microphone recording over the timeline. The take's `recordedAtMs` is the
 * timeline time at which the MediaRecorder actually started, so the saved
 * take lines up with what was on screen.
 */
class Recorder {
	readonly status = createStore({
		phase: "idle" as RecordPhase,
		lineId: null as string | null,
		level: 0,
		micReady: false,
		deviceId: "" as string,
		devices: [] as MediaDeviceInfo[],
		error: null as string | null,
	});
	private stream: MediaStream | null = null;
	private meterCtx: AudioContext | null = null;
	private meterRaf = 0;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private recordedAtMs = 0;
	private stopTimer: (() => void) | null = null;
	private requestId: string | undefined;

	async ensureMic(): Promise<MediaStream> {
		const { deviceId } = this.status.get();
		if (this.stream?.active && (!deviceId || this.stream.getAudioTracks()[0]?.getSettings().deviceId === deviceId)) return this.stream;
		const allowed = await window.cue.requestMicrophone();
		if (!allowed) throw new Error("Microphone access is off. Allow Cue in System Settings → Privacy & Security → Microphone.");
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = await navigator.mediaDevices.getUserMedia({
			audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
		});
		const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
		this.status.set({ micReady: true, devices, error: null });
		window.cue.reportRecorder({ micReady: true });
		this.startMeter(this.stream);
		return this.stream;
	}

	async setDevice(deviceId: string) {
		this.status.set({ deviceId });
		if (this.stream) await this.ensureMic();
	}

	private startMeter(stream: MediaStream) {
		cancelAnimationFrame(this.meterRaf);
		void this.meterCtx?.close();
		this.meterCtx = new AudioContext();
		const analyser = this.meterCtx.createAnalyser();
		analyser.fftSize = 1024;
		this.meterCtx.createMediaStreamSource(stream).connect(analyser);
		const data = new Float32Array(analyser.fftSize);
		const loop = () => {
			analyser.getFloatTimeDomainData(data);
			let peak = 0;
			for (const v of data) peak = Math.max(peak, Math.abs(v));
			const level = Math.min(1, peak * 1.4);
			const prev = this.status.get().level;
			this.status.set({ level: level > prev ? level : prev * 0.9 });
			this.meterRaf = requestAnimationFrame(loop);
		};
		loop();
	}

	async record(project: ProjectSnapshot, line: LineView, options: { prerollMs?: number; requestId?: string } = {}) {
		if (this.status.get().phase !== "idle") return;
		this.requestId = options.requestId;
		try {
			const stream = await this.ensureMic();
			const settings = project.data.settings;
			const preroll = options.prerollMs ?? settings.prerollMs;
			const from = Math.max(0, line.startMs - preroll);
			const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
			const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 256000 } : undefined);
			this.recorder = recorder;
			this.chunks = [];
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) this.chunks.push(event.data);
			};
			this.status.set({ phase: "countdown", lineId: line.id, error: null });
			window.cue.reportRecorder({ recordingLineId: line.id });
			playback.pause();
			playback.seek(from);
			await new Promise<void>((resolve) => {
				recorder.onstart = () => {
					this.recordedAtMs = playback.currentMs;
					resolve();
				};
				playback.playOpenEnded(from, settings.monitor === "timeline" ? "exceptVoiceover" : "muted");
				recorder.start(250);
			});
			const stopAt = line.startMs + line.maxMs + settings.postrollMs;
			const unsubscribe = playback.onTick((ms) => {
				if (ms >= line.startMs && this.status.get().phase === "countdown") this.status.set({ phase: "recording" });
				if (settings.autoStop && ms >= stopAt) void this.stop();
			});
			this.stopTimer = unsubscribe;
		} catch (error) {
			this.reset();
			const message = (error as Error).message;
			this.status.set({ error: message });
			if (this.requestId) window.cue.failRecording(this.requestId, message);
			notify(message, "danger");
		}
	}

	async stop() {
		const recorder = this.recorder;
		const { lineId, phase } = this.status.get();
		if (!recorder || !lineId || phase === "saving" || phase === "idle") return;
		this.stopTimer?.();
		this.stopTimer = null;
		this.status.set({ phase: "saving" });
		const stopped = new Promise<void>((resolve) => {
			recorder.onstop = () => resolve();
		});
		recorder.stop();
		playback.pause();
		await stopped;
		const blob = new Blob(this.chunks, { type: recorder.mimeType });
		const extension = recorder.mimeType.includes("mp4") ? "m4a" : "webm";
		try {
			await window.cue.saveRecording({ lineId, audio: await blob.arrayBuffer(), extension, recordedAtMs: this.recordedAtMs, requestId: this.requestId });
			notify(`Saved a take for ${lineId}`, "success");
		} catch (error) {
			notify(`Could not save the take: ${(error as Error).message}`, "danger");
		} finally {
			this.reset();
		}
	}

	/** Stop without keeping the take. */
	cancel() {
		this.stopTimer?.();
		this.stopTimer = null;
		if (this.recorder && this.recorder.state !== "inactive") {
			this.recorder.onstop = null;
			this.recorder.stop();
		}
		playback.pause();
		if (this.requestId) window.cue.failRecording(this.requestId, "The user cancelled the recording.");
		this.reset();
	}

	private reset() {
		this.recorder = null;
		this.chunks = [];
		this.requestId = undefined;
		this.status.set({ phase: "idle", lineId: null });
		window.cue.reportRecorder({ recordingLineId: null });
	}
}

export const recorder = new Recorder();
