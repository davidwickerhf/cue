import { A, C, DocPage, H2, H3, Kbd, Note, Ol, Table, Ul } from "@/components/docs/Prose";
import appData from "@/content/app-data.json";
import { doc } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";
import { DOWNLOAD } from "@/lib/site";

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

const TOC = [
	{ id: "install", label: "Install" },
	{ id: "first-project", label: "Your first project" },
	{ id: "import", label: "Importing media" },
	{ id: "layout", label: "The editor" },
	{ id: "workspaces", label: "Workspaces" },
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
					Download <A href={DOWNLOAD}>Cue-mac-arm64.zip</A> from the latest release.
				</li>
				<li>
					Unzip it and move <strong className="text-white">Cue</strong> to <strong className="text-white">Applications</strong>.
				</li>
				<li>
					The first time, right-click Cue and choose <strong className="text-white">Open</strong>. The app is signed but not
					notarised yet, so macOS asks once.
				</li>
			</Ol>
			<p>
				Cue needs macOS on Apple Silicon. ffmpeg is bundled, and editing needs no account or API key. Cue does not update itself
				yet: download new versions from the releases page.
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

			<H2 id="workspaces">Workspaces</H2>
			<p>
				A workspace sets up the window for one kind of work: panel sizes, what is docked beside the viewer, how tall each kind
				of track is, which viewer overlays are on and which inspector sections are open. Switch with the workspace button in the
				header or with the keys below.
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
				Agents can switch workspace too, with <C>set_view</C>, for example to show you the Colour workspace after grading.
			</Note>
		</DocPage>
	);
}
