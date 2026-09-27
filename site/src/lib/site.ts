export const SITE_URL = "https://cue.wicker.life";
export const REPO = "https://github.com/davidwickerhf/cue";
/** Donations. */
export const KOFI = "https://ko-fi.com/davidwickerhf";
export const DOWNLOAD = `${REPO}/releases/latest/download/Cue-mac-arm64.zip`;
/** Cue's MCP server inside the installed app. */
export const MCP_SCRIPT = "/Applications/Cue.app/Contents/Resources/mcp/cue-mcp.mjs";
export const MCP_COMMAND = `claude mcp add --scope user cue -- node "${MCP_SCRIPT}"`;

export const AUTHOR = {
	name: "David Henry Francis Wicker",
	url: "https://wicker.life",
	github: "https://github.com/davidwickerhf",
};

export const TAGLINE = "The video editor your AI agent can drive";
export const DESCRIPTION =
	"Cue is a free, open-source video editor for macOS on Apple Silicon. Edit by hand with Premiere-style shortcuts, or let Claude Code, Codex, Gemini CLI or any MCP client edit the same project with 110+ tools.";

/** Demo videos in public/videos (each has a .mp4 and a 1280x720 .jpg poster). */
export const DEMOS = ["edit", "agent", "transcript", "titles", "look", "audio", "nest", "projects"] as const;
export type Demo = (typeof DEMOS)[number];

/** Pages people search for, linked from the footer and listed in the sitemap. */
export const USE_CASES: { href: string; label: string }[] = [
	{ href: "/ai-video-editor-mac", label: "AI video editor for Mac" },
	{ href: "/open-source-premiere-alternative", label: "Open-source Premiere alternative" },
	{ href: "/edit-video-with-claude-code", label: "Edit video with Claude Code" },
	{ href: "/text-based-video-editing", label: "Text-based video editing" },
];

/** The shared preview image (app/opengraph-image.tsx). */
export const OG_IMAGE = {
	url: "/opengraph-image",
	width: 1200,
	height: 630,
	alt: "Cue, the open-source video editor for macOS that your AI agent can drive",
};
