import fs from "node:fs/promises";
import path from "node:path";
import { newId } from "./project";

/**
 * Collections group projects in the projects overview, like folders: the pieces
 * of one video (its edit, the graphics made as their own projects, other
 * versions) in one place. A project is in one collection at most. Collections
 * live in the app's data, not in the projects, so moving a project into one
 * never touches its file, and deleting a collection never deletes a project.
 */

export interface Collection {
	id: string;
	name: string;
	createdAt: string;
	/** Project files, in the order they were added. */
	projects: string[];
}

export class CollectionStore {
	private cache: Collection[] | null = null;
	/** Writes one at a time, so two quick changes can't interleave. */
	private writing: Promise<void> = Promise.resolve();

	constructor(private readonly file: string) {}

	async list(): Promise<Collection[]> {
		if (this.cache) return this.cache;
		try {
			const raw = JSON.parse(await fs.readFile(this.file, "utf8")) as {
				collections?: Collection[];
			};
			this.cache = (raw.collections ?? []).filter(
				(c) => typeof c.id === "string" && typeof c.name === "string" && Array.isArray(c.projects),
			);
		} catch {
			this.cache = [];
		}
		return this.cache;
	}

	/** The collection a project is in, if any. */
	async of(projectFile: string): Promise<Collection | undefined> {
		const file = path.resolve(projectFile);
		return (await this.list()).find((c) => c.projects.includes(file));
	}

	async create(name: string, projects: string[] = []): Promise<Collection> {
		const clean = name.trim();
		if (!clean) throw new Error("Give the collection a name.");
		const list = await this.list();
		const collection: Collection = {
			id: newId("col"),
			name: uniqueName(clean, list),
			createdAt: new Date().toISOString(),
			projects: [],
		};
		this.cache = [...list, collection];
		if (!projects.length) {
			await this.save();
			return collection;
		}
		await this.move(projects, collection.id);
		return find(await this.list(), collection.id);
	}

	async rename(id: string, name: string): Promise<Collection> {
		const clean = name.trim();
		if (!clean) throw new Error("Give the collection a name.");
		const list = await this.list();
		const found = find(list, id);
		const renamed = {
			...found,
			name: uniqueName(
				clean,
				list.filter((c) => c.id !== id),
			),
		};
		this.cache = list.map((c) => (c.id === id ? renamed : c));
		await this.save();
		return renamed;
	}

	/** Removes the collection; its projects stay where they are, ungrouped. */
	async remove(id: string): Promise<void> {
		const list = await this.list();
		find(list, id);
		this.cache = list.filter((c) => c.id !== id);
		await this.save();
	}

	/** Puts projects in a collection (taking them out of any other), or ungroups them with null. */
	async move(projectFiles: string[], id: string | null): Promise<void> {
		const list = await this.list();
		if (id) find(list, id);
		const files = projectFiles.map((f) => path.resolve(f));
		this.cache = list.map((c) => {
			const kept = c.projects.filter((p) => !files.includes(p));
			return c.id === id ? { ...c, projects: [...kept, ...files] } : { ...c, projects: kept };
		});
		await this.save();
	}

	/** A project file was renamed or moved: its collection follows it. */
	async renamed(from: string, to: string): Promise<void> {
		const a = path.resolve(from);
		const b = path.resolve(to);
		const list = await this.list();
		if (!list.some((c) => c.projects.includes(a))) return;
		this.cache = list.map((c) => ({ ...c, projects: c.projects.map((p) => (p === a ? b : p)) }));
		await this.save();
	}

	private save(): Promise<void> {
		const data = `${JSON.stringify({ collections: this.cache ?? [] }, null, "\t")}\n`;
		this.writing = this.writing.then(async () => {
			await fs.mkdir(path.dirname(this.file), { recursive: true });
			const tmp = `${this.file}.${process.pid}.tmp`;
			await fs.writeFile(tmp, data);
			await fs.rename(tmp, this.file);
		});
		return this.writing;
	}
}

function find(list: Collection[], id: string): Collection {
	const found = list.find((c) => c.id === id);
	if (!found)
		throw new Error(
			`No collection "${id}". Collections: ${list.map((c) => `${c.id} (${c.name})`).join(", ") || "none yet"}.`,
		);
	return found;
}

/** "Name", or "Name 2", "Name 3"… when another collection has that name. */
function uniqueName(name: string, others: Collection[]): string {
	const taken = new Set(others.map((c) => c.name.toLowerCase()));
	if (!taken.has(name.toLowerCase())) return name;
	for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}
