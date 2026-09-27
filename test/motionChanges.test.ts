import { describe, expect, it } from "vitest";
import { motionChanges, motionDiffers } from "../electron/core/motion";

const layer = (extra = {}) => ({
	ty: 4,
	ip: 0,
	op: 300,
	st: 0,
	ks: { o: { a: 0, k: 100 }, p: { a: 0, k: [0, 0] } },
	...extra,
});

describe("motion changes for export", () => {
	it("a still graphic never differs, so it is drawn once", () => {
		const c = motionChanges({ fr: 30, ip: 0, op: 300, layers: [layer()] });
		expect(motionDiffers(c, 1, 250)).toBe(false);
	});
	it("frames inside a keyframe span or across a layer's start differ", () => {
		const moving = layer({
			ks: {
				o: {
					a: 1,
					k: [
						{ t: 10, s: [0] },
						{ t: 30, s: [100] },
					],
				},
			},
		});
		const late = layer({ ip: 200 });
		const c = motionChanges({ fr: 30, ip: 0, op: 300, layers: [moving, late] });
		expect(motionDiffers(c, 0, 5)).toBe(false);
		expect(motionDiffers(c, 12, 13)).toBe(true);
		expect(motionDiffers(c, 40, 150)).toBe(false);
		expect(motionDiffers(c, 150, 210)).toBe(true);
	});
	it("keyframes inside a precomp count from the layer's start time", () => {
		const json = {
			assets: [
				{
					id: "p",
					layers: [
						layer({
							ks: {
								o: {
									a: 1,
									k: [
										{ t: 0, s: [0] },
										{ t: 10, s: [100] },
									],
								},
							},
						}),
					],
				},
			],
			layers: [layer({ ty: 0, refId: "p", st: 100 })],
		};
		const c = motionChanges(json);
		expect(motionDiffers(c, 20, 40)).toBe(false);
		expect(motionDiffers(c, 102, 104)).toBe(true);
	});
	it("gives up (draws every frame) on expressions and time remapping", () => {
		expect(
			motionChanges({ layers: [layer({ ks: { o: { a: 0, k: 100, x: "wiggle(1,2)" } } })] }),
		).toBeNull();
		expect(motionChanges({ layers: [layer({ tm: { a: 1, k: [] } })] })).toBeNull();
		expect(motionDiffers(null, 3, 4)).toBe(true);
	});
});

describe("holds inside one keyframe list", () => {
	it("a fade in, a long hold and a fade out only differ during the fades", () => {
		const o = {
			a: 1,
			k: [
				{ t: 0, s: [0] },
				{ t: 8, s: [100] },
				{ t: 160, s: [100] },
				{ t: 170, s: [0] },
			],
		};
		const c = motionChanges({ layers: [layer({ ks: { o } })] });
		expect(motionDiffers(c, 20, 150)).toBe(false);
		expect(motionDiffers(c, 2, 4)).toBe(true);
		expect(motionDiffers(c, 161, 162)).toBe(true);
	});
	it("a hold keyframe changes the picture at the next keyframe", () => {
		const o = {
			a: 1,
			k: [
				{ t: 0, s: [0], h: 1 },
				{ t: 50, s: [100] },
			],
		};
		const c = motionChanges({ layers: [layer({ ks: { o } })] });
		expect(motionDiffers(c, 10, 40)).toBe(false);
		expect(motionDiffers(c, 40, 60)).toBe(true);
	});
});
