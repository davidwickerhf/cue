import path from "node:path";
import { clipEnd } from "./project";
import type { Clip, Track } from "./types";

/**
 * Screen and camera recording: the pure parts (file names, ffmpeg arguments
 * and where the recorded clips go). Capturing itself happens in the editor
 * window with MediaRecorder; the main process writes the chunks and imports.
 */

/** What a recording source is, as listed for the user and agents. */
export interface CaptureSource {
	id: string;
	name: string;
	kind: "screen" | "window";
	/** Small preview image (data URL), only for the editor's picker. */
	thumbnail?: string;
}

export interface CaptureSources {
	sources: CaptureSource[];
	/** macOS Screen Recording permission: granted, denied, not-determined, restricted or unknown. */
	screenAccess: string;
	cameraAccess: string;
	microphoneAccess: string;
	cameras: { id: string; label: string }[];
	microphones: { id: string; label: string }[];
}

/** Explains how to allow screen recording, for when macOS blocks it. */
export const SCREEN_ACCESS_HELP =
	"macOS is blocking screen recording for Cue. Open System Settings → Privacy & Security → Screen & System Audio Recording, turn on Cue (or Electron when running from source), then quit and reopen Cue.";

/** A timestamp that sorts by time and is safe in file names (no colons): 2026-09-26 14.03.22 */
export function recordingStamp(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}

/**
 * Where a recording's raw files go: `<project>/recordings/<stamp> screen.webm`
 * and `... camera.webm`. `taken` says whether a name is already used, so two
 * recordings in the same second don't overwrite each other.
 */
export function recordingFiles(
	projectDir: string,
	date: Date,
	parts: { screen: boolean; camera: boolean },
	taken: (file: string) => boolean = () => false,
): { screen?: string; camera?: string } {
	const dir = path.join(projectDir, "recordings");
	const stamp = recordingStamp(date);
	const names = (suffix: string) => ({
		screen: parts.screen ? path.join(dir, `${stamp}${suffix} screen.webm`) : undefined,
		camera: parts.camera ? path.join(dir, `${stamp}${suffix} camera.webm`) : undefined,
	});
	for (let n = 1; ; n++) {
		const files = names(n === 1 ? "" : ` ${n}`);
		const all = [files.screen, files.camera].filter((f): f is string => !!f);
		// The MP4s are what stay, so a clash with those counts too.
		if (!all.some((f) => taken(f) || taken(mp4Name(f)))) return files;
	}
}

/** The MP4 a raw recording becomes: same name, .mp4. */
export function mp4Name(file: string): string {
	return file.replace(/\.webm$/i, ".mp4");
}

/**
 * ffmpeg arguments that turn a MediaRecorder WebM into an MP4 the editor can
 * seek in: constant frame rate (screen capture only sends frames when
 * something changes), a keyframe every second, even dimensions (windows can be
 * odd-sized), AAC sound and the index at the front.
 */
export function mp4Args(
	input: string,
	output: string,
	options: { fps: number; hardware: boolean },
): string[] {
	const fps = Math.max(1, Math.round(options.fps));
	const video = options.hardware
		? ["-c:v", "h264_videotoolbox", "-q:v", "70"]
		: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];
	return [
		"-fflags",
		"+genpts",
		"-i",
		input,
		"-vf",
		`scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=${fps}`,
		...video,
		"-pix_fmt",
		"yuv420p",
		"-g",
		String(fps),
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-ar",
		"48000",
		"-movflags",
		"+faststart",
		output,
	];
}

/** An existing track, or a new video track inserted at this index of the track list. */
export type TrackChoice = { trackId: string } | { newTrackAt: number };

export interface PlacementPlan {
	/** The screen (or the camera when it is recorded alone). */
	main: TrackChoice;
	/** The camera, on the track right above the screen. */
	overlay?: TrackChoice;
}

/**
 * Chooses tracks for a recording placed at `atMs`: the lowest video track that
 * is free for the whole length, and for the camera the track right above it if
 * that one is free too. Otherwise new video tracks are made: above the other
 * video tracks but below titles, the camera's right above the screen's.
 * Tracks are listed top to bottom.
 */
export function planPlacement(
	tracks: Track[],
	clips: Clip[],
	atMs: number,
	lengths: { mainMs: number; overlayMs?: number },
): PlacementPlan {
	const free = (t: Track | undefined, lengthMs: number): t is Track =>
		!!t &&
		t.kind === "video" &&
		!t.locked &&
		!clips.some((c) => c.trackId === t.id && c.startMs < atMs + lengthMs && clipEnd(c) > atMs);
	const videoIndexes = tracks.map((t, i) => (t.kind === "video" ? i : -1)).filter((i) => i >= 0);
	// Bottom-most first: the main picture usually lives on the lowest video track.
	const mainIndex = [...videoIndexes].reverse().find((i) => free(tracks[i], lengths.mainMs));
	// New tracks go where the video tracks start, so titles stay on top.
	const firstPicture = tracks.findIndex((t) => t.kind !== "text");
	const top = videoIndexes[0] ?? (firstPicture < 0 ? tracks.length : firstPicture);
	const main: TrackChoice =
		mainIndex === undefined ? { newTrackAt: top } : { trackId: tracks[mainIndex].id };
	if (lengths.overlayMs === undefined) return { main };
	if (mainIndex !== undefined && mainIndex > 0 && free(tracks[mainIndex - 1], lengths.overlayMs))
		return { main, overlay: { trackId: tracks[mainIndex - 1].id } };
	// A new track at the main track's place pushes it down, so the camera ends up right above.
	return { main, overlay: { newTrackAt: mainIndex ?? top } };
}

/** Backgrounds for the studio look (pictures in resources/studio). */
export const WALLPAPERS = ["dusk", "ocean", "graphite", "mint", "sunrise"] as const;
export type Wallpaper = (typeof WALLPAPERS)[number];

/** The Recordly-style finish for a screen recording, as chosen before recording. */
export interface StudioChoice {
	/** Picture behind the screen, or none (the canvas colour). */
	wallpaper: Wallpaper | "none";
	/** Zoom in where the clicks are. */
	zoom: boolean;
	/** Leave the real pointer out and draw a smooth, larger one. */
	cursor: boolean;
	/** A ripple on each click. */
	clickEffect: boolean;
	/** Cursor size, 0.5–2 (1 is about 5% of the frame's height). */
	cursorSize: number;
}

export const DEFAULT_STUDIO: StudioChoice = {
	wallpaper: "dusk",
	zoom: true,
	cursor: true,
	clickEffect: true,
	cursorSize: 1,
};

/** Recording options chosen in the dialog or by an agent. */
export interface CaptureOptions {
	/** A screen or window id from list_capture_sources; null records the camera alone. */
	sourceId: string | null;
	camera: boolean;
	microphone: boolean;
	/** Show the camera as a small picture in the corner of the screen recording. */
	bubble: boolean;
	/** Stop by itself after this long (seconds). */
	maxSeconds?: number;
}

/** Checks a set of options makes a recording at all. */
export function checkCaptureOptions(options: CaptureOptions): void {
	if (!options.sourceId && !options.camera)
		throw new Error("Choose a screen or window, or turn the camera on.");
}
