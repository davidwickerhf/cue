import { useEffect, useRef, useState } from "react";
import type { Asset } from "../../../electron/core/types";
import { motionPoster } from "../../lib/motion";
import { app } from "../../lib/state";

const peaksCache = new Map<string, Promise<number[]>>();
const thumbsCache = new Map<string, Promise<{ intervalMs: number; urls: string[] }>>();

// Keyed by project, media id and file, so relinked media, re-rendered sequences and a copy of
// the project (same media ids, its own cache folder) load afresh.
const cacheKey = (assetId: string, file: string) =>
	`${app.get().state?.project?.path ?? ""}|${assetId}|${file}`;

function loadPeaks(assetId: string, file: string) {
	const key = cacheKey(assetId, file);
	let p = peaksCache.get(key);
	if (!p) {
		p = window.cue.peaks(assetId).catch(() => []);
		peaksCache.set(key, p);
	}
	return p;
}

export function loadThumbs(assetId: string, file: string) {
	const key = cacheKey(assetId, file);
	let p = thumbsCache.get(key);
	if (!p) {
		p = window.cue.thumbnails(assetId).catch(() => ({ intervalMs: 0, urls: [] }));
		thumbsCache.set(key, p);
	}
	return p;
}

const PEAKS_PER_SECOND = 50;

/** Waveform of the part of the source a clip plays. */
export function Waveform({
	assetId,
	file,
	inMs,
	spanMs,
	width,
	height,
	visible,
	color = "rgba(255,255,255,0.85)",
}: {
	assetId: string;
	/** The media's file, so a new file loads new peaks. */
	file: string;
	inMs: number;
	spanMs: number;
	width: number;
	height: number;
	/** Only this part (px from the left) is drawn; the whole width by default. */
	visible?: [number, number];
	color?: string;
}) {
	// Draw only the visible part: long clips at high zoom would need huge canvases.
	const from = Math.max(0, Math.min(width, visible?.[0] ?? 0));
	const to = Math.max(from, Math.min(width, visible?.[1] ?? width));
	const shown = to - from;
	const canvas = useRef<HTMLCanvasElement>(null);
	const [peaks, setPeaks] = useState<number[] | null>(null);
	useEffect(() => {
		let alive = true;
		void loadPeaks(assetId, file).then((p) => alive && setPeaks(p));
		return () => {
			alive = false;
		};
	}, [assetId, file]);
	useEffect(() => {
		const el = canvas.current;
		if (!el || !peaks || shown <= 0) return;
		const dpr = window.devicePixelRatio || 1;
		const w = Math.min(8192, Math.max(1, Math.round(shown * dpr)));
		const h = Math.max(1, Math.round(height * dpr));
		el.width = w;
		el.height = h;
		const ctx = el.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = color;
		const msPerPx = spanMs / Math.max(1, width);
		const first = ((inMs + from * msPerPx) / 1000) * PEAKS_PER_SECOND;
		const perPx = (((shown * msPerPx) / 1000) * PEAKS_PER_SECOND) / w;
		const mid = h / 2;
		for (let x = 0; x < w; x++) {
			const a = Math.floor(first + x * perPx);
			const b = Math.max(a + 1, Math.floor(first + (x + 1) * perPx));
			let max = 0;
			for (let i = a; i < b && i < peaks.length; i++) max = Math.max(max, peaks[i] ?? 0);
			const amp = (max / 255) * mid * 0.92;
			ctx.fillRect(x, mid - amp, 1, Math.max(1, amp * 2));
		}
	}, [peaks, inMs, spanMs, width, height, color, from, shown]);
	return (
		<canvas
			ref={canvas}
			className="pointer-events-none absolute bottom-0"
			style={{ left: from, width: shown, height }}
		/>
	);
}

/** Frames from the source laid across a video clip. */
export function Filmstrip({
	assetId,
	file,
	inMs,
	speed,
	width,
	height,
	pxPerMs,
	visible,
}: {
	assetId: string;
	/** The media's file, so a new file loads new frames. */
	file: string;
	inMs: number;
	speed: number;
	width: number;
	height: number;
	pxPerMs: number;
	/** Only tiles in this part (px from the left) are drawn. */
	visible?: [number, number];
}) {
	const [thumbs, setThumbs] = useState<{ intervalMs: number; urls: string[] } | null>(null);
	useEffect(() => {
		let alive = true;
		void loadThumbs(assetId, file).then((t) => alive && setThumbs(t));
		return () => {
			alive = false;
		};
	}, [assetId, file]);
	if (!thumbs || thumbs.urls.length === 0) return null;
	const tileW = Math.max(24, height * (16 / 9));
	const first = Math.max(0, Math.floor((visible?.[0] ?? 0) / tileW));
	const last = Math.min(Math.ceil(width / tileW), Math.ceil((visible?.[1] ?? width) / tileW));
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden opacity-90">
			{Array.from({ length: Math.max(0, last - first) }, (_, n) => {
				const i = first + n;
				const sourceMs = inMs + ((i * tileW) / pxPerMs) * speed;
				const index = Math.min(
					thumbs.urls.length - 1,
					Math.max(0, Math.floor(sourceMs / thumbs.intervalMs)),
				);
				return (
					<img
						key={i}
						src={thumbs.urls[index]}
						alt=""
						draggable={false}
						className="absolute top-0 h-full object-cover"
						style={{ left: i * tileW, width: tileW }}
					/>
				);
			})}
		</div>
	);
}

export function Tiled({ url, width, height }: { url: string; width: number; height: number }) {
	const tileW = Math.max(24, height * (16 / 9));
	const count = Math.min(60, Math.ceil(width / tileW));
	return (
		<div className="pointer-events-none absolute inset-0 flex overflow-hidden opacity-90">
			{Array.from({ length: count }, (_, i) => (
				<img
					key={i}
					src={url}
					alt=""
					draggable={false}
					className="h-full shrink-0 object-cover"
					style={{ width: tileW }}
				/>
			))}
		</div>
	);
}

/** A picture's small thumbnail repeated along its clip (never the full-size file). */
export function ImageTiles({
	asset,
	width,
	height,
}: {
	asset: Asset;
	width: number;
	height: number;
}) {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		let alive = true;
		void loadThumbs(asset.id, asset.path).then((t) => alive && setUrl(t.urls[0] ?? null));
		return () => {
			alive = false;
		};
	}, [asset.id, asset.path]);
	return url ? <Tiled url={url} width={width} height={height} /> : null;
}

/** A motion graphic's still, repeated along its clip like an image's. */
export function MotionTiles({
	asset,
	url,
	width,
	height,
}: {
	asset: Asset;
	url: string | undefined;
	width: number;
	height: number;
}) {
	const [poster, setPoster] = useState<string | null>(null);
	useEffect(() => {
		if (!url || !asset.motion) return;
		let alive = true;
		void motionPoster(url, asset.motion)
			.then((p) => alive && setPoster(p))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [url, asset.motion]);
	return poster ? <Tiled url={poster} width={width} height={height} /> : null;
}
