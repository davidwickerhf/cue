#!/usr/bin/env node
/**
 * MCP bridge for Cue. Runs over stdio, finds the running app through
 * control.json (launching Cue when needed) and forwards every tool call to the
 * app's loopback control server. Tools are generated from the shared contract.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { contract, type MethodName } from "../electron/control/contract";

const VERSION = "0.1.0";
const dataDir =
	process.env.CUE_DATA_DIR ??
	(process.platform === "darwin"
		? path.join(os.homedir(), "Library", "Application Support", "Cue")
		: process.platform === "win32"
			? path.join(process.env.APPDATA ?? os.homedir(), "Cue")
			: path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "Cue"));
const controlFile = path.join(dataDir, "control.json");
const here = path.dirname(fileURLToPath(import.meta.url));

interface Control {
	port: number;
	token: string;
}

function readControl(): Control | null {
	try {
		return JSON.parse(readFileSync(controlFile, "utf8")) as Control;
	} catch {
		return null;
	}
}

async function healthy(control: Control | null): Promise<boolean> {
	if (!control) return false;
	try {
		const res = await fetch(`http://127.0.0.1:${control.port}/health`, {
			headers: { authorization: `Bearer ${control.token}` },
			signal: AbortSignal.timeout(1500),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** Packaged: the bridge lives in Cue.app/Contents/Resources/mcp. Dev: <repo>/dist-mcp. */
function launchApp(): void {
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	const bundle = path.resolve(here, "..", "..");
	if (bundle.endsWith(".app")) {
		spawn("open", ["-a", bundle], { detached: true, stdio: "ignore", env }).unref();
		return;
	}
	if (existsSync("/Applications/Cue.app") && !process.env.CUE_DEV) {
		spawn("open", ["-a", "/Applications/Cue.app"], { detached: true, stdio: "ignore", env }).unref();
		return;
	}
	const repo = path.resolve(here, "..");
	const electron = path.join(repo, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
	spawn(existsSync(electron) ? electron : "npx", existsSync(electron) ? [repo] : ["electron", repo], {
		cwd: repo,
		detached: true,
		stdio: "ignore",
		env,
	}).unref();
}

async function connect(): Promise<Control> {
	const current = readControl();
	if (await healthy(current)) return current as Control;
	launchApp();
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 500));
		const next = readControl();
		if (await healthy(next)) return next as Control;
	}
	throw new Error("Cue did not start. Open the Cue app and try again.");
}

async function rpc(method: MethodName, params: unknown): Promise<unknown> {
	const control = await connect();
	const res = await fetch(`http://127.0.0.1:${control.port}/rpc`, {
		method: "POST",
		headers: { authorization: `Bearer ${control.token}`, "content-type": "application/json" },
		body: JSON.stringify({ method, params }),
	});
	const body = (await res.json()) as { result?: unknown; error?: string };
	if (body.error) throw new Error(body.error);
	return body.result;
}

const server = new McpServer(
	{ name: "cue", version: VERSION },
	{
		instructions:
			"Cue is a desktop video editor for recording voiceover over a script. Call get_state first. " +
			"Script lines have startMs/targetMs/maxMs on the video timeline; a take fits when its speech is shorter than maxMs. " +
			"record_line uses the user's microphone, so tell the user which line is about to roll before calling it. " +
			"Use export kind 'stems' to hand clips to another pipeline (one WAV per line plus durations.json).",
	},
);

for (const [name, spec] of Object.entries(contract) as [MethodName, (typeof contract)[MethodName]][]) {
	server.registerTool(name, { description: spec.description, inputSchema: spec.input }, async (args: unknown) => {
		try {
			const result = await rpc(name, args);
			return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
		} catch (error) {
			return { isError: true, content: [{ type: "text" as const, text: (error as Error).message }] };
		}
	});
}

await server.connect(new StdioServerTransport());
