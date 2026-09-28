import { describe, expect, it } from "vitest";
import {
	addPreset,
	animatedProps,
	clearKeys,
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
