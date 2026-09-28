import {
	clearKeys,
	type Key,
	type KeyProp,
	keyableProps,
	keysOf,
	type PresetEntry,
	type PresetSide,
	presetDuration,
	presetsOf,
	removeKey,
	setKey,
	valueAt,
} from "./motionKeys";
import { layerAt, updateLayer } from "./motionLayers";
import { EASES, type Ease } from "./motionSpec";

/**
 * The Motion page's timeline, as pure edits of a spec: keys picked across
 * layers and moved, deleted, eased, copied and pasted together; a property
 * switched between animated and still (the stopwatch); a layer trimmed or slid
 * along the time with its keys and its enter and exit presets. Every function
 * returns a new spec (or a patch for one layer) and leaves the input alone.
 */

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Picked keys
// ---------------------------------------------------------------------------

/** A key picked on the timeline: its layer, its property and its time (unique per property). */
export interface KeySel {
	path: number[];
	prop: KeyProp;
	ms: number;
}

/** A stable id for a picked key. */
export const selId = (s: KeySel) => `${s.path.join(".")}|${s.prop}|${Math.round(s.ms)}`;

const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) < tol;
const tidy = (ms: number) => Math.max(0, Math.round(ms));

/** The picked keys grouped by layer and property, with their places in the key list. */
function byProperty(spec: Json, sel: KeySel[]) {
	const out = new Map<string, { path: number[]; prop: KeyProp; indices: number[] }>();
	for (const s of sel) {
		const layer = layerAt(spec, s.path);
		const ks = layer ? keysOf(layer)[s.prop] : undefined;
		const i = ks?.findIndex((k) => near(k[0], s.ms)) ?? -1;
		if (i < 0) continue;
		const id = `${s.path.join(".")}|${s.prop}`;
		const entry = out.get(id) ?? { path: s.path, prop: s.prop, indices: [] };
		if (!entry.indices.includes(i)) entry.indices.push(i);
		out.set(id, entry);
	}
	return [...out.values()];
}

/** Sets one property's keys in a spec (an empty list removes the property's keys). */
function withPropKeys(spec: Json, path: number[], prop: KeyProp, ks: Key[]): Json {
	const layer = layerAt(spec, path);
	if (!layer) return spec;
	const next: Json = { ...keysOf(layer) };
	if (ks.length) next[prop] = ks;
	else delete next[prop];
	return updateLayer(spec, path, { keys: Object.keys(next).length ? next : undefined });
}

/** How far picked keys can move: none before 0 or past the graphic's end. */
export function clampKeyDelta(spec: Json, sel: KeySel[], deltaMs: number): number {
	if (!sel.length) return 0;
	const end = Number(spec.durationMs ?? 3000);
	const times = sel.map((s) => s.ms);
	const lo = -Math.min(...times);
	const hi = end - Math.max(...times);
	return Math.min(hi, Math.max(lo, deltaMs)) || 0;
}

/**
 * Moves picked keys by the same time (clamped to the graphic). A key landing on
 * one that wasn't picked replaces it. Returns the spec and the keys' new picks.
 */
export function moveKeys(
	spec: Json,
	sel: KeySel[],
	deltaMs: number,
): { spec: Json; sel: KeySel[] } {
	const delta = Math.round(clampKeyDelta(spec, sel, deltaMs));
	if (!delta) return { spec, sel };
	let next = spec;
	const moved: KeySel[] = [];
	for (const g of byProperty(spec, sel)) {
		const ks = keysOf(layerAt(spec, g.path) as Json)[g.prop] ?? [];
		const going = g.indices.map((i) => ks[i]);
		const shifted: Key[] = going.map((k) => [tidy(k[0] + delta), ...k.slice(1)] as Key);
		const staying = ks.filter(
			(k, i) => !g.indices.includes(i) && !shifted.some((m) => near(m[0], k[0])),
		);
		const list = [...staying, ...shifted].sort((a, b) => a[0] - b[0]);
		next = withPropKeys(next, g.path, g.prop, list);
		for (const k of shifted) moved.push({ path: g.path, prop: g.prop, ms: k[0] });
	}
	return { spec: next, sel: moved };
}

/** Deletes picked keys (a property with none left stops animating). */
export function deleteKeys(spec: Json, sel: KeySel[]): Json {
	let next = spec;
	for (const g of byProperty(spec, sel)) {
		const ks = keysOf(layerAt(next, g.path) as Json)[g.prop] ?? [];
		next = withPropKeys(
			next,
			g.path,
			g.prop,
			ks.filter((_, i) => !g.indices.includes(i)),
		);
	}
	return next;
}

/** Every key of a layer (or of one of its properties) as picks, e.g. to pick them all. */
export function keysAsSel(layer: Json, path: number[], prop?: KeyProp): KeySel[] {
	const keys = keysOf(layer);
	return (Object.keys(keys) as KeyProp[])
		.filter((p) => !prop || p === prop)
		.flatMap((p) => (keys[p] ?? []).map((k) => ({ path, prop: p, ms: k[0] })));
}

// ---------------------------------------------------------------------------
// Interpolation: key glyphs and After Effects' ease commands
// ---------------------------------------------------------------------------

/** How one side of a key moves: straight, eased (slowing near it) or holding (jumping). */
export type KeySide = "linear" | "eased" | "hold";

type Handles = [number, number, number, number];
const LINEAR: Handles = [0, 0, 1, 1];

function handlesOf(ease: Ease | undefined): Handles {
	if (!ease || ease === "hold") return [...LINEAR];
	return [...(typeof ease === "string" ? EASES[ease] : ease)] as Handles;
}

/** A handle on the diagonal leaves the curve straight at that end. */
const straight = (x: number, y: number) => Math.abs(x - y) < 0.02;

/**
 * The two halves of a key's glyph, as After Effects draws them: the left half
 * is how the curve arrives (the previous key's ease), the right how it leaves
 * (this key's ease). The first key has no arrival, so it mirrors its departure.
 */
export function keyGlyph(ks: Key[], i: number): { in: KeySide; out: KeySide } {
	const own = ks[i]?.[2];
	const [x1, y1] = handlesOf(own);
	const out: KeySide = own === "hold" ? "hold" : straight(x1, y1) ? "linear" : "eased";
	if (i === 0) return { in: out === "hold" ? "linear" : out, out };
	const prev = ks[i - 1]?.[2];
	const [, , x2, y2] = handlesOf(prev);
	return { in: prev === "hold" ? "hold" : straight(x2, y2) ? "linear" : "eased", out };
}

/** After Effects' key interpolation commands. */
export type Interpolation = "linear" | "easy" | "easeIn" | "easeOut" | "hold";

/** Which command a key's glyph matches (for a check mark in its menu). */
export function interpolationOf(ks: Key[], i: number): Interpolation | undefined {
	const g = keyGlyph(ks, i);
	if (g.out === "hold") return "hold";
	if (g.in === "linear" && g.out === "linear") return "linear";
	if (g.in === "eased" && g.out === "eased") return "easy";
	if (g.in === "eased" && g.out === "linear") return "easeIn";
	if (g.in === "linear" && g.out === "eased") return "easeOut";
	return undefined;
}

/**
 * Handles as the schema writes them: a named ease when one matches (linear is
 * no ease at all), else the curve itself.
 */
export function easeFromHandles(h: Handles): Ease | undefined {
	const r = h.map((v) => Math.round(v * 1000) / 1000) as Handles;
	for (const [name, c] of Object.entries(EASES))
		if (c.every((v, j) => Math.abs(v - r[j]) < 1e-6))
			return name === "linear" ? undefined : (name as Ease);
	return r;
}

/** Easy Ease's handles: CSS's ease-in-out, so a key eased on both sides reads "inOut". */
const EASY_OUT: [number, number] = [0.42, 0];
const EASY_IN: [number, number] = [0.58, 1];

const withEase = (k: Key, ease: Ease | undefined): Key =>
	ease === undefined ? [k[0], k[1]] : [k[0], k[1], ease];

/**
 * Applies an interpolation command to a key, like After Effects: Easy Ease
 * eases both sides, Ease In the arrival (the end of the previous stretch), Ease
 * Out the departure, Linear straightens both, Hold keeps the value until the
 * next key. A held arrival stays held (that belongs to the previous key).
 */
export function setInterpolation(ks: Key[], i: number, mode: Interpolation): Key[] {
	const next = [...ks];
	const k = next[i];
	if (!k) return ks;
	const setOut = (handle: [number, number]) => {
		const h = handlesOf(k[2] === "hold" ? undefined : k[2]);
		next[i] = withEase(k, easeFromHandles([handle[0], handle[1], h[2], h[3]]));
	};
	const setIn = (handle: [number, number]) => {
		const p = next[i - 1];
		if (!p || p[2] === "hold") return;
		const h = handlesOf(p[2]);
		next[i - 1] = withEase(p, easeFromHandles([h[0], h[1], handle[0], handle[1]]));
	};
	switch (mode) {
		case "hold":
			next[i] = withEase(k, "hold");
			break;
		case "linear":
			setOut([0, 0]);
			setIn([1, 1]);
			break;
		case "easy":
			setOut(EASY_OUT);
			setIn(EASY_IN);
			break;
		case "easeIn":
			// The first key has no arrival: it eases as a whole instead.
			if (i === 0) setOut(EASY_OUT);
			else setIn(EASY_IN);
			break;
		case "easeOut":
			setOut(EASY_OUT);
			break;
	}
	return next;
}

/** Applies an interpolation command to every picked key. */
export function interpolateKeys(spec: Json, sel: KeySel[], mode: Interpolation): Json {
	let next = spec;
	for (const g of byProperty(spec, sel)) {
		let ks = keysOf(layerAt(next, g.path) as Json)[g.prop] ?? [];
		for (const i of [...g.indices].sort((a, b) => a - b)) ks = setInterpolation(ks, i, mode);
		next = withPropKeys(next, g.path, g.prop, ks);
	}
	return next;
}

/** Sets the ease from every picked key to the next (undefined = linear). */
export function easeKeys(spec: Json, sel: KeySel[], ease: Ease | undefined): Json {
	let next = spec;
	for (const g of byProperty(spec, sel)) {
		const ks = [...(keysOf(layerAt(next, g.path) as Json)[g.prop] ?? [])];
		for (const i of g.indices) ks[i] = withEase(ks[i], ease);
		next = withPropKeys(next, g.path, g.prop, ks);
	}
	return next;
}

// ---------------------------------------------------------------------------
// Copy and paste
// ---------------------------------------------------------------------------

/** Copied keys, timed from the earliest one. */
export type KeyClipboard = {
	prop: KeyProp;
	offsetMs: number;
	value: number | string;
	ease?: Ease;
}[];

export function copyKeys(spec: Json, sel: KeySel[]): KeyClipboard {
	const found: KeyClipboard = [];
	for (const g of byProperty(spec, sel)) {
		const ks = keysOf(layerAt(spec, g.path) as Json)[g.prop] ?? [];
		for (const i of g.indices)
			found.push({ prop: g.prop, offsetMs: ks[i][0], value: ks[i][1], ease: ks[i][2] });
	}
	if (!found.length) return [];
	const first = Math.min(...found.map((c) => c.offsetMs));
	return found
		.map((c) => ({ ...c, offsetMs: c.offsetMs - first }))
		.sort((a, b) => a.offsetMs - b.offsetMs);
}

/**
 * Pastes copied keys onto the same properties of a layer, the earliest at
 * `atMs` (keys already there take the pasted values). Properties the layer
 * can't animate are skipped, and nothing lands past the graphic's end.
 */
export function pasteKeys(
	spec: Json,
	path: number[],
	clip: KeyClipboard,
	atMs: number,
): { spec: Json; sel: KeySel[] } {
	let next = spec;
	const sel: KeySel[] = [];
	const end = Number(spec.durationMs ?? 3000);
	for (const c of clip) {
		const layer = layerAt(next, path);
		if (!layer) break;
		const keyable = keyableProps(layer).includes(c.prop) || !!keysOf(layer)[c.prop];
		const ms = tidy(atMs + c.offsetMs);
		if (!keyable || ms > end) continue;
		next = updateLayer(next, path, setKey(layer, c.prop, ms, c.value, c.ease).patch);
		sel.push({ path, prop: c.prop, ms });
	}
	return { spec: next, sel };
}

// ---------------------------------------------------------------------------
// One property: stopwatch, value at the playhead, key navigation
// ---------------------------------------------------------------------------

/**
 * The patch that makes a property still at a value, or null when the layer
 * has no still form of it (only arcs have a still trim).
 */
export function restPatch(layer: Json, prop: KeyProp, value: number | string): Json | null {
	const type = String(layer.type);
	const n = Number(value);
	const scale = layer.scale as number | [number, number] | undefined;
	const [sx, sy] = Array.isArray(scale) ? scale : [scale ?? 1, scale ?? 1];
	switch (prop) {
		case "x":
		case "y":
		case "rotation":
			return { [prop]: n };
		case "opacity":
			return { opacity: Math.min(1, Math.max(0, n)) };
		case "width":
		case "height":
			return { [prop]: Math.max(0, n) };
		case "blur":
			return { blur: Math.min(400, Math.max(0, n)) };
		case "scale":
			return { scale: Array.isArray(scale) && sx !== sy && sx ? [n, (sy * n) / sx] : n };
		case "scaleX":
			return { scale: [n, sy] };
		case "scaleY":
			return { scale: [sx, n] };
		case "trimStart":
			return type === "arc" ? { from: Math.min(1, Math.max(0, n)) } : null;
		case "trimEnd":
			return type === "arc" ? { to: Math.min(1, Math.max(0, n)) } : null;
		case "color": {
			const hex = String(value);
			if (type === "line" || (typeof layer.stroke === "string" && typeof layer.fill !== "string"))
				return { stroke: hex };
			if (type === "text") return { color: hex };
			return { fill: hex };
		}
	}
}

/** A value as a key stores it: numbers rounded (a little finer than they show). */
export function keyValue(value: number | string, digits = 3): number | string {
	return typeof value === "number" ? Number(value.toFixed(Math.max(digits, 2))) : value;
}

/** Turns the stopwatch on: a key at `ms` with the value the property has there. */
export function startAnimating(spec: Json, layer: Json, prop: KeyProp, ms: number): Json {
	return setKey(layer, prop, ms, keyValue(valueAt(spec, layer, prop, ms))).patch;
}

/** Turns the stopwatch off: the keys go, and the value at `ms` stays as the still value. */
export function stopAnimating(spec: Json, layer: Json, prop: KeyProp, ms: number): Json {
	const value = keyValue(valueAt(spec, layer, prop, ms));
	return { ...(restPatch(layer, prop, value) ?? {}), ...clearKeys(layer, prop) };
}

/**
 * Sets a property's value as seen at `ms`: an animated one gets (or updates) a
 * key there; a still one changes its value (or starts animating when it has no
 * still form).
 */
export function setValueAt(layer: Json, prop: KeyProp, ms: number, value: number | string): Json {
	if (keysOf(layer)[prop]?.length) return setKey(layer, prop, ms, value).patch;
	return restPatch(layer, prop, value) ?? setKey(layer, prop, ms, value).patch;
}

/** The index of a property's key at `ms` (within `tol` ms), or -1. */
export function keyIndexAt(layer: Json, prop: KeyProp, ms: number, tol = 0.5): number {
	return (keysOf(layer)[prop] ?? []).findIndex((k) => near(k[0], ms, tol));
}

/** The diamond between the arrows: removes the key at `ms`, or adds one with the value there. */
export function toggleKeyAt(spec: Json, layer: Json, prop: KeyProp, ms: number, tol = 0.5): Json {
	const i = keyIndexAt(layer, prop, ms, tol);
	if (i >= 0) return removeKey(layer, prop, i);
	return startAnimating(spec, layer, prop, ms);
}

/**
 * The time of the nearest key before (-1) or after (1) `ms`: of one property,
 * or of all a layer's keys and its in and out points (J and K). Undefined when
 * there is none.
 */
export function nextKeyTime(
	spec: Json,
	layer: Json,
	ms: number,
	dir: -1 | 1,
	prop?: KeyProp,
	tol = 0.5,
): number | undefined {
	const keys = keysOf(layer);
	const times = prop
		? (keys[prop] ?? []).map((k) => k[0])
		: [
				...Object.values(keys).flatMap((ks) => (ks ?? []).map((k) => k[0])),
				...Object.values(layerSpan(spec, layer)),
			];
	const ahead = times.filter((t) => (dir > 0 ? t > ms + tol : t < ms - tol));
	if (!ahead.length) return undefined;
	return dir > 0 ? Math.min(...ahead) : Math.max(...ahead);
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/**
 * Snaps a time to whole frames, and to any target (the playhead, a layer's
 * ends) within `tolMs`.
 */
export function snapTime(ms: number, fps: number, targets: number[] = [], tolMs = 0): number {
	let best: number | undefined;
	for (const t of targets)
		if (Math.abs(t - ms) <= tolMs && (best === undefined || Math.abs(t - ms) < Math.abs(best - ms)))
			best = t;
	if (best !== undefined) return best;
	const frame = 1000 / fps;
	return Math.round(ms / frame) * frame;
}

// ---------------------------------------------------------------------------
// A layer's time: trim, slide, preset lengths
// ---------------------------------------------------------------------------

/** When a layer shows: from its start to its end (the graphic's end when it gives none). */
export function layerSpan(spec: Json, layer: Json): { start: number; end: number } {
	const duration = Number(spec.durationMs ?? 3000);
	return {
		start: Number(layer.startMs ?? 0),
		end: Math.min(Number(layer.endMs ?? duration), duration),
	};
}

/** The shortest a layer, or a preset, can be. */
export const MIN_SPAN_MS = 10;

const shiftPresets = (list: PresetEntry[], by: number): PresetEntry[] =>
	list.map((p) => ({ ...p, atMs: tidy(p.atMs + by) }));

/**
 * Trims a layer's start or end to a time. Its keys stay where they are (as in
 * After Effects). An entrance that began at the old start follows the new one
 * (and an exit that ended at the old end the new end), so the layer still
 * comes in and goes out at its edges; others stay put unless the new edge
 * passes them, which pushes them inside. An end at the graphic's end is
 * written as no end at all.
 */
export function trimLayer(spec: Json, path: number[], edge: "start" | "end", ms: number): Json {
	const layer = layerAt(spec, path);
	if (!layer) return spec;
	const duration = Number(spec.durationMs ?? 3000);
	const { start, end } = layerSpan(spec, layer);
	const patch: Json = {};
	if (edge === "start") {
		const to = tidy(Math.min(end - MIN_SPAN_MS, Math.max(0, ms)));
		if (to === start) return spec;
		patch.startMs = to || undefined;
		const enter = presetsOf(layer, "enter");
		if (enter.length)
			patch.enter = enter.map((p) => ({
				...p,
				atMs: tidy(near(p.atMs, start, 1) ? to : Math.max(p.atMs, to)),
			}));
	} else {
		const to = tidy(Math.min(duration, Math.max(start + MIN_SPAN_MS, ms)));
		if (to === end) return spec;
		patch.endMs = to >= duration ? undefined : to;
		const exit = presetsOf(layer, "exit");
		if (exit.length)
			patch.exit = exit.map((p) => {
				const d = presetDuration(p);
				const ends = p.atMs + d;
				return { ...p, atMs: tidy(near(ends, end, 1) ? to - d : Math.min(p.atMs, to - d)) };
			});
	}
	return updateLayer(spec, path, patch);
}

/** Every time written on a layer (to keep a slide from pushing any below 0). */
function timesOf(layer: Json): number[] {
	const out: number[] = [];
	if (layer.startMs !== undefined) out.push(Number(layer.startMs));
	for (const ks of Object.values(keysOf(layer))) for (const k of ks ?? []) out.push(k[0]);
	for (const side of ["enter", "exit"] as const)
		for (const p of presetsOf(layer, side)) out.push(p.atMs);
	for (const f of ["follow", "count"] as const) {
		const v = layer[f] as { atMs?: number } | undefined;
		if (v?.atMs !== undefined) out.push(v.atMs);
	}
	for (const r of (layer.runs as Json[] | undefined) ?? []) out.push(...timesOf(r));
	for (const l of (layer.layers as Json[] | undefined) ?? []) out.push(...timesOf(l));
	return out;
}

/** A layer (or a text run) with every time it writes moved by `by`. */
function shifted(layer: Json, by: number, duration: number, top: boolean): Json {
	const next: Json = { ...layer };
	if (layer.startMs !== undefined || (top && by > 0)) {
		const s = tidy(Number(layer.startMs ?? 0) + by);
		next.startMs = s || undefined;
	}
	if (layer.endMs !== undefined || (top && by !== 0)) {
		const e = tidy(Number(layer.endMs ?? duration) + by);
		next.endMs = e;
	}
	const keys = keysOf(layer);
	if (Object.keys(keys).length)
		next.keys = Object.fromEntries(
			Object.entries(keys).map(([p, ks]) => [
				p,
				(ks ?? []).map((k) => [tidy(k[0] + by), ...k.slice(1)]),
			]),
		);
	for (const side of ["enter", "exit"] as const) {
		const v = layer[side] as PresetEntry | PresetEntry[] | undefined;
		if (v === undefined) continue;
		next[side] = Array.isArray(v) ? shiftPresets(v, by) : shiftPresets([v], by)[0];
	}
	for (const f of ["follow", "count"] as const) {
		const v = layer[f] as Json | undefined;
		if (v && typeof v.atMs === "number") next[f] = { ...v, atMs: tidy(v.atMs + by) };
	}
	if (Array.isArray(layer.runs))
		next.runs = (layer.runs as Json[]).map((r) => shifted(r, by, duration, false));
	if (Array.isArray(layer.layers))
		next.layers = (layer.layers as Json[]).map((l) => shifted(l, by, duration, false));
	for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
	return next;
}

/** How far a layer can slide: nothing it writes goes before 0 (its start stays in the graphic). */
export function clampSlide(spec: Json, path: number[], deltaMs: number): number {
	const layer = layerAt(spec, path);
	if (!layer) return 0;
	const duration = Number(spec.durationMs ?? 3000);
	const { start } = layerSpan(spec, layer);
	const lo = -Math.min(start, ...timesOf(layer));
	const hi = duration - MIN_SPAN_MS - start;
	return Math.round(Math.min(hi, Math.max(lo, deltaMs)));
}

/**
 * Slides a layer along the time: its start and end, keys, presets, route and
 * counter all move together (a group moves everything in it).
 */
export function slideLayer(spec: Json, path: number[], deltaMs: number): Json {
	const by = clampSlide(spec, path, deltaMs);
	const layer = layerAt(spec, path);
	if (!by || !layer) return spec;
	const duration = Number(spec.durationMs ?? 3000);
	const moved = shifted(layer, by, duration, true);
	// An end at the graphic's end is the same as none.
	if (Number(moved.endMs) === duration) delete moved.endMs;
	const patch: Json = { ...moved };
	for (const k of Object.keys(layer)) if (!(k in moved)) patch[k] = undefined;
	return updateLayer(spec, path, patch);
}

/**
 * Drags an edge of a preset: an entrance's end or an exit's start (its other
 * end stays put), or with `move` the whole preset. Returns the layer's patch.
 */
export function resizePreset(
	spec: Json,
	layer: Json,
	side: PresetSide,
	index: number,
	edge: "start" | "end" | "move",
	ms: number,
): Json {
	const list = presetsOf(layer, side);
	const p = list[index];
	if (!p) return {};
	const duration = Number(spec.durationMs ?? 3000);
	const d = presetDuration(p);
	let atMs = p.atMs;
	let len = d;
	if (edge === "move") atMs = Math.min(duration - MIN_SPAN_MS, Math.max(0, ms));
	else if (edge === "end") len = Math.max(MIN_SPAN_MS, Math.min(60000, ms - p.atMs));
	else {
		const end = p.atMs + d;
		atMs = Math.max(0, Math.min(end - MIN_SPAN_MS, ms));
		len = end - atMs;
	}
	const next: PresetEntry = { ...p, atMs: tidy(atMs), durationMs: Math.round(len) };
	return { [side]: list.map((e, i) => (i === index ? next : e)) };
}
