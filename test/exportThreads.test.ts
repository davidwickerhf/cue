import { describe, expect, it } from "vitest";
import { filterGraphThreads } from "../electron/core/exporter";

describe("filter graph threads for long edits", () => {
	it("leaves small exports on ffmpeg's default", () => {
		expect(filterGraphThreads(3)).toBeUndefined();
		expect(filterGraphThreads(24)).toBeUndefined();
	});

	it("keeps a long layered edit under the process thread limit", () => {
		expect(filterGraphThreads(100)).toBe(4);
		expect(filterGraphThreads(440)).toBe(3);
		expect(filterGraphThreads(2000)).toBe(1);
		// About two scalers per input, each with this many threads, well under macOS's 4,096.
		for (const inputs of [25, 200, 440, 900]) {
			expect(inputs * 2 * (filterGraphThreads(inputs) ?? 1)).toBeLessThan(4096);
		}
	});
});
