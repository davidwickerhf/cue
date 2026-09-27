import type { Playbook } from "./index";

const style = (p: Omit<Playbook, "category">): Playbook => ({ ...p, category: "style" });

export const OTHER_STYLES: Playbook[] = [
	style({
		id: "map-documentary",
		name: "Map documentary (Johnny Harris)",
		summary:
			"Vox DNA pushed further: maps with drawn routes and pins, a presenter at a desk, hard cuts with punch-ins, stepped graphics.",
		useWhen: "Geography, travel, borders, history of places, investigations with locations.",
		body: `# Map documentary

- Shape: aerial or globe establishing shot (2–3 s) → a map with a route drawing at 12 fps → a pin and label → a punch-in on a document → hard cut to the presenter speaking to camera. Few dissolves.
- Punch-ins jump: scale keyframes 1.0 → 1.3 with ease hold on a narration beat (an instant jump, not a zoom).
- Maps: a period map or a clean paper map (scans, or Natural Earth, public domain) on paper texture; the route-map template, or line layers with the draw preset (1.5–3 s, linear feels like travel), stepFps 12; pins pop (scale 0 → 1.1 → 1 in 300 ms) with location-tag labels; regions fill in the accent colour at 50% after their outline draws.
- Follow the route: keyframe the map clip's x/y opposite to the route so the head of the line stays near the centre.
- Look: warm desaturated grade (saturation 0.8, temperature +0.05), grain 0.3, vignette 0.3, paper under maps.
- Everything else as in vox-explainer (cut-outs, marks, source tags, sound).`,
	}),
	style({
		id: "flat-vector-explainer",
		name: "Flat vector explainer (Kurzgesagt)",
		summary:
			"Rounded geometric vector scenes, rich saturated palettes on deep backgrounds, constant ambient motion, zoom-through transitions.",
		useWhen: "Science and big-picture explainers illustrated entirely with vector graphics.",
		body: `# Flat vector explainer

- Background: a vertical gradient from #1B1640 to #2A2360 (rect with gradient) and 30–60 small dots drifting at three speeds (0.3×, 0.6×, 1×) for depth.
- Objects: simple rounded shapes (rect radius, ellipse, path), two flat tones plus one lighter highlight shape towards the light; saturated accents (pink #FF4D8D, cyan #34D5FF, orange #FF9F43).
- Entrances: scale 0 → 1.08 → 1 over 400 ms (pop preset or outBack). Idle motion on everything: y ±4 px sine over 2–3 s (keys looping, or wiggle on the clip).
- Transitions: zoom through an object into the next scene (scale 1 → 8 with ease-in over 700 ms on the old scene; the new one scale 0.3 → 1 ease-out), or a push.
- Text is rare and bold (sans 800, rounded shapes around it); the narration carries the information.
- No textures, no grain: the look is clean. Build each scene as one motion graphic spec (groups for objects).`,
	}),
	style({
		id: "tech-review",
		name: "Tech review (MKBHD)",
		summary:
			"Clean studio look, product B-roll on sliders and turntables, spec cards, measured rhythm of talking head and B-roll.",
		useWhen: "Product reviews, unboxings, comparisons.",
		body: `# Tech review

- Rhythm (measured on MKBHD): about 7 cuts a minute, shots 5.5–6.5 s; talking head and B-roll alternate every 20–40 s; the hook peaks at 10–14 cuts in the first 30 s; one long unbroken verdict (30–55 s) near the end; speech ends 4–6 s before the last frame.
- Product B-roll: 3–5 s each with a slow push or slide (x keyframes); speed_ramp 100% → 20% on the reveal (outIn).
- Spec card: white rounded card (frame radius 24, shadow) on the right third, at most 4 bullets, sans 44 px, sliding in over 250 ms.
- Small black source tags on borrowed clips (source-tag). No burned-in captions, no split screens.
- Grade: contrast 1.1, saturation 0.95, neutral; one brand accent colour. A lo-fi or electronic bed under the voice.`,
	}),
	style({
		id: "captions-talking-head",
		name: "Captions-heavy talking head (Hormozi, Ali Abdaal)",
		summary:
			"Short-form talking head with word-by-word captions, one highlighted word per beat, jump cuts and punch-ins.",
		useWhen: "Shorts, Reels, TikToks and clips of someone speaking to camera.",
		body: `# Captions-heavy talking head

- Cut every pause (remove_silence; remove_filler_words unless the tone is casual).
- Alternate framing on each cut: scale 1.0 and 1.15 with x ±0.02 (set_keyframe or transform), so jump cuts look intentional.
- Captions: auto_captions with wordStyle pop; bold condensed sans in capitals, white with a heavy dark outline, 80–120 px (10–15% of the height), at y 0.60–0.70, 1–3 words at a time, 200–500 ms per word; one keyword per beat in yellow #FFD93D or green #39FF14. No bounce or fade: words snap.
- The payoff in the first 2.5 s; the visual changes every 3–8 s (B-roll, an emoji or graphic popping in at 0.3 × 0.3 of the frame on keywords, a punch-in).
- A pop sound on each punch-in; music low.
- Vertical 1080 × 1920: reframe and follow_faces; keep 15% top and 20% bottom clear of text.`,
	}),
	style({
		id: "product-film",
		name: "Product film (Apple)",
		summary:
			"Restraint: a void, macro product shots with light sweeps, big clean words revealed one by one, music builds.",
		useWhen: "Launch videos, brand films, anything premium and minimal.",
		body: `# Product film

- Type: sans 700–800 at 120–180 px, centred, tight tracking; each word rises from behind a line (masked reveal: rise with clip, 500–700 ms, bezier 0.2 0 0 1), words 80–120 ms apart; white on black or black on white.
- Product shots 3–4 s, push-in 1.0 → 1.05 with a long ease; a light sweep across (a gradient rect in a motion graphic moving over 1 s, blend screen).
- Cuts on the music's builds; dips to black of 200 ms between chapters.
- End card: the logo only, 2 s. Nothing decorative that doesn't serve the product.`,
	}),
	style({
		id: "true-crime",
		name: "True-crime documentary",
		summary:
			"Restraint and dread: a dark cool grade, slow pushes, evidence and maps timed to facts, silence as a weapon.",
		useWhen: "Investigations, crime and mystery stories, serious documentaries.",
		body: `# True-crime documentary

- Grade from the first seconds: contrast 1.15, saturation 0.7, temperature −0.1 (cool, teal), vignette 0.4, grain 0.2.
- Interviews: an imperceptible push 1.0 → 1.06 over 20–40 s.
- Documents: a slow drift at scale 1.8 across a report; names redacted (a black bar, add_overlay redact, or a rect that grows); the key phrase gets a thin red underline, not a yellow highlighter.
- Evidence board: polaroids (frame templates), pins and red string (a line between two points, drawn).
- Dates in mono in a corner, typed on ("MARCH 14, 2003 — 11:42 PM", type preset).
- Title cards: white serif on black, fading over 800 ms.
- Music: a drone bed; cut to silence a second before a reveal; a low boom on reveal cards.`,
	}),
	style({
		id: "video-essay",
		name: "Video essay (Every Frame a Painting, Nerdwriter)",
		summary:
			"An argument read over film clips as evidence: side-by-side comparisons, freeze frames with drawn lines, patient pacing.",
		useWhen: "Analysis of films, art, design or media.",
		body: `# Video essay

- Clips of 3–8 s chosen as evidence. For a key moment, duck the narration and let the clip's own sound play 1–3 s.
- Comparisons: arrange_clips side by side, each 0.48 of the width with a 0.02 gap on black, a small white title with the film and year above each.
- Freeze frame (freeze_frame, 2–3 s), then draw on it: composition lines, eyelines, circles (annotation templates in white or the accent).
- Chapter titles: white sans on black, 1.5 s. Film titles in small italic at the bottom left of each clip.
- Pacing is patient; re-edit until each point is proved by what is on screen.`,
	}),
	style({
		id: "news-package",
		name: "TV news package and breaking news",
		summary:
			"Reporter voice over B-roll, sound bites, a stand-up and a sign-off; lower thirds, banners and tickers.",
		useWhen: "News-style reports, announcements, breaking updates.",
		body: `# News package

- Structure (1:15–2:00): natural sound open (2–3 s) → voice over B-roll → sound bite (8–15 s) → voice → reporter stand-up (10–15 s) → second sound bite → voice close → sign-off.
- Every speaker gets a lower third (lower-third template): a bar low in the frame, name 44 px bold, role 30 px, sliding in over 300 ms, held 4 s.
- Breaking: a red #C8102E bar along the bottom (0.09 of the height) with BREAKING NEWS in white bold italic, wiped on in 250 ms with a two-frame white flash and a sting; a ticker crawling at about 120 px/s (a text layer with linear x keys).
- B-roll with its natural sound only; a live bug and a clock in a top corner for live looks.`,
	}),
	style({
		id: "beat-montage",
		name: "Beat-synced montage (travel, events)",
		summary:
			"Hard cuts on drum hits, the downbeat reserved for reveals, whips and speed ramps tied to the music's intensity.",
		useWhen: "Travel films, event recaps, sports and music-driven montages.",
		body: `# Beat-synced montage

- detect_beats, then beat_montage: a cut every 2 beats in verses, every beat in the chorus, and a hold of 2–4 bars on the best shot at the drop.
- The first beat of a bar is for scene changes and reveals.
- Whip pans with their middle on the beat; match cuts on movement; speed ramps (outIn: fast to slow on the hit) at most once every 8 bars, never back to back.
- One grade for everything (a LUT, copy_grade).
- The place name in wide-tracked sans (+30%) at 60 px, fading in over 600 ms at the start of a phrase.`,
	}),
	style({
		id: "podcast-clip",
		name: "Podcast clip (vertical)",
		summary:
			"9:16 clip of the best moment: the speaker full frame, split screen for back-and-forth, captions in the middle, a hook first.",
		useWhen: "Clips from podcasts and interviews for Shorts, Reels and TikTok.",
		body: `# Podcast clip

- 1080 × 1920 (reframe), faces followed (follow_faces). One strong moment, 20–60 s, with the hook in the first 2 s.
- The speaker full frame during an answer; stacked split screen (arrange_clips, each half face-centred) for back-and-forth — the listener's reaction sells it.
- Captions in the middle 60% (auto_captions at y ≈ 0.5 between the halves, or 0.62 for one speaker). Keep the top 15% and bottom 20% clear.
- A hook title card at the top for the first 3 s. Cut fillers, keep reactions. An optional progress bar (progress-bar template).`,
	}),
	style({
		id: "corporate-explainer",
		name: "Product and corporate explainer",
		summary:
			"Brand-coloured flat shapes, screen recordings in frames, icon-and-text pairs, problem → solution → how it works → call to action.",
		useWhen: "SaaS demos, onboarding and company explainers.",
		body: `# Product explainer

- Arc: problem → solution → how it works (3 steps) → call to action.
- Screen recordings with the studio look (frame radius 24–32, shadow 0.4) on a brand gradient background; zoom to each action (1.6×, 600 ms, add_zoom).
- Icons pop in (0 → 1.1 → 1 over 300 ms), 100 ms apart, each with a short text (sans 600, 56 px, at most 6 words).
- Scene changes: a brand-coloured circle growing from the click point to cover the frame in 400 ms (transition-iris at atCutMs).
- A friendly voice, upbeat music, lower thirds for people, a clear end card with the call to action.`,
	}),
	style({
		id: "vlog",
		name: "Vlog (Casey Neistat)",
		summary:
			"Music-driven, jump-cut, time-lapse openers, sped-up task montages and cutting mid-sentence.",
		useWhen: "Personal vlogs, behind the scenes, day-in-the-life.",
		body: `# Vlog

- Open on a time-lapse (speed 8×, 4–8 s) on music.
- Task montages: 6–12 clips of 0.3–0.8 s each at 2–4× speed, cut on beats.
- Jump cuts everywhere (remove_silence), a punch-in to 1.2× on every other cut.
- Cut mid-sentence on a word boundary, hard to B-roll with the music up.
- Place names in plain white sans or hand-lettered titles. Select brutally: use a third or less of what was filmed.`,
	}),
];
