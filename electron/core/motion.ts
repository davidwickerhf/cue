/**
 * Motion graphics: Lottie animations, the format After Effects exports through
 * Bodymovin or the LottieFiles plug-in (.json, or .lottie, a zip with the
 * animation and its pictures). Cue plays them as media: they sit on picture
 * tracks and can be moved, scaled, keyframed and graded like video. Their text
 * layers and colours can be changed per clip without touching the file, the way
 * a template's Essential Graphics are edited in Premiere.
 *
 * Only data is read from these files: expressions run inside the player's own
 * WebAssembly engine, never as JavaScript in the app.
 */

// biome-ignore lint/suspicious/noExplicitAny: Lottie documents are loosely typed JSON.
export type LottieJson = Record<string, any>;

/** A text layer that can be rewritten. `id` is stable for the file (layer name, numbered when repeated). */
export interface MotionText {
	id: string;
	text: string;
	/** The precomposition the layer is in; none for the main composition. */
	comp?: string;
	/** Drawn from glyph outlines stored in the file, so only those letters exist. */
	glyphs?: boolean;
}

/** A named point in the animation (After Effects composition markers). */
export interface MotionMarker {
	name: string;
	startMs: number;
	durationMs: number;
}

/** What Cue knows about a motion graphic, read once on import. */
export interface MotionInfo {
	fps: number;
	/** First and last frame of the animation (Lottie ip and op). */
	inFrame: number;
	outFrame: number;
	texts: MotionText[];
	/** Every colour the animation uses, most used first, as #rrggbb. */
	colors: string[];
	markers: MotionMarker[];
	/** Font families the text layers ask for. */
	fonts: string[];
	/** Parts the designer exposed for theming (Lottie slots). */
	slots?: string[];
	/** Pictures inside the animation. */
	images?: number;
	/** After Effects version it was exported from, when known. */
	version?: string;
}

/** Per-clip changes to a motion graphic. */
export interface MotionSettings {
	/** Repeat the animation for as long as the clip lasts (otherwise it holds its last frame). */
	loop?: boolean;
	/** New text per text layer id. */
	text?: Record<string, string>;
	/** Colour replacements: original #rrggbb → new #rrggbb. */
	colors?: Record<string, string>;
}

export const MOTION_EXTENSIONS = [".json", ".lottie"];

/** Whether parsed JSON looks like a Lottie animation. */
export function isLottie(json: unknown): json is LottieJson {
	if (!json || typeof json !== "object") return false;
	const j = json as LottieJson;
	return (
		typeof j.fr === "number" &&
		typeof j.ip === "number" &&
		typeof j.op === "number" &&
		typeof j.w === "number" &&
		typeof j.h === "number" &&
		Array.isArray(j.layers)
	);
}

// ---------------------------------------------------------------------------
// Walking the document
// ---------------------------------------------------------------------------

/** Every composition: the main one ("") and each precomposition, with its layers. */
function compositions(json: LottieJson): { comp: string; layers: LottieJson[] }[] {
	const out = [{ comp: "", layers: (json.layers ?? []) as LottieJson[] }];
	for (const asset of json.assets ?? [])
		if (Array.isArray(asset?.layers))
			out.push({ comp: String(asset.id ?? ""), layers: asset.layers });
	return out;
}

/** Text layers in a fixed order, with ids that are the same every time the file is read. */
function textLayers(json: LottieJson): { id: string; comp: string; layer: LottieJson }[] {
	const seen = new Map<string, number>();
	const out: { id: string; comp: string; layer: LottieJson }[] = [];
	for (const { comp, layers } of compositions(json)) {
		for (const layer of layers) {
			if (layer?.ty !== 5 || !Array.isArray(layer.t?.d?.k)) continue;
			const base = String(layer.nm ?? "Text").trim() || "Text";
			const n = (seen.get(base) ?? 0) + 1;
			seen.set(base, n);
			out.push({ id: n === 1 ? base : `${base} ${n}`, comp, layer });
		}
	}
	return out;
}

type Rgb = number[];

/** Lottie colours are 0–1 (some old exports use 0–255). */
function toHex(c: Rgb): string | null {
	if (!Array.isArray(c) || c.length < 3 || c.slice(0, 3).some((v) => typeof v !== "number"))
		return null;
	const big = c.slice(0, 3).some((v) => v > 1);
	return `#${c
		.slice(0, 3)
		.map((v) =>
			Math.round(Math.max(0, Math.min(255, big ? v : v * 255)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

function fromHex(hex: string, like: Rgb): Rgb {
	const n = Number.parseInt(hex.slice(1), 16);
	const big = like.slice(0, 3).some((v) => v > 1);
	const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (big ? v : v / 255));
	return [...rgb, ...like.slice(3)];
}

/**
 * Calls `visit` for every colour in the document (fills, strokes, gradient stops,
 * text, solids, colour effects) with a setter to replace it.
 */
function eachColor(json: LottieJson, visit: (hex: string, set: (hex: string) => void) => void) {
	const rgb = (holder: LottieJson, key: string | number) => {
		const value = holder?.[key];
		const hex = toHex(value);
		if (hex) visit(hex, (next) => (holder[key] = fromHex(next, value)));
	};
	/** An animatable property holding a colour (static, or keyframed with s and e values). */
	const prop = (p: LottieJson | undefined) => {
		if (!p || typeof p !== "object") return;
		if (p.a === 1 && Array.isArray(p.k))
			for (const key of p.k) {
				if (key && typeof key === "object") {
					rgb(key, "s");
					rgb(key, "e");
				}
			}
		else rgb(p, "k");
	};
	/** Gradient stops: the first `count` groups of four are offset, r, g, b. */
	const gradient = (g: LottieJson | undefined) => {
		if (!g?.k) return;
		const count = Number(g.p) || 0;
		const stops = (values: number[] | undefined) => {
			if (!Array.isArray(values)) return;
			for (let i = 0; i < count && i * 4 + 3 < values.length; i++) {
				const at = i * 4 + 1;
				const hex = toHex(values.slice(at, at + 3));
				if (hex)
					visit(hex, (next) => {
						const [r, gg, b] = fromHex(next, values.slice(at, at + 3));
						values[at] = r;
						values[at + 1] = gg;
						values[at + 2] = b;
					});
			}
		};
		if (g.k.a === 1 && Array.isArray(g.k.k))
			for (const key of g.k.k) {
				stops(key?.s);
				stops(key?.e);
			}
		else stops(g.k.k);
	};
	const shapes = (items: LottieJson[] | undefined) => {
		for (const item of items ?? []) {
			if (!item || typeof item !== "object") continue;
			if (item.ty === "fl" || item.ty === "st") prop(item.c);
			if (item.ty === "gf" || item.ty === "gs") gradient(item.g);
			if (item.ty === "gr") shapes(item.it);
		}
	};
	const effects = (list: LottieJson[] | undefined) => {
		for (const e of list ?? []) {
			if (!e || typeof e !== "object") continue;
			if (e.ty === 2) prop(e.v);
			effects(e.ef);
		}
	};
	for (const { layers } of compositions(json)) {
		for (const layer of layers) {
			if (!layer || typeof layer !== "object") continue;
			if (layer.ty === 1 && typeof layer.sc === "string" && /^#[0-9a-f]{6}$/i.test(layer.sc)) {
				const hex = layer.sc.toLowerCase();
				visit(hex, (next) => (layer.sc = next));
			}
			shapes(layer.shapes);
			effects(layer.ef);
			if (layer.ty === 5)
				for (const key of layer.t?.d?.k ?? []) {
					rgb(key?.s, "fc");
					rgb(key?.s, "sc");
				}
		}
	}
}

/** Reads what can be changed in a motion graphic. */
export function motionInfo(json: LottieJson): MotionInfo {
	const glyphs = Array.isArray(json.chars) && json.chars.length > 0;
	const texts: MotionText[] = textLayers(json).map(({ id, comp, layer }) => ({
		id,
		// After Effects writes line breaks as \r, and soft breaks (in paragraph text) as \u0003.
		text: String(layer.t.d.k[0]?.s?.t ?? "")
			.replace(/\r/g, "\n")
			.split(String.fromCharCode(3))
			.join("\n"),
		...(comp ? { comp } : {}),
		...(glyphs ? { glyphs: true } : {}),
	}));
	const counts = new Map<string, number>();
	eachColor(json, (hex) => counts.set(hex, (counts.get(hex) ?? 0) + 1));
	const colors = [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([hex]) => hex)
		.slice(0, 32);
	const fps = json.fr > 0 ? json.fr : 30;
	const markers: MotionMarker[] = (Array.isArray(json.markers) ? json.markers : [])
		.map((m: LottieJson) => ({
			name: markerName(m.cm),
			startMs: Math.round((((m.tm ?? 0) - json.ip) / fps) * 1000),
			durationMs: Math.round(((m.dr ?? 0) / fps) * 1000),
		}))
		.filter((m: MotionMarker) => m.name);
	const fonts = [
		...new Set<string>(
			(json.fonts?.list ?? [])
				.map((f: LottieJson) => String(f.fFamily ?? f.fName ?? ""))
				.filter(Boolean),
		),
	];
	const slots = json.slots && typeof json.slots === "object" ? Object.keys(json.slots) : [];
	const images = (json.assets ?? []).filter(
		(a: LottieJson) => typeof a?.p === "string" && !a.layers,
	).length;
	return {
		fps,
		inFrame: json.ip,
		outFrame: json.op,
		texts,
		colors,
		markers,
		fonts,
		...(slots.length ? { slots } : {}),
		...(images ? { images } : {}),
		...(json.v ? { version: String(json.v) } : {}),
	};
}

/** Marker comments are plain names, or JSON like {"name": "intro"} from some exporters. */
function markerName(cm: unknown): string {
	const raw = String(cm ?? "").trim();
	if (raw.startsWith("{"))
		try {
			const parsed = JSON.parse(raw);
			return String(parsed.name ?? parsed.cm ?? raw).trim();
		} catch {}
	return raw;
}

/** The animation's length in ms. */
export function motionDurationMs(info: Pick<MotionInfo, "fps" | "inFrame" | "outFrame">): number {
	return Math.max(1, Math.round(((info.outFrame - info.inFrame) / info.fps) * 1000));
}

/** A copy of the document with a clip's text and colour changes applied. */
export function applyMotion(json: LottieJson, settings: MotionSettings | undefined): LottieJson {
	const text = settings?.text ?? {};
	const colors = Object.fromEntries(
		Object.entries(settings?.colors ?? {}).map(([from, to]) => [
			from.toLowerCase(),
			to.toLowerCase(),
		]),
	);
	if (!Object.keys(text).length && !Object.keys(colors).length) return json;
	const copy = structuredClone(json);
	for (const { id, layer } of textLayers(copy)) {
		if (text[id] === undefined) continue;
		for (const key of layer.t.d.k) if (key?.s) key.s.t = text[id].replace(/\r?\n/g, "\r");
	}
	if (Object.keys(colors).length)
		eachColor(copy, (hex, set) => {
			const next = colors[hex];
			if (next && /^#[0-9a-f]{6}$/.test(next)) set(next);
		});
	return copy;
}

/** A short key for a clip's changes, to reuse a prepared player. */
export function motionKey(settings: MotionSettings | undefined): string {
	if (!settings?.text && !settings?.colors) return "";
	return JSON.stringify([settings.text ?? {}, settings.colors ?? {}]);
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const OUTRO = /^(out|outro|end|exit|animate ?out)\b/i;

/**
 * The animation frame to show `localMs` into a clip. Past the end the last frame
 * holds (or the animation repeats when looping). When the file marks where its
 * outro starts (a marker named "out" or "outro"), a longer clip holds before the
 * outro and plays the outro as the clip ends, like a lower-third template.
 */
export function motionFrameAt(
	info: Pick<MotionInfo, "fps" | "inFrame" | "outFrame" | "markers">,
	clip: { inMs: number; speed: number; durationMs: number; motion?: MotionSettings },
	localMs: number,
): number {
	const total = ((info.outFrame - info.inFrame) / info.fps) * 1000;
	const last = info.inFrame + Math.max(0, info.outFrame - info.inFrame - 1);
	let source = clip.inMs + localMs * clip.speed;
	if (clip.motion?.loop && total > 0) source = ((source % total) + total) % total;
	else {
		const outro = info.markers.find((m) => OUTRO.test(m.name));
		if (outro && outro.startMs > clip.inMs) {
			const outroLength = total - outro.startMs;
			const clipLength = clip.inMs + clip.durationMs * clip.speed;
			if (clipLength > total) {
				// Hold just before the outro, then play it so it ends with the clip.
				const outroStartsAt = clipLength - outroLength;
				source =
					source >= outroStartsAt
						? outro.startMs + (source - outroStartsAt)
						: Math.min(source, outro.startMs - 1000 / info.fps);
			}
		}
	}
	const frame = info.inFrame + (source / 1000) * info.fps;
	return Math.max(info.inFrame, Math.min(last, frame));
}
