import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { type MethodInput, type MethodName, parseInput } from "./control/contract";
import { AGENT_GUIDE } from "./control/guide";
import { MOTION_GUIDE } from "./control/motionGuide";
import { findLibraryAsset, LIBRARY_ASSETS, materializeLibraryAsset } from "./core/assetLibrary";
import { binPath, filterMedia, mediaUses, usedAssetIds } from "./core/bins";
import {
	type CaptureSources,
	checkCaptureOptions,
	DEFAULT_STUDIO,
	recordingFiles,
	type StudioChoice,
} from "./core/capture";
import {
	type CursorEvent,
	normalise,
	type RecordingClock,
	type Rect,
	recordCursor,
	studioDir,
} from "./core/cursor";
import type { Rasteriser } from "./core/exporter";
import { scanProjects, summarise } from "./core/library";
import { ffmpeg } from "./core/media";
import { describeParams, MOTION_TEMPLATES, MOTION_THEMES } from "./core/motionTemplates";
import { reviewEdit } from "./core/notes";
import { activeSequence, allSequences } from "./core/ops";
import { clipEnd, DEFAULT_TEXT_STYLE, type LineInput, speechOf } from "./core/project";
import {
	BUILT_IN_RECIPES,
	loadRecipes,
	type Recipe,
	recipeContext,
	recipeId,
	recipeSchema,
	resolveRecipe,
	saveRecipes,
} from "./core/recipes";
import type { AiRuntime } from "./core/runtime";
import { type NativeCapture, nativeMp4Args, startNativeCapture } from "./core/screenrec";
import { parseSrt } from "./core/srt";
import type { ProjectStore } from "./core/store";
import { TITLE_TEMPLATES } from "./core/titles";
import type {
	Actor,
	AgentStatus,
	AppState,
	Asset,
	EditorCommand,
	JobStatus,
	LineView,
	ProjectSummary,
	RecentProject,
	RecorderStatus,
} from "./core/types";

/** Calls that only read, so they never wait for a transaction. */
const READ_ONLY =
	/^(get_|list_|render_frame$|inspect_edit$|search_|find_moments$|review_edit$|focus_window$|pause$|seek$|play$)/;

/** File types each kind of output may have, for paths chosen by an agent. */
const OUTPUT_TYPES: Record<string, string[]> = {
	video: [".mp4", ".mov", ".m4v", ".mkv", ".webm"],
	audio: [".wav", ".m4a", ".mp3", ".aac", ".flac"],
	voiceover: [".wav", ".m4a", ".mp3", ".aac", ".flac"],
	captions: [".srt", ".vtt"],
	otio: [".otio"],
	fcpxml: [".fcpxml"],
	mlt: [".mlt"],
	edl: [".edl"],
	frame: [".png"],
	gif: [".gif"],
	project: [".cueproj"],
};

/**
 * Checks where an agent wants to write. Agents may create new files anywhere
 * (with the right file type) and overwrite files only in the project's export
 * folder, so a tool call can never replace media, projects or documents.
 */
async function checkAgentOutput(
	target: string,
	projectDir: string,
	kind: string,
	folderOk = false,
): Promise<void> {
	const stat = await fs.stat(target).catch(() => null);
	const inExports = !path.relative(path.join(projectDir, "export"), target).startsWith("..");
	if (stat?.isDirectory()) {
		if (folderOk && !path.relative(projectDir, target).startsWith("..")) return;
		throw new Error(`Agents can only write into folders inside the project: ${target}`);
	}
	const types = OUTPUT_TYPES[kind];
	if (!folderOk && types && !types.includes(path.extname(target).toLowerCase()))
		throw new Error(`A ${kind} output must end in ${types.join(", ")}: ${target}`);
	if (stat && !inExports)
		throw new Error(
			`${target} already exists. Agents only overwrite files in the project's export folder; choose a new name.`,
		);
}

interface PendingRecording {
	lineId: string;
	resolve: (take: Asset) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

/** A screen or camera recording being written: chunks stream in from the window. */
interface CaptureSession {
	id: string;
	files: { main: string; overlay?: string };
	handles: { main: fs.FileHandle; overlay?: fs.FileHandle };
	/** Writes happen in order, one after another. */
	writing: Promise<void>;
	actor: Actor;
	/** The pointer, recorded for the studio look. */
	cursor?: { stop: () => Promise<CursorEvent[]>; region: Rect | null };
	/** The screen, recorded without the pointer (the window then records only the microphone). */
	native?: NativeCapture;
}

/** What a finished recording became, for agents. */
export interface CaptureResult {
	media: { id: string; name: string; durationMs: number; size: string }[];
	clips: { id: string; trackId: string; startMs: number; durationMs: number; role: string }[];
}

export interface ControllerHooks {
	sendCommand: (command: EditorCommand) => boolean;
	focusWindow: () => void;
	/** Rasterise text clips and motion graphics to PNGs (editor window). */
	renderText: Rasteriser;
	/** PNG of the preview at a moment (editor window). */
	captureFrame: (atMs: number) => Promise<string>;
	/** The generative runtime built from app settings, keys and local models. */
	runtime: () => Promise<AiRuntime>;
	/** Read and change app-wide settings (never secrets or agent access). */
	appSettings?: { get: () => unknown; set: (patch: Record<string, unknown>) => Promise<unknown> };
	/** The folder new projects go in (app setting). */
	projectsDir?: () => string;
	/** Screens, windows, cameras and microphones, and the macOS permissions for them. */
	captureSources?: () => Promise<CaptureSources>;
	/** Where user recipes are kept (app data). Without it only built-in recipes exist. */
	recipesFile?: string;
}

/**
 * Where editor state lives and every action is implemented. The editor window
 * (actor "user") and the control server (actor "agent") both call `call()`.
 */
export class Controller extends EventEmitter {
	selectedLineId: string | null = null;
	selectedClipIds: string[] = [];
	recorder: RecorderStatus = {
		uiReady: false,
		micReady: false,
		recordingLineId: null,
		playing: false,
		currentMs: 0,
	};
	agent: AgentStatus = { connected: false, lastSeenAt: null, requests: 0, controlPort: null };
	aiConfigured = false;
	aiStatus: import("./core/runtime").ProviderStatus[] = [];
	private recent: RecentProject[] = [];
	private jobs: JobStatus[] = [];
	private pending = new Map<string, PendingRecording>();
	private capture: CaptureSession | null = null;
	/** An agent's record_screen, waiting for the window to start recording. */
	private captureStart: {
		requestId: string;
		resolve: () => void;
		reject: (error: Error) => void;
	} | null = null;
	/** The import after a recording stops; stop_screen_recording waits for it. */
	private captureImport: Promise<CaptureResult> | null = null;
	/** Resolved when the next recording has been imported (or failed). */
	private captureWaiters: { resolve: (r: CaptureResult) => void; reject: (e: Error) => void }[] =
		[];
	/** The last finished recording, for a stop_screen_recording that comes after maxSeconds. */
	private lastCapture: CaptureResult | null = null;
	private seq = 0;

	constructor(
		readonly store: ProjectStore,
		private readonly hooks: ControllerHooks,
	) {
		super();
		store.on("change", () => this.changed());
		store.on("activity", () => this.changed());
		void this.refreshRecent();
		void this.refreshAi();
	}

	/** The editor's state; without the project (which is large) when the window already has it. */
	state(withProject = true): AppState {
		return {
			project: withProject ? this.store.snapshot() : null,
			selectedLineId: this.selectedLineId,
			selectedClipIds: this.selectedClipIds,
			recorder: this.recorder,
			agent: this.agent,
			activity: this.store.getActivity().slice(0, 80),
			recent: this.recent,
			jobs: this.jobs,
			ai: {
				configured: this.aiConfigured,
				provider: this.aiConfigured ? "openai" : null,
				status: this.aiStatus,
			},
		};
	}

	changed(): void {
		this.emit("state");
	}

	async refreshAi(): Promise<void> {
		const runtime = await this.hooks.runtime();
		this.aiStatus = runtime.status();
		this.aiConfigured = this.aiStatus.some((s) => s.ready);
		this.changed();
	}

	noteAgentRequest(): void {
		this.agent = {
			...this.agent,
			connected: true,
			lastSeenAt: new Date().toISOString(),
			requests: this.agent.requests + 1,
		};
		this.changed();
	}

	updateRecorder(patch: Partial<RecorderStatus>): void {
		const before = this.recorder;
		this.recorder = { ...before, ...patch };
		// The playhead position is only for agents asking for it; don't rebroadcast state for it.
		const meaningful = (Object.keys(patch) as (keyof RecorderStatus)[]).some(
			(k) =>
				k !== "currentMs" &&
				k !== "playing" &&
				k !== "inMs" &&
				k !== "outMs" &&
				k !== "panel" &&
				before[k] !== patch[k],
		);
		if (meaningful) this.changed();
	}

	selectClips(ids: string[]): void {
		this.selectedClipIds = ids;
		this.changed();
	}

	/** Called by the editor window when a recording finishes. */
	async saveRecording(input: {
		lineId: string;
		audio: Buffer;
		extension: string;
		recordedAtMs: number;
		requestId?: string;
	}): Promise<Asset> {
		const pending = input.requestId ? this.pending.get(input.requestId) : undefined;
		const settle = (fn: () => void) => {
			if (pending && input.requestId) {
				clearTimeout(pending.timer);
				this.pending.delete(input.requestId);
				fn();
			}
		};
		try {
			const take = await this.store.addRecording({ ...input, actor: pending ? "agent" : "user" });
			settle(() => pending?.resolve(take));
			return take;
		} catch (error) {
			settle(() => pending?.reject(error as Error));
			throw error;
		}
	}

	failRecording(requestId: string, message: string): void {
		const pending = this.pending.get(requestId);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(requestId);
		pending.reject(new Error(message));
	}

	/** The window is about to record: opens the files its chunks are written to. */
	async beginCapture(input: {
		screen: boolean;
		camera: boolean;
		requestId?: string;
		/** Record the pointer too (for the studio look): the screen's bounds, or a window's id. */
		cursor?: { region: Rect | null; windowId?: number; displayId?: number; pointer?: boolean };
		/** Record the screen here (ScreenCaptureKit) instead of in the window; the pointer only if asked. */
		native?: { showCursor: boolean };
	}): Promise<{ id: string; files: { main: string; overlay?: string }; native: boolean }> {
		if (!this.store.isOpen) throw new Error("Open a project first.");
		if (this.capture) throw new Error("A recording is already running.");
		const named = recordingFiles(this.store.projectDir, new Date(), input, existsSync);
		const main = named.screen ?? named.camera;
		if (!main) throw new Error("Choose a screen or window, or turn the camera on.");
		const files = { main, overlay: named.screen ? named.camera : undefined };
		await fs.mkdir(path.dirname(main), { recursive: true });
		const handles = {
			main: await fs.open(files.main, "w"),
			overlay: files.overlay ? await fs.open(files.overlay, "w") : undefined,
		};
		const agentStart =
			input.requestId && this.captureStart?.requestId === input.requestId
				? this.captureStart
				: null;
		this.capture = {
			id: `s${++this.seq}`,
			files,
			handles,
			writing: Promise.resolve(),
			actor: agentStart ? "agent" : "user",
		};
		const session = this.capture;
		if (input.native && input.screen && input.cursor) {
			try {
				session.native = await startNativeCapture(
					{ ...input.cursor, showCursor: input.native.showCursor },
					files.main.replace(/\.webm$/i, ".native.mov"),
					this.store.current.canvas.fps,
				);
			} catch (error) {
				// The window records the screen instead (screen sharing, with the pointer).
				this.store.log(
					"system",
					`Recording without the pointer failed: ${(error as Error).message}`,
				);
			}
		}
		if (input.cursor?.pointer && input.screen) {
			const recorder = recordCursor(input.cursor.windowId);
			if (recorder) session.cursor = { ...recorder, region: input.cursor.region };
		}
		this.lastCapture = null;
		this.updateRecorder({ capturing: true });
		// An agent's record_screen returns once the screen is really being recorded.
		if (agentStart) {
			this.captureStart = null;
			agentStart.resolve();
		}
		return { id: session.id, files, native: !!session.native };
	}

	/** Pauses or resumes the part of a recording made here (the screen without the pointer). */
	pauseCapture(id: string, paused: boolean): void {
		const native = this.capture?.id === id ? this.capture.native : undefined;
		if (paused) native?.pause();
		else native?.resume();
	}

	/** A piece of a recording from the window's MediaRecorder. */
	writeCapture(id: string, part: "main" | "overlay", data: Buffer): Promise<void> {
		const session = this.capture;
		if (!session || session.id !== id) return Promise.reject(new Error("No recording is running."));
		const handle = session.handles[part];
		if (!handle) return Promise.resolve();
		session.writing = session.writing.then(async () => {
			await handle.write(data);
		});
		return session.writing;
	}

	/** The window stopped recording: convert, import and place the result. */
	finishCapture(
		id: string,
		input: {
			atMs: number;
			bubble: boolean;
			clock?: RecordingClock;
			studio?: StudioChoice | null;
		},
	): Promise<CaptureResult> {
		const session = this.capture;
		if (!session || session.id !== id) return Promise.reject(new Error("No recording is running."));
		this.capture = null;
		const waiters = this.captureWaiters;
		this.captureWaiters = [];
		const run = async (): Promise<CaptureResult> => {
			await session.writing;
			await session.handles.main.close();
			await session.handles.overlay?.close();
			const events = (await session.cursor?.stop()) ?? [];
			let main = session.files.main;
			if (session.native) {
				// The movie and the microphone (if any) become the screen's MP4, starting when the window started.
				await session.native.stop();
				const mic = (await fs.stat(main).catch(() => null))?.size ? main : undefined;
				const output = main.replace(/\.webm$/i, ".mp4");
				const args = (hardware: boolean) =>
					nativeMp4Args({
						video: (session.native as NativeCapture).file,
						audio: mic,
						trimMs: input.clock
							? input.clock.startedAt - (session.native as NativeCapture).startedAt
							: 0,
						output,
						fps: this.store.current.canvas.fps,
						hardware,
					});
				await ffmpeg(args(true)).catch(() => ffmpeg(args(false)));
				await fs.rm(session.native.file, { force: true });
				await fs.rm(main, { force: true });
				main = output;
			}
			const dir = studioDir();
			const choice = input.studio;
			const pointer =
				input.clock && session.cursor
					? normalise(events, input.clock, session.cursor.region)
					: { path: [], clicks: [] };
			const studio =
				choice && dir && !/camera\.webm$/.test(session.files.main)
					? {
							wallpaper:
								choice.wallpaper === "none" ? null : path.join(dir, `${choice.wallpaper}.jpg`),
							zoom: choice.zoom && pointer.clicks.length > 0,
							cursor:
								choice.cursor && pointer.path.length
									? { image: path.join(dir, "cursor.png"), size: choice.cursorSize }
									: null,
							clickEffect: choice.clickEffect,
							path: pointer.path,
							clicks: pointer.clicks,
						}
					: undefined;
			const { assets, clipIds } = await this.job("Importing the recording", () =>
				this.store.addScreenRecording(
					{ ...session.files, main, atMs: input.atMs, bubble: input.bubble, studio },
					session.actor,
				),
			);
			const roles = session.files.overlay
				? ["screen", "camera"]
				: [/camera\.webm$/.test(session.files.main) ? "camera" : "screen"];
			return {
				media: assets.map((a) => ({
					id: a.id,
					name: a.name,
					durationMs: a.durationMs,
					size: `${a.width}x${a.height}`,
				})),
				clips: clipIds.flatMap((clipId, i) => {
					const c = this.store.current.clips.find((x) => x.id === clipId);
					return c
						? [
								{
									id: c.id,
									trackId: c.trackId,
									startMs: c.startMs,
									durationMs: c.durationMs,
									// The studio's extra clips are named Wallpaper, Cursor and Click.
									role: roles[i] ?? c.name?.toLowerCase() ?? "studio",
								},
							]
						: [];
				}),
			};
		};
		const imported = run();
		this.captureImport = imported;
		imported.then(
			(result) => {
				this.lastCapture = result;
				for (const w of waiters) w.resolve(result);
			},
			(error: Error) => {
				for (const w of waiters) w.reject(error);
			},
		);
		void imported
			.catch(() => {})
			.finally(() => {
				if (this.captureImport === imported) this.captureImport = null;
				this.updateRecorder({ capturing: false });
			});
		return imported;
	}

	/** Drops whatever is being recorded (the window closed). */
	abortCapture(message: string): Promise<void> {
		return this.cancelCapture(this.capture?.id ?? null, message);
	}

	/** The recording failed or was cancelled: nothing is kept. */
	async cancelCapture(id: string | null, message: string, requestId?: string): Promise<void> {
		const error = new Error(message);
		if (this.captureStart && (!requestId || this.captureStart.requestId === requestId)) {
			this.captureStart.reject(error);
			this.captureStart = null;
		}
		const session = id && this.capture?.id === id ? this.capture : null;
		if (!session) return;
		this.capture = null;
		for (const w of this.captureWaiters) w.reject(error);
		this.captureWaiters = [];
		this.updateRecorder({ capturing: false });
		void session.cursor?.stop();
		if (session.native) {
			session.native.kill();
			await fs.rm(session.native.file, { force: true }).catch(() => {});
		}
		await session.writing.catch(() => {});
		await session.handles.main.close().catch(() => {});
		await session.handles.overlay?.close().catch(() => {});
		await fs.rm(session.files.main, { force: true });
		if (session.files.overlay) await fs.rm(session.files.overlay, { force: true });
	}

	async call(method: MethodName, params: unknown, actor: Actor): Promise<unknown> {
		// Edits wait for a running transaction (an import, a freeze frame) to finish.
		if (!READ_ONLY.test(method)) await this.store.settled();
		switch (method) {
			case "get_state":
				return this.describeState();
			case "get_timeline": {
				const { fromMs, toMs, trackId } = parseInput("get_timeline", params);
				return this.store.current.clips
					.filter(
						(c) =>
							(!trackId || c.trackId === trackId) &&
							(fromMs === undefined || clipEnd(c) > fromMs) &&
							(toMs === undefined || c.startMs < toMs),
					)
					.sort((a, b) => a.startMs - b.startMs);
			}
			case "render_frame": {
				const { atMs } = parseInput("render_frame", params);
				return { png: await this.hooks.captureFrame(atMs) };
			}
			case "inspect_edit": {
				const { fromMs, toMs, sampleCount } = parseInput("inspect_edit", params);
				const clips = this.store.current.clips;
				const durationMs = clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0);
				if (durationMs === 0) throw new Error("The timeline is empty.");
				const startMs = fromMs ?? 0;
				const endMs = Math.min(toMs ?? durationMs, durationMs);
				if (startMs >= endMs) throw new Error("Choose a time range inside the timeline.");
				const frames = [];
				for (let i = 0; i < sampleCount; i++) {
					const atMs = Math.round(startMs + ((i + 0.5) / sampleCount) * (endMs - startMs));
					frames.push({
						atMs,
						png: await this.hooks.captureFrame(atMs),
						clips: clips
							.filter((clip) => !clip.disabled && clip.startMs <= atMs && clipEnd(clip) > atMs)
							.map(({ id, trackId, startMs, durationMs }) => ({
								id,
								trackId,
								startMs,
								durationMs,
							})),
					});
				}
				return {
					durationMs,
					range: { fromMs: startMs, toMs: endMs },
					frames,
					notes: reviewEdit(this.store.current, { offline: this.store.offline() }),
				};
			}
			case "get_activity":
				return this.store.getActivity().slice(0, parseInput("get_activity", params).limit);
			case "list_recent_projects":
				await this.refreshRecent();
				return this.recent;
			case "list_projects":
				return this.projects();
			case "close_project":
				await this.store.close(actor);
				await this.refreshRecent();
				return { closed: true };
			case "save_project_as": {
				const target = parseInput("save_project_as", params).path;
				if (actor === "agent") {
					const file = path.resolve(target);
					await checkAgentOutput(
						file.endsWith(".cueproj") ? file : `${file}.cueproj`,
						"/",
						"project",
					);
				}
				const file = await this.store.saveAs(target, actor);
				await this.afterOpen();
				return { path: file };
			}
			case "relink_media": {
				const { assetId, file } = parseInput("relink_media", params);
				return this.store.relink(assetId, file, actor);
			}
			case "find_offline_media":
				return this.store.findOffline(
					parseInput("find_offline_media", params).folders ?? [],
					actor,
				);
			case "import_timeline": {
				const { file } = parseInput("import_timeline", params);
				return this.job(`Importing ${path.basename(file)}`, () =>
					this.store.importTimeline(file, actor),
				);
			}
			case "open_project":
				await this.store.open(parseInput("open_project", params).path, actor);
				return this.afterOpen();
			case "create_project":
				await this.store.create(parseInput("create_project", params), actor);
				return this.afterOpen();
			case "rename_project":
				return this.store.apply(
					{ type: "rename", name: parseInput("rename_project", params).name },
					actor,
				);
			case "set_canvas":
				return this.store.apply(
					{ type: "setCanvas", canvas: parseInput("set_canvas", params) },
					actor,
				);

			case "list_library_assets": {
				const { query, category } = parseInput("list_library_assets", params);
				return LIBRARY_ASSETS.filter(
					(asset) => !category || asset.category.toLowerCase() === category.toLowerCase(),
				)
					.filter(
						(asset) =>
							!query ||
							`${asset.name} ${asset.description} ${asset.tags.join(" ")}`
								.toLowerCase()
								.includes(query.toLowerCase()),
					)
					.map((asset) => ({
						...asset,
						posterUrl: `https://cue.wicker.life/assets/${asset.id}.jpg`,
					}));
			}
			case "show_library_asset": {
				const asset = findLibraryAsset(parseInput("show_library_asset", params).id);
				this.hooks.sendCommand({ type: "showLibraryAsset", id: asset.id });
				return { ...asset, posterUrl: `https://cue.wicker.life/assets/${asset.id}.jpg` };
			}
			case "import_library_asset": {
				const { id, trackId, startMs } = parseInput("import_library_asset", params);
				const asset = findLibraryAsset(id);
				const file = await this.job(`Getting ${asset.name}`, () =>
					materializeLibraryAsset(asset, this.store.projectDir),
				);
				const imported = await this.job(`Importing ${asset.name}`, () =>
					this.store.importMedia([file], actor, trackId ? { trackId, startMs } : undefined),
				);
				return {
					libraryId: id,
					media: imported.map((item) => this.describeAsset(item)),
					sourcePage: asset.sourcePage,
					license: asset.license,
					licenseUrl: asset.licenseUrl,
				};
			}
			case "import_media": {
				const { files, trackId, startMs } = parseInput("import_media", params);
				const assets = await this.job(`Importing ${files.length} file(s)`, () =>
					this.store.importMedia(files, actor, trackId ? { trackId, startMs } : undefined),
				);
				return assets.map((a) => this.describeAsset(a));
			}
			case "list_media": {
				const { filter } = parseInput("list_media", params);
				const data = this.store.current;
				// Adjustment layers are built in, not media; they only show when nothing filters.
				const assets = filter ? filterMedia(data, filter) : data.assets;
				const used = usedAssetIds(data);
				return assets.map((a) => this.describeAsset(a, used));
			}
			case "remove_media": {
				const input = parseInput("remove_media", params);
				const list = [...new Set([...(input.id ? [input.id] : []), ...(input.ids ?? [])])];
				if (!list.length) throw new Error("Give the id (or ids) of the media to remove.");
				if (list.length === 1) return this.store.apply({ type: "removeAsset", id: list[0] }, actor);
				return this.store.transaction(actor, `Removed ${list.length} media items`, () => {
					for (const id of list) this.store.apply({ type: "removeAsset", id }, actor);
					return { removed: list.length };
				});
			}
			case "list_capture_sources": {
				if (!this.hooks.captureSources) throw new Error("Recording is not available.");
				const found = await this.hooks.captureSources();
				return {
					...found,
					sources: found.sources.map(({ thumbnail: _t, ...s }) => s),
					recording: !!this.capture,
				};
			}
			case "record_screen":
				return this.recordScreen(parseInput("record_screen", params));
			case "pause_screen_recording": {
				const { paused } = parseInput("pause_screen_recording", params);
				if (!this.capture) throw new Error("Nothing is being recorded.");
				if (!this.hooks.sendCommand({ type: "pauseScreen", paused }))
					throw new Error("The Cue window is not open.");
				return { paused };
			}
			case "stop_screen_recording":
				return this.stopScreenRecording();
			case "rename_media":
				return this.store.apply(
					{ type: "renameAsset", ...parseInput("rename_media", params) },
					actor,
				);
			case "list_bins": {
				const data = this.store.current;
				return (data.bins ?? []).map((b) => ({
					...b,
					path: binPath(data, b.id),
					items: data.assets.filter((a) => a.binId === b.id).length,
				}));
			}
			case "create_bin":
				return this.store.apply({ type: "createBin", ...parseInput("create_bin", params) }, actor);
			case "rename_bin":
				return this.store.apply({ type: "renameBin", ...parseInput("rename_bin", params) }, actor);
			case "remove_bin":
				return this.store.apply({ type: "removeBin", ...parseInput("remove_bin", params) }, actor);
			case "move_media":
				return this.store.apply({ type: "moveMedia", ...parseInput("move_media", params) }, actor);
			case "tag_media":
				return this.store.apply({ type: "tagMedia", ...parseInput("tag_media", params) }, actor);
			case "add_track":
				return this.store.apply({ type: "addTrack", ...parseInput("add_track", params) }, actor);
			case "update_track":
				return this.store.apply(
					{ type: "updateTrack", ...parseInput("update_track", params) },
					actor,
				);
			case "auto_mix":
				return this.job("Auto-mixing", () => this.store.autoMix(actor, this.hooks.renderText));
			case "measure_loudness":
				return this.job("Measuring loudness", () =>
					this.store.measureLoudness(this.hooks.renderText),
				);
			case "remove_track":
				return this.store.apply(
					{ type: "removeTrack", id: parseInput("remove_track", params).id },
					actor,
				);
			case "move_track":
				return this.store.apply({ type: "moveTrack", ...parseInput("move_track", params) }, actor);

			case "add_clips":
				return this.store.apply(
					{ type: "addClips", clips: parseInput("add_clips", params).clips },
					actor,
				);
			case "add_text": {
				const input = parseInput("add_text", params);
				const trackId =
					input.trackId ??
					this.store.current.tracks.find((t) => t.kind === "text")?.id ??
					this.store.apply({ type: "addTrack", kind: "text", index: 0 }, actor).created?.[0];
				if (!trackId) throw new Error("No text track.");
				const template = TITLE_TEMPLATES[input.preset];
				const style = { ...DEFAULT_TEXT_STYLE, ...template.style, ...input.style };
				return this.store.apply(
					{
						type: "addClips",
						clips: [
							{
								type: "text",
								trackId,
								startMs: input.startMs,
								durationMs: input.durationMs,
								text: input.text,
								style,
								animationIn: template.animationIn,
								animationOut: template.animationOut,
								name: template.label,
							},
						],
					},
					actor,
				);
			}
			case "update_clip":
				return this.store.apply(
					{ type: "updateClip", ...parseInput("update_clip", params) },
					actor,
				);
			case "move_clips":
				return this.store.apply({ type: "moveClips", ...parseInput("move_clips", params) }, actor);
			case "trim_clip":
				return this.store.apply({ type: "trimClip", ...parseInput("trim_clip", params) }, actor);
			case "split_clip":
				return this.store.apply({ type: "splitClip", ...parseInput("split_clip", params) }, actor);
			case "split_at":
				return this.store.apply({ type: "splitAt", ...parseInput("split_at", params) }, actor);
			case "delete_clips": {
				const input = parseInput("delete_clips", params);
				const result = this.store.apply({ type: "removeClips", ...input }, actor);
				this.selectedClipIds = this.selectedClipIds.filter((id) => !input.ids.includes(id));
				return result;
			}
			case "detach_audio":
				return this.store.apply(
					{ type: "detachAudio", ...parseInput("detach_audio", params) },
					actor,
				);
			case "get_history": {
				const { limit, before, after } = parseInput("get_history", params);
				return this.store.historyEntries(limit, before, after);
			}
			case "restore_history":
				return this.afterSequence(
					await this.store.restoreHistory(parseInput("restore_history", params).n, actor),
				);
			case "list_sequences": {
				const data = this.store.current;
				const open = activeSequence(data);
				return allSequences(data).map((q) => ({
					id: q.id,
					name: q.name,
					open: q.id === open.id,
					durationMs: q.clips.reduce((end, c) => Math.max(end, c.startMs + c.durationMs), 0),
					clips: q.clips.length,
					nestedAs: data.assets.find((a) => a.sequenceId === q.id)?.id ?? null,
				}));
			}
			case "new_sequence":
				return this.afterSequence(
					this.store.apply({ type: "newSequence", ...parseInput("new_sequence", params) }, actor),
				);
			case "open_sequence":
				return this.afterSequence(
					this.store.apply({ type: "openSequence", ...parseInput("open_sequence", params) }, actor),
				);
			case "rename_sequence":
				return this.store.apply(
					{ type: "renameSequence", ...parseInput("rename_sequence", params) },
					actor,
				);
			case "duplicate_sequence":
				return this.store.apply(
					{ type: "duplicateSequence", ...parseInput("duplicate_sequence", params) },
					actor,
				);
			case "delete_sequence":
				return this.store.apply(
					{ type: "deleteSequence", ...parseInput("delete_sequence", params) },
					actor,
				);
			case "branch_sequence": {
				const { name, from } = parseInput("branch_sequence", params);
				return this.afterSequence(this.store.apply({ type: "branchSequence", name, from }, actor));
			}
			case "promote_branch":
				return this.store.apply(
					{ type: "promoteBranch", ...parseInput("promote_branch", params) },
					actor,
				);
			case "rough_cut": {
				const input = parseInput("rough_cut", params);
				return this.afterSequence(await this.store.roughCut(actor, input));
			}
			case "beat_montage": {
				const input = parseInput("beat_montage", params);
				return this.afterSequence(
					await this.job("Cutting to the beat", () => this.store.beatMontage(actor, input)),
				);
			}
			case "nest_clips":
				return this.afterSequence(
					this.store.apply({ type: "nestClips", ...parseInput("nest_clips", params) }, actor),
				);
			case "add_adjustment_layer":
				return this.store.apply(
					{ type: "addAdjustment", ...parseInput("add_adjustment_layer", params) },
					actor,
				);
			case "copy_grade":
				return this.store.apply({ type: "copyGrade", ...parseInput("copy_grade", params) }, actor);
			case "speed_ramp":
				return this.store.apply({ type: "speedRamp", ...parseInput("speed_ramp", params) }, actor);
			case "lift_range":
				return this.store.apply({ type: "liftRange", ...parseInput("lift_range", params) }, actor);
			case "insert_edit":
				return this.store.apply(
					{ type: "insertEdit", ...parseInput("insert_edit", params) },
					actor,
				);
			case "freeze_frame": {
				const { clipId, atMs, durationMs } = parseInput("freeze_frame", params);
				return this.store.freezeFrame(clipId, atMs, durationMs, actor);
			}
			case "remove_ranges":
				return this.store.apply(
					{ type: "removeRanges", ...parseInput("remove_ranges", params) },
					actor,
				);
			case "remove_silence": {
				const input = parseInput("remove_silence", params);
				return this.job(input.dryRun ? "Finding pauses" : "Removing pauses", () =>
					this.store.removeSilence(actor, input),
				);
			}
			case "slip_clip":
				return this.store.apply({ type: "slipClip", ...parseInput("slip_clip", params) }, actor);
			case "roll_edit":
				return this.store.apply({ type: "rollEdit", ...parseInput("roll_edit", params) }, actor);
			case "slide_clip":
				return this.store.apply({ type: "slideClip", ...parseInput("slide_clip", params) }, actor);
			case "group_clips":
				return this.store.apply(
					{ type: "groupClips", ...parseInput("group_clips", params) },
					actor,
				);
			case "ungroup_clips":
				return this.store.apply(
					{ type: "ungroupClips", ...parseInput("ungroup_clips", params) },
					actor,
				);
			case "add_transition": {
				const { clipId, kind, durationMs } = parseInput("add_transition", params);
				return this.store.apply(
					{ type: "addTransition", clipId, transition: { kind, durationMs } },
					actor,
				);
			}
			case "remove_transition":
				return this.store.apply(
					{ type: "removeTransition", ...parseInput("remove_transition", params) },
					actor,
				);
			case "set_keyframe": {
				const { clipId, prop, atMs, value, ease, curve } = parseInput("set_keyframe", params);
				return this.store.apply(
					{ type: "setKeyframe", clipId, prop, keyframe: { atMs, value, ease, curve } },
					actor,
				);
			}
			case "edit_keyframes":
				return this.store.apply(
					{ type: "editKeyframes", ...parseInput("edit_keyframes", params) },
					actor,
				);
			case "remove_keyframe":
				return this.store.apply(
					{ type: "removeKeyframe", ...parseInput("remove_keyframe", params) },
					actor,
				);
			case "clear_keyframes":
				return this.store.apply(
					{ type: "clearKeyframes", ...parseInput("clear_keyframes", params) },
					actor,
				);
			case "add_zoom":
				return this.store.apply({ type: "addZoom", ...parseInput("add_zoom", params) }, actor);
			case "update_zoom":
				return this.store.apply(
					{ type: "updateZoom", ...parseInput("update_zoom", params) },
					actor,
				);
			case "remove_zoom":
				return this.store.apply(
					{ type: "removeZoom", ...parseInput("remove_zoom", params) },
					actor,
				);
			case "transcribe_media": {
				const { assetId, language } = parseInput("transcribe_media", params);
				const creds = await this.requireCredentials();
				const transcript = await this.job("Transcribing", () =>
					this.store.transcribeAsset(assetId, creds, actor, language),
				);
				return {
					words: transcript.words.length,
					text: transcript.words
						.map((w) => w.text)
						.join(" ")
						.slice(0, 4000),
				};
			}
			case "get_transcript": {
				const { assetId, search } = parseInput("get_transcript", params);
				const words = this.store.current.assets.find((a) => a.id === assetId)?.transcript?.words;
				if (!words) throw new Error("Not transcribed yet. Call transcribe_media first.");
				if (search) {
					const target = search.toLowerCase().split(/\s+/).filter(Boolean);
					const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
					const hits: { from: number; to: number; text: string }[] = [];
					for (let i = 0; i + target.length <= words.length; i++) {
						if (target.every((t, j) => norm(words[i + j].text) === norm(t)))
							hits.push({
								from: i,
								to: i + target.length - 1,
								text: words
									.slice(i, i + target.length)
									.map((w) => w.text)
									.join(" "),
							});
					}
					return hits;
				}
				return words.map((w, i) => ({ i, text: w.text, startMs: w.startMs, endMs: w.endMs }));
			}
			case "cut_words": {
				const { assetId, ranges } = parseInput("cut_words", params);
				return this.store.cutWords(assetId, ranges, actor);
			}
			case "remove_filler_words": {
				const { assetId, fillers } = parseInput("remove_filler_words", params);
				return this.store.removeFillers(assetId, actor, fillers);
			}
			case "build_proxies": {
				if (!this.store.current.settings.useProxies)
					throw new Error("Playback copies are turned off for this project (settings.useProxies).");
				const queued = this.store.buildProxies();
				return {
					queued,
					note: queued
						? "Building in the background."
						: "Every video that needs one has a playback copy.",
				};
			}
			case "duplicate_clips":
				return this.store.apply(
					{ type: "duplicateClips", ...parseInput("duplicate_clips", params) },
					actor,
				);
			case "select_clips":
				this.selectClips(parseInput("select_clips", params).ids);
				return { selected: this.selectedClipIds };

			case "set_lines":
				return this.store.apply(
					{ type: "setLines", lines: parseInput("set_lines", params).lines },
					actor,
				);
			case "import_script": {
				const { file, replace } = parseInput("import_script", params);
				// Relative paths are relative to the project, like every other path an agent gives.
				const text = await fs.readFile(path.resolve(this.store.projectDir, file), "utf8");
				const lines = file.toLowerCase().endsWith(".srt")
					? parseSrt(text)
					: (JSON.parse(text) as LineInput[]);
				return this.store.apply(
					{ type: "setLines", lines: replace ? lines : [...this.store.current.lines, ...lines] },
					actor,
				);
			}
			case "add_line":
				return this.store.apply(
					{ type: "addLine", line: parseInput("add_line", params).line },
					actor,
				);
			case "update_line": {
				const { id, patch } = parseInput("update_line", params);
				const result = this.store.apply({ type: "updateLine", id, patch }, actor);
				if (this.selectedLineId === id && patch.id) this.selectedLineId = patch.id;
				return result;
			}
			case "remove_line":
				return this.store.apply(
					{ type: "removeLine", id: parseInput("remove_line", params).id },
					actor,
				);
			case "shift_lines":
				return this.store.apply(
					{ type: "shiftLines", ...parseInput("shift_lines", params), withClips: true },
					actor,
				);
			case "select_line": {
				const { id } = parseInput("select_line", params);
				this.requireLine(id);
				this.selectedLineId = id;
				this.changed();
				return { selected: id };
			}
			case "record_line":
				return this.recordLine(parseInput("record_line", params));
			case "stop_recording":
				return this.command({ type: "stop" });
			case "import_take": {
				const { lineId, file, recordedAtMs } = parseInput("import_take", params);
				return this.describeTake(
					this.requireLine(lineId),
					await this.store.importTake(lineId, file, actor, recordedAtMs),
				);
			}
			case "list_takes": {
				const { lineId } = parseInput("list_takes", params);
				const lines = this.lines().filter((l) => !lineId || l.id === lineId);
				if (lineId && lines.length === 0) throw new Error(`No line "${lineId}".`);
				return lines.map((l) => ({
					lineId: l.id,
					chosen: l.chosenAssetId,
					status: l.status,
					takes: l.takes.map((t) => this.describeTake(l, t)),
				}));
			}
			case "choose_take":
				return this.store.apply(
					{ type: "chooseTake", ...parseInput("choose_take", params) },
					actor,
				);
			case "delete_take":
				return this.store.apply(
					{ type: "deleteTake", assetId: parseInput("delete_take", params).assetId },
					actor,
				);

			case "generate_take": {
				const { lineId, ...overrides } = parseInput("generate_take", params);
				const creds = await this.requireCredentials();
				const take = await this.job(`Generating voice for ${lineId}`, () =>
					this.store.generateTake(lineId, creds, actor, overrides),
				);
				return this.describeTake(this.requireLine(lineId), take);
			}
			case "rewrite_line": {
				const { id, goal, instructions } = parseInput("rewrite_line", params);
				const runtime = await this.requireCredentials();
				return this.job(`Rewriting ${id}`, () =>
					this.store.rewriteLine(id, runtime, actor, goal, instructions),
				);
			}
			case "update_marker":
				return this.store.apply(
					{ type: "updateMarker", ...parseInput("update_marker", params) },
					actor,
				);
			case "clear_markers":
				return this.store.apply(
					{ type: "clearMarkers", ...parseInput("clear_markers", params) },
					actor,
				);
			case "set_in_out": {
				const input = parseInput("set_in_out", params);
				if (!this.hooks.sendCommand({ type: "setInOut", ...input }))
					throw new Error("The Cue window is not open.");
				return {
					inMs: input.inMs ?? this.recorder.inMs ?? null,
					outMs: input.outMs ?? this.recorder.outMs ?? null,
				};
			}
			case "set_view": {
				const input = parseInput("set_view", params);
				if (!this.hooks.sendCommand({ type: "setView", ...input }))
					throw new Error("The Cue window is not open.");
				return { ok: true };
			}
			case "get_app_settings":
				return this.hooks.appSettings?.get() ?? null;
			case "update_app_settings": {
				if (!this.hooks.appSettings) throw new Error("App settings are not available.");
				return this.hooks.appSettings.set(parseInput("update_app_settings", params).patch);
			}
			case "wait_for":
				throw new Error("wait_for is answered by the control server for agents.");
			case "get_guide": {
				const { topic } = parseInput("get_guide", params);
				return topic === "motion" ? MOTION_GUIDE : AGENT_GUIDE;
			}
			case "list_motion_templates": {
				const { category } = parseInput("list_motion_templates", params);
				return {
					templates: MOTION_TEMPLATES.filter((t) => !category || t.category === category).map(
						(t) => ({
							id: t.id,
							name: t.name,
							category: t.category,
							description: t.description,
							overlay: t.overlay,
							params: describeParams(t),
							example: t.example,
						}),
					),
					themes: MOTION_THEMES.map(
						({ id, label, bg, surface, text, accent, accent2, accent3 }) => ({
							id,
							label,
							colors: { bg, surface, text, accent, accent2, accent3 },
						}),
					),
				};
			}
			case "create_motion_graphic": {
				const input = parseInput("create_motion_graphic", params);
				const placed =
					input.trackId !== undefined || input.startMs !== undefined || input.atCutMs !== undefined;
				const { asset, clipId } = await this.store.createMotionGraphic(
					{
						template: input.template,
						params: input.params,
						spec: input.spec,
						name: input.name,
						place: placed
							? {
									trackId: input.trackId,
									startMs: input.startMs,
									durationMs: input.durationMs,
									atCutMs: input.atCutMs,
								}
							: undefined,
					},
					actor,
				);
				return { ...this.describeAsset(asset), ...(clipId ? { clipId } : {}) };
			}
			case "update_motion_graphic": {
				const { assetId, ...change } = parseInput("update_motion_graphic", params);
				return this.describeAsset(await this.store.updateMotionGraphic(assetId, change, actor));
			}
			case "get_motion_graphic": {
				const { assetId } = parseInput("get_motion_graphic", params);
				return this.store.motionGraphicSource(assetId);
			}
			case "arrange_clips": {
				const { layout, clipIds } = parseInput("arrange_clips", params);
				return this.store.arrangeClips(layout, clipIds, actor);
			}
			case "add_overlay":
				return this.store.addOverlay(parseInput("add_overlay", params), actor);
			case "add_infographic":
				return this.store.addInfographic(parseInput("add_infographic", params), actor);
			case "add_data_callout":
				return this.store.addDataCallout(parseInput("add_data_callout", params), actor);
			case "review_changes": {
				const { action, clipIds } = parseInput("review_changes", params);
				if (actor === "agent")
					throw new Error("Only the user can keep or undo an agent's proposed changes.");
				return action === "accept"
					? this.store.acceptProposal(actor, clipIds)
					: this.store.rejectProposal(actor, clipIds);
			}
			case "make_variants": {
				const input = parseInput("make_variants", params);
				if (!input.aspects?.length && !input.lengthsSec?.length)
					throw new Error("Pick at least one frame shape or length.");
				return this.job("Making variants", () =>
					this.store.makeVariants(input, actor, this.hooks.renderText),
				);
			}
			case "search_shots": {
				const { query, assetIds, limit, describe } = parseInput("search_shots", params);
				// With a text model, the search also matches related labels ("snow" → winter, ice…).
				const runtime = await this.hooks.runtime().catch(() => undefined);
				return this.job("Searching shots", () =>
					this.store.searchShots(query, { assetIds, limit, runtime, describe }),
				);
			}
			case "follow_faces":
				return this.job("Following faces", () =>
					this.store.followFaces(parseInput("follow_faces", params).clipId, actor),
				);
			case "split_at_scenes": {
				const { clipId, threshold, split } = parseInput("split_at_scenes", params);
				return this.store.splitAtScenes(clipId, actor, { threshold, split });
			}
			case "detect_beats": {
				const { assetId, addMarkers, every } = parseInput("detect_beats", params);
				return this.store.detectBeats(assetId, actor, { addMarkers, every });
			}
			case "snap_cuts_to_beats": {
				const { trackId, musicAssetId, toleranceMs } = parseInput("snap_cuts_to_beats", params);
				return this.store.snapCutsToBeats(trackId, musicAssetId, actor, toleranceMs);
			}
			case "find_moments": {
				const { query } = parseInput("find_moments", params);
				const runtime = await this.requireCredentials();
				return this.job("Searching the edit", () => this.store.findMoments(query, runtime));
			}
			case "generate_chapters": {
				const { addMarkers } = parseInput("generate_chapters", params);
				const runtime = await this.requireCredentials();
				return this.job("Writing chapters", () => this.store.chapters(runtime, actor, addMarkers));
			}
			case "suggest_broll": {
				const { count } = parseInput("suggest_broll", params);
				const runtime = await this.requireCredentials();
				return this.job("Planning B-roll", () => this.store.suggestBroll(runtime, count));
			}
			case "add_broll": {
				const { items } = parseInput("add_broll", params);
				const runtime = await this.requireCredentials();
				return this.job(
					`Generating ${items.length} B-roll image${items.length === 1 ? "" : "s"}`,
					() => this.store.addBroll(items, runtime, actor),
				);
			}
			case "reframe": {
				const { width, height } = parseInput("reframe", params);
				return this.store.reframe(width, height, actor);
			}
			case "get_ai_status":
				return (await this.hooks.runtime()).status();
			case "generate_voiceover": {
				const input = parseInput("generate_voiceover", params);
				const creds = await this.requireCredentials();
				const targets = this.lines().filter(
					(l) =>
						(!input.lineIds || input.lineIds.includes(l.id)) &&
						(!input.onlyMissing || l.status === "empty"),
				);
				const results: unknown[] = [];
				await this.job(`Generating ${targets.length} voice take(s)`, async (progress) => {
					for (const [i, l] of targets.entries()) {
						const take = await this.store.generateTake(l.id, creds, actor, {
							voice: input.voice,
							instructions: input.instructions,
						});
						results.push(this.describeTake(this.requireLine(l.id), take));
						progress((i + 1) / targets.length);
					}
				});
				return results;
			}
			case "auto_captions": {
				const input = parseInput("auto_captions", params);
				const creds = await this.requireCredentials();
				return this.job("Transcribing captions", () =>
					this.store.autoCaptions(creds, actor, input),
				);
			}
			case "script_from_media": {
				const { assetId, idPrefix, replace } = parseInput("script_from_media", params);
				const creds = await this.requireCredentials();
				const count = await this.job("Transcribing script", () =>
					this.store.scriptFromMedia(assetId, creds, actor, { idPrefix, replace }),
				);
				return { lines: count };
			}
			case "review_edit": {
				const { measureAudio } = parseInput("review_edit", params);
				const loudness = measureAudio
					? await this.job("Measuring loudness", () =>
							this.store.measureLoudness(this.hooks.renderText),
						)
					: undefined;
				return {
					notes: reviewEdit(this.store.current, { offline: this.store.offline(), loudness }),
				};
			}
			case "list_recipes":
				return this.recipes();
			case "list_styles": {
				const { category, query } = parseInput("list_styles", params);
				return (await this.recipes())
					.filter((r) => r.format === "style" || !!r.guide)
					.filter((r) => !category || r.category?.toLowerCase() === category.toLowerCase())
					.filter(
						(r) =>
							!query ||
							`${r.name} ${r.description} ${r.category ?? ""}`
								.toLowerCase()
								.includes(query.toLowerCase()),
					)
					.map(({ id, name, category, description, guide, preview, assetIds }) => ({
						id,
						name,
						category,
						description,
						requires: guide?.requires ?? [],
						preview: preview && {
							...preview,
							videoUrl: `https://cue.wicker.life/styles/${preview.video}`,
							posterUrl: `https://cue.wicker.life/styles/${preview.poster}`,
						},
						assetIds: assetIds ?? [],
					}));
			}
			case "show_style": {
				const { id } = parseInput("show_style", params);
				const style = (await this.recipes()).find(
					(r) => r.id === id && (r.format === "style" || !!r.guide),
				);
				if (!style) throw new Error(`No style "${id}". Use list_styles to browse them.`);
				if (!this.hooks.sendCommand({ type: "showStyle", id }))
					throw new Error("The Cue window is not open.");
				return {
					...style,
					preview: style.preview && {
						...style.preview,
						videoUrl: `https://cue.wicker.life/styles/${style.preview.video}`,
						posterUrl: `https://cue.wicker.life/styles/${style.preview.poster}`,
					},
				};
			}
			case "run_recipe": {
				const { id, dryRun } = parseInput("run_recipe", params);
				return this.runRecipe(id, dryRun, actor);
			}
			case "save_recipe": {
				const input = parseInput("save_recipe", params);
				const file = this.hooks.recipesFile;
				if (!file) throw new Error("Recipes can't be saved here.");
				const mine = await loadRecipes(file);
				const same = mine.find((r) => r.name.toLowerCase() === input.name.toLowerCase());
				const taken = [...BUILT_IN_RECIPES, ...mine].map((r) => r.id);
				const recipe = recipeSchema.parse({
					...input,
					id: same?.id ?? recipeId(input.name, taken),
				});
				await saveRecipes(file, [...mine.filter((r) => r.id !== recipe.id), recipe]);
				this.store.log(actor, `Saved the recipe "${recipe.name}"`);
				return recipe;
			}
			case "delete_recipe": {
				const { id } = parseInput("delete_recipe", params);
				if (BUILT_IN_RECIPES.some((r) => r.id === id))
					throw new Error("Built-in recipes can't be deleted.");
				const file = this.hooks.recipesFile;
				const mine = await loadRecipes(file);
				if (!file || !mine.some((r) => r.id === id)) throw new Error(`No recipe "${id}".`);
				await saveRecipes(
					file,
					mine.filter((r) => r.id !== id),
				);
				return { deleted: id };
			}
			case "generate_image": {
				const { prompt, orientation, trackId, startMs } = parseInput("generate_image", params);
				const creds = await this.requireCredentials();
				const asset = await this.job("Generating image", () =>
					this.store.generateImage(prompt, creds, actor, {
						orientation,
						place: trackId ? { trackId, startMs } : undefined,
					}),
				);
				return this.describeAsset(asset);
			}

			case "seek":
				return this.command({ type: "seek", ms: parseInput("seek", params).ms });
			case "play":
				return this.command({ type: "play", ...parseInput("play", params) });
			case "pause":
				return this.command({ type: "pause" });
			case "preview_media":
				return this.command({
					type: "previewAsset",
					assetId: parseInput("preview_media", params).assetId,
				});

			case "update_settings":
				return this.store.apply(
					{ type: "updateSettings", settings: parseInput("update_settings", params).settings },
					actor,
				);
			case "update_export":
				return this.store.apply(
					{ type: "updateExport", export: parseInput("update_export", params).export },
					actor,
				);
			case "update_ai":
				return this.store.apply(
					{ type: "updateAi", ai: parseInput("update_ai", params).ai },
					actor,
				);
			case "add_marker":
				return this.store.apply({ type: "addMarker", ...parseInput("add_marker", params) }, actor);
			case "remove_marker":
				return this.store.apply(
					{ type: "removeMarker", id: parseInput("remove_marker", params).id },
					actor,
				);
			case "undo":
				this.afterSequence(null);
				return { undone: this.store.undo(actor) };
			case "redo":
				this.afterSequence(null);
				return { redone: this.store.redo(actor) };
			case "export": {
				const { kind, out, range } = parseInput("export", params);
				if (actor === "agent" && out)
					await checkAgentOutput(
						path.resolve(this.store.projectDir, out),
						this.store.projectDir,
						kind,
						kind === "stems",
					);
				return this.job(`Exporting ${kind}`, () =>
					this.store.export(kind, out, actor, this.hooks.renderText, range),
				);
			}
			case "export_frame": {
				const { atMs, out } = parseInput("export_frame", params);
				const frame = await this.hooks.captureFrame(atMs);
				const name = `${this.store.current.name.replace(/[^\w\- ]+/g, "")} ${(atMs / 1000).toFixed(2)}s.png`;
				const file = out
					? path.resolve(this.store.projectDir, out)
					: path.join(this.store.projectDir, "export", name);
				if (actor === "agent") await checkAgentOutput(file, this.store.projectDir, "frame");
				await fs.mkdir(path.dirname(file), { recursive: true });
				await fs.copyFile(frame, file);
				this.store.log(
					actor,
					`Saved the frame at ${(atMs / 1000).toFixed(2)} s → ${path.basename(file)}`,
				);
				return { path: file };
			}
			case "focus_window":
				this.hooks.focusWindow();
				return { focused: true };
		}
	}

	/** Built-in recipes, then the user's. */
	async recipes(): Promise<Recipe[]> {
		return [...BUILT_IN_RECIPES, ...(await loadRecipes(this.hooks.recipesFile))];
	}

	/**
	 * Runs a recipe's calls one after another as `actor`. Each call is its own
	 * edit (and undo step); nothing here holds a transaction, since `call()`
	 * waits for running ones and would wait forever on its own.
	 */
	private async runRecipe(id: string, dryRun: boolean, actor: Actor) {
		const recipe = (await this.recipes()).find((r) => r.id === id);
		if (!recipe) throw new Error(`No recipe "${id}". list_recipes shows them.`);
		if (recipe.steps.length === 0)
			throw new Error(
				`"${recipe.name}" is a style guide. Open it in the Style library or ask an agent to follow it.`,
			);
		const startingStep = this.store.historyEntries(1)[0]?.n;
		const context = () =>
			recipeContext(this.store.current, {
				playheadMs: this.recorder.currentMs,
				selectedClipIds: this.selectedClipIds,
			});
		if (dryRun) return { recipe: recipe.name, steps: resolveRecipe(recipe, context()) };
		const done: { step: number; tool: string; label: string; skipped?: string }[] = [];
		for (let index = 0; index < recipe.steps.length; index++) {
			// Resolve each step against the project as the earlier steps left it.
			const calls = resolveRecipe(recipe, context()).filter((s) => s.index === index);
			for (const call of calls) {
				try {
					if (call.problem) throw new Error(call.problem);
					await this.call(call.tool, call.params, actor);
					done.push({ step: index + 1, tool: call.tool, label: call.label });
				} catch (error) {
					const message = (error as Error).message;
					if (call.optional) {
						done.push({ step: index + 1, tool: call.tool, label: call.label, skipped: message });
						continue;
					}
					let rolledBack = false;
					if (done.some((step) => !step.skipped) && startingStep !== undefined) {
						await this.store.restoreHistory(startingStep, actor);
						rolledBack = true;
					}
					return {
						recipe: recipe.name,
						ok: false,
						rolledBack,
						done,
						failed: { step: index + 1, tool: call.tool, label: call.label, error: message },
					};
				}
			}
		}
		this.store.log(actor, `Ran the recipe "${recipe.name}"`);
		return { recipe: recipe.name, ok: true, done };
	}

	async refreshRecentAndNotify(): Promise<void> {
		await this.refreshRecent();
		this.changed();
	}

	private nestedTimer: NodeJS.Timeout | null = null;

	/** Nested clips show a render of their sequence; refresh those renders in the background. */
	private afterSequence<T>(result: T): T {
		if (this.nestedTimer) clearTimeout(this.nestedTimer);
		this.nestedTimer = setTimeout(() => {
			this.nestedTimer = null;
			if (!this.store.isOpen || !this.store.current.assets.some((a) => a.sequenceId)) return;
			void this.job("Rendering nested sequences", () =>
				this.store.renderNested(this.hooks.renderText),
			).catch(() => {});
		}, 250);
		return result;
	}

	/** Recent projects plus those found in the projects folder, newest change first. */
	async projects(): Promise<ProjectSummary[]> {
		await this.refreshRecent();
		const dir = this.hooks.projectsDir?.();
		const scanned = dir ? await scanProjects(dir) : [];
		const byPath = new Map(this.recent.map((r) => [r.path, r]));
		const files = [...new Set([...this.recent.map((r) => r.path), ...scanned])];
		const list = await Promise.all(
			files.map((f) => summarise(f, (file) => this.store.toUrl(file), byPath.get(f))),
		);
		return list.sort(
			(a, b) => Date.parse(b.openedAt ?? b.modifiedAt) - Date.parse(a.openedAt ?? a.modifiedAt),
		);
	}

	// -------------------------------------------------------------------------

	/** The job running now, if any (its label and progress), for agents waiting on a long call. */
	runningJob(): JobStatus | undefined {
		return this.jobs.find((j) => j.state === "running");
	}

	private async job<T>(
		label: string,
		run: (progress: (fraction: number) => void) => Promise<T>,
	): Promise<T> {
		const id = `j${++this.seq}`;
		const update = (patch: Partial<JobStatus>) => {
			this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
			this.changed();
		};
		this.jobs = [
			...this.jobs.filter((j) => j.state === "running"),
			{ id, label, progress: null, state: "running" },
		];
		this.changed();
		try {
			const result = await run((fraction) => update({ progress: fraction }));
			update({ state: "done", progress: 1 });
			return result;
		} catch (error) {
			update({ state: "failed", message: (error as Error).message });
			throw error;
		} finally {
			setTimeout(() => {
				this.jobs = this.jobs.filter((j) => j.id !== id);
				this.changed();
			}, 6000);
		}
	}

	private async requireCredentials(): Promise<AiRuntime> {
		return this.hooks.runtime();
	}

	private command(command: EditorCommand) {
		if (!this.hooks.sendCommand(command)) throw new Error("The Cue window is not open.");
		return { sent: command.type };
	}

	private afterOpen() {
		this.selectedLineId = this.store.snapshot()?.lines[0]?.id ?? null;
		this.selectedClipIds = [];
		void this.refreshRecent();
		return this.describeState();
	}

	private lines(): LineView[] {
		const snapshot = this.store.snapshot();
		if (!snapshot) throw new Error("No project is open. Open or create one first.");
		return snapshot.lines;
	}

	private requireLine(id: string): LineView {
		const l = this.lines().find((candidate) => candidate.id === id);
		if (!l) throw new Error(`No line "${id}".`);
		return l;
	}

	private async recordLine(input: MethodInput<"record_line">) {
		const l = this.requireLine(input.id);
		if (!this.recorder.uiReady)
			throw new Error("The Cue window is not ready. Call focus_window and try again.");
		if (this.recorder.recordingLineId)
			throw new Error(`Already recording ${this.recorder.recordingLineId}.`);
		const requestId = `r${++this.seq}`;
		this.selectedLineId = l.id;
		this.changed();
		this.hooks.focusWindow();
		const settings = this.store.current.settings;
		const preroll = input.prerollMs ?? settings.prerollMs;
		const budget = input.timeoutMs ?? preroll + l.maxMs + settings.postrollMs + 30000;
		const done = new Promise<Asset>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error("Timed out waiting for the recording. Is the microphone allowed?"));
			}, budget);
			this.pending.set(requestId, { lineId: l.id, resolve, reject, timer });
		});
		// Without `wait` nobody awaits the take, so its failure must not go unhandled.
		done.catch(() => {});
		try {
			this.command({ type: "record", lineId: l.id, prerollMs: preroll, requestId });
		} catch (error) {
			const pending = this.pending.get(requestId);
			if (pending) clearTimeout(pending.timer);
			this.pending.delete(requestId);
			throw error;
		}
		if (!input.wait) return { started: l.id, requestId };
		const take = await done;
		return this.describeTake(this.requireLine(l.id), take);
	}

	private async recordScreen(input: MethodInput<"record_screen">) {
		if (!this.store.isOpen) throw new Error("No project is open. Open or create one first.");
		if (!this.recorder.uiReady)
			throw new Error("The Cue window is not ready. Call focus_window and try again.");
		if (this.capture || this.captureStart)
			throw new Error("A recording is already running. Call stop_screen_recording first.");
		const cameraOnly = input.sourceId === "none";
		checkCaptureOptions({ ...input, sourceId: cameraOnly ? null : (input.sourceId ?? "screen") });
		if (input.sourceId && !cameraOnly && this.hooks.captureSources) {
			const { sources } = await this.hooks.captureSources();
			if (!sources.some((s) => s.id === input.sourceId))
				throw new Error(
					`No screen or window "${input.sourceId}". Call list_capture_sources for the ids.`,
				);
		}
		const requestId = `c${++this.seq}`;
		const started = new Promise<void>((resolve, reject) => {
			this.captureStart = { requestId, resolve, reject };
		});
		// Permissions and the 3-2-1 countdown come first; give up if nothing happens.
		const timer = setTimeout(() => {
			if (this.captureStart?.requestId !== requestId) return;
			this.captureStart.reject(
				new Error("The recording did not start. Is screen recording allowed for Cue?"),
			);
			this.captureStart = null;
		}, 30000);
		this.hooks.focusWindow();
		try {
			this.command({
				type: "recordScreen",
				requestId,
				// Without a source the window picks the main screen.
				sourceId: cameraOnly ? null : (input.sourceId ?? "screen"),
				camera: input.camera,
				microphone: input.microphone,
				bubble: input.bubble,
				maxSeconds: input.maxSeconds,
				studio:
					input.studio && !cameraOnly
						? {
								...DEFAULT_STUDIO,
								...(input.wallpaper ? { wallpaper: input.wallpaper } : {}),
								zoom: input.autoZoom,
								cursor: input.smoothCursor,
								cursorSize: input.cursorSize,
								clickEffect: input.clickRipples,
							}
						: null,
				cameraId: input.cameraId,
				microphoneId: input.microphoneId,
			});
			await started;
		} catch (error) {
			// Narrowed to null by the check above, but the window may have set it since.
			const start = this.captureStart as { requestId: string } | null;
			if (start?.requestId === requestId) this.captureStart = null;
			throw error;
		} finally {
			clearTimeout(timer);
		}
		return {
			recording: true,
			camera: input.camera,
			microphone: input.microphone,
			stopsAfterSeconds: input.maxSeconds ?? null,
			next: "Call stop_screen_recording to finish and import it.",
		};
	}

	private stopScreenRecording(): Promise<CaptureResult> {
		// Already stopped (by the user or maxSeconds): the import that is running, or its result.
		if (!this.capture) {
			if (this.captureImport) return this.captureImport;
			if (this.lastCapture) return Promise.resolve(this.lastCapture);
			return Promise.reject(new Error("Nothing is being recorded."));
		}
		const done = new Promise<CaptureResult>((resolve, reject) =>
			this.captureWaiters.push({ resolve, reject }),
		);
		this.command({ type: "stopScreen" });
		return done;
	}

	private describeAsset(a: Asset, used?: Set<string>) {
		const data = this.store.current;
		const uses = mediaUses(data, a.id);
		const info = a.info;
		return {
			id: a.id,
			kind: a.kind,
			name: a.name,
			durationMs: a.durationMs,
			size: a.width ? `${a.width}x${a.height}` : undefined,
			hasAudio: a.hasAudio,
			origin: a.origin,
			lineId: a.lineId,
			bin: a.binId ? { id: a.binId, path: binPath(data, a.binId) } : null,
			tags: a.tags ?? [],
			rating: a.rating ?? 0,
			note: a.note,
			used: used ? used.has(a.id) : uses.length > 0,
			// Clips on the open timeline by id; other timelines by name and count.
			usedBy: uses.filter((u) => u.open).map((u) => u.clipId),
			usedInOtherSequences: [...new Set(uses.filter((u) => !u.open).map((u) => u.sequenceName))],
			info: info
				? {
						format: info.format,
						videoCodec: info.videoCodec,
						videoProfile: info.videoProfile,
						fps: info.fps,
						bitrateKbps: info.bitrateKbps,
						audioCodec: info.audioCodec,
						audioChannels: info.audioChannels,
						sampleRate: info.sampleRate,
						creationTime: info.creationTime,
						rotation: info.rotation,
						fileBytes: a.size,
					}
				: a.size !== undefined
					? { fileBytes: a.size }
					: undefined,
			transcribed: !!a.transcript,
			...(a.motion
				? {
						motion: {
							fps: Math.round(a.motion.fps * 100) / 100,
							texts: a.motion.texts.map((t) => ({
								id: t.id,
								text: t.text,
								...(t.glyphs ? { onlyLettersInFile: true } : {}),
							})),
							colors: a.motion.colors,
							markers: a.motion.markers,
							fonts: a.motion.fonts,
							...(a.motion.slots ? { slots: a.motion.slots } : {}),
						},
					}
				: {}),
		};
	}

	private describeTake(l: LineView, take: Asset) {
		const speech = speechOf(take);
		const chosen =
			this.store.snapshot()?.lines.find((x) => x.id === l.id)?.chosenAssetId === take.id;
		return {
			assetId: take.id,
			name: take.name,
			chosen,
			origin: take.origin,
			speechMs: speech.lengthMs,
			targetMs: l.targetMs,
			maxMs: l.maxMs,
			fit: speech.lengthMs > l.maxMs ? "over" : speech.lengthMs > l.maxMs - 300 ? "tight" : "ok",
			peakDb: take.peakDb ?? null,
			by: take.actor,
		};
	}

	private describeState() {
		const snapshot = this.store.snapshot();
		if (!snapshot) return { project: null, recent: this.recent };
		const { data } = snapshot;
		return {
			project: {
				path: snapshot.path,
				name: data.name,
				openSequence: activeSequence(data),
				otherSequences: (data.sequences ?? []).map((q) => ({ id: q.id, name: q.name })),
				durationMs: snapshot.durationMs,
				canvas: data.canvas,
				tracks: data.tracks.map((t) => ({
					...t,
					clips: data.clips.filter((c) => c.trackId === t.id).length,
				})),
				media: data.assets.length,
				bins: (data.bins ?? []).length,
				offlineMedia: this.store.offline().map((id) => ({
					id,
					name: data.assets.find((a) => a.id === id)?.name,
					path: data.assets.find((a) => a.id === id)?.path,
				})),
				clips: data.clips.length,
				// Review mode: the user decides whether your edits are kept.
				pendingReview: snapshot.proposal
					? {
							steps: snapshot.proposal.steps.length,
							added: snapshot.proposal.added.length,
							changed: snapshot.proposal.changed.length,
							removed: snapshot.proposal.removed.length,
						}
					: null,
				markers: data.markers,
				lines: snapshot.lines.map((l) => ({
					id: l.id,
					text: l.text,
					startMs: l.startMs,
					targetMs: l.targetMs,
					maxMs: l.maxMs,
					takes: l.takes.length,
					chosen: l.chosenAssetId,
					speechMs: l.speechMs,
					status: l.status,
				})),
				scriptProgress: `${snapshot.lines.filter((l) => l.status !== "empty").length}/${snapshot.lines.length} lines have a take`,
				settings: data.settings,
				export: data.export,
				ai: data.ai,
			},
			selection: { lineId: this.selectedLineId, clipIds: this.selectedClipIds },
			view: {
				playheadMs: this.recorder.currentMs,
				playing: this.recorder.playing,
				inMs: this.recorder.inMs ?? null,
				outMs: this.recorder.outMs ?? null,
				panel: this.recorder.panel ?? null,
			},
			recorder: this.recorder,
			aiConfigured: this.aiConfigured,
		};
	}

	private async refreshRecent() {
		this.recent = await this.store.recent();
		this.changed();
	}
}
