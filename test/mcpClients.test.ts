import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mcpClients } from "../electron/core/mcpClients";

describe("connecting MCP clients", () => {
	it("gives each client a command or config with the server's path", () => {
		const script = "/Applications/Cue.app/Contents/Resources/mcp/cue-mcp.mjs";
		const clients = mcpClients(script);
		expect(clients.map((c) => c.id)).toEqual(
			expect.arrayContaining(["claude", "codex", "gemini", "cursor", "claude-desktop", "vscode"]),
		);
		for (const c of clients) expect(c.text).toContain(script);
		const cursor = clients.find((c) => c.id === "cursor");
		expect(JSON.parse(cursor?.text ?? "")).toEqual({
			mcpServers: { cue: { command: "node", args: [script] } },
		});
	});

	it("is the same list on the website", () => {
		expect(readFileSync("site/src/lib/mcpClients.ts", "utf8")).toBe(
			readFileSync("electron/core/mcpClients.ts", "utf8"),
		);
	});
});
