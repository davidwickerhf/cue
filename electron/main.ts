import { createReadStream, existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	protocol,
	safeStorage,
	session,
	shell,
	systemPreferences,
} from "electron";
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
import type { TextRender } from "./core/exporter";
import {
	detectLocal,
	downloadWhisperModel,
	type LocalInventory,
	startOllama,
	WHISPER_DOWNLOADS,
} from "./core/local-ai";
import { resolveInProject } from "./core/paths";
import { isProjectFile, PROJECT_EXTENSION } from "./core/project";
import { type AppSettings, appSettingsSchema, buildRuntime } from "./core/runtime";
import { ProjectStore } from "./core/store";
import type { EditorCommand, RecorderStatus, TextClip } from "./core/types";

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
	clips: TextClip[],
	canvas?: { width: number; height: number },
): Promise<Record<string, TextRender>> {
	const fps = store.current.canvas.fps;
	const images = await askWindow<Record<string, { still?: ArrayBuffer; frames?: ArrayBuffer[] }>>(
		// The clips travel with the request: they may belong to a sequence that is not open.
		(requestId) => ({
			type: "renderText",
			requestId,
			clipIds: clips.map((c) => c.id),
			clips,
			fps,
			...canvas,
		}),
		300000,
	);
	const root = path.join(store.cacheDir(), "text");
	const out: Record<string, TextRender> = {};
	for (const [id, image] of Object.entries(images)) {
		if (image.frames?.length) {
			const dir = path.join(root, id);
			await fs.rm(dir, { recursive: true, force: true });
			await fs.mkdir(dir, { recursive: true });
			await Promise.all(
				image.frames.map((frame, i) =>
					fs.writeFile(path.join(dir, `${String(i).padStart(5, "0")}.png`), Buffer.from(frame)),
				),
			);
			out[id] = { kind: "sequence", pattern: path.join(dir, "%05d.png"), fps };
		} else if (image.still) {
			await fs.mkdir(root, { recursive: true });
			const file = path.join(root, `${id}.png`);
			await fs.writeFile(file, Buffer.from(image.still));
			out[id] = { kind: "still", file };
		}
	}
	return out;
}

async function captureFrame(atMs: number): Promise<string> {
	const rect = await askWindow<{ x: number; y: number; width: number; height: number }>(
		(requestId) => ({ type: "captureFrame", requestId, atMs }),
	);
	if (!win) throw new Error("The Cue window is not open.");
	const image = await win.webContents.capturePage({
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		width: Math.round(rect.width),
		height: Math.round(rect.height),
	});
	const dir = path.join(store.cacheDir(), "frames");
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(dir, `frame-${Math.round(atMs)}.png`);
	await fs.writeFile(file, image.toPNG());
	return file;
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
	appSettings = appSettingsSchema.parse({
		...appSettings,
		...patch,
		ai: { ...appSettings.ai, ...patch.ai },
		agent: { ...appSettings.agent, ...patch.agent },
		editor: { ...appSettings.editor, ...patch.editor },
	});
	await fs.mkdir(dataDir, { recursive: true });
	await fs.writeFile(settingsFile, JSON.stringify(appSettings, null, 2));
	await controller.refreshAi();
	win?.webContents.send("cue:appSettings", appSettings);
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
	recipesFile: path.join(dataDir, "recipes.json"),
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
controller.on("state", () => {
	if (stateTimer) return;
	stateTimer = setTimeout(() => {
		stateTimer = null;
		if (!win || win.isDestroyed()) return;
		const key = store.snapshotKey;
		const same = key === sentProject;
		sentProject = key;
		win.webContents.send("cue:state", controller.state(!same), same);
	}, 16);
});
store.on("error", (error: Error) => store.log("system", `Autosave failed: ${error.message}`));

// ---------------------------------------------------------------------------
// In-app agent chat through the user's own CLIs (Claude Code, Codex, Gemini)
// ---------------------------------------------------------------------------

const chats = new Map<string, { stop: () => void }>();
let harnessCache: { at: number; list: Promise<HarnessInfo[]> } | null = null;

function listHarnesses(force = false) {
	if (!harnessCache || force || Date.now() - harnessCache.at > 30000)
		harnessCache = { at: Date.now(), list: detectHarnesses() };
	return harnessCache.list;
}

async function sendChat(
	chatId: string,
	input: { harness: HarnessId; prompt: string; sessionId?: string; model?: string },
) {
	if (!appSettings.agent.enabled)
		throw new Error("Agent access is turned off in Settings → Agent.");
	chats.get(chatId)?.stop();
	// Each turn has its own entry. Events from a turn that was replaced are dropped,
	// and a stop that arrives while the harness is still starting is applied once it runs.
	let handle: { stop: () => void } | null = null;
	let stopped = false;
	const entry = {
		stop: () => {
			stopped = true;
			handle?.stop();
		},
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
	if (stopped) handle.stop();
}

function mcpScriptPath(): string {
	// Demo recordings show the installed app's bridge (same code) rather than a development path.
	const installed = "/Applications/Cue.app/Contents/Resources/mcp/cue-mcp.mjs";
	if (recordFrames && existsSync(installed)) return installed;
	return app.isPackaged
		? path.join(process.resourcesPath, "mcp", "cue-mcp.mjs")
		: path.join(app.getAppPath(), "dist-mcp", "cue-mcp.mjs");
}

/** Only the open project's folder and its media may be streamed to the window. */
function mayServe(file: string): boolean {
	const resolved = path.resolve(file);
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
	// Inside the project folder: pictures and sound only (caches, renders, takes), never other files.
	if (resolved.startsWith(`${snapshot.dir}${path.sep}`))
		return path.extname(resolved).toLowerCase() in MIME;
	return snapshot.data.assets.some((a) => resolveInProject(snapshot.dir, a.path) === resolved);
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
	const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
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

function createWindow() {
	win = new BrowserWindow({
		width: 1560,
		height: 980,
		minWidth: 1180,
		minHeight: 760,
		title: "Cue",
		titleBarStyle: "hiddenInset",
		trafficLightPosition: { x: 18, y: 15 },
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
			...(recordFrames ? { offscreen: true, backgroundThrottling: false } : {}),
		},
	});
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
		// Nothing repaints while the screen is still; ask for a frame so there always is a current one.
		setInterval(() => {
			if (win && !win.isDestroyed() && existsSync(flag) && Date.now() - lastFrame > 400)
				win.webContents.invalidate();
		}, 250);
	} else win.once("ready-to-show", () => win?.show());
	// A (re)loaded page has no project yet.
	win.webContents.on("did-start-loading", () => {
		sentProject = null;
	});
	win.on("closed", () => {
		win = null;
		sentProject = null;
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
				],
			},
		],
	});
	if (result.canceled || result.filePaths.length === 0) return [];
	return controller.call("import_media", { files: result.filePaths, ...place }, "user");
}

function buildMenu() {
	const guard = (fn: () => Promise<unknown>) => () =>
		void fn().catch((error: Error) => win && dialog.showErrorBox("Cue", error.message));
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: app.name,
				submenu: [
					{ role: "about" },
					{
						label: "Support Cue…",
						click: () => void shell.openExternal("https://ko-fi.com/davidwickerhf"),
					},
					{ type: "separator" },
					{
						label: "Settings…",
						accelerator: "CmdOrCtrl+,",
						click: () => win?.webContents.send("cue:openSettings"),
					},
					{ type: "separator" },
					{ role: "services" },
					{ type: "separator" },
					{ role: "hide" },
					{ role: "hideOthers" },
					{ role: "unhide" },
					{ type: "separator" },
					{ role: "quit" },
				],
			},
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
					{ type: "separator" },
					{
						label: "Import Timeline (OTIO)…",
						accelerator: "CmdOrCtrl+Shift+I",
						click: guard(importTimelineDialog),
					},
					{ type: "separator" },
					{ label: "Save", accelerator: "CmdOrCtrl+S", click: guard(() => store.flush()) },
					{ label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: guard(saveAsDialog) },
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
					{ role: "close" },
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
		]),
	);
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
	ipcMain.handle("cue:peaks", (_event, assetId: string) => store.peaks(assetId));
	ipcMain.handle("cue:thumbnails", (_event, assetId: string) => store.thumbnails(assetId));
	ipcMain.handle("cue:audioProxy", async (_event, assetId: string, speed: number) =>
		mediaUrl(await store.audioProxy(assetId, speed)),
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
			let dir = path.join(folder, name.replace(/[/\\:]/g, "-"));
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
		const { execFile } = await import("node:child_process");
		execFile("say", ["-v", voice, "This is how the voiceover will sound."]);
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
					permission === "clipboard-sanitized-write" ||
					// Lists installed fonts for the title editor.
					(permission as string) === "local-fonts",
			),
		);
		session.defaultSession.setPermissionCheckHandler(
			(_wc, permission) => permission === "media" || (permission as string) === "local-fonts",
		);
		registerIpc();
		buildMenu();
		const control = await startControlServer(
			controller,
			dataDir,
			app.getVersion(),
			() => appSettings.agent.enabled,
		);
		// Quitting waits (briefly) for the last save, so no edit is lost.
		let flushed = false;
		app.on("before-quit", (event) => {
			if (flushed) return;
			event.preventDefault();
			flushed = true;
			for (const chat of chats.values()) chat.stop();
			void control.close();
			// Everything is stopped and saved, so exit directly (a second app.quit() is
			// ignored when the quit came from a signal, which left the app running).
			void Promise.race([store.flushAll(), new Promise((r) => setTimeout(r, 5000))])
				.catch((error) => store.log("system", `Could not save before quitting: ${error}`))
				.finally(() => app.exit(0));
		});
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
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
}
