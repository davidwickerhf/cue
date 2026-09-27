import type { Playbook } from "./index";

export const MATCH_REFERENCE: Playbook = {
	id: "match-a-reference",
	name: "Match a reference video",
	category: "workflow",
	summary:
		"How to recreate the style of any video the user points at: measure it, write a style sheet, find legal material, build scene by scene, then measure your own export against it.",
	useWhen:
		"The user says 'make it look like this', names a creator or channel, or shares a video whose style they want.",
	body: `# Match a reference video

Style is numbers plus a handful of recurring devices. Measure the numbers, name the devices, then build with Cue's tools and check the numbers again at the end.

## 1. Get the reference (to study, never to reuse)
- A file the user gives, or one they have the right to download. The reference is only studied: its footage, music, graphics and logos never go into the new video.
- Import it or pass its path to analyze_reference.

## 2. Measure it
analyze_reference returns, and shows as a contact sheet (one frame per shot):
- pace: cuts per minute, median and mean shot length, the longest holds, and cuts per 10 s (where it speeds up, where it breathes — a cold open is usually the densest stretch);
- look: brightness, colourfulness, how much is black and white, the dominant colours (take the 2–3 non-grey ones as the accent palette);
- sound: integrated loudness and range (explainers sit around −16 to −20 LUFS; loud social edits near −14).
Measured on Vox's "Why we say OK": 17.7 cuts a minute, median shot 1.8 s, 83% black and white, paper white #eaeaea and ink #111010 covering half the picture, −20.5 LUFS. Numbers like these are the brief.

## 3. Write a style sheet before building
Look at the contact sheet and list, in one short note (add_marker at 0 with the note, or keep it in your reply):
- backgrounds (paper, a colour field, footage full frame, a desk);
- how people and objects appear (cut-outs with an outline, framed photos, footage in a TV, full-frame archive);
- type: families, sizes, where it sits, how it enters;
- marks and labels (circles, underlines, highlighter, leader lines, arrows) and their colours;
- camera: push-ins, punch-ins, pans, how still pictures move, stepped or smooth;
- transitions (hard cuts, whips, slides, colour-block wipes);
- texture: grain, vignette, paper, halftone, dust;
- sound: music style and where it stops, which effects land on which events.
Then read the closest style playbook (list_playbooks {category: "style"}) and take its recipes; the style sheet overrides it where they differ.

## 4. Find material you may use
- Public domain footage: Prelinger Archives on archive.org (industrial and educational films, 1930s–70s); public domain photos and prints: Wikimedia Commons (check the licence line), the Library of Congress, the Rijksmuseum; maps: David Rumsey, Natural Earth. Credit every source with a source-tag and in the description.
- Textures and sound effects: list_library_assets {category: "Textures" | "Sound effects"} (CC0 and Cue originals).
- Music: generate or use CC0; never lift the reference's music.
- Cut people and objects out with cut_out; fit footage into devices with the frame templates (list_motion_templates {category: "frame"}).

## 5. Build scene by scene (see working-in-cue)
Script and voice first, word timings from get_transcript; then one scene at a time: background, pictures and their motion, graphics, marks timed to words, source tags, sound effects. After each scene, render_frame at its middle and at every mark, and compare with the reference's contact sheet side by side: same density of things on screen? same palette? same amount of texture?

## 6. Measure your own export
export, then analyze_reference on your file and compare:
- cuts per minute and median shot within about 20% of the reference;
- the black-and-white share and the palette's top colours close;
- loudness within 2 LU.
Where you are off, fix the cause (too few visual events per sentence, holds too long, too clean a picture) and export again.

## Pitfalls
- A clean, empty frame is the most common miss: references almost always have more texture, more layers and more movement than a first pass.
- Don't copy the reference's distinctive branding (logo bugs, signature title designs, its exact graphics). Recreate the technique, not the artwork.
- Keep what you learn: package_project the finished edit with a README of sources, so it can be shared and rebuilt.`,
};
