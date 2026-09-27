import { z } from "zod";
import type { LottieJson } from "./motion";
import { FONT_METRICS, METRIC_CHARS } from "./motionFontMetrics";

/**
 * Motion specs: a compact way for people and agents to describe a motion graphic
 * (shapes, text, charts, reveals, counters, transitions), compiled to a Lottie
 * animation that Cue plays like any After Effects export. Positions are canvas
 * pixels, times are milliseconds, and layers are listed bottom to top.
 */

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

/** Cubic-bezier handles [x1, y1, x2, y2] (CSS cubic-bezier). */
export const EASES = {
	linear: [0, 0, 1, 1],
	ease: [0.25, 0.1, 0.25, 1],
	in: [0.42, 0, 1, 1],
	out: [0, 0, 0.58, 1],
	inOut: [0.42, 0, 0.58, 1],
	outCubic: [0.33, 1, 0.68, 1],
	inCubic: [0.32, 0, 0.67, 0],
	inOutCubic: [0.65, 0, 0.35, 1],
	outQuint: [0.22, 1, 0.36, 1],
	outExpo: [0.16, 1, 0.3, 1],
	inExpo: [0.7, 0, 0.84, 0],
	inOutExpo: [0.87, 0, 0.13, 1],
	outBack: [0.34, 1.56, 0.64, 1],
	inBack: [0.36, 0, 0.66, -0.56],
	inOutBack: [0.68, -0.6, 0.32, 1.6],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type EaseName = keyof typeof EASES | "hold";
const easeNames = [...Object.keys(EASES), "hold"] as unknown as [EaseName, ...EaseName[]];
const easeSchema = z.union([
	z.enum(easeNames),
	z.tuple([z.number(), z.number(), z.number(), z.number()]),
]);
export type Ease = z.infer<typeof easeSchema>;

function handles(ease: Ease | undefined): readonly [number, number, number, number] {
	if (!ease || ease === "hold") return EASES.linear;
	return typeof ease === "string" ? EASES[ease] : ease;
}

/** The value of an ease at progress t (0–1), for things computed here (counters, typing). */
export function easeAt(ease: Ease | undefined, t: number): number {
	if (ease === "hold") return t < 1 ? 0 : 1;
	const [x1, y1, x2, y2] = handles(ease);
	const bez = (a: number, b: number, s: number) =>
		3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 30; i++) {
		const mid = (lo + hi) / 2;
		if (bez(x1, x2, mid) < t) lo = mid;
		else hi = mid;
	}
	return bez(y1, y2, (lo + hi) / 2);
}

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

const hex = z
	.string()
	.regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Colours are #rrggbb or #rrggbbaa.");
/** A keyframe: [ms, value, ease into the next key]. Colour keys use hex values. */
const key = z.tuple([z.number().min(0), z.union([z.number(), hex])]).rest(easeSchema);
const keys = z.array(key).min(1).max(600);

export const MOTION_PRESETS = [
	"fade",
	"rise",
	"fall",
	"slideLeft",
	"slideRight",
	"grow",
	"pop",
	"draw",
	"type",
	"blur",
	"spin",
] as const;
const motion = z.object({
	preset: z.enum(MOTION_PRESETS),
	atMs: z.number().min(0),
	durationMs: z.number().min(1).max(60000).optional(),
	ease: easeSchema.optional(),
	/** Pixels for rise, fall and slides; degrees for spin; the start scale for grow and pop. */
	amount: z.number().optional(),
});
export type MotionPreset = z.infer<typeof motion>;

const gradient = z.object({
	kind: z.enum(["linear", "radial"]).default("linear"),
	/** Start and end points, in pixels relative to the shape's centre. */
	from: z.tuple([z.number(), z.number()]),
	to: z.tuple([z.number(), z.number()]),
	stops: z
		.array(z.tuple([z.number().min(0).max(1), hex]))
		.min(2)
		.max(8),
});

const shadow = z.object({
	color: hex.default("#000000"),
	opacity: z.number().min(0).max(1).default(0.35),
	distance: z.number().min(0).max(400).default(12),
	blur: z.number().min(0).max(400).default(30),
	/** Direction the shadow falls, degrees (180 = straight down). */
	angle: z.number().default(180),
});

const base = {
	name: z.string().max(80).optional(),
	x: z.number().optional(),
	y: z.number().optional(),
	/** 1 = 100%; [x, y] scales the axes separately. */
	scale: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
	rotation: z.number().optional(),
	opacity: z.number().min(0).max(1).optional(),
	startMs: z.number().min(0).optional(),
	endMs: z.number().min(0).optional(),
	keys: z
		.object({
			x: keys,
			y: keys,
			scale: keys,
			scaleX: keys,
			scaleY: keys,
			rotation: keys,
			opacity: keys,
			width: keys,
			height: keys,
			trimStart: keys,
			trimEnd: keys,
			color: keys,
			blur: keys,
		})
		.partial()
		.optional(),
	enter: z.union([motion, z.array(motion).max(6)]).optional(),
	exit: z.union([motion, z.array(motion).max(6)]).optional(),
	/** Only what is inside this canvas rectangle shows (a track matte): text rising out of a line. */
	clip: z
		.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
		.optional(),
	blend: z.enum(["normal", "multiply", "screen", "overlay", "add", "darken", "lighten"]).optional(),
	shadow: shadow.optional(),
	blur: z.number().min(0).max(400).optional(),
	/**
	 * Travels along a route (a motion path): canvas points, or the points of a line
	 * layer by name (so a dot rides a route as it draws). Sets x and y (and rotation
	 * with orient) over the time given.
	 */
	follow: z
		.object({
			points: z
				.array(z.tuple([z.number(), z.number()]))
				.min(2)
				.max(400)
				.optional(),
			line: z.string().max(80).optional(),
			smooth: z.boolean().optional(),
			atMs: z.number().min(0),
			durationMs: z.number().min(1).max(60000),
			ease: easeSchema.optional(),
			/** Turn to face the way it travels (added to rotation). */
			orient: z.boolean().optional(),
		})
		.refine((f) => f.points || f.line, "Give follow points or the name of a line layer.")
		.optional(),
};

const paint = {
	fill: hex.nullable().optional(),
	stroke: hex.nullable().optional(),
	strokeWidth: z.number().min(0).max(20000).optional(),
	gradient: gradient.optional(),
	/** Round line ends and joins. */
	cap: z.enum(["round", "butt", "square"]).optional(),
	dash: z.array(z.number().min(0)).max(4).optional(),
};

const ORIGINS = [
	"center",
	"left",
	"right",
	"top",
	"bottom",
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
] as const;

const rect = z.object({
	type: z.literal("rect"),
	...base,
	...paint,
	width: z.number().min(0),
	height: z.number().min(0),
	radius: z.number().min(0).optional(),
	/** Which point of the rectangle x, y is; growing and scaling happen from there. */
	origin: z.enum(ORIGINS).optional(),
});
const ellipse = z.object({
	type: z.literal("ellipse"),
	...base,
	...paint,
	width: z.number().min(0),
	height: z.number().min(0),
});
/** A ring segment (donut charts, progress rings): 0 is 12 o'clock, going clockwise, in turns (0–1). */
const arc = z.object({
	type: z.literal("arc"),
	...base,
	radius: z.number().min(1),
	thickness: z.number().min(0.5),
	from: z.number().min(0).max(1).default(0),
	to: z.number().min(0).max(1).default(1),
	color: hex,
	cap: z.enum(["round", "butt"]).optional(),
});
const line = z.object({
	type: z.literal("line"),
	...base,
	...paint,
	/** Canvas points; with x, y set they are relative to that point. */
	points: z
		.array(z.tuple([z.number(), z.number()]))
		.min(2)
		.max(400),
	/** Round the corners into a smooth curve. */
	smooth: z.boolean().optional(),
	closed: z.boolean().optional(),
});
const pathShape = z.object({
	type: z.literal("path"),
	...base,
	...paint,
	/** SVG path data (M, L, H, V, C, S, Q, A, Z; absolute or relative), in canvas pixels. */
	d: z.string().max(20000),
});
const FONT_FAMILIES = ["sans", "display", "serif", "mono"] as const;
const text = z.object({
	type: z.literal("text"),
	...base,
	text: z.string().max(2000).default(""),
	font: z.enum(FONT_FAMILIES).default("sans"),
	weight: z.number().min(100).max(900).default(600),
	size: z.number().min(4).max(1000),
	color: hex.default("#ffffff"),
	align: z.enum(["left", "center", "right"]).default("left"),
	/** Letter spacing, in pixels. */
	tracking: z.number().min(-50).max(200).optional(),
	/** Line height as a multiple of the size. */
	lineHeight: z.number().min(0.5).max(3).optional(),
	uppercase: z.boolean().optional(),
	/** x, y is the middle of the text block (default), or the first line's baseline. */
	anchor: z.enum(["middle", "baseline", "top"]).optional(),
	/**
	 * One line in parts, side by side on one baseline: each part can have its own
	 * colour, weight, font and motion (a word that pops in, an accent full stop).
	 * The layer's text is then ignored; its size, tracking, align and motion apply to all.
	 */
	runs: z
		.array(
			z.object({
				text: z.string().max(400),
				color: hex.optional(),
				font: z.enum(FONT_FAMILIES).optional(),
				weight: z.number().min(100).max(900).optional(),
				opacity: z.number().min(0).max(1).optional(),
				startMs: z.number().min(0).optional(),
				endMs: z.number().min(0).optional(),
				keys: base.keys,
				enter: base.enter,
				exit: base.exit,
			}),
		)
		.min(1)
		.max(40)
		.optional(),
	/** Counts a number up: the text shows prefix + value + suffix. */
	count: z
		.object({
			from: z.number(),
			to: z.number(),
			atMs: z.number().min(0),
			durationMs: z.number().min(1),
			decimals: z.number().int().min(0).max(4).optional(),
			prefix: z.string().max(20).optional(),
			suffix: z.string().max(20).optional(),
			ease: easeSchema.optional(),
			/** Thousands separator, e.g. ",". */
			separator: z.string().max(2).optional(),
		})
		.optional(),
});
const image = z.object({
	type: z.literal("image"),
	...base,
	/** A file path or data: URL (PNG, JPEG, SVG); files are embedded when compiled. */
	src: z.string().max(4_000_000),
	width: z.number().min(1),
	height: z.number().min(1),
});

/** A layer as written (defaults may be left out). */
export type MotionLayer =
	| z.input<typeof rect>
	| z.input<typeof ellipse>
	| z.input<typeof arc>
	| z.input<typeof line>
	| z.input<typeof pathShape>
	| z.input<typeof text>
	| z.input<typeof image>
	| (z.input<typeof groupBase> & { type: "group"; layers: MotionLayer[] });
/** A layer after checking (defaults filled in). */
type Layer =
	| z.output<typeof rect>
	| z.output<typeof ellipse>
	| z.output<typeof arc>
	| z.output<typeof line>
	| z.output<typeof pathShape>
	| z.output<typeof text>
	| z.output<typeof image>
	| MotionGroup;
type MotionGroup = z.output<typeof groupBase> & { type: "group"; layers: Layer[] };
const groupBase = z.object({
	...base,
	/** The point it scales and turns around (default: the canvas centre). */
	pivot: z.tuple([z.number(), z.number()]).optional(),
});
const layer: z.ZodType<Layer, MotionLayer> = z.lazy(() =>
	z.discriminatedUnion("type", [
		rect,
		ellipse,
		arc,
		line,
		pathShape,
		text,
		image,
		groupBase.extend({ type: z.literal("group"), layers: z.array(layer).max(400) }),
	]),
) as unknown as z.ZodType<Layer, MotionLayer>;

export const motionSpecSchema = z.object({
	name: z.string().max(120).optional(),
	width: z.number().int().min(16).max(7680).default(1920),
	height: z.number().int().min(16).max(7680).default(1080),
	fps: z.number().min(1).max(120).default(30),
	durationMs: z.number().min(100).max(600000),
	background: hex.optional(),
	layers: z.array(layer).max(600),
	/** Named points: "outro" makes longer clips hold before it; "cut" is where a transition covers the frame. */
	markers: z
		.array(
			z.object({
				name: z.string().max(40),
				atMs: z.number().min(0),
				durationMs: z.number().min(0).default(0),
			}),
		)
		.max(20)
		.optional(),
});
export type MotionSpec = z.input<typeof motionSpecSchema>;
type Spec = z.output<typeof motionSpecSchema>;

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/** Fonts bundled with Cue (SIL Open Font License), by family and weight. */
export const MOTION_FONTS: {
	family: (typeof FONT_FAMILIES)[number];
	name: string;
	weight: number;
	face: string;
}[] = [
	{ family: "sans", name: "Inter-400", weight: 400, face: "Inter" },
	{ family: "sans", name: "Inter-600", weight: 600, face: "Inter" },
	{ family: "sans", name: "Inter-800", weight: 800, face: "Inter" },
	{ family: "display", name: "SpaceGrotesk-500", weight: 500, face: "Space Grotesk" },
	{ family: "display", name: "SpaceGrotesk-700", weight: 700, face: "Space Grotesk" },
	{ family: "serif", name: "InstrumentSerif-400", weight: 400, face: "Instrument Serif" },
	{ family: "mono", name: "JetBrainsMono-500", weight: 500, face: "JetBrains Mono" },
];

function fontFor(family: (typeof FONT_FAMILIES)[number], weight: number) {
	const options = MOTION_FONTS.filter((f) => f.family === family);
	return options.reduce((best, f) =>
		Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best,
	);
}

/** Rough advance widths (share of the size) for characters the fonts do not have. */
const AVERAGE_WIDTH: Record<string, number> = { sans: 0.56, display: 0.58, serif: 0.46, mono: 0.6 };

/**
 * How wide a line (the widest line, for several) of text is, in pixels, from
 * the bundled fonts' own advance widths. Kerning is left out, so it can be a
 * little wider than drawn. Templates use it for layout; specs for runs and boxes.
 */
export function textWidth(
	value: string,
	size: number,
	font: (typeof FONT_FAMILIES)[number] = "sans",
	tracking = 0,
	weight = 600,
) {
	const metrics = FONT_METRICS[fontFor(font, weight).name];
	const widest = Math.max(
		0,
		...value.split("\n").map((line) => {
			let em = 0;
			for (const ch of line) {
				const at = METRIC_CHARS.indexOf(ch);
				const w = at >= 0 ? (metrics?.widths[at] ?? -1) : -1;
				em += w >= 0 ? w / 1000 : AVERAGE_WIDTH[font];
			}
			return em * size + [...line].length * tracking;
		}),
	);
	return widest;
}

/** The cap height of a family at a weight, as a share of the size. */
function capHeight(font: (typeof FONT_FAMILIES)[number], weight: number) {
	return (FONT_METRICS[fontFor(font, weight).name]?.cap ?? 720) / 1000;
}

// ---------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------

type Prop = { a: 0; k: number | number[] } | { a: 1; k: LottieJson[] };

function rgba(color: string): [number, number, number, number] {
	const n = color.slice(1);
	const c = (i: number) => Number.parseInt(n.slice(i, i + 2), 16) / 255;
	return [c(0), c(2), c(4), n.length === 8 ? c(6) : 1];
}

interface Track {
	/** [frame, value, ease] */
	keys: [number, number[], Ease | undefined][];
}

/** Collects animated values per property while a layer is compiled. */
class Timeline {
	tracks = new Map<string, Track>();
	constructor(readonly fps: number) {}
	frame(ms: number) {
		return (ms / 1000) * this.fps;
	}
	add(prop: string, ms: number, value: number[], ease?: Ease) {
		let t = this.tracks.get(prop);
		if (!t) {
			t = { keys: [] };
			this.tracks.set(prop, t);
		}
		const f = this.frame(ms);
		t.keys = t.keys.filter((k) => Math.abs(k[0] - f) > 1e-6);
		t.keys.push([f, value, ease]);
		t.keys.sort((a, b) => a[0] - b[0]);
	}
	has(prop: string) {
		return this.tracks.has(prop);
	}
	/** A Lottie property: static when never animated. */
	prop(name: string, fallback: number[] | number): Prop {
		const t = this.tracks.get(name);
		if (!t || t.keys.length === 0) return { a: 0, k: fallback };
		if (t.keys.length === 1) return { a: 0, k: unwrap(t.keys[0][1], fallback) };
		return {
			a: 1,
			k: t.keys.map(([f, v, ease], i) => {
				const last = i === t.keys.length - 1;
				if (last) return { t: f, s: v };
				const [x1, y1, x2, y2] = handles(ease);
				return {
					t: f,
					s: v,
					...(ease === "hold" ? { h: 1 } : {}),
					o: { x: [x1], y: [y1] },
					i: { x: [x2], y: [y2] },
				};
			}),
		};
	}
}

const unwrap = (v: number[], like: number[] | number) => (Array.isArray(like) ? v : v[0]);

interface Context {
	spec: Spec;
	assets: LottieJson[];
	fonts: Set<string>;
	nextIndex: () => number;
	resolveImage?: (src: string) => string | null;
	chars: number;
	/** Line layers by name, as canvas points (for follow). */
	lines: Map<string, { points: [number, number][]; smooth: boolean }>;
}

/** Where a layer's own motion (enter, exit, keys) goes, with its resting values. */
interface Rest {
	x: number;
	y: number;
	sx: number;
	sy: number;
	rotation: number;
	opacity: number;
}

const PRESET_MS: Record<(typeof MOTION_PRESETS)[number], number> = {
	fade: 400,
	rise: 700,
	fall: 700,
	slideLeft: 700,
	slideRight: 700,
	grow: 800,
	pop: 550,
	draw: 1000,
	type: 1000,
	blur: 600,
	spin: 800,
};

function list<T>(v: T | T[] | undefined): T[] {
	return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/**
 * Turns enter and exit presets into keys on the timeline (without overriding
 * keys the layer sets itself). Returns extra state for text and strokes.
 */
function presets(layer: Layer, tl: Timeline, rest: Rest, growAxis: "x" | "y" | "both") {
	const out: {
		type?: { atMs: number; durationMs: number; ease?: Ease; out: boolean }[];
		draw: boolean;
	} = {
		draw: false,
	};
	// When the layer's own keys (or its route) move a property: presets leave that
	// stretch of time alone, and combine with the keys before or after it.
	const own = new Map<string, [number, number]>();
	const claim = (prop: string, from: number, to: number) => {
		const had = own.get(prop);
		own.set(prop, had ? [Math.min(had[0], from), Math.max(had[1], to)] : [from, to]);
	};
	for (const [prop, ks] of Object.entries(layer.keys ?? {})) {
		const times = (ks ?? []).map((k) => k[0]);
		claim(
			prop === "scaleX" || prop === "scaleY" ? "scale" : prop,
			Math.min(...times),
			Math.max(...times),
		);
	}
	if (layer.follow) {
		const { atMs, durationMs, orient } = layer.follow;
		for (const prop of orient ? ["x", "y", "rotation"] : ["x", "y"])
			claim(prop, atMs, atMs + durationMs);
	}
	const apply = (m: MotionPreset, entering: boolean) => {
		const d = m.durationMs ?? PRESET_MS[m.preset];
		const a = entering ? m.atMs : m.atMs;
		const b = a + d;
		const ease: Ease =
			m.ease ?? (entering ? (m.preset === "pop" ? "outBack" : "outExpo") : "inCubic");
		/** Adds a from→to move for a property, entering or leaving. */
		const move = (prop: string, away: number[], home: number[]) => {
			const taken = own.get(prop);
			if (taken && a <= taken[1] && b >= taken[0]) return;
			if (entering) {
				tl.add(prop, a, away, ease);
				tl.add(prop, b, home);
			} else {
				tl.add(prop, a, home, ease);
				tl.add(prop, b, away);
			}
		};
		const amount = m.amount;
		switch (m.preset) {
			case "fade":
				move("opacity", [0], [rest.opacity * 100]);
				break;
			case "rise":
			case "fall":
				move(
					"y",
					[rest.y + (m.preset === "rise" ? 1 : -1) * (amount ?? 60) * (entering ? 1 : -1)],
					[rest.y],
				);
				move("opacity", [0], [rest.opacity * 100]);
				break;
			case "slideLeft":
			case "slideRight":
				move(
					"x",
					[rest.x + (m.preset === "slideLeft" ? 1 : -1) * (amount ?? 120) * (entering ? 1 : -1)],
					[rest.x],
				);
				move("opacity", [0], [rest.opacity * 100]);
				break;
			case "grow": {
				const from = amount ?? 0;
				const sx = growAxis === "y" ? rest.sx : rest.sx * from;
				const sy = growAxis === "x" ? rest.sy : rest.sy * from;
				move("scale", [sx * 100, sy * 100], [rest.sx * 100, rest.sy * 100]);
				break;
			}
			case "pop": {
				const from = amount ?? 0.6;
				move("scale", [rest.sx * from * 100, rest.sy * from * 100], [rest.sx * 100, rest.sy * 100]);
				move("opacity", [0], [rest.opacity * 100]);
				break;
			}
			case "draw":
				move("trimEnd", [0], [100]);
				out.draw = true;
				break;
			case "type":
				out.type ??= [];
				out.type.push({ atMs: a, durationMs: d, ease: m.ease ?? "linear", out: !entering });
				break;
			case "blur":
				move("blur", [amount ?? 40], [0]);
				move("opacity", [0], [rest.opacity * 100]);
				break;
			case "spin":
				move("rotation", [rest.rotation + (amount ?? -90)], [rest.rotation]);
				move("opacity", [0], [rest.opacity * 100]);
				break;
		}
	};
	for (const m of list(layer.enter)) apply(m, true);
	for (const m of list(layer.exit)) apply(m, false);
	return out;
}

/** Points along a route, close enough together to measure and travel it. */
function routeSamples(points: [number, number][], smooth: boolean): [number, number][] {
	const b = polyline(points, smooth, false);
	const out: [number, number][] = [b.v[0] as [number, number]];
	for (let k = 0; k < b.v.length - 1; k++) {
		const p0 = b.v[k];
		const p3 = b.v[k + 1];
		const c1 = [p0[0] + b.o[k][0], p0[1] + b.o[k][1]];
		const c2 = [p3[0] + b.i[k + 1][0], p3[1] + b.i[k + 1][1]];
		for (let s = 1; s <= 32; s++) {
			const t = s / 32;
			const at = (a: number, b1: number, c: number, d: number) =>
				(1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b1 + 3 * (1 - t) * t * t * c + t ** 3 * d;
			out.push([at(p0[0], c1[0], c2[0], p3[0]), at(p0[1], c1[1], c2[1], p3[1])]);
		}
	}
	return out;
}

/** x, y (and rotation) keys, one per frame, that move a layer along its follow route. */
function followKeys(layer: Layer, tl: Timeline, ctx: Context) {
	const f = layer.follow;
	if (!f) return;
	const named = f.line ? ctx.lines.get(f.line) : undefined;
	if (f.line && !named) throw new Error(`Motion spec: follow: no line layer named "${f.line}".`);
	const route = routeSamples(
		named?.points ?? (f.points as [number, number][]),
		named?.smooth ?? !!f.smooth,
	);
	const lengths = [0];
	for (let i = 1; i < route.length; i++)
		lengths.push(
			lengths[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]),
		);
	const total = lengths[lengths.length - 1] || 1;
	const pointAt = (d: number) => {
		let i = 1;
		while (i < route.length - 1 && lengths[i] < d) i++;
		const span = lengths[i] - lengths[i - 1] || 1;
		const t = Math.min(1, Math.max(0, (d - lengths[i - 1]) / span));
		const [a, b] = [route[i - 1], route[i]];
		return {
			x: a[0] + (b[0] - a[0]) * t,
			y: a[1] + (b[1] - a[1]) * t,
			angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
		};
	};
	const frames = Math.max(1, Math.round((f.durationMs / 1000) * tl.fps));
	let lastAngle: number | undefined;
	for (let i = 0; i <= frames; i++) {
		const ms = f.atMs + (i / frames) * f.durationMs;
		const p = pointAt(easeAt(f.ease ?? "inOutCubic", i / frames) * total);
		tl.add("x", ms, [p.x]);
		tl.add("y", ms, [p.y]);
		if (f.orient) {
			// Turn the short way round, so the angle never jumps a full circle.
			let angle = p.angle;
			if (lastAngle !== undefined) angle += Math.round((lastAngle - angle) / 360) * 360;
			lastAngle = angle;
			tl.add("rotation", ms, [angle + (layer.rotation ?? 0)]);
		}
	}
}

/** The layer's own keys, converted to Lottie units, and its route when it follows one. */
function ownKeys(layer: Layer, tl: Timeline, ctx: Context) {
	followKeys(layer, tl, ctx);
	for (const [prop, ks] of Object.entries(layer.keys ?? {})) {
		for (const [ms, value, ease] of ks as [number, number | string, Ease?][]) {
			if (prop === "color") {
				tl.add("color", ms, rgba(String(value)).slice(0, 3), ease);
				continue;
			}
			const v = Number(value);
			const scaled =
				prop === "opacity" || prop === "trimStart" || prop === "trimEnd"
					? [v * 100]
					: prop === "scale"
						? [v * 100, v * 100]
						: [v];
			tl.add(prop, ms, scaled, ease);
		}
	}
	// Separate axis scale keys become full scale keys (the other axis stays at rest).
	for (const axis of ["scaleX", "scaleY"] as const) {
		const t = tl.tracks.get(axis);
		if (!t) continue;
		tl.tracks.delete(axis);
		const s = Array.isArray(layer.scale) ? layer.scale : [layer.scale ?? 1, layer.scale ?? 1];
		for (const [f, [v], ease] of t.keys)
			tl.add(
				"scale",
				(f / tl.fps) * 1000,
				axis === "scaleX" ? [v * 100, s[1] * 100] : [s[0] * 100, v * 100],
				ease,
			);
	}
}

function transform(tl: Timeline, rest: Rest, anchor: [number, number] = [0, 0]): LottieJson {
	return {
		a: { a: 0, k: [anchor[0], anchor[1], 0] },
		p: { s: true, x: tl.prop("x", rest.x), y: tl.prop("y", rest.y) },
		s: tl.prop("scale", [rest.sx * 100, rest.sy * 100, 100]),
		r: tl.prop("rotation", rest.rotation),
		o: tl.prop("opacity", rest.opacity * 100),
	};
}

const BLEND: Record<string, number> = {
	normal: 0,
	multiply: 1,
	screen: 2,
	overlay: 3,
	darken: 4,
	lighten: 5,
	add: 16,
};

function effects(layer: Layer, tl: Timeline): LottieJson[] | undefined {
	const out: LottieJson[] = [];
	if (layer.shadow) {
		const s = shadow.parse(layer.shadow);
		const [r, g, b] = rgba(s.color);
		out.push({
			ty: 25,
			nm: "Drop Shadow",
			en: 1,
			ef: [
				{ ty: 2, nm: "Shadow Color", v: { a: 0, k: [r, g, b, 1] } },
				{ ty: 0, nm: "Opacity", v: { a: 0, k: s.opacity * 255 } },
				{ ty: 0, nm: "Direction", v: { a: 0, k: s.angle } },
				{ ty: 0, nm: "Distance", v: { a: 0, k: s.distance } },
				{ ty: 0, nm: "Softness", v: { a: 0, k: s.blur } },
				{ ty: 7, nm: "Shadow Only", v: { a: 0, k: 0 } },
			],
		});
	}
	if (layer.blur !== undefined || tl.has("blur")) {
		out.push({
			ty: 29,
			nm: "Gaussian Blur",
			en: 1,
			ef: [
				{ ty: 0, nm: "Blurriness", v: tl.prop("blur", layer.blur ?? 0) },
				{ ty: 7, nm: "Blur Dimensions", v: { a: 0, k: 1 } },
				{ ty: 7, nm: "Repeat Edge Pixels", v: { a: 0, k: 0 } },
			],
		});
	}
	return out.length ? out : undefined;
}

function paintItems(
	shape: {
		fill?: string | null;
		stroke?: string | null;
		strokeWidth?: number;
		gradient?: z.infer<typeof gradient>;
		cap?: string;
		dash?: number[];
	},
	tl: Timeline,
	fallbackFill: string | null,
): LottieJson[] {
	const items: LottieJson[] = [];
	const caps = { butt: 1, round: 2, square: 3 } as Record<string, number>;
	if (shape.stroke) {
		const [r, g, b, a] = rgba(shape.stroke);
		items.push({
			ty: "st",
			c:
				tl.has("color") && !shape.fill && !shape.gradient
					? tl.prop("color", [r, g, b])
					: { a: 0, k: [r, g, b, 1] },
			o: { a: 0, k: a * 100 },
			w: { a: 0, k: shape.strokeWidth ?? 4 },
			lc: caps[shape.cap ?? "round"],
			lj: shape.cap === "butt" ? 1 : 2,
			ml: 4,
			...(shape.dash?.length
				? {
						d: shape.dash.map((v, i) => ({
							n: i % 2 ? "g" : "d",
							nm: i % 2 ? "gap" : "dash",
							v: { a: 0, k: v },
						})),
					}
				: {}),
		});
	}
	if (shape.gradient) {
		const g = gradient.parse(shape.gradient);
		const stops = g.stops.flatMap(([at, c]) => [at, ...rgba(c).slice(0, 3)]);
		const alphas = g.stops.flatMap(([at, c]) => [at, rgba(c)[3]]);
		items.push({
			ty: "gf",
			o: { a: 0, k: 100 },
			r: 1,
			s: { a: 0, k: g.from },
			e: { a: 0, k: g.to },
			t: g.kind === "radial" ? 2 : 1,
			g: { p: g.stops.length, k: { a: 0, k: [...stops, ...alphas] } },
		});
	} else {
		const fill = shape.fill === undefined ? fallbackFill : shape.fill;
		if (fill) {
			const [r, g, b, a] = rgba(fill);
			items.push({
				ty: "fl",
				c: tl.has("color") ? tl.prop("color", [r, g, b]) : { a: 0, k: [r, g, b, 1] },
				o: { a: 0, k: a * 100 },
				r: 1,
			});
		}
	}
	return items;
}

function trim(tl: Timeline, draw: boolean): LottieJson[] {
	if (!draw && !tl.has("trimEnd") && !tl.has("trimStart")) return [];
	return [
		{
			ty: "tm",
			s: tl.prop("trimStart", 0),
			e: tl.prop("trimEnd", 100),
			o: { a: 0, k: 0 },
			m: 1,
		},
	];
}

/** Where x, y sits on a rectangle, as an offset from its centre. */
function originOffset(
	origin: (typeof ORIGINS)[number] | undefined,
	w: number,
	h: number,
): [number, number] {
	const o = origin ?? "center";
	const dx = o.includes("left") ? w / 2 : o.includes("right") ? -w / 2 : 0;
	const dy = o.startsWith("top") ? h / 2 : o.startsWith("bottom") ? -h / 2 : 0;
	return [dx, dy];
}

function growAxisFor(origin: (typeof ORIGINS)[number] | undefined): "x" | "y" | "both" {
	if (origin === "left" || origin === "right") return "x";
	if (origin === "top" || origin === "bottom") return "y";
	return "both";
}

// --- SVG paths --------------------------------------------------------------

interface Bezier {
	v: number[][];
	i: number[][];
	o: number[][];
	c: boolean;
}

/** Parses SVG path data into Lottie bezier shapes (one per subpath). */
export function parsePath(d: string): Bezier[] {
	const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
	const out: Bezier[] = [];
	let cur: Bezier | null = null;
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	let lastCtrl: [number, number] | null = null;
	let cmd = "";
	let i = 0;
	const num = () => Number(tokens[i++]);
	const begin = (px: number, py: number) => {
		cur = { v: [[px, py]], i: [[0, 0]], o: [[0, 0]], c: false };
		out.push(cur);
		startX = px;
		startY = py;
	};
	const lineTo = (px: number, py: number) => {
		if (!cur) begin(x, y);
		(cur as Bezier).v.push([px, py]);
		(cur as Bezier).i.push([0, 0]);
		(cur as Bezier).o.push([0, 0]);
	};
	const curveTo = (c1x: number, c1y: number, c2x: number, c2y: number, px: number, py: number) => {
		if (!cur) begin(x, y);
		const b = cur as Bezier;
		const last = b.v.length - 1;
		b.o[last] = [c1x - b.v[last][0], c1y - b.v[last][1]];
		b.v.push([px, py]);
		b.i.push([c2x - px, c2y - py]);
		b.o.push([0, 0]);
	};
	while (i < tokens.length) {
		if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
		const rel = cmd === cmd.toLowerCase();
		const ox = rel ? x : 0;
		const oy = rel ? y : 0;
		switch (cmd.toUpperCase()) {
			case "M": {
				x = ox + num();
				y = oy + num();
				begin(x, y);
				cmd = rel ? "l" : "L";
				lastCtrl = null;
				break;
			}
			case "L":
				x = ox + num();
				y = oy + num();
				lineTo(x, y);
				lastCtrl = null;
				break;
			case "H":
				x = ox + num();
				lineTo(x, y);
				lastCtrl = null;
				break;
			case "V":
				y = oy + num();
				lineTo(x, y);
				lastCtrl = null;
				break;
			case "C": {
				const c1x = ox + num();
				const c1y = oy + num();
				const c2x = ox + num();
				const c2y = oy + num();
				x = ox + num();
				y = oy + num();
				curveTo(c1x, c1y, c2x, c2y, x, y);
				lastCtrl = [c2x, c2y];
				break;
			}
			case "S": {
				const c1: [number, number] = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
				const c2x = ox + num();
				const c2y = oy + num();
				x = ox + num();
				y = oy + num();
				curveTo(c1[0], c1[1], c2x, c2y, x, y);
				lastCtrl = [c2x, c2y];
				break;
			}
			case "Q": {
				const qx = ox + num();
				const qy = oy + num();
				const px = ox + num();
				const py = oy + num();
				curveTo(
					x + (2 / 3) * (qx - x),
					y + (2 / 3) * (qy - y),
					px + (2 / 3) * (qx - px),
					py + (2 / 3) * (qy - py),
					px,
					py,
				);
				x = px;
				y = py;
				lastCtrl = null;
				break;
			}
			case "A": {
				const rx = num();
				const ry = num();
				const turn = num();
				const large = num();
				const sweep = num();
				const px = ox + num();
				const py = oy + num();
				for (const c of arcCurves(x, y, rx, ry, turn, !!large, !!sweep, px, py))
					curveTo(c[0], c[1], c[2], c[3], c[4], c[5]);
				if (rx === 0 || ry === 0) lineTo(px, py);
				x = px;
				y = py;
				lastCtrl = null;
				break;
			}
			case "Z":
				if (cur) {
					const b = cur as Bezier;
					// A closing point on the start is dropped (Lottie closes the shape itself).
					const last = b.v.length - 1;
					if (last > 0 && Math.hypot(b.v[last][0] - startX, b.v[last][1] - startY) < 1e-6) {
						b.i[0] = b.i[last];
						b.v.pop();
						b.i.pop();
						b.o.pop();
					}
					b.c = true;
				}
				x = startX;
				y = startY;
				cur = null;
				lastCtrl = null;
				break;
			default:
				// Anything unknown (T): skip the command's numbers.
				i++;
		}
	}
	return out.filter((b) => b.v.length > 1);
}

/**
 * An SVG elliptical arc as cubic curves (at most a quarter turn each):
 * [c1x, c1y, c2x, c2y, x, y] per curve. Follows the SVG spec's endpoint to
 * centre conversion, including radii too small to reach the end point.
 */
function arcCurves(
	x1: number,
	y1: number,
	rx: number,
	ry: number,
	turnDeg: number,
	large: boolean,
	sweep: boolean,
	x2: number,
	y2: number,
): number[][] {
	if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [];
	rx = Math.abs(rx);
	ry = Math.abs(ry);
	const phi = (turnDeg * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);
	const dx = (x1 - x2) / 2;
	const dy = (y1 - y2) / 2;
	const x1p = cos * dx + sin * dy;
	const y1p = -sin * dx + cos * dy;
	const grow = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
	if (grow > 1) {
		rx *= Math.sqrt(grow);
		ry *= Math.sqrt(grow);
	}
	const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
	const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
	const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
	const cxp = (k * rx * y1p) / ry;
	const cyp = (-k * ry * x1p) / rx;
	const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
	const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
	const angle = (ux: number, uy: number, vx: number, vy: number) =>
		Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
	let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
	if (!sweep && dt > 0) dt -= 2 * Math.PI;
	if (sweep && dt < 0) dt += 2 * Math.PI;
	const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
	const step = dt / n;
	const h = (4 / 3) * Math.tan(step / 4);
	// A point on the unit circle, stretched to the ellipse, turned and moved to the centre.
	const place = (ux: number, uy: number) => {
		const px = rx * ux;
		const py = ry * uy;
		return [cx + cos * px - sin * py, cy + sin * px + cos * py];
	};
	const out: number[][] = [];
	for (let i = 0; i < n; i++) {
		const a = t1 + i * step;
		const b = a + step;
		const c1 = place(Math.cos(a) - h * Math.sin(a), Math.sin(a) + h * Math.cos(a));
		const c2 = place(Math.cos(b) + h * Math.sin(b), Math.sin(b) - h * Math.cos(b));
		const end = i === n - 1 ? [x2, y2] : place(Math.cos(b), Math.sin(b));
		out.push([...c1, ...c2, ...end]);
	}
	return out;
}

/** Points joined by straight lines, or smoothed into a curve through them. */
function polyline(points: [number, number][], smooth: boolean, closed: boolean): Bezier {
	const n = points.length;
	const zero = points.map(() => [0, 0]);
	if (!smooth) return { v: points, i: zero, o: zero.map((z) => [...z]), c: closed };
	const inT: number[][] = [];
	const outT: number[][] = [];
	for (let k = 0; k < n; k++) {
		const prev = points[closed ? (k - 1 + n) % n : Math.max(0, k - 1)];
		const next = points[closed ? (k + 1) % n : Math.min(n - 1, k + 1)];
		const tx = (next[0] - prev[0]) / 6;
		const ty = (next[1] - prev[1]) / 6;
		inT.push([-tx, -ty]);
		outT.push([tx, ty]);
	}
	return { v: points, i: inT, o: outT, c: closed };
}

// --- Layers -----------------------------------------------------------------

function restOf(layer: Layer, defaults: { x: number; y: number }): Rest {
	const s = layer.scale ?? 1;
	const [sx, sy] = Array.isArray(s) ? s : [s, s];
	return {
		x: layer.x ?? defaults.x,
		y: layer.y ?? defaults.y,
		sx,
		sy,
		rotation: layer.rotation ?? 0,
		opacity: layer.opacity ?? 1,
	};
}

function common(layer: Layer, ctx: Context, index: number): LottieJson {
	const fr = ctx.spec.fps;
	const end = ctx.spec.durationMs;
	return {
		ddd: 0,
		ind: index,
		nm: layer.name ?? layer.type,
		sr: 1,
		st: 0,
		ip: ((layer.startMs ?? 0) / 1000) * fr,
		op: ((Math.min(layer.endMs ?? end, end) || end) / 1000) * fr,
		bm: BLEND[layer.blend ?? "normal"],
	};
}

function shapeLayer(
	layer: Exclude<Layer, { type: "text" | "image" | "group" }>,
	ctx: Context,
): LottieJson {
	const tl = new Timeline(ctx.spec.fps);
	ownKeys(layer, tl, ctx);
	const W = ctx.spec.width;
	const H = ctx.spec.height;
	let items: LottieJson[] = [];
	let rest: Rest;
	let draw = false;
	if (layer.type === "rect") {
		rest = restOf(layer, { x: W / 2, y: H / 2 });
		const [dx, dy] = originOffset(layer.origin, layer.width, layer.height);
		const p = presets(layer, tl, rest, growAxisFor(layer.origin));
		draw = p.draw;
		// Width and height keys keep the origin edge in place.
		const size = tl.has("width") || tl.has("height");
		const wKeys = tl.tracks.get("width")?.keys;
		const hKeys = tl.tracks.get("height")?.keys;
		let sizeProp: Prop = { a: 0, k: [layer.width, layer.height] };
		let posProp: Prop = { a: 0, k: [dx, dy] };
		if (size) {
			const frames = [...new Set([...(wKeys ?? []), ...(hKeys ?? [])].map((k) => k[0]))].sort(
				(a, b) => a - b,
			);
			const at = (ks: typeof wKeys, f: number, fallback: number) => {
				if (!ks?.length) return fallback;
				const exact = ks.find((k) => Math.abs(k[0] - f) < 1e-6);
				if (exact) return exact[1][0];
				// Between keys: linear estimate (keys of both axes usually share frames).
				const before = [...ks].reverse().find((k) => k[0] < f) ?? ks[0];
				const after = ks.find((k) => k[0] > f) ?? ks[ks.length - 1];
				const t = after[0] === before[0] ? 0 : (f - before[0]) / (after[0] - before[0]);
				return before[1][0] + (after[1][0] - before[1][0]) * t;
			};
			const easeAtFrame = (f: number) =>
				(wKeys ?? []).find((k) => Math.abs(k[0] - f) < 1e-6)?.[2] ??
				(hKeys ?? []).find((k) => Math.abs(k[0] - f) < 1e-6)?.[2];
			const sizeTl = new Timeline(ctx.spec.fps);
			for (const f of frames) {
				const w = at(wKeys, f, layer.width);
				const h = at(hKeys, f, layer.height);
				const [ox, oy] = originOffset(layer.origin, w, h);
				const ms = (f / ctx.spec.fps) * 1000;
				sizeTl.add("s", ms, [w, h], easeAtFrame(f));
				sizeTl.add("p", ms, [ox, oy], easeAtFrame(f));
			}
			sizeProp = sizeTl.prop("s", [layer.width, layer.height]);
			posProp = sizeTl.prop("p", [dx, dy]);
		}
		// Fully rounded (radius at least half of every size it takes) is drawn as a true ellipse.
		const sizes = [
			layer.width,
			layer.height,
			...(wKeys ?? []).map((k) => k[1][0]),
			...(hKeys ?? []).map((k) => k[1][0]),
		];
		const round = (layer.radius ?? 0) > 0 && (layer.radius ?? 0) >= Math.max(...sizes) / 2;
		items.push(
			round
				? { ty: "el", d: 1, s: sizeProp, p: posProp }
				: { ty: "rc", d: 1, s: sizeProp, p: posProp, r: { a: 0, k: layer.radius ?? 0 } },
		);
		items.push(...trim(tl, draw), ...paintItems(layer, tl, "#ffffff"));
	} else if (layer.type === "ellipse") {
		rest = restOf(layer, { x: W / 2, y: H / 2 });
		draw = presets(layer, tl, rest, "both").draw;
		items.push({
			ty: "el",
			d: 1,
			s: { a: 0, k: [layer.width, layer.height] },
			p: { a: 0, k: [0, 0] },
		});
		items.push(...trim(tl, draw), ...paintItems(layer, tl, "#ffffff"));
	} else if (layer.type === "arc") {
		rest = restOf(layer, { x: W / 2, y: H / 2 });
		const p = presets(layer, tl, rest, "both");
		// "draw" sweeps the arc from its start to its end.
		if (p.draw && tl.has("trimEnd")) {
			const t = tl.tracks.get("trimEnd") as Track;
			t.keys = t.keys.map(([f, v, e]) => [
				f,
				[layer.from * 100 + (v[0] / 100) * (layer.to - layer.from) * 100],
				e,
			]);
		}
		const d = layer.radius * 2;
		items.push({ ty: "el", d: 1, s: { a: 0, k: [d, d] }, p: { a: 0, k: [0, 0] } });
		items.push({
			ty: "tm",
			s: tl.has("trimStart")
				? tl.prop("trimStart", layer.from * 100)
				: { a: 0, k: layer.from * 100 },
			e: tl.has("trimEnd") ? tl.prop("trimEnd", layer.to * 100) : { a: 0, k: layer.to * 100 },
			o: { a: 0, k: 0 },
			m: 1,
		});
		items.push(
			...paintItems(
				{ stroke: layer.color, strokeWidth: layer.thickness, cap: layer.cap ?? "butt" },
				tl,
				null,
			),
		);
	} else {
		rest = restOf(layer, { x: 0, y: 0 });
		draw = presets(layer, tl, rest, "both").draw;
		const shapes =
			layer.type === "line"
				? [polyline(layer.points, !!layer.smooth, !!layer.closed)]
				: parsePath(layer.d);
		for (const b of shapes) items.push({ ty: "sh", d: 1, ks: { a: 0, k: b } });
		items.push(
			...trim(tl, draw),
			...paintItems(layer, tl, layer.type === "line" ? null : "#ffffff"),
		);
		// A line with neither fill nor stroke would be invisible: stroke it.
		if (layer.type === "line" && !layer.stroke && !layer.fill && !layer.gradient)
			items.push(
				...paintItems(
					{ stroke: "#ffffff", strokeWidth: layer.strokeWidth ?? 4, cap: layer.cap },
					tl,
					null,
				),
			);
	}
	items = [
		{
			ty: "gr",
			nm: layer.name ?? layer.type,
			it: [
				...items,
				{
					ty: "tr",
					p: { a: 0, k: [0, 0] },
					a: { a: 0, k: [0, 0] },
					s: { a: 0, k: [100, 100] },
					r: { a: 0, k: 0 },
					o: { a: 0, k: 100 },
				},
			],
		},
	];
	return {
		...common(layer, ctx, ctx.nextIndex()),
		ty: 4,
		ks: transform(tl, rest),
		shapes: items,
		...(effects(layer, tl) ? { ef: effects(layer, tl) } : {}),
	};
}

function formatCount(value: number, c: NonNullable<z.infer<typeof text>["count"]>): string {
	const fixed = value.toFixed(c.decimals ?? 0);
	const [int, frac] = fixed.split(".");
	const grouped = c.separator ? int.replace(/\B(?=(\d{3})+(?!\d))/g, c.separator) : int;
	return `${c.prefix ?? ""}${grouped}${frac ? `.${frac}` : ""}${c.suffix ?? ""}`;
}

function textLayer(layer: z.infer<typeof text>, ctx: Context): LottieJson {
	const tl = new Timeline(ctx.spec.fps);
	ownKeys(layer, tl, ctx);
	const W = ctx.spec.width;
	const H = ctx.spec.height;
	const rest = restOf(layer, { x: W / 2, y: H / 2 });
	const p = presets(layer, tl, rest, "both");
	const font = fontFor(layer.font, layer.weight);
	ctx.fonts.add(font.name);
	const content = layer.uppercase ? layer.text.toUpperCase() : layer.text;
	const lines = content.split("\n");
	const lh = layer.size * (layer.lineHeight ?? 1.2);
	// Lottie places text by the first line's baseline; move it so x, y is the middle (or top).
	const shift = baselineShift(layer, lines.length);
	const [r, g, b] = rgba(layer.color);
	const doc = (t: string) => ({
		s: layer.size,
		f: font.name,
		t: t.replace(/\n/g, "\r"),
		j: layer.align === "right" ? 1 : layer.align === "center" ? 2 : 0,
		tr: layer.tracking ? (layer.tracking / layer.size) * 1000 : 0,
		lh,
		ls: 0,
		fc: [r, g, b],
	});
	const docs: { t: number; s: LottieJson }[] = [];
	const fps = ctx.spec.fps;
	const frame = (ms: number) => (ms / 1000) * fps;
	if (layer.count) {
		const c = layer.count;
		const start = frame(c.atMs);
		const frames = Math.max(1, Math.round(frame(c.durationMs)));
		docs.push({ t: 0, s: doc(formatCount(c.from, c)) });
		let last = "";
		for (let i = 0; i <= frames; i++) {
			const v = c.from + (c.to - c.from) * easeAt(c.ease ?? "outExpo", i / frames);
			const s = formatCount(v, c);
			if (s === last) continue;
			last = s;
			docs.push({ t: start + i, s: doc(s) });
		}
	} else if (p.type?.length) {
		// Typing: the text grows (or shrinks) a character at a time.
		docs.push({ t: 0, s: doc(p.type.some((k) => !k.out) ? "" : content) });
		for (const k of p.type) {
			const n = content.length;
			const frames = Math.max(1, Math.round(frame(k.durationMs)));
			let last = -1;
			for (let i = 0; i <= frames; i++) {
				const shown = Math.round(easeAt(k.ease, i / frames) * n);
				const count = k.out ? n - shown : shown;
				if (count === last) continue;
				last = count;
				docs.push({ t: frame(k.atMs) + i, s: doc(content.slice(0, count)) });
			}
		}
		docs.sort((a, b) => a.t - b.t);
	} else docs.push({ t: 0, s: doc(content) });
	ctx.chars += content.length;
	return {
		...common(layer, ctx, ctx.nextIndex()),
		ty: 5,
		// The anchor sits on x, y (the middle of the block by default), so text scales and turns around it.
		ks: transform(tl, rest, [0, -shift]),
		t: {
			d: { k: docs },
			p: {},
			m: { g: 1, a: { a: 0, k: [0, 0] } },
			a: [],
		},
		...(effects(layer, tl) ? { ef: effects(layer, tl) } : {}),
	};
}

function imageLayer(layer: z.infer<typeof image>, ctx: Context): LottieJson | null {
	const data = layer.src.startsWith("data:") ? layer.src : ctx.resolveImage?.(layer.src);
	if (!data) return null;
	const id = `image_${ctx.assets.length}`;
	ctx.assets.push({ id, w: layer.width, h: layer.height, u: "", p: data, e: 1 });
	const tl = new Timeline(ctx.spec.fps);
	ownKeys(layer, tl, ctx);
	const rest = restOf(layer, { x: ctx.spec.width / 2, y: ctx.spec.height / 2 });
	presets(layer, tl, rest, "both");
	return {
		...common(layer, ctx, ctx.nextIndex()),
		ty: 2,
		refId: id,
		ks: transform(tl, rest, [layer.width / 2, layer.height / 2]),
		...(effects(layer, tl) ? { ef: effects(layer, tl) } : {}),
	};
}

function groupLayer(layer: MotionGroup, ctx: Context): LottieJson {
	const W = ctx.spec.width;
	const H = ctx.spec.height;
	const pivot = layer.pivot ?? [W / 2, H / 2];
	const id = `group_${ctx.assets.length}`;
	const asset: LottieJson = { id, layers: [] };
	ctx.assets.push(asset);
	asset.layers = compileLayers(layer.layers, ctx);
	const tl = new Timeline(ctx.spec.fps);
	ownKeys(layer, tl, ctx);
	const rest = restOf(layer, { x: pivot[0], y: pivot[1] });
	presets(layer, tl, rest, "both");
	return {
		...common(layer, ctx, ctx.nextIndex()),
		ty: 0,
		refId: id,
		w: W,
		h: H,
		ks: transform(tl, rest, pivot),
		...(effects(layer, tl) ? { ef: effects(layer, tl) } : {}),
	};
}

/** Compiles layers (listed bottom to top) into Lottie's top-first order, with clip mattes. */
function compileLayers(layers: Layer[], ctx: Context): LottieJson[] {
	const out: LottieJson[] = [];
	for (const l of layers) {
		const compiled =
			l.type === "text"
				? l.runs?.length
					? groupLayer(runsGroup(l, ctx), ctx)
					: textLayer(l, ctx)
				: l.type === "image"
					? imageLayer(l, ctx)
					: l.type === "group"
						? groupLayer(l, ctx)
						: shapeLayer(l, ctx);
		if (!compiled) continue;
		if (l.clip) {
			// A track matte: a rectangle just above the layer, used as its alpha.
			const c = l.clip;
			const matte: LottieJson = {
				...common({ ...l, name: `${l.name ?? l.type} clip` } as Layer, ctx, ctx.nextIndex()),
				ty: 4,
				td: 1,
				ks: transform(new Timeline(ctx.spec.fps), {
					x: 0,
					y: 0,
					sx: 1,
					sy: 1,
					rotation: 0,
					opacity: 1,
				}),
				shapes: [
					{
						ty: "gr",
						it: [
							{
								ty: "rc",
								d: 1,
								s: { a: 0, k: [c.width, c.height] },
								p: { a: 0, k: [c.x + c.width / 2, c.y + c.height / 2] },
								r: { a: 0, k: 0 },
							},
							{ ty: "fl", c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 }, r: 1 },
							{
								ty: "tr",
								p: { a: 0, k: [0, 0] },
								a: { a: 0, k: [0, 0] },
								s: { a: 0, k: [100, 100] },
								r: { a: 0, k: 0 },
								o: { a: 0, k: 100 },
							},
						],
					},
				],
			};
			compiled.tt = 1;
			// Top-first: the matte comes before its layer.
			out.unshift(compiled);
			out.unshift(matte);
		} else out.unshift(compiled);
	}
	return out;
}

/** Every line layer with a name, anywhere in the spec, as canvas points. */
function namedLines(
	layers: Layer[],
	into = new Map<string, { points: [number, number][]; smooth: boolean }>(),
) {
	for (const l of layers) {
		if (l.type === "group") namedLines(l.layers, into);
		else if (l.type === "line" && l.name && !into.has(l.name)) {
			const [dx, dy] = [l.x ?? 0, l.y ?? 0];
			into.set(l.name, {
				points: l.points.map(([x, y]) => [x + dx, y + dy] as [number, number]),
				smooth: !!l.smooth,
			});
		}
	}
	return into;
}

type TextLayer = z.infer<typeof text>;

/** Where the first line's baseline is, below y, for a text layer's anchor. */
function baselineShift(layer: TextLayer, lines: number) {
	const cap = layer.size * capHeight(layer.font, layer.weight);
	const lh = layer.size * (layer.lineHeight ?? 1.2);
	const anchor = layer.anchor ?? "middle";
	return anchor === "baseline" ? 0 : anchor === "top" ? cap : cap / 2 - ((lines - 1) * lh) / 2;
}

/**
 * Text in runs becomes a group of text layers set side by side on one baseline;
 * the group carries the layer's own motion, each run its own.
 */
function runsGroup(layer: TextLayer, ctx: Context): MotionGroup {
	const W = ctx.spec.width;
	const H = ctx.spec.height;
	const x = layer.x ?? W / 2;
	const y = layer.y ?? H / 2;
	const tracking = layer.tracking ?? 0;
	const runs = (layer.runs ?? []).map((r) => ({
		...r,
		text: (layer.uppercase ? r.text.toUpperCase() : r.text).replace(/\n/g, " "),
		font: r.font ?? layer.font,
		weight: r.weight ?? layer.weight,
	}));
	const widths = runs.map((r) => textWidth(r.text, layer.size, r.font, tracking, r.weight));
	const total = widths.reduce((a, b) => a + b, 0);
	let left = x - (layer.align === "center" ? total / 2 : layer.align === "right" ? total : 0);
	const baseline = y + baselineShift(layer, 1);
	const children: Layer[] = runs.map((r, i) => {
		const child: TextLayer = {
			type: "text",
			name: `${layer.name ?? "Text"} ${i + 1}`,
			text: r.text,
			font: r.font,
			weight: r.weight,
			size: layer.size,
			color: r.color ?? layer.color,
			// Centred on its own middle, so a run pops and turns around itself.
			align: "center",
			tracking: layer.tracking,
			x: left + widths[i] / 2,
			y: baseline - (layer.size * capHeight(r.font, r.weight)) / 2,
			opacity: r.opacity,
			startMs: r.startMs,
			endMs: r.endMs,
			keys: r.keys,
			enter: r.enter,
			exit: r.exit,
		};
		left += widths[i];
		return child;
	});
	return {
		type: "group",
		name: layer.name,
		x,
		y,
		pivot: [x, y],
		scale: layer.scale,
		rotation: layer.rotation,
		opacity: layer.opacity,
		startMs: layer.startMs,
		endMs: layer.endMs,
		keys: layer.keys,
		enter: layer.enter,
		exit: layer.exit,
		follow: layer.follow,
		blend: layer.blend,
		shadow: layer.shadow,
		blur: layer.blur,
		layers: children,
	};
}

/** A text layer's box on the canvas at rest (from the fonts' widths; kerning left out). */
export interface TextBox {
	name: string;
	text: string;
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * Where each text layer sits at rest, so agents can line other things up with
 * words (an underline, a pin label, the next run). Positions inside groups are
 * as written, before the group's own move or scale.
 */
export function textBoxes(input: unknown): TextBox[] {
	const spec = parseMotionSpec(input);
	const out: TextBox[] = [];
	const walk = (layers: Layer[]) => {
		for (const l of layers) {
			if (l.type === "group") walk(l.layers);
			if (l.type !== "text") continue;
			const content = l.runs?.length
				? l.runs.map((r) => r.text).join("")
				: l.count
					? `${l.count.prefix ?? ""}${l.count.to}${l.count.suffix ?? ""}`
					: l.text;
			const shown = l.uppercase ? content.toUpperCase() : content;
			const lines = shown.split("\n");
			const width = l.runs?.length
				? l.runs.reduce(
						(sum, r) =>
							sum +
							textWidth(
								l.uppercase ? r.text.toUpperCase() : r.text,
								l.size,
								r.font ?? l.font,
								l.tracking ?? 0,
								r.weight ?? l.weight,
							),
						0,
					)
				: textWidth(shown, l.size, l.font, l.tracking ?? 0, l.weight);
			const x = l.x ?? spec.width / 2;
			const y = l.y ?? spec.height / 2;
			const left = x - (l.align === "center" ? width / 2 : l.align === "right" ? width : 0);
			const cap = l.size * capHeight(l.font, l.weight);
			const lh = l.size * (l.lineHeight ?? 1.2);
			const top = y + baselineShift(l, lines.length) - cap;
			const round = (v: number) => Math.round(v);
			out.push({
				name: l.name ?? "text",
				text: shown,
				left: round(left),
				top: round(top),
				right: round(left + width),
				bottom: round(top + cap + (lines.length - 1) * lh),
			});
		}
	};
	walk(spec.layers);
	return out;
}

/** Validates a spec and gives a readable error for the first problem. */
export function parseMotionSpec(input: unknown): Spec {
	const result = motionSpecSchema.safeParse(input);
	if (result.success) return result.data;
	const issue = result.error.issues[0];
	throw new Error(`Motion spec: ${issue.path.join(".") || "spec"}: ${issue.message}`);
}

/**
 * Compiles a spec into a Lottie document. `resolveImage` turns image file paths
 * into data URLs (done where files can be read).
 */
export function compileMotion(
	input: unknown,
	options: { resolveImage?: (src: string) => string | null } = {},
): LottieJson {
	const spec = parseMotionSpec(input);
	let index = 0;
	const ctx: Context = {
		spec,
		assets: [],
		fonts: new Set(),
		nextIndex: () => ++index,
		resolveImage: options.resolveImage,
		chars: 0,
		lines: namedLines(spec.layers),
	};
	const layers = spec.background
		? [
				{
					type: "rect" as const,
					name: "Background",
					width: spec.width,
					height: spec.height,
					fill: spec.background,
				},
				...spec.layers,
			]
		: spec.layers;
	const compiled = compileLayers(layers, ctx);
	const fonts = MOTION_FONTS.filter((f) => ctx.fonts.has(f.name));
	return {
		v: "5.12.1",
		fr: spec.fps,
		ip: 0,
		op: (spec.durationMs / 1000) * spec.fps,
		w: spec.width,
		h: spec.height,
		nm: spec.name ?? "Cue graphic",
		ddd: 0,
		assets: ctx.assets,
		...(fonts.length
			? {
					fonts: {
						list: fonts.map((f) => ({
							fName: f.name,
							fFamily: f.face,
							fStyle: f.weight >= 700 ? "Bold" : f.weight >= 600 ? "SemiBold" : "Regular",
							fWeight: String(f.weight),
							ascent: 72,
							origin: 3,
						})),
					},
				}
			: {}),
		layers: compiled,
		markers: (spec.markers ?? []).map((m) => ({
			tm: (m.atMs / 1000) * spec.fps,
			cm: m.name,
			dr: (m.durationMs / 1000) * spec.fps,
		})),
		meta: { g: "Cue motion spec" },
	};
}
