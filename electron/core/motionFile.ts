import { promises as fs } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { isLottie, type LottieJson } from "./motion";

/** Reading motion graphics from disk (the rest of motion.ts also runs in the editor window). */

/** The files in a zip archive (stored or deflated entries, which is all .lottie files use). */
export function readZip(buffer: Buffer): Map<string, Buffer> {
	const files = new Map<string, Buffer>();
	// The end-of-central-directory record is in the last 64 KB.
	let end = -1;
	for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
		if (buffer.readUInt32LE(i) === 0x06054b50) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new Error("Not a zip file.");
	const count = buffer.readUInt16LE(end + 10);
	let at = buffer.readUInt32LE(end + 16);
	for (let n = 0; n < count; n++) {
		if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error("Damaged zip file.");
		const method = buffer.readUInt16LE(at + 10);
		const compressed = buffer.readUInt32LE(at + 20);
		const nameLength = buffer.readUInt16LE(at + 28);
		const extraLength = buffer.readUInt16LE(at + 30);
		const commentLength = buffer.readUInt16LE(at + 32);
		const local = buffer.readUInt32LE(at + 42);
		const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
		at += 46 + nameLength + extraLength + commentLength;
		if (name.endsWith("/")) continue;
		const dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
		const data = buffer.subarray(dataAt, dataAt + compressed);
		if (method === 0) files.set(name, Buffer.from(data));
		else if (method === 8) files.set(name, inflateRawSync(data));
	}
	return files;
}

const IMAGE_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".svg": "image/svg+xml",
};

/** Puts pictures the animation refers to inside it, so one JSON file is the whole graphic. */
async function inlineImages(
	json: LottieJson,
	read: (ref: string) => Promise<Buffer | null>,
): Promise<number> {
	let count = 0;
	for (const asset of json.assets ?? []) {
		if (typeof asset?.p !== "string" || asset.layers || asset.e === 1) {
			if (asset?.e === 1) count++;
			continue;
		}
		if (asset.p.startsWith("data:")) {
			asset.e = 1;
			count++;
			continue;
		}
		const ref = `${asset.u ?? ""}${asset.p}`;
		const data = await read(ref);
		if (!data) continue;
		const type = IMAGE_TYPES[path.extname(asset.p).toLowerCase()] ?? "image/png";
		asset.u = "";
		asset.p = `data:${type};base64,${data.toString("base64")}`;
		asset.e = 1;
		count++;
	}
	return count;
}

/**
 * Reads a .json or .lottie file into one self-contained Lottie document
 * (pictures inlined). Throws when the file is not a Lottie animation.
 */
export async function readMotionFile(file: string): Promise<LottieJson> {
	const raw = await fs.readFile(file);
	// Some tools save plain JSON with a .lottie name: the first byte tells.
	if (raw[0] === 0x50 && raw[1] === 0x4b) {
		const files = readZip(raw);
		let entry: string | undefined;
		const manifest = files.get("manifest.json");
		if (manifest) {
			try {
				const m = JSON.parse(manifest.toString("utf8"));
				const id = m.activeAnimationId ?? m.animations?.[0]?.id;
				if (id) entry = [...files.keys()].find((k) => k === `animations/${id}.json`);
			} catch {}
		}
		entry ??= [...files.keys()].find((k) => /^(a\/|animations\/).+\.json$/.test(k));
		if (!entry) throw new Error(`${path.basename(file)} has no animation in it.`);
		const json = JSON.parse((files.get(entry) as Buffer).toString("utf8"));
		if (!isLottie(json)) throw new Error(`${path.basename(file)} is not a Lottie animation.`);
		await inlineImages(json, async (ref) => {
			const name = ref.replace(/^\/+/, "");
			return (
				files.get(name) ??
				files.get(`images/${path.basename(name)}`) ??
				files.get(`i/${path.basename(name)}`) ??
				null
			);
		});
		return json;
	}
	let json: unknown;
	try {
		json = JSON.parse(raw.toString("utf8"));
	} catch {
		throw new Error(`${path.basename(file)} is not a Lottie animation (not JSON).`);
	}
	if (!isLottie(json)) throw new Error(`${path.basename(file)} is not a Lottie animation.`);
	const dir = path.dirname(file);
	await inlineImages(json, async (ref) =>
		fs.readFile(path.resolve(dir, ref.replace(/^\/+/, ""))).catch(() => null),
	);
	return json;
}
