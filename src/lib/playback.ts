import { valueAt, zoomAt } from "../../electron/core/anim";
import type {
	Asset,
	Clip,
	ColorGrade,
	MediaClip,
	ProjectSnapshot,
	TextClip,
	Track,
} from "../../electron/core/types";
import { createKeyer, type Keyer, maskUrl } from "./compositing";
import { createStore } from "./state";
import { drawTextClip, textFrame } from "./textDraw";

export type AudioFilter = "all" | "voiceover" | "muted" | "exceptVoiceover";

/** One visible picture on a video track: a fitted frame (crop, fades) holding the media (zoom, colour). */
interface Slot {
	frame: HTMLDivElement;
	video: HTMLVideoElement;
	image: HTMLImageElement;
	clipId: string | null;
	src: string;
	/** Latest seek wanted while a seek is still running. */
	pendingSeek: number | null;
	/** WebGL canvas for chroma-keyed clips, made on first use. */
	keyer?: Keyer | null;
	keyedClip?: MediaClip | null;
}

interface VideoLayer {
	root: HTMLDivElement;
	slots: [Slot, Slot];
}

interface TextLayer {
	canvas: HTMLCanvasElement;
	key: string;
}

interface Index {
	tracks: Map<string, Track>;
	assets: Map<string, Asset>;
	/** Clips per track, sorted by start. */
	byTrack: Map<string, Clip[]>;
	voiceRanges: { start: number; end: number }[];
}

const clipEnd = (c: Clip) => c.startMs + c.durationMs;

function cssFilter(grade: ColorGrade | undefined): string {
	if (!grade) return "none";
	const parts: string[] = [];
	if (grade.brightness) parts.push(`brightness(${(1 + grade.brightness).toFixed(3)})`);
	if (grade.contrast !== 1) parts.push(`contrast(${grade.contrast.toFixed(3)})`);
	if (grade.saturation !== 1) parts.push(`saturate(${grade.saturation.toFixed(3)})`);
	if (grade.temperature > 0) parts.push(`sepia(${(grade.temperature * 0.35).toFixed(3)})`);
	if (grade.temperature < 0) parts.push(`hue-rotate(${(grade.temperature * 18).toFixed(1)}deg)`);
	return parts.length ? parts.join(" ") : "none";
}

/** Fade-out for a clip's sound, including a crossfade into the next clip (same rule as the exporter). */
function audioFadeOut(clips: Clip[], clip: MediaClip): number {
	let overlap = 0;
	for (const x of clips) {
		if (
			x.type === "media" &&
			x.id !== clip.id &&
			x.transitionIn?.kind === "crossfade" &&
			x.startMs < clipEnd(clip) &&
			x.startMs > clip.startMs
		) {
			overlap = Math.max(overlap, clipEnd(clip) - x.startMs);
		}
	}
	return Math.max(clip.fadeOutMs, overlap);
}

/**
 * Plays the timeline, built for speed:
 * - lightweight proxies for large videos, one seek in flight per picture;
 * - audio decoded from small extracted (and, for speed changes, time-stretched)
 *   files and scheduled sample-accurately on Web Audio;
 * - per-track layers that are only touched when something visibly changes.
 */
class PlaybackEngine {
	readonly clock = createStore({ currentMs: 0, playing: false, rate: 1 });
	readonly meter = createStore({ left: 0, right: 0 });
	/** Peak level per track (0–1), for the mixer. */
	readonly trackMeters = createStore<{ levels: Record<string, number> }>({ levels: {} });
	private buses = new Map<
		string,
		{ gain: GainNode; pan: StereoPannerNode; analyser: AnalyserNode }
	>();
	private project: ProjectSnapshot | null = null;
	private index: Index | null = null;
	private stage: HTMLDivElement | null = null;
	private anchor: HTMLElement | null = null;
	private videoLayers = new Map<string, VideoLayer>();
	private textLayers = new Map<string, TextLayer>();
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private analysers: [AnalyserNode, AnalyserNode] | null = null;
	private buffers = new Map<string, Promise<AudioBuffer | null>>();
	private scheduled: AudioScheduledSourceNode[] = [];
	private startPerf = 0;
	private startMs = 0;
	private stopAtMs: number | null = null;
	private raf = 0;
	private filter: AudioFilter = "all";
	private preview: HTMLAudioElement | null = null;
	private tickListeners = new Set<(ms: number) => void>();
	private meterData = new Float32Array(1024);
	private frameCount = 0;
	/** Playback rate for J/K/L shuttle; negative plays backwards (seeking), anything but 1 is silent. */
	private rate = 1;

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

	attach(stage: HTMLDivElement, anchor: HTMLElement) {
		this.stage = stage;
		this.anchor = anchor;
		this.rebuildLayers();
		this.render(this.currentMs);
	}

	detach() {
		this.pause();
		for (const layer of this.videoLayers.values()) layer.root.remove();
		for (const layer of this.textLayers.values()) layer.canvas.remove();
		this.videoLayers.clear();
		this.textLayers.clear();
		this.stage = null;
		this.anchor = null;
	}

	setProject(project: ProjectSnapshot | null) {
		const previous = this.project;
		if (
			project &&
			previous &&
			project.revision === previous.revision &&
			project.path === previous.path &&
			project.proxyUrls === previous.proxyUrls
		)
			return;
		this.project = project;
		if (!project) return;
		this.index = this.buildIndex(project);
		this.updateBuses(project);
		const layout = (p: ProjectSnapshot | null) =>
			p?.data.tracks.map((t) => `${t.id}:${t.kind}`).join() ?? "";
		if (
			layout(previous) !== layout(project) ||
			(this.videoLayers.size === 0 && this.textLayers.size === 0)
		)
			this.rebuildLayers();
		for (const layer of this.textLayers.values()) layer.key = "";
		this.warmAudio();
		if (this.playing) this.reschedule();
		else this.render(this.currentMs);
	}

	/** Redraw after the viewer changes size. */
	refresh() {
		for (const layer of this.textLayers.values()) layer.key = "";
		this.render(this.currentMs);
	}

	setFilter(filter: AudioFilter) {
		this.filter = filter;
		if (this.playing) this.reschedule();
	}

	/** J/K/L shuttle: 1, 2, 4 forward; -1, -2, -4 backward. */
	shuttle(rate: number) {
		if (rate === 0) return this.pause();
		this.play({ rate });
	}

	play(options: { fromMs?: number; toMs?: number; filter?: AudioFilter; rate?: number } = {}) {
		if (!this.project) return;
		this.stopPreview();
		if (options.filter) this.filter = options.filter;
		this.rate = options.rate ?? 1;
		const from = options.fromMs ?? (this.currentMs >= this.durationMs - 30 ? 0 : this.currentMs);
		this.stopAtMs = options.toMs ?? null;
		this.startMs = from;
		this.startPerf = performance.now();
		this.clock.set({ currentMs: from, playing: true, rate: this.rate });
		void this.audio().resume();
		this.reschedule();
		cancelAnimationFrame(this.raf);
		const loop = () => {
			if (!this.playing) return;
			const now = this.startMs + (performance.now() - this.startPerf) * this.rate;
			const end = this.stopAtMs ?? Math.max(this.durationMs, this.startMs);
			if (now <= 0 && this.rate < 0) {
				this.pause(0);
				return;
			}
			if (now >= end && this.stopAtMs !== Number.POSITIVE_INFINITY) {
				this.pause(end);
				return;
			}
			this.clock.set({ currentMs: now });
			this.render(now);
			if ((this.frameCount++ & 1) === 0) this.readMeter();
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
		for (const layer of this.videoLayers.values())
			for (const slot of layer.slots) if (!slot.video.paused) slot.video.pause();
		this.rate = 1;
		this.clock.set({ playing: false, currentMs: at, rate: 1 });
		this.meter.set({ left: 0, right: 0 });
		this.trackMeters.set({ levels: {} });
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

	/** Seeks and resolves once every visible picture shows the right frame. */
	async seekAndSettle(ms: number): Promise<void> {
		this.pause();
		this.seek(ms);
		const waits: Promise<void>[] = [];
		for (const layer of this.videoLayers.values()) {
			for (const slot of layer.slots) {
				if (slot.frame.style.display === "none" || !slot.video.src) continue;
				waits.push(
					new Promise<void>((resolve) => {
						const started = performance.now();
						const check = () => {
							if (
								(!slot.video.seeking && slot.pendingSeek === null && slot.video.readyState >= 2) ||
								performance.now() - started > 2500
							)
								resolve();
							else setTimeout(check, 25);
						};
						check();
					}),
				);
			}
		}
		await Promise.all(waits);
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
	// Index and layers
	// -------------------------------------------------------------------------

	private buildIndex(project: ProjectSnapshot): Index {
		const tracks = new Map(project.data.tracks.map((t) => [t.id, t]));
		const byTrack = new Map<string, Clip[]>(project.data.tracks.map((t) => [t.id, []]));
		// Disabled clips stay on the timeline but are neither drawn nor heard.
		for (const c of project.data.clips) if (!c.disabled) byTrack.get(c.trackId)?.push(c);
		for (const list of byTrack.values()) list.sort((a, b) => a.startMs - b.startMs);
		const voiceRanges = project.data.clips
			.filter(
				(c) =>
					c.type === "media" &&
					!c.disabled &&
					tracks.get(c.trackId)?.voiceover &&
					!tracks.get(c.trackId)?.muted,
			)
			.map((c) => ({ start: c.startMs, end: clipEnd(c) }));
		return {
			tracks,
			assets: new Map(project.data.assets.map((a) => [a.id, a])),
			byTrack,
			voiceRanges,
		};
	}

	/** One DOM layer per visual track, stacked in track order like the exporter. */
	private rebuildLayers() {
		const stage = this.stage;
		const project = this.project;
		if (!stage || !project) return;
		for (const layer of this.videoLayers.values()) layer.root.remove();
		for (const layer of this.textLayers.values()) layer.canvas.remove();
		this.videoLayers.clear();
		this.textLayers.clear();
		const makeSlot = (root: HTMLDivElement): Slot => {
			const frame = document.createElement("div");
			frame.className = "absolute top-0 left-0 overflow-hidden";
			frame.style.display = "none";
			frame.style.willChange = "transform, opacity";
			const video = document.createElement("video");
			video.muted = true;
			video.playsInline = true;
			video.preload = "auto";
			video.disablePictureInPicture = true;
			// CORS mode, so the chroma keyer may read its pixels into WebGL.
			video.crossOrigin = "anonymous";
			video.className = "absolute inset-0 size-full object-fill";
			const image = document.createElement("img");
			image.className = "absolute inset-0 size-full object-fill";
			image.draggable = false;
			image.decoding = "async";
			frame.append(video, image);
			root.append(frame);
			const slot: Slot = { frame, video, image, clipId: null, src: "", pendingSeek: null };
			video.addEventListener("seeked", () => {
				if (slot.pendingSeek === null) return;
				const next = slot.pendingSeek;
				slot.pendingSeek = null;
				if (Math.abs(video.currentTime - next) > 0.015) video.currentTime = next;
			});
			// Keyed clips redraw whenever a new frame is decoded (playing or after a seek).
			const redraw = () => {
				if (slot.keyer && slot.keyedClip?.key) slot.keyer.draw(video, slot.keyedClip.key);
				video.requestVideoFrameCallback(redraw);
				// A paused video only has its frame once a seek or load finishes.
				const redrawOnce = () => {
					if (slot.keyer && slot.keyedClip?.key) slot.keyer.draw(video, slot.keyedClip.key);
				};
				video.addEventListener("seeked", redrawOnce);
				video.addEventListener("loadeddata", redrawOnce);
			};
			video.requestVideoFrameCallback(redraw);
			return slot;
		};
		for (const track of [...project.data.tracks].reverse()) {
			if (track.kind === "text") {
				const canvas = document.createElement("canvas");
				canvas.className = "pointer-events-none absolute inset-0 size-full";
				stage.insertBefore(canvas, this.anchor);
				this.textLayers.set(track.id, { canvas, key: "" });
			} else if (track.kind === "video") {
				const root = document.createElement("div");
				root.className = "pointer-events-none absolute inset-0 overflow-hidden";
				stage.insertBefore(root, this.anchor);
				this.videoLayers.set(track.id, { root, slots: [makeSlot(root), makeSlot(root)] });
			}
		}
	}

	// -------------------------------------------------------------------------
	// Rendering
	// -------------------------------------------------------------------------

	/** Brings every layer to the state of the timeline at `ms`. */
	private render(ms: number) {
		const index = this.index;
		if (!this.project || !index) return;
		for (const [trackId, layer] of this.videoLayers) {
			const track = index.tracks.get(trackId);
			const active: MediaClip[] = [];
			if (track && !track.hidden) {
				for (const c of index.byTrack.get(trackId) ?? []) {
					if (c.startMs > ms) break;
					if (c.type === "media" && ms < clipEnd(c)) active.push(c);
				}
			}
			// The two most recent clips: the later one draws on top (crossfades).
			const shown = active.slice(-2);
			this.renderSlot(layer.slots[0], shown.length === 2 ? shown[0] : undefined, ms, layer.root);
			this.renderSlot(layer.slots[1], shown.length === 2 ? shown[1] : shown[0], ms, layer.root);
		}
		this.drawText(ms);
	}

	private renderSlot(slot: Slot, clip: MediaClip | undefined, ms: number, root: HTMLDivElement) {
		const project = this.project;
		const index = this.index;
		if (!clip || !project || !index) {
			if (slot.frame.style.display !== "none") slot.frame.style.display = "none";
			if (!slot.video.paused) slot.video.pause();
			slot.clipId = null;
			return;
		}
		const asset = index.assets.get(clip.assetId);
		if (asset?.kind === "adjustment") return this.renderAdjustment(slot, clip, ms, root);
		if (slot.frame.style.backdropFilter) slot.frame.style.backdropFilter = "";
		const isImage = asset?.kind === "image";
		const url = isImage
			? project.assetUrls[clip.assetId]
			: (project.proxyUrls[clip.assetId] ?? project.assetUrls[clip.assetId]);
		const local = ms - clip.startMs;
		const t = clip.transform;
		const kf = clip.keyframes;
		const scale = valueAt(kf?.scale, local, t.scale);
		const x = valueAt(kf?.x, local, t.x);
		const y = valueAt(kf?.y, local, t.y);
		let opacity = t.opacity;
		if (clip.fadeInMs > 0 && local < clip.fadeInMs) opacity *= local / clip.fadeInMs;
		if (clip.fadeOutMs > 0 && local > clip.durationMs - clip.fadeOutMs)
			opacity *= (clip.durationMs - local) / clip.fadeOutMs;
		const W = root.clientWidth;
		const H = root.clientHeight;
		const ar = asset?.width && asset.height ? asset.width / asset.height : W / Math.max(1, H);
		const fit = Math.min(W / ar, H) * scale;
		const w = fit * ar;
		const h = fit;
		const c = t.crop;
		const frame = slot.frame.style;
		frame.display = "";
		frame.width = `${w}px`;
		frame.height = `${h}px`;
		frame.transform = `translate3d(${x * W - w / 2}px, ${y * H - h / 2}px, 0)`;
		frame.opacity = String(Math.max(0, Math.min(1, opacity)));
		frame.clipPath =
			c.left || c.top || c.right || c.bottom
				? `inset(${c.top * 100}% ${c.right * 100}% ${c.bottom * 100}% ${c.left * 100}%)`
				: "none";
		const mask = clip.mask ? `url(${maskUrl(clip.mask, ar)})` : "none";
		if (frame.maskImage !== mask) {
			frame.maskImage = mask;
			frame.maskSize = "100% 100%";
		}
		const element = isImage ? slot.image : slot.video;
		const other = isImage ? slot.video : slot.image;
		if (other.style.display !== "none") other.style.display = "none";
		element.style.display = "";
		const z = zoomAt(clip.zooms, local);
		element.style.transformOrigin = `${z.x * 100}% ${z.y * 100}%`;
		element.style.transform = z.scale !== 1 ? `scale(${z.scale})` : "none";
		element.style.filter = cssFilter(clip.color);
		slot.clipId = clip.id;
		if (isImage) {
			if (slot.src !== url) {
				slot.image.src = url;
				slot.src = url;
			}
			if (!slot.video.paused) slot.video.pause();
			return;
		}
		const video = slot.video;
		// Chroma key: the video keeps decoding underneath while a WebGL canvas shows it keyed.
		if (clip.key) {
			if (slot.keyer === undefined) {
				slot.keyer = createKeyer();
				if (slot.keyer) slot.frame.append(slot.keyer.canvas);
			}
			if (slot.keyer) {
				slot.keyedClip = clip;
				video.style.opacity = "0";
				const k = slot.keyer.canvas.style;
				k.display = "";
				k.transform = video.style.transform;
				k.transformOrigin = video.style.transformOrigin;
				k.filter = video.style.filter;
				slot.keyer.draw(video, clip.key);
			}
		} else if (slot.keyedClip) {
			slot.keyedClip = null;
			video.style.opacity = "";
			if (slot.keyer) slot.keyer.canvas.style.display = "none";
		}
		if (slot.src !== url) {
			video.src = url;
			slot.src = url;
			slot.pendingSeek = null;
		}
		const target = (clip.inMs + local * clip.speed) / 1000;
		const rate = Math.min(16, clip.speed * Math.abs(this.rate));
		if (video.playbackRate !== rate) video.playbackRate = rate;
		if (this.playing && this.rate > 0) {
			const drift = Math.abs(video.currentTime - target);
			if (video.paused) {
				if (drift > 0.05) this.seekVideo(slot, target);
				void video.play().catch(() => {});
			} else if (drift > 0.25) this.seekVideo(slot, target);
		} else {
			if (!video.paused) video.pause();
			if (Math.abs(video.currentTime - target) > 0.015) this.seekVideo(slot, target);
		}
	}

	/** An adjustment layer: a full-frame backdrop filter grading everything drawn below it. */
	private renderAdjustment(slot: Slot, clip: MediaClip, ms: number, root: HTMLDivElement) {
		const frame = slot.frame.style;
		const local = ms - clip.startMs;
		let opacity = clip.transform.opacity;
		if (clip.fadeInMs > 0 && local < clip.fadeInMs) opacity *= local / clip.fadeInMs;
		if (clip.fadeOutMs > 0 && local > clip.durationMs - clip.fadeOutMs)
			opacity *= (clip.durationMs - local) / clip.fadeOutMs;
		frame.display = "";
		frame.width = `${root.clientWidth}px`;
		frame.height = `${root.clientHeight}px`;
		frame.transform = "none";
		frame.opacity = String(Math.max(0, Math.min(1, opacity)));
		frame.clipPath = "none";
		frame.maskImage = clip.mask
			? `url(${maskUrl(clip.mask, root.clientWidth / Math.max(1, root.clientHeight))})`
			: "none";
		frame.maskSize = "100% 100%";
		frame.backdropFilter = cssFilter(clip.color) === "none" ? "" : cssFilter(clip.color);
		slot.video.style.display = "none";
		slot.image.style.display = "none";
		if (slot.keyer) slot.keyer.canvas.style.display = "none";
		if (!slot.video.paused) slot.video.pause();
		slot.clipId = clip.id;
	}

	/** At most one seek in flight per picture; newer requests replace the queued one. */
	private seekVideo(slot: Slot, target: number) {
		if (slot.video.seeking) slot.pendingSeek = target;
		else slot.video.currentTime = target;
	}

	private drawText(ms: number) {
		const project = this.project;
		const index = this.index;
		if (!project || !index) return;
		const { width: W, height: H } = project.data.canvas;
		const dpr = window.devicePixelRatio || 1;
		for (const [trackId, layer] of this.textLayers) {
			const track = index.tracks.get(trackId);
			const active: TextClip[] = [];
			if (track && !track.hidden) {
				for (const c of index.byTrack.get(trackId) ?? []) {
					if (c.startMs > ms) break;
					if (c.type === "text" && ms < clipEnd(c)) active.push(c);
				}
			}
			const canvas = layer.canvas;
			const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
			const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
			const frames = active.map((c) => ({ c, f: textFrame(c, ms - c.startMs, H) }));
			// Skip the redraw when nothing on this layer looks different from the last frame.
			const key = `${w}x${h}|${frames.map(({ c, f }) => `${c.id}:${f.alpha.toFixed(3)}:${f.scale.toFixed(3)}:${f.offsetY.toFixed(1)}:${f.reveal}`).join(",")}`;
			if (key === layer.key) continue;
			layer.key = key;
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
			}
			const ctx = canvas.getContext("2d");
			if (!ctx) continue;
			ctx.clearRect(0, 0, w, h);
			if (frames.length === 0) continue;
			ctx.save();
			ctx.scale(w / W, h / H);
			for (const { c, f } of frames) drawTextClip(ctx, c, W, H, f);
			ctx.restore();
		}
	}

	// -------------------------------------------------------------------------
	// Audio
	// -------------------------------------------------------------------------

	private audio() {
		if (!this.ctx) {
			this.ctx = new AudioContext({ latencyHint: "interactive" });
			this.master = this.ctx.createGain();
			const splitter = this.ctx.createChannelSplitter(2);
			const left = this.ctx.createAnalyser();
			const right = this.ctx.createAnalyser();
			left.fftSize = 1024;
			right.fftSize = 1024;
			this.master.connect(this.ctx.destination);
			this.master.connect(splitter);
			splitter.connect(left, 0);
			splitter.connect(right, 1);
			this.analysers = [left, right];
		}
		return this.ctx;
	}

	/** Per-track mixer strip: level, pan and a meter, feeding the master. */
	private bus(trackId: string, master: GainNode) {
		let bus = this.buses.get(trackId);
		if (!bus) {
			const ctx = this.audio();
			const gain = ctx.createGain();
			const pan = ctx.createStereoPanner();
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 512;
			gain.connect(pan).connect(master);
			pan.connect(analyser);
			bus = { gain, pan, analyser };
			this.buses.set(trackId, bus);
			const track = this.index?.tracks.get(trackId);
			if (track) this.levelBus(bus, track);
		}
		return bus;
	}

	private levelBus(bus: { gain: GainNode; pan: StereoPannerNode }, track: Track) {
		const ctx = this.audio();
		bus.gain.gain.setTargetAtTime(track.volume, ctx.currentTime, 0.015);
		bus.pan.pan.setTargetAtTime(track.pan ?? 0, ctx.currentTime, 0.015);
	}

	/** Moves a fader or pan knob live while it is dragged (the edit is saved on release). */
	previewTrackMix(trackId: string, mix: { volume?: number; pan?: number }) {
		const bus = this.buses.get(trackId);
		if (!bus || !this.ctx) return;
		if (mix.volume !== undefined)
			bus.gain.gain.setTargetAtTime(mix.volume, this.ctx.currentTime, 0.01);
		if (mix.pan !== undefined) bus.pan.pan.setTargetAtTime(mix.pan, this.ctx.currentTime, 0.01);
	}

	private updateBuses(project: ProjectSnapshot) {
		for (const track of project.data.tracks) {
			const bus = this.buses.get(track.id);
			if (bus) this.levelBus(bus, track);
		}
	}

	private readMeter() {
		if (this.buses.size) {
			const levels: Record<string, number> = {};
			const prev = this.trackMeters.get().levels;
			const data = new Float32Array(512);
			for (const [id, bus] of this.buses) {
				bus.analyser.getFloatTimeDomainData(data);
				let peak = 0;
				for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
				levels[id] = Math.max(peak, (prev[id] ?? 0) * 0.85);
			}
			this.trackMeters.set({ levels });
		}
		if (!this.analysers) return;
		const [l, r] = this.analysers.map((a) => {
			a.getFloatTimeDomainData(this.meterData);
			let peak = 0;
			for (let i = 0; i < this.meterData.length; i++) {
				const v = Math.abs(this.meterData[i]);
				if (v > peak) peak = v;
			}
			return peak;
		});
		const prev = this.meter.get();
		this.meter.set({ left: Math.max(l, prev.left * 0.85), right: Math.max(r, prev.right * 0.85) });
	}

	/** Decoded audio for an asset at a speed, from a small extracted or time-stretched file. */
	private buffer(asset: Asset, speed: number): Promise<AudioBuffer | null> {
		const key = `${asset.id}@${Math.round(speed * 1000) / 1000}`;
		let cached = this.buffers.get(key);
		if (!cached) {
			cached = window.cue
				.audioProxy(asset.id, speed)
				.then((url) => fetch(url))
				.then((res) => res.arrayBuffer())
				.then((bytes) => this.audio().decodeAudioData(bytes))
				.catch(() => {
					this.buffers.delete(key);
					return null;
				});
			this.buffers.set(key, cached);
		}
		return cached;
	}

	/** Start decoding what the timeline will need, nearest to the playhead first, one at a time. */
	private warmAudio() {
		const index = this.index;
		if (!index || !this.project) return;
		const now = this.currentMs;
		const seen = new Set<string>();
		const wanted = this.project.data.clips
			.filter(
				(c): c is MediaClip =>
					c.type === "media" &&
					!!index.assets.get(c.assetId)?.hasAudio &&
					index.assets.get(c.assetId)?.kind !== "image",
			)
			.sort((a, b) => Math.abs(a.startMs - now) - Math.abs(b.startMs - now))
			.filter((c) => {
				const key = `${c.assetId}@${c.speed}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		let chain = Promise.resolve();
		for (const c of wanted) {
			const asset = index.assets.get(c.assetId);
			if (asset) chain = chain.then(() => this.buffer(asset, c.speed).then(() => undefined));
		}
	}

	private audible(clip: MediaClip, track: Track): boolean {
		if (clip.disabled || track.muted || track.hidden || clip.volume <= 0) return false;
		if (this.project?.data.tracks.some((t) => t.solo) && !track.solo) return false;
		if (this.filter === "muted") return false;
		if (this.filter === "voiceover") return Boolean(track.voiceover);
		if (this.filter === "exceptVoiceover") return !track.voiceover;
		return true;
	}

	private clearScheduled() {
		for (const source of this.scheduled) {
			try {
				source.stop();
			} catch {}
		}
		this.scheduled = [];
	}

	private reschedule() {
		this.clearScheduled();
		const project = this.project;
		const index = this.index;
		if (!project || !index || !this.playing || this.rate !== 1) return;
		const ctx = this.audio();
		const master = this.master as GainNode;
		const scheduledAtPerf = this.startPerf;
		for (const clip of project.data.clips) {
			if (clip.type !== "media") continue;
			const track = index.tracks.get(clip.trackId);
			const asset = index.assets.get(clip.assetId);
			if (
				!track ||
				!asset ||
				!asset.hasAudio ||
				asset.kind === "image" ||
				!this.audible(clip, track)
			)
				continue;
			if (clipEnd(clip) <= this.currentMs) continue;
			void this.buffer(asset, clip.speed).then((buffer) => {
				if (!buffer || !this.playing || this.startPerf !== scheduledAtPerf) return;
				const nowMs = this.startMs + (performance.now() - this.startPerf);
				const from = Math.max(nowMs, clip.startMs);
				if (from >= clipEnd(clip)) return;
				const base = ctx.currentTime + 0.01;
				const toCtx = (timelineMs: number) => base + Math.max(0, timelineMs - nowMs) / 1000;
				// The buffer is already stretched to timeline speed (pitch kept), so it plays at rate 1.
				const offset = (clip.inMs / clip.speed + (from - clip.startMs)) / 1000;
				const duration = (clipEnd(clip) - from) / 1000;
				const source = ctx.createBufferSource();
				source.buffer = buffer;
				// Gain stages: track level + fades, keyframed/clip volume, ducking.
				const fades = ctx.createGain();
				// The track's own level and pan live on its bus, so the mixer reacts instantly.
				const level = 1;
				const fadeIn = clip.fadeInMs;
				const fadeOut = audioFadeOut(index.byTrack.get(clip.trackId) ?? [], clip);
				const localFrom = from - clip.startMs;
				const at = (local: number) => {
					let g = level;
					if (fadeIn > 0 && local < fadeIn) g *= local / fadeIn;
					if (fadeOut > 0 && local > clip.durationMs - fadeOut)
						g *= Math.max(0, (clip.durationMs - local) / fadeOut);
					return g;
				};
				fades.gain.setValueAtTime(at(localFrom), toCtx(from));
				if (fadeIn > 0 && localFrom < fadeIn)
					fades.gain.linearRampToValueAtTime(level, toCtx(clip.startMs + fadeIn));
				if (fadeOut > 0) {
					const fadeStart = Math.max(localFrom, clip.durationMs - fadeOut);
					fades.gain.setValueAtTime(at(fadeStart), toCtx(clip.startMs + fadeStart));
					fades.gain.linearRampToValueAtTime(0, toCtx(clipEnd(clip)));
				}
				const volume = ctx.createGain();
				const keys = clip.keyframes?.volume;
				volume.gain.setValueAtTime(valueAt(keys, localFrom, clip.volume), toCtx(from));
				if (keys?.length)
					for (const k of keys)
						if (k.atMs > localFrom)
							volume.gain.linearRampToValueAtTime(k.value, toCtx(clip.startMs + k.atMs));
				let tail: AudioNode = volume;
				if (track.duck && !track.voiceover && index.voiceRanges.length) {
					const duck = ctx.createGain();
					duck.gain.setValueAtTime(1, base);
					for (const r of index.voiceRanges) {
						if (r.end <= nowMs) continue;
						duck.gain.setTargetAtTime(0.3, toCtx(r.start), 0.06);
						duck.gain.setTargetAtTime(1, toCtx(r.end), 0.18);
					}
					volume.connect(duck);
					tail = duck;
				}
				source.connect(fades).connect(volume);
				tail.connect(this.bus(track.id, master).gain);
				source.start(toCtx(from), offset, duration);
				this.scheduled.push(source);
			});
		}
	}
}

export const playback = new PlaybackEngine();
