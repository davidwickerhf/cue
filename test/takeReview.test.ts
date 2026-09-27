import { describe, expect, it } from "vitest";
import { reviewTake } from "../src/lib/takeReview";

const line = { startMs: 10000, targetMs: 6000, maxMs: 6700 };
const next = 17000; // 7 s of room before the next line, 6.65 s after the breath

describe("reviewing a new take", () => {
	it("says a take fits its slot", () => {
		const r = reviewTake({ speechMs: 6000, peakDb: -10, line, nextStartMs: next });
		expect(r.verdict).toBe("fits");
		expect(r.recommend).toBe("use");
		expect(r.fit).toBeUndefined();
	});
	it("offers to make room when a take runs a little long", () => {
		const r = reviewTake({ speechMs: 7400, peakDb: -10, line, nextStartMs: next });
		expect(r.verdict).toBe("long");
		expect(r.recommend).toBe("fit");
		expect(r.fit).toEqual(expect.objectContaining({ fromMs: next }));
		expect(r.fit?.deltaMs).toBeGreaterThanOrEqual(750);
	});
	it("suggests discarding a take far too long", () => {
		const r = reviewTake({ speechMs: 11000, peakDb: -10, line, nextStartMs: next });
		expect(r.verdict).toBe("too-long");
		expect(r.recommend).toBe("discard");
	});
	it("flags a take with no speech", () => {
		expect(reviewTake({ speechMs: 100, peakDb: -60, line, nextStartMs: next }).verdict).toBe(
			"silent",
		);
	});
	it("offers to close the gap after a short take", () => {
		const r = reviewTake({ speechMs: 3500, peakDb: -12, line, nextStartMs: next });
		expect(r.verdict).toBe("short");
		expect(r.fit?.deltaMs).toBeLessThan(0);
	});
});
