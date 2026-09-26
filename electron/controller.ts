import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { type MethodInput, type MethodName, parseInput } from "./control/contract";
import { AGENT_GUIDE } from "./control/guide";
import type { TextRender } from "./core/exporter";
import { clipEnd, DEFAULT_TEXT_STYLE, type LineInput, speechOf } from "./core/project";
import type { AiRuntime } from "./core/runtime";
import { scanProjects, summarise } from "./core/library";
import { parseSrt } from "./core/srt";
import type { ProjectStore } from "./core/store";
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
	TextClip,
	TextStyle,
} from "./core/types";

interface PendingRecording {
	lineId: string;
	resolve: (take: Asset) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

export interface ControllerHooks {
	sendCommand: (command: EditorCommand) => boolean;
	focusWindow: () => void;
	/** Rasterise text clips to full-canvas PNGs (editor window). */
	renderText: (clips: TextClip[]) => Promise<Record<string, TextRender>>;
	/** PNG of the preview at a moment (editor window). */
	captureFrame: (atMs: number) => Promise<string>;
	/** The generative runtime built from app settings, keys and local models. */
	runtime: () => Promise<AiRuntime>;
	/** Read and change app-wide settings (never secrets or agent access). */
	appSettings?: { get: () => unknown; set: (patch: Record<string, unknown>) => Promise<unknown> };
	/** The folder new projects go in (app setting). */
	projectsDir?: () => string;
}

const TEXT_PRESETS: Record<"title" | "lower-third" | "caption" | "label", Partial<TextStyle>> = {
	title: { fontSize: 96, fontWeight: 800, y: 0.45, width: 0.8, background: null, shadow: true },
	"lower-third": {
		fontSize: 44,
		fontWeight: 700,
		x: 0.3,
		y: 0.82,
		width: 0.5,
		align: "left",
		background: "rgba(15, 23, 42, 0.78)",
	},
	caption: { fontSize: 46, fontWeight: 600, y: 0.9, width: 0.86, padding: 14, radius: 10 },
	label: {
		fontSize: 32,
		fontWeight: 600,
		x: 0.84,
		y: 0.1,
		width: 0.28,
		background: "rgba(37, 99, 235, 0.9)",
		radius: 999,
		padding: 12,
	},
};

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

	state(): AppState {
		return {
			project: this.store.snapshot(),
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

	async call(method: MethodName, params: unknown, actor: Actor): Promise<unknown> {
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
				const file = await this.store.saveAs(parseInput("save_project_as", params).path, actor);
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

			case "import_media": {
				const { files, trackId, startMs } = parseInput("import_media", params);
				const assets = await this.job(`Importing ${files.length} file(s)`, () =>
					this.store.importMedia(files, actor, trackId ? { trackId, startMs } : undefined),
				);
				return assets.map((a) => this.describeAsset(a));
			}
			case "list_media":
				return this.store.current.assets.map((a) => this.describeAsset(a));
			case "remove_media":
				return this.store.apply(
					{ type: "removeAsset", id: parseInput("remove_media", params).id },
					actor,
				);
			case "add_track":
				return this.store.apply({ type: "addTrack", ...parseInput("add_track", params) }, actor);
			case "update_track":
				return this.store.apply(
					{ type: "updateTrack", ...parseInput("update_track", params) },
					actor,
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
				const style = { ...DEFAULT_TEXT_STYLE, ...TEXT_PRESETS[input.preset], ...input.style };
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
								name: input.preset,
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
				const { clipId, prop, atMs, value, ease } = parseInput("set_keyframe", params);
				return this.store.apply(
					{ type: "setKeyframe", clipId, prop, keyframe: { atMs, value, ease } },
					actor,
				);
			}
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
			case "build_proxies":
				this.store.buildProxies();
				return { started: true };
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
				const text = await fs.readFile(path.resolve(file), "utf8");
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
				this.hooks.sendCommand({ type: "setInOut", ...input });
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
			case "get_guide":
				return AGENT_GUIDE;
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
				return { undone: this.store.undo(actor) };
			case "redo":
				return { redone: this.store.redo(actor) };
			case "export": {
				const { kind, out, range } = parseInput("export", params);
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

	async refreshRecentAndNotify(): Promise<void> {
		await this.refreshRecent();
		this.changed();
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
		this.command({ type: "record", lineId: l.id, prerollMs: preroll, requestId });
		if (!input.wait) {
			done.catch(() => {});
			return { started: l.id, requestId };
		}
		const take = await done;
		return this.describeTake(this.requireLine(l.id), take);
	}

	private describeAsset(a: Asset) {
		return {
			id: a.id,
			kind: a.kind,
			name: a.name,
			durationMs: a.durationMs,
			size: a.width ? `${a.width}x${a.height}` : undefined,
			hasAudio: a.hasAudio,
			origin: a.origin,
			lineId: a.lineId,
			usedBy: this.store.current.clips
				.filter((c) => c.type === "media" && c.assetId === a.id)
				.map((c) => c.id),
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
				durationMs: snapshot.durationMs,
				canvas: data.canvas,
				tracks: data.tracks.map((t) => ({
					...t,
					clips: data.clips.filter((c) => c.trackId === t.id).length,
				})),
				media: data.assets.length,
				offlineMedia: this.store.offline().map((id) => ({
					id,
					name: data.assets.find((a) => a.id === id)?.name,
					path: data.assets.find((a) => a.id === id)?.path,
				})),
				clips: data.clips.length,
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
