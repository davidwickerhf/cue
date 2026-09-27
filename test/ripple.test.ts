import { describe, expect, it } from "vitest";
import { applyOp } from "../electron/core/ops";
import { emptyProject } from "../electron/core/project";
import type { ProjectData } from "../electron/core/types";

function project(): ProjectData {
	const p = emptyProject("Ripple");
	return {
		...p,
		tracks: [
			{
				id: "V1",
				kind: "video",
				name: "Video",
				muted: false,
				locked: false,
				hidden: false,
				volume: 1,
			},
			{
				id: "A1",
				kind: "audio",
				name: "Voice",
				muted: false,
				locked: false,
				hidden: false,
				volume: 1,
				voiceover: true,
			},
		] as ProjectData["tracks"],
		clips: [
			{ id: "c1", type: "text", trackId: "V1", startMs: 0, durationMs: 4000, text: "a" },
			{ id: "c2", type: "text", trackId: "V1", startMs: 5000, durationMs: 3000, text: "b" },
			{ id: "c3", type: "text", trackId: "V1", startMs: 9000, durationMs: 2000, text: "c" },
		] as unknown as ProjectData["clips"],
		lines: [
			{ id: "L1", text: "one", startMs: 0, targetMs: 4000, maxMs: 4500 },
			{ id: "L2", text: "two", startMs: 5000, targetMs: 3000, maxMs: 3500 },
		] as unknown as ProjectData["lines"],
		markers: [{ id: "m1", atMs: 6000, label: "x", color: "accent" }],
	};
}

describe("ripple_from", () => {
	it("makes room: everything from the point moves together", () => {
		const { data } = applyOp(project(), { type: "rippleFrom", fromMs: 5000, deltaMs: 1200 });
		expect(data.clips.map((c) => c.startMs)).toEqual([0, 6200, 10200]);
		expect(data.lines.map((l) => l.startMs)).toEqual([0, 6200]);
		expect(data.markers[0].atMs).toBe(7200);
	});
	it("closes a gap without pulling anything before the point", () => {
		const { data } = applyOp(project(), { type: "rippleFrom", fromMs: 5000, deltaMs: -800 });
		expect(data.clips.map((c) => c.startMs)).toEqual([0, 4200, 8200]);
		expect(data.lines[1].startMs).toBe(4200);
	});
});
