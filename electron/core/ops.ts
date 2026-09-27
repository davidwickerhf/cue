import { z } from "zod";
import { DEFAULT_CURVE, splitKeyframes, splitZooms, withKeyframe } from "./anim";
import { binPath } from "./bins";
import type { MotionSettings } from "./motion";
import {
	aiSchema,
	assertUnique,
	BLEND_MODES,
	CLIP_LABELS,
	captionWordSchema,
	clipEnd,
	colorSchema,
	cropSchema,
	curveSchema,
	DEFAULT_FRAME,
	DEFAULT_KEY,
	DEFAULT_MASK,
	DEFAULT_SHAPE,
	DEFAULT_TEXT_STYLE,
	DEFAULT_TRANSFORM,
	dataCalloutSchema,
	defaultTracks,
	denoiseSchema,
	EASES,
	effectsSchema,
	exportSchema,
	frameSchema,
	groupTracks,
	infographicSchema,
	KEYFRAME_PROPS,
	keyframeSchema,
	keySchema,
	lineInputSchema,
	maskSchema,
	motionSettingsSchema,
	NEUTRAL_COLOR,
	NO_CROP,
	NO_EFFECTS,
	newId,
	normaliseLine,
	settingsSchema,
	shapeSchema,
	sortLines,
	takeClip,
	textStyleSchema,
	trackCompressorSchema,
	trackEqSchema,
	transformSchema,
	transitionSchema,
	voiceoverTrack,
	wiggleSchema,
	wordStyleSchema,
} from "./project";
import { fadesIn, overlaps, transitionLabel } from "./transitions";
import type {
	Asset,
	Bin,
	CaptionWord,
	Clip,
	Keyframe,
	KeyframeProp,
	MediaClip,
	MediaInfo,
	ProjectData,
	TextClip,
	Track,
	TrackKind,
	WordStyle,
} from "./types";

/**
 * Every edit is one of these operations. The editor window, the control
 * server and the MCP bridge all use this list, so undo, autosave, validation
 * and the activity feed behave the same whoever makes the change.
 */
const ms = z.number();
const animation = z.enum(["none", "fade", "pop", "slide-up", "slide-left", "zoom", "typewriter"]);

export const mediaClipInput = z.object({
	type: z.literal("media"),
	id: z.string().optional(),
	trackId: z.string(),
	assetId: z.string(),
	startMs: ms.min(0),
	durationMs: ms.min(1).optional(),
	inMs: ms.min(0).optional(),
	speed: z.number().min(0.1).max(8).optional(),
	volume: z.number().min(0).max(2).optional(),
	fadeInMs: ms.min(0).optional(),
	fadeOutMs: ms.min(0).optional(),
	transform: transformSchema.partial().extend({ crop: cropSchema.partial() }).partial().optional(),
	denoise: denoiseSchema.optional(),
	name: z.string().max(120).optional(),
	/** false keeps a video's sound on the picture clip instead of an audio track (see settings.separateAudio). */
	linkedAudio: z.boolean().optional(),
	/** Clip-local keyframes per property (x, y, scale, volume). */
	keyframes: z
		.object({
			x: z.array(keyframeSchema).max(2000),
			y: z.array(keyframeSchema).max(2000),
			scale: z.array(keyframeSchema).max(2000),
			rotation: z.array(keyframeSchema).max(2000),
			opacity: z.array(keyframeSchema).max(2000),
			volume: z.array(keyframeSchema).max(2000),
		})
		.partial()
		.optional(),
	frame: frameSchema.partial().optional(),
	/** Blend with the tracks below (multiply for paper textures, screen for light leaks). */
	blend: z.enum(BLEND_MODES).optional(),
	wiggle: wiggleSchema.optional(),
	stepFps: z.number().min(1).max(60).optional(),
	/** Motion graphics: new text per text layer, colour swaps and looping. */
	motion: motionSettingsSchema.optional(),
});

export const textClipInput = z.object({
	type: z.literal("text"),
	id: z.string().optional(),
	trackId: z.string(),
	startMs: ms.min(0),
	durationMs: ms.min(1).optional(),
	text: z.string().max(4000),
	style: textStyleSchema.partial().optional(),
	animationIn: animation.optional(),
	animationOut: animation.optional(),
	name: z.string().max(120).optional(),
	/** Word timings (clip-local), for word-by-word captions. */
	words: z.array(captionWordSchema).max(400).optional(),
	/** A graphic under the text: box, ellipse, line or arrow (text may be empty). */
	shape: shapeSchema.partial().optional(),
	infographic: infographicSchema.optional(),
	dataCallout: dataCalloutSchema.optional(),
	wordStyle: wordStyleSchema.optional(),
});

export const clipInput = z.discriminatedUnion("type", [mediaClipInput, textClipInput]);

export const clipPatch = z
	.object({
		trackId: z.string(),
		startMs: ms.min(0),
		durationMs: ms.min(1),
		inMs: ms.min(0),
		speed: z.number().min(0.1).max(8),
		volume: z.number().min(0).max(2),
		fadeInMs: ms.min(0),
		fadeOutMs: ms.min(0),
		transform: transformSchema.partial().extend({ crop: cropSchema.partial() }).partial(),
		denoise: denoiseSchema,
		color: colorSchema.partial(),
		text: z.string().max(4000),
		style: textStyleSchema.partial(),
		animationIn: animation,
		animationOut: animation,
		name: z.string().max(120),
		disabled: z.boolean(),
		label: z.enum(CLIP_LABELS).nullable(),
		mask: maskSchema.partial().nullable(),
		key: keySchema.partial().nullable(),
		effects: effectsSchema.partial().nullable(),
		blend: z.enum(BLEND_MODES).nullable(),
		wiggle: wiggleSchema.partial().nullable(),
		stepFps: z.number().min(1).max(60).nullable(),
		frame: frameSchema.partial().nullable(),
		motion: motionSettingsSchema.nullable(),
		wordStyle: wordStyleSchema.nullable(),
		shape: shapeSchema.partial().nullable(),
		infographic: infographicSchema.partial().nullable(),
		dataCallout: dataCalloutSchema.partial().nullable(),
		words: z.array(captionWordSchema).max(400).nullable(),
	})
	.partial();

const trackPatch = z
	.object({
		name: z.string().min(1).max(80),
		muted: z.boolean(),
		locked: z.boolean(),
		hidden: z.boolean(),
		volume: z.number().min(0).max(2),
		voiceover: z.boolean(),
		duck: z.boolean(),
		solo: z.boolean(),
		pan: z.number().min(-1).max(1),
		/** Merged into the current EQ; null resets it to flat. */
		eq: trackEqSchema.partial().nullable(),
		compressor: trackCompressorSchema.nullable(),
	})
	.partial();

export const opSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("rename"), name: z.string().min(1).max(200) }),
	z.object({
		type: z.literal("setCanvas"),
		canvas: z
			.object({
				width: z.number().int().min(16).max(7680),
				height: z.number().int().min(16).max(4320),
				fps: z.number().min(1).max(120),
				background: z.string(),
			})
			.partial(),
	}),
	// Media library
	z.object({ type: z.literal("renameAsset"), id: z.string(), name: z.string().min(1).max(200) }),
	z.object({ type: z.literal("removeAsset"), id: z.string() }),
	// Bins (folders), tags, ratings and notes for media
	z.object({
		type: z.literal("createBin"),
		id: z.string().min(1).max(80).optional(),
		name: z.string().trim().min(1).max(120),
		parentId: z.string().optional(),
	}),
	z.object({
		type: z.literal("renameBin"),
		id: z.string(),
		name: z.string().trim().min(1).max(120),
	}),
	z.object({ type: z.literal("removeBin"), id: z.string() }),
	z.object({
		type: z.literal("moveMedia"),
		assetIds: z.array(z.string()).min(1),
		binId: z.string().nullable(),
	}),
	z.object({
		type: z.literal("tagMedia"),
		assetIds: z.array(z.string()).min(1),
		add: z.array(z.string().max(60)).optional(),
		remove: z.array(z.string().max(60)).optional(),
		rating: z.number().int().min(0).max(5).optional(),
		note: z.string().max(4000).optional(),
	}),
	// Tracks
	z.object({
		type: z.literal("addTrack"),
		kind: z.enum(["video", "audio", "text"]),
		name: z.string().max(80).optional(),
		index: z.number().int().optional(),
	}),
	z.object({ type: z.literal("updateTrack"), id: z.string(), patch: trackPatch }),
	z.object({ type: z.literal("removeTrack"), id: z.string() }),
	z.object({ type: z.literal("moveTrack"), id: z.string(), index: z.number().int().min(0) }),
	// Clips
	z.object({ type: z.literal("addClips"), clips: z.array(clipInput).min(1) }),
	z.object({ type: z.literal("updateClip"), id: z.string(), patch: clipPatch }),
	z.object({
		type: z.literal("moveClips"),
		ids: z.array(z.string()).min(1),
		deltaMs: ms,
		/** All the listed clips (and only them, not their linked clips) go to this track. */
		trackId: z.string().optional(),
		/** Per clip: the track it goes to, or "new" for a new track of its kind. Others keep theirs. */
		tracks: z.record(z.string(), z.string()).optional(),
		/** Moved clips replace what they land on (trimming, splitting or removing it), as in other editors. */
		overwrite: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("trimClip"),
		id: z.string(),
		edge: z.enum(["start", "end"]),
		toMs: ms.min(0),
	}),
	z.object({ type: z.literal("splitClip"), id: z.string(), atMs: ms }),
	z.object({ type: z.literal("splitAt"), atMs: ms, trackIds: z.array(z.string()).optional() }),
	z.object({
		type: z.literal("removeClips"),
		ids: z.array(z.string()).min(1),
		ripple: z.boolean().default(false),
	}),
	z.object({
		type: z.literal("duplicateClips"),
		ids: z.array(z.string()).min(1),
		offsetMs: ms.optional(),
		trackId: z.string().optional(),
	}),
	z.object({
		type: z.literal("removeRanges"),
		ranges: z.array(z.object({ startMs: ms.min(0), endMs: ms.min(0) })).min(1),
		trackIds: z.array(z.string()).optional(),
	}),
	z.object({ type: z.literal("detachAudio"), id: z.string(), trackId: z.string().optional() }),
	z.object({
		type: z.literal("addAdjustment"),
		trackId: z.string().optional(),
		startMs: ms.min(0),
		durationMs: ms.min(100).default(5000),
	}),
	z.object({
		type: z.literal("copyGrade"),
		fromClipId: z.string(),
		toClipIds: z.array(z.string()).min(1),
		/** Copy the picture effects (blur, sharpen, vignette, glow, stabilize) along with the colour. */
		effects: z.boolean().default(true),
	}),
	// Sequences (several timelines per project) and nesting
	z.object({
		type: z.literal("newSequence"),
		name: z.string().min(1).max(120),
		open: z.boolean().default(true),
		/** Start without the default tracks (e.g. when rebuilding an imported timeline). */
		empty: z.boolean().default(false),
	}),
	z.object({ type: z.literal("openSequence"), id: z.string() }),
	z.object({ type: z.literal("renameSequence"), id: z.string(), name: z.string().min(1).max(120) }),
	z.object({ type: z.literal("duplicateSequence"), id: z.string() }),
	z.object({ type: z.literal("deleteSequence"), id: z.string() }),
	/** An alternative cut: a copy of a timeline, named "… · alt N" and opened. */
	z.object({
		type: z.literal("branchSequence"),
		from: z.string().optional(),
		name: z.string().min(1).max(120).optional(),
	}),
	/** Keep a branch: it takes the original's name and the original becomes "… (old)". */
	z.object({ type: z.literal("promoteBranch"), id: z.string(), originalId: z.string().optional() }),
	z.object({
		type: z.literal("nestClips"),
		ids: z.array(z.string()).min(1),
		name: z.string().min(1).max(120).optional(),
	}),
	// Speed ramps: a stretch of a clip re-timed in short steps that ease between speeds
	z.object({
		type: z.literal("speedRamp"),
		clipId: z.string(),
		shape: z.enum(["up", "down", "inOut", "outIn"]),
		/** The fastest (or slowest) speed the ramp reaches. */
		peak: z.number().min(0.1).max(8),
		/** Part of the clip to ramp, in clip time (default: all of it). */
		fromMs: ms.min(0).optional(),
		toMs: ms.min(0).optional(),
		steps: z.number().int().min(3).max(24).default(10),
	}),
	// Three-point editing (Premiere: , insert and . overwrite; ; lift)
	z.object({
		type: z.literal("liftRange"),
		startMs: ms.min(0),
		endMs: ms.min(0),
		trackIds: z.array(z.string()).optional(),
	}),
	z.object({
		type: z.literal("insertEdit"),
		mode: z.enum(["insert", "overwrite"]),
		assetId: z.string(),
		trackId: z.string(),
		atMs: ms.min(0),
		inMs: ms.min(0).optional(),
		outMs: ms.min(0).optional(),
	}),
	// Keyframes, zooms, transitions and groups
	z.object({
		type: z.literal("setKeyframe"),
		clipId: z.string(),
		prop: z.enum(KEYFRAME_PROPS),
		keyframe: keyframeSchema,
	}),
	z.object({
		type: z.literal("removeKeyframe"),
		clipId: z.string(),
		prop: z.enum(KEYFRAME_PROPS),
		atMs: ms,
	}),
	// Several keyframes of one clip changed at once (a drag, a delete, an ease), one undo step.
	z.object({
		type: z.literal("editKeyframes"),
		clipId: z.string(),
		edits: z
			.array(
				z.object({
					prop: z.enum(KEYFRAME_PROPS),
					/** Which keyframe: the one within 10 ms of this clip-local time. */
					atMs: ms,
					toMs: ms.min(0).optional(),
					value: z.number().optional(),
					ease: z.enum(EASES).optional(),
					curve: curveSchema.optional(),
					remove: z.boolean().optional(),
				}),
			)
			.min(1),
	}),
	z.object({
		type: z.literal("clearKeyframes"),
		clipId: z.string(),
		prop: z.enum(KEYFRAME_PROPS).optional(),
	}),
	z.object({
		type: z.literal("addZoom"),
		clipId: z.string(),
		startMs: ms.min(0),
		endMs: ms.min(0),
		scale: z.number().min(1).max(6).default(1.8),
		x: z.number().min(0).max(1).default(0.5),
		y: z.number().min(0).max(1).default(0.5),
		easeMs: z.number().min(0).max(3000).default(450),
	}),
	z.object({
		type: z.literal("updateZoom"),
		clipId: z.string(),
		zoomId: z.string(),
		patch: z
			.object({
				startMs: ms.min(0),
				endMs: ms.min(0),
				scale: z.number().min(1).max(6),
				x: z.number().min(0).max(1),
				y: z.number().min(0).max(1),
				easeMs: z.number().min(0).max(3000),
			})
			.partial(),
	}),
	z.object({ type: z.literal("removeZoom"), clipId: z.string(), zoomId: z.string() }),
	z.object({ type: z.literal("addTransition"), clipId: z.string(), transition: transitionSchema }),
	z.object({ type: z.literal("removeTransition"), clipId: z.string() }),
	z.object({ type: z.literal("groupClips"), ids: z.array(z.string()).min(2) }),
	z.object({ type: z.literal("ungroupClips"), ids: z.array(z.string()).min(1) }),
	z.object({ type: z.literal("slipClip"), id: z.string(), deltaMs: ms }),
	z.object({
		type: z.literal("rollEdit"),
		leftId: z.string(),
		rightId: z.string(),
		toMs: ms.min(0),
	}),
	z.object({ type: z.literal("slideClip"), id: z.string(), deltaMs: ms }),
	// Voiceover script
	z.object({ type: z.literal("setLines"), lines: z.array(lineInputSchema) }),
	z.object({ type: z.literal("addLine"), line: lineInputSchema }),
	z.object({ type: z.literal("updateLine"), id: z.string(), patch: lineInputSchema.partial() }),
	z.object({ type: z.literal("removeLine"), id: z.string() }),
	z.object({
		type: z.literal("shiftLines"),
		fromMs: ms,
		deltaMs: ms,
		withClips: z.boolean().default(true),
	}),
	z.object({ type: z.literal("rippleFrom"), fromMs: z.number().min(0), deltaMs: z.number() }),
	z.object({ type: z.literal("chooseTake"), lineId: z.string(), assetId: z.string().nullable() }),
	z.object({ type: z.literal("deleteTake"), assetId: z.string() }),
	// Markers and settings
	z.object({
		type: z.literal("addMarker"),
		atMs: ms.min(0),
		label: z.string().max(200),
		color: z.enum(["accent", "success", "warning", "danger"]).default("accent"),
	}),
	z.object({ type: z.literal("removeMarker"), id: z.string() }),
	z.object({
		type: z.literal("updateMarker"),
		id: z.string(),
		patch: z
			.object({
				atMs: ms.min(0),
				label: z.string().max(200),
				color: z.enum(["accent", "success", "warning", "danger"]),
			})
			.partial(),
	}),
	z.object({ type: z.literal("clearMarkers"), label: z.string().optional() }),
	z.object({ type: z.literal("updateSettings"), settings: settingsSchema.partial() }),
	z.object({ type: z.literal("updateExport"), export: exportSchema.partial() }),
	z.object({ type: z.literal("updateAi"), ai: aiSchema.partial() }),
]);

export type Op = z.input<typeof opSchema>;
type ParsedOp = z.output<typeof opSchema>;

/** Internal operations produced by the store after media work, never sent by clients. */
export type InternalOp =
	| { type: "addAsset"; asset: Asset; placeOn?: { trackId: string; startMs: number } }
	| { type: "addTake"; asset: Asset }
	| { type: "setTranscript"; assetId: string; transcript: Asset["transcript"] }
	/** A nested sequence got longer or shorter: clips showing all of it follow, in every timeline. */
	| { type: "fitNested"; assetId: string; fromMs: number; toMs: number }
	/** Change fields of a media item (e.g. a nested sequence's render). */
	| { type: "updateAsset"; id: string; patch: Partial<Asset> }
	/** New file locations for media that moved (path as stored in the project). */
	| { type: "relinkAssets"; paths: Record<string, { path: string; relPath: string }> }
	/** Technical details probed from files (at import, or backfilled when a project opens). */
	| { type: "setMediaInfo"; infos: Record<string, MediaInfo>; sizes?: Record<string, number> };

export interface OpResult {
	data: ProjectData;
	summary: string;
	/** Ids of clips created by the operation, e.g. after a split. */
	created?: string[];
}

const sec = (value: number) => `${(value / 1000).toFixed(2)} s`;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function track(data: ProjectData, id: string): Track {
	const found = data.tracks.find((candidate) => candidate.id === id);
	if (!found)
		throw new Error(`No track "${id}". Tracks: ${data.tracks.map((t) => t.id).join(", ")}.`);
	return found;
}

function clip(data: ProjectData, id: string): Clip {
	const found = data.clips.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`No clip "${id}".`);
	return found;
}

function asset(data: ProjectData, id: string): Asset {
	const found = data.assets.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`No media "${id}".`);
	return found;
}

function bin(data: ProjectData, id: string): Bin {
	const found = data.bins?.find((candidate) => candidate.id === id);
	if (!found) {
		const names = (data.bins ?? []).map((b) => `${b.id} (${b.name})`).join(", ");
		throw new Error(`No bin "${id}". Bins: ${names || "none"}.`);
	}
	return found;
}

/** Trimmed, single-spaced tags without case-insensitive repeats. */
export function cleanTags(tags: string[]): string[] {
	const out: string[] = [];
	for (const raw of tags) {
		const tag = raw.trim().replace(/\s+/g, " ").slice(0, 60);
		if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
	}
	return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function unlocked(data: ProjectData, trackId: string): Track {
	const t = track(data, trackId);
	if (t.locked) throw new Error(`Track "${t.name}" is locked.`);
	return t;
}

/** Checks a clip against its track kind and the length of its source. */
/** The open timeline's id and name. */
export function activeSequence(data: ProjectData) {
	return data.sequence ?? { id: "main", name: "Main" };
}

/** Every timeline, open one included. */
export function allSequences(data: ProjectData) {
	const open = activeSequence(data);
	return [
		{ ...open, tracks: data.tracks, clips: data.clips, markers: data.markers },
		...(data.sequences ?? []),
	];
}

/**
 * Moves a clip and everything after it on its track by `deltaMs`, along with
 * the clips linked to them on other tracks (so linked sound stays in sync).
 */
function shiftTrackFrom(data: ProjectData, from: Clip, deltaMs: number): ProjectData {
	const moving = new Set(
		data.clips
			.filter((x) => x.trackId === from.trackId && x.startMs >= from.startMs - 1)
			.map((x) => x.id),
	);
	const groups = new Set(
		data.clips.filter((x) => moving.has(x.id) && x.groupId).map((x) => x.groupId as string),
	);
	for (const x of data.clips) if (x.groupId && groups.has(x.groupId)) moving.add(x.id);
	return {
		...data,
		clips: data.clips.map((x) =>
			moving.has(x.id) ? { ...x, startMs: Math.max(0, x.startMs + deltaMs) } : x,
		),
	};
}

/**
 * Word timings for text without any: words spread over the clip in proportion
 * to their length (the clip's first 90%, so the last word gets a moment).
 */
export function estimateWords(text: string, durationMs: number): CaptionWord[] {
	const tokens = text.split(/\s+/).filter(Boolean);
	const total = tokens.reduce((n, t) => n + t.length + 1, 0);
	let at = 0;
	return tokens.map((t) => {
		const length = ((t.length + 1) / Math.max(1, total)) * durationMs * 0.9;
		const word = { text: t, startMs: Math.round(at), endMs: Math.round(at + length) };
		at += length;
		return word;
	});
}

/**
 * A text clip after an edit, with its word timing kept in step: new text gets
 * new estimated timing, turning word animation on estimates timing if there is
 * none, and null clears either.
 */
function withWords(
	before: TextClip,
	after: TextClip,
	words: CaptionWord[] | null | undefined,
	wordStyle: WordStyle | null | undefined,
): TextClip {
	const next: TextClip = { ...after };
	if (wordStyle === null) delete next.wordStyle;
	else if (wordStyle) next.wordStyle = wordStyle;
	if (words === null) delete next.words;
	else if (words) next.words = words;
	else if (next.words && next.text !== before.text) {
		// Rewritten text: the old timing no longer fits the words.
		next.words = estimateWords(next.text, next.durationMs);
	}
	if (next.wordStyle && !next.words?.length) next.words = estimateWords(next.text, next.durationMs);
	return next;
}

/**
 * With the project's separateAudio setting (on by default), a video with sound
 * placed on a picture track gets its sound on an audio track, linked to the
 * picture, as editors do: the picture's own sound is turned off.
 */
function withSeparateSound(
	data: ProjectData,
	clipIds: string[],
): { data: ProjectData; created: string[] } {
	if (data.settings.separateAudio === false) return { data, created: [] };
	let next = data;
	const created: string[] = [];
	for (const id of clipIds) {
		const c = next.clips.find((x) => x.id === id);
		if (!c || c.type !== "media" || c.volume === 0) continue;
		const a = next.assets.find((x) => x.id === c.assetId);
		const track = next.tracks.find((t) => t.id === c.trackId);
		if (!a || a.kind !== "video" || !a.hasAudio || track?.kind !== "video") continue;
		const before = new Set(next.clips.map((x) => x.id));
		next = applyOp(next, { type: "detachAudio", id }).data;
		created.push(...next.clips.filter((x) => !before.has(x.id)).map((x) => x.id));
	}
	return { data: next, created };
}

/** Removes every clip of a media item, in every sequence. */
function withoutAssetClips(data: ProjectData, assetId: string): ProjectData {
	const keep = (c: Clip) => !(c.type === "media" && c.assetId === assetId);
	return {
		...data,
		clips: data.clips.filter(keep),
		...(data.sequences
			? { sequences: data.sequences.map((q) => ({ ...q, clips: q.clips.filter(keep) })) }
			: {}),
	};
}

/** Puts the open timeline away with the others. */
function stash(data: ProjectData): ProjectData {
	const open = activeSequence(data);
	return {
		...data,
		sequences: [
			...(data.sequences ?? []),
			{ ...open, tracks: data.tracks, clips: data.clips, markers: data.markers },
		],
	};
}

/** Opens a stored timeline. */
function swapIn(
	data: ProjectData,
	target: {
		id: string;
		name: string;
		tracks: Track[];
		clips: Clip[];
		markers: ProjectData["markers"];
	},
): ProjectData {
	return {
		...data,
		sequence: { id: target.id, name: target.name },
		sequences: (data.sequences ?? []).filter((q) => q.id !== target.id),
		tracks: target.tracks,
		clips: target.clips,
		markers: target.markers,
	};
}

/** The name a branch is an alternative of: "Main · alt 2" → "Main". */
export function branchBase(name: string): string {
	return name.replace(/ · alt \d+$/, "");
}

/** Renames a timeline, open or stored, and the media that nests it. */
function renameSeq(data: ProjectData, id: string, name: string): ProjectData {
	if (activeSequence(data).id === id) return { ...data, sequence: { id, name } };
	return {
		...data,
		sequences: (data.sequences ?? []).map((q) => (q.id === id ? { ...q, name } : q)),
		assets: data.assets.map((a) => (a.sequenceId === id ? { ...a, name } : a)),
	};
}

/** The one built-in media item behind every adjustment layer clip. */
export const ADJUSTMENT_ASSET = "a_adjust";

function validateClip(data: ProjectData, c: Clip): Clip {
	const t = unlocked(data, c.trackId);
	if (c.type === "text") {
		if (t.kind !== "text") throw new Error(`Text clips go on text tracks, not "${t.name}".`);
		return c;
	}
	const a = asset(data, c.assetId);
	if (t.kind === "text") throw new Error(`Media clips cannot go on text track "${t.name}".`);
	if (t.kind === "video" && a.kind === "audio")
		throw new Error(`Audio "${a.name}" cannot go on video track "${t.name}".`);
	if (t.kind === "audio" && (a.kind === "image" || a.kind === "lottie"))
		throw new Error(`"${a.name}" is a picture; it cannot go on audio track "${t.name}".`);
	if (t.kind !== "video" && a.kind === "adjustment")
		throw new Error("Adjustment layers go on video tracks.");
	if (t.kind === "audio" && !a.hasAudio && a.kind === "video")
		throw new Error(`"${a.name}" has no audio.`);
	// Motion graphics can run past their end: they hold their last frame, or loop.
	if (a.kind !== "image" && a.kind !== "adjustment" && a.kind !== "lottie") {
		const available = a.durationMs - c.inMs;
		if (available <= 0) throw new Error(`In-point is past the end of "${a.name}".`);
		const maxDuration = available / c.speed;
		if (c.durationMs > maxDuration + 1) {
			return { ...c, durationMs: Math.max(1, Math.floor(maxDuration)) };
		}
	}
	return {
		...c,
		fadeInMs: Math.min(c.fadeInMs, c.durationMs),
		fadeOutMs: Math.min(c.fadeOutMs, c.durationMs),
	};
}

function buildClip(data: ProjectData, input: z.output<typeof clipInput>): Clip {
	if (input.type === "text") {
		return validateClip(data, {
			id: input.id ?? newId("c"),
			type: "text",
			trackId: input.trackId,
			startMs: Math.round(input.startMs),
			durationMs: Math.round(input.durationMs ?? 3000),
			text: input.text,
			style: { ...DEFAULT_TEXT_STYLE, ...input.style },
			animationIn: input.animationIn ?? "fade",
			animationOut: input.animationOut ?? "fade",
			...(input.name ? { name: input.name } : {}),
			...(input.shape ? { shape: shapeSchema.parse({ ...DEFAULT_SHAPE, ...input.shape }) } : {}),
			...(input.infographic ? { infographic: input.infographic } : {}),
			...(input.dataCallout ? { dataCallout: input.dataCallout } : {}),
			...(input.wordStyle
				? {
						wordStyle: input.wordStyle,
						words: input.words ?? estimateWords(input.text, Math.round(input.durationMs ?? 3000)),
					}
				: input.words
					? { words: input.words }
					: {}),
		});
	}
	const a = asset(data, input.assetId);
	const inMs = Math.round(input.inMs ?? 0);
	const speed = input.speed ?? 1;
	const natural =
		a.kind === "image" || a.kind === "adjustment" ? 5000 : (a.durationMs - inMs) / speed;
	return validateClip(data, {
		id: input.id ?? newId("c"),
		type: "media",
		trackId: input.trackId,
		assetId: a.id,
		startMs: Math.round(input.startMs),
		durationMs: Math.round(input.durationMs ?? natural),
		inMs,
		speed,
		volume: input.volume ?? 1,
		fadeInMs: input.fadeInMs ?? 0,
		fadeOutMs: input.fadeOutMs ?? 0,
		transform: {
			...DEFAULT_TRANSFORM,
			...input.transform,
			crop: { ...NO_CROP, ...input.transform?.crop },
		},
		denoise: input.denoise ?? "off",
		name: input.name ?? a.name,
		...(input.keyframes
			? {
					keyframes: Object.fromEntries(
						Object.entries(input.keyframes).map(([prop, list]) => [
							prop,
							list.map((k) => tidyKeyframe(k, Math.round(input.durationMs ?? natural))),
						]),
					),
				}
			: {}),
		...(input.frame ? { frame: frameSchema.parse({ ...DEFAULT_FRAME, ...input.frame }) } : {}),
		...(input.motion && a.kind === "lottie" ? { motion: input.motion } : {}),
		...(input.blend && input.blend !== "normal" ? { blend: input.blend } : {}),
		...(input.wiggle ? { wiggle: input.wiggle } : {}),
		...(input.stepFps ? { stepFps: input.stepFps } : {}),
	});
}

/**
 * A motion patch merges: text and colours add to (or replace) what the clip has,
 * an empty string or colour removes that change, and null clears everything.
 */
function mergeMotion(
	current: MotionSettings | undefined,
	patch: MotionSettings | null,
): MotionSettings | undefined {
	if (patch === null) return undefined;
	const text = { ...current?.text, ...patch.text };
	for (const [k, v] of Object.entries(patch.text ?? {})) if (v === "") delete text[k];
	const colors = { ...current?.colors };
	for (const [from, to] of Object.entries(patch.colors ?? {})) {
		const key = from.toLowerCase();
		if (to.toLowerCase() === key) delete colors[key];
		else colors[key] = to.toLowerCase();
	}
	const loop = patch.loop ?? current?.loop;
	const next: MotionSettings = {
		...(loop ? { loop: true } : {}),
		...(Object.keys(text).length ? { text } : {}),
		...(Object.keys(colors).length ? { colors } : {}),
	};
	return Object.keys(next).length ? next : undefined;
}

/** Adds a track: picture and text tracks go on top of the stack, sound tracks at the bottom. */
function withTrack(
	data: ProjectData,
	kind: TrackKind,
	name?: string,
	index?: number,
): { data: ProjectData; track: Track } {
	const prefix = { video: "V", audio: "A", text: "T" }[kind];
	let n = 1;
	while (data.tracks.some((t) => t.id === `${prefix}${n}`)) n++;
	const t: Track = {
		id: `${prefix}${n}`,
		kind,
		name: name ?? `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`,
		muted: false,
		locked: false,
		hidden: false,
		volume: 1,
	};
	const tracks = [...data.tracks];
	tracks.splice(index ?? (kind === "audio" ? tracks.length : 0), 0, t);
	return { data: { ...data, tracks: groupTracks(tracks) }, track: t };
}

/** Adds every clip that shares a group with one of `ids`. */
export function withGroups(data: ProjectData, ids: string[]): string[] {
	const groups = new Set(
		data.clips.filter((c) => ids.includes(c.id) && c.groupId).map((c) => c.groupId),
	);
	if (groups.size === 0) return ids;
	return [
		...new Set([
			...ids,
			...data.clips.filter((c) => c.groupId && groups.has(c.groupId)).map((c) => c.id),
		]),
	];
}

/** Neighbour on the same track that ends where `c` starts (within `slack` ms). */
function leftNeighbour(data: ProjectData, c: Clip, slack = 60): Clip | undefined {
	return data.clips
		.filter(
			(x) => x.id !== c.id && x.trackId === c.trackId && Math.abs(clipEnd(x) - c.startMs) <= slack,
		)
		.sort((a, b) => clipEnd(b) - clipEnd(a))[0];
}

function rightNeighbour(data: ProjectData, c: Clip, slack = 60): Clip | undefined {
	return data.clips
		.filter(
			(x) => x.id !== c.id && x.trackId === c.trackId && Math.abs(x.startMs - clipEnd(c)) <= slack,
		)
		.sort((a, b) => a.startMs - b.startMs)[0];
}

function media(data: ProjectData, id: string): MediaClip {
	const c = clip(data, id);
	if (c.type !== "media") throw new Error("That is a text clip; this works on media clips.");
	return c;
}

function replaceClip(data: ProjectData, next: Clip): ProjectData {
	return { ...data, clips: data.clips.map((c) => (c.id === next.id ? next : c)) };
}

function splitOne(
	data: ProjectData,
	c: Clip,
	atMs: number,
): { data: ProjectData; created: string } {
	if (atMs <= c.startMs + 1 || atMs >= clipEnd(c) - 1)
		throw new Error(`${sec(atMs)} is not inside clip ${c.id}.`);
	unlocked(data, c.trackId);
	const leftLength = Math.round(atMs - c.startMs);
	let right: Clip;
	let left: Clip;
	if (c.type === "media") {
		// Keyframes and zooms are clip-local, so each half gets its own part of them.
		const keyframes: [MediaClip["keyframes"], MediaClip["keyframes"]] = [{}, {}];
		for (const [prop, list] of Object.entries(c.keyframes ?? {})) {
			const [l, r] = splitKeyframes(list, leftLength);
			if (l?.length) (keyframes[0] as Record<string, unknown>)[prop] = l;
			if (r?.length) (keyframes[1] as Record<string, unknown>)[prop] = r;
		}
		const [zoomsLeft, zoomsRight] = splitZooms(c.zooms, leftLength);
		right = {
			...c,
			id: newId("c"),
			startMs: Math.round(atMs),
			durationMs: c.durationMs - leftLength,
			inMs: Math.round(c.inMs + leftLength * c.speed),
			fadeInMs: 0,
			keyframes: c.keyframes ? keyframes[1] : undefined,
			zooms: zoomsRight,
		};
		// The cut itself is the right half's entrance, so it has no transition.
		delete (right as MediaClip).transitionIn;
		left = {
			...c,
			durationMs: leftLength,
			fadeOutMs: 0,
			keyframes: c.keyframes ? keyframes[0] : undefined,
			zooms: zoomsLeft,
		};
		if (!c.keyframes) {
			delete (left as MediaClip).keyframes;
			delete (right as MediaClip).keyframes;
		}
		if (!zoomsLeft) delete (left as MediaClip).zooms;
		if (!zoomsRight) delete (right as MediaClip).zooms;
	} else {
		right = {
			...c,
			id: newId("c"),
			startMs: Math.round(atMs),
			durationMs: c.durationMs - leftLength,
			animationIn: "none",
		};
		left = { ...c, durationMs: leftLength, animationOut: "none" };
		// Timed words go to the half they are said in, so a caption splits into two captions.
		if (c.words?.length) {
			const early = c.words.filter((w) => w.startMs < leftLength);
			const late = c.words
				.filter((w) => w.startMs >= leftLength)
				.map((w) => ({
					...w,
					startMs: w.startMs - leftLength,
					endMs: Math.max(0, w.endMs - leftLength),
				}));
			if (early.length && late.length) {
				left = { ...left, words: early, text: early.map((w) => w.text).join(" ") };
				right = { ...right, words: late, text: late.map((w) => w.text).join(" ") };
			}
		}
	}
	const index = data.clips.findIndex((candidate) => candidate.id === c.id);
	const clips = [...data.clips];
	clips.splice(index, 1, left, right);
	return { data: { ...data, clips }, created: right.id };
}

/** Puts a take on the voiceover track as the line's clip, replacing the previous one. */
/** Removes whatever lies between two times on some tracks, leaving a gap (no ripple). */
function clearRange(
	data: ProjectData,
	startMs: number,
	endMs: number,
	affected: Set<string>,
): ProjectData {
	let next = data;
	for (const edge of [endMs, startMs])
		for (const c of next.clips)
			if (affected.has(c.trackId) && edge > c.startMs + 1 && edge < clipEnd(c) - 1)
				next = splitOne(next, c, edge).data;
	return {
		...next,
		clips: next.clips.filter(
			(c) => !(affected.has(c.trackId) && c.startMs >= startMs - 1 && clipEnd(c) <= endMs + 1),
		),
	};
}

function placeTake(data: ProjectData, a: Asset): ProjectData {
	if (!a.lineId) throw new Error(`"${a.name}" is not a take.`);
	const line = data.lines.find((candidate) => candidate.id === a.lineId);
	if (!line) throw new Error(`No line "${a.lineId}".`);
	const existing = data.clips.find(
		(c): c is MediaClip => c.type === "media" && c.lineId === a.lineId,
	);
	const trackId = existing?.trackId ?? voiceoverTrack(data)?.id;
	if (!trackId) throw new Error("Add an audio track for the voiceover first.");
	unlocked(data, trackId);
	const next = takeClip(a, trackId, data.settings.padMs, line.startMs);
	const kept = existing
		? {
				...next,
				id: existing.id,
				volume: existing.volume,
				fadeInMs: existing.fadeInMs,
				fadeOutMs: existing.fadeOutMs,
			}
		: next;
	const clips = existing
		? data.clips.map((c) => (c.id === existing.id ? kept : c))
		: [...data.clips, kept];
	return { ...data, clips };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/** A keyframe inside its clip, with a curve only when it uses one. */
function tidyKeyframe(k: z.input<typeof keyframeSchema>, durationMs: number): Keyframe {
	const ease = k.ease ?? "ease";
	const out: Keyframe = {
		atMs: Math.round(Math.min(Math.max(0, k.atMs), durationMs)),
		value: k.value,
		ease,
	};
	if (ease === "bezier") out.curve = k.curve ?? DEFAULT_CURVE;
	return out;
}

export function applyOp(data: ProjectData, rawOp: Op | InternalOp): OpResult {
	if (rawOp.type === "addAsset") {
		let next: ProjectData = { ...data, assets: [...data.assets, rawOp.asset] };
		let created: string[] | undefined;
		if (rawOp.placeOn) {
			const c = buildClip(next, {
				type: "media",
				assetId: rawOp.asset.id,
				trackId: rawOp.placeOn.trackId,
				startMs: rawOp.placeOn.startMs,
			});
			const sound = withSeparateSound({ ...next, clips: [...next.clips, c] }, [c.id]);
			next = sound.data;
			created = [c.id, ...sound.created];
		}
		return { data: next, summary: `Added ${rawOp.asset.kind} "${rawOp.asset.name}"`, created };
	}
	if (rawOp.type === "fitNested") {
		const fit = (clips: Clip[]): Clip[] => {
			let next = clips;
			for (const { id } of clips) {
				// Earlier fits may have moved this clip; always work from where it is now.
				const c = next.find((x) => x.id === id) as Clip;
				if (c.type !== "media" || c.assetId !== rawOp.assetId) continue;
				// Only clips that reached the old end of the sequence follow its new length.
				if (c.inMs + c.durationMs * c.speed < rawOp.fromMs - 2) continue;
				const length = Math.max(1, Math.round((rawOp.toMs - c.inMs) / c.speed));
				const delta = length - c.durationMs;
				if (!delta) continue;
				const end = clipEnd(c);
				// Clips cut straight after it move along, so nothing overlaps and no gap opens.
				const followers = new Set(
					next
						.filter((x) => x.trackId === c.trackId && x.id !== c.id && x.startMs >= end - 2)
						.sort((a, b) => a.startMs - b.startMs)
						.reduce<{ ids: string[]; at: number }>(
							(run, x) =>
								Math.abs(x.startMs - run.at) <= 2
									? { ids: [...run.ids, x.id], at: clipEnd(x) }
									: run,
							{ ids: [], at: end },
						).ids,
				);
				next = next.map((x) =>
					x.id === c.id
						? { ...x, durationMs: length }
						: followers.has(x.id)
							? { ...x, startMs: Math.max(0, x.startMs + delta) }
							: x,
				);
			}
			return next;
		};
		return {
			data: {
				...data,
				clips: fit(data.clips),
				sequences: data.sequences?.map((q) => ({ ...q, clips: fit(q.clips) })),
			},
			summary: "Fitted nested clips to their sequence",
		};
	}
	if (rawOp.type === "updateAsset") {
		asset(data, rawOp.id);
		return {
			data: {
				...data,
				assets: data.assets.map((a) => (a.id === rawOp.id ? { ...a, ...rawOp.patch } : a)),
			},
			summary: `Updated ${asset(data, rawOp.id).name}`,
		};
	}
	if (rawOp.type === "relinkAssets") {
		const count = Object.keys(rawOp.paths).length;
		return {
			data: {
				...data,
				assets: data.assets.map((a) => (rawOp.paths[a.id] ? { ...a, ...rawOp.paths[a.id] } : a)),
			},
			summary: `Relinked ${count} media file${count === 1 ? "" : "s"}`,
		};
	}
	if (rawOp.type === "setMediaInfo") {
		return {
			data: {
				...data,
				assets: data.assets.map((a) =>
					rawOp.infos[a.id]
						? {
								...a,
								info: rawOp.infos[a.id],
								...(rawOp.sizes?.[a.id] !== undefined ? { size: rawOp.sizes[a.id] } : {}),
							}
						: a,
				),
			},
			summary: `Read media info for ${plural(Object.keys(rawOp.infos).length, "file")}`,
		};
	}
	if (rawOp.type === "setTranscript") {
		asset(data, rawOp.assetId);
		return {
			data: {
				...data,
				assets: data.assets.map((a) =>
					a.id === rawOp.assetId ? { ...a, transcript: rawOp.transcript } : a,
				),
			},
			summary: `Transcribed ${asset(data, rawOp.assetId).name} (${rawOp.transcript?.words.length ?? 0} words)`,
		};
	}
	if (rawOp.type === "addTake") {
		const withAsset = { ...data, assets: [...data.assets, rawOp.asset] };
		const placed = placeTake(withAsset, rawOp.asset);
		const speech =
			(rawOp.asset.speechEndMs ?? rawOp.asset.durationMs) - (rawOp.asset.speechStartMs ?? 0);
		return {
			data: placed,
			summary: `${rawOp.asset.origin === "tts" ? "Generated" : "Recorded"} a take for ${rawOp.asset.lineId} (${sec(speech)})`,
		};
	}

	const op = opSchema.parse(rawOp) as ParsedOp;
	switch (op.type) {
		case "rename":
			return { data: { ...data, name: op.name }, summary: `Renamed the project to "${op.name}"` };
		case "setCanvas":
			return {
				data: { ...data, canvas: { ...data.canvas, ...op.canvas } },
				summary: `Canvas set to ${op.canvas.width ?? data.canvas.width}×${op.canvas.height ?? data.canvas.height}`,
			};

		case "renameAsset":
			asset(data, op.id);
			return {
				data: {
					...data,
					assets: data.assets.map((a) => (a.id === op.id ? { ...a, name: op.name } : a)),
				},
				summary: `Renamed media to "${op.name}"`,
			};
		case "removeAsset": {
			const a = asset(data, op.id);
			const before = allSequences(data).reduce((n, q) => n + q.clips.length, 0);
			const next = withoutAssetClips(
				{ ...data, assets: data.assets.filter((x) => x.id !== op.id) },
				op.id,
			);
			const after = allSequences(next).reduce((n, q) => n + q.clips.length, 0);
			return {
				data: next,
				summary: `Removed "${a.name}" and ${before - after} clip(s)`,
			};
		}

		case "createBin": {
			const bins = data.bins ?? [];
			if (op.id && bins.some((b) => b.id === op.id))
				throw new Error(`A bin with id "${op.id}" already exists.`);
			// Nesting stops at one level: a bin inside a sub-bin would be hard to see in the panel.
			if (op.parentId && bin(data, op.parentId).parentId)
				throw new Error("Bins nest one level deep: pick a top-level bin as the parent.");
			const clash = bins.find(
				(b) => b.parentId === op.parentId && b.name.toLowerCase() === op.name.toLowerCase(),
			);
			if (clash) throw new Error(`There is already a bin called "${clash.name}" (${clash.id}).`);
			const created: Bin = {
				id: op.id ?? newId("b"),
				name: op.name,
				...(op.parentId ? { parentId: op.parentId } : {}),
			};
			return {
				data: { ...data, bins: [...bins, created] },
				summary: `Created bin "${binPath({ ...data, bins: [...bins, created] }, created.id)}"`,
				created: [created.id],
			};
		}
		case "renameBin": {
			const b = bin(data, op.id);
			return {
				data: {
					...data,
					bins: (data.bins ?? []).map((x) => (x.id === op.id ? { ...x, name: op.name } : x)),
				},
				summary: `Renamed bin "${b.name}" to "${op.name}"`,
			};
		}
		case "removeBin": {
			const b = bin(data, op.id);
			// Its media and sub-bins move up to where the bin was, so nothing is lost.
			const moved = data.assets.filter((a) => a.binId === b.id).length;
			return {
				data: {
					...data,
					bins: (data.bins ?? [])
						.filter((x) => x.id !== b.id)
						.map((x) =>
							x.parentId === b.id
								? b.parentId
									? { ...x, parentId: b.parentId }
									: { id: x.id, name: x.name }
								: x,
						),
					assets: data.assets.map((a) => {
						if (a.binId !== b.id) return a;
						const { binId: _, ...rest } = a;
						return b.parentId ? { ...rest, binId: b.parentId } : rest;
					}),
				},
				summary: `Removed bin "${b.name}"${moved ? ` (${plural(moved, "item")} moved ${b.parentId ? "to its parent" : "to the top level"})` : ""}`,
			};
		}
		case "moveMedia": {
			for (const id of op.assetIds) asset(data, id);
			const target = op.binId === null ? null : bin(data, op.binId);
			const ids = new Set(op.assetIds);
			return {
				data: {
					...data,
					assets: data.assets.map((a) => {
						if (!ids.has(a.id)) return a;
						const { binId: _, ...rest } = a;
						return target ? { ...rest, binId: target.id } : rest;
					}),
				},
				summary: `Moved ${plural(ids.size, "media item")} to ${target ? `"${binPath(data, target.id)}"` : "the top level"}`,
			};
		}
		case "tagMedia": {
			for (const id of op.assetIds) asset(data, id);
			const ids = new Set(op.assetIds);
			const add = cleanTags(op.add ?? []);
			const remove = new Set(cleanTags(op.remove ?? []).map((t) => t.toLowerCase()));
			const assets = data.assets.map((a) => {
				if (!ids.has(a.id)) return a;
				const next: Asset = { ...a };
				if (add.length || remove.size) {
					const tags = cleanTags([...(a.tags ?? []), ...add]).filter(
						(t) => !remove.has(t.toLowerCase()),
					);
					if (tags.length) next.tags = tags;
					else delete next.tags;
				}
				if (op.rating !== undefined) {
					if (op.rating > 0) next.rating = op.rating;
					else delete next.rating;
				}
				if (op.note !== undefined) {
					const note = op.note.trim();
					if (note) next.note = note;
					else delete next.note;
				}
				return next;
			});
			const what = [
				add.length ? `tagged ${add.map((t) => `"${t}"`).join(", ")}` : "",
				remove.size
					? `untagged ${[...(op.remove ?? [])].map((t) => `"${t.trim()}"`).join(", ")}`
					: "",
				op.rating !== undefined ? (op.rating ? `rated ${op.rating}★` : "cleared the rating") : "",
				op.note !== undefined ? (op.note.trim() ? "noted" : "cleared the note") : "",
			].filter(Boolean);
			const target =
				ids.size === 1 ? `"${asset(data, op.assetIds[0]).name}"` : plural(ids.size, "media item");
			return {
				data: { ...data, assets },
				summary: `${target[0].toUpperCase()}${target.slice(1)}: ${what.join(", ") || "unchanged"}`,
			};
		}

		case "addTrack": {
			const { data: next, track: t } = withTrack(data, op.kind, op.name, op.index);
			return {
				data: next,
				summary: `Added ${op.kind} track "${t.name}"`,
				created: [t.id],
			};
		}
		case "updateTrack": {
			track(data, op.id);
			const { eq, compressor, ...rest } = op.patch;
			let tracks = data.tracks.map((t) => {
				if (t.id !== op.id) return t;
				const next: Track = { ...t, ...rest };
				// EQ bands are merged, so one band can change without resending the others.
				if (eq === null) delete next.eq;
				else if (eq) next.eq = { low: 0, mid: 0, high: 0, ...t.eq, ...eq };
				if (compressor === null) delete next.compressor;
				else if (compressor) next.compressor = compressor;
				return next;
			});
			if (op.patch.voiceover)
				tracks = tracks.map((t) => (t.id === op.id ? t : { ...t, voiceover: false }));
			return {
				data: { ...data, tracks },
				summary: `Updated track ${op.id} (${Object.keys(op.patch).join(", ")})`,
			};
		}
		case "removeTrack": {
			const t = track(data, op.id);
			const clips = data.clips.filter((c) => c.trackId !== op.id);
			return {
				data: { ...data, tracks: data.tracks.filter((x) => x.id !== op.id), clips },
				summary: `Removed track "${t.name}" and ${data.clips.length - clips.length} clip(s)`,
			};
		}
		case "moveTrack": {
			const t = track(data, op.id);
			const tracks = data.tracks.filter((x) => x.id !== op.id);
			tracks.splice(Math.min(op.index, tracks.length), 0, t);
			return { data: { ...data, tracks: groupTracks(tracks) }, summary: `Moved track "${t.name}"` };
		}

		case "addClips": {
			let next = data;
			const created: string[] = [];
			const separate: string[] = [];
			for (const input of op.clips) {
				const c = buildClip(next, input);
				next = { ...next, clips: [...next.clips, c] };
				created.push(c.id);
				if (!(input.type === "media" && input.linkedAudio === false)) separate.push(c.id);
			}
			assertUnique(
				next.clips.map((c) => c.id),
				"clip",
			);
			const sound = withSeparateSound(next, separate);
			return {
				data: sound.data,
				summary: `Added ${created.length} clip(s)`,
				created: [...created, ...sound.created],
			};
		}
		case "updateClip": {
			const current = clip(data, op.id);
			unlocked(data, current.trackId);
			const {
				transform,
				style,
				color,
				label,
				mask,
				key,
				effects,
				frame,
				motion,
				blend,
				wiggle,
				stepFps,
				wordStyle,
				words,
				shape,
				infographic,
				dataCallout,
				...patch
			} = op.patch;
			// null clears a label, mask or key; a partial mask or key merges with what is there.
			const rest = {
				...patch,
				...(label === undefined ? {} : { label: label ?? undefined }),
				...(mask === undefined || current.type !== "media"
					? {}
					: {
							mask:
								mask === null
									? undefined
									: maskSchema.parse({ ...DEFAULT_MASK, ...current.mask, ...mask }),
						}),
				...(key === undefined || current.type !== "media"
					? {}
					: {
							key:
								key === null
									? undefined
									: keySchema.parse({ ...DEFAULT_KEY, ...current.key, ...key }),
						}),
				...(effects === undefined || current.type !== "media"
					? {}
					: {
							effects: (() => {
								if (effects === null) return undefined;
								const next = effectsSchema.parse({ ...NO_EFFECTS, ...current.effects, ...effects });
								// All off is the same as none.
								return next.blur ||
									next.sharpen ||
									next.vignette ||
									next.glow ||
									next.grain ||
									next.stabilize
									? next
									: undefined;
							})(),
						}),
				...(frame === undefined || current.type !== "media"
					? {}
					: {
							frame: (() => {
								if (frame === null) return undefined;
								const next = frameSchema.parse({ ...DEFAULT_FRAME, ...current.frame, ...frame });
								return next.radius || next.shadow ? next : undefined;
							})(),
						}),
				...(motion === undefined || current.type !== "media"
					? {}
					: { motion: mergeMotion(current.motion, motion) }),
				...(blend === undefined || current.type !== "media"
					? {}
					: { blend: blend === null || blend === "normal" ? undefined : blend }),
				...(wiggle === undefined || current.type !== "media"
					? {}
					: {
							wiggle: (() => {
								if (wiggle === null) return undefined;
								const next = wiggleSchema.parse({
									position: 0,
									rotation: 0,
									speed: 1,
									...current.wiggle,
									...wiggle,
								});
								return next.position || next.rotation ? next : undefined;
							})(),
						}),
				...(stepFps === undefined || current.type !== "media"
					? {}
					: { stepFps: stepFps ?? undefined }),
			};
			const merged =
				current.type === "media"
					? {
							...current,
							...rest,
							transform: {
								...current.transform,
								...transform,
								crop: { ...current.transform.crop, ...transform?.crop },
							},
							...(color ? { color: { ...NEUTRAL_COLOR, ...current.color, ...color } } : {}),
						}
					: withWords(
							current,
							{
								...current,
								...rest,
								style: { ...current.style, ...style },
								...(shape === undefined
									? {}
									: {
											shape:
												shape === null
													? undefined
													: shapeSchema.parse({ ...DEFAULT_SHAPE, ...current.shape, ...shape }),
										}),
								...(infographic === undefined
									? {}
									: {
											infographic:
												infographic === null
													? undefined
													: infographicSchema.parse({ ...current.infographic, ...infographic }),
										}),
								...(dataCallout === undefined
									? {}
									: {
											dataCallout:
												dataCallout === null
													? undefined
													: dataCalloutSchema.parse({ ...current.dataCallout, ...dataCallout }),
										}),
							},
							words,
							wordStyle,
						);
			if (
				current.type === "media" &&
				(op.patch.text !== undefined ||
					style ||
					wordStyle ||
					words ||
					infographic !== undefined ||
					dataCallout !== undefined)
			)
				throw new Error("Only text clips have text, style and word timing.");
			const next = validateClip(data, merged as Clip);
			return {
				data: replaceClip(data, next),
				summary: `Edited clip ${current.name ?? current.id} (${Object.keys(op.patch).join(", ")})`,
			};
		}
		case "moveClips": {
			let next = data;
			const ids = op.trackId ? op.ids : withGroups(data, op.ids);
			// One shared delta, limited by the earliest clip, so grouped clips stay in sync at 0.
			const earliest = Math.min(...ids.map((id) => clip(data, id).startMs));
			const deltaMs = Math.round(Math.max(op.deltaMs, -earliest));
			// "new" makes one new track per kind (picture tracks on top, sound at the bottom).
			const fresh = new Map<TrackKind, string>();
			const created: string[] = [];
			const destination = (c: Clip): string => {
				const wanted = op.tracks?.[c.id] ?? op.trackId ?? c.trackId;
				if (wanted !== "new") return wanted;
				const kind = track(next, c.trackId).kind;
				let id = fresh.get(kind);
				if (!id) {
					const added = withTrack(next, kind);
					next = added.data;
					id = added.track.id;
					fresh.set(kind, id);
					created.push(id);
				}
				return id;
			};
			const moved: Clip[] = [];
			for (const id of ids) {
				const c = clip(data, id);
				unlocked(data, c.trackId);
				const trackId = destination(c);
				unlocked(next, trackId);
				moved.push({
					...c,
					startMs: Math.max(0, Math.round(c.startMs + deltaMs)),
					trackId,
				} as Clip);
			}
			const movedIds = new Set(ids);
			if (op.overwrite) {
				// Clear the places they land in, not counting the moved clips themselves.
				let rest: ProjectData = { ...next, clips: next.clips.filter((c) => !movedIds.has(c.id)) };
				for (const c of moved) {
					// A transition into the clip overlaps the clip before it on purpose.
					const tr = c.type === "media" ? c.transitionIn : undefined;
					const from = c.startMs + (tr && overlaps(tr) ? tr.durationMs : 0);
					rest = clearRange(rest, from, clipEnd(c), new Set([c.trackId]));
				}
				next = { ...rest, clips: [...rest.clips, ...next.clips.filter((c) => movedIds.has(c.id))] };
			}
			for (const c of moved) next = replaceClip(next, validateClip(next, c));
			const target = op.trackId ?? (created.length ? "a new track" : undefined);
			return {
				data: next,
				summary: `Moved ${ids.length} clip(s) by ${sec(op.deltaMs)}${target ? ` to ${target}` : ""}`,
				...(created.length ? { created } : {}),
			};
		}
		case "trimClip": {
			const c = clip(data, op.id);
			unlocked(data, c.trackId);
			const end = clipEnd(c);
			let next: Clip;
			if (op.edge === "end") {
				next = validateClip(data, {
					...c,
					durationMs: Math.max(1, Math.round(op.toMs - c.startMs)),
				} as Clip);
			} else {
				let start = Math.min(Math.round(op.toMs), end - 1);
				if (c.type === "media") {
					const a = asset(data, c.assetId);
					// Extending left is limited by the start of the source.
					const earliest = a.kind === "image" ? 0 : c.startMs - c.inMs / c.speed;
					start = Math.max(start, Math.ceil(earliest), 0);
					const inMs =
						a.kind === "image"
							? 0
							: Math.max(0, Math.round(c.inMs + (start - c.startMs) * c.speed));
					next = validateClip(data, { ...c, startMs: start, durationMs: end - start, inMs });
				} else {
					const from = Math.max(0, start);
					// Word times are clip-local: they move with the clip's new start.
					const words = c.words
						?.map((w) => ({
							...w,
							startMs: w.startMs - (from - c.startMs),
							endMs: w.endMs - (from - c.startMs),
						}))
						.filter((w) => w.endMs > 0)
						.map((w) => ({ ...w, startMs: Math.max(0, w.startMs) }));
					next = validateClip(data, {
						...c,
						startMs: from,
						durationMs: end - from,
						...(words ? { words } : {}),
					});
				}
			}
			return {
				data: replaceClip(data, next),
				summary: `Trimmed ${c.name ?? c.id} (${op.edge}) to ${sec(op.edge === "end" ? clipEnd(next) : next.startMs)}`,
			};
		}
		case "splitClip": {
			const result = splitOne(data, clip(data, op.id), op.atMs);
			return {
				data: result.data,
				summary: `Split clip at ${sec(op.atMs)}`,
				created: [result.created],
			};
		}
		case "splitAt": {
			let next = data;
			const created: string[] = [];
			for (const c of data.clips) {
				if (op.trackIds && !op.trackIds.includes(c.trackId)) continue;
				if (op.atMs <= c.startMs + 1 || op.atMs >= clipEnd(c) - 1) continue;
				if (track(data, c.trackId).locked) continue;
				const result = splitOne(next, clip(next, c.id), op.atMs);
				next = result.data;
				created.push(result.created);
			}
			if (created.length === 0) throw new Error(`No clip crosses ${sec(op.atMs)}.`);
			return { data: next, summary: `Split ${created.length} clip(s) at ${sec(op.atMs)}`, created };
		}
		case "removeClips": {
			const ids = withGroups(data, op.ids);
			const removed = ids.map((id) => clip(data, id));
			for (const c of removed) unlocked(data, c.trackId);
			let clips = data.clips.filter((c) => !ids.includes(c.id));
			if (op.ripple) {
				for (const r of [...removed].sort((a, b) => b.startMs - a.startMs)) {
					clips = clips.map((c) =>
						c.trackId === r.trackId && c.startMs >= clipEnd(r)
							? { ...c, startMs: Math.max(0, c.startMs - r.durationMs) }
							: c,
					);
				}
			}
			return {
				data: { ...data, clips },
				summary: `Deleted ${removed.length} clip(s)${op.ripple ? " and closed the gap" : ""}`,
			};
		}
		case "duplicateClips": {
			let next = data;
			const created: string[] = [];
			// Copies of linked clips are linked to each other, not to the originals.
			const groups = new Map<string, string>();
			for (const id of op.ids) {
				const c = clip(next, id);
				const groupId = c.groupId
					? (groups.get(c.groupId) ?? groups.set(c.groupId, newId("g")).get(c.groupId))
					: undefined;
				const copy = validateClip(next, {
					...c,
					id: newId("c"),
					startMs: Math.round(op.offsetMs !== undefined ? c.startMs + op.offsetMs : clipEnd(c)),
					trackId: op.trackId ?? c.trackId,
					groupId,
					...(c.type === "media" ? { lineId: undefined } : {}),
				} as Clip);
				if (!groupId) delete (copy as { groupId?: string }).groupId;
				next = { ...next, clips: [...next.clips, copy] };
				created.push(copy.id);
			}
			// A group needs two copies; a lone copy is simply unlinked.
			const members = new Map<string, number>();
			for (const c of next.clips)
				if (created.includes(c.id) && c.groupId)
					members.set(c.groupId, (members.get(c.groupId) ?? 0) + 1);
			next = {
				...next,
				clips: next.clips.map((c) => {
					if (!created.includes(c.id) || !c.groupId || (members.get(c.groupId) ?? 0) > 1) return c;
					const { groupId: _alone, ...rest } = c;
					return rest as Clip;
				}),
			};
			return { data: next, summary: `Duplicated ${created.length} clip(s)`, created };
		}

		case "removeRanges": {
			// Merge overlapping ranges, then cut from the last one backwards so earlier positions stay valid.
			const ranges = [...op.ranges]
				.filter((r) => r.endMs - r.startMs > 1)
				.sort((a, b) => a.startMs - b.startMs);
			const merged: { startMs: number; endMs: number }[] = [];
			for (const r of ranges) {
				const last = merged.at(-1);
				if (last && r.startMs <= last.endMs) last.endMs = Math.max(last.endMs, r.endMs);
				else merged.push({ ...r });
			}
			const affected = new Set(
				op.trackIds ?? data.tracks.filter((t) => !t.locked).map((t) => t.id),
			);
			let next = data;
			let removed = 0;
			for (const range of [...merged].reverse()) {
				const width = range.endMs - range.startMs;
				for (const edge of [range.endMs, range.startMs]) {
					for (const c of next.clips) {
						if (!affected.has(c.trackId) || edge <= c.startMs + 1 || edge >= clipEnd(c) - 1)
							continue;
						next = splitOne(next, c, edge).data;
					}
				}
				next = {
					...next,
					clips: next.clips
						.filter(
							(c) =>
								!(
									affected.has(c.trackId) &&
									c.startMs >= range.startMs - 1 &&
									clipEnd(c) <= range.endMs + 1
								),
						)
						.map((c) =>
							affected.has(c.trackId) && c.startMs >= range.endMs - 1
								? { ...c, startMs: Math.max(0, Math.round(c.startMs - width)) }
								: c,
						),
					lines: next.lines.map((l) =>
						l.startMs >= range.endMs ? { ...l, startMs: Math.round(l.startMs - width) } : l,
					),
					markers: next.markers.map((m) =>
						m.atMs >= range.endMs ? { ...m, atMs: Math.round(m.atMs - width) } : m,
					),
				};
				removed += width;
			}
			return { data: next, summary: `Removed ${merged.length} range(s), ${sec(removed)} in total` };
		}
		case "newSequence": {
			const id = newId("s");
			const fresh = {
				id,
				name: op.name,
				tracks: op.empty ? [] : defaultTracks(),
				clips: [],
				markers: [],
			};
			if (!op.open)
				return {
					data: { ...data, sequences: [...(data.sequences ?? []), fresh] },
					summary: `Added sequence "${op.name}"`,
					created: [id],
				};
			return {
				data: swapIn(stash(data), fresh),
				summary: `New sequence "${op.name}"`,
				created: [id],
			};
		}
		case "openSequence": {
			if (activeSequence(data).id === op.id) return { data, summary: "Already open" };
			const target = (data.sequences ?? []).find((q) => q.id === op.id);
			if (!target) throw new Error(`No sequence "${op.id}".`);
			return { data: swapIn(stash(data), target), summary: `Opened sequence "${target.name}"` };
		}
		case "renameSequence": {
			if (activeSequence(data).id === op.id)
				return {
					data: { ...data, sequence: { id: op.id, name: op.name } },
					summary: `Renamed the sequence to "${op.name}"`,
				};
			if (!(data.sequences ?? []).some((q) => q.id === op.id))
				throw new Error(`No sequence "${op.id}".`);
			return {
				data: {
					...data,
					sequences: (data.sequences ?? []).map((q) =>
						q.id === op.id ? { ...q, name: op.name } : q,
					),
					assets: data.assets.map((a) => (a.sequenceId === op.id ? { ...a, name: op.name } : a)),
				},
				summary: `Renamed the sequence to "${op.name}"`,
			};
		}
		case "duplicateSequence": {
			const all = allSequences(data);
			const source = all.find((q) => q.id === op.id);
			if (!source) throw new Error(`No sequence "${op.id}".`);
			const copy = {
				id: newId("s"),
				name: `${source.name} copy`,
				tracks: source.tracks,
				clips: source.clips.map((c) => ({ ...c, id: newId("c") })),
				markers: source.markers.map((m) => ({ ...m, id: newId("m") })),
			};
			return {
				data: { ...data, sequences: [...(data.sequences ?? []), copy] },
				summary: `Duplicated "${source.name}"`,
				created: [copy.id],
			};
		}
		case "branchSequence": {
			const all = allSequences(data);
			const source = all.find((q) => q.id === (op.from ?? activeSequence(data).id));
			if (!source) throw new Error(`No sequence "${op.from}".`);
			const base = branchBase(source.name);
			const names = new Set(all.map((q) => q.name));
			let n = 1;
			while (names.has(`${base} · alt ${n}`)) n++;
			const copy = {
				id: newId("s"),
				name: op.name ?? `${base} · alt ${n}`,
				tracks: source.tracks,
				clips: source.clips.map((c) => ({ ...c, id: newId("c") })),
				markers: source.markers.map((m) => ({ ...m, id: newId("m") })),
			};
			// Linked clips stay linked to each other in the copy, not to the original's.
			const groups = new Map<string, string>();
			copy.clips = copy.clips.map((c) => {
				if (!c.groupId) return c;
				if (!groups.has(c.groupId)) groups.set(c.groupId, newId("g"));
				return { ...c, groupId: groups.get(c.groupId) };
			});
			return {
				data: swapIn(stash(data), copy),
				summary: `Branched "${source.name}" as "${copy.name}"`,
				created: [copy.id],
			};
		}
		case "promoteBranch": {
			const all = allSequences(data);
			const branch = all.find((q) => q.id === op.id);
			if (!branch) throw new Error(`No sequence "${op.id}".`);
			const original = op.originalId
				? all.find((q) => q.id === op.originalId)
				: all.find((q) => q.id !== branch.id && q.name === branchBase(branch.name));
			if (!original || original.id === branch.id)
				throw new Error(
					`Can't tell which sequence "${branch.name}" is an alternative of; pass originalId.`,
				);
			let next = renameSeq(data, original.id, `${original.name} (old)`);
			next = renameSeq(next, branch.id, original.name);
			return {
				data: next,
				summary: `Kept "${branch.name}" as "${original.name}"; the original is now "${original.name} (old)"`,
			};
		}
		case "deleteSequence": {
			if (activeSequence(data).id === op.id)
				throw new Error("Open another sequence before deleting this one.");
			const used = allSequences(data).some((q) =>
				q.clips.some(
					(c) =>
						c.type === "media" && data.assets.find((a) => a.id === c.assetId)?.sequenceId === op.id,
				),
			);
			if (used)
				throw new Error("This sequence is nested in another one. Delete those clips first.");
			return {
				data: {
					...data,
					sequences: (data.sequences ?? []).filter((q) => q.id !== op.id),
					assets: data.assets.filter((a) => a.sequenceId !== op.id),
				},
				summary: "Deleted a sequence",
			};
		}
		case "nestClips": {
			// Like Premiere's Nest: the clips move into a new sequence, which takes their place as one clip.
			const ids = withGroups(data, op.ids);
			const chosen = data.clips.filter((c) => ids.includes(c.id));
			if (!chosen.length) throw new Error("Select the clips to nest.");
			for (const c of chosen) unlocked(data, c.trackId);
			const start = Math.min(...chosen.map((c) => c.startMs));
			const end = Math.max(...chosen.map(clipEnd));
			const usedTracks = data.tracks.filter((t) => chosen.some((c) => c.trackId === t.id));
			const id = newId("s");
			const name = op.name ?? `Nested ${(data.sequences?.length ?? 0) + 1}`;
			const nested = {
				id,
				name,
				tracks: usedTracks.map((t) => ({ ...t, solo: false })),
				clips: chosen.map((c) => ({ ...c, startMs: c.startMs - start })),
				markers: [],
			};
			const assetId = newId("a");
			const place =
				usedTracks.find((t) => t.kind === "video")?.id ??
				data.tracks.filter((t) => t.kind === "video" && !t.locked).at(-1)?.id;
			if (!place) throw new Error("Nesting needs a video track to hold the new clip.");
			const withAsset: ProjectData = {
				...data,
				clips: data.clips.filter((c) => !ids.includes(c.id)),
				sequences: [...(data.sequences ?? []), nested],
				assets: [
					...data.assets,
					{
						id: assetId,
						kind: "video",
						name,
						path: "",
						sequenceId: id,
						durationMs: end - start,
						width: data.canvas.width,
						height: data.canvas.height,
						hasAudio: chosen.some(
							(c) => c.type === "media" && data.assets.find((a) => a.id === c.assetId)?.hasAudio,
						),
						origin: "import",
						createdAt: new Date().toISOString(),
						actor: "user",
					},
				],
			};
			const clip = buildClip(withAsset, {
				type: "media",
				assetId,
				trackId: place,
				startMs: start,
				durationMs: end - start,
				name,
			});
			return {
				data: { ...withAsset, clips: [...withAsset.clips, clip] },
				summary: `Nested ${chosen.length} clip(s) into "${name}"`,
				created: [clip.id, id],
			};
		}
		case "copyGrade": {
			const from = media(data, op.fromClipId);
			// Text clips have no grade; the source itself needs no copy.
			const targets = [...new Set(op.toClipIds)]
				.map((id) => clip(data, id))
				.filter((c): c is MediaClip => c.type === "media" && c.id !== from.id);
			if (!targets.length) throw new Error("Pick at least one other video or picture clip.");
			for (const c of targets) unlocked(data, c.trackId);
			const ids = new Set(targets.map((c) => c.id));
			// The whole look is copied, so an ungraded source clears the target's grade.
			const copy = (c: MediaClip): MediaClip => {
				const { color: _c, effects: _e, ...rest } = c;
				const color = from.color ? { ...from.color } : undefined;
				const effects = op.effects ? (from.effects ? { ...from.effects } : undefined) : c.effects;
				return {
					...rest,
					...(color ? { color } : {}),
					...(effects ? { effects } : {}),
				};
			};
			return {
				data: {
					...data,
					clips: data.clips.map((c) => (ids.has(c.id) ? copy(c as MediaClip) : c)),
				},
				summary: `Copied the grade of ${from.name ?? from.id} to ${targets.length} clip(s)`,
			};
		}
		case "addAdjustment": {
			let next = data;
			if (!next.assets.some((a) => a.id === ADJUSTMENT_ASSET))
				next = {
					...next,
					assets: [
						...next.assets,
						{
							id: ADJUSTMENT_ASSET,
							kind: "adjustment",
							name: "Adjustment layer",
							path: "",
							durationMs: 0,
							width: next.canvas.width,
							height: next.canvas.height,
							hasAudio: false,
							origin: "import",
							createdAt: new Date().toISOString(),
							actor: "user",
						},
					],
				};
			let trackId = op.trackId;
			if (!trackId) {
				// An adjustment layer affects the tracks below it, so it goes on a new top video track.
				const added = applyOp(next, {
					type: "addTrack",
					kind: "video",
					name: "Adjustment",
					index: 0,
				});
				next = added.data;
				trackId = added.created?.[0];
			}
			if (!trackId) throw new Error("No track for the adjustment layer.");
			const c = buildClip(next, {
				type: "media",
				assetId: ADJUSTMENT_ASSET,
				trackId,
				startMs: op.startMs,
				durationMs: op.durationMs,
				name: "Adjustment",
			});
			return {
				data: { ...next, clips: [...next.clips, { ...c, color: { ...NEUTRAL_COLOR } } as Clip] },
				summary: "Added an adjustment layer",
				created: [c.id],
			};
		}
		case "speedRamp": {
			const c = media(data, op.clipId);
			unlocked(data, c.trackId);
			const a = Math.max(0, Math.round(op.fromMs ?? 0));
			const b = Math.min(c.durationMs, Math.round(op.toMs ?? c.durationMs));
			if (b - a < 200) throw new Error("Ramp at least a fifth of a second.");
			const base = c.speed;
			const span = (b - a) * base;
			// How far towards the peak each step goes: 0 = the clip's speed, 1 = the peak.
			const weight = (u: number) =>
				op.shape === "up"
					? (1 - Math.cos(Math.PI * u)) / 2
					: op.shape === "down"
						? (1 + Math.cos(Math.PI * u)) / 2
						: Math.sin(Math.PI * u);
			const pieces: MediaClip[] = [];
			let at = c.startMs + a;
			let source = c.inMs + a * base;
			for (let i = 0; i < op.steps; i++) {
				const w = weight((i + 0.5) / op.steps);
				const speed = Math.min(8, Math.max(0.1, base * (op.peak / base) ** w));
				const length = Math.max(1, Math.round(span / op.steps / speed));
				pieces.push({
					...c,
					id: newId("c"),
					startMs: Math.round(at),
					durationMs: length,
					inMs: Math.round(source),
					speed: Math.round(speed * 1000) / 1000,
					fadeInMs: 0,
					fadeOutMs: 0,
					transitionIn: undefined,
					keyframes: undefined,
					zooms: undefined,
				});
				at += length;
				source += span / op.steps;
			}
			const head: MediaClip[] = a > 0 ? [{ ...c, durationMs: a, fadeOutMs: 0 }] : [];
			const tail: MediaClip[] =
				b < c.durationMs
					? [
							{
								...c,
								id: newId("c"),
								startMs: Math.round(at),
								durationMs: c.durationMs - b,
								inMs: Math.round(c.inMs + b * base),
								fadeInMs: 0,
								transitionIn: undefined,
							},
						]
					: [];
			if (head.length) head[0].fadeInMs = c.fadeInMs;
			(tail.at(0) ?? (pieces.at(-1) as MediaClip)).fadeOutMs = c.fadeOutMs;
			// Later clips on the track move by however much longer or shorter the clip became.
			const delta = Math.round(at - (c.startMs + b));
			const end = clipEnd(c);
			const others = data.clips
				.filter((x) => x.id !== c.id)
				.map((x) =>
					x.trackId === c.trackId && x.startMs >= end - 1
						? { ...x, startMs: Math.max(0, x.startMs + delta) }
						: x,
				);
			return {
				data: { ...data, clips: [...others, ...head, ...pieces, ...tail] },
				summary: `Speed ramp on ${c.name ?? c.id}: ${base}× → ${op.peak}× (${op.shape})`,
				created: pieces.map((p) => p.id),
			};
		}
		case "liftRange": {
			if (op.endMs - op.startMs < 2) throw new Error("Mark an in and an out point first.");
			const affected = new Set(
				op.trackIds ?? data.tracks.filter((t) => !t.locked).map((t) => t.id),
			);
			return {
				data: clearRange(data, op.startMs, op.endMs, affected),
				summary: `Lifted ${sec(op.endMs - op.startMs)}, leaving a gap`,
			};
		}
		case "insertEdit": {
			const a = asset(data, op.assetId);
			unlocked(data, op.trackId);
			const inMs = op.inMs ?? 0;
			const outMs = op.outMs ?? (a.kind === "image" ? inMs + 5000 : a.durationMs);
			const width = Math.round(outMs - inMs);
			if (width < 1) throw new Error("The out point must come after the in point.");
			let next = data;
			if (op.mode === "overwrite") {
				next = clearRange(next, op.atMs, op.atMs + width, new Set([op.trackId]));
			} else {
				// Insert pushes everything after the playhead along, on every unlocked track.
				const affected = new Set(next.tracks.filter((t) => !t.locked).map((t) => t.id));
				for (const c of next.clips)
					if (affected.has(c.trackId) && op.atMs > c.startMs + 1 && op.atMs < clipEnd(c) - 1)
						next = splitOne(next, c, op.atMs).data;
				next = {
					...next,
					clips: next.clips.map((c) =>
						affected.has(c.trackId) && c.startMs >= op.atMs - 1
							? { ...c, startMs: c.startMs + width }
							: c,
					),
					lines: next.lines.map((l) =>
						l.startMs >= op.atMs ? { ...l, startMs: l.startMs + width } : l,
					),
					markers: next.markers.map((m) =>
						m.atMs >= op.atMs ? { ...m, atMs: m.atMs + width } : m,
					),
				};
			}
			const c = buildClip(next, {
				type: "media",
				assetId: a.id,
				trackId: op.trackId,
				startMs: op.atMs,
				inMs: a.kind === "image" ? 0 : inMs,
				durationMs: width,
			});
			if (op.mode === "overwrite") {
				// The sound it brings replaces what was on the sound track there too.
				const soundTrack = next.tracks.find((t) => t.kind === "audio" && !t.voiceover && !t.locked);
				if (soundTrack && a.kind === "video" && a.hasAudio && next.settings.separateAudio !== false)
					next = clearRange(next, op.atMs, op.atMs + width, new Set([soundTrack.id]));
			}
			const sound = withSeparateSound({ ...next, clips: [...next.clips, c] }, [c.id]);
			return {
				data: sound.data,
				summary: `${op.mode === "insert" ? "Inserted" : "Overwrote with"} ${a.name} (${sec(width)})`,
				created: [c.id, ...sound.created],
			};
		}
		case "detachAudio": {
			const c = clip(data, op.id);
			if (c.type !== "media") throw new Error("Only media clips have audio.");
			const a = asset(data, c.assetId);
			if (a.kind !== "video" || !a.hasAudio) throw new Error(`"${a.name}" has no audio to detach.`);
			let next = data;
			let trackId =
				op.trackId ??
				next.tracks.find(
					(t) =>
						t.kind === "audio" &&
						!t.voiceover &&
						!t.locked &&
						!next.clips.some(
							(x) => x.trackId === t.id && x.startMs < clipEnd(c) && clipEnd(x) > c.startMs,
						),
				)?.id;
			if (!trackId) {
				const created = applyOp(next, { type: "addTrack", kind: "audio", name: "Sound" });
				next = created.data;
				trackId = created.created?.[0];
			}
			if (!trackId) throw new Error("No audio track available.");
			// Picture and sound stay linked (they move together) until the user unlinks them.
			const groupId = c.groupId ?? newId("g");
			const audio: MediaClip = {
				...c,
				id: newId("c"),
				trackId,
				transform: { ...DEFAULT_TRANSFORM },
				lineId: undefined,
				groupId,
				zooms: undefined,
				keyframes: undefined,
				color: undefined,
				name: `${c.name ?? a.name} (audio)`,
			};
			next = {
				...next,
				clips: [
					...next.clips.map((x) => (x.id === c.id ? { ...c, volume: 0, groupId } : x)),
					validateClip(next, audio),
				],
			};
			return {
				data: next,
				summary: `Detached the audio of ${c.name ?? a.name}`,
				created: [audio.id],
			};
		}
		case "setKeyframe": {
			const c = media(data, op.clipId);
			unlocked(data, c.trackId);
			const keyframe = tidyKeyframe(op.keyframe, c.durationMs);
			const keyframes = {
				...c.keyframes,
				[op.prop]: withKeyframe(c.keyframes?.[op.prop], keyframe),
			};
			return {
				data: replaceClip(data, { ...c, keyframes }),
				summary: `Set a ${op.prop} keyframe at ${sec(keyframe.atMs)} on ${c.name ?? c.id}`,
			};
		}
		case "removeKeyframe": {
			const c = media(data, op.clipId);
			const list = (c.keyframes?.[op.prop] ?? []).filter((k) => Math.abs(k.atMs - op.atMs) > 10);
			const keyframes = { ...c.keyframes, [op.prop]: list };
			if (list.length === 0) delete keyframes[op.prop];
			return {
				data: replaceClip(data, { ...c, keyframes }),
				summary: `Removed a ${op.prop} keyframe`,
			};
		}
		case "editKeyframes": {
			const c = media(data, op.clipId);
			unlocked(data, c.trackId);
			const lists: Partial<Record<KeyframeProp, Keyframe[]>> = { ...c.keyframes };
			const placed: [KeyframeProp, Keyframe][] = [];
			// Every edited keyframe is lifted out first, so selections can move past each other.
			for (const e of op.edits) {
				const list = lists[e.prop] ?? [];
				const k = list.find((x) => Math.abs(x.atMs - e.atMs) <= 10);
				if (!k) throw new Error(`No ${e.prop} keyframe at ${sec(e.atMs)} on ${c.name ?? c.id}.`);
				lists[e.prop] = list.filter((x) => x !== k);
				if (e.remove) continue;
				// A new named ease drops the old custom curve.
				const curve = e.curve ?? (e.ease && e.ease !== k.ease ? undefined : k.curve);
				placed.push([
					e.prop,
					tidyKeyframe(
						{
							atMs: e.toMs ?? k.atMs,
							value: e.value ?? k.value,
							ease: e.ease ?? k.ease,
							...(curve ? { curve } : {}),
						},
						c.durationMs,
					),
				]);
			}
			for (const [prop, k] of placed) lists[prop] = withKeyframe(lists[prop], k);
			for (const prop of Object.keys(lists) as KeyframeProp[])
				if (!lists[prop]?.length) delete lists[prop];
			const count = `${op.edits.length} keyframe${op.edits.length === 1 ? "" : "s"}`;
			const verb = op.edits.every((e) => e.remove)
				? "Removed"
				: op.edits.some((e) => e.toMs !== undefined || e.value !== undefined)
					? "Moved"
					: "Changed the ease of";
			return {
				data: replaceClip(data, { ...c, keyframes: lists }),
				summary: `${verb} ${count} on ${c.name ?? c.id}`,
			};
		}
		case "clearKeyframes": {
			const c = media(data, op.clipId);
			const keyframes = { ...c.keyframes };
			if (op.prop) delete keyframes[op.prop];
			return {
				data: replaceClip(data, { ...c, keyframes: op.prop ? keyframes : {} }),
				summary: `Cleared ${op.prop ?? "all"} keyframes`,
			};
		}
		case "addZoom": {
			const c = media(data, op.clipId);
			unlocked(data, c.trackId);
			if (op.endMs - op.startMs < 200) throw new Error("A zoom needs at least 0.2 s.");
			const zoom = {
				id: newId("z"),
				startMs: Math.round(op.startMs),
				endMs: Math.round(Math.min(op.endMs, c.durationMs)),
				scale: op.scale,
				x: op.x,
				y: op.y,
				easeMs: op.easeMs,
			};
			const zooms = [
				...(c.zooms ?? []).filter((z) => z.endMs <= zoom.startMs || z.startMs >= zoom.endMs),
				zoom,
			].sort((a, b) => a.startMs - b.startMs);
			return {
				data: replaceClip(data, { ...c, zooms }),
				summary: `Added a ${op.scale.toFixed(1)}× zoom at ${sec(zoom.startMs)} in ${c.name ?? c.id}`,
				created: [zoom.id],
			};
		}
		case "updateZoom": {
			const c = media(data, op.clipId);
			if (!(c.zooms ?? []).some((z) => z.id === op.zoomId))
				throw new Error(`No zoom ${op.zoomId}.`);
			const zooms = (c.zooms ?? [])
				.map((z) => (z.id === op.zoomId ? { ...z, ...op.patch } : z))
				.sort((a, b) => a.startMs - b.startMs);
			return {
				data: replaceClip(data, { ...c, zooms }),
				summary: `Edited a zoom (${Object.keys(op.patch).join(", ")})`,
			};
		}
		case "removeZoom": {
			const c = media(data, op.clipId);
			return {
				data: replaceClip(data, { ...c, zooms: (c.zooms ?? []).filter((z) => z.id !== op.zoomId) }),
				summary: "Removed a zoom",
			};
		}
		case "addTransition": {
			const c = media(data, op.clipId);
			unlocked(data, c.trackId);
			const left = leftNeighbour(data, c);
			if (!left)
				throw new Error("A transition needs a clip right before this one on the same track.");
			const d = Math.round(
				Math.min(op.transition.durationMs, c.durationMs / 2, left.durationMs / 2),
			);
			let next = data;
			const kind = op.transition.kind;
			// Replacing a transition starts from the clips as they were without it.
			if (c.transitionIn) {
				next = applyOp(next, { type: "removeTransition", clipId: c.id }).data;
			}
			if (kind !== "dip") {
				// Overlap the clips by d: this clip and everything after it on the track move left.
				const current = clip(next, c.id);
				const before = leftNeighbour(next, current) ?? left;
				const shift = d - Math.max(0, clipEnd(before) - current.startMs);
				next = shiftTrackFrom(next, current, -shift);
				const moved = clip(next, c.id) as MediaClip;
				next = replaceClip(next, {
					...moved,
					// Wipes and slides keep the picture solid; the others fade it in too.
					fadeInMs: fadesIn({ kind, durationMs: d }) ? d : 0,
					transitionIn: { kind, durationMs: d },
				});
			} else {
				next = replaceClip(next, { ...(left as MediaClip), fadeOutMs: Math.round(d / 2) });
				next = replaceClip(next, {
					...(clip(next, c.id) as MediaClip),
					fadeInMs: Math.round(d / 2),
					transitionIn: { kind: "dip", durationMs: d },
				});
			}
			return {
				data: next,
				summary: `Added a ${sec(d)} ${transitionLabel(kind).toLowerCase()} into ${c.name ?? c.id}`,
			};
		}
		case "removeTransition": {
			const c = media(data, op.clipId);
			if (!c.transitionIn) throw new Error("That clip has no transition.");
			let next = data;
			const left = leftNeighbour(data, c, c.transitionIn.durationMs + 60);
			if (overlaps(c.transitionIn)) {
				const shift = left ? Math.max(0, clipEnd(left) - c.startMs) : 0;
				next = shiftTrackFrom(next, c, shift);
			} else if (left && left.type === "media") next = replaceClip(next, { ...left, fadeOutMs: 0 });
			const { transitionIn: _gone, ...rest } = clip(next, c.id) as MediaClip;
			next = replaceClip(next, { ...rest, fadeInMs: 0 });
			return { data: next, summary: "Removed a transition" };
		}
		case "groupClips": {
			const groupId = newId("g");
			for (const id of op.ids) clip(data, id);
			return {
				data: {
					...data,
					clips: data.clips.map((c) => (op.ids.includes(c.id) ? { ...c, groupId } : c)),
				},
				summary: `Linked ${op.ids.length} clips`,
			};
		}
		case "ungroupClips": {
			const ids = withGroups(data, op.ids);
			return {
				data: {
					...data,
					clips: data.clips.map((c) =>
						ids.includes(c.id) ? (({ groupId: _g, ...rest }) => rest as Clip)(c) : c,
					),
				},
				summary: `Unlinked ${ids.length} clips`,
			};
		}
		case "slipClip": {
			const c = media(data, op.id);
			unlocked(data, c.trackId);
			const a = asset(data, c.assetId);
			if (a.kind === "image") throw new Error("Images have nothing to slip.");
			const maxIn = Math.max(0, a.durationMs - c.durationMs * c.speed);
			const inMs = Math.round(Math.min(maxIn, Math.max(0, c.inMs + op.deltaMs * c.speed)));
			return {
				data: replaceClip(data, { ...c, inMs }),
				summary: `Slipped ${c.name ?? c.id} to in-point ${sec(inMs)}`,
			};
		}
		case "rollEdit": {
			const left = clip(data, op.leftId);
			const right = clip(data, op.rightId);
			if (left.trackId !== right.trackId || Math.abs(clipEnd(left) - right.startMs) > 60)
				throw new Error("Roll works on two adjacent clips on the same track.");
			unlocked(data, left.trackId);
			let to = op.toMs;
			const bound = (c: Clip, edge: "start" | "end") => {
				if (c.type !== "media") return edge === "end" ? Number.POSITIVE_INFINITY : 0;
				const a = asset(data, c.assetId);
				if (a.kind === "image") return edge === "end" ? Number.POSITIVE_INFINITY : 0;
				if (a.kind === "lottie" && edge === "end") return Number.POSITIVE_INFINITY;
				return edge === "end"
					? c.startMs + (a.durationMs - c.inMs) / c.speed
					: c.startMs - c.inMs / c.speed;
			};
			to = Math.min(to, bound(left, "end"), clipEnd(right) - 20);
			to = Math.max(to, bound(right, "start"), left.startMs + 20);
			const delta = to - right.startMs;
			const nextLeft = { ...left, durationMs: Math.round(to - left.startMs) } as Clip;
			const nextRight = (
				right.type === "media"
					? {
							...right,
							startMs: Math.round(to),
							durationMs: Math.round(clipEnd(right) - to),
							inMs: Math.max(0, Math.round(right.inMs + delta * right.speed)),
						}
					: { ...right, startMs: Math.round(to), durationMs: Math.round(clipEnd(right) - to) }
			) as Clip;
			return {
				data: replaceClip(replaceClip(data, nextLeft), nextRight),
				summary: `Rolled the cut to ${sec(to)}`,
			};
		}
		case "slideClip": {
			const c = clip(data, op.id);
			unlocked(data, c.trackId);
			const left = leftNeighbour(data, c, 2);
			const right = rightNeighbour(data, c, 2);
			let delta = op.deltaMs;
			if (left) delta = Math.max(delta, -(left.durationMs - 20));
			if (right) delta = Math.min(delta, right.durationMs - 20);
			if (!left) delta = Math.max(delta, -c.startMs);
			let next = replaceClip(data, { ...c, startMs: Math.round(c.startMs + delta) } as Clip);
			if (left)
				next = replaceClip(
					next,
					validateClip(next, { ...left, durationMs: Math.round(left.durationMs + delta) } as Clip),
				);
			if (right) {
				const r =
					right.type === "media"
						? {
								...right,
								startMs: Math.round(right.startMs + delta),
								durationMs: Math.round(right.durationMs - delta),
								inMs: Math.max(0, Math.round(right.inMs + delta * right.speed)),
							}
						: {
								...right,
								startMs: Math.round(right.startMs + delta),
								durationMs: Math.round(right.durationMs - delta),
							};
				next = replaceClip(next, r as Clip);
			}
			return { data: next, summary: `Slid ${c.name ?? c.id} by ${sec(delta)}` };
		}
		case "setLines": {
			const lines = sortLines(op.lines.map(normaliseLine));
			assertUnique(
				lines.map((l) => l.id),
				"line",
			);
			const ids = new Set(lines.map((l) => l.id));
			const clips = data.clips.map((c) =>
				c.type === "media" && c.lineId && !ids.has(c.lineId) ? { ...c, lineId: undefined } : c,
			);
			return {
				data: { ...data, lines, clips },
				summary: `Replaced the script with ${lines.length} lines`,
			};
		}
		case "addLine": {
			const line = normaliseLine(op.line);
			const lines = sortLines([...data.lines, line]);
			assertUnique(
				lines.map((l) => l.id),
				"line",
			);
			return { data: { ...data, lines }, summary: `Added line ${line.id} at ${sec(line.startMs)}` };
		}
		case "updateLine": {
			const current = data.lines.find((l) => l.id === op.id);
			if (!current) throw new Error(`No line "${op.id}".`);
			const next = normaliseLine({ ...current, ...op.patch });
			const lines = sortLines(data.lines.map((l) => (l.id === op.id ? next : l)));
			assertUnique(
				lines.map((l) => l.id),
				"line",
			);
			let { assets, clips } = data;
			if (next.id !== op.id) {
				assets = assets.map((a) => (a.lineId === op.id ? { ...a, lineId: next.id } : a));
				clips = clips.map((c) =>
					c.type === "media" && c.lineId === op.id ? { ...c, lineId: next.id } : c,
				);
			}
			if (op.patch.startMs !== undefined && op.patch.startMs !== current.startMs) {
				const delta = next.startMs - current.startMs;
				clips = clips.map((c) =>
					c.type === "media" && c.lineId === next.id
						? { ...c, startMs: Math.max(0, c.startMs + delta) }
						: c,
				);
			}
			return {
				data: { ...data, lines, assets, clips },
				summary: `Updated line ${op.id} (${Object.keys(op.patch).join(", ")})`,
			};
		}
		case "removeLine": {
			if (!data.lines.some((l) => l.id === op.id)) throw new Error(`No line "${op.id}".`);
			return {
				data: {
					...data,
					lines: data.lines.filter((l) => l.id !== op.id),
					clips: data.clips.map((c) =>
						c.type === "media" && c.lineId === op.id ? { ...c, lineId: undefined } : c,
					),
					assets: data.assets.map((a) => (a.lineId === op.id ? { ...a, lineId: undefined } : a)),
				},
				summary: `Removed line ${op.id} (its takes stay in the media library)`,
			};
		}
		case "shiftLines": {
			const moved = new Set(data.lines.filter((l) => l.startMs >= op.fromMs).map((l) => l.id));
			const lines = sortLines(
				data.lines.map((l) =>
					moved.has(l.id) ? { ...l, startMs: Math.max(0, l.startMs + op.deltaMs) } : l,
				),
			);
			const clips = op.withClips
				? data.clips.map((c) =>
						c.type === "media" && c.lineId && moved.has(c.lineId)
							? { ...c, startMs: Math.max(0, c.startMs + op.deltaMs) }
							: c,
					)
				: data.clips;
			return {
				data: { ...data, lines, clips },
				summary: `Shifted ${moved.size} line(s) by ${sec(op.deltaMs)}`,
			};
		}
		case "rippleFrom": {
			// Everything from fromMs on moves together: clips on every track, script lines and
			// markers. Pulled earlier, nothing moves before fromMs + deltaMs's room: it stops at fromMs.
			const at = op.fromMs;
			const delta = op.deltaMs < 0 ? Math.max(op.deltaMs, -at) : op.deltaMs;
			const move = (t: number) => (t >= at ? Math.max(at + Math.min(0, delta), t + delta) : t);
			const clips = data.clips.map((c) => (c.startMs >= at ? { ...c, startMs: move(c.startMs) } : c));
			const lines = sortLines(data.lines.map((l) => (l.startMs >= at ? { ...l, startMs: move(l.startMs) } : l)));
			const markers = data.markers.map((m) => (m.atMs >= at ? { ...m, atMs: move(m.atMs) } : m));
			const moved = data.clips.filter((c) => c.startMs >= at).length;
			return {
				data: { ...data, clips, lines, markers },
				summary: `${delta >= 0 ? "Made room" : "Closed the gap"}: moved ${moved} clip(s) from ${sec(at)} by ${sec(delta)}`,
			};
		}
		case "chooseTake": {
			if (!data.lines.some((l) => l.id === op.lineId)) throw new Error(`No line "${op.lineId}".`);
			if (op.assetId === null) {
				return {
					data: {
						...data,
						clips: data.clips.filter((c) => !(c.type === "media" && c.lineId === op.lineId)),
					},
					summary: `Removed the voiceover clip for ${op.lineId}`,
				};
			}
			const a = asset(data, op.assetId);
			if (a.lineId !== op.lineId) throw new Error(`"${a.name}" is not a take of ${op.lineId}.`);
			return { data: placeTake(data, a), summary: `Chose ${a.name} for ${op.lineId}` };
		}
		case "deleteTake": {
			const a = asset(data, op.assetId);
			let next: ProjectData = { ...data, assets: data.assets.filter((x) => x.id !== a.id) };
			const usedBy = data.clips.find(
				(c): c is MediaClip => c.type === "media" && c.assetId === a.id && c.lineId === a.lineId,
			);
			if (usedBy) {
				next = { ...next, clips: next.clips.filter((c) => c.id !== usedBy.id) };
				const fallback = next.assets.filter((x) => x.lineId === a.lineId).at(-1);
				if (fallback) next = placeTake(next, fallback);
			}
			// Any other use of the take (a copy, another sequence) goes with it.
			next = withoutAssetClips(next, a.id);
			return { data: next, summary: `Deleted take ${a.name}${a.lineId ? ` of ${a.lineId}` : ""}` };
		}

		case "addMarker":
			return {
				data: {
					...data,
					markers: [
						...data.markers,
						{ id: newId("m"), atMs: op.atMs, label: op.label, color: op.color },
					],
				},
				summary: `Added marker "${op.label}" at ${sec(op.atMs)}`,
			};
		case "updateMarker": {
			if (!data.markers.some((m) => m.id === op.id)) throw new Error(`No marker "${op.id}".`);
			return {
				data: {
					...data,
					markers: data.markers.map((m) => (m.id === op.id ? { ...m, ...op.patch } : m)),
				},
				summary: "Edited a marker",
			};
		}
		case "clearMarkers": {
			const keep = data.markers.filter((m) => op.label !== undefined && m.label !== op.label);
			return {
				data: { ...data, markers: keep },
				summary: `Removed ${data.markers.length - keep.length} marker(s)`,
			};
		}
		case "removeMarker":
			return {
				data: { ...data, markers: data.markers.filter((m) => m.id !== op.id) },
				summary: "Removed a marker",
			};
		case "updateSettings":
			return {
				data: { ...data, settings: { ...data.settings, ...op.settings } },
				summary: `Changed recording settings (${Object.keys(op.settings).join(", ")})`,
			};
		case "updateExport":
			return {
				data: { ...data, export: { ...data.export, ...op.export } },
				summary: `Changed export settings (${Object.keys(op.export).join(", ")})`,
			};
		case "updateAi":
			return {
				data: { ...data, ai: { ...data.ai, ...op.ai } },
				summary: `Changed AI settings (${Object.keys(op.ai).join(", ")})`,
			};
	}
}
