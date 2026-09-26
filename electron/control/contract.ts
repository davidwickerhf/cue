import { z } from "zod";
import { clipInput, clipPatch } from "../core/ops";
import { aiSchema, exportSchema, lineInputSchema, settingsSchema, textStyleSchema } from "../core/project";

/**
 * The agent-facing API. Each entry becomes an MCP tool (through the bridge)
 * and a method on the app's local control server; the editor window calls the
 * same methods as the user. Descriptions are written for the calling model.
 */
const line = lineInputSchema.describe("Script line: id, text, startMs on the timeline, optional targetMs and maxMs.");
const ids = z.array(z.string()).min(1);

export const contract = {
	// --- Overview --------------------------------------------------------------
	get_state: {
		description:
			"Overview of the open project: canvas, tracks, media, script lines with take status (empty/ok/tight/over), selection and recorder. Call this first. Clips are summarised; use get_timeline for details.",
		input: {},
	},
	get_timeline: {
		description: "Every clip (id, track, start, duration, source in-point, text, style) optionally limited to a time range.",
		input: { fromMs: z.number().min(0).optional(), toMs: z.number().min(0).optional(), trackId: z.string().optional() },
	},
	render_frame: {
		description:
			"Render what the viewer sees at a moment as a PNG and return its path, so you can look at the edit (text layout, framing, captions).",
		input: { atMs: z.number().min(0) },
	},
	get_activity: { description: "Recent edits with who made them (user or agent).", input: { limit: z.number().int().min(1).max(200).default(30) } },

	// --- Projects --------------------------------------------------------------
	list_recent_projects: { description: "Recently opened projects.", input: {} },
	open_project: { description: "Open a .cue.json project (or a folder containing one).", input: { path: z.string() } },
	create_project: {
		description:
			"Create a project. Optionally start from a video (placed on track V1, canvas matches its size) and a voiceover script from an .srt file or a list of lines.",
		input: {
			path: z.string().describe("Project file or folder."),
			name: z.string().optional(),
			video: z.string().optional(),
			srt: z.string().optional(),
			lines: z.array(line).optional(),
		},
	},
	rename_project: { description: "Rename the project.", input: { name: z.string().min(1).max(200) } },
	set_canvas: {
		description: "Output size, frame rate and background colour.",
		input: { width: z.number().int().optional(), height: z.number().int().optional(), fps: z.number().optional(), background: z.string().optional() },
	},

	// --- Media and tracks -----------------------------------------------------------
	import_media: {
		description: "Add video, audio or image files to the media library. With trackId, also place them back to back from startMs.",
		input: { files: z.array(z.string()).min(1), trackId: z.string().optional(), startMs: z.number().min(0).default(0) },
	},
	list_media: { description: "The media library: id, kind, duration, origin (import/recording/tts/generated), which line a take belongs to.", input: {} },
	remove_media: { description: "Remove a media item and every clip that uses it.", input: { id: z.string() } },
	add_track: { description: "Add a video, audio or text track. index 0 is the top.", input: { kind: z.enum(["video", "audio", "text"]), name: z.string().optional(), index: z.number().int().optional() } },
	update_track: {
		description: "Rename, mute, lock, hide, set volume (0–2) or mark as the voiceover track.",
		input: {
			id: z.string(),
			patch: z.object({ name: z.string(), muted: z.boolean(), locked: z.boolean(), hidden: z.boolean(), volume: z.number().min(0).max(2), voiceover: z.boolean() }).partial(),
		},
	},
	remove_track: { description: "Delete a track and its clips.", input: { id: z.string() } },
	move_track: { description: "Reorder a track (0 = top; upper video tracks draw over lower ones).", input: { id: z.string(), index: z.number().int().min(0) } },

	// --- Clip editing -------------------------------------------------------------
	add_clips: {
		description:
			"Place clips. Media clip: {type:'media', trackId, assetId, startMs, durationMs?, inMs?, speed?, volume?, fadeInMs?, fadeOutMs?, transform?}. Text clip: {type:'text', trackId, startMs, durationMs?, text, style?, animationIn?, animationOut?}.",
		input: { clips: z.array(clipInput).min(1) },
	},
	add_text: {
		description:
			"Add a text overlay quickly. preset: title (large, centred), lower-third, caption (bottom) or label. Uses the first text track unless trackId is given.",
		input: {
			text: z.string().min(1),
			startMs: z.number().min(0),
			durationMs: z.number().min(100).default(3000),
			preset: z.enum(["title", "lower-third", "caption", "label"]).default("title"),
			trackId: z.string().optional(),
			style: textStyleSchema.partial().optional(),
		},
	},
	update_clip: {
		description: "Change a clip: timing, in-point, speed, volume, fades, transform (x, y, scale, opacity), text, style or animations.",
		input: { id: z.string(), patch: clipPatch },
	},
	move_clips: { description: "Move clips by deltaMs, optionally onto another track.", input: { ids, deltaMs: z.number(), trackId: z.string().optional() } },
	trim_clip: {
		description: "Move a clip's start or end edge to toMs. Extending is limited by the source media.",
		input: { id: z.string(), edge: z.enum(["start", "end"]), toMs: z.number().min(0) },
	},
	split_clip: { description: "Split one clip at a timeline position.", input: { id: z.string(), atMs: z.number() } },
	split_at: { description: "Blade: split every clip crossing atMs (optionally only on some tracks).", input: { atMs: z.number(), trackIds: z.array(z.string()).optional() } },
	delete_clips: { description: "Delete clips; ripple closes the gap on their tracks.", input: { ids, ripple: z.boolean().default(false) } },
	duplicate_clips: { description: "Copy clips right after themselves, or offsetMs from their start.", input: { ids, offsetMs: z.number().optional() } },
	select_clips: { description: "Select clips in the editor so the user sees what you mean.", input: { ids: z.array(z.string()) } },

	// --- Voiceover script and takes --------------------------------------------------
	set_lines: { description: "Replace the voiceover script.", input: { lines: z.array(line) } },
	import_script: {
		description: "Load script lines from an .srt file or a JSON array of lines. replace=false appends.",
		input: { file: z.string(), replace: z.boolean().default(true) },
	},
	add_line: { description: "Add one script line.", input: { line } },
	update_line: { description: "Change a line. Moving startMs also moves its voiceover clip.", input: { id: z.string(), patch: lineInputSchema.partial() } },
	remove_line: { description: "Delete a script line (takes stay in the library).", input: { id: z.string() } },
	shift_lines: { description: "Move lines starting at or after fromMs by deltaMs, with their clips.", input: { fromMs: z.number(), deltaMs: z.number() } },
	select_line: { description: "Focus a line in the editor (teleprompter and takes).", input: { id: z.string() } },
	record_line: {
		description:
			"Record a take with the user's microphone: the editor rolls from the pre-roll with a teleprompter and stops after the line's max + post-roll. Tell the user before calling. With wait=true returns the take with its speech length and fit.",
		input: { id: z.string(), prerollMs: z.number().min(0).max(10000).optional(), wait: z.boolean().default(true), timeoutMs: z.number().min(1000).max(600000).optional() },
	},
	stop_recording: { description: "Stop the current recording and keep it.", input: {} },
	import_take: {
		description: "Use an audio file as a take for a line. recordedAtMs is where the file starts on the timeline; otherwise its speech starts at the line start.",
		input: { lineId: z.string(), file: z.string(), recordedAtMs: z.number().min(0).optional() },
	},
	list_takes: { description: "Takes per line with speech length, fit and which one is used.", input: { lineId: z.string().optional() } },
	choose_take: { description: "Use a take for its line (null removes the line's voiceover clip).", input: { lineId: z.string(), assetId: z.string().nullable() } },
	delete_take: { description: "Delete a take.", input: { assetId: z.string() } },

	// --- Generative tools --------------------------------------------------------------
	generate_take: {
		description: "Generate a spoken take for a line with text-to-speech (placeholder or final voice). Optional voice and delivery instructions.",
		input: { lineId: z.string(), voice: z.string().optional(), instructions: z.string().max(2000).optional(), text: z.string().optional() },
	},
	generate_voiceover: {
		description: "Generate takes for many lines at once (by default only lines without a take).",
		input: { lineIds: z.array(z.string()).optional(), onlyMissing: z.boolean().default(true), voice: z.string().optional(), instructions: z.string().max(2000).optional() },
	},
	auto_captions: {
		description: "Transcribe the voiceover track (or the full mix) and add timed caption clips on a new Captions track.",
		input: { source: z.enum(["voiceover", "mix"]).default("voiceover"), maxChars: z.number().int().min(12).max(90).default(42), language: z.string().optional() },
	},
	script_from_media: {
		description: "Transcribe a media item's speech into script lines (e.g. to re-record an existing narration).",
		input: { assetId: z.string(), idPrefix: z.string().default("L"), replace: z.boolean().default(true) },
	},
	generate_image: {
		description: "Generate a still image (title card, B-roll, background). With trackId it is placed at startMs for 5 s.",
		input: { prompt: z.string().min(3), orientation: z.enum(["landscape", "portrait", "square"]).default("landscape"), trackId: z.string().optional(), startMs: z.number().min(0).default(0) },
	},

	// --- Playback -----------------------------------------------------------------------
	seek: { description: "Move the playhead.", input: { ms: z.number().min(0) } },
	play: { description: "Play from the playhead or fromMs (optionally stop at toMs).", input: { fromMs: z.number().min(0).optional(), toMs: z.number().min(0).optional() } },
	pause: { description: "Pause playback.", input: {} },
	preview_media: { description: "Play a media item (e.g. a take) on its own.", input: { assetId: z.string() } },

	// --- Settings, markers, history, export ------------------------------------------------
	update_settings: { description: "Recording settings: prerollMs, postrollMs, autoStop, monitor (mute/timeline), padMs, silenceDb.", input: { settings: settingsSchema.partial() } },
	update_export: { description: "Export settings: stemsDir, stemPattern ({id},{index}), normalize, voiceoverFile, videoFile ({name}), videoQuality.", input: { export: exportSchema.partial() } },
	update_ai: { description: "Generation settings: ttsModel, voice, voiceInstructions, transcriptionModel, imageModel.", input: { ai: aiSchema.partial() } },
	add_marker: {
		description: "Add a timeline marker, e.g. to flag something for the user.",
		input: { atMs: z.number().min(0), label: z.string().max(200), color: z.enum(["accent", "success", "warning", "danger"]).default("accent") },
	},
	remove_marker: { description: "Remove a marker.", input: { id: z.string() } },
	undo: { description: "Undo the last edit.", input: {} },
	redo: { description: "Redo.", input: {} },
	export: {
		description:
			"Export. stems: one WAV per script line + durations.json. voiceover: the voiceover track as one WAV. audio: full mix. video: rendered MP4 with every visible track and the mix.",
		input: { kind: z.enum(["stems", "voiceover", "audio", "video"]), out: z.string().optional() },
	},
	focus_window: { description: "Bring the Cue window to the front.", input: {} },
} as const;

export type MethodName = keyof typeof contract;
export type MethodInput<M extends MethodName> = z.output<z.ZodObject<(typeof contract)[M]["input"]>>;

export function parseInput<M extends MethodName>(method: M, params: unknown): MethodInput<M> {
	return z.object(contract[method].input).parse(params ?? {}) as MethodInput<M>;
}
