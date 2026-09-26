import { type UseCase, UseCasePage } from "@/components/UseCasePage";
import { pageMetadata } from "@/lib/metadata";

const page: UseCase = {
	path: "/ai-video-editor-mac",
	name: "AI video editor for Mac",
	h1: "An AI video editor for Mac where you keep the final say",
	intro:
		"Cue is a free, open-source video editor for Apple Silicon Macs. An AI agent can make the edits you ask for, and every one lands on the same timeline you edit by hand, where you can see it and undo it.",
	video: "edit",
	videoLabel: "Editing a trailer on the Cue timeline",
	sections: [
		{
			title: "Ask an agent inside the editor",
			body: (
				<p>
					The Agent panel runs Claude Code, Codex or Gemini CLI, whichever you have installed, signed in with your own account. It
					sees your playhead and selection, and each run gets Cue&apos;s editing tools only: no shell, files or web. Right-click a
					clip and choose Ask the agent about this to start from it.
				</p>
			),
		},
		{
			title: "AI edits are ordinary edits",
			body: (
				<p>
					The editor, the in-app chat and the MCP server all go through one set of actions, so an agent&apos;s change is recorded,
					attributed and undoable like yours. The History panel keeps every step across sessions, with who made it.
				</p>
			),
		},
		{
			title: "Models on your Mac, or in the cloud",
			body: (
				<p>
					Transcribe with whisper.cpp, generate voices with macOS voices, and rewrite, find chapters or search by meaning with Ollama
					or LM Studio, all on your Mac. Add an OpenAI key for cloud voices, captions and images. Keys are kept in your keychain,
					and footage stays on your Mac unless you pick a cloud model.
				</p>
			),
		},
		{
			title: "A real editor underneath",
			body: (
				<p>
					A multi-track timeline with Premiere-style tools and shortcuts, titles, colour, masks, a mixer with ducking, and hardware
					H.264, HEVC and ProRes export. Editing needs no account, no API key and no internet connection.
				</p>
			),
		},
	],
};

export const metadata = pageMetadata({
	title: "AI video editor for Mac",
	description:
		"Cue is a free, open-source AI video editor for Apple Silicon Macs. Ask Claude Code, Codex or Gemini to edit, run Whisper and local models on your Mac, and undo anything.",
	path: page.path,
});

export default function Page() {
	return <UseCasePage {...page} />;
}
