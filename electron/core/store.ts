import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chunkCaptions } from "./ai";
import { AUTO_MIX_TARGETS, audioPreset, type MixRole, mixRole } from "./audio";
import { mp4Args, mp4Name, planPlacement, type TrackChoice } from "./capture";
import { autoZooms, type CursorPoint, cursorClips, onCanvas, smoothPath } from "./cursor";
import {
	type ExportReport,
	exportAudioMix,
	exportCaptions,
	exportGif,
	exportStems,
	exportVideo,
	exportVoiceover,
	type Loudness,
	measureLoudness,
	type Rasteriser,
} from "./exporter";
import { type HistoryEntry, ProjectHistory } from "./history";
import { dataCalloutTemplate, infographicTemplate } from "./infographics";
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
	type LibraryInfo,
	toEdl,
	toFcpxml,
	toMlt,
	toOtio,
} from "./interchange";
import { LAYOUTS, type LayoutKind, layoutTransforms } from "./layouts";
import { makePoster } from "./library";
import {
	analyseSpeech,
	computePeaks,
	detectSilences,
	extractThumbnails,
	ffmpeg,
	kindOf,
	makeAudioProxy,
	makeImageProxy,
	makeImageThumb,
	makeVideoProxy,
	PEAKS_PER_SECOND,
	PREVIEW_IMAGE_MAX,
	partFile,
	probe,
	toWav,
} from "./media";
import { type MontageSource, planMontage } from "./montage";
import { type LottieJson, motionDurationMs, motionInfo } from "./motion";
import { readMotionFile } from "./motionFile";
import { findLayer, layerAt, listLayers, moveLayer, updateLayer } from "./motionLayers";
import { compileMotion, type TextBox, textBoxes } from "./motionSpec";
import {
	buildTemplate,
	type FittedRegion,
	motionTemplate,
	templateRegions,
} from "./motionTemplates";
import { activeSequence, allSequences, applyOp, type InternalOp, type Op } from "./ops";
import { type PackageReport, packageProject } from "./packager";
import { relativeToProject, resolveInProject } from "./paths";
import {
	DEFAULT_TEXT_STYLE,
	deriveLines,
	emptyProject,
	isProjectFile,
	LEGACY_EXTENSION,
	type LineInput,
	newId,
	PROJECT_EXTENSION,
	parseProject,
	projectDuration,
} from "./project";
import { findMoved, isOffline } from "./relink";
import { planRoughCut } from "./roughcut";
import type { AiRuntime } from "./runtime";
import { parseSrt } from "./srt";
import type {
	ActivityEntry,
	Actor,
	Asset,
	Clip,
	DataCallout,
	DenoiseMode,
	Infographic,
	MediaClip,
	MediaInfo,
	MotionSource,
	ProjectData,
	ProjectSnapshot,
	Proposal,
	RecentProject,
} from "./types";
import { type Aspect, reframeData, shortenData, variantLabel } from "./variants";
import {
	analyseImages,
	cutOut,
	followKeyframes,
	labelsFor,
	type ShotSample,
	scoreShot,
	visionAvailable,
	visionVocabulary,
} from "./vision";

const HISTORY_LIMIT = 150;
const ACTIVITY_LIMIT = 200;
const CACHE_DIR = ".cue-cache";

/** A graphic made from a template and placed on the timeline: edit it with update_motion_graphic. */
export interface MadeGraphic {
	clipId: string;
	trackId: string;
	assetId: string;
	template: string;
	params: Record<string, unknown>;
}

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

type TextRenderer = Rasteriser;

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
			proxyUrls: Object.fromEntries(
				this.data.assets
					.filter(
						(a) =>
							(a.kind === "image" || this.data?.settings.useProxies) &&
							this.proxies.has(this.cacheKey(a.id)),
					)
					.map((a) => [a.id, this.options.mediaUrl(this.proxyPath(a.id))]),
			),
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

	private backfilling: Promise<void> | null = null;

	/**
	 * Reads codec, frame rate, bitrate and so on for media that doesn't have
	 * them yet (projects from before Cue kept them, recorded takes). Each file
	 * is probed once; the result is kept in the project, without an undo step.
	 */
	backfillInfo(): Promise<void> {
		this.backfilling ??= this.probeMissing().finally(() => {
			this.backfilling = null;
		});
		return this.backfilling;
	}

	private async probeMissing(): Promise<void> {
		const file = this.file;
		if (!this.data || !file) return;
		const offline = new Set(this.offline());
		const todo = this.data.assets.filter(
			(a) =>
				!a.info &&
				a.path &&
				!a.sequenceId &&
				a.kind !== "adjustment" &&
				a.kind !== "lottie" &&
				!offline.has(a.id),
		);
		if (!todo.length) return;
		const dir = this.projectDir;
		const infos: Record<string, MediaInfo> = {};
		const sizes: Record<string, number> = {};
		// A few at a time: quick for hundreds of files without starting hundreds of ffmpegs.
		for (let i = 0; i < todo.length; i += 4) {
			await Promise.all(
				todo.slice(i, i + 4).map(async (a) => {
					const resolved = resolveInProject(dir, a.path);
					try {
						const [probed, stat] = await Promise.all([probe(resolved), fs.stat(resolved)]);
						infos[a.id] = probed.info;
						if (a.size === undefined) sizes[a.id] = stat.size;
					} catch {
						// Unreadable files are marked as probed so they aren't retried on every open.
						infos[a.id] = { probedAt: new Date().toISOString() };
					}
				}),
			);
		}
		// The project may have been closed or switched while probing.
		if (this.file !== file || !this.data) return;
		const op = { type: "setMediaInfo" as const, infos, sizes };
		const withInfo = (d: ProjectData) => applyOp(d, op).data;
		this.data = withInfo(this.data);
		// Earlier states get the info too, so undoing past this point doesn't lose it.
		this.past = this.past.map(withInfo);
		this.future = this.future.map(withInfo);
		if (this.proposal) this.proposal.base = withInfo(this.proposal.base);
		this.touch();
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

	/**
	 * Adds a source-labelled chart as a motion graphic (bar, donut, line chart, key
	 * numbers or timeline template), placed at startMs; one undo step. Older
	 * projects keep their infographic text clips, which still draw.
	 */
	async addInfographic(
		input: Infographic & { startMs: number; durationMs?: number },
		actor: Actor,
	): Promise<MadeGraphic> {
		const { startMs, ...chart } = input;
		return this.addLegacyGraphic(infographicTemplate(chart), chart.title, startMs, actor);
	}

	/** Adds a point annotation as a callout motion graphic, placed at startMs; one undo step. */
	async addDataCallout(
		input: DataCallout & { startMs: number; durationMs?: number },
		actor: Actor,
	): Promise<MadeGraphic> {
		const { startMs, ...callout } = input;
		return this.addLegacyGraphic(dataCalloutTemplate(callout), callout.label, startMs, actor);
	}

	private async addLegacyGraphic(
		source: { template: string; params: Record<string, unknown> },
		name: string,
		startMs: number,
		actor: Actor,
	): Promise<MadeGraphic> {
		const { asset, clipId } = await this.createMotionGraphic(
			{ ...source, name, place: { startMs } },
			actor,
		);
		const clip = this.current.clips.find((c) => c.id === clipId);
		return {
			clipId: clipId as string,
			trackId: clip?.trackId as string,
			assetId: asset.id,
			template: source.template,
			params: source.params,
		};
	}

	/** Adds a shape, callout, blur or redact overlay in one undo step. */
	async addOverlay(
		input: {
			kind: "box" | "circle" | "arrow" | "line" | "callout" | "blur" | "redact";
			startMs: number;
			durationMs: number;
			x: number;
			y: number;
			width: number;
			height: number;
			color?: string;
			text?: string;
		},
		actor: Actor,
	): Promise<{ clipId: string; trackId: string }> {
		return this.transaction(actor, `Added a ${input.kind} overlay`, () => {
			const { kind, startMs, durationMs, x, y, width, height } = input;
			const color = input.color ?? (kind === "redact" ? "#000000" : "#ffd60a");
			if (kind === "blur") {
				const created =
					this.apply({ type: "addAdjustment", startMs, durationMs }, actor).created ?? [];
				const clipId = created.find((id) => this.current.clips.some((c) => c.id === id)) as string;
				this.apply(
					{
						type: "updateClip",
						id: clipId,
						patch: {
							name: "Blur box",
							effects: { blur: 0.9 },
							mask: {
								shape: "rectangle",
								x,
								y,
								width: Math.abs(width),
								height: Math.abs(height),
								feather: 0.02,
								invert: false,
							},
						},
					},
					actor,
				);
				const trackId = this.current.clips.find((c) => c.id === clipId)?.trackId as string;
				return { clipId, trackId };
			}
			// Graphics go on a "Graphics" text track that is free at that time, so each
			// overlay can be seen and picked on the timeline; another is made if needed.
			const end = startMs + durationMs;
			const free = (id: string) =>
				!this.current.clips.some(
					(c) => c.trackId === id && c.startMs < end && c.startMs + c.durationMs > startMs,
				);
			const graphics = this.current.tracks.filter(
				(t) => t.kind === "text" && /^Graphics/.test(t.name),
			);
			let trackId = graphics.find((t) => free(t.id))?.id;
			if (!trackId)
				trackId = this.apply(
					{
						type: "addTrack",
						kind: "text",
						name: graphics.length ? `Graphics ${graphics.length + 1}` : "Graphics",
						index: 0,
					},
					actor,
				).created?.[0] as string;
			const shape =
				kind === "circle"
					? { kind: "ellipse" as const, width, height, fill: null, stroke: color, strokeWidth: 8 }
					: kind === "arrow" || kind === "line"
						? {
								kind: kind as "arrow" | "line",
								width,
								height,
								fill: null,
								stroke: color,
								strokeWidth: 10,
							}
						: kind === "redact"
							? {
									kind: "rect" as const,
									width,
									height,
									fill: color,
									stroke: null,
									strokeWidth: 0,
									radius: 4,
								}
							: kind === "callout"
								? {
										kind: "rect" as const,
										width,
										height,
										fill: "rgba(12,12,14,0.82)",
										stroke: color,
										strokeWidth: 4,
										radius: 18,
									}
								: {
										kind: "rect" as const,
										width,
										height,
										fill: null,
										stroke: color,
										strokeWidth: 8,
										radius: 16,
									};
			const text = kind === "callout" ? (input.text ?? "Callout") : (input.text ?? "");
			const created = this.apply(
				{
					type: "addClips",
					clips: [
						{
							type: "text",
							trackId,
							startMs,
							durationMs,
							text,
							name: kind[0].toUpperCase() + kind.slice(1),
							shape,
							animationIn: kind === "redact" ? "none" : "pop",
							animationOut: kind === "redact" ? "none" : "fade",
							style: {
								x,
								y,
								background: null,
								fontSize: 44,
								fontWeight: 700,
								width: Math.max(0.1, Math.abs(width) - 0.02),
								shadow: false,
							},
						},
					],
				},
				actor,
			).created;
			return { clipId: created?.[0] as string, trackId };
		});
	}

	/**
	 * Arranges pictures on screen: side by side, stacked, a grid, or picture in
	 * picture. Split layouts fill areas left to right, top to bottom in the order
	 * given; for picture in picture the clip on the higher track is the small one.
	 */
	arrangeClips(layout: LayoutKind, clipIds: string[], actor: Actor) {
		const clips = clipIds.map((id) => {
			const clip = this.current.clips.find((c) => c.id === id);
			if (!clip || clip.type !== "media") throw new Error(`No picture clip "${id}".`);
			return { clip, asset: this.current.assets.find((a) => a.id === clip.assetId) };
		});
		const needed = LAYOUTS[layout].slots;
		if (clips.length > needed)
			throw new Error(
				`"${LAYOUTS[layout].label}" takes up to ${needed} clips; ${clips.length} were given.`,
			);
		const order = (id: string) => this.current.tracks.findIndex((t) => t.id === id);
		const placed = layout.startsWith("pip")
			? [...clips].sort((a, b) => order(b.clip.trackId) - order(a.clip.trackId))
			: clips;
		const patches = layoutTransforms(layout, placed, this.current.canvas);
		return this.transaction(
			actor,
			`Arranged ${clips.length} clip(s): ${LAYOUTS[layout].label.toLowerCase()}`,
			() => {
				for (const { id, transform } of patches)
					this.apply({ type: "updateClip", id, patch: { transform } }, actor);
				return { arranged: patches.map((p) => p.id) };
			},
		);
	}

	/**
	 * Keyframes that pan a clip so the main face stays in the middle of the frame
	 * (for a picture wider than the frame, e.g. a 16:9 shot in a 9:16 edit).
	 * Faces are found on this Mac with Apple's Vision framework.
	 */
	async faceKeyframes(
		clip: MediaClip,
		canvas: { width: number; height: number },
	): Promise<{ atMs: number; value: number }[]> {
		if (!visionAvailable())
			throw new Error(
				"Following faces uses Apple's Vision framework, which is only available in Cue for macOS.",
			);
		const asset = this.current.assets.find((a) => a.id === clip.assetId);
		if (!asset || asset.kind !== "video" || !asset.width || !asset.height)
			throw new Error("Following faces works on video clips.");
		const { width: W, height: H } = canvas;
		const ar = asset.width / asset.height;
		const span = (Math.min(W / ar, H) * ar * clip.transform.scale) / W;
		if (span <= 1.01)
			throw new Error(
				"The picture already fits the frame across, so there is nothing to pan. Reframe first (e.g. to 9:16).",
			);
		// One frame every 400 ms of the clip, small, from the part of the source it plays.
		const stepMs = Math.max(400, Math.ceil(clip.durationMs / 150));
		const dir = path.join(
			this.projectDir,
			CACHE_DIR,
			"faces",
			`${this.cacheKey(asset.id)}-${clip.inMs}-${clip.durationMs}`,
		);
		await fs.rm(dir, { recursive: true, force: true });
		await fs.mkdir(dir, { recursive: true });
		await ffmpeg([
			"-ss",
			(clip.inMs / 1000).toFixed(3),
			"-t",
			((clip.durationMs * clip.speed) / 1000).toFixed(3),
			"-i",
			this.assetPath(asset.id),
			"-an",
			"-vf",
			`fps=${(1000 / (stepMs * clip.speed)).toFixed(4)},scale=480:-2`,
			path.join(dir, "%04d.jpg"),
		]);
		const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
		const results = await analyseImages(
			files.map((f) => path.join(dir, f)),
			{ faces: true },
		);
		await fs.rm(dir, { recursive: true, force: true });
		const samples = results.map((r, i) => {
			// The biggest face is the one that matters.
			const face = [...(r.faces ?? [])].sort((a, b) => b.w * b.h - a.w * a.h)[0];
			return { atMs: i * stepMs, cx: face ? face.x + face.w / 2 : null };
		});
		if (!samples.some((s) => s.cx !== null)) throw new Error("No faces were found in that clip.");
		return followKeyframes(samples, span);
	}

	/** Pans a clip so it follows the main face (x keyframes, one undoable step). */
	async followFaces(clipId: string, actor: Actor): Promise<{ keyframes: number }> {
		const clip = this.current.clips.find((c) => c.id === clipId);
		if (!clip || clip.type !== "media") throw new Error(`No media clip "${clipId}".`);
		const keys = await this.faceKeyframes(clip, this.current.canvas);
		await this.transaction(actor, "Made the clip follow the face", () => {
			this.apply({ type: "clearKeyframes", clipId, prop: "x" }, actor);
			for (const k of keys)
				this.apply(
					{
						type: "setKeyframe",
						clipId,
						prop: "x",
						keyframe: { atMs: k.atMs, value: k.value, ease: "ease" },
					},
					actor,
				);
		});
		return { keyframes: keys.length };
	}

	/**
	 * What is in a video over time (or in a still): Vision's labels, text on
	 * screen and faces, sampled every two seconds on this Mac. Cached per file.
	 */
	async shotIndex(assetId: string): Promise<ShotSample[]> {
		const asset = this.current.assets.find((a) => a.id === assetId);
		if (!asset || (asset.kind !== "video" && asset.kind !== "image")) return [];
		// v2: weaker labels are kept too, so less obvious things (snow, fog) can be found.
		const cache = path.join(
			this.projectDir,
			CACHE_DIR,
			"shots",
			`${this.cacheKey(assetId)}.v2.json`,
		);
		try {
			return JSON.parse(await fs.readFile(cache, "utf8")) as ShotSample[];
		} catch {}
		const dir = `${cache}.frames`;
		await fs.rm(dir, { recursive: true, force: true });
		await fs.mkdir(dir, { recursive: true });
		const stepMs = asset.kind === "image" ? 0 : Math.max(2000, Math.ceil(asset.durationMs / 240));
		// Without on-device vision (Windows, Linux) only what is said can be searched:
		// empty samples along the file, not cached so a later run with vision fills them.
		if (!visionAvailable()) {
			const count = asset.kind === "image" ? 1 : Math.max(1, Math.ceil(asset.durationMs / stepMs));
			return Array.from({ length: count }, (_, i) => ({
				atMs: i * stepMs,
				labels: [],
				text: [],
				faces: 0,
			}));
		}
		await ffmpeg([
			"-i",
			this.assetPath(assetId),
			"-an",
			...(asset.kind === "image" ? ["-frames:v", "1"] : []),
			"-vf",
			`${asset.kind === "image" ? "" : `fps=${(1000 / stepMs).toFixed(4)},`}scale=512:-2`,
			path.join(dir, "%04d.jpg"),
		]);
		const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
		const results = await analyseImages(
			files.map((f) => path.join(dir, f)),
			{ faces: true, labels: true, text: true },
		);
		await fs.rm(dir, { recursive: true, force: true });
		const samples: ShotSample[] = results.map((r, i) => ({
			atMs: i * stepMs,
			labels: r.labels ?? [],
			text: r.text ?? [],
			faces: r.faces?.length ?? 0,
		}));
		await fs.writeFile(cache, JSON.stringify(samples));
		return samples;
	}

	/**
	 * Finds moments in the media by what they show, the text on screen or what
	 * is said there ("a dog on a beach", "the pricing slide"), all on this Mac.
	 * Neighbouring matching moments are joined into one range.
	 */
	/**
	 * Sentences describing each sampled frame of a media item, made once by a
	 * vision model (only when asked: the frames are sent to that model).
	 */
	private async shotCaptions(assetId: string, runtime: AiRuntime): Promise<string[]> {
		const asset = this.current.assets.find((a) => a.id === assetId);
		if (!asset) return [];
		const cache = path.join(
			this.projectDir,
			CACHE_DIR,
			"shots",
			`${this.cacheKey(assetId)}.captions.json`,
		);
		try {
			return JSON.parse(await fs.readFile(cache, "utf8")) as string[];
		} catch {}
		const samples = await this.shotIndex(assetId);
		const dir = `${cache}.frames`;
		await fs.rm(dir, { recursive: true, force: true });
		await fs.mkdir(dir, { recursive: true });
		const stepMs = samples[1] ? samples[1].atMs - samples[0].atMs : 0;
		await ffmpeg([
			"-i",
			this.assetPath(assetId),
			"-an",
			...(stepMs ? [] : ["-frames:v", "1"]),
			"-vf",
			`${stepMs ? `fps=${(1000 / stepMs).toFixed(4)},` : ""}scale=512:-2`,
			path.join(dir, "%04d.jpg"),
		]);
		const files = (await fs.readdir(dir))
			.filter((f) => f.endsWith(".jpg"))
			.sort()
			.slice(0, samples.length);
		const captions = await runtime.describeImages(files.map((f) => path.join(dir, f)));
		await fs.rm(dir, { recursive: true, force: true });
		await fs.writeFile(cache, JSON.stringify(captions));
		return captions;
	}

	/** Labels a model thinks match the query, from the classifier's vocabulary (cached per query). */
	private relatedLabels = new Map<string, Promise<string[]>>();

	private async widenQuery(query: string, runtime?: AiRuntime): Promise<string[]> {
		const vocab = await visionVocabulary();
		const direct = labelsFor(query, vocab);
		if (!runtime || !vocab.length) return direct;
		const key = query.toLowerCase().trim();
		let pending = this.relatedLabels.get(key);
		if (!pending) {
			pending = runtime
				.chat(
					"You map a video search to image-classifier labels. Reply with only a JSON array of up to 12 labels copied exactly from the list, the ones a frame matching the search would most likely get. No explanations.",
					`Search: ${query}\n\nLabels: ${vocab.join(", ")}`,
				)
				.then((text) => {
					const list = JSON.parse(
						text.slice(text.indexOf("["), text.lastIndexOf("]") + 1),
					) as string[];
					return list.filter((l) => vocab.includes(l));
				})
				.catch(() => []);
			this.relatedLabels.set(key, pending);
		}
		return [...new Set([...direct, ...(await pending)])];
	}

	async searchShots(
		query: string,
		options: {
			assetIds?: string[];
			limit?: number;
			/** A text model widens the search to related labels (cheap, no pictures sent). */
			runtime?: AiRuntime;
			/** Also describe frames with a vision model (sends small frames to it). */
			describe?: boolean;
		} = {},
	): Promise<
		{
			assetId: string;
			name: string;
			startMs: number;
			endMs: number;
			score: number;
			shows: string[];
			text: string[];
			caption?: string;
		}[]
	> {
		const assets = this.current.assets.filter(
			(a) =>
				(a.kind === "video" || a.kind === "image") &&
				!a.sequenceId &&
				(!options.assetIds || options.assetIds.includes(a.id)),
		);
		const found: Awaited<ReturnType<ProjectStore["searchShots"]>> = [];
		const related = await this.widenQuery(query, options.runtime);
		for (const asset of assets) {
			const samples = await this.shotIndex(asset.id);
			if (options.describe && options.runtime) {
				const captions = await this.shotCaptions(asset.id, options.runtime);
				samples.forEach((s, i) => {
					s.caption = captions[i];
				});
			}
			const step = samples[1] ? samples[1].atMs - samples[0].atMs : 2000;
			const words = asset.transcript?.words ?? [];
			let run: (typeof found)[number] | null = null;
			for (const s of samples) {
				const speech = words
					.filter((w) => w.startMs >= s.atMs - 2000 && w.startMs <= s.atMs + step)
					.map((w) => w.text)
					.join(" ");
				const score = scoreShot(query, s, speech, related);
				if (score < 0.5) {
					run = null;
					continue;
				}
				const shows = s.labels.slice(0, 4).map((l) => l.id.replace(/_/g, " "));
				if (run && s.atMs - run.endMs <= step) {
					run.endMs = Math.min(asset.durationMs || s.atMs + step, s.atMs + step);
					run.score = Math.max(run.score, score);
				} else {
					run = {
						assetId: asset.id,
						name: asset.name,
						startMs: s.atMs,
						endMs: asset.kind === "image" ? 0 : Math.min(asset.durationMs, s.atMs + step),
						score,
						shows,
						text: s.text.slice(0, 3),
						...(s.caption ? { caption: s.caption } : {}),
					};
					found.push(run);
				}
			}
		}
		return found.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 20);
	}

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

	/**
	 * Rough cut from a script: finds where each line was said in the
	 * transcribed media and lays those stretches out, in line order, in a new
	 * sequence. On device (word alignment), one undo step.
	 */
	async roughCut(
		actor: Actor,
		options: { lines?: string[]; assetIds?: string[]; name?: string; padMs?: number } = {},
	) {
		const data = this.current;
		const lines = (
			options.lines ?? [...data.lines].sort((a, b) => a.startMs - b.startMs).map((l) => l.text)
		)
			.map((l) => l.trim())
			.filter(Boolean);
		if (!lines.length)
			throw new Error("Pass the lines of the script or brief, or write a script first.");
		const media = options.assetIds
			? options.assetIds.map((id) => {
					const a = data.assets.find((x) => x.id === id);
					if (!a) throw new Error(`No media "${id}".`);
					return a;
				})
			: data.assets.filter((a) => (a.kind === "video" || a.kind === "audio") && a.hasAudio);
		const untranscribed = media.filter((a) => !a.transcript?.words.length);
		const sources = media
			.filter((a) => a.transcript?.words.length)
			.map((a) => ({
				assetId: a.id,
				words: a.transcript?.words ?? [],
				durationMs: a.durationMs,
			}));
		if (!sources.length)
			throw new Error(
				media.length
					? `Nothing is transcribed yet. Transcribe these first with transcribe_media: ${untranscribed.map((a) => a.name).join(", ")}.`
					: "There is no media with speech in this project.",
			);
		const plan = planRoughCut(lines, sources, { padMs: options.padMs ?? 150 });
		const found = plan.filter((p) => p.match);
		if (!found.length) throw new Error("None of the lines were found in the transcribed media.");
		const name = options.name ?? "Rough cut";
		return this.transaction(
			actor,
			`Rough cut "${name}": ${found.length} of ${lines.length} lines`,
			() => {
				const sequenceId = this.apply({ type: "newSequence", name }, actor).created?.[0] as string;
				const picture = this.current.tracks.find((t) => t.kind === "video")?.id as string;
				let sound: string | undefined;
				let at = 0;
				const placed = [];
				for (const { line, match } of plan) {
					if (!match) continue;
					const a = this.current.assets.find((x) => x.id === match.assetId) as Asset;
					let trackId = picture;
					if (a.kind === "audio") {
						sound ??= this.apply({ type: "addTrack", kind: "audio", name: "Dialogue" }, actor)
							.created?.[0];
						trackId = sound as string;
					}
					const durationMs = match.endMs - match.startMs;
					const clipId = this.apply(
						{
							type: "addClips",
							clips: [
								{
									type: "media",
									trackId,
									assetId: a.id,
									startMs: at,
									inMs: match.startMs,
									durationMs,
									name: line.slice(0, 120),
								},
							],
						},
						actor,
					).created?.[0];
					placed.push({ line, clipId, atMs: at, ...match });
					at += durationMs;
				}
				return {
					sequenceId,
					durationMs: at,
					placed,
					unmatched: plan.filter((p) => !p.match).map((p) => p.line),
					...(untranscribed.length
						? { notTranscribed: untranscribed.map((a) => ({ id: a.id, name: a.name })) }
						: {}),
				};
			},
		);
	}

	/**
	 * Music-driven montage: a new sequence with the music on an audio track and
	 * the pictures cut on its beats, cycling through the footage (fresh shots
	 * first). One undo step.
	 */
	async beatMontage(
		actor: Actor,
		options: {
			musicAssetId: string;
			assetIds?: string[];
			every?: number;
			lengthSec?: number;
			name?: string;
			zoomStills?: boolean;
		},
	) {
		const data = this.current;
		const music = data.assets.find((a) => a.id === options.musicAssetId);
		if (!music?.hasAudio) throw new Error("Pick music: a media item with sound.");
		const pictures = options.assetIds
			? options.assetIds.map((id) => {
					const a = data.assets.find((x) => x.id === id);
					if (!a) throw new Error(`No media "${id}".`);
					if (a.kind !== "video" && a.kind !== "image")
						throw new Error(`${a.name} has no picture.`);
					return a;
				})
			: data.assets.filter(
					(a) => (a.kind === "video" || a.kind === "image") && a.id !== music.id && !a.sequenceId,
				);
		if (!pictures.length) throw new Error("Import some video or pictures to cut to the music.");
		const { beats, bpm } = detectBeatsIn(await this.peaks(music.id), PEAKS_PER_SECOND);
		if (beats.length < 2) throw new Error(`No steady beat found in ${music.name}.`);
		// Shot changes let each cut start on a fresh shot; footage without them still works.
		const sources: MontageSource[] = await Promise.all(
			pictures.map(async (a) => ({
				assetId: a.id,
				kind: a.kind as "video" | "image",
				durationMs: a.durationMs,
				scenes: a.kind === "video" ? await this.sceneCuts(a.id).catch(() => []) : undefined,
			})),
		);
		const plan = planMontage({
			beats,
			musicDurationMs: music.durationMs,
			sources,
			every: options.every ?? 2,
			lengthMs: options.lengthSec ? options.lengthSec * 1000 : undefined,
		});
		const name = options.name ?? "Montage";
		return this.transaction(
			actor,
			`Montage "${name}": ${plan.clips.length} cuts at ${bpm} BPM`,
			() => {
				const sequenceId = this.apply({ type: "newSequence", name }, actor).created?.[0] as string;
				const picture = this.current.tracks.find((t) => t.kind === "video")?.id as string;
				const musicTrack = (
					this.current.tracks.find((t) => t.kind === "audio" && !t.voiceover) ??
					this.current.tracks.find((t) => t.kind === "audio")
				)?.id as string;
				this.apply(
					{
						type: "addClips",
						clips: [
							{
								type: "media",
								trackId: musicTrack,
								assetId: music.id,
								startMs: 0,
								inMs: plan.musicInMs,
								durationMs: plan.durationMs,
								fadeOutMs: Math.min(2000, Math.round(plan.durationMs / 4)),
							},
						],
					},
					actor,
				);
				const created =
					this.apply(
						{
							type: "addClips",
							clips: plan.clips.map((c) => ({
								type: "media" as const,
								trackId: picture,
								assetId: c.assetId,
								startMs: c.startMs,
								durationMs: c.durationMs,
								inMs: c.inMs,
								speed: c.speed,
								// The music carries the sound.
								volume: 0,
							})),
						},
						actor,
					).created ?? [];
				let zooms = 0;
				if (options.zoomStills !== false)
					plan.clips.forEach((c, i) => {
						if (c.kind !== "image" || !created[i]) return;
						// A gentle push-in keeps stills alive (Ken Burns).
						for (const [atMs, value] of [
							[0, 1],
							[c.durationMs, 1.08],
						])
							this.apply(
								{
									type: "setKeyframe",
									clipId: created[i],
									prop: "scale",
									keyframe: { atMs, value, ease: "linear" },
								},
								actor,
							);
						zooms++;
					});
				return {
					sequenceId,
					bpm,
					cuts: plan.clips.length,
					durationMs: plan.durationMs,
					stillsZoomed: zooms,
				};
			},
		);
	}

	/** Loudness of the whole mix as it would be exported (EBU R128). */
	async measureLoudness(renderText?: TextRenderer): Promise<Loudness> {
		await this.renderNested(renderText);
		return measureLoudness(this.exportContext(renderText));
	}

	/**
	 * Levels the mix: dialogue and voiceover tracks to about -16 LUFS, music and
	 * other beds 8 dB under them (and ducked under the voiceover). The voiceover
	 * gets the Voice preset when it has no EQ yet. One undo step.
	 */
	async autoMix(actor: Actor, renderText?: TextRenderer) {
		await this.renderNested(renderText);
		const data = this.current;
		const heard = data.tracks.filter(
			(t) =>
				t.kind !== "text" &&
				!t.muted &&
				!t.hidden &&
				data.clips.some(
					(c) =>
						c.type === "media" &&
						c.trackId === t.id &&
						!c.disabled &&
						data.assets.find((a) => a.id === c.assetId)?.hasAudio,
				),
		);
		if (heard.length === 0) throw new Error("Nothing is audible: add clips with sound first.");
		const voice = audioPreset("Voice");
		const plans = heard.map((track) => ({
			track,
			role: mixRole(data, track),
			preset: track.voiceover && !track.eq && voice ? voice : undefined,
		}));
		// Measure with the preset in place, since the compressor changes the level.
		const planned = {
			...data,
			tracks: data.tracks.map((t) => {
				const plan = plans.find((p) => p.track.id === t.id);
				return plan?.preset ? { ...t, eq: plan.preset.eq, compressor: plan.preset.compressor } : t;
			}),
		};
		const measured: (number | null)[] = [];
		for (const plan of plans)
			measured.push(
				(
					await measureLoudness(
						{ ...this.exportContext(renderText), data: planned },
						{ onlyTracks: new Set([plan.track.id]), preFader: true, normalize: false },
					)
				).integratedLufs,
			);
		const hasDialogue = plans.some((p, i) => p.role === "dialogue" && measured[i] !== null);
		const changes: {
			trackId: string;
			name: string;
			role: MixRole;
			measuredLufs: number | null;
			targetLufs: number;
			volume: { from: number; to: number };
			preset?: string;
			duck?: boolean;
		}[] = [];
		const patches: { id: string; patch: Record<string, unknown> }[] = [];
		plans.forEach((plan, i) => {
			const lufs = measured[i];
			const target =
				plan.role === "music" && hasDialogue ? AUTO_MIX_TARGETS.music : AUTO_MIX_TARGETS.dialogue;
			// The fader sits after the EQ and compressor, so loudness follows it in dB.
			const volume =
				lufs === null
					? plan.track.volume
					: Math.round(Math.min(2, Math.max(0.01, 10 ** ((target - lufs) / 20))) * 100) / 100;
			const duck = plan.role === "music" && hasDialogue && !plan.track.voiceover;
			const patch: Record<string, unknown> = { volume };
			if (plan.preset) {
				patch.eq = plan.preset.eq;
				patch.compressor = plan.preset.compressor;
			}
			if (duck && !plan.track.duck) patch.duck = true;
			patches.push({ id: plan.track.id, patch });
			changes.push({
				trackId: plan.track.id,
				name: plan.track.name,
				role: plan.role,
				measuredLufs: lufs === null ? null : Math.round(lufs * 10) / 10,
				targetLufs: target,
				volume: { from: plan.track.volume, to: volume },
				...(plan.preset ? { preset: plan.preset.name } : {}),
				...(duck ? { duck: true } : {}),
			});
		});
		const summary = `Auto-mixed ${changes.length} track(s)`;
		await this.transaction(actor, summary, () => {
			for (const { id, patch } of patches) this.apply({ type: "updateTrack", id, patch }, actor);
		});
		// Loudness above what the faders can reach (+6 dB) is left to export normalisation.
		const limited = changes.filter(
			(c) => c.measuredLufs !== null && c.volume.to >= 2 && c.measuredLufs + 6 < c.targetLufs - 0.5,
		);
		return {
			summary,
			tracks: changes,
			...(limited.length
				? {
						note: `${limited.map((c) => c.name).join(", ")} could only be raised 6 dB; turn on loudness normalisation or raise the clip volume.`,
					}
				: {}),
		};
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
			/** Pan to follow faces in the narrower shapes (on-device vision). */
			followFaces?: boolean;
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
				// Narrow shapes can follow the faces in wide shots instead of a fixed centre crop.
				if (aspect && options.followFaces && visionAvailable())
					for (const clip of data.clips) {
						if (clip.type !== "media" || clip.keyframes?.x?.length) continue;
						const keys = await this.faceKeyframes(clip, data.canvas).catch(() => []);
						for (const k of keys)
							data = applyOp(data, {
								type: "setKeyframe",
								clipId: clip.id,
								prop: "x",
								keyframe: { atMs: k.atMs, value: k.value, ease: "ease" },
							}).data;
					}
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
					const tmp = partFile(file, "mp4");
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

	/**
	 * Places another project (or one of its sequences) in this one as media, like
	 * a pre-composition shared between projects: it is rendered to a video in this
	 * project's cache and made again whenever that project changes (refreshProjectMedia).
	 */
	async addProjectMedia(
		file: string,
		options: { sequenceId?: string; place?: { trackId: string; startMs: number } },
		actor: Actor,
		renderText?: TextRenderer,
	): Promise<Asset> {
		const source = path.resolve(file);
		if (!isProjectFile(source)) throw new Error("Choose a Cue project (.cueproj).");
		if (source === this.file) throw new Error("A project cannot contain itself.");
		const other = parseProject(JSON.parse(await fs.readFile(source, "utf8")));
		const sequence = pickSequence(other, options.sequenceId);
		const render = await this.renderProjectMedia(source, sequence.id, renderText);
		const asset: Asset = {
			id: newId("a"),
			kind: "video",
			name: sequence.id === "main" ? other.name : `${other.name} · ${sequence.name}`,
			path: render.path,
			relPath: render.path,
			durationMs: render.durationMs,
			width: other.canvas.width,
			height: other.canvas.height,
			hasAudio: render.hasAudio,
			origin: "import",
			createdAt: new Date().toISOString(),
			actor,
			projectSource: { path: source, sequenceId: sequence.id, modifiedMs: render.modifiedMs },
		};
		this.apply({ type: "addAsset", asset, placeOn: options.place }, actor);
		return asset;
	}

	/**
	 * Renders again every project placed as media whose file changed since its
	 * render. Returns how many were updated. A missing source keeps its last render.
	 */
	async refreshProjectMedia(renderText?: TextRenderer): Promise<number> {
		let updated = 0;
		for (const asset of this.current.assets.filter((a) => a.projectSource)) {
			const src = asset.projectSource as NonNullable<Asset["projectSource"]>;
			const stat = await fs.stat(src.path).catch(() => null);
			if (!stat || Math.round(stat.mtimeMs) <= src.modifiedMs) continue;
			const render = await this.renderProjectMedia(src.path, src.sequenceId, renderText);
			// Pointing at a new render is housekeeping, not an edit: no undo step.
			let next = applyOp(this.current, {
				type: "updateAsset",
				id: asset.id,
				patch: {
					path: render.path,
					relPath: render.path,
					durationMs: render.durationMs,
					hasAudio: render.hasAudio,
					projectSource: { ...src, modifiedMs: render.modifiedMs },
				},
			}).data;
			if (asset.durationMs !== render.durationMs && asset.durationMs > 0)
				next = applyOp(next, {
					type: "fitNested",
					assetId: asset.id,
					fromMs: asset.durationMs,
					toMs: render.durationMs,
				}).data;
			this.data = next;
			this.touch();
			this.log("system", `Updated "${asset.name}" from its project`);
			updated++;
		}
		return updated;
	}

	/** Renders a project file (one sequence of it) into this project's cache. */
	private async renderProjectMedia(
		source: string,
		sequenceId: string | undefined,
		renderText?: TextRenderer,
	): Promise<{ path: string; durationMs: number; hasAudio: boolean; modifiedMs: number }> {
		const stat = await fs.stat(source);
		const other = parseProject(JSON.parse(await fs.readFile(source, "utf8")));
		const sequence = pickSequence(other, sequenceId);
		const data: ProjectData = {
			...other,
			tracks: sequence.tracks,
			clips: sequence.clips,
			markers: sequence.markers,
		};
		const durationMs = projectDuration(data);
		if (durationMs <= 0) throw new Error(`"${other.name}" has nothing on its timeline yet.`);
		const modifiedMs = Math.round(stat.mtimeMs);
		let hash = 0;
		const key = `${source}|${sequence.id}`;
		for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
		const file = path.join(
			this.projectDir,
			CACHE_DIR,
			"projects",
			`${(hash >>> 0).toString(36)}-${modifiedMs.toString(36)}.mp4`,
		);
		if (!existsSync(file)) {
			await fs.mkdir(path.dirname(file), { recursive: true });
			const tmp = partFile(file, "mp4");
			await exportVideo(
				{
					dir: path.dirname(source),
					data: {
						...data,
						export: { ...data.export, codec: "h264", videoQuality: "high", scale: 1 },
					},
					renderText,
				},
				tmp,
			);
			await fs.rename(tmp, file);
		}
		const hasAudio = sequence.clips.some((c) => {
			if (c.type !== "media" || c.disabled) return false;
			const a = other.assets.find((x) => x.id === c.assetId);
			return !!a?.hasAudio && c.volume > 0;
		});
		return { path: relativeToProject(this.projectDir, file), durationMs, hasAudio, modifiedMs };
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
		let target = stat.isDirectory() ? await this.findProjectIn(resolved) : resolved;
		const data = parseProject(JSON.parse(await fs.readFile(target, "utf8")));
		// Projects from before .cueproj (name.cue.json) take the project extension, so
		// Finder and Explorer show them as Cue projects and open them in Cue.
		let migratedFrom: string | null = null;
		if (target.endsWith(LEGACY_EXTENSION)) {
			const renamed = `${target.slice(0, -LEGACY_EXTENSION.length)}${PROJECT_EXTENSION}`;
			if (!existsSync(renamed)) {
				await fs.rename(target, renamed);
				migratedFrom = target;
				target = renamed;
			}
		}
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
		await this.remember(migratedFrom);
		this.log(actor, `Opened ${path.basename(target)}`);
		if (migratedFrom) {
			this.log(
				"system",
				`Renamed ${path.basename(migratedFrom)} to ${path.basename(target)}, the Cue project file type`,
			);
			this.emit("renamed", migratedFrom, target);
		}
		this.emit("change");
		this.history = new ProjectHistory(target);
		await this.history.load();
		// A project opened for the first time starts its history with how it is now.
		if (!this.history.last) this.record(actor, "Started the history", "start");
		await this.autoRelink();
		this.autoBuildProxies();
		this.refreshPoster();
		void this.backfillInfo();
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
		const image = this.data?.assets.find((a) => a.id === assetId)?.kind === "image";
		return path.join(
			this.projectDir,
			CACHE_DIR,
			"proxy",
			`${this.cacheKey(assetId)}.${image ? "png" : "mp4"}`,
		);
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
		if (!this.data) return 0;
		// Viewer copies of big pictures are always made; video proxies only with proxies on.
		const videos = this.data.settings.useProxies;
		const pending = this.data.assets.filter(
			(a) =>
				!a.sequenceId &&
				!this.proxies.has(this.cacheKey(a.id)) &&
				((videos && a.kind === "video" && (a.height > 720 || a.durationMs > 20000)) ||
					(a.kind === "image" && Math.max(a.width, a.height) > PREVIEW_IMAGE_MAX)),
		);
		for (const asset of pending) {
			this.proxyQueue = this.proxyQueue.then(async () => {
				const key = this.cacheKey(asset.id);
				if (!this.data?.assets.some((a) => a.id === asset.id) || this.proxies.has(key)) return;
				try {
					await (asset.kind === "image" ? makeImageProxy : makeVideoProxy)(
						this.assetPath(asset.id),
						this.proxyPath(asset.id),
					);
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

	/** Playback audio for an asset at a speed (extracted, time-stretched and/or denoised, cached). */
	audioProxy(assetId: string, speed: number, denoise: DenoiseMode = "off"): Promise<string> {
		const asset = this.current.assets.find((a) => a.id === assetId);
		if (!asset) return Promise.reject(new Error(`No media "${assetId}".`));
		const rounded = Math.round(speed * 1000) / 1000;
		if (
			rounded === 1 &&
			denoise === "off" &&
			asset.kind === "audio" &&
			/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(asset.path)
		)
			return Promise.resolve(this.assetPath(assetId));
		const key = `${this.cacheKey(assetId)}@${rounded}${denoise === "off" ? "" : `-${denoise}`}`;
		let pending = this.audioProxies.get(key);
		if (!pending) {
			const file = path.join(this.projectDir, CACHE_DIR, "audio", `${key}.m4a`);
			pending = existsSync(file)
				? Promise.resolve(file)
				: makeAudioProxy(this.assetPath(assetId), file, rounded, denoise).then(() => file);
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

	/**
	 * Packages the project with all its media into one zip to share or archive;
	 * `trim` cuts long video and audio down to what the edit uses (with handles).
	 */
	async packageProject(
		out: string,
		options: { trim?: boolean; extras?: Record<string, string> },
		actor: Actor,
		onProgress?: (fraction: number) => void,
	): Promise<PackageReport> {
		if (!this.file) throw new Error("No project is open.");
		await this.flush();
		const target = path.resolve(this.projectDir, out.endsWith(".zip") ? out : `${out}.zip`);
		const report = await packageProject({
			projectFile: this.file,
			data: this.current,
			out: target,
			trim: options.trim,
			extras: options.extras,
			onProgress,
		});
		this.log(
			actor,
			`Packaged the project with ${report.media} media file(s)${report.trimmed.length ? `, ${report.trimmed.length} trimmed` : ""} → ${path.basename(target)} (${(report.bytes / 1e6).toFixed(1)} MB)`,
		);
		return report;
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
		const library = new Map<string, LibraryInfo>();
		const collect = (stack: ImportedStack): void => {
			for (const t of stack.tracks)
				for (const c of t.clips) {
					if (c.type === "media" && c.library && !library.has(c.file))
						library.set(c.file, c.library);
					if (c.type === "nested") collect(c.timeline);
				}
		};
		collect(timeline);
		const missing = all.filter((f) => !existsSync(f));
		const counts = { clips: 0, sequences: 0 };
		await this.transaction(actor, `Imported ${path.basename(source)}`, async () => {
			const byPath = new Map(
				this.current.assets.map((a) => [resolveInProject(this.projectDir, a.path), a.id]),
			);
			const files = all.filter((f) => existsSync(f) && !byPath.has(f) && kindOf(f));
			for (const asset of await this.importMedia(files, actor)) {
				const resolved = resolveInProject(this.projectDir, asset.path);
				byPath.set(resolved, asset.id);
				// Media new to this project keeps the bin, tags and rating it had in Cue.
				const info = library.get(resolved);
				if (info) this.applyLibrary(asset.id, info, actor);
			}
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

	/** Files a media item in a bin (by path, creating bins as needed) and sets its tags, rating and note. */
	private applyLibrary(assetId: string, info: LibraryInfo, actor: Actor): void {
		if (info.bin) {
			const [top, sub] = info.bin.split(" › ").map((n) => n.trim().slice(0, 120));
			const find = (name: string, parentId?: string) =>
				(this.current.bins ?? []).find(
					(b) => b.parentId === parentId && b.name.toLowerCase() === name.toLowerCase(),
				)?.id;
			const binFor = (name: string, parentId?: string) =>
				find(name, parentId) ??
				this.apply({ type: "createBin", name, parentId }, actor).created?.[0];
			let binId = top ? binFor(top) : undefined;
			if (binId && sub) binId = binFor(sub, binId);
			if (binId) this.apply({ type: "moveMedia", assetIds: [assetId], binId }, actor);
		}
		if (info.tags?.length || info.rating || info.note)
			this.apply(
				{
					type: "tagMedia",
					assetIds: [assetId],
					add: info.tags,
					rating: info.rating || undefined,
					note: info.note,
				},
				actor,
			);
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
		// Takes, generated images and the like arrive without media info; read it in the background.
		if ((op.type === "addAsset" || op.type === "addTake") && !op.asset.info)
			void this.backfillInfo();
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
			if (kind === "lottie") {
				const asset = await this.motionAsset(resolved, actor);
				this.apply(
					{
						type: "addAsset",
						asset,
						placeOn: place ? { trackId: place.trackId, startMs: at } : undefined,
					},
					actor,
				);
				at += asset.durationMs;
				added.push(asset);
				continue;
			}
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
				info: info.info,
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

	/**
	 * A motion graphic (Lottie .json or .lottie) as media. The animation is saved as
	 * one self-contained JSON file in the project's graphics folder (pictures inside),
	 * so the project keeps working when the download folder is cleaned up.
	 */
	private async motionAsset(file: string, actor: Actor): Promise<Asset> {
		const json = await readMotionFile(file);
		return {
			id: newId("a"),
			kind: "lottie",
			name: path.basename(file),
			...(await this.writeMotion(json, path.parse(file).name)),
			hasAudio: false,
			origin: "import",
			createdAt: new Date().toISOString(),
			actor,
		};
	}

	/** Saves a Lottie document in the project's graphics folder; the asset fields that describe it. */
	private async writeMotion(json: LottieJson, name: string) {
		const info = motionInfo(json);
		const folder = path.join(this.projectDir, "graphics");
		await fs.mkdir(folder, { recursive: true });
		const base = safeSegment(name).slice(0, 60) || "graphic";
		let target = path.join(folder, `${base}.json`);
		for (let n = 2; existsSync(target); n++) target = path.join(folder, `${base}-${n}.json`);
		const text = JSON.stringify(json);
		await fs.writeFile(target, text);
		return {
			path: relativeToProject(this.projectDir, target),
			relPath: path.relative(this.projectDir, target),
			size: Buffer.byteLength(text),
			durationMs: motionDurationMs(info),
			width: Math.round(json.w),
			height: Math.round(json.h),
			motion: info,
		};
	}

	/** The spec a template (with parameters) or a written spec describes, at this project's size. */
	private motionSpecOf(source: MotionSource): unknown {
		const { width, height, fps } = this.current.canvas;
		if (source.template)
			return buildTemplate(source.template, source.params ?? {}, { width, height, fps });
		if (source.spec) return { width, height, fps, ...source.spec };
		throw new Error("Give a template (with params) or a spec.");
	}

	private compileSource(source: MotionSource): LottieJson {
		return compileMotion(this.motionSpecOf(source), {
			resolveImage: (src) => {
				try {
					const file = resolveInProject(this.projectDir, src);
					const ext = path.extname(file).slice(1).toLowerCase();
					const type = ext === "svg" ? "svg+xml" : ext === "jpg" ? "jpeg" : ext;
					return `data:image/${type};base64,${readFileSync(file).toString("base64")}`;
				} catch {
					return null;
				}
			},
		});
	}

	/**
	 * Makes a motion graphic from a template or a spec and adds it to the media.
	 * With a place, it goes on the timeline too: on the given track, or on the top
	 * picture track when that is free there (otherwise a new track above it).
	 * `atCutMs` centres a transition on a cut (its "cut" marker lands on it).
	 */
	async createMotionGraphic(
		input: MotionSource & {
			name?: string;
			place?: { trackId?: string; startMs?: number; durationMs?: number; atCutMs?: number };
		},
		actor: Actor,
	): Promise<{ asset: Asset; clipId?: string; regions?: FittedRegion[] }> {
		const source: MotionSource = input.template
			? { template: input.template, params: input.params ?? {} }
			: { spec: input.spec };
		const json = this.compileSource(source);
		const name =
			input.name ??
			(input.template ? motionTemplate(input.template).name : String(json.nm ?? "Graphic"));
		const asset: Asset = {
			id: newId("a"),
			kind: "lottie",
			name,
			...(await this.writeMotion(json, name)),
			hasAudio: false,
			origin: "generated",
			createdAt: new Date().toISOString(),
			motionSource: source,
			actor,
		};
		let clipId: string | undefined;
		await this.transaction(actor, `Made ${name}`, async () => {
			this.apply({ type: "addAsset", asset }, actor);
			const place = input.place;
			if (!place) return;
			const cut = asset.motion?.markers.find((m) => m.name === "cut");
			const startMs = Math.max(
				0,
				Math.round(
					place.atCutMs !== undefined
						? place.atCutMs - (cut?.startMs ?? asset.durationMs / 2)
						: (place.startMs ?? 0),
				),
			);
			const durationMs = Math.round(place.durationMs ?? asset.durationMs);
			let trackId = place.trackId;
			if (!trackId) {
				const top = this.current.tracks.find((t) => t.kind === "video" && !t.locked);
				const busy = top
					? this.current.clips.some(
							(c) =>
								c.trackId === top.id &&
								c.startMs < startMs + durationMs &&
								c.startMs + c.durationMs > startMs,
						)
					: true;
				trackId =
					top && !busy
						? top.id
						: (this.apply({ type: "addTrack", kind: "video", name: "Graphics", index: 0 }, actor)
								.created?.[0] as string);
			}
			const result = this.apply(
				{
					type: "addClips",
					clips: [{ type: "media", trackId, assetId: asset.id, startMs, durationMs, name }],
				},
				actor,
			);
			clipId = result.created?.[0];
		});
		return {
			asset: this.current.assets.find((a) => a.id === asset.id) ?? asset,
			clipId,
			// Device frames: where their see-through screens are, and how to fit footage under them.
			regions: templateRegions(source, this.current.canvas),
		};
	}

	/**
	 * Rebuilds a motion graphic made in Cue with new parameters (merged with the
	 * old ones) or a new spec. Clips using it show the new version; undo goes back.
	 */
	async updateMotionGraphic(
		assetId: string,
		change: { params?: Record<string, unknown>; spec?: Record<string, unknown>; template?: string },
		actor: Actor,
	): Promise<Asset> {
		const a = this.current.assets.find((x) => x.id === assetId);
		if (a?.kind !== "lottie") throw new Error(`No motion graphic "${assetId}".`);
		const old = a.motionSource;
		if (!old && !change.spec && !change.template)
			throw new Error(
				`${a.name} was imported, not made in Cue: give a spec or a template to replace it.`,
			);
		const source: MotionSource = change.spec
			? { spec: change.spec }
			: {
					template: change.template ?? old?.template,
					params:
						change.template && change.template !== old?.template
							? (change.params ?? {})
							: { ...old?.params, ...change.params },
				};
		const json = this.compileSource(source);
		const fields = await this.writeMotion(json, a.name);
		this.apply(
			{ type: "updateAsset", id: a.id, patch: { ...fields, motionSource: source } },
			actor,
		);
		return this.current.assets.find((x) => x.id === a.id) as Asset;
	}

	/** A motion graphic's source: its template and parameters, or its spec (built in full for templates). */
	motionGraphicSource(assetId: string): {
		source: MotionSource;
		spec: unknown;
		textBoxes: TextBox[];
		layers: { name: string; type: string; path: string }[];
	} {
		const a = this.current.assets.find((x) => x.id === assetId);
		if (!a?.motionSource) throw new Error(`"${assetId}" is not a motion graphic made in Cue.`);
		const spec = this.motionSpecOf(a.motionSource);
		const layers = listLayers(spec as Record<string, unknown>).map((r) => ({
			name: r.name,
			type: r.type,
			path: r.path.join("."),
		}));
		return { source: a.motionSource, spec, textBoxes: textBoxes(spec), layers };
	}

	/**
	 * Changes one layer of a motion graphic made in Cue, by name or path: sets or
	 * removes properties (null removes), moves it, or deletes it. A graphic made
	 * from a template becomes its own design (the template's fields stop applying).
	 */
	async editMotionLayer(
		assetId: string,
		edit: {
			layer: string;
			patch?: Record<string, unknown>;
			move?: { dx: number; dy: number };
			remove?: boolean;
		},
		actor: Actor,
	): Promise<{ asset: Asset; layer: string; path: string }> {
		const a = this.current.assets.find((x) => x.id === assetId);
		if (!a?.motionSource) throw new Error(`"${assetId}" is not a motion graphic made in Cue.`);
		let spec = this.motionSpecOf(a.motionSource) as Record<string, unknown>;
		const row = findLayer(spec, edit.layer);
		if (!row)
			throw new Error(
				`No layer "${edit.layer}". Layers: ${listLayers(spec)
					.map((r) => `${r.name} (${r.path.join(".")})`)
					.join(", ")}.`,
			);
		if (edit.remove) {
			const parent = row.path.slice(0, -1);
			const i = row.path[row.path.length - 1];
			const siblings = ((parent.length ? layerAt(spec, parent)?.layers : spec.layers) ??
				[]) as unknown[];
			const kept = siblings.filter((_, j) => j !== i);
			spec = parent.length
				? updateLayer(spec, parent, { layers: kept })
				: { ...spec, layers: kept };
		} else {
			if (edit.patch)
				spec = updateLayer(
					spec,
					row.path,
					Object.fromEntries(
						Object.entries(edit.patch).map(([k, v]) => [k, v === null ? undefined : v]),
					),
				);
			if (edit.move) spec = moveLayer(spec, row.path, edit.move.dx, edit.move.dy);
		}
		const asset = await this.updateMotionGraphic(assetId, { spec }, actor);
		return { asset, layer: row.name, path: row.path.join(".") };
	}

	/**
	 * Cuts the subject out of a picture (or a video frame at `atMs`) into a new
	 * image with transparency, with a paper-white outline and a soft shadow, as in
	 * collage-style explainers. Optionally placed on a track.
	 */
	async cutOutMedia(
		assetId: string,
		options: {
			atMs?: number;
			outline?: number;
			shadow?: number;
			place?: { trackId: string; startMs: number };
		},
		actor: Actor,
	): Promise<Asset> {
		const source = this.current.assets.find((a) => a.id === assetId);
		if (!source || (source.kind !== "image" && source.kind !== "video"))
			throw new Error(`"${assetId}" is not a picture or video.`);
		const folder = path.join(this.projectDir, "cutouts");
		await fs.mkdir(folder, { recursive: true });
		let input = this.assetPath(assetId);
		const base = safeSegment(path.parse(source.name).name).slice(0, 50) || "cutout";
		if (source.kind === "video") {
			const at = Math.max(0, Math.min(source.durationMs - 1, options.atMs ?? 0));
			input = path.join(folder, `${base}-${Math.round(at)}-frame.png`);
			await ffmpeg([
				"-ss",
				(at / 1000).toFixed(3),
				"-i",
				this.assetPath(assetId),
				"-frames:v",
				"1",
				"-y",
				input,
			]);
		}
		let output = path.join(folder, `${base}-cutout.png`);
		for (let n = 2; existsSync(output); n++) output = path.join(folder, `${base}-cutout-${n}.png`);
		await cutOut(input, output, { outline: options.outline ?? 12, shadow: options.shadow ?? 0.5 });
		const [asset] = await this.importMedia([output], actor, options.place);
		this.apply({ type: "renameAsset", id: asset.id, name: `${source.name} (cut out)` }, actor);
		return this.current.assets.find((a) => a.id === asset.id) ?? asset;
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

	/**
	 * Turns a finished screen or camera recording into media on the timeline:
	 * each WebM becomes an MP4 (for reliable seeking), and the clips go at `atMs`
	 * with the camera on the track above the screen, linked, and shown as a
	 * picture in picture bubble when asked. One undo step.
	 */
	async addScreenRecording(
		input: {
			main: string;
			overlay?: string;
			atMs: number;
			bubble: boolean;
			studio?: StudioLook;
		},
		actor: Actor,
	): Promise<{ assets: Asset[]; clipIds: string[] }> {
		const fps = this.current.canvas.fps;
		const converted: string[] = [];
		for (const raw of [input.main, input.overlay].filter((f): f is string => !!f)) {
			// Recorded without the pointer: already an MP4.
			if (/\.mp4$/i.test(raw)) {
				converted.push(raw);
				continue;
			}
			const out = mp4Name(raw);
			// Hardware encoding is much faster; x264 is the fallback where it isn't available.
			await ffmpeg(mp4Args(raw, out, { fps, hardware: process.platform === "darwin" })).catch(() =>
				ffmpeg(mp4Args(raw, out, { fps, hardware: false })),
			);
			await fs.rm(raw, { force: true });
			converted.push(out);
		}
		const assets: Asset[] = [];
		for (const file of converted) {
			const [info, stat] = await Promise.all([probe(file), fs.stat(file)]);
			if (!info.durationMs) throw new Error(`The recording ${path.basename(file)} is empty.`);
			assets.push({
				id: newId("a"),
				kind: "video",
				name: path.basename(file),
				path: relativeToProject(this.projectDir, file),
				relPath: path.relative(this.projectDir, file),
				size: stat.size,
				durationMs: info.durationMs,
				width: info.width,
				height: info.height,
				hasAudio: info.hasAudio,
				origin: "recording",
				createdAt: new Date().toISOString(),
				actor,
			});
		}
		const [main, overlay] = assets;
		const atMs = Math.max(0, Math.round(input.atMs));
		const studio = input.studio && !main.name.includes("camera") ? input.studio : undefined;
		// The studio's pictures are copied into the project, so it doesn't depend on the app's files.
		const still = async (file: string | null | undefined) => {
			if (!file) return undefined;
			const folder = path.join(this.projectDir, "recordings", "studio");
			const copy = path.join(folder, path.basename(file));
			const rel = path.relative(this.projectDir, copy);
			const known = this.current.assets.find((a) => a.relPath === rel);
			if (known) return known;
			await fs.mkdir(folder, { recursive: true });
			if (!existsSync(copy)) await fs.copyFile(file, copy);
			const info = await probe(copy);
			return {
				id: newId("a"),
				kind: "image",
				name: path.basename(copy),
				path: relativeToProject(this.projectDir, copy),
				relPath: rel,
				durationMs: 0,
				width: info.width,
				height: info.height,
				hasAudio: false,
				origin: "recording",
				createdAt: new Date().toISOString(),
				actor,
			} satisfies Asset as Asset;
		};
		const wallpaper = await still(studio?.wallpaper);
		const pointer = studio?.cursor ? await still(studio.cursor.image) : undefined;
		const summary = overlay
			? `Recorded the screen and camera (${(main.durationMs / 1000).toFixed(1)} s)`
			: `Recorded ${path.basename(main.path).includes("camera") ? "the camera" : "the screen"} (${(main.durationMs / 1000).toFixed(1)} s)`;
		const result = await this.transaction(actor, summary, () => {
			const plan = planPlacement(this.current.tracks, this.current.clips, atMs, {
				mainMs: main.durationMs,
				overlayMs: overlay?.durationMs,
			});
			const trackFor = (choice: TrackChoice) =>
				"trackId" in choice
					? choice.trackId
					: (this.apply({ type: "addTrack", kind: "video", index: choice.newTrackAt }, actor)
							.created?.[0] as string);
			const mainTrack = trackFor(plan.main);
			const overlayTrack = plan.overlay ? trackFor(plan.overlay) : undefined;
			const clipIds: string[] = [];
			for (const [asset, trackId] of [
				[main, mainTrack],
				[overlay, overlayTrack],
			] as const) {
				if (!asset || !trackId) continue;
				const created = this.apply(
					{ type: "addAsset", asset, placeOn: { trackId, startMs: atMs } },
					actor,
				).created;
				if (created?.[0]) clipIds.push(created[0]);
			}
			if (studio) {
				clipIds.push(
					...this.applyStudio(clipIds, studio, { wallpaper, pointer, bubble: input.bubble }, actor),
				);
				this.apply({ type: "groupClips", ids: clipIds }, actor);
			} else if (clipIds.length > 1) {
				this.apply({ type: "groupClips", ids: clipIds }, actor);
				if (input.bubble) {
					const placed = clipIds.map((id) => {
						const clip = this.current.clips.find((c) => c.id === id) as MediaClip;
						return { clip, asset: this.current.assets.find((a) => a.id === clip.assetId) };
					});
					// The screen fills the frame; the camera (on the track above) is the bubble.
					for (const { id, transform } of layoutTransforms("pip-br", placed, this.current.canvas))
						this.apply({ type: "updateClip", id, patch: { transform } }, actor);
				}
			}
			return { assets, clipIds };
		});
		this.autoBuildProxies();
		return result;
	}

	/**
	 * The studio look on a just-placed screen recording (`ids`: screen, then
	 * camera): the screen inset on a wallpaper with rounded corners and a shadow,
	 * zooms on the clicks, a smooth cursor drawn back over it, a ripple on each
	 * click and the camera as a round bubble. Returns the clips it added.
	 */
	private applyStudio(
		ids: string[],
		look: StudioLook,
		pictures: { wallpaper?: Asset; pointer?: Asset; bubble: boolean },
		actor: Actor,
	): string[] {
		for (const picture of [pictures.wallpaper, pictures.pointer])
			if (picture && !this.current.assets.some((a) => a.id === picture.id))
				this.apply({ type: "addAsset", asset: picture }, actor);
		const find = (id: string) => this.current.clips.find((c) => c.id === id) as MediaClip;
		const screen = find(ids[0]);
		const asset = this.current.assets.find((a) => a.id === screen.assetId) as Asset;
		const { width: W, height: H } = this.current.canvas;
		const indexOf = (trackId: string) => this.current.tracks.findIndex((t) => t.id === trackId);
		const added: string[] = [];
		const startMs = screen.startMs;
		const durationMs = screen.durationMs;

		// The screen, inset with rounded corners and a shadow.
		const inset = look.padding ?? 0.08;
		const scale = Math.round((1 - 2 * inset) * 1000) / 1000;
		this.apply(
			{
				type: "updateClip",
				id: screen.id,
				patch: {
					transform: { x: 0.5, y: 0.5, scale },
					frame: { radius: Math.round(H * 0.016), shadow: 0.6 },
				},
			},
			actor,
		);
		const zooms = look.zoom
			? autoZooms(look.clicks, durationMs).map((z) => {
					this.apply({ type: "addZoom", clipId: screen.id, ...z }, actor);
					return z;
				})
			: [];
		const placedZooms = find(screen.id).zooms ?? [];

		// The wallpaper, on a track of its own under the screen.
		if (pictures.wallpaper) {
			const track = this.apply(
				{ type: "addTrack", kind: "video", index: indexOf(screen.trackId) + 1, name: "Background" },
				actor,
			).created?.[0] as string;
			const a = pictures.wallpaper;
			const ar = a.width && a.height ? a.width / a.height : W / H;
			const cover = Math.max(W / H / ar, ar / (W / H));
			const [id] = this.apply(
				{
					type: "addClips",
					clips: [
						{
							type: "media",
							trackId: track,
							assetId: a.id,
							startMs,
							durationMs,
							transform: { scale: Math.round(cover * 1000) / 1000 },
							name: "Wallpaper",
						},
					],
				},
				actor,
			).created as string[];
			added.push(id);
		}

		// Where the screen sits on the canvas, for the cursor and the ripples.
		const ar = asset.width && asset.height ? asset.width / asset.height : W / H;
		const fit = Math.min(W / ar, H) * scale;
		const place = {
			width: (fit * ar) / W,
			height: fit / H,
			left: 0.5 - (fit * ar) / W / 2,
			top: 0.5 - fit / H / 2,
		};

		// The cursor, drawn back smooth and a little larger.
		if (pictures.pointer && look.cursor) {
			const track = this.apply(
				{ type: "addTrack", kind: "video", index: indexOf(screen.trackId), name: "Cursor" },
				actor,
			).created?.[0] as string;
			const path = smoothPath(look.path, durationMs, look.cursor.smoothing ?? 90);
			const clips = cursorClips(path, placedZooms, place, {
				size: 0.05 * (look.cursor.size ?? 1) * scale,
				image: CURSOR_IMAGE,
				aspect: W / H,
			});
			if (clips.length) {
				const created = this.apply(
					{
						type: "addClips",
						clips: clips.map((c) => ({
							type: "media" as const,
							trackId: track,
							assetId: (pictures.pointer as Asset).id,
							startMs: startMs + c.startMs,
							durationMs: c.durationMs,
							keyframes: c.keyframes,
							transform: {
								x: c.keyframes.x[0].value,
								y: c.keyframes.y[0].value,
								scale: c.keyframes.scale[0].value,
							},
							name: "Cursor",
						})),
					},
					actor,
				).created as string[];
				added.push(...created);
			}
		}

		// A ripple where each click lands.
		if (look.clickEffect && look.clicks.length) {
			const track = this.apply(
				{ type: "addTrack", kind: "text", index: indexOf(screen.trackId), name: "Clicks" },
				actor,
			).created?.[0] as string;
			const ring = 0.05 * scale;
			const created = this.apply(
				{
					type: "addClips",
					clips: look.clicks
						.filter((c) => c.atMs < durationMs - 100)
						.map((c) => {
							const at = onScreen(c, placedZooms, place);
							return {
								type: "text" as const,
								trackId: track,
								startMs: startMs + c.atMs,
								durationMs: Math.min(550, durationMs - c.atMs),
								text: "",
								style: { x: at.x, y: at.y },
								animationIn: "pop" as const,
								animationOut: "fade" as const,
								shape: {
									kind: "ellipse" as const,
									width: (ring * at.zoom * H) / W,
									height: ring * at.zoom,
									fill: "rgba(255,255,255,0.28)",
									stroke: "rgba(255,255,255,0.9)",
									strokeWidth: 4,
								},
								name: "Click",
							};
						}),
				},
				actor,
			).created as string[];
			added.push(...created);
		}

		// The camera as a round bubble in the corner.
		const camera = ids[1] ? find(ids[1]) : undefined;
		if (camera && pictures.bubble) {
			const cam = this.current.assets.find((a) => a.id === camera.assetId);
			const car = cam?.width && cam.height ? cam.width / cam.height : 16 / 9;
			const cfit = Math.min(W / car, H);
			const D = H * 0.26;
			const cs = car >= 1 ? D / cfit : D / (cfit * car);
			const side = car >= 1 ? (1 - 1 / car) / 2 : 0;
			const vert = car < 1 ? (1 - car) / 2 : 0;
			const margin = H * 0.045;
			this.apply(
				{
					type: "updateClip",
					id: camera.id,
					patch: {
						transform: {
							scale: Math.round(cs * 1000) / 1000,
							x: 1 - (margin + D / 2) / W,
							y: 1 - (margin + D / 2) / H,
							crop: { left: side, right: side, top: vert, bottom: vert },
						},
						frame: { radius: Math.round(D / 2), shadow: 0.6 },
					},
				},
				actor,
			);
		}
		void zooms;
		return added;
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

	/** Where the timeline's last clip ends. */
	timelineEndMs(): number {
		return this.current.clips.reduce((end, c) => Math.max(end, c.startMs + c.durationMs), 0);
	}

	/**
	 * Adds music (found or made) to the library with its credit or generation, and lays it
	 * on the music track (made if missing) with fades, ducked under the voiceover.
	 */
	async addMusic(
		file: string,
		actor: Actor,
		extra: {
			name: string;
			credit?: Asset["credit"];
			generation?: Asset["generation"];
			place?: {
				trackId?: string;
				startMs: number;
				durationMs?: number;
				fadeInMs: number;
				fadeOutMs: number;
			};
		},
	): Promise<{ asset: Asset; clipId?: string; trackId?: string }> {
		const [imported] = await this.importMedia([file], actor);
		if (!imported) throw new Error("Could not import the music.");
		const patch: Partial<Asset> = {
			name: extra.name,
			...(extra.credit ? { credit: extra.credit } : {}),
			...(extra.generation ? { generation: extra.generation, origin: "generated" as const } : {}),
		};
		this.apply({ type: "updateAsset", id: imported.id, patch }, actor);
		const asset = { ...imported, ...patch };
		const place = extra.place;
		if (!place) return { asset };
		let trackId = place.trackId;
		let clipId: string | undefined;
		await this.transaction(actor, `Placed ${extra.name}`, () => {
			if (!trackId) {
				const music = this.current.tracks.find(
					(t) => t.kind === "audio" && !t.voiceover && /music|score|bed/i.test(t.name),
				);
				trackId =
					music?.id ??
					(this.apply({ type: "addTrack", kind: "audio", name: "Music" }, actor)
						.created?.[0] as string);
			}
			this.apply({ type: "updateTrack", id: trackId, patch: { duck: true } }, actor);
			const durationMs = Math.min(asset.durationMs, place.durationMs ?? asset.durationMs);
			clipId = this.apply(
				{
					type: "addClips",
					clips: [
						{
							type: "media",
							trackId,
							assetId: asset.id,
							startMs: place.startMs,
							durationMs,
							fadeInMs: Math.min(place.fadeInMs, durationMs / 3),
							fadeOutMs: Math.min(place.fadeOutMs, durationMs / 3),
							name: extra.name,
						},
					],
				},
				actor,
			).created?.[0];
		});
		return { asset, clipId, trackId };
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
		const tmp = path.join(
			os.tmpdir(),
			`cue-captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
		);
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
		if (!asset || (asset.kind !== "video" && asset.kind !== "image"))
			return { intervalMs: 0, urls: [] };
		const dir = path.join(this.projectDir, CACHE_DIR, "thumbs", this.cacheKey(assetId));
		if (asset.kind === "image") {
			const file = path.join(dir, "thumb.png");
			if (!existsSync(file)) await makeImageThumb(this.assetPath(assetId), file);
			return { intervalMs: 0, urls: [this.options.mediaUrl(file)] };
		}
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
		onProgress?: (fraction: number) => void,
	): Promise<ExportReport> {
		if (kind === "edl") await this.renderNested(renderText);
		if (kind === "otio" || kind === "fcpxml" || kind === "mlt" || kind === "edl")
			return this.exportTimeline(kind, out, actor);
		// Nested sequences must be up to date before they are used in an export.
		if (kind === "video" || kind === "gif" || kind === "audio") {
			await this.refreshProjectMedia(renderText);
			await this.renderNested(renderText);
		}
		const ctx = { ...this.exportContext(renderText), range, onProgress };
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

	/** Puts the open project first in the recent list (replacing `previousPath` after a rename). */
	private async remember(previousPath: string | null = null): Promise<void> {
		if (!this.file || !this.data) return;
		const entry: RecentProject = {
			path: this.file,
			name: this.data.name,
			openedAt: new Date().toISOString(),
		};
		const list = [
			entry,
			...(await this.recent()).filter(
				(item) => item.path !== this.file && item.path !== previousPath,
			),
		].slice(0, 12);
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

/** The cursor image in resources/studio: its size and where the tip is, in pixels. */
const CURSOR_IMAGE = { size: 80, tipX: 7.5, tipY: 1.5 };

/** Where a click shows on the canvas, through the zoom at that moment. */
function onScreen(
	p: CursorPoint,
	zooms: import("./types").Zoom[],
	place: { left: number; top: number; width: number; height: number },
) {
	return onCanvas(p, p.atMs, zooms, place);
}

/** The Recordly-style look for a screen recording, with the pointer as recorded. */
export interface StudioLook {
	/** A picture behind the screen (absolute path), or null for the canvas colour. */
	wallpaper: string | null;
	/** Space around the screen, as a share of the frame on each side. */
	padding?: number;
	/** Zoom in where the clicks are. */
	zoom: boolean;
	/** Draw the pointer back as a smooth cursor (the real one is left out of the recording). */
	cursor: { image: string; size?: number; smoothing?: number } | null;
	/** A ripple on each click. */
	clickEffect: boolean;
	/** The pointer, in recording time and shares of the recorded area. */
	path: CursorPoint[];
	clicks: CursorPoint[];
}

/** The sequence of a project to use: the one asked for, else its main timeline. */
function pickSequence(data: ProjectData, id?: string) {
	const all = allSequences(data);
	const found = id ? all.find((q) => q.id === id) : (all.find((q) => q.id === "main") ?? all[0]);
	if (!found)
		throw new Error(
			`No sequence "${id}" in "${data.name}". Sequences: ${all.map((q) => `${q.id} (${q.name})`).join(", ")}.`,
		);
	return found;
}
