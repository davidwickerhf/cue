import type { TextClip } from "../../electron/core/types";

const IN_MS = 320;
const OUT_MS = 250;

export interface TextFrame {
	alpha: number;
	scale: number;
	offsetY: number;
	/** Characters revealed (typewriter), or Infinity. */
	reveal: number;
}

/** Animation state for a text clip `localMs` after it starts. */
export function textFrame(clip: TextClip, localMs: number, canvasHeight: number): TextFrame {
	const frame: TextFrame = { alpha: 1, scale: 1, offsetY: 0, reveal: Number.POSITIVE_INFINITY };
	const inP = Math.min(1, Math.max(0, localMs / IN_MS));
	const outP = Math.min(1, Math.max(0, (clip.durationMs - localMs) / OUT_MS));
	const ease = (t: number) => 1 - (1 - t) ** 3;
	const apply = (kind: TextClip["animationIn"], p: number) => {
		const e = ease(p);
		if (kind === "fade") frame.alpha *= e;
		if (kind === "pop") {
			frame.alpha *= e;
			frame.scale *= 0.86 + 0.14 * e;
		}
		if (kind === "slide-up") {
			frame.alpha *= e;
			frame.offsetY += (1 - e) * canvasHeight * 0.03;
		}
	};
	if (clip.animationIn === "typewriter") {
		const total = Math.min(clip.durationMs * 0.6, clip.text.length * 38);
		frame.reveal = Math.floor((localMs / Math.max(1, total)) * clip.text.length);
	} else apply(clip.animationIn, inP);
	if (clip.animationOut !== "typewriter") apply(clip.animationOut, outP);
	return frame;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		const words = paragraph.split(/\s+/).filter(Boolean);
		let current = "";
		for (const word of words) {
			const candidate = current ? `${current} ${word}` : word;
			if (current && ctx.measureText(candidate).width > maxWidth) {
				lines.push(current);
				current = word;
			} else current = candidate;
		}
		lines.push(current);
	}
	return lines;
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
) {
	const radius = Math.min(r, h / 2, w / 2);
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, radius);
}

/**
 * Draws one text clip onto a canvas that represents the full output frame
 * (`width` × `height` in output pixels; scale the context for previews).
 */
export function drawTextClip(
	ctx: CanvasRenderingContext2D,
	clip: TextClip,
	width: number,
	height: number,
	frame?: TextFrame,
) {
	const style = clip.style;
	const f = frame ?? { alpha: 1, scale: 1, offsetY: 0, reveal: Number.POSITIVE_INFINITY };
	if (f.alpha <= 0.001) return;
	const raw = style.uppercase ? clip.text.toUpperCase() : clip.text;
	const text = Number.isFinite(f.reveal) ? raw.slice(0, Math.max(0, f.reveal)) : raw;
	ctx.save();
	ctx.font = `${style.fontWeight} ${style.fontSize}px "${style.fontFamily}", "DM Sans Variable", system-ui, sans-serif`;
	ctx.letterSpacing = `${style.letterSpacing}px`;
	ctx.textBaseline = "middle";
	const maxText = Math.max(10, style.width * width - style.padding * 2);
	const measureLines = wrap(ctx, raw, maxText);
	const lines = Number.isFinite(f.reveal) ? wrap(ctx, text, maxText) : measureLines;
	const lineHeight = style.fontSize * style.lineHeight;
	const textWidth = Math.max(...measureLines.map((line) => ctx.measureText(line).width), 1);
	const boxW = Math.min(style.width * width, textWidth + style.padding * 2);
	const boxH = measureLines.length * lineHeight + style.padding * 2;
	const cx = style.x * width;
	const cy = style.y * height + f.offsetY;
	ctx.globalAlpha = f.alpha;
	ctx.translate(cx, cy);
	ctx.scale(f.scale, f.scale);
	const left = -boxW / 2;
	const top = -boxH / 2;
	if (style.background) {
		if (style.shadow) {
			ctx.shadowColor = "rgba(0,0,0,0.25)";
			ctx.shadowBlur = style.fontSize * 0.5;
			ctx.shadowOffsetY = style.fontSize * 0.08;
		}
		ctx.fillStyle = style.background;
		roundRect(ctx, left, top, boxW, boxH, style.radius);
		ctx.fill();
		ctx.shadowColor = "transparent";
	} else if (style.shadow) {
		ctx.shadowColor = "rgba(0,0,0,0.55)";
		ctx.shadowBlur = style.fontSize * 0.18;
		ctx.shadowOffsetY = style.fontSize * 0.05;
	}
	ctx.fillStyle = style.color;
	ctx.textAlign = style.align;
	const x =
		style.align === "left"
			? left + style.padding
			: style.align === "right"
				? left + boxW - style.padding
				: 0;
	lines.forEach((line, i) => {
		ctx.fillText(line, x, top + style.padding + lineHeight * (i + 0.5));
	});
	ctx.restore();
}

async function png(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
	if (!blob) throw new Error("Could not encode text.");
	return blob.arrayBuffer();
}

/**
 * Renders a text clip for export at the output size. Clips with animations
 * become a frame sequence so the exported motion matches the preview exactly.
 */
export async function rasterise(
	clip: TextClip,
	width: number,
	height: number,
	fps: number,
): Promise<{ still?: ArrayBuffer; frames?: ArrayBuffer[] }> {
	await document.fonts
		.load(`${clip.style.fontWeight} ${clip.style.fontSize}px "${clip.style.fontFamily}"`)
		.catch(() => {});
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas is not available.");
	if (clip.animationIn === "none" && clip.animationOut === "none") {
		drawTextClip(ctx, clip, width, height);
		return { still: await png(canvas) };
	}
	const frames: ArrayBuffer[] = [];
	const count = Math.max(1, Math.ceil((clip.durationMs / 1000) * fps));
	let previous: ArrayBuffer | null = null;
	let previousKey = "";
	for (let i = 0; i < count; i++) {
		const frame = textFrame(clip, (i * 1000) / fps, height);
		// Identical frames (the static middle of a clip) reuse the last encode.
		const key = `${frame.alpha.toFixed(3)}|${frame.scale.toFixed(3)}|${frame.offsetY.toFixed(1)}|${frame.reveal}`;
		if (previous && key === previousKey) {
			frames.push(previous);
			continue;
		}
		ctx.clearRect(0, 0, width, height);
		drawTextClip(ctx, clip, width, height, frame);
		previous = await png(canvas);
		previousKey = key;
		frames.push(previous);
	}
	return { frames };
}
