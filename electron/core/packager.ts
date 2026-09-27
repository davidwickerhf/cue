import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { crc32, deflateRaw } from "node:zlib";
import { ffmpeg } from "./media";
import { relativeToProject, resolveInProject } from "./paths";
import { PROJECT_EXTENSION, sourceSpan } from "./project";
import type { Asset, Clip, MediaClip, ProjectData } from "./types";

/**
 * Packaging a project to share it (Premiere's Project Manager, Resolve's
 * .drp archive): the project file and every piece of media it uses in one zip
 * that opens anywhere. Media outside the project folder is copied into media/;
 * long video and audio can be trimmed to the parts the edit uses (with handles),
 * which keeps a video cut from a feature film small. Caches, history and
 * exports are left out: Cue remakes them.
 */

export interface PackageOptions {
	/** The open project's file and its data. */
	projectFile: string;
	data: ProjectData;
	/** Where the zip goes. */
	out: string;
	/** Trim video and audio to what the edit uses (plus handles). */
	trim?: boolean;
	/** Extra files to include at the top of the zip (name → text), e.g. a README with credits. */
	extras?: Record<string, string>;
	onProgress?: (fraction: number) => void;
}

export interface PackageReport {
	path: string;
	bytes: number;
	media: number;
	trimmed: { name: string; fromMs: number; toMs: number }[];
}

/** Seconds of source kept before and after what the edit uses, for trimming later. */
const HANDLE_MS = 1000;
/** Only trim when it saves at least this share of a file. */
const TRIM_IF_UNDER = 0.7;
/** Folders in the project that are made again on open and never go in a package. */
const SKIP = new Set([".cue-cache", ".cue-history", ".cue-chat", "export", "exports"]);

/** Every media clip in the project, in every sequence. */
function allClips(data: ProjectData): Clip[] {
	return [...data.clips, ...(data.sequences ?? []).flatMap((s) => s.clips)];
}

/** Uses of one file further apart than this become separate trimmed files. */
const SPLIT_GAP_MS = 10000;

interface UsedRange {
	fromMs: number;
	toMs: number;
	clips: MediaClip[];
}

/**
 * The parts of a file the edit uses, with handles: nearby uses share one range,
 * uses far apart get their own (a few shots from a long film make a few short
 * files). Null keeps the whole file, when trimming would save little.
 */
function usedRanges(asset: Asset, clips: MediaClip[]): UsedRange[] | null {
	if (!clips.length || asset.durationMs <= 0) return null;
	const spans = clips
		.map((clip) => ({
			fromMs: Math.max(0, clip.inMs - HANDLE_MS),
			toMs: Math.min(asset.durationMs, clip.inMs + sourceSpan(clip) + HANDLE_MS),
			clips: [clip],
		}))
		.sort((a, b) => a.fromMs - b.fromMs);
	const ranges: UsedRange[] = [];
	for (const span of spans) {
		const last = ranges.at(-1);
		if (last && span.fromMs - last.toMs <= SPLIT_GAP_MS) {
			last.toMs = Math.max(last.toMs, span.toMs);
			last.clips.push(...span.clips);
		} else ranges.push({ ...span, clips: [...span.clips] });
	}
	const kept = ranges.reduce((sum, r) => sum + r.toMs - r.fromMs, 0);
	if (kept >= asset.durationMs * TRIM_IF_UNDER) return null;
	return ranges.map((r) => ({ ...r, fromMs: Math.round(r.fromMs), toMs: Math.round(r.toMs) }));
}

export async function packageProject(options: PackageOptions): Promise<PackageReport> {
	const { data, projectFile } = options;
	const projectDir = path.dirname(projectFile);
	const name = path.basename(projectFile).replace(/\.cueproj$|\.cue\.json$/, "");
	const staging = await fs.mkdtemp(path.join(os.tmpdir(), "cue-package-"));
	try {
		const out: ProjectData = structuredClone(data);
		const clips = allClips(out).filter((c): c is MediaClip => c.type === "media");
		const files = new Map<string, string>(); // path in the zip → file on disk
		const taken = new Set<string>();
		const unique = (wanted: string) => {
			let candidate = wanted;
			const ext = path.extname(wanted);
			for (let n = 2; taken.has(candidate); n++)
				candidate = `${wanted.slice(0, -ext.length || undefined)}-${n}${ext}`;
			taken.add(candidate);
			return candidate;
		};
		const trimmed: PackageReport["trimmed"] = [];
		const media = out.assets.filter((a) => a.kind !== "adjustment" && !a.sequenceId);
		let done = 0;
		for (const asset of media) {
			const source = resolveInProject(projectDir, asset.path);
			const inside = relativeToProject(projectDir, source) !== source;
			const uses = clips.filter((c) => c.assetId === asset.id);
			const ranges =
				options.trim && (asset.kind === "video" || asset.kind === "audio")
					? usedRanges(asset, uses)
					: null;
			if (ranges) {
				for (const [i, range] of ranges.entries()) {
					// The first part keeps the media item; later parts become new ones.
					const part: Asset =
						i === 0
							? asset
							: {
									...structuredClone(asset),
									id: `${asset.id}-${i + 1}`,
									name: `${asset.name} (${i + 1})`,
								};
					if (i > 0) out.assets.push(part);
					// Re-encoded (not stream-copied) so the cut is frame accurate.
					const ext = asset.kind === "video" ? ".mp4" : ".m4a";
					const zipName = unique(
						`media/${path.basename(source, path.extname(source))}-${Math.round(range.fromMs / 1000)}s${ext}`,
					);
					const file = path.join(staging, zipName);
					await fs.mkdir(path.dirname(file), { recursive: true });
					await ffmpeg([
						"-ss",
						(range.fromMs / 1000).toFixed(3),
						"-t",
						((range.toMs - range.fromMs) / 1000).toFixed(3),
						"-i",
						source,
						...(asset.kind === "video"
							? ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p"]
							: ["-vn"]),
						"-c:a",
						"aac",
						"-b:a",
						"192k",
						"-movflags",
						"+faststart",
						file,
					]);
					files.set(zipName, file);
					for (const clip of range.clips) {
						clip.assetId = part.id;
						clip.inMs = Math.max(0, clip.inMs - range.fromMs);
					}
					part.durationMs = range.toMs - range.fromMs;
					if (asset.transcript)
						part.transcript = {
							...asset.transcript,
							words: asset.transcript.words
								.filter((w) => w.endMs > range.fromMs && w.startMs < range.toMs)
								.map((w) => ({
									...w,
									startMs: w.startMs - range.fromMs,
									endMs: w.endMs - range.fromMs,
								})),
						};
					for (const key of ["speechStartMs", "speechEndMs"] as const) {
						const v = asset[key];
						if (v !== undefined) part[key] = Math.max(0, v - range.fromMs);
					}
					part.path = zipName;
					part.relPath = zipName;
					trimmed.push({ name: part.name, fromMs: range.fromMs, toMs: range.toMs });
				}
			} else {
				// Media in the project folder keeps its place; the rest goes in media/.
				const zipName = inside
					? path.relative(projectDir, source).split(path.sep).join("/")
					: unique(`media/${path.basename(source)}`);
				taken.add(zipName);
				files.set(zipName, source);
				asset.path = zipName;
			}
			asset.relPath = asset.path;
			done++;
			options.onProgress?.((done / Math.max(1, media.length)) * 0.6);
		}
		// Anything else the project keeps in its folder (graphics sources, cut-outs), skipping caches.
		for (const entry of await walk(projectDir)) {
			const rel = path.relative(projectDir, entry).split(path.sep).join("/");
			if (SKIP.has(rel.split("/")[0]) || rel === path.basename(projectFile)) continue;
			if (/\.(cueproj|cue\.json)$/.test(rel) || rel.endsWith(".part") || rel.includes(".part."))
				continue;
			if (!files.has(rel) && !taken.has(rel)) {
				files.set(rel, entry);
				taken.add(rel);
			}
		}
		const entries: ZipEntry[] = [
			{
				name: `${name}/${name}${PROJECT_EXTENSION}`,
				data: Buffer.from(`${JSON.stringify(out, null, "\t")}\n`),
			},
			...Object.entries(options.extras ?? {}).map(([file, text]) => ({
				name: `${name}/${file}`,
				data: Buffer.from(text),
			})),
			...[...files].map(([zipName, file]) => ({ name: `${name}/${zipName}`, file })),
		];
		await fs.mkdir(path.dirname(options.out), { recursive: true });
		const bytes = await writeZip(options.out, entries, (f) => options.onProgress?.(0.6 + f * 0.4));
		return { path: options.out, bytes, media: media.length, trimmed };
	} finally {
		await fs.rm(staging, { recursive: true, force: true });
	}
}

/** Files under dir, leaving out hidden files and folders (caches, history, .DS_Store). */
async function walk(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
		if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(full)));
		else if (entry.isFile()) out.push(full);
	}
	return out;
}

// ---------------------------------------------------------------------------
// A small zip writer (the format readZip in motionFile.ts reads)
// ---------------------------------------------------------------------------

type ZipEntry = { name: string; data: Buffer } | { name: string; file: string };

const deflateAsync = promisify(deflateRaw);

/** Already-compressed files are stored as they are; deflating them gains nothing. */
const STORED = /\.(mp4|mov|m4a|mp3|aac|jpe?g|png|webp|gif|zip|lottie|mkv|webm)$/i;

/**
 * Writes a zip (deflated or stored entries, 32-bit sizes: files under 4 GB).
 * Each file is read and written one at a time, so big media never sits in memory together.
 */
export async function writeZip(
	out: string,
	entries: ZipEntry[],
	onProgress?: (fraction: number) => void,
): Promise<number> {
	const stream = createWriteStream(out);
	const write = (chunk: Buffer) =>
		new Promise<void>((resolve, reject) =>
			stream.write(chunk, (error) => (error ? reject(error) : resolve())),
		);
	const central: Buffer[] = [];
	let offset = 0;
	const now = new Date();
	const dosTime =
		(now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
	const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
	let i = 0;
	for (const entry of entries) {
		const raw = "data" in entry ? entry.data : await fs.readFile(entry.file);
		const store = STORED.test(entry.name);
		// Compressed off the main thread: a big package must not stall the app.
		const body = store ? raw : await deflateAsync(raw);
		if (raw.length >= 0xffffffff || offset >= 0xffffffff)
			throw new Error("The package would be over 4 GB; trim the media or leave some out.");
		const crc = crc32(raw);
		const nameBytes = Buffer.from(entry.name, "utf8");
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(store ? 0 : 8, 8);
		local.writeUInt16LE(dosTime, 10);
		local.writeUInt16LE(dosDate, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		local.writeUInt16LE(0, 28);
		await write(local);
		await write(nameBytes);
		await write(body);
		const record = Buffer.alloc(46);
		record.writeUInt32LE(0x02014b50, 0);
		record.writeUInt16LE(20, 4);
		record.writeUInt16LE(20, 6);
		record.writeUInt16LE(0x0800, 8);
		record.writeUInt16LE(store ? 0 : 8, 10);
		record.writeUInt16LE(dosTime, 12);
		record.writeUInt16LE(dosDate, 14);
		record.writeUInt32LE(crc, 16);
		record.writeUInt32LE(body.length, 20);
		record.writeUInt32LE(raw.length, 24);
		record.writeUInt16LE(nameBytes.length, 28);
		record.writeUInt32LE(offset, 42);
		central.push(record, nameBytes);
		offset += local.length + nameBytes.length + body.length;
		onProgress?.(++i / entries.length);
	}
	const directory = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	await write(directory);
	await write(end);
	await new Promise<void>((resolve, reject) =>
		stream.end((error?: Error | null) => (error ? reject(error) : resolve())),
	);
	return offset + directory.length + end.length;
}
