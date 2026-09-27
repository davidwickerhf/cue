import { z } from "zod";
import { type Ease, type MotionLayer, type MotionSpec, textWidth } from "./motionSpec";

/**
 * Cue's own motion graphics: templates that build a motion spec from a few
 * parameters (text, data, a theme), so charts follow their numbers and titles
 * fit their words. Every one is an original design; agents can use them as they
 * are, restyle them, or read their spec and build new graphics from it.
 */

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export interface MotionTheme {
	id: string;
	label: string;
	/** Full-frame background. */
	bg: string;
	/** Cards and panels. */
	surface: string;
	text: string;
	muted: string;
	/** Lines, grids and dividers. */
	line: string;
	accent: string;
	accent2: string;
	accent3: string;
	/** Headline font and weight. */
	display: "sans" | "display" | "serif";
	displayWeight: number;
}

export const MOTION_THEMES: MotionTheme[] = [
	{
		id: "midnight",
		label: "Midnight",
		bg: "#0b0f19",
		surface: "#141b2d",
		text: "#f4f6fb",
		muted: "#8b95ab",
		line: "#27304a",
		accent: "#5b8cff",
		accent2: "#22d3ee",
		accent3: "#f472b6",
		display: "sans",
		displayWeight: 800,
	},
	{
		id: "editorial",
		label: "Editorial",
		bg: "#f3eee3",
		surface: "#fbf8f2",
		text: "#1b1a17",
		muted: "#6f675b",
		line: "#d9d0c0",
		accent: "#d9482b",
		accent2: "#1f4e5f",
		accent3: "#e0a526",
		display: "serif",
		displayWeight: 400,
	},
	{
		id: "signal",
		label: "Signal",
		bg: "#0a0a0a",
		surface: "#171717",
		text: "#ffffff",
		muted: "#9a9a9a",
		line: "#2e2e2e",
		accent: "#c6ff3d",
		accent2: "#ff5a36",
		accent3: "#7c5cff",
		display: "display",
		displayWeight: 700,
	},
	{
		id: "sunset",
		label: "Sunset",
		bg: "#1c1027",
		surface: "#2a1839",
		text: "#fff4ec",
		muted: "#c7a9bb",
		line: "#402a52",
		accent: "#ff7a59",
		accent2: "#ffc857",
		accent3: "#b084f7",
		display: "display",
		displayWeight: 700,
	},
	{
		id: "ocean",
		label: "Ocean",
		bg: "#06202b",
		surface: "#0c3140",
		text: "#eaf6f8",
		muted: "#80a8b4",
		line: "#174656",
		accent: "#2dd4bf",
		accent2: "#38bdf8",
		accent3: "#facc15",
		display: "sans",
		displayWeight: 800,
	},
	{
		id: "mono",
		label: "Mono",
		bg: "#ffffff",
		surface: "#f2f2f2",
		text: "#0a0a0a",
		muted: "#6e6e6e",
		line: "#dddddd",
		accent: "#0a0a0a",
		accent2: "#5c5c5c",
		accent3: "#a3a3a3",
		display: "sans",
		displayWeight: 800,
	},
];

const themeIds = MOTION_THEMES.map((t) => t.id) as [string, ...string[]];

/** A theme with any colours overridden. */
function themeOf(id: string | undefined, overrides?: Partial<MotionTheme>): MotionTheme {
	const base = MOTION_THEMES.find((t) => t.id === id) ?? MOTION_THEMES[0];
	return { ...base, ...overrides };
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const common = {
	theme: z.enum(themeIds).default("midnight"),
	/** Replace theme colours, e.g. a brand accent. */
	colors: z
		.object({
			bg: hex,
			surface: hex,
			text: hex,
			muted: hex,
			line: hex,
			accent: hex,
			accent2: hex,
			accent3: hex,
		})
		.partial()
		.optional(),
	durationMs: z.number().min(1000).max(60000).optional(),
};

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

interface Frame {
	W: number;
	H: number;
	/** One pixel of a 1080-line design. */
	u: number;
	/** Safe margin. */
	m: number;
	portrait: boolean;
}

function frameOf(width: number, height: number): Frame {
	const u = Math.min(width / 1920, height / 1080) * (height > width ? 1.25 : 1);
	return {
		W: width,
		H: height,
		u,
		m: Math.round(Math.min(width, height) * 0.075),
		portrait: height > width,
	};
}

/** A line of text that rises out of a mask line (the classic editorial reveal). */
function risingText(
	o: {
		text: string;
		x: number;
		y: number;
		size: number;
		color: string;
		font?: "sans" | "display" | "serif" | "mono";
		weight?: number;
		align?: "left" | "center" | "right";
		atMs: number;
		outMs?: number;
		tracking?: number;
		uppercase?: boolean;
		name?: string;
	},
	W: number,
): MotionLayer {
	const h = o.size * 1.35;
	return {
		type: "text",
		name: o.name,
		text: o.text,
		x: o.x,
		y: o.y,
		size: o.size,
		color: o.color,
		font: o.font ?? "sans",
		weight: o.weight ?? 600,
		align: o.align ?? "left",
		tracking: o.tracking,
		uppercase: o.uppercase,
		clip: { x: 0, y: o.y - h / 2, width: W, height: h },
		enter: { preset: "rise", atMs: o.atMs, durationMs: 800, amount: h, ease: "outExpo" },
		...(o.outMs !== undefined
			? { exit: { preset: "fall", atMs: o.outMs, durationMs: 450, amount: h, ease: "inCubic" } }
			: {}),
	};
}

function fmt(value: number, decimals: number) {
	return value.toFixed(decimals);
}

function decimalsOf(values: number[]) {
	return Math.min(2, Math.max(0, ...values.map((v) => (String(v).split(".")[1] ?? "").length)));
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface MotionTemplate<P extends z.ZodRawShape = z.ZodRawShape> {
	id: string;
	name: string;
	category:
		| "lower third"
		| "title"
		| "chart"
		| "stat"
		| "callout"
		| "list"
		| "quote"
		| "overlay"
		| "map"
		| "transition";
	description: string;
	/** Full frame, or drawn over the video (transparent). */
	overlay: boolean;
	params: z.ZodObject<P>;
	/** Parameters that show it off, for the gallery and as an example for agents. */
	example: Record<string, unknown>;
	build: (
		p: z.output<z.ZodObject<P>>,
		canvas: { width: number; height: number; fps: number },
	) => MotionSpec;
}

function template<P extends z.ZodRawShape>(t: MotionTemplate<P>): MotionTemplate {
	return t as unknown as MotionTemplate;
}

const lowerThird = template({
	id: "lower-third",
	name: "Lower third",
	category: "lower third",
	description:
		"A name and role over the video: an accent bar grows, the name rises out of a line and the role slides in; it holds and leaves the same way.",
	overlay: true,
	params: z.object({
		...common,
		name: z.string().max(60),
		role: z.string().max(80).default(""),
		side: z.enum(["left", "right"]).default("left"),
	}),
	example: { name: "Maya Lindqvist", role: "Head of Research, Northwind", theme: "midnight" },
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 5000;
		const out = D - 700;
		const size = Math.round(58 * f.u);
		const roleSize = Math.round(28 * f.u);
		const nameW = textWidth(p.name, size, "sans");
		const roleW = textWidth(p.role.toUpperCase(), roleSize, "sans", 3 * f.u);
		const pad = 34 * f.u;
		const boxW = Math.max(nameW, roleW) + pad * 2 + 18 * f.u;
		const boxH = (p.role ? 176 : 112) * f.u;
		const left = p.side === "left" ? f.m : f.W - f.m - boxW;
		const top = f.H - f.m - boxH;
		const textX = left + 18 * f.u + pad;
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers: [
				{
					type: "rect",
					name: "Panel",
					x: left,
					y: top + boxH / 2,
					origin: "left",
					width: boxW,
					height: boxH,
					fill: `${t.surface}f0`,
					radius: 6 * f.u,
					shadow: { opacity: 0.35, distance: 10 * f.u, blur: 40 * f.u },
					enter: { preset: "grow", atMs: 120, durationMs: 700, ease: "outExpo" },
					exit: { preset: "grow", atMs: out + 200, durationMs: 450, ease: "inCubic" },
				},
				{
					type: "rect",
					name: "Accent",
					x: left + 5 * f.u,
					y: top + boxH,
					origin: "bottom",
					width: 10 * f.u,
					height: boxH,
					fill: t.accent,
					enter: { preset: "grow", atMs: 0, durationMs: 600, ease: "outExpo" },
					exit: { preset: "fade", atMs: out + 400, durationMs: 250 },
				},
				risingText(
					{
						name: "Name",
						text: p.name,
						x: textX,
						y: p.role ? top + 66 * f.u : top + boxH / 2,
						size,
						color: t.text,
						weight: 700,
						atMs: 380,
						outMs: out,
					},
					f.W,
				),
				...(p.role
					? [
							{
								type: "text" as const,
								name: "Role",
								text: p.role,
								uppercase: true,
								tracking: 3 * f.u,
								x: textX,
								y: top + 126 * f.u,
								size: roleSize,
								color: t.muted,
								weight: 600,
								enter: {
									preset: "slideRight" as const,
									atMs: 560,
									durationMs: 700,
									amount: 40 * f.u,
								},
								exit: { preset: "fade" as const, atMs: out, durationMs: 300 },
							},
						]
					: []),
			],
		};
	},
});

const titleCard = template({
	id: "title-card",
	name: "Title card",
	category: "title",
	description:
		"A full-frame chapter or opening title: a kicker line, a headline that rises line by line, a rule that draws and a subtitle, over a softly moving backdrop.",
	overlay: false,
	params: z.object({
		...common,
		kicker: z.string().max(60).default(""),
		title: z.string().max(140),
		subtitle: z.string().max(160).default(""),
		align: z.enum(["left", "center"]).default("left"),
	}),
	example: {
		kicker: "Chapter 02",
		title: "Where the\ntime goes",
		subtitle: "A week inside a design studio",
		theme: "editorial",
	},
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 5000;
		const out = D - 800;
		const lines = p.title.split("\n").slice(0, 4);
		const size = Math.round((lines.length > 2 ? 104 : 128) * f.u);
		const lh = size * 1.08;
		const blockH = lines.length * lh;
		const x = p.align === "center" ? f.W / 2 : f.m * 1.4;
		const top = f.H / 2 - blockH / 2 - (p.subtitle ? 30 * f.u : 0);
		const layers: MotionLayer[] = [
			// A large soft disc drifting behind, and a thin frame line.
			{
				type: "ellipse",
				name: "Glow",
				x: f.W * 0.78,
				y: f.H * 0.3,
				width: f.H * 1.1,
				height: f.H * 1.1,
				gradient: {
					kind: "radial",
					from: [0, 0],
					to: [f.H * 0.55, 0],
					stops: [
						[0, `${t.accent}55`],
						[1, `${t.accent}00`],
					],
				},
				enter: { preset: "pop", atMs: 0, durationMs: 1600, amount: 0.7, ease: "outCubic" },
				keys: {
					x: [
						[0, f.W * 0.82, "inOutCubic"],
						[D, f.W * 0.74],
					],
				},
			},
			{
				type: "rect",
				name: "Frame",
				width: f.W - f.m,
				height: f.H - f.m,
				fill: null,
				stroke: t.line,
				strokeWidth: 2 * f.u,
				enter: { preset: "draw", atMs: 100, durationMs: 1400, ease: "inOutCubic" },
				exit: { preset: "fade", atMs: out, durationMs: 500 },
			},
		];
		if (p.kicker)
			layers.push({
				type: "text",
				name: "Kicker",
				text: p.kicker,
				uppercase: true,
				tracking: 6 * f.u,
				x,
				y: top - 70 * f.u,
				size: 26 * f.u,
				weight: 600,
				color: t.accent,
				align: p.align,
				enter: { preset: "type", atMs: 250, durationMs: 500 },
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			});
		lines.forEach((line, i) => {
			layers.push(
				risingText(
					{
						name: `Title ${i + 1}`,
						text: line,
						x,
						y: top + lh * i + lh / 2,
						size,
						color: t.text,
						font: t.display,
						weight: t.displayWeight,
						align: p.align,
						atMs: 450 + i * 110,
						outMs: out + i * 60,
					},
					f.W,
				),
			);
		});
		const ruleY = top + blockH + 34 * f.u;
		const ruleW = Math.min(f.W * 0.3, 360 * f.u);
		layers.push({
			type: "line",
			name: "Rule",
			points:
				p.align === "center"
					? [
							[f.W / 2 - ruleW / 2, ruleY],
							[f.W / 2 + ruleW / 2, ruleY],
						]
					: [
							[x, ruleY],
							[x + ruleW, ruleY],
						],
			stroke: t.accent,
			strokeWidth: 5 * f.u,
			cap: "butt",
			enter: { preset: "draw", atMs: 750 + lines.length * 110, durationMs: 900 },
			exit: { preset: "fade", atMs: out, durationMs: 300 },
		});
		if (p.subtitle)
			layers.push({
				type: "text",
				name: "Subtitle",
				text: p.subtitle,
				x,
				y: ruleY + 58 * f.u,
				size: 36 * f.u,
				weight: 400,
				color: t.muted,
				align: p.align,
				enter: {
					preset: "rise",
					atMs: 950 + lines.length * 110,
					durationMs: 800,
					amount: 24 * f.u,
				},
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			});
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			background: t.bg,
			markers: [{ name: "outro", atMs: out, durationMs: 800 }],
			layers,
		};
	},
});

const item = z.object({ label: z.string().max(40), value: z.number() });
const chartCommon = {
	...common,
	title: z.string().max(80).default(""),
	subtitle: z.string().max(120).default(""),
	/** Where the numbers come from. */
	source: z.string().max(120).default(""),
	unit: z.string().max(8).default(""),
	prefix: z.string().max(4).default(""),
	/** Full frame, or a card over the video. */
	backdrop: z.enum(["full", "card"]).default("full"),
};

/** Title, subtitle and source around a chart area; returns the area and the layers. */
function chartFrame(
	p: { title: string; subtitle: string; source: string; backdrop: "full" | "card" },
	t: MotionTheme,
	f: Frame,
	out: number,
) {
	const layers: MotionLayer[] = [];
	let area = { x: f.m, y: f.m, w: f.W - 2 * f.m, h: f.H - 2 * f.m };
	if (p.backdrop === "card") {
		const w = f.portrait ? f.W - 2 * f.m : f.W * 0.62;
		const h = f.portrait ? f.H * 0.5 : f.H * 0.72;
		const x = f.portrait ? f.m : f.W - f.m - w;
		const y = (f.H - h) / 2;
		layers.push({
			type: "rect",
			name: "Card",
			x,
			y: y + h / 2,
			origin: "left",
			width: w,
			height: h,
			radius: 18 * f.u,
			fill: `${t.surface}f2`,
			shadow: { opacity: 0.35, distance: 16 * f.u, blur: 60 * f.u },
			enter: { preset: "grow", atMs: 0, durationMs: 700 },
			exit: { preset: "fade", atMs: out + 300, durationMs: 400 },
		});
		const pad = 48 * f.u;
		area = { x: x + pad, y: y + pad, w: w - 2 * pad, h: h - 2 * pad };
	}
	let top = area.y;
	if (p.title) {
		layers.push(
			risingText(
				{
					name: "Title",
					text: p.title,
					x: area.x,
					y: top + 30 * f.u,
					size: 52 * f.u,
					color: t.text,
					font: t.display,
					weight: t.displayWeight,
					atMs: 150,
					outMs: out,
				},
				f.W,
			),
		);
		top += 78 * f.u;
	}
	if (p.subtitle) {
		layers.push({
			type: "text",
			name: "Subtitle",
			text: p.subtitle,
			x: area.x,
			y: top + 10 * f.u,
			size: 28 * f.u,
			weight: 400,
			color: t.muted,
			enter: { preset: "fade", atMs: 350, durationMs: 600 },
			exit: { preset: "fade", atMs: out, durationMs: 300 },
		});
		top += 56 * f.u;
	}
	let bottom = area.y + area.h;
	if (p.source) {
		layers.push({
			type: "text",
			name: "Source",
			text: `Source: ${p.source}`,
			x: area.x,
			y: bottom - 12 * f.u,
			size: 20 * f.u,
			weight: 400,
			color: t.muted,
			enter: { preset: "fade", atMs: 900, durationMs: 600 },
			exit: { preset: "fade", atMs: out, durationMs: 300 },
		});
		bottom -= 50 * f.u;
	}
	return { layers, area: { x: area.x, y: top + 24 * f.u, w: area.w, h: bottom - top - 24 * f.u } };
}

const barChart = template({
	id: "bar-chart",
	name: "Bar chart",
	category: "chart",
	description:
		"Compares values: bars grow one after another with their numbers counting up; one bar can be highlighted. Horizontal bars suit long labels, columns suit time series.",
	overlay: false,
	params: z.object({
		...chartCommon,
		items: z.array(item).min(1).max(12),
		orientation: z.enum(["bars", "columns"]).default("bars"),
		/** Index of the bar drawn in the accent colour (others are quieter). */
		highlight: z.number().int().min(0).optional(),
	}),
	example: {
		title: "Where the time goes",
		subtitle: "Hours per week, design team",
		source: "Studio time-tracking, 2024",
		items: [
			{ label: "Research", value: 14 },
			{ label: "Design", value: 22 },
			{ label: "Review", value: 9 },
			{ label: "Meetings", value: 6 },
		],
		unit: "h",
		highlight: 1,
		theme: "midnight",
	},
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 6000;
		const out = D - 700;
		const { layers, area } = chartFrame(p, t, f, out);
		const max = Math.max(...p.items.map((i) => i.value), 1e-9);
		const decimals = decimalsOf(p.items.map((i) => i.value));
		const colorFor = (i: number) =>
			p.highlight === undefined
				? i === 0
					? t.accent
					: t.accent
				: i === p.highlight
					? t.accent
					: `${t.muted}99`;
		const n = p.items.length;
		if (p.orientation === "bars") {
			const labelW = Math.min(
				area.w * 0.3,
				Math.max(...p.items.map((i) => textWidth(i.label, 34 * f.u))) + 32 * f.u,
			);
			const valueW = 150 * f.u;
			const row = Math.min(area.h / n, 150 * f.u);
			const barH = row * 0.52;
			// The rows sit in the middle of the space under the title.
			area.y += Math.max(0, (area.h - row * n) / 2);
			const x0 = area.x + labelW;
			const span = area.w - labelW - valueW;
			layers.push({
				type: "line",
				name: "Axis",
				points: [
					[x0, area.y],
					[x0, area.y + row * n],
				],
				stroke: t.line,
				strokeWidth: 2 * f.u,
				enter: { preset: "draw", atMs: 250, durationMs: 600 },
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			});
			p.items.forEach((it, i) => {
				const cy = area.y + row * i + row / 2;
				const at = 500 + i * 110;
				const w = Math.max(2 * f.u, (it.value / max) * span);
				layers.push(
					{
						type: "text",
						name: `Label ${i + 1}`,
						text: it.label,
						x: area.x,
						y: cy,
						size: 34 * f.u,
						weight: 500,
						color: t.text,
						enter: { preset: "fade", atMs: at - 100, durationMs: 500 },
						exit: { preset: "fade", atMs: out, durationMs: 300 },
					},
					{
						type: "rect",
						name: `Bar ${i + 1}`,
						x: x0,
						y: cy,
						origin: "left",
						width: w,
						height: barH,
						radius: 4 * f.u,
						fill: colorFor(i),
						keys: {
							width: [
								[at, 0, "outExpo"],
								[at + 1100, w],
							],
						},
						exit: { preset: "fade", atMs: out + i * 30, durationMs: 300 },
					},
					{
						type: "text",
						name: `Value ${i + 1}`,
						text: "",
						x: x0 + w + 18 * f.u,
						y: cy,
						size: 38 * f.u,
						weight: 700,
						font: "display",
						color: i === p.highlight ? t.accent : t.text,
						count: {
							from: 0,
							to: it.value,
							atMs: at,
							durationMs: 1100,
							decimals,
							prefix: p.prefix,
							suffix: p.unit,
						},
						keys: {
							x: [
								[at, x0 + 18 * f.u, "outExpo"],
								[at + 1100, x0 + w + 18 * f.u],
							],
						},
						enter: { preset: "fade", atMs: at, durationMs: 300 },
						exit: { preset: "fade", atMs: out, durationMs: 300 },
					},
				);
			});
		} else {
			const col = area.w / n;
			const barW = Math.min(col * 0.56, 140 * f.u);
			const base = area.y + area.h - 50 * f.u;
			const span = base - area.y - 60 * f.u;
			layers.push({
				type: "line",
				name: "Baseline",
				points: [
					[area.x, base],
					[area.x + area.w, base],
				],
				stroke: t.line,
				strokeWidth: 2 * f.u,
				enter: { preset: "draw", atMs: 250, durationMs: 700 },
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			});
			p.items.forEach((it, i) => {
				const cx = area.x + col * i + col / 2;
				const at = 500 + i * 90;
				const h = Math.max(2 * f.u, (it.value / max) * span);
				layers.push(
					{
						type: "rect",
						name: `Column ${i + 1}`,
						x: cx,
						y: base,
						origin: "bottom",
						width: barW,
						height: h,
						radius: 4 * f.u,
						fill: colorFor(i),
						keys: {
							height: [
								[at, 0, "outExpo"],
								[at + 1100, h],
							],
						},
						exit: { preset: "fade", atMs: out + i * 30, durationMs: 300 },
					},
					{
						type: "text",
						name: `Value ${i + 1}`,
						text: "",
						x: cx,
						y: base - h - 30 * f.u,
						align: "center",
						size: 30 * f.u,
						weight: 700,
						font: "display",
						color: i === p.highlight ? t.accent : t.text,
						count: {
							from: 0,
							to: it.value,
							atMs: at,
							durationMs: 1100,
							decimals,
							prefix: p.prefix,
							suffix: p.unit,
						},
						keys: {
							y: [
								[at, base - 30 * f.u, "outExpo"],
								[at + 1100, base - h - 30 * f.u],
							],
						},
						enter: { preset: "fade", atMs: at, durationMs: 300 },
						exit: { preset: "fade", atMs: out, durationMs: 300 },
					},
					{
						type: "text",
						name: `Label ${i + 1}`,
						text: it.label,
						x: cx,
						y: base + 30 * f.u,
						align: "center",
						size: 24 * f.u,
						weight: 500,
						color: t.muted,
						enter: { preset: "fade", atMs: at, durationMs: 500 },
						exit: { preset: "fade", atMs: out, durationMs: 300 },
					},
				);
			});
		}
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			...(p.backdrop === "full" ? { background: t.bg } : {}),
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers,
		};
	},
});

const donutChart = template({
	id: "donut-chart",
	name: "Donut chart",
	category: "chart",
	description:
		"Parts of a whole: each slice sweeps in after the last, the total counts up in the middle and a legend with shares rises beside it.",
	overlay: false,
	params: z.object({
		...chartCommon,
		items: z.array(item).min(1).max(6),
		/** Text under the number in the middle (the total is shown by default). */
		centerLabel: z.string().max(30).default("Total"),
	}),
	example: {
		title: "Where visitors come from",
		source: "Site analytics, Q3",
		items: [
			{ label: "Search", value: 48 },
			{ label: "Direct", value: 27 },
			{ label: "Social", value: 16 },
			{ label: "Referral", value: 9 },
		],
		unit: "%",
		centerLabel: "Visits",
		theme: "signal",
	},
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 6000;
		const out = D - 700;
		const { layers, area } = chartFrame(p, t, f, out);
		const total = p.items.reduce((s, i) => s + Math.max(0, i.value), 0) || 1;
		const palette = [t.accent, t.accent2, t.accent3, t.text, t.muted, t.line];
		const r = Math.min(area.h * 0.42, (f.portrait ? area.w : area.w * 0.45) * 0.42);
		const legendW =
			36 * f.u + Math.max(...p.items.map((i) => textWidth(i.label, 30 * f.u))) + 200 * f.u;
		const groupW = 2 * r + 110 * f.u + legendW;
		const cx = f.portrait ? area.x + area.w / 2 : area.x + Math.max(0, (area.w - groupW) / 2) + r;
		const cy = f.portrait ? area.y + r + 10 * f.u : area.y + area.h / 2;
		const thick = r * 0.28;
		layers.push({
			type: "arc",
			name: "Track",
			x: cx,
			y: cy,
			radius: r,
			thickness: thick,
			color: t.line,
			enter: { preset: "fade", atMs: 200, durationMs: 500 },
			exit: { preset: "fade", atMs: out, durationMs: 300 },
		});
		let at = 0;
		const gap = p.items.length > 1 ? 0.004 : 0;
		p.items.forEach((it, i) => {
			const share = Math.max(0, it.value) / total;
			const start = 500 + i * 260;
			layers.push({
				type: "arc",
				name: `Slice ${i + 1}`,
				x: cx,
				y: cy,
				radius: r,
				thickness: thick,
				from: at + gap,
				to: Math.max(at + gap, at + share - gap),
				color: palette[i % palette.length],
				enter: {
					preset: "draw",
					atMs: start,
					durationMs: Math.max(350, share * 1600),
					ease: "outCubic",
				},
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			});
			at += share;
		});
		const decimals = decimalsOf(p.items.map((i) => i.value));
		layers.push(
			{
				type: "text",
				name: "Total",
				text: "",
				x: cx,
				y: cy - 12 * f.u,
				align: "center",
				size: r * 0.42,
				weight: 700,
				font: "display",
				color: t.text,
				count: {
					from: 0,
					to: total,
					atMs: 500,
					durationMs: 1400,
					decimals,
					prefix: p.prefix,
					suffix: p.unit === "%" ? "" : p.unit,
				},
				enter: { preset: "pop", atMs: 400, durationMs: 600 },
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			},
			{
				type: "text",
				name: "Center label",
				text: p.centerLabel,
				uppercase: true,
				tracking: 3 * f.u,
				x: cx,
				y: cy + r * 0.3,
				align: "center",
				size: Math.max(16 * f.u, r * 0.1),
				weight: 600,
				color: t.muted,
				enter: { preset: "fade", atMs: 700, durationMs: 500 },
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			},
		);
		const lx = f.portrait ? area.x : cx + r + 110 * f.u;
		const ly = f.portrait ? cy + r + 70 * f.u : cy - (p.items.length - 1) * 42 * f.u;
		p.items.forEach((it, i) => {
			const y = ly + i * 84 * f.u;
			const pct = (Math.max(0, it.value) / total) * 100;
			const at2 = 600 + i * 260;
			layers.push(
				{
					type: "rect",
					name: `Key ${i + 1}`,
					x: lx + 9 * f.u,
					y,
					width: 18 * f.u,
					height: 18 * f.u,
					radius: 4 * f.u,
					fill: palette[i % palette.length],
					enter: { preset: "pop", atMs: at2, durationMs: 500 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				risingText(
					{
						name: `Legend ${i + 1}`,
						text: it.label,
						x: lx + 36 * f.u,
						y,
						size: 30 * f.u,
						color: t.text,
						weight: 500,
						atMs: at2,
						outMs: out,
					},
					f.W,
				),
				{
					type: "text",
					name: `Share ${i + 1}`,
					text: "",
					x: f.portrait ? area.x + area.w : lx + legendW,
					y,
					align: "right",
					size: 30 * f.u,
					weight: 700,
					font: "display",
					color: palette[i % palette.length] === t.line ? t.text : palette[i % palette.length],
					count: {
						from: 0,
						to: pct,
						atMs: at2,
						durationMs: 900,
						decimals: pct > 0 && pct < 1 ? 1 : 0,
						suffix: "%",
					},
					enter: { preset: "fade", atMs: at2, durationMs: 300 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
			);
		});
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			...(p.backdrop === "full" ? { background: t.bg } : {}),
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers,
		};
	},
});

const lineChart = template({
	id: "line-chart",
	name: "Line chart",
	category: "chart",
	description:
		"A trend over time: gridlines draw, the line traces left to right under a soft fill, points pop in as it passes and the last value is called out.",
	overlay: false,
	params: z.object({
		...chartCommon,
		points: z.array(item).min(2).max(24),
	}),
	example: {
		title: "Monthly active users",
		subtitle: "Thousands",
		source: "Product analytics",
		points: [
			{ label: "Jan", value: 12 },
			{ label: "Feb", value: 15 },
			{ label: "Mar", value: 14 },
			{ label: "Apr", value: 21 },
			{ label: "May", value: 26 },
			{ label: "Jun", value: 34 },
		],
		unit: "k",
		theme: "ocean",
	},
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 6500;
		const out = D - 700;
		const { layers, area } = chartFrame(p, t, f, out);
		const values = p.points.map((q) => q.value);
		const lo = Math.min(0, ...values);
		const hi = Math.max(...values);
		const range = hi - lo || 1;
		const left = area.x + 70 * f.u;
		const right = area.x + area.w - 110 * f.u;
		const top = area.y + 30 * f.u;
		const bottom = area.y + area.h - 50 * f.u;
		const px = (i: number) => left + ((right - left) * i) / (p.points.length - 1);
		const py = (v: number) => bottom - ((v - lo) / range) * (bottom - top);
		const decimals = decimalsOf(values);
		for (let g = 0; g <= 3; g++) {
			const y = bottom - ((bottom - top) * g) / 3;
			const v = lo + (range * g) / 3;
			layers.push(
				{
					type: "line",
					name: `Grid ${g + 1}`,
					points: [
						[left, y],
						[right, y],
					],
					stroke: t.line,
					strokeWidth: (g === 0 ? 2 : 1) * f.u,
					dash: g === 0 ? undefined : [6 * f.u, 8 * f.u],
					enter: { preset: "draw", atMs: 200 + g * 80, durationMs: 700 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				{
					type: "text",
					name: `Tick ${g + 1}`,
					text: `${p.prefix}${fmt(v, decimals)}${p.unit}`,
					x: left - 16 * f.u,
					y,
					align: "right",
					size: 20 * f.u,
					weight: 500,
					color: t.muted,
					enter: { preset: "fade", atMs: 300 + g * 80, durationMs: 500 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
			);
		}
		const pts = p.points.map((q, i) => [px(i), py(q.value)] as [number, number]);
		const drawAt = 700;
		const drawMs = 1600;
		layers.push(
			{
				type: "line",
				name: "Area",
				points: [...pts, [right, bottom], [left, bottom]],
				closed: true,
				fill: null,
				gradient: {
					kind: "linear",
					from: [0, top],
					to: [0, bottom],
					stops: [
						[0, `${t.accent}55`],
						[1, `${t.accent}00`],
					],
				},
				enter: { preset: "fade", atMs: drawAt + drawMs * 0.6, durationMs: 800 },
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			},
			{
				type: "line",
				name: "Trend",
				points: pts,
				stroke: t.accent,
				strokeWidth: 6 * f.u,
				enter: { preset: "draw", atMs: drawAt, durationMs: drawMs, ease: "inOutCubic" },
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			},
		);
		pts.forEach(([x, y], i) => {
			const at = drawAt + (drawMs * i) / (pts.length - 1);
			layers.push(
				{
					type: "ellipse",
					name: `Point ${i + 1}`,
					x,
					y,
					width: 18 * f.u,
					height: 18 * f.u,
					fill: t.bg,
					stroke: t.accent,
					strokeWidth: 5 * f.u,
					enter: { preset: "pop", atMs: at, durationMs: 400, amount: 0 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				{
					type: "text",
					name: `X ${i + 1}`,
					text: p.points[i].label,
					x,
					y: bottom + 32 * f.u,
					align: "center",
					size: 22 * f.u,
					weight: 500,
					color: t.muted,
					enter: { preset: "fade", atMs: at - 100, durationMs: 400 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
			);
		});
		const [lx, ly] = pts[pts.length - 1];
		const last = values[values.length - 1];
		const bubbleAt = drawAt + drawMs;
		layers.push(
			{
				type: "rect",
				name: "Callout",
				x: lx,
				y: ly - 62 * f.u,
				width: 150 * f.u,
				height: 60 * f.u,
				radius: 30 * f.u,
				fill: t.accent,
				enter: { preset: "pop", atMs: bubbleAt, durationMs: 500 },
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			},
			{
				type: "text",
				name: "Last value",
				text: `${p.prefix}${fmt(last, decimals)}${p.unit}`,
				x: lx,
				y: ly - 62 * f.u,
				align: "center",
				size: 30 * f.u,
				weight: 800,
				color: t.bg,
				enter: { preset: "pop", atMs: bubbleAt + 60, durationMs: 500 },
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			},
		);
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			...(p.backdrop === "full" ? { background: t.bg } : {}),
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers,
		};
	},
});

const bigStat = template({
	id: "big-stat",
	name: "Big number",
	category: "stat",
	description:
		"One number that matters: it counts up large while a ring fills to the share (when it is a percentage), with a label and a line of context.",
	overlay: false,
	params: z.object({
		...common,
		value: z.number(),
		prefix: z.string().max(4).default(""),
		suffix: z.string().max(6).default(""),
		label: z.string().max(60).default(""),
		context: z.string().max(140).default(""),
		/** Show a ring filled to value / ringOf (e.g. 100 for percentages). */
		ringOf: z.number().positive().optional(),
		backdrop: z.enum(["full", "none"]).default("full"),
	}),
	example: {
		value: 72,
		suffix: "%",
		label: "of teams ship weekly",
		context: "Up from 41% two years ago",
		ringOf: 100,
		theme: "sunset",
	},
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 5000;
		const out = D - 700;
		const cx = f.W / 2;
		const cy = f.H / 2 - (p.context ? 40 : 20) * f.u;
		const r = Math.min(f.H, f.W) * 0.27;
		const layers: MotionLayer[] = [];
		const decimals = decimalsOf([p.value]);
		if (p.ringOf) {
			const share = Math.max(0, Math.min(1, p.value / p.ringOf));
			layers.push(
				{
					type: "arc",
					name: "Ring track",
					x: cx,
					y: cy,
					radius: r,
					thickness: 18 * f.u,
					color: t.line,
					enter: { preset: "fade", atMs: 0, durationMs: 500 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				{
					type: "arc",
					name: "Ring",
					x: cx,
					y: cy,
					radius: r,
					thickness: 18 * f.u,
					to: share,
					color: t.accent,
					cap: "round",
					enter: { preset: "draw", atMs: 200, durationMs: 1600, ease: "outExpo" },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
			);
		}
		layers.push({
			type: "text",
			name: "Number",
			text: "",
			x: cx,
			y: cy,
			align: "center",
			size: p.ringOf ? r * 0.62 : 260 * f.u,
			weight: 700,
			font: "display",
			color: t.text,
			count: {
				from: 0,
				to: p.value,
				atMs: 200,
				durationMs: 1600,
				decimals,
				prefix: p.prefix,
				suffix: p.suffix,
				separator: ",",
			},
			enter: { preset: "blur", atMs: 150, durationMs: 700, amount: 30 * f.u },
			exit: { preset: "fade", atMs: out, durationMs: 300 },
		});
		const below = cy + (p.ringOf ? r + 70 * f.u : 170 * f.u);
		if (p.label)
			layers.push(
				risingText(
					{
						name: "Label",
						text: p.label,
						x: cx,
						y: below,
						size: 44 * f.u,
						color: t.text,
						weight: 600,
						align: "center",
						atMs: 700,
						outMs: out,
					},
					f.W,
				),
			);
		if (p.context)
			layers.push({
				type: "text",
				name: "Context",
				text: p.context,
				x: cx,
				y: below + 62 * f.u,
				align: "center",
				size: 28 * f.u,
				weight: 400,
				color: t.muted,
				enter: { preset: "rise", atMs: 950, durationMs: 700, amount: 20 * f.u },
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			});
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			...(p.backdrop === "full" ? { background: t.bg } : {}),
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers,
		};
	},
});

const statRow = template({
	id: "stat-row",
	name: "Key numbers",
	category: "stat",
	description:
		"Two to four figures side by side on cards that rise in turn, each counting up with its label.",
	overlay: false,
	params: z.object({
		...common,
		title: z.string().max(80).default(""),
		stats: z
			.array(
				z.object({
					value: z.number(),
					prefix: z.string().max(4).default(""),
					suffix: z.string().max(6).default(""),
					label: z.string().max(40),
				}),
			)
			.min(1)
			.max(4),
		backdrop: z.enum(["full", "none"]).default("full"),
	}),
	example: {
		title: "The year in numbers",
		stats: [
			{ value: 18400, label: "Readers" },
			{ value: 3.4, suffix: "×", label: "Growth" },
			{ value: 96, suffix: "%", label: "Would recommend" },
		],
		theme: "midnight",
	},
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 5500;
		const out = D - 700;
		const n = p.stats.length;
		const gap = 28 * f.u;
		const layers: MotionLayer[] = [];
		const vertical = f.portrait;
		const cardW = vertical ? f.W - 2 * f.m : (f.W - 2 * f.m - gap * (n - 1)) / n;
		const cardH = vertical ? Math.min(260 * f.u, (f.H * 0.6 - gap * (n - 1)) / n) : 320 * f.u;
		const totalH = vertical ? n * cardH + (n - 1) * gap : cardH;
		const top = f.H / 2 - totalH / 2 + (p.title ? 50 * f.u : 0);
		if (p.title)
			layers.push(
				risingText(
					{
						name: "Title",
						text: p.title,
						x: f.m,
						y: top - 90 * f.u,
						size: 56 * f.u,
						color: t.text,
						font: t.display,
						weight: t.displayWeight,
						atMs: 100,
						outMs: out,
					},
					f.W,
				),
			);
		p.stats.forEach((s, i) => {
			const x = vertical ? f.m : f.m + i * (cardW + gap);
			const y = vertical ? top + i * (cardH + gap) : top;
			const at = 300 + i * 150;
			layers.push({
				type: "group",
				name: `Card ${i + 1}`,
				pivot: [x + cardW / 2, y + cardH / 2],
				enter: [{ preset: "rise", atMs: at, durationMs: 800, amount: 60 * f.u }],
				exit: { preset: "fade", atMs: out + i * 50, durationMs: 350 },
				layers: [
					{
						type: "rect",
						x: x + cardW / 2,
						y: y + cardH / 2,
						width: cardW,
						height: cardH,
						radius: 16 * f.u,
						fill: t.surface,
					},
					{
						type: "rect",
						x,
						y: y + 4 * f.u,
						origin: "left",
						width: cardW,
						height: 8 * f.u,
						fill: i === 0 ? t.accent : i === 1 ? t.accent2 : t.accent3,
						enter: { preset: "grow", atMs: at + 200, durationMs: 900 },
					},
					{
						type: "text",
						text: "",
						x: x + 40 * f.u,
						y: y + cardH * 0.45,
						size: Math.min(110 * f.u, cardH * 0.34),
						weight: 700,
						font: "display",
						color: t.text,
						count: {
							from: 0,
							to: s.value,
							atMs: at + 150,
							durationMs: 1400,
							decimals: decimalsOf([s.value]),
							prefix: s.prefix,
							suffix: s.suffix,
							separator: ",",
						},
					},
					{
						type: "text",
						text: s.label,
						uppercase: true,
						tracking: 3 * f.u,
						x: x + 40 * f.u,
						y: y + cardH * 0.78,
						size: 24 * f.u,
						weight: 600,
						color: t.muted,
					},
				],
			});
		});
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			...(p.backdrop === "full" ? { background: t.bg } : {}),
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers,
		};
	},
});

const callout = template({
	id: "callout",
	name: "Callout",
	category: "callout",
	description:
		"Points at something in the footage: a pulsing marker at the target, a leader line that draws to a label with a value. Place the target where the thing is (shares of the frame).",
	overlay: true,
	params: z.object({
		...common,
		label: z.string().max(40),
		value: z.string().max(30).default(""),
		/** Where a factual value comes from, in small type under the label. */
		source: z.string().max(80).default(""),
		/** The point to mark, as shares of the frame (0–1). */
		targetX: z.number().min(0).max(1).default(0.4),
		targetY: z.number().min(0).max(1).default(0.55),
		/** Where the label sits, as shares of the frame. */
		labelX: z.number().min(0).max(1).default(0.68),
		labelY: z.number().min(0).max(1).default(0.3),
	}),
	example: {
		label: "Central Station",
		value: "42% of riders",
		targetX: 0.38,
		targetY: 0.58,
		theme: "signal",
	},
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 4500;
		const out = D - 600;
		const tx = p.targetX * f.W;
		const ty = p.targetY * f.H;
		const lx = p.labelX * f.W;
		const ly = p.labelY * f.H;
		const size = 34 * f.u;
		const valueSize = 26 * f.u;
		const sourceSize = 18 * f.u;
		const sourceText = p.source ? `Source: ${p.source}` : "";
		const w =
			Math.max(
				textWidth(p.label.toUpperCase(), size, "sans", 1.5 * f.u),
				textWidth(p.value, valueSize),
				textWidth(sourceText, sourceSize),
			) +
			90 * f.u;
		const h = ((p.value ? 112 : 72) + (p.source ? 34 : 0)) * f.u;
		// Label and value sit higher when a source line is under them.
		const shift = p.source ? -17 * f.u : 0;
		const right = lx >= tx;
		const boxX = right ? lx : lx - w;
		const elbow: [number, number] = [lx, ty + (ly - ty) * 0.001];
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			markers: [{ name: "outro", atMs: out, durationMs: 600 }],
			layers: [
				{
					type: "ellipse",
					name: "Pulse",
					x: tx,
					y: ty,
					width: 90 * f.u,
					height: 90 * f.u,
					fill: null,
					stroke: t.accent,
					strokeWidth: 3 * f.u,
					keys: {
						scale: [
							[0, 0.2, "outCubic"],
							[1100, 1.2, "hold"],
							[1101, 0.2, "outCubic"],
							[2200, 1.2, "hold"],
							[2201, 0.2, "outCubic"],
							[3300, 1.2],
						],
						opacity: [
							[0, 1, "in"],
							[1100, 0, "hold"],
							[1101, 1, "in"],
							[2200, 0, "hold"],
							[2201, 1, "in"],
							[3300, 0],
						],
					},
				},
				{
					type: "ellipse",
					name: "Target",
					x: tx,
					y: ty,
					width: 28 * f.u,
					height: 28 * f.u,
					fill: t.accent,
					stroke: t.bg,
					strokeWidth: 4 * f.u,
					enter: { preset: "pop", atMs: 0, durationMs: 500, amount: 0 },
					exit: { preset: "pop", atMs: out + 300, durationMs: 300, amount: 0 },
				},
				{
					type: "line",
					name: "Leader",
					points: [[tx, ty], elbow, [lx, ly]],
					stroke: t.accent,
					strokeWidth: 3 * f.u,
					cap: "butt",
					enter: { preset: "draw", atMs: 250, durationMs: 700, ease: "inOutCubic" },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				{
					type: "rect",
					name: "Label box",
					x: boxX,
					y: ly,
					origin: "left",
					width: w,
					height: h,
					radius: 4 * f.u,
					fill: t.surface,
					shadow: { opacity: 0.4, distance: 8 * f.u, blur: 28 * f.u },
					enter: { preset: "grow", atMs: 850, durationMs: 600 },
					exit: { preset: "grow", atMs: out + 150, durationMs: 400 },
				},
				{
					type: "rect",
					name: "Label edge",
					x: right ? boxX : boxX + w - 6 * f.u,
					y: ly,
					origin: "left",
					width: 6 * f.u,
					height: h,
					fill: t.accent,
					enter: { preset: "fade", atMs: 850, durationMs: 200 },
					exit: { preset: "fade", atMs: out + 300, durationMs: 200 },
				},
				risingText(
					{
						name: "Label",
						text: p.label,
						uppercase: true,
						tracking: 1.5 * f.u,
						x: boxX + 30 * f.u,
						y: ly - (p.value ? 20 : 0) * f.u + shift,
						size,
						color: t.text,
						weight: 700,
						atMs: 1050,
						outMs: out,
					},
					f.W,
				),
				...(p.value
					? [
							{
								type: "text" as const,
								name: "Value",
								text: p.value,
								x: boxX + 30 * f.u,
								y: ly + 26 * f.u + shift,
								size: valueSize,
								weight: 600,
								color: t.accent,
								enter: { preset: "type" as const, atMs: 1250, durationMs: 450 },
								exit: { preset: "fade" as const, atMs: out, durationMs: 250 },
							},
						]
					: []),
				...(p.source
					? [
							{
								type: "text" as const,
								name: "Source",
								text: sourceText,
								x: boxX + 30 * f.u,
								y: ly + h / 2 - 24 * f.u,
								size: sourceSize,
								weight: 400,
								color: t.muted,
								enter: { preset: "fade" as const, atMs: 1450, durationMs: 400 },
								exit: { preset: "fade" as const, atMs: out, durationMs: 250 },
							},
						]
					: []),
			],
		};
	},
});

const timeline = template({
	id: "timeline",
	name: "Timeline",
	category: "list",
	description:
		"Milestones in order: a line draws across, each point pops in with its date above and a label below.",
	overlay: false,
	params: z.object({
		...common,
		title: z.string().max(80).default(""),
		items: z
			.array(z.object({ date: z.string().max(20), label: z.string().max(40) }))
			.min(2)
			.max(7),
		backdrop: z.enum(["full", "none"]).default("full"),
	}),
	example: {
		title: "How we got here",
		items: [
			{ date: "2019", label: "First prototype" },
			{ date: "2021", label: "Public launch" },
			{ date: "2023", label: "One million users" },
			{ date: "2025", label: "Going global" },
		],
		theme: "editorial",
	},
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 6000;
		const out = D - 700;
		const layers: MotionLayer[] = [];
		const y = f.H / 2 + 20 * f.u;
		const left = f.m * 1.3;
		const right = f.W - f.m * 1.3;
		if (p.title)
			layers.push(
				risingText(
					{
						name: "Title",
						text: p.title,
						x: left,
						y: f.m + 50 * f.u,
						size: 56 * f.u,
						color: t.text,
						font: t.display,
						weight: t.displayWeight,
						atMs: 100,
						outMs: out,
					},
					f.W,
				),
			);
		const drawMs = 400 + p.items.length * 280;
		layers.push({
			type: "line",
			name: "Line",
			points: [
				[left, y],
				[right, y],
			],
			stroke: t.line,
			strokeWidth: 4 * f.u,
			cap: "butt",
			enter: { preset: "draw", atMs: 300, durationMs: drawMs, ease: "inOutCubic" },
			exit: { preset: "fade", atMs: out, durationMs: 300 },
		});
		const n = p.items.length;
		p.items.forEach((it, i) => {
			const x = left + ((right - left) * (i + 0.5)) / n;
			const at = 300 + (drawMs * (i + 0.5)) / n;
			layers.push(
				{
					type: "ellipse",
					name: `Node ${i + 1}`,
					x,
					y,
					width: 30 * f.u,
					height: 30 * f.u,
					fill: i === n - 1 ? t.accent : t.bg,
					stroke: t.accent,
					strokeWidth: 5 * f.u,
					enter: { preset: "pop", atMs: at, durationMs: 500, amount: 0 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				risingText(
					{
						name: `Date ${i + 1}`,
						text: it.date,
						x,
						y: y - 70 * f.u,
						size: 46 * f.u,
						color: t.text,
						font: "display",
						weight: 700,
						align: "center",
						atMs: at + 60,
						outMs: out,
					},
					f.W,
				),
				{
					type: "text",
					name: `Label ${i + 1}`,
					text: it.label,
					x,
					y: y + 64 * f.u,
					align: "center",
					size: 26 * f.u,
					weight: 500,
					color: t.muted,
					enter: { preset: "rise", atMs: at + 150, durationMs: 600, amount: 20 * f.u },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
			);
		});
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			...(p.backdrop === "full" ? { background: t.bg } : {}),
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers,
		};
	},
});

const checklist = template({
	id: "checklist",
	name: "Checklist",
	category: "list",
	description: "A titled list whose items slide in one by one, each ticked off as it lands.",
	overlay: false,
	params: z.object({
		...common,
		title: z.string().max(80).default(""),
		items: z.array(z.string().max(70)).min(1).max(6),
		backdrop: z.enum(["full", "none"]).default("full"),
	}),
	example: {
		title: "Before you ship",
		items: ["Test on a real phone", "Read it out loud", "Check the numbers twice"],
		theme: "ocean",
	},
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 5500;
		const out = D - 700;
		const layers: MotionLayer[] = [];
		const row = 118 * f.u;
		const x = f.m * 1.5;
		const top = f.H / 2 - (p.items.length * row) / 2 + (p.title ? 50 * f.u : 0);
		if (p.title)
			layers.push(
				risingText(
					{
						name: "Title",
						text: p.title,
						x,
						y: top - 120 * f.u,
						size: 80 * f.u,
						color: t.text,
						font: t.display,
						weight: t.displayWeight,
						atMs: 100,
						outMs: out,
					},
					f.W,
				),
			);
		p.items.forEach((text, i) => {
			const y = top + i * row + row / 2;
			const at = 450 + i * 320;
			const s = 54 * f.u;
			layers.push(
				{
					type: "rect",
					name: `Box ${i + 1}`,
					x: x + s / 2,
					y,
					width: s,
					height: s,
					radius: 10 * f.u,
					fill: t.accent,
					enter: { preset: "pop", atMs: at, durationMs: 450 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				{
					type: "line",
					name: `Tick ${i + 1}`,
					points: [
						[x + s * 0.27, y + s * 0.02],
						[x + s * 0.44, y + s * 0.2],
						[x + s * 0.75, y - s * 0.18],
					],
					stroke: t.bg,
					strokeWidth: 6 * f.u,
					enter: { preset: "draw", atMs: at + 250, durationMs: 350, ease: "outCubic" },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				{
					type: "text",
					name: `Item ${i + 1}`,
					text,
					x: x + s + 36 * f.u,
					y,
					size: 50 * f.u,
					weight: 500,
					color: t.text,
					enter: { preset: "slideRight", atMs: at + 80, durationMs: 700, amount: 50 * f.u },
					exit: { preset: "fade", atMs: out + i * 40, durationMs: 300 },
				},
			);
		});
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			...(p.backdrop === "full" ? { background: t.bg } : {}),
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers,
		};
	},
});

const quote = template({
	id: "quote",
	name: "Quote",
	category: "quote",
	description:
		"A pull quote: a large quotation mark drops in, the lines rise one by one and the attribution slides in under a short rule.",
	overlay: false,
	params: z.object({
		...common,
		quote: z.string().max(260),
		author: z.string().max(80).default(""),
		backdrop: z.enum(["full", "none"]).default("full"),
	}),
	example: {
		quote: "The details are not the details.\nThey make the design.",
		author: "Charles Eames",
		theme: "editorial",
	},
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 6000;
		const out = D - 700;
		const size = 84 * f.u;
		// Wrap to about 30 characters a line unless the text has its own breaks.
		const lines = p.quote.includes("\n")
			? p.quote.split("\n")
			: wrap(p.quote, f.portrait ? 16 : 28);
		const lh = size * 1.22;
		const x = f.m * 1.6;
		const top = f.H / 2 - (lines.length * lh) / 2 - 20 * f.u;
		const layers: MotionLayer[] = [
			{
				type: "text",
				name: "Mark",
				text: "“",
				x: x - 10 * f.u,
				y: top - 40 * f.u,
				size: 260 * f.u,
				font: "serif",
				weight: 400,
				color: t.accent,
				enter: { preset: "fall", atMs: 0, durationMs: 800, amount: 60 * f.u },
				exit: { preset: "fade", atMs: out, durationMs: 300 },
			},
		];
		lines.slice(0, 6).forEach((l, i) => {
			layers.push(
				risingText(
					{
						name: `Line ${i + 1}`,
						text: l,
						x,
						y: top + i * lh + lh / 2,
						size,
						color: t.text,
						font: "serif",
						weight: 400,
						atMs: 300 + i * 130,
						outMs: out + i * 40,
					},
					f.W,
				),
			);
		});
		if (p.author) {
			const y = top + lines.length * lh + 60 * f.u;
			layers.push(
				{
					type: "line",
					name: "Rule",
					points: [
						[x, y],
						[x + 60 * f.u, y],
					],
					stroke: t.accent,
					strokeWidth: 4 * f.u,
					cap: "butt",
					enter: { preset: "draw", atMs: 500 + lines.length * 130, durationMs: 500 },
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
				{
					type: "text",
					name: "Author",
					text: p.author,
					uppercase: true,
					tracking: 3 * f.u,
					x: x + 84 * f.u,
					y,
					size: 26 * f.u,
					weight: 600,
					color: t.muted,
					enter: {
						preset: "slideRight",
						atMs: 650 + lines.length * 130,
						durationMs: 700,
						amount: 30 * f.u,
					},
					exit: { preset: "fade", atMs: out, durationMs: 300 },
				},
			);
		}
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			...(p.backdrop === "full" ? { background: t.bg } : {}),
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers,
		};
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

// --- Transitions --------------------------------------------------------------

/** Transitions cover the whole frame at `cut` and uncover it after; the edit cuts underneath. */
const transitionParams = {
	...common,
	/** How long the whole transition lasts. */
	durationMs: z.number().min(400).max(4000).default(1200),
};

const panelsTransition = template({
	id: "transition-panels",
	name: "Sliding panels",
	category: "transition",
	description:
		"Three coloured panels sweep across and off again; the cut happens underneath while the frame is covered. Place it centred on a cut.",
	overlay: true,
	params: z.object({
		...transitionParams,
		direction: z.enum(["left", "right", "up", "down"]).default("right"),
	}),
	example: { theme: "sunset", direction: "right" },
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs;
		const half = D / 2;
		const colors = [t.accent2, t.accent, t.bg];
		const horizontal = p.direction === "left" || p.direction === "right";
		const sign = p.direction === "right" || p.direction === "down" ? 1 : -1;
		const span = horizontal ? f.W : f.H;
		const layers: MotionLayer[] = colors.map((color, i) => {
			const lag = i * D * 0.07;
			const inStart = lag;
			const inEnd = half - (2 - i) * D * 0.02;
			const outStart = half + i * D * 0.04;
			const outEnd = D - (2 - i) * D * 0.03;
			const home = horizontal ? f.W / 2 : f.H / 2;
			const from = home - sign * span * 1.05;
			const to = home + sign * span * 1.05;
			const k = [
				[inStart, from, "inOutCubic"],
				[inEnd, home, "hold"],
				[outStart, home, "inOutCubic"],
				[outEnd, to],
			] as [number, number, string?][];
			return {
				type: "rect" as const,
				name: `Panel ${i + 1}`,
				x: f.W / 2,
				y: f.H / 2,
				width: f.W * (horizontal ? 1.02 : 1.2),
				height: f.H * (horizontal ? 1.2 : 1.02),
				fill: color,
				keys: horizontal ? { x: k as never } : { y: k as never },
			};
		});
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			markers: [{ name: "cut", atMs: half, durationMs: 0 }],
			layers,
		};
	},
});

const irisTransition = template({
	id: "transition-iris",
	name: "Iris",
	category: "transition",
	description:
		"Rings expand from a point to fill the frame, then open out from the centre onto the next shot.",
	overlay: true,
	params: z.object({
		...transitionParams,
		x: z.number().min(0).max(1).default(0.5),
		y: z.number().min(0).max(1).default(0.5),
	}),
	example: { theme: "ocean" },
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs;
		const half = D / 2;
		const cx = p.x * f.W;
		const cy = p.y * f.H;
		const reach = 2.2 * Math.hypot(Math.max(cx, f.W - cx), Math.max(cy, f.H - cy));
		const layers: MotionLayer[] = [t.accent2, t.accent, t.bg].map((color, i) => ({
			type: "ellipse" as const,
			name: `Ring ${i + 1}`,
			x: cx,
			y: cy,
			width: reach,
			height: reach,
			fill: color,
			keys: {
				scale: [
					[i * D * 0.06, 0, "inOutCubic"],
					[half - (2 - i) * D * 0.02, 1, "hold"],
				],
			},
			endMs: half + (i === 2 ? 0 : 1),
		}));
		// After the cut the cover opens from the centre: a ring so thick it covers everything,
		// whose hole grows (its inner edge is size / 2 - reach).
		layers.push({
			type: "rect",
			name: "Open",
			x: cx,
			y: cy,
			width: 2 * reach,
			height: 2 * reach,
			radius: 1e6,
			fill: null,
			stroke: t.bg,
			strokeWidth: 2 * reach,
			startMs: half,
			keys: {
				width: [
					[half, 2 * reach, "inOutCubic"],
					[D, 4.2 * reach],
				],
				height: [
					[half, 2 * reach, "inOutCubic"],
					[D, 4.2 * reach],
				],
			},
		});
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			markers: [{ name: "cut", atMs: half, durationMs: 0 }],
			layers,
		};
	},
});

const stripesTransition = template({
	id: "transition-stripes",
	name: "Diagonal stripes",
	category: "transition",
	description:
		"Slanted stripes shoot across one after another until the frame is covered, then carry on off the other side.",
	overlay: true,
	params: z.object({ ...transitionParams, stripes: z.number().int().min(3).max(12).default(6) }),
	example: { theme: "signal", stripes: 6 },
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs;
		const half = D / 2;
		const n = p.stripes;
		const diag = Math.hypot(f.W, f.H);
		const band = (diag / n) * 1.12;
		const colors = [t.accent, t.accent2, t.accent3];
		const layers: MotionLayer[] = [];
		// Each stripe is turned 30° and travels along its own length (a turned group would be
		// clipped to the frame and leave the corners open).
		const angle = (-30 * Math.PI) / 180;
		const along: [number, number] = [-Math.sin(angle), Math.cos(angle)];
		const across: [number, number] = [Math.cos(angle), Math.sin(angle)];
		const at = (offset: number, travel: number) => [
			f.W / 2 + across[0] * offset + along[0] * travel,
			f.H / 2 + across[1] * offset + along[1] * travel,
		];
		for (let i = 0; i < n; i++) {
			const offset = (i - (n - 1) / 2) * (diag / n);
			const lag = (i / n) * D * 0.18;
			const far = diag * 1.4;
			const times: [number, number, string][] = [
				[lag, -far, "inOutCubic"],
				[half - D * 0.04, 0, "hold"],
				[half + D * 0.02 + lag * 0.5, 0, "inOutCubic"],
				[D - D * 0.02, far, "linear"],
			];
			layers.push({
				type: "rect",
				name: `Stripe ${i + 1}`,
				rotation: -30,
				width: band,
				height: diag * 1.3,
				fill: [...colors, t.bg][i % 4],
				keys: {
					x: times.map(([ms, travel, ease]) => [ms, at(offset, travel)[0], ease]) as never,
					y: times.map(([ms, travel, ease]) => [ms, at(offset, travel)[1], ease]) as never,
				},
			});
		}
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			markers: [{ name: "cut", atMs: half, durationMs: 0 }],
			layers,
		};
	},
});

const blocksTransition = template({
	id: "transition-blocks",
	name: "Blocks",
	category: "transition",
	description:
		"A grid of squares pops in from one corner to cover the frame and shrinks away towards the other.",
	overlay: true,
	params: z.object({ ...transitionParams, columns: z.number().int().min(4).max(16).default(8) }),
	example: { theme: "midnight", columns: 8 },
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs;
		const half = D / 2;
		const cols = p.columns;
		const size = f.W / cols;
		const rows = Math.ceil(f.H / size);
		const layers: MotionLayer[] = [];
		const maxD = cols + rows - 2 || 1;
		for (let r = 0; r < rows; r++)
			for (let q = 0; q < cols; q++) {
				const d = (q + r) / maxD;
				const inAt = d * half * 0.55;
				const outAt = half + d * half * 0.55;
				layers.push({
					type: "rect",
					x: q * size + size / 2,
					y: r * size + size / 2,
					width: size + 1,
					height: size + 1,
					fill: (q + r) % 5 === 0 ? t.accent : t.bg,
					keys: {
						scale: [
							[inAt, 0, "outCubic"],
							[inAt + half * 0.45, 1, "hold"],
							[outAt, 1, "inCubic"],
							[Math.min(D, outAt + half * 0.45), 0],
						],
					},
				});
			}
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			markers: [{ name: "cut", atMs: half, durationMs: 0 }],
			layers,
		};
	},
});

// --- Overlays, kinetic type and maps ----------------------------------------------

/** A keyframe as specs write it: [ms, value, ease]. */
type Key = [number, number, ...Ease[]];

const subscribe = template({
	id: "subscribe",
	name: "Subscribe reminder",
	category: "overlay",
	description:
		"A subscribe button in a corner: it pops in, a cursor glides over and clicks it, the button turns to Subscribed with a tick and the bell rings; it slides away at the end.",
	overlay: true,
	params: z.object({
		...common,
		label: z.string().max(24).default("Subscribe"),
		doneLabel: z.string().max(24).default("Subscribed"),
		corner: z
			.enum(["bottom-right", "bottom-left", "top-right", "top-left"])
			.default("bottom-right"),
		bell: z.boolean().default(true),
		cursor: z.boolean().default(true),
		/** The button's colour (default a strong red); colors.accent does the same. */
		color: hex.optional(),
	}),
	example: { corner: "bottom-right" },
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const D = p.durationMs ?? 5000;
		const out = D - 600;
		const red = p.color ?? p.colors?.accent ?? "#e8261c";
		const size = 30 * f.u;
		const tracking = 2 * f.u;
		const labels = [p.label, p.doneLabel].map((s) => s.toUpperCase());
		const textW = Math.max(...labels.map((s) => textWidth(s, size, "sans", tracking, 800)));
		const bh = 84 * f.u;
		const bw = 78 * f.u + textW + 40 * f.u;
		const gap = 16 * f.u;
		const total = bw + (p.bell ? gap + bh : 0);
		const right = p.corner.endsWith("right");
		const bottom = p.corner.startsWith("bottom");
		const left = right ? f.W - f.m - total : f.m;
		const by = bottom ? f.H - f.m - bh / 2 : f.m + bh / 2;
		const bx = left + bw / 2;
		const cx = left + bw + gap + bh / 2;
		const click = 1950;
		const iconX = left + 46 * f.u;
		const textX = left + 78 * f.u;
		const done = "#2a2a2a";
		const doneText = "#c4c4c4";
		// Where the cursor ends up: on the label, a little right of centre.
		const tipX = bx + 30 * f.u;
		const tipY = by + 10 * f.u;
		const layers: MotionLayer[] = [
			{
				type: "rect",
				name: "Button",
				x: bx,
				y: by,
				width: bw,
				height: bh,
				radius: bh / 2,
				fill: red,
				shadow: { opacity: 0.35, distance: 8 * f.u, blur: 24 * f.u },
				keys: p.cursor
					? {
							color: [
								[click, red, "outCubic"],
								[click + 200, done],
							],
							scale: [
								[click - 80, 1, "out"],
								[click, 0.94, "outBack"],
								[click + 220, 1],
							],
						}
					: undefined,
				enter: { preset: "pop", atMs: 0, durationMs: 600 },
			},
			{
				type: "path",
				name: "Play",
				x: iconX,
				y: by,
				d: `M ${-11 * f.u} ${-15 * f.u} L ${15 * f.u} 0 L ${-11 * f.u} ${15 * f.u} Z`,
				fill: "#ffffff",
				...(p.cursor ? { endMs: click + 100 } : {}),
				enter: { preset: "pop", atMs: 250, durationMs: 500 },
			},
			{
				type: "text",
				name: "Label",
				text: labels[0],
				x: textX,
				y: by,
				size,
				weight: 800,
				tracking,
				color: "#ffffff",
				...(p.cursor ? { endMs: click + 100 } : {}),
				enter: { preset: "fade", atMs: 250, durationMs: 300 },
			},
		];
		if (p.cursor)
			layers.push(
				{
					type: "line",
					name: "Tick",
					points: [
						[iconX - 12 * f.u, by + f.u],
						[iconX - 3 * f.u, by + 10 * f.u],
						[iconX + 14 * f.u, by - 9 * f.u],
					],
					stroke: doneText,
					strokeWidth: 5 * f.u,
					startMs: click + 100,
					enter: { preset: "draw", atMs: click + 120, durationMs: 300 },
				},
				{
					type: "text",
					name: "Label done",
					text: labels[1],
					x: textX,
					y: by,
					size,
					weight: 800,
					tracking,
					color: doneText,
					startMs: click + 100,
					enter: { preset: "fade", atMs: click + 100, durationMs: 200 },
				},
			);
		if (p.bell)
			layers.push(
				{
					type: "ellipse",
					name: "Bell circle",
					x: cx,
					y: by,
					width: bh,
					height: bh,
					fill: "#ffffff",
					shadow: { opacity: 0.35, distance: 8 * f.u, blur: 24 * f.u },
					enter: { preset: "pop", atMs: 120, durationMs: 600 },
				},
				{
					type: "path",
					name: "Bell",
					x: cx,
					y: by,
					scale: f.u,
					d: "M -14 8 C -14 -8 -10 -16 0 -16 C 10 -16 14 -8 14 8 L 18 12 L -18 12 Z M -5 15 A 5 5 0 0 0 5 15 Z M -2 -16 A 2 2 0 0 1 2 -16 Z",
					fill: "#111111",
					keys: {
						rotation: [
							[2500, 0, "inOut"],
							[2600, 20, "inOut"],
							[2700, -16, "inOut"],
							[2800, 12, "inOut"],
							[2900, -7, "inOut"],
							[3000, 0],
						],
					},
					enter: { preset: "pop", atMs: 220, durationMs: 600 },
				},
			);
		if (p.cursor)
			layers.push(
				{
					type: "ellipse",
					name: "Ripple",
					x: tipX,
					y: tipY,
					width: 110 * f.u,
					height: 110 * f.u,
					fill: null,
					stroke: "#ffffff",
					strokeWidth: 4 * f.u,
					startMs: click,
					keys: {
						scale: [
							[click, 0.1, "outCubic"],
							[click + 500, 1.3],
						],
						opacity: [
							[click, 0.9, "in"],
							[click + 500, 0],
						],
					},
				},
				{
					type: "path",
					name: "Cursor",
					x: tipX,
					y: tipY,
					scale: f.u,
					d: "M 0 0 L 0 38 L 10 29 L 17 44 L 24 41 L 17 26 L 30 26 Z",
					fill: "#ffffff",
					stroke: "#111111",
					strokeWidth: 2.5,
					keys: {
						x: [
							[500, right ? f.W + 40 * f.u : tipX + 400 * f.u, "outCubic"],
							[1650, tipX],
						],
						y: [
							[500, bottom ? f.H + 50 * f.u : tipY + 250 * f.u, "outCubic"],
							[1650, tipY],
						],
						scale: [
							[click - 80, f.u, "out"],
							[click, 0.82 * f.u, "outBack"],
							[click + 200, f.u],
						],
						opacity: [
							[3100, 1, "inCubic"],
							[3500, 0],
						],
					},
				},
			);
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			markers: [{ name: "outro", atMs: out, durationMs: 600 }],
			layers: [
				{
					type: "group",
					name: "Reminder",
					pivot: [bx, by],
					layers,
					exit: [
						{
							preset: right ? "slideRight" : "slideLeft",
							atMs: out,
							durationMs: 500,
							amount: 120 * f.u,
						},
						{ preset: "fade", atMs: out + 100, durationMs: 400 },
					],
				},
			],
		};
	},
});

const kineticWords = template({
	id: "kinetic-words",
	name: "Kinetic words",
	category: "title",
	description:
		"Short words slam in one after another (a scale punch with a blur, a flash and a small shake), each ending in an accent mark; a rule draws under them and they lift away. For openers and slogans.",
	overlay: false,
	params: z.object({
		...common,
		words: z.array(z.string().min(1).max(24)).min(1).max(6),
		/** Shown after each word in the accent colour ("" for none). */
		mark: z.string().max(2).default("."),
		/** One word under another, or all on one line. */
		layout: z.enum(["stack", "line"]).default("stack"),
		/** Time between words. */
		staggerMs: z.number().min(150).max(2000).default(500),
		uppercase: z.boolean().default(true),
		backdrop: z.enum(["full", "none"]).default("full"),
	}),
	example: { words: ["Build", "Ship", "Repeat"], theme: "signal" },
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const words = p.words.map((w) => (p.uppercase ? w.toUpperCase() : w));
		const n = words.length;
		const firstAt = 150;
		const lastAt = firstAt + (n - 1) * p.staggerMs;
		const D = p.durationMs ?? Math.max(3000, lastAt + 2600);
		const out = D - 700;
		const font = t.display === "serif" ? "serif" : "display";
		const weight = font === "serif" ? 400 : 700;
		// Tight tracking, in proportion to the size (so widths scale with it).
		const widths = (s: number) =>
			words.map((w) => textWidth(w + p.mark, s, font, -0.01 * s, weight));
		const room = f.W - 2 * f.m;
		const ruleGap = 70 * f.u;
		let size: number;
		if (p.layout === "stack") {
			const byWidth = room / Math.max(...widths(1));
			const byHeight = (f.H - 2 * f.m - ruleGap) / (n * 1.02);
			size = Math.min(260 * f.u, byWidth, byHeight);
		} else {
			const gap = 0.3;
			const total = widths(1).reduce((a, b) => a + b, 0) + gap * (n - 1);
			size = Math.min(220 * f.u, room / total);
		}
		const lh = size * 1.02;
		const tracking = -0.01 * size;
		const slam = (at: number) => ({
			scale: [
				[at, 2.4, "outExpo"],
				[at + 280, 1],
			] as Key[],
			opacity: [
				[at, 0],
				[at + 50, 1],
			] as Key[],
			blur: [
				[at, 30 * f.u, "outCubic"],
				[at + 220, 0],
			] as Key[],
		});
		const times = words.map((_, i) => firstAt + i * p.staggerMs);
		const layers: MotionLayer[] = times.map((at) => ({
			type: "rect",
			name: "Flash",
			width: f.W,
			height: f.H,
			fill: t.accent,
			opacity: 0,
			keys: {
				opacity: [
					[at, 0, "linear"],
					[at + 40, 0.14, "outCubic"],
					[at + 320, 0],
				],
			},
		}));
		const kids: MotionLayer[] = [];
		let ruleY: number;
		let ruleW: number;
		if (p.layout === "stack") {
			const top = f.H / 2 - (n * lh + ruleGap) / 2 + lh / 2;
			words.forEach((w, i) => {
				kids.push({
					type: "text",
					name: `Word ${i + 1}`,
					runs: [{ text: w }, ...(p.mark ? [{ text: p.mark, color: t.accent }] : [])],
					font,
					weight,
					size,
					tracking,
					align: "center",
					x: f.W / 2,
					y: top + i * lh,
					color: t.text,
					keys: slam(times[i]),
					exit: {
						preset: "rise",
						atMs: out + i * 70,
						durationMs: 450,
						amount: 90 * f.u,
						ease: "inCubic",
					},
				});
			});
			ruleY = top + (n - 1) * lh + lh / 2 + ruleGap / 2;
			ruleW = Math.min(room, Math.max(...widths(size)) * 0.8);
		} else {
			kids.push({
				type: "text",
				name: "Words",
				runs: words.flatMap((w, i) => [
					{ text: w, keys: slam(times[i]) },
					{
						text: `${p.mark}${i < n - 1 ? " " : ""}`,
						color: t.accent,
						keys: slam(times[i]),
					},
				]),
				font,
				weight,
				size,
				tracking,
				align: "center",
				x: f.W / 2,
				y: f.H / 2 - ruleGap / 2,
				color: t.text,
				exit: { preset: "rise", atMs: out, durationMs: 450, amount: 90 * f.u, ease: "inCubic" },
			});
			ruleY = f.H / 2 + size / 2 + ruleGap / 4;
			ruleW = Math.min(room, widths(size).reduce((a, b) => a + b, 0) * 0.6);
		}
		const shake: Key[] = [[0, f.W / 2]];
		for (const at of times)
			shake.push(
				[at + 60, f.W / 2, "linear"],
				[at + 100, f.W / 2 + 16 * f.u, "linear"],
				[at + 140, f.W / 2 - 12 * f.u, "linear"],
				[at + 180, f.W / 2 + 8 * f.u, "linear"],
				[at + 230, f.W / 2],
			);
		layers.push(
			{
				type: "group",
				name: "Words",
				pivot: [f.W / 2, f.H / 2],
				keys: { x: shake },
				layers: kids,
			},
			{
				type: "rect",
				name: "Rule",
				x: f.W / 2 - ruleW / 2,
				y: ruleY,
				origin: "left",
				width: ruleW,
				height: 10 * f.u,
				fill: t.accent,
				enter: { preset: "grow", atMs: lastAt + 450, durationMs: 700 },
				exit: { preset: "fade", atMs: out + 100, durationMs: 300 },
			},
		);
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			...(p.backdrop === "full" ? { background: t.bg } : {}),
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers,
		};
	},
});

const place = z.object({
	label: z.string().max(40),
	/** A second line under the name, e.g. coordinates or a date. */
	detail: z.string().max(40).default(""),
	/** Where on the frame, as shares (0–1). */
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1),
});

const routeMap = template({
	id: "route-map",
	name: "Route map",
	category: "map",
	description:
		"A journey between two places on a map-style grid: the start pin drops, a dotted route draws across with a travelling dot, the destination pin lands and a distance label pops at the top of the arc.",
	overlay: false,
	params: z.object({
		...common,
		from: place,
		to: place,
		/** Shown in a chip over the middle of the route, e.g. "577 km". */
		distance: z.string().max(24).default(""),
		/** How much the route bows upwards (0 = straight, negative bows down). */
		bend: z.number().min(-1).max(1).default(0.45),
		/** Seconds the route takes to draw. */
		travelMs: z.number().min(500).max(20000).default(1800),
		backdrop: z.enum(["full", "none"]).default("full"),
	}),
	example: {
		from: { label: "Amsterdam", detail: "52.37° N  4.90° E", x: 0.23, y: 0.65 },
		to: { label: "Berlin", detail: "52.52° N  13.40° E", x: 0.77, y: 0.52 },
		distance: "577 km",
		theme: "midnight",
	},
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const travelAt = 900;
		const arrive = travelAt + p.travelMs;
		const D = p.durationMs ?? Math.max(4500, arrive + 3300);
		const out = D - 700;
		const A: [number, number] = [p.from.x * f.W, p.from.y * f.H];
		const B: [number, number] = [p.to.x * f.W, p.to.y * f.H];
		const span = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
		// The route bows sideways from the straight line, towards the top of the frame.
		let normal: [number, number] = [(A[1] - B[1]) / span, (B[0] - A[0]) / span];
		if (normal[1] > 0 || (normal[1] === 0 && normal[0] < 0)) normal = [-normal[0], -normal[1]];
		const bow = p.bend * span * 0.25;
		const mid: [number, number] = [
			(A[0] + B[0]) / 2 + normal[0] * bow,
			(A[1] + B[1]) / 2 + normal[1] * bow,
		];
		// An even arc: points along a quadratic curve whose top is mid.
		const control = [2 * mid[0] - (A[0] + B[0]) / 2, 2 * mid[1] - (A[1] + B[1]) / 2];
		const route: [number, number][] = Array.from({ length: 9 }, (_, i) => {
			const k = i / 8;
			return [
				(1 - k) ** 2 * A[0] + 2 * (1 - k) * k * control[0] + k * k * B[0],
				(1 - k) ** 2 * A[1] + 2 * (1 - k) * k * control[1] + k * k * B[1],
			];
		});
		const exit = (d = 400) => ({ preset: "fade" as const, atMs: out, durationMs: d });
		const layers: MotionLayer[] = [];
		if (p.backdrop === "full") {
			const step = 120 * f.u;
			for (let y = step * 1.5, i = 0; y < f.H; y += step, i++)
				layers.push({
					type: "line",
					name: `Latitude ${i + 1}`,
					points: [
						[0, y],
						[f.W, y],
					],
					stroke: `${t.text}1c`,
					strokeWidth: 2 * f.u,
					dash: [2 * f.u, 10 * f.u],
					enter: { preset: "fade", atMs: i * 40, durationMs: 600 },
					exit: exit(),
				});
			for (let x = step, i = 0; x < f.W; x += step * 1.33, i++)
				layers.push({
					type: "line",
					name: `Longitude ${i + 1}`,
					points: [
						[x, 0],
						[x, f.H],
					],
					stroke: `${t.text}1c`,
					strokeWidth: 2 * f.u,
					dash: [2 * f.u, 10 * f.u],
					enter: { preset: "fade", atMs: i * 30, durationMs: 600 },
					exit: exit(),
				});
			const reach = Math.max(f.W, f.H);
			layers.push({
				type: "ellipse",
				name: "Vignette",
				width: reach * 1.6,
				height: reach * 1.6,
				fill: null,
				gradient: {
					kind: "radial",
					from: [0, 0],
					to: [reach * 0.8, 0],
					stops: [
						[0.5, `${t.bg}00`],
						[1, `${t.bg}ff`],
					],
				},
			});
		}
		layers.push(
			{
				type: "line",
				name: "Route",
				points: route,
				smooth: true,
				stroke: t.accent,
				strokeWidth: 7 * f.u,
				cap: "round",
				dash: [0.1, 20 * f.u],
				enter: { preset: "draw", atMs: travelAt, durationMs: p.travelMs, ease: "inOutCubic" },
				exit: exit(),
			},
			{
				type: "ellipse",
				name: "Traveller glow",
				width: 60 * f.u,
				height: 60 * f.u,
				fill: `${t.accent}40`,
				startMs: travelAt,
				endMs: arrive + 50,
				follow: { line: "Route", atMs: travelAt, durationMs: p.travelMs, ease: "inOutCubic" },
			},
			{
				type: "ellipse",
				name: "Traveller",
				width: 22 * f.u,
				height: 22 * f.u,
				fill: t.accent,
				stroke: t.bg,
				strokeWidth: 4 * f.u,
				startMs: travelAt,
				endMs: arrive + 50,
				follow: { line: "Route", atMs: travelAt, durationMs: p.travelMs, ease: "inOutCubic" },
			},
		);
		const pinScale = 1.35 * f.u;
		const pin = "M 0 0 C -6 -14 -24 -26 -24 -44 A 24 24 0 1 1 24 -44 C 24 -26 6 -14 0 0 Z";
		const places: [z.output<typeof place>, [number, number], string, number][] = [
			[p.from, A, t.text, 200],
			[p.to, B, t.accent, arrive - 50],
		];
		places.forEach(([pl, [x, y], color, at], i) => {
			const name = i === 0 ? "From" : "To";
			layers.push(
				{
					type: "ellipse",
					name: `${name} shadow`,
					x,
					y,
					width: 36 * f.u,
					height: 10 * f.u,
					fill: "#00000066",
					enter: { preset: "pop", atMs: at, durationMs: 500 },
					exit: exit(),
				},
				{
					type: "path",
					name: `${name} pin`,
					x,
					y,
					scale: pinScale,
					d: pin,
					fill: color,
					shadow: { opacity: 0.4, distance: 6 * f.u, blur: 14 * f.u },
					enter: { preset: "pop", atMs: at, durationMs: 550, amount: 0 },
					exit: exit(),
				},
				{
					type: "ellipse",
					name: `${name} hole`,
					x,
					y: y - 44 * pinScale,
					width: 18 * pinScale,
					height: 18 * pinScale,
					fill: t.bg,
					enter: { preset: "pop", atMs: at + 80, durationMs: 450, amount: 0 },
					exit: exit(),
				},
				{
					type: "text",
					name: `${name} name`,
					text: pl.label,
					uppercase: true,
					x,
					y: y + 50 * f.u,
					size: 40 * f.u,
					weight: 800,
					tracking: 4 * f.u,
					align: "center",
					color: t.text,
					clip: { x: x - f.W / 2, y: y + 18 * f.u, width: f.W, height: 64 * f.u },
					enter: { preset: "rise", atMs: at + 150, durationMs: 700, amount: 64 * f.u },
					exit: exit(300),
				},
			);
			if (pl.detail)
				layers.push({
					type: "text",
					name: `${name} detail`,
					text: pl.detail,
					font: "mono",
					weight: 500,
					x,
					y: y + 94 * f.u,
					size: 20 * f.u,
					align: "center",
					color: t.muted,
					enter: { preset: "fade", atMs: at + 350, durationMs: 500 },
					exit: exit(300),
				});
		});
		if (p.distance) {
			const size = 26 * f.u;
			const w = textWidth(p.distance.toUpperCase(), size, "sans", 2 * f.u, 800) + 60 * f.u;
			const h = 52 * f.u;
			// The chip sits just off the top of the route's arc, on the side it bows to.
			const side = p.bend >= 0 ? 1 : -1;
			const off = 18 * f.u + (Math.abs(normal[0]) * w) / 2 + (Math.abs(normal[1]) * h) / 2;
			const chipX = mid[0] + normal[0] * off * side;
			const chipY = mid[1] + normal[1] * off * side;
			layers.push(
				{
					type: "rect",
					name: "Distance chip",
					x: chipX,
					y: chipY,
					width: w,
					height: h,
					radius: 26 * f.u,
					fill: t.surface,
					stroke: `${t.accent}88`,
					strokeWidth: 2 * f.u,
					enter: { preset: "pop", atMs: travelAt + p.travelMs * 0.5, durationMs: 500 },
					exit: exit(),
				},
				{
					type: "text",
					name: "Distance",
					text: p.distance,
					uppercase: true,
					x: chipX,
					y: chipY,
					size,
					weight: 800,
					tracking: 2 * f.u,
					align: "center",
					color: t.text,
					enter: { preset: "fade", atMs: travelAt + p.travelMs * 0.5 + 100, durationMs: 400 },
					exit: exit(300),
				},
			);
		}
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			...(p.backdrop === "full" ? { background: t.bg } : {}),
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers,
		};
	},
});

const progressBar = template({
	id: "progress-bar",
	name: "Chapter progress",
	category: "overlay",
	description:
		"Where the viewer is in the video: a bar split into chapters along the top (or bottom) edge, the chapters done filled, the current one filling, with its number and title beside it.",
	overlay: true,
	params: z.object({
		...common,
		chapters: z.number().int().min(2).max(12).default(5),
		current: z.number().int().min(1).max(12).default(2),
		/** The current chapter's title. */
		title: z.string().max(60).default(""),
		/** How far the current chapter fills (0–1). */
		within: z.number().min(0).max(1).default(1),
		/** The small label; {current} and {chapters} are filled in. */
		label: z.string().max(40).default("Chapter {current} of {chapters}"),
		edge: z.enum(["top", "bottom"]).default("top"),
		/** A soft shade behind the bar, so it reads over bright footage. */
		shade: z.boolean().default(true),
	}),
	example: { chapters: 5, current: 2, title: "Designing the prototype", theme: "sunset" },
	build: (p, c) => {
		const f = frameOf(c.width, c.height);
		const t = themeOf(p.theme, p.colors);
		const D = p.durationMs ?? 5000;
		const out = D - 700;
		const n = p.chapters;
		const current = Math.min(p.current, n);
		const gap = 10 * f.u;
		const barH = 8 * f.u;
		const seg = (f.W - 2 * f.m - gap * (n - 1)) / n;
		const top = p.edge === "top";
		const barY = top ? f.m : f.H - f.m;
		const textY = top ? barY + 44 * f.u : barY - 44 * f.u;
		const exit = (d = 400) => ({ preset: "fade" as const, atMs: out, durationMs: d });
		const layers: MotionLayer[] = [];
		if (p.shade)
			layers.push({
				type: "rect",
				name: "Shade",
				x: f.W / 2,
				y: top ? 0 : f.H,
				origin: top ? "top" : "bottom",
				width: f.W,
				height: f.m + 140 * f.u,
				gradient: {
					kind: "linear",
					from: [0, top ? -(f.m + 140 * f.u) / 2 : (f.m + 140 * f.u) / 2],
					to: [0, top ? (f.m + 140 * f.u) / 2 : -(f.m + 140 * f.u) / 2],
					stops: [
						[0, "#00000080"],
						[1, "#00000000"],
					],
				},
				enter: { preset: "fade", atMs: 0, durationMs: 500 },
				exit: exit(),
			});
		for (let i = 0; i < n; i++) {
			const x = f.m + i * (seg + gap);
			layers.push({
				type: "rect",
				name: `Chapter ${i + 1}`,
				x,
				y: barY,
				origin: "left",
				width: seg,
				height: barH,
				radius: barH / 2,
				fill: `${t.text}40`,
				enter: { preset: "grow", atMs: 100 + i * 70, durationMs: 600 },
				exit: exit(),
			});
		}
		for (let i = 0; i < current; i++) {
			const x = f.m + i * (seg + gap);
			const last = i === current - 1;
			const at = 500 + i * 250;
			const w = last ? Math.max(barH, seg * p.within) : seg;
			layers.push({
				type: "rect",
				name: `Done ${i + 1}`,
				x,
				y: barY,
				origin: "left",
				width: w,
				height: barH,
				radius: barH / 2,
				fill: t.accent,
				keys: {
					width: [
						[at, 0, "outCubic"],
						[last ? at + 1100 : at + 500, w],
					],
				},
				exit: exit(),
			});
		}
		const label = p.label
			.replace("{current}", String(current))
			.replace("{chapters}", String(n))
			.toUpperCase();
		layers.push({
			type: "text",
			name: "Label",
			runs: [
				{ text: label, color: t.accent, weight: 800 },
				...(p.title ? [{ text: `   ${p.title}`, weight: 400 }] : []),
			],
			x: f.m,
			y: textY,
			size: 24 * f.u,
			tracking: 1 * f.u,
			color: t.text,
			enter: { preset: top ? "fall" : "rise", atMs: 700, durationMs: 600, amount: 16 * f.u },
			exit: exit(300),
		});
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			durationMs: D,
			markers: [{ name: "outro", atMs: out, durationMs: 700 }],
			layers,
		};
	},
});

export const MOTION_TEMPLATES: MotionTemplate[] = [
	lowerThird,
	titleCard,
	barChart,
	donutChart,
	lineChart,
	bigStat,
	statRow,
	callout,
	timeline,
	checklist,
	quote,
	kineticWords,
	subscribe,
	progressBar,
	routeMap,
	panelsTransition,
	irisTransition,
	stripesTransition,
	blocksTransition,
];

export function motionTemplate(id: string): MotionTemplate {
	const t = MOTION_TEMPLATES.find((x) => x.id === id);
	if (!t)
		throw new Error(
			`No motion template "${id}". Templates: ${MOTION_TEMPLATES.map((x) => x.id).join(", ")}.`,
		);
	return t;
}

/** Builds a template's spec from its parameters (checked, with defaults filled in). */
export function buildTemplate(
	id: string,
	params: Record<string, unknown>,
	canvas: { width: number; height: number; fps: number },
): MotionSpec {
	const t = motionTemplate(id);
	const parsed = t.params.safeParse(params);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new Error(`${t.name}: ${issue.path.join(".") || "params"}: ${issue.message}`);
	}
	return { name: t.name, ...t.build(parsed.data as never, canvas) };
}

/** A short description of a template's parameters, for agents. */
export function describeParams(t: MotionTemplate): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, schema] of Object.entries(t.params.shape)) {
		const json = z.toJSONSchema(schema as z.ZodType, { unrepresentable: "any" }) as Record<
			string,
			unknown
		>;
		const type =
			(json.enum as unknown[] | undefined)?.map((v) => JSON.stringify(v)).join(" | ") ??
			(json.type === "array" ? "array" : String(json.type ?? "object"));
		const def = json.default !== undefined ? ` (default ${JSON.stringify(json.default)})` : "";
		const optional = (schema as z.ZodType).safeParse(undefined).success ? "" : " (required)";
		out[key] = `${type}${def}${optional}`;
	}
	return out;
}
