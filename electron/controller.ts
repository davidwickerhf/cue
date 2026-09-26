import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_TEXT_STYLE, type LineInput, clipEnd, speechOf } from "./core/project";
import { parseSrt } from "./core/srt";
import type { AiCredentials } from "./core/ai";
import type { TextRender } from "./core/exporter";
import type { ProjectStore } from "./core/store";
import type {
	Actor,
	AgentStatus,
	AppState,
	Asset,
	EditorCommand,
	JobStatus,
	LineView,
	RecentProject,
	RecorderStatus,
	TextClip,
	TextStyle,
} from "./core/types";
import { type MethodInput, type MethodName, parseInput } from "./control/contract";

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
	credentials: () => Promise<AiCredentials | null>;
}

const TEXT_PRESETS: Record<"title" | "lower-third" | "caption" | "label", Partial<TextStyle>> = {
	title: { fontSize: 96, fontWeight: 800, y: 0.45, width: 0.8, background: null, shadow: true },
	"lower-third": { fontSize: 44, fontWeight: 700, x: 0.3, y: 0.82, width: 0.5, align: "left", background: "rgba(15, 23, 42, 0.78)" },
	caption: { fontSize: 46, fontWeight: 600, y: 0.9, width: 0.86, padding: 14, radius: 10 },
	label: { fontSize: 32, fontWeight: 600, x: 0.84, y: 0.1, width: 0.28, background: "rgba(37, 99, 235, 0.9)", radius: 999, padding: 12 },
};

/**
 * Where editor state lives and every action is implemented. The editor window
 * (actor "user") and the control server (actor "agent") both call `call()`.
 */
export class Controller extends EventEmitter {
	selectedLineId: string | null = null;
	selectedClipIds: string[] = [];
	recorder: RecorderStatus = { uiReady: false, micReady: false, recordingLineId: null, playing: false, currentMs: 0 };
	agent: AgentStatus = { connected: false, lastSeenAt: null, requests: 0, controlPort: null };
	aiConfigured = false;
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
			ai: { configured: this.aiConfigured, provider: this.aiConfigured ? "openai" : null },
		};
	}

	changed(): void {
		this.emit("state");
	}

	async refreshAi(): Promise<void> {
		this.aiConfigured = Boolean(await this.hooks.credentials());
		this.changed();
	}

	noteAgentRequest(): void {
		this.agent = { ...this.agent, connected: true, lastSeenAt: new Date().toISOString(), requests: this.agent.requests + 1 };
		this.changed();
	}

	updateRecorder(patch: Partial<RecorderStatus>): void {
		this.recorder = { ...this.recorder, ...patch };
		this.changed();
	}

	selectClips(ids: string[]): void {
		this.selectedClipIds = ids;
		this.changed();
	}

	/** Called by the editor window when a recording finishes. */
	async saveRecording(input: { lineId: string; audio: Buffer; extension: string; recordedAtMs: number; requestId?: string }): Promise<Asset> {
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
					.filter((c) => (!trackId || c.trackId === trackId) && (fromMs === undefined || clipEnd(c) > fromMs) && (toMs === undefined || c.startMs < toMs))
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
			case "open_project":
				await this.store.open(parseInput("open_project", params).path, actor);
				return this.afterOpen();
			case "create_project":
				await this.store.create(parseInput("create_project", params), actor);
				return this.afterOpen();
			case "rename_project":
				return this.store.apply({ type: "rename", name: parseInput("rename_project", params).name }, actor);
			case "set_canvas":
				return this.store.apply({ type: "setCanvas", canvas: parseInput("set_canvas", params) }, actor);

			case "import_media": {
				const { files, trackId, startMs } = parseInput("import_media", params);
				const assets = await this.job(`Importing ${files.length} file(s)`, () => this.store.importMedia(files, actor, trackId ? { trackId, startMs } : undefined));
				return assets.map((a) => this.describeAsset(a));
			}
			case "list_media":
				return this.store.current.assets.map((a) => this.describeAsset(a));
			case "remove_media":
				return this.store.apply({ type: "removeAsset", id: parseInput("remove_media", params).id }, actor);
			case "add_track":
				return this.store.apply({ type: "addTrack", ...parseInput("add_track", params) }, actor);
			case "update_track":
				return this.store.apply({ type: "updateTrack", ...parseInput("update_track", params) }, actor);
			case "remove_track":
				return this.store.apply({ type: "removeTrack", id: parseInput("remove_track", params).id }, actor);
			case "move_track":
				return this.store.apply({ type: "moveTrack", ...parseInput("move_track", params) }, actor);

			case "add_clips":
				return this.store.apply({ type: "addClips", clips: parseInput("add_clips", params).clips }, actor);
			case "add_text": {
				const input = parseInput("add_text", params);
				const trackId = input.trackId ?? this.store.current.tracks.find((t) => t.kind === "text")?.id ?? this.store.apply({ type: "addTrack", kind: "text", index: 0 }, actor).created?.[0];
				if (!trackId) throw new Error("No text track.");
				const style = { ...DEFAULT_TEXT_STYLE, ...TEXT_PRESETS[input.preset], ...input.style };
				return this.store.apply({ type: "addClips", clips: [{ type: "text", trackId, startMs: input.startMs, durationMs: input.durationMs, text: input.text, style, name: input.preset }] }, actor);
			}
			case "update_clip":
				return this.store.apply({ type: "updateClip", ...parseInput("update_clip", params) }, actor);
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
				return this.store.apply({ type: "detachAudio", ...parseInput("detach_audio", params) }, actor);
			case "remove_ranges":
				return this.store.apply({ type: "removeRanges", ...parseInput("remove_ranges", params) }, actor);
			case "remove_silence": {
				const input = parseInput("remove_silence", params);
				return this.job(input.dryRun ? "Finding pauses" : "Removing pauses", () => this.store.removeSilence(actor, input));
			}
			case "duplicate_clips":
				return this.store.apply({ type: "duplicateClips", ...parseInput("duplicate_clips", params) }, actor);
			case "select_clips":
				this.selectClips(parseInput("select_clips", params).ids);
				return { selected: this.selectedClipIds };

			case "set_lines":
				return this.store.apply({ type: "setLines", lines: parseInput("set_lines", params).lines }, actor);
			case "import_script": {
				const { file, replace } = parseInput("import_script", params);
				const text = await fs.readFile(path.resolve(file), "utf8");
				const lines = file.toLowerCase().endsWith(".srt") ? parseSrt(text) : (JSON.parse(text) as LineInput[]);
				return this.store.apply({ type: "setLines", lines: replace ? lines : [...this.store.current.lines, ...lines] }, actor);
			}
			case "add_line":
				return this.store.apply({ type: "addLine", line: parseInput("add_line", params).line }, actor);
			case "update_line": {
				const { id, patch } = parseInput("update_line", params);
				const result = this.store.apply({ type: "updateLine", id, patch }, actor);
				if (this.selectedLineId === id && patch.id) this.selectedLineId = patch.id;
				return result;
			}
			case "remove_line":
				return this.store.apply({ type: "removeLine", id: parseInput("remove_line", params).id }, actor);
			case "shift_lines":
				return this.store.apply({ type: "shiftLines", ...parseInput("shift_lines", params), withClips: true }, actor);
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
				return this.describeTake(this.requireLine(lineId), await this.store.importTake(lineId, file, actor, recordedAtMs));
			}
			case "list_takes": {
				const { lineId } = parseInput("list_takes", params);
				const lines = this.lines().filter((l) => !lineId || l.id === lineId);
				if (lineId && lines.length === 0) throw new Error(`No line "${lineId}".`);
				return lines.map((l) => ({ lineId: l.id, chosen: l.chosenAssetId, status: l.status, takes: l.takes.map((t) => this.describeTake(l, t)) }));
			}
			case "choose_take":
				return this.store.apply({ type: "chooseTake", ...parseInput("choose_take", params) }, actor);
			case "delete_take":
				return this.store.apply({ type: "deleteTake", assetId: parseInput("delete_take", params).assetId }, actor);

			case "generate_take": {
				const { lineId, ...overrides } = parseInput("generate_take", params);
				const creds = await this.requireCredentials();
				const take = await this.job(`Generating voice for ${lineId}`, () => this.store.generateTake(lineId, creds, actor, overrides));
				return this.describeTake(this.requireLine(lineId), take);
			}
			case "generate_voiceover": {
				const input = parseInput("generate_voiceover", params);
				const creds = await this.requireCredentials();
				const targets = this.lines().filter((l) => (!input.lineIds || input.lineIds.includes(l.id)) && (!input.onlyMissing || l.status === "empty"));
				const results: unknown[] = [];
				await this.job(`Generating ${targets.length} voice take(s)`, async (progress) => {
					for (const [i, l] of targets.entries()) {
						const take = await this.store.generateTake(l.id, creds, actor, { voice: input.voice, instructions: input.instructions });
						results.push(this.describeTake(this.requireLine(l.id), take));
						progress((i + 1) / targets.length);
					}
				});
				return results;
			}
			case "auto_captions": {
				const input = parseInput("auto_captions", params);
				const creds = await this.requireCredentials();
				return this.job("Transcribing captions", () => this.store.autoCaptions(creds, actor, input));
			}
			case "script_from_media": {
				const { assetId, idPrefix, replace } = parseInput("script_from_media", params);
				const creds = await this.requireCredentials();
				const count = await this.job("Transcribing script", () => this.store.scriptFromMedia(assetId, creds, actor, { idPrefix, replace }));
				return { lines: count };
			}
			case "generate_image": {
				const { prompt, orientation, trackId, startMs } = parseInput("generate_image", params);
				const creds = await this.requireCredentials();
				const asset = await this.job("Generating image", () => this.store.generateImage(prompt, creds, actor, { orientation, place: trackId ? { trackId, startMs } : undefined }));
				return this.describeAsset(asset);
			}

			case "seek":
				return this.command({ type: "seek", ms: parseInput("seek", params).ms });
			case "play":
				return this.command({ type: "play", ...parseInput("play", params) });
			case "pause":
				return this.command({ type: "pause" });
			case "preview_media":
				return this.command({ type: "previewAsset", assetId: parseInput("preview_media", params).assetId });

			case "update_settings":
				return this.store.apply({ type: "updateSettings", settings: parseInput("update_settings", params).settings }, actor);
			case "update_export":
				return this.store.apply({ type: "updateExport", export: parseInput("update_export", params).export }, actor);
			case "update_ai":
				return this.store.apply({ type: "updateAi", ai: parseInput("update_ai", params).ai }, actor);
			case "add_marker":
				return this.store.apply({ type: "addMarker", ...parseInput("add_marker", params) }, actor);
			case "remove_marker":
				return this.store.apply({ type: "removeMarker", id: parseInput("remove_marker", params).id }, actor);
			case "undo":
				return { undone: this.store.undo(actor) };
			case "redo":
				return { redone: this.store.redo(actor) };
			case "export": {
				const { kind, out } = parseInput("export", params);
				return this.job(`Exporting ${kind}`, () => this.store.export(kind, out, actor, this.hooks.renderText));
			}
			case "focus_window":
				this.hooks.focusWindow();
				return { focused: true };
		}
	}

	// -------------------------------------------------------------------------

	private async job<T>(label: string, run: (progress: (fraction: number) => void) => Promise<T>): Promise<T> {
		const id = `j${++this.seq}`;
		const update = (patch: Partial<JobStatus>) => {
			this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
			this.changed();
		};
		this.jobs = [...this.jobs.filter((j) => j.state === "running"), { id, label, progress: null, state: "running" }];
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

	private async requireCredentials(): Promise<AiCredentials> {
		const creds = await this.hooks.credentials();
		if (!creds) throw new Error("No AI provider is set up. Add an OpenAI API key in Cue → Settings → AI.");
		return creds;
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
		if (!this.recorder.uiReady) throw new Error("The Cue window is not ready. Call focus_window and try again.");
		if (this.recorder.recordingLineId) throw new Error(`Already recording ${this.recorder.recordingLineId}.`);
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
			usedBy: this.store.current.clips.filter((c) => c.type === "media" && c.assetId === a.id).map((c) => c.id),
		};
	}

	private describeTake(l: LineView, take: Asset) {
		const speech = speechOf(take);
		const chosen = this.store.snapshot()?.lines.find((x) => x.id === l.id)?.chosenAssetId === take.id;
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
			recorder: this.recorder,
			aiConfigured: this.aiConfigured,
		};
	}

	private async refreshRecent() {
		this.recent = await this.store.recent();
		this.changed();
	}
}
