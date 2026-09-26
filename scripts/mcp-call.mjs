// Calls Cue's MCP tools from the command line, the same way an agent does.
//   node scripts/mcp-call.mjs list
//   node scripts/mcp-call.mjs '[["get_state", {}], ["seek", {"ms": 5000}]]'
// Uses the repo build by default; set CUE_MCP to use another bridge (e.g. the installed app's).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridge = process.env.CUE_MCP ?? path.join(here, "..", "dist-mcp", "cue-mcp.mjs");
const client = new Client({ name: "cue-cli", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [bridge], env: { ...process.env } }));

const arg = process.argv[2] ?? "list";
if (arg === "list") {
	const { tools } = await client.listTools();
	for (const tool of tools) console.log(`${tool.name.padEnd(22)} ${tool.description?.split(". ")[0]}`);
} else {
	for (const [name, args] of JSON.parse(arg)) {
		const result = await client.callTool({ name, arguments: args });
		console.log(`== ${name}${result.isError ? " (error)" : ""}\n${result.content?.[0]?.text ?? ""}`);
	}
}
await client.close();
