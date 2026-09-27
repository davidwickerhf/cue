import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { probe } from "../electron/core/media";
import {
	creditLine,
	generateMusic,
	licenceLabel,
	MUSIC_MOODS,
	musicSearchUrl,
	toTrack,
} from "../electron/core/music";

describe("finding music", () => {
	it("asks Openverse for music under licences usable in any video", () => {
		const url = new URL(musicSearchUrl({ query: "calm piano", limit: 5 }));
		expect(url.searchParams.get("category")).toBe("music");
		expect(url.searchParams.get("license")).toBe("cc0,pdm,by,by-sa");
		expect(url.searchParams.get("q")).toBe("calm piano");
	});

	it("labels licences and writes a credit line", () => {
		expect(licenceLabel("by", "3.0")).toBe("CC BY 3.0");
		expect(licenceLabel("cc0")).toBe("CC0 1.0");
		const t = toTrack({
			id: "x",
			title: "Nuage",
			creator: "Someone",
			license: "by",
			license_version: "3.0",
			foreign_landing_url: "https://example.org/t/1",
			url: "https://example.org/t/1.mp3",
			duration: 199000,
			source: "jamendo",
		});
		expect(t.licence).toBe("CC BY 3.0");
		expect(t.credit).toBe(creditLine(t));
		expect(t.credit).toContain("Someone");
	});
});

describe("making music", () => {
	for (const mood of MUSIC_MOODS)
		it(`composes ${mood} music of the asked length`, async () => {
			const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "cue-music-")), `${mood}.m4a`);
			const made = await generateMusic({ mood, durationMs: 6000 }, out);
			const info = await probe(out);
			expect(info.hasAudio).toBe(true);
			expect(Math.abs(info.durationMs - 6000)).toBeLessThan(250);
			expect(made.bpm).toBeGreaterThan(40);
		});
});
