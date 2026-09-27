/** Who performed an operation. Every change is attributed so the UI can show agent activity. */
/** Noise reduction for a clip: off, a light FFT filter, or the RNNoise speech model. */
export type DenoiseMode = "off" | "light" | "voice";

export type Actor = "user" | "agent" | "system";

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

/**
 * "adjustment" is Cue's built-in adjustment layer: no file, it grades whatever is below it.
 * "lottie" is a motion graphic (After Effects via Bodymovin/LottieFiles), drawn by the app.
 */
export type AssetKind = "video" | "audio" | "image" | "adjustment" | "lottie";
export type AssetOrigin = "import" | "recording" | "tts" | "generated";

export interface Asset {
	id: string;
	kind: AssetKind;
	name: string;
	/** Relative to the project directory, or absolute when outside it. */
	path: string;
	/** Always relative to the project (may start with ../), used to find media that moved with the project. */
	relPath?: string;
	/** Bytes, to tell the right file from others with the same name when relinking. */
	size?: number;
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
	/** Set for nested sequences: this media is a render of that sequence. */
	sequenceId?: string;
	/**
	 * Set for another project placed as media: this is a render of that project
	 * (or one of its sequences), made again when the project file changes.
	 */
	projectSource?: { path: string; sequenceId?: string; modifiedMs: number };
	/** Word-level transcript of the speech in this media (source time). */
	transcript?: Transcript;
	/** The bin (folder) this media is filed in; none means the top level. */
	binId?: string;
	tags?: string[];
	/** 0–5 stars; 0 or none is unrated. Favourites are 5. */
	rating?: number;
	note?: string;
	/** Technical details read from the file (codec, frame rate, …), probed once and kept. */
	info?: MediaInfo;
	/** Motion graphics: frame rate, editable text layers and colours. */
	motion?: import("./motion").MotionInfo;
	/** Motion graphics made in Cue: the template and parameters, or the spec, it was built from. */
	motionSource?: MotionSource;
	actor: Actor;
}

export interface MotionSource {
	template?: string;
	params?: Record<string, unknown>;
	spec?: Record<string, unknown>;
}

/** What `ffmpeg -i` reports about a file. Fields are missing when the file doesn't say. */
export interface MediaInfo {
	/** Container, e.g. "mov" or "matroska". */
	format?: string;
	videoCodec?: string;
	/** e.g. "High" for H.264. */
	videoProfile?: string;
	pixelFormat?: string;
	fps?: number;
	/** Overall bitrate, kilobits per second. */
	bitrateKbps?: number;
	audioCodec?: string;
	audioChannels?: number;
	/** e.g. "stereo" or "5.1(side)". */
	channelLayout?: string;
	sampleRate?: number;
	/** When the camera or app says it was recorded (ISO). */
	creationTime?: string;
	/** Clockwise rotation the player applies (phone footage). */
	rotation?: number;
	/** When the file was probed (ISO), so a project probes each file once. */
	probedAt: string;
}

/** A folder in the media library. Bins nest one level deep. */
export interface Bin {
	id: string;
	name: string;
	parentId?: string;
}

export interface TranscriptWord {
	text: string;
	startMs: number;
	endMs: number;
}

export interface Transcript {
	model: string;
	createdAt: string;
	words: TranscriptWord[];
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
	/** Only soloed tracks are heard while any track is soloed. */
	solo?: boolean;
	/** Stereo balance, -1 left to 1 right. */
	pan?: number;
	/** Three-band EQ in dB (-12 to 12): low shelf, peaking mid, high shelf. */
	eq?: TrackEq;
	/** One-knob compressor, 0 (off) to 1. */
	compressor?: TrackCompressor;
}

export interface TrackEq {
	low: number;
	mid: number;
	high: number;
}

export interface TrackCompressor {
	amount: number;
}

export type ClipLabel = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink";

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
	/** Turn in degrees, clockwise (paper cut-outs sit a little askew). */
	rotation?: number;
	crop: Crop;
}

/** A small random drift, like a hand-held camera or a paper cut-out that is never quite still. */
export interface Wiggle {
	/** How far it drifts, in pixels of a 1080-line frame. */
	position: number;
	/** How far it turns, in degrees. */
	rotation: number;
	/** Drifts per second. */
	speed: number;
}

export type Ease = "linear" | "ease" | "ease-in" | "ease-out" | "hold" | "bezier";

/** Cubic bezier handles [x1, y1, x2, y2], as in CSS cubic-bezier(); x stays within 0–1. */
export type Curve = [number, number, number, number];

export interface Keyframe {
	/** Clip-local time. */
	atMs: number;
	value: number;
	/** How the value travels to the next keyframe. */
	ease: Ease;
	/** The custom curve used when `ease` is "bezier". */
	curve?: Curve;
}

export type KeyframeProp = "x" | "y" | "scale" | "rotation" | "opacity" | "volume";

/** A push-in on part of a video clip, like the auto-zooms of screen recorders. */
export interface Zoom {
	id: string;
	/** Clip-local start and end. */
	startMs: number;
	endMs: number;
	/** 1.2–4. */
	scale: number;
	/** Point of the source frame to zoom into, 0–1. */
	x: number;
	y: number;
	/** Time to zoom in and out. */
	easeMs: number;
}

/** A shape that limits which part of a clip is visible, in shares of the (uncropped) picture. */
export interface Mask {
	shape: "rectangle" | "ellipse";
	/** Centre, 0–1. */
	x: number;
	y: number;
	/** Size, 0–1 of the picture. */
	width: number;
	height: number;
	/** Soft edge, 0–1 of the shape's size. */
	feather: number;
	/** Show everything except the shape. */
	invert: boolean;
}

/** Chroma key: makes one colour (a green or blue screen) transparent. */
export interface ChromaKey {
	/** Hex colour, e.g. #00ff00. */
	color: string;
	/** How close a colour must be to be removed, 0.01–0.6. */
	similarity: number;
	/** Softness of the edge, 0–0.5. */
	blend: number;
}

export interface ColorGrade {
	/** -1–1, 0 is neutral. */
	brightness: number;
	/** 0–3, 1 is neutral. */
	contrast: number;
	/** 0–3, 1 is neutral. */
	saturation: number;
	/** -1 (cool) – 1 (warm). */
	temperature: number;
	/** Absolute path of a .cube LUT, applied on export. */
	lut?: string;
}

/** Picture effects, each 0 (off) to 1. */
export interface Effects {
	blur: number;
	sharpen: number;
	vignette: number;
	glow: number;
	/** Film grain, 0–1: moving noise over the picture (archive footage, paper, a filmic look). */
	grain: number;
	/** Smooth out camera shake (analysed on export). */
	stabilize: boolean;
}

/** How a picture combines with what is under it (textures: multiply for paper, screen for light leaks). */
export type BlendMode =
	| "normal"
	| "multiply"
	| "screen"
	| "overlay"
	| "soft-light"
	| "darken"
	| "lighten";

/** Rounded corners and a drop shadow around a picture (the "studio" look of screen recordings). */
export interface Frame {
	/** Corner radius in pixels of the export canvas. */
	radius: number;
	/** Shadow strength, 0 (none) – 1. */
	shadow: number;
}

export interface Transition {
	kind: import("./transitions").TransitionKind;
	durationMs: number;
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
	/** Reduce background noise in this clip's audio: an FFT filter (light) or the RNNoise voice model. */
	denoise: DenoiseMode;
	keyframes?: Partial<Record<KeyframeProp, Keyframe[]>>;
	zooms?: Zoom[];
	color?: ColorGrade;
	mask?: Mask;
	key?: ChromaKey;
	effects?: Effects;
	frame?: Frame;
	/** Blend with the tracks below; none is normal. */
	blend?: BlendMode;
	wiggle?: Wiggle;
	/**
	 * Movement held for whole steps at this rate (12 = "on twos", like stop-motion
	 * paper): keyframes, wiggle and motion graphics advance in steps, footage plays on.
	 */
	stepFps?: number;
	/** Motion graphics: this clip's text and colour changes, and whether it loops. */
	motion?: import("./motion").MotionSettings;
	/** How this clip enters from the clip before it on the same track. */
	transitionIn?: Transition;
	/** Clips with the same group move and delete together (e.g. linked picture and sound). */
	groupId?: string;
	/** Disabled clips stay on the timeline but are not seen or heard. */
	disabled?: boolean;
	label?: ClipLabel;
	/** Voiceover clips remember the script line they belong to. */
	lineId?: string;
	name?: string;
}

export type TextAnimation =
	| "none"
	| "fade"
	| "pop"
	| "slide-up"
	| "slide-left"
	| "zoom"
	| "typewriter";

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
	italic?: boolean;
	/** Outline around the letters. */
	strokeColor?: string | null;
	strokeWidth?: number;
	/** Second colour for a top-to-bottom gradient fill. */
	gradientTo?: string | null;
	/** Degrees, clockwise. */
	rotation?: number;
}

/**
 * A graphic drawn with a text clip (under its text): a box, an ellipse, a line
 * or an arrow, centred on the text position. Sizes are shares of the frame.
 */
export interface Shape {
	kind: "rect" | "ellipse" | "line" | "arrow";
	/** Box and ellipse size; for lines and arrows, the vector from start to end. */
	width: number;
	height: number;
	fill: string | null;
	stroke: string | null;
	/** Pixels on the export canvas. */
	strokeWidth: number;
	/** Corner radius of a box, pixels. */
	radius: number;
}

/** A word of a caption, with when it is said (clip-local). */
export interface CaptionWord {
	text: string;
	startMs: number;
	endMs: number;
}

/**
 * Word-by-word animation for captions and titles: highlight colours the word
 * being said, reveal shows words as they are said, pop and bounce move it.
 */
export interface WordStyle {
	mode: "highlight" | "reveal" | "pop" | "bounce";
	/** Colour of the word being said. */
	color: string;
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
	/** A graphic under the text (boxes, arrows, callouts). */
	shape?: Shape;
	/** Editable, data-driven graphic rendered identically in preview and export. */
	infographic?: Infographic;
	/** A leader line and data label anchored to a point in the picture. */
	dataCallout?: DataCallout;
	/** The words of `text` with their timing, for word-by-word animation. */
	words?: CaptionWord[];
	wordStyle?: WordStyle;
	groupId?: string;
	disabled?: boolean;
	label?: ClipLabel;
	name?: string;
}

export interface Infographic {
	kind: "bars" | "donut" | "cards" | "line" | "timeline";
	title: string;
	items: { label: string; value: number }[];
	unit?: string;
	source?: string;
	palette: "editorial" | "electric" | "mono";
}

export interface DataCallout {
	label: string;
	value?: string;
	source?: string;
	x: number;
	y: number;
	targetX: number;
	targetY: number;
	palette: "editorial" | "electric" | "mono";
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
	/** Play lightweight copies of large videos in the editor (exports always use the originals). */
	useProxies: boolean;
	/** A video's sound goes on an audio track (linked to the picture) when it is placed. */
	separateAudio: boolean;
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

/** A timeline that is not open right now (the open one lives in ProjectData.tracks/clips/markers). */
export interface Sequence {
	id: string;
	name: string;
	tracks: Track[];
	clips: Clip[];
	markers: Marker[];
}

export interface ProjectData {
	version: 2;
	name: string;
	canvas: Canvas;
	assets: Asset[];
	/** Folders for media (older projects have none). */
	bins?: Bin[];
	/** The open timeline. */
	tracks: Track[];
	clips: Clip[];
	lines: ScriptLine[];
	markers: Marker[];
	settings: RecordingSettings;
	export: ExportSettings;
	ai: AiSettings;
	/** Which timeline is open ("main" unless another sequence was opened). */
	sequence?: { id: string; name: string };
	/** The other timelines in the project. */
	sequences?: Sequence[];
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
	/** Increases with every change, so views can skip work when nothing changed. */
	revision: number;
	path: string;
	dir: string;
	data: ProjectData;
	/** Absolute file URL per asset id, loadable by the editor. */
	assetUrls: Record<string, string>;
	/** Lightweight playback copies of videos, when ready. */
	proxyUrls: Record<string, string>;
	durationMs: number;
	lines: LineView[];
	canUndo: boolean;
	canRedo: boolean;
	dirty: boolean;
	/** Media whose file can't be found (moved, renamed or on a disconnected drive). */
	offline: string[];
	/** Agent edits waiting for the user's decision (review mode). */
	proposal: Proposal | null;
}

/** What an agent changed on the open timeline since the user last decided. */
export interface Proposal {
	/** What the agent did, in order. */
	steps: string[];
	added: string[];
	changed: string[];
	/** Clips the agent removed, as they were. */
	removed: Clip[];
	/** Changes outside the open timeline's clips (tracks, media, markers, settings). */
	other: boolean;
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
	/** The editor's in and out marks and open panel, so agents see what the user sees. */
	inMs?: number | null;
	outMs?: number | null;
	panel?: string;
	/** A screen or camera recording is running (record_screen / the Record dialog). */
	capturing?: boolean;
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
	/** Goes up whenever a project collection changes (the projects overview reloads). */
	collectionsVersion?: number;
	jobs: JobStatus[];
	ai: {
		configured: boolean;
		provider: "openai" | null;
		status: {
			capability: "tts" | "transcription" | "text" | "image";
			provider: string;
			ready: boolean;
			problem?: string;
			model?: string;
		}[];
	};
}

export interface RecentProject {
	path: string;
	name: string;
	openedAt: string;
}

/** A project as shown in the projects overview. */
export interface ProjectSummary {
	path: string;
	name: string;
	openedAt?: string;
	modifiedAt: string;
	durationMs: number;
	width: number;
	height: number;
	fps: number;
	clipCount: number;
	posterUrl?: string;
	/** False when the file has been moved or deleted. */
	exists: boolean;
	problem?: string;
	/** The collection it is filed in, if any. */
	collectionId?: string;
}

export type PreviewMode = "all" | "voiceover" | "muted";

/** Commands the main process sends to the editor window. */
export type EditorCommand =
	| { type: "record"; lineId: string; prerollMs?: number; requestId?: string }
	| { type: "stop" }
	| {
			type: "recordScreen";
			requestId: string;
			sourceId: string | null;
			camera: boolean;
			microphone: boolean;
			bubble: boolean;
			maxSeconds?: number;
			studio?: import("./capture").StudioChoice | null;
			cameraId?: string;
			microphoneId?: string;
	  }
	| { type: "stopScreen" }
	| { type: "listDevices"; requestId: string }
	| { type: "play"; fromMs?: number; toMs?: number }
	| { type: "pause" }
	| { type: "seek"; ms: number }
	| { type: "previewAsset"; assetId: string }
	| { type: "showStyle"; id: string }
	| { type: "showLibraryAsset"; id: string }
	| {
			type: "renderText";
			requestId: string;
			clipIds: string[];
			/** Text clips, and media clips of motion graphics (drawn at `sizes[id]`). */
			clips?: (TextClip | MediaClip)[];
			sizes?: Record<string, { width: number; height: number }>;
			fps: number;
			/** Frame size to draw at (a variant's may differ from the open project's). */
			width?: number;
			height?: number;
			/** Motion graphics of another project (placed as media), by asset id. */
			assets?: Record<string, { motion: import("./motion").MotionInfo; url: string }>;
	  }
	| { type: "captureFrame"; requestId: string; atMs: number }
	| { type: "captureDone" }
	| { type: "setInOut"; inMs?: number | null; outMs?: number | null }
	| {
			type: "setView";
			page?: string;
			motionAssetId?: string;
			panel?: string;
			fitTimeline?: boolean;
			openSource?: string;
			zoom?: number;
			workspace?: string;
			dock?: string;
			viewerZoom?: number | "fit";
			overlays?: Partial<
				Record<"safeAreas" | "teleprompter" | "compare" | "sourceTwoUp" | "clipStrip", boolean>
			>;
			beforeAfter?: { split: boolean; at?: number };
			compareSequences?: [string, string] | null;
	  }
	| { type: "pauseScreen"; paused: boolean };
