import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Controller } from "../electron/controller";
import { reviewEdit } from "../electron/core/notes";
import { applyOp } from "../electron/core/ops";
import { emptyProject } from "../electron/core/project";
import {
	BUILT_IN_RECIPES,
	recipeContext,
	resolveParams,
	resolveRecipe,
} from "../electron/core/recipes";
import type { AiRuntime } from "../electron/core/runtime";
import { ProjectStore } from "../electron/core/store";
import type { Asset, MediaClip, ProjectData, TextClip } from "../electron/core/types";

const video: Asset = {
	id: "a_v",
	kind: "video",
	name: "v.mp4",
	path: "v.mp4",
	durationMs: 60000,
	width: 1920,
	height: 1080,
	hasAudio: true,
	origin: "import",
	createdAt: "",
	actor: "user",
};
const song: Asset = { ...video, id: "a_m", kind: "audio", name: "song.mp3", width: 0, height: 0 };
const voice: Asset = { ...song, id: "a_vo", name: "vo.wav" };

function project(): ProjectData {
	let data = emptyProject("Demo");
	for (const asset of [video, song, voice]) data = applyOp(data, { type: "addAsset", asset }).data;
	return data;
}

const place = (data: ProjectData, clips: unknown[]) =>
	applyOp(data, { type: "addClips", clips: clips as never }).data;

const kinds = (data: ProjectData) => reviewEdit(data).map((n) => n.kind);

describe("director's notes", () => {
	it("finds a flash frame gap and closes it by extending the clip before", () => {
		const data = place(project(), [
			{ type: "media", trackId: "V1", assetId: video.id, startMs: 0, durationMs: 3000 },
			{
				type: "media",
				trackId: "V1",
				assetId: video.id,
				startMs: 3080,
				durationMs: 3000,
				inMs: 20000,
			},
		]);
		const gap = reviewEdit(data).find((n) => n.kind === "gap");
		expect(gap?.severity).toBe("problem");
		expect(gap?.atMs).toBe(3000);
		expect(gap?.fix?.tool).toBe("trim_clip");
		expect(gap?.fix?.params).toMatchObject({ edge: "end", toMs: 3080 });
	});

	it("flags jump cuts in the same shot but not cuts to another part of it", () => {
		const data = place(project(), [
			{ type: "media", trackId: "V1", assetId: video.id, startMs: 0, durationMs: 3000 },
			// Source picks up 1 s after the first clip ends: a jump cut.
			{
				type: "media",
				trackId: "V1",
				assetId: video.id,
				startMs: 3000,
				durationMs: 3000,
				inMs: 4000,
			},
			// Far away in the source: a real cut.
			{
				type: "media",
				trackId: "V1",
				assetId: video.id,
				startMs: 6000,
				durationMs: 3000,
				inMs: 30000,
			},
		]);
		const jumps = reviewEdit(data).filter((n) => n.kind === "jump-cut");
		expect(jumps.map((n) => n.atMs)).toEqual([3000]);
		expect(jumps[0].fix?.tool).toBe("add_zoom");
		// Applying the fix clears the note.
		const fixed = applyOp(data, {
			type: "addZoom",
			...(jumps[0].fix?.params as { clipId: string }),
		} as never).data;
		expect(kinds(fixed)).not.toContain("jump-cut");
	});

	it("flags very short clips", () => {
		const data = place(project(), [
			{ type: "media", trackId: "V1", assetId: video.id, startMs: 0, durationMs: 150 },
		]);
		expect(kinds(data)).toContain("short-clip");
	});

	it("suggests a push-in on a long static shot, not on one that moves", () => {
		const data = place(project(), [
			{ type: "media", trackId: "V1", assetId: video.id, startMs: 0, durationMs: 12000 },
		]);
		const note = reviewEdit(data).find((n) => n.kind === "static-shot");
		expect(note?.fix?.tool).toBe("add_zoom");
		const clip = data.clips[0] as MediaClip;
		const moving = applyOp(data, {
			type: "addZoom",
			clipId: clip.id,
			startMs: 0,
			endMs: 12000,
			scale: 1.15,
			x: 0.5,
			y: 0.5,
			easeMs: 3000,
		}).data;
		expect(kinds(moving)).not.toContain("static-shot");
	});

	it("flags titles too fast to read, too small or outside title safe", () => {
		const data = place(project(), [
			{
				type: "text",
				trackId: "T1",
				startMs: 1000,
				durationMs: 1000,
				text: "Six words on screen for one",
				style: { fontSize: 20, x: 0.5, y: 0.97 },
			},
		]);
		const notes = reviewEdit(data);
		const speed = notes.find((n) => n.kind === "title-speed");
		expect(speed?.fix).toMatchObject({
			tool: "trim_clip",
			params: { edge: "end", toMs: 1000 + 2400 },
		});
		expect(notes.map((n) => n.kind)).toEqual(expect.arrayContaining(["text-size", "title-safe"]));
		// Captions follow the speech: their pace isn't flagged.
		const captions = {
			...data,
			clips: data.clips.map((c) => ({ ...(c as TextClip), source: { kind: "caption" as const } })),
		};
		expect(kinds(captions)).not.toContain("title-speed");
	});

	it("notes abrupt music, missing captions on vertical video, offline media and disabled clips", () => {
		let data = place(project(), [
			{ type: "media", trackId: "A2", assetId: song.id, startMs: 2000, durationMs: 10000 },
			{ type: "media", trackId: "A1", assetId: voice.id, startMs: 0, durationMs: 4000 },
			{ type: "media", trackId: "V1", assetId: video.id, startMs: 0, durationMs: 5000 },
		]);
		data = { ...data, canvas: { ...data.canvas, width: 1080, height: 1920 } };
		data = {
			...data,
			clips: data.clips.map((c) => (c.trackId === "V1" ? { ...c, disabled: true } : c)),
		};
		const notes = reviewEdit(data, { offline: [voice.id] });
		const abrupt = notes.find((n) => n.kind === "abrupt-audio");
		expect(abrupt?.fix?.params).toMatchObject({ patch: { fadeInMs: 300, fadeOutMs: 300 } });
		expect(notes.find((n) => n.kind === "captions")?.fix?.params).toMatchObject({
			source: "voiceover",
		});
		expect(notes.map((n) => n.kind)).toEqual(expect.arrayContaining(["offline", "disabled"]));
		// Problems come first.
		expect(notes[0].severity).toBe("problem");
	});

	it("reports loudness and peaks only when measured", () => {
		const data = project();
		expect(kinds(data)).toEqual([]);
		const measured = reviewEdit(data, { loudness: { integratedLufs: -28, truePeakDb: 0.4 } });
		expect(measured.map((n) => n.kind)).toEqual(["clipping", "loudness"]);
	});
});

describe("recipes", () => {
	it("fills placeholders, keeping lists and numbers whole", () => {
		const missing = new Set<string>();
		const out = resolveParams(
			{
				ids: "{selectedClipIds}",
				at: "{playheadMs}",
				text: "Made at {playheadMs} ms",
				x: "{nope}",
			},
			{ selectedClipIds: ["c1", "c2"], playheadMs: 1500 },
			missing,
		);
		expect(out).toEqual({ ids: ["c1", "c2"], at: 1500, text: "Made at 1500 ms", x: "{nope}" });
		expect(missing.size).toBe(0);
		resolveParams({ id: "{musicAssetId}" }, { musicAssetId: null }, missing);
		expect([...missing]).toEqual(["musicAssetId"]);
	});

	it("built-in recipes resolve to valid tool calls on a typical project", () => {
		const data = place(project(), [
			{ type: "media", trackId: "V1", assetId: video.id, startMs: 0, durationMs: 8000 },
			{ type: "media", trackId: "A1", assetId: voice.id, startMs: 0, durationMs: 6000 },
			{ type: "media", trackId: "A2", assetId: song.id, startMs: 0, durationMs: 8000 },
		]);
		const ctx = recipeContext(data, { playheadMs: 0, selectedClipIds: [] });
		expect(ctx.musicAssetId).toBe(song.id);
		expect(ctx.voiceoverAssetId).toBe(voice.id);
		expect(ctx.captionSource).toBe("voiceover");
		for (const recipe of BUILT_IN_RECIPES) {
			const steps = resolveRecipe(recipe, ctx);
			expect(steps.filter((s) => s.problem)).toEqual([]);
		}
	});

	it("saves, dry-runs and runs a recipe through the controller, stopping at a failing step", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-recipes-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: path.join(dir, "P") });
		store.apply({ type: "addAsset", asset: video }, "user");
		const controller = new Controller(store, {
			sendCommand: () => false,
			focusWindow: () => {},
			renderText: async () => ({}),
			captureFrame: async () => "",
			runtime: async () => ({ status: () => [] }) as unknown as AiRuntime,
			recipesFile: path.join(dir, "recipes.json"),
		});
		controller.updateRecorder({ currentMs: 2500 });

		const saved = (await controller.call(
			"save_recipe",
			{
				name: "Mark and title",
				steps: [
					{ tool: "add_marker", params: { atMs: "{playheadMs}", label: "Here" } },
					{ tool: "add_text", params: { text: "{projectName}", startMs: "{playheadMs}" } },
					{ tool: "update_clip", params: { id: "{selectedClipId}", patch: { volume: 0.5 } } },
				],
			},
			"agent",
		)) as { id: string };
		expect(saved.id).toBe("mark-and-title");
		const list = (await controller.call("list_recipes", {}, "agent")) as { id: string }[];
		expect(list.map((r) => r.id)).toContain("mark-and-title");

		const dry = (await controller.call("run_recipe", { id: saved.id, dryRun: true }, "agent")) as {
			steps: { params: Record<string, unknown>; problem?: string }[];
		};
		expect(dry.steps[0].params).toEqual({ atMs: 2500, label: "Here" });
		expect(dry.steps[2].problem).toMatch(/selected clip/);
		expect(store.current.markers).toHaveLength(0);

		const result = (await controller.call("run_recipe", { id: saved.id }, "agent")) as {
			ok: boolean;
			done: unknown[];
			failed?: { step: number };
		};
		expect(result.ok).toBe(false);
		expect(result.done).toHaveLength(2);
		expect(result.failed?.step).toBe(3);
		expect(store.current.markers.map((m) => m.atMs)).toEqual([2500]);
		expect(store.current.clips.find((c) => c.type === "text")?.startMs).toBe(2500);

		await expect(
			controller.call("delete_recipe", { id: "social-clip" }, "agent"),
		).rejects.toThrow();
		await controller.call("delete_recipe", { id: saved.id }, "agent");
		const after = (await controller.call("list_recipes", {}, "agent")) as { id: string }[];
		expect(after.map((r) => r.id)).not.toContain(saved.id);
		await expect(
			controller.call("save_recipe", { name: "Nested", steps: [{ tool: "run_recipe" }] }, "agent"),
		).rejects.toThrow();

		const notes = (await controller.call("review_edit", {}, "agent")) as { notes: unknown[] };
		expect(Array.isArray(notes.notes)).toBe(true);
		await store.close("user");
	});
});
