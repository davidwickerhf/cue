import { A, C, DocPage, H2, H3, Note, Ol, Table, Ul } from "@/components/docs/Prose";
import { doc } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";

const PAGE = doc("/docs/export");

export const metadata = pageMetadata({ title: PAGE.title, description: PAGE.description, path: PAGE.href });

const TOC = [
	{ id: "video", label: "Video presets" },
	{ id: "gif-and-sound", label: "GIF and sound only" },
	{ id: "variants", label: "Variants" },
	{ id: "other", label: "Frames, captions and stems" },
	{ id: "settings", label: "Export settings" },
	{ id: "timelines", label: "Timelines for other editors" },
];

export default function Page() {
	return (
		<DocPage
			href={PAGE.href}
			toc={TOC}
			intro={
				<p>
					The <strong className="text-white">Export</strong> button at the top right lists everything Cue can write: a video, the frame at
					the playhead, the voiceover, stems, the audio mix, captions and timelines for other editors. Files go to the
					project&apos;s <C>export</C> folder unless you pick another place.
				</p>
			}
		>
			<H2 id="video">Video presets</H2>
			<p>
				Choose <strong className="text-white">Video</strong> to open the export window. Pick a preset, then the whole timeline or just the part
				between your in and out points, and where to save.
			</p>
			<Table
				head={["Preset", "Format"]}
				rows={[
					["Web & YouTube", "H.264 MP4, high quality, full size"],
					["Smaller file", "HEVC MP4, standard quality, full size"],
					["Quick review", "H.264 MP4, draft quality, half size"],
					["Master", "ProRes MOV, for further editing"],
					["Animated GIF", "15 fps, up to 720 px wide, for short clips"],
					["Sound only", "AAC (.m4a) of the full mix"],
				]}
			/>
			<p>
				The window shows the size, frame rate and length before you start. H.264 and HEVC use the Mac&apos;s hardware encoder.
				When the export finishes, Cue shows the file in Finder.
			</p>

			<H2 id="gif-and-sound">GIF and sound only</H2>
			<Ul>
				<li>
					<strong className="text-white">Animated GIF</strong> suits short clips: mark in and out around the moment first.
				</li>
				<li>
					<strong className="text-white">Sound only</strong> saves the full mix, with ducking. It defaults to <C>.m4a</C>; change the
					extension in the save dialog to <C>.mp3</C>, <C>.wav</C> or <C>.flac</C> for those formats.
				</li>
			</Ul>

			<H2 id="variants">Variants</H2>
			<p>
				The <strong className="text-white">Variants</strong> tab of the export window makes other versions of the edit in one go, without
				changing your timeline. Each combination is exported as its own video.
			</p>
			<Table
				head={["Frame shape", "Size"]}
				rows={[
					["Vertical 9:16", "1080×1920"],
					["Square 1:1", "1080×1080"],
					["Portrait 4:5", "1080×1350"],
					["Wide 16:9", "1920×1080"],
				]}
			/>
			<Ul>
				<li>
					In another frame shape, pictures that filled the old frame fill the new one with a centre crop. Titles keep their place
					relative to the frame.
				</li>
				<li>
					<strong className="text-white">Shorter cuts</strong> of 15, 30 or 60 seconds end at the last cut before that length (or at the
					length itself if that cut is too early), and the ending fades out.
				</li>
				<li>
					<strong className="text-white">Also save each as a project</strong> keeps every variant as a project next to this one, to fine-tune
					later.
				</li>
			</Ul>
			<Note>
				For a short cut built from the best moments instead of the first ones, ask an agent: &quot;Make a 30 second vertical cut from
				the best moments.&quot; It finds the stretches worth keeping and passes them to <C>make_variants</C>.
			</Note>

			<H2 id="other">Frames, captions and stems</H2>
			<Table
				head={["Export menu item", "What you get"]}
				rows={[
					["Frame at the playhead", "A PNG of exactly what the viewer shows."],
					["Voiceover track", "The voiceover track as one WAV, full length."],
					[
						"Line stems",
						"One WAV per script line, plus durations.json, in the stems folder. Useful for handing narration to another tool.",
					],
					["Audio mix", "A WAV of every audible track, with ducking."],
					["Captions", "An SRT and a VTT file made from the caption clips."],
				]}
			/>

			<H2 id="settings">Export settings</H2>
			<p>The Export section of the project settings holds the defaults the export uses:</p>
			<Ul>
				<li>The video file name (<C>{"{name}"}</C> is the project name), codec (H.264, HEVC or ProRes), size, quality and hardware encoding.</li>
				<li>
					The stems folder and stem names (<C>{"{id}"}</C> and <C>{"{index}"}</C> are the line&apos;s id and number), and the captions and
					voiceover file names.
				</li>
				<li>
					<strong className="text-white">Normalise loudness</strong> for the exported mix.
				</li>
			</Ul>
			<p>Exports always use the original media, never the playback copies.</p>

			<H2 id="timelines">Timelines for other editors</H2>
			<p>
				<strong className="text-white">File → Export Timeline</strong> (or the Export menu) writes the edit for another editor, linking the
				original media:
			</p>
			<Table
				head={["Format", "Opens in", "Carries"]}
				rows={[
					[
						"OpenTimelineIO .otio",
						"DaVinci Resolve, Premiere (plug-in), Kdenlive, Avid",
						"Tracks, cuts, speed, titles, markers, nested sequences, adjustment layers, and Cue's clip settings",
					],
					[
						"FCPXML 1.10 .fcpxml",
						"Final Cut Pro, DaVinci Resolve",
						"Tracks as lanes, cuts, speed, volume, titles, markers, nested sequences as compound clips",
					],
					[
						"MLT XML .mlt",
						"Shotcut",
						"Tracks, cuts, speed, volume, titles, mute and hide, nested sequences, adjustment layers as colour filters",
					],
					["CMX3600 .edl", "Almost any editor", "The main video track and two audio tracks"],
				]}
			/>
			<H3>Importing a timeline</H3>
			<Ol>
				<li>
					Export OpenTimelineIO from the other editor (Resolve, Premiere with the plug-in, Kdenlive and others).
				</li>
				<li>
					In Cue, choose <strong className="text-white">File → Import Timeline (OTIO)…</strong> (⇧⌘I).
				</li>
				<li>
					The timeline comes in as new tracks, with nested sequences and adjustment layers rebuilt. Media is linked where it is.
				</li>
			</Ol>
			<p>
				See also <A href="/docs/projects-and-history">Projects and history</A> for where projects and exports are kept.
			</p>
		</DocPage>
	);
}
