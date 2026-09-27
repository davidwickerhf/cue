/**
 * How agents design motion graphics in Cue (get_guide {topic: "motion"}):
 * the spec format, what makes motion look professional, and ready patterns.
 */
export const MOTION_GUIDE = `# Motion graphics in Cue

Cue plays Lottie animations (the format After Effects exports) as media. You can make your own with create_motion_graphic, from a template (list_motion_templates) or from a spec you write. Both become media on a picture track that can be moved, scaled, keyframed, faded, graded and edited like video. Change a made graphic later with update_motion_graphic (new params merge with the old; a spec replaces it). Always look at the result with render_frame at a few moments (the start of the reveal, the hold, the exit) and fix what looks wrong.

## Workflow
1. Understand the brief: what must the viewer read, in what order, for how long? A lower third needs ~4–6 s, a chart 6–8 s, a transition 0.8–1.4 s.
2. Try a template first (list_motion_templates shows each one's params and an example). Restyle it with theme and colors {accent: "#…"} to match the user's brand.
3. When no template fits, write a spec. Start from get_motion_graphic on a template-made graphic to see a complete working spec, then change it.
4. Place it: trackId/startMs, or atCutMs for transitions (their "cut" marker lands on the cut, and the frame is fully covered then, so the edit underneath is hidden).
5. render_frame, adjust, repeat. Keep text inside the safe area (7.5% margins). render_frame shows the viewer at its size on screen, so small parts (a button, a pin, a label) are hard to judge: zoom in by scaling the clip, e.g. update_clip {transform: {scale: 3, x: 0.5 - 3 × (px - 0.5), y: 0.5 - 3 × (py - 0.5)}} centres the point px, py (shares of the frame), then set transform back to {scale: 1, x: 0.5, y: 0.5}.

## The spec
{ width, height, fps (default: the project's), durationMs, background?: "#hex", markers?: [{name, atMs, durationMs}], layers: [...] }
Layers are listed bottom to top. Positions are canvas pixels (x right, y down), times ms, colours "#rrggbb" or "#rrggbbaa".

Every layer: name, x, y, scale (1 = 100%, or [sx, sy]), rotation (degrees), opacity (0–1), startMs/endMs (when it exists),
  enter / exit: a preset or a list: {preset, atMs, durationMs?, ease?, amount?}
    presets: fade | rise | fall (amount px) | slideLeft | slideRight (amount px) | grow (from scale amount, default 0; rects grow from their origin edge) | pop (scale from amount, default 0.6, with overshoot) | draw (strokes and arcs trace on) | type (text types in/out) | blur (from amount px) | spin (from amount degrees)
  keys: {x, y, scale, scaleX, scaleY, rotation, opacity, width, height (rects), trimStart, trimEnd (0–1, strokes), color (fill, or stroke when there is no fill), blur}: [[ms, value, ease?], …]; the ease applies from that key to the next. Keys and presets on the same property combine when their times do not overlap (pop in with a preset, then press with scale keys later); where they overlap, the keys win.
  follow: {line: "Route" (a line layer's name) or points: [[x, y], …], smooth?, atMs, durationMs, ease? (default inOutCubic), orient?} — travels along a route (sets x and y, and rotation with orient). Give it the same timing and ease as the line's draw and it rides the tip as the line draws.
  clip: {x, y, width, height}: only that canvas rectangle shows (a track matte) — text that rises out of a line.
  shadow: {color, opacity, distance, blur, angle}; blur: px; blend: normal | multiply | screen | overlay | add | darken | lighten.
Types:
  rect {width, height, radius?, origin?: center | left | right | top | bottom | top-left …, fill?, stroke?, strokeWidth?, gradient?, dash?}
  ellipse {width, height, fill?, stroke?, gradient?}
  arc {radius, thickness, from, to (turns 0–1 from 12 o'clock, clockwise), color, cap?: round | butt} — donuts, progress rings; "draw" sweeps it.
  line {points: [[x, y], …], stroke, strokeWidth, cap?, smooth?, closed?, fill?, dash?: [dash, gap]} — "draw" traces it. dash [0.1, 20] with cap round makes a dotted line.
  path {d: SVG path data (M L H V C S Q A Z, absolute or relative), fill?, stroke?} — icons, logos, arrows, pins. With x, y set, the path is drawn around that point and scales and turns around it; draw icons around 0, 0 and place them with x, y (and size them with scale).
  text {text (\\n for lines), font: sans | display | serif | mono, weight (sans 400/600/800, display 500/700, serif 400, mono 500), size, color, align, tracking (px), lineHeight, uppercase, anchor: middle (default) | top | baseline,
        runs?: [{text, color?, weight?, font?, keys?, enter?, exit?, startMs?}] — one line in parts on one baseline: an accent word or full stop, a bold label then a light title, words that pop in one by one. The layer's text is ignored; its size, tracking, align and motion apply to all.
        count?: {from, to, atMs, durationMs, decimals?, prefix?, suffix?, separator?, ease?} — a number counting up}
        x is the left edge, centre or right edge (align); y the vertical middle (anchor). Text scales and turns around x, y.
        create_motion_graphic and get_motion_graphic return textBoxes: each text layer's left, top, right and bottom on the canvas. Use them to fit a box, an underline or an icon to the words instead of guessing widths.
  image {src: a file path or data URL, width, height}
  group {layers: [...], pivot?: [x, y]} — moves, fades and scales its layers together; set pivot to the middle of what it holds (default: the canvas centre) so it scales and turns around that. A group is clipped to the canvas, so to cover the whole frame with turned shapes, turn each shape instead of the group.
  To change a layer (a label that becomes another word), end one layer with endMs and start the next with startMs at the same moment.
  gradient: {kind: linear | radial, from: [x, y], to: [x, y] (relative to the shape's centre), stops: [[0, "#…"], [1, "#…"]]}
Eases: linear, ease, in, out, inOut, outCubic, inCubic, inOutCubic, outQuint, outExpo, inExpo, inOutExpo, outBack, inBack, inOutBack, hold, or [x1, y1, x2, y2].
Markers: "outro" at the start of the exit makes longer clips hold before it and play it as the clip ends; "cut" marks the covered moment of a transition.

## What makes it look professional
- Ease everything. Entrances decelerate (outExpo, outQuint, outCubic); exits accelerate (inCubic, inExpo); nothing important moves linearly. Overshoot (outBack, pop) only on small accents.
- Stagger related elements 60–120 ms apart (lines of a title, bars, list items) instead of moving them together. Reveal in reading order.
- Durations: small moves 300–500 ms, entrances 600–900 ms, big frame-filling moves 900–1400 ms. Hold readable text at least 1 s per 3 words.
- Motion with a reason: text rises out of a line (clip), rules draw, numbers count, bars grow from their baseline. Avoid spinning or bouncing text.
- Few colours: a background, a surface, text, a muted grey and one accent (a second only to distinguish data). Keep contrast high for text.
- Type: one family for headlines, one for text; big contrast in size (headline 2–3× the body). Uppercase with tracking for small labels.
- Leave room: 7.5% margins, align to a few edges, and keep lower thirds in the bottom third.
- Exit as carefully as you enter, faster (about 60% of the entrance time), and with an "outro" marker so the graphic can hold.
- Data: label every number with its unit, round sensibly, cite the source, and highlight the one bar or slice the story is about.

## Patterns
- Lower third: accent bar grows (rect, origin bottom, grow) → panel grows from the left (origin left, grow) → name rises inside a clip rect → role slides in → outro reverses.
- Kinetic title: each line a text layer with a clip rect exactly around its line and enter rise with amount = line height, staggered 110 ms; a rule that draws under it.
- Transition: full-frame rects or circles that cover the frame by the middle ("cut" marker) and leave on the other side; stagger 2–3 layers in the theme colours. Place with atCutMs.
- Counter: text with count {from 0, to value, durationMs 1200–1600, ease outExpo} plus a label under it.
- Chart: axis or baseline draws first, then bars (rect origin left/bottom with width/height keys from 0) staggered, each with a counting value that travels with the bar end.
- Callout: dot pops at the target, a line draws to the label, the label box grows and the text rises inside it.
- Logo sting: path layers (from the SVG logo) that draw (stroke) then fill in (fade a filled copy), with a soft glow ellipse behind.
- Button click (subscribe, follow, "try it"): a pill (rect with radius = height / 2) pops in; a cursor (path "M 0 0 L 0 38 L 10 29 L 17 44 L 24 41 L 17 26 L 30 26 Z", white with a dark stroke, its tip at x, y) glides in with x and y keys (outCubic); on the click the pill presses (scale keys 1 → 0.94 → 1 with outBack), a ring grows and fades from the tip, the colour changes (color keys) and the label swaps (endMs / startMs). Fit the pill to the label's textBox. Or use the subscribe template.
- Slam text: each word scales from about 2.4 to 1 in 250–300 ms (outExpo) while its blur goes from 30 to 0 and its opacity from 0 to 1 in 50 ms; a full-frame accent rect flashes to 0.15 opacity and back; a group around the words shakes on x (±15 px over 150 ms) on each hit. Stagger the words 400–600 ms. Or use the kinetic-words template.
- Map route: a dark background with faint dashed gridlines, a radial vignette, two pins (path "M 0 0 C -6 -14 -24 -26 -24 -44 A 24 24 0 1 1 24 -44 C 24 -26 6 -14 0 0 Z" with its point at x, y, and a small circle in the background colour at y - 44 for the hole) that pop in, a dotted line between them that draws, and a dot that follows the line; name labels rise under the pins. Or use the route-map template.
- Progress: a row of rounded track rects (the text colour at 25% opacity) with filled rects over them whose width keys grow from 0 (origin left); the label in runs (bold accent label, then the title). Or use the progress-bar template.
`;
