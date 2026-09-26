import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type { Actor, ProjectData } from "./types";

const pack = promisify(gzip);
const unpack = promisify(gunzip);

/** How many steps are kept; older snapshots are removed. */
const LIMIT = 2000;

export interface HistoryEntry {
	/** Step number, counting up for the life of the project. */
	n: number;
	at: string;
	actor: Actor;
	summary: string;
	kind: "start" | "edit" | "undo" | "redo" | "restore";
	/** The timeline that was open. */
	sequence?: string;
}

/**
 * A project's complete, persistent history: every change is kept with who
 * made it and when, plus a compressed snapshot of the project after it, in a
 * hidden .cue-history folder next to the project file. Any step can be
 * restored later, even after the app was closed.
 */
export class ProjectHistory {
	entries: HistoryEntry[] = [];
	private readonly dir: string;
	private queue: Promise<void> = Promise.resolve();
	private indexTimer: NodeJS.Timeout | null = null;

	constructor(projectFile: string) {
		const base = path.basename(projectFile).replace(/\.cueproj$|\.cue\.json$/, "");
		this.dir = path.join(path.dirname(projectFile), ".cue-history", base);
	}

	async load(): Promise<void> {
		try {
			this.entries = JSON.parse(await fs.readFile(path.join(this.dir, "index.json"), "utf8"));
		} catch {
			this.entries = [];
		}
	}

	get last(): HistoryEntry | undefined {
		return this.entries.at(-1);
	}

	record(entry: Omit<HistoryEntry, "n" | "at">, data: ProjectData): HistoryEntry {
		const full: HistoryEntry = {
			...entry,
			n: (this.last?.n ?? 0) + 1,
			at: new Date().toISOString(),
		};
		this.entries.push(full);
		const json = JSON.stringify(data);
		this.queue = this.queue
			.then(async () => {
				await this.ensureDir();
				await fs.writeFile(this.snapshotFile(full.n), await pack(json));
				await this.prune();
			})
			.catch(() => {});
		this.scheduleIndex();
		return full;
	}

	async snapshot(n: number): Promise<ProjectData> {
		await this.queue;
		const raw = await fs.readFile(this.snapshotFile(n)).catch(() => {
			throw new Error(`Step ${n} is no longer in the history.`);
		});
		return JSON.parse((await unpack(raw)).toString("utf8")) as ProjectData;
	}

	/** Waits for pending writes (before closing a project). */
	async flush(): Promise<void> {
		if (this.indexTimer) {
			clearTimeout(this.indexTimer);
			this.indexTimer = null;
			await this.writeIndex();
		}
		await this.queue;
	}

	private snapshotFile(n: number) {
		return path.join(this.dir, `${String(n).padStart(6, "0")}.json.gz`);
	}

	private async ensureDir() {
		await fs.mkdir(this.dir, { recursive: true });
		// Keep the history out of git repositories the project may live in.
		const ignore = path.join(path.dirname(this.dir), ".gitignore");
		await fs.writeFile(ignore, "*\n", { flag: "wx" }).catch(() => {});
	}

	private scheduleIndex() {
		if (this.indexTimer) clearTimeout(this.indexTimer);
		this.indexTimer = setTimeout(() => {
			this.indexTimer = null;
			void this.writeIndex();
		}, 300);
	}

	private async writeIndex() {
		this.queue = this.queue
			.then(async () => {
				await this.ensureDir();
				const tmp = path.join(this.dir, "index.json.tmp");
				await fs.writeFile(tmp, JSON.stringify(this.entries));
				await fs.rename(tmp, path.join(this.dir, "index.json"));
			})
			.catch(() => {});
		await this.queue;
	}

	private async prune() {
		if (this.entries.length <= LIMIT) return;
		const drop = this.entries.splice(0, this.entries.length - LIMIT);
		await Promise.all(drop.map((e) => fs.rm(this.snapshotFile(e.n), { force: true })));
	}
}
