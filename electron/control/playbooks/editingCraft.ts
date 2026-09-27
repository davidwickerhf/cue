import type { Playbook } from "./index";

export const EDITING_CRAFT: Playbook = {
	id: "editing-craft",
	name: "Editing craft",
	category: "craft",
	summary:
		"The fundamentals professional editors rely on: story, pacing, where to cut, sound, colour, text and the checks before delivery.",
	useWhen: "Read before any edit where quality matters; it applies to every style.",
	body: `# Editing craft

## Story first
- Know the one thing the viewer should take away. Every shot either moves towards it or goes.
- Open with the question or the most striking moment (a cold open); explain after you have attention.
- Structure: hook (first 5–10 s) → setup → development in clear sections → payoff that answers the hook → short ending. Mark sections with markers and, in longer pieces, chapter cards.
- Show, don't tell: when the narrator says a number, show the number; when they name a person, show the person.

## Pacing
- Cut when the viewer has understood the shot, not when it has been on for a fixed time. Information-dense shots hold longer (3–6 s); simple illustrations shorter (1.5–3 s).
- Vary rhythm: a run of quick cuts, then a longer hold to breathe after an important point (1–1.5 s with no new information).
- Something should change on screen every 2–4 s in explainers and social video; documentary and essay can hold 5–10 s on strong material.
- Cut out every pause that isn't doing work (remove_silence), but keep a beat after jokes, reveals and questions.

## Where to cut
- Cut on action: in the middle of a movement, so the eye follows it across the cut.
- Cut on the word: new visuals land 2–3 frames before the word they illustrate, so the eye arrives as the ear hears.
- J and L cuts: let the sound of the next shot start before its picture (J), or the sound of this shot carry over the next picture (L). It makes cuts feel smooth and natural (detach_audio, then trim sound and picture separately).
- Match cuts connect two shots by shape, movement or colour; use them at scene changes.
- Avoid jump cuts inside one shot unless it is a deliberate style (talking-head social video); hide them with a punch-in (scale 1.0 → 1.15) or B-roll.

## Sound is half the picture
- Voice first: clear, consistent level (auto_mix targets it), no clipped peaks.
- Music under speech (−18 to −24 dB below voice); duck it automatically on the voice track. Change or re-cut music at section turns (roughly every 20–40 s); cut music out a beat before a key line and bring it back on the next downbeat.
- Sound effects make graphics physical: a whoosh on a push or slide, a pop or tick on a small element, paper sounds for cut-outs, a typewriter for typed text. Keep them quiet (−18 to −24 LUFS short-term) and vary them.
- Room tone under cuts in dialogue, so silence never drops to digital zero.

## Colour and look
- One look per video: a consistent grade (copy_grade), the same fonts, one accent colour.
- Archive and mixed sources: grade them together (desaturate a little, warm or cool them the same way) so they belong to one film.
- Texture (grain, paper) and a subtle vignette on an adjustment layer make mixed material feel of a piece.

## Text on screen
- As few words as possible; the voice carries the information.
- Hold time: at least 1.5 s plus 0.3 s per word; longer for numbers people must remember.
- Inside the title-safe area (7.5% margins); never over faces; high contrast (add a box or shadow over busy pictures).
- One font family for headlines and one for text; big size contrast; small labels in uppercase with tracking.

## Motion
- Ease everything: things arrive fast and settle (ease-out), leave by accelerating (ease-in).
- Nothing is ever completely still in a designed video: stills drift (Ken Burns 1.00 → 1.08 over the shot).
- Stagger related elements 60–120 ms apart instead of moving them together.

## Before delivery
- Watch it through once without stopping, at normal speed, with sound.
- Check the first and last frames, every text for typos and hold time, every name and number against the source.
- Loudness: about −14 LUFS for online video (measure_loudness), no clipping.
- Export at the canvas's size and frame rate; check the file plays from the start.
`,
};
