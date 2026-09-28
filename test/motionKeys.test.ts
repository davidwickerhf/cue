import { describe, expect, it } from "vitest";
import {
	addPreset,
	animatedProps,
	clearKeys,
	type Key,
	keyableProps,
	poseAt,
	presetsOf,
	removeKey,
	removePreset,
	restValue,
	retimeKey,
	setKey,
	setKeyEase,
	setKeyValue,
	updatePreset,
	valueAt,
} from "../electron/core/motionKeys";
import { layerAt, moveLayer, updateLayer } from "../electron/core/motionLayers";
import { compileMotion, parseMotionSpec } from "../electron/core/motionSpec";
import {
	clampKeyDelta,
	clampSlide,
	copyKeys,
	deleteKeys,
	easeFromHandles,
	easeKeys,
	interpolateKeys,
	interpolationOf,
	type KeySel,
	keyGlyph,
	keyIndexAt,
	keysAsSel,
	layerSpan,
	moveKeys,
	nextKeyTime,
	pasteKeys,
	resizePreset,
	restPatch,
	selId,
	setInterpolation,
	setValueAt,
	slideLayer,
	snapTime,
	startAnimating,
	stopAnimating,
	toggleKeyAt,
	trimLayer,
} from "../electron/core/motionTimeline";

type Json = Record<string, unknown>;

const spec: Json = {
	width: 1920,
	height: 1080,
	durationMs: 3000,
	layers: [
		{ type: "rect", name: "Box", x: 300, y: 200, width: 200, height: 100, fill: "#e4362b" },
		{
			type: "group",
			name: "Tag",
			pivot: [960, 540],
			layers: [
				{
					type: "text",
					name: "Label",
					text: "OK",
					x: 960,
					y: 540,
					size: 80,
					keys: {
						opacity: [
							[0, 0, "outCubic"],
							[500, 1],
						],
					},
				},
			],
		},
	],
};

const keysAt = (s: Json, path: number[]) => (layerAt(s, path)?.keys ?? {}) as Json;

/** Applies a patch to the layer at `path` and checks the result is still a valid spec. */
function edit(s: Json, path: number[], patch: Json) {
	const next = updateLayer(s, path, patch);
	expect(() => parseMotionSpec(next)).not.toThrow();
	expect(() => compileMotion(next)).not.toThrow();
	return next;
}

describe("editing a layer's keys by hand", () => {
	it("adds keys at a time with the layer's value there, sorted, and keeps the stretch's ease", () => {
		const box = layerAt(spec, [0]) as Json;
		expect(keyableProps(box)).toEqual(expect.arrayContaining(["x", "width", "height", "color"]));
		expect(keyableProps(layerAt(spec, [1, 0]) as Json)).not.toContain("width");
		expect(restValue(spec, box, "x")).toBe(300);

		let r = setKey(box, "x", 1000, restValue(spec, box, "x"), "outExpo");
		let s = edit(spec, [0], r.patch);
		expect(layerAt(s, [0])?.keys).toEqual({ x: [[1000, 300, "outExpo"]] });
		r = setKey(layerAt(s, [0]) as Json, "x", 2000, 800);
		s = edit(s, [0], r.patch);
		r = setKey(layerAt(s, [0]) as Json, "x", 200.4, 100);
		s = edit(s, [0], r.patch);
		expect(r.index).toBe(0);
		expect(keysAt(s, [0]).x).toEqual([
			[200, 100],
			[1000, 300, "outExpo"],
			[2000, 800],
		]);
		// A key between two splits their stretch and keeps its ease.
		r = setKey(layerAt(s, [0]) as Json, "x", 1500, 500);
		expect(r.index).toBe(2);
		expect(((r.patch.keys as Json).x as unknown[])[2]).toEqual([1500, 500, "outExpo"]);
		// A key at the same time takes the new value.
		r = setKey(layerAt(s, [0]) as Json, "x", 1000, 350);
		expect(r.index).toBe(1);
		expect(((r.patch.keys as Json).x as unknown[])[1]).toEqual([1000, 350, "outExpo"]);
	});

	it("reads values between keys through the ease, and holds them outside", () => {
		const label = layerAt(spec, [1, 0]) as Json;
		expect(valueAt(spec, label, "opacity", 0)).toBe(0);
		expect(valueAt(spec, label, "opacity", 2000)).toBe(1);
		const mid = Number(valueAt(spec, label, "opacity", 250));
		// outCubic is well past halfway at half time.
		expect(mid).toBeGreaterThan(0.7);
		expect(mid).toBeLessThan(1);
		// Unkeyed properties are their rest value.
		expect(valueAt(spec, label, "x", 250)).toBe(960);
		expect(poseAt(spec, layerAt(spec, [0]) as Json, 0)).toMatchObject({ x: 300 });
	});

	it("retimes, changes and deletes keys, and clears a property", () => {
		const label = layerAt(spec, [1, 0]) as Json;
		// Moving the first key past the second reorders them.
		let r = retimeKey(label, "opacity", 0, 800);
		expect(r.index).toBe(1);
		let s = edit(spec, [1, 0], r.patch);
		expect(keysAt(s, [1, 0]).opacity).toEqual([
			[500, 1],
			[800, 0, "outCubic"],
		]);
		// Onto another key's time: that key gives way.
		r = retimeKey(layerAt(s, [1, 0]) as Json, "opacity", 1, 500);
		expect((r.patch.keys as Json).opacity).toEqual([[500, 0, "outCubic"]]);

		s = edit(spec, [1, 0], setKeyValue(label, "opacity", 1, 0.5));
		s = edit(s, [1, 0], setKeyEase(layerAt(s, [1, 0]) as Json, "opacity", 0, "hold"));
		expect(keysAt(s, [1, 0]).opacity).toEqual([
			[0, 0, "hold"],
			[500, 0.5],
		]);
		s = edit(s, [1, 0], setKeyEase(layerAt(s, [1, 0]) as Json, "opacity", 0, undefined));
		expect(keysAt(s, [1, 0]).opacity).toEqual([
			[0, 0],
			[500, 0.5],
		]);

		s = edit(s, [1, 0], removeKey(layerAt(s, [1, 0]) as Json, "opacity", 0));
		expect(keysAt(s, [1, 0]).opacity).toEqual([[500, 0.5]]);
		// The last key gone: no keys left at all (a spec needs at least one per property).
		s = edit(s, [1, 0], removeKey(layerAt(s, [1, 0]) as Json, "opacity", 0));
		expect(layerAt(s, [1, 0])?.keys).toBeUndefined();

		const two = edit(spec, [1, 0], setKey(label, "x", 0, 900).patch);
		const cleared = edit(two, [1, 0], clearKeys(layerAt(two, [1, 0]) as Json, "opacity"));
		expect(animatedProps(layerAt(cleared, [1, 0]) as Json)).toEqual(["x"]);
	});

	it("moves keyed positions along when a layer is dragged", () => {
		const box = layerAt(spec, [0]) as Json;
		const keyed = edit(spec, [0], {
			keys: {
				x: [
					[0, 100, "outExpo"],
					[1000, 300],
				],
			},
		});
		expect(box.x).toBe(300);
		const moved = moveLayer(keyed, [0], 50, 10);
		expect(layerAt(moved, [0])).toMatchObject({
			x: 350,
			y: 210,
			keys: {
				x: [
					[0, 150, "outExpo"],
					[1000, 350],
				],
			},
		});
		// A group with a pivot: its keyed position moves with the pivot and its layers.
		const group = edit(spec, [1], { keys: { x: [[0, 900]] } });
		const shifted = moveLayer(group, [1], 20, 0);
		expect(layerAt(shifted, [1])).toMatchObject({ pivot: [980, 540], keys: { x: [[0, 920]] } });
		expect(layerAt(shifted, [1, 0])).toMatchObject({ x: 980 });
	});
});

describe("editing enter and exit presets", () => {
	it("adds, changes and removes several presets on each side", () => {
		const box = layerAt(spec, [0]) as Json;
		let s = edit(spec, [0], addPreset(spec, box, "enter"));
		s = edit(s, [0], addPreset(spec, layerAt(s, [0]) as Json, "enter"));
		// The second entrance starts where the first ends.
		expect(presetsOf(layerAt(s, [0]) as Json, "enter")).toEqual([
			{ preset: "fade", atMs: 0 },
			{ preset: "fade", atMs: 400 },
		]);
		s = edit(
			s,
			[0],
			updatePreset(layerAt(s, [0]) as Json, "enter", 1, {
				preset: "rise",
				durationMs: 900,
				ease: "outBack",
				amount: 80,
			}),
		);
		expect(presetsOf(layerAt(s, [0]) as Json, "enter")[1]).toEqual({
			preset: "rise",
			atMs: 400,
			durationMs: 900,
			ease: "outBack",
			amount: 80,
		});
		// A preset that takes no amount drops it; an unset ease goes back to the preset's own.
		s = edit(
			s,
			[0],
			updatePreset(layerAt(s, [0]) as Json, "enter", 1, { preset: "fade", ease: undefined }),
		);
		expect(presetsOf(layerAt(s, [0]) as Json, "enter")[1]).toEqual({
			preset: "fade",
			atMs: 400,
			durationMs: 900,
		});

		// An exit ends at the graphic's end (or the layer's).
		s = edit(s, [0], addPreset(spec, layerAt(s, [0]) as Json, "exit"));
		expect(presetsOf(layerAt(s, [0]) as Json, "exit")).toEqual([{ preset: "fade", atMs: 2600 }]);

		s = edit(s, [0], removePreset(layerAt(s, [0]) as Json, "enter", 0));
		s = edit(s, [0], removePreset(layerAt(s, [0]) as Json, "enter", 0));
		expect(layerAt(s, [0])).not.toHaveProperty("enter");
	});

	it("reads a single preset written on its own as a list", () => {
		const layer = { type: "rect", width: 10, height: 10, exit: { preset: "fade", atMs: 100 } };
		expect(presetsOf(layer, "exit")).toEqual([{ preset: "fade", atMs: 100 }]);
		expect(updatePreset(layer, "exit", 0, { atMs: 250.6 })).toEqual({
			exit: [{ preset: "fade", atMs: 251 }],
		});
	});
});

describe("the timeline: picked keys", () => {
	const keyed = (): Json =>
		edit(spec, [0], {
			keys: {
				x: [
					[0, 100, "outExpo"],
					[500, 300],
					[1000, 500],
				],
				opacity: [
					[0, 0],
					[400, 1],
				],
			},
		});

	it("moves picked keys across properties together, replacing keys they land on", () => {
		const s = keyed();
		const sel: KeySel[] = [
			{ path: [0], prop: "x", ms: 0 },
			{ path: [0], prop: "opacity", ms: 400 },
		];
		const r = moveKeys(s, sel, 500);
		expect(() => parseMotionSpec(r.spec)).not.toThrow();
		expect(keysAt(r.spec, [0]).x).toEqual([
			[500, 100, "outExpo"],
			[1000, 500],
		]);
		expect(keysAt(r.spec, [0]).opacity).toEqual([
			[0, 0],
			[900, 1],
		]);
		expect(r.sel.map(selId).sort()).toEqual(["0|opacity|900", "0|x|500"]);
		// Clamped to the graphic: nothing before 0 or past its end.
		expect(clampKeyDelta(s, sel, -900)).toBe(0);
		expect(clampKeyDelta(s, [{ path: [0], prop: "x", ms: 1000 }], 5000)).toBe(2000);
		expect(moveKeys(s, sel, 0).spec).toBe(s);
	});

	it("deletes picked keys and stops animating a property left without any", () => {
		const r = deleteKeys(keyed(), [
			{ path: [0], prop: "opacity", ms: 0 },
			{ path: [0], prop: "opacity", ms: 400 },
			{ path: [0], prop: "x", ms: 500 },
		]);
		expect(() => compileMotion(r)).not.toThrow();
		expect(keysAt(r, [0])).toEqual({
			x: [
				[0, 100, "outExpo"],
				[1000, 500],
			],
		});
		expect(keysAsSel(layerAt(r, [0]) as Json, [0]).map(selId)).toEqual(["0|x|0", "0|x|1000"]);
	});

	it("copies keys and pastes them at the playhead on the same properties", () => {
		const s = keyed();
		const clip = copyKeys(s, [
			{ path: [0], prop: "x", ms: 500 },
			{ path: [0], prop: "x", ms: 1000 },
			{ path: [0], prop: "opacity", ms: 400 },
		]);
		expect(clip).toEqual([
			{ prop: "opacity", offsetMs: 0, value: 1, ease: undefined },
			{ prop: "x", offsetMs: 100, value: 300, ease: undefined },
			{ prop: "x", offsetMs: 600, value: 500, ease: undefined },
		]);
		const r = pasteKeys(s, [0], clip, 2000);
		expect(() => parseMotionSpec(r.spec)).not.toThrow();
		expect(keysAt(r.spec, [0]).x).toEqual([
			[0, 100, "outExpo"],
			[500, 300],
			[1000, 500],
			[2100, 300],
			[2600, 500],
		]);
		expect(r.sel.map(selId)).toEqual(["0|opacity|2000", "0|x|2100", "0|x|2600"]);
		// Onto a text layer: it can't animate width, so width keys are skipped; nothing lands past the end.
		const w = pasteKeys(spec, [1, 0], [{ prop: "width", offsetMs: 0, value: 10 }], 0);
		expect(w.sel).toEqual([]);
		expect(pasteKeys(s, [0], clip, 2800).sel.map(selId)).toEqual(["0|opacity|2800", "0|x|2900"]);
	});
});

describe("the timeline: interpolation", () => {
	const ks: Key[] = [
		[0, 0],
		[500, 1],
		[1000, 0],
	];
	it("draws key glyphs from the eases on each side", () => {
		expect(keyGlyph(ks, 1)).toEqual({ in: "linear", out: "linear" });
		const eased: Key[] = [
			[0, 0, "out"],
			[500, 1, "hold"],
			[1000, 0],
		];
		// "out" slows into its next key: an eased arrival there, a straight departure here.
		expect(keyGlyph(eased, 0)).toEqual({ in: "linear", out: "linear" });
		expect(keyGlyph(eased, 1)).toEqual({ in: "eased", out: "hold" });
		expect(keyGlyph(eased, 2)).toEqual({ in: "hold", out: "linear" });
		expect(keyGlyph([[0, 0, "outExpo"]], 0)).toEqual({ in: "eased", out: "eased" });
	});

	it("applies Easy Ease, Ease In, Ease Out, Linear and Hold like After Effects", () => {
		// Easy Ease on the middle key: the stretch before ends eased, the one after starts eased.
		let next = setInterpolation(ks, 1, "easy");
		expect(next).toEqual([
			[0, 0, "out"],
			[500, 1, "in"],
			[1000, 0],
		]);
		expect(interpolationOf(next, 1)).toBe("easy");
		// Both ends of a stretch eased read as the named ease-in-out.
		next = setInterpolation(next, 0, "easy");
		expect(next[0]).toEqual([0, 0, "inOut"]);
		// Ease In changes only the arrival; Ease Out only the departure.
		expect(setInterpolation(ks, 1, "easeIn")).toEqual([
			[0, 0, "out"],
			[500, 1],
			[1000, 0],
		]);
		expect(interpolationOf(setInterpolation(ks, 1, "easeOut"), 1)).toBe("easeOut");
		// A curve that matches no name is kept as handles.
		const expo: Key[] = [
			[0, 0, "outExpo"],
			[500, 1],
		];
		expect(setInterpolation(expo, 1, "easeIn")[0]).toEqual([0, 0, [0.16, 1, 0.58, 1]]);
		expect(easeFromHandles([0.16, 1, 0.3, 1])).toBe("outExpo");
		expect(easeFromHandles([0, 0, 1, 1])).toBeUndefined();
		// Hold, then Linear straightens both sides again.
		const held = setInterpolation(next, 1, "hold");
		expect(held[1]).toEqual([500, 1, "hold"]);
		expect(interpolationOf(held, 1)).toBe("hold");
		const straight = setInterpolation(held, 1, "linear");
		expect(straight[1]).toEqual([500, 1]);
		expect(straight[0]).toEqual([0, 0, "in"]);
		expect(interpolationOf(straight, 1)).toBe("linear");
	});

	it("eases picked keys in a spec, and the result compiles", () => {
		const s = edit(spec, [0], { keys: { x: ks, y: ks } });
		const sel: KeySel[] = [
			{ path: [0], prop: "x", ms: 500 },
			{ path: [0], prop: "y", ms: 0 },
		];
		const eased = interpolateKeys(s, sel, "easy");
		expect(() => compileMotion(eased)).not.toThrow();
		expect(keysAt(eased, [0]).x).toEqual([
			[0, 0, "out"],
			[500, 1, "in"],
			[1000, 0],
		]);
		expect((keysAt(eased, [0]).y as Key[])[0]).toEqual([0, 0, "in"]);
		const custom = easeKeys(s, sel, [0.2, 0.8, 0.3, 1]);
		expect(() => parseMotionSpec(custom)).not.toThrow();
		expect((keysAt(custom, [0]).x as Key[])[1]).toEqual([500, 1, [0.2, 0.8, 0.3, 1]]);
	});
});

describe("the timeline: one property", () => {
	it("turns the stopwatch on and off, keeping the value at the playhead", () => {
		const box = layerAt(spec, [0]) as Json;
		let s = edit(spec, [0], startAnimating(spec, box, "x", 500));
		expect(keysAt(s, [0]).x).toEqual([[500, 300]]);
		s = edit(s, [0], setValueAt(layerAt(s, [0]) as Json, "x", 1500, 700));
		expect(keysAt(s, [0]).x).toEqual([
			[500, 300],
			[1500, 700],
		]);
		// Off at 1000: the keys go and x stays where it was then.
		s = edit(s, [0], stopAnimating(s, layerAt(s, [0]) as Json, "x", 1000));
		expect(layerAt(s, [0])).toMatchObject({ x: 500 });
		expect(layerAt(s, [0])?.keys).toBeUndefined();
		// A still property takes the value itself.
		expect(setValueAt(layerAt(s, [0]) as Json, "rotation", 0, 45)).toEqual({ rotation: 45 });
		// A rect has no still trim: setting one starts animating it.
		expect(setValueAt(box, "trimEnd", 200, 0.5)).toEqual({ keys: { trimEnd: [[200, 0.5]] } });
	});

	it("writes still values in the layer's own form", () => {
		const box = layerAt(spec, [0]) as Json;
		expect(restPatch(box, "color", "#00ff00")).toEqual({ fill: "#00ff00" });
		expect(restPatch({ type: "line", stroke: "#fff" }, "color", "#000000")).toEqual({
			stroke: "#000000",
		});
		expect(restPatch({ type: "rect", scale: [2, 1] }, "scale", 4)).toEqual({ scale: [4, 2] });
		expect(restPatch({ type: "rect" }, "scaleY", 3)).toEqual({ scale: [1, 3] });
		expect(restPatch({ type: "arc" }, "trimEnd", 0.5)).toEqual({ to: 0.5 });
		expect(restPatch(box, "opacity", 4)).toEqual({ opacity: 1 });
	});

	it("adds or removes the key at the playhead, and finds the keys around it", () => {
		const label = layerAt(spec, [1, 0]) as Json;
		expect(keyIndexAt(label, "opacity", 500.3)).toBe(1);
		const removed = toggleKeyAt(spec, label, "opacity", 500.3);
		expect(removed).toEqual({ keys: { opacity: [[0, 0, "outCubic"]] } });
		const added = toggleKeyAt(spec, label, "opacity", 250);
		expect(((added.keys as Json).opacity as Key[])[1][0]).toBe(250);
		expect(nextKeyTime(spec, label, 0, 1, "opacity")).toBe(500);
		expect(nextKeyTime(spec, label, 500, 1, "opacity")).toBeUndefined();
		expect(nextKeyTime(spec, label, 400, -1, "opacity")).toBe(0);
		// J and K also stop at the layer's in and out points.
		expect(nextKeyTime(spec, label, 500, 1)).toBe(3000);
	});

	it("snaps to whole frames and to targets nearby", () => {
		expect(snapTime(40, 30)).toBeCloseTo(33.333, 2);
		expect(snapTime(40, 30, [50], 12)).toBe(50);
		expect(snapTime(40, 30, [100], 12)).toBeCloseTo(33.333, 2);
	});
});

describe("the timeline: a layer's time", () => {
	const timed = (): Json =>
		edit(spec, [0], {
			startMs: 500,
			keys: {
				x: [
					[600, 100],
					[1200, 400],
				],
			},
			enter: { preset: "fade", atMs: 500 },
			exit: [{ preset: "fade", atMs: 2600 }],
		});

	it("trims the start and end, taking entrances and exits along", () => {
		const s = timed();
		let t = trimLayer(s, [0], "start", 800);
		expect(() => compileMotion(t)).not.toThrow();
		expect(layerAt(t, [0])).toMatchObject({
			startMs: 800,
			enter: [{ preset: "fade", atMs: 800 }],
			keys: {
				x: [
					[600, 100],
					[1200, 400],
				],
			},
		});
		t = trimLayer(t, [0], "end", 2000);
		expect(layerAt(t, [0])).toMatchObject({ endMs: 2000, exit: [{ preset: "fade", atMs: 1600 }] });
		expect(layerSpan(t, layerAt(t, [0]) as Json)).toEqual({ start: 800, end: 2000 });
		// Back to the end of the graphic: no end written.
		t = trimLayer(t, [0], "end", 5000);
		expect(layerAt(t, [0])).not.toHaveProperty("endMs");
		// A preset away from the edge stays, until the edge passes it.
		const later = edit(s, [0], { enter: { preset: "fade", atMs: 1000 } });
		expect(layerAt(trimLayer(later, [0], "start", 800), [0])).toMatchObject({
			enter: [{ atMs: 1000 }],
		});
		expect(layerAt(trimLayer(later, [0], "start", 1300), [0])).toMatchObject({
			enter: [{ atMs: 1300 }],
		});
		// A start can't pass the end.
		expect(layerAt(trimLayer(s, [0], "start", 9000), [0])).toMatchObject({ startMs: 2990 });
		// To 0: no start written.
		expect(layerAt(trimLayer(s, [0], "start", -40), [0])).not.toHaveProperty("startMs");
	});

	it("slides a layer with its keys, presets and a group's layers", () => {
		const s = timed();
		const slid = slideLayer(s, [0], 300);
		expect(() => compileMotion(slid)).not.toThrow();
		expect(layerAt(slid, [0])).toMatchObject({
			startMs: 800,
			endMs: 3300,
			keys: {
				x: [
					[900, 100],
					[1500, 400],
				],
			},
			enter: { preset: "fade", atMs: 800 },
			exit: [{ preset: "fade", atMs: 2900 }],
		});
		// Back again: the same as before (no end written at the graphic's end).
		expect(layerAt(slideLayer(slid, [0], -300), [0])).toEqual(layerAt(s, [0]));
		// Nothing goes before 0.
		expect(clampSlide(s, [0], -2000)).toBe(-500);
		// A group moves what is in it.
		const group = slideLayer(spec, [1], 200);
		expect(() => compileMotion(group)).not.toThrow();
		expect(layerAt(group, [1])).toMatchObject({ startMs: 200, endMs: 3200 });
		expect(layerAt(group, [1, 0])).toMatchObject({
			keys: {
				opacity: [
					[200, 0, "outCubic"],
					[700, 1],
				],
			},
		});
	});

	it("drags a preset's edges or the whole preset", () => {
		const s = timed();
		const layer = layerAt(s, [0]) as Json;
		let t = edit(s, [0], resizePreset(s, layer, "enter", 0, "end", 1400));
		expect(presetsOf(layerAt(t, [0]) as Json, "enter")).toEqual([
			{ preset: "fade", atMs: 500, durationMs: 900 },
		]);
		t = edit(t, [0], resizePreset(t, layerAt(t, [0]) as Json, "exit", 0, "start", 2200));
		expect(presetsOf(layerAt(t, [0]) as Json, "exit")).toEqual([
			{ preset: "fade", atMs: 2200, durationMs: 800 },
		]);
		t = edit(t, [0], resizePreset(t, layerAt(t, [0]) as Json, "exit", 0, "move", 2000));
		expect(presetsOf(layerAt(t, [0]) as Json, "exit")[0]).toMatchObject({ atMs: 2000 });
		// Never shorter than the minimum.
		t = edit(t, [0], resizePreset(t, layerAt(t, [0]) as Json, "enter", 0, "end", 0));
		expect(presetsOf(layerAt(t, [0]) as Json, "enter")[0].durationMs).toBe(10);
	});
});

describe("hidden layers", () => {
	it("are kept in the spec but not drawn", () => {
		const shown = compileMotion(spec) as { layers: unknown[] };
		const hidden = compileMotion(edit(spec, [0], { hidden: true })) as { layers: unknown[] };
		expect(hidden.layers.length).toBe(shown.layers.length - 1);
	});
});
