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

/** Registered once, before the first graphic loads (text layers look fonts up by name). */
const fontsReady: Promise<unknown> = Promise.all(
	MOTION_FONTS.map((f) => {
		const url = Object.entries(fontFiles).find(([file]) => file.endsWith(`/${f.name}.ttf`))?.[1];
		return url ? DotLottie.registerFont(f.name, url).catch(() => false) : false;
	}),
);

interface Player {
	/** Made once the file is read (the player takes its data when created). */
	dot: DotLottie | null;
	canvas: OffscreenCanvas;
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
export async function motionSettled(): Promise<void> {
	await Promise.all([...players.values()].map((p) => p.ready));
}

/** The player for one file with one clip's changes, made on first use. */
function player(url: string, settings: MotionSettings | undefined): Player {
	const key = `${url}|${motionKey(settings)}`;
	const existing = players.get(key);
	if (existing) {
		existing.usedAt = performance.now();
		return existing;
	}
	const canvas = new OffscreenCanvas(2, 2);
	let resolveReady: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	const p: Player = {
		dot: null,
		canvas,
		ready,
		loaded: false,
		frame: -1,
		usedAt: performance.now(),
	};
	const fail = (message: string) => {
		p.failed = message;
		resolveReady();
	};
	Promise.all([load(url), fontsReady])
		.then(([json]) => {
			if (players.get(key) !== p) return resolveReady();
			const dot = new DotLottie({
				canvas,
				data: JSON.stringify(applyMotion(json, settings)),
				autoplay: false,
				loop: false,
				renderConfig: { autoResize: false, freezeOnOffscreen: false, devicePixelRatio: 1 },
				layout: { fit: "fill", align: [0.5, 0.5] },
			});
			p.dot = dot;
			dot.addEventListener("load", () => {
				p.loaded = true;
				resolveReady();
				for (const l of listeners) l();
			});
			dot.addEventListener("loadError", (event) =>
				fail(String((event as { error?: Error }).error?.message ?? "Could not play the graphic.")),
			);
		})
		.catch((error: Error) => fail(error.message));
	players.set(key, p);
	prune();
	return p;
}

/** Keeps at most a few dozen players (each holds a frame buffer). */
function prune() {
	if (players.size <= 24) return;
	const oldest = [...players.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt);
	for (const [key, p] of oldest.slice(0, players.size - 24)) {
		p.dot?.destroy();
		players.delete(key);
	}
}

/** Renders a frame at `width` × `height` into the player's canvas; null until loaded. */
function renderFrame(
	p: Player,
	frame: number,
	width: number,
	height: number,
): OffscreenCanvas | null {
	if (!p.loaded || !p.dot) return null;
	const w = Math.max(2, Math.round(width));
	const h = Math.max(2, Math.round(height));
	if (p.canvas.width !== w || p.canvas.height !== h) {
		p.canvas.width = w;
		p.canvas.height = h;
		p.dot.resize();
		p.frame = -1;
	}
	if (p.frame !== frame) {
		p.dot.setFrame(frame);
		p.frame = frame;
	}
	return p.canvas;
}

/**
 * Draws a motion graphic's frame to fill `ctx`'s canvas. Returns false while the
 * file is still loading (the viewer is told when it is ready).
 */
export function drawMotion(
	ctx: CanvasRenderingContext2D,
	url: string,
	settings: MotionSettings | undefined,
	frame: number,
): boolean {
	const p = player(url, settings);
	const { width, height } = ctx.canvas;
	const source = renderFrame(p, frame, width, height);
	ctx.clearRect(0, 0, width, height);
	if (!source) return false;
	ctx.drawImage(source, 0, 0);
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
		const source = renderFrame(p, frame, canvas.width, canvas.height);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (source) ctx.drawImage(source, 0, 0);
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
