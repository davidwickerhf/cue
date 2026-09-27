/**
 * How to connect each MCP client to Cue: a terminal command where the client has
 * one, else the JSON it reads. Shown in the app (with the real path of the MCP
 * server) and, with the path in /Applications, on the website.
 */
export interface McpClient {
	id: string;
	label: string;
	/** A command to run once in a terminal, or JSON to add to a config file. */
	kind: "command" | "config";
	text: string;
	/** Where it goes or what it does, in a few words. */
	note: string;
}

export function mcpClients(script: string): McpClient[] {
	const json = (wrapper: string) =>
		JSON.stringify({ [wrapper]: { cue: { command: "node", args: [script] } } }, null, 2);
	return [
		{
			id: "claude",
			label: "Claude Code",
			kind: "command",
			text: `claude mcp add --scope user cue -- node "${script}"`,
			note: "Run once in a terminal; Cue is then available in every folder.",
		},
		{
			id: "codex",
			label: "Codex",
			kind: "command",
			text: `codex mcp add cue -- node "${script}"`,
			note: "Run once in a terminal (OpenAI Codex CLI).",
		},
		{
			id: "gemini",
			label: "Gemini CLI",
			kind: "command",
			text: `gemini mcp add --scope user cue node "${script}"`,
			note: "Run once in a terminal.",
		},
		{
			id: "vscode",
			label: "VS Code",
			kind: "command",
			text: `code --add-mcp '${JSON.stringify({ name: "cue", command: "node", args: [script] })}'`,
			note: "Adds Cue for GitHub Copilot's agent mode in VS Code.",
		},
		{
			id: "cursor",
			label: "Cursor",
			kind: "config",
			text: json("mcpServers"),
			note: "Add to ~/.cursor/mcp.json (merge into mcpServers if the file exists).",
		},
		{
			id: "claude-desktop",
			label: "Claude Desktop",
			kind: "config",
			text: json("mcpServers"),
			note: "Add to ~/Library/Application Support/Claude/claude_desktop_config.json, then restart Claude.",
		},
		{
			id: "other",
			label: "Other",
			kind: "config",
			text: `command: node\nargs:    ${script}`,
			note: "Any MCP client that starts a local (stdio) server: run node with this file.",
		},
	];
}
