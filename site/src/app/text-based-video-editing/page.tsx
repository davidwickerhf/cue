import { type UseCase, UseCasePage } from "@/components/UseCasePage";
import { pageMetadata } from "@/lib/metadata";

const page: UseCase = {
	path: "/text-based-video-editing",
	name: "Text-based video editing",
	h1: "Text-based video editing: cut speech like a document",
	intro:
		"Cue transcribes your footage on your Mac, word by word. Delete words in the transcript and the matching video and sound are cut from every track at once.",
	video: "transcript",
	videoLabel: "Selecting words in the transcript to cut them in Cue",
	sections: [
		{
			title: "Transcribe on your Mac",
			body: (
				<p>
					Transcription runs locally with whisper.cpp, with models you can download in Settings, so nothing is uploaded. If you
					prefer, pick OpenAI for transcription instead in Settings → AI &amp; models.
				</p>
			),
		},
		{
			title: "Delete words to cut",
			body: (
				<p>
					Select words and delete them to cut them from every track, keeping picture and sound in sync. Filler words go in one
					click, and long pauses can be removed across the timeline.
				</p>
			),
		},
		{
			title: "Search, chapters and captions",
			body: (
				<p>
					Find a moment by what is said, even when you do not remember the exact words, generate chapters, and export captions as
					SRT or VTT. Search by meaning and chapters use Ollama or LM Studio on your Mac, or OpenAI.
				</p>
			),
		},
		{
			title: "Or ask an agent",
			body: (
				<p>
					An agent in Cue&apos;s Agent panel or any MCP client can do the same, for example: &quot;Transcribe the interview, cut the
					filler words and add captions.&quot; Each cut is a normal, undoable edit on the timeline.
				</p>
			),
		},
	],
};

export const metadata = pageMetadata({
	title: "Text-based video editing on Mac",
	description:
		"Edit video by editing its transcript in Cue, a free, open-source editor for Mac. Transcribe locally with Whisper, delete words to cut, remove filler words and export captions.",
	path: page.path,
});

export default function Page() {
	return <UseCasePage {...page} />;
}
