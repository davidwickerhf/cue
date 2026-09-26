import { useEffect, useRef, useState } from "react";
import { playback } from "../../lib/playback";
import { cn } from "../../lib/utils";

/** The picture is read at this size; enough for levels, cheap to scan. */
const W = 240;
const H = 135;

type Kind = "waveform" | "vectorscope" | "histogram";

/**
 * Video scopes for grading, drawn from what the viewer shows about eight times
 * a second: a luma waveform (brightness across the picture), a vectorscope
 * (hue and saturation) and an RGB histogram.
 */
export function Scopes() {
	const [kinds, setKinds] = useState<Record<Kind, boolean>>({
		waveform: true,
		vectorscope: true,
		histogram: true,
	});
	const refs = {
		waveform: useRef<HTMLCanvasElement>(null),
		vectorscope: useRef<HTMLCanvasElement>(null),
		histogram: useRef<HTMLCanvasElement>(null),
	};
	useEffect(() => {
		const source = document.createElement("canvas");
		source.width = W;
		source.height = H;
		const ctx = source.getContext("2d", { willReadFrequently: true });
		if (!ctx) return;
		const timer = setInterval(() => {
			playback.drawComposite(ctx, W, H);
			let pixels: Uint8ClampedArray;
			try {
				pixels = ctx.getImageData(0, 0, W, H).data;
			} catch {
				return;
			}
			if (refs.waveform.current) drawWaveform(refs.waveform.current, pixels);
			if (refs.vectorscope.current) drawVectorscope(refs.vectorscope.current, pixels);
			if (refs.histogram.current) drawHistogram(refs.histogram.current, pixels);
		}, 125);
		return () => clearInterval(timer);
		// biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
	}, []);
	return (
		<div className="flex flex-col gap-3 p-3">
			<div className="flex gap-1">
				{(Object.keys(kinds) as Kind[]).map((k) => (
					<button
						key={k}
						type="button"
						onClick={() => setKinds({ ...kinds, [k]: !kinds[k] })}
						className={cn(
							"h-6 rounded-md px-2 text-[11px] capitalize",
							kinds[k] ? "bg-default text-foreground" : "text-muted hover:text-foreground",
						)}
					>
						{k}
					</button>
				))}
			</div>
			{kinds.waveform && (
				<Scope label="Waveform · luma 0–100">
					<canvas ref={refs.waveform} width={W} height={128} className="h-32 w-full" />
				</Scope>
			)}
			{kinds.vectorscope && (
				<Scope label="Vectorscope">
					<canvas
						ref={refs.vectorscope}
						width={180}
						height={180}
						className="mx-auto size-[180px]"
					/>
				</Scope>
			)}
			{kinds.histogram && (
				<Scope label="Histogram · RGB">
					<canvas ref={refs.histogram} width={256} height={100} className="h-24 w-full" />
				</Scope>
			)}
		</div>
	);
}

function Scope({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<figure className="flex flex-col gap-1">
			<figcaption className="text-[11px] text-muted">{label}</figcaption>
			<div className="rounded-md bg-black p-1 ring-1 ring-white/5">{children}</div>
		</figure>
	);
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function drawWaveform(canvas: HTMLCanvasElement, px: Uint8ClampedArray) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	const w = canvas.width;
	const h = canvas.height;
	const hits = new Uint16Array(w * h);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4;
			const l = luma(px[i], px[i + 1], px[i + 2]);
			const row = h - 1 - Math.round((l / 255) * (h - 1));
			hits[row * w + Math.round((x / (W - 1)) * (w - 1))]++;
		}
	const out = ctx.createImageData(w, h);
	for (let i = 0; i < hits.length; i++) {
		const v = Math.min(255, hits[i] * 40);
		out.data[i * 4] = v * 0.55;
		out.data[i * 4 + 1] = v;
		out.data[i * 4 + 2] = v * 0.6;
		out.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(out, 0, 0);
	// Guides at 0, 25, 50, 75 and 100 %.
	ctx.strokeStyle = "rgba(255,255,255,0.12)";
	for (const p of [0, 0.25, 0.5, 0.75, 1]) {
		const y = Math.round((1 - p) * (h - 1)) + 0.5;
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(w, y);
		ctx.stroke();
	}
}

function drawVectorscope(canvas: HTMLCanvasElement, px: Uint8ClampedArray) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	const size = canvas.width;
	const hits = new Uint16Array(size * size);
	for (let i = 0; i < px.length; i += 4) {
		const r = px[i];
		const g = px[i + 1];
		const b = px[i + 2];
		const cb = -0.1146 * r - 0.3854 * g + 0.5 * b;
		const cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
		const x = Math.round(size / 2 + (cb / 128) * (size / 2 - 4));
		const y = Math.round(size / 2 - (cr / 128) * (size / 2 - 4));
		if (x >= 0 && y >= 0 && x < size && y < size) hits[y * size + x]++;
	}
	const out = ctx.createImageData(size, size);
	for (let i = 0; i < hits.length; i++) {
		const v = Math.min(255, hits[i] * 30);
		out.data[i * 4] = v * 0.7;
		out.data[i * 4 + 1] = v;
		out.data[i * 4 + 2] = v * 0.8;
		out.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(out, 0, 0);
	ctx.strokeStyle = "rgba(255,255,255,0.15)";
	ctx.beginPath();
	ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
	ctx.moveTo(size / 2, 4);
	ctx.lineTo(size / 2, size - 4);
	ctx.moveTo(4, size / 2);
	ctx.lineTo(size - 4, size / 2);
	ctx.stroke();
	// The skin-tone line (about 123°), which faces should sit along.
	ctx.strokeStyle = "rgba(255,190,120,0.35)";
	ctx.beginPath();
	ctx.moveTo(size / 2, size / 2);
	const a = (123 * Math.PI) / 180;
	ctx.lineTo(size / 2 + Math.cos(a) * (size / 2 - 4), size / 2 - Math.sin(a) * (size / 2 - 4));
	ctx.stroke();
}

function drawHistogram(canvas: HTMLCanvasElement, px: Uint8ClampedArray) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
	for (let i = 0; i < px.length; i += 4) {
		bins[0][px[i]]++;
		bins[1][px[i + 1]]++;
		bins[2][px[i + 2]]++;
	}
	const w = canvas.width;
	const h = canvas.height;
	const max = Math.max(1, ...bins.flatMap((b) => [...b.slice(1, 255)]));
	ctx.clearRect(0, 0, w, h);
	ctx.globalCompositeOperation = "lighter";
	const colors = ["rgba(255,70,70,0.6)", "rgba(70,255,110,0.6)", "rgba(80,140,255,0.6)"];
	bins.forEach((bin, c) => {
		ctx.fillStyle = colors[c];
		for (let x = 0; x < 256; x++) {
			const v = Math.min(h, (bin[x] / max) * h);
			ctx.fillRect(x, h - v, 1, v);
		}
	});
	ctx.globalCompositeOperation = "source-over";
}
