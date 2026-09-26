import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../electron/core/store";

async function newStore(name: string) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `cue-${name}-`));
	const store = new ProjectStore({
		mediaUrl: (f) => f,
		recentFile: path.join(dir, "recent.json"),
		autoProxies: () => false,
	});
	await store.create({ path: path.join(dir, "P") });
	return { dir, store };
}

describe("saving", () => {
	it("keeps an edit made while a save is being written", async () => {
		const { store } = await newStore("save");
		store.apply({ type: "rename", name: "First" }, "user");
		const saving = store.flush();
		store.apply({ type: "rename", name: "Second" }, "user");
		await saving;
		await store.flush();
		const file = store.filePath as string;
		expect(JSON.parse(await fs.readFile(file, "utf8")).name).toBe("Second");
	});

	it("never runs two saves at once", async () => {
		const { store } = await newStore("overlap");
		const saves: Promise<void>[] = [];
		for (let i = 0; i < 10; i++) {
			store.apply({ type: "rename", name: `Name ${i}` }, "user");
			saves.push(store.flush());
		}
		await Promise.all(saves);
		const file = store.filePath as string;
		expect(JSON.parse(await fs.readFile(file, "utf8")).name).toBe("Name 9");
	});
});

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

import { fromOtio } from "../electron/core/interchange";
import { applyOp } from "../electron/core/ops";
import { emptyProject } from "../electron/core/project";
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

function withClip(): ProjectData {
	const data = applyOp(emptyProject("T"), { type: "addAsset", asset: video }).data;
	return applyOp(data, {
		type: "addClips",
		clips: [{ type: "media", trackId: "V1", assetId: video.id, startMs: 1000, durationMs: 8000 }],
	}).data;
}
const only = (d: ProjectData) => d.clips.find((c) => c.type === "media") as MediaClip;

describe("edits", () => {
	it("splits keyframes and zooms between the two halves", () => {
		let data = withClip();
		const id = only(data).id;
		for (const [atMs, value] of [
			[0, 0],
			[8000, 1],
		])
			data = applyOp(data, {
				type: "setKeyframe",
				clipId: id,
				prop: "x",
				keyframe: { atMs, value, ease: "linear" },
			}).data;
		data = applyOp(data, {
			type: "addZoom",
			clipId: id,
			startMs: 3000,
			endMs: 5000,
			scale: 2,
		}).data;
		data = applyOp(data, { type: "splitAt", atMs: 5000 }).data;
		const [left, right] = data.clips
			.filter((c): c is MediaClip => c.type === "media")
			.sort((a, b) => a.startMs - b.startMs);
		expect(left.keyframes?.x?.at(-1)).toMatchObject({ atMs: 4000, value: 0.5 });
		expect(right.keyframes?.x?.[0]).toMatchObject({ atMs: 0, value: 0.5 });
		expect(right.keyframes?.x?.at(-1)).toMatchObject({ atMs: 4000, value: 1 });
		expect(left.zooms?.[0]).toMatchObject({ startMs: 3000, endMs: 4000 });
		expect(right.zooms?.[0]).toMatchObject({ startMs: 0, endMs: 1000 });
		expect(right.transitionIn).toBeUndefined();
	});

	it("keeps linked clips in sync when moved past the start", () => {
		let data = withClip();
		data = applyOp(data, {
			type: "addClips",
			clips: [{ type: "media", trackId: "A1", assetId: video.id, startMs: 3000, durationMs: 2000 }],
		}).data;
		const ids = data.clips.map((c) => c.id);
		data = applyOp(data, { type: "groupClips", ids }).data;
		data = applyOp(data, { type: "moveClips", ids: [ids[0]], deltaMs: -5000 }).data;
		const [a, b] = ids.map((id) => data.clips.find((c) => c.id === id) as MediaClip);
		expect(a.startMs).toBe(0);
		expect(b.startMs).toBe(2000);
	});

	it("duplicates onto another track with its own links", () => {
		let data = withClip();
		data = applyOp(data, { type: "addTrack", kind: "video" }).data;
		const other = data.tracks.find((t) => t.kind === "video" && t.id !== "V1")?.id as string;
		data = applyOp(data, {
			type: "addClips",
			clips: [{ type: "media", trackId: "A1", assetId: video.id, startMs: 1000, durationMs: 8000 }],
		}).data;
		const ids = data.clips.map((c) => c.id);
		data = applyOp(data, { type: "groupClips", ids }).data;
		const { data: next, created } = applyOp(data, {
			type: "duplicateClips",
			ids: [ids[0]],
			offsetMs: 0,
			trackId: other,
		});
		const copy = next.clips.find((c) => c.id === created?.[0]) as MediaClip;
		expect(copy.trackId).toBe(other);
		expect(copy.groupId).toBeUndefined();
	});

	it("removes media from every sequence", () => {
		let data = withClip();
		data = applyOp(data, { type: "duplicateSequence", id: "main" }).data;
		expect(data.sequences?.[0].clips).toHaveLength(1);
		data = applyOp(data, { type: "removeAsset", id: video.id }).data;
		expect(data.clips).toHaveLength(0);
		expect(data.sequences?.[0].clips).toHaveLength(0);
	});

	it("reads OpenTimelineIO media that starts at a timecode", () => {
		const rt = (value: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: 25, value });
		const range = (start: number, duration: number) => ({
			OTIO_SCHEMA: "TimeRange.1",
			start_time: rt(start),
			duration: rt(duration),
		});
		const hour = 25 * 3600;
		const timeline = fromOtio(
			{
				OTIO_SCHEMA: "Timeline.1",
				tracks: {
					OTIO_SCHEMA: "Stack.1",
					children: [
						{
							OTIO_SCHEMA: "Track.1",
							kind: "Video",
							children: [
								{
									OTIO_SCHEMA: "Clip.2",
									name: "shot",
									source_range: range(hour + 50, 100),
									media_references: {
										DEFAULT_MEDIA: {
											OTIO_SCHEMA: "ExternalReference.1",
											target_url: "file:///media/shot.mov",
											available_range: range(hour, 1000),
										},
									},
									active_media_reference_key: "DEFAULT_MEDIA",
								},
							],
						},
					],
				},
			},
			"/",
		);
		const clip = timeline.tracks[0].clips[0] as { inMs: number };
		expect(clip.inMs).toBe(2000);
	});
});

import { chunkCaptions } from "../electron/core/ai";
import type { TextClip } from "../electron/core/types";

describe("word-by-word captions", () => {
	it("keeps punctuation with its word and times words per caption", () => {
		const [chunk] = chunkCaptions([
			{
				startMs: 1000,
				endMs: 2000,
				text: "Hello, world.",
				words: [
					{ word: "Hello", startMs: 1000, endMs: 1400 },
					{ word: ",", startMs: 1400, endMs: 1450 },
					{ word: " world", startMs: 1500, endMs: 1900 },
					{ word: ".", startMs: 1900, endMs: 1950 },
				],
			},
		]);
		expect(chunk.text).toBe("Hello, world.");
		expect(chunk.words.map((w) => w.text)).toEqual(["Hello,", "world."]);
	});

	it("estimates timing when turned on, and splits captions between words", () => {
		let data = applyOp(emptyProject("T"), {
			type: "addClips",
			clips: [
				{ type: "text", trackId: "T1", startMs: 0, durationMs: 4000, text: "one two three four" },
			],
		}).data;
		const id = data.clips[0].id;
		data = applyOp(data, {
			type: "updateClip",
			id,
			patch: { wordStyle: { mode: "highlight", color: "#ffd60a" } },
		}).data;
		const clip = data.clips[0] as TextClip;
		expect(clip.words?.map((w) => w.text)).toEqual(["one", "two", "three", "four"]);
		expect(clip.words?.[3].startMs).toBeGreaterThan(clip.words?.[2].startMs ?? 0);
		// Split between the second and third word: each half keeps its own words and text.
		const at = (clip.words?.[2].startMs ?? 0) - 5;
		data = applyOp(data, { type: "splitClip", id, atMs: at }).data;
		const [left, right] = (data.clips as TextClip[]).sort((a, b) => a.startMs - b.startMs);
		expect(left.text).toBe("one two");
		expect(right.text).toBe("three four");
		expect(right.words?.[0].startMs).toBeLessThan(200);
		// New text gets new timing.
		data = applyOp(data, {
			type: "updateClip",
			id: right.id,
			patch: { text: "five six seven" },
		}).data;
		expect((data.clips.find((c) => c.id === right.id) as TextClip).words).toHaveLength(3);
	});
});

describe("reviewing agent edits", () => {
	it("keeps or undoes an agent's changes clip by clip or all at once", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-review-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
			reviewAgentEdits: () => true,
		});
		await store.create({ path: path.join(dir, "P") });
		const text = (startMs: number, t: string) => ({
			type: "text" as const,
			trackId: "T1",
			startMs,
			durationMs: 1000,
			text: t,
		});
		const [a, b] = store.apply({ type: "addClips", clips: [text(0, "A"), text(2000, "B")] }, "user")
			.created as string[];
		// The user's own edits are never a proposal.
		expect(store.snapshot()?.proposal).toBeNull();
		store.apply({ type: "moveClips", ids: [a], deltaMs: 500 }, "agent");
		const [c] = store.apply({ type: "addClips", clips: [text(4000, "C")] }, "agent")
			.created as string[];
		store.apply({ type: "removeClips", ids: [b] }, "agent");
		let p = store.snapshot()?.proposal;
		expect(p?.steps).toHaveLength(3);
		expect(p?.changed).toEqual([a]);
		expect(p?.added).toEqual([c]);
		expect(p?.removed.map((x) => x.id)).toEqual([b]);

		// Undo just the move; keep the new clip.
		store.rejectProposal("user", [a]);
		expect(store.current.clips.find((x) => x.id === a)?.startMs).toBe(0);
		store.acceptProposal("user", [c]);
		p = store.snapshot()?.proposal;
		expect(p?.changed).toEqual([]);
		expect(p?.added).toEqual([]);
		expect(p?.removed.map((x) => x.id)).toEqual([b]);

		// Undo the rest: B comes back, C (kept) stays.
		store.rejectProposal("user");
		expect(store.snapshot()?.proposal).toBeNull();
		expect(store.current.clips.map((x) => x.id).sort()).toEqual([a, b, c].sort());
		// And that is one undoable step.
		store.undo("user");
		expect(store.current.clips.some((x) => x.id === b)).toBe(false);
	});
});
