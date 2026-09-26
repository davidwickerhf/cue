import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({ command: "node", args: ["/Users/davidwickerhf/Projects/personal/cue/dist-mcp/cue-mcp.mjs"], env: { ...process.env, CUE_DEV: "1" } });
const client = new Client({ name: "test", version: "1" });
await client.connect(transport);
const calls = JSON.parse(process.argv[2]);
if (calls === "list") { const t = await client.listTools(); console.log(t.tools.length, t.tools.map(x=>x.name).join(", ")); process.exit(0); }
for (const [name, args] of calls) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  console.log(`== ${name}${r.isError ? " ERROR" : ""}\n${text.slice(0, 1500)}`);
}
process.exit(0);
