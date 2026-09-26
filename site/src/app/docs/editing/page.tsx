import { A, C, DocPage, H2, H3, Kbd, Keys, Note, Ol, Table, Ul } from "@/components/docs/Prose";
import appData from "@/content/app-data.json";
import { doc } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";

const PAGE = doc("/docs/editing");

export const metadata = pageMetadata({ title: PAGE.title, description: PAGE.description, path: PAGE.href });

const TOC = [
	{ id: "tools", label: "Tools" },
	{ id: "shortcuts", label: "Keyboard shortcuts" },
	{ id: "selecting", label: "Selecting" },
	{ id: "trimming", label: "Trimming" },
	{ id: "ripple", label: "Ripple, lift and extract" },
	{ id: "source-monitor", label: "Three-point editing" },
	{ id: "clip-menu", label: "The clip menu" },
	{ id: "speed", label: "Speed and holds" },
	{ id: "markers", label: "Markers" },
	{ id: "sequences", label: "Sequences and nesting" },
	{ id: "transcript", label: "Editing by transcript" },
	{ id: "tracks", label: "Track heights" },
];

/** Keys handled by the editor that the Settings → Shortcuts list does not show. */
const MORE_KEYS: { label: string; keys: string[] }[] = [
	{ label: "Ripple trim the previous / next edit to the playhead", keys: ["Q", "W"] },
	{ label: "Lift / extract between in and out", keys: [";", "'"] },
	{ label: "Next / previous marker", keys: ["⇧M", "⇧⌘M"] },
	{ label: "Enable / disable the selected clips", keys: ["⇧E"] },
	{ label: "Switch workspace", keys: ["⌥1", "…", "⌥7"] },
	{ label: "Save / save as", keys: ["⌘S", "⇧⌘S"] },
	{ label: "All projects", keys: ["⇧⌘O"] },
	{ label: "Import a timeline (OpenTimelineIO)", keys: ["⇧⌘I"] },
];

export default function Page() {
	return (
		<DocPage
			href={PAGE.href}
			toc={TOC}
			intro={
				<p>
					Cue uses the keys and tools of Premiere Pro first, then DaVinci Resolve and Final Cut Pro, so most of what you know
					carries over.
				</p>
			}
		>
			<H2 id="tools">Tools</H2>
			<p>The tool buttons are in the timeline toolbar. Each has a key:</p>
			<Table
				head={["Tool", "Key", "What dragging does"]}
				rows={[
					["Selection", <Kbd key="v">V</Kbd>, "Moves clips, trims their edges, draws a selection rectangle on empty timeline."],
					[
						"Blade",
						<Keys key="c" keys={["C", "B"]} />,
						"Click a clip to cut it there.",
					],
					["Slip", <Kbd key="y">Y</Kbd>, "Changes which part of the source a clip shows, without moving it."],
					["Rolling edit", <Kbd key="n">N</Kbd>, "Moves the cut between two clips: one gets longer, the other shorter."],
					["Slide", <Kbd key="u">U</Kbd>, "Moves a clip between its neighbours; they grow and shrink so nothing else moves."],
				]}
			/>
			<p>
				<Kbd>S</Kbd> turns snapping on and off. Whether snapping starts on is set in <strong className="text-white">Settings → General</strong>.
			</p>

			<H2 id="shortcuts">Keyboard shortcuts</H2>
			<p>
				This is the list from <strong className="text-white">Settings → Shortcuts</strong> (<Kbd>⌘,</Kbd>), generated from the app&apos;s
				source.
			</p>
			{appData.shortcuts.map((group) => (
				<div key={group.title} className="flex flex-col gap-2">
					<H3>{group.title}</H3>
					<Table
						head={["Action", "Keys"]}
						rows={group.items.map((item) => [
							<span key="label">
								{item.label}
								{"note" in item && item.note ? <span className="block text-[13px] text-muted">{item.note}</span> : null}
							</span>,
							<Keys key="keys" keys={item.keys} />,
						])}
					/>
				</div>
			))}
			<H3>Also available</H3>
			<Table head={["Action", "Keys"]} rows={MORE_KEYS.map((k) => [k.label, <Keys key="keys" keys={k.keys} />])} />

			<H2 id="selecting">Selecting</H2>
			<Ul>
				<li>Click a clip to select it; ⇧-click or ⌘-click adds it to the selection or takes it out. <Kbd>⌘A</Kbd> selects everything, <Kbd>Esc</Kbd> nothing.</li>
				<li>
					With the Selection tool, drag on an empty part of the timeline to draw a rectangle: every clip it touches is selected.
					Hold <Kbd>⇧</Kbd> to add to the current selection.
				</li>
				<li>Clicking empty timeline clears the selection. Clicking the ruler only moves the playhead.</li>
				<li>
					Linked clips (a picture and its sound) move and delete together. <Kbd>⌘L</Kbd> links or unlinks the selection,{" "}
					<Kbd>⌘G</Kbd> and <Kbd>⇧⌘G</Kbd> group and ungroup.
				</li>
				<li>
					<Kbd>⌥</Kbd>-drag a clip to duplicate it. <Kbd>⌘C</Kbd>, <Kbd>⌘X</Kbd> and <Kbd>⌘V</Kbd> copy, cut and paste at the playhead.
				</li>
			</Ul>

			<H2 id="trimming">Trimming</H2>
			<Ul>
				<li>
					Drag the start or end edge of a clip to trim it. You can extend a clip only as far as its source media goes.
				</li>
				<li>
					<Kbd>⌘K</Kbd> splits at the playhead: on the tracks of the selected clips, or on every track when nothing is selected.
				</li>
				<li>
					<Kbd>Q</Kbd> removes everything from the previous edit point to the playhead, <Kbd>W</Kbd> from the playhead to the next
					one, and closes the gap (ripple trim).
				</li>
				<li>
					Use the Slip, Rolling edit and Slide tools for fine changes, and <Kbd>⌥←</Kbd> / <Kbd>⌥→</Kbd> to nudge the selected clips one frame.
				</li>
				<li>
					<Kbd>↑</Kbd> and <Kbd>↓</Kbd> jump to the previous and next edit point, <Kbd>←</Kbd> and <Kbd>→</Kbd> step one frame (five with <Kbd>⇧</Kbd>).
				</li>
				<li>
					<Kbd>Esc</Kbd> cancels a drag or trim in progress.
				</li>
			</Ul>

			<H2 id="ripple">Ripple, lift and extract</H2>
			<Ul>
				<li>
					<Kbd>⌫</Kbd> deletes the selected clips and leaves a gap. <Kbd>⇧⌫</Kbd> ripple deletes: the gap closes on their tracks.{" "}
					<strong className="text-white">Settings → General → Delete closes gaps (ripple) by default</strong> swaps the two.
				</li>
				<li>
					Mark in and out with <Kbd>I</Kbd> and <Kbd>O</Kbd>, then <Kbd>;</Kbd> lifts that range (removes it on every track and leaves the gap) and{" "}
					<Kbd>&apos;</Kbd> extracts it (removes it and closes the gap). Script lines and markers after the range move with it.
				</li>
				<li>
					<Kbd>/</Kbd> plays from in to out, <Kbd>⌥X</Kbd> clears both marks.
				</li>
			</Ul>

			<H2 id="source-monitor">Source monitor and three-point editing</H2>
			<Ol>
				<li>Double-click a clip in the Media panel. It opens in the source monitor, a tab over the viewer.</li>
				<li>
					Play it with <Kbd>Space</Kbd>, and mark the part you want with <Kbd>I</Kbd> and <Kbd>O</Kbd> (the buttons under the picture do the
					same).
				</li>
				<li>
					Put the timeline playhead where the clip should go and press <Kbd>,</Kbd> to insert (later material on every unlocked track
					moves along) or <Kbd>.</Kbd> to overwrite (it replaces what is there).
				</li>
				<li>
					<Kbd>Esc</Kbd> goes back to the timeline. The source monitor remembers its position when you come back.
				</li>
			</Ol>

			<H2 id="clip-menu">The clip menu</H2>
			<p>Right-click a clip for: Split, Duplicate, Split at shot changes (video), a transition from the previous clip (crossfade or dip to black) or Remove transition, Fade in and out, Mute or Unmute, Detach audio, Zoom in here, Hold this frame, Nest… (or Open nested sequence), Enable or Disable, Link selected or Unlink, Ask the agent about this…, Delete and Ripple delete.</p>
			<Ul>
				<li>
					<strong className="text-white">Split at shot changes</strong> finds the cuts inside a long take or a finished film and splits the
					clip (and its linked sound) there.
				</li>
				<li>
					<strong className="text-white">Disable</strong> (<Kbd>⇧E</Kbd>) keeps a clip on the timeline but unseen and unheard.
				</li>
				<li>
					<strong className="text-white">Fade in and out</strong> adds half-second fades at both ends; <strong className="text-white">Zoom in here</strong>{" "}
					adds a push-in where you right-clicked (see <A href="/docs/look-and-motion#zooms">zooms</A>).
				</li>
				<li>
					<strong className="text-white">Detach audio</strong> moves a video clip&apos;s sound onto its own audio track and mutes the video clip.
				</li>
			</Ul>

			<H2 id="speed">Speed, ramps and frame holds</H2>
			<Ul>
				<li>Set a constant speed from 0.1× to 8× in the inspector&apos;s Source section.</li>
				<li>
					The <strong className="text-white">Speed ramp</strong> section has four one-click ramps: Speed up, Slow down, Montage (fast in the
					middle) and Slow-mo hit. It ramps the part between the in and out points if they fall inside the clip, otherwise the
					whole clip. Later clips on the track move to make room.
				</li>
				<li>
					<strong className="text-white">Hold this frame</strong> in the clip menu holds the frame where you right-clicked for two seconds;
					later clips on that track move along.
				</li>
			</Ul>

			<H2 id="markers">Markers</H2>
			<Ul>
				<li>
					<Kbd>M</Kbd> drops a marker at the playhead. <Kbd>⇧M</Kbd> and <Kbd>⇧⌘M</Kbd> jump to the next and previous marker.
				</li>
				<li>Click a marker on the ruler to jump to it, double-click it to remove it.</li>
				<li>
					The markers list shows every marker in time order: click the time to jump, type over the name to rename it. It is in
					the inspector when nothing is selected, and docked beside the viewer in the Review workspace. Clear removes them all,
					or only the beat markers when there are others too.
				</li>
				<li>Markers come in four colours. Beat detection and chapters add their own markers (green Beat markers, chapter markers).</li>
			</Ul>

			<H2 id="sequences">Sequences and nesting</H2>
			<p>A project can hold several timelines (sequences). The open one is the one you edit, and what agents edit.</p>
			<Ul>
				<li>The sequence tabs above the timeline switch between them; the + button makes a new one.</li>
				<li>Right-click a tab to rename, duplicate (to try a different cut) or delete it.</li>
				<li>
					<strong className="text-white">Nest…</strong> in the clip menu moves the selected clips into a new sequence that takes their place as one
					clip, like Premiere&apos;s Nest. Double-click a nested clip to open its sequence; when you go back, the nested clip plays
					the updated version.
				</li>
				<li>A sequence that is open or nested somewhere cannot be deleted.</li>
			</Ul>

			<H2 id="transcript">Editing by transcript</H2>
			<p>
				The Transcript panel turns speech into text you can edit. Transcription runs on your Mac with Whisper, or with OpenAI if
				you choose it (see <A href="/docs/ai-and-agents#models">local and cloud models</A>).
			</p>
			<Ol>
				<li>Pick a media item and press Transcribe.</li>
				<li>Click a word to jump to it. Drag or ⇧-click to select words.</li>
				<li>Press <Kbd>⌫</Kbd> (or Cut selection) to cut them from the timeline on every track, closing the gaps.</li>
				<li>Remove fillers cuts um, uh, erm and similar in one go; the button shows how many it found.</li>
			</Ol>
			<p>
				The search box (&quot;Find where they talk about…&quot;) searches by meaning with the text model, not only exact words.
				Click a result to jump there and mark it in to out.
			</p>
			<Note>
				Agents can also cut pauses: <C>remove_silence</C> finds silences in the speech and cuts them on every track, with a
				dry run to preview the ranges first.
			</Note>

			<H2 id="tracks">Track heights</H2>
			<p>
				Drag the bottom edge of a track header to make the track taller or shorter; double-click the edge to reset it. The
				heights you set are kept per project. Each workspace has its own heights for video, audio and text tracks, and tracks you
				resized keep yours when you switch.
			</p>
		</DocPage>
	);
}
