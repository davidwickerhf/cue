import type { Playbook } from "./index";

/**
 * The working vocabulary of a modern editor and motion designer, each technique with
 * when to reach for it and how to build it with Cue's tools. Agents plan an edit from
 * this list the way an editor thinks: "a J-cut into the interview, a punch-in on the
 * punchline, a riser into the title".
 */
export const TECHNIQUES: Playbook = {
	id: "editing-techniques",
	name: "Editing techniques: what pros use, when, and how in Cue",
	category: "craft",
	summary:
		"About 45 techniques of modern editing and motion design (cuts, camera moves, retention, graphics, sound design, colour, transitions, formats), each with when to use it, how to build it with Cue's tools and numbers, and the usual mistake, plus which techniques fit which kind of video.",
	useWhen:
		"Planning any edit: pick the techniques for the video's kind (last section), then build them. Read before 'editing-craft' details and a style's playbook.",
	body: `# Editing techniques

Plan an edit as a list of techniques tied to moments ("0:12 J-cut into the demo; 0:18 punch-in on 'three times faster'; 0:31 riser into the title"). Use a technique because the moment needs it; three well-placed ones beat twenty. After building, watch it through (play) and check with inspect_edit.

## Cuts
- **Straight cut.** The default. Cut when the thought or action completes, not when a line ends. Most of an edit is straight cuts; everything below is seasoning.
- **J-cut (sound leads).** The next shot's sound starts under the current picture, so the voice or ambience pulls the viewer into the cut. Interviews, scene changes, a narrator introducing a place. How: trim the picture clip's start later than its linked audio (move_clips on the picture only, or detach_audio first, then trim_clip), lead 300–800 ms.
- **L-cut (sound lags).** The picture cuts, the previous sound carries on: a reaction shot while someone finishes, B-roll over the end of a sentence. Same tools, the other way.
- **Cutaway / B-roll.** Cover a join, show what's being said, hide a jump. add_broll or suggest_broll then add_broll; search_shots finds shots in your own media ('whiteboard', 'the word pricing'); 1.5–4 s each, cut on the noun it illustrates.
- **Jump cut.** Cutting out the pauses of one continuous shot: energetic, honest, modern (talking heads, vlogs). remove_silence and remove_filler_words do it; alternate punch-ins (below) between cuts so each jump reads as intentional.
- **Match cut.** Cut between two shots that share a shape, motion or position (a spinning wheel to a spinning globe, a hand reaching in both). Line the matching thing up at the same spot on screen (update_clip transform x, y, scale) and cut on the motion's same phase. Worth hunting for once per video.
- **Smash cut.** An abrupt cut from calm to loud (or the reverse) for comedy or shock. Hard cut, sound change at the same frame, often a silent beat before (see Silence).
- **Cut on action.** Cut in the middle of a movement (a door opening, a hand turning); the movement hides the cut. Choose the out and in points 2–4 frames into the motion.
- **Cross-cutting.** Alternate between two things happening at once; shorten the shots as they converge.
- **Montage.** Many short shots to compress time. beat_montage cuts to the music; snap_cuts_to_beats aligns an existing sequence; detect_beats first.

## Camera moves (on footage or stills)
- **Punch-in.** A sudden 110–130% scale on a key word, for emphasis or to hide a jump cut: set_keyframe scale at the word with ease hold (an instant jump), back to 100% at the next cut. In a talking head, alternate 100% and 115% between cuts.
- **Slow push (Ken Burns).** Stills and slow shots always move: scale 1.04 → 1.12 linear over the shot, or a pan (x or y keyframes) across a tall or wide picture; the motion follows what the narration looks at.
- **Zoom to detail (screen recordings).** add_zoom toward the region of the thing discussed (detect_activity gives the regions); in 400–600 ms, hold, out at the next change.
- **Speed ramp.** Slow down into the key moment and back up (speed_ramp). Action, sport, product reveals. Pair with a whoosh or riser at the ramp.
- **Freeze frame.** freeze_frame on a moment for a name tag, a punchline, a 'that's me' beat; add a camera shutter sound.
- **Parallax / 2.5D.** Cut the subject out of a still (cut_out), keep the background on a lower track: push the background 1.00 → 1.06 and the subject 1.00 → 1.12 so they separate. Gives depth to archive photos.
- **Camera shake / impact.** A few frames of wiggle ({position: 12, rotation: 1, speed: 12}) on the frame an impact lands, with a hit sound. Sparingly.
- **Hand-held drift.** wiggle {position: 3–5, rotation: 0.3–0.5, speed: 0.5–1} on stills and graphics so nothing is dead still.

## Pace and retention (online video)
- **Hook in the first 3–5 s.** Open on the most interesting moment, a question or the result, not the logo. Restructure with move_clips or insert_edit; a title can come after the hook.
- **Pattern interrupts.** Change something every 5–10 s: a punch-in, a cutaway, a graphic, a sound. review_edit flags static stretches.
- **Open loops.** Tease what's coming ('in a minute: the number that surprised us') and pay it off.
- **Trim air.** remove_silence (keep 150–250 ms), cut_words for flubs, remove_filler_words. Then listen: over-cutting sounds breathless.
- **Chapters and progress.** generate_chapters, a progress-bar template for long videos, section titles at screen changes.
- **Captions.** auto_captions; for social, word-by-word styles (wordStyle pop or highlight), 2–4 words at a time, placed in the lower third away from faces and UI.

## Graphics and design
- **Lower thirds and name tags.** A template (list_motion_templates), 4–6 s, on first appearance only.
- **Kinetic typography.** Key phrases as animated words (kinetic-words template, or a spec with runs and staggered rise), in sync with the voice (word timings from get_transcript). One idea per screen.
- **Callouts and annotations.** add_data_callout to point at something; circles, underlines, arrows and highlighter from the annotation templates, drawing on 2–3 frames before the word.
- **Data.** add_infographic for bars, lines, donuts, big numbers: real numbers, labelled, the story's bar highlighted, source cited.
- **Maps and routes.** A route-map template or line layers that draw between places; label places as they're named.
- **Split screen / comparison.** Two clips side by side (transform x 0.25 and 0.75, scale 0.5, crop to fit), before/after, or the viewer's split for A/B.
- **Picture-in-picture.** A face cam in a corner: scale 0.25–0.3, frame {radius, shadow}, 5% margin.
- **Device frames.** Footage inside a phone, laptop, TV or polaroid template; fit with the template's regions; push the pair in together.
- **Collage / cut-outs.** cut_out subjects with a paper edge and shadow, on paper textures from the library, turned -3…3°, stepFps 12 for a handmade feel.
- **Masks and reveals.** update_clip mask (rectangle or ellipse, feather) to reveal a region, vignette a subject, or wipe one picture into another.
- **Text behind subject.** Title on a track between the background and a cut_out of the subject, so the subject overlaps the text.
- **Brand consistency.** One font family for titles, one for text; a palette of a background, a text colour and one accent; the same positions for recurring graphics.

## Sound design
- **Every visual event has a sound.** Whooshes on moves and transitions (the peak on the cut: use the library asset's syncMs with atMs), pops on things appearing, ticks on counters and clicks, paper slaps on collage, impacts on slams, risers into reveals. Vary them; keep them 12–18 dB under the voice.
- **Room tone.** A bed of room tone under the whole edit so silences don't sound dead (library sfx-room-tone).
- **Music.** A bed that fits the tone: generate_music {mood} made to measure, or find_music for a licensed track (credit it). Edit music on phrase boundaries (cuts on the downbeat, detect_beats); duck it under the voice (auto_mix does).
- **Silence for emphasis.** Drop the music a beat before a key line or punchline, bring it back after.
- **Risers and stingers.** A riser into a title or reveal, an impact on it; a short sting on section titles.
- **Clean voice.** Denoise voice (update_clip denoise), the Voice preset on the voiceover track, level quiet takes (level_take), -16 LUFS finish (auto_mix, measure_loudness).

## Colour and look
- **Consistency first.** Match shots to each other (copy_grade), then give the whole edit a look with an adjustment layer (add_adjustment_layer: grade, grain, vignette).
- **Looks by genre.** Warm and saturated archive; desaturated cool for tension; black and white for the past or a flashback; clean neutral for tutorials and product.
- **Film texture.** Grain 0.2–0.4, vignette 0.3–0.45, dust or light leaks from the library (import_library_asset, screen blend) on archive and nostalgic passages only.
- **LUTs.** update_clip color lut with a .cube file for a known look; lower its effect with an adjustment layer's opacity.

## Transitions
- Straight cuts almost always. A dissolve means time passing; a dip to black a chapter ending; a match cut or cut on action is invisible.
- **Whip / zoom transitions** for energetic edits: add_transition (zoom, slide, wipe) 8–14 frames with a whoosh on the cut.
- **Designed transitions.** Transition templates in your palette, placed with atCutMs; light leak over a cut (1–2 s, screen) for warmth.
- **Motivated wipes.** Something crossing the frame (a person, a car, a pole) as the wipe: cut when it covers the frame.
- Never use a different transition at every cut.

## Formats
- **Vertical and square.** make_variants or reframe (with follow_faces) for 9:16 and 1:1; re-place captions and graphics inside the new safe area.
- **Shorts from long videos.** find_moments for the strongest 20–60 s; hook first; captions on; end on a loop point.

## Which techniques for which video
- **Tutorial, demo, assignment video:** detect_activity; cut idle; zoom to regions; ticks and pops on clicks; captions; calm music bed; clean neutral look. Read 'screen-recording-demo'.
- **Explainer:** narration-led; kinetic type, callouts, maps and data; collage or motion graphics; sound on every graphic. Read 'vox-explainer' or 'flat-vector-explainer'.
- **Documentary / history:** archive with labels, slow pushes, parallax, maps, evidence close-ups; several voices; a score that follows the story. Read 'archive-history-documentary'.
- **Talking head / vlog:** jump cuts with alternating punch-ins, B-roll every 10–15 s, word captions, pattern interrupts, music under.
- **Interview:** J- and L-cuts, cutaways, lower thirds, room tone, gentle grade.
- **Product film / ad:** hook, speed ramps, macro cutaways, clean type, beat-cut music, a strong end card with the call to action.
- **Event / travel montage:** beat_montage, match cuts, speed ramps, light leaks, one song.
- **Social short:** hook in 1 s, vertical, big captions, a change every 2–3 s, loop the ending.

## Find what you need
Use Cue's library (list_library_assets: textures, overlays, sound effects, stock clips), generate (generate_image for stills and backgrounds, generate_music for beds, generate_take for voices), or find openly licensed material (find_media for images and video, find_music for music) with its credit. Don't stop because an asset isn't in the library. Read 'finding-assets'.`,
};
