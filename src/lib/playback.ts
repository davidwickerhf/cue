import type { Asset, Clip, MediaClip, ProjectSnapshot, TextClip, Track } from "../../electron/core/types";
import { createStore } from "./state";
import { drawTextClip, textFrame } from "./textDraw";

export type AudioFilter = "all" | "voiceover" | "muted" | "exceptVoiceover";

interface Layer {
	track: Track;
	root: HTMLDivElement;
	video: HTMLVideoElement;
	image: HTMLImageElement;
	assetId: string | null;
}

const clipEnd = (c: Clip) => c.startMs + c.durationMs;

/**
 * Plays the timeline. The clock is performance.now(); audio is scheduled on a
 * Web Audio graph (volume, fades and speed per clip), video layers follow the
 * clock with drift correction, and text is drawn on a canvas each frame.
 */
class PlaybackEngine {
	readonly clock = createStore({ currentMs: 0, playing: false });
	private project: ProjectSnapshot | null = null;
	private stage: HTMLDivElement | null = null;
	private textCanvas: HTMLCanvasElement | null = null;
	private layers = new Map<string, Layer>();
	private ctx: AudioContext | null = null;
	private buffers = new Map<string, Promise<AudioBuffer | null>>();
	private scheduled: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
	private startPerf = 0;
	private startMs = 0;
	private stopAtMs: number | null = null;
	private raf = 0;
	private filter: AudioFilter = "all";
	private preview: HTMLAudioElement | null = null;
	private tickListeners = new Set<(ms: number) => void>();

	get currentMs() {
		return this.clock.get().currentMs;
	}

	get playing() {
		return this.clock.get().playing;
	}

	get durationMs() {
		return this.project?.durationMs ?? 0;
	}

	onTick(listener: (ms: number) => void) {
		this.tickListeners.add(listener);
		return () => this.tickListeners.delete(listener);
	}

	attach(stage: HTMLDivElement, textCanvas: HTMLCanvasElement) {
		this.stage = stage;
		this.textCanvas = textCanvas;
		this.layers.clear();
		this.rebuildLayers();
		this.render(this.currentMs);
	}

	detach() {
		this.pause();
		this.stage = null;
		this.textCanvas = null;
		this.layers.clear();
	}

	setProject(project: ProjectSnapshot | null) {
		const previous = this.project;
		this.project = project;
		if (!project) return;
		const tracksChanged = previous?.data.tracks.map((t) => t.id).join() !== project.data.tracks.map((t) => t.id).join();
		if (tracksChanged || this.layers.size === 0) this.rebuildLayers();
		for (const asset of project.data.assets) if (asset.hasAudio) void this.buffer(asset);
		if (this.playing) this.reschedule();
		else this.render(this.currentMs);
	}

	setFilter(filter: AudioFilter) {
		this.filter = filter;
		if (this.playing) this.reschedule();
	}

	play(options: { fromMs?: number; toMs?: number; filter?: AudioFilter } = {}) {
		if (!this.project) return;
		this.stopPreview();
		if (options.filter) this.filter = options.filter;
		const from = options.fromMs ?? (this.currentMs >= this.durationMs - 30 ? 0 : this.currentMs);
		this.stopAtMs = options.toMs ?? null;
		this.startMs = from;
		this.startPerf = performance.now();
		this.clock.set({ currentMs: from, playing: true });
		void this.audio().resume();
		this.reschedule();
		cancelAnimationFrame(this.raf);
		const loop = () => {
			if (!this.playing) return;
			const now = this.startMs + (performance.now() - this.startPerf);
			const end = this.stopAtMs ?? Math.max(this.durationMs, this.startMs);
			if (now >= end && this.stopAtMs !== Number.POSITIVE_INFINITY) {
				this.pause(end);
				return;
			}
			this.clock.set({ currentMs: now });
			this.render(now);
			for (const listener of this.tickListeners) listener(now);
			this.raf = requestAnimationFrame(loop);
		};
		this.raf = requestAnimationFrame(loop);
	}

	/** Keeps the clock running past the end of the timeline (used while recording). */
	playOpenEnded(fromMs: number, filter: AudioFilter) {
		this.play({ fromMs, filter });
		this.stopAtMs = Number.POSITIVE_INFINITY;
	}

	pause(atMs?: number) {
		cancelAnimationFrame(this.raf);
		const at = atMs ?? this.currentMs;
		this.clearScheduled();
		for (const layer of this.layers.values()) layer.video.pause();
		this.clock.set({ playing: false, currentMs: at });
		this.render(at);
	}

	toggle() {
		if (this.playing) this.pause();
		else this.play();
	}

	seek(ms: number) {
		const target = Math.max(0, ms);
		if (this.playing) {
			this.startMs = target;
			this.startPerf = performance.now();
			this.clock.set({ currentMs: target });
			this.reschedule();
		} else {
			this.clock.set({ currentMs: target });
			this.render(target);
		}
	}

	/** Seeks and resolves once every visible video layer shows the right frame. */
	async seekAndSettle(ms: number): Promise<void> {
		this.pause();
		this.seek(ms);
		await Promise.all(
			[...this.layers.values()].map(
				(layer) =>
					new Promise<void>((resolve) => {
						if (layer.root.style.display === "none" || !layer.video.src || !layer.video.seeking) return resolve();
						layer.video.addEventListener("seeked", () => resolve(), { once: true });
						setTimeout(resolve, 1500);
					}),
			),
		);
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	}

	previewAsset(url: string) {
		this.pause();
		this.stopPreview();
		this.preview = new Audio(url);
		void this.preview.play();
	}

	stopPreview() {
		this.preview?.pause();
		this.preview = null;
	}

	// -------------------------------------------------------------------------

	private audio() {
		if (!this.ctx) this.ctx = new AudioContext({ latencyHint: "interactive" });
		return this.ctx;
	}

	private buffer(asset: Asset): Promise<AudioBuffer | null> {
		const url = this.project?.assetUrls[asset.id];
		const key = `${asset.id}|${url}`;
		let cached = this.buffers.get(key);
		if (!cached && url) {
			cached = fetch(url)
				.then((res) => res.arrayBuffer())
				.then((bytes) => this.audio().decodeAudioData(bytes))
				.catch(() => null);
			this.buffers.set(key, cached);
		}
		return cached ?? Promise.resolve(null);
	}

	private audible(clip: MediaClip, track: Track): boolean {
		if (track.muted || track.hidden) return false;
		if (this.filter === "muted") return false;
		if (this.filter === "voiceover") return Boolean(track.voiceover);
		if (this.filter === "exceptVoiceover") return !track.voiceover;
		return clip.volume > 0;
	}

	private clearScheduled() {
		for (const { source } of this.scheduled) {
			try {
				source.stop();
			} catch {}
		}
		this.scheduled = [];
	}

	private reschedule() {
		this.clearScheduled();
		const project = this.project;
		if (!project || !this.playing) return;
		const ctx = this.audio();
		const scheduledAtPerf = this.startPerf;
		const tracks = new Map(project.data.tracks.map((t) => [t.id, t]));
		const assets = new Map(project.data.assets.map((a) => [a.id, a]));
		for (const clip of project.data.clips) {
			if (clip.type !== "media") continue;
			const track = tracks.get(clip.trackId);
			const asset = assets.get(clip.assetId);
			if (!track || !asset || !asset.hasAudio || asset.kind === "image" || !this.audible(clip, track)) continue;
			if (clipEnd(clip) <= this.currentMs) continue;
			void this.buffer(asset).then((buffer) => {
				if (!buffer || !this.playing || this.startPerf !== scheduledAtPerf) return;
				const nowMs = this.startMs + (performance.now() - this.startPerf);
				const from = Math.max(nowMs, clip.startMs);
				if (from >= clipEnd(clip)) return;
				const when = ctx.currentTime + (from - nowMs) / 1000;
				const offset = (clip.inMs + (from - clip.startMs) * clip.speed) / 1000;
				const duration = ((clipEnd(clip) - from) * clip.speed) / 1000;
				const source = ctx.createBufferSource();
				source.buffer = buffer;
				source.playbackRate.value = clip.speed;
				const gain = ctx.createGain();
				const level = clip.volume * track.volume;
				const localStart = from - clip.startMs;
				const fadeIn = clip.fadeInMs;
				const fadeOut = clip.fadeOutMs;
				const levelAt = (local: number) => {
					let g = level;
					if (fadeIn > 0 && local < fadeIn) g *= local / fadeIn;
					if (fadeOut > 0 && local > clip.durationMs - fadeOut) g *= Math.max(0, (clip.durationMs - local) / fadeOut);
					return g;
				};
				gain.gain.setValueAtTime(levelAt(localStart), when);
				if (fadeIn > 0 && localStart < fadeIn) gain.gain.linearRampToValueAtTime(level, when + (fadeIn - localStart) / 1000);
				if (fadeOut > 0) {
					const fadeStart = clip.durationMs - fadeOut;
					const at = when + Math.max(0, fadeStart - localStart) / 1000;
					gain.gain.setValueAtTime(levelAt(Math.max(localStart, fadeStart)), at);
					gain.gain.linearRampToValueAtTime(0, when + (clip.durationMs - localStart) / 1000);
				}
				source.connect(gain).connect(ctx.destination);
				source.start(when, offset, duration);
				this.scheduled.push({ source, gain });
			});
		}
	}

	private rebuildLayers() {
		const stage = this.stage;
		const project = this.project;
		if (!stage || !project) return;
		for (const layer of this.layers.values()) layer.root.remove();
		this.layers.clear();
		// Bottom video track first so upper tracks stack above it.
		const videoTracks = project.data.tracks.filter((t) => t.kind === "video").reverse();
		for (const track of videoTracks) {
			const root = document.createElement("div");
			root.className = "absolute inset-0 overflow-hidden pointer-events-none";
			const video = document.createElement("video");
			video.muted = true;
			video.playsInline = true;
			video.preload = "auto";
			video.className = "absolute object-contain";
			const image = document.createElement("img");
			image.className = "absolute object-contain";
			image.draggable = false;
			root.append(video, image);
			stage.insertBefore(root, this.textCanvas);
			this.layers.set(track.id, { track, root, video, image, assetId: null });
		}
	}

	/** Brings every layer to the state of the timeline at `ms`. */
	private render(ms: number) {
		const project = this.project;
		if (!project) return;
		const assets = new Map(project.data.assets.map((a) => [a.id, a]));
		for (const [trackId, layer] of this.layers) {
			const track = project.data.tracks.find((t) => t.id === trackId);
			const active = track && !track.hidden
				? [...project.data.clips].reverse().find((c): c is MediaClip => c.type === "media" && c.trackId === trackId && ms >= c.startMs && ms < clipEnd(c))
				: undefined;
			if (!active) {
				layer.root.style.display = "none";
				if (!layer.video.paused) layer.video.pause();
				continue;
			}
			layer.root.style.display = "";
			const asset = assets.get(active.assetId);
			const url = project.assetUrls[active.assetId];
			const local = ms - active.startMs;
			let opacity = active.transform.opacity;
			if (active.fadeInMs > 0 && local < active.fadeInMs) opacity *= local / active.fadeInMs;
			if (active.fadeOutMs > 0 && local > active.durationMs - active.fadeOutMs) opacity *= (active.durationMs - local) / active.fadeOutMs;
			const element = asset?.kind === "image" ? layer.image : layer.video;
			const other = asset?.kind === "image" ? layer.video : layer.image;
			other.style.display = "none";
			element.style.display = "";
			const t = active.transform;
			Object.assign(element.style, {
				left: `${t.x * 100}%`,
				top: `${t.y * 100}%`,
				width: `${t.scale * 100}%`,
				height: `${t.scale * 100}%`,
				transform: "translate(-50%, -50%)",
				opacity: String(Math.max(0, Math.min(1, opacity))),
			});
			if (asset?.kind === "image") {
				if (layer.image.dataset.src !== url) {
					layer.image.src = url;
					layer.image.dataset.src = url;
				}
				if (!layer.video.paused) layer.video.pause();
				continue;
			}
			if (layer.assetId !== active.assetId || layer.video.dataset.src !== url) {
				layer.video.src = url;
				layer.video.dataset.src = url;
				layer.assetId = active.assetId;
			}
			const target = (active.inMs + local * active.speed) / 1000;
			const video = layer.video;
			video.playbackRate = active.speed;
			if (this.playing) {
				if (Math.abs(video.currentTime - target) > 0.2 || video.paused) {
					if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target;
					if (video.paused) void video.play().catch(() => {});
				}
			} else {
				if (!video.paused) video.pause();
				if (Math.abs(video.currentTime - target) > 0.02) video.currentTime = target;
			}
		}
		this.drawText(ms);
	}

	private drawText(ms: number) {
		const canvas = this.textCanvas;
		const project = this.project;
		if (!canvas || !project) return;
		const rect = canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const w = Math.max(1, Math.round(rect.width * dpr));
		const h = Math.max(1, Math.round(rect.height * dpr));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, w, h);
		const { width: W, height: H } = project.data.canvas;
		ctx.save();
		ctx.scale(w / W, h / H);
		// Upper tracks draw last (on top).
		for (const track of [...project.data.tracks].reverse()) {
			if (track.kind !== "text" || track.hidden) continue;
			for (const clip of project.data.clips) {
				if (clip.type !== "text" || clip.trackId !== track.id || ms < clip.startMs || ms >= clipEnd(clip)) continue;
				drawTextClip(ctx, clip as TextClip, W, H, textFrame(clip as TextClip, ms - clip.startMs, H));
			}
		}
		ctx.restore();
	}
}

export const playback = new PlaybackEngine();
