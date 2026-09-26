import { A, C, DocPage, H2, Kbd, Note, Ol, Table, Ul } from "@/components/docs/Prose";
import appData from "@/content/app-data.json";
import { doc } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";

const PAGE = doc("/docs/titles-and-captions");

export const metadata = pageMetadata({ title: PAGE.title, description: PAGE.description, path: PAGE.href });

const TOC = [
	{ id: "templates", label: "Templates" },
	{ id: "styles", label: "Styles" },
	{ id: "animation", label: "Animation" },
	{ id: "word-by-word", label: "Word-by-word captions" },
	{ id: "auto-captions", label: "Automatic captions" },
];

const ANIMATION_NAMES: Record<string, string> = {
	fade: "Fade",
	pop: "Pop",
	zoom: "Zoom",
	"slide-up": "Slide up",
	"slide-left": "Slide left",
	typewriter: "Typewriter",
};
const anim = (a: string | null) => (a ? (ANIMATION_NAMES[a] ?? a) : "None");

export default function Page() {
	return (
		<DocPage
			href={PAGE.href}
			toc={TOC}
			intro={
				<p>
					Titles and captions are text clips on a text track. Start from a template, then change anything about the style and
					motion. The Titles workspace (<Kbd>⌥5</Kbd>) shows the template gallery, safe-area guides on the viewer and taller text
					tracks.
				</p>
			}
		>
			<H2 id="templates">Templates</H2>
			<p>
				Open the Text panel and click a template to add it at the playhead. Each thumbnail is drawn with the real text renderer,
				so it looks like what you get. The panel also lists every text clip on the timeline; click one to jump to it.
			</p>
			<Table
				head={["Template", "Animates in", "Animates out"]}
				rows={appData.titles.map((t) => [t.label, anim(t.animationIn), anim(t.animationOut)])}
			/>
			<p>
				Double-click a title in the viewer to type straight into it. Every value a template sets can be changed afterwards.
			</p>

			<H2 id="styles">Styles</H2>
			<p>Select a text clip and use the inspector:</p>
			<Ul>
				<li>
					<strong className="text-white">Text</strong>: the words themselves.
				</li>
				<li>
					<strong className="text-white">Style</strong>: font (every font installed on your Mac), size, weight, colour, a gradient to a
					second colour, outline and outline width, a background box, alignment, shadow, letter spacing, line height and rotation.
				</li>
				<li>
					<strong className="text-white">Layout</strong>: X and Y position, width, and the box&apos;s padding and corner radius.
				</li>
			</Ul>
			<p>Turn on safe areas from the workspace menu (On the viewer → Safe areas) to keep titles clear of the edges.</p>

			<H2 id="animation">Animation</H2>
			<p>
				The <strong className="text-white">Animation</strong> section sets how a title comes in and goes out: none, fade, pop, zoom, slide up,
				slide left or typewriter.
			</p>

			<H2 id="word-by-word">Word-by-word captions</H2>
			<p>The Words section animates a text clip one word at a time, in a bold social style:</p>
			<Table
				head={["Mode", "What happens"]}
				rows={[
					["Highlight", "The word being said is coloured."],
					["Reveal", "Words appear as they are said."],
					["Pop", "The word being said pops."],
					["Bounce", "The word being said bounces."],
				]}
			/>
			<p>
				Set the colour of the current word with <strong className="text-white">Word colour</strong>. Captions made from speech are timed
				word by word from the transcript; on any other text clip the words are spread evenly over the clip.
			</p>

			<H2 id="auto-captions">Automatic captions</H2>
			<Ol>
				<li>Put your narration on the voiceover track (see <A href="/docs/audio#voiceover">Audio</A>).</li>
				<li>
					In the Generate panel, under Captions, press <strong className="text-white">Caption the voiceover</strong>.
				</li>
				<li>Cue transcribes it and adds timed caption clips on a new Captions track, with word timings.</li>
			</Ol>
			<p>
				Edit the captions like any text clip, or give them a word-by-word mode. Transcription runs on your Mac with Whisper or
				with OpenAI, whichever you chose in <strong className="text-white">Settings → AI &amp; models</strong>.
			</p>
			<Note>
				An agent can do more with <C>auto_captions</C>: caption the whole mix instead of the voiceover, limit the characters per
				caption, pick the language, and choose a style (plain, highlight, reveal, pop or bounce) with a word colour. Try
				&quot;Add pop captions to the whole video, yellow for the current word.&quot;
			</Note>
			<p>
				To deliver captions as files, export <strong className="text-white">Captions</strong>: an SRT and a VTT made from the caption clips
				(see <A href="/docs/export">Export</A>).
			</p>
		</DocPage>
	);
}
