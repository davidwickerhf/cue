import { z } from "zod";
import type { MotionLayer, MotionSpec } from "./motionSpec";
import type { MotionTemplate } from "./motionTemplates";

/**
 * Device frames: original vector drawings of a retro CRT television, a laptop, a
 * phone, a polaroid, a film strip and a taped photo card, each with a see-through
 * hole where the picture goes. The frame graphic sits on an upper track and the
 * footage on a track below it, moved and scaled so it fills the hole: every
 * template reports its holes as regions (shares of the frame), and fitToRegion
 * turns a region into the clip transform that fills it.
 */

/** A see-through area of a frame, in shares of the output frame (0–1), top-left origin. */
export interface MotionRegion {
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Degrees clockwise the hole is turned around its centre (a tilted polaroid). */
	rotation?: number;
}

/** A clip transform (x, y = centre, scale 1 fits the canvas, crop in shares per edge). */
export interface RegionFit {
	x: number;
	y: number;
	scale: number;
	/** Degrees clockwise: the clip turns with a tilted frame. */
	rotation: number;
	crop: { left: number; top: number; right: number; bottom: number };
}

/**
 * The transform that makes a picture of `aspect` (width / height) cover `region`
 * with a small bleed under the frame's edge, cropped to the hole so nothing spills
 * past the device. Scale 1 fits the picture inside the canvas (contain).
 */
export function fitToRegion(
	region: Pick<MotionRegion, "x" | "y" | "width" | "height" | "rotation">,
	aspect: number,
	canvas: { width: number; height: number },
	bleed = 0.006,
): RegionFit {
	const W = canvas.width;
	const H = canvas.height;
	// The picture's size at scale 1, in pixels.
	const fitW = aspect >= W / H ? W : H * aspect;
	const fitH = aspect >= W / H ? W / aspect : H;
	const pad = bleed * Math.min(W, H);
	const targetW = region.width * W + 2 * pad;
	const targetH = region.height * H + 2 * pad;
	const scale = Math.max(targetW / fitW, targetH / fitH);
	const shownW = fitW * scale;
	const shownH = fitH * scale;
	const side = Math.min(0.45, Math.max(0, (shownW - targetW) / shownW / 2));
	const ends = Math.min(0.45, Math.max(0, (shownH - targetH) / shownH / 2));
	const round = (v: number) => Math.round(v * 10000) / 10000;
	return {
		x: round(region.x + region.width / 2),
		y: round(region.y + region.height / 2),
		scale: round(scale),
		rotation: round(region.rotation ?? 0),
		crop: { left: round(side), right: round(side), top: round(ends), bottom: round(ends) },
	};
}

/**
 * Where the fitted clip must go (x, y, scale) when the frame graphic is scaled by
 * `push` around the canvas centre, so the pair can be pushed in together with
 * scale (and x, y) keyframes on both clips.
 */
export function pushedFit(fit: RegionFit, push: number): Pick<RegionFit, "x" | "y" | "scale"> {
	const round = (v: number) => Math.round(v * 10000) / 10000;
	return {
		x: round(0.5 + (fit.x - 0.5) * push),
		y: round(0.5 + (fit.y - 0.5) * push),
		scale: round(fit.scale * push),
	};
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const share = z.number().min(-0.5).max(1.5);
const common = {
	/** Centre of the device on the frame, shares 0–1. */
	x: share.default(0.5),
	y: share.default(0.5),
	/** Degrees clockwise the whole device is turned (the footage fitted to it turns too). */
	rotation: z.number().min(-45).max(45).default(0),
	durationMs: z.number().min(500).max(600000).default(8000),
};

interface Hole {
	name: string;
	x: number;
	y: number;
	w: number;
	h: number;
	r: number;
}

interface Layout {
	layers: MotionLayer[];
	holes: Hole[];
}

const n = (v: number) => Math.round(v * 100) / 100;

/** SVG path of a rounded rectangle; `reverse` winds it the other way (a hole, with the non-zero rule). */
function roundRect(x: number, y: number, w: number, h: number, r: number, reverse = false): string {
	const rr = Math.max(0, Math.min(r, w / 2, h / 2));
	const k = rr * 0.4477; // 1 - 0.5523: bezier handles of a quarter circle.
	const x2 = x + w;
	const y2 = y + h;
	if (!reverse)
		return [
			`M ${n(x + rr)} ${n(y)}`,
			`L ${n(x2 - rr)} ${n(y)}`,
			`C ${n(x2 - k)} ${n(y)} ${n(x2)} ${n(y + k)} ${n(x2)} ${n(y + rr)}`,
			`L ${n(x2)} ${n(y2 - rr)}`,
			`C ${n(x2)} ${n(y2 - k)} ${n(x2 - k)} ${n(y2)} ${n(x2 - rr)} ${n(y2)}`,
			`L ${n(x + rr)} ${n(y2)}`,
			`C ${n(x + k)} ${n(y2)} ${n(x)} ${n(y2 - k)} ${n(x)} ${n(y2 - rr)}`,
			`L ${n(x)} ${n(y + rr)}`,
			`C ${n(x)} ${n(y + k)} ${n(x + k)} ${n(y)} ${n(x + rr)} ${n(y)} Z`,
		].join(" ");
	return [
		`M ${n(x + rr)} ${n(y)}`,
		`C ${n(x + k)} ${n(y)} ${n(x)} ${n(y + k)} ${n(x)} ${n(y + rr)}`,
		`L ${n(x)} ${n(y2 - rr)}`,
		`C ${n(x)} ${n(y2 - k)} ${n(x + k)} ${n(y2)} ${n(x + rr)} ${n(y2)}`,
		`L ${n(x2 - rr)} ${n(y2)}`,
		`C ${n(x2 - k)} ${n(y2)} ${n(x2)} ${n(y2 - k)} ${n(x2)} ${n(y2 - rr)}`,
		`L ${n(x2)} ${n(y + rr)}`,
		`C ${n(x2)} ${n(y + k)} ${n(x2 - k)} ${n(y)} ${n(x2 - rr)} ${n(y)}`,
		`L ${n(x + rr)} ${n(y)} Z`,
	].join(" ");
}

type PathLayer = Extract<MotionLayer, { type: "path" }>;

/** A filled rounded shape with the holes cut out of it. */
function cutout(
	name: string,
	outer: { x: number; y: number; w: number; h: number; r: number },
	holes: Pick<Hole, "x" | "y" | "w" | "h" | "r">[],
	paint: Pick<PathLayer, "fill" | "shadow" | "opacity">,
): MotionLayer {
	return {
		type: "path",
		name,
		d: [
			roundRect(outer.x, outer.y, outer.w, outer.h, outer.r),
			...holes.map((h) => roundRect(h.x, h.y, h.w, h.h, h.r, true)),
		].join(" "),
		...paint,
	};
}

/** Faint glass over a screen: a soft glare in one corner and darker edges (drawn under the body). */
function glass(hole: Hole, strength = 1): MotionLayer[] {
	const clip = { x: hole.x, y: hole.y, width: hole.w, height: hole.h };
	return [
		{
			type: "ellipse",
			name: "Screen shade",
			x: hole.x + hole.w / 2,
			y: hole.y + hole.h / 2,
			width: hole.w * 1.35,
			height: hole.h * 1.45,
			fill: null,
			gradient: {
				kind: "radial",
				from: [0, 0],
				to: [hole.w * 0.68, 0],
				stops: [
					[0.55, "#00000000"],
					[
						1,
						`#000000${Math.round(0x55 * strength)
							.toString(16)
							.padStart(2, "0")}`,
					],
				],
			},
			clip,
		},
		{
			type: "ellipse",
			name: "Glare",
			x: hole.x + hole.w * 0.28,
			y: hole.y + hole.h * 0.2,
			width: hole.w * 0.7,
			height: hole.h * 0.45,
			rotation: -18,
			fill: null,
			gradient: {
				kind: "radial",
				from: [0, 0],
				to: [hole.w * 0.35, 0],
				stops: [
					[
						0,
						`#ffffff${Math.round(0x1c * strength)
							.toString(16)
							.padStart(2, "0")}`,
					],
					[1, "#ffffff00"],
				],
			},
			clip,
		},
	];
}

function spec(
	c: { width: number; height: number; fps: number },
	durationMs: number,
	layers: MotionLayer[],
): MotionSpec {
	return { width: c.width, height: c.height, fps: c.fps, durationMs, layers };
}

/** The params every frame has: where its centre is, how far it is turned, how long it lasts. */
interface Turned {
	x: number;
	y: number;
	rotation: number;
	durationMs: number;
}

function template<P extends z.ZodRawShape>(
	t: Omit<MotionTemplate<P>, "build" | "regions" | "overlay" | "category"> & {
		layout: (
			p: z.output<z.ZodObject<P>>,
			c: { width: number; height: number; fps: number },
		) => Layout;
	},
): MotionTemplate {
	const { layout, ...rest } = t;
	const built: MotionTemplate<P> = {
		...rest,
		category: "frame",
		overlay: true,
		build: (p, c) => {
			const { x, y, rotation, durationMs } = p as unknown as Turned;
			const { layers } = layout(p, c);
			return spec(
				c,
				durationMs,
				rotation
					? [{ type: "group", name: "Frame", pivot: [x * c.width, y * c.height], rotation, layers }]
					: layers,
			);
		},
		// A turned device turns its holes around the device's centre: each region is the
		// hole's own box, moved to where its centre lands, with the angle to turn the clip.
		regions: (p, c) => {
			const { x, y, rotation } = p as unknown as Turned;
			const rad = (rotation * Math.PI) / 180;
			const px = x * c.width;
			const py = y * c.height;
			return layout(p, c).holes.map((h) => {
				const dx = h.x + h.w / 2 - px;
				const dy = h.y + h.h / 2 - py;
				const cx = px + dx * Math.cos(rad) - dy * Math.sin(rad);
				const cy = py + dx * Math.sin(rad) + dy * Math.cos(rad);
				return {
					name: h.name,
					x: (cx - h.w / 2) / c.width,
					y: (cy - h.h / 2) / c.height,
					width: h.w / c.width,
					height: h.h / c.height,
					...(rotation ? { rotation } : {}),
				};
			});
		},
	};
	return built as unknown as MotionTemplate;
}

/**
 * The device's height in pixels for a `size` share of the frame height, kept
 * narrower than the frame when the device is wider than it is tall.
 */
function deviceHeight(c: { width: number; height: number }, size: number, widthPerHeight: number) {
	return Math.min(size * c.height, (0.96 * c.width) / widthPerHeight);
}

const shadow = (unit: number, opacity = 0.35) => ({
	color: "#000000",
	opacity,
	distance: 14 * unit,
	blur: 34 * unit,
	angle: 180,
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const CRT_FINISHES = {
	wood: { body: "#6b4428", grain: "#4f2f19", trim: "#2b2622", panel: "#3a332d" },
	green: { body: "#7c9a6d", grain: "#6a8660", trim: "#2c3029", panel: "#3b4237" },
	cream: { body: "#e6dcc4", grain: "#d6c9ac", trim: "#34302b", panel: "#4a453e" },
	grey: { body: "#8b8e92", grain: "#7b7e82", trim: "#26282b", panel: "#3a3c40" },
} as const;

const crt = template({
	id: "frame-crt",
	name: "Retro TV",
	description:
		"A retro CRT television (wood, green, cream or grey cabinet) with a rounded 4:3 screen, dials, a speaker grille and optional rabbit-ear antenna. The screen is see-through: put the footage on a track below and fit it with the screen region's fit. Faint scanlines and glass glare sit over the picture.",
	params: z.object({
		...common,
		/** Height of the cabinet as a share of the frame height. */
		size: z.number().min(0.2).max(1.2).default(0.6),
		/** Centre of the cabinet; a little low by default to leave room for the antenna. */
		y: share.default(0.56),
		finish: z.enum(["wood", "green", "cream", "grey"]).default("wood"),
		antenna: z.boolean().default(true),
		scanlines: z.boolean().default(true),
	}),
	example: { finish: "wood" },
	layout: (p, c) => {
		const S = deviceHeight(c, p.size, 1.4);
		const u = S / 700;
		const f = CRT_FINISHES[p.finish];
		const bw = 1.4 * S;
		const bh = S;
		const bx = p.x * c.width - bw / 2;
		const by = p.y * c.height - bh / 2;
		const hh = 0.72 * S;
		const hw = (4 / 3) * hh;
		const hole: Hole = {
			name: "screen",
			x: bx + 0.12 * S,
			y: by + (bh - hh) / 2,
			w: hw,
			h: hh,
			r: 0.075 * S,
		};
		const m = 0.045 * S;
		const bezel = { x: hole.x - m, y: hole.y - m, w: hw + 2 * m, h: hh + 2 * m, r: 0.1 * S };
		const panelX = bezel.x + bezel.w + 0.035 * S;
		const panelW = bx + bw - 0.06 * S - panelX;
		const layers: MotionLayer[] = [];
		layers.push(...glass(hole));
		if (p.scanlines) {
			const lines: string[] = [];
			for (let y = hole.y + 2 * u; y < hole.y + hh; y += 4.5 * u)
				lines.push(`M ${n(hole.x)} ${n(y)} H ${n(hole.x + hw)}`);
			layers.push({
				type: "path",
				name: "Scanlines",
				d: lines.join(" "),
				fill: null,
				stroke: "#000000",
				strokeWidth: 1.6 * u,
				opacity: 0.14,
				cap: "butt",
			});
		}
		// Legs and antenna go behind the cabinet.
		for (const lx of [bx + 0.14 * S, bx + bw - 0.26 * S])
			layers.push({
				type: "path",
				name: "Leg",
				d: `M ${n(lx)} ${n(by + bh - 4 * u)} L ${n(lx + 0.12 * S)} ${n(by + bh - 4 * u)} L ${n(lx + 0.1 * S)} ${n(by + bh + 0.07 * S)} L ${n(lx + 0.02 * S)} ${n(by + bh + 0.07 * S)} Z`,
				fill: f.trim,
			});
		if (p.antenna) {
			const ax = bx + bw * 0.5;
			const ay = by + 4 * u;
			for (const [dx, dy] of [
				[-0.28, -0.3],
				[0.24, -0.33],
			] as const) {
				layers.push({
					type: "line",
					name: "Antenna",
					points: [
						[ax, ay - 0.04 * S],
						[ax + dx * S, ay - 0.04 * S + dy * S],
					],
					stroke: "#9a9da2",
					strokeWidth: 5 * u,
					cap: "round",
				});
				layers.push({
					type: "ellipse",
					name: "Antenna tip",
					x: ax + dx * S,
					y: ay - 0.04 * S + dy * S,
					width: 14 * u,
					height: 14 * u,
					fill: "#b9bcc1",
				});
			}
			layers.push({
				type: "path",
				name: "Antenna base",
				d: `M ${n(ax - 0.09 * S)} ${n(ay)} C ${n(ax - 0.09 * S)} ${n(ay - 0.08 * S)} ${n(ax + 0.09 * S)} ${n(ay - 0.08 * S)} ${n(ax + 0.09 * S)} ${n(ay)} Z`,
				fill: f.trim,
			});
		}
		layers.push(
			cutout("Cabinet", { x: bx, y: by, w: bw, h: bh, r: 0.07 * S }, [hole], {
				fill: f.body,
				shadow: shadow(u),
			}),
		);
		// Wood grain (or moulding lines): only above, below and right of the screen.
		const grain: string[] = [];
		for (let i = 0; i < 9; i++) {
			const t = (i + 0.5) / 9;
			const y = by + t * bh;
			const inScreen = y > bezel.y - 6 * u && y < bezel.y + bezel.h + 6 * u;
			const x0 = inScreen ? panelX - 0.01 * S : bx + 0.05 * S;
			const wave = Math.sin(i * 1.7) * 5 * u;
			grain.push(
				`M ${n(x0)} ${n(y)} C ${n(x0 + (bx + bw - x0) * 0.3)} ${n(y + wave)} ${n(x0 + (bx + bw - x0) * 0.7)} ${n(y - wave)} ${n(bx + bw - 0.05 * S)} ${n(y + wave * 0.5)}`,
			);
		}
		layers.push({
			type: "path",
			name: "Grain",
			d: grain.join(" "),
			fill: null,
			stroke: f.grain,
			strokeWidth: 2.2 * u,
			opacity: 0.55,
		});
		layers.push(
			cutout("Bezel", bezel, [hole], {
				fill: f.trim,
			}),
			cutout(
				"Bezel lip",
				{ x: hole.x - 5 * u, y: hole.y - 5 * u, w: hw + 10 * u, h: hh + 10 * u, r: hole.r + 4 * u },
				[hole],
				{ fill: "#15171a" },
			),
			{
				type: "rect",
				name: "Panel",
				x: panelX + panelW / 2,
				y: by + bh / 2,
				width: panelW,
				height: bezel.h,
				radius: 0.04 * S,
				fill: f.panel,
			},
		);
		const knobX = panelX + panelW / 2;
		for (const [i, ky] of [by + 0.26 * S, by + 0.46 * S].entries()) {
			const d = Math.min(0.13 * S, panelW * 0.7);
			layers.push(
				{ type: "ellipse", name: "Dial", x: knobX, y: ky, width: d, height: d, fill: "#1b1b1d" },
				{
					type: "ellipse",
					name: "Dial face",
					x: knobX,
					y: ky,
					width: d * 0.78,
					height: d * 0.78,
					fill: "#c9c3b5",
				},
				{
					type: "line",
					name: "Dial mark",
					points: [
						[knobX, ky],
						[
							knobX + Math.cos(i ? -0.6 : -2.2) * d * 0.34,
							ky + Math.sin(i ? -0.6 : -2.2) * d * 0.34,
						],
					],
					stroke: "#1b1b1d",
					strokeWidth: 4 * u,
					cap: "round",
				},
			);
		}
		const grille: string[] = [];
		for (let i = 0; i < 7; i++) {
			const y = by + 0.6 * S + i * 0.035 * S;
			grille.push(`M ${n(panelX + panelW * 0.18)} ${n(y)} H ${n(panelX + panelW * 0.82)}`);
		}
		layers.push({
			type: "path",
			name: "Speaker",
			d: grille.join(" "),
			fill: null,
			stroke: "#141416",
			strokeWidth: 5 * u,
			cap: "round",
		});
		return { layers, holes: [hole] };
	},
});

const laptop = template({
	id: "frame-laptop",
	name: "Laptop",
	description:
		"A generic open laptop (silver or dark) with a see-through 16:9 screen. Put the footage (a screen recording, a website, a clip) on a track below and fit it with the screen region's fit.",
	params: z.object({
		...common,
		/** Height of the whole laptop as a share of the frame height. */
		size: z.number().min(0.2).max(1.2).default(0.72),
		finish: z.enum(["silver", "dark"]).default("silver"),
	}),
	example: { finish: "silver" },
	layout: (p, c) => {
		const S = deviceHeight(c, p.size, 1.66);
		const u = S / 700;
		const metal = p.finish === "silver" ? "#c9ccd2" : "#3b3e44";
		const metalDark = p.finish === "silver" ? "#a4a8b0" : "#2a2c31";
		const lidH = 0.9 * S;
		const hh = lidH - 0.1 * S;
		const hw = (16 / 9) * hh;
		const lidW = hw + 0.07 * S;
		const cx = p.x * c.width;
		const top = p.y * c.height - S / 2;
		const lid = { x: cx - lidW / 2, y: top, w: lidW, h: lidH, r: 0.035 * S };
		const hole: Hole = {
			name: "screen",
			x: cx - hw / 2,
			y: top + 0.045 * S,
			w: hw,
			h: hh,
			r: 0.006 * S,
		};
		const baseW = lidW * 1.14;
		const baseTop = top + lidH;
		const layers: MotionLayer[] = [
			...glass(hole, 0.5),
			cutout("Lid", lid, [hole], { fill: metal, shadow: shadow(u, 0.3) }),
			cutout(
				"Bezel",
				{
					x: lid.x + 0.008 * S,
					y: lid.y + 0.008 * S,
					w: lid.w - 0.016 * S,
					h: lid.h - 0.016 * S,
					r: 0.03 * S,
				},
				[hole],
				{ fill: "#131418" },
			),
			{
				type: "ellipse",
				name: "Camera",
				x: cx,
				y: top + 0.024 * S,
				width: 7 * u,
				height: 7 * u,
				fill: "#2c2f36",
			},
			{
				type: "path",
				name: "Base",
				d: `M ${n(cx - lidW / 2 - 0.01 * S)} ${n(baseTop)} L ${n(cx + lidW / 2 + 0.01 * S)} ${n(baseTop)} L ${n(cx + baseW / 2)} ${n(baseTop + 0.07 * S)} C ${n(cx + baseW / 2)} ${n(baseTop + 0.095 * S)} ${n(cx + baseW / 2 - 0.02 * S)} ${n(baseTop + 0.1 * S)} ${n(cx + baseW / 2 - 0.05 * S)} ${n(baseTop + 0.1 * S)} L ${n(cx - baseW / 2 + 0.05 * S)} ${n(baseTop + 0.1 * S)} C ${n(cx - baseW / 2 + 0.02 * S)} ${n(baseTop + 0.1 * S)} ${n(cx - baseW / 2)} ${n(baseTop + 0.095 * S)} ${n(cx - baseW / 2)} ${n(baseTop + 0.07 * S)} Z`,
				fill: metal,
				shadow: shadow(u, 0.3),
			},
			{
				type: "rect",
				name: "Hinge",
				x: cx,
				y: baseTop + 0.004 * S,
				width: lidW + 0.02 * S,
				height: 0.012 * S,
				fill: metalDark,
			},
			{
				type: "rect",
				name: "Notch",
				x: cx,
				y: baseTop + 0.018 * S,
				width: 0.22 * S,
				height: 0.018 * S,
				radius: 0.009 * S,
				fill: metalDark,
			},
		];
		return { layers, holes: [hole] };
	},
});

const phone = template({
	id: "frame-phone",
	name: "Phone",
	description:
		"A generic smartphone, portrait or landscape, with a see-through screen (about 9:19.5) and a camera pill. Put a vertical video, a screen recording or a post on a track below and fit it with the screen region's fit (the 9:16 fit for vertical video).",
	params: z.object({
		...common,
		/** Height of the phone as a share of the frame height (its long side in portrait). */
		size: z.number().min(0.2).max(1.2).default(0.82),
		orientation: z.enum(["portrait", "landscape"]).default("portrait"),
		finish: z.enum(["graphite", "silver", "blue"]).default("graphite"),
	}),
	example: { orientation: "portrait" },
	layout: (p, c) => {
		const portrait = p.orientation === "portrait";
		const long = portrait
			? deviceHeight(c, p.size, 0.49)
			: Math.min(p.size * c.width * 0.6, 0.96 * c.width);
		const short = long * 0.49;
		const w = portrait ? short : long;
		const h = portrait ? long : Math.min(short, 0.96 * c.height);
		const u = long / 900;
		const rim = { graphite: "#3c3d41", silver: "#d4d6da", blue: "#3f5a78" }[p.finish];
		const cx = p.x * c.width;
		const cy = p.y * c.height;
		const body = { x: cx - w / 2, y: cy - h / 2, w, h, r: 0.075 * long };
		const m = 0.022 * long;
		const hole: Hole = {
			name: "screen",
			x: body.x + m,
			y: body.y + m,
			w: w - 2 * m,
			h: h - 2 * m,
			r: 0.058 * long,
		};
		const buttons: MotionLayer[] = (
			portrait
				? [
						[body.x - 3 * u, body.y + 0.2 * h, 6 * u, 0.06 * h],
						[body.x - 3 * u, body.y + 0.3 * h, 6 * u, 0.09 * h],
						[body.x + w + 3 * u, body.y + 0.26 * h, 6 * u, 0.13 * h],
					]
				: [
						[body.x + 0.2 * w, body.y - 3 * u, 0.06 * w, 6 * u],
						[body.x + 0.3 * w, body.y - 3 * u, 0.09 * w, 6 * u],
						[body.x + 0.26 * w, body.y + h + 3 * u, 0.13 * w, 6 * u],
					]
		).map(([x, y, bw, bh]) => ({
			type: "rect" as const,
			name: "Button",
			x: x + (portrait ? 0 : bw / 2),
			y: y + (portrait ? bh / 2 : 0),
			width: bw,
			height: bh,
			radius: 3 * u,
			fill: rim,
		}));
		const pill = portrait
			? { x: cx, y: hole.y + 0.03 * long, width: 0.13 * long, height: 0.034 * long }
			: { x: hole.x + 0.03 * long, y: cy, width: 0.034 * long, height: 0.13 * long };
		const layers: MotionLayer[] = [
			...glass(hole, 0.4),
			...buttons,
			cutout("Body", body, [hole], { fill: rim, shadow: shadow(u, 0.35) }),
			cutout(
				"Bezel",
				{ x: body.x + 4 * u, y: body.y + 4 * u, w: w - 8 * u, h: h - 8 * u, r: body.r - 4 * u },
				[hole],
				{ fill: "#0b0b0c" },
			),
			{
				type: "rect",
				name: "Camera",
				...pill,
				radius: Math.min(pill.width, pill.height) / 2,
				fill: "#050505",
			},
		];
		return { layers, holes: [hole] };
	},
});

const polaroid = template({
	id: "frame-polaroid",
	name: "Polaroid",
	description:
		"An instant photo: a white card with a square picture window, a thicker bottom border and an optional handwritten-style caption. Put a photo or clip on a track below and fit it with the screen region's fit.",
	params: z.object({
		...common,
		/** Height of the card as a share of the frame height. */
		size: z.number().min(0.2).max(1.2).default(0.74),
		caption: z.string().max(60).default(""),
		paper: hex.default("#f6f3ec"),
		ink: hex.default("#2b2b33"),
	}),
	example: { caption: "Summer, 1974" },
	layout: (p, c) => {
		const h = deviceHeight(c, p.size, 0.83);
		const w = 0.83 * h;
		const u = h / 700;
		const x = p.x * c.width - w / 2;
		const y = p.y * c.height - h / 2;
		const side = 0.055 * w;
		const hw = w - 2 * side;
		const hole: Hole = {
			name: "screen",
			x: x + side,
			y: y + side * 1.15,
			w: hw,
			h: hw * 0.98,
			r: 1.5 * u,
		};
		const layers: MotionLayer[] = [
			cutout("Card", { x, y, w, h, r: 4 * u }, [hole], { fill: p.paper, shadow: shadow(u, 0.4) }),
			cutout(
				"Inner edge",
				{ x: hole.x - 2 * u, y: hole.y - 2 * u, w: hole.w + 4 * u, h: hole.h + 4 * u, r: 2 * u },
				[hole],
				{ fill: "#d9d4c8" },
			),
		];
		if (p.caption)
			layers.push({
				type: "text",
				name: "Caption",
				text: p.caption,
				x: x + w / 2,
				y: (hole.y + hole.h + y + h) / 2,
				align: "center",
				font: "serif",
				italic: true,
				weight: 400,
				size: Math.min(0.075 * h, (1.6 * hw) / Math.max(8, p.caption.length)),
				color: p.ink,
				rotation: -1.5,
			});
		return { layers, holes: [hole] };
	},
});

const ASPECTS = { "16:9": 16 / 9, "4:3": 4 / 3, "3:2": 3 / 2, "1:1": 1 } as const;

const filmStrip = template({
	id: "frame-film-strip",
	name: "Film strip",
	description:
		"A strip of film with sprocket holes and one to four see-through frames side by side. The middle frame is the region named screen, the others frame-1, frame-2… from the left. Put a clip under each frame and fit it with that region's fit; sprocket holes show what is under the strip.",
	params: z.object({
		...common,
		/** Height of the strip as a share of the frame height. */
		size: z.number().min(0.1).max(1).default(0.46),
		/** Length of the strip as a share of the frame width. */
		length: z.number().min(0.2).max(1.5).default(1.1),
		frames: z.number().int().min(1).max(4).default(3),
		aspect: z.enum(["4:3", "16:9", "3:2", "1:1"]).default("4:3"),
		color: hex.default("#16130f"),
		numbers: z.boolean().default(true),
	}),
	example: { frames: 3 },
	layout: (p, c) => {
		const sh = p.size * c.height;
		const sw = p.length * c.width;
		const u = sh / 500;
		const x = p.x * c.width - sw / 2;
		const y = p.y * c.height - sh / 2;
		let fh = 0.7 * sh;
		let fw = fh * ASPECTS[p.aspect];
		let gap = 0.07 * sh;
		// Frames stay on the picture even when the strip runs off its sides.
		const room = 0.96 * Math.min(sw, c.width);
		if (p.frames * fw + (p.frames - 1) * gap > room) {
			const k = room / (p.frames * fw + (p.frames - 1) * gap);
			fh *= k;
			fw *= k;
			gap *= k;
		}
		const total = p.frames * fw + (p.frames - 1) * gap;
		const middle = Math.floor((p.frames - 1) / 2);
		const holes: Hole[] = Array.from({ length: p.frames }, (_, i) => ({
			name: i === middle ? "screen" : `frame-${i + 1}`,
			x: x + (sw - total) / 2 + i * (fw + gap),
			y: y + (sh - fh) / 2,
			w: fw,
			h: fh,
			r: 0.02 * fh,
		}));
		// Sprocket holes along both edges.
		const band = (sh - fh) / 2;
		const sprW = Math.min(0.052 * sh, band * 0.55);
		const sprH = sprW * 1.35;
		const pitch = sprW * 2.1;
		const sprockets: Hole[] = [];
		for (let sx = x + pitch * 0.6; sx + sprW < x + sw - pitch * 0.3; sx += pitch)
			for (const sy of [y + (band - sprH * 0.75) / 2, y + sh - band + (band - sprH * 0.75) / 2])
				sprockets.push({ name: "sprocket", x: sx, y: sy, w: sprW, h: sprH * 0.75, r: sprW * 0.2 });
		// Three bands (edges with sprockets, the middle with the frames) keep each path short;
		// they overlap by a pixel so no seam shows.
		const edge = (name: string, top: number) =>
			cutout(
				name,
				{ x, y: top, w: sw, h: band + 1, r: 0 },
				sprockets.filter((s) => s.y >= top && s.y < top + band),
				{ fill: p.color },
			);
		const layers: MotionLayer[] = [
			...holes.flatMap((h) => glass(h, 0.35)),
			{
				type: "group",
				name: "Film",
				pivot: [x + sw / 2, y + sh / 2],
				shadow: shadow(u, 0.3),
				layers: [
					edge("Top edge", y),
					cutout("Frames", { x, y: y + band - 1, w: sw, h: fh + 2, r: 0 }, holes, {
						fill: p.color,
					}),
					edge("Bottom edge", y + sh - band - 1),
				],
			},
		];
		if (p.numbers)
			for (const [i, h] of holes.entries())
				layers.push({
					type: "text",
					name: "Frame number",
					text: `${14 + i}${i % 2 ? "" : "A"}  ▸`,
					x: h.x + 4 * u,
					y: y + sh - band * 0.12,
					anchor: "baseline",
					font: "mono",
					weight: 500,
					size: Math.max(8, band * 0.2),
					color: "#d98c2b",
					opacity: 0.85,
				});
		return { layers, holes };
	},
});

const photoCard = template({
	id: "frame-photo-card",
	name: "Taped photo",
	description:
		"A printed photo with a white paper border, held on with strips of masking tape, for the collage/evidence-board look. Put the photo or clip on a track below and fit it with the screen region's fit. The tape crosses the picture's corners.",
	params: z.object({
		...common,
		/** Height of the card as a share of the frame height. */
		size: z.number().min(0.2).max(1.2).default(0.62),
		aspect: z.enum(["16:9", "4:3", "3:2", "1:1"]).default("4:3"),
		tape: z.enum(["corners", "top", "none"]).default("corners"),
		paper: hex.default("#f4f1ea"),
		tapeColor: hex.default("#e7dcc0"),
	}),
	example: { aspect: "4:3", tape: "corners" },
	layout: (p, c) => {
		const ratio = ASPECTS[p.aspect];
		const border = 0.045;
		const h = deviceHeight(c, p.size, ratio + 2 * border);
		const u = h / 700;
		const hh = h * (1 - 2 * border);
		const hw = hh * ratio;
		const w = hw + 2 * border * h;
		const x = p.x * c.width - w / 2;
		const y = p.y * c.height - h / 2;
		const hole: Hole = { name: "screen", x: x + border * h, y: y + border * h, w: hw, h: hh, r: 0 };
		const layers: MotionLayer[] = [
			cutout("Card", { x, y, w, h, r: 2 * u }, [hole], { fill: p.paper, shadow: shadow(u, 0.4) }),
		];
		const strip = (cx: number, cy: number, angle: number, seed: number) => {
			const tw = 0.24 * h;
			const th = 0.07 * h;
			const pts: [number, number][] = [];
			// Torn short ends: a small zig-zag.
			const teeth = 6;
			pts.push([-tw / 2, -th / 2], [tw / 2, -th / 2]);
			for (let i = 1; i <= teeth; i++)
				pts.push([
					tw / 2 + (i % 2 ? 3 : -2) * u * (1 + ((seed + i) % 3) * 0.4),
					-th / 2 + (th * i) / teeth,
				]);
			pts.push([-tw / 2, th / 2]);
			for (let i = teeth - 1; i >= 1; i--)
				pts.push([
					-tw / 2 + (i % 2 ? -3 : 2) * u * (1 + ((seed + i) % 2) * 0.5),
					-th / 2 + (th * i) / teeth,
				]);
			const rad = (angle * Math.PI) / 180;
			const points = pts.map(([px, py]): [number, number] => [
				cx + px * Math.cos(rad) - py * Math.sin(rad),
				cy + px * Math.sin(rad) + py * Math.cos(rad),
			]);
			layers.push({
				type: "line",
				name: "Tape",
				points,
				closed: true,
				fill: `${p.tapeColor}c8`,
				stroke: null,
				shadow: { color: "#000000", opacity: 0.18, distance: 2 * u, blur: 6 * u, angle: 180 },
			});
		};
		if (p.tape === "corners") {
			strip(x + 0.02 * h, y + 0.02 * h, -38, 1);
			strip(x + w - 0.02 * h, y + 0.02 * h, 38, 2);
		} else if (p.tape === "top") strip(x + w / 2, y + 0.005 * h, -3, 3);
		return { layers, holes: [hole] };
	},
});

export const FRAME_TEMPLATES: MotionTemplate[] = [
	crt,
	laptop,
	phone,
	polaroid,
	filmStrip,
	photoCard,
];
