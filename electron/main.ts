import { createReadStream, existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	protocol,
	safeStorage,
	screen,
	session,
	shell,
	systemPreferences,
} from "electron";
import { loadChats, saveAttachment, saveChats } from "./agents/chats";
import {
	type ChatEvent,
	detectHarnesses,
	type HarnessId,
	type HarnessInfo,
	runHarness,
} from "./agents/harness";
import { contract, type MethodName } from "./control/contract";
import { startControlServer } from "./control/server";
import { Controller } from "./controller";
import type { AiCredentials } from "./core/ai";
import { type CaptureSources, WALLPAPERS } from "./core/capture";
import { cursorBinary, studioDir } from "./core/cursor";
import { diffSnapshot } from "./core/delta";
import type { TextRender } from "./core/exporter";
import {
	detectLocal,
	downloadWhisperModel,
	type LocalInventory,
	startOllama,
	WHISPER_DOWNLOADS,
} from "./core/local-ai";
import { mcpClients } from "./core/mcpClients";
import { ffmpeg } from "./core/media";
import { resolveInProject } from "./core/paths";
import { isProjectFile, PROJECT_EXTENSION } from "./core/project";
import { type AppSettings, appSettingsSchema, buildRuntime } from "./core/runtime";
import { captureBinary } from "./core/screenrec";
import { ProjectStore } from "./core/store";
import type {
	Asset,
	DenoiseMode,
	EditorCommand,
	MediaClip,
	ProjectSnapshot,
	RecorderStatus,
	TextClip,
} from "./core/types";
import type { UpdateStatus } from "./core/updates";
import { Updater } from "./updater";

app.setName("Cue");
const MEDIA_SCHEME = "cue-media";
protocol.registerSchemesAsPrivileged([
	{
		scheme: MEDIA_SCHEME,
		privileges: {
			standard: true,
			secure: true,
			stream: true,
			supportFetchAPI: true,
			corsEnabled: true,
		},
	},
]);

let win: BrowserWindow | null = null;
// Development: a separate data folder lets a second copy run next to the installed app.
if (process.env.CUE_USER_DATA) app.setPath("userData", process.env.CUE_USER_DATA);
const dataDir = app.getPath("userData");
/** Development: render offscreen and save frames here (for recording demos). */
const recordFrames = process.env.CUE_RECORD_FRAMES;
/** Frames are rendered this many times sharper than the 1440×900 layout. */
const recordScale = Number(process.env.CUE_RECORD_SCALE ?? "1.5");
const secretsFile = path.join(dataDir, "secrets.bin");
const mediaUrl = (file: string) => `${MEDIA_SCHEME}://local/${encodeURIComponent(file)}`;

// ---------------------------------------------------------------------------
// Window round-trips (text rasterising and frame capture happen in the editor)
// ---------------------------------------------------------------------------

const waiting = new Map<
	string,
	{ resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let requestSeq = 0;

function askWindow<T>(
	command: (requestId: string) => EditorCommand,
	timeoutMs = 60000,
): Promise<T> {
	if (!win || win.isDestroyed()) return Promise.reject(new Error("The Cue window is not open."));
	const requestId = `w${++requestSeq}`;
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			waiting.delete(requestId);
			reject(new Error("The editor window did not respond."));
		}, timeoutMs);
		waiting.set(requestId, {
			resolve: (value) => {
				clearTimeout(timer);
				resolve(value as T);
			},
			reject: (error) => {
				clearTimeout(timer);
				reject(error);
			},
		});
		win?.webContents.send("cue:command", command(requestId));
	});
}

async function renderText(
	clips: (TextClip | MediaClip)[],
	canvas?: { width: number; height: number },
	sizes?: Record<string, { width: number; height: number }>,
	onProgress?: (done: number, total: number) => void,
	source?: { dir: string; assets: Asset[] },
): Promise<Record<string, TextRender>> {
	const fps = store.current.canvas.fps;
	// Clips from another project (placed as media) bring their motion graphics with them:
	// the window gets their data and may read their files for this render.
	const foreign = source && (!store.isOpen || path.resolve(source.dir) !== store.projectDir);
	const assets = foreign
		? Object.fromEntries(
				source.assets
					.filter(
						(a) =>
							a.kind === "lottie" &&
							a.motion &&
							clips.some((c) => c.type === "media" && c.assetId === a.id),
					)
					.map((a) => {
						const file = resolveInProject(source.dir, a.path);
						extraServable.add(path.resolve(file));
						return [
							a.id,
							{ motion: a.motion as NonNullable<Asset["motion"]>, url: mediaUrl(file) },
						];
					}),
			)
		: undefined;
	const root = path.join(store.cacheDir(), "text");
	const out: Record<string, TextRender> = {};
	// Text is quick and goes in one request; each motion graphic gets its own, with
	// time for its length, so a long edit full of graphics never runs out of time
	// (and its frames are written as they come instead of all held at once).
	// Animated text (typewriter, fades, word styles) is rendered frame by frame like a
	// graphic, so it gets its own request and time for its frames: an edit with twenty
	// typed-on labels used to share one request timed as twenty stills, and timed out.
	const animated = (c: TextClip | MediaClip) =>
		c.type === "text" &&
		((c.animationIn ?? "none") !== "none" ||
			(c.animationOut ?? "none") !== "none" ||
			!!c.wordStyle);
	const stills = clips.filter((c) => c.type === "text" && !animated(c));
	const batches = [
		...(stills.length ? [stills] : []),
		...clips.filter((c) => c.type !== "text" || animated(c)).map((c) => [c]),
	];
	let done = 0;
	for (const batch of batches) {
		const frames = batch.reduce(
			(n, c) =>
				n + (c.type === "text" && !animated(c) ? 1 : Math.ceil((c.durationMs / 1000) * fps)),
			0,
		);
		const images = await askWindow<Record<string, { still?: ArrayBuffer; frames?: ArrayBuffer[] }>>(
			// The clips travel with the request: they may belong to a sequence that is not open.
			(requestId) => ({
				type: "renderText",
				requestId,
				clipIds: batch.map((c) => c.id),
				clips: batch,
				fps,
				...canvas,
				...(sizes ? { sizes } : {}),
				...(assets ? { assets } : {}),
			}),
			60000 + frames * 250,
		);
		for (const [id, image] of Object.entries(images)) {
			// A graphic that never changes over the clip is a still, not hundreds of identical frames.
			if (image.frames?.length && image.frames.every((f) => f === image.frames?.[0]))
				image.still = image.frames[0];
			if (image.frames?.length && !image.still) {
				const dir = path.join(root, id);
				await fs.rm(dir, { recursive: true, force: true });
				await fs.mkdir(dir, { recursive: true });
				// A still stretch of a graphic arrives as the same buffer repeated: write it
				// once and link the other frame files to it.
				const written = new Map<ArrayBuffer, string>();
				for (const [i, frame] of image.frames.entries()) {
					const file = path.join(dir, `${String(i).padStart(5, "0")}.png`);
					const first = written.get(frame);
					if (first) await fs.link(first, file).catch(() => fs.copyFile(first, file));
					else {
						await fs.writeFile(file, Buffer.from(frame));
						written.set(frame, file);
					}
				}
				out[id] = { kind: "sequence", pattern: path.join(dir, "%05d.png"), fps };
			} else if (image.still) {
				await fs.mkdir(root, { recursive: true });
				const file = path.join(root, `${id}.png`);
				await fs.writeFile(file, Buffer.from(image.still));
				out[id] = { kind: "still", file };
			}
		}
		done += batch.length;
		onProgress?.(done, clips.length);
	}
	return out;
}

async function captureFrame(atMs: number): Promise<string> {
	// A minimised or hidden window draws nothing to capture: bring it back without taking focus.
	// (Offscreen demo recording draws without a visible window: showing it would only show a placeholder.)
	if (!recordFrames && win && !win.isDestroyed() && (win.isMinimized() || !win.isVisible())) {
		if (win.isMinimized()) win.restore();
		win.showInactive();
	}
	const rect = await askWindow<{ x: number; y: number; width: number; height: number }>(
		(requestId) => ({ type: "captureFrame", requestId, atMs }),
	);
	if (!win) throw new Error("The Cue window is not open.");
	const view = win;
	const area = {
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		width: Math.round(rect.width),
		height: Math.round(rect.height),
	};
	// A big picture shown for the first time is painted in tiles after it decodes: capture
	// until two captures a moment apart agree (moving grain can keep them apart; 4 at most).
	const settled = async () => {
		let image = await view.webContents.capturePage(area);
		for (let i = 0; i < 3; i++) {
			await new Promise((resolve) => setTimeout(resolve, 120));
			const next = await view.webContents.capturePage(area);
			const same = next.toBitmap().equals(image.toBitmap());
			image = next;
			if (same) break;
		}
		return image;
	};
	const image = await settled().finally(() => {
		// The window put its guides and zoom away for the capture; they come back now.
		if (win && !win.isDestroyed()) win.webContents.send("cue:command", { type: "captureDone" });
	});
	const dir = path.join(store.cacheDir(), "frames");
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(dir, `frame-${Math.round(atMs)}.png`);
	await fs.writeFile(file, image.toPNG());
	return file;
}

// ---------------------------------------------------------------------------
// Screen and camera recording
// ---------------------------------------------------------------------------

/** macOS permission for screen, camera or microphone (always granted elsewhere). */
function mediaAccess(kind: "screen" | "camera" | "microphone"): string {
	return process.platform === "darwin" ? systemPreferences.getMediaAccessStatus(kind) : "granted";
}

/** Screens and windows that can be recorded, plus cameras and microphones (asked of the window). */
async function captureSources(thumbnails = false): Promise<CaptureSources> {
	let sources: CaptureSources["sources"] = [];
	try {
		const found = await desktopCapturer.getSources({
			types: ["screen", "window"],
			thumbnailSize: thumbnails ? { width: 320, height: 200 } : { width: 0, height: 0 },
			fetchWindowIcons: false,
		});
		sources = found.map((s) => ({
			id: s.id,
			name: s.name,
			kind: s.id.startsWith("screen:") ? "screen" : "window",
			...(thumbnails && !s.thumbnail.isEmpty() ? { thumbnail: s.thumbnail.toDataURL() } : {}),
		}));
	} catch (error) {
		store.log("system", `Could not list screens: ${(error as Error).message}`);
	}
	const devices = await askWindow<{
		cameras: CaptureSources["cameras"];
		microphones: CaptureSources["microphones"];
	}>((requestId) => ({ type: "listDevices", requestId }), 5000).catch(() => ({
		cameras: [],
		microphones: [],
	}));
	return {
		sources,
		screenAccess: mediaAccess("screen"),
		cameraAccess: mediaAccess("camera"),
		microphoneAccess: mediaAccess("microphone"),
		...devices,
	};
}

/**
 * What the pointer is measured against: a screen's bounds (in points, like the
 * pointer), or a window's id (its bounds come from cue-cursor as it moves).
 */
async function pointerTarget(sourceId: string): Promise<{
	region: { x: number; y: number; w: number; h: number } | null;
	windowId?: number;
	displayId?: number;
}> {
	const window = /^window:(\d+):/.exec(sourceId);
	if (window) return { region: null, windowId: Number(window[1]) };
	let displayId: string | undefined;
	if (sourceId.startsWith("screen:")) {
		const found = await desktopCapturer
			.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
			.catch(() => []);
		displayId = found.find((s) => s.id === sourceId)?.display_id;
	}
	const display =
		screen.getAllDisplays().find((d) => String(d.id) === displayId) ?? screen.getPrimaryDisplay();
	const b = display.bounds;
	return { region: { x: b.x, y: b.y, w: b.width, h: b.height }, displayId: display.id };
}

/** The screen or window the window's next getDisplayMedia() call records. */
let displaySource: string | null = null;

/** Hands the chosen source to getDisplayMedia (Electron has no picker of its own). */
async function handleDisplayMedia(
	_request: Electron.DisplayMediaRequestHandlerHandlerRequest,
	callback: (streams: Electron.Streams) => void,
) {
	const wanted = displaySource;
	displaySource = null;
	try {
		const found = await desktopCapturer.getSources({
			types: ["screen", "window"],
			thumbnailSize: { width: 0, height: 0 },
		});
		const source =
			found.find((s) => s.id === wanted) ??
			(wanted === "screen" || !wanted ? found.find((s) => s.id.startsWith("screen:")) : undefined);
		// No streams at all makes getDisplayMedia fail, which the window explains.
		callback(source ? { video: source } : {});
	} catch {
		callback({});
	}
}

// ---------------------------------------------------------------------------
// Credentials: stored encrypted with the OS keychain via safeStorage
// ---------------------------------------------------------------------------

async function credentials(): Promise<AiCredentials | null> {
	try {
		const raw = await fs.readFile(secretsFile);
		const parsed = JSON.parse(safeStorage.decryptString(raw)) as { openai?: string };
		if (parsed.openai) return { apiKey: parsed.openai };
	} catch {}
	return process.env.OPENAI_API_KEY ? { apiKey: process.env.OPENAI_API_KEY } : null;
}

async function saveApiKey(key: string | null): Promise<void> {
	if (!key) {
		await fs.rm(secretsFile, { force: true });
		return;
	}
	if (!safeStorage.isEncryptionAvailable())
		throw new Error("Secure storage is not available on this system.");
	await fs.mkdir(dataDir, { recursive: true });
	await fs.writeFile(
		secretsFile,
		safeStorage.encryptString(JSON.stringify({ openai: key.trim() })),
		{ mode: 0o600 },
	);
}

// ---------------------------------------------------------------------------
// App settings and local models
// ---------------------------------------------------------------------------

const settingsFile = path.join(dataDir, "settings.json");
let appSettings: AppSettings = appSettingsSchema.parse({});
let inventory: LocalInventory | null = null;
let inventoryAt = 0;

async function loadAppSettings() {
	try {
		appSettings = appSettingsSchema.parse(JSON.parse(await fs.readFile(settingsFile, "utf8")));
	} catch {
		appSettings = appSettingsSchema.parse({});
	}
	if (!appSettings.projectsDir) appSettings.projectsDir = path.join(app.getPath("videos"), "Cue");
	await fs.mkdir(appSettings.projectsDir, { recursive: true }).catch(() => {});
}

async function saveAppSettings(patch: Partial<AppSettings>) {
	const wasAutoUpdate = appSettings.autoUpdate;
	const wasAutoInstall = appSettings.autoInstallUpdates;
	appSettings = appSettingsSchema.parse({
		...appSettings,
		...patch,
		...(patch.autoInstallUpdates === true ? { autoUpdate: true } : {}),
		...(patch.autoUpdate === false ? { autoInstallUpdates: false } : {}),
		ai: { ...appSettings.ai, ...patch.ai },
		agent: { ...appSettings.agent, ...patch.agent },
		editor: { ...appSettings.editor, ...patch.editor },
	});
	await fs.mkdir(dataDir, { recursive: true });
	await fs.writeFile(settingsFile, JSON.stringify(appSettings, null, 2));
	await controller.refreshAi();
	win?.webContents.send("cue:appSettings", appSettings);
	if (appSettings.autoUpdate !== wasAutoUpdate) updater?.schedule();
	if (appSettings.autoInstallUpdates !== wasAutoInstall)
		updater?.setAutoInstall(appSettings.autoInstallUpdates);
}

let inventoryScan: Promise<LocalInventory> | null = null;

function scanInventory(): Promise<LocalInventory> {
	inventoryScan ??= detectLocal(dataDir)
		.then((found) => {
			inventory = found;
			inventoryAt = Date.now();
			return found;
		})
		.finally(() => {
			inventoryScan = null;
		});
	return inventoryScan;
}

/**
 * Local models and voices. Scanning takes most of a second (it asks macOS for
 * its voices and probes Ollama and LM Studio), so the last result is returned
 * straight away and refreshed in the background.
 */
async function localInventory(force = false): Promise<LocalInventory> {
	if (force || !inventory) return scanInventory();
	if (Date.now() - inventoryAt > 15000) void scanInventory();
	return inventory;
}

async function runtime() {
	return buildRuntime(appSettings, await credentials(), await localInventory());
}

// ---------------------------------------------------------------------------

const store = new ProjectStore({
	mediaUrl,
	recentFile: path.join(dataDir, "recent.json"),
	autoProxies: () => appSettings.editor.autoProxies,
	reviewAgentEdits: () => appSettings.agent.review,
});
const controller = new Controller(store, {
	sendCommand: (command) => {
		if (!win || win.isDestroyed()) return false;
		win.webContents.send("cue:command", command);
		return true;
	},
	focusWindow: () => {
		if (!win || win.isDestroyed()) createWindow();
		else {
			if (win.isMinimized()) win.restore();
			win.show();
			win.focus();
		}
	},
	renderText,
	captureFrame,
	runtime,
	projectsDir: () => appSettings.projectsDir,
	captureSources: () => captureSources(false),
	recipesFile: path.join(dataDir, "recipes.json"),
	collectionsFile: path.join(dataDir, "collections.json"),
	appSettings: {
		get: () => appSettings,
		set: async (patch) => {
			await saveAppSettings(patch as Partial<AppSettings>);
			return appSettings;
		},
	},
});

let stateTimer: NodeJS.Timeout | null = null;
/** The project version the window has; unchanged projects aren't sent again. */
let sentProject: string | null = null;
/** The snapshot last sent, so an edit only sends what changed since. */
let sentSnapshot: ProjectSnapshot | null = null;
controller.on("state", () => {
	if (stateTimer) return;
	stateTimer = setTimeout(() => {
		stateTimer = null;
		if (!win || win.isDestroyed()) return;
		const key = store.snapshotKey;
		if (key === sentProject) {
			win.webContents.send("cue:state", controller.state(false), true);
			return;
		}
		sentProject = key;
		const snapshot = store.snapshot();
		const patch = sentSnapshot && snapshot ? diffSnapshot(sentSnapshot, snapshot) : null;
		sentSnapshot = snapshot;
		// A patch against the last sent version; another project or a reload gets it whole.
		if (patch) win.webContents.send("cue:state", controller.state(false), false, patch);
		else
			win.webContents.send("cue:state", { ...controller.state(false), project: snapshot }, false);
	}, 16);
});
store.on("error", (error: Error) => store.log("system", `Autosave failed: ${error.message}`));

// ---------------------------------------------------------------------------
// In-app agent chat through the user's own CLIs (Claude Code, Codex, Gemini)
// ---------------------------------------------------------------------------

const chats = new Map<
	string,
	{
		stop: () => void;
		steer: ((text: string, images: string[], uuid: string) => Promise<void>) | null;
	}
>();
let harnessCache: { at: number; list: Promise<HarnessInfo[]> } | null = null;

function listHarnesses(force = false) {
	if (!harnessCache || force || Date.now() - harnessCache.at > 30000)
		harnessCache = { at: Date.now(), list: detectHarnesses() };
	return harnessCache.list;
}

async function sendChat(
	chatId: string,
	input: {
		harness: HarnessId;
		prompt: string;
		sessionId?: string;
		model?: string;
		images?: string[];
		uuid?: string;
	},
) {
	if (!appSettings.agent.enabled)
		throw new Error("Agent access is turned off in Settings → Agent.");
	chats.get(chatId)?.stop();
	// Each turn has its own entry. Events from a turn that was replaced are dropped,
	// and a stop that arrives while the harness is still starting is applied once it runs.
	let handle: Awaited<ReturnType<typeof runHarness>> | null = null;
	let stopped = false;
	const entry = {
		stop: () => {
			stopped = true;
			handle?.stop();
		},
		// Until the harness has started, a steer can't be delivered: the renderer queues it instead.
		steer: null as ((text: string, images: string[], uuid: string) => Promise<void>) | null,
	};
	chats.set(chatId, entry);
	const current = () => chats.get(chatId) === entry;
	const emit = (event: ChatEvent) => {
		if (!current()) return;
		if (event.kind === "done") chats.delete(chatId);
		if (win && !win.isDestroyed()) win.webContents.send("cue:chatEvent", chatId, event);
	};
	try {
		handle = await runHarness(
			{
				...input,
				// Cue's own runtime runs the MCP bridge, so no separate Node install is needed.
				bridge: {
					command: process.execPath,
					args: [mcpScriptPath()],
					env: { ELECTRON_RUN_AS_NODE: "1", CUE_DATA_DIR: dataDir },
				},
				workDir: path.join(dataDir, "agent", input.harness),
			},
			emit,
		);
	} catch (error) {
		if (current()) chats.delete(chatId);
		throw error;
	}
	entry.steer = handle.steer;
	if (stopped) handle.stop();
}

/** The folder of the open project: where its conversations and attachments live. */
function chatDir() {
	const dir = store.snapshot()?.dir;
	if (!dir) throw new Error("Open a project first.");
	return dir;
}

/**
 * Tells the MCP bridge how to start Cue when it isn't running. An AppImage's
 * files only exist while it runs, so its bridge is copied to the data folder.
 */
async function recordLaunch() {
	try {
		await fs.writeFile(
			path.join(dataDir, "app.json"),
			JSON.stringify({ executable: process.env.APPIMAGE ?? process.execPath }),
		);
		if (process.env.APPIMAGE)
			await fs.cp(path.join(process.resourcesPath, "mcp"), path.join(dataDir, "mcp"), {
				recursive: true,
				force: true,
			});
	} catch (error) {
		store.log("system", `Could not record how to start Cue: ${(error as Error).message}`);
	}
}

function mcpScriptPath(): string {
	if (process.env.APPIMAGE) return path.join(dataDir, "mcp", "cue-mcp.mjs");
	// Demo recordings show the installed app's bridge (same code) rather than a development path.
	const installed = "/Applications/Cue.app/Contents/Resources/mcp/cue-mcp.mjs";
	if (recordFrames && existsSync(installed)) return installed;
	return app.isPackaged
		? path.join(process.resourcesPath, "mcp", "cue-mcp.mjs")
		: path.join(app.getAppPath(), "dist-mcp", "cue-mcp.mjs");
}

/** Only the open project's folder and its media may be streamed to the window. */
/** Files of another project the window may read while that project is rendered as media. */
const extraServable = new Set<string>();

function mayServe(file: string): boolean {
	const resolved = path.resolve(file);
	if (extraServable.has(resolved)) return true;
	// Poster frames for the projects overview, only next to a Cue project file.
	if (
		path.basename(resolved) === "poster.jpg" &&
		path.basename(path.dirname(resolved)) === ".cue-cache"
	) {
		const projectDir = path.dirname(path.dirname(resolved));
		return readdirSync(projectDir).some((entry) => isProjectFile(entry));
	}
	const snapshot = store.snapshot();
	if (!snapshot) return false;
	// Media in the project (including motion graphics, which are JSON) is served wherever it is.
	if (snapshot.data.assets.some((a) => resolveInProject(snapshot.dir, a.path) === resolved))
		return true;
	// Otherwise, inside the project folder: pictures and sound only (caches, renders, takes).
	return (
		resolved.startsWith(`${snapshot.dir}${path.sep}`) &&
		path.extname(resolved).toLowerCase() in MIME
	);
}

const MIME: Record<string, string> = {
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".wav": "audio/wav",
	".m4a": "audio/mp4",
	".mp3": "audio/mpeg",
	".aac": "audio/aac",
	".flac": "audio/flac",
	".ogg": "audio/ogg",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
};

async function serveMedia(request: Request): Promise<Response> {
	const file = decodeURIComponent(new URL(request.url).pathname.slice(1));
	if (!mayServe(file)) return new Response("Forbidden", { status: 403 });
	const stat = await fs.stat(file).catch(() => null);
	if (!stat?.isFile()) return new Response("Not found", { status: 404 });
	const ext = path.extname(file).toLowerCase();
	const type = MIME[ext] ?? (ext === ".json" ? "application/json" : "application/octet-stream");
	const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") ?? "");
	const cors = { "access-control-allow-origin": "*" };
	if (range) {
		const start = range[1] ? Number(range[1]) : 0;
		const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
		return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
			status: 206,
			headers: {
				...cors,
				"content-type": type,
				"content-length": String(end - start + 1),
				"content-range": `bytes ${start}-${end}/${stat.size}`,
				"accept-ranges": "bytes",
			},
		});
	}
	return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
		headers: {
			...cors,
			"content-type": type,
			"content-length": String(stat.size),
			"accept-ranges": "bytes",
		},
	});
}

/** Whether a text field has focus, so ⌘Z edits the text rather than the timeline. */
async function typing(): Promise<boolean> {
	if (!win || win.isDestroyed()) return false;
	return win.webContents
		.executeJavaScript(
			`(() => { const e = document.activeElement; return !!e && (e.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.tagName)); })()`,
		)
		.catch(() => false);
}

/**
 * macOS: the header doubles as the title bar, with the traffic lights inset.
 * Windows: the same, with the system's window buttons drawn over the header's
 * right end (its colours follow the theme, see cue:titleBarColors). Linux: the
 * desktop's own frame, since window button overlays vary by desktop.
 */
function windowChrome(): Electron.BrowserWindowConstructorOptions {
	if (process.platform === "darwin")
		return { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 18, y: 15 } };
	if (process.platform === "win32")
		return {
			titleBarStyle: "hidden",
			titleBarOverlay: { color: "#18181b", symbolColor: "#e4e4e7", height: 43 },
		};
	return { autoHideMenuBar: true };
}

function createWindow() {
	win = new BrowserWindow({
		width: 1560,
		height: 980,
		minWidth: 1180,
		minHeight: 760,
		title: "Cue",
		...windowChrome(),
		...(recordFrames
			? {
					width: Math.round(1440 * recordScale),
					height: Math.round(900 * recordScale),
					show: false,
					useContentSize: true,
				}
			: {}),
		backgroundColor: "#0f0f11",
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			sandbox: true,
			// Agents render frames and export while Cue is behind other windows or hidden:
			// the page must keep drawing then (throttled, it stops painting and captures hang).
			backgroundThrottling: false,
			...(recordFrames ? { offscreen: true } : {}),
		},
	});
	// Projects placed as media are rendered again when their files changed while Cue was in the background.
	win.on("focus", () => void controller.refreshProjectMedia());
	if (recordFrames) {
		// Frames are written while <dir>/on exists, named by the time they were painted.
		const flag = path.join(recordFrames, "on");
		win.webContents.setFrameRate(30);
		// Offscreen windows ignore the display scale; zoom keeps the 1440×900 layout at a sharper size.
		win.webContents.on("did-finish-load", () => win?.webContents.setZoomFactor(recordScale));
		let lastFrame = 0;
		win.webContents.on("paint", (_event, _dirty, image) => {
			if (!existsSync(flag)) return;
			lastFrame = Date.now();
			void fs.writeFile(path.join(recordFrames, `${lastFrame}.jpg`), image.toJPEG(90));
		});
		// Paint every frame while recording (a steady 30 fps, so motion in the app is smooth in the
		// edit even when nothing asks for a repaint).
		setInterval(() => {
			if (win && !win.isDestroyed() && existsSync(flag)) win.webContents.invalidate();
		}, 33);
	} else win.once("ready-to-show", () => win?.show());
	// A (re)loaded page has no project yet.
	win.webContents.on("did-start-loading", () => {
		sentProject = null;
		sentSnapshot = null;
	});
	win.on("closed", () => {
		win = null;
		sentProject = null;
		sentSnapshot = null;
		// Nothing will answer requests sent to the old window.
		for (const [id, request] of waiting) {
			waiting.delete(id);
			request.reject(new Error("The Cue window was closed."));
		}
		controller.updateRecorder({
			uiReady: false,
			micReady: false,
			recordingLineId: null,
			playing: false,
		});
		void controller.abortCapture("The Cue window was closed.");
	});
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	// The window only ever shows Cue. A dropped file or a stray link must not replace
	// it (a loaded page would get window.cue); web links open in the browser instead.
	win.webContents.on("will-navigate", (event, url) => {
		if (url === win?.webContents.getURL()) return;
		event.preventDefault();
		if (/^https?:/.test(url) && !url.startsWith(process.env.VITE_DEV_SERVER_URL ?? "\0"))
			void shell.openExternal(url);
	});
	win.webContents.on("will-attach-webview", (event) => event.preventDefault());
	if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
	else
		void win.loadFile(
			path.join(__dirname, "../dist/index.html"),
			recordFrames ? { query: { record: "1" } } : undefined,
		);
}

const PROJECT_FILTER = { name: "Cue project", extensions: ["cueproj", "json"] };
const isProject = (arg: string) => isProjectFile(arg);

/** Quick path from the menu: a folder per project inside the projects folder. */
async function newProjectDialog() {
	win?.webContents.send("cue:newProject");
}

async function openProjectDialog() {
	if (!win) return;
	const result = await dialog.showOpenDialog(win, {
		title: "Open a Cue project",
		defaultPath: appSettings.projectsDir,
		properties: ["openFile"],
		filters: [PROJECT_FILTER],
	});
	if (!result.canceled && result.filePaths[0])
		await controller.call("open_project", { path: result.filePaths[0] }, "user");
}

async function packageDialog() {
	if (!win || !store.isOpen) return;
	const result = await dialog.showSaveDialog(win, {
		title: "Package the project and its media",
		defaultPath: path.join(app.getPath("desktop"), `${store.current.name}.zip`),
		filters: [{ name: "Zip archive", extensions: ["zip"] }],
	});
	if (result.canceled || !result.filePath) return;
	const report = (await controller.call(
		"package_project",
		{ out: result.filePath, trim: true },
		"user",
	)) as { path?: string };
	if (report?.path) shell.showItemInFolder(report.path);
}

async function saveAsDialog() {
	if (!win || !store.isOpen) return;
	const result = await dialog.showSaveDialog(win, {
		title: "Save a copy of the project",
		defaultPath: path.join(
			appSettings.projectsDir,
			`${store.current.name} copy${PROJECT_EXTENSION}`,
		),
		filters: [{ name: "Cue project", extensions: ["cueproj"] }],
	});
	if (!result.canceled && result.filePath)
		await controller.call("save_project_as", { path: result.filePath }, "user");
}

const TIMELINE_FORMATS = {
	otio: {
		label: "OpenTimelineIO (Resolve, Premiere, Kdenlive)…",
		ext: "otio",
		name: "OpenTimelineIO",
	},
	fcpxml: { label: "Final Cut Pro XML (Final Cut, Resolve)…", ext: "fcpxml", name: "FCPXML" },
	mlt: { label: "MLT XML (Shotcut)…", ext: "mlt", name: "MLT XML" },
	edl: { label: "CMX3600 EDL…", ext: "edl", name: "EDL" },
} as const;

async function exportTimelineDialog(format: keyof typeof TIMELINE_FORMATS) {
	if (!win || !store.isOpen) return;
	const info = TIMELINE_FORMATS[format];
	const result = await dialog.showSaveDialog(win, {
		title: `Export the timeline as ${info.name}`,
		defaultPath: path.join(store.projectDir, "export", `${store.current.name}.${info.ext}`),
		filters: [{ name: info.name, extensions: [info.ext] }],
	});
	if (result.canceled || !result.filePath) return;
	const report = (await controller.call(
		"export",
		{ kind: format, out: result.filePath },
		"user",
	)) as {
		outputs: string[];
	};
	if (report?.outputs?.[0]) shell.showItemInFolder(report.outputs[0]);
}

async function importTimelineDialog() {
	if (!win || !store.isOpen) return;
	const result = await dialog.showOpenDialog(win, {
		title: "Import a timeline",
		properties: ["openFile"],
		filters: [{ name: "OpenTimelineIO", extensions: ["otio"] }],
	});
	if (!result.canceled && result.filePaths[0])
		await controller.call("import_timeline", { file: result.filePaths[0] }, "user");
}

/** Opens a project, or imports a timeline file into the open project. */
async function openPath(file: string) {
	if (file.endsWith(".otio")) {
		if (!store.isOpen) throw new Error("Open a project first, then import the timeline into it.");
		await controller.call("import_timeline", { file }, "user");
	} else await controller.call("open_project", { path: file }, "user");
}

async function importDialog(place?: { trackId: string; startMs: number }) {
	if (!win || !store.isOpen) return [];
	const result = await dialog.showOpenDialog(win, {
		title: "Import media",
		properties: ["openFile", "multiSelections"],
		filters: [
			{
				name: "Media",
				extensions: [
					"mp4",
					"mov",
					"m4v",
					"webm",
					"wav",
					"mp3",
					"m4a",
					"aac",
					"flac",
					"ogg",
					"png",
					"jpg",
					"jpeg",
					"webp",
					"gif",
					"json",
					"lottie",
				],
			},
			{ name: "Motion graphics (Lottie from After Effects)", extensions: ["json", "lottie"] },
		],
	});
	if (result.canceled || result.filePaths.length === 0) return [];
	return controller.call("import_media", { files: result.filePaths, ...place }, "user");
}

function buildMenu() {
	const guard = (fn: () => Promise<unknown>) => () =>
		void fn().catch((error: Error) => win && dialog.showErrorBox("Cue", error.message));
	const mac = process.platform === "darwin";
	const settingsItem: Electron.MenuItemConstructorOptions = {
		label: mac ? "Settings…" : "Settings",
		accelerator: "CmdOrCtrl+,",
		click: () => win?.webContents.send("cue:openSettings"),
	};
	const updatesItem: Electron.MenuItemConstructorOptions = {
		label: "Check for Updates…",
		click: guard(checkForUpdatesDialog),
	};
	const supportItem: Electron.MenuItemConstructorOptions = {
		label: "Support Cue…",
		click: () => void shell.openExternal("https://ko-fi.com/davidwickerhf"),
	};
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			...(mac
				? [
						{
							label: app.name,
							submenu: [
								{ role: "about" },
								updatesItem,
								supportItem,
								{ type: "separator" },
								settingsItem,
								{ type: "separator" },
								{ role: "services" },
								{ type: "separator" },
								{ role: "hide" },
								{ role: "hideOthers" },
								{ role: "unhide" },
								{ type: "separator" },
								{ role: "quit" },
							],
						} satisfies Electron.MenuItemConstructorOptions,
					]
				: []),
			{
				label: "File",
				submenu: [
					{ label: "New Project…", accelerator: "CmdOrCtrl+N", click: guard(newProjectDialog) },
					{ label: "Open Project…", accelerator: "CmdOrCtrl+O", click: guard(openProjectDialog) },
					{
						label: "Show All Projects",
						accelerator: "CmdOrCtrl+Shift+O",
						click: guard(() => controller.call("close_project", {}, "user")),
					},
					{
						label: "Import Media…",
						accelerator: "CmdOrCtrl+I",
						click: guard(() => importDialog()),
					},
					{
						label: "Record Screen or Camera…",
						accelerator: "CmdOrCtrl+Shift+R",
						click: () => win?.webContents.send("cue:openRecord"),
					},
					{ type: "separator" },
					{
						label: "Import Timeline (OTIO)…",
						accelerator: "CmdOrCtrl+Shift+I",
						click: guard(importTimelineDialog),
					},
					{ type: "separator" },
					{ label: "Save", accelerator: "CmdOrCtrl+S", click: guard(() => store.flush()) },
					{ label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: guard(saveAsDialog) },
					{ label: "Package Project…", click: guard(packageDialog) },
					{
						label: "Export Timeline",
						submenu: (Object.keys(TIMELINE_FORMATS) as (keyof typeof TIMELINE_FORMATS)[]).map(
							(format) => ({
								label: TIMELINE_FORMATS[format].label,
								click: guard(() => exportTimelineDialog(format)),
							}),
						),
					},
					{ type: "separator" },
					...(mac
						? [{ role: "close" } satisfies Electron.MenuItemConstructorOptions]
						: [
								settingsItem,
								{ type: "separator" } satisfies Electron.MenuItemConstructorOptions,
								{ role: "quit" } satisfies Electron.MenuItemConstructorOptions,
							]),
				],
			},
			{
				label: "Edit",
				submenu: [
					{
						label: "Undo",
						accelerator: "CmdOrCtrl+Z",
						click: guard(async () => {
							if (await typing()) win?.webContents.undo();
							else await controller.call("undo", {}, "user");
						}),
					},
					{
						label: "Redo",
						accelerator: "CmdOrCtrl+Shift+Z",
						click: guard(async () => {
							if (await typing()) win?.webContents.redo();
							else await controller.call("redo", {}, "user");
						}),
					},
					{ type: "separator" },
					{ role: "cut" },
					{ role: "copy" },
					{ role: "paste" },
					{ role: "selectAll" },
				],
			},
			{ role: "viewMenu" },
			{ role: "windowMenu" },
			...(mac
				? []
				: [
						{
							label: "Help",
							submenu: [updatesItem, supportItem, { type: "separator" }, { role: "about" }],
						} satisfies Electron.MenuItemConstructorOptions,
					]),
		]),
	);
}

// ---------------------------------------------------------------------------
// Updates (electron-updater, GitHub Releases)
// ---------------------------------------------------------------------------

let updater: Updater | null = null;

function sendUpdateStatus(status: UpdateStatus) {
	if (win && !win.isDestroyed()) win.webContents.send("cue:updateStatus", status);
}

/** Help → Check for Updates… (the Cue menu on macOS). */
async function checkForUpdatesDialog() {
	if (!updater) return;
	const status = await updater.check(true);
	const show = (options: Electron.MessageBoxOptions) =>
		win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
	if (status.state === "ready") {
		const { response } = await show({
			type: "info",
			message: `Cue ${status.version} is ready to install.`,
			detail: "Cue restarts to install it. Your project is saved first.",
			buttons: ["Restart Now", "Later"],
			defaultId: 0,
			cancelId: 1,
		});
		if (response === 0) await updater.install();
	} else if (status.state === "available") {
		const { response } = await show({
			type: "info",
			message: `Cue ${status.version} is available.`,
			detail: "Download this update? Cue will not download it without your choice.",
			buttons: ["Download Update", "Later"],
			defaultId: 0,
			cancelId: 1,
		});
		if (response === 0) void updater.download();
	} else if (status.state === "downloading")
		await show({
			type: "info",
			message: `Downloading Cue ${status.version}…`,
			detail: "You'll see “Update ready” at the top of the window when it can be installed.",
		});
	else if (status.state === "unsupported" || status.state === "error") {
		const { response } = await show({
			type: status.state === "error" ? "warning" : "info",
			message:
				status.state === "error"
					? "Couldn't check for updates."
					: "This copy of Cue can't update itself.",
			detail: status.message,
			buttons: ["Open Releases", "OK"],
			defaultId: 1,
			cancelId: 1,
		});
		if (response === 0)
			void shell.openExternal("https://github.com/davidwickerhf/cue/releases/latest");
	} else
		await show({
			type: "info",
			message: "Cue is up to date.",
			detail: `You have version ${app.getVersion()}.`,
		});
}

function registerIpc() {
	ipcMain.handle("cue:state", () => controller.state());
	ipcMain.handle("cue:call", (_event, method: string, params: unknown) => {
		if (!(method in contract)) throw new Error(`Unknown method ${method}`);
		return controller.call(method as MethodName, params, "user");
	});
	ipcMain.on("cue:recorder", (_event, status: Partial<RecorderStatus>) =>
		controller.updateRecorder(status),
	);
	ipcMain.on("cue:selectClips", (_event, ids: string[]) => controller.selectClips(ids));
	ipcMain.on("cue:selectLine", (_event, id: string | null) => {
		controller.selectedLineId = id;
		controller.changed();
	});
	ipcMain.on("cue:reply", (_event, requestId: string, error: string | null, value: unknown) => {
		const pending = waiting.get(requestId);
		if (!pending) return;
		waiting.delete(requestId);
		if (error) pending.reject(new Error(error));
		else pending.resolve(value);
	});
	ipcMain.handle("cue:saveRecording", (_event, input) =>
		controller.saveRecording({ ...input, audio: Buffer.from(input.audio) }),
	);
	ipcMain.on("cue:failRecording", (_event, requestId: string, message: string) =>
		controller.failRecording(requestId, message),
	);
	ipcMain.handle("cue:requestMicrophone", () =>
		process.platform === "darwin" ? systemPreferences.askForMediaAccess("microphone") : true,
	);
	ipcMain.handle("cue:requestCamera", () =>
		process.platform === "darwin" ? systemPreferences.askForMediaAccess("camera") : true,
	);
	ipcMain.handle("cue:captureSources", () => captureSources(true));
	ipcMain.handle("cue:screenAccess", () => mediaAccess("screen"));
	ipcMain.on("cue:setCaptureSource", (_event, id: string | null) => {
		displaySource = id;
	});
	ipcMain.handle("cue:studioWallpapers", () => {
		const dir = studioDir();
		return Object.fromEntries(
			WALLPAPERS.map((name) => {
				const file = dir ? path.join(dir, `${name}.jpg`) : "";
				const image = file && existsSync(file) ? nativeImage.createFromPath(file) : null;
				return [name, image && !image.isEmpty() ? image.resize({ width: 96 }).toDataURL() : null];
			}),
		);
	});
	ipcMain.handle(
		"cue:pointerAvailable",
		() => cursorBinary() !== null && process.platform === "darwin",
	);
	ipcMain.handle("cue:nativeCapture", () => captureBinary() !== null);
	ipcMain.handle(
		"cue:captureBegin",
		async (
			_event,
			input: {
				screen: boolean;
				camera: boolean;
				requestId?: string;
				sourceId?: string | null;
				/** Record the pointer separately (the studio look). */
				pointer?: boolean;
				/** Record the screen natively; with the pointer drawn in unless hidden. */
				native?: { showCursor: boolean };
			},
		) => {
			const { sourceId, pointer, native, ...rest } = input;
			const target = sourceId ? await pointerTarget(sourceId) : undefined;
			return controller.beginCapture({
				...rest,
				native: native && captureBinary() ? native : undefined,
				cursor: target && { ...target, pointer: !!pointer },
			});
		},
	);
	ipcMain.handle("cue:capturePause", (_event, id: string, paused: boolean) =>
		controller.pauseCapture(id, paused),
	);
	ipcMain.handle("cue:captureChunk", (_event, id: string, part: "main" | "overlay", data) =>
		controller.writeCapture(id, part, Buffer.from(data)),
	);
	ipcMain.handle("cue:captureFinish", (_event, id: string, input) =>
		controller.finishCapture(id, input),
	);
	ipcMain.handle(
		"cue:captureCancel",
		(_event, id: string | null, message: string, requestId?: string) =>
			controller.cancelCapture(id, message, requestId),
	);
	ipcMain.handle("cue:peaks", (_event, assetId: string) => store.peaks(assetId));
	ipcMain.handle("cue:thumbnails", (_event, assetId: string) => store.thumbnails(assetId));
	ipcMain.handle(
		"cue:audioProxy",
		async (_event, assetId: string, speed: number, denoise?: DenoiseMode) =>
			mediaUrl(
				await store.audioProxy(
					assetId,
					speed,
					denoise === "light" || denoise === "voice" ? denoise : "off",
				),
			),
	);
	ipcMain.handle("cue:importDialog", (_event, place?: { trackId: string; startMs: number }) =>
		importDialog(place),
	);
	ipcMain.handle("cue:listProjects", () => controller.projects());
	ipcMain.handle(
		"cue:chooseSave",
		async (_event, options: { title: string; defaultPath?: string; extensions?: string[] }) => {
			if (!win) return null;
			const result = await dialog.showSaveDialog(win, {
				title: options.title,
				defaultPath: options.defaultPath,
				filters: options.extensions?.length
					? [{ name: "File", extensions: options.extensions }]
					: undefined,
			});
			return result.canceled ? null : (result.filePath ?? null);
		},
	);
	ipcMain.handle("cue:harnesses", (_event, force?: boolean) => listHarnesses(force));
	ipcMain.handle("cue:chatSend", (_event, chatId: string, input) => sendChat(chatId, input));
	ipcMain.handle("cue:chatStop", (_event, chatId: string) => chats.get(chatId)?.stop());
	// Another message while the agent works: false when it can't take one now (the renderer queues it).
	ipcMain.handle(
		"cue:chatSteer",
		async (_event, chatId: string, input: { prompt: string; images?: string[]; uuid: string }) => {
			const steer = chats.get(chatId)?.steer;
			if (!steer) return false;
			try {
				await steer(input.prompt, input.images ?? [], input.uuid);
				return true;
			} catch {
				return false;
			}
		},
	);
	ipcMain.handle("cue:chatLoad", async () => {
		const dir = store.snapshot()?.dir;
		return dir ? { dir, data: await loadChats(dir) } : null;
	});
	ipcMain.handle("cue:chatSave", async (_event, dir: string, data: unknown) => {
		// Only into the folder of a project (the renderer saves the one it loaded).
		if (!existsSync(dir) || !readdirSync(dir).some((entry) => isProjectFile(entry))) return;
		await saveChats(dir, data);
	});
	ipcMain.handle("cue:chatAttach", (_event, bytes: ArrayBuffer) =>
		saveAttachment(chatDir(), new Uint8Array(bytes)),
	);
	ipcMain.handle("cue:chatAttachFrame", async (_event, atMs: number) =>
		saveAttachment(chatDir(), await fs.readFile(await captureFrame(atMs))),
	);
	// Voice commands: what was said, with the transcription provider from Settings.
	ipcMain.handle("cue:transcribeSpeech", async (_event, audio: ArrayBuffer) => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-voice-"));
		try {
			// No extension: ffmpeg recognises the format from the data (WebM from the recorder).
			const input = path.join(dir, "speech-input");
			const wav = path.join(dir, "speech.wav");
			await fs.writeFile(input, Buffer.from(audio));
			await ffmpeg(["-i", input, "-ar", "16000", "-ac", "1", wav]);
			const { text } = await (await runtime()).transcribe(wav, {});
			return text.trim();
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
	ipcMain.handle(
		"cue:createProject",
		async (
			_event,
			options: {
				name: string;
				folder?: string;
				width: number;
				height: number;
				fps: number;
				video?: string;
			},
		) => {
			const name = options.name.trim() || "Untitled";
			const folder = options.folder || appSettings.projectsDir;
			// Characters no platform allows in a folder name (Windows is the strictest).
			let dir = path.join(
				folder,
				name.replace(/[/\\:*?"<>|]/g, "-").replace(/[. ]+$/, "") || "Untitled",
			);
			for (let n = 2; existsSync(dir); n++) dir = path.join(folder, `${name} ${n}`);
			await controller.call(
				"create_project",
				{
					path: path.join(dir, `${path.basename(dir)}${PROJECT_EXTENSION}`),
					name,
					video: options.video,
				},
				"user",
			);
			if (!options.video)
				await controller.call(
					"set_canvas",
					{ width: options.width, height: options.height, fps: options.fps },
					"user",
				);
		},
	);
	ipcMain.handle(
		"cue:projectAction",
		async (_event, action: string, file: string, arg?: string) => {
			if (!isProject(file)) throw new Error("Not a Cue project.");
			if (action === "reveal") return shell.showItemInFolder(file);
			if (action === "forget")
				return store.forget(file).then(() => controller.refreshRecentAndNotify());
			if (action === "rename" && arg) {
				const data = JSON.parse(await fs.readFile(file, "utf8"));
				data.name = arg.slice(0, 200);
				await fs.writeFile(file, `${JSON.stringify(data, null, "\t")}\n`);
				return controller.refreshRecentAndNotify();
			}
			if (action === "duplicate") {
				const copy = file.replace(/(\.cueproj|\.cue\.json)$/, "");
				let target = `${copy} copy${PROJECT_EXTENSION}`;
				for (let n = 2; existsSync(target); n++) target = `${copy} copy ${n}${PROJECT_EXTENSION}`;
				const data = JSON.parse(await fs.readFile(file, "utf8"));
				data.name = `${data.name} copy`;
				await fs.writeFile(target, `${JSON.stringify(data, null, "\t")}\n`);
				// The copy goes in the same collection as the original.
				const collection = await controller.collections.of(file);
				if (collection)
					await controller.call(
						"move_to_collection",
						{ projects: [target], collectionId: collection.id },
						"user",
					);
				return target;
			}
			if (action === "trash") {
				if (!win) return;
				const { response } = await dialog.showMessageBox(win, {
					type: "warning",
					message: `Move “${path.basename(file)}” to the Trash?`,
					detail: "Only the project file goes to the Trash. Your media files stay where they are.",
					buttons: ["Move to Trash", "Cancel"],
					defaultId: 1,
					cancelId: 1,
				});
				if (response !== 0) return;
				if (store.filePath === file) await store.close();
				await shell.trashItem(file);
				await store.forget(file);
				await controller.call(
					"move_to_collection",
					{ projects: [file], collectionId: null },
					"user",
				);
				return controller.refreshRecentAndNotify();
			}
		},
	);
	ipcMain.handle("cue:newProject", () => newProjectDialog());
	ipcMain.handle("cue:openProject", () => openProjectDialog());
	ipcMain.handle("cue:reveal", (_event, file: string) => shell.showItemInFolder(file));
	ipcMain.handle("cue:setApiKey", async (_event, key: string | null) => {
		await saveApiKey(key);
		await localInventory(true);
		await controller.refreshAi();
	});
	ipcMain.handle("cue:getAppSettings", () => appSettings);
	ipcMain.handle("cue:setAppSettings", (_event, patch: Partial<AppSettings>) =>
		saveAppSettings(patch),
	);
	ipcMain.handle("cue:localInventory", async (_event, force: boolean) => ({
		inventory: await localInventory(force),
		downloads: WHISPER_DOWNLOADS,
	}));
	ipcMain.handle("cue:previewVoice", async (_event, voice: string) => {
		if (process.platform !== "darwin") return;
		const { execFile } = await import("node:child_process");
		execFile("say", ["-v", voice, "This is how the voiceover will sound."]);
	});
	ipcMain.handle("cue:appInfo", () => ({
		version: app.getVersion(),
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		arch: process.arch,
		packaged: app.isPackaged,
	}));
	ipcMain.handle("cue:updateStatus", () => updater?.status ?? { state: "idle" });
	ipcMain.handle("cue:checkForUpdates", () => updater?.check(true));
	ipcMain.handle("cue:downloadUpdate", () => updater?.download());
	ipcMain.handle("cue:installUpdate", () => updater?.install());
	// Windows: the window buttons drawn over the header take the header's colours.
	ipcMain.on("cue:titleBarColors", (_event, color: string, symbolColor: string) => {
		if (process.platform === "win32" && win && !win.isDestroyed())
			win.setTitleBarOverlay({ color, symbolColor });
	});
	ipcMain.handle("cue:startOllama", async () => {
		startOllama();
		for (let i = 0; i < 20; i++) {
			await new Promise((r) => setTimeout(r, 500));
			const next = await localInventory(true);
			if (next.ollama.running) break;
		}
		await controller.refreshAi();
		return localInventory();
	});
	ipcMain.handle("cue:downloadWhisper", async (_event, name: string) => {
		const file = await downloadWhisperModel(dataDir, name, (fraction) =>
			win?.webContents.send("cue:downloadProgress", name, fraction),
		);
		await saveAppSettings({
			ai: { ...appSettings.ai, whisperModel: file, transcription: "whisper" },
		});
		await localInventory(true);
		return file;
	});
	ipcMain.handle(
		"cue:mcpCommand",
		() => `claude mcp add --scope user cue -- node "${mcpScriptPath()}"`,
	);
	ipcMain.handle("cue:mcpClients", () => mcpClients(mcpScriptPath()));
	ipcMain.handle(
		"cue:chooseFolder",
		async (_event, options: { title: string; defaultPath?: string }) => {
			if (!win) return null;
			const result = await dialog.showOpenDialog(win, {
				title: options.title,
				defaultPath: options.defaultPath,
				properties: ["openDirectory", "createDirectory"],
			});
			return result.canceled ? null : (result.filePaths[0] ?? null);
		},
	);
	ipcMain.handle(
		"cue:chooseFile",
		async (_event, options: { title: string; extensions?: string[] }) => {
			if (!win) return null;
			const result = await dialog.showOpenDialog(win, {
				title: options.title,
				properties: ["openFile"],
				filters: options.extensions
					? [{ name: "Files", extensions: options.extensions }]
					: undefined,
			});
			return result.canceled ? null : (result.filePaths[0] ?? null);
		},
	);
}

// Development aid: log main-process stalls (they make menus and dialogs feel slow).
if (process.env.CUE_LAG) {
	let last = performance.now();
	setInterval(() => {
		const now = performance.now();
		if (now - last > 80) console.log(`[lag] main blocked ${Math.round(now - last - 50)} ms`);
		last = now;
	}, 50);
}

/** Files opened from Finder before the app was ready. */
let pendingOpen: string | null = null;
/** Set once startup has created the first window. */
let started = false;

if (!process.env.CUE_USER_DATA && !app.requestSingleInstanceLock()) app.quit();
else {
	// Double-clicking a .cueproj (or dropping one on the Dock icon).
	app.on("open-file", (event, file) => {
		event.preventDefault();
		// Until startup has made the window, it opens this file itself (no second window).
		if (!started) pendingOpen = file;
		else {
			if (!win || win.isDestroyed()) createWindow();
			void openPath(file).catch((error) => store.log("system", String(error)));
		}
	});

	app.on("second-instance", (_event, argv) => {
		controller.call("focus_window", {}, "system").catch(() => {});
		const project = argv.find((arg) => isProject(arg) || arg.endsWith(".otio"));
		if (project) void openPath(project).catch((error) => store.log("system", String(error)));
	});

	app.whenReady().then(async () => {
		app.setAboutPanelOptions({
			applicationName: "Cue",
			applicationVersion: app.getVersion(),
			copyright: "© 2026 David Henry Francis Wicker",
			website: "https://wicker.life",
			credits:
				"Open source under the MIT License. cue.wicker.life · Support: ko-fi.com/davidwickerhf",
		});
		await loadAppSettings();
		protocol.handle(MEDIA_SCHEME, serveMedia);
		session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
			callback(
				permission === "media" ||
					// Screen recording; the source itself is chosen in handleDisplayMedia.
					permission === "display-capture" ||
					permission === "clipboard-sanitized-write" ||
					// Lists installed fonts for the title editor.
					(permission as string) === "local-fonts",
			),
		);
		session.defaultSession.setPermissionCheckHandler(
			(_wc, permission) =>
				permission === "media" ||
				permission === "display-capture" ||
				(permission as string) === "local-fonts",
		);
		session.defaultSession.setDisplayMediaRequestHandler(
			(request, callback) => void handleDisplayMedia(request, callback),
		);
		registerIpc();
		buildMenu();
		const control = await startControlServer(
			controller,
			dataDir,
			app.getVersion(),
			() => appSettings.agent.enabled,
		);
		/** Stops agents and the control server and waits (briefly) for the last save. */
		const shutdown = async () => {
			for (const chat of chats.values()) chat.stop();
			void control.close();
			await Promise.race([store.flushAll(), new Promise((r) => setTimeout(r, 5000))]).catch(
				(error) => store.log("system", `Could not save before quitting: ${error}`),
			);
		};
		// Quitting waits for the last save, so no edit is lost.
		let flushed = false;
		app.on("before-quit", (event) => {
			if (flushed) return;
			event.preventDefault();
			flushed = true;
			// Everything is stopped and saved, so exit directly (a second app.quit() is
			// ignored when the quit came from a signal, which left the app running).
			void shutdown().finally(() => app.exit(0));
		});
		updater = new Updater({
			automatic: () => appSettings.autoUpdate,
			autoInstall: () => appSettings.autoInstallUpdates,
			onStatus: sendUpdateStatus,
			// Installing quits through the updater, which must not be held up by before-quit.
			beforeInstall: async () => {
				flushed = true;
				await shutdown();
			},
		});
		if (app.isPackaged) void recordLaunch();
		createWindow();
		started = true;
		// Warm up the model scan so Settings and the Generate panel open instantly.
		void scanInventory().catch(() => {});
		const initial =
			pendingOpen ?? process.argv.find((arg) => isProject(arg)) ?? process.env.CUE_OPEN;
		pendingOpen = null;
		if (initial) await openPath(initial).catch((error) => store.log("system", String(error)));
		else if (appSettings.reopenLast) {
			const [last] = await store.recent();
			if (last)
				await controller.call("open_project", { path: last.path }, "system").catch(() => {});
		}
		void updater.start();
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
}
