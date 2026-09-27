import type { Playbook } from "./index";

export const VOX_EXPLAINER: Playbook = {
	id: "vox-explainer",
	name: "Vox-style explainer",
	category: "style",
	summary:
		"The collage explainer of Vox (and Johnny Harris): paper, archive cut-outs, hand-drawn marks, highlighters, maps, grain, stepped motion — built with Cue's tools, with numbers.",
	useWhen:
		"Explainers and history pieces told by a narrator over archive material, documents, maps and graphics.",
	body: `# Vox-style explainer

What makes it Vox (from Vox's own producers): an "animated opinion essay" — narration over graphics, never a desk; the script is locked before anything is animated; visuals are deliberately imperfect ("you don't want it to look perfect, because that might make it look more like an ad"); archive material is the evidence and gets long holds; music is re-cut to land changes on beats.

The look is the sum of many small things. Missing any three of them and it stops looking like Vox:
paper under everything · archive photos cut out with a white edge and shadow, slightly turned · black-and-white archive with one accent colour · grain and a vignette over all of it · hand-drawn red marks and yellow highlighter · everything moving a little, in steps · labels on leader lines · small source tags · paper and whoosh sounds.

## Palette and type
- Paper #F2EDE4 (off-white) or kraft #E8D9B5; ink #131313; one accent: Vox yellow #FFF200 for highlighter, or red #E4362B for marks; optional muted blue #2F6F8F. Only the thing the narrator points at is in the accent colour.
- Type: serif for titles, quotes and names (font serif, italic for names and captions); heavy sans for labels and big numbers (sans 800); mono uppercase with tracking for dates and source tags. Titles 110–140 px, labels 40–48 px, source tags 22–26 px.

## The base (on every scene)
1. Paper: a paper texture from list_library_assets (Textures) on the bottom track, scale 1.05, or create_motion_graphic {template: "paper"}. Drift it: set_keyframe scale 1.05 → 1.08 over the scene.
2. One adjustment layer over the whole edit (add_adjustment_layer on the top picture track): effects {vignette: 0.35, grain: 0.25}. Heavier grain (0.4) on archive scenes.
3. Optional: multiply a paper texture over footage too (update_clip {blend: "multiply"}, opacity 0.4) so footage sits on the same paper.

## Archive photos as cut-outs (the signature)
1. cut_out {assetId, outline: 10–14, shadow: 0.5} lifts the person or object out with a paper-white edge and a soft shadow.
2. Place it off-centre (x 0.38 or 0.62, 0.35–0.55 of the frame high), leave the other third for its label.
3. Turn it slightly: transform.rotation between −3 and 3.
4. Entrance ("paper slap"): scale keyframes 1.15 → 1.0 over 250 ms (ease-out), with a paper sound on the landing.
5. Never still: wiggle {position: 3, rotation: 0.6, speed: 0.8} and stepFps 12.
6. Stack two or three for "people of the time", each a little turned, lower ones slightly darker (color brightness −0.05).

## Archive in black and white
- Grade archive photos and footage: saturation 0, contrast 1.1, brightness +0.03, temperature +0.05 (warm), grain 0.3–0.4.
- Colour isolation: the same clip above in colour, with a feathered ellipse mask (feather 0.3) round the subject, fading in on the word that names it.
- Archive footage inside an object: a TV or phone frame graphic (list_motion_templates {category: "frame"}) on the track above, the footage below fitted to its screen; push the pair in 1.0 → 1.06 together.

## Camera: nothing is ever still
- Every still has a Ken Burns push: scale 1.00 → 1.08 over the shot, drifting 0.01–0.03 towards the subject.
- Punch-in on a beat to show a detail: scale 1.0 → 1.35 in 400–600 ms (ease-out), then keep drifting.
- Stepped motion: stepFps 12 on graphics and on keyframed stills (footage stays smooth). It is what makes the movement feel handmade.
- Whip between scenes: a slide (slide-left/right transition, 250–350 ms) with a whoosh starting 80 ms before the middle.

## Documents and newspapers
- The clipping or scan on paper, turned 3–8°, slowly pushing in.
- Highlighter (create_motion_graphic {template: "annotate-highlight"}, yellow, multiplied) swiping across the quoted phrase 2–3 frames before the narrator says it, 300–600 ms per line; punch in 1.0 → 1.25 towards it.
- Circle a date or name (annotate-circle, red, 0.65 s draw) as it is said; underline (annotate-underline) a short phrase.
- Dim the rest of the page on the highlight (brightness −0.3 on a duplicate, or a feathered inverted mask with blur).
- Headline flurry for "everyone was writing about it": 6–10 clippings, 250–400 ms each, each turned ±4°, landing on the last one.
- source-tag template with the paper and date for as long as the document is on screen.

## Marks and labels
- Hand-drawn circle, underline and arrow (annotate-circle, annotate-underline, annotate-arrow): red, 6–10 px, drawn in 400–650 ms, stepped at 12 fps, held at least 1.5 s.
- Leader-line labels (annotate-label) naming people and places: the line draws from the subject, the label rises above its end; keep labels in the outer thirds, never over faces.
- Name titles (name-title): big italic serif name, small italic caption; on paper in ink, over pictures in white.
- Maps: a scan of a period map or a simple paper map; location-tag (red tag, italic serif) with an arrow to the spot; routes drawn with line layers (draw preset, 1.5–3 s); a pin that pops.

## Numbers and ideas
- Visualise the abstract with physical metaphors: stacks of objects, a grid of 100 dots filling in, paper columns that grow.
- Counters count up over 1–1.5 s (ease-out), then get a highlighter swipe. Charts (bar-chart, donut-chart, line-chart templates, theme editorial) on paper.
- Big words: a single important word in huge red serif, slammed in (scale 1.5 → 1 over 450 ms), then gone on the next line.

## Structure and pacing
- Cold open (20–60 s): the puzzle or paradox, archive that raises the question. Then the title card (2–3 s, serif on paper, a sting). Then 3–5 sections, each with a card (big sans number, serif title, 1.5–2.5 s).
- One visual event (a cut, a label, a highlight, a punch-in, a number) per stressed noun, number or name in the narration — roughly every 2–4 s. At least 1.2 s between big cuts; after a key fact, 1–1.5 s of calm.
- Archive holds can run 6–8 s when they are the evidence.
- End by answering the opening question; hold the last image 2–3 s.

## Sound
- Music bed changing every ~20 s or at section turns; cut it a beat before a reveal and bring it back on the downbeat; a sting on title and section cards.
- Paper rustle on each cut-out landing, a thud on slams, a whoosh on pushes and whips, a typewriter under typed dates, a marker squeak under highlighter swipes (Sound effects in list_library_assets). Quiet: −18 to −24 dB under the voice, varied.
- Archive sound (a speech, a news anchor) starts 0.5–1 s before its picture, with the voice and music ducked under it.

## Building it in Cue (order)
1. Script and voice (see working-in-cue), word timings from get_transcript.
2. Tracks: Paper (bottom) · Scans · Graphics · Marks · Tags · Look (adjustment layer on top).
3. Paper and the look adjustment layer for the whole length.
4. Scene by scene: place scans (cut_out where people or objects appear), their push-ins, rotation, wiggle, stepFps 12; then the graphics; then marks timed to words; then source tags.
5. Sound effects on landings and transitions; music; auto_mix.
6. render_frame at every scene's middle and at every mark; fix; export.

## Checks specific to this style
- Would a screenshot of any moment show paper, texture and something handmade? If a frame looks clean and digital, add paper, grain, a turn or a mark.
- Is exactly one thing in the accent colour at a time?
- Does every mark land just before its word, and stay long enough to read?
- Are all sources credited on screen (source tags) and in the description?
`,
};
