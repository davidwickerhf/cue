import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CollectionStore } from "../electron/core/collections";

describe("project collections", () => {
	it("groups projects like folders, follows renames and never loses a project", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-collections-"));
		const file = path.join(dir, "collections.json");
		const store = new CollectionStore(file);
		const a = path.join(dir, "edit.cueproj");
		const b = path.join(dir, "graphics.cueproj");
		const video = await store.create("Why we say OK", [a]);
		const other = await store.create("Why we say OK");
		expect(other.name).toBe("Why we say OK 2");
		await store.move([b], video.id);
		expect((await store.of(b))?.id).toBe(video.id);
		// One collection at most: moving takes it out of the other.
		await store.move([a], other.id);
		expect((await store.list()).find((c) => c.id === video.id)?.projects).toEqual([b]);
		// A renamed file keeps its collection.
		const renamed = path.join(dir, "graphics v2.cueproj");
		await store.renamed(b, renamed);
		expect((await store.of(renamed))?.id).toBe(video.id);
		await store.rename(video.id, "OK remake");
		// Deleting a collection ungroups its projects; it survives a restart of the app.
		await store.remove(other.id);
		const reopened = new CollectionStore(file);
		const list = await reopened.list();
		expect(list.map((c) => c.name)).toEqual(["OK remake"]);
		expect(await reopened.of(a)).toBeUndefined();
		await expect(reopened.move([a], "col_nope")).rejects.toThrow(/No collection/);
		await expect(reopened.create("  ")).rejects.toThrow(/name/);
	});
});
