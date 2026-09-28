import { z } from "zod";
import { WALLPAPERS } from "../core/capture";
import { clipInput, clipPatch } from "../core/ops";
import {
	aiSchema,
	BLEND_MODES,
	curveSchema,
	exportSchema,
	KEYFRAME_PROPS,
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
/** Clips to fit into a device frame's see-through regions (by name, or in order). */
const fitInput = z
	.array(z.object({ clipId: z.string(), region: z.string().optional() }))
	.max(8)
	.optional();

const line = lineInputSchema.describe(
	"Script line: id, text, startMs on the timeline, optional targetMs and maxMs.",
);
const ids = z.array(z.string()).min(1);

export const contract = {
	// --- Overview --------------------------------------------------------------
	cut_out: {
		description:
			"Cut the subject (people, objects) out of a picture, or of a video frame at atMs, into a new image with a transparent background, a paper-white outline (px, 0 for none) and a soft shadow (0–1) — the collage cut-outs of explainer videos. Returns the new media; with trackId and startMs it is placed too. Turn it slightly (transform.rotation -3…3) and add a small wiggle for the hand-made look. macOS only.",
		input: {
			assetId: z.string(),
			atMs: z.number().min(0).optional(),
			outline: z.number().min(0).max(60).optional(),
			shadow: z.number().min(0).max(1).optional(),
			trackId: z.string().optional(),
			startMs: z.number().min(0).optional(),
		},
	},
	list_playbooks: {
		description:
			"Cue's playbooks: how to work in Cue (read 'working-in-cue' first, then 'before-your-first-pass': the mistakes earlier builds made), the editing techniques pros use and how to build each in Cue ('editing-techniques'), where to get footage, stills, music and sounds ('finding-assets'), how to match a reference video ('match-a-reference', with analyze_reference), complete worked examples ('example-why-we-say-ok', 'example-the-red-cars'), editing craft, premium motion design, and recognisable styles (Vox explainer, archive history documentary, screen-recording demo, map documentary, flat vector, tech review, captions talking head, product film, true crime, video essay, news, beat montage, podcast clip, product explainer, vlog) taken apart into techniques with Cue's tools and numbers. Read the relevant one with get_playbook before building a video in a style.",
		input: { category: z.enum(["workflow", "craft", "style", "example"]).optional() },
	},
	get_playbook: {
		description: "A playbook's full text (markdown), by id from list_playbooks.",
		input: { id: z.string() },
	},
	wait_for: {
		description:
			"Wait for a long call to finish. Calls that take longer than about 45 seconds (exports, voiceovers, transcripts) reply with {status: 'running', callId, progress} instead of their result; pass that callId here to wait again (up to about 45 seconds per call) and get the result. Never start the same work twice.",
		input: { callId: z.string(), waitMs: z.number().min(1000).max(50000).optional() },
	},
	get_guide: {
		description:
			"How Cue works and how to edit with these tools: concepts, units, track order, workflows and which tool does what. Read it once before editing. topic 'motion' is the guide to designing motion graphics (the spec format, design rules and patterns); read it before create_motion_graphic with a spec.",
		input: { topic: z.enum(["editing", "motion"]).default("editing") },
	},
	list_motion_templates: {
		description:
			"Cue's motion graphic templates (lower thirds, titles, kinetic words, bar/donut/line charts, big numbers, callouts, timelines, checklists, quotes, a subscribe reminder, a chapter progress bar, a route map, editorial annotations, device frames with see-through screens for footage (retro TV, laptop, phone, polaroid, film strip, taped photo), and transitions that cover a cut), each with its parameters and an example, plus the colour themes. Use one with create_motion_graphic {template, params}.",
		input: {
			category: z
				.enum([
					"lower third",
					"title",
					"chart",
					"stat",
					"callout",
					"list",
					"quote",
					"overlay",
					"map",
					"transition",
					"annotation",
					"frame",
				])
				.optional(),
		},
	},
	create_motion_graphic: {
		description:
			'Make a motion graphic (a Lottie animation, played like video) from a template with params, or from a spec you write (see get_guide {topic: \'motion\'}). It is added to the media; with trackId, startMs or atCutMs it is also placed on the timeline (on the top picture track when free there, else a new Graphics track). atCutMs centres a transition on a cut. Text and data are editable later with update_motion_graphic; look at it with render_frame. Device frames (category frame: frame-crt, frame-laptop, frame-phone, frame-polaroid, frame-film-strip, frame-photo-card) have see-through screens: the reply\'s regions give each screen\'s {name, x, y, width, height} (shares of the frame) and fit {"16:9", "4:3", "9:16"}: the {x, y, scale, crop} transform that makes a clip of that shape fill it. Put the frame on an upper track and the footage on a track below it; fit: [{clipId, region?}] applies the fit to those clips (by their media\'s shape) for you.',
		input: {
			template: z.string().optional(),
			params: z.record(z.string(), z.unknown()).optional(),
			spec: z.record(z.string(), z.unknown()).optional(),
			name: z.string().max(120).optional(),
			trackId: z.string().optional(),
			startMs: z.number().min(0).optional(),
			durationMs: z.number().min(1).optional(),
			atCutMs: z.number().min(0).optional(),
			fit: fitInput,
		},
	},
	update_motion_graphic: {
		description:
			"Rebuild a motion graphic made in Cue: params merge with its current ones (change a title, the data, the theme, colors); spec replaces it entirely; template switches to another template. Clips using it update; one undo step. Device frames reply with their regions again; pass fit [{clipId, region?}] to refit the footage after moving or resizing the frame.",
		input: {
			assetId: z.string(),
			params: z.record(z.string(), z.unknown()).optional(),
			spec: z.record(z.string(), z.unknown()).optional(),
			template: z.string().optional(),
			fit: fitInput,
		},
	},
	edit_motion_layer: {
		description:
			"Change one layer of a motion graphic made in Cue without rewriting its spec: layer is its name or path (see get_motion_graphic layers, e.g. 'Title' or '1.0'); patch sets spec properties of that layer (text, color, fill, size, x, y, rotation, opacity, enter, exit, keys…; null removes one); move {dx, dy} shifts it in composition pixels (lines by their points, groups with everything in them); remove deletes it. A graphic made from a template becomes its own design (the template's params stop applying). One undoable step; clips using it update. Works without the window on screen.",
		input: {
			assetId: z.string(),
			layer: z.string(),
			patch: z.record(z.string(), z.unknown()).optional(),
			move: z.object({ dx: z.number(), dy: z.number() }).optional(),
			remove: z.boolean().optional(),
		},
	},
	get_motion_graphic: {
		description:
			"A motion graphic's source: the template and params it was made from, its full spec (for templates, the spec they build) and its layers (name, type, path) for edit_motion_layer. Copy and change the spec to make a new graphic in the same style.",
		input: { assetId: z.string() },
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
	view_attachment: {
		description:
			"Look at a screenshot the user attached to a chat message (its path is given in the message). Returns the picture.",
		input: { path: z.string() },
	},
	render_frame: {
		description:
			"Show the actual viewer image at a moment, with its PNG path. Use it to inspect framing, text and captions.",
		input: { atMs: z.number().min(0) },
	},
	inspect_edit: {
		description:
			"Inspect the current edit in one call: sampled viewer images across a time range, active clips at each sample, and director's notes about likely issues. Returns actual images as MCP content so you can see the cut. Use get_timeline for exact clip details and render_frame to zoom in on a problem moment.",
		input: {
			fromMs: z.number().min(0).optional(),
			toMs: z.number().min(0).optional(),
			sampleCount: z.number().int().min(1).max(6).default(4),
		},
	},
	get_activity: {
		description: "Recent edits with who made them (user or agent).",
		input: { limit: z.number().int().min(1).max(200).default(30) },
	},

	// --- Projects --------------------------------------------------------------
	list_recent_projects: { description: "Recently opened projects.", input: {} },
	list_projects: {
		description:
			"Every project in the projects overview (recent ones and those in the projects folder) with length, canvas, clip count, last change and the collection it is in (collectionId; see list_collections).",
		input: {},
	},
	list_collections: {
		description:
			"Collections in the projects overview: named groups of projects, like folders (the pieces of one video — its edit, graphics made as their own projects, other versions). Each has an id, name and its project files. list_projects shows which collection each project is in.",
		input: {},
	},
	create_collection: {
		description:
			"Make a collection in the projects overview, optionally with projects (their file paths) moved into it. A project is in one collection at most.",
		input: { name: z.string().min(1).max(80), projects: z.array(z.string()).optional() },
	},
	rename_collection: {
		description: "Rename a collection.",
		input: { id: z.string(), name: z.string().min(1).max(80) },
	},
	delete_collection: {
		description:
			"Delete a collection. Its projects are not deleted: they go back to the ungrouped list.",
		input: { id: z.string() },
	},
	move_to_collection: {
		description:
			"Move projects (file paths) into a collection, out of any other; collectionId null takes them out of their collection.",
		input: { projects: z.array(z.string()).min(1), collectionId: z.string().nullable() },
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
	add_project_media: {
		description:
			"Place another Cue project (or one of its sequences) in this one as media, like a pre-composition shared between projects: it is rendered to a video (text and graphics included) and rendered again whenever that project file changes (on opening this project, when Cue comes to the front, before export, or with refresh_project_media). With trackId it is also put on the timeline at startMs. Its media item has projectSource with the file. Long: may reply with a callId for wait_for.",
		input: {
			path: z.string(),
			sequenceId: z.string().optional(),
			trackId: z.string().optional(),
			startMs: z.number().min(0).optional(),
		},
	},
	refresh_project_media: {
		description:
			"Render again the projects placed as media (add_project_media) whose files changed. Returns how many were updated.",
		input: {},
	},
	analyze_reference: {
		description:
			"Measure a reference video you are asked to match (a style, a creator, an ad): where its cuts are, shot lengths (median, mean, range), cuts per minute and per 10 s (where it speeds up or breathes), brightness, colourfulness and how much is black and white, its dominant colours, loudness, and a contact sheet with one frame per shot (returned as an image). Give a file path or the assetId of imported media. Use the numbers to set your pacing, grade and palette, then read the matching playbook (list_playbooks) and the 'match-a-reference' playbook. Long: may reply with a callId for wait_for.",
		input: { file: z.string().optional(), assetId: z.string().optional() },
	},
	package_project: {
		description:
			"Package the project and every media file it uses into one .zip to share or archive (like Premiere's Project Manager): media outside the project folder is copied in, caches and history are left out, and the zip opens anywhere. trim (default true) cuts long video and audio down to the parts the edit uses plus 1 s handles, so footage from a long film stays small. readme adds a README.txt (credits, sources, how it was made). out defaults to the project's export folder. Long: may reply with a callId for wait_for.",
		input: {
			out: z.string().optional(),
			trim: z.boolean().default(true),
			readme: z.string().max(20000).optional(),
		},
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
	list_library_assets: {
		description:
			'Browse Cue\'s curated library: stock footage, original graphics, Textures (paper, kraft, cardboard, newsprint and construction-paper boards; film dust, light leak, halftone and vignette overlays) and Sound effects (whooshes, paper slaps and rustles, pop, tick, camera shutter, typewriter, riser, impacts, a title chime, room tone). category narrows it (e.g. "Textures", "Sound effects"); query searches names, descriptions and tags. Each result has its kind (video, image, audio), duration for sounds and loops, source, credit and license, and `use`: how to use it (blend, opacity, track: bottom for boards, top for overlays, audio; volume; loop; syncMs, the moment in a sound to line up with the event; and a note). Add one with import_library_asset. There is no music in the library: find openly licensed music with find_music, or compose an original bed with generate_music.',
		input: { query: z.string().optional(), category: z.string().optional() },
	},
	show_library_asset: {
		description:
			"Select a curated asset in Cue's asset gallery and return its source, license and usage notes.",
		input: { id: z.string() },
	},
	import_library_asset: {
		description:
			'Copy (or, for stock footage, download) a curated asset into the open project and import it as media. Give trackId, startMs or atMs to also place it, following its `use`: without trackId, sounds go on a free "SFX" audio track (made when needed), paper boards on a new bottom picture track (under everything: put graphics and cut-outs above it), and overlays (dust, light leak, halftone, vignette) on a new top track, with the suggested blend mode (multiply for paper over footage, screen for dust and light leaks) and opacity. atMs lines the sound\'s sync point up with an event (a whoosh\'s peak on the cut): startMs = atMs - use.syncMs. durationMs sets the length (stills default to 5 s; loops repeat back to back to fill it). blend, opacity and volume override the suggestions. To lay paper over footage instead, pass a trackId above the footage and blend "multiply". Stock footage comes from its credited source; check the license before publishing.',
		input: {
			id: z.string(),
			trackId: z.string().optional(),
			startMs: z.number().min(0).optional(),
			atMs: z.number().min(0).optional(),
			durationMs: z.number().min(1).optional(),
			blend: z.enum(BLEND_MODES).optional(),
			opacity: z.number().min(0).max(1).optional(),
			volume: z.number().min(0).max(2).optional(),
		},
	},
	import_media: {
		description:
			"Add video, audio, image or motion graphic files to the media library. With trackId, also place them back to back from startMs. Motion graphics are Lottie animations (.json or .lottie), the format After Effects exports with the Bodymovin or LottieFiles plug-in; they go on video tracks and list their editable text layers, colours and markers (see update_clip motion).",
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
			"Start recording a screen or window, optionally with the camera and microphone, in the editor window (a 3-2-1 countdown, then a recording bar the user can stop). Tell the user before calling. Returns once recording has started; call stop_screen_recording to finish, or it stops by itself after maxSeconds. The screen is recorded natively (ScreenCaptureKit on macOS) at full resolution. The result is imported and placed at the playhead: the screen on a free video track, the camera on the track above (as a picture-in-picture bubble when bubble is true, round with the studio look), linked together; the microphone is recorded into the screen's sound. Use pause_screen_recording to pause and resume.",
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
				.describe("Show the camera small in the bottom-right corner (round, with the studio look)"),
			maxSeconds: z.number().min(1).max(7200).optional(),
			studio: z
				.boolean()
				.default(true)
				.describe(
					"The Recordly-style finish: the screen inset on a wallpaper with rounded corners and a shadow, the real pointer replaced by a smooth larger cursor, zooms on the clicks and a ripple on each click. All of it is ordinary clips, keyframes and zooms on their own tracks (Background, Cursor, Clicks), so it can be edited afterwards",
				),
			wallpaper: z
				.enum([...WALLPAPERS, "none"])
				.optional()
				.describe("Studio background (default dusk)"),
			autoZoom: z.boolean().default(true).describe("Studio: zoom in where the clicks are"),
			smoothCursor: z
				.boolean()
				.default(true)
				.describe("Studio: leave the real pointer out and draw a smooth, larger cursor"),
			cursorSize: z
				.number()
				.min(0.5)
				.max(2)
				.default(1)
				.describe("Studio: cursor size (1 is about 5% of the frame height)"),
			clickRipples: z.boolean().default(true).describe("Studio: a ripple on each click"),
			cameraId: z
				.string()
				.optional()
				.describe("A camera id from list_capture_sources (default: the system camera)"),
			microphoneId: z
				.string()
				.optional()
				.describe("A microphone id from list_capture_sources (default: the system microphone)"),
		},
	},
	pause_screen_recording: {
		description:
			"Pause (paused: true) or resume (paused: false) the running screen recording. Paused time is left out of the recording, the pointer track and the zooms.",
		input: { paused: z.boolean() },
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
			"Change a clip: timing, in-point, speed, volume, fades, denoise (off | light: FFT filter for steady hiss and hum | voice: RNNoise speech model that removes most non-speech noise; true means light), color {brightness -1–1, contrast 0–3, saturation 0–3, temperature -1–1, lut: .cube path}, transform (x, y, scale, opacity, crop {left,top,right,bottom} as shares 0–0.45), text, style or animations. mask {shape rectangle|ellipse, x, y, width, height (shares of the picture), feather 0–1, invert} or null. key (chroma key) {color '#00ff00', similarity 0.01–0.6, blend 0–0.5} or null. effects {blur, sharpen, vignette, glow, grain (film grain): 0–1, stabilize: boolean} (partial, merged) or null; on an adjustment layer vignette and grain give the whole edit a filmic look. transform.rotation turns a picture (degrees; cut-outs and clippings look placed by hand at -3 to 3). wiggle {position: px drift, rotation: degrees, speed: per second} or null adds a gentle hand-held drift (e.g. {position: 4, rotation: 0.5, speed: 1}); stepFps (12 = 'on twos') moves keyframes, wiggle and motion graphics in whole steps like stop-motion paper, or null for smooth. blend: normal | multiply | screen | overlay | soft-light | darken | lighten combines a picture with the tracks below (multiply a paper texture over everything, screen a light leak) or null. frame {radius: corner radius in canvas pixels, shadow 0–1} rounds and shadows a picture (the studio look of screen recordings) or null. Motion graphics (media kind lottie): motion {text: {layerId: 'new text'}, colors: {'#original': '#new'}, loop: boolean} rewrites text layers and swaps colours without changing the file (ids and colours come from list_media motion); patches merge, an empty string removes a text change, mapping a colour to itself removes that swap, null resets. Past its end a graphic holds its last frame, or loops; if the file has an 'out' or 'outro' marker, a longer clip holds before the outro and plays it as the clip ends. Text clips: wordStyle {mode highlight|reveal|pop|bounce, color} animates word by word (words are timed from speech for captions, else spread over the clip); words [{text, startMs, endMs}] (clip-local) sets the timing; null clears either. disabled: true keeps it on the timeline but unseen and unheard. label: a colour tag (red, orange, yellow, green, blue, purple, pink) or null.",
		input: { id: z.string(), patch: clipPatch },
	},
	move_clips: {
		description:
			"Move clips by deltaMs (linked picture and sound move together). trackId puts all the listed clips on that track; tracks {clipId: trackId or 'new'} moves single clips to other tracks ('new' makes a new track of that kind) while their linked clips keep theirs. overwrite: true makes the moved clips replace what they land on (trimming, splitting or removing it) instead of overlapping it, as dragging does in the timeline.",
		input: {
			ids,
			deltaMs: z.number(),
			trackId: z.string().optional(),
			tracks: z.record(z.string(), z.string()).optional(),
			overwrite: z.boolean().optional(),
		},
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
			"Transition into a clip from the clip right before it on the same track. Every kind but dip overlaps the clips and crossfades their sound: crossfade, wipe-left/right, slide-left/right, zoom, blur, paper-tear (ragged paper edge), signal-glitch (staggered horizontal signal breakup), ink-blot (organic radial reveal). Dip fades through black. Adding one to a clip that has one replaces it.",
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
			"Animate a media clip: set x or y (0–1, centre on canvas), scale (1 = fit), rotation (degrees, clockwise), opacity (0–1) or volume (0–2) at a clip-local time. ease is how the value travels to the next keyframe: linear, ease (slow in and out), ease-in (starts slow), ease-out (ends slow), hold (jumps at the next keyframe) or bezier with curve [x1, y1, x2, y2] like CSS cubic-bezier (x 0–1; y below 0 or above 1 overshoots, e.g. [0.34, 1.56, 0.64, 1] for a bounce back).",
		input: {
			clipId: z.string(),
			prop: z.enum(KEYFRAME_PROPS),
			atMs: z.number().min(0),
			value: z.number(),
			ease: z.enum(["linear", "ease", "ease-in", "ease-out", "hold", "bezier"]).default("ease"),
			curve: curveSchema.optional().describe("Bezier handles [x1, y1, x2, y2] for ease bezier."),
		},
	},
	edit_keyframes: {
		description:
			"Change several keyframes of one clip in one undoable step. Each edit picks a keyframe by prop and its clip-local atMs, then moves it (toMs), changes its value, ease or curve, or removes it (remove: true).",
		input: {
			clipId: z.string(),
			edits: z
				.array(
					z.object({
						prop: z.enum(KEYFRAME_PROPS),
						atMs: z.number().min(0),
						toMs: z.number().min(0).optional(),
						value: z.number().optional(),
						ease: z.enum(["linear", "ease", "ease-in", "ease-out", "hold", "bezier"]).optional(),
						curve: curveSchema.optional(),
						remove: z.boolean().optional(),
					}),
				)
				.min(1),
		},
	},
	remove_keyframe: {
		description: "Remove one keyframe.",
		input: {
			clipId: z.string(),
			prop: z.enum(KEYFRAME_PROPS),
			atMs: z.number().min(0),
		},
	},
	clear_keyframes: {
		description: "Remove all keyframes of a property (or of the clip).",
		input: { clipId: z.string(), prop: z.enum(KEYFRAME_PROPS).optional() },
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
	detect_activity: {
		description:
			"What happens on screen in a video (screen recordings, app demos, tutorials), found without looking at frames: each change between frames is sorted into screen-change (a new page or view), ui-change (a small area changes: usually a click's result, with its region), scroll (with how far), typing, pointer (the cursor moving) and idle (nothing happens for idleMs). Give clipId for events in timeline time within what the clip plays (or assetId for source time). Each kind comes with what editors usually do there (click sounds, zooms to the region, whooshes, cutting or speeding up idle stretches). markers true adds a timeline marker per event (not pointer). Use it instead of stepping through frames with render_frame; check a few moments with render_frame afterwards.",
		input: {
			clipId: z.string().optional(),
			assetId: z.string().optional(),
			fromMs: z.number().min(0).optional(),
			toMs: z.number().min(0).optional(),
			kinds: z
				.array(z.enum(["screen-change", "ui-change", "scroll", "typing", "pointer", "idle"]))
				.optional(),
			idleMs: z.number().min(300).default(1500),
			markers: z.boolean().default(false),
		},
	},
	trim_take: {
		description:
			"Measure again where a take's speech starts and ends and, if it's the take in use, place it again so the silence before and after is left out (a recording stopped late, a pause before speaking). New takes are measured this way when saved.",
		input: { assetId: z.string() },
	},
	level_take: {
		description:
			"Raise a quiet voiceover take (or any speech audio) to voiceover level: measured, raised by up to 30 dB towards -18 LUFS and limited so it never clips, written as a new file (the original stays). Use it when a recorded take is much quieter than the others: a clip's volume only goes up to +6 dB. New recordings are levelled automatically.",
		input: { assetId: z.string() },
	},
	ripple_from: {
		description:
			"Move everything that starts at or after fromMs (clips on every track, script lines and markers) by deltaMs, in one undoable step: positive makes room (a take that runs long, an inserted scene), negative closes a gap. Pictures, music and voice stay in sync with each other.",
		input: { fromMs: z.number().min(0), deltaMs: z.number() },
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
	add_infographic: {
		description:
			"A quick way to make a data chart over the video: bars compares values, donut shows parts of a whole, cards shows up to four key numbers, line shows a trend, and timeline shows ordered milestones with a value each. Give real numbers and a source when available. It makes a motion graphic from the matching template (bar-chart, donut-chart, stat-row, line-chart, timeline) on a card over the footage and places it at startMs; it returns the assetId, template and params. Change it with update_motion_graphic {assetId, params} (e.g. new items, a theme or colors), or use create_motion_graphic directly for more options (columns, a highlighted bar, full-frame backdrops). Palette: editorial (warm paper, red accent), electric (the dark signal theme with lime), mono (black and white). Without durationMs the template's own length is used.",
		input: {
			kind: z.enum(["bars", "donut", "cards", "line", "timeline"]),
			title: z.string().min(1).max(120),
			items: z
				.array(z.object({ label: z.string().min(1).max(60), value: z.number().finite().min(0) }))
				.min(1)
				.max(6),
			unit: z.string().max(24).optional(),
			source: z.string().max(160).optional(),
			palette: z.enum(["editorial", "electric", "mono"]).default("editorial"),
			startMs: z.number().min(0),
			durationMs: z.number().min(1000).max(60000).optional(),
		},
	},
	add_data_callout: {
		description:
			"Pin an animated callout to a point in the video: a pulsing marker on the target (targetX, targetY), a leader line and a label box with an optional value and source at x, y. Positions are shares of the frame, 0–1. It makes a motion graphic from the callout template and places it at startMs; it returns the assetId, template and params. Move or reword it with update_motion_graphic {assetId, params: {targetX, targetY, labelX, labelY, label, value, source, theme}}. Use for a place, person, object, or sourced fact visible in the shot.",
		input: {
			label: z.string().min(1).max(80),
			value: z.string().max(40).optional(),
			source: z.string().max(120).optional(),
			x: z.number().min(0).max(1).default(0.72),
			y: z.number().min(0).max(1).default(0.38),
			targetX: z.number().min(0).max(1),
			targetY: z.number().min(0).max(1),
			palette: z.enum(["editorial", "electric", "mono"]).default("editorial"),
			startMs: z.number().min(0),
			durationMs: z.number().min(1000).max(60000).optional(),
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
			describe: z
				.boolean()
				.default(false)
				.describe(
					"also describe each sampled frame with the vision model of the text provider in Settings (OpenAI sends small frames to OpenAI; Ollama or LM Studio stay on this Mac); descriptions are cached, so later searches are instant",
				),
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
			"List quick recipes and style guides. Style guides include a goal, required media, structure, directions and review checks. Follow them adaptively with Cue tools; only quick recipes run automatically.",
		input: {},
	},
	list_styles: {
		description:
			"Browse the style library. Returns each style's id, name, category, description, preview and recommended library assets; use show_style to select one in the editor and read its full guide.",
		input: { category: z.string().optional(), query: z.string().optional() },
	},
	show_style: {
		description:
			"Select a style in Cue's Style library and return its full goal, footage requirements, structure, directions and review checks. Then use the normal Cue editing tools to adapt it to the project.",
		input: { id: z.string() },
	},
	run_recipe: {
		description:
			"Run a quick recipe's steps in order on the open project. Style guides without steps are followed by an agent using normal Cue tools instead. Placeholders are filled from the project; dryRun returns resolved calls without running them. On a required-step failure, earlier project edits are restored; optional steps are skipped.",
		input: { id: z.string(), dryRun: z.boolean().default(false) },
	},
	save_recipe: {
		description:
			"Save a quick recipe, style guide, or both. A style guide has format 'style' and guide {goal, requires[], structure[], directions[], review[]}; agents follow it adaptively. Repeatable edits use steps [{tool, params, label?, optional?, each?}] and may use {playheadMs}, {selectedClipIds}, {selectedClipId}, {durationMs}, {projectName}, {voiceoverAssetId}, {musicAssetId}, {firstVideoClipId}, {firstMusicClipId}, {voiceClipIds}, {captionSource}. Saving with the same name replaces your recipe.",
		input: {
			name: z.string().min(1).max(120),
			description: z.string().max(1000).default(""),
			category: z.string().max(60).optional(),
			format: z.enum(["recipe", "style"]).optional(),
			guide: z
				.object({
					goal: z.string().min(1).max(1000),
					requires: z.array(z.string().min(1)).max(12),
					structure: z.array(z.string().min(1)).min(1).max(12),
					directions: z.array(z.string().min(1)).min(1).max(12),
					review: z.array(z.string().min(1)).max(12),
				})
				.optional(),
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
				.max(50)
				.default([]),
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

	find_media: {
		description:
			"Find openly licensed pictures or footage outside the project when the library and your own media don't have what the edit needs: kind image (Openverse: Flickr, museums, Wikimedia and more; plus Wikimedia Commons) or video (Wikimedia Commons). Only CC0, public domain, CC BY and CC BY-SA (usable in any video with credit). Returns id, title, creator, size, length, licence and the credit line for the credits. Add one with import_found. Prefer specific queries ('1950s office typewriter', 'aerial city night timelapse').",
		input: {
			query: z.string().min(2),
			kind: z.enum(["image", "video"]).default("image"),
			minWidth: z.number().int().min(0).optional(),
			limit: z.number().int().min(1).max(20).default(8),
		},
	},
	import_found: {
		description:
			"Download something found with find_media (by id) into the project's found folder, add it to the media with its credit (video is converted to MP4), and optionally place it on trackId at startMs (images for durationMs, default 5 s). Put its credit line in the credits.",
		input: {
			id: z.string(),
			trackId: z.string().optional(),
			startMs: z.number().min(0).default(0),
			durationMs: z.number().min(1).optional(),
		},
	},
	find_music: {
		description:
			"Search openly licensed music (CC0, public domain, CC BY, CC BY-SA: usable in any video, commercial ones too) by mood, genre or instrument, e.g. 'calm piano', 'lo-fi study', 'cinematic tension'. Returns tracks with id, title, creator, length, licence and the credit line that must go in the video's credits or description. Add one with import_music. Cue's library has sound effects but no music: use this or generate_music whenever a video needs a bed.",
		input: {
			query: z.string().min(2),
			minSeconds: z.number().min(0).optional(),
			maxSeconds: z.number().min(1).optional(),
			licences: z
				.array(z.enum(["cc0", "pdm", "by", "by-sa"]))
				.min(1)
				.optional(),
			limit: z.number().int().min(1).max(20).default(8),
		},
	},
	find_sfx: {
		description:
			"Search openly licensed sound effects (Freesound and others through Openverse; CC0, public domain, CC BY, CC BY-SA) for the exact sound a moment needs: 'door slam', 'camera shutter', 'crowd cheer', 'keyboard typing', 'wind'. Returns short sounds with id, length, licence and credit. Add one with import_sfx. Use real recorded sounds for real-world things; generate_sfx for designed ones (whooshes, risers, hits, UI sounds).",
		input: {
			query: z.string().min(2),
			maxSeconds: z.number().min(0.1).max(60).default(12),
			limit: z.number().int().min(1).max(20).default(8),
		},
	},
	import_sfx: {
		description:
			"Download a sound found with find_sfx (by id), add it to the media with its credit, and place it at atMs on an SFX track (a free one, so sounds never cover each other). Put the credit line in the credits.",
		input: {
			id: z.string(),
			atMs: z.number().min(0).optional(),
			trackId: z.string().optional(),
			volume: z.number().min(0).max(2).default(0.8),
		},
	},
	generate_sfx: {
		description:
			"Synthesise original sound effects, a new variant every time (pitch, length, envelope and space vary), so repeated events don't repeat the same file. kind: whoosh, swish (short), riser, downlifter, impact, sub-drop, hit, pop, click, glitch, shimmer, beep, thump. character fits the material: soft (paper, gentle UI), bright (UI, tech), dark (tension, cinema), heavy (trailers, drops), digital (glitchy, screen), organic (neutral). variants makes several at once; atMs (one or a list, one per variant) places them on a free SFX track. No credit needed.",
		input: {
			kind: z.enum([
				"whoosh",
				"swish",
				"riser",
				"downlifter",
				"impact",
				"sub-drop",
				"hit",
				"pop",
				"click",
				"glitch",
				"shimmer",
				"beep",
				"thump",
			]),
			character: z
				.enum(["soft", "bright", "dark", "heavy", "digital", "organic"])
				.default("organic"),
			durationMs: z.number().min(30).max(10000).optional(),
			variants: z.number().int().min(1).max(8).default(1),
			atMs: z.union([z.number().min(0), z.array(z.number().min(0)).max(8)]).optional(),
			trackId: z.string().optional(),
			volume: z.number().min(0).max(2).default(0.7),
		},
	},
	import_music: {
		description:
			"Download a track found with find_music (by id), add it to the media with its credit, and lay it on the music track (made if missing) from startMs with fades, ducked under the voiceover. durationMs trims it (default: the whole track). Put the returned credit line in the credits. place false only adds it to the media.",
		input: {
			id: z.string(),
			startMs: z.number().min(0).default(0),
			durationMs: z.number().min(1).optional(),
			trackId: z.string().optional(),
			fadeInMs: z.number().min(0).default(1500),
			fadeOutMs: z.number().min(0).default(3000),
			place: z.boolean().default(true),
		},
	},
	generate_music: {
		description:
			"Compose an original, royalty-free music bed made to measure (no credit needed): mood calm (soft piano arpeggios over a pad: explainers, tutorials, study or assignment videos), lofi (jazzy chords, soft beat, vinyl), ambient (slow open chords), tension (dark minor pulse), uplifting (bright arpeggios, light beat) or documentary (dark drone). It is exactly durationMs long (default: to the end of the timeline), with fades and loudness set for ducking under a voice, and is laid on the music track unless place is false. Optional key (C, D, E, F, G, A, B and sharps) and bpm.",
		input: {
			mood: z.enum(["calm", "lofi", "ambient", "tension", "uplifting", "documentary"]),
			durationMs: z.number().min(2000).max(3600000).optional(),
			startMs: z.number().min(0).default(0),
			key: z.string().optional(),
			bpm: z.number().min(40).max(180).optional(),
			trackId: z.string().optional(),
			place: z.boolean().default(true),
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
			"Project settings: recording (prerollMs, postrollMs, autoStop, monitor mute/timeline, padMs, silenceDb), useProxies, and separateAudio (a placed video's sound goes on an audio track, linked; default true).",
		input: { settings: settingsSchema.partial() },
	},
	update_export: {
		description:
			"Export settings: stemsDir, stemPattern ({id},{index}), normalize, voiceoverFile, videoFile ({name}), videoQuality.",
		input: { export: exportSchema.partial() },
	},
	update_ai: {
		description:
			"Generation settings: ttsModel, voice, voiceInstructions, transcriptionModel, imageModel. ttsModel: keep gpt-4o-mini-tts (it follows OpenAI's newest speech model; a dated snapshot pins an old one), or tts-1-hd. For images, choose gpt-image-2.5-flare (fast) or gpt-image-2.5-sunburst (precise); older saved models remain usable.",
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
			"Show the user something: go to a page (edit, motion, titles, colour, audio, voice, review, deliver, agent — motion with motionAssetId opens that graphic on the Motion page), switch workspace (window layout), open a sidebar panel or a dock beside the viewer, fit the whole timeline in view, zoom the timeline (px per second), open a media item in the source monitor, zoom the viewer, turn viewer overlays on or off, split before/after, or A/B compare two sequences.",
		input: {
			page: z
				.enum([
					"edit",
					"motion",
					"titles",
					"colour",
					"audio",
					"voice",
					"review",
					"deliver",
					"agent",
				])
				.optional(),
			motionAssetId: z.string().optional().describe("motion graphic to open on the Motion page"),
			panel: z
				.enum([
					"media",
					"library",
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
			viewerZoom: z
				.union([z.literal("fit"), z.number().min(10).max(800)])
				.optional()
				.describe(
					"Zoom the viewer to inspect the frame: 'fit', or a percentage of the canvas's real pixels (100 = one canvas pixel per screen pixel)",
				),
			overlays: z
				.object({
					safeAreas: z.boolean(),
					teleprompter: z.boolean(),
					compare: z.boolean(),
					sourceTwoUp: z.boolean(),
					clipStrip: z.boolean(),
				})
				.partial()
				.optional()
				.describe(
					"Viewer overlays: safeAreas (title and action safe guides), teleprompter (script beside the viewer), compare (before/after controls), sourceTwoUp (source monitor beside the viewer), clipStrip (shots under the viewer)",
				),
			beforeAfter: z
				.object({ split: z.boolean(), at: z.number().min(0).max(1).optional() })
				.optional()
				.describe(
					"Split before/after in the viewer: the ungraded picture left of a divider at `at`",
				),
			compareSequences: z
				.tuple([z.string(), z.string()])
				.nullable()
				.optional()
				.describe(
					"A/B compare two sequences (ids from list_sequences): the user flips between them at the same moment with the backquote key; null stops",
				),
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
