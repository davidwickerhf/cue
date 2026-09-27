import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { nativeImage } from "electron";

/**
 * The in-app agent's conversations, kept next to the project they are about
 * (so they move with it) in .cue-chat/: chats.json and the screenshots attached
 * to messages. Not included when a project is packaged to share.
 */
export const CHAT_DIR = ".cue-chat";

/** Longest side of an attached picture: what agents read at full detail anyway. */
const MAX_SIDE = 1568;

const chatsFile = (projectDir: string) => path.join(projectDir, CHAT_DIR, "chats.json");

export async function loadChats(projectDir: string): Promise<unknown> {
	try {
		return JSON.parse(await fs.readFile(chatsFile(projectDir), "utf8"));
	} catch {
		return null;
	}
}

/** Written to a temporary file first, so a crash mid-write never loses the history. */
export async function saveChats(projectDir: string, data: unknown) {
	const file = chatsFile(projectDir);
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temp, JSON.stringify(data));
	await fs.rename(temp, file);
}

/** Stores a picture (PNG, JPEG…) as a PNG no larger than agents can use; returns its path. */
export async function saveAttachment(projectDir: string, bytes: Buffer | Uint8Array) {
	let image = nativeImage.createFromBuffer(Buffer.from(bytes));
	if (image.isEmpty()) throw new Error("That file isn't a picture Cue can read (use PNG or JPEG).");
	const { width, height } = image.getSize();
	const scale = MAX_SIDE / Math.max(width, height);
	if (scale < 1)
		image = image.resize({
			width: Math.round(width * scale),
			height: Math.round(height * scale),
			quality: "best",
		});
	const dir = path.join(projectDir, CHAT_DIR, "attachments");
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(
		dir,
		`${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}.png`,
	);
	await fs.writeFile(file, image.toPNG());
	const size = image.getSize();
	return { path: file, width: size.width, height: size.height };
}

/** Whether a path is a picture attached in this project's chats (what view_attachment may show). */
export function isAttachment(projectDir: string, file: string) {
	const dir = path.join(path.resolve(projectDir), CHAT_DIR, "attachments") + path.sep;
	const resolved = path.resolve(file);
	return resolved.startsWith(dir) && resolved.endsWith(".png");
}
