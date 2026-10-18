import { describe, expect, it } from "vitest";
import { specTexts, withSpecText } from "../src/lib/motionText";

const spec = {
	layers: [
		{ type: "text", name: "H", text: "About this video" },
		{ type: "line", name: "R" },
		{ type: "group", layers: [{ type: "text", name: "L0", text: "First" }] },
		{ type: "text", name: "L1", text: "Second" },
	],
};

describe("motion graphic text fields", () => {
	it("lists text layers in spec order, inside groups too", () => {
		expect(specTexts(spec).map((t) => [t.path, t.name])).toEqual([
			["0", "H"],
			["2.0", "L0"],
			["3", "L1"],
		]);
	});

	it("changes a line, and an emptied line removes the layer", () => {
		expect(specTexts(withSpecText(spec, "2.0", "Changed"))[1].text).toBe("Changed");
		const removed = withSpecText(spec, "3", null);
		expect(removed.layers).toHaveLength(3);
		expect(specTexts(removed).map((t) => t.name)).toEqual(["H", "L0"]);
		// The original is untouched.
		expect(spec.layers).toHaveLength(4);
	});
});
