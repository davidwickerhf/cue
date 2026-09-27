import { REPO } from "@/lib/site";

export type FaqItem = {
	q: string;
	/** Plain-text answer, shown on the page and used for the FAQPage structured data. */
	a: string;
	/** Optionally turns the first occurrence of `text` in the answer into a link. */
	link?: { text: string; href: string };
};

export const FAQ: FaqItem[] = [
	{ q: "Is Cue free?", a: "Yes. Cue is free and open source under the MIT license, with no accounts, limits or watermarks." },
	{
		q: "Which AI agents work with Cue?",
		a: "The Agent panel runs Claude Code, Codex or Gemini CLI if you have them installed, signed in with your own account, with access to Cue's tools only. Any other MCP client can connect with one command, shown in Cue under Agent → Connect.",
	},
	{
		q: "Do I need an API key?",
		a: "No. Editing needs nothing, and transcription, voices and writing can run on your Mac with Whisper, macOS voices and Ollama or LM Studio. An OpenAI key adds cloud voices, captions and image generation.",
	},
	{
		q: "What platforms does Cue support?",
		a: "macOS 12 or later (Apple Silicon and Intel), Windows 10 and 11 (64-bit) and Linux (64-bit, as an AppImage or a .deb). Everything works everywhere except a few features that use macOS frameworks: cutting out subjects, searching shots by what they show, and pointer effects on screen recordings.",
	},
	{
		q: "Why does macOS warn me the first time I open it?",
		a: "It shouldn't any more: from 0.2.2 Cue is signed with a Developer ID and notarised by Apple, and it updates itself. Versions before 0.2.2 weren't, so they needed a right-click on Cue and Open the first time, and can't update: download 0.2.2 once by hand.",
	},
	{
		q: "How can I help?",
		a: "Star the repository, open issues with bugs and ideas, or send a pull request on GitHub.",
		link: { text: "GitHub", href: REPO },
	},
];
