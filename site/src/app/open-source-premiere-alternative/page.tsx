import { type UseCase, UseCasePage } from "@/components/UseCasePage";
import { pageMetadata } from "@/lib/metadata";

const page: UseCase = {
	path: "/open-source-premiere-alternative",
	name: "Open-source Premiere alternative",
	h1: "A free, open-source alternative to Premiere Pro on the Mac",
	intro:
		"Cue uses Premiere's shortcuts and ideas, from three-point editing to nested sequences, in an MIT-licensed editor with no account, subscription or watermark.",
	video: "nest",
	videoLabel: "Nesting clips into their own sequence in Cue",
	sections: [
		{
			title: "The keys you already know",
			body: (
				<p>
					J, K and L to shuttle, C for the blade, Y, N and U to slip, roll and slide, I and O for in and out, comma and period to
					insert and overwrite from the source monitor, semicolon and apostrophe to lift and extract, Q and W to ripple trim, and ⌘K
					to split. The full list is in Settings → Shortcuts.
				</p>
			),
		},
		{
			title: "Sequences, nesting and adjustment layers",
			body: (
				<p>
					Keep several timelines in one project and nest clips into their own sequence. Grade with LUTs or under an adjustment layer,
					add feathered masks and chroma key, and animate position, scale and volume with keyframes and speed ramps.
				</p>
			),
		},
		{
			title: "Move edits between editors",
			body: (
				<p>
					Export the timeline as OpenTimelineIO for DaVinci Resolve, Premiere (with its plug-in), Kdenlive or Avid, as FCPXML for
					Final Cut Pro and Resolve, as MLT for Shotcut, or as a CMX3600 EDL. OpenTimelineIO files can also be imported back into
					Cue.
				</p>
			),
		},
		{
			title: "What to expect",
			body: (
				<>
					<p>
						Projects are plain .cueproj JSON files with a full history of every change, and an AI agent can edit them with you.
					</p>
					<p>
						Cue is young: it runs on Apple Silicon Macs only and does not cover everything Premiere does. The changelog shows what is
						new, and issues on GitHub are the place for what you miss.
					</p>
				</>
			),
		},
	],
};

export const metadata = pageMetadata({
	title: "Open-source Premiere Pro alternative for Mac",
	description:
		"Cue is a free, MIT-licensed video editor for Apple Silicon Macs with Premiere's shortcuts, three-point editing, nested sequences and adjustment layers, plus OTIO and FCPXML export.",
	path: page.path,
});

export default function Page() {
	return <UseCasePage {...page} />;
}
