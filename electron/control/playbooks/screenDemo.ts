import type { Playbook } from "./index";

export const SCREEN_DEMO: Playbook = {
	id: "screen-recording-demo",
	name: "Screen-recording demo (app walkthroughs, tutorials, assignment videos)",
	category: "style",
	summary:
		"Turning a raw screen recording and a voiceover into a clear, paced demo: read the recording's activity instead of its frames, cut dead time, zoom to what matters, sound on every action, a quiet bed.",
	useWhen:
		"A video built from a screen recording: product demos, software tutorials, course and assignment videos, bug reports.",
	body: `# Screen-recording demo

## Read the recording first (don't step through frames)
detect_activity {clipId} returns what happens on screen in timeline time: screen-change (a new page or view), ui-change (a click's result, with its region), scroll (with how far), typing, pointer and idle stretches. It takes seconds for a whole recording. Plan the edit from that list and check only a few moments with render_frame. markers true shows them on the timeline for the user.

## Pace
- Cut or speed up idle stretches (remove_ranges, or speed 2–4 on the part) unless the voiceover needs the time. A demo has no still moments longer than about 1.5 s without a reason.
- Long typing: speed it up (2–4×) or cut to the result. Long scrolls: speed up the middle.
- Let the narration lead: each line explains what the viewer is about to see; the action lands on or just after the words that name it. If a take runs long, make room (ripple_from) rather than squeezing the picture.

## Guide the eye
- Zoom (add_zoom) toward the region of each ui-change that is small on screen (a button, a field, a result card): in 400–600 ms before the click, hold while it's discussed, out on the next screen-change. Don't zoom on every click: the ones the narration talks about.
- Keep the pointer visible; a pointer event before a ui-change is where the click happened.
- Titles for sections (screen-change is a natural place), short captions or labels for results that matter (a score, a recommendation).

## Sound
- A soft tick (sfx-tick) 60–100 ms before each ui-change the viewer should notice; a pop (sfx-pop) as a result appears; a soft whoosh (sfx-whoosh-soft) under scrolls and zooms; a title chime (sfx-chime) at the start. Keep them 12–18 dB under the voice and vary them.
- A quiet music bed: generate_music {mood: "calm"} (or "lofi") for the edit's length; it ducks under the voice. Or find_music for a licensed track, and credit it.
- The recording's own sound (the app, a draft narration) usually goes: volume 0 on the screen clip, or detach_audio and mute. Check nothing else speaks under the voiceover.
- Takes recorded on a laptop mic are levelled when saved; level_take raises older quiet ones. Finish with auto_mix and check about -16 LUFS.

## Check
review_edit and inspect_edit at the end; watch the zooms and cuts once through (play), and listen for sound effects that land late or early.`,
};
