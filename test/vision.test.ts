import { describe, expect, it } from "vitest";
import { followKeyframes, scoreShot } from "../electron/core/vision";

describe("following faces", () => {
	it("keeps the face centred, smoothly, without leaving the frame uncovered", () => {
		// A face walking from left (0.2) to right (0.8) of a picture twice as wide as the frame.
		const samples = Array.from({ length: 11 }, (_, i) => ({ atMs: i * 400, cx: 0.2 + i * 0.06 }));
		const keys = followKeyframes(samples, 2);
		expect(keys.length).toBeGreaterThan(2);
		// Values move from right to left (the picture slides the other way) and stay within reach.
		expect(keys[0].value).toBeGreaterThan(keys.at(-1)?.value ?? 1);
		for (const k of keys) expect(Math.abs(k.value - 0.5)).toBeLessThanOrEqual(0.5 + 1e-9);
		// A face that never moves gives one position held to the end.
		const still = followKeyframes(
			Array.from({ length: 5 }, (_, i) => ({ atMs: i * 400, cx: 0.5 })),
			2,
		);
		expect(still.map((k) => k.value)).toEqual([0.5, 0.5]);
		// Nothing to pan when the picture fits.
		expect(followKeyframes(samples, 1)).toEqual([]);
	});
});

describe("searching shots", () => {
	const sample = {
		atMs: 0,
		labels: [
			{ id: "dog", confidence: 0.8 },
			{ id: "beach", confidence: 0.6 },
		],
		text: ["PRICING PLANS"],
		faces: 1,
	};
	it("scores what is shown, text on screen, speech and people", () => {
		expect(scoreShot("dogs on a beach", sample, "")).toBeGreaterThan(0.5);
		expect(scoreShot("pricing", sample, "")).toBeGreaterThan(1);
		expect(scoreShot("refund", sample, "we offer a refund")).toBeGreaterThan(0.5);
		expect(scoreShot("person", sample, "")).toBeGreaterThan(0.5);
		expect(scoreShot("volcano", sample, "")).toBe(0);
	});
});
