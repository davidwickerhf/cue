import { textWidth } from "./motionSpec";

/**
 * Layers of a motion spec as the Motion page shows and edits them: listed in
 * drawing order with their place in the tree, changed one at a time without
 * touching the rest of the spec, and boxed on the frame so they can be picked
 * and dragged. Specs are plain JSON here (as stored), so nothing is lost.
 */

type Json = Record<string, unknown>;

export interface LayerRow {
	/** Indices from the top of the spec down to this layer (groups nest). */
	path: number[];
	depth: number;
	type: string;
	name: string;
	layer: Json;
}

/** Every layer, top of the stack first (as layer panels list them), groups before their children. */
export function listLayers(spec: Json): LayerRow[] {
	const out: LayerRow[] = [];
	const walk = (layers: Json[], path: number[], depth: number) => {
		for (let i = layers.length - 1; i >= 0; i--) {
			const layer = layers[i];
			const here = [...path, i];
			const type = String(layer.type ?? "layer");
			out.push({ path: here, depth, type, name: layerName(layer, type), layer });
			if (type === "group" && Array.isArray(layer.layers))
				walk(layer.layers as Json[], here, depth + 1);
		}
	};
	walk((spec.layers as Json[]) ?? [], [], 0);
	return out;
}

function layerName(layer: Json, type: string): string {
	if (typeof layer.name === "string" && layer.name) return layer.name;
	if (type === "text" && typeof layer.text === "string")
		return layer.text.split("\n")[0].slice(0, 40) || "Text";
	return type[0].toUpperCase() + type.slice(1);
}

/** The layer at `path`, or undefined. */
export function layerAt(spec: Json, path: number[]): Json | undefined {
	let layers = spec.layers as Json[] | undefined;
	let found: Json | undefined;
	for (const i of path) {
		found = layers?.[i];
		layers = found?.layers as Json[] | undefined;
	}
	return found;
}

/**
 * A copy of the spec with the layer at `path` changed: keys in `patch` are set,
 * and keys set to undefined are removed (so a property goes back to its default).
 */
export function updateLayer(spec: Json, path: number[], patch: Json): Json {
	const change = (layers: Json[], rest: number[]): Json[] =>
		layers.map((layer, i) => {
			if (i !== rest[0]) return layer;
			if (rest.length > 1)
				return { ...layer, layers: change(layer.layers as Json[], rest.slice(1)) };
			const next: Json = { ...layer, ...patch };
			for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
			return next;
		});
	if (!path.length) throw new Error("No layer chosen.");
	return { ...spec, layers: change((spec.layers as Json[]) ?? [], path) };
}

/** Moves a layer up or down its own list (1 = towards the front). */
export function reorderLayer(
	spec: Json,
	path: number[],
	by: 1 | -1,
): { spec: Json; path: number[] } {
	const parentPath = path.slice(0, -1);
	const i = path[path.length - 1];
	const siblings = parentPath.length
		? (layerAt(spec, parentPath)?.layers as Json[])
		: (spec.layers as Json[]);
	const j = i + by;
	if (!siblings || j < 0 || j >= siblings.length) return { spec, path };
	const swapped = [...siblings];
	[swapped[i], swapped[j]] = [swapped[j], swapped[i]];
	const next = parentPath.length
		? updateLayer(spec, parentPath, { layers: swapped })
		: { ...spec, layers: swapped };
	return { spec: next, path: [...parentPath, j] };
}

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * Where a layer sits at rest, in composition pixels, for picking and dragging on
 * the preview: shapes, pictures, text, lines (their points) and groups (their layers).
 */
export function layerBox(spec: Json, layer: Json): Box | null {
	const W = Number(spec.width ?? 1920);
	const H = Number(spec.height ?? 1080);
	const x = Number(layer.x ?? W / 2);
	const y = Number(layer.y ?? H / 2);
	const type = layer.type;
	if (type === "rect" || type === "ellipse" || type === "image" || type === "arc") {
		const w = Number(layer.width ?? 0);
		const h = Number(layer.height ?? 0);
		if (!w || !h) return null;
		const origin = String(layer.origin ?? "center");
		const left = origin.includes("left") ? x : origin.includes("right") ? x - w : x - w / 2;
		const top =
			origin === "top" || origin.startsWith("top")
				? y
				: origin.startsWith("bottom")
					? y - h
					: y - h / 2;
		return { left, top, right: left + w, bottom: top + h };
	}
	if ((type === "line" || type === "path") && Array.isArray(layer.points) && layer.points.length) {
		const pts = layer.points as [number, number][];
		const pad = Number(layer.strokeWidth ?? 4) / 2 + 6;
		const xs = pts.map((p) => p[0]);
		const ys = pts.map((p) => p[1]);
		return {
			left: Math.min(...xs) - pad,
			top: Math.min(...ys) - pad,
			right: Math.max(...xs) + pad,
			bottom: Math.max(...ys) + pad,
		};
	}
	if (type === "group" && Array.isArray(layer.layers)) {
		const boxes = (layer.layers as Json[])
			.map((l) => layerBox(spec, l))
			.filter((b): b is Box => !!b);
		if (!boxes.length) return null;
		return {
			left: Math.min(...boxes.map((b) => b.left)),
			top: Math.min(...boxes.map((b) => b.top)),
			right: Math.max(...boxes.map((b) => b.right)),
			bottom: Math.max(...boxes.map((b) => b.bottom)),
		};
	}
	if (type === "text" && typeof layer.text === "string") {
		const size = Number(layer.size ?? 48);
		const lines = layer.text.split("\n");
		const font = (layer.font as "sans" | "serif" | "display" | "mono") ?? "sans";
		const weight = Number(layer.weight ?? 600);
		const width = Math.max(
			...lines.map((l) =>
				textWidth(l, size, font, Number(layer.tracking ?? 0), weight, !!layer.italic),
			),
		);
		const height = size * (1 + (lines.length - 1) * Number(layer.lineHeight ?? 1.2));
		const align = layer.align ?? "left";
		const left = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
		const top =
			layer.anchor === "top" ? y : layer.anchor === "baseline" ? y - size * 0.8 : y - height / 2;
		return { left, top, right: left + width, bottom: top + height };
	}
	return null;
}

/** The topmost layer whose box contains a point (composition pixels), for clicking on the preview. */
export function layerAtPoint(spec: Json, px: number, py: number): LayerRow | undefined {
	return listLayers(spec).find((row) => {
		// Clicks pick what is drawn, not the group around it (groups are picked in the list).
		if (row.layer.hidden || row.type === "group") return false;
		const box = layerBox(spec, row.layer);
		return !!box && px >= box.left && px <= box.right && py >= box.top && py <= box.bottom;
	});
}

/**
 * A layer moved by dx, dy (composition pixels): its x and y, the points of a line,
 * or everything in a group (and the point it turns around).
 */
export function moveLayer(spec: Json, path: number[], dx: number, dy: number): Json {
	// Keyed positions move along, so an animated layer's whole path shifts.
	const shiftKeys = (layer: Json): Json => {
		const keys = layer.keys as Record<string, [number, number, ...unknown[]][]> | undefined;
		if (!keys?.x && !keys?.y) return {};
		const by = (ks: [number, number, ...unknown[]][] | undefined, d: number) =>
			ks?.map(([ms, v, ...ease]) => [ms, Math.round(Number(v) + d), ...ease]);
		return {
			keys: {
				...keys,
				...(keys.x ? { x: by(keys.x, dx) } : {}),
				...(keys.y ? { y: by(keys.y, dy) } : {}),
			},
		};
	};
	const shift = (layer: Json): Json => {
		if (layer.type === "group" && Array.isArray(layer.layers)) {
			const pivot = layer.pivot as [number, number] | undefined;
			// Its pivot is drawn at x, y: with the pivot moved, a set (or keyed) x, y moves too.
			// Without a pivot, the children moving is the whole move.
			return {
				...layer,
				layers: (layer.layers as Json[]).map(shift),
				...(pivot
					? {
							pivot: [pivot[0] + dx, pivot[1] + dy],
							...(layer.x !== undefined ? { x: Math.round(Number(layer.x) + dx) } : {}),
							...(layer.y !== undefined ? { y: Math.round(Number(layer.y) + dy) } : {}),
							...shiftKeys(layer),
						}
					: {}),
			};
		}
		if (Array.isArray(layer.points))
			return {
				...layer,
				points: (layer.points as [number, number][]).map(([x, y]) => [
					Math.round((x + dx) * 10) / 10,
					Math.round((y + dy) * 10) / 10,
				]),
			};
		const W = Number(spec.width ?? 1920);
		const H = Number(spec.height ?? 1080);
		return {
			...layer,
			x: Math.round(Number(layer.x ?? W / 2) + dx),
			y: Math.round(Number(layer.y ?? H / 2) + dy),
			...shiftKeys(layer),
		};
	};
	const layer = layerAt(spec, path);
	if (!layer) throw new Error("No layer there.");
	const moved = shift(layer);
	return updateLayer(spec, path, moved);
}

/** Finds a layer by its name (first match, top of the stack first) or by a path like "1.0". */
export function findLayer(spec: Json, ref: string): LayerRow | undefined {
	const rows = listLayers(spec);
	if (/^\d+(\.\d+)*$/.test(ref)) return rows.find((r) => r.path.join(".") === ref);
	return (
		rows.find((r) => r.name === ref) ?? rows.find((r) => r.name.toLowerCase() === ref.toLowerCase())
	);
}
