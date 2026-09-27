import type { Playbook } from "./index";

export const EXAMPLE_OK: Playbook = {
	id: "example-why-we-say-ok",
	name: 'Worked example: "Why we say OK" in the Vox style',
	category: "example",
	summary:
		"A complete 73-second explainer built in Cue with public domain material: the script, every scene with its tools and numbers, the sources, and what went wrong on the way.",
	useWhen:
		"Before building any explainer, archive or collage video; as a model of how much goes into one scene.",
	body: `# Worked example: "Why we say OK"

A 73.5 s, 1080p remake of Vox's explainer "Why we say OK" (youtube.com/watch?v=1UnIDL-eHOs), made entirely with Cue's tools as a test of how well an agent can recreate a style: the idea, story and editing style are Vox's, the material and the build are new, and the end card credits Vox. Shown on cue.wicker.life/examples with the project to download. Credit the original the same way whenever you remake someone's video.

## Script (8 lines, generated voice "ash", about 150 words)
L1 There is a two-letter word you have probably said today without even thinking about it.
L2 OK. It might be the most widely understood word on the planet. And it started as a joke.
L3 In March 1839, the Boston Morning Post printed a strange little abbreviation: o. k., all correct.
L4 Spelled wrong on purpose: oll korrect. Papers at the time were full of joke abbreviations like that, K C for knuff ced, O W for oll wright.
L5 Almost all of them were forgotten within a year. OK was not, thanks to a president.
L6 Martin Van Buren came from Kinderhook, New York. When he ran for re-election in 1840, his supporters called him Old Kinderhook, and started O.K. clubs.
L7 He lost. But the word stuck. The telegraph needed a short reply that meant: message received. O K.
L8 And today it is how we say yes without saying very much at all.
Word timings from get_transcript drive every mark below (a mark lands 2–3 frames before its word).

## Tracks (top to bottom)
Look (adjustment layer: vignette 0.35, grain 0.22) · Tags · Marks · Graphics · Cutouts · Footage · Ghost (newsprint) · Paper (paper texture, scale 1.05 → 1.10 over the whole video) · Voiceover · Music · Effects.

## Scenes
1. 0–6.4 s, cold open: five archive shots of people on telephones (1.1–1.5 s each) from "The World at Your Call" (1950, Prelinger), black and white (saturation 0, contrast 1.18), grain 0.4, vignette 0.35, scale 1.36 → 1.42 to fill 16:9 from 4:3. A red box with white "OK" pops beside each speaker (a motion graphic group with pivot on the box, pop preset, rotation ±4°) with a pop sound; film dust (screen, 0.7) over it.
2. 6.4–13.45 s: a 900 px red serif "OK" slams in (scale 1.5 → 1 in 450 ms, thud); at "most widely understood" the 1845 fashion plate figures, cut out with cut_out (outline 14, shadow 0.5), slide up from below in front of the letters (y 1.45 → 0.63 in 320 ms, paper slap), turned −1.5°, wiggle and stepFps 12; the word "okay" in other languages types on at the top.
3. 13.45–14.9 s: title card on a full red field.
4. 14.9–24.1 s: the Boston Morning Post clipping (clipping template) multiplied over newsprint (opacity 0.55), turned −1.2°; the date circled as "March 1839" is said; at "abbreviation" the camera punches in to 1.7 towards the "o. k." line (x and y keyframes centring it), and it is underlined on "o. k."; the marks carry the same keyframes as the clipping so they stay on their words; a source tag.
5. 24.1–27.8 s: a red block sliding over the left 40%, the cut-out people half on it, "Oll Korrect" in italic serif with a yellow multiplied highlighter swiping under it on the word.
6. 27.8–35.35 s: the original fashion plate panning slowly (x 0.53 → 0.47, scale 1.10 → 1.16); leader labels KC and OW on the faces (with the pan's keyframes), quotes with highlighter at the bottom.
7. 35.35–42.45 s: nine abbreviations appear and are struck out in red one after another; O.K. stays and becomes a red block with a thud.
8. 42.45–44.85 s: Van Buren, cut out from a Brady daguerreotype, slapped onto a red block covering the right 56%, name title in the paper half.
9. 44.85–49.95 s: an 1827 map of New York pushing in to Kinderhook (scale 1.02 → 1.6 in 700 ms), a location tag, an "1840" stamp.
10. 49.95–55.15 s: "Old Kinderhook" in italic serif; O and K circled, the other letters fade, O and K slide together into "O.K.", a red "CLUBS" block.
11. 55.15–58.8 s: Van Buren tips over and falls out of frame on "He lost" (rotation −2 → −22, y → 1.6, ease-in, deep whoosh); "But the word stuck." on a red strip.
12. 58.8–64.95 s: telegraph poles, then a switchboard, ghosted (opacity 0.3–0.4 over paper); a wire draws across; MESSAGE RECEIVED types on (typewriter sound); O and K in boxes with their Morse code.
13. 64.95–70.5 s: a woman on the phone (the same film), darkened; a chat card masked to its phone shape (the chat template has a paper background: mask rectangle width 0.335) where "Ok" is sent.
14. 70.5–73.5 s: end card, red field, "OK.".

## Sound
An original plucked music bed at 96 bpm (0.22 volume, ducked under the voice), silent for a beat before "He lost"; 40 effects: pops on tags, paper slaps on cut-outs, thuds on slams, whooshes on pushes and falls, flicks on marks, typewriter and ticks on the telegraph. Final mix −16.4 LUFS.

## Sources (all public domain)
- "The World at Your Call" (1950), Prelinger Archives, archive.org/details/WorldAtYourC
- Journal des Marchands Tailleurs, June 1845, No. 97 (Rijksmuseum RP-P-2009-3238), via Wikimedia Commons
- Martin Van Buren, daguerreotype by Mathew Brady, c. 1849 (Library of Congress), via Wikimedia Commons
- A. Finley, Map of New York, 1827, via Wikimedia Commons (Geographicus)
- Paper, newsprint and sounds from Cue's library (CC0 and Cue originals)

## What went wrong, so you don't repeat it
- v1 was flat paper with text: no footage, no cut-outs, no texture. It did not read as Vox at all. The fix was everything in scenes 1, 2, 5, 8 and 11: archive footage, cut-outs on red, grain and vignette over everything.
- A 1848 cartoon found in the search had a racial slur in its speech bubbles: read every archive picture before using it.
- Marks drawn over a clipping drift off their words when the clipping is pushed in: give the marks the same keyframes.
- The chat template covers the frame with paper; mask it to the card to see footage around it.
- 4:3 archive fills a 16:9 frame at scale 1.33; use 1.36 so the pushed edges never show.
- Check the export, not only the viewer: render_frame, then export and look at frames of the file (analyze_reference on it gives the numbers to compare with the reference).
- Package the finished project (package_project, with a README of sources) so it can be shared; the example's download was made that way.`,
};
