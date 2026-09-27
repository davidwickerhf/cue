import { describe, expect, it } from "vitest";
import { applyOp } from "../electron/core/ops";
import { emptyProject } from "../electron/core/project";
import type { Asset, ProjectData } from "../electron/core/types";

const track = (id: string, kind: "video" | "audio", extra = {}) => ({
	id,
	kind,
	name: id,
	muted: false,
	locked: false,
	hidden: false,
	volume: 1,
	...extra,
});

function project(): ProjectData {
	const p = emptyProject("Overlap");
	return {
		...p,
		tracks: [
			track("V1", "video"),
			track("A1", "audio", { name: "Voiceover", voiceover: true }),
		] as ProjectData["tracks"],
		assets: [
			{
				id: "img",
				kind: "image",
				name: "still",
				path: "/x.png",
				durationMs: 5000,
				width: 100,
				height: 100,
			},
		] as unknown as Asset[],
		lines: [
			{ id: "L1", text: "one", startMs: 0, targetMs: 4000, maxMs: 4500 },
			{ id: "L2", text: "two", startMs: 0, targetMs: 4000, maxMs: 4500 },
		] as unknown as ProjectData["lines"],
	};
}

const take = (id: string, lineId: string) =>
	({
		id,
		kind: "audio",
		name: id,
		path: `/${id}.wav`,
		durationMs: 3000,
		lineId,
		origin: "tts",
	}) as unknown as Asset;

describe("clips don't land on top of each other", () => {
	it("puts a take whose line overlaps another take on a new voiceover track", () => {
		let data = applyOp(project(), { type: "addTake", asset: take("t1", "L1") }).data;
		data = applyOp(data, { type: "addTake", asset: take("t2", "L2") }).data;
		const [a, b] = data.clips;
		expect(a.trackId).toBe("A1");
		expect(b.trackId).not.toBe("A1");
		expect(data.tracks.find((t) => t.id === b.trackId)?.kind).toBe("audio");
		// A new take for the same line replaces its clip where it is.
		data = applyOp(data, { type: "addTake", asset: take("t3", "L1") }).data;
		expect(data.clips.filter((c) => c.trackId === "A1")).toHaveLength(1);
	});

	it("moves an agent's overlapping clip to a free track, and leaves touching clips alone", () => {
		const clip = (startMs: number) => ({
			type: "media" as const,
			trackId: "V1",
			assetId: "img",
			startMs,
			durationMs: 2000,
		});
		let data = applyOp(project(), { type: "addClips", clips: [clip(0)], avoidOverlap: true }).data;
		data = applyOp(data, { type: "addClips", clips: [clip(2000)], avoidOverlap: true }).data;
		expect(data.clips.map((c) => c.trackId)).toEqual(["V1", "V1"]);
		const r = applyOp(data, { type: "addClips", clips: [clip(1000)], avoidOverlap: true });
		expect(r.data.clips[2].trackId).not.toBe("V1");
		expect(r.summary).toMatch(/free track/);
		// Without the flag (the user's own edits) the clip goes where it was asked.
		const plain = applyOp(data, { type: "addClips", clips: [clip(1000)] });
		expect(plain.data.clips[2].trackId).toBe("V1");
	});
});

describe("takes gather back once their lines are spaced out", () => {
	it("moves a take off its overflow track and removes the empty track", () => {
		let data = applyOp(project(), { type: "addTake", asset: take("t1", "L1") }).data;
		data = applyOp(data, { type: "addTake", asset: take("t2", "L2") }).data;
		expect(data.tracks.some((t) => t.overflow)).toBe(true);
		data = applyOp(data, { type: "updateLine", id: "L2", patch: { startMs: 6000 } }).data;
		expect(data.clips.every((c) => c.trackId === "A1")).toBe(true);
		expect(data.tracks.some((t) => t.overflow)).toBe(false);
	});
});
