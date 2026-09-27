import { A, C, DocPage, H2, H3, Kbd, Note, Ol, Table, Ul } from "@/components/docs/Prose";
import appData from "@/content/app-data.json";
import { doc } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";

const PAGE = doc("/docs/getting-started");

export const metadata = pageMetadata({ title: PAGE.title, description: PAGE.description, path: PAGE.href });

/** What each built-in workspace sets up (src/lib/workspace.ts). */
const WORKSPACE_NOTES: Record<string, string> = {
	editing: "The default layout: media on the left, viewer, inspector on the right, timeline below.",
	audio: "The mixer docked beside the viewer, tall audio tracks with waveforms and volume lines, low video tracks. The inspector opens on Audio and Timing.",
	colour: "Scopes docked beside the viewer, a hold-to-compare button on the viewer, and the inspector open on Colour, Effects, Mask and Chroma key.",
	voiceover: "The script panel with takes per line, a script prompter on the viewer, tall audio tracks. The inspector is hidden.",
	titles: "The title template gallery, safe-area guides on the viewer, tall text tracks, and the inspector open on the text sections.",
	agent: "The agent chat in a wide sidebar and the history docked beside the viewer, so you can follow what the agent changes.",
	review: "A large viewer with the sidebar and inspector hidden, a short timeline and the markers list docked beside the viewer.",
};

/** The page bar (src/lib/pages.ts), in its order. */
const PAGES = [
	{ label: "Edit", keys: "⌥1", about: "Cut the story: media, timeline and viewer." },
	{ label: "Motion", keys: "⌥8", about: "Design one motion graphic: its layers, text, colours and timing, with a large preview." },
	{ label: "Titles", keys: "⌥5", about: "Titles, captions and text on screen." },
	{ label: "Colour", keys: "⌥3", about: "Grade shot by shot with scopes and before/after." },
	{ label: "Audio", keys: "⌥2", about: "Mix, clean up and level the sound." },
	{ label: "Voice", keys: "⌥4", about: "Script and voiceover takes, with a teleprompter." },
	{ label: "Review", keys: "⌥7", about: "Watch it through and leave notes." },
	{ label: "Deliver", keys: "⌥9", about: "Export for the web, a master, variants or sound." },
	{ label: "Agent", keys: "⌥6", about: "Work with your agent, with the history beside it." },
];

const TOC = [
	{ id: "install", label: "Install" },
	{ id: "first-project", label: "Your first project" },
	{ id: "import", label: "Importing media" },
	{ id: "layout", label: "The editor" },
	{ id: "pages", label: "Pages" },
];

export default function Page() {
	return (
		<DocPage
			href={PAGE.href}
			toc={TOC}
			intro={<p>Install Cue, make a project, bring in your footage and learn where things are in the editor.</p>}
		>
			<H2 id="install">Install</H2>
			<Ol>
				<li>
					Download Cue for your computer from the <A href="/download">download page</A>: a disk image for Mac (Apple Silicon or Intel), an
					installer for Windows, an AppImage or .deb for Linux.
				</li>
				<li>
					On a Mac, drag <strong className="text-white">Cue</strong> to <strong className="text-white">Applications</strong>. On Windows, run the
					installer; on Linux, make the AppImage executable and run it, or install the .deb.
				</li>
				<li>
					Open it. The Mac app is signed and notarised by Apple, so it opens like any other app. The Windows installer isn't signed yet: if
					Windows says it protected your PC, choose More info, then Run anyway.
				</li>
			</Ol>
			<p>
				Cue runs on macOS 12 or later, Windows 10 and 11, and 64-bit Linux. ffmpeg is bundled, and editing needs no account or API key. From 0.2.2 Cue updates itself:
				it checks for new versions and asks before downloading one (or does it for you, in{" "}
				<strong className="text-white">Settings → General → Updates</strong>). Older copies need 0.2.2 downloaded once by hand.
			</p>

			<H2 id="first-project">Your first project</H2>
			<p>
				Choose <strong className="text-white">File → New Project…</strong> (<Kbd>⌘N</Kbd>) or <strong className="text-white">New project</strong> in the
				projects overview. The dialog asks for:
			</p>
			<Ul>
				<li>
					<strong className="text-white">Name</strong>, used for the project&apos;s folder and file.
				</li>
				<li>
					<strong className="text-white">Frame size</strong>: HD 1080p, 4K UHD, HD 720p, Vertical (1080×1920), Square (1080×1080) or Portrait
					(1080×1350).
				</li>
				<li>
					<strong className="text-white">Frame rate</strong>: 24, 25, 30, 50 or 60 fps.
				</li>
				<li>
					<strong className="text-white">Start from</strong> a video (optional). The video goes on the first video track and the frame size
					matches it.
				</li>
				<li>
					<strong className="text-white">Location</strong>. By default each project gets its own folder in your projects folder (
					<C>~/Movies/Cue</C>), which you can change in Settings.
				</li>
			</Ul>
			<p>
				You can change the frame size, rate and background colour later in the project settings (the Project button at the
				bottom of the sidebar). <strong className="text-white">File → Show All Projects</strong> (<Kbd>⇧⌘O</Kbd>) goes back to the
				projects overview. See <A href="/docs/projects-and-history">Projects and history</A>.
			</p>

			<H2 id="import">Importing media</H2>
			<Ul>
				<li>
					<strong className="text-white">File → Import Media…</strong> (<Kbd>⌘I</Kbd>) or <strong className="text-white">Import media</strong> in the Media
					panel adds video, audio and image files to the project.
				</li>
				<li>Drag files from Finder straight onto the timeline to import and place them in one go.</li>
				<li>
					In the Media panel, filter by All, Video, Audio, Images or Takes, add an item at the playhead, or double-click it to
					open it in the source monitor (see <A href="/docs/editing#source-monitor">three-point editing</A>).
				</li>
			</Ul>
			<p>
				Media is linked where it is on disk, not copied. Large videos get lightweight playback copies (proxies) for smooth
				scrubbing when <strong className="text-white">Settings → General → Playback copies of large videos</strong> is on;
				exports always use the originals.
			</p>

			<H2 id="layout">The editor</H2>
			<Table
				head={["Area", "What it holds"]}
				rows={[
					[
						"Header",
						"Back to all projects, the project name, undo and redo, whether an agent is connected, the workspace menu, and Export.",
					],
					[
						"Sidebar",
						"Panels: Media, Voiceover (the script), Transcript, Text, Mixer, Generate, History and Agent, plus project settings. Clicking the open panel's icon folds the sidebar away.",
					],
					[
						"Viewer",
						"The picture at the playhead. Tabs above it switch between the timeline and a clip open in the source monitor. Double-click a title to type into it.",
					],
					[
						"Dock",
						"An optional pane beside the viewer: the mixer, scopes, the agent, history or the markers list.",
					],
					[
						"Inspector",
						"Settings for the selected clip, in collapsible sections (Timing, Audio, Transform, Colour, Text, Mask, Effects and more).",
					],
					[
						"Timeline",
						"Sequence tabs, the ruler and markers, and the tracks. Picture tracks (video and text) always sit above sound tracks; upper tracks draw over lower ones.",
					],
				]}
			/>
			<p>
				Each track header has a name you can type over, buttons to mute, solo, lock and hide the track, and a menu to move it,
				set its volume, make it the voiceover track, duck it under the voiceover or delete it. Drag the bottom edge of a track
				header to resize the track; double-click the edge to reset it.
			</p>

			<H2 id="pages">Pages</H2>
			<p>
				Cue has a page for each job, in the bar along the bottom of the window. The same project flows through all of them.
				Most pages lay the editor out for their job; Motion and Deliver are screens of their own.
			</p>
			<Table
				head={["Page", "Keys", "What it is for"]}
				rows={PAGES.map((p) => [p.label, <Kbd key={p.label}>{p.keys}</Kbd>, p.about])}
			/>
			<p>
				The layouts behind the editor pages are workspaces: panel sizes, what is docked beside the viewer, how tall each kind
				of track is, which viewer overlays are on and which inspector sections are open.
			</p>
			<Table
				head={["Workspace", "Keys", "What it sets up"]}
				rows={appData.workspaces.map((w) => [w.label, <Kbd key={w.id}>{w.keys}</Kbd>, WORKSPACE_NOTES[w.id] ?? ""])}
			/>
			<H3>Changing and saving a workspace</H3>
			<p>
				The workspace menu also chooses what is docked <strong className="text-white">beside the viewer</strong> (nothing,
				mixer, scopes, agent, history or markers) and what is drawn <strong className="text-white">on the viewer</strong> (safe
				areas, the script prompter, the before/after button). Drag the dividers to resize panes. <strong className="text-white">Save current as…</strong>{" "}
				keeps the whole layout under a name, including track heights and overlays. The current layout is remembered between
				launches.
			</p>
			<Note>
				Agents can switch page or workspace too, with <C>set_view</C>, for example to show you the Colour page after grading or
				open a graphic on the Motion page.
			</Note>
		</DocPage>
	);
}
