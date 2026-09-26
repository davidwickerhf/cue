import { useEffect, useRef, useState } from "react";

const peaksCache = new Map<string, Promise<number[]>>();
const thumbsCache = new Map<string, Promise<{ intervalMs: number; urls: string[] }>>();

// Keyed by media id and file, so relinked media and re-rendered sequences load afresh.
function loadPeaks(assetId: string, file: string) {
	const key = `${assetId}|${file}`;
	let p = peaksCache.get(key);
	if (!p) {
		p = window.cue.peaks(assetId).catch(() => []);
		peaksCache.set(key, p);
	}
	return p;
}

function loadThumbs(assetId: string, file: string) {
	const key = `${assetId}|${file}`;
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
	color = "rgba(255,255,255,0.85)",
}: {
	assetId: string;
	/** The media's file, so a new file loads new peaks. */
	file: string;
	inMs: number;
	spanMs: number;
	width: number;
	height: number;
	color?: string;
}) {
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
		if (!el || !peaks || width <= 0) return;
		const dpr = window.devicePixelRatio || 1;
		const w = Math.min(8192, Math.max(1, Math.round(width * dpr)));
		const h = Math.max(1, Math.round(height * dpr));
		el.width = w;
		el.height = h;
		const ctx = el.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = color;
		const first = (inMs / 1000) * PEAKS_PER_SECOND;
		const perPx = ((spanMs / 1000) * PEAKS_PER_SECOND) / w;
		const mid = h / 2;
		for (let x = 0; x < w; x++) {
			const a = Math.floor(first + x * perPx);
			const b = Math.max(a + 1, Math.floor(first + (x + 1) * perPx));
			let max = 0;
			for (let i = a; i < b && i < peaks.length; i++) max = Math.max(max, peaks[i] ?? 0);
			const amp = (max / 255) * mid * 0.92;
			ctx.fillRect(x, mid - amp, 1, Math.max(1, amp * 2));
		}
	}, [peaks, inMs, spanMs, width, height, color]);
	return (
		<canvas
			ref={canvas}
			className="pointer-events-none absolute inset-x-0 bottom-0"
			style={{ width, height }}
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
}: {
	assetId: string;
	/** The media's file, so a new file loads new frames. */
	file: string;
	inMs: number;
	speed: number;
	width: number;
	height: number;
	pxPerMs: number;
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
	const count = Math.min(200, Math.ceil(width / tileW));
	return (
		<div className="pointer-events-none absolute inset-0 flex overflow-hidden opacity-90">
			{Array.from({ length: count }, (_, i) => {
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
						className="h-full shrink-0 object-cover"
						style={{ width: tileW }}
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
