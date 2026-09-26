import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planMontage } from "../electron/core/montage";
import { activeSequence, allSequences, applyOp } from "../electron/core/ops";
import { emptyProject } from "../electron/core/project";
import { matchLine, planRoughCut, type RoughSource, tokenise } from "../electron/core/roughcut";
import { ProjectStore } from "../electron/core/store";
import type { Asset, MediaClip, TranscriptWord } from "../electron/core/types";

/** Words 400 ms apart, each 300 ms long, from `offsetMs`. */
function said(text: string, offsetMs = 0): TranscriptWord[] {
	return text
		.split(" ")
		.map((w, i) => ({ text: w, startMs: offsetMs + i * 400, endMs: offsetMs + i * 400 + 300 }));
}

const interview: RoughSource = {
	assetId: "a_i",
	durationMs: 60000,
	words: said(
		"Okay so um. We started Cue because editing felt slow. Honestly the timeline was the hardest part. Anyway, agents can now do anything the user can do in the editor.",
	),
};
const broll: RoughSource = {
	assetId: "a_b",
	durationMs: 30000,
	words: said("The weather in Maastricht is lovely today, look at the river."),
};

describe("rough cut matching", () => {
	it("normalises words", () => {
		expect(tokenise("Don't STOP, the Timelines!")).toEqual(["dont", "stop", "the", "timeline"]);
	});

	it("finds an exact line with full confidence", () => {
		const m = matchLine("We started Cue because editing felt slow.", [broll, interview]);
		expect(m?.assetId).toBe("a_i");
		expect(m?.confidence).toBe(1);
		expect(m?.text).toBe("We started Cue because editing felt slow.");
		// Padded, but never into the word before.
		const first = interview.words[m?.fromWord as number];
		expect(m?.startMs).toBeLessThan(first.startMs);
		expect(m?.startMs).toBeGreaterThanOrEqual(interview.words[(m?.fromWord as number) - 1].endMs);
	});

	it("matches a paraphrase with gaps and skipped words", () => {
		const m = matchLine("agents do anything a user can do in the editor", [interview, broll]);
		expect(m?.assetId).toBe("a_i");
		expect(m?.text).toBe("agents can now do anything the user can do in the editor.");
		expect(m?.confidence).toBeGreaterThan(0.6);
		expect(m?.confidence).toBeLessThan(1);
	});

	it("returns nothing for a line that was never said", () => {
		expect(matchLine("Pricing starts at ten euros per month", [interview, broll])).toBeNull();
		expect(matchLine("", [interview])).toBeNull();
	});

	it("plans every line in order", () => {
		const plan = planRoughCut(
			["the timeline was the hardest part", "look at the river", "we sell shoes online"],
			[interview, broll],
		);
		expect(plan.map((p) => p.match?.assetId ?? null)).toEqual(["a_i", "a_b", null]);
	});
});

describe("beat montage plan", () => {
	// 120 BPM, first beat at 0.3 s, 20 s of music.
	const beats = Array.from({ length: 40 }, (_, i) => 300 + i * 500);

	it("cuts on every other beat, cycling through fresh parts of the footage", () => {
		const plan = planMontage({
			beats,
			musicDurationMs: 20300,
			every: 2,
			lengthMs: 8000,
			sources: [
				{ assetId: "v1", kind: "video", durationMs: 10000, scenes: [2500, 6000] },
				{ assetId: "img", kind: "image", durationMs: 0 },
				{ assetId: "v2", kind: "video", durationMs: 4000 },
			],
		});
		expect(plan.musicInMs).toBe(300);
		expect(plan.durationMs).toBe(8000);
		// Every cut lands on a beat (timeline 0 is the first beat).
		for (const c of plan.clips) {
			expect(c.startMs % 1000).toBe(0);
			expect(c.durationMs).toBe(1000);
		}
		expect(plan.clips.map((c) => c.assetId).slice(0, 6)).toEqual([
			"v1",
			"img",
			"v2",
			"v1",
			"img",
			"v2",
		]);
		// Shot changes first, then fresh stretches; never the same source range twice.
		const v1 = plan.clips.filter((c) => c.assetId === "v1").map((c) => c.inMs);
		expect(v1.slice(0, 3)).toEqual([0, 2580, 6080]);
		for (const id of ["v1", "v2"]) {
			const ranges = plan.clips.filter((c) => c.assetId === id).map((c) => [c.inMs, c.inMs + 1000]);
			for (let i = 0; i < ranges.length; i++)
				for (let j = i + 1; j < ranges.length; j++)
					expect(ranges[i][0] < ranges[j][1] && ranges[j][0] < ranges[i][1]).toBe(false);
		}
	});

	it("uses the whole song by default and slows short clips to fill a beat", () => {
		const plan = planMontage({
			beats,
			musicDurationMs: 20300,
			every: 4,
			sources: [{ assetId: "short", kind: "video", durationMs: 1000 }],
		});
		expect(plan.durationMs).toBe(18000);
		expect(plan.clips[0].speed).toBe(0.5);
		expect(() => planMontage({ beats: [100], musicDurationMs: 1000, sources: [] })).toThrow();
	});
});

const clip = (id: string, over: Partial<Asset> = {}): Asset => ({
	id,
	kind: "video",
	name: `${id}.mp4`,
	path: `${id}.mp4`,
	durationMs: 60000,
	width: 1920,
	height: 1080,
	hasAudio: true,
	origin: "import",
	createdAt: "",
	actor: "user",
	...over,
});

describe("alternative cuts as branches", () => {
	it("branches the open sequence, opens it, and promotes it over the original", () => {
		let data = applyOp(emptyProject("B"), { type: "addAsset", asset: clip("a_v") }).data;
		data = applyOp(data, {
			type: "addClips",
			clips: [{ type: "media", trackId: "V1", assetId: "a_v", startMs: 0, durationMs: 3000 }],
		}).data;
		const branched = applyOp(data, { type: "branchSequence" });
		data = branched.data;
		expect(activeSequence(data)).toEqual({ id: branched.created?.[0], name: "Main · alt 1" });
		expect(data.clips).toHaveLength(1);
		// A second branch of the branch is "alt 2" of the same original.
		const second = applyOp(data, { type: "branchSequence" }).data;
		expect(activeSequence(second).name).toBe("Main · alt 2");
		// Editing the branch leaves the original alone.
		data = applyOp(data, { type: "removeClips", ids: [data.clips[0].id] }).data;
		expect(allSequences(data).find((q) => q.id === "main")?.clips).toHaveLength(1);
		data = applyOp(data, { type: "promoteBranch", id: branched.created?.[0] as string }).data;
		const names = Object.fromEntries(allSequences(data).map((q) => [q.id, q.name]));
		expect(names).toEqual({ [branched.created?.[0] as string]: "Main", main: "Main (old)" });
		expect(() => applyOp(data, { type: "promoteBranch", id: "main" })).toThrow();
	});
});

describe("rough cut in a project", () => {
	it("builds an opened sequence in line order as one undo step", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-rough-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Rough" });
		const transcript = (words: TranscriptWord[]) => ({ model: "t", createdAt: "", words });
		store.apply(
			{ type: "addAsset", asset: clip("a_i", { transcript: transcript(interview.words) }) },
			"user",
		);
		store.apply(
			{
				type: "addAsset",
				asset: clip("a_vo", {
					kind: "audio",
					width: 0,
					height: 0,
					transcript: transcript(broll.words),
				}),
			},
			"user",
		);
		store.apply({ type: "addAsset", asset: clip("a_raw") }, "user");
		const result = await store.roughCut("agent", {
			lines: [
				"look at the river",
				"we started cue because editing felt slow",
				"unrelated words here",
			],
		});
		const data = store.current;
		expect(activeSequence(data)).toEqual({ id: result.sequenceId, name: "Rough cut" });
		expect(result.unmatched).toEqual(["unrelated words here"]);
		expect(result.notTranscribed).toEqual([{ id: "a_raw", name: "a_raw.mp4" }]);
		const clips = [...data.clips].sort((a, b) => a.startMs - b.startMs) as MediaClip[];
		expect(clips.map((c) => c.assetId)).toEqual(["a_vo", "a_i"]);
		expect(clips[1].startMs).toBe(clips[0].durationMs);
		expect(data.tracks.find((t) => t.id === clips[0].trackId)?.name).toBe("Dialogue");
		expect(store.undo("user")).toBe(true);
		expect(activeSequence(store.current).id).toBe("main");
		expect(store.current.sequences ?? []).toHaveLength(0);
	});

	it("says which media needs transcribing", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-rough-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Rough" });
		store.apply({ type: "addAsset", asset: clip("a_raw") }, "user");
		await expect(store.roughCut("agent", { lines: ["hello"] })).rejects.toThrow(
			/transcribe_media: a_raw\.mp4/,
		);
	});
});
