import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ffmpeg } from "./media";

/**
 * Openly licensed pictures and footage from outside the project: images through
 * Openverse (Flickr, museums, Wikimedia and more), photos and video from Wikimedia
 * Commons. Only licences usable in any video (CC0, public domain, CC BY, CC BY-SA);
 * each result carries the credit line to show.
 */

export type FoundKind = "image" | "video";

export interface FoundMedia {
	/** "ov:<id>" (Openverse) or "wc:<File:…>" (Commons), used by import_found. */
	id: string;
	kind: FoundKind;
	title: string;
	creator: string;
	licence: string;
	sourceUrl: string;
	fileUrl: string;
	width: number;
	height: number;
	durationMs?: number;
	provider: string;
	credit: string;
}

const USER_AGENT = "Cue video editor (https://cue.wicker.life)";
const credit = (m: { title: string; creator: string; licence: string; sourceUrl: string }) =>
	`"${m.title}" by ${m.creator || "unknown"} (${m.licence}), ${m.sourceUrl}`;

/** Licence names that allow any use with credit (no NonCommercial, no NoDerivatives). */
export function usableLicence(name: string): boolean {
	const n = name.toLowerCase();
	if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv/.test(n)) return false;
	return /cc0|public domain|^pd\b|pdm|cc[- ]by(-sa)?\b|attribution/.test(n);
}

const strip = (html: string) =>
	html
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();

async function openverseImages(query: string, limit: number): Promise<FoundMedia[]> {
	const u = new URL("https://api.openverse.org/v1/images/");
	u.searchParams.set("q", query);
	u.searchParams.set("license", "cc0,pdm,by,by-sa");
	u.searchParams.set("page_size", String(Math.min(40, limit * 2)));
	const res = await fetch(u, { headers: { "User-Agent": USER_AGENT } });
	if (!res.ok) throw new Error(`Image search failed (${res.status}).`);
	const body = (await res.json()) as {
		results?: {
			id: string;
			title?: string;
			creator?: string;
			license: string;
			license_version?: string;
			foreign_landing_url?: string;
			url: string;
			width?: number;
			height?: number;
			source?: string;
		}[];
	};
	return (body.results ?? []).map((r) => {
		const licence =
			r.license === "cc0"
				? "CC0 1.0"
				: r.license === "pdm"
					? "Public Domain Mark"
					: `CC ${r.license.toUpperCase()} ${r.license_version ?? ""}`.trim();
		const m = {
			id: `ov:${r.id}`,
			kind: "image" as const,
			title: r.title || "Untitled",
			creator: r.creator ?? "",
			licence,
			sourceUrl: r.foreign_landing_url ?? r.url,
			fileUrl: r.url,
			width: r.width ?? 0,
			height: r.height ?? 0,
			provider: r.source ?? "openverse",
		};
		return { ...m, credit: credit(m) };
	});
}

async function commons(query: string, kind: FoundKind, limit: number): Promise<FoundMedia[]> {
	const u = new URL("https://commons.wikimedia.org/w/api.php");
	const params: Record<string, string> = {
		action: "query",
		format: "json",
		generator: "search",
		gsrnamespace: "6",
		gsrsearch: `${kind === "video" ? "filetype:video" : "filetype:bitmap"} ${query}`,
		gsrlimit: String(Math.min(40, limit * 3)),
		prop: "imageinfo",
		iiprop: "url|size|mediatype|extmetadata",
		iiextmetadatafilter: "LicenseShortName|Artist|ObjectName",
	};
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	const res = await fetch(u, { headers: { "User-Agent": USER_AGENT } });
	if (!res.ok) throw new Error(`Commons search failed (${res.status}).`);
	const body = (await res.json()) as {
		query?: {
			pages?: Record<
				string,
				{
					title: string;
					index?: number;
					imageinfo?: {
						url: string;
						descriptionurl: string;
						width: number;
						height: number;
						duration?: number;
						extmetadata?: Record<string, { value: string }>;
					}[];
				}
			>;
		};
	};
	return Object.values(body.query?.pages ?? {})
		.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
		.flatMap((p) => {
			const info = p.imageinfo?.[0];
			const meta = info?.extmetadata ?? {};
			const licence = strip(meta.LicenseShortName?.value ?? "");
			if (!info || !usableLicence(licence)) return [];
			const m = {
				id: `wc:${p.title}`,
				kind,
				title:
					strip(meta.ObjectName?.value ?? "") ||
					p.title.replace(/^File:/, "").replace(/\.[^.]+$/, ""),
				creator: strip(meta.Artist?.value ?? "").slice(0, 120),
				licence,
				sourceUrl: info.descriptionurl,
				fileUrl: info.url,
				width: info.width,
				height: info.height,
				...(info.duration ? { durationMs: Math.round(info.duration * 1000) } : {}),
				provider: "wikimedia commons",
			};
			return [{ ...m, credit: credit(m) }];
		});
}

/** Openly licensed images (Openverse, then Commons) or video (Commons) for a query. */
export async function findMedia(opts: {
	query: string;
	kind: FoundKind;
	limit?: number;
	minWidth?: number;
}): Promise<FoundMedia[]> {
	const limit = opts.limit ?? 8;
	const results =
		opts.kind === "video"
			? await commons(opts.query, "video", limit)
			: [
					...(await openverseImages(opts.query, limit).catch(() => [] as FoundMedia[])),
					...(await commons(opts.query, "image", limit).catch(() => [] as FoundMedia[])),
				];
	return results.filter((r) => !opts.minWidth || r.width >= opts.minWidth).slice(0, limit);
}

const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 50);

/** Downloads a found item into the project's "found" folder; video becomes an MP4 (reliable seeking). */
export async function downloadFound(item: FoundMedia, projectDir: string): Promise<string> {
	const dir = path.join(projectDir, "found");
	await fs.mkdir(dir, { recursive: true });
	const ext = (
		new URL(item.fileUrl).pathname.match(/\.([a-z0-9]+)$/i)?.[1] ??
		(item.kind === "video" ? "webm" : "jpg")
	).toLowerCase();
	const base = path.join(dir, `${slug(item.title) || "found"}-${Date.now().toString(36)}`);
	const raw = `${base}.${ext}`;
	const res = await fetch(item.fileUrl, { headers: { "User-Agent": USER_AGENT } });
	if (!res.ok || !res.body) throw new Error(`Could not download "${item.title}" (${res.status}).`);
	await pipeline(Readable.fromWeb(res.body as never), createWriteStream(raw));
	if (item.kind !== "video" || ext === "mp4") return raw;
	const mp4 = `${base}.mp4`;
	await ffmpeg([
		"-i",
		raw,
		"-c:v",
		"libx264",
		"-crf",
		"18",
		"-preset",
		"medium",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-b:a",
		"160k",
		"-movflags",
		"+faststart",
		mp4,
	]);
	await fs.rm(raw, { force: true });
	return mp4;
}
