import { z } from "zod";
import { clipInput, clipPatch } from "../core/ops";
import {
	aiSchema,
	exportSchema,
	lineInputSchema,
	settingsSchema,
	textStyleSchema,
} from "../core/project";
import { TITLE_IDS } from "../core/titles";
import { TRANSITION_KINDS } from "../core/transitions";

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
	get_guide: {
		description:
			"How Cue works and how to edit with these tools: concepts, units, track order, workflows and which tool does what. Read it once before editing.",
		input: {},
	},
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
			"The media library: id, kind, name, duration, origin (import/recording/tts/generated), the line a take belongs to, bin (id and path), tags, rating (0–5), note, whether and where it is used, and technical info (codec, fps, bitrate, file size, audio channels and sample rate, recording date). filter narrows it: binId (media directly in that bin; null for media in no bin), tag, kind, unused (no timeline uses it), minRating, query (words to find in the name, tags, note or transcript).",
		input: {
			filter: z
				.object({
					binId: z.string().nullable(),
					tag: z.string(),
					kind: z.enum(["video", "audio", "image"]),
					unused: z.boolean(),
					minRating: z.number().int().min(1).max(5),
					query: z.string(),
				})
				.partial()
				.optional(),
		},
	},
	remove_media: {
		description:
			"Remove media items (id, or ids for several) and every clip that uses them, as one undo step.",
		input: { id: z.string().optional(), ids: z.array(z.string()).min(1).optional() },
	},
	rename_media: {
		description: "Rename a media item in the library (the file on disk keeps its name).",
		input: { id: z.string(), name: z.string().min(1).max(200) },
	},
	list_bins: {
		description:
			"The bins (folders) of the media library: id, name, parentId for sub-bins, and how many items each holds directly.",
		input: {},
	},
	create_bin: {
		description:
			"Create a bin (folder) for media. parentId makes it a sub-bin of a top-level bin (bins nest one level deep). Returns the new bin's id in created.",
		input: {
			name: z.string().min(1).max(120),
			parentId: z.string().optional(),
		},
	},
	rename_bin: {
		description: "Rename a bin.",
		input: { id: z.string(), name: z.string().min(1).max(120) },
	},
	remove_bin: {
		description:
			"Delete a bin. Nothing is lost: its media and sub-bins move up to where the bin was (its parent, or the top level).",
		input: { id: z.string() },
	},
	move_media: {
		description: "File media items in a bin, or at the top level with binId null.",
		input: { assetIds: ids, binId: z.string().nullable() },
	},
	tag_media: {
		description:
			"Tag, rate and annotate media items. add and remove are lists of tags (merged with the tags they have; case doesn't matter). rating 1–5 stars (5 is a favourite), 0 clears it. note replaces the note; an empty note clears it. Fields you leave out stay as they are.",
		input: {
			assetIds: ids,
			add: z.array(z.string().max(60)).optional(),
			remove: z.array(z.string().max(60)).optional(),
			rating: z.number().int().min(0).max(5).optional(),
			note: z.string().max(4000).optional(),
		},
	},
	list_capture_sources: {
		description:
			"What can be recorded: screens and windows (ids for record_screen), cameras and microphones, and whether macOS allows Cue to record the screen, camera and microphone (granted, denied, not-determined).",
		input: {},
	},
	record_screen: {
		description:
			"Start recording a screen or window, optionally with the camera and microphone, in the editor window (a 3-2-1 countdown, then a recording bar the user can stop). Tell the user before calling. Returns once recording has started; call stop_screen_recording to finish, or it stops by itself after maxSeconds. The result is imported and placed at the playhead: the screen on a free video track, the camera on the track above (as a picture-in-picture bubble when bubble is true), linked together; the microphone is recorded into the screen's sound.",
		input: {
			sourceId: z
				.string()
				.optional()
				.describe(
					"A screen or window id from list_capture_sources; omit for the main screen; 'none' records the camera alone",
				),
			camera: z.boolean().default(false),
			microphone: z.boolean().default(true),
			bubble: z
				.boolean()
				.default(true)
				.describe("Show the camera small in the bottom-right corner"),
			maxSeconds: z.number().min(1).max(7200).optional(),
		},
	},
	stop_screen_recording: {
		description:
			"Stop the screen or camera recording started with record_screen (or by the user), then import it and return the new media and clips.",
		input: {},
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
			"Rename, mute, solo, lock, hide, set volume (0–2) or pan (-1 left to 1 right), mark as the voiceover track, or duck it (lower it automatically while the voiceover speaks). eq: three bands in dB (-12 to 12): low (shelf at 120 Hz: rumble, boom), mid (1.2 kHz: presence, honk), high (shelf at 8 kHz: air, hiss); bands you leave out keep their value, null makes it flat. compressor: {amount 0–1} evens out loud and quiet parts (0.3 gentle, 0.5 voice, 0.8 heavy), null turns it off. Presets: Voice is eq {low:-3, mid:2, high:3} with compressor 0.5; Music bed is eq {mid:-2} with compressor 0.3.",
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
					solo: z.boolean(),
					pan: z.number().min(-1).max(1),
					eq: z
						.object({
							low: z.number().min(-12).max(12),
							mid: z.number().min(-12).max(12),
							high: z.number().min(-12).max(12),
						})
						.partial()
						.nullable(),
					compressor: z.object({ amount: z.number().min(0).max(1) }).nullable(),
				})
				.partial(),
		},
	},
	auto_mix: {
		description:
			"Level the mix in one undoable step: measures each audible track's loudness and sets track volumes so dialogue and voiceover sit at about -16 LUFS and music or background tracks about 8 dB under them, turns on ducking for music tracks, and gives the voiceover track the Voice preset (EQ and compressor) if it has no EQ yet. Tracks are told apart by the voiceover flag, their names (Music, Voice, …) and transcripts. Returns each track's measured loudness and what changed.",
		input: {},
	},
	measure_loudness: {
		description:
			"Measure the loudness of the whole mix as it would be exported (EBU R128): integrated LUFS and true peak in dBTP. Nothing is changed.",
		input: {},
	},
	remove_track: { description: "Delete a track and its clips.", input: { id: z.string() } },
	move_track: {
		description:
			"Reorder a track (0 = top; upper video tracks draw over lower ones). Video and text tracks always stay above audio tracks.",
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
			"Add a title from a template (preset): title, headline, outline, gradient, lower-third, caption, subtitle (yellow outlined), minimal, quote, label or big-number. Style and animations can be changed after with update_clip. Uses the first text track unless trackId is given.",
		input: {
			text: z.string().min(1),
			startMs: z.number().min(0),
			durationMs: z.number().min(100).default(3000),
			preset: z.enum(TITLE_IDS).default("title"),
			trackId: z.string().optional(),
			style: textStyleSchema.partial().optional(),
		},
	},
	update_clip: {
		description:
			"Change a clip: timing, in-point, speed, volume, fades, denoise, color {brightness -1–1, contrast 0–3, saturation 0–3, temperature -1–1, lut: .cube path}, transform (x, y, scale, opacity, crop {left,top,right,bottom} as shares 0–0.45), text, style or animations. mask {shape rectangle|ellipse, x, y, width, height (shares of the picture), feather 0–1, invert} or null. key (chroma key) {color '#00ff00', similarity 0.01–0.6, blend 0–0.5} or null. effects {blur, sharpen, vignette, glow: 0–1, stabilize: boolean} (partial, merged) or null. Text clips: wordStyle {mode highlight|reveal|pop|bounce, color} animates word by word (words are timed from speech for captions, else spread over the clip); words [{text, startMs, endMs}] (clip-local) sets the timing; null clears either. disabled: true keeps it on the timeline but unseen and unheard. label: a colour tag (red, orange, yellow, green, blue, purple, pink) or null.",
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
	get_history: {
		description:
			"The project's complete history, newest first: every change with its step number, who made it (user, agent or system), when, and on which timeline. It persists across sessions.",
		input: {
			limit: z.number().int().min(1).max(2000).default(100),
			before: z.number().int().optional().describe("only steps before this number (paging)"),
			after: z.number().int().optional().describe("only steps after this number (what's new)"),
		},
	},
	restore_history: {
		description:
			"Bring the project back to how it was right after a history step. This is a new step itself, so it can be undone.",
		input: { n: z.number().int().min(1) },
	},
	list_sequences: {
		description:
			"Every timeline (sequence) in the project, which one is open, and which appear nested inside others.",
		input: {},
	},
	new_sequence: {
		description:
			"Create a timeline (sequence) and open it (open: false keeps the current one open).",
		input: { name: z.string().min(1).max(120), open: z.boolean().default(true) },
	},
	open_sequence: {
		description: "Open another timeline. Editing tools always work on the open one.",
		input: { id: z.string() },
	},
	rename_sequence: {
		description: "Rename a timeline.",
		input: { id: z.string(), name: z.string().min(1).max(120) },
	},
	duplicate_sequence: {
		description: "Copy a timeline (e.g. to try a different cut).",
		input: { id: z.string() },
	},
	delete_sequence: {
		description: "Delete a timeline that is not open and not nested anywhere.",
		input: { id: z.string() },
	},
	branch_sequence: {
		description:
			"Try an alternative cut without touching the original: copies the open timeline (or from) as a branch named e.g. 'Main · alt 1' and opens it. Edit the branch; the user can A/B compare it with the original (backquote key) and keep it with promote_branch.",
		input: {
			name: z.string().min(1).max(120).optional(),
			from: z.string().optional().describe("sequence id to branch; default the open one"),
		},
	},
	promote_branch: {
		description:
			"Keep a branch ('Use this version'): it takes the original's name and the original is renamed '… (old)', in one undoable step. The original is found by name ('Main · alt 1' → 'Main') unless originalId is given.",
		input: { id: z.string(), originalId: z.string().optional() },
	},
	nest_clips: {
		description:
			"Nest clips (Premiere's Nest): move them into a new sequence that takes their place as one clip. Open the new sequence to edit inside it; the nested clip updates when you come back.",
		input: { ids: z.array(z.string()).min(1), name: z.string().min(1).max(120).optional() },
	},
	add_adjustment_layer: {
		description:
			"Add an adjustment layer: a clip on a video track whose colour grade (update_clip color) and mask apply to everything on the tracks below it for as long as it lasts. Without trackId it goes on a new top track.",
		input: {
			startMs: z.number().min(0),
			durationMs: z.number().min(100).default(5000),
			trackId: z.string().optional(),
		},
	},
	copy_grade: {
		description:
			"Copy one clip's colour grade (color, including its LUT) to other video or picture clips, e.g. to match shots from the same scene. effects (default true) copies the picture effects (blur, sharpen, vignette, glow, stabilize) too. The whole look is copied: an ungraded source clears the targets' grade. Text clips in toClipIds are skipped.",
		input: {
			fromClipId: z.string(),
			toClipIds: ids,
			effects: z.boolean().default(true),
		},
	},
	speed_ramp: {
		description:
			"Speed ramp part of a media clip (fromMs–toMs in clip time, default all of it): up = ease to peak speed, down = ease from peak back to normal, inOut = fast in the middle (montage), outIn with peak < 1 = slow-motion hit. Later clips on the track move to make room.",
		input: {
			clipId: z.string(),
			shape: z.enum(["up", "down", "inOut", "outIn"]),
			peak: z.number().min(0.1).max(8),
			fromMs: z.number().min(0).optional(),
			toMs: z.number().min(0).optional(),
			steps: z.number().int().min(3).max(24).default(10),
		},
	},
	lift_range: {
		description:
			"Remove everything between two times (the in and out points) but leave the gap, like Premiere's Lift. Use remove_ranges to close the gap (Extract).",
		input: {
			startMs: z.number().min(0),
			endMs: z.number().min(0),
			trackIds: z.array(z.string()).optional(),
		},
	},
	insert_edit: {
		description:
			"Three-point edit: put a media item's range (inMs–outMs, default whole) on a track at atMs. insert pushes later material along on every unlocked track; overwrite replaces what is there.",
		input: {
			mode: z.enum(["insert", "overwrite"]),
			assetId: z.string(),
			trackId: z.string(),
			atMs: z.number().min(0),
			inMs: z.number().min(0).optional(),
			outMs: z.number().min(0).optional(),
		},
	},
	freeze_frame: {
		description:
			"Hold the frame at atMs (inside a video clip) for durationMs; later clips on that track move along.",
		input: {
			clipId: z.string(),
			atMs: z.number().min(0),
			durationMs: z.number().min(100).max(60000).default(2000),
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
			"Transition into a clip from the clip right before it on the same track. Every kind but dip overlaps the two clips (later clips move left by the overlap) and crossfades their sound: crossfade, wipe-left / wipe-right (a hard edge sweeps across), slide-left (enters from the right) / slide-right (from the left), zoom (settles in from larger while fading in), blur (sharpens while fading in). dip fades through black. Adding one to a clip that has one replaces it.",
		input: {
			clipId: z.string(),
			kind: z.enum(TRANSITION_KINDS).default("crossfade"),
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
		description:
			"Copy clips right after themselves, or offsetMs from their start; trackId puts the copies on another track.",
		input: { ids, offsetMs: z.number().optional(), trackId: z.string().optional() },
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
	arrange_clips: {
		description:
			"Put several pictures on screen at once (clips that play at the same time on different video tracks): side-by-side, top-bottom, thirds, grid (four), full (back to full frame), or picture in picture pip-br / pip-bl / pip-tr / pip-tl (the clip on the higher track becomes the small one; one clip alone is just made small). Split layouts fill areas in the order of clipIds, each picture centre-cropped to fill its area.",
		input: {
			layout: z.enum([
				"full",
				"side-by-side",
				"top-bottom",
				"thirds",
				"grid",
				"pip-br",
				"pip-bl",
				"pip-tr",
				"pip-tl",
			]),
			clipIds: z.array(z.string()).min(1).max(4),
		},
	},
	add_overlay: {
		description:
			"Add a graphic over the picture in one step. box, circle, arrow, line: an outline in color (arrows and lines go from (x - width/2, y - height/2) to (x + width/2, y + height/2), so width and height can be negative to point the other way); callout: a dark box with text; redact: a solid box (black by default) that hides what is under it; blur: blurs everything under that area (an adjustment layer with a mask). x, y (centre), width, height are shares of the frame. Graphics go on a 'Graphics' text track and pop in; edit them afterwards with update_clip (style x/y, shape {kind, width, height, fill, stroke, strokeWidth, radius}, text).",
		input: {
			kind: z.enum(["box", "circle", "arrow", "line", "callout", "blur", "redact"]),
			startMs: z.number().min(0),
			durationMs: z.number().min(100).default(3000),
			x: z.number().min(-0.5).max(1.5).default(0.5),
			y: z.number().min(-0.5).max(1.5).default(0.5),
			width: z.number().min(-2).max(2).default(0.3),
			height: z.number().min(-2).max(2).default(0.2),
			color: z.string().optional(),
			text: z.string().max(400).optional(),
		},
	},
	review_changes: {
		description:
			"The user's decision on an agent's proposed changes (review mode): accept keeps them, reject undoes them; clipIds limits it to those clips. Agents cannot call this: when get_state shows pendingReview, tell the user what you changed and let them decide.",
		input: {
			action: z.enum(["accept", "reject"]),
			clipIds: z.array(z.string()).optional(),
		},
	},
	make_variants: {
		description:
			"Make other versions of the edit without changing the open timeline: other frame shapes (9:16 vertical, 1:1, 4:5, 16:9; full-frame pictures are centre-cropped) and/or shorter cuts (e.g. 15, 30, 60 s). Every combination is exported as a video to the project's export folder; saveProjects also saves each as a project next to this one to fine-tune later. For short cuts, pass keep: the timeline stretches worth keeping (e.g. found with find_moments or from the transcript); otherwise the edit ends at the last cut before the target length.",
		input: {
			aspects: z
				.array(z.enum(["9:16", "1:1", "4:5", "16:9"]))
				.max(4)
				.optional(),
			lengthsSec: z.array(z.number().min(3).max(600)).max(4).optional(),
			keep: z
				.array(z.object({ startMs: z.number().min(0), endMs: z.number().min(0) }))
				.max(40)
				.optional(),
			saveProjects: z.boolean().default(false),
			exportVideos: z.boolean().default(true),
			followFaces: z
				.boolean()
				.default(false)
				.describe("pan wide shots to follow faces in narrower shapes (on-device, macOS)"),
		},
	},
	search_shots: {
		description:
			"Find moments in the media by what they show, text on screen or what is said there, e.g. 'dog on a beach', 'whiteboard', 'the word pricing on a slide'. Runs on this Mac (Apple Vision labels, text recognition and faces, plus transcripts); the first search indexes each video, which takes a moment. Returns source ranges (assetId, startMs, endMs) best first, ready for add_clips (inMs = startMs) or insert_edit.",
		input: {
			query: z.string().min(1).max(200),
			assetIds: z.array(z.string()).optional(),
			limit: z.number().int().min(1).max(50).default(12),
		},
	},
	follow_faces: {
		description:
			"Pan a video clip so the main face stays in the middle of the frame: sets smoothed x keyframes (one undoable step). For pictures wider than the frame, e.g. 16:9 footage in a 9:16 edit (reframe or make_variants first). Faces are found on this Mac.",
		input: { clipId: z.string() },
	},
	split_at_scenes: {
		description:
			"Find the shot changes in the part of a video clip's source it plays and cut the clip (and its linked sound) there, or add 'Shot' markers instead with split false. threshold 0.05–0.9: lower finds more (dissolves), higher only hard cuts. Returns the cut times on the timeline.",
		input: {
			clipId: z.string(),
			threshold: z.number().min(0.05).max(0.9).default(0.3),
			split: z.boolean().default(true),
		},
	},
	detect_beats: {
		description:
			"Tempo (BPM) and beats of a media item with sound. addMarkers puts a green 'Beat' marker on every beat (or every Nth with every) where the item is used on the timeline.",
		input: {
			assetId: z.string(),
			addMarkers: z.boolean().default(false),
			every: z.number().int().min(1).max(16).optional(),
		},
	},
	snap_cuts_to_beats: {
		description:
			"Move each cut on a track to the nearest beat of a music item on the timeline (rolling edits, within toleranceMs).",
		input: {
			trackId: z.string(),
			musicAssetId: z.string(),
			toleranceMs: z.number().min(20).max(1000).default(350),
		},
	},
	rough_cut: {
		description:
			"Rough cut from a script or brief, on device: finds where each line was said in the transcribed media (word matching that tolerates small wording changes and gaps) and lays the matches out in line order in a new sequence (opened), padded by padMs. Video keeps its sound; audio-only media goes on a Dialogue track. lines default to the project's script lines; assetIds to all media with speech. Returns each match with its confidence (0–1) and the lines not found. Media must be transcribed first (transcribe_media). One undoable step.",
		input: {
			lines: z.array(z.string().min(1).max(2000)).min(1).max(200).optional(),
			assetIds: z.array(z.string()).optional(),
			name: z.string().min(1).max(120).optional(),
			padMs: z.number().min(0).max(1000).default(150),
		},
	},
	beat_montage: {
		description:
			"Music-driven montage: detects the music's beats and builds a new sequence (opened) with the music on an audio track (fading out at the end) and the pictures cut exactly on every 1, 2 or 4 beats, cycling through the media and taking a different part each time (starting on shot changes where found). Stills last one cut and get a gentle push-in. assetIds default to every video and image except the music; lengthSec defaults to the whole song. One undoable step.",
		input: {
			musicAssetId: z.string(),
			assetIds: z.array(z.string()).min(1).optional(),
			every: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(2),
			lengthSec: z.number().min(2).max(3600).optional(),
			name: z.string().min(1).max(120).optional(),
			zoomStills: z.boolean().default(true),
		},
	},
	find_moments: {
		description:
			"Search the edit by meaning using the transcript and the text model, e.g. 'where they talk about pricing'. Returns timeline ranges with reasons. Transcribe first.",
		input: { query: z.string().min(2).max(500) },
	},
	generate_chapters: {
		description:
			"Chapters from the transcript: adds chapter markers and returns a YouTube-ready chapter list.",
		input: { addMarkers: z.boolean().default(true) },
	},
	suggest_broll: {
		description:
			"Suggest cutaway images (B-roll) for moments in the transcript: times, durations and image prompts. Nothing is generated yet.",
		input: { count: z.number().int().min(1).max(12).default(4) },
	},
	add_broll: {
		description:
			"Generate B-roll images and place them on a B-roll track above the picture, with short fades.",
		input: {
			items: z
				.array(
					z.object({
						atMs: z.number().min(0),
						durationMs: z.number().min(500).max(20000),
						prompt: z.string().min(3),
					}),
				)
				.min(1)
				.max(12),
		},
	},
	reframe: {
		description:
			"Change the frame size (e.g. 1080×1920 for vertical) and make full-frame pictures fill it with a centre crop. Adjust transform.x per clip afterwards to follow the subject.",
		input: {
			width: z.number().int().min(16).max(7680),
			height: z.number().int().min(16).max(4320),
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
			"Transcribe the voiceover track (or the full mix) and add timed caption clips on a new Captions track, with word timings. style plain gives classic subtitles; highlight, reveal, pop or bounce give animated word-by-word captions in a bold social style (wordColor for the word being said).",
		input: {
			source: z.enum(["voiceover", "mix"]).default("voiceover"),
			maxChars: z.number().int().min(12).max(90).optional(),
			style: z.enum(["plain", "highlight", "reveal", "pop", "bounce"]).default("plain"),
			wordColor: z.string().optional(),
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
	review_edit: {
		description:
			"Director's notes: a quick on-device review of the open timeline. Returns notes {id, atMs, endMs?, kind, severity tip|warning|problem, message, clipId?, fix?} for flash frames and tiny gaps, very short clips, jump cuts, long static shots, titles too fast to read, too small or outside title safe, music that starts or stops abruptly, long pauses in the voiceover, vertical video without captions, no music bed, offline media and disabled clips. A fix is a ready tool call {tool, params, label}: call that tool with those params to apply it. measureAudio also measures the mix's loudness and peaks (slower).",
		input: { measureAudio: z.boolean().default(false) },
	},
	list_recipes: {
		description:
			"Recipes: reusable edits, each a list of tool calls (built-in ones and those saved by the user or agents). Returns id, name, description and steps.",
		input: {},
	},
	run_recipe: {
		description:
			"Run a recipe's steps in order on the open project. Placeholders in the params are filled in from the project first. Stops at the first failing step (optional steps are skipped instead) and says which one failed. dryRun returns the resolved calls without running them.",
		input: { id: z.string(), dryRun: z.boolean().default(false) },
	},
	save_recipe: {
		description:
			"Save a recipe (e.g. what you just did, to repeat on other projects). steps: [{tool, params, label?, optional?, each?}]. Params may use placeholders filled in when it runs: {playheadMs}, {selectedClipIds}, {selectedClipId}, {durationMs}, {projectName}, {voiceoverAssetId} (the main speech media), {musicAssetId}, {firstVideoClipId}, {firstMusicClipId}, {voiceClipIds}, {captionSource}. each: '{voiceClipIds}' or '{selectedClipIds}' runs the step once per clip with {clipId} set. Saving with the name of one of your recipes replaces it.",
		input: {
			name: z.string().min(1).max(120),
			description: z.string().max(1000).default(""),
			steps: z
				.array(
					z.object({
						tool: z.string(),
						params: z.record(z.string(), z.unknown()).default({}),
						label: z.string().max(200).optional(),
						each: z.string().optional(),
						optional: z.boolean().optional(),
					}),
				)
				.min(1)
				.max(50),
		},
	},
	delete_recipe: {
		description: "Delete a saved recipe (built-in recipes stay).",
		input: { id: z.string() },
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
	update_marker: {
		description: "Rename, move or recolour a marker.",
		input: {
			id: z.string(),
			patch: z
				.object({
					atMs: z.number().min(0),
					label: z.string().max(200),
					color: z.enum(["accent", "success", "warning", "danger"]),
				})
				.partial(),
		},
	},
	clear_markers: {
		description: "Remove all markers, or only those with a given label (e.g. 'Beat').",
		input: { label: z.string().optional() },
	},
	undo: { description: "Undo the last edit.", input: {} },
	redo: { description: "Redo.", input: {} },
	export: {
		description:
			"Export. stems: one WAV per script line + durations.json. voiceover: the voiceover track as one WAV. audio: full mix (with ducking); the file type follows out (.wav, .mp3, .m4a, .flac). gif: an animated GIF (up to 720 px wide, 15 fps), for short clips. video: rendered video with every visible track and the mix (codec, hardware encoding and scale from export settings). captions: SRT + VTT from the caption clips. otio / fcpxml / mlt / edl: the timeline for another editor (OpenTimelineIO for Resolve, Premiere, Kdenlive; FCPXML for Final Cut Pro and Resolve; MLT for Shotcut; CMX3600 EDL for anything), linking the original media.",
		input: {
			kind: z.enum([
				"stems",
				"voiceover",
				"audio",
				"video",
				"gif",
				"captions",
				"otio",
				"fcpxml",
				"mlt",
				"edl",
			]),
			out: z.string().optional(),
			range: z
				.object({ startMs: z.number().min(0), endMs: z.number().min(0) })
				.optional()
				.describe(
					"video/gif/audio only: export just this part, e.g. between the in and out points",
				),
		},
	},
	export_frame: {
		description: "Save the frame at atMs as a PNG (as the viewer shows it) and return its path.",
		input: { atMs: z.number().min(0), out: z.string().optional() },
	},
	set_in_out: {
		description:
			"Set the editor's in and/or out marks (the range for lift, extract, play-in-to-out and range export). null clears one.",
		input: {
			inMs: z.number().min(0).nullable().optional(),
			outMs: z.number().min(0).nullable().optional(),
		},
	},
	set_view: {
		description:
			"Show the user something: switch workspace (window layout), open a sidebar panel, fit the whole timeline in view, zoom the timeline (px per second), or open a media item in the source monitor.",
		input: {
			panel: z
				.enum([
					"media",
					"script",
					"transcript",
					"text",
					"mixer",
					"generate",
					"history",
					"agent",
					"settings",
				])
				.optional(),
			dock: z
				.enum(["none", "mixer", "scopes", "agent", "history", "markers", "notes"])
				.optional()
				.describe("pane beside the viewer; notes shows the director's notes"),
			fitTimeline: z.boolean().optional(),
			zoom: z.number().min(4).max(600).optional(),
			openSource: z.string().optional().describe("asset id"),
			workspace: z
				.enum(["editing", "audio", "colour", "voiceover", "titles", "agent", "review"])
				.optional()
				.describe(
					"editing; audio (mixer docked, tall audio tracks); colour (scopes, before/after, colour tools); voiceover (script and teleprompter); titles (safe areas, text tools); agent (chat and history); review (big viewer, director's notes)",
				),
		},
	},
	get_app_settings: {
		description:
			"App-wide settings: theme, projects folder, which AI providers and models are used (voice, transcription, text, images), and editing defaults.",
		input: {},
	},
	update_app_settings: {
		description:
			"Change app-wide settings, e.g. {ai: {tts: 'macos', macVoice: 'Samantha'}} or {editor: {snapping: false}} or {theme: 'light'}. API keys and agent access can only be changed by the user.",
		input: {
			patch: z
				.object({
					theme: z.enum(["dark", "light", "system"]),
					projectsDir: z.string(),
					reopenLast: z.boolean(),
					ai: z.record(z.string(), z.unknown()),
					editor: z.record(z.string(), z.unknown()),
				})
				.partial(),
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
