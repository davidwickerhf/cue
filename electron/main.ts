import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { BrowserWindow, Menu, app, dialog, ipcMain, protocol, safeStorage, session, shell, systemPreferences } from "electron";
import { contract, type MethodName } from "./control/contract";
import { startControlServer } from "./control/server";
import { Controller } from "./controller";
import type { AiCredentials } from "./core/ai";
import type { TextRender } from "./core/exporter";
import { resolveInProject } from "./core/project";
import { ProjectStore } from "./core/store";
import type { EditorCommand, RecorderStatus, TextClip } from "./core/types";

app.setName("Cue");
const MEDIA_SCHEME = "cue-media";
protocol.registerSchemesAsPrivileged([
	{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

let win: BrowserWindow | null = null;
const dataDir = app.getPath("userData");
const secretsFile = path.join(dataDir, "secrets.bin");
const mediaUrl = (file: string) => `${MEDIA_SCHEME}://local/${encodeURIComponent(file)}`;

// ---------------------------------------------------------------------------
// Window round-trips (text rasterising and frame capture happen in the editor)
// ---------------------------------------------------------------------------

const waiting = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let requestSeq = 0;

function askWindow<T>(command: (requestId: string) => EditorCommand, timeoutMs = 60000): Promise<T> {
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

async function renderText(clips: TextClip[]): Promise<Record<string, TextRender>> {
	const fps = store.current.canvas.fps;
	const images = await askWindow<Record<string, { still?: ArrayBuffer; frames?: ArrayBuffer[] }>>(
		(requestId) => ({ type: "renderText", requestId, clipIds: clips.map((c) => c.id), fps }),
		300000,
	);
	const root = path.join(store.cacheDir(), "text");
	const out: Record<string, TextRender> = {};
	for (const [id, image] of Object.entries(images)) {
		if (image.frames?.length) {
			const dir = path.join(root, id);
			await fs.rm(dir, { recursive: true, force: true });
			await fs.mkdir(dir, { recursive: true });
			await Promise.all(image.frames.map((frame, i) => fs.writeFile(path.join(dir, `${String(i).padStart(5, "0")}.png`), Buffer.from(frame))));
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
	const rect = await askWindow<{ x: number; y: number; width: number; height: number }>((requestId) => ({ type: "captureFrame", requestId, atMs }));
	if (!win) throw new Error("The Cue window is not open.");
	const image = await win.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
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
	if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is not available on this system.");
	await fs.mkdir(dataDir, { recursive: true });
	await fs.writeFile(secretsFile, safeStorage.encryptString(JSON.stringify({ openai: key.trim() })), { mode: 0o600 });
}

// ---------------------------------------------------------------------------

const store = new ProjectStore({ mediaUrl, recentFile: path.join(dataDir, "recent.json") });
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
	credentials,
});

let stateTimer: NodeJS.Timeout | null = null;
controller.on("state", () => {
	if (stateTimer) return;
	stateTimer = setTimeout(() => {
		stateTimer = null;
		if (win && !win.isDestroyed()) win.webContents.send("cue:state", controller.state());
	}, 16);
});
store.on("error", (error: Error) => store.log("system", `Autosave failed: ${error.message}`));

function mcpScriptPath(): string {
	return app.isPackaged ? path.join(process.resourcesPath, "mcp", "cue-mcp.mjs") : path.join(app.getAppPath(), "dist-mcp", "cue-mcp.mjs");
}

/** Only the open project's folder and its media may be streamed to the window. */
function mayServe(file: string): boolean {
	const snapshot = store.snapshot();
	if (!snapshot) return false;
	const resolved = path.resolve(file);
	if (resolved.startsWith(`${snapshot.dir}${path.sep}`)) return true;
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
			headers: { ...cors, "content-type": type, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${stat.size}`, "accept-ranges": "bytes" },
		});
	}
	return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
		headers: { ...cors, "content-type": type, "content-length": String(stat.size), "accept-ranges": "bytes" },
	});
}

function createWindow() {
	win = new BrowserWindow({
		width: 1560,
		height: 980,
		minWidth: 1180,
		minHeight: 760,
		title: "Cue",
		titleBarStyle: "hiddenInset",
		trafficLightPosition: { x: 18, y: 20 },
		backgroundColor: "#f4f4f5",
		show: false,
		webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
	});
	win.once("ready-to-show", () => win?.show());
	win.on("closed", () => {
		win = null;
		controller.updateRecorder({ uiReady: false, micReady: false, recordingLineId: null, playing: false });
	});
	win.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});
	if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
	else void win.loadFile(path.join(__dirname, "../dist/index.html"));
}

async function newProjectDialog() {
	if (!win) return;
	const video = await dialog.showOpenDialog(win, {
		title: "Start from a video (optional)",
		buttonLabel: "Use Video",
		properties: ["openFile"],
		filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "webm"] }],
	});
	const source = video.canceled ? undefined : video.filePaths[0];
	const target = await dialog.showSaveDialog(win, {
		title: "Save the Cue project",
		defaultPath: source ? path.join(path.dirname(source), `${path.parse(source).name}.cue.json`) : path.join(app.getPath("documents"), "Untitled.cue.json"),
	});
	if (target.canceled || !target.filePath) return;
	await controller.call("create_project", { path: target.filePath, video: source }, "user");
}

async function openProjectDialog() {
	if (!win) return;
	const result = await dialog.showOpenDialog(win, { title: "Open a Cue project", properties: ["openFile"], filters: [{ name: "Cue project", extensions: ["json"] }] });
	if (!result.canceled && result.filePaths[0]) await controller.call("open_project", { path: result.filePaths[0] }, "user");
}

async function importDialog(place?: { trackId: string; startMs: number }) {
	if (!win || !store.isOpen) return [];
	const result = await dialog.showOpenDialog(win, {
		title: "Import media",
		properties: ["openFile", "multiSelections"],
		filters: [{ name: "Media", extensions: ["mp4", "mov", "m4v", "webm", "wav", "mp3", "m4a", "aac", "flac", "ogg", "png", "jpg", "jpeg", "webp", "gif"] }],
	});
	if (result.canceled || result.filePaths.length === 0) return [];
	return controller.call("import_media", { files: result.filePaths, ...place }, "user");
}

function buildMenu() {
	const guard = (fn: () => Promise<unknown>) => () => void fn().catch((error: Error) => win && dialog.showErrorBox("Cue", error.message));
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{ role: "appMenu" },
			{
				label: "File",
				submenu: [
					{ label: "New Project…", accelerator: "CmdOrCtrl+N", click: guard(newProjectDialog) },
					{ label: "Open Project…", accelerator: "CmdOrCtrl+O", click: guard(openProjectDialog) },
					{ label: "Import Media…", accelerator: "CmdOrCtrl+I", click: guard(() => importDialog()) },
					{ type: "separator" },
					{ label: "Save", accelerator: "CmdOrCtrl+S", click: guard(() => store.flush()) },
					{ type: "separator" },
					{ role: "close" },
				],
			},
			{
				label: "Edit",
				submenu: [
					{ label: "Undo", accelerator: "CmdOrCtrl+Z", click: guard(() => controller.call("undo", {}, "user")) },
					{ label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", click: guard(() => controller.call("redo", {}, "user")) },
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
	ipcMain.on("cue:recorder", (_event, status: Partial<RecorderStatus>) => controller.updateRecorder(status));
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
	ipcMain.handle("cue:saveRecording", (_event, input) => controller.saveRecording({ ...input, audio: Buffer.from(input.audio) }));
	ipcMain.on("cue:failRecording", (_event, requestId: string, message: string) => controller.failRecording(requestId, message));
	ipcMain.handle("cue:requestMicrophone", () => (process.platform === "darwin" ? systemPreferences.askForMediaAccess("microphone") : true));
	ipcMain.handle("cue:peaks", (_event, assetId: string) => store.peaks(assetId));
	ipcMain.handle("cue:thumbnails", (_event, assetId: string) => store.thumbnails(assetId));
	ipcMain.handle("cue:importDialog", (_event, place?: { trackId: string; startMs: number }) => importDialog(place));
	ipcMain.handle("cue:newProject", () => newProjectDialog());
	ipcMain.handle("cue:openProject", () => openProjectDialog());
	ipcMain.handle("cue:reveal", (_event, file: string) => shell.showItemInFolder(file));
	ipcMain.handle("cue:setApiKey", async (_event, key: string | null) => {
		await saveApiKey(key);
		await controller.refreshAi();
	});
	ipcMain.handle("cue:mcpCommand", () => `claude mcp add --scope user cue -- node "${mcpScriptPath()}"`);
	ipcMain.handle("cue:chooseFile", async (_event, options: { title: string; extensions?: string[] }) => {
		if (!win) return null;
		const result = await dialog.showOpenDialog(win, { title: options.title, properties: ["openFile"], filters: options.extensions ? [{ name: "Files", extensions: options.extensions }] : undefined });
		return result.canceled ? null : (result.filePaths[0] ?? null);
	});
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", (_event, argv) => {
		controller.call("focus_window", {}, "system").catch(() => {});
		const project = argv.find((arg) => arg.endsWith(".cue.json"));
		if (project) void controller.call("open_project", { path: project }, "user").catch(() => {});
	});

	app.whenReady().then(async () => {
		protocol.handle(MEDIA_SCHEME, serveMedia);
		session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "media" || permission === "clipboard-sanitized-write"));
		session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
		registerIpc();
		buildMenu();
		const control = await startControlServer(controller, dataDir, app.getVersion());
		app.on("before-quit", () => {
			void control.close();
			void store.flush();
		});
		createWindow();
		const initial = process.argv.find((arg) => arg.endsWith(".cue.json")) ?? process.env.CUE_OPEN;
		if (initial) await controller.call("open_project", { path: initial }, "user").catch((error) => store.log("system", String(error)));
		else {
			const [last] = await store.recent();
			if (last) await controller.call("open_project", { path: last.path }, "system").catch(() => {});
		}
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
}
