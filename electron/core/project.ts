import { z } from "zod";
import { TRANSITION_KINDS } from "./transitions";
import type {
	AiSettings,
	Asset,
	Bin,
	Clip,
	DenoiseMode,
	ExportSettings,
	LineStatus,
	LineView,
	MediaClip,
	ProjectData,
	RecordingSettings,
	ScriptLine,
	TextStyle,
	Track,
	Transform,
} from "./types";

/** Cue project files: JSON inside, so they diff and version well. */
/** Colour labels for clips, as in every NLE's Label menu. */
export const CLIP_LABELS = ["red", "orange", "yellow", "green", "blue", "purple", "pink"] as const;

export const PROJECT_EXTENSION = ".cueproj";
/** Projects saved by earlier versions. */
export const LEGACY_EXTENSION = ".cue.json";

export function isProjectFile(file: string): boolean {
	return file.endsWith(PROJECT_EXTENSION) || file.endsWith(LEGACY_EXTENSION);
}

export const DEFAULT_SETTINGS: RecordingSettings = {
	prerollMs: 1500,
	postrollMs: 1200,
	autoStop: true,
	monitor: "mute",
	padMs: 250,
	silenceDb: -42,
	useProxies: true,
	separateAudio: true,
};

export const DEFAULT_EXPORT: ExportSettings = {
	stemsDir: "stems",
	stemPattern: "{id}.wav",
	normalize: false,
	voiceoverFile: "export/voiceover.wav",
	videoFile: "export/{name}.mp4",
	videoQuality: "standard",
	codec: "h264",
	hardware: true,
	scale: 1,
	captionsFile: "export/{name}.srt",
};

export const DEFAULT_AI: AiSettings = {
	ttsModel: "gpt-4o-mini-tts",
	voice: "cedar",
	voiceInstructions: "Natural, warm and conversational. Clear, moderate pace.",
	transcriptionModel: "gpt-4o-transcribe",
	imageModel: "gpt-image-1",
};

export const NO_CROP = { left: 0, top: 0, right: 0, bottom: 0 };
export const DEFAULT_TRANSFORM: Transform = { x: 0.5, y: 0.5, scale: 1, opacity: 1, crop: NO_CROP };

export const DEFAULT_TEXT_STYLE: TextStyle = {
	fontFamily: "DM Sans Variable",
	fontSize: 64,
	fontWeight: 700,
	color: "#ffffff",
	background: "rgba(15, 23, 42, 0.72)",
	align: "center",
	x: 0.5,
	y: 0.82,
	width: 0.8,
	padding: 20,
	radius: 14,
	shadow: true,
	uppercase: false,
	letterSpacing: 0,
	lineHeight: 1.2,
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const id = z.string().min(1).max(80);

export const DENOISE_MODES = ["off", "light", "voice"] as const;
/** Older projects and agents use true/false; true meant the light (FFT) filter. */
export const denoiseSchema = z
	.union([z.boolean(), z.enum(DENOISE_MODES)])
	.transform((v): DenoiseMode => (v === true ? "light" : v === false ? "off" : v));
const ms = z.number().min(0);

export const lineInputSchema = z.object({
	id,
	text: z.string().max(4000),
	startMs: ms,
	targetMs: ms.optional(),
	maxMs: ms.optional(),
	section: z.string().max(120).optional(),
	notes: z.string().max(2000).optional(),
});
export type LineInput = z.infer<typeof lineInputSchema>;

export const cropSchema = z.object({
	left: z.number().min(0).max(0.45),
	top: z.number().min(0).max(0.45),
	right: z.number().min(0).max(0.45),
	bottom: z.number().min(0).max(0.45),
});

export const transformSchema = z.object({
	x: z.number().min(-1).max(2),
	y: z.number().min(-1).max(2),
	scale: z.number().min(0.05).max(10),
	opacity: z.number().min(0).max(1),
	crop: cropSchema.default(NO_CROP),
});

export const textStyleSchema = z.object({
	fontFamily: z.string().min(1).max(120),
	fontSize: z.number().min(6).max(600),
	fontWeight: z.number().min(100).max(1000),
	color: z.string().max(60),
	background: z.string().max(60).nullable(),
	align: z.enum(["left", "center", "right"]),
	x: z.number().min(-0.5).max(1.5),
	y: z.number().min(-0.5).max(1.5),
	width: z.number().min(0.05).max(1.5),
	padding: z.number().min(0).max(200),
	radius: z.number().min(0).max(200),
	shadow: z.boolean(),
	uppercase: z.boolean(),
	letterSpacing: z.number().min(-10).max(50),
	lineHeight: z.number().min(0.6).max(3),
	italic: z.boolean().optional(),
	strokeColor: z.string().max(60).nullable().optional(),
	strokeWidth: z.number().min(0).max(40).optional(),
	gradientTo: z.string().max(60).nullable().optional(),
	rotation: z.number().min(-180).max(180).optional(),
});

const animation = z.enum(["none", "fade", "pop", "slide-up", "slide-left", "zoom", "typewriter"]);

export const settingsSchema = z.object({
	prerollMs: z.number().min(0).max(10000),
	postrollMs: z.number().min(0).max(10000),
	autoStop: z.boolean(),
	monitor: z.enum(["mute", "timeline"]),
	padMs: z.number().min(0).max(2000),
	silenceDb: z.number().min(-80).max(-10),
	useProxies: z.boolean(),
	separateAudio: z.boolean(),
});

export const EASES = ["linear", "ease", "ease-in", "ease-out", "hold", "bezier"] as const;
/** Bezier handles: x within 0–1 so time only runs forward; y may overshoot. */
export const curveSchema = z.tuple([
	z.number().min(0).max(1),
	z.number().min(-2).max(3),
	z.number().min(0).max(1),
	z.number().min(-2).max(3),
]);
export const keyframeSchema = z.object({
	atMs: z.number().min(0),
	value: z.number(),
	ease: z.enum(EASES).default("ease"),
	curve: curveSchema.optional(),
});
export const zoomSchema = z.object({
	id: z.string(),
	startMs: z.number().min(0),
	endMs: z.number().min(0),
	scale: z.number().min(1).max(6),
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1),
	easeMs: z.number().min(0).max(3000).default(450),
});
export const colorSchema = z.object({
	brightness: z.number().min(-1).max(1),
	contrast: z.number().min(0).max(3),
	saturation: z.number().min(0).max(3),
	temperature: z.number().min(-1).max(1),
	lut: z.string().optional(),
});
export const maskSchema = z.object({
	shape: z.enum(["rectangle", "ellipse"]),
	x: z.number().min(-0.5).max(1.5),
	y: z.number().min(-0.5).max(1.5),
	width: z.number().min(0.01).max(2),
	height: z.number().min(0.01).max(2),
	feather: z.number().min(0).max(1),
	invert: z.boolean(),
});
export const DEFAULT_MASK = {
	shape: "ellipse" as const,
	x: 0.5,
	y: 0.5,
	width: 0.6,
	height: 0.6,
	feather: 0.15,
	invert: false,
};
export const keySchema = z.object({
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
	similarity: z.number().min(0.01).max(0.6),
	blend: z.number().min(0).max(0.5),
});
export const DEFAULT_KEY = { color: "#00ff00", similarity: 0.15, blend: 0.08 };
export const effectsSchema = z.object({
	blur: z.number().min(0).max(1),
	sharpen: z.number().min(0).max(1),
	vignette: z.number().min(0).max(1),
	glow: z.number().min(0).max(1),
	stabilize: z.boolean(),
});
export const NO_EFFECTS = { blur: 0, sharpen: 0, vignette: 0, glow: 0, stabilize: false };
export const NEUTRAL_COLOR = { brightness: 0, contrast: 1, saturation: 1, temperature: 0 };
export const transitionSchema = z.object({
	kind: z.enum(TRANSITION_KINDS),
	durationMs: z.number().min(40).max(5000),
});

export const exportSchema = z.object({
	stemsDir: z.string().min(1),
	stemPattern: z.string().min(1),
	normalize: z.boolean(),
	voiceoverFile: z.string().min(1),
	videoFile: z.string().min(1),
	videoQuality: z.enum(["draft", "standard", "high"]),
	codec: z.enum(["h264", "hevc", "prores"]),
	hardware: z.boolean(),
	scale: z.number().min(0.1).max(2),
	captionsFile: z.string().min(1),
});

export const aiSchema = z.object({
	ttsModel: z.string().min(1),
	voice: z.string().min(1),
	voiceInstructions: z.string().max(2000),
	transcriptionModel: z.string().min(1),
	imageModel: z.string().min(1),
});

export const mediaInfoSchema = z.object({
	format: z.string().optional(),
	videoCodec: z.string().optional(),
	videoProfile: z.string().optional(),
	pixelFormat: z.string().optional(),
	fps: z.number().optional(),
	bitrateKbps: z.number().optional(),
	audioCodec: z.string().optional(),
	audioChannels: z.number().optional(),
	channelLayout: z.string().optional(),
	sampleRate: z.number().optional(),
	creationTime: z.string().optional(),
	rotation: z.number().optional(),
	probedAt: z.string(),
});

export const binSchema = z.object({
	id,
	name: z.string().min(1).max(120),
	parentId: z.string().optional(),
});

const assetSchema = z.object({
	id,
	kind: z.enum(["video", "audio", "image", "adjustment"]),
	name: z.string(),
	path: z.string(),
	relPath: z.string().optional(),
	size: z.number().optional(),
	sequenceId: z.string().optional(),
	durationMs: ms,
	width: z.number().default(0),
	height: z.number().default(0),
	hasAudio: z.boolean().default(false),
	origin: z.enum(["import", "recording", "tts", "generated"]),
	createdAt: z.string(),
	lineId: z.string().optional(),
	recordedAtMs: z.number().optional(),
	speechStartMs: z.number().optional(),
	speechEndMs: z.number().optional(),
	peakDb: z.number().nullable().optional(),
	generation: z
		.object({
			provider: z.string(),
			model: z.string(),
			prompt: z.string(),
			voice: z.string().optional(),
		})
		.optional(),
	actor: z.enum(["user", "agent", "system"]).default("user"),
	binId: z.string().optional(),
	tags: z.array(z.string().max(60)).optional(),
	rating: z.number().int().min(0).max(5).optional(),
	note: z.string().max(4000).optional(),
	info: mediaInfoSchema.optional(),
	transcript: z
		.object({
			model: z.string(),
			createdAt: z.string(),
			words: z.array(z.object({ text: z.string(), startMs: z.number(), endMs: z.number() })),
		})
		.optional(),
});

const eqBand = z.number().min(-12).max(12);
export const trackEqSchema = z.object({ low: eqBand, mid: eqBand, high: eqBand });

export const trackCompressorSchema = z.object({ amount: z.number().min(0).max(1) });

const trackSchema = z.object({
	id,
	kind: z.enum(["video", "audio", "text"]),
	name: z.string().max(80),
	muted: z.boolean().default(false),
	locked: z.boolean().default(false),
	hidden: z.boolean().default(false),
	volume: z.number().min(0).max(2).default(1),
	voiceover: z.boolean().optional(),
	duck: z.boolean().optional(),
	solo: z.boolean().optional(),
	pan: z.number().min(-1).max(1).optional(),
	eq: trackEqSchema.optional(),
	compressor: trackCompressorSchema.optional(),
});

const mediaClipSchema = z.object({
	id,
	type: z.literal("media"),
	trackId: id,
	assetId: id,
	startMs: ms,
	durationMs: z.number().min(1),
	inMs: ms.default(0),
	speed: z.number().min(0.1).max(8).default(1),
	volume: z.number().min(0).max(2).default(1),
	fadeInMs: ms.default(0),
	fadeOutMs: ms.default(0),
	transform: transformSchema.default(DEFAULT_TRANSFORM),
	denoise: denoiseSchema.default("off"),
	keyframes: z.record(z.enum(["x", "y", "scale", "volume"]), z.array(keyframeSchema)).optional(),
	zooms: z.array(zoomSchema).optional(),
	color: colorSchema.optional(),
	mask: maskSchema.optional(),
	key: keySchema.optional(),
	effects: effectsSchema.optional(),
	transitionIn: transitionSchema.optional(),
	groupId: z.string().optional(),
	disabled: z.boolean().optional(),
	label: z.enum(CLIP_LABELS).optional(),
	lineId: z.string().optional(),
	name: z.string().max(120).optional(),
});

export const shapeSchema = z.object({
	kind: z.enum(["rect", "ellipse", "line", "arrow"]),
	width: z.number().min(-2).max(2),
	height: z.number().min(-2).max(2),
	fill: z.string().max(60).nullable(),
	stroke: z.string().max(60).nullable(),
	strokeWidth: z.number().min(0).max(80),
	radius: z.number().min(0).max(400),
});
export const DEFAULT_SHAPE = {
	kind: "rect" as const,
	width: 0.3,
	height: 0.2,
	fill: null,
	stroke: "#ffd60a",
	strokeWidth: 8,
	radius: 16,
};

export const captionWordSchema = z.object({
	text: z.string().max(200),
	startMs: z.number().min(0),
	endMs: z.number().min(0),
});
export const wordStyleSchema = z.object({
	mode: z.enum(["highlight", "reveal", "pop", "bounce"]),
	color: z.string().max(60),
});

const textClipSchema = z.object({
	id,
	type: z.literal("text"),
	trackId: id,
	startMs: ms,
	durationMs: z.number().min(1),
	text: z.string().max(4000),
	style: textStyleSchema.partial().transform((style) => ({ ...DEFAULT_TEXT_STYLE, ...style })),
	animationIn: animation.default("fade"),
	animationOut: animation.default("fade"),
	source: z.object({ kind: z.literal("caption"), assetId: z.string().optional() }).optional(),
	words: z.array(captionWordSchema).max(400).optional(),
	wordStyle: wordStyleSchema.optional(),
	shape: shapeSchema.optional(),
	groupId: z.string().optional(),
	disabled: z.boolean().optional(),
	label: z.enum(CLIP_LABELS).optional(),
	name: z.string().max(120).optional(),
});

export const clipSchema = z.discriminatedUnion("type", [mediaClipSchema, textClipSchema]);

const markerSchema = z.object({
	id,
	atMs: ms,
	label: z.string().max(200),
	color: z.enum(["accent", "success", "warning", "danger"]),
});

const projectSchema = z.object({
	version: z.literal(2),
	sequence: z.object({ id: z.string(), name: z.string().max(120) }).optional(),
	sequences: z
		.array(
			z.object({
				id: z.string(),
				name: z.string().max(120),
				tracks: z.array(z.lazy(() => trackSchema)),
				clips: z.array(z.lazy(() => clipSchema)),
				markers: z.array(markerSchema).default([]),
			}),
		)
		.optional(),
	name: z.string().min(1).max(200),
	canvas: z
		.object({
			width: z.number().int().min(16).max(7680),
			height: z.number().int().min(16).max(4320),
			fps: z.number().min(1).max(120),
			background: z.string().max(60),
		})
		.default({ width: 1920, height: 1080, fps: 30, background: "#000000" }),
	assets: z.array(assetSchema).default([]),
	bins: z.array(binSchema).default([]),
	tracks: z.array(trackSchema).default([]),
	clips: z.array(clipSchema).default([]),
	lines: z.array(lineInputSchema).default([]),
	markers: z
		.array(
			z.object({
				id,
				atMs: ms,
				label: z.string().max(200),
				color: z.enum(["accent", "success", "warning", "danger"]),
			}),
		)
		.default([]),
	settings: settingsSchema.partial().default({}),
	export: exportSchema.partial().default({}),
	ai: aiSchema.partial().default({}),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
/** Short, sortable, collision-resistant ids. */
export function newId(prefix: string): string {
	idCounter = (idCounter + 1) % 1296;
	return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 5)}`;
}

/** Fill defaults for a line: max falls back to 1.25 × target, target to 0.8 × max, both to 6 s. */
export function normaliseLine(input: LineInput): ScriptLine {
	const target = input.targetMs ?? (input.maxMs !== undefined ? input.maxMs * 0.8 : 6000);
	const max = input.maxMs ?? Math.max(target * 1.25, target + 500);
	return {
		id: input.id.trim(),
		text: input.text.trim(),
		startMs: Math.round(input.startMs),
		targetMs: Math.round(target),
		maxMs: Math.round(Math.max(max, 1)),
		...(input.section ? { section: input.section } : {}),
		...(input.notes ? { notes: input.notes } : {}),
	};
}

export function sortLines(lines: ScriptLine[]): ScriptLine[] {
	return [...lines].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

export function assertUnique(ids: string[], what: string): void {
	const seen = new Set<string>();
	for (const value of ids) {
		if (seen.has(value)) throw new Error(`Duplicate ${what} id "${value}".`);
		seen.add(value);
	}
}

function pick<T extends object>(defaults: T, raw: Partial<T>): T {
	return {
		...defaults,
		...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)),
	} as T;
}

export function defaultTracks(): Track[] {
	return [
		{ id: "T1", kind: "text", name: "Text", muted: false, locked: false, hidden: false, volume: 1 },
		{
			id: "V1",
			kind: "video",
			name: "Video",
			muted: false,
			locked: false,
			hidden: false,
			volume: 1,
		},
		{
			id: "A1",
			kind: "audio",
			name: "Voiceover",
			muted: false,
			locked: false,
			hidden: false,
			volume: 1,
			voiceover: true,
		},
		{
			id: "A2",
			kind: "audio",
			name: "Music",
			muted: false,
			locked: false,
			hidden: false,
			volume: 0.6,
			duck: true,
		},
	];
}

export function emptyProject(name: string): ProjectData {
	return {
		version: 2,
		name,
		canvas: { width: 1920, height: 1080, fps: 30, background: "#000000" },
		assets: [],
		bins: [],
		tracks: defaultTracks(),
		clips: [],
		lines: [],
		markers: [],
		settings: { ...DEFAULT_SETTINGS },
		export: { ...DEFAULT_EXPORT },
		ai: { ...DEFAULT_AI },
	};
}

export function parseProject(raw: unknown): ProjectData {
	const parsed = projectSchema.parse(raw);
	const lines = sortLines(parsed.lines.map((line) => normaliseLine(line)));
	assertUnique(
		lines.map((line) => line.id),
		"line",
	);
	assertUnique(
		parsed.assets.map((asset) => asset.id),
		"asset",
	);
	assertUnique(
		parsed.tracks.map((track) => track.id),
		"track",
	);
	const bins = tidyBins(parsed.bins);
	const binIds = new Set(bins.map((b) => b.id));
	assertUnique(
		parsed.clips.map((clip) => clip.id),
		"clip",
	);
	return {
		version: 2,
		name: parsed.name,
		canvas: parsed.canvas,
		// Media filed in a bin that no longer exists goes back to the top level.
		assets: parsed.assets.map((a) =>
			a.binId && !binIds.has(a.binId) ? { ...a, binId: undefined } : a,
		) as Asset[],
		bins,
		tracks: groupTracks(parsed.tracks as Track[]),
		clips: parsed.clips as Clip[],
		lines,
		markers: parsed.markers,
		settings: pick(DEFAULT_SETTINGS, parsed.settings),
		export: pick(DEFAULT_EXPORT, parsed.export),
		ai: pick(DEFAULT_AI, parsed.ai),
		...(parsed.sequence ? { sequence: parsed.sequence } : {}),
		...(parsed.sequences?.length
			? {
					sequences: parsed.sequences.map((q) => ({
						...q,
						tracks: groupTracks(q.tracks as Track[]),
						clips: q.clips as Clip[],
					})),
				}
			: {}),
	};
}

/**
 * Keeps bins consistent after loading: unique ids, parents that exist, and
 * only one level of nesting (a bin inside a sub-bin moves up a level).
 */
export function tidyBins(bins: Bin[]): Bin[] {
	const seen = new Set<string>();
	const unique = bins.filter((b) => !seen.has(b.id) && seen.add(b.id));
	const top = new Set(unique.filter((b) => !b.parentId).map((b) => b.id));
	return unique.map((b) =>
		b.parentId && !top.has(b.parentId) ? { id: b.id, name: b.name } : { ...b },
	);
}

export const clipEnd = (clip: Clip) => clip.startMs + clip.durationMs;

/** Source length consumed by a media clip. */
export const sourceSpan = (clip: MediaClip) => clip.durationMs * clip.speed;

export function projectDuration(data: ProjectData): number {
	return data.clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0);
}

export function voiceoverTrack(data: ProjectData): Track | undefined {
	return (
		data.tracks.find((track) => track.voiceover) ??
		data.tracks.find((track) => track.kind === "audio")
	);
}

export function lineStatus(line: ScriptLine, speechMs: number | null): LineStatus {
	if (speechMs === null) return "empty";
	if (speechMs > line.maxMs) return "over";
	if (speechMs > line.maxMs - 300) return "tight";
	return "ok";
}

export function speechOf(asset: Asset) {
	const start = asset.speechStartMs ?? 0;
	const end = asset.speechEndMs ?? asset.durationMs;
	return { startMs: start, endMs: end, lengthMs: Math.max(0, end - start) };
}

export function deriveLines(data: ProjectData): LineView[] {
	return data.lines.map((line, index) => {
		const takes = data.assets.filter((asset) => asset.lineId === line.id);
		const clip = data.clips.find(
			(candidate): candidate is MediaClip =>
				candidate.type === "media" && candidate.lineId === line.id,
		);
		const chosen = clip ? takes.find((asset) => asset.id === clip.assetId) : undefined;
		const speech = chosen ? speechOf(chosen) : null;
		return {
			...line,
			index,
			takes,
			chosenAssetId: chosen?.id ?? null,
			clipId: clip?.id ?? null,
			status: lineStatus(line, speech ? speech.lengthMs : null),
			speechMs: speech ? speech.lengthMs : null,
			placementMs:
				clip && speech ? clip.startMs + Math.max(0, speech.startMs - clip.inMs) / clip.speed : null,
		};
	});
}

export function stemName(pattern: string, lineId: string, index: number): string {
	return pattern
		.replaceAll("{id}", lineId)
		.replaceAll("{index}", String(index + 1).padStart(2, "0"));
}

/** A media clip for a voiceover take, trimmed to the speech plus padding. */
export function takeClip(
	asset: Asset,
	trackId: string,
	padMs: number,
	lineStartMs: number,
): MediaClip {
	const speech = speechOf(asset);
	const inMs = Math.max(0, speech.startMs - padMs);
	const outMs = Math.min(asset.durationMs, speech.endMs + padMs);
	// Recordings stay where they were spoken; generated takes start their speech on the line's start.
	const startMs =
		asset.recordedAtMs !== undefined
			? asset.recordedAtMs + inMs
			: lineStartMs - (speech.startMs - inMs);
	return {
		id: newId("c"),
		type: "media",
		trackId,
		assetId: asset.id,
		startMs: Math.max(0, Math.round(startMs)),
		durationMs: Math.max(1, Math.round(outMs - inMs)),
		inMs: Math.round(inMs),
		speed: 1,
		volume: 1,
		fadeInMs: 0,
		fadeOutMs: 0,
		transform: { ...DEFAULT_TRANSFORM },
		denoise: "off",
		lineId: asset.lineId,
		name: asset.lineId ? `${asset.lineId} · ${asset.name}` : asset.name,
	};
}

/** A track is heard unless muted, or unless another track is soloed. */
export function trackAudible(data: ProjectData, track: Track): boolean {
	if (track.muted) return false;
	const soloing = data.tracks.some((t) => t.solo);
	return !soloing || !!track.solo;
}

/**
 * Picture tracks (video and text) sit above sound tracks, with a divider
 * between them, as in Premiere, Resolve and Final Cut. Order within each
 * group is kept.
 */
export function groupTracks(tracks: Track[]): Track[] {
	return [...tracks.filter((t) => t.kind !== "audio"), ...tracks.filter((t) => t.kind === "audio")];
}
