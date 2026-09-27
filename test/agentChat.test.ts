import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Pictures are read with Electron's nativeImage; here a fake that knows a width and height.
vi.mock("electron", () => {
	const make = (width: number, height: number) => ({
		isEmpty: () => width === 0,
		getSize: () => ({ width, height }),
		resize: ({ width: w, height: h }: { width: number; height: number }) => make(w, h),
		toPNG: () => Buffer.from(`png ${width}x${height}`),
	});
	return {
		nativeImage: {
			createFromBuffer: (b: Buffer) => {
				const m = /^img (\d+)x(\d+)$/.exec(b.toString());
				return m ? make(Number(m[1]), Number(m[2])) : make(0, 0);
			},
		},
	};
});

import { isAttachment, loadChats, saveAttachment, saveChats } from "../electron/agents/chats";
import type { ChatEvent } from "../electron/agents/harness";

let dir: string;
let bin: string;

// Stand-ins for the agent CLIs, found through a fake login shell's PATH.
const FAKE_CLAUDE = `
const lines = [];
let turn = null;
const echo = (m) => console.log(JSON.stringify({ type: "user", isReplay: true, uuid: m.uuid, message: m.message }));
const say = (text) => console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }));
function runTurn() {
	const m = lines.shift();
	echo(m);
	const images = m.message.content.filter((c) => c.type === "image");
	say("images " + images.length + " " + images.map((c) => c.source.media_type).join(","));
	// "Work" for a moment; messages arriving meanwhile are read at the next step.
	turn = setTimeout(() => {
		while (lines.length) { const s = lines.shift(); echo(s); say("steered: " + s.message.content[0].text); }
		console.log(JSON.stringify({ type: "result", total_cost_usd: 0.01 }));
		turn = null;
		if (lines.length) runTurn();
	}, 400);
}
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }));
let buf = "";
process.stdin.on("data", (d) => {
	buf += d;
	let i;
	while ((i = buf.indexOf("\\n")) >= 0) {
		const line = buf.slice(0, i); buf = buf.slice(i + 1);
		if (!line.trim()) continue;
		lines.push(JSON.parse(line));
		if (!turn) runTurn();
	}
});
process.stdin.on("end", () => { if (!turn) process.exit(0); else setTimeout(() => process.exit(0), 500); });
`;
const FAKE_CODEX = `console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(process.argv.slice(2)) } }));`;
const FAKE_GEMINI = `console.log(JSON.stringify({ type: "message", role: "assistant", content: JSON.stringify(process.argv.slice(2)) })); console.log(JSON.stringify({ type: "result", status: "ok" }));`;

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-chat-"));
	bin = path.join(dir, "bin");
	await fs.mkdir(bin);
	for (const [name, body] of [
		["claude", FAKE_CLAUDE],
		["codex", FAKE_CODEX],
		["gemini", FAKE_GEMINI],
	]) {
		await fs.writeFile(path.join(bin, name), `#!${process.execPath}\n${body}`, { mode: 0o755 });
	}
	const shell = path.join(dir, "shell");
	await fs.writeFile(shell, `#!/bin/sh\nprintf "__PATH__%s" "${bin}"\n`, { mode: 0o755 });
	process.env.SHELL = shell;
});

afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

async function turn(
	harness: "claude" | "codex" | "gemini",
	prompt: string,
	images: string[] = [],
	during?: (handle: Awaited<ReturnType<typeof import("../electron/agents/harness").runHarness>>) => Promise<void>,
) {
	const { runHarness } = await import("../electron/agents/harness");
	const events: ChatEvent[] = [];
	let done: () => void = () => {};
	const finished = new Promise<void>((resolve) => {
		done = resolve;
	});
	const handle = await runHarness(
		{
			harness,
			prompt,
			images,
			uuid: "00000000-0000-4000-8000-000000000001",
			bridge: { command: "node", args: [], env: {} },
			workDir: path.join(dir, "work", harness),
		},
		(event) => {
			events.push(event);
			if (event.kind === "done") done();
		},
	);
	await during?.(handle);
	await finished;
	return { events, handle };
}

const texts = (events: ChatEvent[]) =>
	events.filter((e): e is Extract<ChatEvent, { kind: "text" }> => e.kind === "text").map((e) => e.text);

describe.skipIf(process.platform === "win32")("in-app agent chat", () => {
	it("hands Claude attached screenshots as pictures in the message", async () => {
		const png = path.join(dir, "shot.png");
		await fs.writeFile(png, "fake png");
		const { events } = await turn("claude", "What is wrong here?", [png, png]);
		expect(texts(events)).toContain("images 2 image/png,image/png");
		expect(events).toContainEqual({ kind: "ack", uuid: "00000000-0000-4000-8000-000000000001" });
		expect(events.filter((e) => e.kind === "done")).toEqual([{ kind: "done", costUsd: 0.01 }]);
	});

	it("lets the user steer Claude while it works, in the same turn", async () => {
		const { events, handle } = await turn("claude", "Tighten the edit", [], async (h) => {
			await new Promise((resolve) => setTimeout(resolve, 150));
			await h.steer?.("Keep the intro as it is", [], "00000000-0000-4000-8000-000000000002");
		});
		expect(texts(events)).toContain("steered: Keep the intro as it is");
		expect(events).toContainEqual({ kind: "ack", uuid: "00000000-0000-4000-8000-000000000002" });
		expect(events.filter((e) => e.kind === "done")).toHaveLength(1);
		// Once the turn is over, another message has to start a new one.
		await expect(handle.steer?.("too late", [], crypto.randomUUID())).rejects.toThrow();
	});

	it("gives Codex screenshots with --image and can't be steered mid-turn", async () => {
		const png = path.join(dir, "codex.png");
		await fs.writeFile(png, "fake png");
		const { events, handle } = await turn("codex", "Look", [png]);
		const argv = JSON.parse(texts(events)[0]) as string[];
		expect(argv.slice(argv.indexOf("-i"), argv.indexOf("-i") + 2)).toEqual(["-i", png]);
		expect(argv.at(-1)).toBe("Look");
		expect(handle.steer).toBeNull();
	});

	it("tells Gemini to look at screenshots with view_attachment", async () => {
		const { events } = await turn("gemini", "Look", ["/p/.cue-chat/attachments/a.png"]);
		const argv = JSON.parse(texts(events)[0]) as string[];
		const prompt = argv[argv.indexOf("-p") + 1];
		expect(prompt).toContain("view_attachment");
		expect(prompt).toContain('"/p/.cue-chat/attachments/a.png"');
	});

	it("keeps conversations and screenshots next to the project", async () => {
		const project = path.join(dir, "project");
		await fs.mkdir(project);
		expect(await loadChats(project)).toBeNull();
		await saveChats(project, { version: 1, chats: [{ id: "c1" }] });
		expect(await loadChats(project)).toEqual({ version: 1, chats: [{ id: "c1" }] });

		// Big screenshots are scaled to what agents read at full detail.
		const big = await saveAttachment(project, Buffer.from("img 3200x1800"));
		expect([big.width, big.height]).toEqual([1568, 882]);
		expect(big.path.startsWith(path.join(project, ".cue-chat", "attachments"))).toBe(true);
		const small = await saveAttachment(project, Buffer.from("img 800x600"));
		expect([small.width, small.height]).toEqual([800, 600]);
		await expect(saveAttachment(project, Buffer.from("not a picture"))).rejects.toThrow(/picture/);

		expect(isAttachment(project, big.path)).toBe(true);
		expect(isAttachment(project, path.join(project, "media", "x.png"))).toBe(false);
		expect(isAttachment(project, path.join(project, ".cue-chat", "attachments", "..", "chats.json"))).toBe(
			false,
		);
	});
});
