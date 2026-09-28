export type Release = {
	version: string;
	/** ISO date of the release, or undefined while unreleased. */
	date?: string;
	summary: string;
	changes: string[];
};

/** Newest first. "Unreleased" lists work on the main branch that is not in a build yet. */
export const CHANGELOG: Release[] = [
	{
		version: "0.2.13",
		date: "2026-09-28",
		summary: "Shared usage includes how long exports take.",
		changes: [
			"If you share anonymous usage, an export also reports how many seconds it took and how that compares with the video's length, so slow exports show up and get fixed.",
		],
	},
	{
		version: "0.2.12",
		date: "2026-09-28",
		summary: "Help shape Cue: optional, anonymous usage sharing.",
		changes: [
			"Cue asks once whether to share anonymous usage (the version, your system, and which features get used). Nothing is sent unless you say yes; it never includes file or project names, content, prompts or keys. Change it any time in Settings → General → Privacy.",
			"A privacy page on the site says exactly what the site and the app measure.",
		],
	},
	{
		version: "0.2.11",
		date: "2026-09-28",
		summary: "Pasting an API key just works.",
		changes: [
			"A pasted key is taken out of whatever came with it (invisible characters from a web page, a label, quotes), so ElevenLabs, OpenAI and fal keys connect first time.",
			"When what was pasted isn't a key, Cue says what a key looks like and what it got, instead of the service's 'Invalid API key'.",
		],
	},
	{
		version: "0.2.10",
		date: "2026-09-28",
		summary: "Agents know what they can generate with your connected services, and when not to.",
		changes: [
			"Agents see at the start of every job what can be generated right now (voice, sound and music, video clips, images) and with which service, or which one to connect.",
			"A new 'ai-generation' playbook: when to generate rather than find or film, honesty rules for news and documentary, prompts for each service, one voice and one look per project, silent clips given a sound, and spending your credits sensibly.",
			"ElevenLabs v3 delivery tags such as [whispers] go only into the spoken take, never into the script or captions.",
		],
	},
	{
		version: "0.2.9",
		date: "2026-09-28",
		summary: "An After Effects–style timeline for motion graphics, one key for all AI services, and a calmer editor.",
		changes: [
			"Motion page: a timeline with every layer, twirl-down properties with stopwatches and scrubbable values, keyframes shaped by their ease (Easy Ease with F9), layer bars to trim and slide, and entrances and exits you drag. It scrolls at the edges while you drag, and the preview follows live.",
			"Connect services once: fal gives voice, sound, music, video clips and images with one key; Connect opens the key page and Cue picks the key up when you copy it. OpenAI and ElevenLabs connect the same way.",
			"New AI tools: sound effects and music (ElevenLabs), video clips from a prompt or a still (Kling, Hailuo), and ElevenLabs voices for the voiceover.",
			"Settings → AI shows the services and what Cue can do with them; the per-task choices are under Advanced.",
			"Generate is a short list of tools, each opening on its own; the style library moved to the Agent panel.",
			"Media: search and one Add menu, with filters and sorting in a single menu.",
			"The sidebar, inspector and docked panes resize by dragging their edge (double-click resets); the sidebar can run the full height; the timeline folds to its tabs.",
			"Check for Updates opens Cue's own dialog, with what's new, progress and restart.",
		],
	},
	{
		version: "0.2.8",
		date: "2026-09-28",
		summary: "A problem drawing one panel no longer blanks the whole window.",
		changes: [
			"If part of the window hits a problem, only that page or panel says so, with 'Try again' (or 'Reload the window'); the project is never affected.",
			"Motion graphics that use a font this version doesn't have are drawn in Sans instead of crashing (selecting DM Sans text in 0.2.5 blanked the window).",
			"The Motion page lists the UI font (DM Sans), and a graphic opens at its own time instead of where the previous one was.",
		],
	},
	{
		version: "0.2.7",
		date: "2026-09-28",
		summary: "Show the agent what you mean: screenshots, pinned clips, a history of conversations, and messages while it works.",
		changes: [
			"Paste, drop or attach screenshots in the agent chat, or attach the frame at the playhead; the agent sees them with your message.",
			"'Ask the agent about this…' pins the clips to your message, with their exact details, so the agent acts on those clips even if the selection changes.",
			"Every project keeps its conversations (in .cue-chat next to the project, left out of shared packages): switch between them or delete them from the history list.",
			"Keep writing while the agent works: Claude reads a new message at its next step; Codex and Gemini get it as soon as they finish, or right away with 'Send now'.",
			"Sound effects with variety: generate_sfx makes whooshes, risers, impacts and more in different characters, each variant different; find_sfx and import_sfx bring in openly licensed sounds with their credits.",
			"The speed badge on timeline clips is rounded (2.6×, not 2.5989…×).",
		],
	},
	{
		version: "0.2.6",
		date: "2026-09-28",
		summary: "Exports that don't freeze the editor, clips that never stack, and Cue's own font for motion graphics.",
		changes: [
			"Exporting no longer freezes the editor: graphics are drawn only where they change (a still backdrop is one frame, not hundreds), the window keeps responding between frames, and ffmpeg runs at a lower priority.",
			"Clips an agent adds never land on top of each other: a clip that would overlap goes to a free track, and voiceover takes move back to the voiceover track once their lines are spaced out.",
			"Motion graphics can use DM Sans, the font of Cue's own interface (font: ui).",
		],
	},
	{
		version: "0.2.5",
		date: "2026-09-27",
		summary: "Takes trimmed to the speech, and a clearer takes list you can stop.",
		changes: [
			"A take's speech is found from its loudness, so the silence before you speak and after you finish (a late Stop) is left out, on any mic and at any level; 'Trim silence' fixes takes recorded before.",
			"Levelled takes stay exactly in sync (the limiter's delay is compensated).",
			"The takes list: the take's name in full, its source as an icon, its length against the line, a 'Quiet · Raise' button when it's too quiet, and Play that turns into Stop with a progress bar.",
		],
	},
	{
		version: "0.2.4",
		date: "2026-09-27",
		summary: "An agent that edits like a pro, reads screen recordings in seconds, and levels quiet voiceovers.",
		changes: [
			"Voiceover takes recorded on a laptop mic are raised to voice level when saved (the original is kept); quiet takes already recorded get a 'Raise to voice level' button.",
			"detect_activity reads a screen recording without looking at its frames: page changes, click results and where they are, scrolls, typing and idle stretches, in seconds, with what editors do at each.",
			"Agents know the craft: an 'editing-techniques' library (about 45 techniques, when and how to use each in Cue), 'finding-assets', 'screen-recording-demo', and guidance on what to do first for each kind of request.",
			"find_media brings in openly licensed pictures and footage (Openverse, Wikimedia Commons) with their credits.",
			"The in-app agent works like an editor: it looks at the material, plans in techniques, tells you the plan, builds, checks and reports.",
		],
	},
	{
		version: "0.2.3",
		date: "2026-09-27",
		summary: "Music found or made, a proper review of every voiceover take, big projects that stay light and export reliably, and a second worked example.",
		changes: [
			"Pictures in the media panel and timeline use small thumbnails instead of the full-size files, and silent clips' sound isn't decoded: a 150-clip project went from 2.1 GB to about 740 MB.",
			"Exports of large, layered edits no longer fail: inputs decode on one thread each, animated text gets time for its frames, the Mac's hardware encoder falls back to software when it won't start, and a failed export leaves no half-written file.",
			"Agents connecting to a second copy of Cue reach that copy (the MCP bridge honours CUE_USER_DATA).",
			"Music: agents can find openly licensed music (CC0, CC BY) with its credit line, or compose an original, royalty-free bed made to measure (calm, lo-fi, ambient, tension, uplifting, documentary), laid on the music track and ducked under the voice.",
			"Recording a voiceover take: a big 3-2-1 countdown, a live timer against the line's target and maximum, and recording runs until you stop it. Afterwards Cue shows how the take fits and suggests what to do: use it, keep the previous take, discard it, or fit the edit around it (make room or close the gap). It also warns when a video under the line has its own sound playing with the take.",
			"Every take stays in the project: the selected line lists them right under it in the Voiceover panel, with how many there are on each line.",
			"The Agent panel shows replies formatted (bold, lists, code, links) instead of raw markdown.",
			"ripple_from moves everything after a point (clips on every track, lines and markers) in one step.",
			"New example: The Red Cars, an archive history documentary in the style of Hoog, with its project, prompt and a worked-example playbook.",
			"New playbooks: 'before-your-first-pass' (the mistakes earlier builds made, as rules and a checklist) and 'archive-history-documentary'.",
			"Releases can no longer split into two drafts: the draft is created before the builds start.",
		],
	},
	{
		version: "0.2.2",
		date: "2026-09-27",
		summary: "Signed with a Developer ID and notarised by Apple, so Cue opens without a warning and updates itself.",
		changes: [
			"The Mac app is signed with a Developer ID and notarised: no right-click → Open the first time.",
			"Automatic updates work on macOS from here on. Copies before 0.2.2 can't update themselves, so download this one once by hand.",
			"Settings → About shows Cue's version, with what it's built on and a link to what's new.",
		],
	},
	{
		version: "0.2.1",
		date: "2026-09-27",
		summary: "Connect any agent, not only Claude Code.",
		changes: [
			"Connect an agent… in the projects overview opens a dialog to pick Claude Code, Codex, Gemini CLI, VS Code, Cursor, Claude Desktop or any MCP client and copy its command or config; Settings → Agent and the Agent panel have the same choice.",
			"Release builds for Mac no longer fail when there is no signing certificate.",
		],
	},
	{
		version: "0.2.0",
		date: "2026-09-27",
		summary:
			"Pages for each job, a Motion page and motion graphics made by agents, Lottie from After Effects, collections, packaging, and everything learnt from remaking a Vox explainer.",
		changes: [
			"Pages: a bar along the bottom of the editor for Edit, Motion, Titles, Colour, Audio, Voice, Review, Deliver and Agent (⌥1–⌥9).",
			"The Motion page designs one motion graphic at a time: its layers, a large preview to click and drag on, text, colours, position, entrances and exits.",
			"Motion graphics: Lottie files from After Effects play and export; 40+ original templates (titles, charts, annotations, maps, device frames); agents design their own from a JSON spec, and change single layers with edit_motion_layer.",
			"Film grain, blend modes, rotation, opacity keyframes, hand-held wiggle and stepped motion ('on twos'); cut_out lifts people and objects out of pictures with a paper edge and a shadow.",
			"An asset library of CC0 paper textures, light leaks, dust and sound effects, and device frames (TV, laptop, phone, polaroid) that footage fits into, now tiltable.",
			"Playbooks for agents: how to work in Cue, editing craft, premium motion design, 13 styles (Vox, map documentary, tech review, vlog…), matching a reference video, and a worked example. analyze_reference measures a video's pace, look and loudness.",
			"Projects: collections in the projects overview, File → Package Project… (one zip with all media, long footage trimmed), projects placed in other projects as media, and a .cueproj document icon.",
			"Exports: scale keyframes and the vignette now match the preview, graphics-heavy edits no longer time out, and agents see export progress.",
			"Reliability: render_frame works with Cue in the background, never catches half-drawn pictures, and long agent calls reply with a handle to wait on.",
			"Blur, sharpen, vignette, glow and stabilisation effects; split a clip at its shot changes; GIF, MP3, AAC and FLAC exports; marquee selection and resizable tracks; RNNoise voice clean-up.",
			"Timeline: moving clips between tracks and adding tracks by dropping onto the timeline, with overwrite as in other editors.",
		],
	},
	{
		version: "0.1.1",
		date: "2026-09-26",
		summary: "Fixes since 0.1.0.",
		changes: [
			"Titles added from a template are visible right away.",
			"Project posters skip dark openings.",
			"The Music tools pick the music track, not the voiceover.",
			"The in-app agent chat always talks to the right copy of Cue.",
		],
	},
	{
		version: "0.1.0",
		date: "2026-09-26",
		summary: "The first public build of Cue for Apple Silicon Macs.",
		changes: [
			"Multi-track timeline with Premiere-style tools and shortcuts: blade, slip, roll, slide, ripple, insert and overwrite, lift and extract, J/K/L.",
			"Agent panel for Claude Code, Codex and Gemini CLI, and an MCP server with 110+ editing tools for any MCP client.",
			"Word-level transcripts with Whisper on your Mac, text-based editing, filler-word removal and captions.",
			"Titles with templates, colour grading and LUTs, adjustment layers, masks, chroma key, keyframes and speed ramps.",
			"Mixer, ducking, denoise, loudness normalisation and beat detection.",
			"Nested sequences, .cueproj project files with a persistent history, and relinking of moved media.",
			"Export to H.264, HEVC and ProRes, and timelines to OpenTimelineIO, FCPXML, MLT and EDL.",
		],
	},
];
