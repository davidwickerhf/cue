import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpeg, levelSpeech } from "../electron/core/media";

async function loudness(file: string) {
	const r = await ffmpeg(["-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
	const s = r.slice(r.lastIndexOf("Summary:"));
	return {
		lufs: Number(/I:\s*(-?[\d.]+) LUFS/.exec(s)?.[1]),
		peak: Number(/Peak:\s*(-?[\d.]+) dBFS/.exec(s)?.[1]),
	};
}

describe("levelling a quiet take", () => {
	it("brings a quiet recording up to voice level without clipping, keeping the original", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-level-"));
		const file = path.join(dir, "take.wav");
		// A voice-like signal about 22 dB too quiet: tones that come and go, like syllables.
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"aevalsrc='0.03*sin(2*PI*180*t)*(0.5+0.5*sin(2*PI*3*t))+0.015*sin(2*PI*420*t)':s=48000:d=4",
			"-c:a",
			"pcm_s16le",
			file,
		]);
		const before = await loudness(file);
		const gain = await levelSpeech(file);
		const after = await loudness(file);
		expect(before.lufs).toBeLessThan(-30);
		expect(gain).toBeGreaterThan(10);
		expect(after.lufs).toBeGreaterThan(-21);
		expect(after.peak).toBeLessThan(0);
		await expect(fs.stat(path.join(dir, "take.original.wav"))).resolves.toBeTruthy();
	});

	it("leaves a take that is already loud enough alone", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-level-"));
		const file = path.join(dir, "take.wav");
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			"aevalsrc='0.5*sin(2*PI*180*t)*(0.5+0.5*sin(2*PI*3*t))':s=48000:d=3",
			"-c:a",
			"pcm_s16le",
			file,
		]);
		expect(await levelSpeech(file)).toBe(0);
	});
});
