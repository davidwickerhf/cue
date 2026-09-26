import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ffmpeg } from "./media";
import { resolveInProject } from "./paths";
import { isProjectFile, parseProject, projectDuration } from "./project";
import type { ProjectData, ProjectSummary, RecentProject } from "./types";

/** Where each project keeps its poster frame for the projects overview. */
export function posterPath(projectFile: string): string {
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
		const poster = posterPath(file);
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

/** Grabs a frame from the first picture on the timeline as the project's poster. */
export async function makePoster(projectFile: string, data: ProjectData): Promise<void> {
	const dir = path.dirname(projectFile);
	const visual = new Set(
		data.tracks.filter((t) => t.kind === "video" && !t.hidden).map((t) => t.id),
	);
	const clip = data.clips
		.filter((c) => c.type === "media" && visual.has(c.trackId))
		.sort((a, b) => a.startMs - b.startMs)[0];
	if (!clip || clip.type !== "media") return;
	const asset = data.assets.find((a) => a.id === clip.assetId);
	if (!asset || asset.kind === "audio") return;
	const source = resolveInProject(dir, asset.path);
	if (!existsSync(source)) return;
	const out = posterPath(projectFile);
	await fs.mkdir(path.dirname(out), { recursive: true });
	const at =
		asset.kind === "image"
			? []
			: ["-ss", String((clip.inMs + Math.min(1000, clip.durationMs / 3)) / 1000)];
	await ffmpeg([...at, "-i", source, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", out]);
}
