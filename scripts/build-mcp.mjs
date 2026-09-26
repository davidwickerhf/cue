// Bundles the MCP bridge into one ESM file so it runs with plain `node`.
import { build } from "esbuild";

await build({
	entryPoints: ["mcp/cue-mcp.ts"],
	outfile: "dist-mcp/cue-mcp.mjs",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node20",
	banner: {
		js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
	},
	logLevel: "info",
});
