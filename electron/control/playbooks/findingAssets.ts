import type { Playbook } from "./index";

export const FINDING_ASSETS: Playbook = {
	id: "finding-assets",
	name: "Finding assets: library, generated, and openly licensed",
	category: "workflow",
	summary:
		"Where to get anything an edit needs (footage, stills, textures, sound effects, music, voices) in the order that works, and the licence rules that keep a video publishable.",
	useWhen:
		"Whenever an edit needs a picture, a clip, a sound or music the project doesn't have. Never tell the user an asset is missing before trying these.",
	body: `# Finding assets

Work down this list; stop at the first that gives what the edit needs.

1. **The project's own media.** search_shots finds moments by what they show or say ('whiteboard', 'a dog on a beach', the word 'pricing' on a slide); find_moments by meaning in the transcript. The best B-roll is often already recorded.
2. **Cue's library.** list_library_assets {category or query}: stock clips (city, nature, people, work), paper and cardboard boards, film dust, light leaks, halftone, vignette, and sound effects (whooshes, pops, ticks, paper, typewriter, shutter, risers, impacts, chime, room tone). import_library_asset places them with their blend and loops them.
3. **Generate.** generate_image for stills that don't need to be real: backgrounds, tabletop 'evidence' scenes, illustrations, title plates (describe light, lens and mood; no readable text in the picture). generate_music {mood} for a bed made to measure. generate_take / generate_voiceover for voices (several voices for a documentary). create_motion_graphic for anything graphic: charts, maps, titles, icons.
4. **Find openly licensed material.** find_media {query, kind: image|video} (Openverse images from Flickr, museums and Wikimedia; Wikimedia Commons photos and video), find_music {query}. Only CC0, public domain, CC BY and CC BY-SA come back, each with its credit line; import_found / import_music bring them in with the credit kept on the media.
5. **Archives you can fetch yourself** (when you have a shell or the user asks for historical material): the Prelinger Archives and other public domain films on archive.org, the Library of Congress (items marked 'no known restrictions'), NASA (public domain), national archives. Check each item's own rights statement, not a search page's.

## Licences
- Usable in any video: CC0, public domain, CC BY, CC BY-SA (credit the creator, name the licence, link the source; for BY-SA note the licence of the video itself if it is shared as a whole).
- Not usable: NonCommercial (NC) or NoDerivatives (ND) licences, anything without a licence, 'free to use' stock-site licences unless the user accepts their terms, and anything from YouTube or social media unless it is the user's own.
- Keep every credit line: the media's credit, and a sources list in the project's README when you package_project.
- AI-generated stills and music are the user's; say what is generated when it could be mistaken for real archive.

## Quality
- Footage at least as tall as the edit (1080 lines for 1080p); upscale old or small footage only for archive looks, and restore it (see 'before-your-first-pass').
- Look at every picture before using it (render_frame after placing): watermarks, text, the wrong subject, anything offensive.
- Match colour and grain to the rest of the edit (copy_grade, an adjustment layer).`,
};
