/** The docs pages, in reading order. Drives the sidebar, the pager and the sitemap. */
export type DocLink = { href: string; title: string; description: string };

export const DOCS_GROUPS: { title: string; pages: DocLink[] }[] = [
	{
		title: "Guide",
		pages: [
			{
				href: "/docs",
				title: "Overview",
				description: "How the Cue documentation is organised and where to start.",
			},
			{
				href: "/docs/getting-started",
				title: "Getting started",
				description: "Install Cue, make a project, import media and find your way around the editor and its workspaces.",
			},
			{
				href: "/docs/editing",
				title: "Editing",
				description: "Tools, keyboard shortcuts, trimming, ripple edits, three-point editing, markers, sequences and text-based editing.",
			},
			{
				href: "/docs/look-and-motion",
				title: "Look and motion",
				description: "Transform, keyframes, zooms, colour, LUTs, effects, masks, chroma key, adjustment layers, transitions and scopes.",
			},
			{
				href: "/docs/titles-and-captions",
				title: "Titles and captions",
				description: "Title templates, text styles and animations, word-by-word captions and automatic captions.",
			},
			{
				href: "/docs/audio",
				title: "Audio",
				description: "The mixer, ducking, voiceover recording and takes, denoise, loudness and beat detection.",
			},
			{
				href: "/docs/ai-and-agents",
				title: "AI and agents",
				description: "Chat with Claude Code, Codex or Gemini in Cue, connect any MCP client, review agent edits, and choose local or cloud models.",
			},
			{
				href: "/docs/export",
				title: "Export",
				description: "Export presets, GIF, sound only, variants, captions, stems and timelines for other editors.",
			},
			{
				href: "/docs/projects-and-history",
				title: "Projects and history",
				description: "Project files, the projects overview, relinking moved media, and the history of every change.",
			},
		],
	},
	{
		title: "Reference",
		pages: [
			{
				href: "/docs/tools",
				title: "Agent tool reference",
				description: "Every tool Cue gives AI agents over MCP and in the Agent panel, with its inputs.",
			},
		],
	},
];

export const DOCS: DocLink[] = DOCS_GROUPS.flatMap((g) => g.pages);

export function doc(href: string): DocLink {
	const found = DOCS.find((d) => d.href === href);
	if (!found) throw new Error(`No docs page ${href}`);
	return found;
}
