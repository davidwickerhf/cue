import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ffmpeg } from "./media";
import { resolveInProject } from "./paths";
import { isProjectFile, parseProject, projectDuration } from "./project";
import type { Asset, MediaClip, ProjectData, ProjectSummary, RecentProject } from "./types";

/**
 * Where a project keeps its poster frame for the projects overview: one per project
 * file, so copies of a project in the same folder (backups, versions) each show their own.
 */
export function posterPath(projectFile: string): string {
	const name = path.basename(projectFile).replace(/\.cueproj$|\.cue\.json$/, "");
	return path.join(path.dirname(projectFile), ".cue-cache", "posters", `${name}.jpg`);
}

/** The poster of projects made before each file had its own (one per folder). */
function folderPoster(projectFile: string): string {
	return path.join(path.dirname(projectFile), ".cue-cache", "poster.jpg");
}

/** Project files in a folder and its sub-folders (two levels, like one folder per project). */
export async function scanProjects(dir: string, depth = 2): Promise<string[]> {
	const found: string[] = [];
	const walk = async (folder: string, level: number) => {
		const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const full = path.join(folder, entry.name);
			if (entry.isFile() && isProjectFile(entry.name)) found.push(full);
			else if (entry.isDirectory() && level < depth && !entry.name.endsWith(".app"))
				await walk(full, level + 1);
		}
	};
	await walk(dir, 0);
	return found;
}

export async function summarise(
	file: string,
	mediaUrl: (file: string) => string,
	recent?: RecentProject,
): Promise<ProjectSummary> {
	const base: ProjectSummary = {
		path: file,
		name: recent?.name ?? path.basename(file).replace(/\.cueproj$|\.cue\.json$/, ""),
		openedAt: recent?.openedAt,
		modifiedAt: recent?.openedAt ?? new Date(0).toISOString(),
		durationMs: 0,
		width: 0,
		height: 0,
		fps: 0,
		clipCount: 0,
		exists: false,
	};
	try {
		const [stat, raw] = await Promise.all([fs.stat(file), fs.readFile(file, "utf8")]);
		const data = parseProject(JSON.parse(raw));
		const poster = existsSync(posterPath(file)) ? posterPath(file) : folderPoster(file);
		// A project that has never had a poster gets one in the background, for the next listing.
		if (!existsSync(poster)) void makePoster(file, data).catch(() => {});
		return {
			...base,
			name: data.name,
			modifiedAt: stat.mtime.toISOString(),
			durationMs: projectDuration(data),
			width: data.canvas.width,
			height: data.canvas.height,
			fps: data.canvas.fps,
			clipCount: data.clips.length,
			posterUrl: existsSync(poster)
				? `${mediaUrl(poster)}?v=${Math.round((await fs.stat(poster)).mtimeMs)}`
				: undefined,
			exists: true,
		};
	} catch (error) {
		return { ...base, exists: existsSync(file), problem: (error as Error).message.slice(0, 200) };
	}
}

/**
 * Grabs a frame of the edit as the project's poster: the topmost photo or video on
 * screen about 15% of the way in (past cold opens and titles), or at a later moment when
 * nothing is there. Motion graphics, adjustment layers and nested sequences are skipped:
 * ffmpeg can't read them, and an edit that starts with one used to get no poster at all.
 */
export async function makePoster(projectFile: string, data: ProjectData): Promise<void> {
	const dir = path.dirname(projectFile);
	const order = data.tracks.filter((t) => t.kind === "video" && !t.hidden).map((t) => t.id);
	const pictures = data.clips.filter((c): c is MediaClip => {
		if (c.type !== "media" || c.disabled || !order.includes(c.trackId)) return false;
		const a = data.assets.find((x) => x.id === c.assetId);
		return (
			!!a &&
			(a.kind === "image" || a.kind === "video") &&
			!a.sequenceId &&
			existsSync(resolveInProject(dir, a.path))
		);
	});
	if (!pictures.length) return;
	const length = projectDuration(data);
	// Tracks are listed top to bottom, so the first one showing at a moment is on top.
	const at = (ms: number) =>
		pictures
			.filter((c) => c.startMs <= ms && ms < c.startMs + c.durationMs)
			.sort((a, b) => order.indexOf(a.trackId) - order.indexOf(b.trackId))[0];
	const moments = [0.15, 0.3, 0.5, 0.05].map((share) => length * share);
	let ms = moments.find((m) => at(m)) ?? pictures[0].startMs;
	const clip = at(ms) ?? pictures[0];
	ms = Math.max(ms, clip.startMs);
	const asset = data.assets.find((a) => a.id === clip.assetId) as Asset;
	const out = posterPath(projectFile);
	await fs.mkdir(path.dirname(out), { recursive: true });
	const seek =
		asset.kind === "image"
			? []
			: ["-ss", String((clip.inMs + (ms - clip.startMs) * clip.speed) / 1000)];
	await ffmpeg([
		...seek,
		"-i",
		resolveInProject(dir, asset.path),
		"-frames:v",
		"1",
		"-vf",
		"scale=480:-2",
		"-q:v",
		"4",
		out,
	]);
}
