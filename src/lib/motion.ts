import { DotLottie } from "@lottiefiles/dotlottie-web";
import wasmUrl from "@lottiefiles/dotlottie-web/dotlottie-player.wasm?url";
import {
	applyMotion,
	type LottieJson,
	type MotionInfo,
	type MotionSettings,
	motionKey,
} from "../../electron/core/motion";
import { MOTION_FONTS } from "../../electron/core/motionSpec";

/**
 * Draws motion graphics (Lottie) for the viewer and for export. Each animation is
 * played by ThorVG compiled to WebAssembly (LottieFiles' dotlottie-web): the
 * file's expressions run inside that engine, never as JavaScript in this window.
 * Frames are drawn on demand (`setFrame` renders at once), so the viewer and the
 * export show exactly the same picture for the same time.
 */

DotLottie.setWasmUrl(wasmUrl);

/** Fonts bundled for motion graphics (Inter, Space Grotesk, Instrument Serif, JetBrains Mono). */
const fontFiles = import.meta.glob("../assets/motion-fonts/*.ttf", {
	eager: true,
	query: "?url",
	import: "default",
}) as Record<string, string>;

/**
 * Registers the bundled fonts, before the first graphic loads (text layers look
 * fonts up by name). A font that fails (its file couldn't be read while the app
 * was busy) is tried again, and again before every new graphic, so one bad
 * moment never leaves a session drawing text in the fallback font.
 */
const registered = new Set<string>();
let registering: Promise<void> | null = null;
function registerFonts(): Promise<void> {
	if (registered.size === MOTION_FONTS.length) return Promise.resolve();
	registering ??= (async () => {
		for (let attempt = 0; attempt < 3 && registered.size < MOTION_FONTS.length; attempt++) {
			if (attempt) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
			await Promise.all(
				MOTION_FONTS.filter((f) => !registered.has(f.name)).map(async (f) => {
					const url = Object.entries(fontFiles).find(([file]) =>
						file.endsWith(`/${f.name}.ttf`),
					)?.[1];
					if (!url) return;
					try {
						const res = await fetch(url);
						if (!res.ok) return;
						const bytes = new Uint8Array(await res.arrayBuffer());
						if (await DotLottie.registerFont(f.name, bytes)) registered.add(f.name);
					} catch {}
				}),
			);
		}
		for (const f of MOTION_FONTS)
			if (!registered.has(f.name)) console.warn(`[motion] Could not register the font ${f.name}.`);
	})().finally(() => {
		registering = null;
	});
	return registering;
}
void registerFonts();

interface Player {
	/** Made once the file is read (the player takes its data when created). */
	dot: DotLottie | null;
	/**
	 * What the engine renders into: just a size. Its pixels are copied straight into
	 * the canvas that shows them, so graphics hold no GPU surfaces of their own
	 * (dozens of offscreen canvases exhausted the GPU process).
	 */
	surface: { width: number; height: number };
	ready: Promise<void>;
	loaded: boolean;
	failed?: string;
	frame: number;
	usedAt: number;
}

const documents = new Map<string, Promise<LottieJson>>();
const players = new Map<string, Player>();
/** Called when a player finishes loading, so the viewer can draw it. */
const listeners = new Set<() => void>();

export function onMotionReady(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function load(url: string): Promise<LottieJson> {
	let doc = documents.get(url);
	if (!doc) {
		doc = fetch(url).then(async (r) => {
			if (!r.ok) throw new Error(`Could not read the motion graphic (${r.status}).`);
			return (await r.json()) as LottieJson;
		});
		doc.catch(() => documents.delete(url));
		documents.set(url, doc);
	}
	return doc;
}

/** Frees the player for `key` (a gallery preview that has drawn its still). */
export function releaseMotion(key: string) {
	for (const [k, p] of players)
		if (k.startsWith(`${key}|`)) {
			p.dot?.destroy();
			players.delete(k);
		}
}

/** Gives a document to play under `key` without a file (gallery previews). */
export function provideMotion(key: string, json: LottieJson) {
	if (!documents.has(key)) documents.set(key, Promise.resolve(json));
}

/** Forgets a file's cached copy (after it changed on disk). */
export function forgetMotion(url: string) {
	documents.delete(url);
	for (const [key, p] of players)
		if (key.startsWith(`${url}|`)) {
			p.dot?.destroy();
			players.delete(key);
		}
}

/** Whether any graphic is still loading: stills wait for them. */
export async function motionSettled(timeoutMs = 8000): Promise<void> {
	await Promise.race([
		Promise.all([...players.values()].map((p) => p.ready)),
		new Promise((resolve) => setTimeout(resolve, timeoutMs)),
	]);
}

/** The player for one file with one clip's changes, made on first use. */
function player(url: string, settings: MotionSettings | undefined): Player {
	const key = `${url}|${motionKey(settings)}`;
	const existing = players.get(key);
	if (existing) {
		existing.usedAt = performance.now();
		return existing;
	}
	const surface = { width: 2, height: 2 };
	let resolveReady: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	const p: Player = {
		dot: null,
		surface,
		ready,
		loaded: false,
		frame: -1,
		usedAt: performance.now(),
	};
	const fail = (message: string) => {
		p.failed = message;
		resolveReady();
	};
	Promise.all([load(url), registerFonts()])
		.then(([json]) => {
			if (players.get(key) !== p) return resolveReady();
			const dot = new DotLottie({
				canvas: surface,
				data: JSON.stringify(applyMotion(json, settings)),
				autoplay: false,
				loop: false,
				renderConfig: { autoResize: false, freezeOnOffscreen: false, devicePixelRatio: 1 },
				layout: { fit: "fill", align: [0.5, 0.5] },
			});
			p.dot = dot;
			const loaded = () => {
				if (p.loaded) return;
				p.loaded = true;
				resolveReady();
				for (const l of listeners) l();
			};
			dot.addEventListener("load", loaded);
			// Without a real canvas the engine can finish loading before this line.
			if (dot.isLoaded) loaded();
			dot.addEventListener("loadError", (event) =>
				fail(String((event as { error?: Error }).error?.message ?? "Could not play the graphic.")),
			);
		})
		.catch((error: Error) => fail(error.message));
	players.set(key, p);
	prune();
	return p;
}

/** Keeps at most a dozen players (each holds a frame buffer as big as the viewer). */
const MAX_PLAYERS = 12;
function prune() {
	// Gallery previews free themselves once drawn; only the edit's graphics count here.
	const own = [...players.entries()].filter(([key]) => !key.startsWith("preview:"));
	if (own.length <= MAX_PLAYERS) return;
	const oldest = own.sort((a, b) => a[1].usedAt - b[1].usedAt);
	for (const [key, p] of oldest.slice(0, own.length - MAX_PLAYERS)) {
		p.dot?.destroy();
		players.delete(key);
	}
}

/** Renders a frame at `width` × `height`; its pixels (RGBA), or null until loaded. */
function renderFrame(p: Player, frame: number, width: number, height: number): ImageData | null {
	if (!p.loaded || !p.dot) return null;
	const w = Math.max(2, Math.round(width));
	const h = Math.max(2, Math.round(height));
	if (p.surface.width !== w || p.surface.height !== h) {
		p.surface.width = w;
		p.surface.height = h;
		p.dot.resize();
		p.frame = -1;
	}
	if (p.frame !== frame) {
		p.dot.setFrame(frame);
		p.frame = frame;
	}
	const buffer = p.dot.buffer;
	if (!buffer || buffer.byteLength !== w * h * 4) return null;
	// Copied: the engine's memory may move when it renders again.
	return new ImageData(new Uint8ClampedArray(buffer), w, h);
}

/**
 * Draws a motion graphic's frame to fill `ctx`'s canvas. Returns false while the
 * file is still loading (the viewer is told when it is ready).
 */
export function drawMotion(
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	url: string,
	settings: MotionSettings | undefined,
	frame: number,
): boolean {
	const p = player(url, settings);
	const { width, height } = ctx.canvas;
	const pixels = renderFrame(p, frame, width, height);
	if (!pixels) {
		ctx.clearRect(0, 0, width, height);
		return false;
	}
	ctx.putImageData(pixels, 0, 0);
	return true;
}

/** Waits until a motion graphic can be drawn (for export and stills). */
export async function motionReady(url: string, settings: MotionSettings | undefined) {
	const p = player(url, settings);
	await p.ready;
	if (p.failed) throw new Error(p.failed);
}

/**
 * Renders frames of a motion graphic as PNGs at `width` × `height`, for export.
 * `frames` are animation frame numbers; repeated frames reuse the last encode.
 */
export async function rasteriseMotion(
	url: string,
	settings: MotionSettings | undefined,
	frames: number[],
	width: number,
	height: number,
): Promise<ArrayBuffer[]> {
	await motionReady(url, settings);
	const p = player(url, settings);
	const canvas = new OffscreenCanvas(
		Math.max(2, Math.round(width)),
		Math.max(2, Math.round(height)),
	);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas is not available.");
	const out: ArrayBuffer[] = [];
	let last: { frame: number; png: ArrayBuffer } | null = null;
	for (const frame of frames) {
		if (last && Math.abs(last.frame - frame) < 1e-3) {
			out.push(last.png);
			continue;
		}
		const pixels = renderFrame(p, frame, canvas.width, canvas.height);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (pixels) ctx.putImageData(pixels, 0, 0);
		const png = await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
		last = { frame, png };
		out.push(png);
	}
	return out;
}
const posters = new Map<string, Promise<string>>();

/**
 * A still of a motion graphic for thumbnails (an object URL, made once per file):
 * the frame 60% of the way in, when intro animations have usually settled.
 */
export function motionPoster(url: string, info: MotionInfo, maxSide = 480): Promise<string> {
	let poster = posters.get(url);
	if (!poster) {
		poster = (async () => {
			const frame = info.inFrame + (info.outFrame - info.inFrame) * 0.6;
			const json = await load(url);
			const k = maxSide / Math.max(json.w, json.h, 1);
			const [png] = await rasteriseMotion(url, undefined, [frame], json.w * k, json.h * k);
			return URL.createObjectURL(new Blob([png], { type: "image/png" }));
		})();
		poster.catch(() => posters.delete(url));
		posters.set(url, poster);
	}
	return poster;
}
