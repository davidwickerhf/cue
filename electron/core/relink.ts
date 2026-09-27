import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveInProject } from "./paths";
import type { Asset } from "./types";

/**
 * Finding media that moved, the way Premiere's "Link Media" and Resolve's
 * "Relink" do: try the stored relative path first, then look for a file with
 * the same name (and size, when known) near the project and near media that
 * is still where it was.
 */

const SKIP = new Set(["node_modules", ".git", ".cue-cache", ".cue-chat", "Library", ".Trash"]);
const MAX_ENTRIES = 25000;

export function isOffline(dir: string, asset: Asset): boolean {
	// Built-in adjustment layers and nested-sequence renders are not files the user can move.
	if (asset.kind === "adjustment" || asset.sequenceId) return false;
	return !existsSync(resolveInProject(dir, asset.path));
}

function sameFile(asset: Asset, file: string): boolean {
	if (!asset.size) return true;
	try {
		return statSync(file).size === asset.size;
	} catch {
		return false;
	}
}

/** Files by name under the given folders (bounded, so a huge disk never stalls opening). */
async function index(roots: { dir: string; depth: number }[]): Promise<Map<string, string[]>> {
	const byName = new Map<string, string[]>();
	const seen = new Set<string>();
	let entries = 0;
	const walk = async (folder: string, depth: number) => {
		if (seen.has(folder) || entries > MAX_ENTRIES) return;
		seen.add(folder);
		const list = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
		for (const entry of list) {
			entries++;
			if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
			const full = path.join(folder, entry.name);
			if (entry.isFile()) {
				const key = entry.name.toLowerCase();
				byName.set(key, [...(byName.get(key) ?? []), full]);
			} else if (entry.isDirectory() && depth > 0 && !entry.name.endsWith(".app"))
				await walk(full, depth - 1);
		}
	};
	for (const root of roots) await walk(root.dir, root.depth);
	return byName;
}

/**
 * New locations for offline assets, keyed by asset id (absolute paths).
 * `extraRoots` lets a user-picked folder be searched first.
 */
export async function findMoved(
	projectDir: string,
	assets: Asset[],
	extraRoots: string[] = [],
): Promise<Record<string, string>> {
	const offline = assets.filter((a) => isOffline(projectDir, a));
	if (offline.length === 0) return {};
	const found: Record<string, string> = {};
	// 1. The path relative to the project, for projects moved together with their media.
	for (const asset of offline) {
		if (!asset.relPath) continue;
		const candidate = path.resolve(projectDir, asset.relPath);
		if (existsSync(candidate) && sameFile(asset, candidate)) found[asset.id] = candidate;
	}
	const rest = offline.filter((a) => !found[a.id]);
	if (rest.length === 0) return found;
	// 2. Same name nearby: picked folders, the project and its parents, and folders of media still online.
	const online = assets
		.filter((a) => !isOffline(projectDir, a))
		.map((a) => path.dirname(resolveInProject(projectDir, a.path)));
	const roots = [
		...extraRoots.map((dir) => ({ dir, depth: 2 })),
		{ dir: projectDir, depth: 3 },
		{ dir: path.dirname(projectDir), depth: 3 },
		{ dir: path.dirname(path.dirname(projectDir)), depth: 2 },
		...[...new Set(online)].map((dir) => ({ dir, depth: 1 })),
	];
	const byName = await index(roots);
	for (const asset of rest) {
		const name = path.basename(asset.path).toLowerCase();
		const match = (byName.get(name) ?? []).find((file) => sameFile(asset, file));
		if (match) found[asset.id] = match;
	}
	return found;
}
