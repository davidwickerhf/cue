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
import { z } from "zod";
import { contract, type MethodName } from "../electron/control/contract";
import { AGENT_GUIDE } from "../electron/control/guide";

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

/**
 * Packaged: the bridge lives in Cue.app/Contents/Resources/mcp (macOS) or
 * <install dir>/resources/mcp (Windows, Linux). Dev: <repo>/dist-mcp. Cue also
 * records its own executable in app.json on every launch, which is how an
 * AppImage (whose files vanish when it quits) is found again.
 */
function launchApp(): void {
	const target = launchTarget();
	if (target)
		spawn(target.command, target.args, {
			cwd: target.cwd,
			detached: true,
			stdio: "ignore",
			env: target.env,
			windowsHide: true,
		}).unref();
}

function launchTarget(): {
	command: string;
	args: string[];
	cwd?: string;
	env: NodeJS.ProcessEnv;
} | null {
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	const start = (command: string, args: string[] = [], cwd?: string) => ({
		command,
		args,
		cwd,
		env,
	});
	if (process.platform === "darwin") {
		// Cue.app/Contents/Resources/mcp → Cue.app
		const bundle = path.resolve(here, "..", "..", "..");
		if (bundle.endsWith(".app")) return start("open", ["-a", bundle]);
		if (existsSync("/Applications/Cue.app") && !process.env.CUE_DEV)
			return start("open", ["-a", "/Applications/Cue.app"]);
	} else if (!process.env.CUE_DEV) {
		// <install dir>/resources/mcp → <install dir>/Cue.exe or cue
		const exe = path.join(
			path.resolve(here, "..", ".."),
			process.platform === "win32" ? "Cue.exe" : "cue",
		);
		if (path.basename(path.resolve(here, "..")) === "resources" && existsSync(exe))
			return start(exe);
		const recorded = recordedExecutable();
		if (recorded) return start(recorded);
	}
	const repo = path.resolve(here, "..");
	const electron =
		process.platform === "darwin"
			? path.join(
					repo,
					"node_modules",
					"electron",
					"dist",
					"Electron.app",
					"Contents",
					"MacOS",
					"Electron",
				)
			: path.join(
					repo,
					"node_modules",
					"electron",
					"dist",
					process.platform === "win32" ? "electron.exe" : "electron",
				);
	if (existsSync(electron)) return start(electron, [repo], repo);
	// npx is a .cmd on Windows, which needs a shell; there the dev app is started by hand.
	return process.platform === "win32" ? null : start("npx", ["electron", repo], repo);
}

/** The executable the last Cue launch recorded (app.json in the data folder). */
function recordedExecutable(): string | null {
	try {
		const { executable } = JSON.parse(readFileSync(path.join(dataDir, "app.json"), "utf8")) as {
			executable?: string;
		};
		return executable && existsSync(executable) ? executable : null;
	} catch {
		return null;
	}
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

/** Frames a result carries (render_frame, inspect_edit, or their result through wait_for). */
function framesOf(result: unknown): { atMs?: number; png: string }[] {
	if (!result || typeof result !== "object") return [];
	const r = result as { png?: unknown; frames?: unknown; status?: unknown };
	// Still running: there is nothing to show yet (wait_for brings the frames).
	if (r.status === "running") return [];
	if (typeof r.png === "string") return [{ png: r.png }];
	if (Array.isArray(r.frames))
		return r.frames.filter((f): f is { atMs?: number; png: string } => typeof f?.png === "string");
	return [];
}

function toolContent(_name: MethodName, result: unknown) {
	const text = { type: "text" as const, text: JSON.stringify(result, null, 2) };
	return [
		text,
		...framesOf(result).flatMap((frame) => [
			{ type: "text" as const, text: `Viewer at ${frame.atMs ?? "requested time"} ms` },
			{
				type: "image" as const,
				data: readFileSync(frame.png).toString("base64"),
				mimeType: "image/png" as const,
			},
		]),
	];
}

const server = new McpServer(
	{ name: "cue", version: VERSION },
	{
		instructions: AGENT_GUIDE,
	},
);

for (const [name, spec] of Object.entries(contract) as [
	MethodName,
	(typeof contract)[MethodName],
][]) {
	server.registerTool(
		name,
		// Strict, so a misspelt parameter is reported instead of silently dropped.
		{ description: spec.description, inputSchema: z.strictObject(spec.input) },
		async (args: unknown) => {
			try {
				const result = await rpc(name, args);
				return { content: toolContent(name, result) };
			} catch (error) {
				return {
					isError: true,
					content: [{ type: "text" as const, text: (error as Error).message }],
				};
			}
		},
	);
}

await server.connect(new StdioServerTransport());
