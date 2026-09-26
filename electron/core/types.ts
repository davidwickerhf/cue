/** Who performed an operation. Every change is attributed so the UI can show agent activity. */
export type Actor = "user" | "agent" | "system";

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

export type AssetKind = "video" | "audio" | "image";
export type AssetOrigin = "import" | "recording" | "tts" | "generated";

export interface Asset {
	id: string;
	kind: AssetKind;
	name: string;
	/** Relative to the project directory, or absolute when outside it. */
	path: string;
	/** 0 for images. */
	durationMs: number;
	width: number;
	height: number;
	hasAudio: boolean;
	origin: AssetOrigin;
	createdAt: string;
	/** Set for voiceover takes (recorded or generated for a script line). */
	lineId?: string;
	/** Video time at which a recording started, used to place takes. */
	recordedAtMs?: number;
	speechStartMs?: number;
	speechEndMs?: number;
	peakDb?: number | null;
	/** Prompt, voice or model for generated media. */
	generation?: { provider: string; model: string; prompt: string; voice?: string };
	actor: Actor;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type TrackKind = "video" | "audio" | "text";

export interface Track {
	id: string;
	kind: TrackKind;
	name: string;
	muted: boolean;
	locked: boolean;
	hidden: boolean;
	/** 0–2, 1 is unity. */
	volume: number;
	/** The track new voiceover takes are placed on. */
	voiceover?: boolean;
	/** Lower this track while the voiceover speaks. */
	duck?: boolean;
}

export interface Crop {
	/** Share of the source removed from each edge, 0–0.45. */
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface Transform {
	/** Centre of the clip on the canvas, 0–1. */
	x: number;
	y: number;
	/** 1 fits the canvas. */
	scale: number;
	opacity: number;
	crop: Crop;
}

export interface MediaClip {
	id: string;
	type: "media";
	trackId: string;
	assetId: string;
	/** Position on the timeline. */
	startMs: number;
	/** Length on the timeline (after speed). */
	durationMs: number;
	/** Offset into the source. */
	inMs: number;
	speed: number;
	volume: number;
	fadeInMs: number;
	fadeOutMs: number;
	transform: Transform;
	/** Reduce background noise in this clip's audio. */
	denoise: boolean;
	/** Voiceover clips remember the script line they belong to. */
	lineId?: string;
	name?: string;
}

export type TextAnimation = "none" | "fade" | "pop" | "slide-up" | "typewriter";

export interface TextStyle {
	fontFamily: string;
	/** Pixels on the export canvas. */
	fontSize: number;
	fontWeight: number;
	color: string;
	/** CSS colour or null for no box. */
	background: string | null;
	align: "left" | "center" | "right";
	/** Centre of the text box on the canvas, 0–1. */
	x: number;
	y: number;
	/** Box width as a share of the canvas. */
	width: number;
	padding: number;
	radius: number;
	shadow: boolean;
	uppercase: boolean;
	letterSpacing: number;
	lineHeight: number;
}

export interface TextClip {
	id: string;
	type: "text";
	trackId: string;
	startMs: number;
	durationMs: number;
	text: string;
	style: TextStyle;
	animationIn: TextAnimation;
	animationOut: TextAnimation;
	/** Captions generated from speech keep a pointer to their source. */
	source?: { kind: "caption"; assetId?: string };
	name?: string;
}

export type Clip = MediaClip | TextClip;

// ---------------------------------------------------------------------------
// Voiceover script
// ---------------------------------------------------------------------------

export interface ScriptLine {
	id: string;
	text: string;
	/** Where the line should start on the timeline. */
	startMs: number;
	/** Comfortable length for the line. */
	targetMs: number;
	/** Longest the line can run before it collides with what follows. */
	maxMs: number;
	section?: string;
	notes?: string;
}

export interface Marker {
	id: string;
	atMs: number;
	label: string;
	color: "accent" | "success" | "warning" | "danger";
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface Canvas {
	width: number;
	height: number;
	fps: number;
	background: string;
}

export interface RecordingSettings {
	prerollMs: number;
	postrollMs: number;
	autoStop: boolean;
	/** Whether the timeline's other audio plays while recording. */
	monitor: "mute" | "timeline";
	/** Silence kept around trimmed speech. */
	padMs: number;
	silenceDb: number;
}

export interface ExportSettings {
	stemsDir: string;
	/** `{id}` and `{index}` are replaced. */
	stemPattern: string;
	normalize: boolean;
	voiceoverFile: string;
	videoFile: string;
	videoQuality: "draft" | "standard" | "high";
	codec: "h264" | "hevc" | "prores";
	/** Use the GPU encoder (VideoToolbox on macOS) for H.264/HEVC. */
	hardware: boolean;
	/** Output size relative to the canvas. */
	scale: number;
	captionsFile: string;
}

export interface AiSettings {
	ttsModel: string;
	voice: string;
	voiceInstructions: string;
	transcriptionModel: string;
	imageModel: string;
}

export interface ProjectData {
	version: 2;
	name: string;
	canvas: Canvas;
	assets: Asset[];
	tracks: Track[];
	clips: Clip[];
	lines: ScriptLine[];
	markers: Marker[];
	settings: RecordingSettings;
	export: ExportSettings;
	ai: AiSettings;
}

// ---------------------------------------------------------------------------
// Views sent to the editor and agents
// ---------------------------------------------------------------------------

export type LineStatus = "empty" | "ok" | "tight" | "over";

export interface LineView extends ScriptLine {
	index: number;
	takes: Asset[];
	/** Asset used by the line's clip on the voiceover track. */
	chosenAssetId: string | null;
	clipId: string | null;
	status: LineStatus;
	/** Speech length of the chosen take. */
	speechMs: number | null;
	/** Where the chosen take's speech starts on the timeline. */
	placementMs: number | null;
}

export interface ActivityEntry {
	id: number;
	at: string;
	actor: Actor;
	summary: string;
}

export interface ProjectSnapshot {
	path: string;
	dir: string;
	data: ProjectData;
	/** Absolute file URL per asset id, loadable by the editor. */
	assetUrls: Record<string, string>;
	durationMs: number;
	lines: LineView[];
	canUndo: boolean;
	canRedo: boolean;
	dirty: boolean;
}

export interface AgentStatus {
	connected: boolean;
	lastSeenAt: string | null;
	requests: number;
	controlPort: number | null;
}

export interface RecorderStatus {
	uiReady: boolean;
	micReady: boolean;
	recordingLineId: string | null;
	playing: boolean;
	currentMs: number;
}

export interface JobStatus {
	id: string;
	label: string;
	progress: number | null;
	state: "running" | "done" | "failed";
	message?: string;
}

export interface AppState {
	project: ProjectSnapshot | null;
	selectedLineId: string | null;
	selectedClipIds: string[];
	recorder: RecorderStatus;
	agent: AgentStatus;
	activity: ActivityEntry[];
	recent: RecentProject[];
	jobs: JobStatus[];
	ai: { configured: boolean; provider: "openai" | null };
}

export interface RecentProject {
	path: string;
	name: string;
	openedAt: string;
}

export type PreviewMode = "all" | "voiceover" | "muted";

/** Commands the main process sends to the editor window. */
export type EditorCommand =
	| { type: "record"; lineId: string; prerollMs?: number; requestId?: string }
	| { type: "stop" }
	| { type: "play"; fromMs?: number; toMs?: number }
	| { type: "pause" }
	| { type: "seek"; ms: number }
	| { type: "previewAsset"; assetId: string }
	| { type: "renderText"; requestId: string; clipIds: string[]; fps: number }
	| { type: "captureFrame"; requestId: string; atMs: number };
