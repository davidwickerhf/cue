import type { Playbook } from "./index";

export const MOTION_DESIGN: Playbook = {
	id: "premium-motion-design",
	name: "Premium motion design",
	category: "craft",
	summary:
		"What makes template-marketplace motion graphics look expensive — easing, stagger, layered builds, masked reveals, light leaks, glitch, HUD, parallax — as original recipes in Cue.",
	useWhen:
		"Designing titles, lower thirds, transitions, openers or any graphic with create_motion_graphic; read with get_guide {topic: 'motion'}.",
	body: `# Premium motion design

## The principles every premium template shares
- Easing: strong ease-out on entrances (outExpo, bezier 0.16 1 0.3 1), quick ease-in on exits (inCubic). Durations 300–700 ms; exits ~0.7× the entrance.
- Stagger: 40–120 ms between letters, words and elements.
- Overshoot: 3–8% on pops (outBack), never more, only on small accents.
- Layering: 2–3 accent shapes (a line, a bar, a dot) move before and after the text; the text never arrives alone.
- Spacing on a grid (multiples of 8 px), generous margins (title-safe 90% of the frame).
- One accent colour. Titles live 2–4 s; transitions 8–16 frames (270–530 ms at 30 fps).

## Layered-shape title build
1. t=0: a thin line draws (line layer, draw preset, 250 ms).
2. t=100 ms: an accent bar grows from the left (rect origin left, grow, 300 ms).
3. t=300 ms: the bar retracts to the right while the text rises from behind it (text with clip at the bar's rectangle, rise preset with amount = line height).
4. Exit in reverse at 0.7× the time. Add an outro marker so longer clips hold.

## Masked text reveal
Each line is its own text layer with a clip rectangle exactly its line's height; it rises from below (rise, amount = line height, 500 ms outExpo), lines staggered 90 ms. The title-card and lower-third templates do this; copy their spec (get_motion_graphic) to start.

## Kinetic typography
Words appear on the syllables of the voice (word times from get_transcript): each word a text layer snapping in (scale 1.3 → 1 over 150 ms); the previous group pushes out as a whole (group, slide 0.3 of the width over 200 ms); emphasis words twice the size in the accent colour. The kinetic-words template is a starting point.

## Light leaks and film burns
2–3 large radial-gradient ellipses (#FF7A1A, #FF3D6E, #FFD27A, alpha fading to 0 at the edge) drifting across in 1–2 s; put the graphic on the top track with blend screen; opacity peaking at 70% on a cut. A light-leak texture from the library with blend screen does the same.

## Glitch (on cuts and titles, 2–4 frames)
4–6 horizontal rectangles of random height (0.02–0.1 of the frame), shifted ±5% for 1–2 frames each, in the accent colour, cyan and magenta at 60%. On a clip: duplicate it above, offset x by 8 px, tinted (color temperature), for 2 frames.

## Shape transitions
Full-frame shapes (panels, circles, stripes, blocks) cover the frame by the middle and leave on the other side; the last colour matches the next scene's background. Use the transition templates with atCutMs. Liquid versions: 2–3 blob paths (8–12 points) growing from a corner, colours offset 60 ms.

## Parallax slideshow
Three depths per slide, all panning the same way over 3–4 s: a blurred background photo (blur 0.3) drifting slowly, a photo card in the middle (frame radius 16, shadow 0.5) moving twice as fast, text in front three times as fast. Change slides with a 350 ms slide transition.

## Callouts and HUD
- Callout: dot pops (150 ms) → leader line draws (250 ms) → label wipes in (200 ms), text 3 frames later.
- HUD: 2–3 concentric dashed rings rotating at different speeds (rotation keys: +20°/s and −35°/s), a counter ticking, a mono label; accent lines as corner brackets.

## Social frames
A generic post card (rounded rect, circle avatar, two text lines, simple icon row — never real platform logos) with the clip inside (frame radius 24). The subscribe template for calls to action.

## Logo reveal
The logo's outline as path layers drawing on (800 ms), the filled copy fading in (200 ms), a settle from scale 1.05 → 1 (300 ms), a glow peaking on the settle, a whoosh and a hit.

## Checks
- Pause on any frame mid-animation: does it still look composed?
- Is anything moving linearly that should ease? Is anything arriving without a supporting shape?
- Is text readable at its hold, and does the exit happen faster than the entrance?
`,
};
