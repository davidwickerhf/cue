import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from "electron";
import type { MethodName } from "./control/contract";
import type { ProjectPatch } from "./core/delta";
import type { McpClient } from "./core/mcpClients";
import type {
	AppState,
	DenoiseMode,
	EditorCommand,
	ProjectSummary,
	RecorderStatus,
} from "./core/types";

const api = {
	/** The same methods agents use, performed as the user. */
	call: <T = unknown>(method: MethodName, params?: unknown) =>
		ipcRenderer.invoke("cue:call", method, params) as Promise<T>,
	getState: () => ipcRenderer.invoke("cue:state") as Promise<AppState>,
	/**
	 * `projectUnchanged`: the project was left out because the window already has this version.
	 * `patch`: the project was left out; apply this to the version the window has.
	 */
	onState: (
		listener: (state: AppState, projectUnchanged: boolean, patch?: ProjectPatch) => void,
	) => {
		const handler = (
			_event: IpcRendererEvent,
			state: AppState,
			projectUnchanged = false,
			patch?: ProjectPatch,
		) => listener(state, projectUnchanged, patch);
		ipcRenderer.on("cue:state", handler);
		return () => {
			ipcRenderer.removeListener("cue:state", handler);
		};
	},
	onCommand: (listener: (command: EditorCommand) => void) => {
		const handler = (_event: IpcRendererEvent, command: EditorCommand) => listener(command);
		ipcRenderer.on("cue:command", handler);
		return () => {
			ipcRenderer.removeListener("cue:command", handler);
		};
	},
	reply: (requestId: string, error: string | null, value?: unknown) =>
		ipcRenderer.send("cue:reply", requestId, error, value),
	reportRecorder: (status: Partial<RecorderStatus>) => ipcRenderer.send("cue:recorder", status),
	selectClips: (ids: string[]) => ipcRenderer.send("cue:selectClips", ids),
	selectLine: (id: string | null) => ipcRenderer.send("cue:selectLine", id),
	saveRecording: (input: {
		lineId: string;
		audio: ArrayBuffer;
		extension: string;
		recordedAtMs: number;
		requestId?: string;
	}) => ipcRenderer.invoke("cue:saveRecording", input),
	failRecording: (requestId: string, message: string) =>
		ipcRenderer.send("cue:failRecording", requestId, message),
	requestMicrophone: () => ipcRenderer.invoke("cue:requestMicrophone") as Promise<boolean>,
	requestCamera: () => ipcRenderer.invoke("cue:requestCamera") as Promise<boolean>,
	/** Screens and windows (with small previews), cameras, microphones and permissions. */
	captureSources: () =>
		ipcRenderer.invoke("cue:captureSources") as Promise<import("./core/capture").CaptureSources>,
	screenAccess: () => ipcRenderer.invoke("cue:screenAccess") as Promise<string>,
	/** The source the next getDisplayMedia() call records. */
	setCaptureSource: (id: string | null) => ipcRenderer.send("cue:setCaptureSource", id),
	/** Small previews of the studio wallpapers, by name. */
	studioWallpapers: () =>
		ipcRenderer.invoke("cue:studioWallpapers") as Promise<Record<string, string | null>>,
	/** Whether the pointer can be recorded separately (for the studio look). */
	pointerAvailable: () => ipcRenderer.invoke("cue:pointerAvailable") as Promise<boolean>,
	captureBegin: (input: {
		screen: boolean;
		camera: boolean;
		requestId?: string;
		sourceId?: string | null;
		pointer?: boolean;
		native?: { showCursor: boolean };
	}) =>
		ipcRenderer.invoke("cue:captureBegin", input) as Promise<{
			id: string;
			files: { main: string; overlay?: string };
			native: boolean;
		}>,
	/** Whether screens are recorded natively (ScreenCaptureKit) rather than by screen sharing. */
	nativeCapture: () => ipcRenderer.invoke("cue:nativeCapture") as Promise<boolean>,
	capturePause: (id: string, paused: boolean) =>
		ipcRenderer.invoke("cue:capturePause", id, paused) as Promise<void>,
	captureChunk: (id: string, part: "main" | "overlay", data: ArrayBuffer) =>
		ipcRenderer.invoke("cue:captureChunk", id, part, data) as Promise<void>,
	captureFinish: (
		id: string,
		input: {
			atMs: number;
			bubble: boolean;
			clock?: import("./core/cursor").RecordingClock;
			studio?: import("./core/capture").StudioChoice | null;
		},
	) =>
		ipcRenderer.invoke("cue:captureFinish", id, input) as Promise<
			import("./controller").CaptureResult
		>,
	captureCancel: (id: string | null, message: string, requestId?: string) =>
		ipcRenderer.invoke("cue:captureCancel", id, message, requestId) as Promise<void>,
	onOpenRecord: (listener: () => void) => {
		const handler = () => listener();
		ipcRenderer.on("cue:openRecord", handler);
		return () => {
			ipcRenderer.removeListener("cue:openRecord", handler);
		};
	},
	peaks: (assetId: string) => ipcRenderer.invoke("cue:peaks", assetId) as Promise<number[]>,
	audioProxy: (assetId: string, speed: number, denoise: DenoiseMode = "off") =>
		ipcRenderer.invoke("cue:audioProxy", assetId, speed, denoise) as Promise<string>,
	thumbnails: (assetId: string) =>
		ipcRenderer.invoke("cue:thumbnails", assetId) as Promise<{
			intervalMs: number;
			urls: string[];
		}>,
	importDialog: (place?: { trackId: string; startMs: number }) =>
		ipcRenderer.invoke("cue:importDialog", place),
	newProject: () => ipcRenderer.invoke("cue:newProject"),
	harnesses: (force = false) =>
		ipcRenderer.invoke("cue:harnesses", force) as Promise<import("./agents/harness").HarnessInfo[]>,
	chatSend: (
		chatId: string,
		input: {
			harness: import("./agents/harness").HarnessId;
			prompt: string;
			sessionId?: string;
			model?: string;
		},
	) => ipcRenderer.invoke("cue:chatSend", chatId, input) as Promise<void>,
	chatStop: (chatId: string) => ipcRenderer.invoke("cue:chatStop", chatId) as Promise<void>,
	/** What was said in a short recording (voice commands). */
	transcribeSpeech: (audio: ArrayBuffer) =>
		ipcRenderer.invoke("cue:transcribeSpeech", audio) as Promise<string>,
	onChatEvent: (
		listener: (chatId: string, event: import("./agents/harness").ChatEvent) => void,
	) => {
		const handler = (
			_event: IpcRendererEvent,
			chatId: string,
			event: import("./agents/harness").ChatEvent,
		) => listener(chatId, event);
		ipcRenderer.on("cue:chatEvent", handler);
		return () => {
			ipcRenderer.removeListener("cue:chatEvent", handler);
		};
	},
	listProjects: () => ipcRenderer.invoke("cue:listProjects") as Promise<ProjectSummary[]>,
	createProject: (options: {
		name: string;
		folder?: string;
		width: number;
		height: number;
		fps: number;
		video?: string;
	}) => ipcRenderer.invoke("cue:createProject", options) as Promise<void>,
	projectAction: (
		action: "reveal" | "forget" | "rename" | "duplicate" | "trash",
		file: string,
		arg?: string,
	) => ipcRenderer.invoke("cue:projectAction", action, file, arg) as Promise<unknown>,
	onNewProject: (listener: () => void) => {
		const handler = () => listener();
		ipcRenderer.on("cue:newProject", handler);
		return () => {
			ipcRenderer.removeListener("cue:newProject", handler);
		};
	},
	openProject: () => ipcRenderer.invoke("cue:openProject"),
	chooseFile: (options: { title: string; extensions?: string[] }) =>
		ipcRenderer.invoke("cue:chooseFile", options) as Promise<string | null>,
	chooseSave: (options: { title: string; defaultPath?: string; extensions?: string[] }) =>
		ipcRenderer.invoke("cue:chooseSave", options) as Promise<string | null>,
	chooseFolder: (options: { title: string; defaultPath?: string }) =>
		ipcRenderer.invoke("cue:chooseFolder", options) as Promise<string | null>,
	reveal: (file: string) => ipcRenderer.invoke("cue:reveal", file),
	setApiKey: (key: string | null) => ipcRenderer.invoke("cue:setApiKey", key),
	getAppSettings: () =>
		ipcRenderer.invoke("cue:getAppSettings") as Promise<import("./core/runtime").AppSettings>,
	setAppSettings: (patch: Partial<import("./core/runtime").AppSettings>) =>
		ipcRenderer.invoke("cue:setAppSettings", patch),
	onAppSettings: (listener: (settings: import("./core/runtime").AppSettings) => void) => {
		const handler = (_event: IpcRendererEvent, settings: import("./core/runtime").AppSettings) =>
			listener(settings);
		ipcRenderer.on("cue:appSettings", handler);
		return () => {
			ipcRenderer.removeListener("cue:appSettings", handler);
		};
	},
	onOpenSettings: (listener: () => void) => {
		const handler = () => listener();
		ipcRenderer.on("cue:openSettings", handler);
		return () => {
			ipcRenderer.removeListener("cue:openSettings", handler);
		};
	},
	localInventory: (force = false) =>
		ipcRenderer.invoke("cue:localInventory", force) as Promise<{
			inventory: import("./core/local-ai").LocalInventory;
			downloads: Record<string, { url: string; sizeMb: number }>;
		}>,
	previewVoice: (voice: string) => ipcRenderer.invoke("cue:previewVoice", voice),
	startOllama: () => ipcRenderer.invoke("cue:startOllama"),
	downloadWhisper: (name: string) =>
		ipcRenderer.invoke("cue:downloadWhisper", name) as Promise<string>,
	onDownloadProgress: (listener: (name: string, fraction: number) => void) => {
		const handler = (_event: IpcRendererEvent, name: string, fraction: number) =>
			listener(name, fraction);
		ipcRenderer.on("cue:downloadProgress", handler);
		return () => {
			ipcRenderer.removeListener("cue:downloadProgress", handler);
		};
	},
	mcpCommand: () => ipcRenderer.invoke("cue:mcpCommand") as Promise<string>,
	/** How to connect each MCP client (Claude Code, Codex, Gemini CLI, Cursor…) to this copy of Cue. */
	mcpClients: () => ipcRenderer.invoke("cue:mcpClients") as Promise<McpClient[]>,
	updateStatus: () =>
		ipcRenderer.invoke("cue:updateStatus") as Promise<import("./core/updates").UpdateStatus>,
	onUpdateStatus: (listener: (status: import("./core/updates").UpdateStatus) => void) => {
		const handler = (_event: IpcRendererEvent, status: import("./core/updates").UpdateStatus) =>
			listener(status);
		ipcRenderer.on("cue:updateStatus", handler);
		return () => {
			ipcRenderer.removeListener("cue:updateStatus", handler);
		};
	},
	checkForUpdates: () =>
		ipcRenderer.invoke("cue:checkForUpdates") as Promise<
			import("./core/updates").UpdateStatus | undefined
		>,
	downloadUpdate: () =>
		ipcRenderer.invoke("cue:downloadUpdate") as Promise<
			import("./core/updates").UpdateStatus | undefined
		>,
	installUpdate: () => ipcRenderer.invoke("cue:installUpdate") as Promise<void>,
	/** Windows: colours of the window buttons drawn over the header. */
	setTitleBarColors: (color: string, symbolColor: string) =>
		ipcRenderer.send("cue:titleBarColors", color, symbolColor),
	/** Real path of a file dropped from Finder. */
	pathForFile: (file: File) => webUtils.getPathForFile(file),
	platform: process.platform,
};

contextBridge.exposeInMainWorld("cue", api);

export type CueApi = typeof api;
