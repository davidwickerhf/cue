import { valueAt, zoomAt } from "../../electron/core/anim";
import {
	COMPRESSOR_KNEE_DB,
	compressorSettings,
	EQ_BANDS,
	FLAT_EQ,
} from "../../electron/core/audio";
import { BLUR_FROM, entered, overlaps, ZOOM_FROM } from "../../electron/core/transitions";
import type {
	Asset,
	Clip,
	ColorGrade,
	DenoiseMode,
	Effects,
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
	/** Dark-edge overlay for the vignette effect, made on first use. */
	vignette?: HTMLDivElement;
	/** Set once the slot's layer is rebuilt; stops its frame callbacks. */
	disposed?: boolean;
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

const joinFilters = (...parts: string[]) =>
	parts.filter((p) => p && p !== "none").join(" ") || "none";

/**
 * CSS for blur, sharpen and glow at `px` screen pixels per export pixel of a
 * 1080-line picture (same strengths as the exporter). Sharpen and glow use SVG
 * filters added to the page once.
 */
function effectsFilter(effects: Effects | undefined, px: number): string {
	if (!effects) return "none";
	const parts: string[] = [];
	if (effects.blur > 0) parts.push(`blur(${(effects.blur * 24 * px).toFixed(2)}px)`);
	if (effects.sharpen > 0) parts.push(`url(#${svgFilter("sharpen", effects.sharpen)})`);
	if (effects.glow > 0) parts.push(`url(#${svgFilter("glow", effects.glow)})`);
	return parts.join(" ") || "none";
}

/** Id of a shared SVG filter for an effect, in ten steps of strength. */
function svgFilter(kind: "sharpen" | "glow", amount: number): string {
	const step = Math.max(1, Math.min(10, Math.round(amount * 10)));
	const id = `cue-${kind}-${step}`;
	if (document.getElementById(id)) return id;
	let defs: Element | null = document.getElementById("cue-filters");
	if (!defs) {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("width", "0");
		svg.setAttribute("height", "0");
		svg.style.position = "absolute";
		const created = document.createElementNS("http://www.w3.org/2000/svg", "defs");
		created.id = "cue-filters";
		svg.append(created);
		defs = created;
		document.body.append(svg);
	}
	const k = step / 10;
	const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
	filter.id = id;
	filter.setAttribute("color-interpolation-filters", "sRGB");
	if (kind === "sharpen") {
		// An unsharp kernel that sums to 1, so brightness is kept.
		const a = (k * 0.6).toFixed(3);
		const c = (1 + k * 2.4).toFixed(3);
		filter.innerHTML = `<feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="0 -${a} 0 -${a} ${c} -${a} 0 -${a} 0" divisor="1"/>`;
	} else {
		filter.innerHTML = `<feGaussianBlur in="SourceGraphic" stdDeviation="${(4 + k * 8).toFixed(1)}" result="b"/><feComponentTransfer in="b" result="s"><feFuncR type="linear" slope="${(k * 0.8).toFixed(2)}"/><feFuncG type="linear" slope="${(k * 0.8).toFixed(2)}"/><feFuncB type="linear" slope="${(k * 0.8).toFixed(2)}"/></feComponentTransfer><feBlend in="SourceGraphic" in2="s" mode="screen"/>`;
	}
	defs.append(filter);
	return id;
}

/** Fade-out for a clip's sound, including a crossfade into the next clip (same rule as the exporter). */
function audioFadeOut(clips: Clip[], clip: MediaClip): number {
	let overlap = 0;
	for (const x of clips) {
		if (
			x.type === "media" &&
			x.id !== clip.id &&
			overlaps(x.transitionIn) &&
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
	private buses = new Map<string, Bus>();
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
	/** Bumped on every reschedule; audio still decoding for an older schedule is dropped. */
	private scheduleGen = 0;
	/** Clips already scheduled in the current generation. */
	private scheduledClips = new Set<string>();
	private startPerf = 0;
	private startMs = 0;
	private stopAtMs: number | null = null;
	private raf = 0;
	private filter: AudioFilter = "all";
	private preview: HTMLAudioElement | null = null;
	private tickListeners = new Set<(ms: number) => void>();
	private meterData = new Float32Array(1024);
	private frameCount = 0;
	private lastGrain = 0;
	/** Before/after: pictures without their grade and effects. */
	private original = false;
	private stageW = 0;
	private stageH = 0;
	private warmTimer: ReturnType<typeof setTimeout> | undefined;
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
		this.measure();
		this.rebuildLayers();
		this.render(this.currentMs);
	}

	detach() {
		this.pause();
		this.removeLayers();
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

	/**
	 * Reads the viewer's size once. Every layer fills the viewer, so frames use this
	 * instead of reading element sizes (which would force a layout on every frame).
	 */
	private measure() {
		this.stageW = this.stage?.clientWidth ?? 0;
		this.stageH = this.stage?.clientHeight ?? 0;
	}

	/** Shows every picture without its grade and effects while on (before/after). */
	setOriginal(on: boolean) {
		if (this.original === on) return;
		this.original = on;
		this.render(this.currentMs);
	}

	/**
	 * Draws roughly what the viewer shows into a small canvas (for scopes): each
	 * visible picture with its filters, then the text. Crops, masks and zooms are
	 * left out; it is for reading levels, not for export.
	 */
	drawComposite(ctx: CanvasRenderingContext2D, w: number, h: number) {
		const stage = this.stage;
		ctx.filter = "none";
		ctx.globalAlpha = 1;
		ctx.fillStyle = this.project?.data.canvas.background ?? "#000";
		ctx.fillRect(0, 0, w, h);
		if (!stage || !this.stageW || !this.stageH) return;
		const sx = w / this.stageW;
		const sy = h / this.stageH;
		const text = new Set([...this.textLayers.values()].map((l) => l.canvas as Element));
		const layers = new Map([...this.videoLayers.values()].map((l) => [l.root as Element, l]));
		for (const child of stage.children) {
			if (text.has(child)) {
				ctx.filter = "none";
				ctx.globalAlpha = 1;
				ctx.drawImage(child as HTMLCanvasElement, 0, 0, w, h);
				continue;
			}
			const layer = layers.get(child);
			if (!layer) continue;
			const slots = [...layer.slots].sort(
				(a, b) => Number(a.frame.style.zIndex || 0) - Number(b.frame.style.zIndex || 0),
			);
			for (const slot of slots) {
				const f = slot.frame.style;
				if (f.display === "none") continue;
				ctx.globalAlpha = Number(f.opacity || 1);
				if (f.backdropFilter) {
					// An adjustment layer: grade what is drawn so far.
					ctx.filter = f.backdropFilter;
					ctx.drawImage(ctx.canvas, 0, 0);
					continue;
				}
				const [, x = "0", y = "0"] =
					/translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(f.transform) ?? [];
				const source =
					slot.keyer && slot.keyer.canvas.style.display !== "none"
						? slot.keyer.canvas
						: slot.video.style.display !== "none"
							? slot.video
							: slot.image;
				ctx.filter = (source as HTMLElement).style.filter || "none";
				try {
					ctx.drawImage(
						source,
						Number(x) * sx,
						Number(y) * sy,
						Number.parseFloat(f.width) * sx,
						Number.parseFloat(f.height) * sy,
					);
				} catch {}
			}
		}
		ctx.filter = "none";
		ctx.globalAlpha = 1;
	}

	/** Redraw after the viewer changes size. */
	refresh() {
		this.measure();
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
			// Schedule sound a little ahead of the playhead rather than all at once.
			if (this.frameCount % 30 === 0) this.scheduleAhead();
			// Shuttling (J/L at other speeds) has no scheduled sound; play grains instead.
			if (this.rate !== 1 && this.frameCount % 5 === 0) this.scrubGrain(now);
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
			// Have the sound around the new position ready by the time play is pressed.
			clearTimeout(this.warmTimer);
			this.warmTimer = setTimeout(() => this.warmAudio(), 300);
		}
	}

	/**
	 * Moves the playhead while the user drags it, playing a short grain of the
	 * sound there so cuts can be found by ear (at most every 60 ms).
	 */
	scrub(ms: number) {
		this.seek(ms);
		const now = performance.now();
		if (now - this.lastGrain < 60) return;
		this.lastGrain = now;
		this.scrubGrain(ms);
	}

	/** About 80 ms of every audible clip at `ms`, faded in and out, through each track's bus. */
	private scrubGrain(ms: number) {
		const project = this.project;
		const index = this.index;
		if (!project || !index) return;
		const ctx = this.audio();
		void ctx.resume();
		const master = this.master as GainNode;
		for (const clip of project.data.clips) {
			if (clip.type !== "media" || ms < clip.startMs || ms >= clipEnd(clip)) continue;
			const track = index.tracks.get(clip.trackId);
			const asset = index.assets.get(clip.assetId);
			if (!track || !asset?.hasAudio || asset.kind === "image" || !this.audible(clip, track))
				continue;
			// Only sound that is already decoded: scrubbing must never wait.
			const key = bufferKey(asset, clip.speed, clip.denoise);
			const pending = this.buffers.get(key);
			if (!pending) {
				void this.buffer(asset, clip.speed, clip.denoise);
				continue;
			}
			void pending.then((buffer) => {
				if (!buffer) return;
				const offset = (clip.inMs / clip.speed + (ms - clip.startMs)) / 1000;
				if (offset < 0 || offset >= buffer.duration) return;
				const source = ctx.createBufferSource();
				source.buffer = buffer;
				source.playbackRate.value = Math.min(4, Math.max(0.5, Math.abs(this.rate) || 1));
				const env = ctx.createGain();
				const t = ctx.currentTime;
				env.gain.setValueAtTime(0, t);
				env.gain.linearRampToValueAtTime(clip.volume, t + 0.008);
				env.gain.setValueAtTime(clip.volume, t + 0.07);
				env.gain.linearRampToValueAtTime(0, t + 0.085);
				source.connect(env).connect(this.bus(track.id, master).input);
				source.start(t, offset, 0.09);
			});
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

	/** Removes every layer, releasing its decoders and WebGL contexts, not just the DOM nodes. */
	private removeLayers() {
		for (const layer of this.videoLayers.values()) {
			for (const slot of layer.slots) {
				slot.disposed = true;
				slot.keyer?.dispose();
				slot.video.removeAttribute("src");
				slot.video.load();
			}
			layer.root.remove();
		}
		for (const layer of this.textLayers.values()) layer.canvas.remove();
		this.videoLayers.clear();
		this.textLayers.clear();
	}

	/** One DOM layer per visual track, stacked in track order like the exporter. */
	private rebuildLayers() {
		const stage = this.stage;
		const project = this.project;
		if (!stage || !project) return;
		this.removeLayers();
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
			image.crossOrigin = "anonymous";
			image.className = "absolute inset-0 size-full object-fill";
			image.draggable = false;
			image.addEventListener("load", () => {
				if (slot.keyer && slot.keyedClip?.key && slot.image.style.display !== "none")
					slot.keyer.draw(slot.image, slot.keyedClip.key);
			});
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
				if (slot.keyer && slot.keyedClip?.key && video.style.display !== "none")
					slot.keyer.draw(video, slot.keyedClip.key);
			};
			const onFrame = () => {
				redraw();
				if (!slot.disposed) video.requestVideoFrameCallback(onFrame);
			};
			video.requestVideoFrameCallback(onFrame);
			// A paused video only has its frame once a seek or load finishes.
			video.addEventListener("seeked", redraw);
			video.addEventListener("loadeddata", redraw);
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
				// Its own stacking context: the z-index of a slot (crossfades) orders it within
				// this track only, never above the tracks drawn after it.
				root.style.zIndex = "0";
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
			// The two most recent clips; the later one draws on top (crossfades). A clip keeps
			// the slot it is already in, so a crossfade never reloads (and blanks) the outgoing picture.
			const shown = active.slice(-2);
			const assigned: (MediaClip | undefined)[] = [undefined, undefined];
			for (const c of shown) {
				const i = layer.slots.findIndex((slot) => slot.clipId === c.id);
				if (i >= 0 && !assigned[i]) assigned[i] = c;
			}
			for (const c of shown) {
				if (assigned.includes(c)) continue;
				const free = assigned.findIndex((a, i) => !a && layer.slots[i].clipId === null);
				assigned[free >= 0 ? free : assigned.findIndex((a) => !a)] = c;
			}
			const top = shown.at(-1);
			layer.slots.forEach((slot, i) => {
				this.renderSlot(slot, assigned[i], ms);
				slot.frame.style.zIndex = assigned[i] && assigned[i] === top ? "1" : "0";
			});
			// An idle slot loads the next clip ahead of time, so the cut to it is instant.
			const idle = layer.slots.find((_, i) => !assigned[i]);
			if (idle) {
				const next = (index.byTrack.get(trackId) ?? []).find(
					(c): c is MediaClip =>
						c.type === "media" && c.startMs > ms && c.startMs - ms < PRELOAD_MS,
				);
				if (next) this.preload(idle, next);
			}
		}
		this.drawText(ms);
	}

	/** A dark edge over the slot's picture (made on first use). */
	private showVignette(slot: Slot, effects: Effects | undefined) {
		const amount = effects?.vignette ?? 0;
		if (!amount) {
			if (slot.vignette) slot.vignette.style.display = "none";
			return;
		}
		if (!slot.vignette) {
			slot.vignette = document.createElement("div");
			slot.vignette.className = "pointer-events-none absolute inset-0";
			slot.vignette.style.zIndex = "2";
			slot.frame.append(slot.vignette);
		}
		slot.vignette.style.display = "";
		const inner = Math.round(70 - amount * 45);
		slot.vignette.style.background = `radial-gradient(ellipse at center, transparent ${inner}%, rgba(0,0,0,${(0.35 + amount * 0.55).toFixed(2)}) 100%)`;
	}

	/** Loads a clip's first frame into a hidden slot. */
	private preload(slot: Slot, clip: MediaClip) {
		const project = this.project;
		const asset = this.index?.assets.get(clip.assetId);
		if (!project || asset?.kind !== "video") return;
		const url = project.proxyUrls[clip.assetId] ?? project.assetUrls[clip.assetId];
		if (slot.src !== url) {
			slot.video.src = url;
			slot.src = url;
			slot.pendingSeek = null;
		}
		const target = clip.inMs / 1000;
		if (Math.abs(slot.video.currentTime - target) > 0.015) this.seekVideo(slot, target);
	}

	private renderSlot(slot: Slot, clip: MediaClip | undefined, ms: number) {
		const project = this.project;
		const index = this.index;
		if (!clip || !project || !index) {
			if (slot.frame.style.display !== "none") slot.frame.style.display = "none";
			if (!slot.video.paused) slot.video.pause();
			slot.clipId = null;
			return;
		}
		const asset = index.assets.get(clip.assetId);
		if (asset?.kind === "adjustment") return this.renderAdjustment(slot, clip, ms);
		if (slot.frame.style.backdropFilter) slot.frame.style.backdropFilter = "";
		const isImage = asset?.kind === "image";
		const url = isImage
			? project.assetUrls[clip.assetId]
			: (project.proxyUrls[clip.assetId] ?? project.assetUrls[clip.assetId]);
		const local = ms - clip.startMs;
		const t = clip.transform;
		const kf = clip.keyframes;
		// How far the transition into this clip has got (1 once it is over).
		const tr = clip.transitionIn;
		const p = entered(tr, local);
		const scale =
			valueAt(kf?.scale, local, t.scale) * (tr?.kind === "zoom" ? 1 + ZOOM_FROM * (1 - p) : 1);
		const x =
			valueAt(kf?.x, local, t.x) +
			(tr?.kind === "slide-left" ? 1 - p : tr?.kind === "slide-right" ? p - 1 : 0);
		const y = valueAt(kf?.y, local, t.y);
		let opacity = t.opacity;
		if (clip.fadeInMs > 0 && local < clip.fadeInMs) opacity *= local / clip.fadeInMs;
		if (clip.fadeOutMs > 0 && local > clip.durationMs - clip.fadeOutMs)
			opacity *= (clip.durationMs - local) / clip.fadeOutMs;
		const W = this.stageW;
		const H = this.stageH;
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
		// A wipe uncovers the picture from one side, on top of any crop.
		const left = Math.max(c.left, tr?.kind === "wipe-left" ? 1 - p : 0);
		const right = Math.max(c.right, tr?.kind === "wipe-right" ? 1 - p : 0);
		frame.clipPath =
			left || c.top || right || c.bottom
				? `inset(${c.top * 100}% ${right * 100}% ${c.bottom * 100}% ${left * 100}%)`
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
		// Effects are sized like the export's: in pixels of a 1080-line picture.
		// "Compare" shows the pictures as they were shot: no grade, no effects.
		const look = this.original ? undefined : clip;
		element.style.filter = joinFilters(
			cssFilter(look?.color),
			effectsFilter(look?.effects, h / 1080),
			tr?.kind === "blur" && p < 1 ? `blur(${((1 - p) * BLUR_FROM * h) / 1080}px)` : "",
		);
		this.showVignette(slot, look?.effects);
		// Chroma key: the picture stays underneath (still decoding) while a WebGL canvas shows it keyed.
		if (clip.key) {
			if (slot.keyer === undefined) {
				slot.keyer = createKeyer();
				if (slot.keyer) slot.frame.append(slot.keyer.canvas);
			}
			if (slot.keyer) {
				slot.keyedClip = clip;
				element.style.opacity = "0";
				const k = slot.keyer.canvas.style;
				k.display = "";
				k.transform = element.style.transform;
				k.transformOrigin = element.style.transformOrigin;
				k.filter = element.style.filter;
				slot.keyer.draw(element, clip.key);
			}
		} else if (slot.keyedClip) {
			slot.keyedClip = null;
			slot.video.style.opacity = "";
			slot.image.style.opacity = "";
			if (slot.keyer) slot.keyer.canvas.style.display = "none";
		}
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
		if (slot.src !== url) {
			video.src = url;
			slot.src = url;
			slot.pendingSeek = null;
		}
		const target = (clip.inMs + local * clip.speed) / 1000;
		const base = Math.min(16, clip.speed * Math.abs(this.rate));
		if (this.playing && this.rate > 0) {
			// Positive when the picture is behind the clock.
			const error = target - video.currentTime;
			const drift = Math.abs(error);
			// Small drift is corrected by playing slightly faster or slower (invisible);
			// only a large jump seeks, which would stall the picture for a moment.
			const rate =
				drift > 0.02 && drift <= 0.5 ? base * (1 + Math.max(-0.08, Math.min(0.08, error))) : base;
			if (Math.abs(video.playbackRate - rate) > 0.001) video.playbackRate = rate;
			if (video.paused) {
				if (drift > 0.05) this.seekVideo(slot, target);
				void video.play().catch(() => {});
			} else if (drift > 0.5) this.seekVideo(slot, target);
		} else {
			if (video.playbackRate !== base) video.playbackRate = base;
			if (!video.paused) video.pause();
			if (Math.abs(video.currentTime - target) > 0.015) this.seekVideo(slot, target);
		}
	}

	/** An adjustment layer: a full-frame backdrop filter grading everything drawn below it. */
	private renderAdjustment(slot: Slot, clip: MediaClip, ms: number) {
		const frame = slot.frame.style;
		const local = ms - clip.startMs;
		let opacity = clip.transform.opacity;
		if (clip.fadeInMs > 0 && local < clip.fadeInMs) opacity *= local / clip.fadeInMs;
		if (clip.fadeOutMs > 0 && local > clip.durationMs - clip.fadeOutMs)
			opacity *= (clip.durationMs - local) / clip.fadeOutMs;
		frame.display = "";
		frame.width = `${this.stageW}px`;
		frame.height = `${this.stageH}px`;
		frame.transform = "none";
		frame.opacity = String(Math.max(0, Math.min(1, opacity)));
		frame.clipPath = "none";
		frame.maskImage = clip.mask
			? `url(${maskUrl(clip.mask, this.stageW / Math.max(1, this.stageH))})`
			: "none";
		frame.maskSize = "100% 100%";
		const look = this.original ? undefined : clip;
		const backdrop = joinFilters(
			cssFilter(look?.color),
			effectsFilter(look?.effects && { ...look.effects, glow: 0 }, this.stageH / 1080),
		);
		frame.backdropFilter = backdrop === "none" ? "" : backdrop;
		this.showVignette(slot, look?.effects);
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
			const w = Math.max(1, Math.round(this.stageW * dpr));
			const h = Math.max(1, Math.round(this.stageH * dpr));
			const frames = active.map((c) => ({ c, f: textFrame(c, ms - c.startMs, H) }));
			// Skip the redraw when nothing on this layer looks different from the last frame.
			const key = `${w}x${h}|${frames.map(({ c, f }) => `${c.id}:${f.alpha.toFixed(3)}:${f.scale.toFixed(3)}:${f.offsetY.toFixed(1)}:${f.reveal}:${f.word ?? ""}:${(f.wordP ?? 1).toFixed(2)}`).join(",")}`;
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

	/**
	 * Per-track mixer strip, like a desk channel: EQ, compressor, fader, pan and
	 * a meter, feeding the master. The export applies the same chain to each
	 * track's submix. Nodes live as long as the track, so changes never rebuild.
	 */
	private bus(trackId: string, master: GainNode) {
		let bus = this.buses.get(trackId);
		if (!bus) {
			const ctx = this.audio();
			const input = ctx.createGain();
			const band = (type: BiquadFilterType, frequency: number, q?: number) => {
				const f = ctx.createBiquadFilter();
				f.type = type;
				f.frequency.value = frequency;
				if (q) f.Q.value = q;
				f.gain.value = 0;
				return f;
			};
			const low = band(EQ_BANDS.low.type, EQ_BANDS.low.frequency);
			const mid = band(EQ_BANDS.mid.type, EQ_BANDS.mid.frequency, EQ_BANDS.mid.q);
			const high = band(EQ_BANDS.high.type, EQ_BANDS.high.frequency);
			const compressor = ctx.createDynamicsCompressor();
			compressor.knee.value = COMPRESSOR_KNEE_DB;
			compressor.ratio.value = 1;
			const makeup = ctx.createGain();
			const gain = ctx.createGain();
			const pan = ctx.createStereoPanner();
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 512;
			input
				.connect(low)
				.connect(mid)
				.connect(high)
				.connect(compressor)
				.connect(makeup)
				.connect(gain)
				.connect(pan)
				.connect(master);
			pan.connect(analyser);
			bus = { input, low, mid, high, compressor, makeup, gain, pan, analyser };
			this.buses.set(trackId, bus);
			const track = this.index?.tracks.get(trackId);
			if (track) this.levelBus(bus, track);
		}
		return bus;
	}

	private levelBus(bus: Bus, track: Track) {
		const ctx = this.audio();
		bus.gain.gain.setTargetAtTime(track.volume, ctx.currentTime, 0.015);
		bus.pan.pan.setTargetAtTime(track.pan ?? 0, ctx.currentTime, 0.015);
		this.toneBus(bus, track.eq ?? FLAT_EQ, track.compressor?.amount ?? 0, 0.015);
	}

	/** EQ and compressor settings, eased in so a change never clicks. */
	private toneBus(bus: Bus, eq: Track["eq"] & {}, amount: number, smoothing: number) {
		const now = this.audio().currentTime;
		bus.low.gain.setTargetAtTime(eq.low, now, smoothing);
		bus.mid.gain.setTargetAtTime(eq.mid, now, smoothing);
		bus.high.gain.setTargetAtTime(eq.high, now, smoothing);
		const c = compressorSettings(amount);
		const ratio = c.active ? c.ratio : 1;
		bus.compressor.threshold.setTargetAtTime(c.thresholdDb, now, smoothing);
		bus.compressor.ratio.setTargetAtTime(ratio, now, smoothing);
		bus.compressor.attack.setTargetAtTime(c.attackMs / 1000, now, smoothing);
		bus.compressor.release.setTargetAtTime(c.releaseMs / 1000, now, smoothing);
		// Web Audio's compressor adds its own makeup gain; swap it for ours so the preview matches the export.
		const makeupDb = c.active ? c.makeupDb - builtInMakeupDb(c.thresholdDb, ratio) : 0;
		bus.makeup.gain.setTargetAtTime(10 ** (makeupDb / 20), now, smoothing);
	}

	/** Moves a fader or pan knob live while it is dragged (the edit is saved on release). */
	previewTrackMix(trackId: string, mix: { volume?: number; pan?: number }) {
		const bus = this.buses.get(trackId);
		if (!bus || !this.ctx) return;
		if (mix.volume !== undefined)
			bus.gain.gain.setTargetAtTime(mix.volume, this.ctx.currentTime, 0.01);
		if (mix.pan !== undefined) bus.pan.pan.setTargetAtTime(mix.pan, this.ctx.currentTime, 0.01);
	}

	/** Moves an EQ band or the compressor live while it is dragged. */
	previewTrackTone(
		trackId: string,
		tone: { eq?: Partial<NonNullable<Track["eq"]>>; compressor?: number },
	) {
		const bus = this.buses.get(trackId);
		const track = this.index?.tracks.get(trackId);
		if (!bus || !track || !this.ctx) return;
		this.toneBus(
			bus,
			{ ...FLAT_EQ, ...track.eq, ...tone.eq },
			tone.compressor ?? track.compressor?.amount ?? 0,
			0.01,
		);
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

	/** Decoded audio for an asset at a speed, from a small extracted, time-stretched or denoised file. */
	private buffer(asset: Asset, speed: number, denoise?: DenoiseMode): Promise<AudioBuffer | null> {
		// Keyed by file too, so relinked media and re-rendered sequences are heard as they are now.
		const key = bufferKey(asset, speed, denoise);
		let cached = this.buffers.get(key);
		if (!cached) {
			cached = window.cue
				.audioProxy(asset.id, speed, denoise ?? "off")
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

	/**
	 * Decodes the sound needed around the playhead (nearest first, one at a time)
	 * and lets go of sound that is far away or no longer used, so memory stays
	 * bounded however long the project is.
	 */
	private warmAudio() {
		const index = this.index;
		if (!index || !this.project) return;
		const now = this.currentMs;
		const near = (c: MediaClip) =>
			clipEnd(c) > now - KEEP_BEHIND_MS && c.startMs < now + WARM_AHEAD_MS;
		const wanted = new Map<
			string,
			{ asset: Asset; speed: number; denoise: DenoiseMode; distance: number }
		>();
		for (const c of this.project.data.clips) {
			if (c.type !== "media" || !near(c)) continue;
			const asset = index.assets.get(c.assetId);
			if (!asset?.hasAudio || asset.kind === "image") continue;
			const key = bufferKey(asset, c.speed, c.denoise);
			const distance = Math.max(0, c.startMs - now);
			const seen = wanted.get(key);
			if (!seen || distance < seen.distance)
				wanted.set(key, { asset, speed: c.speed, denoise: c.denoise, distance });
		}
		for (const key of this.buffers.keys()) if (!wanted.has(key)) this.buffers.delete(key);
		let chain = Promise.resolve();
		for (const { asset, speed, denoise } of [...wanted.values()].sort(
			(a, b) => a.distance - b.distance,
		))
			chain = chain.then(() => this.buffer(asset, speed, denoise).then(() => undefined));
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
		this.scheduleGen++;
		this.scheduledClips.clear();
		for (const source of this.scheduled) {
			try {
				source.stop();
			} catch {}
		}
		this.scheduled = [];
	}

	private reschedule() {
		this.clearScheduled();
		this.scheduleAhead();
	}

	/** Schedules the clips that start before the lookahead, once each per generation. */
	private scheduleAhead() {
		const project = this.project;
		const index = this.index;
		if (!project || !index || !this.playing || this.rate !== 1) return;
		const ctx = this.audio();
		const master = this.master as GainNode;
		const gen = this.scheduleGen;
		const horizon = this.currentMs + SCHEDULE_AHEAD_MS;
		this.warmAudio();
		for (const clip of project.data.clips) {
			if (clip.type !== "media") continue;
			if (clip.startMs > horizon || this.scheduledClips.has(clip.id)) continue;
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
			this.scheduledClips.add(clip.id);
			void this.buffer(asset, clip.speed, clip.denoise).then((buffer) => {
				if (!buffer || !this.playing || this.scheduleGen !== gen) return;
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
				// Overlapping transitions crossfade the sound even when the picture doesn't fade.
				const fadeIn = Math.max(
					clip.fadeInMs,
					overlaps(clip.transitionIn) ? (clip.transitionIn?.durationMs ?? 0) : 0,
				);
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
				tail.connect(this.bus(track.id, master).input);
				source.start(toCtx(from), offset, duration);
				this.scheduled.push(source);
			});
		}
	}
}

interface Bus {
	/** Clips connect here. */
	input: GainNode;
	low: BiquadFilterNode;
	mid: BiquadFilterNode;
	high: BiquadFilterNode;
	compressor: DynamicsCompressorNode;
	makeup: GainNode;
	/** The track's fader, after the dynamics (as on a desk). */
	gain: GainNode;
	pan: StereoPannerNode;
	analyser: AnalyserNode;
}

/**
 * The makeup gain the Web Audio spec builds into its compressor: 0.6 of what
 * a full-scale signal loses (the knee is ignored, it is small).
 */
function builtInMakeupDb(thresholdDb: number, ratio: number): number {
	return -0.6 * thresholdDb * (1 - 1 / ratio);
}

/** A hidden slot loads the next clip this long before it starts. */
const PRELOAD_MS = 1500;

/** Sound is scheduled this far ahead of the playhead… */
const SCHEDULE_AHEAD_MS = 20_000;
/** …decoded this far ahead… */
const WARM_AHEAD_MS = 60_000;
/** …and kept this far behind it. */
const KEEP_BEHIND_MS = 30_000;

/** Denoised sound is a separate proxy, so the preview hears what the export will. */
function bufferKey(asset: Asset, speed: number, denoise?: DenoiseMode) {
	const clean = denoise && denoise !== "off" ? `~${denoise}` : "";
	return `${asset.id}|${asset.path}@${Math.round(speed * 1000) / 1000}${clean}`;
}

export const playback = new PlaybackEngine();
