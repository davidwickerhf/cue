import { C, DocPage, H2, Kbd, Note, Ol, Ul } from "@/components/docs/Prose";
import { doc } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";

const PAGE = doc("/docs/projects-and-history");

export const metadata = pageMetadata({ title: PAGE.title, description: PAGE.description, path: PAGE.href });

const TOC = [
	{ id: "files", label: "Project files" },
	{ id: "overview", label: "The projects overview" },
	{ id: "collections", label: "Collections" },
	{ id: "package", label: "Packaging a project" },
	{ id: "project-media", label: "Projects as media" },
	{ id: "relinking", label: "Relinking moved media" },
	{ id: "history", label: "History" },
];

export default function Page() {
	return (
		<DocPage
			href={PAGE.href}
			toc={TOC}
			intro={
				<p>
					A Cue project is one plain file, and Cue keeps a history of every change to it, by you or by an agent, across
					sessions.
				</p>
			}
		>
			<H2 id="files">Project files</H2>
			<Ul>
				<li>
					A project is a <C>.cueproj</C> file: plain JSON that diffs and versions well, with its own icon in Finder. Older{" "}
					<C>.cue.json</C> projects open too and are renamed to <C>.cueproj</C> when opened.
				</li>
				<li>
					New projects get their own folder in your projects folder, <C>~/Movies/Cue</C> by default. Change it in{" "}
					<strong className="text-white">Settings → General → Projects</strong>, where you can also choose to reopen the last project on
					launch.
				</li>
				<li>
					Media stays where it is on disk. Its paths are stored relative to the project when possible, so a project folder can
					move with its media.
				</li>
				<li>
					Cue saves as you work. <Kbd>⌘S</Kbd> saves right away, and <strong className="text-white">File → Save As…</strong> (<Kbd>⇧⌘S</Kbd>) saves
					a copy somewhere else and switches to it; the media stays where it is.
				</li>
				<li>
					Exports go to an <C>export</C> folder next to the project unless you choose another place.
				</li>
			</Ul>

			<H2 id="overview">The projects overview</H2>
			<p>
				Cue opens on the projects overview unless it reopens your last project. Get back to it with the button at the left of
				the header or <strong className="text-white">File → Show All Projects</strong> (<Kbd>⇧⌘O</Kbd>).
			</p>
			<Ul>
				<li>Every project in the projects folder and every recent one, newest first, with a poster frame.</li>
				<li>Search by name, and sort by most recent or by name.</li>
				<li>Each project can be duplicated, shown in Finder or removed from the recent list.</li>
				<li>Projects that moved, were deleted or cannot be read are marked as such.</li>
				<li>
					<strong className="text-white">Agent access</strong> copies the command that connects an MCP client (see AI and agents).
				</li>
			</Ul>

			<H2 id="collections">Collections</H2>
			<p>
				Collections group projects like folders, for example the pieces of one video: its edit, graphics made as their own
				projects, other versions. They are listed on the left of the projects overview with how many projects each holds.
			</p>
			<Ul>
				<li>Make one with <strong className="text-white">+</strong> next to Collections, then drag projects onto it, or use a project&apos;s menu → Move to collection.</li>
				<li>A project is in one collection at most. Duplicates join the original&apos;s collection.</li>
				<li>Rename or delete a collection from its right-click menu. Deleting one never deletes its projects.</li>
				<li>
					Agents use <C>list_collections</C>, <C>create_collection</C>, <C>move_to_collection</C>, <C>rename_collection</C> and{" "}
					<C>delete_collection</C>.
				</li>
			</Ul>

			<H2 id="package">Packaging a project</H2>
			<p>
				<strong className="text-white">File → Package Project…</strong> puts the project and every media file it uses into one zip
				that opens anywhere, to share or archive it. Long footage is trimmed to the parts the edit uses, with one-second handles,
				so a few shots from a feature film stay small. Caches and history are left out; Cue makes them again. Agents use{" "}
				<C>package_project</C>, optionally with a README of credits.
			</p>

			<H2 id="project-media">Projects as media</H2>
			<p>
				Place one project inside another, like a pre-composition shared between projects: Media → Add another project as media…
				(or <C>add_project_media</C>). Cue renders it, graphics included, and renders it again when that project changes: when you
				open this one, come back to Cue, or export. Its media has a Project badge that opens the source project.
			</p>

			<H2 id="relinking">Relinking moved media</H2>
			<p>
				When a project opens, Cue looks near the project for files that were moved. Anything still missing is shown as offline,
				with a bar over the editor:
			</p>
			<Ol>
				<li>
					Click <strong className="text-white">Relink media</strong>.
				</li>
				<li>
					Locate one missing file. Other missing files in the same folder are found with it.
				</li>
				<li>Or search a whole folder for the missing media.</li>
			</Ol>
			<p>When everything is found, the dialog says so and the bar goes away.</p>
			<Note>
				Agents see offline media in <C>get_state</C> and can fix it with <C>find_offline_media</C> or <C>relink_media</C>.
			</Note>

			<H2 id="history">History</H2>
			<p>
				<Kbd>⌘Z</Kbd> and <Kbd>⇧⌘Z</Kbd> undo and redo, for your edits and an agent&apos;s alike. Beyond that, every change is kept with
				who made it and when, in a hidden <C>.cue-history</C> folder next to the project (Cue adds it to <C>.gitignore</C>).
			</p>
			<Ul>
				<li>
					The <strong className="text-white">History</strong> panel lists every step, grouped by day, across sessions. Filter it to
					Everything, You or Agents.
				</li>
				<li>Each step shows which timeline it changed, so edits in nested or other sequences are easy to find.</li>
				<li>
					Click a step and choose <strong className="text-white">Go back to this point</strong> to restore the project to how it was right
					after it.
				</li>
				<li>
					Restoring is a step of its own, so <Kbd>⌘Z</Kbd> takes you back to where you were.
				</li>
			</Ul>
			<p>The Agent workspace (<Kbd>⌥6</Kbd>) docks the history beside the viewer, so you can follow what an agent changes as it works.</p>
		</DocPage>
	);
}
