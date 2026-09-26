import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isLottie, type LottieJson, motionInfo } from "../electron/core/motion";
import { compileMotion, easeAt, parsePath } from "../electron/core/motionSpec";
import { buildTemplate, describeParams, MOTION_TEMPLATES } from "../electron/core/motionTemplates";
import { ProjectStore } from "../electron/core/store";
import type { MediaClip } from "../electron/core/types";

const canvas = { width: 1920, height: 1080, fps: 30 };

describe("motion specs", () => {
	it("eases from 0 to 1 and overshoots only where asked", () => {
		expect(easeAt("outExpo", 0)).toBeCloseTo(0, 5);
		expect(easeAt("outExpo", 1)).toBeCloseTo(1, 5);
		expect(easeAt("outExpo", 0.2)).toBeGreaterThan(0.5);
		expect(easeAt("linear", 0.3)).toBeCloseTo(0.3, 3);
		const back = Array.from({ length: 50 }, (_, i) => easeAt("outBack", i / 49));
		expect(Math.max(...back)).toBeGreaterThan(1);
	});

	it("reads SVG path data, relative commands and closing included", () => {
		const [square] = parsePath("M10 10 h100 v100 H10 Z");
		expect(square.v).toEqual([
			[10, 10],
			[110, 10],
			[110, 110],
			[10, 110],
		]);
		expect(square.c).toBe(true);
		const [curve] = parsePath("M0 0 C 10 0 20 10 20 20");
		expect(curve.o[0]).toEqual([10, 0]);
		expect(curve.i[1]).toEqual([0, -10]);
	});

	it("compiles layers bottom to top, with presets, clips, counters and markers", () => {
		const json = compileMotion({
			width: 1280,
			height: 720,
			fps: 25,
			durationMs: 4000,
			background: "#101010",
			markers: [{ name: "outro", atMs: 3200 }],
			layers: [
				{
					type: "rect",
					name: "Bar",
					x: 100,
					y: 360,
					origin: "left",
					width: 600,
					height: 40,
					fill: "#ff0000",
					keys: {
						width: [
							[500, 0, "outExpo"],
							[1500, 600],
						],
					},
				},
				{
					type: "text",
					name: "Headline",
					text: "Hello",
					size: 80,
					x: 640,
					y: 200,
					clip: { x: 0, y: 150, width: 1280, height: 100 },
					enter: { preset: "rise", atMs: 200, amount: 100 },
				},
				{
					type: "text",
					name: "Count",
					text: "",
					size: 60,
					count: { from: 0, to: 1250, atMs: 0, durationMs: 1000, separator: ",", suffix: " fans" },
				},
			],
		});
		expect(isLottie(json)).toBe(true);
		expect(json.op).toBe(100);
		// Top first: the counter, then the headline's matte and the headline, the bar, the background.
		expect(json.layers.map((l: LottieJson) => l.nm)).toEqual([
			"Count",
			"Headline clip",
			"Headline",
			"Bar",
			"Background",
		]);
		expect(json.layers[1].td).toBe(1);
		expect(json.layers[2].tt).toBe(1);
		// The rise starts 100 px low and ends where the text rests (both shifted to the baseline).
		const y = json.layers[2].ks.p.y.k;
		expect(y[0].s[0] - y[1].s[0]).toBeCloseTo(100);
		// Width keys grow the bar from its left edge: the rectangle's centre moves with its width.
		const rect = json.layers[3].shapes[0].it[0];
		expect(rect.s.k[0].s).toEqual([0, 40]);
		expect(rect.p.k[1].s).toEqual([300, 0]);
		// The counter ends on the formatted value.
		const docs = json.layers[0].t.d.k;
		expect(docs.at(-1).s.t).toBe("1,250 fans");
		expect(json.fonts.list.map((f: LottieJson) => f.fName)).toEqual(["Inter-600"]);
		expect(motionInfo(json).markers).toEqual([{ name: "outro", startMs: 3200, durationMs: 0 }]);
	});

	it("explains what is wrong with a bad spec", () => {
		expect(() =>
			compileMotion({ durationMs: 1000, layers: [{ type: "rect", width: 10 }] }),
		).toThrow(/layers\.0\.height/);
		expect(() =>
			compileMotion({
				durationMs: 1000,
				layers: [{ type: "text", text: "x", size: 20, color: "red" }],
			}),
		).toThrow(/#rrggbb/);
	});
});

describe("motion templates", () => {
	it.each(MOTION_TEMPLATES.map((t) => [t.id, t]))(
		"%s builds and compiles from its example",
		(_, t) => {
			for (const size of [canvas, { width: 1080, height: 1920, fps: 30 }]) {
				const spec = buildTemplate(t.id, t.example, size);
				const json = compileMotion(spec);
				expect(isLottie(json)).toBe(true);
				expect(json.w).toBe(size.width);
				const info = motionInfo(json);
				if (t.category === "transition") expect(info.markers.map((m) => m.name)).toContain("cut");
				else expect(info.markers.map((m) => m.name)).toContain("outro");
			}
			expect(Object.keys(describeParams(t))).toContain("theme");
		},
	);

	it("says which parameter is wrong", () => {
		expect(() => buildTemplate("bar-chart", { items: [] }, canvas)).toThrow(/items/);
		expect(() => buildTemplate("nope", {}, canvas)).toThrow(/No motion template/);
	});
});

describe("motion graphics made in a project", () => {
	it("creates, places on a cut, rebuilds and undoes", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-mgfx-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Graphics" });
		const { asset, clipId } = await store.createMotionGraphic(
			{
				template: "lower-third",
				params: { name: "Ada Lovelace", role: "Analyst" },
				place: { startMs: 1000 },
			},
			"agent",
		);
		expect(asset.kind).toBe("lottie");
		expect(asset.motionSource).toEqual({
			template: "lower-third",
			params: { name: "Ada Lovelace", role: "Analyst" },
		});
		expect(asset.motion?.texts.map((t) => t.text)).toContain("Ada Lovelace");
		const clip = store.current.clips.find((c) => c.id === clipId) as MediaClip;
		expect(clip.startMs).toBe(1000);
		expect(clip.trackId).toBe("V1");

		// A transition centred on a cut at 5 s; V1 is busy there, so it gets a Graphics track.
		const t = await store.createMotionGraphic(
			{ template: "transition-panels", params: { durationMs: 1000 }, place: { atCutMs: 1500 } },
			"agent",
		);
		const tc = store.current.clips.find((c) => c.id === t.clipId) as MediaClip;
		expect(tc.startMs).toBe(1000);
		expect(store.current.tracks.find((x) => x.id === tc.trackId)?.name).toBe("Graphics");

		const before = asset.path;
		const updated = await store.updateMotionGraphic(
			asset.id,
			{ params: { name: "Grace Hopper" } },
			"agent",
		);
		expect(updated.path).not.toBe(before);
		expect(updated.motionSource?.params).toEqual({ name: "Grace Hopper", role: "Analyst" });
		expect(updated.motion?.texts.map((x) => x.text)).toContain("Grace Hopper");
		store.undo("user");
		expect(store.current.assets.find((a) => a.id === asset.id)?.path).toBe(before);

		const { spec } = store.motionGraphicSource(asset.id);
		expect((spec as { layers: unknown[] }).layers.length).toBeGreaterThan(2);
		// A spec of its own replaces a graphic.
		const own = await store.createMotionGraphic(
			{
				spec: {
					durationMs: 2000,
					layers: [
						{
							type: "ellipse",
							width: 200,
							height: 200,
							fill: "#22cc88",
							enter: { preset: "pop", atMs: 0 },
						},
					],
				},
			},
			"agent",
		);
		expect(own.asset.width).toBe(1920);
		expect(own.asset.durationMs).toBe(2000);
	});
});
