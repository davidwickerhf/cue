import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compressorSettings, mixRole, trackAudioFilters } from "../electron/core/audio";
import { ffmpeg } from "../electron/core/media";
import { applyOp } from "../electron/core/ops";
import { emptyProject } from "../electron/core/project";
import { ProjectStore } from "../electron/core/store";

/** Mean level of a file in dB, from ffmpeg's volumedetect. */
async function meanVolume(file: string): Promise<number> {
	let log: string;
	try {
		log = await ffmpeg(["-i", file, "-af", "volumedetect", "-f", "null", "-"]);
	} catch (error) {
		log = String((error as { stderr?: string }).stderr);
	}
	const found = /mean_volume:\s+(-?[\d.]+) dB/.exec(log);
	if (!found) throw new Error(`No volume in ${log.slice(-400)}`);
	return Number(found[1]);
}

/** A sine tone WAV at a frequency and gain (dB; lavfi's sine peaks at -18 dBFS). */
async function tone(file: string, frequency: number, db: number, seconds = 4) {
	await ffmpeg([
		"-f",
		"lavfi",
		"-i",
		`sine=f=${frequency}:d=${seconds}:sample_rate=48000`,
		"-af",
		`volume=${db}dB`,
		"-ac",
		"2",
		file,
	]);
}

async function project(prefix: string) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	const store = new ProjectStore({
		mediaUrl: (f) => f,
		recentFile: path.join(dir, "recent.json"),
		autoProxies: () => false,
	});
	await store.create({ path: dir, name: "Audio" });
	store.apply({ type: "updateExport", export: { normalize: false } }, "user");
	return { dir, store };
}

describe("track EQ and compressor", () => {
	it("merges EQ patches band by band and resets with null", () => {
		let data = emptyProject("x");
		data = applyOp(data, { type: "updateTrack", id: "A1", patch: { eq: { high: 4 } } }).data;
		data = applyOp(data, { type: "updateTrack", id: "A1", patch: { eq: { low: -2 } } }).data;
		expect(data.tracks.find((t) => t.id === "A1")?.eq).toEqual({ low: -2, mid: 0, high: 4 });
		data = applyOp(data, {
			type: "updateTrack",
			id: "A1",
			patch: { eq: null, compressor: { amount: 0.4 } },
		}).data;
		const track = data.tracks.find((t) => t.id === "A1");
		expect(track?.eq).toBeUndefined();
		expect(track?.compressor).toEqual({ amount: 0.4 });
		expect(() =>
			applyOp(data, { type: "updateTrack", id: "A1", patch: { eq: { mid: 20 } } }),
		).toThrow();
	});

	it("maps them to ffmpeg filters", () => {
		expect(trackAudioFilters({})).toEqual([]);
		const filters = trackAudioFilters({
			eq: { low: -3, mid: 2, high: 3 },
			compressor: { amount: 0.5 },
		});
		expect(filters[0]).toMatch(/^bass=g=-3\.00:f=120/);
		expect(filters[1]).toMatch(/^equalizer=f=1200:t=q:w=0\.9:g=2\.00/);
		expect(filters[2]).toMatch(/^treble=g=3\.00:f=8000/);
		expect(filters[3]).toMatch(/^acompressor=threshold=.*:attack=10:release=150/);
		const c = compressorSettings(0.5);
		expect(c.thresholdDb).toBe(-21);
		expect(c.ratio).toBe(3.75);
		expect(c.makeupDb).toBeGreaterThan(0);
	});

	it("exports with EQ and compressor, and a high-shelf cut lowers a high tone", async () => {
		const { dir, store } = await project("cue-eq-");
		const hiss = path.join(dir, "hiss.wav");
		await tone(hiss, 12000, -12);
		const [asset] = await store.importMedia([hiss], "user");
		store.apply(
			{
				type: "addClips",
				clips: [{ type: "media", trackId: "A2", assetId: asset.id, startMs: 0, durationMs: 4000 }],
			},
			"user",
		);
		store.apply({ type: "updateTrack", id: "A2", patch: { volume: 1, duck: false } }, "user");
		const flat = (await store.export("audio", "flat.wav", "user")).outputs[0];
		store.apply(
			{
				type: "updateTrack",
				id: "A2",
				patch: { eq: { low: 2, mid: -1, high: -12 }, compressor: { amount: 0.3 } },
			},
			"user",
		);
		const cut = (await store.export("audio", "cut.wav", "user")).outputs[0];
		const before = await meanVolume(flat);
		const after = await meanVolume(cut);
		expect(before - after).toBeGreaterThan(6);
		// The video export uses the same per-track mix.
		const video = await store.export("video", "out.mp4", "user");
		expect(video.outputs[0]).toMatch(/out\.mp4$/);
	}, 90000);
});

describe("auto-mix", () => {
	it("brings a quiet voice up, a loud music bed down, and ducks the music", async () => {
		const { dir, store } = await project("cue-automix-");
		const voice = path.join(dir, "voice.wav");
		const music = path.join(dir, "music.wav");
		await tone(voice, 300, -10);
		await tone(music, 500, 15);
		const [v, m] = await store.importMedia([voice, music], "user");
		store.apply(
			{
				type: "addClips",
				clips: [
					{ type: "media", trackId: "A1", assetId: v.id, startMs: 0, durationMs: 4000 },
					{ type: "media", trackId: "A2", assetId: m.id, startMs: 0, durationMs: 4000 },
				],
			},
			"user",
		);
		store.apply({ type: "updateTrack", id: "A2", patch: { volume: 1, duck: false } }, "user");
		const bed = store.current.tracks.find((t) => t.id === "A2");
		expect(bed && mixRole(store.current, bed)).toBe("music");
		const result = await store.autoMix("agent");
		const a1 = store.current.tracks.find((t) => t.id === "A1");
		const a2 = store.current.tracks.find((t) => t.id === "A2");
		expect(a1?.volume).toBeGreaterThan(1);
		expect(a2?.volume).toBeLessThan(1);
		expect(a2?.duck).toBe(true);
		expect(a1?.eq).toEqual({ low: -3, mid: 2, high: 3 });
		expect(a1?.compressor).toEqual({ amount: 0.5 });
		expect(result.tracks.find((t) => t.trackId === "A1")?.preset).toBe("Voice");
		// The music is measured and placed 8 dB under the dialogue target.
		const music2 = result.tracks.find((t) => t.trackId === "A2");
		expect(music2?.targetLufs).toBe(-24);
		const after = await store.measureLoudness();
		expect(after.integratedLufs).not.toBeNull();
		// One undo step puts everything back.
		store.undo("user");
		expect(store.current.tracks.find((t) => t.id === "A1")?.volume).toBe(1);
		expect(store.current.tracks.find((t) => t.id === "A1")?.eq).toBeUndefined();
		expect(store.current.tracks.find((t) => t.id === "A2")?.duck).toBe(false);
	}, 90000);
});
