import { z } from "zod";
import { withKeyframe } from "./anim";
import {
	aiSchema,
	assertUnique,
	clipEnd,
	colorSchema,
	cropSchema,
	DEFAULT_TEXT_STYLE,
	DEFAULT_TRANSFORM,
	exportSchema,
	keyframeSchema,
	lineInputSchema,
	NEUTRAL_COLOR,
	NO_CROP,
	newId,
	normaliseLine,
	settingsSchema,
	sortLines,
	takeClip,
	textStyleSchema,
	transformSchema,
	transitionSchema,
	voiceoverTrack,
} from "./project";
import type { Asset, Clip, MediaClip, ProjectData, Track } from "./types";

/**
 * Every edit is one of these operations. The editor window, the control
 * server and the MCP bridge all use this list, so undo, autosave, validation
 * and the activity feed behave the same whoever makes the change.
 */
const ms = z.number();
const animation = z.enum(["none", "fade", "pop", "slide-up", "typewriter"]);

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
	denoise: z.boolean().optional(),
	name: z.string().max(120).optional(),
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
		denoise: z.boolean(),
		color: colorSchema.partial(),
		text: z.string().max(4000),
		style: textStyleSchema.partial(),
		animationIn: animation,
		animationOut: animation,
		name: z.string().max(120),
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
		trackId: z.string().optional(),
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
	}),
	z.object({
		type: z.literal("removeRanges"),
		ranges: z.array(z.object({ startMs: ms.min(0), endMs: ms.min(0) })).min(1),
		trackIds: z.array(z.string()).optional(),
	}),
	z.object({ type: z.literal("detachAudio"), id: z.string(), trackId: z.string().optional() }),
	// Keyframes, zooms, transitions and groups
	z.object({
		type: z.literal("setKeyframe"),
		clipId: z.string(),
		prop: z.enum(["x", "y", "scale", "volume"]),
		keyframe: keyframeSchema,
	}),
	z.object({
		type: z.literal("removeKeyframe"),
		clipId: z.string(),
		prop: z.enum(["x", "y", "scale", "volume"]),
		atMs: ms,
	}),
	z.object({
		type: z.literal("clearKeyframes"),
		clipId: z.string(),
		prop: z.enum(["x", "y", "scale", "volume"]).optional(),
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
	/** New file locations for media that moved (path as stored in the project). */
	| { type: "relinkAssets"; paths: Record<string, { path: string; relPath: string }> };

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

function unlocked(data: ProjectData, trackId: string): Track {
	const t = track(data, trackId);
	if (t.locked) throw new Error(`Track "${t.name}" is locked.`);
	return t;
}

/** Checks a clip against its track kind and the length of its source. */
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
	if (t.kind === "audio" && a.kind === "image")
		throw new Error(`Image "${a.name}" cannot go on audio track "${t.name}".`);
	if (t.kind === "audio" && !a.hasAudio && a.kind === "video")
		throw new Error(`"${a.name}" has no audio.`);
	if (a.kind !== "image") {
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
		});
	}
	const a = asset(data, input.assetId);
	const inMs = Math.round(input.inMs ?? 0);
	const speed = input.speed ?? 1;
	const natural = a.kind === "image" ? 5000 : (a.durationMs - inMs) / speed;
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
		denoise: input.denoise ?? false,
		name: input.name ?? a.name,
	});
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
	const right: Clip =
		c.type === "media"
			? {
					...c,
					id: newId("c"),
					startMs: Math.round(atMs),
					durationMs: c.durationMs - leftLength,
					inMs: Math.round(c.inMs + leftLength * c.speed),
					fadeInMs: 0,
				}
			: {
					...c,
					id: newId("c"),
					startMs: Math.round(atMs),
					durationMs: c.durationMs - leftLength,
					animationIn: "none",
				};
	const left: Clip =
		c.type === "media"
			? { ...c, durationMs: leftLength, fadeOutMs: 0 }
			: { ...c, durationMs: leftLength, animationOut: "none" };
	const index = data.clips.findIndex((candidate) => candidate.id === c.id);
	const clips = [...data.clips];
	clips.splice(index, 1, left, right);
	return { data: { ...data, clips }, created: right.id };
}

/** Puts a take on the voiceover track as the line's clip, replacing the previous one. */
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
			next = { ...next, clips: [...next.clips, c] };
			created = [c.id];
		}
		return { data: next, summary: `Added ${rawOp.asset.kind} "${rawOp.asset.name}"`, created };
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
			const clips = data.clips.filter((c) => !(c.type === "media" && c.assetId === op.id));
			return {
				data: { ...data, assets: data.assets.filter((x) => x.id !== op.id), clips },
				summary: `Removed "${a.name}" and ${data.clips.length - clips.length} clip(s)`,
			};
		}

		case "addTrack": {
			const prefix = { video: "V", audio: "A", text: "T" }[op.kind];
			let n = 1;
			while (data.tracks.some((t) => t.id === `${prefix}${n}`)) n++;
			const t: Track = {
				id: `${prefix}${n}`,
				kind: op.kind,
				name: op.name ?? `${op.kind[0].toUpperCase()}${op.kind.slice(1)} ${n}`,
				muted: false,
				locked: false,
				hidden: false,
				volume: 1,
			};
			const tracks = [...data.tracks];
			tracks.splice(op.index ?? tracks.length, 0, t);
			return {
				data: { ...data, tracks },
				summary: `Added ${op.kind} track "${t.name}"`,
				created: [t.id],
			};
		}
		case "updateTrack": {
			track(data, op.id);
			let tracks = data.tracks.map((t) => (t.id === op.id ? { ...t, ...op.patch } : t));
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
			return { data: { ...data, tracks }, summary: `Moved track "${t.name}"` };
		}

		case "addClips": {
			let next = data;
			const created: string[] = [];
			for (const input of op.clips) {
				const c = buildClip(next, input);
				next = { ...next, clips: [...next.clips, c] };
				created.push(c.id);
			}
			assertUnique(
				next.clips.map((c) => c.id),
				"clip",
			);
			return { data: next, summary: `Added ${created.length} clip(s)`, created };
		}
		case "updateClip": {
			const current = clip(data, op.id);
			unlocked(data, current.trackId);
			const { transform, style, color, ...rest } = op.patch;
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
					: { ...current, ...rest, style: { ...current.style, ...style } };
			if (current.type === "media" && (op.patch.text !== undefined || style))
				throw new Error("Only text clips have text and style.");
			const next = validateClip(data, merged as Clip);
			return {
				data: replaceClip(data, next),
				summary: `Edited clip ${current.name ?? current.id} (${Object.keys(op.patch).join(", ")})`,
			};
		}
		case "moveClips": {
			let next = data;
			const ids = op.trackId ? op.ids : withGroups(data, op.ids);
			for (const id of ids) {
				const c = clip(next, id);
				unlocked(next, c.trackId);
				const moved = validateClip(next, {
					...c,
					startMs: Math.max(0, Math.round(c.startMs + op.deltaMs)),
					trackId: op.trackId ?? c.trackId,
				} as Clip);
				next = replaceClip(next, moved);
			}
			return {
				data: next,
				summary: `Moved ${ids.length} clip(s) by ${sec(op.deltaMs)}${op.trackId ? ` to ${op.trackId}` : ""}`,
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
					next = validateClip(data, {
						...c,
						startMs: Math.max(0, start),
						durationMs: end - Math.max(0, start),
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
			for (const id of op.ids) {
				const c = clip(next, id);
				const copy = validateClip(next, {
					...c,
					id: newId("c"),
					startMs: Math.round(op.offsetMs !== undefined ? c.startMs + op.offsetMs : clipEnd(c)),
					...(c.type === "media" ? { lineId: undefined } : {}),
				} as Clip);
				next = { ...next, clips: [...next.clips, copy] };
				created.push(copy.id);
			}
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
				const created = applyOp(next, { type: "addTrack", kind: "audio", name: "Detached audio" });
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
			const keyframe = {
				...op.keyframe,
				atMs: Math.round(Math.min(Math.max(0, op.keyframe.atMs), c.durationMs)),
			};
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
			if (op.transition.kind === "crossfade") {
				// Overlap the clips by d: this clip and everything after it on the track move left.
				const shift = d - Math.max(0, clipEnd(left) - c.startMs);
				next = {
					...next,
					clips: next.clips.map((x) =>
						x.trackId === c.trackId && x.startMs >= c.startMs - 1
							? { ...x, startMs: Math.max(0, x.startMs - shift) }
							: x,
					),
				};
				const moved = clip(next, c.id) as MediaClip;
				next = replaceClip(next, {
					...moved,
					fadeInMs: d,
					transitionIn: { kind: "crossfade", durationMs: d },
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
				summary: `Added a ${sec(d)} ${op.transition.kind === "crossfade" ? "crossfade" : "dip to black"} into ${c.name ?? c.id}`,
			};
		}
		case "removeTransition": {
			const c = media(data, op.clipId);
			if (!c.transitionIn) throw new Error("That clip has no transition.");
			let next = data;
			const left = leftNeighbour(data, c, c.transitionIn.durationMs + 60);
			if (c.transitionIn.kind === "crossfade") {
				const shift = left ? Math.max(0, clipEnd(left) - c.startMs) : 0;
				next = {
					...next,
					clips: next.clips.map((x) =>
						x.trackId === c.trackId && x.startMs >= c.startMs - 1
							? { ...x, startMs: x.startMs + shift }
							: x,
					),
				};
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
