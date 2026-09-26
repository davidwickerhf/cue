import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../electron/core/store";

describe("project history", () => {
	it("keeps every step across sessions and restores any of them", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-history-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: path.join(dir, "P") });
		store.apply({ type: "rename", name: "First" }, "user");
		store.apply({ type: "addMarker", atMs: 1000, label: "Hook", color: "accent" }, "agent");
		await store.transaction("user", "Two markers at once", () => {
			store.apply({ type: "addMarker", atMs: 2000, label: "A", color: "accent" }, "user");
			store.apply({ type: "addMarker", atMs: 3000, label: "B", color: "accent" }, "user");
		});
		store.undo("user");
		await store.flush();
		const file = store.filePath as string;
		await store.close();

		// A new session sees the whole history.
		await store.open(file);
		const steps = store.historyEntries();
		expect(steps.map((s) => s.summary).slice(0, 4)).toEqual([
			"Undo",
			"Two markers at once",
			'Added marker "Hook" at 1.00 s',
			'Renamed the project to "First"',
		]);
		expect(steps.find((s) => s.summary.startsWith("Added marker"))?.actor).toBe("agent");
		expect(store.current.markers).toHaveLength(1);

		// Go back to the moment after the two markers were added.
		const two = steps.find((s) => s.summary === "Two markers at once")?.n as number;
		await store.restoreHistory(two, "user");
		expect(store.current.markers).toHaveLength(3);
		expect(store.historyEntries()[0].kind).toBe("restore");
		// Restoring is undoable like any edit.
		store.undo("user");
		expect(store.current.markers).toHaveLength(1);
		// The history stays out of git.
		expect(existsSync(path.join(path.dirname(file), ".cue-history", ".gitignore"))).toBe(true);
	});
});
