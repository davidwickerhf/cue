import { Command, type UseCase, UseCasePage } from "@/components/UseCasePage";
import { pageMetadata } from "@/lib/metadata";
import { MCP_COMMAND } from "@/lib/site";

const PROMPTS = [
	"Transcribe the interview, cut the filler words and add captions.",
	"Find where they talk about pricing and make that the opening.",
	"Mark the beats in the music and move the cuts onto them.",
	"Make a vertical version and follow the speaker with the crop.",
	"Render the frame at 1:15 and tell me if the title is readable.",
];

const page: UseCase = {
	path: "/edit-video-with-claude-code",
	name: "Edit video with Claude Code",
	h1: "Edit video with Claude Code, Codex or any MCP client",
	intro:
		"Cue ships an MCP server with 110+ editing tools, so an agent can cut, title, caption, grade and export a real project while you watch it happen on the timeline.",
	video: "agent",
	videoLabel: "An agent adding a title from the chat panel in Cue",
	sections: [
		{
			title: "Connect in one command",
			body: (
				<>
					<p>With Cue in Applications, run this once:</p>
					<Command>{MCP_COMMAND}</Command>
					<p>
						The server starts Cue when needed and sends every client a written guide to editing in Cue. The command for other
						MCP clients is shown in Cue under Agent → Connect.
					</p>
				</>
			),
		},
		{
			title: "Things to ask",
			body: (
				<ul className="flex list-disc flex-col gap-1.5 pl-5">
					{PROMPTS.map((p) => (
						<li key={p}>{p}</li>
					))}
				</ul>
			),
		},
		{
			title: "Or skip setup with the Agent panel",
			body: (
				<p>
					Inside Cue, the Agent panel runs Claude Code, Codex or Gemini CLI if you have them installed, signed in with your own
					account. It sees your playhead and selection, and each run gets Cue&apos;s tools only, with no shell, files or web.
				</p>
			),
		},
		{
			title: "The same actions as the editor",
			body: (
				<p>
					One contract defines every action in Cue, and the editor, the chat and the MCP server all use it. That means the agent can
					do anything you can, and its edits are recorded, attributed and undoable like yours.
				</p>
			),
		},
	],
};

export const metadata = pageMetadata({
	title: "Edit video with Claude Code and MCP",
	description:
		"Connect Claude Code, Codex, Gemini CLI or any MCP client to Cue, a free video editor for Mac, in one command. 110+ tools to cut, caption, grade and export, all undoable.",
	path: page.path,
});

export default function Page() {
	return <UseCasePage {...page} />;
}
