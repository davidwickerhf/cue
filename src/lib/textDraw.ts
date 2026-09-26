import type { TextClip } from "../../electron/core/types";

const IN_MS = 320;
const OUT_MS = 250;

export interface TextFrame {
	alpha: number;
	scale: number;
	offsetY: number;
	/** Characters revealed (typewriter), or Infinity. */
	reveal: number;
	offsetX?: number;
	/** Word-by-word captions: the word being said (-1 before the first) and how far into it, 0–1. */
	word?: number;
	wordP?: number;
}

/** How long a word's pop or bounce lasts. */
const WORD_MS = 180;

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
		if (kind === "slide-left") {
			frame.alpha *= e;
			frame.offsetX = (frame.offsetX ?? 0) + (1 - e) * canvasHeight * 0.08;
		}
		if (kind === "zoom") {
			frame.alpha *= e;
			frame.scale *= 1.25 - 0.25 * e;
		}
	};
	if (clip.animationIn === "typewriter") {
		const total = Math.min(clip.durationMs * 0.6, clip.text.length * 38);
		frame.reveal = Math.floor((localMs / Math.max(1, total)) * clip.text.length);
	} else apply(clip.animationIn, inP);
	if (clip.animationOut !== "typewriter") apply(clip.animationOut, outP);
	if (clip.wordStyle && clip.words?.length) {
		let word = -1;
		for (let i = 0; i < clip.words.length; i++) if (localMs >= clip.words[i].startMs) word = i;
		frame.word = word;
		frame.wordP =
			word < 0 ? 0 : Math.min(1, Math.max(0, (localMs - clip.words[word].startMs) / WORD_MS));
	}
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
	ctx.font = `${style.italic ? "italic " : ""}${style.fontWeight} ${style.fontSize}px "${style.fontFamily}", "DM Sans Variable", system-ui, sans-serif`;
	ctx.letterSpacing = `${style.letterSpacing}px`;
	ctx.textBaseline = "middle";
	const maxText = Math.max(10, style.width * width - style.padding * 2);
	const measureLines = wrap(ctx, raw, maxText);
	const lines = Number.isFinite(f.reveal) ? wrap(ctx, text, maxText) : measureLines;
	const lineHeight = style.fontSize * style.lineHeight;
	const textWidth = Math.max(...measureLines.map((line) => ctx.measureText(line).width), 1);
	const boxW = Math.min(style.width * width, textWidth + style.padding * 2);
	const boxH = measureLines.length * lineHeight + style.padding * 2;
	const cx = style.x * width + (f.offsetX ?? 0);
	const cy = style.y * height + f.offsetY;
	ctx.globalAlpha = f.alpha;
	ctx.translate(cx, cy);
	if (style.rotation) ctx.rotate((style.rotation * Math.PI) / 180);
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
	if (style.gradientTo) {
		const gradient = ctx.createLinearGradient(
			0,
			top + style.padding,
			0,
			top + boxH - style.padding,
		);
		gradient.addColorStop(0, style.color);
		gradient.addColorStop(1, style.gradientTo);
		ctx.fillStyle = gradient;
	} else ctx.fillStyle = style.color;
	ctx.textAlign = style.align;
	const x =
		style.align === "left"
			? left + style.padding
			: style.align === "right"
				? left + boxW - style.padding
				: 0;
	const outline = style.strokeColor && (style.strokeWidth ?? 0) > 0;
	if (clip.wordStyle && clip.words?.length) {
		drawWords(ctx, clip, f, { left, top, boxW, maxText, lineHeight, outline: !!outline });
		ctx.restore();
		return;
	}
	lines.forEach((line, i) => {
		const y = top + style.padding + lineHeight * (i + 0.5);
		if (outline) {
			// Outline first, then the fill on top, so the stroke sits outside the letters.
			ctx.save();
			ctx.strokeStyle = style.strokeColor as string;
			ctx.lineWidth = (style.strokeWidth ?? 0) * 2;
			ctx.lineJoin = "round";
			ctx.strokeText(line, x, y);
			ctx.restore();
		}
		ctx.fillText(line, x, y);
	});
	ctx.restore();
}

/** Draws a clip's words one by one, styling the word being said. */
function drawWords(
	ctx: CanvasRenderingContext2D,
	clip: TextClip,
	f: TextFrame,
	box: {
		left: number;
		top: number;
		boxW: number;
		maxText: number;
		lineHeight: number;
		outline: boolean;
	},
) {
	const style = clip.style;
	const ws = clip.wordStyle as NonNullable<TextClip["wordStyle"]>;
	const words = (clip.words ?? []).map((w) => (style.uppercase ? w.text.toUpperCase() : w.text));
	// A little wider than a space: the word being said grows and needs room.
	const space = ctx.measureText(" ").width + style.fontSize * 0.1;
	// Lines of word indices, wrapped like the rest of the text.
	const lines: number[][] = [[]];
	let width = 0;
	words.forEach((word, i) => {
		const w = ctx.measureText(word).width;
		const line = lines[lines.length - 1];
		if (line.length && width + space + w > box.maxText) {
			lines.push([i]);
			width = w;
		} else {
			line.push(i);
			width += (line.length > 1 ? space : 0) + w;
		}
	});
	const fill = ctx.fillStyle;
	const active = f.word ?? -1;
	const p = f.wordP ?? 1;
	ctx.textAlign = "left";
	lines.forEach((line, row) => {
		const lineW =
			line.reduce((n, i) => n + ctx.measureText(words[i]).width, 0) + space * (line.length - 1);
		let x =
			style.align === "left"
				? box.left + style.padding
				: style.align === "right"
					? box.left + box.boxW - style.padding - lineW
					: -lineW / 2;
		const y = box.top + style.padding + box.lineHeight * (row + 0.5);
		for (const i of line) {
			const w = ctx.measureText(words[i]).width;
			const said = i <= active;
			const now = i === active;
			// Reveal: words appear as they are said.
			if (ws.mode === "reveal" && !said) {
				x += w + space;
				continue;
			}
			ctx.save();
			ctx.fillStyle = now ? ws.color : fill;
			if (ws.mode === "reveal" && now) ctx.globalAlpha *= 0.35 + 0.65 * p;
			let dy = 0;
			let scale = 1;
			if (now && ws.mode === "pop") scale = 1 + 0.22 * (1 - p) * (1 - p) + 0.06;
			if (now && ws.mode === "bounce") dy = -Math.sin(Math.PI * p) * style.fontSize * 0.16;
			ctx.translate(x + w / 2, y + dy);
			ctx.scale(scale, scale);
			if (box.outline) {
				ctx.save();
				ctx.strokeStyle = style.strokeColor as string;
				ctx.lineWidth = (style.strokeWidth ?? 0) * 2;
				ctx.lineJoin = "round";
				ctx.strokeText(words[i], -w / 2, 0);
				ctx.restore();
			}
			ctx.fillText(words[i], -w / 2, 0);
			ctx.restore();
			x += w + space;
		}
	});
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
	if (clip.animationIn === "none" && clip.animationOut === "none" && !clip.wordStyle) {
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
		const key = `${frame.alpha.toFixed(3)}|${frame.scale.toFixed(3)}|${frame.offsetY.toFixed(1)}|${frame.reveal}|${frame.word ?? ""}|${(frame.wordP ?? 1).toFixed(2)}`;
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
