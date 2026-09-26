import type { MethodName } from "../control/contract";
import { mixRole } from "./audio";
import { clipEnd } from "./project";
import type { Clip, MediaClip, ProjectData, TextClip, Track } from "./types";

/**
 * Director's notes: a quick, deterministic review of the open timeline, the
 * kind of things an editor would point out on a first watch. Everything here
 * reads the project only (no model, no network), so it runs on every edit.
 * Each note may carry a one-click fix: a tool call from the contract.
 */

export type NoteSeverity = "tip" | "warning" | "problem";

export type NoteKind =
	| "gap"
	| "short-clip"
	| "jump-cut"
	| "static-shot"
	| "title-speed"
	| "text-size"
	| "title-safe"
	| "abrupt-audio"
	| "voice-gap"
	| "loudness"
	| "clipping"
	| "captions"
	| "music"
	| "offline"
	| "disabled";

export interface NoteFix {
	tool: MethodName;
	params: Record<string, unknown>;
	label: string;
}

export interface Note {
	id: string;
	atMs: number;
	endMs?: number;
	kind: NoteKind;
	severity: NoteSeverity;
	message: string;
	clipId?: string;
	fix?: NoteFix;
}

export interface ReviewOptions {
	/** Media whose file is missing (the store knows; the project alone doesn't). */
	offline?: string[];
	/** The mix as measured (optional: measuring renders the audio). */
	loudness?: { integratedLufs: number | null; truePeakDb: number | null };
}

/** Thresholds, in one place so they are easy to tune. */
export const NOTE_LIMITS = {
	gapMs: 200,
	shortClipMs: 300,
	jumpCutSourceMs: 2000,
	staticShotMs: 8000,
	wordsPerSecond: 3,
	readingWordsPerSecond: 2.5,
	minTextShare: 0.025,
	titleSafe: 0.1,
	voiceGapMs: 1500,
	fadeMs: 300,
	targetLufs: -16,
	lufsTolerance: 3,
	peakDb: -1,
	musicBedMs: 15000,
} as const;

const SEVERITY_ORDER: Record<NoteSeverity, number> = { problem: 0, warning: 1, tip: 2 };

const sec = (ms: number) => {
	const s = Math.max(0, ms) / 1000;
	return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

const words = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Clips of a track in timeline order, leaving out disabled ones (they aren't seen or heard). */
function onTrack(data: ProjectData, track: Track): Clip[] {
	return data.clips
		.filter((c) => c.trackId === track.id && !c.disabled)
		.sort((a, b) => a.startMs - b.startMs);
}

const hasMotion = (c: MediaClip) =>
	!!c.zooms?.length ||
	Object.values(c.keyframes ?? {}).some((list) => (list?.length ?? 0) > 1) ||
	c.speed !== 1;

export function reviewEdit(data: ProjectData, options: ReviewOptions = {}): Note[] {
	const notes: Note[] = [];
	const add = (note: Note) => notes.push(note);
	const assetOf = (c: Clip) =>
		c.type === "media" ? data.assets.find((a) => a.id === c.assetId) : undefined;
	const { width, height } = data.canvas;

	// --- Picture: gaps, flash frames, jump cuts, static shots -------------------
	for (const track of data.tracks.filter((t) => t.kind === "video" && !t.hidden)) {
		const clips = onTrack(data, track);
		clips.forEach((c, i) => {
			const prev = clips[i - 1];
			if (prev) {
				const gap = c.startMs - clipEnd(prev);
				if (gap > 0 && gap < NOTE_LIMITS.gapMs) {
					// Extending the clip before keeps everything in sync; fall back to moving what follows.
					const a = assetOf(prev);
					const room =
						prev.type === "media" && a && a.kind !== "image" && a.kind !== "adjustment"
							? (a.durationMs - prev.inMs) / prev.speed - prev.durationMs
							: Number.POSITIVE_INFINITY;
					add({
						id: `gap:${c.id}`,
						atMs: clipEnd(prev),
						endMs: c.startMs,
						kind: "gap",
						severity: "problem",
						message: `${gap} ms of black between clips on ${track.name} at ${sec(clipEnd(prev))}: it will flash.`,
						clipId: c.id,
						fix:
							room >= gap
								? {
										tool: "trim_clip",
										params: { id: prev.id, edge: "end", toMs: c.startMs },
										label: "Close gap",
									}
								: {
										tool: "move_clips",
										params: { ids: clips.slice(i).map((x) => x.id), deltaMs: -gap },
										label: "Close gap",
									},
					});
				}
			}
			const a = assetOf(c);
			if (c.durationMs < NOTE_LIMITS.shortClipMs && a?.kind !== "adjustment")
				add({
					id: `short:${c.id}`,
					atMs: c.startMs,
					endMs: clipEnd(c),
					kind: "short-clip",
					severity: "warning",
					message: `A ${c.durationMs} ms clip at ${sec(c.startMs)} is too short to register; it reads as a flash frame.`,
					clipId: c.id,
					fix: { tool: "delete_clips", params: { ids: [c.id], ripple: true }, label: "Remove it" },
				});
			if (
				prev &&
				c.type === "media" &&
				prev.type === "media" &&
				a?.kind === "video" &&
				c.assetId === prev.assetId &&
				Math.abs(c.startMs - clipEnd(prev)) < 1 &&
				!c.transitionIn &&
				!c.zooms?.length &&
				Math.abs(c.inMs - (prev.inMs + prev.durationMs * prev.speed)) < NOTE_LIMITS.jumpCutSourceMs
			)
				add({
					id: `jump:${c.id}`,
					atMs: c.startMs,
					kind: "jump-cut",
					severity: "warning",
					message: `Jump cut at ${sec(c.startMs)}: the same shot continues after the cut. A punch-in or crossfade hides it.`,
					clipId: c.id,
					fix: {
						tool: "add_zoom",
						params: {
							clipId: c.id,
							startMs: 0,
							endMs: c.durationMs,
							scale: 1.2,
							easeMs: 0,
						},
						label: "Punch in",
					},
				});
			if (
				c.type === "media" &&
				(a?.kind === "video" || a?.kind === "image") &&
				c.durationMs > NOTE_LIMITS.staticShotMs &&
				!hasMotion(c)
			)
				add({
					id: `static:${c.id}`,
					atMs: c.startMs,
					endMs: clipEnd(c),
					kind: "static-shot",
					severity: "tip",
					message: `${(c.durationMs / 1000).toFixed(0)} s on one shot from ${sec(c.startMs)} without movement. A slow push-in keeps it alive.`,
					clipId: c.id,
					fix: {
						tool: "add_zoom",
						params: {
							clipId: c.id,
							startMs: 0,
							endMs: c.durationMs,
							scale: 1.15,
							easeMs: 3000,
						},
						label: "Add slow push-in",
					},
				});
		});
	}

	// --- Titles: reading speed, size, title safe ---------------------------------
	for (const track of data.tracks.filter((t) => t.kind === "text" && !t.hidden)) {
		const clips = onTrack(data, track) as TextClip[];
		clips.forEach((c, i) => {
			const count = words(c.text);
			// Captions follow the speech, so their pace is the speaker's, not ours.
			const caption = c.source?.kind === "caption";
			const neededMs = Math.ceil((count / NOTE_LIMITS.readingWordsPerSecond) * 1000);
			if (
				!caption &&
				count >= 2 &&
				count / (c.durationMs / 1000) > NOTE_LIMITS.wordsPerSecond &&
				neededMs > c.durationMs
			) {
				const next = clips[i + 1];
				const toMs =
					next && next.startMs > clipEnd(c) + 100
						? Math.min(c.startMs + neededMs, next.startMs)
						: c.startMs + neededMs;
				add({
					id: `speed:${c.id}`,
					atMs: c.startMs,
					endMs: clipEnd(c),
					kind: "title-speed",
					severity: "warning",
					message: `"${clip(c.text)}" is on screen ${(c.durationMs / 1000).toFixed(1)} s for ${count} words: too fast to read.`,
					clipId: c.id,
					fix: {
						tool: "trim_clip",
						params: { id: c.id, edge: "end", toMs },
						label: `Hold for ${((toMs - c.startMs) / 1000).toFixed(1)} s`,
					},
				});
			}
			// Graphics (boxes, arrows, redactions) may sit anywhere at any size.
			if (c.shape || !c.text.trim()) return;
			if (c.style.fontSize < NOTE_LIMITS.minTextShare * height)
				add({
					id: `size:${c.id}`,
					atMs: c.startMs,
					endMs: clipEnd(c),
					kind: "text-size",
					severity: "warning",
					message: `"${clip(c.text)}" at ${sec(c.startMs)} is ${c.style.fontSize} px: hard to read on a phone.`,
					clipId: c.id,
					fix: {
						tool: "update_clip",
						params: { id: c.id, patch: { style: { fontSize: Math.round(height * 0.04) } } },
						label: "Make it bigger",
					},
				});
			const safe = NOTE_LIMITS.titleSafe;
			const half = Math.min(c.style.width, 1) / 2;
			// Text is centred in its box, so a full-width box with centred text is still fine.
			const reach = c.style.align === "center" ? Math.min(half, 0.4) : half;
			const outside =
				c.style.y < safe ||
				c.style.y > 1 - safe ||
				c.style.x - reach < safe - 0.01 ||
				c.style.x + reach > 1 - safe + 0.01;
			if (outside) {
				const w = Math.min(c.style.width, 1 - 2 * safe);
				add({
					id: `safe:${c.id}`,
					atMs: c.startMs,
					endMs: clipEnd(c),
					kind: "title-safe",
					severity: "warning",
					message: `"${clip(c.text)}" at ${sec(c.startMs)} is outside title safe: it may be cut off on some screens.`,
					clipId: c.id,
					fix: {
						tool: "update_clip",
						params: {
							id: c.id,
							patch: {
								style: {
									x: round(clamp(c.style.x, safe + w / 2, 1 - safe - w / 2)),
									y: round(clamp(c.style.y, safe + 0.02, 1 - safe - 0.02)),
									width: round(w),
								},
							},
						},
						label: "Move inside",
					},
				});
			}
		});
	}

	// --- Sound: abrupt music, pauses in the voiceover ------------------------------
	for (const track of data.tracks.filter(
		(t) => t.kind === "audio" && !t.muted && mixRole(data, t) === "music",
	)) {
		const clips = onTrack(data, track) as MediaClip[];
		clips.forEach((c, i) => {
			const next = clips[i + 1];
			const needsIn = c.fadeInMs === 0 && c.startMs > 0 && !c.transitionIn;
			const needsOut =
				c.fadeOutMs === 0 && !(next && next.startMs - clipEnd(c) < 1 && next.transitionIn);
			if (!needsIn && !needsOut) return;
			const fade = Math.min(NOTE_LIMITS.fadeMs, Math.floor(c.durationMs / 3));
			add({
				id: `abrupt:${c.id}`,
				atMs: needsIn ? c.startMs : clipEnd(c),
				kind: "abrupt-audio",
				severity: "warning",
				message: `Music on ${track.name} ${needsIn && needsOut ? "starts and stops" : needsIn ? "starts" : "stops"} abruptly at ${sec(needsIn ? c.startMs : clipEnd(c))}.`,
				clipId: c.id,
				fix: {
					tool: "update_clip",
					params: {
						id: c.id,
						patch: {
							...(needsIn ? { fadeInMs: fade } : {}),
							...(needsOut ? { fadeOutMs: fade } : {}),
						},
					},
					label: "Add fades",
				},
			});
		});
	}
	const voice = data.tracks.find((t) => t.kind === "audio" && t.voiceover && !t.muted);
	if (voice) {
		const clips = onTrack(data, voice);
		for (let i = 1; i < clips.length; i++) {
			const from = clipEnd(clips[i - 1]);
			const to = clips[i].startMs;
			if (to - from > NOTE_LIMITS.voiceGapMs)
				add({
					id: `pause:${clips[i].id}`,
					atMs: from,
					endMs: to,
					kind: "voice-gap",
					severity: "tip",
					message: `${((to - from) / 1000).toFixed(1)} s without narration at ${sec(from)}. Tighten it unless the picture needs the room.`,
					clipId: clips[i].id,
					fix: {
						tool: "remove_ranges",
						// Leave a breath on either side of the cut.
						params: { ranges: [{ startMs: from + 250, endMs: to - 250 }] },
						label: "Tighten",
					},
				});
		}
	}

	// --- Loudness (only when measured) ----------------------------------------------
	const { loudness } = options;
	if (loudness?.integratedLufs != null) {
		const off = loudness.integratedLufs - NOTE_LIMITS.targetLufs;
		if (Math.abs(off) > NOTE_LIMITS.lufsTolerance)
			add({
				id: "loudness",
				atMs: 0,
				kind: "loudness",
				severity: "warning",
				message: `The mix is ${loudness.integratedLufs.toFixed(1)} LUFS, ${Math.abs(off).toFixed(0)} dB ${off > 0 ? "louder" : "quieter"} than the -16 LUFS most platforms expect.`,
				fix: data.export.normalize
					? { tool: "auto_mix", params: {}, label: "Auto-mix" }
					: {
							tool: "update_export",
							params: { export: { normalize: true } },
							label: "Normalise on export",
						},
			});
	}
	if (loudness?.truePeakDb != null && loudness.truePeakDb > NOTE_LIMITS.peakDb)
		add({
			id: "clipping",
			atMs: 0,
			kind: "clipping",
			severity: "problem",
			message: `The mix peaks at ${loudness.truePeakDb.toFixed(1)} dBTP and may distort; keep peaks under -1.`,
			fix: data.export.normalize
				? undefined
				: {
						tool: "update_export",
						params: { export: { normalize: true } },
						label: "Limit on export",
					},
		});

	// --- Missing pieces --------------------------------------------------------------
	const used = data.clips.filter((c) => !c.disabled);
	const durationMs = used.reduce((end, c) => Math.max(end, clipEnd(c)), 0);
	const voiceClips = voice ? used.filter((c) => c.trackId === voice.id) : [];
	const spoken =
		voiceClips.length > 0 ||
		used.some((c) => !!assetOf(c)?.transcript?.words.length && c.type === "media");
	const captioned = used.some((c) => c.type === "text" && c.source?.kind === "caption");
	if (height > width && spoken && !captioned)
		add({
			id: "captions",
			atMs: 0,
			kind: "captions",
			severity: "warning",
			message:
				"Vertical video with speech but no captions: most people watch social video with the sound off.",
			fix: {
				tool: "auto_captions",
				params: { source: voiceClips.length > 0 ? "voiceover" : "mix", style: "highlight" },
				label: "Add captions",
			},
		});
	const music = data.tracks.some(
		(t) =>
			t.kind === "audio" && mixRole(data, t) === "music" && used.some((c) => c.trackId === t.id),
	);
	if (!music && durationMs > NOTE_LIMITS.musicBedMs)
		add({
			id: "music",
			atMs: 0,
			kind: "music",
			severity: "tip",
			message: "No music bed. A quiet track under the edit carries it between lines.",
		});
	const offline = new Set(options.offline ?? []);
	for (const asset of data.assets.filter((a) => offline.has(a.id))) {
		const first = data.clips
			.filter((c) => c.type === "media" && c.assetId === asset.id)
			.sort((a, b) => a.startMs - b.startMs)[0];
		if (!first) continue;
		add({
			id: `offline:${asset.id}`,
			atMs: first.startMs,
			kind: "offline",
			severity: "problem",
			message: `${asset.name} is offline: the file was moved or its drive is disconnected.`,
			clipId: first.id,
			fix: { tool: "find_offline_media", params: {}, label: "Find it" },
		});
	}
	for (const c of data.clips.filter((x) => x.disabled))
		add({
			id: `disabled:${c.id}`,
			atMs: c.startMs,
			endMs: clipEnd(c),
			kind: "disabled",
			severity: "tip",
			message: `A disabled clip is still on the timeline at ${sec(c.startMs)}.`,
			clipId: c.id,
			fix: { tool: "delete_clips", params: { ids: [c.id] }, label: "Delete it" },
		});

	return notes.sort(
		(a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.atMs - b.atMs,
	);
}

const clip = (text: string) => {
	const one = text.replace(/\s+/g, " ").trim();
	return one.length > 32 ? `${one.slice(0, 30)}…` : one;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const round = (v: number) => Math.round(v * 1000) / 1000;
