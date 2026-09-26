import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyClips, applyPatch, diffClips, diffSnapshot } from "../electron/core/delta";
import { ProjectStore } from "../electron/core/store";
import type { Clip, ProjectSnapshot } from "../electron/core/types";

const clip = (id: string, startMs = 0, extra: Partial<Clip> = {}) =>
	({ id, type: "text", trackId: "T1", startMs, durationMs: 1000, text: id, ...extra }) as Clip;

/** What the window would hold: a structured copy, as IPC delivers it. */
const copy = <T>(value: T): T => structuredClone(value);

describe("clip deltas", () => {
	const a = clip("a", 0);
	const b = clip("b", 1000);
	const c = clip("c", 2000);

	it("sends only changed clips and keeps the others' identity", () => {
		const b2 = { ...b, startMs: 1500 };
		const delta = diffClips([a, b, c], [a, b2, c]);
		expect(delta).toEqual({ upsert: [b2], remove: [] });
		const base = [a, b, c];
		const next = applyClips(base, copy(delta as NonNullable<typeof delta>));
		expect(next).toEqual([a, b2, c]);
		expect(next[0]).toBe(a);
		expect(next[2]).toBe(c);
	});

	it("skips clips that were rebuilt with the same content", () => {
		expect(diffClips([a, b], [{ ...a }, { ...b }])).toBeNull();
	});

	it("places new clips where they belong and removes deleted ones", () => {
		const d = clip("d", 500);
		const e = clip("e", 5000);
		const delta = diffClips([a, b, c], [d, a, c, e]);
		expect(delta?.remove).toEqual(["b"]);
		expect(delta?.order).toBeUndefined();
		expect(delta?.added).toEqual({ d: 0, e: 3 });
		expect(applyClips([a, b, c], copy(delta as NonNullable<typeof delta>))).toEqual([d, a, c, e]);
	});

	it("sends the order when kept clips were reordered", () => {
		const delta = diffClips([a, b, c], [c, a, b]);
		expect(delta).toEqual({ upsert: [], remove: [], order: ["c", "a", "b"] });
		const next = applyClips([a, b, c], copy(delta as NonNullable<typeof delta>));
		expect(next.map((x) => x.id)).toEqual(["c", "a", "b"]);
		expect(next[1]).toBe(a);
	});

	it("round-trips random edits", () => {
		let seed = 7;
		const rand = (n: number) => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed % n;
		};
		let prev = Array.from({ length: 40 }, (_, i) => clip(`c${i}`, i * 1000));
		let next_id = 40;
		for (let round = 0; round < 200; round++) {
			let next = prev.slice();
			const kind = rand(4);
			if (kind === 0) next.splice(rand(next.length + 1), 0, clip(`c${next_id++}`, rand(9000)));
			if (kind === 1 && next.length) next.splice(rand(next.length), 1);
			if (kind === 2 && next.length) {
				const i = rand(next.length);
				next[i] = { ...next[i], startMs: rand(9000) };
			}
			if (kind === 3) next = next.slice().sort(() => rand(3) - 1);
			const delta = diffClips(prev, next);
			const applied = delta ? applyClips(prev, copy(delta)) : prev;
			expect(applied).toEqual(next);
			prev = next;
		}
	});
});

describe("snapshot patches", () => {
	async function store() {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-delta-"));
		const s = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await s.create({ path: path.join(dir, "P") });
		return s;
	}

	it("rebuilds the next snapshot from a small patch", async () => {
		const s = await store();
		for (let i = 0; i < 50; i++)
			s.apply(
				{
					type: "addClips",
					clips: [{ type: "text", trackId: "T1", text: `Title ${i}`, startMs: i * 2000 }],
				},
				"user",
			);
		const before = s.snapshot() as ProjectSnapshot;
		const window = copy(before);
		const target = before.data.clips[10];
		s.apply({ type: "updateClip", id: target.id, patch: { startMs: target.startMs + 10 } }, "user");
		s.apply({ type: "addMarker", atMs: 1000, label: "Hook", color: "accent" }, "user");
		const after = s.snapshot() as ProjectSnapshot;
		const patch = diffSnapshot(before, after);
		expect(patch?.clips?.upsert.map((c) => c.id)).toEqual([target.id]);
		expect(Object.keys(patch?.data ?? {})).toEqual(["markers"]);
		expect(JSON.stringify(patch).length).toBeLessThan(JSON.stringify(after).length / 5);
		const applied = applyPatch(window, copy(patch as NonNullable<typeof patch>));
		expect(applied).toEqual(copy(after));
		// Unchanged parts keep their identity in the window.
		expect(applied?.data.clips[0]).toBe(window.data.clips[0]);
		expect(applied?.data.tracks).toBe(window.data.tracks);
		await s.close();
	});

	it("covers undo, redo and a save", async () => {
		const s = await store();
		s.apply(
			{ type: "addClips", clips: [{ type: "text", trackId: "T1", text: "One", startMs: 0 }] },
			"user",
		);
		let window = copy(s.snapshot() as ProjectSnapshot);
		let sent = s.snapshot() as ProjectSnapshot;
		const step = () => {
			const next = s.snapshot() as ProjectSnapshot;
			const patch = diffSnapshot(sent, next);
			const applied = applyPatch(window, copy(patch as NonNullable<typeof patch>));
			expect(applied).toEqual(copy(next));
			window = applied as ProjectSnapshot;
			sent = next;
		};
		s.apply(
			{ type: "addClips", clips: [{ type: "text", trackId: "T1", text: "Two", startMs: 3000 }] },
			"user",
		);
		step();
		s.undo("user");
		step();
		s.redo("user");
		step();
		await s.flush();
		step();
		expect(window.dirty).toBe(false);
		await s.close();
	});

	it("refuses a patch made for another version or project", async () => {
		const s = await store();
		const one = s.snapshot() as ProjectSnapshot;
		s.apply({ type: "rename", name: "Renamed" }, "user");
		const two = s.snapshot() as ProjectSnapshot;
		s.apply({ type: "rename", name: "Again" }, "user");
		const three = s.snapshot() as ProjectSnapshot;
		const patch = diffSnapshot(two, three) as NonNullable<ReturnType<typeof diffSnapshot>>;
		expect(applyPatch(copy(one), patch)).toBeNull();
		expect(applyPatch({ ...copy(two), path: "/elsewhere.cueproj" }, patch)).toBeNull();
		expect(diffSnapshot(one, { ...three, path: "/elsewhere.cueproj" })).toBeNull();
		await s.close();
	});
});
