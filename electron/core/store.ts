import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type AiCredentials, chunkCaptions, generateImage, synthesizeSpeech, transcribe } from "./ai";
import { exportAudioMix, exportStems, exportVideo, exportVoiceover, type ExportReport } from "./exporter";
import { analyseSpeech, computePeaks, extractThumbnails, kindOf, probe, toWav } from "./media";
import { type InternalOp, type Op, applyOp } from "./ops";
import {
	DEFAULT_TEXT_STYLE,
	type LineInput,
	PROJECT_EXTENSION,
	deriveLines,
	emptyProject,
	newId,
	parseProject,
	projectDuration,
	relativeToProject,
	resolveInProject,
} from "./project";
import { parseSrt } from "./srt";
import type { ActivityEntry, Actor, Asset, ProjectData, ProjectSnapshot, RecentProject, TextClip } from "./types";

const HISTORY_LIMIT = 150;
const ACTIVITY_LIMIT = 200;
const CACHE_DIR = ".cue-cache";

export interface CreateProjectOptions {
	/** Project file or directory. A directory gets `<name>.cue.json`. */
	path: string;
	name?: string;
	/** A video to start from: imported and placed on the first video track. */
	video?: string | null;
	/** Import the voiceover script from subtitles. */
	srt?: string;
	/** Or pass the script lines directly. */
	lines?: LineInput[];
}

export interface StoreOptions {
	/** Turns an absolute path into a URL the editor window can load. */
	mediaUrl: (file: string) => string;
	recentFile: string;
}

type TextRenderer = (clips: TextClip[]) => Promise<Record<string, string>>;

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

	constructor(private readonly options: StoreOptions) {
		super();
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

	snapshot(): ProjectSnapshot | null {
		if (!this.data || !this.file) return null;
		const dir = path.dirname(this.file);
		return {
			path: this.file,
			dir,
			data: this.data,
			assetUrls: Object.fromEntries(this.data.assets.map((a) => [a.id, this.options.mediaUrl(resolveInProject(dir, a.path))])),
			durationMs: projectDuration(this.data),
			lines: deriveLines(this.data),
			canUndo: this.past.length > 0,
			canRedo: this.future.length > 0,
			dirty: this.dirty,
		};
	}

	getActivity(): ActivityEntry[] {
		return this.activity;
	}

	log(actor: Actor, summary: string): void {
		this.activity = [{ id: ++this.activityId, at: new Date().toISOString(), actor, summary }, ...this.activity].slice(0, ACTIVITY_LIMIT);
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
		this.file = target;
		this.data = data;
		this.past = [];
		this.future = [];
		this.dirty = false;
		await this.remember();
		this.log(actor, `Opened ${path.basename(target)}`);
		this.emit("change");
	}

	async create(options: CreateProjectOptions, actor: Actor = "user"): Promise<void> {
		let target = path.resolve(options.path);
		const name = options.name ?? path.basename(target).replace(PROJECT_EXTENSION, "").replace(/\.json$/, "");
		const isDir = (await fs.stat(target).catch(() => null))?.isDirectory() || !target.endsWith(".json");
		if (isDir) target = path.join(target, `${slug(name)}${PROJECT_EXTENSION}`);
		if (await fs.stat(target).catch(() => null)) throw new Error(`${target} already exists. Open it instead.`);
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
			if (asset.width && asset.height) this.apply({ type: "setCanvas", canvas: { width: asset.width, height: asset.height } }, "system");
		}
		this.past = [];
		this.log(actor, `Created "${name}"`);
		this.emit("change");
	}

	async flush(): Promise<void> {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (!this.dirty || !this.file || !this.data) return;
		const tmp = `${this.file}.tmp`;
		await fs.writeFile(tmp, `${JSON.stringify(this.data, null, "\t")}\n`);
		await fs.rename(tmp, this.file);
		this.dirty = false;
		this.emit("change");
	}

	async recent(): Promise<RecentProject[]> {
		try {
			const list = JSON.parse(await fs.readFile(this.options.recentFile, "utf8")) as RecentProject[];
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
		this.past = [...this.past, before].slice(-HISTORY_LIMIT);
		this.future = [];
		this.data = data;
		this.touch();
		this.log(actor, summary);
		return { summary, created };
	}

	undo(actor: Actor): boolean {
		const previous = this.past.at(-1);
		if (!previous || !this.data) return false;
		this.past = this.past.slice(0, -1);
		this.future = [this.data, ...this.future];
		this.data = previous;
		this.touch();
		this.log(actor, "Undo");
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
	async importMedia(files: string[], actor: Actor, place?: { trackId: string; startMs: number }): Promise<Asset[]> {
		const added: Asset[] = [];
		let at = place?.startMs ?? 0;
		for (const file of files) {
			const resolved = path.resolve(file);
			const kind = kindOf(resolved);
			if (!kind) throw new Error(`Unsupported file type: ${path.basename(resolved)}`);
			const info = await probe(resolved);
			const asset: Asset = {
				id: newId("a"),
				kind,
				name: path.basename(resolved),
				path: relativeToProject(this.projectDir, resolved),
				durationMs: kind === "image" ? 0 : info.durationMs,
				width: info.width,
				height: info.height,
				hasAudio: kind === "audio" ? true : info.hasAudio,
				origin: "import",
				createdAt: new Date().toISOString(),
				actor,
			};
			this.apply({ type: "addAsset", asset, placeOn: place ? { trackId: place.trackId, startMs: at } : undefined }, actor);
			at += kind === "image" ? 5000 : asset.durationMs;
			added.push(asset);
		}
		return added;
	}

	/** Turns a finished microphone recording into a take for a line. */
	async addRecording(input: { lineId: string; audio: Buffer; extension: string; recordedAtMs: number; actor: Actor }): Promise<Asset> {
		const line = this.requireLine(input.lineId);
		const count = this.current.assets.filter((a) => a.lineId === line.id).length + 1;
		const folder = path.join(this.projectDir, "takes", safeSegment(line.id));
		await fs.mkdir(folder, { recursive: true });
		const base = `${safeSegment(line.id)}-take${String(count).padStart(2, "0")}-${Date.now().toString(36)}`;
		const raw = path.join(folder, `${base}.source.${input.extension.replace(/[^a-z0-9]/gi, "") || "webm"}`);
		const wav = path.join(folder, `${base}.wav`);
		await fs.writeFile(raw, input.audio);
		try {
			await toWav(raw, wav);
		} finally {
			await fs.rm(raw, { force: true });
		}
		return this.addTakeFile(line.id, wav, "recording", input.actor, { recordedAtMs: Math.round(input.recordedAtMs), name: `Take ${count}` });
	}

	/** Generates a spoken take for a line with text-to-speech. */
	async generateTake(lineId: string, creds: AiCredentials, actor: Actor, overrides: { voice?: string; instructions?: string; text?: string } = {}): Promise<Asset> {
		const line = this.requireLine(lineId);
		const ai = this.current.ai;
		const voice = overrides.voice ?? ai.voice;
		const text = overrides.text ?? line.text;
		if (!text.trim()) throw new Error(`Line ${lineId} has no text.`);
		const audio = await synthesizeSpeech(creds, { text, model: ai.ttsModel, voice, instructions: overrides.instructions ?? ai.voiceInstructions });
		const folder = path.join(this.projectDir, "takes", safeSegment(line.id));
		await fs.mkdir(folder, { recursive: true });
		const count = this.current.assets.filter((a) => a.lineId === line.id).length + 1;
		const wav = path.join(folder, `${safeSegment(line.id)}-ai-${voice}-${Date.now().toString(36)}.wav`);
		await fs.writeFile(wav, audio);
		return this.addTakeFile(line.id, wav, "tts", actor, {
			name: `AI ${voice} ${count}`,
			generation: { provider: "openai", model: ai.ttsModel, prompt: text, voice },
		});
	}

	/** Uses an existing audio file as a take for a line. */
	async importTake(lineId: string, file: string, actor: Actor, recordedAtMs?: number): Promise<Asset> {
		this.requireLine(lineId);
		const source = path.resolve(file);
		const folder = path.join(this.projectDir, "takes", safeSegment(lineId));
		await fs.mkdir(folder, { recursive: true });
		const wav = path.join(folder, `${path.parse(source).name}-${Date.now().toString(36)}.wav`);
		await toWav(source, wav);
		return this.addTakeFile(lineId, wav, "import", actor, { recordedAtMs, name: path.basename(source) });
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
		creds: AiCredentials,
		actor: Actor,
		options: { orientation?: "landscape" | "portrait" | "square"; place?: { trackId: string; startMs: number } } = {},
	): Promise<Asset> {
		const size = ({ landscape: "1536x1024", portrait: "1024x1536", square: "1024x1024" } as const)[options.orientation ?? "landscape"];
		const png = await generateImage(creds, { prompt, model: this.current.ai.imageModel, size });
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
		creds: AiCredentials,
		actor: Actor,
		options: { source: "voiceover" | "mix"; trackId?: string; maxChars?: number; language?: string },
	): Promise<{ count: number; trackId: string }> {
		const tmp = path.join(os.tmpdir(), `cue-captions-${Date.now()}.wav`);
		try {
			if (options.source === "voiceover") await exportVoiceover(this.exportContext(), tmp);
			else await exportAudioMix(this.exportContext(), tmp);
			const hint = this.current.lines.map((l) => l.text).join(" ").slice(0, 800);
			const { segments } = await transcribe(creds, { file: tmp, model: this.current.ai.transcriptionModel, language: options.language, prompt: hint || undefined });
			const chunks = chunkCaptions(segments, options.maxChars ?? 42);
			const trackId = options.trackId ?? this.apply({ type: "addTrack", kind: "text", name: "Captions", index: 0 }, actor).created?.[0];
			if (!trackId) throw new Error("Could not create a captions track.");
			if (chunks.length === 0) return { count: 0, trackId };
			const style = { ...DEFAULT_TEXT_STYLE, fontSize: 46, fontWeight: 600, y: 0.9, width: 0.86, padding: 14, radius: 10 };
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
	async scriptFromMedia(assetId: string, creds: AiCredentials, actor: Actor, options: { idPrefix?: string; replace?: boolean } = {}): Promise<number> {
		const { segments } = await transcribe(creds, { file: this.assetPath(assetId), model: this.current.ai.transcriptionModel });
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
		this.apply({ type: "setLines", lines: options.replace === false ? [...this.current.lines, ...lines] : lines }, actor);
		return lines.length;
	}

	async peaks(assetId: string): Promise<number[]> {
		const cache = path.join(this.projectDir, CACHE_DIR, "peaks", `${assetId}.json`);
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
		const dir = path.join(this.projectDir, CACHE_DIR, "thumbs", assetId);
		const meta = path.join(dir, "meta.json");
		let info: { intervalMs: number; count: number };
		try {
			info = JSON.parse(await fs.readFile(meta, "utf8"));
		} catch {
			await fs.rm(dir, { recursive: true, force: true });
			info = await extractThumbnails(this.assetPath(assetId), dir, asset.durationMs);
			await fs.writeFile(meta, JSON.stringify(info));
		}
		const urls = Array.from({ length: info.count }, (_, i) => this.options.mediaUrl(path.join(dir, `${String(i + 1).padStart(4, "0")}.jpg`)));
		return { intervalMs: info.intervalMs, urls };
	}

	// -------------------------------------------------------------------------
	// Export
	// -------------------------------------------------------------------------

	exportContext(renderText?: TextRenderer, onProgress?: (fraction: number) => void) {
		return { dir: this.projectDir, data: this.current, renderText, onProgress };
	}

	async export(kind: "stems" | "voiceover" | "audio" | "video", out: string | undefined, actor: Actor, renderText?: TextRenderer): Promise<ExportReport> {
		const ctx = this.exportContext(renderText);
		const target = out ? path.resolve(this.projectDir, out) : undefined;
		const report =
			kind === "stems"
				? await exportStems(ctx, target)
				: kind === "voiceover"
					? await exportVoiceover(ctx, target)
					: kind === "audio"
						? await exportAudioMix(ctx, target ?? path.join(this.projectDir, "export", "mix.wav"))
						: await exportVideo(ctx, target);
		this.log(actor, `Exported ${kind} → ${report.outputs.map((f) => path.basename(f)).join(", ")}${report.missing.length ? ` (no take yet: ${report.missing.join(", ")})` : ""}`);
		return report;
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
		this.dirty = true;
		this.emit("change");
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.flush().catch((error) => this.emit("error", error)), 400);
	}

	private async findProjectIn(dir: string): Promise<string> {
		const entries = await fs.readdir(dir);
		const match = entries.find((entry) => entry.endsWith(PROJECT_EXTENSION));
		if (!match) throw new Error(`No ${PROJECT_EXTENSION} file in ${dir}.`);
		return path.join(dir, match);
	}

	private async remember(): Promise<void> {
		if (!this.file || !this.data) return;
		const entry: RecentProject = { path: this.file, name: this.data.name, openedAt: new Date().toISOString() };
		const list = [entry, ...(await this.recent()).filter((item) => item.path !== this.file)].slice(0, 12);
		await fs.mkdir(path.dirname(this.options.recentFile), { recursive: true });
		await fs.writeFile(this.options.recentFile, JSON.stringify(list, null, 2));
	}
}

function slug(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

function safeSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}
