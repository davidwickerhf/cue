import { type ChildProcess, execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AGENT_GUIDE } from "../control/guide";

const run = promisify(execFile);

/**
 * Runs coding-agent CLIs the user already has (Claude Code, Codex, Gemini CLI)
 * as Cue's in-app assistant. Each run gets only Cue's MCP tools: no shell, no
 * file edits, no web. Their own sign-in and subscriptions are used as-is.
 */

export type HarnessId = "claude" | "codex" | "gemini";

export interface HarnessInfo {
	id: HarnessId;
	name: string;
	installed: boolean;
	path?: string;
	version?: string;
	/** How to install it, shown when it is missing. */
	install: string;
	models: { id: string; label: string }[];
}

export type ChatEvent =
	| { kind: "session"; sessionId: string }
	/** `delta` continues the previous text instead of starting a new paragraph. */
	| { kind: "text"; text: string; delta?: boolean }
	| {
			kind: "tool";
			id: string;
			name: string;
			status: "running" | "done" | "error";
			detail?: string;
	  }
	| { kind: "done"; error?: string; costUsd?: number };

export interface Bridge {
	command: string;
	args: string[];
	env: Record<string, string>;
}

const HARNESSES: Omit<HarnessInfo, "installed" | "path" | "version">[] = [
	{
		id: "claude",
		name: "Claude Code",
		install: "npm install -g @anthropic-ai/claude-code",
		models: [
			{ id: "", label: "Default" },
			{ id: "sonnet", label: "Sonnet" },
			{ id: "opus", label: "Opus" },
			{ id: "haiku", label: "Haiku (fast)" },
		],
	},
	{
		id: "codex",
		name: "Codex",
		install: "npm install -g @openai/codex",
		models: [{ id: "", label: "Default" }],
	},
	{
		id: "gemini",
		name: "Gemini CLI",
		install: "npm install -g @google/gemini-cli",
		models: [
			{ id: "", label: "Default" },
			{ id: "gemini-2.5-pro", label: "2.5 Pro" },
			{ id: "gemini-2.5-flash", label: "2.5 Flash (fast)" },
		],
	},
];

/** Guidance for the in-app chat: the full agent guide plus how to behave inside the editor. */
export const SYSTEM_PROMPT = `You are the editing assistant built into Cue: a professional video editor and motion designer working with the user. The user is looking at the editor while you work, and each message starts with what they see (playhead, selection, in/out). Act on ordinary edit requests without asking permission, since everything can be undone; confirm before deleting large parts of the edit or overwriting exported files.

How you work: a one-step request, just do it and say what changed. Anything bigger: (1) look first (the timeline, transcripts, detect_activity for screen recordings), (2) choose the techniques the moment needs from "When to use what" and the 'editing-techniques' playbook, (3) tell the user the plan in two to four short lines, (4) build it, (5) check it (render_frame, inspect_edit, review_edit, loudness) and report what you did and what they might adjust. Get missing assets yourself (library, generate, find) instead of asking for them. Write replies in short markdown: a sentence, then bullets with times as m:ss.

${AGENT_GUIDE}`;

/** GUI apps on macOS start with a minimal PATH; use the login shell's instead. */
let shellPath: Promise<string> | null = null;
function loginPath(): Promise<string> {
	shellPath ??= (async () => {
		if (process.platform === "win32")
			return [
				process.env.PATH ?? "",
				path.join(process.env.APPDATA ?? os.homedir(), "npm"),
				path.join(os.homedir(), ".local", "bin"),
				path.join(os.homedir(), ".bun", "bin"),
			].join(path.delimiter);
		const extra = [
			path.join(os.homedir(), ".local/bin"),
			"/opt/homebrew/bin",
			"/usr/local/bin",
			path.join(os.homedir(), ".npm-global/bin"),
			path.join(os.homedir(), ".bun/bin"),
		];
		try {
			const shell = process.env.SHELL || "/bin/zsh";
			const { stdout } = await run(shell, ["-ilc", 'printf "__PATH__%s" "$PATH"'], {
				timeout: 5000,
			});
			const found = stdout.split("__PATH__").pop()?.trim();
			if (found) return [found, ...extra].join(":");
		} catch {}
		return [process.env.PATH ?? "", ...extra].join(":");
	})();
	return shellPath;
}

async function childEnv(): Promise<NodeJS.ProcessEnv> {
	const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
	return { ...env, PATH: await loginPath() };
}

/** How to start a CLI: the file found on PATH, and the command that runs it. */
interface Launcher {
	path: string;
	command: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
}

async function which(bin: string): Promise<Launcher | null> {
	const names = process.platform === "win32" ? [`${bin}.exe`, `${bin}.cmd`] : [bin];
	for (const dir of (await loginPath()).split(path.delimiter)) {
		if (!dir) continue;
		for (const name of names) {
			const candidate = path.join(dir, name);
			try {
				await fs.access(
					candidate,
					process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
				);
			} catch {
				continue;
			}
			if (!candidate.endsWith(".cmd")) return { path: candidate, command: candidate, args: [] };
			const launcher = await npmShim(candidate);
			if (launcher) return launcher;
		}
	}
	return null;
}

/**
 * Windows: npm installs CLIs as .cmd shims, which can't be started without a
 * shell (and a shell would reinterpret the prompt). Run the script the shim
 * points at with Cue's own Node runtime instead.
 */
async function npmShim(file: string): Promise<Launcher | null> {
	const text = await fs.readFile(file, "utf8").catch(() => "");
	const script = /"%dp0%\\([^"]+?\.[cm]?js)"/i.exec(text)?.[1];
	if (!script) return null;
	return {
		path: file,
		command: process.execPath,
		args: [path.join(path.dirname(file), script)],
		env: { ELECTRON_RUN_AS_NODE: "1" },
	};
}

export async function detectHarnesses(): Promise<HarnessInfo[]> {
	const env = await childEnv();
	return Promise.all(
		HARNESSES.map(async (h) => {
			const found = await which(h.id);
			if (!found) return { ...h, installed: false };
			let version: string | undefined;
			try {
				const { stdout } = await run(found.command, [...found.args, "--version"], {
					timeout: 8000,
					env: { ...env, ...found.env },
				});
				version = stdout
					.trim()
					.split("\n")[0]
					?.replace(/\s*\(.*\)$/, "");
			} catch {}
			return { ...h, installed: true, path: found.path, version };
		}),
	);
}

export interface RunOptions {
	harness: HarnessId;
	prompt: string;
	/** Continue an earlier conversation with this harness. */
	sessionId?: string;
	model?: string;
	bridge: Bridge;
	/** A stable working folder per harness: sessions are resumed by folder. */
	workDir: string;
}

/** Starts one turn. Events stream to `onEvent`; `stop()` cancels it. */
export async function runHarness(options: RunOptions, onEvent: (event: ChatEvent) => void) {
	const bin = await which(options.harness);
	if (!bin) throw new Error(`${options.harness} is not installed.`);
	const env = await childEnv();
	const work = options.workDir;
	await fs.mkdir(work, { recursive: true });
	const { args, parse, cwd } = await prepare(options, work);
	const child: ChildProcess = spawn(bin.command, [...bin.args, ...args], {
		cwd,
		env: { ...env, ...bin.env },
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	let buffer = "";
	let stderr = "";
	let finished = false;
	const finish = (event: Extract<ChatEvent, { kind: "done" }>) => {
		if (finished) return;
		finished = true;
		onEvent(event);
	};
	child.stdout?.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf8");
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			newline = buffer.indexOf("\n");
			if (!line.startsWith("{")) continue;
			try {
				for (const event of parse(JSON.parse(line))) {
					if (event.kind === "done") finish(event);
					else onEvent(event);
				}
			} catch {}
		}
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		stderr = (stderr + chunk.toString("utf8")).slice(-4000);
	});
	child.on("error", (error) => finish({ kind: "done", error: error.message }));
	child.on("close", (code, signal) => {
		if (signal) finish({ kind: "done", error: "Stopped" });
		else if (code) finish({ kind: "done", error: lastLine(stderr) || `Exited with code ${code}` });
		else finish({ kind: "done" });
	});
	return {
		stop() {
			child.kill("SIGTERM");
		},
	};
}

function lastLine(text: string) {
	return text
		.trim()
		.split("\n")
		.filter((l) => l.trim() && !/^\s*at\s/.test(l))
		.slice(-2)
		.join(" ")
		.slice(0, 400);
}

type Parser = (event: Record<string, unknown>) => ChatEvent[];

async function prepare(
	{ harness, prompt, sessionId, model, bridge }: RunOptions,
	work: string,
): Promise<{ args: string[]; parse: Parser; cwd: string }> {
	if (harness === "claude") {
		const config = path.join(work, "mcp.json");
		await fs.writeFile(config, JSON.stringify({ mcpServers: { cue: bridge } }));
		const args = [
			"-p",
			prompt,
			"--output-format",
			"stream-json",
			"--verbose",
			"--mcp-config",
			config,
			"--strict-mcp-config",
			// No built-in tools (shell, files, web) and none of the user's own settings: Cue only.
			"--tools",
			"",
			"--setting-sources",
			"",
			"--allowedTools",
			"mcp__cue",
			"--append-system-prompt",
			SYSTEM_PROMPT,
		];
		if (model) args.push("--model", model);
		if (sessionId) args.push("--resume", sessionId);
		return { args, parse: parseClaude, cwd: work };
	}
	if (harness === "codex") {
		const toml = (value: unknown) => JSON.stringify(value);
		const env = `{${Object.entries(bridge.env)
			.map(([k, v]) => `${k}=${toml(v)}`)
			.join(",")}}`;
		const locked = [
			"shell_tool",
			"unified_exec",
			"apps",
			"browser_use",
			"computer_use",
			"js_repl",
			"plugins",
			"image_generation",
			"hooks",
			"multi_agent",
			"view_image",
			"in_app_browser",
			"skill_mcp_dependency_install",
			"workspace_dependencies",
			"worktrees",
			"sleep_tool",
			"goals",
			"tool_suggest",
			"skill_search",
		].flatMap((f) => ["--disable", f]);
		const common = [
			"--json",
			"--skip-git-repo-check",
			// Not the user's config.toml (their MCP servers, hooks, profiles) nor exec rules: Cue only.
			"--ignore-user-config",
			"--ignore-rules",
			...locked,
			// As a setting rather than -s, so resumed sessions stay read-only too.
			"-c",
			'sandbox_mode="read-only"',
			"-c",
			'web_search="disabled"',
			"-c",
			`mcp_servers.cue.command=${toml(bridge.command)}`,
			"-c",
			`mcp_servers.cue.args=${toml(bridge.args)}`,
			"-c",
			`mcp_servers.cue.env=${env}`,
			"-c",
			'mcp_servers.cue.default_tools_approval_mode="approve"',
			"-c",
			`developer_instructions=${toml(SYSTEM_PROMPT)}`,
			...(model ? ["-m", model] : []),
		];
		const args = sessionId
			? ["exec", "resume", ...common, sessionId, prompt]
			: ["exec", "-C", work, ...common, prompt];
		return { args, parse: parseCodex, cwd: work };
	}
	// Gemini CLI reads MCP servers and tool limits from .gemini/settings.json in its working folder.
	await fs.mkdir(path.join(work, ".gemini"), { recursive: true });
	await fs.writeFile(
		path.join(work, ".gemini", "settings.json"),
		JSON.stringify({
			mcpServers: { cue: { ...bridge, trust: true } },
			excludeTools: [
				"run_shell_command",
				"write_file",
				"replace",
				"read_file",
				"read_many_files",
				"glob",
				"search_file_content",
				"list_directory",
				"web_fetch",
				"google_web_search",
				"save_memory",
			],
		}),
	);
	await fs.writeFile(path.join(work, "GEMINI.md"), SYSTEM_PROMPT);
	const args = [
		"-p",
		prompt,
		"--output-format",
		"stream-json",
		"--allowed-mcp-server-names",
		"cue",
	];
	if (model) args.push("--model", model);
	if (sessionId) args.push("--resume", sessionId);
	return { args, parse: parseGemini, cwd: work };
}

const short = (value: unknown) => {
	const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
	return text.length > 160 ? `${text.slice(0, 157)}…` : text;
};
const toolName = (name: string) => name.replace(/^mcp__cue__|^cue__|^mcp_cue_/, "");

const parseClaude: Parser = (e) => {
	const out: ChatEvent[] = [];
	if (e.type === "system" && e.subtype === "init" && typeof e.session_id === "string")
		out.push({ kind: "session", sessionId: e.session_id });
	const message = e.message as { content?: Record<string, unknown>[] } | undefined;
	if (e.type === "assistant")
		for (const c of message?.content ?? []) {
			if (c.type === "text" && typeof c.text === "string" && c.text.trim())
				out.push({ kind: "text", text: c.text });
			if (c.type === "tool_use")
				out.push({
					kind: "tool",
					id: String(c.id),
					name: toolName(String(c.name)),
					status: "running",
					detail: short(c.input),
				});
		}
	if (e.type === "user")
		for (const c of message?.content ?? [])
			if (c.type === "tool_result")
				out.push({
					kind: "tool",
					id: String(c.tool_use_id),
					name: "",
					status: c.is_error ? "error" : "done",
					detail: c.is_error ? short(c.content) : undefined,
				});
	if (e.type === "result")
		out.push({
			kind: "done",
			error: e.is_error ? short(e.result ?? e.subtype) : undefined,
			costUsd: typeof e.total_cost_usd === "number" ? e.total_cost_usd : undefined,
		});
	return out;
};

const parseCodex: Parser = (e) => {
	const out: ChatEvent[] = [];
	if (e.type === "thread.started" && typeof e.thread_id === "string")
		out.push({ kind: "session", sessionId: e.thread_id });
	const item = e.item as Record<string, unknown> | undefined;
	if (item?.type === "agent_message" && e.type === "item.completed")
		out.push({ kind: "text", text: String(item.text ?? "") });
	if (item?.type === "mcp_tool_call") {
		const failed = !!item.error || item.status === "failed";
		out.push({
			kind: "tool",
			id: String(item.id),
			name: String(item.tool ?? ""),
			status: e.type === "item.started" ? "running" : failed ? "error" : "done",
			detail: failed
				? short((item.error as { message?: string })?.message)
				: e.type === "item.started"
					? short(item.arguments)
					: undefined,
		});
	}
	if (e.type === "turn.failed" || e.type === "error")
		out.push({
			kind: "done",
			error: short((e.error as { message?: string })?.message ?? e.message),
		});
	return out;
};

const parseGemini: Parser = (e) => {
	const out: ChatEvent[] = [];
	if (e.type === "init" && typeof e.session_id === "string")
		out.push({ kind: "session", sessionId: e.session_id });
	if (e.type === "message" && e.role === "assistant" && typeof e.content === "string")
		out.push({ kind: "text", text: e.content, delta: e.delta === true });
	if (e.type === "tool_use")
		out.push({
			kind: "tool",
			id: String(e.tool_id),
			name: toolName(String(e.tool_name)),
			status: "running",
			detail: short(e.parameters),
		});
	if (e.type === "tool_result")
		out.push({
			kind: "tool",
			id: String(e.tool_id),
			name: "",
			status: e.status === "error" ? "error" : "done",
		});
	if (e.type === "result")
		out.push({ kind: "done", error: e.status === "error" ? short(e.error) : undefined });
	return out;
};
