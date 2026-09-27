import type { Playbook } from "./index";

export const AGENT_WORKFLOW: Playbook = {
	id: "working-in-cue",
	name: "Working in Cue",
	category: "workflow",
	summary:
		"How to build a whole video in Cue as an agent: plan, script, voice, timings, sources, build, check and export — and the mistakes that cost the most time.",
	useWhen:
		"Read first, before any edit longer than a few changes; then read 'before-your-first-pass' (the mistakes earlier builds made).",
	body: `# Working in Cue

## The order that works
1. Brief and plan. Write down the audience, the length, the style (read its playbook: list_playbooks) and a shot list: one line per beat of narration with what the viewer sees.
2. Script. Short sentences, one idea each. Put the script in with set_lines (ids like L1, L2… are yours to choose; startMs roughly where each line goes).
3. Voice. generate_voiceover (give a voice and instructions for the tone). Takes can run longer than the gaps you left: read the voiceover clips with get_timeline and move lines apart with update_line {startMs} so nothing overlaps (leave 300–400 ms between lines, and a beat before titles).
4. Word timings. transcribe_media on each take, then get_transcript: every word has a start time. Timeline time of a word = clip startMs + (word startMs − clip inMs). Everything that points at something the narrator says lands 60–120 ms before the word.
5. Sources. Prefer public-domain and CC0 material, and record where each came from (licence and credit in the asset's note): Wikimedia Commons (check each file's licence; filter searches with filetype:bitmap), Library of Congress "free to use", NASA, the Prelinger Archives on archive.org (per item), ambientCG and Poly Haven (CC0 textures). Cue's own library: list_library_assets. Never download from paid template sites or YouTube for use in an edit.
6. Build. Tracks from bottom to top: background (paper or colour), footage and scans, graphics, annotations, tags and titles. Add tracks first (add_track), then place things with exact times. For a long edit, write the whole plan as a list of calls and send them in batches; one wrong call should not leave the edit half-built.
7. Check. render_frame at the important moments (the start of each reveal, the hold, the exit) and look at the picture. inspect_edit shows several frames at once. Fix, and check again.
8. Export. export {kind: "video", out}. Long calls answer within about 45 seconds; if the reply is {status: "running", callId}, call wait_for {callId} until the result comes. Never start the same export twice.

## Things that go wrong, and how to avoid them
- Guessing text sizes. Boxes, underlines and letters that must line up with text need the text's real width: templates measure it for you; in a spec, keep related text in one layer or use runs, and check with render_frame. Serif text is much narrower than sans at the same size.
- Positions from a template's layout. When you annotate something a template drew (a word in a clipping, a bar in a chart), read the template's spec with get_motion_graphic and compute from it, or place the annotation by eye and check with render_frame. Remember slow push-ins on the graphic move what you annotate: annotate on a still graphic, or follow the push.
- Misspelt parameters are errors that list the right names. Read the error and fix the name.
- Stale graphics. After changing how something should look, rebuild it (update_motion_graphic with the change); old files keep the old look.
- One scene per clip. Split long sequences into several graphics (one per scene) rather than one huge graphic; they are easier to fix and to retime.
- Overlaps. Dropping or moving clips onto others replaces what is under them (move_clips with overwrite). Keep each track to one thing at a time.
- Motion without a reason. Everything that moves should point at, reveal or explain something in the narration.

## Checking your work like an editor
- Watch (render several frames) at the start, middle and end of every scene.
- Is the thing the narrator names on screen when it is named? Is anything on screen that is never mentioned?
- Can every text be read in time (at least 1.5 s plus 0.3 s per word)? Is it inside the title-safe area (7.5% margins)?
- Does the sound sit right: voice clear, music under it (auto_mix), no clicks at cuts?
- Is the look consistent across scenes (one palette, one grade, the same fonts)?
`,
};
