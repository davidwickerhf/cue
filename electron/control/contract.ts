import { z } from "zod";
import { clipInput, clipPatch } from "../core/ops";
import {
	aiSchema,
	exportSchema,
	lineInputSchema,
	settingsSchema,
	textStyleSchema,
} from "../core/project";

/**
 * The agent-facing API. Each entry becomes an MCP tool (through the bridge)
 * and a method on the app's local control server; the editor window calls the
 * same methods as the user. Descriptions are written for the calling model.
 */
const line = lineInputSchema.describe(
	"Script line: id, text, startMs on the timeline, optional targetMs and maxMs.",
);
const ids = z.array(z.string()).min(1);

export const contract = {
	// --- Overview --------------------------------------------------------------
	get_state: {
		description:
			"Overview of the open project: canvas, tracks, media, script lines with take status (empty/ok/tight/over), selection and recorder. Call this first. Clips are summarised; use get_timeline for details.",
		input: {},
	},
	get_timeline: {
		description:
			"Every clip (id, track, start, duration, source in-point, text, style) optionally limited to a time range.",
		input: {
			fromMs: z.number().min(0).optional(),
			toMs: z.number().min(0).optional(),
			trackId: z.string().optional(),
		},
	},
	render_frame: {
		description:
			"Render what the viewer sees at a moment as a PNG and return its path, so you can look at the edit (text layout, framing, captions).",
		input: { atMs: z.number().min(0) },
	},
	get_activity: {
		description: "Recent edits with who made them (user or agent).",
		input: { limit: z.number().int().min(1).max(200).default(30) },
	},

	// --- Projects --------------------------------------------------------------
	list_recent_projects: { description: "Recently opened projects.", input: {} },
	list_projects: {
		description:
			"Every project in the projects overview (recent ones and those in the projects folder) with length, canvas, clip count and last change.",
		input: {},
	},
	close_project: {
		description: "Save and close the open project, back to the projects overview.",
		input: {},
	},
	save_project_as: {
		description:
			"Save a copy of the project (.cueproj) at a new path and switch to it. Media stays where it is.",
		input: { path: z.string() },
	},
	relink_media: {
		description:
			"Point offline media (moved, renamed or on a disconnected drive; see offlineMedia in get_state) at its new file. Other offline media in the same folder is relinked too.",
		input: { assetId: z.string(), file: z.string() },
	},
	find_offline_media: {
		description:
			"Search near the project (and optionally in extra folders) for offline media that moved, and relink what is found.",
		input: { folders: z.array(z.string()).optional() },
	},
	import_timeline: {
		description:
			"Import an OpenTimelineIO (.otio) timeline from DaVinci Resolve, Premiere, Kdenlive and others as new tracks. Media is linked in place.",
		input: { file: z.string() },
	},
	open_project: {
		description:
			"Open a .cueproj project (or a folder containing one; older .cue.json files work too).",
		input: { path: z.string() },
	},
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
	rename_project: {
		description: "Rename the project.",
		input: { name: z.string().min(1).max(200) },
	},
	set_canvas: {
		description: "Output size, frame rate and background colour.",
		input: {
			width: z.number().int().optional(),
			height: z.number().int().optional(),
			fps: z.number().optional(),
			background: z.string().optional(),
		},
	},

	// --- Media and tracks -----------------------------------------------------------
	import_media: {
		description:
			"Add video, audio or image files to the media library. With trackId, also place them back to back from startMs.",
		input: {
			files: z.array(z.string()).min(1),
			trackId: z.string().optional(),
			startMs: z.number().min(0).default(0),
		},
	},
	list_media: {
		description:
			"The media library: id, kind, duration, origin (import/recording/tts/generated), which line a take belongs to.",
		input: {},
	},
	remove_media: {
		description: "Remove a media item and every clip that uses it.",
		input: { id: z.string() },
	},
	add_track: {
		description: "Add a video, audio or text track. index 0 is the top.",
		input: {
			kind: z.enum(["video", "audio", "text"]),
			name: z.string().optional(),
			index: z.number().int().optional(),
		},
	},
	update_track: {
		description:
			"Rename, mute, lock, hide, set volume (0–2), mark as the voiceover track, or duck it (lower it automatically while the voiceover speaks).",
		input: {
			id: z.string(),
			patch: z
				.object({
					name: z.string(),
					muted: z.boolean(),
					locked: z.boolean(),
					hidden: z.boolean(),
					volume: z.number().min(0).max(2),
					voiceover: z.boolean(),
					duck: z.boolean(),
				})
				.partial(),
		},
	},
	remove_track: { description: "Delete a track and its clips.", input: { id: z.string() } },
	move_track: {
		description: "Reorder a track (0 = top; upper video tracks draw over lower ones).",
		input: { id: z.string(), index: z.number().int().min(0) },
	},

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
		description:
			"Change a clip: timing, in-point, speed, volume, fades, denoise, color {brightness -1–1, contrast 0–3, saturation 0–3, temperature -1–1, lut: .cube path}, transform (x, y, scale, opacity, crop {left,top,right,bottom} as shares 0–0.45), text, style or animations.",
		input: { id: z.string(), patch: clipPatch },
	},
	move_clips: {
		description: "Move clips by deltaMs, optionally onto another track.",
		input: { ids, deltaMs: z.number(), trackId: z.string().optional() },
	},
	trim_clip: {
		description:
			"Move a clip's start or end edge to toMs. Extending is limited by the source media.",
		input: { id: z.string(), edge: z.enum(["start", "end"]), toMs: z.number().min(0) },
	},
	split_clip: {
		description: "Split one clip at a timeline position.",
		input: { id: z.string(), atMs: z.number() },
	},
	split_at: {
		description: "Blade: split every clip crossing atMs (optionally only on some tracks).",
		input: { atMs: z.number(), trackIds: z.array(z.string()).optional() },
	},
	delete_clips: {
		description: "Delete clips; ripple closes the gap on their tracks.",
		input: { ids, ripple: z.boolean().default(false) },
	},
	detach_audio: {
		description: "Split a video clip's sound onto its own audio track (the video clip is muted).",
		input: { id: z.string(), trackId: z.string().optional() },
	},
	remove_ranges: {
		description:
			"Cut time ranges out of the timeline on every (or the given) track and close the gaps. Script lines and markers after a range move with it.",
		input: {
			ranges: z.array(z.object({ startMs: z.number().min(0), endMs: z.number().min(0) })).min(1),
			trackIds: z.array(z.string()).optional(),
		},
	},
	remove_silence: {
		description:
			"Find pauses in the speech (video and voiceover audio, or given clips) and cut them out across all tracks. keepMs leaves a little air on each side. Use dryRun to preview the ranges first.",
		input: {
			clipIds: z.array(z.string()).optional(),
			thresholdDb: z.number().min(-80).max(-10).default(-38),
			minSilenceMs: z.number().min(100).max(10000).default(600),
			keepMs: z.number().min(0).max(1000).default(150),
			dryRun: z.boolean().default(false),
		},
	},
	slip_clip: {
		description:
			"Change which part of the source a clip shows without moving it (deltaMs of source time).",
		input: { id: z.string(), deltaMs: z.number() },
	},
	roll_edit: {
		description:
			"Move the cut between two adjacent clips on a track to toMs (one gets longer, the other shorter).",
		input: { leftId: z.string(), rightId: z.string(), toMs: z.number().min(0) },
	},
	slide_clip: {
		description:
			"Move a clip between its neighbours; the neighbour before grows and the one after shrinks so nothing else moves.",
		input: { id: z.string(), deltaMs: z.number() },
	},
	group_clips: {
		description: "Link clips so they move and delete together (e.g. picture and its sound).",
		input: { ids: z.array(z.string()).min(2) },
	},
	ungroup_clips: { description: "Unlink clips.", input: { ids: z.array(z.string()).min(1) } },
	add_transition: {
		description:
			"Transition into a clip from the clip right before it on the same track. crossfade overlaps the two (later clips move left by the overlap); dip fades through black.",
		input: {
			clipId: z.string(),
			kind: z.enum(["crossfade", "dip"]).default("crossfade"),
			durationMs: z.number().min(40).max(5000).default(600),
		},
	},
	remove_transition: {
		description: "Remove a clip's transition (a crossfade's overlap is undone).",
		input: { clipId: z.string() },
	},
	set_keyframe: {
		description:
			"Animate a media clip: set x or y (0–1, centre on canvas), scale (1 = fit) or volume (0–2) at a clip-local time. ease: linear, ease or hold.",
		input: {
			clipId: z.string(),
			prop: z.enum(["x", "y", "scale", "volume"]),
			atMs: z.number().min(0),
			value: z.number(),
			ease: z.enum(["linear", "ease", "hold"]).default("ease"),
		},
	},
	remove_keyframe: {
		description: "Remove one keyframe.",
		input: {
			clipId: z.string(),
			prop: z.enum(["x", "y", "scale", "volume"]),
			atMs: z.number().min(0),
		},
	},
	clear_keyframes: {
		description: "Remove all keyframes of a property (or of the clip).",
		input: { clipId: z.string(), prop: z.enum(["x", "y", "scale", "volume"]).optional() },
	},
	add_zoom: {
		description:
			"Push in on part of a video clip, like a screen recorder's auto-zoom: startMs/endMs are clip-local, x/y is the point of the source to zoom into (0–1), scale 1.2–4.",
		input: {
			clipId: z.string(),
			startMs: z.number().min(0),
			endMs: z.number().min(0),
			scale: z.number().min(1).max(6).default(1.8),
			x: z.number().min(0).max(1).default(0.5),
			y: z.number().min(0).max(1).default(0.5),
			easeMs: z.number().min(0).max(3000).default(450),
		},
	},
	update_zoom: {
		description: "Change a zoom.",
		input: {
			clipId: z.string(),
			zoomId: z.string(),
			patch: z
				.object({
					startMs: z.number(),
					endMs: z.number(),
					scale: z.number(),
					x: z.number(),
					y: z.number(),
					easeMs: z.number(),
				})
				.partial(),
		},
	},
	remove_zoom: { description: "Remove a zoom.", input: { clipId: z.string(), zoomId: z.string() } },
	transcribe_media: {
		description:
			"Word-level transcript of a media item (stored on it). Needed for text-based editing.",
		input: { assetId: z.string(), language: z.string().optional() },
	},
	get_transcript: {
		description:
			"Words of a transcribed media item with their index and source time. Optionally search for a phrase to get its word indices.",
		input: { assetId: z.string(), search: z.string().optional() },
	},
	cut_words: {
		description:
			"Text-based editing: remove words (inclusive index ranges from get_transcript) from the timeline on every track, closing the gaps.",
		input: {
			assetId: z.string(),
			ranges: z
				.array(z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }))
				.min(1),
		},
	},
	remove_filler_words: {
		description: "Cut um, uh, erm and similar from a transcribed media item across all tracks.",
		input: { assetId: z.string(), fillers: z.array(z.string()).optional() },
	},
	build_proxies: {
		description:
			"Create lightweight playback copies of large videos so the editor plays and scrubs smoothly.",
		input: {},
	},
	duplicate_clips: {
		description: "Copy clips right after themselves, or offsetMs from their start.",
		input: { ids, offsetMs: z.number().optional() },
	},
	select_clips: {
		description: "Select clips in the editor so the user sees what you mean.",
		input: { ids: z.array(z.string()) },
	},

	// --- Voiceover script and takes --------------------------------------------------
	set_lines: { description: "Replace the voiceover script.", input: { lines: z.array(line) } },
	import_script: {
		description:
			"Load script lines from an .srt file or a JSON array of lines. replace=false appends.",
		input: { file: z.string(), replace: z.boolean().default(true) },
	},
	add_line: { description: "Add one script line.", input: { line } },
	update_line: {
		description: "Change a line. Moving startMs also moves its voiceover clip.",
		input: { id: z.string(), patch: lineInputSchema.partial() },
	},
	remove_line: {
		description: "Delete a script line (takes stay in the library).",
		input: { id: z.string() },
	},
	shift_lines: {
		description: "Move lines starting at or after fromMs by deltaMs, with their clips.",
		input: { fromMs: z.number(), deltaMs: z.number() },
	},
	select_line: {
		description: "Focus a line in the editor (teleprompter and takes).",
		input: { id: z.string() },
	},
	record_line: {
		description:
			"Record a take with the user's microphone: the editor rolls from the pre-roll with a teleprompter and stops after the line's max + post-roll. Tell the user before calling. With wait=true returns the take with its speech length and fit.",
		input: {
			id: z.string(),
			prerollMs: z.number().min(0).max(10000).optional(),
			wait: z.boolean().default(true),
			timeoutMs: z.number().min(1000).max(600000).optional(),
		},
	},
	stop_recording: { description: "Stop the current recording and keep it.", input: {} },
	import_take: {
		description:
			"Use an audio file as a take for a line. recordedAtMs is where the file starts on the timeline; otherwise its speech starts at the line start.",
		input: { lineId: z.string(), file: z.string(), recordedAtMs: z.number().min(0).optional() },
	},
	list_takes: {
		description: "Takes per line with speech length, fit and which one is used.",
		input: { lineId: z.string().optional() },
	},
	choose_take: {
		description: "Use a take for its line (null removes the line's voiceover clip).",
		input: { lineId: z.string(), assetId: z.string().nullable() },
	},
	delete_take: { description: "Delete a take.", input: { assetId: z.string() } },

	// --- Generative tools --------------------------------------------------------------
	generate_take: {
		description:
			"Generate a spoken take for a line with text-to-speech (placeholder or final voice). Optional voice and delivery instructions.",
		input: {
			lineId: z.string(),
			voice: z.string().optional(),
			instructions: z.string().max(2000).optional(),
			text: z.string().optional(),
		},
	},
	rewrite_line: {
		description:
			"Rewrite a script line with the text model (OpenAI, Ollama or LM Studio per settings). goal fit makes it fit the line's max length; clearer, shorter, or custom with instructions. Returns before and after.",
		input: {
			id: z.string(),
			goal: z.enum(["fit", "clearer", "shorter", "custom"]).default("fit"),
			instructions: z.string().max(1000).optional(),
		},
	},
	get_ai_status: {
		description:
			"Which providers handle voice, transcription, text and images (cloud or on this Mac), and whether each is ready.",
		input: {},
	},
	generate_voiceover: {
		description: "Generate takes for many lines at once (by default only lines without a take).",
		input: {
			lineIds: z.array(z.string()).optional(),
			onlyMissing: z.boolean().default(true),
			voice: z.string().optional(),
			instructions: z.string().max(2000).optional(),
		},
	},
	auto_captions: {
		description:
			"Transcribe the voiceover track (or the full mix) and add timed caption clips on a new Captions track.",
		input: {
			source: z.enum(["voiceover", "mix"]).default("voiceover"),
			maxChars: z.number().int().min(12).max(90).default(42),
			language: z.string().optional(),
		},
	},
	script_from_media: {
		description:
			"Transcribe a media item's speech into script lines (e.g. to re-record an existing narration).",
		input: {
			assetId: z.string(),
			idPrefix: z.string().default("L"),
			replace: z.boolean().default(true),
		},
	},
	generate_image: {
		description:
			"Generate a still image (title card, B-roll, background). With trackId it is placed at startMs for 5 s.",
		input: {
			prompt: z.string().min(3),
			orientation: z.enum(["landscape", "portrait", "square"]).default("landscape"),
			trackId: z.string().optional(),
			startMs: z.number().min(0).default(0),
		},
	},

	// --- Playback -----------------------------------------------------------------------
	seek: { description: "Move the playhead.", input: { ms: z.number().min(0) } },
	play: {
		description: "Play from the playhead or fromMs (optionally stop at toMs).",
		input: { fromMs: z.number().min(0).optional(), toMs: z.number().min(0).optional() },
	},
	pause: { description: "Pause playback.", input: {} },
	preview_media: {
		description: "Play a media item (e.g. a take) on its own.",
		input: { assetId: z.string() },
	},

	// --- Settings, markers, history, export ------------------------------------------------
	update_settings: {
		description:
			"Recording settings: prerollMs, postrollMs, autoStop, monitor (mute/timeline), padMs, silenceDb.",
		input: { settings: settingsSchema.partial() },
	},
	update_export: {
		description:
			"Export settings: stemsDir, stemPattern ({id},{index}), normalize, voiceoverFile, videoFile ({name}), videoQuality.",
		input: { export: exportSchema.partial() },
	},
	update_ai: {
		description:
			"Generation settings: ttsModel, voice, voiceInstructions, transcriptionModel, imageModel.",
		input: { ai: aiSchema.partial() },
	},
	add_marker: {
		description: "Add a timeline marker, e.g. to flag something for the user.",
		input: {
			atMs: z.number().min(0),
			label: z.string().max(200),
			color: z.enum(["accent", "success", "warning", "danger"]).default("accent"),
		},
	},
	remove_marker: { description: "Remove a marker.", input: { id: z.string() } },
	undo: { description: "Undo the last edit.", input: {} },
	redo: { description: "Redo.", input: {} },
	export: {
		description:
			"Export. stems: one WAV per script line + durations.json. voiceover: the voiceover track as one WAV. audio: full mix (with ducking). video: rendered video with every visible track and the mix (codec, hardware encoding and scale from export settings). captions: SRT + VTT from the caption clips. otio / fcpxml / mlt / edl: the timeline for another editor (OpenTimelineIO for Resolve, Premiere, Kdenlive; FCPXML for Final Cut Pro and Resolve; MLT for Shotcut; CMX3600 EDL for anything), linking the original media.",
		input: {
			kind: z.enum([
				"stems",
				"voiceover",
				"audio",
				"video",
				"captions",
				"otio",
				"fcpxml",
				"mlt",
				"edl",
			]),
			out: z.string().optional(),
		},
	},
	focus_window: { description: "Bring the Cue window to the front.", input: {} },
} as const;

export type MethodName = keyof typeof contract;
export type MethodInput<M extends MethodName> = z.output<
	z.ZodObject<(typeof contract)[M]["input"]>
>;

export function parseInput<M extends MethodName>(method: M, params: unknown): MethodInput<M> {
	return z.object(contract[method].input).parse(params ?? {}) as MethodInput<M>;
}
