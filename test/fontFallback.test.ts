import { describe, expect, it } from "vitest";
import { textWidth } from "../electron/core/motionSpec";

describe("motion fonts", () => {
	// A graphic made in a newer Cue can name a family this build doesn't have
	// (0.2.5 crashed its whole window measuring DM Sans text): measure it as sans.
	it("measures text in a family it doesn't know as sans instead of throwing", () => {
		const unknown = "future-font" as unknown as "sans";
		expect(() => textWidth("Cut by hand", 36, unknown, 0, 700)).not.toThrow();
		expect(textWidth("Cut by hand", 36, unknown, 0, 700)).toBeCloseTo(
			textWidth("Cut by hand", 36, "sans", 0, 700),
		);
	});

	it("measures DM Sans (ui) with its own metrics", () => {
		expect(textWidth("Cut by hand", 36, "ui", 0, 700)).toBeGreaterThan(0);
		expect(textWidth("Cut by hand", 36, "ui", 0, 700)).not.toBeCloseTo(
			textWidth("Cut by hand", 36, "sans", 0, 700),
		);
	});
});
