export const SITE_URL = "https://cue.wicker.life";
export const REPO = "https://github.com/davidwickerhf/cue";
/** Donations. */
export const KOFI = "https://ko-fi.com/davidwickerhf";
const LATEST = `${REPO}/releases/latest/download`;
/** Every build of the latest release (the file names never change between versions). */
export const DOWNLOADS = {
	macArm: `${LATEST}/Cue-mac-arm64.dmg`,
	macArmZip: `${LATEST}/Cue-mac-arm64.zip`,
	macIntel: `${LATEST}/Cue-mac-x64.dmg`,
	macIntelZip: `${LATEST}/Cue-mac-x64.zip`,
	windows: `${LATEST}/Cue-win-x64-setup.exe`,
	linuxAppImage: `${LATEST}/Cue-linux-x86_64.AppImage`,
	linuxDeb: `${LATEST}/Cue-linux-amd64.deb`,
} as const;
/** The Mac download (the default button before the visitor's system is known). */
export const DOWNLOAD = DOWNLOADS.macArmZip;
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
	"Cue is a free, open-source video editor for Mac, Windows and Linux. Edit by hand with Premiere-style shortcuts, or let Claude Code, Codex, Gemini CLI or any MCP client edit the same project with 110+ tools.";

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
