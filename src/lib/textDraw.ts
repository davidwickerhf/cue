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
	chartP?: number;
}

/** How long a word's pop or bounce lasts. */
const WORD_MS = 180;

/** Animation state for a text clip `localMs` after it starts. */
export function textFrame(clip: TextClip, localMs: number, canvasHeight: number): TextFrame {
	const frame: TextFrame = { alpha: 1, scale: 1, offsetY: 0, reveal: Number.POSITIVE_INFINITY };
	if (clip.infographic) frame.chartP = Math.min(1, Math.max(0, localMs / 850));
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

function drawInfographic(
	ctx: CanvasRenderingContext2D,
	clip: TextClip,
	width: number,
	height: number,
	frame: TextFrame,
) {
	const chart = clip.infographic;
	if (!chart) return;
	const scale = height / 1080;
	const panelW = Math.min(width * 0.8, 1350 * scale);
	const panelH = Math.min(height * 0.77, 790 * scale);
	const x = (width - panelW) / 2;
	const y = (height - panelH) / 2;
	const pad = 68 * scale;
	const p = 1 - (1 - (frame.chartP ?? 1)) ** 3;
	const ink =
		chart.palette === "mono" ? "#181818" : chart.palette === "electric" ? "#eaf5ff" : "#18201c";
	const paper =
		chart.palette === "electric" ? "#101f29" : chart.palette === "mono" ? "#f4f3ef" : "#f3f1e8";
	const accent =
		chart.palette === "electric" ? "#7cf5cc" : chart.palette === "mono" ? "#b44c3d" : "#e06b43";
	const subdued = chart.palette === "electric" ? "#829fac" : "#65716a";
	const number = (value: number) =>
		`${Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${chart.unit ? ` ${chart.unit}` : ""}`;
	ctx.save();
	ctx.globalAlpha *= frame.alpha;
	ctx.fillStyle = paper;
	roundRect(ctx, x, y, panelW, panelH, 12 * scale);
	ctx.fill();
	ctx.fillStyle = accent;
	ctx.fillRect(x, y, 8 * scale, panelH);
	ctx.textBaseline = "top";
	ctx.textAlign = "left";
	ctx.fillStyle = subdued;
	ctx.font = `600 ${24 * scale}px "DM Sans Variable", sans-serif`;
	ctx.fillText("CUE  /  DATA", x + pad, y + 42 * scale);
	ctx.fillStyle = ink;
	ctx.font = `700 ${Math.min(64, chart.title.length > 32 ? 48 : 64) * scale}px "DM Sans Variable", sans-serif`;
	ctx.fillText(chart.title, x + pad, y + 88 * scale, panelW - pad * 2);
	const bodyY = y + 210 * scale;
	const bodyH = panelH - 305 * scale;
	const items = chart.items;
	const max = Math.max(1, ...items.map((item) => item.value));
	if (chart.kind === "bars") {
		const rowH = bodyH / items.length;
		const labelW = panelW * 0.27;
		const barW = panelW - pad * 2 - labelW - 130 * scale;
		items.forEach((item, i) => {
			const ry = bodyY + i * rowH + rowH * 0.25;
			ctx.fillStyle = ink;
			ctx.font = `600 ${Math.min(29, (145 / Math.max(5, item.label.length)) * 5) * scale}px "DM Sans Variable", sans-serif`;
			ctx.fillText(item.label, x + pad, ry, labelW - 15 * scale);
			ctx.fillStyle = chart.palette === "electric" ? "#30444b" : "#d8dcd4";
			roundRect(ctx, x + pad + labelW, ry, barW, 34 * scale, 5 * scale);
			ctx.fill();
			ctx.fillStyle = i === 0 ? accent : ink;
			roundRect(
				ctx,
				x + pad + labelW,
				ry,
				Math.max(2, ((barW * item.value) / max) * p),
				34 * scale,
				5 * scale,
			);
			ctx.fill();
			ctx.textAlign = "right";
			ctx.fillStyle = ink;
			ctx.font = `700 ${27 * scale}px "DM Sans Variable", sans-serif`;
			ctx.fillText(number(item.value * p), x + panelW - pad, ry, 115 * scale);
			ctx.textAlign = "left";
		});
	} else if (chart.kind === "donut") {
		const total = items.reduce((sum, item) => sum + item.value, 0);
		const cx = x + panelW * 0.36;
		const cy = bodyY + bodyH * 0.48;
		const radius = Math.min(bodyH * 0.39, panelW * 0.2);
		let angle = -Math.PI / 2;
		items.forEach((item, i) => {
			const sweep = total > 0 ? (item.value / total) * Math.PI * 2 * p : 0;
			ctx.beginPath();
			ctx.arc(cx, cy, radius, angle, angle + sweep);
			ctx.strokeStyle =
				i === 0 ? accent : [ink, "#98a79d", "#c6d0c9", "#678375", "#ddd0b0", "#b5b1a1"][i % 6];
			ctx.lineWidth = 75 * scale;
			ctx.stroke();
			angle += sweep;
		});
		ctx.textAlign = "center";
		ctx.fillStyle = ink;
		ctx.font = `700 ${57 * scale}px "DM Sans Variable", sans-serif`;
		ctx.fillText(number(total * p), cx, cy - 25 * scale);
		ctx.font = `500 ${21 * scale}px "DM Sans Variable", sans-serif`;
		ctx.fillText("TOTAL", cx, cy + 42 * scale);
		ctx.textAlign = "left";
		items.forEach((item, i) => {
			const ly = bodyY + i * Math.min(61 * scale, bodyH / items.length) + 20 * scale;
			ctx.fillStyle = i === 0 ? accent : ink;
			ctx.fillRect(x + panelW * 0.67, ly + 7 * scale, 12 * scale, 12 * scale);
			ctx.fillStyle = ink;
			ctx.font = `500 ${25 * scale}px "DM Sans Variable", sans-serif`;
			ctx.fillText(item.label, x + panelW * 0.69, ly, panelW * 0.18);
			ctx.textAlign = "right";
			ctx.fillText(`${total ? Math.round((item.value / total) * 100) : 0}%`, x + panelW - pad, ly);
			ctx.textAlign = "left";
		});
	} else if (chart.kind === "line") {
		const left = x + pad + 30 * scale;
		const right = x + panelW - pad - 30 * scale;
		const top = bodyY + 25 * scale;
		const bottom = bodyY + bodyH - 65 * scale;
		ctx.strokeStyle = chart.palette === "electric" ? "#36535d" : "#cbd3c9";
		ctx.lineWidth = 2 * scale;
		for (let tick = 0; tick <= 4; tick++) {
			const ty = top + ((bottom - top) * tick) / 4;
			ctx.beginPath();
			ctx.moveTo(left, ty);
			ctx.lineTo(right, ty);
			ctx.stroke();
		}
		const point = (i: number) => ({
			px: left + ((right - left) * i) / Math.max(1, items.length - 1),
			py: bottom - ((bottom - top) * items[i].value) / max,
		});
		const visible = Math.max(0, (items.length - 1) * p);
		ctx.strokeStyle = accent;
		ctx.lineWidth = 6 * scale;
		ctx.lineJoin = "round";
		ctx.beginPath();
		items.forEach((_, i) => {
			if (i > visible) return;
			const { px, py } = point(i);
			if (i === 0) ctx.moveTo(px, py);
			else ctx.lineTo(px, py);
		});
		if (visible < items.length - 1) {
			const i = Math.floor(visible);
			const a = point(i),
				b = point(Math.min(items.length - 1, i + 1));
			ctx.lineTo(a.px + (b.px - a.px) * (visible - i), a.py + (b.py - a.py) * (visible - i));
		}
		ctx.stroke();
		items.forEach((item, i) => {
			if (i > visible) return;
			const { px, py } = point(i);
			ctx.fillStyle = paper;
			ctx.beginPath();
			ctx.arc(px, py, 9 * scale, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = accent;
			ctx.lineWidth = 4 * scale;
			ctx.stroke();
			ctx.fillStyle = ink;
			ctx.textAlign = "center";
			ctx.font = `700 ${24 * scale}px "DM Sans Variable", sans-serif`;
			ctx.fillText(number(item.value), px, py - 41 * scale, 130 * scale);
			ctx.font = `500 ${21 * scale}px "DM Sans Variable", sans-serif`;
			ctx.fillText(
				item.label,
				px,
				bottom + 21 * scale,
				Math.max(90 * scale, (right - left) / items.length),
			);
		});
		ctx.textAlign = "left";
	} else if (chart.kind === "timeline") {
		const left = x + pad + 28 * scale;
		const right = x + panelW - pad - 28 * scale;
		const cy = bodyY + bodyH * 0.53;
		ctx.fillStyle = chart.palette === "electric" ? "#36535d" : "#cbd3c9";
		ctx.fillRect(left, cy - 3 * scale, right - left, 6 * scale);
		ctx.fillStyle = accent;
		ctx.fillRect(left, cy - 3 * scale, (right - left) * p, 6 * scale);
		items.forEach((item, i) => {
			const progress = i / Math.max(1, items.length - 1);
			const px = left + (right - left) * progress;
			const active = p >= progress;
			ctx.fillStyle = active ? accent : subdued;
			ctx.beginPath();
			ctx.arc(px, cy, 12 * scale, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = ink;
			ctx.textAlign = "center";
			ctx.font = `700 ${29 * scale}px "DM Sans Variable", sans-serif`;
			ctx.fillText(active ? number(item.value) : "", px, cy - 85 * scale, 145 * scale);
			ctx.font = `600 ${22 * scale}px "DM Sans Variable", sans-serif`;
			ctx.fillText(
				item.label,
				px,
				cy + 39 * scale,
				Math.max(100 * scale, (right - left) / items.length),
			);
		});
		ctx.textAlign = "left";
	} else {
		const columns = Math.min(3, items.length);
		const rows = Math.ceil(items.length / columns);
		const gap = 15 * scale;
		const cardW = (panelW - pad * 2 - gap * (columns - 1)) / columns;
		const cardH = (bodyH - gap * (rows - 1)) / rows;
		items.forEach((item, i) => {
			const cx = x + pad + (i % columns) * (cardW + gap);
			const cy = bodyY + Math.floor(i / columns) * (cardH + gap);
			ctx.fillStyle = chart.palette === "electric" ? "#1d3840" : "#e5e8df";
			roundRect(ctx, cx, cy, cardW, cardH, 7 * scale);
			ctx.fill();
			ctx.fillStyle = i === 0 ? accent : ink;
			ctx.font = `700 ${Math.min(66, 600 / Math.max(6, number(item.value).length)) * scale}px "DM Sans Variable", sans-serif`;
			ctx.fillText(number(item.value * p), cx + 24 * scale, cy + 25 * scale, cardW - 48 * scale);
			ctx.fillStyle = subdued;
			ctx.font = `600 ${24 * scale}px "DM Sans Variable", sans-serif`;
			ctx.fillText(item.label, cx + 24 * scale, cy + cardH - 60 * scale, cardW - 48 * scale);
		});
	}
	ctx.fillStyle = subdued;
	ctx.font = `500 ${21 * scale}px "DM Sans Variable", sans-serif`;
	ctx.fillText(
		chart.source ? `SOURCE  ${chart.source}` : "",
		x + pad,
		y + panelH - 49 * scale,
		panelW - pad * 2,
	);
	ctx.restore();
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
	if (clip.infographic) {
		ctx.restore();
		drawInfographic(ctx, clip, width, height, f);
		return;
	}
	if (clip.shape) drawShape(ctx, clip.shape, width, height);
	if (!clip.text.trim()) {
		ctx.restore();
		return;
	}
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

/** A shape centred on the origin (boxes and ellipses) or through it (lines and arrows). */
function drawShape(
	ctx: CanvasRenderingContext2D,
	shape: NonNullable<TextClip["shape"]>,
	width: number,
	height: number,
) {
	const w = shape.width * width;
	const h = shape.height * height;
	ctx.save();
	ctx.lineWidth = shape.strokeWidth;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.strokeStyle = shape.stroke ?? "transparent";
	ctx.fillStyle = shape.fill ?? "transparent";
	if (shape.kind === "rect" || shape.kind === "ellipse") {
		ctx.beginPath();
		if (shape.kind === "rect")
			ctx.roundRect(-Math.abs(w) / 2, -Math.abs(h) / 2, Math.abs(w), Math.abs(h), shape.radius);
		else ctx.ellipse(0, 0, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
		if (shape.fill) ctx.fill();
		if (shape.stroke && shape.strokeWidth > 0) ctx.stroke();
	} else {
		// From the start to the end point, with a head at the end for arrows.
		const [x0, y0, x1, y1] = [-w / 2, -h / 2, w / 2, h / 2];
		ctx.strokeStyle = shape.stroke ?? shape.fill ?? "#ffffff";
		ctx.beginPath();
		ctx.moveTo(x0, y0);
		ctx.lineTo(x1, y1);
		ctx.stroke();
		if (shape.kind === "arrow") {
			const angle = Math.atan2(y1 - y0, x1 - x0);
			const head = Math.max(14, shape.strokeWidth * 3.2);
			ctx.fillStyle = ctx.strokeStyle;
			ctx.beginPath();
			ctx.moveTo(
				x1 + Math.cos(angle) * shape.strokeWidth * 0.6,
				y1 + Math.sin(angle) * shape.strokeWidth * 0.6,
			);
			ctx.lineTo(x1 - Math.cos(angle - 0.45) * head, y1 - Math.sin(angle - 0.45) * head);
			ctx.lineTo(x1 - Math.cos(angle + 0.45) * head, y1 - Math.sin(angle + 0.45) * head);
			ctx.closePath();
			ctx.fill();
		}
	}
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
	if (
		clip.animationIn === "none" &&
		clip.animationOut === "none" &&
		!clip.wordStyle &&
		!clip.infographic
	) {
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
		const key = `${frame.alpha.toFixed(3)}|${frame.scale.toFixed(3)}|${frame.offsetY.toFixed(1)}|${frame.reveal}|${frame.word ?? ""}|${(frame.wordP ?? 1).toFixed(2)}|${(frame.chartP ?? 1).toFixed(2)}`;
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
