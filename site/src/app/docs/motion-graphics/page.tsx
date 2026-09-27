import { A, C, CodeBlock, DocPage, H2, H3, Note, Ol, Table, Ul } from "@/components/docs/Prose";
import appData from "@/content/app-data.json";
import { doc } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";

const PAGE = doc("/docs/motion-graphics");

export const metadata = pageMetadata({ title: PAGE.title, description: PAGE.description, path: PAGE.href });

const TOC = [
	{ id: "after-effects", label: "Importing After Effects graphics" },
	{ id: "editing", label: "Editing text and colours" },
	{ id: "templates", label: "The template library" },
	{ id: "data", label: "Charts and callouts from data" },
	{ id: "agents", label: "How agents make graphics" },
	{ id: "spec", label: "The motion spec" },
];

/** Template categories as the gallery groups them. */
const CATEGORY: Record<string, string> = {
	"lower third": "Title",
	title: "Title",
	quote: "Title",
	chart: "Chart",
	stat: "Chart",
	map: "Map",
	callout: "Callout",
	list: "List",
	overlay: "Overlay",
	transition: "Transition",
};
const ORDER = ["Title", "Chart", "Map", "Callout", "List", "Overlay", "Transition"];
const templates = [...appData.motionTemplates].sort(
	(a, b) => ORDER.indexOf(CATEGORY[a.category] ?? "") - ORDER.indexOf(CATEGORY[b.category] ?? ""),
);

const SPEC_EXAMPLE = `{
  "durationMs": 4000,
  "markers": [{ "name": "outro", "atMs": 3400, "durationMs": 600 }],
  "layers": [
    { "type": "rect", "name": "Bar", "x": 144, "y": 900, "origin": "left",
      "width": 520, "height": 8, "fill": "#ffcc00",
      "enter": { "preset": "grow", "atMs": 0, "durationMs": 700 },
      "exit": { "preset": "fade", "atMs": 3400, "durationMs": 400 } },
    { "type": "text", "name": "Title", "x": 144, "y": 850, "size": 56,
      "runs": [{ "text": "Chapter 2  ", "color": "#ffcc00" }, { "text": "The prototype" }],
      "enter": { "preset": "rise", "atMs": 200, "amount": 40 },
      "exit": { "preset": "fade", "atMs": 3400, "durationMs": 300 } }
  ]
}`;

export default function Page() {
	return (
		<DocPage
			href={PAGE.href}
			toc={TOC}
			intro={
				<p>
					Cue plays Lottie animations, the format After Effects exports, as media you can cut, move and grade like video. Bring in
					graphics made in After Effects, start from Cue&apos;s own templates, or have an agent design one from a short brief. Text,
					colours and data stay editable after the graphic is on the timeline.
				</p>
			}
		>
			<H2 id="after-effects">Importing After Effects graphics</H2>
			<p>
				In After Effects, export the composition with the Bodymovin or LottieFiles plug-in as a <C>.json</C> or <C>.lottie</C>{" "}
				file, then import it like any other media (drag it into the Media panel). Cue keeps a self-contained copy in the
				project&apos;s graphics folder, so the project still works when the original download is gone.
			</p>
			<Ul>
				<li>
					Graphics go on video tracks and keep their transparency, so lower thirds and overlays sit on the footage below. Move,
					scale, keyframe, fade and grade them like any clip; the export draws them at the size they appear, so vector art stays
					sharp.
				</li>
				<li>
					Past its end a graphic holds its last frame, or loops when <strong className="text-white">Loop</strong> is on. If the
					file has a marker named <C>outro</C> (or <C>out</C>), a longer clip holds before it and plays the outro as the clip
					ends, so a lower third can stay up as long as you need.
				</li>
				<li>
					Some exports draw their text from letter shapes stored in the file rather than a font. Those texts are marked in the
					inspector: you can rewrite them, but only letters that are in the file will show.
				</li>
			</Ul>

			<H2 id="editing">Editing text and colours</H2>
			<p>
				Select a graphic&apos;s clip and the inspector lists its text layers and colours. Type new words into a text layer, or pick
				a new colour for any colour in the file (every use of it changes). The file itself is not touched: the changes belong to
				the clip, so two clips of the same graphic can say different things. Clear a field to go back to the original.
			</p>
			<p>
				Agents do the same with <C>update_clip</C> and <C>motion</C> <C>{"{text: {layerId: \"…\"}, colors: {\"#from\": \"#to\"}, loop}"}</C>;{" "}
				<C>list_media</C> shows each graphic&apos;s text layers, colours and markers.
			</p>

			<H2 id="templates">The template library</H2>
			<p>
				Open the <strong className="text-white">Library</strong> panel and choose <strong className="text-white">Motion
				graphics</strong> for live previews of every template in a theme of your choice. Click one to add it at the playhead;
				transitions are centred on the playhead so they cover the cut. The inspector then shows the template&apos;s own fields:
				the words, the data, the theme, an accent colour and the length. Every change rebuilds the graphic and is one undo step.
			</p>
			<Table
				head={["Template", "Kind", "What it does"]}
				rows={templates.map((t) => [
					<C key={t.id}>{t.id}</C>,
					`${CATEGORY[t.category] ?? t.category}${t.overlay ? " · over the video" : ""}`,
					t.description,
				])}
			/>
			<p>
				Themes: {appData.motionThemes.map((t) => t.label).join(", ")}. Each sets a background, a surface for cards, the text
				colours and three accents; <C>colors</C> overrides any of them, for example your brand&apos;s accent.
			</p>
			<p>
				The procedural clip transitions (paper tear, signal glitch, ink blot and the rest) are still in the inspector&apos;s{" "}
				<strong className="text-white">Transition in</strong> section; see <A href="/docs/look-and-motion#transitions">Look and
				motion</A>. The transition templates are designed wipes in your theme&apos;s colours that sit on a track above the cut.
			</p>

			<H2 id="data">Charts and callouts from data</H2>
			<p>
				Charts follow their numbers: bars grow to their values, donut slices sweep to their shares and counters land on the exact
				figure, with a source line under the chart. Agents can also use two shortcuts that take plain data and pick the template:
			</p>
			<Table
				head={["Tool", "Makes"]}
				rows={[
					[<C key="b">add_infographic kind bars</C>, "bar-chart, on a card over the footage"],
					[<C key="d">add_infographic kind donut</C>, "donut-chart"],
					[<C key="c">add_infographic kind cards</C>, "stat-row (up to four numbers; more become bars)"],
					[<C key="l">add_infographic kind line</C>, "line-chart"],
					[<C key="t">add_infographic kind timeline</C>, "timeline, each milestone with its value"],
					[<C key="p">add_data_callout</C>, "callout: a marker on the target, a leader line and a label with a value and source"],
				]}
			/>
			<p>
				The palettes map to themes (editorial to editorial, electric to signal, mono to mono), and the result is an ordinary
				template graphic, edited in the inspector or with <C>update_motion_graphic</C>.
			</p>
			<Note>
				Projects made before motion graphics may hold infographic and data callout text clips. They still play, export and edit in
				the inspector as before; new ones are always motion graphics.
			</Note>

			<H2 id="agents">How agents make graphics</H2>
			<p>
				An agent works with the same library and the same editor you see. Ask for what you want in words (&quot;a lower third for
				Maya, Head of Research&quot;, &quot;a chart of these four numbers&quot;, &quot;a subscribe reminder bottom right&quot;) and it will:
			</p>
			<Ol>
				<li>
					Look for a fitting template with <C>list_motion_templates</C>, which lists every template&apos;s fields with an example,
					and the themes.
				</li>
				<li>
					Make it with <C>create_motion_graphic</C> <C>{"{template, params}"}</C>, placed at <C>startMs</C> or, for a transition,
					centred on a cut with <C>atCutMs</C>.
				</li>
				<li>
					When no template fits, read <C>get_guide</C> <C>{"{topic: \"motion\"}"}</C> (the spec format, what makes motion look
					professional, and patterns) and write a spec, often starting from a template&apos;s own spec (<C>get_motion_graphic</C>).
				</li>
				<li>
					Look at the result with <C>render_frame</C> at the reveal, the hold and the exit, and fix what looks wrong with{" "}
					<C>update_motion_graphic</C>: new params merge with the old ones, a new spec replaces the graphic.
				</li>
			</Ol>

			<H2 id="spec">The motion spec</H2>
			<p>
				A spec is a short JSON description that Cue compiles into a Lottie animation. Positions are pixels on the canvas, times are
				milliseconds and layers are listed bottom to top. This one draws a rule and a two-colour title that rises in, and holds
				until the clip&apos;s end before it fades:
			</p>
			<CodeBlock>{SPEC_EXAMPLE}</CodeBlock>
			<H3>What a spec can hold</H3>
			<Ul>
				<li>
					<strong className="text-white">Layers</strong>: rectangles, ellipses, arcs (donuts and progress rings), lines,
					SVG paths (icons, logos, pins), text in four bundled typefaces, images and groups.
				</li>
				<li>
					<strong className="text-white">Motion</strong>: enter and exit presets (fade, rise, slide, grow, pop, draw, type, blur,
					spin), keyframes with named or custom eases, clip rectangles that text rises out of, counters, typing, and routes a
					layer follows as a line draws.
				</li>
				<li>
					<strong className="text-white">Text</strong>: runs set words in different colours or weights on one line, and text is
					measured with the fonts&apos; own widths; the tools return where each text landed so boxes and underlines fit it.
				</li>
				<li>
					<strong className="text-white">Markers</strong>: <C>outro</C> marks the exit so the graphic can hold; <C>cut</C> marks
					the moment a transition covers the frame.
				</li>
			</Ul>
			<p>
				Everything Cue ships is an original design built this way, so any template is a starting point for your own: ask an agent
				to change it, or to make a new graphic in the same style.
			</p>
		</DocPage>
	);
}
