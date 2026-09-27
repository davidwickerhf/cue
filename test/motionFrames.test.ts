import { describe, expect, it } from "vitest";
import { isLottie } from "../electron/core/motion";
import { type fitToRegion, FRAME_TEMPLATES, pushedFit } from "../electron/core/motionFrames";
import { compileMotion } from "../electron/core/motionSpec";
import { buildTemplate, templateRegions } from "../electron/core/motionTemplates";

const landscape = { width: 1920, height: 1080, fps: 30 };
const portrait = { width: 1080, height: 1920, fps: 30 };

/** The canvas rectangle (pixels) a clip of `aspect` shows with a fit transform applied. */
function shown(
	fit: ReturnType<typeof fitToRegion>,
	aspect: number,
	canvas: { width: number; height: number },
) {
	const W = canvas.width;
	const H = canvas.height;
	const w = (aspect >= W / H ? W : H * aspect) * fit.scale;
	const h = (aspect >= W / H ? W / aspect : H) * fit.scale;
	const visibleW = w * (1 - fit.crop.left - fit.crop.right);
	const visibleH = h * (1 - fit.crop.top - fit.crop.bottom);
	return {
		left: fit.x * W - visibleW / 2,
		right: fit.x * W + visibleW / 2,
		top: fit.y * H - visibleH / 2,
		bottom: fit.y * H + visibleH / 2,
	};
}

describe("device frames", () => {
	it("has the six frames, each drawn as an overlay with a screen region", () => {
		expect(FRAME_TEMPLATES.map((t) => t.id)).toEqual([
			"frame-crt",
			"frame-laptop",
			"frame-phone",
			"frame-polaroid",
			"frame-film-strip",
			"frame-photo-card",
		]);
		for (const t of FRAME_TEMPLATES) {
			expect(t.category).toBe("frame");
			expect(t.overlay).toBe(true);
			for (const canvas of [landscape, portrait]) {
				const json = compileMotion(buildTemplate(t.id, t.example, canvas));
				expect(isLottie(json)).toBe(true);
				const regions = templateRegions({ template: t.id, params: t.example }, canvas);
				expect(regions?.map((r) => r.name)).toContain("screen");
				for (const r of regions ?? []) {
					// The screen is on the frame and has a sensible size.
					expect(r.x).toBeGreaterThanOrEqual(0);
					expect(r.y).toBeGreaterThanOrEqual(0);
					expect(r.x + r.width).toBeLessThanOrEqual(1.0001);
					expect(r.y + r.height).toBeLessThanOrEqual(1.0001);
					expect(r.width * r.height).toBeGreaterThan(0.01);
				}
			}
		}
	});

	it("fits 16:9, 4:3 and 9:16 clips so they fill each screen without spilling past it", () => {
		for (const t of FRAME_TEMPLATES)
			for (const canvas of [landscape, portrait]) {
				const regions = templateRegions({ template: t.id, params: t.example }, canvas) ?? [];
				for (const region of regions)
					for (const [shape, aspect] of [
						["16:9", 16 / 9],
						["4:3", 4 / 3],
						["9:16", 9 / 16],
					] as const) {
						const fit = region.fit[shape];
						const rect = shown(fit, aspect, canvas);
						const hole = {
							left: region.x * canvas.width,
							right: (region.x + region.width) * canvas.width,
							top: region.y * canvas.height,
							bottom: (region.y + region.height) * canvas.height,
						};
						const bleed = 0.006 * Math.min(canvas.width, canvas.height);
						const label = `${t.id} ${region.name} ${shape} on ${canvas.width}x${canvas.height}`;
						// Covers the hole…
						expect(rect.left, label).toBeLessThanOrEqual(hole.left + 0.5);
						expect(rect.right, label).toBeGreaterThanOrEqual(hole.right - 0.5);
						expect(rect.top, label).toBeLessThanOrEqual(hole.top + 0.5);
						expect(rect.bottom, label).toBeGreaterThanOrEqual(hole.bottom - 0.5);
						// …and is cropped to it (plus a little bleed under the frame), when the crop can reach.
						if (fit.crop.left < 0.45 && fit.crop.top < 0.45) {
							expect(rect.left, label).toBeGreaterThanOrEqual(hole.left - bleed - 1);
							expect(rect.right, label).toBeLessThanOrEqual(hole.right + bleed + 1);
							expect(rect.top, label).toBeGreaterThanOrEqual(hole.top - bleed - 1);
							expect(rect.bottom, label).toBeLessThanOrEqual(hole.bottom + bleed + 1);
						}
					}
			}
	});

	it("puts a 16:9 clip exactly under the laptop screen and follows a push-in", () => {
		const [screen] =
			templateRegions({ template: "frame-laptop", params: { x: 0.4, y: 0.55 } }, landscape) ?? [];
		const fit = screen.fit["16:9"];
		expect(fit.x).toBeCloseTo(0.4, 2);
		// A 16:9 hole needs no crop beyond the bleed.
		expect(fit.crop.left).toBeLessThan(0.01);
		expect(fit.crop.top).toBeLessThan(0.02);
		expect((screen.width * 1920) / (screen.height * 1080)).toBeCloseTo(16 / 9, 1);
		const pushed = pushedFit(fit, 1.06);
		expect(pushed.scale).toBeCloseTo(fit.scale * 1.06, 3);
		expect(pushed.x).toBeCloseTo(0.5 + (fit.x - 0.5) * 1.06, 3);
		expect(screen.pushed.clip).toEqual(pushed);
	});

	it("reports one region per film frame, the middle one named screen", () => {
		const regions =
			templateRegions({ template: "frame-film-strip", params: { frames: 3 } }, landscape) ?? [];
		expect(regions.map((r) => r.name)).toEqual(["frame-1", "screen", "frame-3"]);
		expect(regions[0].x).toBeLessThan(regions[1].x);
		expect(templateRegions({ template: "lower-third", params: {} }, landscape)).toBeUndefined();
	});
});
