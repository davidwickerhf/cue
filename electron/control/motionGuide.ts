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
5. render_frame, adjust, repeat. Keep text inside the safe area (7.5% margins).

## The spec
{ width, height, fps (default: the project's), durationMs, background?: "#hex", markers?: [{name, atMs, durationMs}], layers: [...] }
Layers are listed bottom to top. Positions are canvas pixels (x right, y down), times ms, colours "#rrggbb" or "#rrggbbaa".

Every layer: name, x, y, scale (1 = 100%, or [sx, sy]), rotation (degrees), opacity (0–1), startMs/endMs (when it exists),
  enter / exit: a preset or a list: {preset, atMs, durationMs?, ease?, amount?}
    presets: fade | rise | fall (amount px) | slideLeft | slideRight (amount px) | grow (from scale amount, default 0; rects grow from their origin edge) | pop (scale from amount, default 0.6, with overshoot) | draw (strokes and arcs trace on) | type (text types in/out) | blur (from amount px) | spin (from amount degrees)
  keys: {x, y, scale, scaleX, scaleY, rotation, opacity, width, height (rects), trimStart, trimEnd (0–1, strokes), color, blur}: [[ms, value, ease?], …]; the ease applies from that key to the next. Keys override presets on the same property.
  clip: {x, y, width, height}: only that canvas rectangle shows (a track matte) — text that rises out of a line.
  shadow: {color, opacity, distance, blur, angle}; blur: px; blend: normal | multiply | screen | overlay | add | darken | lighten.
Types:
  rect {width, height, radius?, origin?: center | left | right | top | bottom | top-left …, fill?, stroke?, strokeWidth?, gradient?, dash?}
  ellipse {width, height, fill?, stroke?, gradient?}
  arc {radius, thickness, from, to (turns 0–1 from 12 o'clock, clockwise), color, cap?: round | butt} — donuts, progress rings; "draw" sweeps it.
  line {points: [[x, y], …], stroke, strokeWidth, cap?, smooth?, closed?, fill?, dash?} — "draw" traces it.
  path {d: SVG path data (M L H V C S Q Z), fill?, stroke?} — icons, logos, arrows.
  text {text (\\n for lines), font: sans | display | serif | mono, weight (sans 400/600/800, display 500/700, serif 400, mono 500), size, color, align, tracking (px), lineHeight, uppercase, anchor: middle (default) | top | baseline,
        count?: {from, to, atMs, durationMs, decimals?, prefix?, suffix?, separator?, ease?} — a number counting up}
  image {src: a file path or data URL, width, height}
  group {layers: [...], pivot?: [x, y]} — moves, fades and scales its layers together. A group is clipped to the canvas, so to cover the whole frame with turned shapes, turn each shape instead of the group.
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
`;
