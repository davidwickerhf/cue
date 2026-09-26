import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from "electron";
import type { MethodName } from "./control/contract";
import type { AppState, EditorCommand, ProjectSummary, RecorderStatus } from "./core/types";

const api = {
	/** The same methods agents use, performed as the user. */
	call: <T = unknown>(method: MethodName, params?: unknown) =>
		ipcRenderer.invoke("cue:call", method, params) as Promise<T>,
	getState: () => ipcRenderer.invoke("cue:state") as Promise<AppState>,
	/** `projectUnchanged`: the project was left out because the window already has this version. */
	onState: (listener: (state: AppState, projectUnchanged: boolean) => void) => {
		const handler = (_event: IpcRendererEvent, state: AppState, projectUnchanged = false) =>
			listener(state, projectUnchanged);
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
	peaks: (assetId: string) => ipcRenderer.invoke("cue:peaks", assetId) as Promise<number[]>,
	audioProxy: (assetId: string, speed: number) =>
		ipcRenderer.invoke("cue:audioProxy", assetId, speed) as Promise<string>,
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
	/** Real path of a file dropped from Finder. */
	pathForFile: (file: File) => webUtils.getPathForFile(file),
	platform: process.platform,
};

contextBridge.exposeInMainWorld("cue", api);

export type CueApi = typeof api;
