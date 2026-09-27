import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isLottie, type LottieJson, motionInfo } from "../electron/core/motion";
import {
	compileMotion,
	easeAt,
	parsePath,
	textBoxes,
	textWidth,
} from "../electron/core/motionSpec";
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

	it("turns SVG arcs into curves that stay on the circle", () => {
		const [circle] = parsePath("M -10 0 A 10 10 0 0 0 10 0 A 10 10 0 0 0 -10 0 Z");
		expect(circle.c).toBe(true);
		const at = (k: number, t: number) => {
			const n = (k + 1) % circle.v.length;
			const [p0, p3] = [circle.v[k], circle.v[n]];
			const c1 = [p0[0] + circle.o[k][0], p0[1] + circle.o[k][1]];
			const c2 = [p3[0] + circle.i[n][0], p3[1] + circle.i[n][1]];
			const b = (a: number, b: number, c: number, d: number) =>
				(1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
			return [b(p0[0], c1[0], c2[0], p3[0]), b(p0[1], c1[1], c2[1], p3[1])];
		};
		for (let k = 0; k < circle.v.length; k++)
			for (const t of [0, 0.25, 0.5, 0.75]) expect(Math.hypot(...at(k, t))).toBeCloseTo(10, 1);
		// Sweep 0 turns anticlockwise on screen: from the left point through the bottom (y down).
		expect(circle.v[1][0]).toBeCloseTo(0, 6);
		expect(circle.v[1][1]).toBeCloseTo(10, 6);
		// Relative arcs end where they say; radii too small grow to reach.
		const [half] = parsePath("M 0 0 a 1 1 0 0 1 10 0");
		expect(half.v.at(-1)?.[0]).toBeCloseTo(10, 6);
		expect(half.v.some(([, y]) => y < -4.9)).toBe(true);
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

	it("measures text with the bundled fonts' widths", () => {
		// Narrow letters measure narrower than wide ones, and tracking adds per letter.
		expect(textWidth("iiii", 100)).toBeLessThan(textWidth("MMMM", 100));
		expect(textWidth("AB", 100, "sans", 10)).toBeCloseTo(textWidth("AB", 100) + 20, 6);
		// Several lines: the widest.
		expect(textWidth("A\nABC", 50)).toBeCloseTo(textWidth("ABC", 50), 6);
	});

	it("turns and scales text around x, y and sets runs side by side", () => {
		const json = compileMotion({
			durationMs: 2000,
			layers: [
				{ type: "text", name: "Title", text: "Hello", size: 100, x: 400, y: 300, align: "center" },
				{
					type: "text",
					name: "Label",
					x: 100,
					y: 600,
					size: 40,
					runs: [{ text: "CHAPTER 2" }, { text: " Title", color: "#ff0000", weight: 400 }],
				},
			],
		});
		const title = json.layers.find((l: LottieJson) => l.nm === "Title");
		// The anchor is on x, y (the baseline sits lower, by half the cap height).
		expect(title.ks.p.x.k).toBe(400);
		expect(title.ks.p.y.k).toBe(300);
		expect(title.ks.a.k[1]).toBeLessThan(0);
		const label = json.layers.find((l: LottieJson) => l.nm === "Label");
		expect(label.ty).toBe(0);
		const runs = json.assets.find((a: LottieJson) => a.id === label.refId).layers;
		// Top first: the second run is to the right of the first, in its own colour.
		const [second, first] = runs;
		expect(first.t.d.k[0].s.t).toBe("CHAPTER 2");
		expect(second.t.d.k[0].s.fc).toEqual([1, 0, 0]);
		expect(second.ks.p.x.k).toBeGreaterThan(first.ks.p.x.k);
		// Both share one baseline.
		expect(first.ks.p.y.k - first.ks.a.k[1]).toBeCloseTo(second.ks.p.y.k - second.ks.a.k[1], 1);
	});

	it("combines presets with keys at other times, and follows a route", () => {
		const json = compileMotion({
			durationMs: 3000,
			fps: 30,
			layers: [
				{
					type: "rect",
					name: "Button",
					width: 200,
					height: 80,
					enter: { preset: "pop", atMs: 0, durationMs: 500 },
					keys: {
						scale: [
							[1000, 1],
							[1100, 0.9],
							[1300, 1],
						],
						opacity: [
							[0, 0],
							[200, 1],
						],
					},
					exit: { preset: "fade", atMs: 2500, durationMs: 300 },
				},
				{
					type: "line",
					name: "Route",
					points: [
						[0, 500],
						[1000, 500],
					],
					enter: { preset: "draw", atMs: 0, durationMs: 1000 },
				},
				{
					type: "ellipse",
					name: "Dot",
					width: 20,
					height: 20,
					follow: { line: "Route", atMs: 0, durationMs: 1000, ease: "linear" },
				},
			],
		});
		const button = json.layers.find((l: LottieJson) => l.nm === "Button");
		// Pop (from 0.6 at 0 ms) then the press keys.
		const scales = button.ks.s.k.map((k: LottieJson) => [k.t, k.s[0]]);
		expect(scales[0]).toEqual([0, 60]);
		expect(scales.map((k: number[]) => k[1])).toContain(90);
		// The fade out joins the opacity keys; the pop's own fade in overlaps them and is left out.
		const opacity = button.ks.o.k.map((k: LottieJson) => k.s[0]);
		expect(opacity).toEqual([0, 100, 100, 0]);
		const dot = json.layers.find((l: LottieJson) => l.nm === "Dot");
		const xs = dot.ks.p.x.k;
		expect(xs[0].s[0]).toBeCloseTo(0, 3);
		expect(xs[15].s[0]).toBeCloseTo(500, 0);
		expect(xs.at(-1).s[0]).toBeCloseTo(1000, 3);
		expect(dot.ks.p.y.k[5].s[0]).toBeCloseTo(500, 3);
		expect(() =>
			compileMotion({
				durationMs: 1000,
				layers: [
					{
						type: "ellipse",
						width: 1,
						height: 1,
						follow: { line: "Nope", atMs: 0, durationMs: 100 },
					},
				],
			}),
		).toThrow(/no line layer named "Nope"/);
	});

	it("reports where text lands", () => {
		const boxes = textBoxes({
			width: 1920,
			height: 1080,
			durationMs: 1000,
			layers: [
				{ type: "text", name: "Left", text: "Hello", size: 100, x: 200, y: 300 },
				{ type: "text", name: "Centre", text: "Hello", size: 100, x: 960, y: 300, align: "center" },
			],
		});
		const [left, centre] = boxes;
		expect(left.left).toBe(200);
		expect(left.right - left.left).toBe(Math.round(textWidth("Hello", 100)));
		expect(centre.left + centre.right).toBeCloseTo(1920, -1);
		// The middle of the capitals is on y.
		expect((left.top + left.bottom) / 2).toBeCloseTo(300, -1);
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
				else if (t.category !== "annotation" && t.category !== "frame")
					expect(info.markers.map((m) => m.name)).toContain("outro");
			}
			// Annotations and device frames have their own colours rather than a theme.
			if (t.category !== "annotation" && t.category !== "frame")
				expect(Object.keys(describeParams(t))).toContain("theme");
		},
	);

	it("fits kinetic words and the subscribe button to their text", () => {
		for (const size of [canvas, { width: 1080, height: 1920, fps: 30 }])
			for (const layout of ["stack", "line"]) {
				const spec = buildTemplate(
					"kinetic-words",
					{ words: ["Imagine", "Prototype", "Iterate"], layout },
					size,
				);
				for (const box of textBoxes(spec)) {
					expect(box.left).toBeGreaterThanOrEqual(0);
					expect(box.right).toBeLessThanOrEqual(size.width);
				}
			}
		const long = buildTemplate(
			"subscribe",
			{ label: "Subscribe now", doneLabel: "Subscribed" },
			canvas,
		);
		const boxes = textBoxes(long);
		const button = JSON.stringify(long).match(
			/"name":"Button","x":([\d.]+),"y":[\d.]+,"width":([\d.]+)/,
		);
		const right = Number(button?.[1]) + Number(button?.[2]) / 2;
		for (const box of boxes) expect(box.right).toBeLessThan(right);
	});

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
