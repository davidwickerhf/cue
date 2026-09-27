import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpeg } from "../electron/core/media";
import {
	generateSfx,
	SFX_CHARACTERS,
	SFX_KINDS,
	sfxRecipe,
	sfxSearchUrl,
} from "../electron/core/sfx";

async function measure(file: string) {
	const log = await ffmpeg(["-i", file, "-af", "volumedetect", "-f", "null", "-"]);
	const max = Number(/max_volume: (-?[\d.]+) dB/.exec(log)?.[1]);
	const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
	const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
	return { max, seconds };
}

describe("generated sound effects", () => {
	it("every kind makes an audible, unclipped sound of about its length, different for each seed", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-sfx-"));
		for (const kind of SFX_KINDS) {
			const a = await generateSfx(kind, { seed: 1 }, path.join(dir, `${kind}-1.wav`));
			const b = await generateSfx(kind, { seed: 2 }, path.join(dir, `${kind}-2.wav`));
			const m = await measure(a.file);
			expect(m.max, kind).toBeGreaterThan(-24);
			expect(m.max, kind).toBeLessThanOrEqual(-0.5);
			expect(Math.abs(m.seconds * 1000 - a.durationMs), kind).toBeLessThan(80);
			const hash = async (f: string) =>
				createHash("md5")
					.update(await fs.readFile(f))
					.digest("hex");
			expect(await hash(a.file), kind).not.toEqual(await hash(b.file));
		}
	}, 120000);

	it("the same seed gives the same variant, and characters change the chain", () => {
		expect(sfxRecipe("whoosh", { seed: 7 })).toEqual(sfxRecipe("whoosh", { seed: 7 }));
		const chains = SFX_CHARACTERS.map((c) => sfxRecipe("impact", { seed: 7, character: c }).graph);
		expect(new Set(chains).size).toBe(SFX_CHARACTERS.length);
		expect(sfxRecipe("riser", { seed: 3, durationMs: 3000 }).durationMs).toBe(3000);
	});

	it("searches only sound effects under licences usable in any video", () => {
		const u = new URL(sfxSearchUrl({ query: "door slam" }));
		expect(u.searchParams.get("category")).toBe("sound_effect");
		expect(u.searchParams.get("license")).toBe("cc0,pdm,by,by-sa");
	});
});
