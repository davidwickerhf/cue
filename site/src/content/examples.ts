import { REPO } from "@/lib/site";

export type Example = {
	slug: string;
	title: string;
	/** One line for cards and metadata. */
	summary: string;
	/** The style it recreates, and the playbook agents read for it. */
	style: string;
	/** The video it recreates, credited on the page. */
	original?: { title: string; by: string; href: string; note: string };
	playbook: string;
	durationS: number;
	/** In public/examples: <slug>.mp4 (720p) and <slug>.jpg. */
	video: string;
	poster: string;
	/** Full quality video and the packaged project (with all its media), on GitHub. */
	fullVideo: string;
	project: { url: string; sizeMb: number };
	/** How it was built, in order. */
	steps: { title: string; body: string }[];
	/** Paste into Claude Code, Codex, Gemini CLI or any MCP client connected to Cue. */
	prompt: string;
	credits: { label: string; href: string; licence: string }[];
	numbers: { label: string; value: string }[];
};

const ASSETS = `${REPO}/releases/download/examples`;

export const EXAMPLES: Example[] = [
	{
		slug: "why-we-say-ok",
		title: "Why we say OK",
		summary:
			"A 73-second remake of Vox's explainer \u201cWhy we say OK\u201d, made in Cue by an agent as a test of the editor: archive film, cut-outs on red, newspaper clippings with hand-drawn marks, a map, grain and sound, all from public domain sources.",
		style: "Vox-style explainer",
		original: {
			title: "Why we say \u201cOK\u201d",
			by: "Vox",
			href: "https://www.youtube.com/watch?v=1UnIDL-eHOs",
			note: "The original explainer is by Vox. We made this remake as a test: could an agent working in Cue recreate the way Vox edits (the archive cut-outs, the paper, the marks, the pacing) from its own script and public domain material? The idea, the story and the style are Vox's; the material and the build are new.",
		},
		playbook: "vox-explainer",
		durationS: 73.5,
		video: "/examples/why-we-say-ok.mp4",
		poster: "/examples/why-we-say-ok.jpg",
		fullVideo: `${ASSETS}/why-we-say-ok-1080p.mp4`,
		project: { url: `${ASSETS}/why-we-say-ok-project.zip`, sizeMb: 45 },
		numbers: [
			{ label: "Scenes", value: "14" },
			{ label: "Motion graphics", value: "30" },
			{ label: "Sound effects", value: "40" },
			{ label: "Sources", value: "4 public domain" },
		],
		steps: [
			{
				title: "Measure the reference",
				body: "analyze_reference on the original gave the brief: 17.7 cuts a minute, a median shot of 1.8 s, 83% black and white, paper white and ink covering half the picture, −20.5 LUFS.",
			},
			{
				title: "Script and voice",
				body: "Eight lines of about 150 words, voiced with text-to-speech. Word timings from the transcript drive every mark, so a circle lands two frames before its word.",
			},
			{
				title: "Find what may be used",
				body: "A 1950 telephone film from the Prelinger Archives, an 1845 fashion plate from the Rijksmuseum, Mathew Brady's portrait of Van Buren and an 1827 map of New York: all public domain. Paper, newsprint and sounds come from Cue's library.",
			},
			{
				title: "Cut-outs and archive",
				body: "cut_out lifted the figures and the portrait out with a paper edge and a shadow. The archive film is graded black and white with grain, pushed in slowly, with red OK tags popping next to each caller.",
			},
			{
				title: "Graphics and marks",
				body: "Thirty motion graphics from templates and specs: the clipping, red blocks, circles and underlines that follow the clipping's punch-in, highlighter, leader labels, a location tag, the telegraph and a chat.",
			},
			{
				title: "Texture and sound",
				body: "One adjustment layer adds vignette and grain to everything. Forty effects land on slaps, slams, pushes and marks; an original music bed stops for a beat before \"He lost.\"",
			},
			{
				title: "Check and package",
				body: "render_frame at every scene and mark, an export, then analyze_reference on the export to compare with the reference. package_project made the download below.",
			},
		],
		prompt: `Make a 70–75 second remake of Vox's explainer "Why we say OK" (https://www.youtube.com/watch?v=1UnIDL-eHOs) in Cue. Recreate how Vox edits, not its artwork: use only public domain and CC0 material, credit every source, and credit Vox as the original on the end card.

1. Read Cue's playbooks first: get_playbook "working-in-cue", "vox-explainer" and "example-why-we-say-ok". The last one is this video written down scene by scene: follow it.
2. Create a 1920×1080, 30 fps project. Script (8 lines):
   L1 There is a two-letter word you have probably said today without even thinking about it.
   L2 OK. It might be the most widely understood word on the planet. And it started as a joke.
   L3 In March 1839, the Boston Morning Post printed a strange little abbreviation: o. k., all correct.
   L4 Spelled wrong on purpose: oll korrect. Papers at the time were full of joke abbreviations like that, K C for knuff ced, O W for oll wright.
   L5 Almost all of them were forgotten within a year. OK was not, thanks to a president.
   L6 Martin Van Buren came from Kinderhook, New York. When he ran for re-election in 1840, his supporters called him Old Kinderhook, and started O.K. clubs.
   L7 He lost. But the word stuck. The telegraph needed a short reply that meant: message received. O K.
   L8 And today it is how we say yes without saying very much at all.
   Generate the voiceover and get word timings with get_transcript.
3. Download and import these public domain sources:
   - https://archive.org/details/WorldAtYourC ("The World at Your Call", 1950): telephone calls, telegraph poles, a switchboard
   - https://commons.wikimedia.org/wiki/File:Journal_des_Marchands_Tailleurs,_juin_1845,_No._97,_RP-P-2009-3238.jpg
   - https://commons.wikimedia.org/wiki/File:Martin_Van_Buren_daguerreotype_by_Mathew_Brady_circa_1849.jpg
   - https://commons.wikimedia.org/wiki/File:1827_Finley_Map_of_New_York_State_-_Geographicus_-_NewYork-finley-1827.jpg
   Use cut_out on the fashion plate and the portrait. Take paper, newsprint and sound effects from list_library_assets.
4. Build it scene by scene as in the example: archive cold open with red OK tags, the big red OK with the people in front, the clipping with marks that follow its punch-in, red blocks with cut-outs, the map push-in, the Old Kinderhook → O.K. type animation, the telegraph, the chat, the end card. Put grain and a vignette over everything with one adjustment layer, sound effects on every landing and push, and a music bed that stops before "He lost".
5. Check every scene and every mark with render_frame. Export to export/why-we-say-ok.mp4 (wait_for the result), look at frames of the file, and run analyze_reference on it: aim for 15–20 cuts a minute, mostly black and white, about −16 LUFS. Fix what is off and export again.
6. package_project with a README listing the sources.`,
		credits: [
			{
				label: "Original video: \u201cWhy we say OK\u201d by Vox (idea, story and editing style)",
				href: "https://www.youtube.com/watch?v=1UnIDL-eHOs",
				licence: "\u00a9 Vox Media, credited as the original",
			},
			{
				label: "The World at Your Call (1950), Prelinger Archives",
				href: "https://archive.org/details/WorldAtYourC",
				licence: "Public domain",
			},
			{
				label: "Journal des Marchands Tailleurs, June 1845 (Rijksmuseum)",
				href: "https://commons.wikimedia.org/wiki/File:Journal_des_Marchands_Tailleurs,_juin_1845,_No._97,_RP-P-2009-3238.jpg",
				licence: "Public domain",
			},
			{
				label: "Martin Van Buren, daguerreotype by Mathew Brady, c. 1849 (Library of Congress)",
				href: "https://commons.wikimedia.org/wiki/File:Martin_Van_Buren_daguerreotype_by_Mathew_Brady_circa_1849.jpg",
				licence: "Public domain",
			},
			{
				label: "A. Finley, Map of New York, 1827",
				href: "https://commons.wikimedia.org/wiki/File:1827_Finley_Map_of_New_York_State_-_Geographicus_-_NewYork-finley-1827.jpg",
				licence: "Public domain",
			},
			{ label: "Paper and newsprint textures, ambientCG", href: "https://ambientcg.com", licence: "CC0" },
			{ label: "Sound effects, Kenney and Cue", href: "https://kenney.nl", licence: "CC0" },
		],
	},
];

export function example(slug: string): Example {
	const found = EXAMPLES.find((e) => e.slug === slug);
	if (!found) throw new Error(`No example ${slug}`);
	return found;
}
