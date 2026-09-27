import type { Playbook } from "./index";

/**
 * What the worked examples taught, written as checks for the first pass, so a new
 * build doesn't repeat them. Add to it whenever a review of an agent's edit finds a
 * mistake that a rule could have prevented.
 */
export const FIRST_PASS: Playbook = {
	id: "before-your-first-pass",
	name: "Before your first pass: mistakes the worked examples made",
	category: "workflow",
	summary:
		"Checks from building 'Why we say OK' and 'The Red Cars' with Cue: what made first passes look cheap (one photo per sentence, uneven voice, restarting music, mis-cued archive) and what fixed it.",
	useWhen:
		"Read after 'working-in-cue' and before building any video longer than a minute; go through the checklist at the end before you call a pass finished.",
	body: `# Before your first pass

Both worked examples were judged "much lower quality" after their first pass, for the same reasons. Build the second pass first.

## Plan scenes, not shots
- One picture per sentence with a slow push-in reads as a slideshow. Every scene needs at least two layers doing something on the narration: a picture plus a mark (a box or underline that draws on the thing being said), a cut-out, a map move, a number, a year stamp, or a punch-in to a second framing on a key word.
- Cut on words, not on sentences. Aim for the reference's pace (analyze_reference): an archive documentary runs 11–15 cuts a minute, a median shot of about 3 s. A shot that runs over 5 s needs something moving in it.
- Plan each cut as "on this word", then compute the times from the transcript (see Timing). Hand-typed times drift the moment a take changes.

## Voice
- Voice whole passages, not single sentences. Separate takes of one line each change tone and energy from line to line; a paragraph per take keeps one delivery. Give every take the same voice and the same instructions, including the pace ("a clear half-second pause after every sentence").
- Transcribe every take and compare it with the script before building on it. A generated take can silently drop a sentence (The Red Cars lost "Then the rails were paved over.") or come back 300 ms long. Regenerate those.
- Several voices sell a documentary: a narrator, a flat "records" reader for charges, verdicts and numbers (track EQ low -12, mid +6, high -9), a period announcer (low -12, mid +9, high -12). Anything that sounds archival but isn't gets 'DRAMATISATION' on screen.
- Numbers come back from transcription as digits ("40", "5 000"): search for the digits.

## Timing
- Keep a word index: for every line, transcribe_media then get_transcript, and store word times relative to the line. Timeline time = line start + word time. Rebuild the edit from anchors ("the cut to the map lands 120 ms before 'four counties'") so a new take only means re-running the layout.
- set_lines does not move voiceover clips; update_line does, or move them with update_clip. Check with get_timeline after re-timing.
- Graphics with internal timing (steps that appear one by one, a stamp, rows) must be timed to the words too: compute each element's time relative to the graphic's start.

## Archive
- Look at the frames before you use an in-point. Old films are full of intertitle cards; a sourcing note of "Broadway, 466–482 s" can land on a caption card. Extract a frame per second around the in-point (ffmpeg) and pick the shot by eye.
- Tall photos in a wide frame are panned, not scaled; check the pan actually crosses the subject (a 1923 train pan showed only sky and wires).
- 640×480 archive film looks soft when filled to 1080 lines. Restore only the segments you use: cut them with a 1 s handle each side, denoise lightly (hqdn3d 2:1.5:5:4), scale with lanczos to 1440×1080, unsharp 5:5:0.7, then import those.
- Put a label on every archive picture ("Place · year"), on a translucent black backing so it reads on white skies.

## Sound
- One continuous score, built as a file with crossfades at the story beats (the drone drops out a beat before the turn, a pulse under the investigation, a lift for the return). Separate music clips restart audibly and their joins pump under ducking.
- A dramatic silence still needs room tone under it, or it sounds like a dropout.
- auto_mix gets dialogue to -16 LUFS and music about 8 dB under; measure the export (loudness per second) and look for jumps and silences you didn't plan.

## Look
- Library textures (film dust, light leaks) go in with import_library_asset {trackId, startMs, durationMs}: it sets their blend and loops them. Added with add_clips they are opaque black. Use few blended clips: each one costs a full-frame blend through the whole export.
- Effects on a cut-out (glow, vignette) apply to its whole rectangle and draw a box around it; grade a cut-out with color only.
- Marks on a photo only line up if the photo doesn't move under them: hold the photo still (same scale and position) while its mark is up, or give the mark the same keyframes.
- Text clip style.x is the centre of the rendered text. To pin a label to a margin, estimate its width (monospaced: characters × (0.6 × size + letter spacing)) and set x = margin + width / 2.
- In a motion-graphic spec, draw paper and backgrounds as shapes with gradients; image layers from local files may not render.

## Second-pass findings
- A shot or graphic held for more than 6–8 s with nothing new in it reads as a pause, even a typing document: cut away to a detail (a still, a punch-in) and come back.
- Stamps and labels in a corner collide with a graphic's own corner text (a year stamp over a map's title): check the corners of every graphic you lay text over, and don't repeat what the graphic already says (a counter already showing the year).
- Every fix made by hand on the timeline (a crop, a removed clip) goes back into the plan or build script too, or the next rebuild brings the mistake back.

## Before you call it finished
1. render_frame at the start, middle and end of every scene; nothing black, no caption cards, no half-framed subjects, labels readable.
2. Export, then check the file, not the viewer: a frame every 2 s as a contact sheet, black-frame detection (ffmpeg blackdetect), loudness per second (ebur128).
3. Transcribe the export's voice once more and read it against the script.
4. Compare with the reference numbers (analyze_reference on your export).
5. Write down what went wrong in this playbook.`,
};
