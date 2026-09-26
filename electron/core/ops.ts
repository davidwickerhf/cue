import { z } from "zod";
import {
	DEFAULT_TEXT_STYLE,
	aiSchema,
	exportSchema,
	settingsSchema,
	DEFAULT_TRANSFORM,
	assertUnique,
	clipEnd,
	lineInputSchema,
	newId,
	normaliseLine,
	sortLines,
	takeClip,
	textStyleSchema,
	transformSchema,
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
	transform: transformSchema.partial().optional(),
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

export const clipPatch = z.object({
	trackId: z.string(),
	startMs: ms.min(0),
	durationMs: ms.min(1),
	inMs: ms.min(0),
	speed: z.number().min(0.1).max(8),
	volume: z.number().min(0).max(2),
	fadeInMs: ms.min(0),
	fadeOutMs: ms.min(0),
	transform: transformSchema.partial(),
	text: z.string().max(4000),
	style: textStyleSchema.partial(),
	animationIn: animation,
	animationOut: animation,
	name: z.string().max(120),
}).partial();

const trackPatch = z
	.object({
		name: z.string().min(1).max(80),
		muted: z.boolean(),
		locked: z.boolean(),
		hidden: z.boolean(),
		volume: z.number().min(0).max(2),
		voiceover: z.boolean(),
	})
	.partial();

export const opSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("rename"), name: z.string().min(1).max(200) }),
	z.object({
		type: z.literal("setCanvas"),
		canvas: z
			.object({ width: z.number().int().min(16).max(7680), height: z.number().int().min(16).max(4320), fps: z.number().min(1).max(120), background: z.string() })
			.partial(),
	}),
	// Media library
	z.object({ type: z.literal("renameAsset"), id: z.string(), name: z.string().min(1).max(200) }),
	z.object({ type: z.literal("removeAsset"), id: z.string() }),
	// Tracks
	z.object({ type: z.literal("addTrack"), kind: z.enum(["video", "audio", "text"]), name: z.string().max(80).optional(), index: z.number().int().optional() }),
	z.object({ type: z.literal("updateTrack"), id: z.string(), patch: trackPatch }),
	z.object({ type: z.literal("removeTrack"), id: z.string() }),
	z.object({ type: z.literal("moveTrack"), id: z.string(), index: z.number().int().min(0) }),
	// Clips
	z.object({ type: z.literal("addClips"), clips: z.array(clipInput).min(1) }),
	z.object({ type: z.literal("updateClip"), id: z.string(), patch: clipPatch }),
	z.object({ type: z.literal("moveClips"), ids: z.array(z.string()).min(1), deltaMs: ms, trackId: z.string().optional() }),
	z.object({ type: z.literal("trimClip"), id: z.string(), edge: z.enum(["start", "end"]), toMs: ms.min(0) }),
	z.object({ type: z.literal("splitClip"), id: z.string(), atMs: ms }),
	z.object({ type: z.literal("splitAt"), atMs: ms, trackIds: z.array(z.string()).optional() }),
	z.object({ type: z.literal("removeClips"), ids: z.array(z.string()).min(1), ripple: z.boolean().default(false) }),
	z.object({ type: z.literal("duplicateClips"), ids: z.array(z.string()).min(1), offsetMs: ms.optional() }),
	// Voiceover script
	z.object({ type: z.literal("setLines"), lines: z.array(lineInputSchema) }),
	z.object({ type: z.literal("addLine"), line: lineInputSchema }),
	z.object({ type: z.literal("updateLine"), id: z.string(), patch: lineInputSchema.partial() }),
	z.object({ type: z.literal("removeLine"), id: z.string() }),
	z.object({ type: z.literal("shiftLines"), fromMs: ms, deltaMs: ms, withClips: z.boolean().default(true) }),
	z.object({ type: z.literal("chooseTake"), lineId: z.string(), assetId: z.string().nullable() }),
	z.object({ type: z.literal("deleteTake"), assetId: z.string() }),
	// Markers and settings
	z.object({ type: z.literal("addMarker"), atMs: ms.min(0), label: z.string().max(200), color: z.enum(["accent", "success", "warning", "danger"]).default("accent") }),
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
	| { type: "addTake"; asset: Asset };

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
	if (!found) throw new Error(`No track "${id}". Tracks: ${data.tracks.map((t) => t.id).join(", ")}.`);
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
	if (t.kind === "video" && a.kind === "audio") throw new Error(`Audio "${a.name}" cannot go on video track "${t.name}".`);
	if (t.kind === "audio" && a.kind === "image") throw new Error(`Image "${a.name}" cannot go on audio track "${t.name}".`);
	if (t.kind === "audio" && !a.hasAudio && a.kind === "video") throw new Error(`"${a.name}" has no audio.`);
	if (a.kind !== "image") {
		const available = a.durationMs - c.inMs;
		if (available <= 0) throw new Error(`In-point is past the end of "${a.name}".`);
		const maxDuration = available / c.speed;
		if (c.durationMs > maxDuration + 1) {
			return { ...c, durationMs: Math.max(1, Math.floor(maxDuration)) };
		}
	}
	return { ...c, fadeInMs: Math.min(c.fadeInMs, c.durationMs), fadeOutMs: Math.min(c.fadeOutMs, c.durationMs) };
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
		transform: { ...DEFAULT_TRANSFORM, ...input.transform },
		name: input.name ?? a.name,
	});
}

function replaceClip(data: ProjectData, next: Clip): ProjectData {
	return { ...data, clips: data.clips.map((c) => (c.id === next.id ? next : c)) };
}

function splitOne(data: ProjectData, c: Clip, atMs: number): { data: ProjectData; created: string } {
	if (atMs <= c.startMs + 1 || atMs >= clipEnd(c) - 1) throw new Error(`${sec(atMs)} is not inside clip ${c.id}.`);
	unlocked(data, c.trackId);
	const leftLength = Math.round(atMs - c.startMs);
	const right: Clip =
		c.type === "media"
			? { ...c, id: newId("c"), startMs: Math.round(atMs), durationMs: c.durationMs - leftLength, inMs: Math.round(c.inMs + leftLength * c.speed), fadeInMs: 0 }
			: { ...c, id: newId("c"), startMs: Math.round(atMs), durationMs: c.durationMs - leftLength, animationIn: "none" };
	const left: Clip = c.type === "media" ? { ...c, durationMs: leftLength, fadeOutMs: 0 } : { ...c, durationMs: leftLength, animationOut: "none" };
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
	const existing = data.clips.find((c): c is MediaClip => c.type === "media" && c.lineId === a.lineId);
	const trackId = existing?.trackId ?? voiceoverTrack(data)?.id;
	if (!trackId) throw new Error("Add an audio track for the voiceover first.");
	unlocked(data, trackId);
	const next = takeClip(a, trackId, data.settings.padMs, line.startMs);
	const kept = existing ? { ...next, id: existing.id, volume: existing.volume, fadeInMs: existing.fadeInMs, fadeOutMs: existing.fadeOutMs } : next;
	const clips = existing ? data.clips.map((c) => (c.id === existing.id ? kept : c)) : [...data.clips, kept];
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
			const c = buildClip(next, { type: "media", assetId: rawOp.asset.id, trackId: rawOp.placeOn.trackId, startMs: rawOp.placeOn.startMs });
			next = { ...next, clips: [...next.clips, c] };
			created = [c.id];
		}
		return { data: next, summary: `Added ${rawOp.asset.kind} "${rawOp.asset.name}"`, created };
	}
	if (rawOp.type === "addTake") {
		const withAsset = { ...data, assets: [...data.assets, rawOp.asset] };
		const placed = placeTake(withAsset, rawOp.asset);
		const speech = (rawOp.asset.speechEndMs ?? rawOp.asset.durationMs) - (rawOp.asset.speechStartMs ?? 0);
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
			return { data: { ...data, canvas: { ...data.canvas, ...op.canvas } }, summary: `Canvas set to ${op.canvas.width ?? data.canvas.width}×${op.canvas.height ?? data.canvas.height}` };

		case "renameAsset":
			asset(data, op.id);
			return { data: { ...data, assets: data.assets.map((a) => (a.id === op.id ? { ...a, name: op.name } : a)) }, summary: `Renamed media to "${op.name}"` };
		case "removeAsset": {
			const a = asset(data, op.id);
			const clips = data.clips.filter((c) => !(c.type === "media" && c.assetId === op.id));
			return { data: { ...data, assets: data.assets.filter((x) => x.id !== op.id), clips }, summary: `Removed "${a.name}" and ${data.clips.length - clips.length} clip(s)` };
		}

		case "addTrack": {
			const prefix = { video: "V", audio: "A", text: "T" }[op.kind];
			let n = 1;
			while (data.tracks.some((t) => t.id === `${prefix}${n}`)) n++;
			const t: Track = { id: `${prefix}${n}`, kind: op.kind, name: op.name ?? `${op.kind[0].toUpperCase()}${op.kind.slice(1)} ${n}`, muted: false, locked: false, hidden: false, volume: 1 };
			const tracks = [...data.tracks];
			tracks.splice(op.index ?? tracks.length, 0, t);
			return { data: { ...data, tracks }, summary: `Added ${op.kind} track "${t.name}"`, created: [t.id] };
		}
		case "updateTrack": {
			track(data, op.id);
			let tracks = data.tracks.map((t) => (t.id === op.id ? { ...t, ...op.patch } : t));
			if (op.patch.voiceover) tracks = tracks.map((t) => (t.id === op.id ? t : { ...t, voiceover: false }));
			return { data: { ...data, tracks }, summary: `Updated track ${op.id} (${Object.keys(op.patch).join(", ")})` };
		}
		case "removeTrack": {
			const t = track(data, op.id);
			const clips = data.clips.filter((c) => c.trackId !== op.id);
			return { data: { ...data, tracks: data.tracks.filter((x) => x.id !== op.id), clips }, summary: `Removed track "${t.name}" and ${data.clips.length - clips.length} clip(s)` };
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
			assertUnique(next.clips.map((c) => c.id), "clip");
			return { data: next, summary: `Added ${created.length} clip(s)`, created };
		}
		case "updateClip": {
			const current = clip(data, op.id);
			unlocked(data, current.trackId);
			const { transform, style, ...rest } = op.patch;
			const merged =
				current.type === "media"
					? { ...current, ...rest, transform: { ...current.transform, ...transform } }
					: { ...current, ...rest, style: { ...current.style, ...style } };
			if (current.type === "media" && (op.patch.text !== undefined || style)) throw new Error("Only text clips have text and style.");
			const next = validateClip(data, merged as Clip);
			return { data: replaceClip(data, next), summary: `Edited clip ${current.name ?? current.id} (${Object.keys(op.patch).join(", ")})` };
		}
		case "moveClips": {
			let next = data;
			for (const id of op.ids) {
				const c = clip(next, id);
				unlocked(next, c.trackId);
				const moved = validateClip(next, { ...c, startMs: Math.max(0, Math.round(c.startMs + op.deltaMs)), trackId: op.trackId ?? c.trackId } as Clip);
				next = replaceClip(next, moved);
			}
			return { data: next, summary: `Moved ${op.ids.length} clip(s) by ${sec(op.deltaMs)}${op.trackId ? ` to ${op.trackId}` : ""}` };
		}
		case "trimClip": {
			const c = clip(data, op.id);
			unlocked(data, c.trackId);
			const end = clipEnd(c);
			let next: Clip;
			if (op.edge === "end") {
				next = validateClip(data, { ...c, durationMs: Math.max(1, Math.round(op.toMs - c.startMs)) } as Clip);
			} else {
				let start = Math.min(Math.round(op.toMs), end - 1);
				if (c.type === "media") {
					const a = asset(data, c.assetId);
					// Extending left is limited by the start of the source.
					const earliest = a.kind === "image" ? 0 : c.startMs - c.inMs / c.speed;
					start = Math.max(start, Math.ceil(earliest), 0);
					const inMs = a.kind === "image" ? 0 : Math.max(0, Math.round(c.inMs + (start - c.startMs) * c.speed));
					next = validateClip(data, { ...c, startMs: start, durationMs: end - start, inMs });
				} else {
					next = validateClip(data, { ...c, startMs: Math.max(0, start), durationMs: end - Math.max(0, start) });
				}
			}
			return { data: replaceClip(data, next), summary: `Trimmed ${c.name ?? c.id} (${op.edge}) to ${sec(op.edge === "end" ? clipEnd(next) : next.startMs)}` };
		}
		case "splitClip": {
			const result = splitOne(data, clip(data, op.id), op.atMs);
			return { data: result.data, summary: `Split clip at ${sec(op.atMs)}`, created: [result.created] };
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
			const removed = op.ids.map((id) => clip(data, id));
			for (const c of removed) unlocked(data, c.trackId);
			let clips = data.clips.filter((c) => !op.ids.includes(c.id));
			if (op.ripple) {
				for (const r of [...removed].sort((a, b) => b.startMs - a.startMs)) {
					clips = clips.map((c) => (c.trackId === r.trackId && c.startMs >= clipEnd(r) ? { ...c, startMs: Math.max(0, c.startMs - r.durationMs) } : c));
				}
			}
			return { data: { ...data, clips }, summary: `Deleted ${removed.length} clip(s)${op.ripple ? " and closed the gap" : ""}` };
		}
		case "duplicateClips": {
			let next = data;
			const created: string[] = [];
			for (const id of op.ids) {
				const c = clip(next, id);
				const copy = validateClip(next, { ...c, id: newId("c"), startMs: Math.round(op.offsetMs !== undefined ? c.startMs + op.offsetMs : clipEnd(c)), ...(c.type === "media" ? { lineId: undefined } : {}) } as Clip);
				next = { ...next, clips: [...next.clips, copy] };
				created.push(copy.id);
			}
			return { data: next, summary: `Duplicated ${created.length} clip(s)`, created };
		}

		case "setLines": {
			const lines = sortLines(op.lines.map(normaliseLine));
			assertUnique(lines.map((l) => l.id), "line");
			const ids = new Set(lines.map((l) => l.id));
			const clips = data.clips.map((c) => (c.type === "media" && c.lineId && !ids.has(c.lineId) ? { ...c, lineId: undefined } : c));
			return { data: { ...data, lines, clips }, summary: `Replaced the script with ${lines.length} lines` };
		}
		case "addLine": {
			const line = normaliseLine(op.line);
			const lines = sortLines([...data.lines, line]);
			assertUnique(lines.map((l) => l.id), "line");
			return { data: { ...data, lines }, summary: `Added line ${line.id} at ${sec(line.startMs)}` };
		}
		case "updateLine": {
			const current = data.lines.find((l) => l.id === op.id);
			if (!current) throw new Error(`No line "${op.id}".`);
			const next = normaliseLine({ ...current, ...op.patch });
			const lines = sortLines(data.lines.map((l) => (l.id === op.id ? next : l)));
			assertUnique(lines.map((l) => l.id), "line");
			let { assets, clips } = data;
			if (next.id !== op.id) {
				assets = assets.map((a) => (a.lineId === op.id ? { ...a, lineId: next.id } : a));
				clips = clips.map((c) => (c.type === "media" && c.lineId === op.id ? { ...c, lineId: next.id } : c));
			}
			if (op.patch.startMs !== undefined && op.patch.startMs !== current.startMs) {
				const delta = next.startMs - current.startMs;
				clips = clips.map((c) => (c.type === "media" && c.lineId === next.id ? { ...c, startMs: Math.max(0, c.startMs + delta) } : c));
			}
			return { data: { ...data, lines, assets, clips }, summary: `Updated line ${op.id} (${Object.keys(op.patch).join(", ")})` };
		}
		case "removeLine": {
			if (!data.lines.some((l) => l.id === op.id)) throw new Error(`No line "${op.id}".`);
			return {
				data: {
					...data,
					lines: data.lines.filter((l) => l.id !== op.id),
					clips: data.clips.map((c) => (c.type === "media" && c.lineId === op.id ? { ...c, lineId: undefined } : c)),
					assets: data.assets.map((a) => (a.lineId === op.id ? { ...a, lineId: undefined } : a)),
				},
				summary: `Removed line ${op.id} (its takes stay in the media library)`,
			};
		}
		case "shiftLines": {
			const moved = new Set(data.lines.filter((l) => l.startMs >= op.fromMs).map((l) => l.id));
			const lines = sortLines(data.lines.map((l) => (moved.has(l.id) ? { ...l, startMs: Math.max(0, l.startMs + op.deltaMs) } : l)));
			const clips = op.withClips
				? data.clips.map((c) => (c.type === "media" && c.lineId && moved.has(c.lineId) ? { ...c, startMs: Math.max(0, c.startMs + op.deltaMs) } : c))
				: data.clips;
			return { data: { ...data, lines, clips }, summary: `Shifted ${moved.size} line(s) by ${sec(op.deltaMs)}` };
		}
		case "chooseTake": {
			if (!data.lines.some((l) => l.id === op.lineId)) throw new Error(`No line "${op.lineId}".`);
			if (op.assetId === null) {
				return { data: { ...data, clips: data.clips.filter((c) => !(c.type === "media" && c.lineId === op.lineId)) }, summary: `Removed the voiceover clip for ${op.lineId}` };
			}
			const a = asset(data, op.assetId);
			if (a.lineId !== op.lineId) throw new Error(`"${a.name}" is not a take of ${op.lineId}.`);
			return { data: placeTake(data, a), summary: `Chose ${a.name} for ${op.lineId}` };
		}
		case "deleteTake": {
			const a = asset(data, op.assetId);
			let next: ProjectData = { ...data, assets: data.assets.filter((x) => x.id !== a.id) };
			const usedBy = data.clips.find((c): c is MediaClip => c.type === "media" && c.assetId === a.id && c.lineId === a.lineId);
			if (usedBy) {
				next = { ...next, clips: next.clips.filter((c) => c.id !== usedBy.id) };
				const fallback = next.assets.filter((x) => x.lineId === a.lineId).at(-1);
				if (fallback) next = placeTake(next, fallback);
			}
			return { data: next, summary: `Deleted take ${a.name}${a.lineId ? ` of ${a.lineId}` : ""}` };
		}

		case "addMarker":
			return { data: { ...data, markers: [...data.markers, { id: newId("m"), atMs: op.atMs, label: op.label, color: op.color }] }, summary: `Added marker "${op.label}" at ${sec(op.atMs)}` };
		case "removeMarker":
			return { data: { ...data, markers: data.markers.filter((m) => m.id !== op.id) }, summary: "Removed a marker" };
		case "updateSettings":
			return { data: { ...data, settings: { ...data.settings, ...op.settings } }, summary: `Changed recording settings (${Object.keys(op.settings).join(", ")})` };
		case "updateExport":
			return { data: { ...data, export: { ...data.export, ...op.export } }, summary: `Changed export settings (${Object.keys(op.export).join(", ")})` };
		case "updateAi":
			return { data: { ...data, ai: { ...data.ai, ...op.ai } }, summary: `Changed AI settings (${Object.keys(op.ai).join(", ")})` };
	}
}

