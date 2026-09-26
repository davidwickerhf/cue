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
		version: "Unreleased",
		summary: "New effects and export formats, a faster timeline, and fixes from a full product review.",
		changes: [
			"Effects: blur, sharpen, vignette, glow and stabilisation, previewed live and exported at matching strengths. Adjustment layers can blur, sharpen and vignette everything below them.",
			"Split a clip at its shot changes, from the clip menu or the split_at_scenes tool, in one undoable step.",
			"Export animated GIFs, and sound only as MP3, AAC or FLAC.",
			"Marquee selection, resizable tracks, draggable volume lines on audio clips, and Esc to cancel a drag or trim.",
			"The timeline draws only what is on screen (about 60% fewer DOM nodes at 500 clips), and video clips show their sound as a waveform strip.",
			"Hardware export uses constant quality: files are 5 to 7 times smaller at the same quality.",
			"Exported keyframes animate over time again, and adjustment layers no longer break exports with sound.",
			"Smoother playback: no blank frames at cuts or crossfades, sound decoded around the playhead, drift corrected smoothly.",
			"Saves never overlap or drop an edit, and quitting waits for them. Agents cannot write files outside the export folder.",
			"The History panel fetches only new steps after an edit.",
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
