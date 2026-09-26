import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chunkCaptions } from "./ai";
import {
	type ExportReport,
	exportAudioMix,
	exportCaptions,
	exportGif,
	exportStems,
	exportVideo,
	exportVoiceover,
	type TextRender,
} from "./exporter";
import { type HistoryEntry, ProjectHistory } from "./history";
import {
	detectBeats as detectBeatsIn,
	editTranscript,
	extractJson,
	sourceToTimeline,
	transcriptForPrompt,
} from "./intelligence";
import {
	fromOtio,
	type ImportedStack,
	INTERCHANGE_EXTENSIONS,
	type InterchangeFormat,
	toEdl,
	toFcpxml,
	toMlt,
	toOtio,
} from "./interchange";
import { makePoster } from "./library";
import {
	analyseSpeech,
	computePeaks,
	detectSilences,
	extractThumbnails,
	ffmpeg,
	kindOf,
	makeAudioProxy,
	makeVideoProxy,
	PEAKS_PER_SECOND,
	probe,
	toWav,
} from "./media";
import { activeSequence, allSequences, applyOp, type InternalOp, type Op } from "./ops";
import { relativeToProject, resolveInProject } from "./paths";
import {
	DEFAULT_TEXT_STYLE,
	deriveLines,
	emptyProject,
	isProjectFile,
	type LineInput,
	newId,
	PROJECT_EXTENSION,
	parseProject,
	projectDuration,
} from "./project";
import { findMoved, isOffline } from "./relink";
import type { AiRuntime } from "./runtime";
import { parseSrt } from "./srt";
import type {
	ActivityEntry,
	Actor,
	Asset,
	Clip,
	MediaClip,
	ProjectData,
	ProjectSnapshot,
	Proposal,
	RecentProject,
	TextClip,
} from "./types";
import { type Aspect, reframeData, shortenData, variantLabel } from "./variants";

const HISTORY_LIMIT = 150;
const ACTIVITY_LIMIT = 200;
const CACHE_DIR = ".cue-cache";

export interface CreateProjectOptions {
	/** Project file or directory. A directory gets `<name>.cueproj`. */
	path: string;
	name?: string;
	/** A video to start from: imported and placed on the first video track. */
	video?: string | null;
	/** Import the voiceover script from subtitles. */
	srt?: string;
	/** Or pass the script lines directly. */
	lines?: LineInput[];
}

export type ExportKind =
	| "stems"
	| "voiceover"
	| "audio"
	| "video"
	| "gif"
	| "captions"
	| InterchangeFormat;

export interface StoreOptions {
	/** Turns an absolute path into a URL the editor window can load. */
	mediaUrl: (file: string) => string;
	recentFile: string;
	/** Whether proxies are built automatically on open and import (app setting). */
	autoProxies?: () => boolean;
	/** Whether agent edits wait for the user to accept them (app setting). */
	reviewAgentEdits?: () => boolean;
}

type TextRenderer = (
	clips: TextClip[],
	canvas?: { width: number; height: number },
) => Promise<Record<string, TextRender>>;

/**
 * Owns the open project. Every edit goes through `apply`, which validates it,
 * records undo history, writes the activity feed and schedules an autosave.
 */
export class ProjectStore extends EventEmitter {
	private file: string | null = null;
	private data: ProjectData | null = null;
	private past: ProjectData[] = [];
	private future: ProjectData[] = [];
	private activity: ActivityEntry[] = [];
	private activityId = 0;
	private saveTimer: NodeJS.Timeout | null = null;
	private dirty = false;
	/** Agent edits waiting for the user (review mode), measured against `base`. */
	private proposal: { base: ProjectData; steps: string[] } | null = null;
	/** The save in progress, if any; saves never overlap. */
	private saving: Promise<void> = Promise.resolve();
	private revision = 0;
	/** Assets whose playback proxy is ready. */
	private proxies = new Set<string>();
	private proxyQueue: Promise<void> = Promise.resolve();
	private audioProxies = new Map<string, Promise<string>>();

	constructor(private readonly options: StoreOptions) {
		super();
	}

	/** A URL the editor window can load for a local file. */
	toUrl(file: string): string {
		return this.options.mediaUrl(file);
	}

	get filePath(): string | null {
		return this.file;
	}

	get isOpen(): boolean {
		return this.data !== null;
	}

	get projectDir(): string {
		if (!this.file) throw new Error("No project is open.");
		return path.dirname(this.file);
	}

	get current(): ProjectData {
		if (!this.data) throw new Error("No project is open. Open or create one first.");
		return this.data;
	}

	/** Changes whenever the snapshot would: another project, an edit, a save. */
	get snapshotKey(): string {
		return this.file ? `${this.file}|${this.revision}|${this.dirty}` : "";
	}

	snapshot(): ProjectSnapshot | null {
		if (!this.data || !this.file) return null;
		const dir = path.dirname(this.file);
		return {
			revision: this.revision,
			path: this.file,
			dir,
			data: this.data,
			assetUrls: Object.fromEntries(
				this.data.assets.map((a) => [a.id, this.options.mediaUrl(resolveInProject(dir, a.path))]),
			),
			proxyUrls: this.data.settings.useProxies
				? Object.fromEntries(
						this.data.assets
							.filter((a) => this.proxies.has(this.cacheKey(a.id)))
							.map((a) => [a.id, this.options.mediaUrl(this.proxyPath(a.id))]),
					)
				: {},
			durationMs: projectDuration(this.data),
			lines: deriveLines(this.data),
			canUndo: this.past.length > 0,
			canRedo: this.future.length > 0,
			dirty: this.dirty,
			offline: this.offline(),
			proposal: this.proposalView(),
		};
	}

	private offlineCache: { revision: number; ids: string[] } | null = null;
	private history: ProjectHistory | null = null;
	/** Inside a transaction, steps are recorded once at the end. */
	private batching = 0;
	private transactions: Promise<void> = Promise.resolve();

	private record(actor: Actor, summary: string, kind: HistoryEntry["kind"]) {
		if (!this.history || !this.data || this.batching) return;
		this.history.record(
			{ actor, summary, kind, sequence: activeSequence(this.data).name },
			this.data,
		);
		this.emit("history");
	}

	/** The project's history, newest first. */
	historyEntries(limit = 200, before?: number, after?: number): HistoryEntry[] {
		const all = this.history?.entries ?? [];
		const upto = all.filter(
			(e) => (before === undefined || e.n < before) && (after === undefined || e.n > after),
		);
		return upto.slice(-limit).reverse();
	}

	/** Brings the project back to how it was after a step. This is itself a step, so it can be undone. */
	async restoreHistory(n: number, actor: Actor): Promise<{ summary: string }> {
		if (!this.history) throw new Error("No project is open.");
		const entry = this.history.entries.find((e) => e.n === n);
		if (!entry) throw new Error(`No step ${n} in the history.`);
		const snapshot = parseProject(await this.history.snapshot(n));
		this.past = [...this.past, this.current].slice(-HISTORY_LIMIT);
		this.future = [];
		this.data = snapshot;
		this.touch();
		const summary = `Went back to step ${n}: ${entry.summary}`;
		this.log(actor, summary);
		this.record(actor, summary, "restore");
		return { summary };
	}

	/** Media whose file is missing (checked once per change). */
	offline(): string[] {
		if (!this.data || !this.file) return [];
		if (this.offlineCache?.revision !== this.revision) {
			const dir = path.dirname(this.file);
			this.offlineCache = {
				revision: this.revision,
				ids: this.data.assets.filter((a) => isOffline(dir, a)).map((a) => a.id),
			};
		}
		return this.offlineCache.ids;
	}

	private stored(file: string) {
		return {
			path: relativeToProject(this.projectDir, file),
			relPath: path.relative(this.projectDir, file),
		};
	}

	/** Looks for moved media when a project opens; fixes what it can without an undo step. */
	private async autoRelink(): Promise<void> {
		if (!this.data || this.offline().length === 0) return;
		const found = await findMoved(this.projectDir, this.data.assets);
		const ids = Object.keys(found);
		if (ids.length === 0 || !this.data) return;
		this.data = applyOp(this.data, {
			type: "relinkAssets",
			paths: Object.fromEntries(ids.map((id) => [id, this.stored(found[id])])),
		}).data;
		this.touch();
		this.log(
			"system",
			`Found ${ids.length} moved media file${ids.length === 1 ? "" : "s"} and relinked ${ids.length === 1 ? "it" : "them"}`,
		);
	}

	/**
	 * Holds the frame at the playhead for a while (Premiere's "Insert Frame
	 * Hold Segment"): the clip is split there and later clips on the track move
	 * along to make room for a still of that frame.
	 */
	async freezeFrame(clipId: string, atMs: number, durationMs: number, actor: Actor) {
		const clip = this.current.clips.find((c) => c.id === clipId);
		if (!clip || clip.type !== "media") throw new Error("Pick a video clip.");
		const source = this.current.assets.find((a) => a.id === clip.assetId);
		if (!source || source.kind !== "video") throw new Error("Frame holds need a video clip.");
		if (atMs <= clip.startMs || atMs >= clip.startMs + clip.durationMs)
			throw new Error("Put the playhead inside the clip.");
		const sourceMs = clip.inMs + (atMs - clip.startMs) * clip.speed;
		const still = path.join(
			this.projectDir,
			"stills",
			`${path.parse(source.name).name}-${Math.round(sourceMs)}.png`,
		);
		await fs.mkdir(path.dirname(still), { recursive: true });
		await ffmpeg([
			"-ss",
			(sourceMs / 1000).toFixed(3),
			"-i",
			this.assetPath(source.id),
			"-frames:v",
			"1",
			still,
		]);
		return this.transaction(actor, `Held the frame at ${(atMs / 1000).toFixed(2)} s`, async () => {
			const [asset] = await this.importMedia([still], actor);
			const later = this.current.clips
				.filter((c) => c.trackId === clip.trackId && c.startMs >= atMs - 1 && c.id !== clip.id)
				.map((c) => c.id);
			this.apply({ type: "splitClip", id: clip.id, atMs }, actor);
			const tail = this.current.clips.find(
				(c) => c.trackId === clip.trackId && Math.abs(c.startMs - atMs) <= 1 && c.id !== clip.id,
			);
			const move = [...later, ...(tail ? [tail.id] : [])];
			if (move.length)
				this.apply(
					{ type: "moveClips", ids: move, deltaMs: durationMs, trackId: clip.trackId },
					actor,
				);
			const created = this.apply(
				{
					type: "addClips",
					clips: [
						{
							type: "media",
							trackId: clip.trackId,
							assetId: asset.id,
							startMs: atMs,
							durationMs,
							transform: clip.transform,
						},
					],
				},
				actor,
			).created;
			return { created };
		});
	}

	// -------------------------------------------------------------------------
	// Analysis and AI helpers
	// -------------------------------------------------------------------------

	/** Shot changes found in a video (seconds into the source), by threshold. */
	private scenes = new Map<string, Promise<number[]>>();

	/** Where the picture of a video changes shot, in ms into the source. */
	sceneCuts(assetId: string, threshold = 0.3): Promise<number[]> {
		const asset = this.current.assets.find((a) => a.id === assetId);
		if (!asset || asset.kind !== "video") return Promise.reject(new Error("Pick a video."));
		const key = `${this.cacheKey(assetId)}@${threshold}`;
		let pending = this.scenes.get(key);
		if (!pending) {
			pending = ffmpeg([
				"-i",
				this.assetPath(assetId),
				"-an",
				"-vf",
				`scale=320:-2,select='gt(scene,${threshold})',showinfo`,
				"-f",
				"null",
				"-",
			]).then((log) => {
				const times = [...log.matchAll(/pts_time:([0-9.]+)/g)].map((m) =>
					Math.round(Number(m[1]) * 1000),
				);
				// Flashes and dissolves give several hits in a row: keep one per half second.
				return times.filter((t, i) => i === 0 || t - times[i - 1] > 500);
			});
			pending.catch(() => this.scenes.delete(key));
			this.scenes.set(key, pending);
		}
		return pending;
	}

	/**
	 * Cuts a clip (and the sound linked to it) at every shot change in the part
	 * of the source it plays, or marks them instead when `split` is false.
	 */
	async splitAtScenes(
		clipId: string,
		actor: Actor,
		options: { threshold?: number; split?: boolean } = {},
	): Promise<{ cuts: number[]; summary: string }> {
		const clip = this.current.clips.find((c) => c.id === clipId);
		if (!clip || clip.type !== "media") throw new Error(`No media clip "${clipId}".`);
		const cuts = await this.sceneCuts(clip.assetId, options.threshold);
		const end = clip.startMs + clip.durationMs;
		const times = cuts
			.map((ms) => Math.round(clip.startMs + (ms - clip.inMs) / clip.speed))
			.filter((t) => t > clip.startMs + 200 && t < end - 200);
		if (times.length === 0) return { cuts: [], summary: "No shot changes found in that clip" };
		const partners = clip.groupId
			? this.current.clips.filter((c) => c.groupId === clip.groupId).map((c) => c.trackId)
			: [clip.trackId];
		const summary =
			options.split === false
				? `Marked ${times.length} shot changes`
				: `Split at ${times.length} shot changes`;
		await this.transaction(actor, summary, () => {
			for (const atMs of times.reverse()) {
				if (options.split === false)
					this.apply({ type: "addMarker", atMs, label: "Shot", color: "warning" }, actor);
				else this.apply({ type: "splitAt", atMs, trackIds: [...new Set(partners)] }, actor);
			}
		});
		return { cuts: times.reverse(), summary };
	}

	/** Tempo and beats of a media item; optionally drops a marker on every beat where it is used. */
	async detectBeats(
		assetId: string,
		actor: Actor,
		options: { addMarkers?: boolean; every?: number } = {},
	) {
		const asset = this.current.assets.find((a) => a.id === assetId);
		if (!asset || !asset.hasAudio) throw new Error("Pick a media item with sound.");
		const found = detectBeatsIn(await this.peaks(assetId), PEAKS_PER_SECOND);
		if (!found.beats.length) throw new Error(`No steady beat found in ${asset.name}.`);
		let markers = 0;
		if (options.addMarkers) {
			const every = Math.max(1, options.every ?? 1);
			const times = found.beats
				.filter((_, i) => i % every === 0)
				.flatMap((b) => sourceToTimeline(this.current, assetId, b))
				.slice(0, 400);
			if (times.length === 0) throw new Error(`${asset.name} is not on the timeline yet.`);
			await this.transaction(actor, `Marked ${times.length} beats (${found.bpm} BPM)`, () => {
				for (const atMs of times)
					this.apply({ type: "addMarker", atMs, label: "Beat", color: "success" }, actor);
			});
			markers = times.length;
		}
		return {
			bpm: found.bpm,
			confidence: Math.round(found.confidence * 100) / 100,
			beats: found.beats.length,
			markers,
		};
	}

	/** Moves each cut on a track to the nearest beat of a music clip (rolling edits, so nothing shifts). */
	async snapCutsToBeats(trackId: string, musicAssetId: string, actor: Actor, toleranceMs = 350) {
		const { beats } = detectBeatsIn(await this.peaks(musicAssetId), PEAKS_PER_SECOND);
		const grid = beats
			.flatMap((b) => sourceToTimeline(this.current, musicAssetId, b))
			.sort((a, b) => a - b);
		if (!grid.length) throw new Error("Put the music on the timeline first.");
		const clips = this.current.clips
			.filter((c) => c.trackId === trackId && !c.disabled)
			.sort((a, b) => a.startMs - b.startMs);
		let moved = 0;
		await this.transaction(actor, "Snapped cuts to the beat", () => {
			for (let i = 0; i < clips.length - 1; i++) {
				const left = this.current.clips.find((c) => c.id === clips[i].id);
				const right = this.current.clips.find((c) => c.id === clips[i + 1].id);
				if (!left || !right) continue;
				const cut = left.startMs + left.durationMs;
				if (Math.abs(cut - right.startMs) > 2) continue;
				const beat = grid.reduce(
					(best, b) => (Math.abs(b - cut) < Math.abs(best - cut) ? b : best),
					grid[0],
				);
				if (Math.abs(beat - cut) < 5 || Math.abs(beat - cut) > toleranceMs) continue;
				try {
					this.apply({ type: "rollEdit", leftId: left.id, rightId: right.id, toMs: beat }, actor);
					moved++;
				} catch {}
			}
		});
		return { cuts: clips.length - 1, moved };
	}

	private requireTranscript() {
		const segments = editTranscript(this.current);
		if (!segments.length)
			throw new Error(
				"Nothing on the timeline is transcribed yet. Transcribe the footage first (Transcript panel).",
			);
		return segments;
	}

	/** Finds parts of the edit that match a description, using the transcript and the text model. */
	async findMoments(query: string, runtime: AiRuntime) {
		const segments = this.requireTranscript();
		const reply = await runtime.chat(
			'You find moments in a video edit from its transcript. Times are seconds on the timeline. Reply with JSON only: an array of {"start": seconds, "end": seconds, "why": short reason}, best match first, at most 8. Return [] if nothing fits.',
			`Find: ${query}\n\nTranscript:\n${transcriptForPrompt(segments)}`,
		);
		const found = extractJson<{ start: number; end: number; why?: string }[]>(reply);
		return found
			.filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end) && m.end > m.start)
			.map((m) => ({
				startMs: Math.round(m.start * 1000),
				endMs: Math.round(m.end * 1000),
				why: m.why ?? "",
			}));
	}

	/** Chapters from the transcript, as markers and as a YouTube-ready list. */
	async chapters(runtime: AiRuntime, actor: Actor, addMarkers = true) {
		const segments = this.requireTranscript();
		const reply = await runtime.chat(
			'You split a video into chapters from its transcript. Times are seconds. Reply with JSON only: an array of {"start": seconds, "title": 2-6 words}. The first chapter starts at 0. Aim for one chapter per distinct topic, at least 20 seconds apart.',
			transcriptForPrompt(segments),
		);
		const list = extractJson<{ start: number; title: string }[]>(reply)
			.filter((c) => Number.isFinite(c.start) && c.title)
			.sort((a, b) => a.start - b.start);
		if (list.length && list[0].start > 0) list[0].start = 0;
		if (addMarkers && list.length)
			await this.transaction(actor, `Added ${list.length} chapter markers`, () => {
				for (const c of list)
					this.apply(
						{
							type: "addMarker",
							atMs: Math.round(c.start * 1000),
							label: c.title.slice(0, 200),
							color: "accent",
						},
						actor,
					);
			});
		const stamp = (sec: number) =>
			`${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
		return {
			chapters: list,
			description: list.map((c) => `${stamp(c.start)} ${c.title}`).join("\n"),
		};
	}

	/** Suggests cutaway images (B-roll) for moments in the transcript. */
	async suggestBroll(runtime: AiRuntime, count = 4) {
		const segments = this.requireTranscript();
		const reply = await runtime.chat(
			'You plan B-roll (cutaway visuals) for a video from its transcript. Times are seconds on the timeline. Reply with JSON only: an array of {"start": seconds, "duration": 2-5 seconds, "prompt": a vivid, concrete image description without any text or logos}. Pick moments where a visual would help the viewer understand.',
			`Suggest ${count} cutaways.\n\n${transcriptForPrompt(segments)}`,
		);
		return extractJson<{ start: number; duration: number; prompt: string }[]>(reply)
			.filter((b) => Number.isFinite(b.start) && b.prompt)
			.slice(0, count)
			.map((b) => ({
				atMs: Math.round(b.start * 1000),
				durationMs: Math.round(Math.min(6, Math.max(1.5, b.duration || 3)) * 1000),
				prompt: b.prompt,
			}));
	}

	/** Generates B-roll images and lays them on a B-roll track above the picture. */
	async addBroll(
		items: { atMs: number; durationMs: number; prompt: string }[],
		runtime: AiRuntime,
		actor: Actor,
	) {
		const landscape = this.current.canvas.width >= this.current.canvas.height;
		let track = this.current.tracks.find((t) => t.kind === "video" && t.name === "B-roll");
		if (!track) {
			const id = this.apply({ type: "addTrack", kind: "video", name: "B-roll", index: 0 }, actor)
				.created?.[0];
			track = this.current.tracks.find((t) => t.id === id);
		}
		if (!track) throw new Error("Could not add a B-roll track.");
		const placed: string[] = [];
		for (const item of items) {
			const asset = await this.generateImage(item.prompt, runtime, actor, {
				orientation: landscape ? "landscape" : "portrait",
			});
			const created = this.apply(
				{
					type: "addClips",
					clips: [
						{
							type: "media",
							trackId: track.id,
							assetId: asset.id,
							startMs: item.atMs,
							durationMs: item.durationMs,
							fadeInMs: 250,
							fadeOutMs: 250,
							// Cutaways fill the frame (centre crop) rather than letterboxing.
							transform: {
								scale: cover(
									asset.width / asset.height,
									this.current.canvas.width / this.current.canvas.height,
								),
							},
						},
					],
				},
				actor,
			).created;
			placed.push(...(created ?? []));
		}
		return { trackId: track.id, clips: placed };
	}

	/**
	 * Changes the frame size and makes every full-frame picture fill the new
	 * frame (centre crop), e.g. to turn a 16:9 edit into a 9:16 one.
	 */
	reframe(width: number, height: number, actor: Actor) {
		const canvas = width / height;
		return this.transaction(actor, `Reframed to ${width}×${height}`, () => {
			this.apply({ type: "setCanvas", canvas: { width, height } }, actor);
			let changed = 0;
			for (const clip of this.current.clips) {
				if (clip.type !== "media" || Math.abs(clip.transform.scale - 1) > 0.001) continue;
				const asset = this.current.assets.find((a) => a.id === clip.assetId);
				const track = this.current.tracks.find((t) => t.id === clip.trackId);
				if (!asset || track?.kind !== "video" || !asset.width || !asset.height) continue;
				const source = asset.width / asset.height;
				const cover = Math.max(source / canvas, canvas / source);
				this.apply(
					{
						type: "updateClip",
						id: clip.id,
						patch: { transform: { scale: Math.round(cover * 1000) / 1000, x: 0.5, y: 0.5 } },
					},
					actor,
				);
				changed++;
			}
			return { width, height, reframedClips: changed };
		});
	}

	/**
	 * Makes versions of the edit in other shapes and lengths, without changing
	 * the open timeline: each is exported as a video, and optionally saved as a
	 * project next to this one to fine-tune later.
	 */
	async makeVariants(
		options: {
			aspects?: Aspect[];
			lengthsSec?: number[];
			/** Stretches to keep when shortening (timeline ms), best first or in order. */
			keep?: { startMs: number; endMs: number }[];
			saveProjects?: boolean;
			exportVideos?: boolean;
		},
		actor: Actor,
		renderText?: TextRenderer,
	): Promise<{
		variants: { label: string; video?: string; project?: string; durationMs: number }[];
	}> {
		await this.renderNested(renderText);
		const base = this.current;
		const aspects: (Aspect | undefined)[] = options.aspects?.length ? options.aspects : [undefined];
		const lengths: (number | undefined)[] = options.lengthsSec?.length
			? options.lengthsSec
			: [undefined];
		const made: { label: string; video?: string; project?: string; durationMs: number }[] = [];
		for (const aspect of aspects)
			for (const lengthSec of lengths) {
				if (!aspect && !lengthSec) continue;
				let data = base;
				if (lengthSec) data = shortenData(data, lengthSec * 1000, options.keep);
				if (aspect) data = reframeData(data, aspect);
				const label = variantLabel(aspect, lengthSec);
				const name = `${base.name} ${label}`;
				data = { ...data, name };
				const entry: (typeof made)[number] = { label, durationMs: projectDuration(data) };
				if (options.exportVideos !== false) {
					const target = path.join(this.projectDir, "export", `${slug(name)}.mp4`);
					await exportVideo({ dir: this.projectDir, data, renderText }, target);
					entry.video = target;
				}
				if (options.saveProjects) {
					// Next to this project, so media paths relative to it still work.
					const file = path.join(this.projectDir, `${slug(name)}${PROJECT_EXTENSION}`);
					await fs.writeFile(file, `${JSON.stringify(data, null, "\t")}\n`);
					entry.project = file;
				}
				made.push(entry);
			}
		this.log(actor, `Made ${made.length} variant(s): ${made.map((m) => m.label).join(", ")}`);
		return { variants: made };
	}

	// -------------------------------------------------------------------------
	// Nested sequences
	// -------------------------------------------------------------------------

	private nestedRenders = new Map<string, Promise<void>>();

	/**
	 * Renders every nested sequence that changed since its last render (inner
	 * ones first) and points its clips at the new file. Renders are cached by
	 * content, so unchanged sequences cost nothing.
	 */
	async renderNested(renderText?: TextRenderer): Promise<number> {
		const ids = [
			...new Set(this.current.assets.flatMap((a) => (a.sequenceId ? [a.sequenceId] : []))),
		];
		let rendered = 0;
		for (const id of ids) rendered += await this.renderSequence(id, renderText, new Set());
		return rendered;
	}

	private async renderSequence(
		id: string,
		renderText: TextRenderer | undefined,
		visiting: Set<string>,
	): Promise<number> {
		if (visiting.has(id)) throw new Error("A sequence cannot contain itself.");
		visiting.add(id);
		let rendered = 0;
		const sequence = () => allSequences(this.current).find((q) => q.id === id);
		const first = sequence();
		if (!first) return 0;
		// Inner sequences first, so this render uses their latest version.
		for (const c of first.clips) {
			const inner =
				c.type === "media"
					? this.current.assets.find((a) => a.id === c.assetId)?.sequenceId
					: undefined;
			if (inner) rendered += await this.renderSequence(inner, renderText, new Set(visiting));
		}
		const seq = sequence();
		const asset = this.current.assets.find((a) => a.sequenceId === id);
		if (!seq || !asset) return rendered;
		const data: ProjectData = {
			...this.current,
			tracks: seq.tracks,
			clips: seq.clips,
			markers: seq.markers,
		};
		const length = projectDuration(data);
		if (length <= 0) {
			// An emptied sequence has no picture or sound; clips of it are skipped on export.
			if (asset.path || asset.hasAudio) {
				this.data = applyOp(this.current, {
					type: "updateAsset",
					id: asset.id,
					patch: { path: "", hasAudio: false },
				}).data;
				this.touch();
			}
			return rendered;
		}
		// Whether the nested sequence makes any sound, so its clips are mixed (or not).
		const hasAudio = seq.clips.some((c) => {
			if (c.type !== "media" || c.disabled) return false;
			const t = seq.tracks.find((x) => x.id === c.trackId);
			const a = this.current.assets.find((x) => x.id === c.assetId);
			return !!a?.hasAudio && !!t && !t.muted && c.volume > 0;
		});
		const used = new Set(seq.clips.flatMap((c) => (c.type === "media" ? [c.assetId] : [])));
		const key = JSON.stringify([
			seq.tracks,
			seq.clips,
			this.current.canvas,
			this.current.assets.filter((a) => used.has(a.id)).map((a) => [a.id, a.path]),
		]);
		let hash = 0;
		for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
		const file = path.join(
			this.projectDir,
			CACHE_DIR,
			"sequences",
			`${id}-${(hash >>> 0).toString(36)}.mp4`,
		);
		if (!existsSync(file)) {
			const job =
				this.nestedRenders.get(file) ??
				(async () => {
					await fs.mkdir(path.dirname(file), { recursive: true });
					const tmp = `${file}.part.mp4`;
					await exportVideo(
						{
							dir: this.projectDir,
							data: {
								...data,
								export: { ...data.export, codec: "h264", videoQuality: "high", scale: 1 },
							},
							renderText,
						},
						tmp,
					);
					await fs.rename(tmp, file);
				})().finally(() => this.nestedRenders.delete(file));
			this.nestedRenders.set(file, job);
			await job;
			rendered++;
		}
		const stored = relativeToProject(this.projectDir, file);
		if (asset.path !== stored || asset.durationMs !== length || asset.hasAudio !== hasAudio) {
			// Pointing at a new render is housekeeping, not an edit: no undo step.
			let next = applyOp(this.current, {
				type: "updateAsset",
				id: asset.id,
				patch: { path: stored, durationMs: length, hasAudio },
			}).data;
			if (asset.durationMs !== length && asset.durationMs > 0)
				next = applyOp(next, {
					type: "fitNested",
					assetId: asset.id,
					fromMs: asset.durationMs,
					toMs: length,
				}).data;
			this.data = next;
			this.touch();
		}
		return rendered;
	}

	/** Searches for offline media (near the project and in `folders`) and relinks what it finds. */
	async findOffline(
		folders: string[],
		actor: Actor,
	): Promise<{ relinked: string[]; stillOffline: number }> {
		const found = await findMoved(
			this.projectDir,
			this.current.assets,
			folders.map((f) => path.resolve(f)),
		);
		const ids = Object.keys(found);
		if (ids.length)
			this.apply(
				{
					type: "relinkAssets",
					paths: Object.fromEntries(ids.map((id) => [id, this.stored(found[id])])),
				},
				actor,
			);
		return {
			relinked: ids.map((id) => this.current.assets.find((a) => a.id === id)?.name ?? id),
			stillOffline: this.offline().length,
		};
	}

	/**
	 * Points a media item at a new file, then looks in that folder for any
	 * other offline media, like "Locate" in Premiere.
	 */
	async relink(
		assetId: string,
		file: string,
		actor: Actor,
	): Promise<{ relinked: string[]; stillOffline: number }> {
		const asset = this.current.assets.find((a) => a.id === assetId);
		if (!asset) throw new Error(`No media "${assetId}".`);
		const resolved = path.resolve(file);
		if (!existsSync(resolved)) throw new Error(`${resolved} does not exist.`);
		if (kindOf(resolved) !== asset.kind)
			throw new Error(`${path.basename(resolved)} is not a ${asset.kind} file.`);
		const others = await findMoved(
			this.projectDir,
			this.current.assets.filter((a) => a.id !== assetId),
			[path.dirname(resolved)],
		);
		const paths = { [assetId]: resolved, ...others };
		this.apply(
			{
				type: "relinkAssets",
				paths: Object.fromEntries(Object.entries(paths).map(([id, f]) => [id, this.stored(f)])),
			},
			actor,
		);
		this.audioProxies.clear();
		return {
			relinked: Object.keys(paths).map(
				(id) => this.current.assets.find((a) => a.id === id)?.name ?? id,
			),
			stillOffline: this.offline().length,
		};
	}

	getActivity(): ActivityEntry[] {
		return this.activity;
	}

	log(actor: Actor, summary: string): void {
		this.activity = [
			{ id: ++this.activityId, at: new Date().toISOString(), actor, summary },
			...this.activity,
		].slice(0, ACTIVITY_LIMIT);
		this.emit("activity");
	}

	// -------------------------------------------------------------------------
	// Files
	// -------------------------------------------------------------------------

	async open(file: string, actor: Actor = "user"): Promise<void> {
		const resolved = path.resolve(file);
		const stat = await fs.stat(resolved).catch(() => null);
		if (!stat) throw new Error(`Project not found: ${resolved}`);
		const target = stat.isDirectory() ? await this.findProjectIn(resolved) : resolved;
		const data = parseProject(JSON.parse(await fs.readFile(target, "utf8")));
		await this.flush();
		await this.history?.flush();
		this.refreshPoster();
		this.file = target;
		this.data = data;
		this.past = [];
		this.future = [];
		this.proposal = null;
		this.dirty = false;
		this.revision++;
		this.proxies = new Set(
			data.assets.filter((a) => existsSync(this.proxyPath(a.id))).map((a) => this.cacheKey(a.id)),
		);
		this.audioProxies.clear();
		await this.remember();
		this.log(actor, `Opened ${path.basename(target)}`);
		this.emit("change");
		this.history = new ProjectHistory(target);
		await this.history.load();
		// A project opened for the first time starts its history with how it is now.
		if (!this.history.last) this.record(actor, "Started the history", "start");
		await this.autoRelink();
		this.autoBuildProxies();
		this.refreshPoster();
	}

	/** Saves and closes the project, back to the projects overview. */
	async close(actor: Actor = "user"): Promise<void> {
		if (!this.data) return;
		await this.flush();
		await this.history?.flush();
		this.history = null;
		this.refreshPoster();
		this.log(actor, `Closed ${this.data.name}`);
		this.proposal = null;
		this.file = null;
		this.data = null;
		this.past = [];
		this.future = [];
		this.proposal = null;
		this.revision++;
		this.emit("change");
	}

	/** Updates the poster frame shown in the projects overview (in the background). */
	private refreshPoster(): void {
		if (!this.file || !this.data) return;
		void makePoster(this.file, this.data).catch(() => {});
	}

	/** Removes a project from the recent list (the file stays where it is). */
	async forget(file: string): Promise<void> {
		const list = (await this.recent()).filter((item) => item.path !== file);
		await fs.mkdir(path.dirname(this.options.recentFile), { recursive: true });
		await fs.writeFile(this.options.recentFile, JSON.stringify(list, null, 2));
	}

	private proxyPath(assetId: string): string {
		return path.join(this.projectDir, CACHE_DIR, "proxy", `${this.cacheKey(assetId)}.mp4`);
	}

	/**
	 * Name for files derived from a media item (proxies, peaks, thumbnails). It
	 * includes the file's path, so relinked media or a new render of a nested
	 * sequence never reuses what was made from the old file.
	 */
	private cacheKey(assetId: string): string {
		const file = this.data?.assets.find((a) => a.id === assetId)?.path ?? "";
		let hash = 0;
		for (let i = 0; i < file.length; i++) hash = (hash * 31 + file.charCodeAt(i)) | 0;
		return `${assetId}-${(hash >>> 0).toString(36)}`;
	}

	private autoBuildProxies() {
		if (this.options.autoProxies?.() ?? true) this.buildProxies();
	}

	/** Builds missing playback proxies in the background, one at a time. Returns how many were queued. */
	buildProxies(): number {
		if (!this.data?.settings.useProxies) return 0;
		const pending = this.data.assets.filter(
			(a) =>
				a.kind === "video" &&
				!a.sequenceId &&
				!this.proxies.has(this.cacheKey(a.id)) &&
				(a.height > 720 || a.durationMs > 20000),
		);
		for (const asset of pending) {
			this.proxyQueue = this.proxyQueue.then(async () => {
				const key = this.cacheKey(asset.id);
				if (!this.data?.assets.some((a) => a.id === asset.id) || this.proxies.has(key)) return;
				try {
					await makeVideoProxy(this.assetPath(asset.id), this.proxyPath(asset.id));
					this.proxies.add(key);
					this.revision++;
					this.emit("change");
				} catch (error) {
					this.log(
						"system",
						`Could not build a playback copy of ${asset.name}: ${(error as Error).message}`,
					);
				}
			});
		}
		return pending.length;
	}

	/** Playback audio for an asset at a speed (extracted and/or time-stretched, cached). */
	audioProxy(assetId: string, speed: number): Promise<string> {
		const asset = this.current.assets.find((a) => a.id === assetId);
		if (!asset) return Promise.reject(new Error(`No media "${assetId}".`));
		const rounded = Math.round(speed * 1000) / 1000;
		if (
			rounded === 1 &&
			asset.kind === "audio" &&
			/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(asset.path)
		)
			return Promise.resolve(this.assetPath(assetId));
		const key = `${this.cacheKey(assetId)}@${rounded}`;
		let pending = this.audioProxies.get(key);
		if (!pending) {
			const file = path.join(this.projectDir, CACHE_DIR, "audio", `${key}.m4a`);
			pending = existsSync(file)
				? Promise.resolve(file)
				: makeAudioProxy(this.assetPath(assetId), file, rounded).then(() => file);
			pending.catch(() => this.audioProxies.delete(key));
			this.audioProxies.set(key, pending);
		}
		return pending;
	}

	async create(options: CreateProjectOptions, actor: Actor = "user"): Promise<void> {
		let target = path.resolve(options.path);
		const name =
			options.name ?? path.basename(target).replace(/\.cueproj$|\.cue\.json$|\.json$/, "");
		const isDir =
			(await fs.stat(target).catch(() => null))?.isDirectory() ||
			!(isProjectFile(target) || target.endsWith(".json"));
		if (isDir) target = path.join(target, `${slug(name)}${PROJECT_EXTENSION}`);
		if (await fs.stat(target).catch(() => null))
			throw new Error(`${target} already exists. Open it instead.`);
		await fs.mkdir(path.dirname(target), { recursive: true });
		let data = emptyProject(name);
		if (options.srt) {
			const srt = await fs.readFile(path.resolve(options.srt), "utf8");
			data = applyOp(data, { type: "setLines", lines: parseSrt(srt) }).data;
		} else if (options.lines?.length) {
			data = applyOp(data, { type: "setLines", lines: options.lines }).data;
		}
		await fs.writeFile(target, `${JSON.stringify(data, null, "\t")}\n`);
		await this.open(target, actor);
		if (options.video) {
			const [asset] = await this.importMedia([options.video], actor, { trackId: "V1", startMs: 0 });
			if (asset.width && asset.height)
				this.apply(
					{ type: "setCanvas", canvas: { width: asset.width, height: asset.height } },
					"system",
				);
		}
		this.past = [];
		this.log(actor, `Created "${name}"`);
		this.emit("change");
	}

	/**
	 * Saves a copy of the project somewhere else and switches to it. Media
	 * paths are rewritten so they still point at the same files.
	 */
	async saveAs(target: string, actor: Actor = "user"): Promise<string> {
		const from = this.projectDir;
		let file = path.resolve(target);
		if (!isProjectFile(file)) file += PROJECT_EXTENSION;
		const to = path.dirname(file);
		const data: ProjectData = {
			...this.current,
			assets: this.current.assets.map((a) => ({
				...a,
				path: relativeToProject(to, resolveInProject(from, a.path)),
				relPath: path.relative(to, resolveInProject(from, a.path)),
			})),
		};
		await fs.mkdir(to, { recursive: true });
		await fs.writeFile(file, `${JSON.stringify(data, null, "\t")}\n`);
		await this.open(file, actor);
		return file;
	}

	/** Brings in a timeline from another editor (OpenTimelineIO) as new tracks. */
	async importTimeline(
		file: string,
		actor: Actor,
	): Promise<{ tracks: number; clips: number; sequences: number; missing: string[] }> {
		const source = path.resolve(file);
		const timeline = fromOtio(JSON.parse(await fs.readFile(source, "utf8")), path.dirname(source));
		const media = (stack: ImportedStack): string[] =>
			stack.tracks.flatMap((t) =>
				t.clips.flatMap((c) =>
					c.type === "media" ? [c.file] : c.type === "nested" ? media(c.timeline) : [],
				),
			);
		const all = [...new Set(media(timeline))];
		const missing = all.filter((f) => !existsSync(f));
		const counts = { clips: 0, sequences: 0 };
		await this.transaction(actor, `Imported ${path.basename(source)}`, async () => {
			const byPath = new Map(
				this.current.assets.map((a) => [resolveInProject(this.projectDir, a.path), a.id]),
			);
			const files = all.filter((f) => existsSync(f) && !byPath.has(f) && kindOf(f));
			for (const asset of await this.importMedia(files, actor))
				byPath.set(resolveInProject(this.projectDir, asset.path), asset.id);
			if (this.current.clips.length === 0 && timeline.width && timeline.height)
				this.apply(
					{ type: "setCanvas", canvas: { width: timeline.width, height: timeline.height } },
					actor,
				);
			this.importStack(timeline, byPath, actor, counts);
		});
		return {
			tracks: timeline.tracks.length,
			clips: counts.clips,
			sequences: counts.sequences,
			missing,
		};
	}

	/** Adds an imported stack's tracks and clips to the open timeline; nested stacks become nested sequences. */
	private importStack(
		stack: ImportedStack,
		byPath: Map<string, string>,
		actor: Actor,
		counts: { clips: number; sequences: number },
	) {
		let visualIndex = this.current.tracks.filter((t) => t.kind !== "audio").length;
		for (const track of stack.tracks) {
			const trackId = this.apply(
				{
					type: "addTrack",
					kind: track.kind,
					name: track.name.slice(0, 80),
					index: track.kind === "audio" ? undefined : visualIndex++,
				},
				actor,
			).created?.[0];
			if (!trackId) continue;
			if (track.muted || track.hidden)
				this.apply(
					{ type: "updateTrack", id: trackId, patch: { muted: track.muted, hidden: track.hidden } },
					actor,
				);
			const inputs: Extract<Op, { type: "addClips" }>["clips"] = [];
			const extras: { index: number; extra?: Partial<MediaClip> }[] = [];
			for (const c of track.clips) {
				if (c.type === "text") {
					inputs.push({
						type: "text",
						trackId,
						startMs: c.startMs,
						durationMs: c.durationMs,
						text: c.text.slice(0, 4000),
						style: c.extra?.style,
						animationIn: c.extra?.animationIn,
						animationOut: c.extra?.animationOut,
					});
				} else if (c.type === "adjustment") {
					const id = this.apply(
						{ type: "addAdjustment", trackId, startMs: c.startMs, durationMs: c.durationMs },
						actor,
					).created?.[0];
					const patch = {
						...(c.extra?.color ? { color: c.extra.color } : {}),
						...(c.extra?.mask ? { mask: c.extra.mask } : {}),
					};
					if (id && Object.keys(patch).length) this.apply({ type: "updateClip", id, patch }, actor);
					counts.clips++;
				} else if (c.type === "nested") {
					// Build the nested sequence, come back, and place a clip that stands for it.
					const parent = activeSequence(this.current).id;
					const seqId = this.apply(
						{ type: "newSequence", name: c.name.slice(0, 120), open: true, empty: true },
						actor,
					).created?.[0];
					if (!seqId) continue;
					this.importStack(c.timeline, byPath, actor, counts);
					this.apply({ type: "openSequence", id: parent }, actor);
					const asset: Asset = {
						id: newId("a"),
						kind: "video",
						name: c.name.slice(0, 120),
						path: "",
						sequenceId: seqId,
						durationMs: Math.max(c.timeline.durationMs, c.inMs + c.durationMs),
						width: this.current.canvas.width,
						height: this.current.canvas.height,
						hasAudio: c.timeline.tracks.some((t) => t.kind === "audio" && t.clips.length > 0),
						origin: "import",
						createdAt: new Date().toISOString(),
						actor,
					};
					this.apply({ type: "addAsset", asset }, actor);
					inputs.push({
						type: "media",
						trackId,
						assetId: asset.id,
						startMs: c.startMs,
						durationMs: c.durationMs,
						inMs: c.inMs,
						name: asset.name,
					});
					counts.sequences++;
				} else {
					const assetId = byPath.get(c.file);
					if (!assetId) continue;
					extras.push({ index: inputs.length, extra: c.extra });
					inputs.push({
						type: "media",
						trackId,
						assetId,
						startMs: c.startMs,
						durationMs: c.durationMs,
						inMs: c.inMs,
						speed: c.speed,
						volume: c.volume,
						fadeInMs: c.extra?.fadeInMs,
						fadeOutMs: c.extra?.fadeOutMs,
						transform: c.extra?.transform,
						denoise: c.extra?.denoise,
						name: c.name?.slice(0, 120),
					});
				}
			}
			if (inputs.length) {
				const created = this.apply({ type: "addClips", clips: inputs }, actor).created ?? [];
				counts.clips += inputs.length;
				// Colour, masks and keys round-trip through Cue's own OTIO metadata.
				for (const { index, extra } of extras) {
					const id = created[index];
					const patch = {
						...(extra?.color ? { color: extra.color } : {}),
						...(extra?.mask ? { mask: extra.mask } : {}),
						...(extra?.key ? { key: extra.key } : {}),
						...(extra?.effects ? { effects: extra.effects } : {}),
					};
					if (id && Object.keys(patch).length) this.apply({ type: "updateClip", id, patch }, actor);
				}
			}
		}
		for (const m of stack.markers)
			this.apply({ type: "addMarker", atMs: m.atMs, label: m.label.slice(0, 120) }, actor);
	}

	/**
	 * Writes the project if it changed. Saves run one at a time, each writing the
	 * state as it was when it started; the project only counts as saved if nothing
	 * changed meanwhile, so an edit made during a write is saved by the next one.
	 */
	flush(): Promise<void> {
		void this.history?.flush();
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		const next = this.saving.then(() => this.save());
		this.saving = next.catch(() => {});
		return next;
	}

	private async save(): Promise<void> {
		if (!this.dirty || !this.file || !this.data) return;
		const file = this.file;
		const revision = this.revision;
		const json = `${JSON.stringify(this.data, null, "\t")}\n`;
		const tmp = `${file}.tmp`;
		await fs.writeFile(tmp, json);
		await fs.rename(tmp, file);
		if (this.file === file && this.revision === revision) {
			this.dirty = false;
			this.emit("change");
		}
	}

	async recent(): Promise<RecentProject[]> {
		try {
			const list = JSON.parse(
				await fs.readFile(this.options.recentFile, "utf8"),
			) as RecentProject[];
			return Array.isArray(list) ? list : [];
		} catch {
			return [];
		}
	}

	// -------------------------------------------------------------------------
	// Edits
	// -------------------------------------------------------------------------

	apply(op: Op | InternalOp, actor: Actor): { summary: string; created?: string[] } {
		const before = this.current;
		const { data, summary, created } = applyOp(before, op);
		// In review mode an agent's edits are applied (so they can be seen and played)
		// but kept apart as a proposal, measured against how things were before them.
		if (actor === "agent" && this.options.reviewAgentEdits?.()) {
			this.proposal ??= { base: before, steps: [] };
			this.proposal.steps.push(summary);
		}
		this.past = [...this.past, before].slice(-HISTORY_LIMIT);
		this.future = [];
		this.data = data;
		this.touch();
		this.log(actor, summary);
		this.record(actor, summary, "edit");
		return { summary, created };
	}

	/** Runs several edits as one undo step. */
	/**
	 * Runs several edits as one step. Transactions run one at a time; callers that
	 * edit from outside (the controller) wait for `settled()` first, so nothing is
	 * merged into, or reverted with, a transaction it wasn't part of.
	 */
	transaction<T>(actor: Actor, summary: string, fn: () => Promise<T> | T): Promise<T> {
		const run = this.transactions.then(() => this.runTransaction(actor, summary, fn));
		this.transactions = run.then(
			() => {},
			() => {},
		);
		return run;
	}

	/** Saves the project and its history (before quitting). */
	async flushAll(): Promise<void> {
		await this.flush();
		await this.history?.flush();
	}

	/** The pending proposal, compared clip by clip on the open timeline. */
	private proposalView(): Proposal | null {
		if (!this.proposal || !this.data) return null;
		const { base, steps } = this.proposal;
		const open = activeSequence(this.data).id;
		const before = allSequences(base).find((q) => q.id === open)?.clips ?? [];
		const now = new Map(this.data.clips.map((c) => [c.id, c]));
		const was = new Map(before.map((c) => [c.id, c]));
		const added = this.data.clips.filter((c) => !was.has(c.id)).map((c) => c.id);
		const changed = this.data.clips
			.filter((c) => was.has(c.id) && JSON.stringify(was.get(c.id)) !== JSON.stringify(c))
			.map((c) => c.id);
		const removed = before.filter((c) => !now.has(c.id));
		const rest = (d: ProjectData) =>
			JSON.stringify({ ...d, clips: [], sequences: [], sequence: undefined, name: "" });
		const other = rest(base) !== rest(this.data);
		if (!added.length && !changed.length && !removed.length && !other) return null;
		return { steps, added, changed, removed, other };
	}

	/**
	 * Keeps the agent's proposed changes: all of them, or only these clips (the
	 * rest stay pending).
	 */
	acceptProposal(actor: Actor, clipIds?: string[]): { kept: number } {
		const view = this.proposalView();
		if (!this.proposal || !view) {
			this.proposal = null;
			return { kept: 0 };
		}
		if (!clipIds) {
			const n = view.added.length + view.changed.length + view.removed.length;
			this.proposal = null;
			this.log(actor, `Kept the agent's changes (${view.steps.length} step(s))`);
			this.touch();
			return { kept: n };
		}
		// Accepting a clip makes its current state the new reference point.
		const ids = new Set(clipIds);
		const base = this.proposal.base;
		const open = activeSequence(this.current).id;
		const current = this.current.clips;
		const withAccepted = (clips: Clip[]) => [
			...clips.filter((c) => !ids.has(c.id)),
			...current.filter((c) => ids.has(c.id)),
		];
		this.proposal.base =
			activeSequence(base).id === open
				? { ...base, clips: withAccepted(base.clips) }
				: {
						...base,
						sequences: base.sequences?.map((q) =>
							q.id === open ? { ...q, clips: withAccepted(q.clips) } : q,
						),
					};
		if (!this.proposalView()) this.proposal = null;
		this.log(actor, `Kept ${ids.size} of the agent's changes`);
		this.touch();
		return { kept: ids.size };
	}

	/**
	 * Undoes the agent's proposed changes: all of them (back to how the project
	 * was before), or only these clips. Undoable like any edit.
	 */
	rejectProposal(actor: Actor, clipIds?: string[]): { reverted: number } {
		const view = this.proposalView();
		if (!this.proposal || !view) {
			this.proposal = null;
			return { reverted: 0 };
		}
		const base = this.proposal.base;
		let next: ProjectData;
		let n: number;
		if (!clipIds) {
			// Back to the base, but staying on the timeline that is open now.
			const open = activeSequence(this.current).id;
			const q = allSequences(base).find((s) => s.id === open);
			next =
				q && activeSequence(base).id !== open
					? {
							...base,
							sequence: { id: q.id, name: q.name },
							sequences: [
								...(base.sequences ?? []).filter((s) => s.id !== open),
								{
									...activeSequence(base),
									tracks: base.tracks,
									clips: base.clips,
									markers: base.markers,
								},
							],
							tracks: q.tracks,
							clips: q.clips,
							markers: q.markers,
						}
					: base;
			n = view.added.length + view.changed.length + view.removed.length;
			this.proposal = null;
		} else {
			const ids = new Set(clipIds);
			const open = activeSequence(this.current).id;
			const before = allSequences(base).find((s) => s.id === open)?.clips ?? [];
			const clips = [
				...this.current.clips.filter((c) => !ids.has(c.id)),
				...before.filter((c) => ids.has(c.id)),
			];
			next = { ...this.current, clips };
			n = ids.size;
		}
		this.past = [...this.past, this.current].slice(-HISTORY_LIMIT);
		this.future = [];
		this.data = next;
		const summary = clipIds
			? `Undid ${n} of the agent's changes`
			: `Undid the agent's changes (${view.steps.length} step(s))`;
		if (this.proposal && !this.proposalView()) this.proposal = null;
		this.touch();
		this.log(actor, summary);
		this.record(actor, summary, "edit");
		return { reverted: n };
	}

	/** Resolves once no transaction is running. */
	settled(): Promise<void> {
		return this.transactions;
	}

	private async runTransaction<T>(
		actor: Actor,
		summary: string,
		fn: () => Promise<T> | T,
	): Promise<T> {
		const before = this.current;
		const past = this.past;
		this.batching++;
		try {
			const result = await fn();
			this.past = [...past, before].slice(-HISTORY_LIMIT);
			this.future = [];
			this.log(actor, summary);
			this.batching--;
			this.record(actor, summary, "edit");
			return result;
		} catch (error) {
			this.batching--;
			this.data = before;
			this.past = past;
			this.touch();
			throw error;
		}
	}

	undo(actor: Actor): boolean {
		const previous = this.past.at(-1);
		if (!previous || !this.data) return false;
		this.past = this.past.slice(0, -1);
		this.future = [this.data, ...this.future];
		this.data = previous;
		this.touch();
		this.log(actor, "Undo");
		this.record(actor, "Undo", "undo");
		return true;
	}

	redo(actor: Actor): boolean {
		const next = this.future[0];
		if (!next || !this.data) return false;
		this.future = this.future.slice(1);
		this.past = [...this.past, this.data];
		this.data = next;
		this.touch();
		this.log(actor, "Redo");
		this.record(actor, "Redo", "redo");
		return true;
	}

	// -------------------------------------------------------------------------
	// Media
	// -------------------------------------------------------------------------

	assetPath(assetId: string): string {
		const asset = this.current.assets.find((a) => a.id === assetId);
		if (!asset) throw new Error(`No media "${assetId}".`);
		return resolveInProject(this.projectDir, asset.path);
	}

	/** Adds files to the media library, optionally placing them one after another on a track. */
	async importMedia(
		files: string[],
		actor: Actor,
		place?: { trackId: string; startMs: number },
	): Promise<Asset[]> {
		const added: Asset[] = [];
		let at = place?.startMs ?? 0;
		for (const file of files) {
			const resolved = path.resolve(file);
			const kind = kindOf(resolved);
			if (!kind) throw new Error(`Unsupported file type: ${path.basename(resolved)}`);
			const [info, stat] = await Promise.all([probe(resolved), fs.stat(resolved)]);
			const asset: Asset = {
				id: newId("a"),
				kind,
				name: path.basename(resolved),
				path: relativeToProject(this.projectDir, resolved),
				relPath: path.relative(this.projectDir, resolved),
				size: stat.size,
				durationMs: kind === "image" ? 0 : info.durationMs,
				width: info.width,
				height: info.height,
				hasAudio: kind === "audio" ? true : info.hasAudio,
				origin: "import",
				createdAt: new Date().toISOString(),
				actor,
			};
			this.apply(
				{
					type: "addAsset",
					asset,
					placeOn: place ? { trackId: place.trackId, startMs: at } : undefined,
				},
				actor,
			);
			at += kind === "image" ? 5000 : asset.durationMs;
			added.push(asset);
		}
		this.autoBuildProxies();
		return added;
	}

	/** Turns a finished microphone recording into a take for a line. */
	async addRecording(input: {
		lineId: string;
		audio: Buffer;
		extension: string;
		recordedAtMs: number;
		actor: Actor;
	}): Promise<Asset> {
		const line = this.requireLine(input.lineId);
		const count = this.current.assets.filter((a) => a.lineId === line.id).length + 1;
		const folder = path.join(this.projectDir, "takes", safeSegment(line.id));
		await fs.mkdir(folder, { recursive: true });
		const base = `${safeSegment(line.id)}-take${String(count).padStart(2, "0")}-${Date.now().toString(36)}`;
		const raw = path.join(
			folder,
			`${base}.source.${input.extension.replace(/[^a-z0-9]/gi, "") || "webm"}`,
		);
		const wav = path.join(folder, `${base}.wav`);
		await fs.writeFile(raw, input.audio);
		try {
			await toWav(raw, wav);
		} finally {
			await fs.rm(raw, { force: true });
		}
		return this.addTakeFile(line.id, wav, "recording", input.actor, {
			recordedAtMs: Math.round(input.recordedAtMs),
			name: `Take ${count}`,
		});
	}

	/** Generates a spoken take for a line (OpenAI voices or the macOS synthesiser). */
	async generateTake(
		lineId: string,
		runtime: AiRuntime,
		actor: Actor,
		overrides: { voice?: string; instructions?: string; text?: string } = {},
	): Promise<Asset> {
		const line = this.requireLine(lineId);
		const ai = this.current.ai;
		const text = overrides.text ?? line.text;
		if (!text.trim()) throw new Error(`Line ${lineId} has no text.`);
		const spoken = await runtime.speak(text, {
			voice: overrides.voice ?? ai.voice,
			instructions: overrides.instructions ?? ai.voiceInstructions,
			model: ai.ttsModel,
		});
		const folder = path.join(this.projectDir, "takes", safeSegment(line.id));
		await fs.mkdir(folder, { recursive: true });
		const count = this.current.assets.filter((a) => a.lineId === line.id).length + 1;
		const wav = path.join(
			folder,
			`${safeSegment(line.id)}-ai-${slug(spoken.voice)}-${Date.now().toString(36)}.wav`,
		);
		await fs.writeFile(wav, spoken.audio);
		return this.addTakeFile(line.id, wav, "tts", actor, {
			name: `AI ${spoken.voice} ${count}`,
			generation: {
				provider: spoken.provider,
				model: spoken.model,
				prompt: text,
				voice: spoken.voice,
			},
		});
	}

	/** Rewrites a line with the text model, e.g. so it fits its slot. Returns before and after. */
	async rewriteLine(
		lineId: string,
		runtime: AiRuntime,
		actor: Actor,
		goal: "fit" | "clearer" | "shorter" | "custom",
		instructions?: string,
	) {
		const line = this.requireLine(lineId);
		const view = deriveLines(this.current).find((l) => l.id === lineId);
		const wordsPerSecond = view?.speechMs
			? line.text.split(/\s+/).length / (view.speechMs / 1000)
			: 2.6;
		const budgetWords = Math.max(3, Math.floor((line.maxMs / 1000) * wordsPerSecond * 0.92));
		const task = {
			fit: `Rewrite it so it can be spoken comfortably within ${(line.maxMs / 1000).toFixed(1)} seconds (at most about ${budgetWords} words). Keep every fact and number.`,
			clearer:
				"Rewrite it to be clearer and more natural to say out loud. Keep the length about the same and keep every fact and number.",
			shorter: "Make it noticeably shorter while keeping every fact and number.",
			custom: instructions ?? "Improve it.",
		}[goal];
		const context = this.current.lines
			.map((l) => `${l.id === lineId ? ">>" : "  "} ${l.text}`)
			.join("\n");
		const text = (
			await runtime.chat(
				"You edit voiceover scripts. Reply with only the rewritten line: no quotes, no labels, no explanation. Match the voice and vocabulary of the surrounding script.",
				`Script for context (the line to rewrite is marked >>):\n${context}\n\nLine: ${line.text}\n\n${task}${instructions && goal !== "custom" ? `\nAlso: ${instructions}` : ""}`,
			)
		)
			.replace(/^["'“]|["'”]$/g, "")
			.trim();
		if (!text) throw new Error("The text model returned nothing.");
		this.apply({ type: "updateLine", id: lineId, patch: { text } }, actor);
		return { before: line.text, after: text, words: text.split(/\s+/).length, budgetWords };
	}

	/** Uses an existing audio file as a take for a line. */
	async importTake(
		lineId: string,
		file: string,
		actor: Actor,
		recordedAtMs?: number,
	): Promise<Asset> {
		this.requireLine(lineId);
		const source = path.resolve(file);
		const folder = path.join(this.projectDir, "takes", safeSegment(lineId));
		await fs.mkdir(folder, { recursive: true });
		const wav = path.join(folder, `${path.parse(source).name}-${Date.now().toString(36)}.wav`);
		await toWav(source, wav);
		return this.addTakeFile(lineId, wav, "import", actor, {
			recordedAtMs,
			name: path.basename(source),
		});
	}

	private async addTakeFile(
		lineId: string,
		wav: string,
		origin: Asset["origin"],
		actor: Actor,
		extra: { recordedAtMs?: number; name: string; generation?: Asset["generation"] },
	): Promise<Asset> {
		const analysis = await analyseSpeech(wav, this.current.settings.silenceDb);
		const asset: Asset = {
			id: newId("a"),
			kind: "audio",
			name: extra.name,
			path: relativeToProject(this.projectDir, wav),
			durationMs: analysis.durationMs,
			width: 0,
			height: 0,
			hasAudio: true,
			origin,
			createdAt: new Date().toISOString(),
			lineId,
			speechStartMs: analysis.speechStartMs,
			speechEndMs: analysis.speechEndMs,
			peakDb: analysis.peakDb,
			actor,
			...(extra.recordedAtMs !== undefined ? { recordedAtMs: extra.recordedAtMs } : {}),
			...(extra.generation ? { generation: extra.generation } : {}),
		};
		this.apply({ type: "addTake", asset }, actor);
		return asset;
	}

	/** Generates a still image and adds it to the library (optionally on a track). */
	async generateImage(
		prompt: string,
		runtime: AiRuntime,
		actor: Actor,
		options: {
			orientation?: "landscape" | "portrait" | "square";
			place?: { trackId: string; startMs: number };
		} = {},
	): Promise<Asset> {
		const size = ({ landscape: "1536x1024", portrait: "1024x1536", square: "1024x1024" } as const)[
			options.orientation ?? "landscape"
		];
		const png = await runtime.image(prompt, { model: this.current.ai.imageModel, size });
		const folder = path.join(this.projectDir, "generated");
		await fs.mkdir(folder, { recursive: true });
		const file = path.join(folder, `${slug(prompt).slice(0, 40)}-${Date.now().toString(36)}.png`);
		await fs.writeFile(file, png);
		const [w, h] = size.split("x").map(Number);
		const asset: Asset = {
			id: newId("a"),
			kind: "image",
			name: prompt.slice(0, 60),
			path: relativeToProject(this.projectDir, file),
			durationMs: 0,
			width: w,
			height: h,
			hasAudio: false,
			origin: "generated",
			createdAt: new Date().toISOString(),
			generation: { provider: "openai", model: this.current.ai.imageModel, prompt },
			actor,
		};
		this.apply({ type: "addAsset", asset, placeOn: options.place }, actor);
		return asset;
	}

	/** Transcribes what is heard (voiceover track or the full mix) into caption clips. */
	async autoCaptions(
		runtime: AiRuntime,
		actor: Actor,
		options: {
			source: "voiceover" | "mix";
			trackId?: string;
			maxChars?: number;
			language?: string;
			/** plain, or a word-by-word look (social-style captions). */
			style?: "plain" | "highlight" | "reveal" | "pop" | "bounce";
			/** Colour of the word being said. */
			wordColor?: string;
		},
	): Promise<{ count: number; trackId: string }> {
		const tmp = path.join(os.tmpdir(), `cue-captions-${Date.now()}.wav`);
		try {
			if (options.source === "voiceover") await exportVoiceover(this.exportContext(), tmp);
			else await exportAudioMix(this.exportContext(), tmp);
			const hint = this.current.lines
				.map((l) => l.text)
				.join(" ")
				.slice(0, 800);
			const { segments } = await runtime.transcribe(tmp, {
				model: this.current.ai.transcriptionModel,
				language: options.language,
				prompt: hint || undefined,
			});
			const animated = options.style && options.style !== "plain";
			// Word-by-word captions read best a few words at a time.
			const chunks = chunkCaptions(segments, options.maxChars ?? (animated ? 24 : 42));
			const trackId =
				options.trackId ??
				this.apply({ type: "addTrack", kind: "text", name: "Captions", index: 0 }, actor)
					.created?.[0];
			if (!trackId) throw new Error("Could not create a captions track.");
			if (chunks.length === 0) return { count: 0, trackId };
			const style = animated
				? {
						...DEFAULT_TEXT_STYLE,
						fontSize: 68,
						fontWeight: 800,
						color: "#ffffff",
						background: null,
						uppercase: true,
						strokeColor: "#000000",
						strokeWidth: 6,
						shadow: true,
						y: 0.74,
						width: 0.82,
						padding: 8,
						lineHeight: 1.1,
					}
				: {
						...DEFAULT_TEXT_STYLE,
						fontSize: 46,
						fontWeight: 600,
						y: 0.9,
						width: 0.86,
						padding: 14,
						radius: 10,
					};
			this.apply(
				{
					type: "addClips",
					clips: chunks.map((chunk, i) => {
						const next = chunks[i + 1];
						const end = next ? Math.min(chunk.endMs + 150, next.startMs) : chunk.endMs + 300;
						return {
							type: "text" as const,
							trackId,
							startMs: chunk.startMs,
							durationMs: Math.max(400, end - chunk.startMs),
							text: chunk.text,
							style,
							animationIn: "none" as const,
							animationOut: "none" as const,
							name: "Caption",
							// Word times relative to the caption, for word-by-word styles.
							words: chunk.words.map((w) => ({
								text: w.text,
								startMs: Math.max(0, w.startMs - chunk.startMs),
								endMs: Math.max(0, w.endMs - chunk.startMs),
							})),
							...(animated
								? {
										wordStyle: {
											mode: options.style as "highlight" | "reveal" | "pop" | "bounce",
											color: options.wordColor ?? "#ffd60a",
										},
									}
								: {}),
						};
					}),
				},
				actor,
			);
			return { count: chunks.length, trackId };
		} finally {
			await fs.rm(tmp, { force: true });
		}
	}

	/** Builds script lines from the speech in a media file, e.g. an existing narration. */
	async scriptFromMedia(
		assetId: string,
		runtime: AiRuntime,
		actor: Actor,
		options: { idPrefix?: string; replace?: boolean } = {},
	): Promise<number> {
		const { segments } = await runtime.transcribe(await this.audioProxy(assetId, 1), {
			model: this.current.ai.transcriptionModel,
		});
		const clip = this.current.clips.find((c) => c.type === "media" && c.assetId === assetId);
		const offset = clip && clip.type === "media" ? clip.startMs - clip.inMs : 0;
		const prefix = options.idPrefix ?? "L";
		const lines = segments.map((segment, i) => ({
			id: `${prefix}${String(i + 1).padStart(2, "0")}`,
			text: segment.text,
			startMs: Math.max(0, segment.startMs + offset),
			targetMs: segment.endMs - segment.startMs,
			maxMs: (segments[i + 1] ? segments[i + 1].startMs : segment.endMs + 2000) - segment.startMs,
		}));
		this.apply(
			{
				type: "setLines",
				lines: options.replace === false ? [...this.current.lines, ...lines] : lines,
			},
			actor,
		);
		return lines.length;
	}

	/**
	 * Finds silent stretches in the audio of the given clips (default: the
	 * voiceover and video tracks) and cuts them out of every track, closing
	 * the gaps so everything stays in sync.
	 */
	async removeSilence(
		actor: Actor,
		options: {
			clipIds?: string[];
			thresholdDb: number;
			minSilenceMs: number;
			keepMs: number;
			dryRun?: boolean;
		},
	): Promise<{ ranges: { startMs: number; endMs: number }[]; removedMs: number }> {
		const data = this.current;
		const clips = data.clips.filter((c): c is import("./types").MediaClip => {
			if (c.type !== "media") return false;
			if (options.clipIds) return options.clipIds.includes(c.id);
			const track = data.tracks.find((t) => t.id === c.trackId);
			const asset = data.assets.find((a) => a.id === c.assetId);
			return (
				!!track &&
				!track.muted &&
				!!asset?.hasAudio &&
				(track.kind === "video" || !!track.voiceover)
			);
		});
		if (clips.length === 0) throw new Error("No clips with audio to analyse.");
		// A moment is removable only if every analysed clip covering it is silent.
		const silentByClip = await Promise.all(
			clips.map(async (c) => {
				const found = await detectSilences(this.assetPath(c.assetId), {
					thresholdDb: options.thresholdDb,
					minSilenceMs: options.minSilenceMs,
					fromMs: c.inMs,
					durationMs: c.durationMs * c.speed,
				});
				return found
					.map((r) => ({
						startMs: c.startMs + (r.startMs - c.inMs) / c.speed + options.keepMs,
						endMs: c.startMs + (r.endMs - c.inMs) / c.speed - options.keepMs,
					}))
					.filter((r) => r.endMs - r.startMs > 40);
			}),
		);
		const covered = (ms: number) =>
			clips.filter((c) => ms >= c.startMs && ms < c.startMs + c.durationMs);
		const candidates = silentByClip.flat().sort((a, b) => a.startMs - b.startMs);
		const ranges: { startMs: number; endMs: number }[] = [];
		for (const r of candidates) {
			const mid = (r.startMs + r.endMs) / 2;
			const owners = covered(mid);
			const allSilent = owners.every((c) =>
				silentByClip[clips.indexOf(c)].some(
					(x) => x.startMs <= r.startMs + 1 && x.endMs >= r.endMs - 1,
				),
			);
			if (allSilent && !ranges.some((x) => x.startMs < r.endMs && x.endMs > r.startMs))
				ranges.push({ startMs: Math.round(r.startMs), endMs: Math.round(r.endMs) });
		}
		const removedMs = ranges.reduce((sum, r) => sum + r.endMs - r.startMs, 0);
		if (!options.dryRun && ranges.length) this.apply({ type: "removeRanges", ranges }, actor);
		return { ranges, removedMs };
	}

	/** Word-level transcript of a media item, stored on the asset. */
	async transcribeAsset(assetId: string, runtime: AiRuntime, actor: Actor, language?: string) {
		const file = await this.audioProxy(assetId, 1);
		const { segments } = await runtime.transcribe(file, {
			model: this.current.ai.transcriptionModel,
			language,
		});
		const words = segments.flatMap((segment) =>
			segment.words?.length
				? segment.words.map((w) => ({ text: w.word.trim(), startMs: w.startMs, endMs: w.endMs }))
				: [{ text: segment.text, startMs: segment.startMs, endMs: segment.endMs }],
		);
		const transcript = {
			model: this.current.ai.transcriptionModel,
			createdAt: new Date().toISOString(),
			words: words.filter((w) => w.text),
		};
		this.apply({ type: "setTranscript", assetId, transcript }, actor);
		return transcript;
	}

	/** Timeline ranges where a stretch of an asset's source is playing. */
	private sourceToTimeline(assetId: string, fromMs: number, toMs: number) {
		return this.current.clips
			.filter((c): c is import("./types").MediaClip => c.type === "media" && c.assetId === assetId)
			.flatMap((c) => {
				const a = Math.max(fromMs, c.inMs);
				const b = Math.min(toMs, c.inMs + c.durationMs * c.speed);
				if (b - a < 5) return [];
				return [
					{
						startMs: Math.round(c.startMs + (a - c.inMs) / c.speed),
						endMs: Math.round(c.startMs + (b - c.inMs) / c.speed),
					},
				];
			});
	}

	/**
	 * Text-based editing: removes words (by index range in the transcript) from
	 * the timeline, cutting every track so picture, sound and text stay in sync.
	 */
	cutWords(assetId: string, ranges: { from: number; to: number }[], actor: Actor) {
		const asset = this.current.assets.find((a) => a.id === assetId);
		const words = asset?.transcript?.words;
		if (!words?.length) throw new Error("Transcribe this media first.");
		const timeline = ranges.flatMap(({ from, to }) => {
			const a = words[Math.max(0, Math.min(from, to))];
			const b = words[Math.min(words.length - 1, Math.max(from, to))];
			if (!a || !b) return [];
			// Cut from the end of the previous word to the start of the next one, so no breath is left behind.
			const prevEnd = words[Math.min(from, to) - 1]?.endMs ?? a.startMs;
			const nextStart = words[Math.max(from, to) + 1]?.startMs ?? b.endMs;
			return this.sourceToTimeline(
				assetId,
				Math.max(prevEnd, a.startMs - 120),
				Math.min(nextStart, b.endMs + 120),
			);
		});
		if (timeline.length === 0) throw new Error("Those words are not on the timeline.");
		return {
			summary: this.apply({ type: "removeRanges", ranges: timeline }, actor).summary,
			ranges: timeline,
		};
	}

	/** Removes filler words ("um", "uh", …) found in the transcript. */
	removeFillers(
		assetId: string,
		actor: Actor,
		fillers = ["um", "uh", "uhm", "erm", "er", "ah", "hmm", "mm"],
	) {
		const words = this.current.assets.find((a) => a.id === assetId)?.transcript?.words;
		if (!words?.length) throw new Error("Transcribe this media first.");
		const set = new Set(fillers.map((f) => f.toLowerCase()));
		const ranges = words.flatMap((w, i) =>
			set.has(w.text.toLowerCase().replace(/[^a-z']/g, "")) ? [{ from: i, to: i }] : [],
		);
		if (ranges.length === 0) return { summary: "No filler words found", ranges: [] };
		return this.cutWords(assetId, ranges, actor);
	}

	async peaks(assetId: string): Promise<number[]> {
		const cache = path.join(this.projectDir, CACHE_DIR, "peaks", `${this.cacheKey(assetId)}.json`);
		try {
			return JSON.parse(await fs.readFile(cache, "utf8")) as number[];
		} catch {}
		const peaks = await computePeaks(this.assetPath(assetId));
		await fs.mkdir(path.dirname(cache), { recursive: true });
		await fs.writeFile(cache, JSON.stringify(peaks));
		return peaks;
	}

	async thumbnails(assetId: string): Promise<{ intervalMs: number; urls: string[] }> {
		const asset = this.current.assets.find((a) => a.id === assetId);
		if (!asset || asset.kind !== "video") return { intervalMs: 0, urls: [] };
		const dir = path.join(this.projectDir, CACHE_DIR, "thumbs", this.cacheKey(assetId));
		const meta = path.join(dir, "meta.json");
		let info: { intervalMs: number; count: number };
		try {
			info = JSON.parse(await fs.readFile(meta, "utf8"));
		} catch {
			await fs.rm(dir, { recursive: true, force: true });
			info = await extractThumbnails(this.assetPath(assetId), dir, asset.durationMs);
			await fs.writeFile(meta, JSON.stringify(info));
		}
		const urls = Array.from({ length: info.count }, (_, i) =>
			this.options.mediaUrl(path.join(dir, `${String(i + 1).padStart(4, "0")}.jpg`)),
		);
		return { intervalMs: info.intervalMs, urls };
	}

	// -------------------------------------------------------------------------
	// Export
	// -------------------------------------------------------------------------

	exportContext(renderText?: TextRenderer, onProgress?: (fraction: number) => void) {
		return { dir: this.projectDir, data: this.current, renderText, onProgress };
	}

	async export(
		kind: ExportKind,
		out: string | undefined,
		actor: Actor,
		renderText?: TextRenderer,
		range?: { startMs: number; endMs: number },
	): Promise<ExportReport> {
		if (kind === "edl") await this.renderNested(renderText);
		if (kind === "otio" || kind === "fcpxml" || kind === "mlt" || kind === "edl")
			return this.exportTimeline(kind, out, actor);
		// Nested sequences must be up to date before they are used in an export.
		if (kind === "video" || kind === "gif" || kind === "audio") await this.renderNested(renderText);
		const ctx = { ...this.exportContext(renderText), range };
		const target = out ? path.resolve(this.projectDir, out) : undefined;
		const report =
			kind === "stems"
				? await exportStems(ctx, target)
				: kind === "voiceover"
					? await exportVoiceover(ctx, target)
					: kind === "audio"
						? await exportAudioMix(ctx, target ?? path.join(this.projectDir, "export", "mix.wav"))
						: kind === "captions"
							? await exportCaptions(ctx, target)
							: kind === "gif"
								? await exportGif(
										ctx,
										target ??
											path.join(this.projectDir, "export", `${slug(this.current.name)}.gif`),
									)
								: await exportVideo(ctx, target);
		this.log(
			actor,
			`Exported ${kind} → ${report.outputs.map((f) => path.basename(f)).join(", ")}${report.missing.length ? ` (no take yet: ${report.missing.join(", ")})` : ""}`,
		);
		return report;
	}

	private async exportTimeline(
		format: InterchangeFormat,
		out: string | undefined,
		actor: Actor,
	): Promise<ExportReport> {
		const data = this.current;
		const target = out
			? path.resolve(this.projectDir, out)
			: path.join(this.projectDir, "export", `${slug(data.name)}${INTERCHANGE_EXTENSIONS[format]}`);
		let text: string;
		let skipped: string[] = [];
		if (format === "otio") text = toOtio(data, this.projectDir);
		else if (format === "fcpxml") text = toFcpxml(data, this.projectDir);
		else if (format === "mlt") text = toMlt(data, this.projectDir);
		else ({ text, skipped } = toEdl(data, this.projectDir));
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, text);
		this.log(
			actor,
			`Exported the timeline → ${path.basename(target)}${skipped.length ? ` (EDL leaves out: ${skipped.join(", ")})` : ""}`,
		);
		return { kind: format, outputs: [target], missing: skipped, durationMs: projectDuration(data) };
	}

	cacheDir(): string {
		return path.join(this.projectDir, CACHE_DIR);
	}

	// -------------------------------------------------------------------------

	private requireLine(id: string) {
		const line = this.current.lines.find((l) => l.id === id);
		if (!line) throw new Error(`No line "${id}".`);
		return line;
	}

	private touch(): void {
		this.revision++;
		this.dirty = true;
		this.emit("change");
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(
			() => void this.flush().catch((error) => this.emit("error", error)),
			400,
		);
	}

	private async findProjectIn(dir: string): Promise<string> {
		const entries = await fs.readdir(dir);
		const match = entries.find((entry) => isProjectFile(entry));
		if (!match) throw new Error(`No ${PROJECT_EXTENSION} file in ${dir}.`);
		return path.join(dir, match);
	}

	private async remember(): Promise<void> {
		if (!this.file || !this.data) return;
		const entry: RecentProject = {
			path: this.file,
			name: this.data.name,
			openedAt: new Date().toISOString(),
		};
		const list = [entry, ...(await this.recent()).filter((item) => item.path !== this.file)].slice(
			0,
			12,
		);
		await fs.mkdir(path.dirname(this.options.recentFile), { recursive: true });
		await fs.writeFile(this.options.recentFile, JSON.stringify(list, null, 2));
	}
}

/** Scale that makes a picture of one aspect ratio fill a frame of another. */
function cover(picture: number, frame: number): number {
	return Math.round(Math.max(picture / frame, frame / picture) * 1000) / 1000;
}

function slug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "project"
	);
}

function safeSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}
