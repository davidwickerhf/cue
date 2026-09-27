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
	{
		slug: "the-red-cars",
		title: "The Red Cars",
		summary:
			"A 3\u00bd-minute history documentary in the style of Hoog, made in Cue by an agent as a test: glowing rail maps on black, warm film archive, lamp-lit evidence, three voices and an original score, from public domain and open-licence sources.",
		style: "Archive history documentary",
		original: {
			title: "How One Company Turned LA Into A Dystopia",
			by: "Hoog",
			href: "https://www.youtube.com/watch?v=M0Hv7nxmS2I",
			note: "The original documentary is by Hoog. We made this shorter remake as a test: could an agent working in Cue recreate the way Hoog edits (the glowing maps, the orange film archive, the evidence on a desk, the voices) from its own script and public domain and openly licensed material? The subject and the style are Hoog's; the script, voices, graphics, music and the build are new, and nothing from the original video is used.",
		},
		playbook: "archive-history-documentary",
		durationS: 217,
		video: "/examples/the-red-cars.mp4",
		poster: "/examples/the-red-cars.jpg",
		fullVideo: `${ASSETS}/the-red-cars-1080p.mp4`,
		project: { url: `${ASSETS}/the-red-cars-project.zip`, sizeMb: 184 },
		numbers: [
			{ label: "Shots", value: "45" },
			{ label: "Motion graphics", value: "17" },
			{ label: "Voices", value: "3" },
			{ label: "Sources", value: "26 open" },
		],
		steps: [
			{
				title: "Measure the reference",
				body: "analyze_reference on the 19-minute original: a 2:1 frame, a median shot of 3.3 s, about 11 cuts a minute, black filling half of every frame, 56% black and white, \u221216 LUFS. Contact sheets of every shot showed the grammar: warm film archive, glowing line maps, evidence on a desk, newsreel, aerials.",
			},
			{
				title: "A new, shorter script",
				body: "473 words of its own covering the Pacific Electric's rise, its peak of about 1,100 miles of track, the 1949 National City Lines case, the freeways and the return of rail, voiced in ten passages so the narrator stays consistent. A flat, filtered records voice reads the charges and the fines; a period announcer, labelled as a dramatisation, reads two lines.",
			},
			{
				title: "Find what may be used",
				body: "26 sources, every licence checked on its own page: 1916\u20131959 films from the Prelinger Archives and archive.org, pre-1929 photographs and maps, CC BY photos from the Los Angeles Times and Commons photographers, NASA night photos. The archive segments used were restored (denoised, upscaled, sharpened).",
			},
			{
				title: "Cut on words",
				body: "Every cut, graphic and sound is anchored to a word of the narration from the transcripts, three frames early, so a new take only means re-running the layout.",
			},
			{
				title: "Maps, marks and evidence",
				body: "The network drawn from real stop coordinates grows to 1,100 miles, then fades line by line to 1961 and fills in again as today's Metro. Red boxes draw on a stuck streetcar and a 1912 real-estate map; a train is cut out onto a red glow; a typed case file is stamped guilty; generated tabletop stills carry the money.",
			},
			{
				title: "Sound",
				body: "One continuous original score: a drone that drops out before \u201cThen came a buyer\u201d, a heartbeat under the investigation, a major lift for the return. Thuds, shutters, typewriter and ticks land on the graphics; room tone fills the silences. Mixed to \u221216.4 LUFS.",
			},
			{
				title: "Check, fix, and write it down",
				body: "Two full passes, each exported and checked frame by frame and second by second. Everything that went wrong (and the Cue bugs it uncovered) is in the playbook 'before-your-first-pass' so the next build starts from the second pass.",
			},
		],
		prompt: `Make a 3\u20134 minute history documentary in the style of Hoog's "How One Company Turned LA Into A Dystopia" (https://www.youtube.com/watch?v=M0Hv7nxmS2I) in Cue, about Los Angeles' Pacific Electric Red Cars. Recreate how Hoog edits, not the video: use only public domain and openly licensed material, credit every source, and credit Hoog as the original on the end card.

1. Read Cue's playbooks first: get_playbook "working-in-cue", "before-your-first-pass", "archive-history-documentary" and "example-the-red-cars" (this video written down).
2. Create a 1920\u00d7960, 24 fps project. Script (narrator passages P, a records voice R, a dramatised announcer A):
   P01 This is Los Angeles. Nearly five hundred square miles of city, stitched together by freeways. Every day, millions of people sit in some of the slowest traffic in America. But a century ago, you could cross this whole region without a car. On a train painted red.
   P02 In 1901, a railroad heir named Henry Huntington founded the Pacific Electric Railway. And his plan wasn't really about trains. Buy empty farmland at the edge of the city. Run a line out to it. Then sell the land, as a brand new town. It worked. Towns grew up around the stations: shops on the main street, homes a short walk away, and the city one ride away.
   P03 By the 1920s the Red Cars ran on more than a thousand miles of track, across four counties. The largest electric interurban railway in the world. And within forty years, almost all of it was gone.
   A01 Tomorrow's city belongs to the motorist! Wide new roads, and freedom for every family!
   P04 Los Angeles fell for the car early. By the late twenties it had more cars per person than almost anywhere. The trains shared the streets with them, and got stuck behind them. Trips got slower. Riders drifted away. The companies stopped paying for repairs.
   P05 Then came a buyer.
   P06 From the late 1930s, a company called National City Lines bought up streetcar systems in dozens of American cities. Behind it: General Motors, Firestone Tire, and Standard Oil of California. Where it took over, the rails came out and buses went in. General Motors buses, on Firestone tires, burning Standard Oil fuel. In 1945 it bought the city's other streetcar network, the Yellow Cars.
   R01 The United States of America, versus National City Lines, et al.
   P07 In 1949, a federal jury convicted the companies of conspiring to monopolize the sale of buses and supplies to the transit systems they controlled.
   R02 Each corporation. Fined five thousand dollars.
   R03 Each executive. One dollar.
   P08 Whether they killed the streetcar on purpose is still argued about. Many historians say the Red Cars were already dying. But nobody was fighting to save them. The state was pouring its money into freeways instead. Through Cahuenga Pass, the Red Cars ran down the middle of the new Hollywood Freeway. Then the rails were paved over.
   P09 On April 9th, 1961, the last Red Car left Los Angeles for Long Beach. The line that started it all was the last to close.
   A02 Los Angeles is getting back on track!
   P10 Twenty-nine years later, a new train opened on nearly the same route. The Metro Blue Line, from downtown to Long Beach. Today the city is building rail again, faster than almost anywhere in America. Line by line, the map is filling back in.
   P11 Los Angeles never forgot how to build around a train. It just spent sixty years paving over the proof.
   Voice the narrator passages with one voice and one set of instructions; transcribe every take and compare it with the script. Put the records and announcer voices on their own tracks with the EQ from the playbook.
3. Source public domain and CC-licensed material (Prelinger Archives, archive.org, Wikimedia Commons, NASA), checking each licence on its page; look at the frames before choosing in-points, and restore the film segments you use.
4. Build scene by scene, every cut anchored to a word: the glowing network map that grows and fades, marks on the photos and maps, the cut-out train, the case file and the fines, year stamps and labels on every archive picture, one continuous score, effects on every landing.
5. Export, then check the file: a contact sheet every 2 s, black frames, loudness per second, the voice against the script. Fix and export again.
6. package_project with a README listing every source and its licence.`,
		credits: [
			{
				label: "Original video and style: \u201cHow One Company Turned LA Into A Dystopia\u201d by Hoog",
				href: "https://www.youtube.com/watch?v=M0Hv7nxmS2I",
				licence: "\u00a9 Hoog, credited as the original",
			},
			{ label: "'A Visitor to Los Angeles' (Ford Educational Weekly, 1916)", href: "https://archive.org/details/silent-a-visitor-to-los-angeles", licence: "Public domain (published 1916, pre-1929; archive.org item has no licence field) \u00b7 Ford Educational Weekly, 1916 (public domain)" },
			{ label: "'Freeway Driving' (Fass-Levy Films, c.1959) (c. 1959)", href: "https://archive.org/details/202248_Freeway_Driving", licence: "Public domain (Prelinger Archives rights field: 'No copyright notice seen on film'; no licenseurl) \u00b7 Freeway Driving, Fass-Levy Films c.1959, Prelinger Archives" },
			{ label: "'Give Yourself the Green Light' (General Motors, 1954)", href: "https://archive.org/details/GiveYour1954", licence: "Public domain (Prelinger Archives, archive.org licenseurl = publicdomain) \u00b7 Give Yourself the Green Light, General Motors 1954, Prelinger Archives (public domain)" },
			{ label: "'Hollywood Snapshots' (1922), Hollywood Boulevard streetcar clip", href: "https://commons.wikimedia.org/wiki/File:Hollywood_Snapshots_(1922).webm", licence: "Public domain (pre-1929 publication) \u00b7 Hollywood Snapshots, 1922 (public domain)" },
			{ label: "'Into the Future' (1922), first 4 minutes", href: "https://archive.org/details/csmha_000012", licence: "Public domain (archive.org rights: 'Public domain. No restrictions on use.') \u00b7 Into the Future, 1922, City of Los Angeles (public domain)" },
			{ label: "'The Towers' (1957), William Hale", href: "https://archive.org/details/TowersTh1957", licence: "Public domain (Prelinger Archives, archive.org licenseurl = publicdomain) \u00b7 The Towers (1957), William Hale, Prelinger Archives (public domain)" },
			{ label: "Four-level interchange under construction (aerial) (1948)", href: "https://commons.wikimedia.org/wiki/File:Construction_work_for_the_interchange_joining_Arroyo_Seco,_Harbor,_Hollywood_and_Santa_Ana_freeways.jpg", licence: "CC BY 4.0 \u00b7 Goodyear Tire and Rubber Co. / Los Angeles Times Photographic Archive, UCLA Library / CC BY 4.0" },
			{ label: "Construction of the Hollywood and Santa Ana freeways (1946)", href: "https://commons.wikimedia.org/wiki/File:Construction_of_Hollywood_and_Santa_Ana_freeways,_looking_north_(toward_City_Hall),_Los_Angeles,_1946.jpg", licence: "CC BY 4.0 \u00b7 Los Angeles Times Photographic Archive, UCLA Library / CC BY 4.0" },
			{ label: "Henry E. Huntington, portrait (c. 1910)", href: "https://commons.wikimedia.org/wiki/File:H.E._Huntington_LCCN2014683681.jpg", licence: "Public domain (pre-1929 publication / expired US copyright) \u00b7 Bain News Service, publisher / public domain, via Wikimedia Commons" },
			{ label: "Traffic congestion at North Broadway and Sunset (1922)", href: "https://commons.wikimedia.org/wiki/File:Intersection_of_North_Broadway_and_Sunset_Boulevard_showing_traffic_congestion,_Los_Angeles,_1922_(AAA-EN-122-3).jpg", licence: "Public domain (pre-1929 publication / expired US copyright) \u00b7 Unknown photographer / public domain, via Wikimedia Commons" },
			{ label: "Traffic at the 'Magic Circle', Wilshire & Western (1922)", href: "https://commons.wikimedia.org/wiki/File:Traffic_passing_%22Magic_Circle%22_at_Wilshire_and_Western,_Los_Angeles,_1922_(AAA-EN-135-2).jpg", licence: "Public domain (pre-1929 publication / expired US copyright) \u00b7 Unknown photographer / public domain, via Wikimedia Commons" },
			{ label: "'Phenomenal Growth of Los Angeles Toward the Ocean' (1912)", href: "https://commons.wikimedia.org/wiki/File:Phenomenal_Growth_of_Los_Angeles_Toward_the_Ocean_1912_map.jpg", licence: "Public domain (pre-1929 publication / expired US copyright) \u00b7 Staff artist / public domain, via Wikimedia Commons" },
			{ label: "Blue Line train on Long Beach Blvd, 1995", href: "https://commons.wikimedia.org/wiki/File:19951007_03_LRT_Long_Beach_Blvd._@_20th_(5378831405).jpg", licence: "CC BY 2.0 \u00b7 David Wilson / Wikimedia Commons / CC BY 2.0" },
			{ label: "Metro Blue Line opening celebration, 14 July 1990", href: "https://commons.wikimedia.org/wiki/File:LA_Blue_Line_Opening_Celebration.jpg", licence: "Public domain (PD-CAGov, LA Metro Library & Archive) \u00b7 Dorothy Peyton Gray Transportation Library and Archive at the Los Angeles County Metropolitan Transportation Authority / public domain, via Wikimedia Commons" },
			{ label: "Downtown Los Angeles at night from Griffith Observatory (2019)", href: "https://commons.wikimedia.org/wiki/File:Downtown_Los_Angeles_at_Night.jpg", licence: "CC BY-SA 4.0 \u00b7 Camiloarenivar / Wikimedia Commons / CC BY-SA 4.0" },
			{ label: "Hollywood Freeway north of Cahuenga Pass (2013)", href: "https://commons.wikimedia.org/wiki/File:Hollywood_Freeway_north_of_Cahuenga_Pass_-_2013.jpg", licence: "CC BY-SA 3.0 \u00b7 Mateusz Kud\u0142a / Wikimedia Commons / CC BY-SA 3.0" },
			{ label: "City lights of Los Angeles from the ISS (2024)", href: "https://commons.wikimedia.org/wiki/File:The_city_lights_of_Los_Angeles,_California_(iss072e399065).jpg", licence: "Public domain (NASA, US federal government work) \u00b7 NASA Johnson Space Center / public domain, via Wikimedia Commons" },
			{ label: "Aerial views of freeway in Los Angeles (drone, 2021)", href: "https://commons.wikimedia.org/wiki/File:Aerial_views_of_freeway_in_Los_Angeles,_California,_USA.webm", licence: "CC BY 3.0 \u00b7 the Dronalist / Wikimedia Commons / CC BY 3.0" },
			{ label: "LA Metro A Line train near South Pasadena (2026)", href: "https://commons.wikimedia.org/wiki/File:LACMTA_A_line_thru_trees.jpg", licence: "CC BY 4.0 \u00b7 Julesucks / Wikimedia Commons / CC BY 4.0" },
			{ label: "LA Metro A Line and Metrolink trains at Union Station (2025)", href: "https://commons.wikimedia.org/wiki/File:LA_Metro_A_Line_%26_Metrolink_Trains_at_Union_Station.jpg", licence: "CC BY 4.0 \u00b7 RailTypes / Wikimedia Commons / CC BY 4.0" },
			{ label: "Pacific Electric Building, Sixth & Main (c. 1905-1909)", href: "https://commons.wikimedia.org/wiki/File:Pacific_Electric_Building_on_the_corner_of_Main_Street_and_Sixth_Street,_ca.1905-1909_(CHS-2363).jpg", licence: "Public domain (pre-1929 publication / expired US copyright) \u00b7 Unknown photographer / public domain, via Wikimedia Commons" },
			{ label: "Last day of Glendale-Burbank line (railfan special) (1955)", href: "https://commons.wikimedia.org/wiki/File:Last_Day_of_Glendale%E2%80%93Burbank_Line_Service_(June_19,_1955).jpg", licence: "Public domain (PD-CAGov, LA Metro Library & Archive) \u00b7 Los Angeles County Metropolitan Transportation Authority / public domain, via Wikimedia Commons" },
			{ label: "Long Beach Line train under signal gantry (1923)", href: "https://commons.wikimedia.org/wiki/File:PE_Mag_1923_05_May_10_Long_Beach.jpg", licence: "Public domain (pre-1929 publication / expired US copyright) \u00b7 Pacific Electric Railway / public domain, via Wikimedia Commons" },
			{ label: "Opening day of the Pacific Electric line at the Long Beach Pier (c. 1902)", href: "https://commons.wikimedia.org/wiki/File:Opening_day_of_the_Pacific_Electric_line(%3F)_at_the_Long_Beach_Pier,_ca.1900-1902_(CHS-1989).jpg", licence: "Public domain (pre-1929 publication / expired US copyright) \u00b7 Unknown photographer / public domain, via Wikimedia Commons" },
			{ label: "Pacific Electric Red Cars awaiting destruction (1956)", href: "https://commons.wikimedia.org/wiki/File:Pacific-Electric-Red-Cars-Awaiting-Destruction.jpg", licence: "CC BY 4.0 \u00b7 Los Angeles Times Photographic Archive, UCLA Library Special Collections / CC BY 4.0" },
			{ label: "PE train at 103rd Street, Watts (1906)", href: "https://commons.wikimedia.org/wiki/File:103rd_Street_in_Watts.jpg", licence: "Public domain (pre-1929 publication / expired US copyright) \u00b7 Metro Library and Archive / public domain, via Wikimedia Commons" },
			{ label: "Sound effects, Kenney and Cue", href: "https://kenney.nl", licence: "CC0" },
		],
	},
];

export function example(slug: string): Example {
	const found = EXAMPLES.find((e) => e.slug === slug);
	if (!found) throw new Error(`No example ${slug}`);
	return found;
}
