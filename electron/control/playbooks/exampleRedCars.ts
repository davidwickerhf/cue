import type { Playbook } from "./index";

export const EXAMPLE_RED_CARS: Playbook = {
	id: "example-the-red-cars",
	name: 'Worked example: "The Red Cars" in the style of Hoog',
	category: "example",
	summary:
		"A 3½-minute archive history documentary built in Cue from public domain and open-licence material: the measurements, the script and voices, how every cut is anchored to a word, each scene's layers, the score, and what two passes found.",
	useWhen:
		"Before building a history, city or investigation documentary, or any video over two minutes with many archive sources; read 'before-your-first-pass' with it.",
	body: `# Worked example: "The Red Cars"

A 217 s, 1920×960 remake in the style of Hoog's "How One Company Turned LA Into A Dystopia" (youtube.com/watch?v=M0Hv7nxmS2I), made with Cue's tools as a test of how well an agent can recreate a documentary style. The subject and the editing style are Hoog's; the script, voices, graphics, music and choice of archive are new, and the end card credits Hoog. Shown on cue.wicker.life/examples with the project to download.

## The reference, measured
analyze_reference on the 19-minute original: 2:1 frame, 24 fps, median shot 3.3 s, 10.9 cuts a minute (bursts of 5–8 per 10 s in montages, none during long map moves), black about half of every frame, 56% black and white, -16.2 LUFS. Its contact sheets gave five picture families: warm saturated film archive, glowing line maps on black, lamp-lit tabletop evidence, black-and-white newsreel, and modern aerials.

## Script and voices
473 words in 16 lines: ten narrator passages (P01–P11, one per section, voice "onyx", one instruction for all of them with "a clear pause after every sentence"), a records reader (R01–R03, voice "ash", track EQ low -12 mid +6 high -9, compressor 0.6) for the case and the fines, and a period announcer (A01, A02, voices "fable" and "verse", EQ low -12 mid +9 high -12, compressor 0.8) tagged DRAMATISATION on screen. Lines are laid out with pauses before each (1.2 s before the first, 3.6 s after the cold open for the title, 2 s before the freeways). Every take was transcribed and read against the script; one had dropped its last sentence and was regenerated.

## Timing
A word index (per line, word times relative to the line start) gives every anchor: the cut to the Watts photo lands 120 ms before "But a century", the map grows until "40 years", the stamp lands on "convicted", the Long Beach line fades on "last to close". The build is a script of calls computed from anchors; a new take means re-running the layout, not re-timing by hand.

## Tracks (top to bottom)
Flashes and marks (V3) · overlays: the steps, company cards, fines, the cut-out (V2) · labels and year stamps (T1) · pictures and full-frame graphics (V1) · narrator · score · records voice · announcer · effects and room tone.

## Scenes (sections)
1. Cold open: NASA night photo of the basin, drone freeway shots with a punch-in on "slowest"; a flash, then the 1906 Watts photo, 1916 Broadway, and the 1957 colour Red Car on "painted red"; a riser into the title card on black with a red glow.
2. Rise: a model Red Car still with a big "1901"; Huntington's portrait at scale 1 on black with his name typed beside it; the PE Building panned top to bottom; the train cut out (cut_out, colour grade only) on a red-glow stage, sliding off on "trains"; steps (Buy farmland / Run a line to it / Sell it as a town) over a generated plat map, each on its word; the 1912 real-estate newspaper map with a red underline and a box on a Red Car line; Long Beach 1902, then 1916 shops and bungalows, a 1922 Hollywood car.
3. Peak: the network map (line layers drawn from real stop coordinates, each doubled with a blurred copy for the glow, a mileage counter to 1,100) grows over 13 s; a fast version fades to dim on "within 40 years".
4. Decline: the announcer over GM's 1954 freeway film and a 1959 freeway film; 1922 traffic photos, a red box drawing on the streetcar stuck in traffic on "stuck behind them"; the 1957 film's waiting riders and empty tracks.
5. The turn: silence and a thud on "Then came a buyer." over a lamp-lit desk; a US map with lines from a Chicago HQ box to eleven cities; GM's film title; a dark bus depot with the three companies and what each sold appearing on their words; "1945" over the 1916 tunnel streetcar.
6. The case: a typed case file (a reconstruction, tagged) whose charge types as it's read, stamped GUILTY on "convicted"; $5,000 over cash, then $1 over a single bill, each with a hit and a held silence on room tone.
7. Freeways: the 1956 scrapyard wide, then punched in; a 1955 last-day photo; freeway construction in 1948 and 1946; the Cahuenga Pass today.
8. Last run: the network fading line by line with a year counter, the Long Beach line last, on "last to close".
9. Return: an 80s promo card (tagged DRAMATISATION); the Blue Line opening in 1990 with a year stamp; Metro today; a Metro map drawing six coloured lines over the ghost of the old network on "line by line".
10. Close: downtown at night, the NASA night photo pulling out, the end card crediting Hoog.

## Archive
Every film in-point was checked frame by frame (two first-pass in-points landed on 1916 caption cards). The 14 film segments used were cut with handles and restored (hqdn3d 2:1.5:5:4, lanczos to 1440×1080, unsharp 5:5:0.7) before import. Grades: colour film temperature 0.45, saturation 1.4, contrast 1.32, grain 0.35; black and white saturation 0, contrast 1.3, grain 0.4; modern saturation 1.15, temperature -0.08. Labels ("Place · year") in Menlo caps on a translucent black backing.

## Sound
One score file built with ffmpeg from three original stems (a D-minor drone, a heartbeat pulse, a D-major lift) with crossfades at the story beats; 40 library effects; room tone under everything; auto_mix to -16 LUFS dialogue with the score about 8 dB under. Export: -16.4 LUFS, LRA 3.3.

## Sources (26)
Public domain: A Visitor to Los Angeles (1916), Hollywood Snapshots (1922), Into the Future (1922), The Towers (1957), Give Yourself the Green Light (GM, 1954), Freeway Driving (c. 1959), pre-1929 photographs and the 1912 Evening Herald map, 1955 and 1990 photos released by California agencies, NASA night photos. CC BY / BY-SA: the 1956 scrapyard, 1946 and 1948 freeway construction (Los Angeles Times / UCLA), a 2021 drone film, Metro photos from Commons, with the credit lines in the project's README. Tabletop stills: generated.

## What went wrong, so you don't repeat it
Read 'before-your-first-pass': it was written from this build. The short version: the first pass was one photo per sentence with line-by-line voice takes and separate music clips, and was judged much weaker than the Vox example; the second pass voiced whole passages, anchored every cut to a word, layered every scene, restored the archive and made one score. The export also exposed Cue bugs (thread exhaustion with 186 inputs, animated text timing, the hardware encoder, the bridge driving the installed app); they are fixed and listed in docs/notes/the-red-cars-build.md.`,
};
