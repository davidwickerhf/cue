import { describe, expect, it } from "vitest";
import { usableLicence } from "../electron/core/findMedia";

describe("found media licences", () => {
	it("keeps licences usable in any video", () => {
		for (const l of [
			"CC0",
			"CC BY 4.0",
			"CC BY-SA 3.0",
			"Public domain",
			"PD-US",
			"Public Domain Mark",
		])
			expect(usableLicence(l), l).toBe(true);
	});
	it("drops non-commercial, no-derivatives and unknown licences", () => {
		for (const l of ["CC BY-NC 4.0", "CC BY-ND 2.0", "CC BY-NC-SA 3.0", "All rights reserved", ""])
			expect(usableLicence(l), l).toBe(false);
	});
});
