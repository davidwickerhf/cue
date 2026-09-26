import { describe, expect, it } from "vitest";
import { contract } from "../electron/control/contract";
import { AGENT_GUIDE } from "../electron/control/guide";
import { detectBeats, editTranscript, extractJson } from "../electron/core/intelligence";
import { applyOp } from "../electron/core/ops";
import { emptyProject, groupTracks, trackAudible } from "../electron/core/project";
import type { Asset, MediaClip, ProjectData } from "../electron/core/types";

const video: Asset = {
	id: "a_v",
	kind: "video",
	name: "v.mp4",
	path: "v.mp4",
	durationMs: 20000,
	width: 1920,
	height: 1080,
	hasAudio: true,
	origin: "import",
	createdAt: "",
	actor: "user",
};
const other: Asset = { ...video, id: "a_o", name: "o.mp4" };

function base(): ProjectData {
	let data = applyOp(emptyProject("T"), { type: "addAsset", asset: video }).data;
	data = applyOp(data, { type: "addAsset", asset: other }).data;
	return applyOp(data, {
		type: "addClips",
		clips: [
			{ type: "media", trackId: "V1", assetId: video.id, startMs: 0, durationMs: 4000 },
			{
				type: "media",
				trackId: "V1",
				assetId: video.id,
				startMs: 4000,
				durationMs: 4000,
				inMs: 8000,
			},
		],
	}).data;
}
const v1 = (d: ProjectData) =>
	d.clips.filter((c) => c.trackId === "V1").sort((a, b) => a.startMs - b.startMs) as MediaClip[];

describe("agent guide", () => {
	it("only mentions tools that exist", () => {
		const named = [...new Set(AGENT_GUIDE.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];
		const missing = named.filter((n) => !(n in contract));
		expect(missing).toEqual([]);
		expect(named.length).toBeGreaterThan(40);
	});
});

describe("three-point editing", () => {
	it("insert pushes later clips along; overwrite replaces", () => {
		const inserted = applyOp(base(), {
			type: "insertEdit",
			mode: "insert",
			assetId: other.id,
			trackId: "V1",
			atMs: 2000,
			inMs: 1000,
			outMs: 3000,
		}).data;
		expect(v1(inserted).map((c) => [c.startMs, c.durationMs])).toEqual([
			[0, 2000],
			[2000, 2000],
			[4000, 2000],
			[6000, 4000],
		]);
		const over = applyOp(base(), {
			type: "insertEdit",
			mode: "overwrite",
			assetId: other.id,
			trackId: "V1",
			atMs: 3000,
			inMs: 0,
			outMs: 2000,
		}).data;
		expect(v1(over).map((c) => [c.startMs, c.durationMs, c.assetId])).toEqual([
			[0, 3000, video.id],
			[3000, 2000, other.id],
			[5000, 3000, video.id],
		]);
	});

	it("lift leaves a gap", () => {
		const lifted = applyOp(base(), { type: "liftRange", startMs: 1000, endMs: 5000 }).data;
		expect(v1(lifted).map((c) => [c.startMs, c.durationMs])).toEqual([
			[0, 1000],
			[5000, 3000],
		]);
	});
});

describe("tracks", () => {
	it("keeps picture tracks above sound tracks", () => {
		const data = applyOp(base(), { type: "addTrack", kind: "video" }).data;
		const kinds = data.tracks.map((t) => (t.kind === "audio" ? "a" : "p")).join("");
		expect(kinds).toMatch(/^p+a+$/);
		expect(data.tracks[0].kind).toBe("video");
		const moved = applyOp(data, {
			type: "moveTrack",
			id: data.tracks[0].id,
			index: data.tracks.length - 1,
		}).data;
		expect(moved.tracks.map((t) => (t.kind === "audio" ? "a" : "p")).join("")).toMatch(/^p+a+$/);
		expect(groupTracks(moved.tracks)).toEqual(moved.tracks);
	});

	it("solo silences the other tracks", () => {
		const data = applyOp(base(), { type: "updateTrack", id: "A1", patch: { solo: true } }).data;
		const [v, a] = [data.tracks.find((t) => t.id === "V1"), data.tracks.find((t) => t.id === "A1")];
		expect(v && trackAudible(data, v)).toBe(false);
		expect(a && trackAudible(data, a)).toBe(true);
	});

	it("labels clips and clears the label with null", () => {
		const start = base();
		const id = start.clips[0].id;
		const labelled = applyOp(start, {
			type: "updateClip",
			id,
			patch: { label: "green", disabled: true },
		}).data;
		expect(labelled.clips.find((c) => c.id === id)).toMatchObject({
			label: "green",
			disabled: true,
		});
		const cleared = applyOp(labelled, { type: "updateClip", id, patch: { label: null } }).data;
		expect(cleared.clips.find((c) => c.id === id)?.label).toBeUndefined();
	});
});

describe("analysis", () => {
	it("finds the tempo of a click track", () => {
		// 120 BPM clicks at 50 envelope values a second: a hit every 25 values.
		const env = Array.from({ length: 50 * 20 }, (_, i) =>
			i % 25 === 3 ? 220 : i % 25 === 4 ? 120 : 10,
		);
		const { bpm, beats } = detectBeats(env, 50);
		expect(bpm).toBeCloseTo(120, 0);
		expect(beats[0] % 500).toBe(60);
	});

	it("maps transcripts to timeline time and parses model JSON", () => {
		let data = base();
		data = applyOp(data, {
			type: "setTranscript",
			assetId: video.id,
			transcript: {
				model: "t",
				createdAt: "",
				words: [
					{ text: "Hello", startMs: 500, endMs: 900 },
					{ text: "there.", startMs: 1000, endMs: 1400 },
					{ text: "Later", startMs: 8200, endMs: 8600 },
				],
			},
		}).data;
		const segs = editTranscript(data);
		// "Later" is at source 8.2 s, which the second clip shows at timeline 4.2 s.
		expect(segs.map((s) => [s.startMs, s.text])).toEqual([
			[500, "Hello there."],
			[4200, "Later"],
		]);
		expect(extractJson<{ a: number }[]>('Sure! ```json\n[{"a": 1}]\n```')).toEqual([{ a: 1 }]);
	});
});

describe("copy grade", () => {
	const graded = () => {
		let data = base();
		const [a] = v1(data);
		data = applyOp(data, {
			type: "updateClip",
			id: a.id,
			patch: {
				color: { brightness: 0.2, saturation: 1.4 },
				effects: { vignette: 0.5 },
			},
		}).data;
		data = applyOp(data, {
			type: "addClips",
			clips: [{ type: "text", trackId: "T1", startMs: 0, durationMs: 1000, text: "Hi" }],
		}).data;
		return data;
	};

	it("copies colour and effects to the targets, skipping text clips", () => {
		const data = graded();
		const [a, b] = v1(data);
		const text = data.clips.find((c) => c.type === "text");
		const next = applyOp(data, {
			type: "copyGrade",
			fromClipId: a.id,
			toClipIds: [b.id, text?.id ?? ""],
		}).data;
		const copied = v1(next)[1];
		expect(copied.color).toEqual(a.color);
		expect(copied.effects).toEqual(a.effects);
		// The copy is its own object, so later changes to one leave the other alone.
		expect(copied.color).not.toBe(a.color);
		expect(next.clips.find((c) => c.type === "text")).toEqual(text);
	});

	it("can leave effects alone and clears the grade from an ungraded source", () => {
		const data = graded();
		const [a, b] = v1(data);
		const withEffects = applyOp(data, {
			type: "updateClip",
			id: b.id,
			patch: { effects: { blur: 0.3 } },
		}).data;
		const colourOnly = v1(
			applyOp(withEffects, {
				type: "copyGrade",
				fromClipId: a.id,
				toClipIds: [b.id],
				effects: false,
			}).data,
		)[1];
		expect(colourOnly.color).toEqual(a.color);
		expect(colourOnly.effects?.blur).toBe(0.3);
		expect(colourOnly.effects?.vignette).toBe(0);
		// Copying from the ungraded clip back resets the graded one.
		const reset = v1(
			applyOp(data, { type: "copyGrade", fromClipId: b.id, toClipIds: [a.id] }).data,
		)[0];
		expect(reset.color).toBeUndefined();
		expect(reset.effects).toBeUndefined();
	});

	it("refuses locked tracks and lists with nothing to paste to", () => {
		const data = graded();
		const [a, b] = v1(data);
		expect(() =>
			applyOp(data, { type: "copyGrade", fromClipId: a.id, toClipIds: [a.id] }),
		).toThrow();
		const locked = applyOp(data, { type: "updateTrack", id: "V1", patch: { locked: true } }).data;
		expect(() =>
			applyOp(locked, { type: "copyGrade", fromClipId: a.id, toClipIds: [b.id] }),
		).toThrow(/locked/);
	});

	it("is an agent tool", () => {
		expect("copy_grade" in contract).toBe(true);
		expect(AGENT_GUIDE).toContain("copy_grade");
	});
});
