import { EASES, type Ease, easeAt, type MOTION_PRESETS, PRESET_MS } from "./motionSpec";

/**
 * A layer's own animation as the Motion page edits it by hand: its keyframes,
 * property by property, and its enter and exit presets. Every change returns a
 * patch for updateLayer (keys or enter/exit set, or removed when emptied), so
 * the rest of the spec is untouched. Layers are plain JSON, as stored.
 */

type Json = Record<string, unknown>;

/** A keyframe as written: [ms, value, ease into the next key]. */
export type Key = [number, number | string, Ease?];

export type KeyProp =
	| "x"
	| "y"
	| "scale"
	| "scaleX"
	| "scaleY"
	| "rotation"
	| "opacity"
	| "width"
	| "height"
	| "trimStart"
	| "trimEnd"
	| "color"
	| "blur";

/** Every property keys can move, in the order the page lists them, with how values show. */
export const KEY_PROPS: {
	prop: KeyProp;
	label: string;
	digits: number;
	step: number;
	min?: number;
	max?: number;
}[] = [
	{ prop: "x", label: "X", digits: 0, step: 1 },
	{ prop: "y", label: "Y", digits: 0, step: 1 },
	{ prop: "scale", label: "Scale", digits: 2, step: 0.05 },
	{ prop: "scaleX", label: "Scale X", digits: 2, step: 0.05 },
	{ prop: "scaleY", label: "Scale Y", digits: 2, step: 0.05 },
	{ prop: "rotation", label: "Rotation", digits: 1, step: 1 },
	{ prop: "opacity", label: "Opacity", digits: 2, step: 0.05, min: 0, max: 1 },
	{ prop: "width", label: "Width", digits: 0, step: 1, min: 0 },
	{ prop: "height", label: "Height", digits: 0, step: 1, min: 0 },
	{ prop: "trimStart", label: "Trim start", digits: 2, step: 0.05, min: 0, max: 1 },
	{ prop: "trimEnd", label: "Trim end", digits: 2, step: 0.05, min: 0, max: 1 },
	{ prop: "color", label: "Colour", digits: 0, step: 1 },
	{ prop: "blur", label: "Blur", digits: 0, step: 1, min: 0 },
];

export const EASE_NAMES = [...Object.keys(EASES), "hold"] as (keyof typeof EASES | "hold")[];

/**
 * The properties a layer's keys actually drive, by type: every layer moves,
 * scales, turns, fades and blurs; rectangles also resize; outlines trim;
 * shapes (not text or pictures) change colour.
 */
export function keyableProps(layer: Json): KeyProp[] {
	const type = String(layer.type);
	const out: KeyProp[] = ["x", "y", "scale", "rotation", "opacity"];
	if (type === "rect") out.push("width", "height");
	if (["rect", "ellipse", "line", "path", "arc"].includes(type))
		out.push("trimStart", "trimEnd", "color");
	out.push("blur");
	return out;
}

/** The layer's keys, as written (an empty object when it has none). */
export function keysOf(layer: Json): Partial<Record<KeyProp, Key[]>> {
	return (layer.keys ?? {}) as Partial<Record<KeyProp, Key[]>>;
}

/** Properties with keys, in the page's order (unknown ones last). */
export function animatedProps(layer: Json): KeyProp[] {
	const keys = keysOf(layer);
	const order = KEY_PROPS.map((p) => p.prop as string);
	return (Object.keys(keys) as KeyProp[])
		.filter((p) => keys[p]?.length)
		.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
}

/** What a property is when nothing animates it (the layer's own value, or the compiler's default). */
export function restValue(spec: Json, layer: Json, prop: KeyProp): number | string {
	const W = Number(spec.width ?? 1920);
	const H = Number(spec.height ?? 1080);
	const type = String(layer.type);
	const scale = layer.scale as number | [number, number] | undefined;
	const [sx, sy] = Array.isArray(scale) ? scale : [scale ?? 1, scale ?? 1];
	// Lines and paths are drawn in canvas points, so their x, y is an offset from 0;
	// groups sit on their pivot.
	const pivot = (layer.pivot as [number, number] | undefined) ?? [W / 2, H / 2];
	const home =
		type === "line" || type === "path" ? [0, 0] : type === "group" ? pivot : [W / 2, H / 2];
	switch (prop) {
		case "x":
			return Number(layer.x ?? home[0]);
		case "y":
			return Number(layer.y ?? home[1]);
		case "scale":
		case "scaleX":
			return sx;
		case "scaleY":
			return sy;
		case "rotation":
			return Number(layer.rotation ?? 0);
		case "opacity":
			return Number(layer.opacity ?? 1);
		case "width":
			return Number(layer.width ?? 100);
		case "height":
			return Number(layer.height ?? 100);
		case "trimStart":
			return type === "arc" ? Number(layer.from ?? 0) : 0;
		case "trimEnd":
			return type === "arc" ? Number(layer.to ?? 1) : 1;
		case "color":
			return String(layer.fill ?? layer.stroke ?? layer.color ?? "#ffffff");
		case "blur":
			return Number(layer.blur ?? 0);
	}
}

/**
 * A property's value at a time: between keys it follows the ease of the key
 * the stretch starts at; before the first key and after the last it holds them.
 * Colours hold (no blending here). Without keys it is the rest value.
 */
export function valueAt(spec: Json, layer: Json, prop: KeyProp, ms: number): number | string {
	const ks = keysOf(layer)[prop];
	if (!ks?.length) return restValue(spec, layer, prop);
	if (ms <= ks[0][0]) return ks[0][1];
	for (let i = 0; i < ks.length - 1; i++) {
		const [a, va, ease] = ks[i];
		const [b, vb] = ks[i + 1];
		if (ms > b) continue;
		if (typeof va !== "number" || typeof vb !== "number") return va;
		const t = b === a ? 1 : easeAt(ease, (ms - a) / (b - a));
		return va + (vb - va) * t;
	}
	return ks[ks.length - 1][1];
}

/** A layer with its position and size where its keys have them at a time (to box it on the preview). */
export function poseAt(spec: Json, layer: Json, ms: number): Json {
	const keys = keysOf(layer);
	const posed: Json = { ...layer };
	for (const prop of ["x", "y", "width", "height"] as const)
		if (keys[prop]?.length && keyableProps(layer).includes(prop))
			posed[prop] = valueAt(spec, layer, prop, ms);
	return posed;
}

/** The patch that sets a property's keys (and drops it, or all keys, when empty). */
function withKeys(layer: Json, prop: KeyProp, ks: Key[]): Json {
	const next: Json = { ...keysOf(layer) };
	if (ks.length) next[prop] = ks;
	else delete next[prop];
	return { keys: Object.keys(next).length ? next : undefined };
}

const sameTime = (a: number, b: number) => Math.abs(a - b) < 0.5;
const tidy = (ms: number) => Math.max(0, Math.round(ms));
const key = (ms: number, value: number | string, ease?: Ease): Key =>
	ease === undefined ? [ms, value] : [ms, value, ease];

/**
 * Sets a key at a time: the key already there takes the new value, otherwise a
 * new one is added. A new key between two splits their stretch, so it keeps
 * that stretch's ease unless one is given. Returns the patch and where the key sits in the list.
 */
export function setKey(
	layer: Json,
	prop: KeyProp,
	ms: number,
	value: number | string,
	ease?: Ease,
): { patch: Json; index: number } {
	const at = tidy(ms);
	const ks = [...(keysOf(layer)[prop] ?? [])];
	const same = ks.findIndex((k) => sameTime(k[0], at));
	if (same >= 0) {
		ks[same] = key(ks[same][0], value, ease ?? ks[same][2]);
		return { patch: withKeys(layer, prop, ks), index: same };
	}
	const before = ks.filter((k) => k[0] < at).pop();
	const splits = before && ks.some((k) => k[0] > at);
	ks.push(key(at, value, ease ?? (splits ? before[2] : undefined)));
	ks.sort((a, b) => a[0] - b[0]);
	return { patch: withKeys(layer, prop, ks), index: ks.findIndex((k) => k[0] === at) };
}

/** Moves a key to another time (a key already there gives way). Returns its new place. */
export function retimeKey(
	layer: Json,
	prop: KeyProp,
	index: number,
	ms: number,
): { patch: Json; index: number } {
	const at = tidy(ms);
	const ks = keysOf(layer)[prop] ?? [];
	const moving = ks[index];
	if (!moving) return { patch: {}, index };
	const moved: Key = key(at, moving[1], moving[2]);
	const rest = ks.filter((k, i) => i !== index && !sameTime(k[0], at));
	const next = [...rest, moved].sort((a, b) => a[0] - b[0]);
	return { patch: withKeys(layer, prop, next), index: next.indexOf(moved) };
}

/** Changes a key's value. */
export function setKeyValue(layer: Json, prop: KeyProp, index: number, value: number | string) {
	const ks = [...(keysOf(layer)[prop] ?? [])];
	if (!ks[index]) return {};
	ks[index] = key(ks[index][0], value, ks[index][2]);
	return withKeys(layer, prop, ks);
}

/** Changes the ease from a key to the next (undefined = linear, the default). */
export function setKeyEase(layer: Json, prop: KeyProp, index: number, ease: Ease | undefined) {
	const ks = [...(keysOf(layer)[prop] ?? [])];
	if (!ks[index]) return {};
	ks[index] = key(ks[index][0], ks[index][1], ease);
	return withKeys(layer, prop, ks);
}

/** Deletes a key (the property stops animating with its last one). */
export function removeKey(layer: Json, prop: KeyProp, index: number) {
	return withKeys(
		layer,
		prop,
		(keysOf(layer)[prop] ?? []).filter((_, i) => i !== index),
	);
}

/** Removes every key of a property: it goes back to its rest value. */
export function clearKeys(layer: Json, prop: KeyProp) {
	return withKeys(layer, prop, []);
}

// ---------------------------------------------------------------------------
// Enter and exit presets
// ---------------------------------------------------------------------------

export interface PresetEntry {
	preset: (typeof MOTION_PRESETS)[number];
	atMs: number;
	durationMs?: number;
	ease?: Ease;
	amount?: number;
}

export type PresetSide = "enter" | "exit";

/** A spec allows at most this many presets on each side. */
export const MAX_PRESETS = 6;

/** A layer's enter or exit presets as a list (a spec may give one on its own). */
export function presetsOf(layer: Json, side: PresetSide): PresetEntry[] {
	const v = layer[side] as PresetEntry | PresetEntry[] | undefined;
	return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function withPresets(side: PresetSide, list: PresetEntry[]): Json {
	return { [side]: list.length ? list : undefined };
}

/** How long a preset takes when it doesn't say. */
export function presetDuration(entry: PresetEntry): number {
	return entry.durationMs ?? PRESET_MS[entry.preset];
}

/** What a preset's amount means (undefined when it takes none), and its default. */
export function presetAmount(
	preset: PresetEntry["preset"],
): { label: string; fallback: number } | undefined {
	switch (preset) {
		case "rise":
		case "fall":
			return { label: "px", fallback: 60 };
		case "slideLeft":
		case "slideRight":
			return { label: "px", fallback: 120 };
		case "grow":
			return { label: "from ×", fallback: 0 };
		case "pop":
			return { label: "from ×", fallback: 0.6 };
		case "blur":
			return { label: "px", fallback: 40 };
		case "spin":
			return { label: "°", fallback: -90 };
		default:
			return undefined;
	}
}

/**
 * Adds a preset: an entrance starts where the last one ends (or at the layer's
 * start); an exit ends at the layer's end (or just before the next exit).
 */
export function addPreset(spec: Json, layer: Json, side: PresetSide): Json {
	const list = presetsOf(layer, side);
	if (list.length >= MAX_PRESETS) return {};
	const end = Math.min(
		Number(layer.endMs ?? spec.durationMs ?? 3000),
		Number(spec.durationMs ?? 3000),
	);
	const preset: PresetEntry["preset"] = "fade";
	let atMs: number;
	if (side === "enter") {
		const last = list[list.length - 1];
		atMs = last ? last.atMs + presetDuration(last) : Number(layer.startMs ?? 0);
	} else {
		const first = list[0];
		atMs = (first ? first.atMs : end) - PRESET_MS[preset];
	}
	return withPresets(side, [...list, { preset, atMs: tidy(atMs) }]);
}

/** Changes one preset; a new preset kind drops an amount that meant something else. */
export function updatePreset(
	layer: Json,
	side: PresetSide,
	index: number,
	patch: Partial<PresetEntry>,
): Json {
	const list = presetsOf(layer, side);
	if (!list[index]) return {};
	const next: PresetEntry = { ...list[index], ...patch };
	if (patch.preset && patch.preset !== list[index].preset && !presetAmount(patch.preset))
		delete next.amount;
	for (const k of Object.keys(next) as (keyof PresetEntry)[])
		if (next[k] === undefined) delete next[k];
	if (next.atMs !== undefined) next.atMs = tidy(next.atMs);
	return withPresets(
		side,
		list.map((e, i) => (i === index ? next : e)),
	);
}

/** Removes one preset. */
export function removePreset(layer: Json, side: PresetSide, index: number): Json {
	return withPresets(
		side,
		presetsOf(layer, side).filter((_, i) => i !== index),
	);
}
