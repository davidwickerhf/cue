import { z } from "zod";
import type { MotionLayer, MotionSpec } from "./motionSpec";
import { textWidth } from "./motionSpec";
import type { MotionTemplate } from "./motionTemplates";

/**
 * Editorial annotation: the marks explainer videos draw over archive footage and
 * scans — a red circle drawn round a word, an underline, a highlighter swipe, an
 * arrow, a label on a leader line, a location tag, a name title, a source tag —
 * and the paper, clippings and chat screens they sit on. Positions are shares of
 * the frame (0–1), so they line up with the picture underneath at any size.
 */

const RED = "#e2342d";
const YELLOW = "#f6e03a";
const INK = "#151515";
const PAPER = "#efece6";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const share = z.number().min(-0.5).max(1.5);
const timing = {
	/** When the mark starts drawing, after the clip starts. */
	delayMs: z.number().min(0).max(20000).default(0),
	durationMs: z.number().min(500).max(60000).default(3500),
};

interface Frame {
	W: number;
	H: number;
	u: number;
}
const frameOf = (c: { width: number; height: number }): Frame => ({
	W: c.width,
	H: c.height,
	u: Math.min(c.width / 1920, c.height / 1080) * (c.height > c.width ? 1.25 : 1),
});

/** A small deterministic random sequence, so a mark looks hand-drawn but the same every time. */
function wobble(seed: number) {
	let s = seed * 9301 + 49297;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

function template<P extends z.ZodRawShape>(t: MotionTemplate<P>): MotionTemplate {
	return t as unknown as MotionTemplate;
}

const spec = (
	c: { width: number; height: number; fps: number },
	durationMs: number,
	layers: MotionLayer[],
	outroMs?: number,
): MotionSpec => ({
	width: c.width,
	height: c.height,
	fps: c.fps,
	durationMs,
	layers,
	...(outroMs !== undefined
		? { markers: [{ name: "outro", atMs: outroMs, durationMs: durationMs - outroMs }] }
		: {}),
});

const circle = template({
	id: "annotate-circle",
	name: "Hand-drawn circle",
	category: "annotation",
	description:
		"A marker circle drawn round something in the picture, a little loose and overlapping where it closes, like a pen stroke. Give the centre and size as shares of the frame.",
	overlay: true,
	params: z.object({
		x: share,
		y: share,
		width: z.number().min(0.01).max(1.5).default(0.2),
		height: z.number().min(0.01).max(1.5).default(0.12),
		color: hex.default(RED),
		thickness: z.number().min(1).max(40).default(7),
		...timing,
	}),
	example: { x: 0.5, y: 0.5, width: 0.3, height: 0.14 },
	build: (p, c) => {
		const f = frameOf(c);
		const rand = wobble(Math.round(p.x * 1000 + p.y * 7919));
		const rx = (p.width * f.W) / 2;
		const ry = (p.height * f.H) / 2;
		const start = -2.3 + rand() * 0.4;
		const turns = 1.12;
		const points: [number, number][] = [];
		const phase = rand() * 6;
		for (let i = 0; i <= 48; i++) {
			const t = i / 48;
			const a = start + t * turns * Math.PI * 2;
			// Slightly egg-shaped and growing as it goes round, so the ends miss each other.
			const k = 1 + 0.035 * Math.sin(3 * a + phase) + 0.02 * Math.sin(5 * a) + 0.07 * t;
			points.push([p.x * f.W + Math.cos(a) * rx * k, p.y * f.H + Math.sin(a) * ry * k]);
		}
		const out = p.durationMs - 400;
		return spec(
			c,
			p.durationMs,
			[
				{
					type: "line",
					name: "Circle",
					points,
					smooth: true,
					stroke: p.color,
					strokeWidth: p.thickness * f.u,
					cap: "round",
					enter: { preset: "draw", atMs: p.delayMs, durationMs: 650, ease: "inOutCubic" },
					exit: { preset: "fade", atMs: out, durationMs: 400 },
				},
			],
			out,
		);
	},
});

const underline = template({
	id: "annotate-underline",
	name: "Hand-drawn underline",
	category: "annotation",
	description:
		"A pen underline drawn under a word or line, from x1 to x2 at height y (shares of the frame).",
	overlay: true,
	params: z.object({
		x1: share,
		x2: share,
		y: share,
		color: hex.default(RED),
		thickness: z.number().min(1).max(40).default(6),
		...timing,
	}),
	example: { x1: 0.3, x2: 0.7, y: 0.6 },
	build: (p, c) => {
		const f = frameOf(c);
		const rand = wobble(Math.round(p.x1 * 3571 + p.y * 1000));
		const y = p.y * f.H;
		const x1 = p.x1 * f.W;
		const x2 = p.x2 * f.W;
		const sag = (rand() - 0.3) * 8 * f.u;
		const points: [number, number][] = [
			[x1, y + 2 * f.u],
			[x1 + (x2 - x1) * 0.35, y + sag],
			[x1 + (x2 - x1) * 0.7, y - sag * 0.6],
			[x2, y - 3 * f.u],
		];
		const out = p.durationMs - 400;
		return spec(
			c,
			p.durationMs,
			[
				{
					type: "line",
					name: "Underline",
					points,
					smooth: true,
					stroke: p.color,
					strokeWidth: p.thickness * f.u,
					cap: "round",
					enter: { preset: "draw", atMs: p.delayMs, durationMs: 420, ease: "outCubic" },
					exit: { preset: "fade", atMs: out, durationMs: 400 },
				},
			],
			out,
		);
	},
});

const highlight = template({
	id: "annotate-highlight",
	name: "Highlighter",
	category: "annotation",
	description:
		"A highlighter swipe over words (multiplied, so the text shows through). Give the box as shares of the frame.",
	overlay: true,
	params: z.object({
		x: share,
		y: share,
		width: z.number().min(0.01).max(1.5),
		height: z.number().min(0.005).max(1).default(0.05),
		color: hex.default(YELLOW),
		...timing,
	}),
	example: { x: 0.3, y: 0.5, width: 0.4, height: 0.06 },
	build: (p, c) => {
		const f = frameOf(c);
		const w = p.width * f.W;
		const out = p.durationMs - 400;
		return spec(
			c,
			p.durationMs,
			[
				{
					type: "rect",
					name: "Highlight",
					x: p.x * f.W,
					y: p.y * f.H + (p.height * f.H) / 2,
					origin: "left",
					width: w,
					height: p.height * f.H,
					radius: 3 * f.u,
					fill: p.color,
					blend: "multiply",
					keys: {
						width: [
							[p.delayMs, 0, "outCubic"],
							[p.delayMs + 380, w],
						],
					},
					exit: { preset: "fade", atMs: out, durationMs: 400 },
				},
			],
			out,
		);
	},
});

const arrow = template({
	id: "annotate-arrow",
	name: "Arrow",
	category: "annotation",
	description:
		"A hand-drawn arrow from one point to another (shares of the frame), gently curved; the head draws in after the shaft.",
	overlay: true,
	params: z.object({
		fromX: share,
		fromY: share,
		toX: share,
		toY: share,
		/** How much it curves: 0 straight, positive bends to the left of its direction. */
		bend: z.number().min(-1).max(1).default(0.2),
		color: hex.default(RED),
		thickness: z.number().min(1).max(40).default(7),
		...timing,
	}),
	example: { fromX: 0.3, fromY: 0.3, toX: 0.5, toY: 0.5 },
	build: (p, c) => {
		const f = frameOf(c);
		const a: [number, number] = [p.fromX * f.W, p.fromY * f.H];
		const b: [number, number] = [p.toX * f.W, p.toY * f.H];
		const dx = b[0] - a[0];
		const dy = b[1] - a[1];
		const len = Math.hypot(dx, dy) || 1;
		const mid: [number, number] = [
			a[0] + dx / 2 - (dy / len) * len * p.bend * 0.3,
			a[1] + dy / 2 + (dx / len) * len * p.bend * 0.3,
		];
		// The head follows the direction the curve arrives in.
		const ax = b[0] - mid[0];
		const ay = b[1] - mid[1];
		const angle = Math.atan2(ay, ax);
		const head = Math.min(len * 0.3, 34 * f.u);
		const wing = (turn: number): [number, number] => [
			b[0] - Math.cos(angle + turn) * head,
			b[1] - Math.sin(angle + turn) * head,
		];
		const out = p.durationMs - 400;
		const stroke = { stroke: p.color, strokeWidth: p.thickness * f.u, cap: "round" as const };
		return spec(
			c,
			p.durationMs,
			[
				{
					type: "line",
					name: "Shaft",
					points: [a, mid, b],
					smooth: true,
					...stroke,
					enter: { preset: "draw", atMs: p.delayMs, durationMs: 420, ease: "inOutCubic" },
					exit: { preset: "fade", atMs: out, durationMs: 400 },
				},
				{
					type: "line",
					name: "Head",
					points: [wing(0.5), b, wing(-0.5)],
					...stroke,
					enter: { preset: "draw", atMs: p.delayMs + 380, durationMs: 220, ease: "outCubic" },
					exit: { preset: "fade", atMs: out, durationMs: 400 },
				},
			],
			out,
		);
	},
});

const label = template({
	id: "annotate-label",
	name: "Leader label",
	category: "annotation",
	description:
		"A short label on a leader line pointing at something (a face, a building): the line draws from the target, then the label rises above its end. Target and label as shares of the frame.",
	overlay: true,
	params: z.object({
		text: z.string().max(60),
		targetX: share,
		targetY: share,
		labelX: share,
		labelY: share,
		lineColor: hex.default(YELLOW),
		textColor: hex.default(INK),
		font: z.enum(["serif", "sans"]).default("serif"),
		size: z.number().min(10).max(200).default(54),
		...timing,
	}),
	example: { text: "OK", targetX: 0.45, targetY: 0.45, labelX: 0.6, labelY: 0.3 },
	build: (p, c) => {
		const f = frameOf(c);
		const t: [number, number] = [p.targetX * f.W, p.targetY * f.H];
		const l: [number, number] = [p.labelX * f.W, p.labelY * f.H];
		const size = p.size * f.u;
		const right = l[0] >= t[0];
		const shelf = Math.max(
			textWidth(p.text, size, p.font === "serif" ? "serif" : "sans") * 1.1,
			60 * f.u,
		);
		const end: [number, number] = [right ? l[0] + shelf : l[0] - shelf, l[1]];
		const out = p.durationMs - 400;
		return spec(
			c,
			p.durationMs,
			[
				{
					type: "line",
					name: "Leader",
					points: [t, l, end],
					stroke: p.lineColor,
					strokeWidth: 7 * f.u,
					cap: "butt",
					enter: { preset: "draw", atMs: p.delayMs, durationMs: 500, ease: "inOutCubic" },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				{
					type: "text",
					name: "Label",
					text: p.text,
					x: right ? l[0] : l[0] - shelf,
					y: l[1] - size * 0.62,
					size,
					font: p.font,
					weight: p.font === "serif" ? 400 : 700,
					color: p.textColor,
					clip: { x: 0, y: l[1] - size * 1.4, width: f.W, height: size * 1.4 },
					enter: {
						preset: "rise",
						atMs: p.delayMs + 380,
						durationMs: 450,
						amount: size,
						ease: "outCubic",
					},
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
			],
			out,
		);
	},
});

const locationTag = template({
	id: "location-tag",
	name: "Location tag",
	category: "annotation",
	description:
		"A place name on a coloured tag for maps (italic serif on red), with an optional arrow to the exact spot.",
	overlay: true,
	params: z.object({
		text: z.string().max(40),
		x: share,
		y: share,
		/** Where the arrow points; leave out for no arrow. */
		targetX: share.optional(),
		targetY: share.optional(),
		color: hex.default(RED),
		textColor: hex.default("#ffffff"),
		...timing,
	}),
	example: { text: "Kinderhook, NY", x: 0.42, y: 0.4, targetX: 0.6, targetY: 0.55 },
	build: (p, c) => {
		const f = frameOf(c);
		const size = 48 * f.u;
		const w = textWidth(p.text, size, "serif") + 44 * f.u;
		const h = size * 1.35;
		const x = p.x * f.W;
		const y = p.y * f.H;
		const out = p.durationMs - 400;
		const layers: MotionLayer[] = [
			{
				type: "rect",
				name: "Tag",
				x: x - w / 2,
				y,
				origin: "left",
				width: w,
				height: h,
				fill: p.color,
				keys: {
					width: [
						[p.delayMs, 0, "outExpo"],
						[p.delayMs + 450, w],
					],
				},
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			},
			{
				type: "text",
				name: "Place",
				text: p.text,
				x,
				y,
				align: "center",
				size,
				font: "serif",
				italic: true,
				weight: 400,
				color: p.textColor,
				clip: { x: x - w / 2, y: y - h / 2, width: w, height: h },
				enter: {
					preset: "rise",
					atMs: p.delayMs + 200,
					durationMs: 450,
					amount: h,
					ease: "outCubic",
				},
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			},
		];
		if (p.targetX !== undefined && p.targetY !== undefined) {
			const b: [number, number] = [p.targetX * f.W, p.targetY * f.H];
			const a: [number, number] = [b[0] < x ? x - w / 2 - 10 * f.u : x + w / 2 + 10 * f.u, y];
			const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
			const head = 22 * f.u;
			const wing = (turn: number): [number, number] => [
				b[0] - Math.cos(angle + turn) * head,
				b[1] - Math.sin(angle + turn) * head,
			];
			layers.push(
				{
					type: "line",
					name: "Pointer",
					points: [a, b],
					stroke: p.color,
					strokeWidth: 6 * f.u,
					enter: { preset: "draw", atMs: p.delayMs + 450, durationMs: 380, ease: "outCubic" },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				{
					type: "line",
					name: "Pointer head",
					points: [wing(0.55), b, wing(-0.55)],
					stroke: p.color,
					strokeWidth: 6 * f.u,
					enter: { preset: "draw", atMs: p.delayMs + 780, durationMs: 180 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				{
					type: "ellipse",
					name: "Spot",
					x: b[0],
					y: b[1],
					width: 16 * f.u,
					height: 16 * f.u,
					fill: p.color,
					enter: { preset: "pop", atMs: p.delayMs + 900, durationMs: 350, amount: 0 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
			);
		}
		return spec(c, p.durationMs, layers, out);
	},
});

const nameTitle = template({
	id: "name-title",
	name: "Name title",
	category: "annotation",
	description:
		"An editorial name title: a large italic serif name with a small italic caption under it, set straight onto the picture (no box).",
	overlay: true,
	params: z.object({
		name: z.string().max(60),
		caption: z.string().max(80).default(""),
		x: share.default(0.08),
		y: share.default(0.3),
		align: z.enum(["left", "center", "right"]).default("left"),
		color: hex.default("#ffffff"),
		size: z.number().min(20).max(300).default(110),
		...timing,
		durationMs: z.number().min(500).max(60000).default(4000),
	}),
	example: { name: "Martin Van Buren", caption: "8th US president", x: 0.08, y: 0.3 },
	build: (p, c) => {
		const f = frameOf(c);
		const size = p.size * f.u;
		const x = p.x * f.W;
		const y = p.y * f.H;
		const out = p.durationMs - 500;
		const nameW = textWidth(p.name, size, "serif");
		const captionX =
			p.align === "left" ? x + nameW * 0.95 : p.align === "center" ? x + nameW * 0.45 : x;
		return spec(
			c,
			p.durationMs,
			[
				{
					type: "text",
					name: "Name",
					text: p.name,
					x,
					y,
					align: p.align,
					size,
					font: "serif",
					italic: true,
					weight: 400,
					color: p.color,
					shadow: { opacity: 0.35, distance: 2 * f.u, blur: 14 * f.u },
					enter: { preset: "blur", atMs: p.delayMs, durationMs: 700, amount: 18 * f.u },
					exit: { preset: "fade", atMs: out, durationMs: 450 },
				},
				...(p.caption
					? [
							{
								type: "text" as const,
								name: "Caption",
								text: p.caption,
								x: captionX,
								y: y + size * 0.62,
								align: "right" as const,
								size: size * 0.4,
								font: "serif" as const,
								italic: true,
								weight: 400,
								color: p.color,
								enter: { preset: "fade" as const, atMs: p.delayMs + 450, durationMs: 600 },
								exit: { preset: "fade" as const, atMs: out, durationMs: 450 },
							},
						]
					: []),
			],
			out,
		);
	},
});

const sourceTag = template({
	id: "source-tag",
	name: "Source tag",
	category: "annotation",
	description:
		"The small credit tag in a corner saying where footage or a document comes from, e.g. 'Boston Morning Post | 1839'.",
	overlay: true,
	params: z.object({
		text: z.string().max(80),
		corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).default("top-left"),
		...timing,
		durationMs: z.number().min(500).max(60000).default(5000),
	}),
	example: { text: "Boston Morning Post | 1839" },
	build: (p, c) => {
		const f = frameOf(c);
		const size = 22 * f.u;
		const w = textWidth(p.text, size, "sans") + 20 * f.u;
		const h = size * 1.5;
		const m = 18 * f.u;
		const left = p.corner.endsWith("left");
		const top = p.corner.startsWith("top");
		const x = left ? m : f.W - m - w;
		const y = top ? m + h / 2 : f.H - m - h / 2;
		return spec(c, p.durationMs, [
			{
				type: "rect",
				name: "Tag",
				x,
				y,
				origin: "left",
				width: w,
				height: h,
				fill: "#000000b3",
				enter: { preset: "fade", atMs: p.delayMs, durationMs: 250 },
				exit: { preset: "fade", atMs: p.durationMs - 300, durationMs: 300 },
			},
			{
				type: "text",
				name: "Credit",
				text: p.text,
				x: x + 10 * f.u,
				y,
				size,
				font: "sans",
				italic: true,
				weight: 600,
				color: "#ffffff",
				enter: { preset: "fade", atMs: p.delayMs, durationMs: 250 },
				exit: { preset: "fade", atMs: p.durationMs - 300, durationMs: 300 },
			},
		]);
	},
});

const chat = template({
	id: "chat",
	name: "Chat screen",
	category: "annotation",
	description:
		"A phone chat: a header with a name, then messages popping in one after another (from 'them' on the left, 'me' on the right).",
	overlay: false,
	params: z.object({
		name: z.string().max(30).default("Gerald"),
		messages: z
			.array(z.object({ text: z.string().max(120), from: z.enum(["them", "me"]).default("them") }))
			.min(1)
			.max(8),
		/** Time between messages. */
		gapMs: z.number().min(200).max(5000).default(1100),
		accent: hex.default("#4f8df7"),
		paper: hex.default(PAPER),
		...timing,
		durationMs: z.number().min(500).max(60000).default(6000),
	}),
	example: {
		name: "Gerald",
		messages: [
			{ text: "Feeling a bit weird after all that chicken.", from: "them" },
			{ text: "Can we do tomorrow instead?", from: "them" },
			{ text: "Ok", from: "me" },
		],
	},
	build: (p, c) => {
		const f = frameOf(c);
		const phoneW = Math.min(f.W * 0.4, 620 * f.u);
		const phoneH = f.H * 0.92;
		const left = f.W / 2 - phoneW / 2;
		const top = f.H * 0.04;
		const layers: MotionLayer[] = [
			{ type: "rect", name: "Paper", width: f.W, height: f.H, fill: p.paper },
			{
				type: "rect",
				name: "Screen",
				x: f.W / 2,
				y: top + phoneH / 2,
				width: phoneW,
				height: phoneH,
				fill: "#ffffff",
				shadow: { opacity: 0.18, distance: 6 * f.u, blur: 30 * f.u },
			},
			{
				type: "rect",
				name: "Header",
				x: f.W / 2,
				y: top + 45 * f.u,
				width: phoneW,
				height: 90 * f.u,
				fill: "#6d6f78",
			},
			{
				type: "text",
				name: "Contact",
				text: p.name,
				x: f.W / 2,
				y: top + 45 * f.u,
				align: "center",
				size: 34 * f.u,
				weight: 600,
				color: "#ffffff",
			},
		];
		let y = top + 130 * f.u;
		const size = 30 * f.u;
		p.messages.forEach((m, i) => {
			const lines = wrap(m.text, 24);
			const w = Math.max(...lines.map((l) => textWidth(l, size, "sans"))) + 44 * f.u;
			const h = lines.length * size * 1.3 + 30 * f.u;
			const mine = m.from === "me";
			const bx = mine ? left + phoneW - 24 * f.u - w / 2 : left + 24 * f.u + w / 2;
			const at = p.delayMs + 300 + i * p.gapMs;
			layers.push(
				{
					type: "rect",
					name: `Bubble ${i + 1}`,
					x: bx,
					y: y + h / 2,
					width: w,
					height: h,
					radius: 26 * f.u,
					fill: mine ? p.accent : "#ebebef",
					enter: { preset: "pop", atMs: at, durationMs: 380, amount: 0.3 },
				},
				{
					type: "text",
					name: `Message ${i + 1}`,
					text: lines.join("\n"),
					x: bx - w / 2 + 22 * f.u,
					y: y + h / 2,
					size,
					weight: 400,
					lineHeight: 1.3,
					color: mine ? "#ffffff" : "#222222",
					enter: { preset: "fade", atMs: at + 120, durationMs: 250 },
				},
			);
			y += h + 22 * f.u;
		});
		return spec(c, p.durationMs, layers);
	},
});

const clipping = template({
	id: "clipping",
	name: "Newspaper clipping",
	category: "annotation",
	description:
		"An old newspaper clipping set in period type on paper: a masthead, a dateline and a paragraph (use \\n for line breaks). Annotate it with circles, underlines and highlights.",
	overlay: false,
	params: z.object({
		masthead: z.string().max(60),
		dateline: z.string().max(80).default(""),
		body: z.string().max(1200),
		paper: hex.default(PAPER),
		ink: hex.default("#1c1a17"),
		...timing,
		durationMs: z.number().min(500).max(60000).default(6000),
	}),
	example: {
		masthead: "BOSTON MORNING POST.",
		dateline: "SATURDAY, MARCH 23, 1839.",
		body: "The Chairman of the Committee on Charity Lecture\nBells is one of the deputation, and perhaps if he\nshould return to Boston, via Providence, he of the\nJournal, and his train-band, would have the\n“contribution box,” et ceteras, o. k.—all correct—and\ncause the corks to fly, like sparks, upward.",
	},
	build: (p, c) => {
		const f = frameOf(c);
		const lines = p.body.split("\n");
		const size = 36 * f.u;
		const lh = size * 1.32;
		const blockH = 150 * f.u + lines.length * lh;
		const top = f.H / 2 - blockH / 2;
		const x = f.W / 2;
		const colW = Math.max(...lines.map((l) => textWidth(l, size, "serif"))) + 60 * f.u;
		const layers: MotionLayer[] = [
			{ type: "rect", name: "Paper", width: f.W, height: f.H, fill: p.paper },
			{
				type: "text",
				name: "Masthead",
				text: p.masthead,
				x,
				y: top + 30 * f.u,
				align: "center",
				size: 56 * f.u,
				font: "serif",
				weight: 400,
				tracking: 2 * f.u,
				color: p.ink,
			},
			{
				type: "line",
				name: "Rule",
				points: [
					[x - colW / 2, top + 72 * f.u],
					[x + colW / 2, top + 72 * f.u],
				],
				stroke: p.ink,
				strokeWidth: 2 * f.u,
				cap: "butt",
			},
			{
				type: "text",
				name: "Dateline",
				text: p.dateline,
				x,
				y: top + 96 * f.u,
				align: "center",
				size: 22 * f.u,
				font: "serif",
				weight: 400,
				tracking: 3 * f.u,
				color: p.ink,
			},
			{
				type: "text",
				name: "Body",
				text: p.body,
				x: x - colW / 2 + 30 * f.u,
				y: top + 150 * f.u,
				anchor: "top",
				size,
				font: "serif",
				weight: 400,
				lineHeight: 1.32,
				color: p.ink,
			},
		];
		return spec(c, p.durationMs, [
			{
				type: "group",
				name: "Clipping",
				keys: {
					scale: [
						[0, 1, "linear"],
						[p.durationMs, 1.06],
					],
				},
				layers,
			},
		]);
	},
});

const paper = template({
	id: "paper",
	name: "Paper",
	category: "annotation",
	description:
		"An off-white paper background with faint specks and a soft edge, for cut-outs, clippings and titles to sit on. Loop it for any length.",
	overlay: false,
	params: z.object({
		color: hex.default(PAPER),
		specks: z.number().int().min(0).max(400).default(140),
		seed: z.number().int().default(7),
		...timing,
		durationMs: z.number().min(500).max(60000).default(10000),
	}),
	example: {},
	build: (p, c) => {
		const f = frameOf(c);
		const rand = wobble(p.seed);
		const layers: MotionLayer[] = [
			{ type: "rect", name: "Paper", width: f.W, height: f.H, fill: p.color },
			{
				type: "ellipse",
				name: "Edge",
				width: f.W * 1.6,
				height: f.H * 1.9,
				fill: null,
				gradient: {
					kind: "radial",
					from: [0, 0],
					to: [f.W * 0.8, 0],
					stops: [
						[0.55, "#00000000"],
						[1, "#0000001c"],
					],
				},
			},
		];
		for (let i = 0; i < p.specks; i++) {
			const s = (0.8 + rand() * rand() * 4) * f.u;
			layers.push({
				type: "ellipse",
				x: rand() * f.W,
				y: rand() * f.H,
				width: s,
				height: s * (0.6 + rand() * 0.8),
				rotation: rand() * 180,
				fill: rand() > 0.85 ? "#3b3630aa" : "#57504866",
			});
		}
		return spec(c, p.durationMs, layers);
	},
});

function wrap(text: string, width: number): string[] {
	const out: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (line && `${line} ${word}`.length > width) {
			out.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	if (line) out.push(line);
	return out;
}

export const ANNOTATION_TEMPLATES: MotionTemplate[] = [
	circle,
	underline,
	highlight,
	arrow,
	label,
	locationTag,
	nameTitle,
	sourceTag,
	clipping,
	chat,
	paper,
];
